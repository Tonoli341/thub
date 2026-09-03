import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  Paper,
  Snackbar,
  Skeleton,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import dayjs from "dayjs";
import "dayjs/locale/it";

dayjs.locale("it");

import { useAuth } from "../auth";
import { getEmployeeOptions } from "../api";
import FilterBar from "../components/FilterBar";
import FilterSelect from "../components/FilterSelect";
import PageHeader, { HeaderButton } from "../components/PageHeader";
import { bodyRowSx, headRowSx, tableSx } from "../components/tableStyles";
import {
  ackMaintenanceDeadline,
  completeMaintenanceDeadline,
  createMaintenanceAssetCounter,
  createMaintenanceDeadline,
  deleteMaintenanceAsset,
  deleteMaintenanceAssetCounter,
  deleteMaintenanceDeadline,
  deleteMaintenanceDocument,
  updateMaintenanceDocumentStatus,
  deleteMaintenanceImage,
  downloadMaintenanceDocument,
  downloadMaintenanceImage,
  fetchMaintenanceAssetQrImageBlobUrl,
  fetchMaintenanceDocumentBlobUrl,
  fetchMaintenanceImageBlobUrl,
  openMaintenanceDocumentInNewTab,
  getMaintenanceAsset,
  getMaintenanceAssetClasses,
  getMaintenanceAssetCounters,
  getMaintenanceAssetDeadlines,
  createMaintenanceAssetComment,
  getMaintenanceAssetComments,
  getMaintenanceAssetHistory,
  getMaintenanceAssetQrToken,
  getMaintenanceDocuments,
  getMaintenancePhotos,
  postponeMaintenanceDeadline,
  regenerateMaintenanceAssetQrToken,
  removeMaintenanceAssetImageField,
  updateMaintenanceAsset,
  updateMaintenanceAssetCounter,
  uploadMaintenanceAssetImageField,
  uploadMaintenanceAssetMainImage,
  uploadMaintenanceDocument,
  uploadMaintenancePhoto,
} from "../maintenanceAssetsApi";
import { MAINTENANCE_ASSET_STATUS_COLORS, MAINTENANCE_ASSET_STATUS_LABELS } from "./maintenanceAssetsColumns";
import { computeCounterStats } from "./maintenanceCounterStats";
import {
  countMaintenanceHistoryFilters,
  emptyMaintenanceHistoryFilters,
  filterMaintenanceAssetHistory,
  maintenanceHistoryOptionValues,
} from "./maintenanceAssetHistoryFilters";

const URGENCY_LABELS = { regolare: "Regolare", in_scadenza: "In scadenza", urgente: "Urgente", scaduta: "Scaduta" };
const URGENCY_COLORS = { regolare: "success", in_scadenza: "warning", urgente: "error", scaduta: "error" };

const URGENCY_ACCENTS = {
  regolare: { color: "success.main", background: "rgba(46, 125, 50, 0.08)" },
  in_scadenza: { color: "warning.main", background: "rgba(237, 108, 2, 0.10)" },
  urgente: { color: "error.main", background: "rgba(211, 47, 47, 0.10)" },
  scaduta: { color: "error.dark", background: "rgba(211, 47, 47, 0.16)" },
};

const HISTORY_FIELD_LABELS = {
  status: "Stato",
  site: "Sito",
  department: "Reparto",
  responsible_employee_id: "Responsabile",
};

function formatHistoryValue(field, value) {
  if (!value) return "—";
  if (field === "status") return MAINTENANCE_ASSET_STATUS_LABELS[value] ?? value;
  return value;
}

function TrashIcon({ size = 18 }) {
  return (
    <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{ width: size, height: size, display: "block" }}>
      <path
        d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Box>
  );
}

function SearchIcon({ size = 18 }) {
  return (
    <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{ width: size, height: size, display: "block" }}>
      <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m15.5 15.5 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </Box>
  );
}

function FilterIcon({ size = 18 }) {
  return (
    <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{ width: size, height: size, display: "block" }}>
      <path d="M4 6h16M7 12h10M10 18h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="8" cy="6" r="1.6" fill="currentColor" />
      <circle cx="15" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="18" r="1.6" fill="currentColor" />
    </Box>
  );
}

function EyeIcon({ size = 18 }) {
  return (
    <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{ width: size, height: size, display: "block" }}>
      <path
        d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </Box>
  );
}

function DownloadIcon({ size = 18 }) {
  return (
    <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{ width: size, height: size, display: "block" }}>
      <path
        d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Box>
  );
}

function CloseIcon({ size = 18 }) {
  return (
    <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{ width: size, height: size, display: "block" }}>
      <path
        d="M6 6l12 12M18 6 6 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Box>
  );
}

function ExternalLinkIcon({ size = 18 }) {
  return (
    <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{ width: size, height: size, display: "block" }}>
      <path
        d="M14 4h6v6M20 4 10 14M9 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Box>
  );
}

function ArrowLeftIcon({ size = 16 }) {
  return (
    <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{ width: size, height: size, display: "block" }}>
      <path d="M19 12H5m0 0 6-6m-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Box>
  );
}

function MoreIcon({ size = 18 }) {
  return (
    <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{ width: size, height: size, display: "block" }}>
      <circle cx="5" cy="12" r="1.7" fill="currentColor" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" />
      <circle cx="19" cy="12" r="1.7" fill="currentColor" />
    </Box>
  );
}

function CameraIcon({ size = 22 }) {
  return (
    <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{ width: size, height: size, display: "block" }}>
      <path d="M4 7.5h3l1.4-2h7.2l1.4 2h3a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9.5a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="12" cy="13.5" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </Box>
  );
}

function PencilIcon({ size = 18 }) {
  return (
    <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{ width: size, height: size, display: "block" }}>
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </Box>
  );
}

function CalendarIcon({ size = 16 }) {
  return (
    <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{ width: size, height: size, display: "block" }}>
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </Box>
  );
}

function WarningIcon({ size = 16 }) {
  return (
    <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{ width: size, height: size, display: "block" }}>
      <path d="M12 4 2.5 20h19L12 4Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 10.5v4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="17.6" r="1" fill="currentColor" stroke="none" />
    </Box>
  );
}

function PinIcon({ size = 16 }) {
  return (
    <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{ width: size, height: size, display: "block" }}>
      <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="9.5" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </Box>
  );
}

function PersonIcon({ size = 16 }) {
  return (
    <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{ width: size, height: size, display: "block" }}>
      <circle cx="12" cy="8" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.5 20c1.3-3.7 4.4-5.5 7.5-5.5s6.2 1.8 7.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </Box>
  );
}

function CounterIcon({ size = 22 }) {
  return (
    <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{ width: size, height: size, display: "block" }}>
      <path d="M4 17a8 8 0 1 1 16 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="m12 13 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="13" r="1.5" fill="currentColor" />
      <path d="M5 20h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </Box>
  );
}

