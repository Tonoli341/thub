import dayjs from "dayjs";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Skeleton,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";

import { closeActiveActivityAdmin, discardActiveActivityAdmin, getActiveActivitiesAdmin } from "../api";
import { useAuth } from "../auth";
import ReportingPeriodFilter from "../components/ReportingPeriodFilter";
import PageHeader from "../components/PageHeader";
import { headRowSx, tableSx } from "../components/tableStyles";
import { activeActivitiesColumns } from "./activeActivitiesColumns";

const REFRESH_INTERVAL_MS = 20000;
const STALE_HEARTBEAT_SECONDS = 5 * 60;

function fmtDuration(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ""}` : `${m}m`;
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  return dayjs(iso).format("DD/MM/YYYY HH:mm");
}

function fmtRelative(iso) {
  if (!iso) return "—";
  const seconds = dayjs().diff(dayjs(iso), "second");
  if (seconds < 60) return "adesso";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min fa`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h fa`;
}

function ActivityRow({ record, isAdmin, onClose, onDiscard }) {
  const isPaused = !!record.paused_at;
  const heartbeatAge = dayjs().diff(dayjs(record.last_heartbeat_at), "second");
  const isStale = heartbeatAge > STALE_HEARTBEAT_SECONDS;

  return (
    <TableRow hover sx={isStale ? { bgcolor: "rgba(211,47,47,0.06)" } : undefined}>
      <TableCell>
        <Typography variant="body2" fontWeight={700} noWrap>
          {record.employee_name || record.employee_id}
        </Typography>
      </TableCell>
      <TableCell>
        <Typography variant="body2" fontWeight={500} noWrap sx={{ maxWidth: 200 }}>
          {record.mapping_description || record.mapping_id}
        </Typography>
        {record.infinity_item_name && (
          <Typography variant="caption" color="text.secondary" display="block">
            {record.infinity_item_name}
          </Typography>
        )}
      </TableCell>
      <TableCell>
        {record.operational_area_name ? (
          <Box
            sx={{
              display: "inline-block",
              px: 0.75,
              py: 0.15,
              borderRadius: 1,
              bgcolor: "rgba(0,112,64,0.1)",
              color: "primary.main",
              fontWeight: 700,
              fontSize: "0.76rem",
            }}
          >
            {record.operational_area_name}
          </Box>
        ) : (
          <Typography variant="caption" color="text.disabled">—</Typography>
        )}
        {record.building && (
          <Typography variant="caption" color="text.secondary" display="block">{record.building}</Typography>
        )}
      </TableCell>
      <TableCell>
        <Typography variant="body2">{fmtDateTime(record.started_at)}</Typography>
      </TableCell>
      <TableCell>
        <Chip
          label={isPaused ? "⏸ In pausa" : "▶ In corso"}
          size="small"
          sx={{
            bgcolor: isPaused ? "rgba(230,81,0,0.1)" : "rgba(0,112,64,0.1)",
            color: isPaused ? "#e65100" : "primary.main",
            fontWeight: 700,
            fontSize: "0.72rem",
          }}
        />
      </TableCell>
      <TableCell>
        <Chip
          label={fmtDuration(record.elapsed_seconds)}
          size="small"
          sx={{ bgcolor: "rgba(0,112,64,0.08)", color: "primary.main", fontWeight: 700, fontSize: "0.72rem" }}
        />
      </TableCell>
      <TableCell>
        <Tooltip title={isStale ? "Nessun heartbeat da oltre 5 minuti: sessione probabilmente abbandonata" : ""}>
          <Typography variant="body2" color={isStale ? "error.main" : "text.secondary"} fontWeight={isStale ? 700 : 400}>
            {fmtRelative(record.last_heartbeat_at)}
          </Typography>
        </Tooltip>
      </TableCell>
      {isAdmin && (
        <TableCell>
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="outlined" startIcon={<span aria-hidden="true">🏁</span>} onClick={() => onClose(record)}>
              Chiudi
            </Button>
            <Button size="small" variant="outlined" color="error" startIcon={<span aria-hidden="true">🗑️</span>} onClick={() => onDiscard(record)}>
              Scarta
            </Button>
          </Stack>
        </TableCell>
      )}
    </TableRow>
  );
}

export default function ActiveActivitiesPage() {
  const queryClient = useQueryClient();
  const { effectiveUser } = useAuth();
  const isAdmin = effectiveUser?.effective_role === "admin";
  const [confirmClose, setConfirmClose] = useState(null);
  const [confirmDiscard, setConfirmDiscard] = useState(null);
  const [snackbar, setSnackbar] = useState(null);
  const today = dayjs().format("YYYY-MM-DD");
  const [range, setRange] = useState({ start: today, end: today });

  const { data = [], isLoading, error } = useQuery({
    queryKey: ["active-activities-admin", range.start, range.end],
    queryFn: () => getActiveActivitiesAdmin({ startDate: range.start, endDate: range.end }),
    refetchInterval: REFRESH_INTERVAL_MS,
  });

  const closeMutation = useMutation({
    mutationFn: (activityId) => closeActiveActivityAdmin(activityId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["active-activities-admin"] });
      setConfirmClose(null);
      setSnackbar("Attività chiusa e registrata");
    },
  });

  const discardMutation = useMutation({
    mutationFn: (activityId) => discardActiveActivityAdmin(activityId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["active-activities-admin"] });
      setConfirmDiscard(null);
      setSnackbar("Attività scartata, nessun record creato");
    },
  });

  const columns = activeActivitiesColumns(isAdmin);

  return (
    <Stack spacing={3}>
      <PageHeader
        section="Rendicontazioni"
        title="Timer attivi"
        meta={isLoading ? undefined : `${data.length} timer ${data.length === 1 ? "aperto" : "aperti"} nel periodo`}
      />

      <ReportingPeriodFilter start={range.start} end={range.end} onChange={setRange} />

      {error && <Alert severity="error">{error.message}</Alert>}

      <Paper sx={{ borderRadius: 3, overflow: "hidden" }}>
        <Box sx={{ px: 2, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
          <Chip
            label="🔄 Aggiornamento automatico ogni 20s"
            size="small"
            variant="outlined"
            sx={{ fontSize: "0.72rem", color: "text.secondary" }}
          />
        </Box>

        {isLoading && (
          <Stack>
            {[1, 2, 3].map((i) => (
              <Box key={i} sx={{ px: 3, py: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
                <Skeleton height={32} />
              </Box>
            ))}
          </Stack>
        )}

        {!isLoading && data.length === 0 && (
          <Box sx={{ py: 6, textAlign: "center" }}>
            <Typography variant="body2" color="text.disabled">
              Nessun timer aperto al momento.
            </Typography>
          </Box>
        )}

        {!isLoading && data.length > 0 && (
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small" sx={tableSx({ minWidth: 900, dense: true })}>
              <TableHead>
                <TableRow sx={headRowSx}>
                  {columns.map((column) => (
                    <TableCell key={column.key} sx={{ width: `${column.width}%` }}>
                      {column.label}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {data.map((record) => (
                  <ActivityRow
                    key={record.id}
                    record={record}
                    isAdmin={isAdmin}
                    onClose={setConfirmClose}
                    onDiscard={setConfirmDiscard}
                  />
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Paper>

      {/* Confirm close dialog */}
      <Dialog open={!!confirmClose} onClose={() => !closeMutation.isPending && setConfirmClose(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Chiudi attività</DialogTitle>
        <DialogContent>
          <Typography>
            Chiudere ora l&apos;attività di <strong>{confirmClose?.employee_name || confirmClose?.employee_id}</strong>?
            Verrà registrato un record definitivo con orario di fine impostato ad adesso.
          </Typography>
          {closeMutation.error && (
            <Alert severity="error" sx={{ mt: 2 }}>{closeMutation.error.message}</Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmClose(null)} disabled={closeMutation.isPending}>Annulla</Button>
          <Button
            variant="contained"
            onClick={() => closeMutation.mutate(confirmClose.id)}
            disabled={closeMutation.isPending}
          >
            {closeMutation.isPending ? <CircularProgress size={18} color="inherit" /> : "Chiudi"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirm discard dialog */}
      <Dialog open={!!confirmDiscard} onClose={() => !discardMutation.isPending && setConfirmDiscard(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Scarta attività</DialogTitle>
        <DialogContent>
          <Typography>
            Scartare l&apos;attività di <strong>{confirmDiscard?.employee_name || confirmDiscard?.employee_id}</strong>?
            Non verrà creato alcun record: il tempo trascorso andrà perso. L&apos;operazione non può essere annullata.
          </Typography>
          {discardMutation.error && (
            <Alert severity="error" sx={{ mt: 2 }}>{discardMutation.error.message}</Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDiscard(null)} disabled={discardMutation.isPending}>Annulla</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => discardMutation.mutate(confirmDiscard.id)}
            disabled={discardMutation.isPending}
          >
            {discardMutation.isPending ? <CircularProgress size={18} color="inherit" /> : "Scarta"}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!snackbar}
        autoHideDuration={3000}
        onClose={() => setSnackbar(null)}
        message={snackbar}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Stack>
  );
}
