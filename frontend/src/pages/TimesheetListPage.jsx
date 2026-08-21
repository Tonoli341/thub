import dayjs from "dayjs";
import "dayjs/locale/it";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  CircularProgress,
  IconButton,
  Paper,
  Skeleton,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useLocation } from "react-router-dom";

import { deleteActivityRecordAdmin, getActivityRecordsAdmin, getDailyRecords, getEmployees, getInfinityBillingCustomerSupplierMap, getOperationalAreas, updateActivityRecordAdmin } from "../api";
import { useAuth } from "../auth";
import { reportingBuildingCodes } from "../buildings";
import ReportingPeriodFilter from "../components/ReportingPeriodFilter";
import PageHeader, { HeaderButton } from "../components/PageHeader";
import { headRowSx, stickyFirstColumnSx, tableSx } from "../components/tableStyles";
import { timesheetListColumns } from "./timesheetListColumns";

function fmtDuration(seconds) {
  const totalMinutes = Math.round((seconds ?? 0) / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function fmtHoursHm(hours) {
  const totalMinutes = Math.round((Number(hours) || 0) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function fmtTime(iso) {
  if (!iso) return "—";
  return dayjs(iso).format("HH:mm");
}

function secondsToHm(seconds) {
  const totalMinutes = Math.round((seconds ?? 0) / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  return dayjs(iso).format("DD/MM/YYYY");
}

function activityLocation(record) {
  return [record.operational_area_name, record.building].filter(Boolean).join(" · ") || "Posizione non specificata";
}

function buildTimelineDays(activities, presences) {
  const activitiesByDate = new Map();
  for (const activity of activities) {
    const key = dayjs(activity.started_at).format("YYYY-MM-DD");
    activitiesByDate.set(key, [...(activitiesByDate.get(key) ?? []), activity]);
  }
  const presenceByDate = new Map((presences ?? []).map((presence) => [String(presence.date), presence]));
  const dates = [...new Set([...activitiesByDate.keys(), ...presenceByDate.keys()])].sort();

  return dates.map((date) => {
    const dayActivities = (activitiesByDate.get(date) ?? []).slice().sort((a, b) => dayjs(a.started_at).valueOf() - dayjs(b.started_at).valueOf());
    const presence = presenceByDate.get(date);
    const activityStarts = dayActivities.map((activity) => dayjs(activity.started_at).valueOf());
    const activityEnds = dayActivities.map((activity) => dayjs(activity.ended_at).valueOf());
    const startMs = presence?.started_at ? dayjs(presence.started_at).valueOf() : Math.min(...activityStarts);
    const endMs = presence?.ended_at ? dayjs(presence.ended_at).valueOf() : Math.max(...activityEnds);

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      return { date, presence, startMs, endMs, segments: [], stops: [] };
    }

    const clippedActivities = dayActivities
      .map((activity) => ({
        ...activity,
        segmentStart: Math.max(dayjs(activity.started_at).valueOf(), startMs),
        segmentEnd: Math.min(dayjs(activity.ended_at).valueOf(), endMs),
        location: activityLocation(activity),
      }))
      .filter((activity) => activity.segmentEnd > activity.segmentStart);
    const boundaries = [...new Set([
      startMs,
      endMs,
      ...clippedActivities.flatMap((activity) => [activity.segmentStart, activity.segmentEnd]),
    ])].sort((a, b) => a - b);

    const segments = [];
    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const segmentStart = boundaries[index];
      const segmentEnd = boundaries[index + 1];
      const active = clippedActivities.filter((activity) => activity.segmentStart < segmentEnd && activity.segmentEnd > segmentStart);
      const locations = [...new Set(active.map((activity) => activity.location))];
      const status = active.length > 0 ? "busy" : "idle";
      const location = locations.join(" / ");
      const previous = segments.at(-1);
      if (previous && previous.status === status && previous.location === location) {
        previous.endMs = segmentEnd;
      } else {
        segments.push({ startMs: segmentStart, endMs: segmentEnd, status, location });
      }
    }

    const stops = [];
    let lastLocation = null;
    for (const segment of segments) {
      if (segment.status === "busy" && segment.location !== lastLocation) {
        stops.push({ atMs: segment.startMs, location: segment.location });
        lastLocation = segment.location;
      }
    }
    return { date, presence, startMs, endMs, segments, stops };
  });
}

function TimelineLegendItem({ color, label }) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center">
      <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: color }} />
      <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Stack>
  );
}