// Card di sintesi per il delta mensile/le medie ricavate dalle letture
// (computeCounterStats, ./maintenanceCounterStats.js): null quando non ci
// sono abbastanza periodi con letture per calcolare il valore.
function StatCard({ label, value }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2, borderRadius: 2.5, minWidth: 0, position: "relative", overflow: "hidden",
        "&::before": { content: '""', position: "absolute", inset: "0 auto 0 0", width: 3, bgcolor: "primary.main" },
      }}
    >
      <Typography sx={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.055em", color: "text.secondary" }}>{label}</Typography>
      <Typography sx={{ fontSize: 24, fontWeight: 800, mt: 0.5, lineHeight: 1.2 }}>
        {value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}`}
        {value != null && <Box component="span" sx={{ fontSize: 13, fontWeight: 650, ml: 0.5, color: "text.secondary" }}>ore</Box>}
      </Typography>
    </Paper>
  );
}

// Dialog di modifica di una singola lettura: riservato agli admin (§2 di
// AGENTS.md — la correzione di un valore già registrato è un'azione
// distruttiva sul dato storico, non va lasciata a chi registra le letture).
function EditReadingDialog({ assetId, reading, open, onClose }) {
  const queryClient = useQueryClient();
  const [readingDate, setReadingDate] = useState(reading?.reading_date ?? "");
  const [value, setValue] = useState(reading?.value ?? "");

  useEffect(() => {
    if (open && reading) {
      setReadingDate(reading.reading_date);
      setValue(reading.value);
    }
  }, [open, reading]);

  const mutation = useMutation({
    mutationFn: () => updateMaintenanceAssetCounter(assetId, reading.id, { reading_date: readingDate, value: Number(value) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-counters", assetId] });
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-deadlines", assetId] });
      onClose();
    },
  });

  if (!reading) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Modifica lettura</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField label="Data lettura" type="date" value={readingDate} onChange={(e) => setReadingDate(e.target.value)} size="small" fullWidth InputLabelProps={{ shrink: true }} />
          <TextField label="Valore (ore)" type="number" value={value} onChange={(e) => setValue(e.target.value)} size="small" fullWidth />
          {mutation.error && <Alert severity="error">{mutation.error.message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={!value || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? "Salvataggio..." : "Salva"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CounterReadingsSection({ assetId, isAdmin }) {
  const queryClient = useQueryClient();
  const [readingDate, setReadingDate] = useState(dayjs().format("YYYY-MM-DD"));
  const [value, setValue] = useState("");
  const [editingReading, setEditingReading] = useState(null);
  const [deletingReading, setDeletingReading] = useState(null);

  const countersQuery = useQuery({
    queryKey: ["maintenance-asset-counters", assetId],
    queryFn: () => getMaintenanceAssetCounters(assetId),
  });

  const addMutation = useMutation({
    mutationFn: () => createMaintenanceAssetCounter(assetId, { reading_date: readingDate, value: Number(value), unit: "ore" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-counters", assetId] });
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-deadlines", assetId] });
      setValue("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteMaintenanceAssetCounter(assetId, deletingReading.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-counters", assetId] });
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-deadlines", assetId] });
      setDeletingReading(null);
    },
  });

  const readings = countersQuery.data ?? [];
  const latestReading = readings[0] ?? null;
  const stats = computeCounterStats(readings);

  if (countersQuery.isLoading) return <Skeleton variant="rounded" height={190} sx={{ borderRadius: 2.5 }} />;

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography sx={{ fontWeight: 750, fontSize: 16 }}>Contatore di utilizzo</Typography>
        <Typography sx={{ fontSize: 12.5, color: "text.secondary", mt: 0.25 }}>Registra le ore del mezzo per mantenere aggiornate statistiche e scadenze.</Typography>
      </Box>

      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: "hidden" }}>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "280px minmax(0, 1fr)" } }}>
          <Box
            sx={{
              p: { xs: 2.5, sm: 3 }, color: "#fff", position: "relative", overflow: "hidden",
              background: "linear-gradient(145deg, #007040 0%, #0b8d58 100%)",
              "&::after": { content: '""', position: "absolute", width: 150, height: 150, borderRadius: "50%", right: -55, bottom: -80, bgcolor: "rgba(255,255,255,0.10)" },
            }}
          >
            <Box sx={{ width: 42, height: 42, borderRadius: 2.5, display: "grid", placeItems: "center", bgcolor: "rgba(255,255,255,0.14)", mb: 2 }}>
              <CounterIcon size={23} />
            </Box>
            <Typography sx={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em", opacity: 0.74 }}>Ultima lettura</Typography>
            <Typography sx={{ fontSize: { xs: 36, sm: 40 }, fontWeight: 850, lineHeight: 1.1, mt: 0.5, letterSpacing: "-0.03em" }}>
              {latestReading ? latestReading.value : "—"}
              {latestReading && <Box component="span" sx={{ fontSize: 15, fontWeight: 650, ml: 0.75, opacity: 0.8, letterSpacing: 0 }}>ore</Box>}
            </Typography>
            <Typography sx={{ fontSize: 12, mt: 1.5, opacity: 0.8 }}>
              {latestReading ? `Aggiornato il ${dayjs(latestReading.reading_date).format("D MMMM YYYY")}` : "Nessuna lettura registrata"}
            </Typography>
          </Box>

          <Box sx={{ p: { xs: 2.5, sm: 3 }, bgcolor: "action.hover", display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <Typography sx={{ fontSize: 13.5, fontWeight: 750 }}>Nuova lettura</Typography>
            <Typography sx={{ fontSize: 12, color: "text.secondary", mt: 0.25, mb: 2 }}>Inserisci il valore riportato dal contaore dell'asset.</Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr auto" }, gap: 1.25, alignItems: "center" }}>
              <TextField label="Data lettura" type="date" value={readingDate} onChange={(e) => setReadingDate(e.target.value)} size="small" InputLabelProps={{ shrink: true }} />
              <TextField label="Valore (ore)" type="number" value={value} onChange={(e) => setValue(e.target.value)} size="small" />
              <Button variant="contained" disabled={!value || addMutation.isPending} onClick={() => addMutation.mutate()} sx={{ minHeight: 40, px: 2.5 }}>
                {addMutation.isPending ? "Salvataggio..." : "Registra"}
              </Button>
            </Box>
            {addMutation.error && <Alert severity="error" sx={{ mt: 1.5 }}>{addMutation.error.message}</Alert>}
          </Box>
        </Box>
      </Paper>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))" }, gap: 1.5 }}>
        <StatCard label="Variazione mese corrente" value={stats.currentMonthDelta} />
        <StatCard label="Media mensile" value={stats.monthlyAverage} />
        <StatCard label="Media annuale" value={stats.yearlyAverage} />
      </Box>

      {countersQuery.error && <Alert severity="error">{countersQuery.error.message}</Alert>}
      {readings.length > 0 && (
        <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: "hidden" }}>
          <Box sx={{ px: 2, py: 1.25, borderBottom: "1px solid", borderColor: "divider", bgcolor: "action.hover" }}>
            <Typography sx={{ fontSize: 13, fontWeight: 750 }}>Storico letture</Typography>
          </Box>
          <TableContainer sx={{ maxHeight: 320 }}>
            <Table size="small" sx={tableSx}>
              <TableHead>
                <TableRow sx={headRowSx}>
                  <TableCell>Data</TableCell>
                  <TableCell>Valore</TableCell>
                  <TableCell>Delta</TableCell>
                  <TableCell>Registrata da</TableCell>
                  {isAdmin && <TableCell align="right">Azioni</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {readings.map((reading, index) => {
                  // readings è ordinato dal più recente al più vecchio (vedi
                  // services/maintenance_assets.list_counter_readings): il
                  // delta è sempre rispetto alla lettura precedente in ordine
                  // cronologico, cioè quella immediatamente successiva in array.
                  const previous = readings[index + 1];
                  const delta = previous ? Number(reading.value) - Number(previous.value) : null;
                  return (
                    <TableRow key={reading.id} sx={bodyRowSx}>
                      <TableCell>{dayjs(reading.reading_date).format("DD/MM/YYYY")}</TableCell>
                      <TableCell>{reading.value} ore</TableCell>
                      <TableCell>
                        {delta === null ? "—" : (
                          <Typography component="span" sx={{ fontSize: 13, color: delta < 0 ? "error.main" : "text.secondary" }}>
                            {delta >= 0 ? "+" : ""}{delta.toFixed(2)} ore
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>{reading.recorded_by ?? "—"}</TableCell>
                      {isAdmin && (
                        <TableCell align="right">
                          <IconButton size="small" onClick={() => setEditingReading(reading)}>
                            <PencilIcon size={16} />
                          </IconButton>
                          <IconButton size="small" color="error" onClick={() => setDeletingReading(reading)}>
                            <TrashIcon size={16} />
                          </IconButton>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      <EditReadingDialog assetId={assetId} reading={editingReading} open={!!editingReading} onClose={() => setEditingReading(null)} />

      <Dialog open={!!deletingReading} onClose={() => setDeletingReading(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Elimina lettura</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13.5 }}>
            Stai per eliminare definitivamente la lettura del {deletingReading && dayjs(deletingReading.reading_date).format("DD/MM/YYYY")} ({deletingReading?.value} ore).
          </Typography>
          {deleteMutation.error && <Alert severity="error" sx={{ mt: 2 }}>{deleteMutation.error.message}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeletingReading(null)}>Annulla</Button>
          <Button color="error" variant="contained" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
            {deleteMutation.isPending ? "Eliminazione..." : "Elimina"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

// Scadenze a soglia ore (due_hours valorizzato): solo per sottoclassi con
// tracks_usage_hours, la proiezione arriva già calcolata dal backend
// (services/maintenance_deadlines.hours_projection) dalle ultime letture.
function HoursDeadlinesSummary({ assetId }) {
  const deadlinesQuery = useQuery({
    queryKey: ["maintenance-asset-deadlines", assetId],
    queryFn: () => getMaintenanceAssetDeadlines(assetId),
  });
  const hourDeadlines = (deadlinesQuery.data ?? []).filter((d) => d.due_hours != null);

  if (deadlinesQuery.isLoading) return <Skeleton variant="rounded" height={82} sx={{ borderRadius: 2 }} />;
  if (deadlinesQuery.error) return <Alert severity="error">{deadlinesQuery.error.message}</Alert>;

  if (hourDeadlines.length === 0) {
    return (
      <Box sx={{ p: 3, textAlign: "center", bgcolor: "action.hover" }}>
        <Typography sx={{ fontSize: 13, fontWeight: 650 }}>Nessuna scadenza a ore</Typography>
        <Typography sx={{ fontSize: 12, color: "text.secondary", mt: 0.5 }}>Puoi configurarla dalla scheda Scadenze.</Typography>
      </Box>
    );
  }

  return (
    <Stack divider={<Box sx={{ borderBottom: "1px solid", borderColor: "divider" }} />}>
      {hourDeadlines.map((deadline) => (
        <Box key={deadline.id} sx={{ p: 2, borderLeft: "3px solid", borderLeftColor: (URGENCY_ACCENTS[deadline.urgency] ?? URGENCY_ACCENTS.regolare).color }}>
          <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }} spacing={1.5}>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontWeight: 700, fontSize: 13.5 }}>{deadline.deadline_type}</Typography>
              <Stack direction="row" sx={{ mt: 1, flexWrap: "wrap", columnGap: 2.5, rowGap: 0.75 }}>
                <Typography sx={{ fontSize: 12, color: "text.secondary" }}><strong>Soglia</strong> · {deadline.due_hours} ore</Typography>
                {deadline.current_hours != null && <Typography sx={{ fontSize: 12, color: "text.secondary" }}><strong>Attuali</strong> · {deadline.current_hours} ore</Typography>}
                {deadline.projected_due_date && <Typography sx={{ fontSize: 12, color: "text.secondary" }}><strong>Data stimata</strong> · {dayjs(deadline.projected_due_date).format("DD/MM/YYYY")}</Typography>}
              </Stack>
            </Box>
            <Chip label={URGENCY_LABELS[deadline.urgency]} size="small" color={URGENCY_COLORS[deadline.urgency]} sx={{ fontSize: 11, fontWeight: 700 }} />
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}

function HoursTab({ assetId, isAdmin }) {
  return (
    <Stack spacing={2.5} sx={{ pt: 2 }}>
      <CounterReadingsSection assetId={assetId} isAdmin={isAdmin} />
      <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: "hidden" }}>
        <Box sx={{ px: 2, py: 1.5, borderBottom: "1px solid", borderColor: "divider", bgcolor: "action.hover" }}>
          <Typography sx={{ fontWeight: 750, fontSize: 14 }}>Scadenze basate sull'utilizzo</Typography>
          <Typography sx={{ fontSize: 12, color: "text.secondary", mt: 0.25 }}>Proiezioni calcolate in base all'andamento delle letture registrate.</Typography>
        </Box>
        <HoursDeadlinesSummary assetId={assetId} />
      </Paper>
    </Stack>
  );
}

function ImageFieldUploader({ asset, field, disabled = false }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const imageId = asset.image_field_ids?.[field.field_key] ?? null;
  const [imageUrl, setImageUrl] = useState(null);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);

  useEffect(() => {
    if (!imageId) {
      setImageUrl(null);
      return;
    }
    let objectUrl = null;
    let cancelled = false;
    fetchMaintenanceImageBlobUrl(imageId).then((url) => {
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      objectUrl = url;
      setImageUrl(url);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageId]);

  const uploadMutation = useMutation({
    mutationFn: (file) => uploadMaintenanceAssetImageField(asset.id, field.field_key, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["maintenance-asset", asset.id] }),
  });
  const removeMutation = useMutation({
    mutationFn: () => removeMaintenanceAssetImageField(asset.id, field.field_key),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["maintenance-asset", asset.id] }),
  });

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (file) uploadMutation.mutate(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // Tile compatta: pensata per stare in griglia 2×3/3×2 insieme alle altre
  // foto tecniche (targhe, spina...), non più una riga a piena larghezza —
  // impilate erano lo spreco di spazio verticale principale della pagina.
  return (
    <Box>
      {imageUrl ? (
        <Box
          component="img"
          src={imageUrl}
          alt={field.label}
          onClick={() => setFullscreenOpen(true)}
          sx={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 1.5, border: "1px solid", borderColor: "divider", display: "block", cursor: "zoom-in" }}
        />
      ) : (
        <Box sx={{ width: "100%", aspectRatio: "1 / 1", borderRadius: 1.5, border: "1px dashed", borderColor: "divider", display: "grid", placeItems: "center", fontSize: 11, color: "text.disabled" }}>
          Nessuna immagine
        </Box>
      )}
      <Typography sx={{ fontSize: 12, fontWeight: 600, mt: 0.5, textAlign: "center" }}>{field.label}</Typography>
      {!disabled && (
        <Button component="label" size="small" fullWidth disabled={uploadMutation.isPending} sx={{ fontSize: 11, mt: 0.25 }}>
          {uploadMutation.isPending ? "Caricamento..." : imageId ? "Sostituisci" : "Carica"}
          <input ref={fileInputRef} type="file" hidden accept=".jpg,.jpeg,.png" onChange={handleFileChange} />
        </Button>
      )}
      {!disabled && imageId && (
        <Button color="error" size="small" fullWidth disabled={removeMutation.isPending} onClick={() => removeMutation.mutate()} sx={{ fontSize: 11 }}>
          Rimuovi
        </Button>
      )}
      {(uploadMutation.error || removeMutation.error) && (
        <Alert severity="error" sx={{ mt: 1, fontSize: 11.5 }}>{(uploadMutation.error || removeMutation.error).message}</Alert>
      )}
      {imageUrl && (
        <Dialog open={fullscreenOpen} onClose={() => setFullscreenOpen(false)} maxWidth="lg" fullWidth>
          <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
            <Box sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{field.label}</Box>
            <IconButton size="small" onClick={() => setFullscreenOpen(false)}>
              <CloseIcon size={17} />
            </IconButton>
          </DialogTitle>
          <DialogContent sx={{ p: 0, display: "grid", placeItems: "center", bgcolor: "action.hover" }}>
            <Box component="img" src={imageUrl} alt={field.label} sx={{ maxWidth: "100%", maxHeight: "80vh", objectFit: "contain" }} />
          </DialogContent>
        </Dialog>
      )}
    </Box>
  );
}

// Badge di stato: elemento riconoscibile in testata (non un campo
// dell'anagrafica) che apre un dialog dedicato per il cambio stato, con lo
// stesso storico/motivazione già gestiti da updateMaintenanceAsset.
function StatusBadgeDialog({ asset, open, onClose }) {
  const queryClient = useQueryClient();
  const [statusValue, setStatusValue] = useState(asset.status);
  const [statusReason, setStatusReason] = useState(asset.status_reason ?? "");
  const [changeReason, setChangeReason] = useState("");

  useEffect(() => {
    if (open) {
      setStatusValue(asset.status);
      setStatusReason(asset.status_reason ?? "");
      setChangeReason("");
    }
  }, [open, asset.status, asset.status_reason]);

  const mutation = useMutation({
    mutationFn: () =>
      updateMaintenanceAsset(asset.id, {
        status: statusValue,
        status_reason: statusReason || null,
        change_reason: changeReason || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset", asset.id] });
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-history", asset.id] });
      onClose();
    },
  });

  const hasChanged = statusValue !== asset.status;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Cambia stato asset</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField select label="Stato" value={statusValue} onChange={(e) => setStatusValue(e.target.value)} size="small" fullWidth>
            {Object.entries(MAINTENANCE_ASSET_STATUS_LABELS)
              .filter(([value]) => value === statusValue || value !== asset.status)
              .map(([value, label]) => (
                <MenuItem key={value} value={value}>{label}</MenuItem>
              ))}
          </TextField>
          <TextField
            label="Motivo stato (facoltativo)"
            value={statusReason}
            onChange={(e) => setStatusReason(e.target.value)}
            size="small"
            fullWidth
          />
          {hasChanged && (
            <TextField
              label="Motivo del cambiamento"
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
              size="small"
              fullWidth
              helperText="Registrato nello storico dell'asset"
            />
          )}
          {mutation.error && <Alert severity="error">{mutation.error.message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? "Salvataggio..." : "Salva"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function StatusBadge({ asset }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Chip
        label={MAINTENANCE_ASSET_STATUS_LABELS[asset.status] ?? asset.status}
        color={MAINTENANCE_ASSET_STATUS_COLORS[asset.status] ?? "default"}
        onClick={() => setOpen(true)}
        clickable
        sx={{ fontWeight: 700, fontSize: 12.5, height: 28, cursor: "pointer" }}
      />
      <StatusBadgeDialog asset={asset} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

// Foto di copertina dell'asset (§2): campo distinto sia dagli attributi sia
// dagli allegati fotografici — upload/sostituzione immediati, non
// fanno parte del batch Salva/Annulla degli attributi.
function MainImageSection({ asset, size = 140, showLabel = true }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const [imageUrl, setImageUrl] = useState(null);
  const imageId = asset.main_image_id;

  useEffect(() => {
    if (!imageId) {
      setImageUrl(null);
      return;
    }
    let objectUrl = null;
    let cancelled = false;
    fetchMaintenanceImageBlobUrl(imageId).then((url) => {
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      objectUrl = url;
      setImageUrl(url);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageId]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["maintenance-asset", asset.id] });

  const uploadMutation = useMutation({
    mutationFn: (file) => uploadMaintenanceAssetMainImage(asset.id, file),
    onSuccess: invalidate,
  });
  function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (file) uploadMutation.mutate(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <Box>
      {showLabel && (
        <Typography variant="caption" sx={{ display: "block", mb: 1, fontWeight: 700, color: "text.secondary" }}>
          Immagine principale
        </Typography>
      )}
      <Box sx={{ position: "relative", borderRadius: 2.5, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.14)" }}>
        {imageUrl ? (
          <Box
            component="img"
            src={imageUrl}
            alt="Immagine principale asset"
            sx={{ width: "100%", height: size, objectFit: "cover", display: "block" }}
          />
        ) : (
          <Box
            sx={{
              width: "100%", height: size, display: "grid", placeItems: "center", textAlign: "center", px: 1,
              color: "primary.main", background: "linear-gradient(145deg, rgba(0,112,64,0.16), rgba(0,112,64,0.04))",
            }}
          >
            <Stack spacing={0.75} alignItems="center">
              <CameraIcon size={28} />
              <Typography sx={{ fontSize: 11.5, fontWeight: 700 }}>Aggiungi una foto</Typography>
            </Stack>
          </Box>
        )}
        {imageId ? (
          <Tooltip title="Modifica foto">
            <IconButton
              component="label"
              size="small"
              disabled={uploadMutation.isPending}
              sx={{
                position: "absolute", right: 8, bottom: 8, color: "#fff",
                bgcolor: "rgba(20,24,22,0.68)", backdropFilter: "blur(8px)",
                "&:hover": { bgcolor: "rgba(20,24,22,0.82)" },
              }}
            >
              <PencilIcon size={16} />
              <input ref={fileInputRef} type="file" hidden accept=".jpg,.jpeg,.png" onChange={handleFileChange} />
            </IconButton>
          </Tooltip>
        ) : (
          <Box sx={{ position: "absolute", left: 8, right: 8, bottom: 8, p: 0.5, borderRadius: 2, bgcolor: "rgba(20,24,22,0.68)", backdropFilter: "blur(8px)" }}>
            <Button component="label" size="small" fullWidth disabled={uploadMutation.isPending} sx={{ color: "#fff", fontSize: 11.5 }}>
              {uploadMutation.isPending ? "Caricamento..." : "Carica foto"}
              <input ref={fileInputRef} type="file" hidden accept=".jpg,.jpeg,.png" onChange={handleFileChange} />
            </Button>
          </Box>
        )}
      </Box>
      {uploadMutation.error && (
        <Alert severity="error" sx={{ mt: 1 }}>{uploadMutation.error.message}</Alert>
      )}
    </Box>
  );
}

// Valore in sola lettura di un attributo (§ modalità view/edit): testo
// pulito senza bordi di input, coerente col pattern richiesto (Notion/Linear/
// Airtable) invece di un TextField disabilitato che sembra ancora un campo.
function formatFieldDisplayValue(field, value, employeeFieldNames) {
  if (field.field_type === "employee") return employeeFieldNames?.[field.field_key] || "—";
  if (field.field_type === "bool") return value ? "Sì" : "No";
  if (field.field_type === "date" && value) return dayjs(value).format("DD/MM/YYYY");
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function FieldDisplay({ label, value }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 11.5, color: "text.secondary", fontWeight: 600 }}>{label}</Typography>
      <Typography sx={{ fontSize: 14, mt: 0.25 }}>{value}</Typography>
    </Box>
  );
}

// Campo custom modificabile inline nel form anagrafica: stesso set di tipi
// gestiti in creazione (CustomFieldInput di MaintenanceAssetsPage), qui
// duplicato in piccolo perché il valore iniziale/onChange sono diversi
// (custom_fields intero, non un singolo state per campo).
function EditableCustomField({ field, value, onChange, employeeOptions = [], disabled = false }) {
  if (field.field_type === "employee") {
    const selected = employeeOptions.find((o) => o.id === value) ?? null;
    return (
      <Autocomplete
        options={employeeOptions}
        getOptionLabel={(o) => o.full_name}
        value={selected}
        onChange={(_, v) => onChange(v?.id ?? null)}
        size="small"
        disabled={disabled}
        renderInput={(params) => <TextField {...params} label={field.label} />}
      />
    );
  }
  if (field.field_type === "select") {
    return (
      <TextField select label={field.label} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} size="small" fullWidth disabled={disabled}>
        <MenuItem value="">—</MenuItem>
        {field.options.map((option) => (
          <MenuItem key={option} value={option}>{option}</MenuItem>
        ))}
      </TextField>
    );
  }
  if (field.field_type === "bool") {
    return (
      <FormControlLabel
        control={<Checkbox checked={!!value} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />}
        label={field.label}
      />
    );
  }
  return (
    <TextField
      label={field.label}
      type={field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : "text"}
      value={value ?? ""}
      onChange={(e) => onChange(field.field_type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)}
      size="small"
      fullWidth
      disabled={disabled}
      InputLabelProps={field.field_type === "date" ? { shrink: true } : undefined}
    />
  );
}

function AnagraficaTab({ asset, assetTypeFields = [], employeeFieldNames = {} }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [customFields, setCustomFields] = useState(asset.custom_fields ?? {});
  const [changeReason, setChangeReason] = useState("");
  const [snackbar, setSnackbar] = useState(null);

  const employeesQuery = useQuery({ queryKey: ["employee-options"], queryFn: getEmployeeOptions, staleTime: 60000, enabled: editing });

  const updateMutation = useMutation({
    mutationFn: (payload) => updateMaintenanceAsset(asset.id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset", asset.id] });
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-history", asset.id] });
      setSnackbar("Asset aggiornato");
      setChangeReason("");
      setEditing(false);
    },
  });

  // Stesse chiavi tracciate nello storico lato backend (site, department,
  // responsible_employee_id): vedi _TRACKED_CUSTOM_FIELD_KEYS in
  // services/maintenance_assets.py.
  const hasTrackedChanges = ["site", "department", "responsible_employee_id"].some(
    (key) => (customFields[key] ?? null) !== (asset.custom_fields?.[key] ?? null),
  );

  function startEditing() {
    setCustomFields(asset.custom_fields ?? {});
    setEditing(true);
  }

  function cancelEditing() {
    setCustomFields(asset.custom_fields ?? {});
    setChangeReason("");
    updateMutation.reset();
    setEditing(false);
  }

  const textFields = assetTypeFields.filter((f) => f.field_type !== "image");
  const imageFields = assetTypeFields.filter((f) => f.field_type === "image");

  return (
    <Stack spacing={2.5} sx={{ pt: 2 }}>
      {textFields.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5, bgcolor: "action.hover" }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Attributi {asset.asset_type_label}
            </Typography>
            {!editing && (
              <Button size="small" onClick={startEditing}>Modifica</Button>
            )}
          </Stack>

          {!editing ? (
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
              {textFields.map((field) => (
                <FieldDisplay
                  key={field.id}
                  label={field.label}
                  value={formatFieldDisplayValue(field, customFields[field.field_key], employeeFieldNames)}
                />
              ))}
            </Box>
          ) : (
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
              {textFields.map((field) => (
                <EditableCustomField
                  key={field.id}
                  field={field}
                  value={customFields[field.field_key]}
                  onChange={(value) => setCustomFields((prev) => ({ ...prev, [field.field_key]: value }))}
                  employeeOptions={employeesQuery.data ?? []}
                />
              ))}
            </Box>
          )}

          {editing && hasTrackedChanges && (
            <TextField
              label="Motivo del cambiamento (sede, reparto o responsabile)"
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
              size="small"
              fullWidth
              sx={{ mt: 2 }}
              helperText="Registrato nello storico dell'asset"
            />
          )}

          {updateMutation.error && <Alert severity="error" sx={{ mt: 2 }}>{updateMutation.error.message}</Alert>}

          {editing && (
            <Stack direction="row" spacing={1.5} sx={{ mt: 2 }}>
              <Button
                variant="contained"
                onClick={() => updateMutation.mutate({ custom_fields: customFields, change_reason: changeReason || null })}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? "Salvataggio..." : "Salva"}
              </Button>
              <Button variant="outlined" onClick={cancelEditing} disabled={updateMutation.isPending}>
                Annulla
              </Button>
            </Stack>
          )}
        </Paper>
      )}

      {imageFields.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5, bgcolor: "action.hover" }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Foto tecniche</Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 1.5 }}>
            {imageFields.map((field) => (
              <ImageFieldUploader key={field.id} asset={asset} field={field} disabled={!editing} />
            ))}
          </Box>
        </Paper>
      )}

      <QrCodeSection asset={asset} />

      <Snackbar open={!!snackbar} autoHideDuration={3000} onClose={() => setSnackbar(null)} message={snackbar} />
    </Stack>
  );
}

function QrCodeSection({ asset }) {
  const { user } = useAuth();
  const isAdmin = user?.effective_role === "admin";
  const queryClient = useQueryClient();
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [imageUrl, setImageUrl] = useState(null);
  const [imageError, setImageError] = useState(null);

  const tokenQuery = useQuery({
    queryKey: ["maintenance-asset-qr-token", asset.id],
    queryFn: () => getMaintenanceAssetQrToken(asset.id),
    enabled: isAdmin && asset.has_qr_token,
    retry: false,
  });

  const regenerateMutation = useMutation({
    mutationFn: () => regenerateMaintenanceAssetQrToken(asset.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset", asset.id] });
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-qr-token", asset.id] });
      setConfirmRegenerate(false);
      setImageUrl(null);
    },
  });

  useEffect(() => {
    if (!isAdmin || !asset.has_qr_token) {
      setImageUrl(null);
      return;
    }
    let objectUrl = null;
    let cancelled = false;
    setImageError(null);
    fetchMaintenanceAssetQrImageBlobUrl(asset.id)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setImageUrl(url);
      })
      .catch((err) => !cancelled && setImageError(err));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [asset.id, asset.has_qr_token, isAdmin, regenerateMutation.data]);

  // Solo un admin gestisce il QR (coerente col backend: la lettura del token
  // in chiaro è require_admin, vedi app/api/maintenance_assets.py). L'early
  // return sta dopo tutti gli hook, per non violare le regole di React.
  if (!isAdmin) return null;

  const publicUrl = tokenQuery.data
    ? `${window.location.origin}${tokenQuery.data.public_url_path}`
    : regenerateMutation.data
      ? `${window.location.origin}${regenerateMutation.data.public_url_path}`
      : null;

  return (
    <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5, bgcolor: "action.hover" }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>QR code asset</Typography>
      <Typography sx={{ fontSize: 12.5, color: "text.secondary", mb: 1.5 }}>
        Da stampare e attaccare fisicamente sull'asset: chi lo scansiona vede una pagina pubblica di sola lettura, senza login.
      </Typography>

      {!asset.has_qr_token && !regenerateMutation.data && (
        <Button variant="contained" size="small" disabled={regenerateMutation.isPending} onClick={() => regenerateMutation.mutate()}>
          {regenerateMutation.isPending ? "Generazione..." : "Genera QR"}
        </Button>
      )}

      {(asset.has_qr_token || regenerateMutation.data) && (
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems="flex-start">
          {imageUrl && (
            <Box component="img" src={imageUrl} alt="QR code asset" sx={{ width: 140, height: 140, borderRadius: 1.5, border: "1px solid", borderColor: "divider" }} />
          )}
          <Stack spacing={1} sx={{ minWidth: 0, flex: 1 }}>
            {publicUrl && (
              <TextField
                size="small"
                label="URL pubblico"
                value={publicUrl}
                InputProps={{ readOnly: true }}
                onFocus={(e) => e.target.select()}
              />
            )}
            <Stack direction="row" spacing={1.5}>
              <Button size="small" variant="outlined" color="warning" onClick={() => setConfirmRegenerate(true)}>
                Rigenera
              </Button>
            </Stack>
          </Stack>
        </Stack>
      )}

      {imageError && <Alert severity="error" sx={{ mt: 1.5 }}>{imageError.message}</Alert>}
      {tokenQuery.error && <Alert severity="error" sx={{ mt: 1.5 }}>{tokenQuery.error.message}</Alert>}
      {regenerateMutation.error && <Alert severity="error" sx={{ mt: 1.5 }}>{regenerateMutation.error.message}</Alert>}

      <Dialog open={confirmRegenerate} onClose={() => setConfirmRegenerate(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Rigenera QR code</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13.5 }}>
            L'etichetta fisica già stampata smetterà di funzionare non appena confermi: chi la scansiona vedrà un errore
            finché non stampi e attacchi il nuovo QR.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmRegenerate(false)}>Annulla</Button>
          <Button color="warning" variant="contained" disabled={regenerateMutation.isPending} onClick={() => regenerateMutation.mutate()}>
            {regenerateMutation.isPending ? "Rigenerazione..." : "Rigenera"}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

function DocumentPreviewDialog({ doc, onClose }) {
  const [previewUrl, setPreviewUrl] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!doc) {
      setPreviewUrl(null);
      setError(null);
      return;
    }
    let objectUrl = null;
    let cancelled = false;
    fetchMaintenanceDocumentBlobUrl(doc.id)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setPreviewUrl(url);
      })
      .catch((err) => !cancelled && setError(err));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [doc]);

  const isImage = doc && ["image/jpeg", "image/png"].includes(doc.mime_type);
  const isPdf = doc?.mime_type === "application/pdf";

  return (
    <Dialog open={!!doc} onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: { height: "85vh" } }}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
        <Box sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc?.title}</Box>
        <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
          <Tooltip title="Apri in un'altra scheda">
            <IconButton size="small" onClick={() => openMaintenanceDocumentInNewTab(doc.id)}>
              <ExternalLinkIcon size={17} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Scarica">
            <IconButton size="small" onClick={() => downloadMaintenanceDocument(doc.id, doc.original_filename)}>
              <DownloadIcon size={17} />
            </IconButton>
          </Tooltip>
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", p: 0, height: "100%" }}>
        {error && <Alert severity="error" sx={{ m: 2 }}>{error.message}</Alert>}
        {!error && !previewUrl && (
          <Box sx={{ flex: 1, display: "grid", placeItems: "center" }}>
            <Typography sx={{ color: "text.secondary" }}>Caricamento anteprima...</Typography>
          </Box>
        )}
        {!error && previewUrl && isImage && (
          <Box sx={{ flex: 1, display: "grid", placeItems: "center", overflow: "auto", bgcolor: "action.hover" }}>
            <Box component="img" src={previewUrl} alt={doc.title} sx={{ maxWidth: "100%", maxHeight: "100%" }} />
          </Box>
        )}
        {!error && previewUrl && isPdf && (
          <Box component="iframe" src={previewUrl} title={doc.title} sx={{ flex: 1, border: "none" }} />
        )}
        {!error && previewUrl && !isImage && !isPdf && (
          <Box sx={{ flex: 1, display: "grid", placeItems: "center" }}>
            <Typography sx={{ color: "text.secondary" }}>Anteprima non disponibile per questo formato: scarica il file.</Typography>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ImagePreviewDialog({ image, onClose }) {
  const [previewUrl, setPreviewUrl] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!image) {
      setPreviewUrl(null);
      setError(null);
      return;
    }
    let objectUrl = null;
    let cancelled = false;
    fetchMaintenanceImageBlobUrl(image.id)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setPreviewUrl(url);
      })
      .catch((err) => !cancelled && setError(err));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [image]);

  return (
    <Dialog open={!!image} onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: { height: "85vh" } }}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
        <Box sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{image?.title}</Box>
        <Tooltip title="Scarica">
          <IconButton size="small" onClick={() => downloadMaintenanceImage(image.id, image.original_filename)}>
            <DownloadIcon size={17} />
          </IconButton>
        </Tooltip>
      </DialogTitle>
      <DialogContent sx={{ p: 0, display: "grid", placeItems: "center", bgcolor: "action.hover" }}>
        {error && <Alert severity="error">{error.message}</Alert>}
        {!error && !previewUrl && <Typography sx={{ color: "text.secondary" }}>Caricamento anteprima...</Typography>}
        {!error && previewUrl && (
          <Box component="img" src={previewUrl} alt={image.title} sx={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DocumentsTab({ assetId, documentTypeOptions }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.effective_role === "admin";
  const fileInputRef = useRef(null);
  const [docType, setDocType] = useState("");
  const [title, setTitle] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [showObsolete, setShowObsolete] = useState(false);
  const [previewTarget, setPreviewTarget] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [search, setSearch] = useState("");

  const documentsQuery = useQuery({
    queryKey: ["maintenance-documents", assetId, showObsolete],
    queryFn: () => getMaintenanceDocuments(assetId, { includeObsolete: showObsolete }),
  });

  const uploadMutation = useMutation({
    mutationFn: (file) => uploadMaintenanceDocument(assetId, { docType, title, file }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-documents", assetId] });
      setDocType("");
      setTitle("");
      setUploadOpen(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteMaintenanceDocument(deleteTarget.id, deleteReason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-documents", assetId] });
      setDeleteTarget(null);
      setDeleteReason("");
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ documentId, status }) => updateMaintenanceDocumentStatus(documentId, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["maintenance-documents", assetId] }),
  });

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file || !docType.trim() || !title.trim()) return;
    uploadMutation.mutate(file);
  }

  const documents = documentsQuery.data ?? [];
  const filteredDocuments = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return documents;
    return documents.filter(
      (doc) => doc.doc_type.toLowerCase().includes(term) || doc.title.toLowerCase().includes(term),
    );
  }, [documents, search]);

  return (
    <Stack spacing={2.5} sx={{ pt: 2 }}>
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "stretch", sm: "center" }} spacing={1.5}>
        <Box>
          <Typography sx={{ fontWeight: 700 }}>Archivio documentale</Typography>
          <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>
            Certificati, report e documentazione tecnica.
          </Typography>
        </Box>
        <Button variant="contained" size="small" onClick={() => setUploadOpen(true)}>+ Carica documento</Button>
      </Stack>

      <Stack direction={{ xs: "column", sm: "row" }} alignItems={{ xs: "stretch", sm: "center" }} justifyContent="space-between" spacing={1.5}>
        <TextField
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cerca per tipo o note..."
          size="small"
          sx={{ maxWidth: { sm: 320 } }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon size={16} /></InputAdornment> }}
        />
        <FormControlLabel
          control={<Checkbox checked={showObsolete} onChange={(e) => setShowObsolete(e.target.checked)} size="small" />}
          label="Mostra anche gli obsoleti"
          sx={{ ml: 0 }}
        />
      </Stack>

      {documentsQuery.error && <Alert severity="error">{documentsQuery.error.message}</Alert>}

      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
        <TableContainer>
          <Table size="small" sx={tableSx({ minWidth: 860 })}>
            <TableHead>
              <TableRow sx={headRowSx}>
                <TableCell sx={{ width: "20%" }}>Tipo</TableCell>
                <TableCell sx={{ width: "28%" }}>Note</TableCell>
                <TableCell align="center" sx={{ width: "14%" }}>Stato</TableCell>
                <TableCell sx={{ width: "15%" }}>Caricato da</TableCell>
                <TableCell sx={{ width: "13%" }}>Data</TableCell>
                <TableCell align="right" sx={{ width: "10%" }}>Azioni</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredDocuments.map((doc) => (
                <TableRow key={doc.id} hover sx={{ ...bodyRowSx(), ...(doc.status === "obsoleto" ? { opacity: 0.65 } : null) }}>
                  <TableCell>{doc.doc_type}</TableCell>
                  <TableCell><Typography sx={{ fontSize: 13, fontWeight: 600 }} noWrap title={doc.title}>{doc.title}</Typography></TableCell>
                  <TableCell align="center">
                    <Tooltip title={doc.status === "rilasciato" ? "Segna come obsoleto" : "Segna come rilasciato"}>
                      <Chip
                        label={doc.status === "rilasciato" ? "Rilasciato" : "Obsoleto"}
                        size="small"
                        color={doc.status === "rilasciato" ? "success" : "default"}
                        sx={{ fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                        onClick={() =>
                          statusMutation.mutate({
                            documentId: doc.id,
                            status: doc.status === "rilasciato" ? "obsoleto" : "rilasciato",
                          })
                        }
                      />
                    </Tooltip>
                  </TableCell>
                  <TableCell>{doc.uploaded_by || "—"}</TableCell>
                  <TableCell>{dayjs(doc.created_at).format("DD/MM/YY HH:mm")}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                    <Tooltip title="Anteprima">
                      <IconButton size="small" onClick={() => setPreviewTarget(doc)}>
                        <EyeIcon size={17} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Apri in un'altra scheda">
                      <IconButton size="small" onClick={() => openMaintenanceDocumentInNewTab(doc.id)}>
                        <ExternalLinkIcon size={17} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Scarica">
                      <IconButton size="small" onClick={() => downloadMaintenanceDocument(doc.id, doc.original_filename)}>
                        <DownloadIcon size={17} />
                      </IconButton>
                    </Tooltip>
                    {isAdmin && (
                      <Tooltip title="Elimina">
                        <IconButton size="small" color="error" onClick={() => setDeleteTarget(doc)}>
                          <TrashIcon size={17} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {documentsQuery.isLoading && (
                <TableRow><TableCell colSpan={6} sx={{ py: 3 }}><Skeleton height={28} /></TableCell></TableRow>
              )}
              {filteredDocuments.length === 0 && !documentsQuery.isLoading && (
                <TableRow>
                  <TableCell colSpan={6} sx={{ py: 4, textAlign: "center", color: "text.secondary" }}>
                    {documents.length === 0 ? "Nessun documento caricato." : "Nessun documento corrisponde alla ricerca."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={uploadOpen} onClose={() => setUploadOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Carica documento</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField select label="Tipo documento" value={docType} onChange={(e) => setDocType(e.target.value)} size="small" fullWidth>
            {documentTypeOptions.length === 0 && (
              <MenuItem value="" disabled>Nessun tipo documento configurato</MenuItem>
            )}
            {documentTypeOptions.map((option) => (
              <MenuItem key={option} value={option}>{option}</MenuItem>
            ))}
          </TextField>
          <TextField label="Note" value={title} onChange={(e) => setTitle(e.target.value)} size="small" fullWidth />
          {uploadMutation.error && <Alert severity="error">{uploadMutation.error.message}</Alert>}
        </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUploadOpen(false)}>Annulla</Button>
          <Button
            variant="contained"
            component="label"
            disabled={!docType.trim() || !title.trim() || uploadMutation.isPending}
            sx={{ whiteSpace: "nowrap", flexShrink: 0 }}
          >
            {uploadMutation.isPending ? "Caricamento..." : "Scegli file"}
            <input ref={fileInputRef} type="file" hidden accept=".pdf,.jpg,.jpeg,.png" onChange={handleFileChange} />
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Elimina documento</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            Stai per eliminare definitivamente <strong>{deleteTarget?.title}</strong>. L'operazione è tracciata e non reversibile.
          </Typography>
          <TextField
            label="Motivazione (obbligatoria)"
            value={deleteReason}
            onChange={(e) => setDeleteReason(e.target.value)}
            size="small"
            fullWidth
            multiline
            minRows={2}
          />
          {deleteMutation.error && <Alert severity="error" sx={{ mt: 2 }}>{deleteMutation.error.message}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Annulla</Button>
          <Button color="error" variant="contained" disabled={!deleteReason.trim() || deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
            Elimina
          </Button>
        </DialogActions>
      </Dialog>

      <DocumentPreviewDialog doc={previewTarget} onClose={() => setPreviewTarget(null)} />
    </Stack>
  );
}

// Foto libere dell'anagrafica: metadati separati dai documenti e contenuto su
// SMB; ogni foto è indipendente e non sostituisce le precedenti.
function PhotosTab({ assetId }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.effective_role === "admin";
  const fileInputRef = useRef(null);
  const [title, setTitle] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [previewTarget, setPreviewTarget] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const photosQuery = useQuery({
    queryKey: ["maintenance-photos", assetId],
    queryFn: () => getMaintenancePhotos(assetId),
  });

  const uploadMutation = useMutation({
    mutationFn: (file) => uploadMaintenancePhoto(assetId, { title, file }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-photos", assetId] });
      setTitle("");
      setUploadOpen(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteMaintenanceImage(deleteTarget.id, deleteReason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-photos", assetId] });
      setDeleteTarget(null);
      setDeleteReason("");
    },
  });

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file || !title.trim()) return;
    uploadMutation.mutate(file);
  }

  const photos = photosQuery.data ?? [];

  return (
    <Stack spacing={2}>
      <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
        <Button variant="contained" size="small" onClick={() => setUploadOpen(true)}>+ Aggiungi foto</Button>
      </Box>
      {photosQuery.error && <Alert severity="error">{photosQuery.error.message}</Alert>}

      {photosQuery.isLoading ? (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(4, 1fr)" }, gap: 1.5 }}>
          {[1, 2, 3, 4].map((item) => <Skeleton key={item} variant="rounded" sx={{ aspectRatio: "1 / 1", borderRadius: 2 }} />)}
        </Box>
      ) : photos.length === 0 ? (
        <Box sx={{ border: "1px dashed", borderColor: "divider", borderRadius: 2.5, py: 5, display: "grid", placeItems: "center", color: "text.secondary" }}>
          <Stack spacing={1} alignItems="center">
            <Box sx={{ color: "primary.main" }}><CameraIcon size={30} /></Box>
            <Typography sx={{ fontWeight: 700 }}>Nessuna foto aggiuntiva</Typography>
            <Typography sx={{ fontSize: 12.5 }}>Carica dettagli, targhe o angolazioni utili dell'asset.</Typography>
          </Stack>
        </Box>
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(4, 1fr)" }, gap: 1.5 }}>
          {photos.map((photo) => (
            <PhotoThumbnail key={photo.id} photo={photo} isAdmin={isAdmin} onPreview={() => setPreviewTarget(photo)} onDelete={() => setDeleteTarget(photo)} />
          ))}
        </Box>
      )}

      <Dialog open={uploadOpen} onClose={() => setUploadOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Aggiungi foto</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Titolo" value={title} onChange={(e) => setTitle(e.target.value)} size="small" fullWidth autoFocus />
            {uploadMutation.error && <Alert severity="error">{uploadMutation.error.message}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUploadOpen(false)}>Annulla</Button>
          <Button variant="contained" component="label" disabled={!title.trim() || uploadMutation.isPending}>
            {uploadMutation.isPending ? "Caricamento..." : "Scegli foto"}
            <input ref={fileInputRef} type="file" hidden accept=".jpg,.jpeg,.png" onChange={handleFileChange} />
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Elimina foto</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            Stai per eliminare definitivamente <strong>{deleteTarget?.title}</strong>. L'operazione è tracciata e non reversibile.
          </Typography>
          <TextField
            label="Motivazione (obbligatoria)"
            value={deleteReason}
            onChange={(e) => setDeleteReason(e.target.value)}
            size="small"
            fullWidth
            multiline
            minRows={2}
          />
          {deleteMutation.error && <Alert severity="error" sx={{ mt: 2 }}>{deleteMutation.error.message}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Annulla</Button>
          <Button color="error" variant="contained" disabled={!deleteReason.trim() || deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
            Elimina
          </Button>
        </DialogActions>
      </Dialog>

      <ImagePreviewDialog image={previewTarget} onClose={() => setPreviewTarget(null)} />
    </Stack>
  );
}

function PhotoThumbnail({ photo, isAdmin, onPreview, onDelete }) {
  const [imageUrl, setImageUrl] = useState(null);

  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;
    fetchMaintenanceImageBlobUrl(photo.id).then((url) => {
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      objectUrl = url;
      setImageUrl(url);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo.id]);

  return (
    <Paper
      variant="outlined"
      sx={{
        borderRadius: 2.5, overflow: "hidden", transition: "transform 160ms ease, box-shadow 160ms ease",
        "&:hover": { transform: "translateY(-2px)", boxShadow: "0 8px 22px rgba(0,0,0,0.14)" },
      }}
    >
      <Box
        onClick={onPreview}
        sx={{ aspectRatio: "1 / 1", bgcolor: "action.hover", cursor: "pointer", display: "grid", placeItems: "center" }}
      >
        {imageUrl ? (
          <Box component="img" src={imageUrl} alt={photo.title} sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <Typography sx={{ fontSize: 11, color: "text.disabled" }}>Caricamento...</Typography>
        )}
      </Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1, py: 0.5 }}>
        <Typography sx={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{photo.title}</Typography>
        {isAdmin && (
          <IconButton size="small" color="error" onClick={onDelete}>
            <TrashIcon size={15} />
          </IconButton>
        )}
      </Stack>
    </Paper>
  );
}

function CreateDeadlineDialog({ open, onClose, assetId, deadlineTypeOptions, tracksUsageHours }) {
  const queryClient = useQueryClient();
  const [deadlineType, setDeadlineType] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [recurrenceBasis, setRecurrenceBasis] = useState("");
  const [recurrenceDays, setRecurrenceDays] = useState("");
  const [dueHours, setDueHours] = useState("");
  const [recurrenceHours, setRecurrenceHours] = useState("");
  const [lastCompletedAt, setLastCompletedAt] = useState("");
  const [lastCompletedHours, setLastCompletedHours] = useState("");

  const createMutation = useMutation({
    mutationFn: () =>
      createMaintenanceDeadline(assetId, {
        asset_id: assetId,
        deadline_type: deadlineType,
        due_date: dueDate,
        recurrence_basis: recurrenceBasis || null,
        recurrence_days: recurrenceDays ? Number(recurrenceDays) : null,
        due_hours: dueHours ? Number(dueHours) : null,
        recurrence_hours: recurrenceHours ? Number(recurrenceHours) : null,
        last_completed_at: lastCompletedAt || null,
        last_completed_hours: lastCompletedHours ? Number(lastCompletedHours) : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-deadlines", assetId] });
      onClose();
      setDeadlineType("");
      setDueDate("");
      setRecurrenceBasis("");
      setRecurrenceDays("");
      setDueHours("");
      setRecurrenceHours("");
      setLastCompletedAt("");
      setLastCompletedHours("");
    },
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Nuova scadenza</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField select label="Tipo scadenza" value={deadlineType} onChange={(e) => setDeadlineType(e.target.value)} size="small" fullWidth>
            {deadlineTypeOptions.length === 0 && (
              <MenuItem value="" disabled>Nessun tipo scadenza configurato</MenuItem>
            )}
            {deadlineTypeOptions.map((option) => (
              <MenuItem key={option} value={option}>{option}</MenuItem>
            ))}
          </TextField>
          <TextField label="Data scadenza" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} size="small" fullWidth InputLabelProps={{ shrink: true }} />
          <TextField select label="Ricorrenza da" value={recurrenceBasis} onChange={(e) => setRecurrenceBasis(e.target.value)} size="small" fullWidth>
            <MenuItem value="">Nessuna ricorrenza</MenuItem>
            <MenuItem value="da_effettiva">Data effettiva dell'intervento</MenuItem>
            <MenuItem value="da_prevista">Data prevista</MenuItem>
          </TextField>
          {recurrenceBasis && (
            <TextField label="Ogni quanti giorni" type="number" value={recurrenceDays} onChange={(e) => setRecurrenceDays(e.target.value)} size="small" fullWidth />
          )}
          {tracksUsageHours && (
            <>
              <TextField
                label="Soglia ore (facoltativa)"
                type="number"
                value={dueHours}
                onChange={(e) => setDueHours(e.target.value)}
                size="small"
                fullWidth
                helperText="La data proposta resta valida; questa soglia si affianca come ulteriore condizione."
              />
              {dueHours && (
                <TextField
                  label="Ricorrenza ogni quante ore"
                  type="number"
                  value={recurrenceHours}
                  onChange={(e) => setRecurrenceHours(e.target.value)}
                  size="small"
                  fullWidth
                />
              )}
            </>
          )}
          <TextField
            label="Data ultima manutenzione (facoltativa)"
            type="date"
            value={lastCompletedAt}
            onChange={(e) => setLastCompletedAt(e.target.value)}
            size="small"
            fullWidth
            InputLabelProps={{ shrink: true }}
            helperText="Se l'intervento è già avvenuto e la scadenza si crea dopo: la ricorrenza e la soglia ore partiranno da qui, non da oggi."
          />
          {tracksUsageHours && dueHours && (
            <TextField
              label="Ore contatore all'ultima manutenzione (facoltativa)"
              type="number"
              value={lastCompletedHours}
              onChange={(e) => setLastCompletedHours(e.target.value)}
              size="small"
              fullWidth
              helperText="Senza questo valore la soglia ore parte dall'ultima lettura contatore disponibile, non da quando è stato fatto l'intervento."
            />
          )}
          {createMutation.error && <Alert severity="error">{createMutation.error.message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={!deadlineType.trim() || !dueDate || createMutation.isPending} onClick={() => createMutation.mutate()}>
          Crea
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DeadlineRow({ deadline, assetId, isAdmin }) {
  const queryClient = useQueryClient();
  const [completeOpen, setCompleteOpen] = useState(false);
  const [postponeOpen, setPostponeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [completedDate, setCompletedDate] = useState(dayjs().format("YYYY-MM-DD"));
  const [completedHours, setCompletedHours] = useState("");
  const [confirmNext, setConfirmNext] = useState(true);
  const [newDueDate, setNewDueDate] = useState(deadline.due_date);
  const [postponeReason, setPostponeReason] = useState("");
  const urgencyAccent = URGENCY_ACCENTS[deadline.urgency] ?? URGENCY_ACCENTS.regolare;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["maintenance-asset-deadlines", assetId] });
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  // Non c'è ancora, in nessuna categoria della campanella, un pulsante "segna
  // come letta" a sé stante: le notifiche spariscono quando cambia lo stato
  // sottostante. Qui facciamo lo stesso — completare o posticipare la
  // scadenza la marca anche come letta per chi ha appena agito.
  const completeMutation = useMutation({
    mutationFn: async () => {
      await completeMaintenanceDeadline(deadline.id, {
        completed_date: completedDate,
        completed_hours: completedHours ? Number(completedHours) : null,
        confirm_next_due_date: confirmNext,
      });
      await ackMaintenanceDeadline(deadline.id);
    },
    onSuccess: () => { invalidate(); setCompleteOpen(false); },
  });
  const postponeMutation = useMutation({
    mutationFn: async () => {
      await postponeMaintenanceDeadline(deadline.id, { new_due_date: newDueDate, reason: postponeReason });
      await ackMaintenanceDeadline(deadline.id);
    },
    onSuccess: () => { invalidate(); setPostponeOpen(false); },
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteMaintenanceDeadline(deadline.id),
    onSuccess: () => { invalidate(); setDeleteOpen(false); },
  });

  return (
    <>
      <TableRow
        hover
        sx={{
          ...bodyRowSx(),
          "& td:first-of-type": { borderLeft: "3px solid", borderLeftColor: urgencyAccent.color },
        }}
      >
        <TableCell>{deadline.deadline_type}</TableCell>
        <TableCell>
          {dayjs(deadline.due_date).format("DD/MM/YYYY")}
          {deadline.due_hours != null && (
            <Typography sx={{ fontSize: 11.5, color: "text.secondary" }}>+{deadline.due_hours} ore dall'ultima manutenzione</Typography>
          )}
        </TableCell>
        <TableCell>
          <Chip
            label={URGENCY_LABELS[deadline.urgency]}
            size="small"
            color={URGENCY_COLORS[deadline.urgency]}
            variant={deadline.urgency === "urgente" ? "outlined" : "filled"}
            sx={{ fontSize: 11, fontWeight: 700 }}
          />
        </TableCell>
        <TableCell>
          {deadline.last_completed_at ? dayjs(deadline.last_completed_at).format("DD/MM/YYYY") : "—"}
          {deadline.last_completed_hours != null && (
            <Typography sx={{ fontSize: 11.5, color: "text.secondary" }}>{deadline.last_completed_hours} ore</Typography>
          )}
        </TableCell>
        <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
          <Button size="small" color="success" onClick={() => setCompleteOpen(true)}>Completa</Button>
          <Button size="small" color="inherit" onClick={() => setPostponeOpen(true)}>Posticipa</Button>
          {isAdmin && (
            <Button size="small" color="error" onClick={() => setDeleteOpen(true)}>Elimina</Button>
          )}
        </TableCell>
      </TableRow>

      <Dialog open={completeOpen} onClose={() => setCompleteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Completa scadenza</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Data effettiva" type="date" value={completedDate} onChange={(e) => setCompletedDate(e.target.value)} size="small" fullWidth InputLabelProps={{ shrink: true }} />
            {deadline.due_hours != null && (
              <TextField
                label="Ore contaore a questa data (facoltativo)"
                type="number"
                value={completedHours}
                onChange={(e) => setCompletedHours(e.target.value)}
                size="small"
                fullWidth
              />
            )}
            {deadline.recurrence_basis && (
              <FormControlLabel
                control={<Checkbox checked={confirmNext} onChange={(e) => setConfirmNext(e.target.checked)} />}
                label="Genera e conferma la prossima scadenza"
              />
            )}
            {completeMutation.error && <Alert severity="error">{completeMutation.error.message}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCompleteOpen(false)}>Annulla</Button>
          <Button variant="contained" disabled={completeMutation.isPending} onClick={() => completeMutation.mutate()}>Conferma</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={postponeOpen} onClose={() => setPostponeOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Posticipa scadenza</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Nuova data" type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} size="small" fullWidth InputLabelProps={{ shrink: true }} />
            <TextField label="Motivazione (obbligatoria)" value={postponeReason} onChange={(e) => setPostponeReason(e.target.value)} size="small" fullWidth multiline minRows={2} />
            {postponeMutation.error && <Alert severity="error">{postponeMutation.error.message}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPostponeOpen(false)}>Annulla</Button>
          <Button variant="contained" disabled={!postponeReason.trim() || postponeMutation.isPending} onClick={() => postponeMutation.mutate()}>Conferma</Button>
        </DialogActions>
      </Dialog>

      {isAdmin && (
        <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle>Elimina scadenza</DialogTitle>
          <DialogContent>
            <Typography sx={{ fontSize: 13.5 }}>
              Stai per eliminare definitivamente la scadenza "{deadline.deadline_type}" del {dayjs(deadline.due_date).format("DD/MM/YYYY")}. L'operazione non è reversibile.
            </Typography>
            {deleteMutation.error && <Alert severity="error" sx={{ mt: 2 }}>{deleteMutation.error.message}</Alert>}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleteOpen(false)}>Annulla</Button>
            <Button color="error" variant="contained" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>Elimina</Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}

function DeadlinesTab({ assetId, deadlineTypeOptions, tracksUsageHours, isAdmin }) {
  const [createOpen, setCreateOpen] = useState(false);
  const deadlinesQuery = useQuery({
    queryKey: ["maintenance-asset-deadlines", assetId],
    queryFn: () => getMaintenanceAssetDeadlines(assetId),
  });
  const deadlines = deadlinesQuery.data ?? [];

  return (
    <Stack spacing={2} sx={{ pt: 2 }}>
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "stretch", sm: "center" }} spacing={1.5}>
        <Box>
          <Typography sx={{ fontWeight: 700 }}>Piano delle scadenze</Typography>
          <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>Controlli programmati, ricorrenze e completamenti dell'asset.</Typography>
        </Box>
        <Button variant="contained" size="small" onClick={() => setCreateOpen(true)}>+ Nuova scadenza</Button>
      </Stack>
      {deadlinesQuery.error && <Alert severity="error">{deadlinesQuery.error.message}</Alert>}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
        <TableContainer>
        <Table size="small" sx={tableSx({ minWidth: 720 })}>
          <TableHead>
            <TableRow sx={headRowSx}>
              <TableCell sx={{ width: "25%" }}>Tipo</TableCell>
              <TableCell sx={{ width: "18%" }}>Scadenza</TableCell>
              <TableCell sx={{ width: "15%" }}>Stato</TableCell>
              <TableCell sx={{ width: "19%" }}>Ultima manutenzione</TableCell>
              <TableCell align="right" sx={{ width: "23%" }}>Azioni</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {deadlines.map((deadline) => (
              <DeadlineRow key={deadline.id} deadline={deadline} assetId={assetId} isAdmin={isAdmin} />
            ))}
            {deadlinesQuery.isLoading && (
              <TableRow><TableCell colSpan={5} sx={{ py: 3 }}><Skeleton height={28} /></TableCell></TableRow>
            )}
            {deadlines.length === 0 && !deadlinesQuery.isLoading && (
              <TableRow>
                <TableCell colSpan={5} sx={{ py: 3, textAlign: "center", color: "text.secondary" }}>
                  Nessuna scadenza configurata.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        </TableContainer>
      </Paper>
      <CreateDeadlineDialog open={createOpen} onClose={() => setCreateOpen(false)} assetId={assetId} deadlineTypeOptions={deadlineTypeOptions} tracksUsageHours={tracksUsageHours} />
    </Stack>
  );
}

function historyValueOptions(history, key, selectedFields) {
  return maintenanceHistoryOptionValues(history, key, selectedFields).map((value) => {
    if (value === "__missing__") return { value, label: "Non valorizzato" };
    const matchingItem = history.find((item) =>
      item[key] != null
      && String(item[key]) === value
      && (selectedFields.length === 0 || selectedFields.includes(item.changed_field)),
    );
    return { value, label: matchingItem ? formatHistoryValue(matchingItem.changed_field, value) : value };
  });
}

function HistoryFiltersDialog({ open, onClose, filters, onApply, history }) {
  const [draft, setDraft] = useState(() => emptyMaintenanceHistoryFilters());

  useEffect(() => {
    if (open) {
      setDraft({
        ...filters,
        fields: [...filters.fields],
        actors: [...filters.actors],
        oldValues: [...filters.oldValues],
        newValues: [...filters.newValues],
      });
    }
  }, [filters, open]);

  const fieldOptions = Array.from(new Set(history.map((item) => item.changed_field)))
    .map((value) => ({ value, label: HISTORY_FIELD_LABELS[value] ?? value }))
    .sort((first, second) => first.label.localeCompare(second.label, "it"));
  const actorOptions = maintenanceHistoryOptionValues(history, "changed_by")
    .map((value) => ({ value, label: value === "__missing__" ? "Autore non disponibile" : value }));
  const oldValueOptions = historyValueOptions(history, "old_value", draft.fields);
  const newValueOptions = historyValueOptions(history, "new_value", draft.fields);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ pb: 1.25 }}>
        <Stack direction="row" alignItems="center" spacing={1.25}>
          <Box sx={{ width: 38, height: 38, display: "grid", placeItems: "center", borderRadius: 2, color: "primary.main", bgcolor: "action.selected" }}>
            <FilterIcon size={19} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: 18, fontWeight: 800 }}>Filtri storico</Typography>
            <Typography sx={{ fontSize: 12, color: "text.secondary", fontWeight: 500 }}>Restringi le modifiche per contenuto, autore e periodo.</Typography>
          </Box>
        </Stack>
      </DialogTitle>
      <Divider />
      <DialogContent sx={{ py: 2.25 }}>
        <Stack spacing={2.25}>
          <Box>
            <Typography sx={{ mb: 1.2, fontSize: 11, fontWeight: 800, color: "text.secondary", letterSpacing: "0.08em", textTransform: "uppercase" }}>Modifica</Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5 }}>
              <FilterSelect
                label="Campi modificati"
                value={draft.fields}
                onChange={(fields) => setDraft((current) => ({ ...current, fields, oldValues: [], newValues: [] }))}
                options={fieldOptions}
                multiple
              />
              <FilterSelect
                label="Autore"
                value={draft.actors}
                onChange={(actors) => setDraft((current) => ({ ...current, actors }))}
                options={actorOptions}
                multiple
              />
              <FilterSelect
                label="Valore precedente"
                value={draft.oldValues}
                onChange={(oldValues) => setDraft((current) => ({ ...current, oldValues }))}
                options={oldValueOptions}
                multiple
              />
              <FilterSelect
                label="Nuovo valore"
                value={draft.newValues}
                onChange={(newValues) => setDraft((current) => ({ ...current, newValues }))}
                options={newValueOptions}
                multiple
              />
              <FilterSelect
                label="Motivazione"
                value={draft.reason}
                onChange={(reason) => setDraft((current) => ({ ...current, reason }))}
                options={[{ value: "yes", label: "Presente" }, { value: "no", label: "Assente" }]}
              />
            </Box>
          </Box>

          <Divider />
          <Box>
            <Typography sx={{ mb: 1.2, fontSize: 11, fontWeight: 800, color: "text.secondary", letterSpacing: "0.08em", textTransform: "uppercase" }}>Periodo e ordinamento</Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5 }}>
              <Stack direction="row" spacing={1}>
                <TextField label="Dal" type="date" size="small" fullWidth value={draft.dateFrom} onChange={(event) => setDraft((current) => ({ ...current, dateFrom: event.target.value }))} InputLabelProps={{ shrink: true }} />
                <TextField label="Al" type="date" size="small" fullWidth value={draft.dateTo} onChange={(event) => setDraft((current) => ({ ...current, dateTo: event.target.value }))} InputLabelProps={{ shrink: true }} />
              </Stack>
              <TextField select label="Ordina per" size="small" fullWidth value={draft.sort} onChange={(event) => setDraft((current) => ({ ...current, sort: event.target.value }))}>
                <MenuItem value="newest">Modifiche più recenti</MenuItem>
                <MenuItem value="oldest">Modifiche meno recenti</MenuItem>
              </TextField>
            </Box>
          </Box>
        </Stack>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 1.75 }}>
        <Button onClick={() => setDraft(emptyMaintenanceHistoryFilters())} disabled={countMaintenanceHistoryFilters(draft) === 0} sx={{ mr: "auto", textTransform: "none" }}>Azzera tutto</Button>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>Annulla</Button>
        <Button variant="contained" onClick={() => { onApply(draft); onClose(); }}>Applica filtri</Button>
      </DialogActions>
    </Dialog>
  );
}

function HistoryTab({ assetId }) {
  const historyQuery = useQuery({ queryKey: ["maintenance-asset-history", assetId], queryFn: () => getMaintenanceAssetHistory(assetId) });
  const history = historyQuery.data ?? [];
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(() => emptyMaintenanceHistoryFilters());
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    setSearch("");
    setFilters(emptyMaintenanceHistoryFilters());
    setFiltersOpen(false);
  }, [assetId]);

  const activeFilterCount = countMaintenanceHistoryFilters(filters);
  const filteredHistory = useMemo(
    () => filterMaintenanceAssetHistory(history, filters, search, HISTORY_FIELD_LABELS, formatHistoryValue),
    [filters, history, search],
  );

  const filterSummary = useMemo(() => {
    const labels = [];
    const oldValueLabels = new Map(historyValueOptions(history, "old_value", filters.fields).map((option) => [option.value, option.label]));
    const newValueLabels = new Map(historyValueOptions(history, "new_value", filters.fields).map((option) => [option.value, option.label]));
    if (filters.fields.length > 0) labels.push(`Campo: ${filters.fields.map((field) => HISTORY_FIELD_LABELS[field] ?? field).join(", ")}`);
    if (filters.actors.length > 0) labels.push(`Autore: ${filters.actors.map((actor) => actor === "__missing__" ? "non disponibile" : actor).join(", ")}`);
    if (filters.oldValues.length > 0) labels.push(`Da: ${filters.oldValues.map((value) => oldValueLabels.get(value) ?? value).join(", ")}`);
    if (filters.newValues.length > 0) labels.push(`A: ${filters.newValues.map((value) => newValueLabels.get(value) ?? value).join(", ")}`);
    if (filters.reason) labels.push(filters.reason === "yes" ? "Con motivazione" : "Senza motivazione");
    if (filters.dateFrom || filters.dateTo) labels.push(`Periodo: ${filters.dateFrom || "inizio"} → ${filters.dateTo || "oggi"}`);
    if (filters.sort === "oldest") labels.push("Ordine: meno recenti");
    return labels;
  }, [filters, history]);
  const hasActiveCriteria = Boolean(search) || activeFilterCount > 0;

  if (historyQuery.error) return <Alert severity="error" sx={{ mt: 2 }}>{historyQuery.error.message}</Alert>;

  return (
    <Stack spacing={1.5} sx={{ mt: 2 }}>
      <FilterBar
        onReset={() => { setSearch(""); setFilters(emptyMaintenanceHistoryFilters()); }}
        resetDisabled={!hasActiveCriteria}
        dense
      >
        <TextField
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Cerca nello storico..."
          size="small"
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon size={16} /></InputAdornment> }}
          sx={{ flex: "1 1 280px" }}
        />
        <Button
          variant={activeFilterCount > 0 ? "contained" : "outlined"}
          startIcon={<FilterIcon size={17} />}
          onClick={() => setFiltersOpen(true)}
          sx={{ minHeight: 40, px: 1.75, flexShrink: 0, textTransform: "none", borderRadius: 2, fontWeight: 750 }}
        >
          Filtri{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
        </Button>
      </FilterBar>

      {filterSummary.length > 0 && (
        <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" alignItems="center">
          <Typography sx={{ mr: 0.25, fontSize: 11.5, fontWeight: 750, color: "text.secondary" }}>Filtri applicati</Typography>
          {filterSummary.map((label) => <Chip key={label} label={label} size="small" variant="outlined" sx={{ height: 27, bgcolor: "background.paper", fontSize: 11.5 }} />)}
        </Stack>
      )}

      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
        <Box sx={{ px: 2, py: 1.25, display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid", borderColor: "divider", bgcolor: "action.hover" }}>
          <Box>
            <Typography sx={{ fontSize: 13.5, fontWeight: 750 }}>Registro modifiche</Typography>
            <Typography sx={{ fontSize: 11.5, color: "text.secondary" }}>Variazioni tracciate dell'anagrafica e dello stato.</Typography>
          </Box>
          <Typography sx={{ fontSize: 12, color: "text.secondary", fontWeight: 650 }}>{filteredHistory.length} {filteredHistory.length === 1 ? "risultato" : "risultati"}{filteredHistory.length !== history.length ? ` su ${history.length}` : ""}</Typography>
        </Box>
      <TableContainer>
      <Table size="small" sx={tableSx({ minWidth: 840 })}>
        <TableHead>
          <TableRow sx={headRowSx}>
            <TableCell sx={{ width: "15%" }}>Campo</TableCell>
            <TableCell sx={{ width: "15%" }}>Da</TableCell>
            <TableCell sx={{ width: "15%" }}>A</TableCell>
            <TableCell sx={{ width: "23%" }}>Motivo</TableCell>
            <TableCell sx={{ width: "17%" }}>Chi</TableCell>
            <TableCell sx={{ width: "15%" }}>Quando</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {filteredHistory.map((item) => (
            <TableRow key={item.id} hover sx={bodyRowSx()}>
              <TableCell><Typography sx={{ fontSize: 13, fontWeight: 700 }}>{HISTORY_FIELD_LABELS[item.changed_field] ?? item.changed_field}</Typography></TableCell>
              <TableCell>{formatHistoryValue(item.changed_field, item.old_value)}</TableCell>
              <TableCell>{formatHistoryValue(item.changed_field, item.new_value)}</TableCell>
              <TableCell>{item.reason || "—"}</TableCell>
              <TableCell>{item.changed_by || "—"}</TableCell>
              <TableCell>{dayjs(item.changed_at).format("DD/MM/YY HH:mm")}</TableCell>
            </TableRow>
          ))}
          {historyQuery.isLoading && (
            <TableRow><TableCell colSpan={6} sx={{ py: 3 }}><Skeleton height={28} /></TableCell></TableRow>
          )}
          {filteredHistory.length === 0 && !historyQuery.isLoading && (
            <TableRow>
              <TableCell colSpan={6} sx={{ py: 3, textAlign: "center", color: "text.secondary" }}>
                {hasActiveCriteria ? "Nessuna modifica corrisponde ai criteri impostati." : "Nessuna modifica registrata."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      </TableContainer>
      </Paper>
      <HistoryFiltersDialog open={filtersOpen} onClose={() => setFiltersOpen(false)} filters={filters} onApply={setFilters} history={history} />
    </Stack>
  );
}

// Note libere sull'asset (§14): a differenza dello storico, che registra un
// motivo solo quando cambia un campo tracciato, qui si può annotare l'asset
// in qualunque momento. Append-only: nessuna modifica o cancellazione in UI.
// Ogni nota è agganciata allo stato dell'asset al momento in cui è scritta
// (status + status_reason, snapshot lato server): la nota resta leggibile nel
// contesto in cui è nata anche se lo stato dell'asset cambia in seguito.
function CommentsTab({ asset }) {
  const assetId = asset.id;
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const commentsQuery = useQuery({ queryKey: ["maintenance-asset-comments", assetId], queryFn: () => getMaintenanceAssetComments(assetId) });
  const comments = commentsQuery.data ?? [];

  const mutation = useMutation({
    mutationFn: () => createMaintenanceAssetComment(assetId, { text: text.trim() }),
    onSuccess: () => {
      setText("");
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-comments", assetId] });
    },
  });

  return (
    <Stack spacing={2} sx={{ pt: 2, maxWidth: 640 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>La nota viene registrata con lo stato attuale:</Typography>
        <Chip
          size="small"
          label={MAINTENANCE_ASSET_STATUS_LABELS[asset.status] ?? asset.status}
          color={MAINTENANCE_ASSET_STATUS_COLORS[asset.status] ?? "default"}
          sx={{ fontWeight: 700, fontSize: 11.5, height: 22 }}
        />
        {asset.status_reason && (
          <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>({asset.status_reason})</Typography>
        )}
      </Stack>
      <Stack direction="row" spacing={1.5} alignItems="flex-start">
        <TextField
          label="Aggiungi una nota"
          value={text}
          onChange={(e) => setText(e.target.value)}
          size="small"
          fullWidth
          multiline
          minRows={2}
        />
        <Button
          variant="contained"
          disabled={!text.trim() || mutation.isPending}
          onClick={() => mutation.mutate()}
          sx={{ mt: 0.25 }}
        >
          Salva
        </Button>
      </Stack>
      {mutation.error && <Alert severity="error">{mutation.error.message}</Alert>}
      {commentsQuery.error && <Alert severity="error">{commentsQuery.error.message}</Alert>}
      <Stack spacing={1.5}>
        {comments.map((item) => (
          <Paper key={item.id} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
              <Chip
                size="small"
                label={MAINTENANCE_ASSET_STATUS_LABELS[item.status] ?? item.status}
                color={MAINTENANCE_ASSET_STATUS_COLORS[item.status] ?? "default"}
                sx={{ fontWeight: 700, fontSize: 11, height: 20 }}
              />
              {item.status_reason && (
                <Typography sx={{ fontSize: 12, color: "text.secondary" }}>{item.status_reason}</Typography>
              )}
            </Stack>
            <Typography sx={{ fontSize: 13.5, whiteSpace: "pre-wrap" }}>{item.text}</Typography>
            <Typography sx={{ fontSize: 11.5, color: "text.secondary", mt: 0.5 }}>
              {item.created_by || "—"} · {dayjs(item.created_at).format("DD/MM/YY HH:mm")}
            </Typography>
          </Paper>
        ))}
        {commentsQuery.isLoading && <Skeleton height={60} />}
        {comments.length === 0 && !commentsQuery.isLoading && (
          <Typography sx={{ fontSize: 13, color: "text.secondary", textAlign: "center", py: 2 }}>
            Nessuna nota registrata.
          </Typography>
        )}
      </Stack>
    </Stack>
  );
}

function AssetFact({ icon, label, value }) {
  return (
    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
      <Box
        sx={{
          width: 34,
          height: 34,
          flexShrink: 0,
          borderRadius: 2,
          display: "grid",
          placeItems: "center",
          bgcolor: "action.selected",
          color: "primary.main",
        }}
      >
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.02em", color: "text.secondary", lineHeight: 1.3 }}>
          {label}
        </Typography>
        <Typography sx={{ fontSize: 14, fontWeight: 650, lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value}
        </Typography>
      </Box>
    </Stack>
  );
}

// La scheda iniziale concentra identità, disponibilità e prossima azione:
// sono le informazioni che servono davanti al mezzo, anche da tablet.
function AssetHero({ asset, deadlines, employeeFieldNames, latestReading, onDelete, canDelete, hasDepartmentField, hasResponsibleField }) {
  const [menuAnchor, setMenuAnchor] = useState(null);
  const activeDeadlines = deadlines.filter((d) => d.is_active).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const nextDeadline = activeDeadlines[0] ?? null;
  const accent = URGENCY_ACCENTS[nextDeadline?.urgency] ?? URGENCY_ACCENTS.regolare;
  const remainingDays = nextDeadline ? dayjs(nextDeadline.due_date).startOf("day").diff(dayjs().startOf("day"), "day") : null;
  const deadlineTiming = remainingDays == null
    ? null
    : remainingDays < 0
      ? `${Math.abs(remainingDays)} ${Math.abs(remainingDays) === 1 ? "giorno" : "giorni"} fa`
      : remainingDays === 0
        ? "Oggi"
        : `Tra ${remainingDays} ${remainingDays === 1 ? "giorno" : "giorni"}`;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: { xs: 2, sm: 3 },
        borderRadius: 3,
        overflow: "hidden",
        position: "relative",
        background: (theme) => theme.palette.mode === "dark"
          ? "linear-gradient(135deg, rgba(0,112,64,0.22) 0%, rgba(51,51,51,0.96) 46%, rgba(51,51,51,1) 100%)"
          : "linear-gradient(135deg, rgba(0,112,64,0.10) 0%, rgba(251,250,246,0.98) 46%, rgba(251,250,246,1) 100%)",
        "&::before": {
          content: '""', position: "absolute", width: 220, height: 220, borderRadius: "50%",
          right: -90, top: -130, bgcolor: "primary.main", opacity: 0.08,
        },
      }}
    >
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "190px minmax(0, 1fr)" }, gap: { xs: 2.5, sm: 3.5 }, position: "relative" }}>
        <MainImageSection asset={asset} size={170} showLabel={false} />

        <Stack spacing={2.25} sx={{ minWidth: 0 }}>
          <Box>
            <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="overline" sx={{ color: "primary.main", fontWeight: 800, letterSpacing: "0.08em", lineHeight: 1.4 }}>
                  {asset.asset_class_label} · {asset.asset_type_label}
                </Typography>
                <Typography variant="h4" sx={{ fontSize: { xs: 24, sm: 30 }, mt: 0.25, lineHeight: 1.12 }}>
                  {[asset.custom_fields?.brand, asset.custom_fields?.model].filter(Boolean).join(" ") || asset.internal_code}
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1, flexWrap: "wrap", rowGap: 1 }}>
                  <Chip label={asset.internal_code} size="small" variant="outlined" sx={{ fontWeight: 800, letterSpacing: "0.04em" }} />
                  <StatusBadge asset={asset} />
                </Stack>
                <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 0.75 }}>
                  Ultima modifica: {dayjs(asset.updated_at).format("DD/MM/YY HH:mm")}
                  {asset.last_modified_by ? ` · ${asset.last_modified_by}` : ""}
                </Typography>
              </Box>
              {canDelete && (
                <>
                  <Tooltip title="Altre azioni">
                    <IconButton size="small" onClick={(event) => setMenuAnchor(event.currentTarget)} sx={{ color: "text.secondary", flexShrink: 0 }}>
                      <MoreIcon size={20} />
                    </IconButton>
                  </Tooltip>
                  <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
                    <MenuItem
                      onClick={() => {
                        setMenuAnchor(null);
                        onDelete();
                      }}
                      sx={{ color: "error.main", fontSize: 13.5 }}
                    >
                      <Box sx={{ mr: 1.25, display: "grid", placeItems: "center" }}><TrashIcon size={17} /></Box>
                      Elimina asset
                    </MenuItem>
                  </Menu>
                </>
              )}
            </Stack>
          </Box>

          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(4, minmax(0, 1fr))" }, gap: 2 }}>
            <AssetFact icon={<PinIcon />} label="Sito" value={asset.custom_fields?.site || "Non assegnato"} />
            {hasDepartmentField && (
              <AssetFact icon={<PinIcon />} label="Reparto" value={asset.custom_fields?.department || "Non assegnato"} />
            )}
            {hasResponsibleField && (
              <AssetFact icon={<PersonIcon />} label="Responsabile" value={employeeFieldNames?.responsible_employee_id || "Non assegnato"} />
            )}
            <AssetFact icon={<CalendarIcon />} label="Ore totali" value={latestReading ? `${latestReading.value} ${latestReading.unit}` : "Nessuna lettura"} />
          </Box>

          <Box
            sx={{
              display: "flex", alignItems: "center", gap: 1.5, p: 1.5, borderRadius: 2,
              borderLeft: "4px solid", borderLeftColor: accent.color, bgcolor: accent.background,
            }}
          >
            <Box sx={{ color: accent.color, display: "grid", placeItems: "center" }}><WarningIcon size={19} /></Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: accent.color }}>
                {nextDeadline ? `Prossima scadenza · ${deadlineTiming}` : "Scadenze"}
              </Typography>
              <Typography sx={{ fontSize: 14, fontWeight: 700 }}>
                {nextDeadline ? `${nextDeadline.deadline_type} · ${dayjs(nextDeadline.due_date).format("D MMMM YYYY")}` : "Nessuna scadenza attiva"}
              </Typography>
            </Box>
            {nextDeadline && <Chip label={URGENCY_LABELS[nextDeadline.urgency]} size="small" color={URGENCY_COLORS[nextDeadline.urgency]} sx={{ fontWeight: 700 }} />}
          </Box>
        </Stack>
      </Box>
    </Paper>
  );
}

function TabLabelWithCount({ label, count }) {
  if (count == null) return label;
  return (
    <Stack component="span" direction="row" spacing={0.75} alignItems="center">
      <Box component="span">{label}</Box>
      <Box
        component="span"
        sx={{
          minWidth: 20,
          height: 20,
          px: 0.65,
          borderRadius: "10px",
          display: "inline-grid",
          placeItems: "center",
          bgcolor: "primary.main",
          color: "primary.contrastText",
          fontSize: 10.5,
          fontWeight: 800,
          lineHeight: 1,
        }}
      >
        {count > 999 ? "999+" : count}
      </Box>
    </Stack>
  );
}

export default function MaintenanceAssetDetailPage() {
  const { assetId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.effective_role === "admin";
  const [tab, setTab] = useState(0);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const assetQuery = useQuery({ queryKey: ["maintenance-asset", assetId], queryFn: () => getMaintenanceAsset(assetId) });
  const asset = assetQuery.data;

  const assetClassesQuery = useQuery({ queryKey: ["maintenance-asset-classes"], queryFn: getMaintenanceAssetClasses });
  // Unione degli attributi generici di classe e di quelli specifici della
  // sottoclasse, nell'ordine sort_order (stesso criterio del backend in
  // services/maintenance_assets.py::_field_defs_for_asset_type).
  const currentClass = asset ? (assetClassesQuery.data ?? []).find((c) => c.id === asset.asset_class_id) : null;
  const currentType = asset ? currentClass?.types.find((t) => t.id === asset.asset_type_id) : null;
  const assetTypeFields = asset
    ? [...(currentClass?.fields ?? []), ...(currentType?.fields ?? [])].sort((a, b) => a.sort_order - b.sort_order)
    : [];
  const tracksUsageHours = !!currentType?.tracks_usage_hours;
  // Reparto e responsabile sono attributi generici di classe come gli altri:
  // il riepilogo li mostra solo se la classe li ha configurati in
  // /manutenzioni/categorie (tab Attributi generici), non in modo fisso.
  const hasDepartmentField = (currentClass?.fields ?? []).some((field) => field.field_key === "department");
  const hasResponsibleField = (currentClass?.fields ?? []).some((field) => field.field_key === "responsible_employee_id");
  const currentClassCode = currentClass?.code ?? null;
  const backToListPath = currentClassCode ? `/manutenzioni/asset/${currentClassCode}` : "/manutenzioni";

  // Stesse queryKey delle tab corrispondenti: React Query le deduplica. Servono
  // anche al riepilogo iniziale e ai badge, senza richieste di rete aggiuntive.
  const documentsQuery = useQuery({
    queryKey: ["maintenance-documents", assetId, false],
    queryFn: () => getMaintenanceDocuments(assetId, { includeObsolete: false }),
    enabled: !!asset,
  });
  const deadlinesQuery = useQuery({
    queryKey: ["maintenance-asset-deadlines", assetId],
    queryFn: () => getMaintenanceAssetDeadlines(assetId),
    enabled: !!asset,
  });
  const photosQuery = useQuery({
    queryKey: ["maintenance-photos", assetId],
    queryFn: () => getMaintenancePhotos(assetId),
    enabled: !!asset,
  });
  const countersQuery = useQuery({
    queryKey: ["maintenance-asset-counters", assetId],
    queryFn: () => getMaintenanceAssetCounters(assetId),
    enabled: !!asset && tracksUsageHours,
  });
  const commentsQuery = useQuery({
    queryKey: ["maintenance-asset-comments", assetId],
    queryFn: () => getMaintenanceAssetComments(assetId),
    enabled: !!asset,
  });
  const deadlines = deadlinesQuery.data ?? [];
  const latestReading = (countersQuery.data ?? [])[0];
  const deadlinesToWatch = deadlines.filter((deadline) => deadline.is_active && deadline.urgency !== "regolare").length;
  const tabIndexes = {
    registry: 0,
    deadlines: 1,
    documents: 2,
    hours: tracksUsageHours ? 3 : null,
    photos: tracksUsageHours ? 4 : 3,
    history: tracksUsageHours ? 5 : 4,
    comments: tracksUsageHours ? 6 : 5,
  };

  const deleteMutation = useMutation({
    mutationFn: () => deleteMaintenanceAsset(assetId),
    onSuccess: () => navigate(backToListPath),
  });

  if (assetQuery.isLoading) {
    return (
      <Stack spacing={2}>
        <Skeleton variant="rounded" height={82} sx={{ borderRadius: 3 }} />
        <Skeleton variant="rounded" height={310} sx={{ borderRadius: 3 }} />
        <Skeleton variant="rounded" height={360} sx={{ borderRadius: 2 }} />
      </Stack>
    );
  }
  if (assetQuery.error) return <Alert severity="error" sx={{ m: 3 }}>{assetQuery.error.message}</Alert>;
  if (!asset) return null;

  return (
    <Box sx={{ minHeight: "100%" }}>
      <Stack spacing={2}>
        <PageHeader
          section={`Manutenzioni · ${asset.asset_class_label}`}
          title="Dettaglio asset"
          actions={
            <HeaderButton onClick={() => navigate(backToListPath)} startIcon={<ArrowLeftIcon size={15} />}>
              Torna all'elenco
            </HeaderButton>
          }
        />

        <AssetHero
          asset={asset}
          deadlines={deadlines}
          employeeFieldNames={asset.employee_field_names}
          latestReading={latestReading}
          canDelete={isAdmin}
          onDelete={() => setDeleteOpen(true)}
          hasDepartmentField={hasDepartmentField}
          hasResponsibleField={hasResponsibleField}
        />

        {deadlinesQuery.error && <Alert severity="error">Impossibile caricare il riepilogo scadenze: {deadlinesQuery.error.message}</Alert>}

        <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle>Elimina asset</DialogTitle>
          <DialogContent>
            <Typography sx={{ fontSize: 13.5 }}>
              Stai per eliminare definitivamente <strong>{asset.internal_code}</strong> con tutto il suo storico, i contatori, le scadenze e i documenti collegati (compresi i file sulla condivisione). L'operazione non è reversibile.
            </Typography>
            {deleteMutation.error && <Alert severity="error" sx={{ mt: 2 }}>{deleteMutation.error.message}</Alert>}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleteOpen(false)}>Annulla</Button>
            <Button color="error" variant="contained" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
              {deleteMutation.isPending ? "Eliminazione..." : "Elimina"}
            </Button>
          </DialogActions>
        </Dialog>

        <Paper variant="outlined" sx={{ borderRadius: 2.5, minWidth: 0, overflow: "hidden" }}>
            <Tabs
              value={tab}
              onChange={(_, v) => setTab(v)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{
                px: 2,
                borderBottom: "1px solid",
                borderColor: "divider",
                bgcolor: "action.hover",
                minHeight: 50,
                "& .MuiTab-root": { minHeight: 50, py: 0, px: 2, fontSize: 13.5, fontWeight: 650, textTransform: "none" },
                "& .Mui-selected": { fontWeight: 800 },
                "& .MuiTabs-indicator": { height: 3, borderRadius: "3px 3px 0 0" },
              }}
            >
              <Tab label="Anagrafica" />
              <Tab label={<TabLabelWithCount label="Scadenze" count={deadlinesToWatch || null} />} />
              <Tab label={<TabLabelWithCount label="Documenti" count={documentsQuery.data?.length} />} />
              {tracksUsageHours && (
                <Tab label={latestReading ? `Ore (${latestReading.value} ${latestReading.unit})` : "Ore"} />
              )}
              <Tab label={<TabLabelWithCount label="Foto" count={photosQuery.data?.length} />} />
              <Tab label="Storico" />
              <Tab label={<TabLabelWithCount label="Note" count={commentsQuery.data?.length} />} />
            </Tabs>
            <Box sx={{ px: { xs: 2, sm: 3 }, pb: 3 }}>
              {tab === tabIndexes.registry && <AnagraficaTab asset={asset} assetTypeFields={assetTypeFields} employeeFieldNames={asset.employee_field_names} />}
              {tab === tabIndexes.deadlines && <DeadlinesTab assetId={assetId} deadlineTypeOptions={asset.deadline_type_options} tracksUsageHours={tracksUsageHours} isAdmin={isAdmin} />}
              {tab === tabIndexes.documents && <DocumentsTab assetId={assetId} documentTypeOptions={asset.document_type_options} />}
              {tracksUsageHours && tab === tabIndexes.hours && <HoursTab assetId={assetId} isAdmin={isAdmin} />}
              {tab === tabIndexes.photos && (
                <Stack spacing={2} sx={{ pt: 2 }}>
                  <Box>
                    <Typography sx={{ fontWeight: 700 }}>Galleria asset</Typography>
                    <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>Dettagli e angolazioni aggiuntive rispetto all'immagine principale.</Typography>
                  </Box>
                  <PhotosTab assetId={asset.id} />
                </Stack>
              )}
              {tab === tabIndexes.history && <HistoryTab assetId={assetId} />}
              {tab === tabIndexes.comments && <CommentsTab asset={asset} />}
            </Box>
        </Paper>
      </Stack>
    </Box>
  );
}
