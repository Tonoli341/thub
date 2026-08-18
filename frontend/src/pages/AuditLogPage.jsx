import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";

import { getAuditLogFilters, getAuditLogs } from "../api";

const ACTION_COLORS = {
  create: "success",
  update: "info",
  upsert: "info",
  delete: "error",
  login: "default",
  approve: "success",
  request_correction: "warning",
};

function formatTimestamp(value) {
  if (!value) return "—";
  const d = new Date(value);
  return `${d.toLocaleDateString("it-IT")} ${d.toLocaleTimeString("it-IT")}`;
}

function AuditRow({ item }) {
  const [open, setOpen] = useState(false);
  const hasDetail = item.detail && Object.keys(item.detail).length > 0;
  const color = ACTION_COLORS[item.action] ?? "default";

  return (
    <>
      <TableRow hover sx={{ "& td": { borderBottom: open ? "none" : undefined } }}>
        <TableCell sx={{ whiteSpace: "nowrap", fontSize: 13 }}>{formatTimestamp(item.created_at)}</TableCell>
        <TableCell sx={{ fontSize: 13, fontWeight: 600 }}>{item.actor_name || "—"}</TableCell>
        <TableCell>
          <Chip size="small" label={item.action} color={color} variant="outlined" />
        </TableCell>
        <TableCell sx={{ fontSize: 13 }}>{item.entity}</TableCell>
        <TableCell align="right">
          {hasDetail && (
            <IconButton size="small" onClick={() => setOpen((v) => !v)} aria-label="Dettaglio">
              <Box component="span" sx={{ fontSize: 12, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s", display: "inline-block" }}>
                ▶
              </Box>
            </IconButton>
          )}
        </TableCell>
      </TableRow>
      {hasDetail && (
        <TableRow>
          <TableCell colSpan={5} sx={{ py: 0, borderBottom: open ? undefined : "none" }}>
            <Collapse in={open} unmountOnExit>
              <Box
                component="pre"
                sx={{
                  m: 0,
                  my: 1,
                  p: 1.5,
                  borderRadius: 2,
                  bgcolor: "action.hover",
                  fontSize: 12,
                  overflowX: "auto",
                  maxHeight: 300,
                }}
              >
                {JSON.stringify(item.detail, null, 2)}
              </Box>
            </Collapse>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export default function AuditLogPage() {
  const [entity, setEntity] = useState("");
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [search, setSearch] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);

  const filtersQuery = useQuery({
    queryKey: ["audit-log-filters"],
    queryFn: getAuditLogFilters,
    staleTime: 60000,
  });

  const logsQuery = useQuery({
    queryKey: ["audit-logs", { entity, action, actor, search, start, end, page, rowsPerPage }],
    queryFn: () =>
      getAuditLogs({
        entity,
        action,
        actor,
        search,
        start,
        end,
        limit: rowsPerPage,
        offset: page * rowsPerPage,
      }),
    placeholderData: keepPreviousData,
    staleTime: 15000,
  });

  const resetPage = (setter) => (value) => {
    setter(value);
    setPage(0);
  };

  const items = logsQuery.data?.items ?? [];
  const total = logsQuery.data?.total ?? 0;

  return (
    <Box>
      <Stack direction="row" alignItems="baseline" justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography variant="h5" fontWeight={700}>
          Audit
        </Typography>
        <Typography fontSize={13} color="text.secondary">
          Registro di chi ha fatto cosa (creazioni, modifiche, cancellazioni, accessi)
        </Typography>
      </Stack>

      <Paper sx={{ p: 2, mb: 2, borderRadius: 3 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} useFlexGap flexWrap="wrap">
          <TextField
            select
            size="small"
            label="Entità"
            value={entity}
            onChange={(e) => resetPage(setEntity)(e.target.value)}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="">Tutte</MenuItem>
            {(filtersQuery.data?.entities ?? []).map((value) => (
              <MenuItem key={value} value={value}>
                {value}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Azione"
            value={action}
            onChange={(e) => resetPage(setAction)(e.target.value)}
            sx={{ minWidth: 170 }}
          >
            <MenuItem value="">Tutte</MenuItem>
            {(filtersQuery.data?.actions ?? []).map((value) => (
              <MenuItem key={value} value={value}>
                {value}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Utente"
            value={actor}
            onChange={(e) => resetPage(setActor)(e.target.value)}
            sx={{ minWidth: 170 }}
          />
          <TextField
            size="small"
            label="Cerca nel dettaglio"
            value={search}
            onChange={(e) => resetPage(setSearch)(e.target.value)}
            sx={{ minWidth: 200 }}
          />
          <TextField
            size="small"
            type="date"
            label="Dal"
            value={start}
            onChange={(e) => resetPage(setStart)(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            size="small"
            type="date"
            label="Al"
            value={end}
            onChange={(e) => resetPage(setEnd)(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
        </Stack>
      </Paper>

      {logsQuery.isError && <Alert severity="error">{String(logsQuery.error?.message || "Errore di caricamento")}</Alert>}

      <Paper sx={{ borderRadius: 3, overflow: "hidden" }}>
        {logsQuery.isLoading ? (
          <Box sx={{ py: 6, display: "grid", placeItems: "center" }}>
            <CircularProgress size={28} />
          </Box>
        ) : (
          <>
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>Data e ora</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Utente</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Azione</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Entità</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                      Dettaglio
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} align="center" sx={{ py: 4, color: "text.secondary" }}>
                        Nessuna voce di audit per i filtri selezionati
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((item) => <AuditRow key={item.id} item={item} />)
                  )}
                </TableBody>
              </Table>
            </Box>
            <TablePagination
              component="div"
              count={total}
              page={page}
              onPageChange={(_, newPage) => setPage(newPage)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => {
                setRowsPerPage(parseInt(e.target.value, 10));
                setPage(0);
              }}
              rowsPerPageOptions={[25, 50, 100, 200]}
              labelRowsPerPage="Righe per pagina"
              labelDisplayedRows={({ from, to, count }) => `${from}–${to} di ${count}`}
            />
          </>
        )}
      </Paper>
    </Box>
  );
}