function EmployeeDayTimeline({ day }) {
  const duration = day.endMs - day.startMs;
  const position = (timestamp) => duration > 0 ? ((timestamp - day.startMs) / duration) * 100 : 0;

  return (
    <Box sx={{ px: 3, py: 2.5, borderTop: "1px solid", borderColor: "divider" }}>
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={0.5} sx={{ mb: 1.5 }}>
        <Typography sx={{ fontWeight: 800 }}>{dayjs(day.date).locale("it").format("dddd DD/MM/YYYY")}</Typography>
        {duration > 0 && (
          <Typography variant="body2" color="text.secondary">
            Inizio {dayjs(day.startMs).format("HH:mm")} · Fine {dayjs(day.endMs).format("HH:mm")}
            {!day.presence && " · orario ricavato dalle attività"}
          </Typography>
        )}
      </Stack>

      {duration <= 0 ? (
        <Typography variant="body2" color="text.disabled">Orari della giornata non disponibili.</Typography>
      ) : (
        <>
          <Box sx={{ position: "relative", height: 42, mx: 1.25 }}>
            <Box sx={{ position: "absolute", left: 0, right: 0, top: 16, height: 8, bgcolor: "#e2e2e5", borderRadius: 4 }} />
            {day.segments.map((segment, index) => (
              <Tooltip
                arrow
                key={`${segment.startMs}-${index}`}
                title={`${segment.status === "busy" ? "Busy" : "Idle"} · ${dayjs(segment.startMs).format("HH:mm")}–${dayjs(segment.endMs).format("HH:mm")}${segment.location ? ` · ${segment.location}` : ""}`}
              >
                <Box
                  sx={{
                    position: "absolute",
                    left: `${position(segment.startMs)}%`,
                    width: `${position(segment.endMs) - position(segment.startMs)}%`,
                    top: 16,
                    height: 8,
                    bgcolor: segment.status === "busy" ? "#007040" : "#b8bcc2",
                    borderRadius: 4,
                    zIndex: 1,
                  }}
                />
              </Tooltip>
            ))}
            {[
              { atMs: day.startMs, label: "Inizio giornata", edge: "start" },
              ...day.stops.map((stop) => ({ ...stop, label: stop.location })),
              { atMs: day.endMs, label: "Fine giornata", edge: "end" },
            ].map((stop, index) => (
              <Tooltip key={`${stop.atMs}-${stop.label}-${index}`} arrow title={`${dayjs(stop.atMs).format("HH:mm")} · ${stop.label}`}>
                <Box
                  sx={{
                    position: "absolute",
                    left: `${position(stop.atMs)}%`,
                    top: 10,
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    bgcolor: stop.edge ? "#fff" : "#007040",
                    border: "3px solid #007040",
                    transform: "translateX(-50%)",
                    zIndex: 2,
                  }}
                />
              </Tooltip>
            ))}
          </Box>

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip size="small" variant="outlined" label={`${dayjs(day.startMs).format("HH:mm")} · Inizio giornata`} />
            {day.stops.map((stop, index) => (
              <Chip
                key={`${stop.atMs}-${stop.location}-${index}`}
                size="small"
                label={`${dayjs(stop.atMs).format("HH:mm")} · ${stop.location}`}
                sx={{ bgcolor: "rgba(0,112,64,0.08)", color: "primary.main", fontWeight: 700 }}
              />
            ))}
            <Chip size="small" variant="outlined" label={`${dayjs(day.endMs).format("HH:mm")} · Fine giornata`} />
          </Stack>
        </>
      )}
    </Box>
  );
}

function EmployeeTimeline({ employee, activities, presences, isLoading }) {
  const days = buildTimelineDays(activities, presences);
  return (
    <Paper sx={{ borderRadius: 3, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2, bgcolor: "#faf7f2" }}>
        <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "center" }} spacing={1}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>Timeline di {employee.full_name}</Typography>
            <Typography color="text.secondary">Presenza, attività e spostamenti tra aree e immobili</Typography>
          </Box>
          <Stack direction="row" spacing={2}>
            <TimelineLegendItem color="#007040" label="Busy" />
            <TimelineLegendItem color="#b8bcc2" label="Idle" />
          </Stack>
        </Stack>
      </Box>
      {isLoading ? (
        <Box sx={{ px: 3, py: 2.5 }}><Skeleton height={70} /></Box>
      ) : days.length === 0 ? (
        <Box sx={{ px: 3, py: 4, borderTop: "1px solid", borderColor: "divider", textAlign: "center" }}>
          <Typography variant="body2" color="text.disabled">Nessun dato temporale nel periodo selezionato.</Typography>
        </Box>
      ) : days.map((day) => <EmployeeDayTimeline key={day.date} day={day} />)}
    </Paper>
  );
}

function FieldValuesExpanded({ values }) {
  const entries = Object.entries(values ?? {});
  if (entries.length === 0) return null;
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
      {entries.map(([k, v]) => (
        <Chip
          key={k}
          label={`${k}: ${v}`}
          size="small"
          variant="outlined"
          sx={{ fontSize: "0.68rem", height: 20, fontFamily: "monospace" }}
        />
      ))}
    </Stack>
  );
}

function ActivityRow({ record, isAdmin, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const hasFields = Object.keys(record.field_values ?? {}).length > 0;

  return (
    <>
      <TableRow hover>
        <TableCell>
          <Typography variant="body2" fontWeight={700} noWrap>
            {record.employee_name || record.employee_id}
          </Typography>
        </TableCell>
        <TableCell>
          <Typography variant="body2" fontWeight={500} noWrap sx={{ maxWidth: 200 }}>
            {record.mapping_description || "—"}
          </Typography>
          {record.jupiter_description && (
            <Typography variant="caption" color="text.secondary" display="block">
              {record.jupiter_description}
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
        </TableCell>
        <TableCell>
          <Typography variant="caption" color="text.secondary">{record.building || "—"}</Typography>
        </TableCell>
        <TableCell>
          <Typography variant="body2" fontWeight={600}>{fmtDate(record.started_at)}</Typography>
        </TableCell>
        <TableCell>
          <Typography variant="body2">{fmtTime(record.started_at)}</Typography>
        </TableCell>
        <TableCell>
          <Typography variant="body2">{fmtTime(record.ended_at)}</Typography>
        </TableCell>
        <TableCell>
          <Chip
            label={fmtDuration(record.duration_seconds)}
            size="small"
            sx={{ bgcolor: "rgba(0,112,64,0.08)", color: "primary.main", fontWeight: 700, fontSize: "0.72rem" }}
          />
        </TableCell>
        <TableCell>
          {hasFields ? (
            <Tooltip title={open ? "Chiudi" : "Campi extra"}>
              <IconButton
                size="small"
                onClick={() => setOpen((c) => !c)}
                sx={{
                  fontSize: 16,
                  color: "text.secondary",
                  transform: open ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.15s",
                }}
              >
                ˅
              </IconButton>
            </Tooltip>
          ) : (
            <Typography variant="caption" color="text.disabled">—</Typography>
          )}
        </TableCell>
        {isAdmin && (
          <TableCell>
            <Stack direction="row" spacing={1}>
              <Button size="small" variant="outlined" startIcon={<span aria-hidden="true">✏️</span>} onClick={() => onEdit(record)}>
                Modifica
              </Button>
              <Button size="small" variant="outlined" color="error" startIcon={<span aria-hidden="true">🗑️</span>} onClick={() => onDelete(record)}>
                Elimina
              </Button>
            </Stack>
          </TableCell>
        )}
      </TableRow>
      {hasFields && (
        <TableRow>
          <TableCell colSpan={isAdmin ? 10 : 9} sx={{ py: 0, borderBottom: open ? undefined : "none" }}>
            <Collapse in={open} timeout="auto" unmountOnExit>
              <Box sx={{ px: 2, py: 1.5, bgcolor: "action.hover", borderRadius: 1, my: 0.5 }}>
                <FieldValuesExpanded values={record.field_values} />
              </Box>
            </Collapse>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// Ricava inizio/fine dal form e la durata NETTA (= lordo − pausa). Il lordo è
// fine − inizio (turni a cavallo della mezzanotte: la fine cade il giorno
// successivo); la pausa è espressa in minuti nel form.
function computeTimes(form) {
  const startedAt = dayjs(`${form.date}T${form.startTime}`);
  let endedAt = dayjs(`${form.date}T${form.endTime}`);
  if (endedAt.isValid() && startedAt.isValid() && !endedAt.isAfter(startedAt)) {
    endedAt = endedAt.add(1, "day");
  }
  const valid = startedAt.isValid() && endedAt.isValid();
  const grossSeconds = valid ? endedAt.diff(startedAt, "second") : null;
  const pauseSeconds = Math.max(Number(form.pauseMinutes) || 0, 0) * 60;
  const durationSeconds = grossSeconds != null ? grossSeconds - pauseSeconds : null;
  return { startedAt, endedAt, grossSeconds, pauseSeconds, durationSeconds, valid };
}

// Codici immobile selezionabili per l'area scelta. Il codice già salvato sul
// record resta in elenco anche se l'area non lo prevede più, così una modifica
// di orario non costringe a cambiare anche l'immobile.
function buildingOptions(area, current) {
  const codes = reportingBuildingCodes(area?.buildings);
  return current && !codes.includes(current) ? [...codes, current] : codes;
}

function EditActivityDialog({ record, areas, areasLoading, onClose, onSave, isSaving, error }) {
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (!record) {
      setForm(null);
      return;
    }
    const start = dayjs(record.started_at);
    const end = record.ended_at ? dayjs(record.ended_at) : start;
    // La pausa non è memorizzata sul record: la ricaviamo dalla differenza tra
    // durata lorda (fine − inizio) e durata netta salvata (duration_seconds).
    const grossSeconds = end.diff(start, "second");
    const pauseSeconds = Math.max(grossSeconds - (record.duration_seconds ?? grossSeconds), 0);
    setForm({
      date: start.format("YYYY-MM-DD"),
      startTime: start.format("HH:mm"),
      endTime: end.format("HH:mm"),
      pauseMinutes: String(Math.round(pauseSeconds / 60)),
      areaId: record.operational_area_id ?? "",
      building: record.building ?? "",
    });
  }, [record]);

  const selectedArea = (areas ?? []).find((a) => a.id === form?.areaId) ?? null;
  const buildingChoices = buildingOptions(selectedArea, form?.building);

  function setField(key, value) {
    setForm((c) => ({ ...c, [key]: value }));
  }

  const times = form ? computeTimes(form) : null;

  function handleSave() {
    const { startedAt, endedAt, grossSeconds, pauseSeconds, durationSeconds, valid } = computeTimes(form);
    if (!valid) {
      onSave(null, "Data o orari non validi.");
      return;
    }
    if (pauseSeconds >= grossSeconds) {
      onSave(null, "La pausa non può essere maggiore o uguale al tempo totale.");
      return;
    }
    if (durationSeconds == null || durationSeconds < 60) {
      onSave(null, "Durata non valida (minimo 00:01).");
      return;
    }
    onSave({
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      duration_seconds: durationSeconds,
      operational_area_id: form.areaId || null,
      building: form.building || null,
    });
  }

  return (
    <Dialog open={!!record} onClose={() => !isSaving && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle>Modifica giornata</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {record?.employee_name || record?.employee_id} · {record?.mapping_description || "—"}
        </Typography>
        {form && (
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
            <TextField
              type="date"
              label="Data"
              value={form.date}
              onChange={(e) => setField("date", e.target.value)}
              InputLabelProps={{ shrink: true }}
              size="small"
            />
            <Autocomplete
              options={areas ?? []}
              value={selectedArea}
              onChange={(_event, value) => setForm((c) => ({ ...c, areaId: value?.id ?? "", building: "" }))}
              loading={areasLoading}
              getOptionLabel={(option) => option?.name ?? ""}
              isOptionEqualToValue={(option, value) => option.id === value.id}
              renderInput={(params) => <TextField {...params} label="Area operativa" size="small" />}
              noOptionsText="Nessuna area trovata"
              loadingText="Caricamento aree..."
            />
            <Autocomplete
              options={buildingChoices}
              value={form.building || null}
              onChange={(_event, value) => setField("building", value ?? "")}
              disabled={!selectedArea || buildingChoices.length === 0}
              renderInput={(params) => <TextField {...params} label="Immobile" size="small" />}
              noOptionsText="Nessun immobile per questa area"
            />
            <TextField
              type="time"
              label="Inizio"
              value={form.startTime}
              onChange={(e) => setField("startTime", e.target.value)}
              InputLabelProps={{ shrink: true }}
              size="small"
            />
            <TextField
              type="time"
              label="Fine"
              value={form.endTime}
              onChange={(e) => setField("endTime", e.target.value)}
              InputLabelProps={{ shrink: true }}
              size="small"
            />
            <TextField
              type="number"
              label="Pausa (min)"
              value={form.pauseMinutes}
              onChange={(e) => setField("pauseMinutes", e.target.value)}
              InputLabelProps={{ shrink: true }}
              inputProps={{ min: 0, step: 1 }}
              size="small"
            />
            <TextField
              label="Durata (hh:mm)"
              value={times?.durationSeconds != null && times.durationSeconds > 0 ? secondsToHm(times.durationSeconds) : "—"}
              InputLabelProps={{ shrink: true }}
              InputProps={{ readOnly: true }}
              size="small"
              disabled
              helperText="Inizio → fine, al netto della pausa"
            />
          </Box>
        )}
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isSaving}>Annulla</Button>
        <Button variant="contained" onClick={handleSave} disabled={isSaving || !form}>
          {isSaving ? <CircularProgress size={18} color="inherit" /> : "Salva"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function ActivityListPage() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const { effectiveUser } = useAuth();
  const isAdmin = effectiveUser?.effective_role === "admin";

  const [confirmDelete, setConfirmDelete] = useState(null);
  const [editRecord, setEditRecord] = useState(null);
  const [editError, setEditError] = useState(null);
  const [snackbar, setSnackbar] = useState(null);
  const [fieldSearch, setFieldSearch] = useState("");

  const [filters, setFilters] = useState(() => {
    const params = new URLSearchParams(location.search);
    const today = dayjs().format("YYYY-MM-DD");
    return {
      startDate: today,
      endDate: today,
      employeeId: params.get("employeeId") ?? "",
      mappingId: params.get("mappingId") ?? "",
    };
  });

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const empId = params.get("employeeId") ?? "";
    const mapId = params.get("mappingId") ?? "";
    if (empId || mapId) {
      setFilters((c) => ({ ...c, employeeId: empId, mappingId: mapId }));
    }
  }, [location.search]);

  const deleteMutation = useMutation({
    mutationFn: (recordId) => deleteActivityRecordAdmin(recordId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activity-records-admin"] });
      queryClient.invalidateQueries({ queryKey: ["activity-records-timeline"] });
      setConfirmDelete(null);
      setSnackbar("Giornata eliminata");
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ recordId, payload }) => updateActivityRecordAdmin(recordId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activity-records-admin"] });
      queryClient.invalidateQueries({ queryKey: ["activity-records-timeline"] });
      setEditRecord(null);
      setEditError(null);
      setSnackbar("Giornata aggiornata");
    },
    onError: (err) => setEditError(err.message),
  });

  function handleSaveEdit(payload, validationError) {
    if (validationError) {
      setEditError(validationError);
      return;
    }
    setEditError(null);
    editMutation.mutate({ recordId: editRecord.id, payload });
  }

  function closeEdit() {
    setEditRecord(null);
    setEditError(null);
  }

  const employeesQuery = useQuery({
    queryKey: ["employees-activity-search"],
    queryFn: () => getEmployees("", []),
  });

  const mappingsQuery = useQuery({
    queryKey: ["mappings-activity-search"],
    queryFn: () => getInfinityBillingCustomerSupplierMap(),
  });

  const areasQuery = useQuery({
    // Senza `activeOnly`: un record può puntare a un'area disattivata e va
    // comunque risolta, altrimenti il salvataggio la azzererebbe.
    queryKey: ["operational-areas-activity-edit"],
    queryFn: () => getOperationalAreas(),
    staleTime: 1000 * 60 * 30,
    enabled: isAdmin,
  });

  const selectedEmployee = (employeesQuery.data ?? []).find((e) => e.id === filters.employeeId) ?? null;
  const selectedMapping = (mappingsQuery.data ?? []).find((m) => m.id === filters.mappingId) ?? null;

  const { data = [], isLoading, error } = useQuery({
    queryKey: ["activity-records-admin", filters],
    queryFn: () => getActivityRecordsAdmin({
      employeeId: filters.employeeId,
      mappingId: filters.mappingId,
      startDate: filters.startDate,
      endDate: filters.endDate,
      limit: 500,
    }),
  });

  // La timeline usa un dataset dedicato e più ampio, sempre senza filtro per
  // commessa: un'attività esclusa dalla tabella non deve diventare un falso
  // periodo Idle nella ricostruzione della giornata del dipendente.
  const timelineActivitiesQuery = useQuery({
    queryKey: ["activity-records-timeline", filters.employeeId, filters.startDate, filters.endDate],
    queryFn: () => getActivityRecordsAdmin({
      employeeId: filters.employeeId,
      startDate: filters.startDate,
      endDate: filters.endDate,
      limit: 2000,
    }),
    enabled: Boolean(filters.employeeId),
  });

  const timelinePresencesQuery = useQuery({
    queryKey: ["daily-records-timeline", filters.employeeId, filters.startDate, filters.endDate],
    queryFn: () => getDailyRecords({
      employeeId: filters.employeeId,
      startDate: filters.startDate,
      endDate: filters.endDate,
      limit: 500,
    }),
    enabled: Boolean(filters.employeeId),
  });

  function update(key, value) {
    setFilters((c) => ({ ...c, [key]: value }));
  }

  function updatePeriod({ start, end }) {
    setFilters((current) => ({ ...current, startDate: start, endDate: end }));
  }

  const fieldSearchTerm = fieldSearch.trim().toLowerCase();
  const filteredData = fieldSearchTerm
    ? data.filter((record) =>
        Object.entries(record.field_values ?? {}).some(([key, value]) =>
          `${key}: ${value}`.toLowerCase().includes(fieldSearchTerm),
        ),
      )
    : data;

  const totalHours = filteredData.reduce((sum, r) => sum + r.duration_seconds, 0) / 3600;
  const columns = timesheetListColumns(isAdmin);

  return (
    <Stack spacing={3}>
      {/* Header */}
      <PageHeader
        section="Rendicontazioni"
        title="Giornate"
        meta={filteredData.length ? `${filteredData.length} giornate` : undefined}
      />

      {/* Filters */}
      <ReportingPeriodFilter
        start={filters.startDate}
        end={filters.endDate}
        onChange={updatePeriod}
        gridTemplateColumns={{ xs: "1fr", sm: "1fr 1fr", md: "auto 1fr 1fr 1fr 1fr" }}
      >
          <Autocomplete
            options={employeesQuery.data ?? []}
            value={selectedEmployee}
            onChange={(_event, value) => update("employeeId", value?.id ?? "")}
            loading={employeesQuery.isLoading}
            getOptionLabel={(option) => option?.full_name ?? ""}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Dipendente"
                size="small"
                placeholder="Cerca per nome e cognome..."
              />
            )}
            noOptionsText="Nessun dipendente trovato"
            loadingText="Caricamento dipendenti..."
            fullWidth
          />
          <Autocomplete
            options={mappingsQuery.data ?? []}
            value={selectedMapping}
            onChange={(_event, value) => update("mappingId", value?.id ?? "")}
            loading={mappingsQuery.isLoading}
            getOptionLabel={(option) => option?.customer_supplier_description ?? ""}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Commessa"
                size="small"
                placeholder="Cerca per nome commessa..."
              />
            )}
            noOptionsText="Nessuna commessa trovata"
            loadingText="Caricamento commesse..."
            fullWidth
          />
          <TextField
            label="Campi extra"
            value={fieldSearch}
            onChange={(e) => setFieldSearch(e.target.value)}
            size="small"
            placeholder="Cerca nei campi extra..."
            sx={{ gridColumn: "1 / -1" }}
          />
      </ReportingPeriodFilter>

      {error && <Alert severity="error">{error.message}</Alert>}
      {timelineActivitiesQuery.error && <Alert severity="error">{timelineActivitiesQuery.error.message}</Alert>}
      {timelinePresencesQuery.error && <Alert severity="error">{timelinePresencesQuery.error.message}</Alert>}

      {selectedEmployee && (
        <EmployeeTimeline
          employee={selectedEmployee}
          activities={timelineActivitiesQuery.data ?? []}
          presences={timelinePresencesQuery.data ?? []}
          isLoading={isLoading || timelineActivitiesQuery.isLoading || timelinePresencesQuery.isLoading}
        />
      )}

      {/* Results table */}
      <Paper sx={{ borderRadius: 3, overflow: "hidden" }}>
        <Box sx={{ px: 3, py: 2, borderBottom: "1px solid rgba(226,226,229,0.9)", bgcolor: "#faf7f2" }}>
          {isLoading ? (
            <Skeleton width={200} height={28} />
          ) : (
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              {filteredData.length} attività · {fmtHoursHm(totalHours)} totali
            </Typography>
          )}
        </Box>

        {isLoading && (
          <Stack>
            {[1, 2, 3, 4, 5].map((i) => (
              <Box key={i} sx={{ px: 3, py: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
                <Skeleton height={32} />
              </Box>
            ))}
          </Stack>
        )}

        {!isLoading && filteredData.length === 0 && (
          <Box sx={{ py: 6, textAlign: "center" }}>
            <Typography variant="body2" color="text.disabled">
              Nessuna attività trovata per i filtri selezionati.
            </Typography>
          </Box>
        )}

        {!isLoading && filteredData.length > 0 && (
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small" sx={{ ...tableSx({ minWidth: 1020, dense: true }), ...stickyFirstColumnSx }}>
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
                {filteredData.map((record) => (
                  <ActivityRow
                    key={record.id}
                    record={record}
                    isAdmin={isAdmin}
                    onEdit={setEditRecord}
                    onDelete={setConfirmDelete}
                  />
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Paper>

      <EditActivityDialog
        record={editRecord}
        areas={areasQuery.data}
        areasLoading={areasQuery.isLoading}
        onClose={closeEdit}
        onSave={handleSaveEdit}
        isSaving={editMutation.isPending}
        error={editError}
      />

      <Dialog open={!!confirmDelete} onClose={() => !deleteMutation.isPending && setConfirmDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Elimina giornata</DialogTitle>
        <DialogContent>
          <Typography>
            Eliminare definitivamente la giornata di{" "}
            <strong>{confirmDelete?.employee_name || confirmDelete?.employee_id}</strong> del{" "}
            <strong>{fmtDate(confirmDelete?.started_at)}</strong>? L&apos;operazione non può essere annullata.
          </Typography>
          {deleteMutation.error && (
            <Alert severity="error" sx={{ mt: 2 }}>{deleteMutation.error.message}</Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)} disabled={deleteMutation.isPending}>Annulla</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => deleteMutation.mutate(confirmDelete.id)}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? <CircularProgress size={18} color="inherit" /> : "Elimina"}
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
