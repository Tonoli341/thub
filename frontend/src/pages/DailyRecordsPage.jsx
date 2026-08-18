import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Autocomplete,
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
  TextField,
  Typography,
} from "@mui/material";

import { deleteDailyRecordAdmin, getDailyRecords, getEmployees, getOperationalAreas, updateDailyRecordAdmin } from "../api";
import { useAuth } from "../auth";
import { reportingBuildingCodes } from "../buildings";
import ReportingPeriodFilter from "../components/ReportingPeriodFilter";

function fmtDate(value) {
  return value ? dayjs(value).format("DD/MM/YYYY") : "—";
}

function fmtTime(value) {
  return value ? dayjs(value).format("HH:mm") : "—";
}

function fmtDuration(seconds) {
  if (seconds == null) return "—";
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function timeToMinutes(value) {
  if (!value) return null;
  const [hours, minutes] = String(value).split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return (hours * 60) + minutes;
}

function getExpectedWorkSeconds(schedule, dateValue) {
  if (!schedule || schedule.length !== 7 || !dateValue) return null;
  const scheduleIdx = (dayjs(dateValue).day() + 6) % 7;
  const day = schedule[scheduleIdx];
  if (!day?.enabled) return 0;

  const startMinutes = timeToMinutes(day.start);
  const endMinutes = timeToMinutes(day.end);
  if (startMinutes == null || endMinutes == null || endMinutes <= startMinutes) return null;

  const breakMinutes = Math.max(Number(day.break_minutes ?? 0), 0);
  return Math.max(((endMinutes - startMinutes) - breakMinutes) * 60, 0);
}

function PauseChips({ pauses }) {
  if (!pauses?.length) {
    return <Typography variant="caption" color="text.disabled">Nessuna</Typography>;
  }
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
      {pauses.map((pause, index) => (
        <Chip
          key={`${pause.started_at}-${pause.ended_at}-${index}`}
          size="small"
          variant="outlined"
          label={`${fmtTime(pause.started_at)} - ${fmtTime(pause.ended_at)}`}
          sx={{ fontSize: "0.7rem", height: 22, fontFamily: "monospace" }}
        />
      ))}
    </Stack>
  );
}

// Ricava inizio/fine e il tempo di lavoro NETTO (= lordo − pausa) dal form. Il
// lordo è fine − inizio (turni a cavallo della mezzanotte: la fine cade il
// giorno successivo); la pausa è espressa in minuti nel form.
function computeTimes(form) {
  const startedAt = dayjs(`${form.date}T${form.startTime}`);
  let endedAt = dayjs(`${form.date}T${form.endTime}`);
  if (endedAt.isValid() && startedAt.isValid() && !endedAt.isAfter(startedAt)) {
    endedAt = endedAt.add(1, "day");
  }
  const valid = startedAt.isValid() && endedAt.isValid();
  const grossSeconds = valid ? endedAt.diff(startedAt, "second") : null;

  // Le pause portano solo l'ora: le ancoriamo al turno, che può scavalcare la
  // mezzanotte (una pausa prima dell'inizio cade il giorno dopo).
  const pauses = (form.pauses ?? []).map((pause) => {
    let from = dayjs(`${form.date}T${pause.startTime}`);
    let to = dayjs(`${form.date}T${pause.endTime}`);
    if (from.isValid() && startedAt.isValid() && from.isBefore(startedAt)) from = from.add(1, "day");
    if (to.isValid() && from.isValid() && !to.isAfter(from)) to = to.add(1, "day");
    return { from, to, valid: from.isValid() && to.isValid() };
  });

  const pausesValid = pauses.every((pause) => pause.valid);
  const pauseSeconds = pausesValid
    ? pauses.reduce((sum, pause) => sum + pause.to.diff(pause.from, "second"), 0)
    : 0;
  const workSeconds = grossSeconds != null ? grossSeconds - pauseSeconds : null;

  return { startedAt, endedAt, grossSeconds, pauses, pausesValid, pauseSeconds, workSeconds, valid };
}

// Codici immobile selezionabili per l'area scelta. Il codice già salvato sul
// record resta in elenco anche se l'area non lo prevede più, così una modifica
// di orario non costringe a cambiare anche l'immobile.
function buildingOptions(area, current) {
  const codes = reportingBuildingCodes(area?.buildings);
  return current && !codes.includes(current) ? [...codes, current] : codes;
}

function EditDailyRecordDialog({ record, areas, areasLoading, onClose, onSave, isSaving, error }) {
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (!record) {
      setForm(null);
      return;
    }
    const start = dayjs(record.started_at);
    const end = record.ended_at ? dayjs(record.ended_at) : start;
    setForm({
      date: dayjs(record.date).format("YYYY-MM-DD"),
      startTime: start.format("HH:mm"),
      endTime: end.format("HH:mm"),
      pauses: (record.pauses ?? []).map((pause) => ({
        startTime: dayjs(pause.started_at).format("HH:mm"),
        endTime: dayjs(pause.ended_at).format("HH:mm"),
      })),
      areaId: record.operational_area_id ?? "",
      building: record.building ?? "",
    });
  }, [record]);

  const selectedArea = (areas ?? []).find((a) => a.id === form?.areaId) ?? null;
  const buildingChoices = buildingOptions(selectedArea, form?.building);

  function setField(key, value) {
    setForm((c) => ({ ...c, [key]: value }));
  }

  function setPause(index, key, value) {
    setForm((c) => ({
      ...c,
      pauses: c.pauses.map((pause, i) => (i === index ? { ...pause, [key]: value } : pause)),
    }));
  }

  function addPause() {
    setForm((c) => ({ ...c, pauses: [...c.pauses, { startTime: "", endTime: "" }] }));
  }

  function removePause(index) {
    setForm((c) => ({ ...c, pauses: c.pauses.filter((_, i) => i !== index) }));
  }

  const times = form ? computeTimes(form) : null;

  function handleSave() {
    const { startedAt, endedAt, grossSeconds, pauses, pausesValid, pauseSeconds, workSeconds, valid } =
      computeTimes(form);
    if (!valid) {
      onSave(null, "Data o orari non validi.");
      return;
    }
    if (!pausesValid) {
      onSave(null, "Compila gli orari di tutte le pause (Da e A).");
      return;
    }
    if (pauses.some((pause) => pause.to.isAfter(endedAt))) {
      onSave(null, "Le pause devono essere comprese tra l'inizio e la fine della giornata.");
      return;
    }
    if (pauseSeconds >= grossSeconds) {
      onSave(null, "Le pause non possono coprire l'intera giornata.");
      return;
    }
    if (workSeconds == null || workSeconds < 60) {
      onSave(null, "Tempo di lavoro non valido (minimo 00:01).");
      return;
    }
    // `pause_seconds` e `work_seconds` li ricalcola il backend dagli intervalli.
    onSave({
      date: form.date,
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      pauses: pauses.map((pause) => ({
        started_at: pause.from.toISOString(),
        ended_at: pause.to.toISOString(),
      })),
      operational_area_id: form.areaId || null,
      building: form.building || null,
    });
  }

  return (
    <Dialog open={!!record} onClose={() => !isSaving && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle>Modifica presenza</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {record?.employee_name || record?.employee_id}
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
              label="Tempo pausa (hh:mm)"
              value={times?.pausesValid ? fmtDuration(times.pauseSeconds) : "—"}
              InputLabelProps={{ shrink: true }}
              InputProps={{ readOnly: true }}
              size="small"
              disabled
              helperText="Somma delle pause"
            />
            <TextField
              label="Tempo lavoro (hh:mm)"
              value={times?.workSeconds != null && times.workSeconds > 0 ? fmtDuration(times.workSeconds) : "—"}
              InputLabelProps={{ shrink: true }}
              InputProps={{ readOnly: true }}
              size="small"
              disabled
              helperText="Inizio → fine, al netto delle pause"
            />
          </Box>
        )}

        {form && (
          <Box sx={{ mt: 3 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Pause</Typography>
              <Button size="small" onClick={addPause}>+ Aggiungi pausa</Button>
            </Stack>
            {form.pauses.length === 0 ? (
              <Typography variant="body2" color="text.disabled">
                Nessuna pausa registrata.
              </Typography>
            ) : (
              <Stack spacing={1.5}>
                {form.pauses.map((pause, index) => (
                  <Stack key={index} direction="row" spacing={1.5} alignItems="center">
                    <TextField
                      type="time"
                      label="Da"
                      value={pause.startTime}
                      onChange={(e) => setPause(index, "startTime", e.target.value)}
                      InputLabelProps={{ shrink: true }}
                      size="small"
                      fullWidth
                    />
                    <TextField
                      type="time"
                      label="A"
                      value={pause.endTime}
                      onChange={(e) => setPause(index, "endTime", e.target.value)}
                      InputLabelProps={{ shrink: true }}
                      size="small"
                      fullWidth
                    />
                    <Button
                      size="small"
                      color="error"
                      onClick={() => removePause(index)}
                      sx={{ minWidth: 0, px: 1.5, flexShrink: 0 }}
                    >
                      Rimuovi
                    </Button>
                  </Stack>
                ))}
              </Stack>
            )}
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

export default function DailyRecordsPage() {
  const queryClient = useQueryClient();
  const { effectiveUser } = useAuth();
  const isAdmin = effectiveUser?.effective_role === "admin";

  const [confirmDelete, setConfirmDelete] = useState(null);
  const [editRecord, setEditRecord] = useState(null);
  const [editError, setEditError] = useState(null);
  const [snackbar, setSnackbar] = useState(null);

  const [filters, setFilters] = useState(() => {
    const today = dayjs().format("YYYY-MM-DD");
    return { startDate: today, endDate: today, employee: null };
  });

  const employeesQuery = useQuery({
    queryKey: ["employees-presence-search"],
    queryFn: () => getEmployees("", []),
  });

  const areasQuery = useQuery({
    // Senza `activeOnly`: un record può puntare a un'area disattivata e va
    // comunque risolta, altrimenti il salvataggio la azzererebbe.
    queryKey: ["operational-areas-daily-edit"],
    queryFn: () => getOperationalAreas(),
    staleTime: 1000 * 60 * 30,
    enabled: isAdmin,
  });

  const deleteMutation = useMutation({
    mutationFn: (recordId) => deleteDailyRecordAdmin(recordId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["daily-records"] });
      setConfirmDelete(null);
      setSnackbar("Presenza eliminata");
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ recordId, payload }) => updateDailyRecordAdmin(recordId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["daily-records"] });
      setEditRecord(null);
      setEditError(null);
      setSnackbar("Presenza aggiornata");
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

  const { data = [], isLoading, error } = useQuery({
    queryKey: ["daily-records", filters],
    queryFn: () => getDailyRecords({
      employeeId: filters.employee?.id ?? "",
      startDate: filters.startDate,
      endDate: filters.endDate,
      limit: 500,
    }),
  });

  const employeesById = Object.fromEntries((employeesQuery.data ?? []).map((employee) => [employee.id, employee]));

  const rows = data.map((row) => {
    const employee = employeesById[row.employee_id];
    const expectedWorkSeconds = getExpectedWorkSeconds(employee?.default_schedule, row.date);
    const overtimeSeconds = expectedWorkSeconds == null || row.work_seconds == null
      ? null
      : Math.max(row.work_seconds - expectedWorkSeconds, 0);
    return {
      ...row,
      employee_name: employee?.full_name ?? row.employee_name ?? row.employee_id,
      expected_work_seconds: expectedWorkSeconds,
      overtime_seconds: overtimeSeconds,
    };
  });

  const totalWorkSeconds = rows.reduce((sum, row) => sum + (row.work_seconds ?? 0), 0);
  const totalOvertimeSeconds = rows.reduce((sum, row) => sum + (row.overtime_seconds ?? 0), 0);

  function update(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function updatePeriod({ start, end }) {
    setFilters((current) => ({ ...current, startDate: start, endDate: end }));
  }

  return (
    <Stack spacing={3}>
      <Paper sx={{ p: 3.5, borderRadius: 4, background: "linear-gradient(135deg, rgba(0,112,64,0.96), rgba(0,80,46,0.92))", color: "#fff" }}>
        <Typography variant="overline" sx={{ opacity: 0.8 }}>Rendicontazioni</Typography>
        <Typography variant="h4">Presenze</Typography>
        <Typography sx={{ mt: 0.5, maxWidth: 680, opacity: 0.9, fontSize: "0.95rem" }}>
          Elenco delle giornate registrate dal client presenze con orari di inizio, fine, pause e monte ore dichiarato.
        </Typography>
      </Paper>

      <ReportingPeriodFilter
        start={filters.startDate}
        end={filters.endDate}
        onChange={updatePeriod}
        gridTemplateColumns={{ xs: "1fr", sm: "1fr 1fr", md: "auto 1fr 1fr 1fr" }}
      >
          <Autocomplete
            options={employeesQuery.data ?? []}
            value={filters.employee}
            onChange={(_event, value) => update("employee", value)}
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
      </ReportingPeriodFilter>

      {employeesQuery.error && (
        <Alert severity="error">{employeesQuery.error.message}</Alert>
      )}

      {error && <Alert severity="error">{error.message}</Alert>}

      <Paper sx={{ borderRadius: 3, overflow: "hidden" }}>
        <Box sx={{ px: 3, py: 2, borderBottom: "1px solid rgba(226,226,229,0.9)", bgcolor: "#faf7f2" }}>
          {isLoading ? (
            <Skeleton width={260} height={28} />
          ) : (
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              {rows.length} presenze · {fmtDuration(totalWorkSeconds)} lavorate · {fmtDuration(totalOvertimeSeconds)} straordinario
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

        {!isLoading && rows.length === 0 && (
          <Box sx={{ py: 6, textAlign: "center" }}>
            <Typography variant="body2" color="text.disabled">
              Nessuna presenza trovata per i filtri selezionati.
            </Typography>
          </Box>
        )}

        {!isLoading && rows.length > 0 && (
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small" sx={{ minWidth: 1260 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Dipendente</TableCell>
                  <TableCell>Data</TableCell>
                  <TableCell>Inizio</TableCell>
                  <TableCell>Fine</TableCell>
                  <TableCell>Area</TableCell>
                  <TableCell>Immobile</TableCell>
                  <TableCell>Pause</TableCell>
                  <TableCell>Tempo pausa</TableCell>
                  <TableCell>Tempo standard</TableCell>
                  <TableCell>Tempo lavoro</TableCell>
                  <TableCell>Straordinario</TableCell>
                  <TableCell>Creato il</TableCell>
                  {isAdmin && <TableCell>Azioni Admin</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={700} noWrap>
                        {row.employee_name}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>{fmtDate(row.date)}</Typography>
                    </TableCell>
                    <TableCell>{fmtTime(row.started_at)}</TableCell>
                    <TableCell>{fmtTime(row.ended_at)}</TableCell>
                    <TableCell>
                      {row.operational_area_name ? (
                        <Chip
                          label={row.operational_area_name}
                          size="small"
                          sx={{ bgcolor: "rgba(0,112,64,0.08)", color: "primary.main", fontWeight: 700, fontSize: "0.72rem" }}
                        />
                      ) : (
                        <Typography variant="caption" color="text.disabled">—</Typography>
                      )}
                    </TableCell>
                    <TableCell>{row.building || "—"}</TableCell>
                    <TableCell sx={{ minWidth: 220 }}>
                      <PauseChips pauses={row.pauses} />
                    </TableCell>
                    <TableCell>{fmtDuration(row.pause_seconds)}</TableCell>
                    <TableCell>{fmtDuration(row.expected_work_seconds)}</TableCell>
                    <TableCell>
                      <Chip
                        label={fmtDuration(row.work_seconds)}
                        size="small"
                        sx={{ bgcolor: "rgba(0,112,64,0.08)", color: "primary.main", fontWeight: 700, fontSize: "0.72rem" }}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={fmtDuration(row.overtime_seconds)}
                        size="small"
                        sx={{
                          bgcolor: row.overtime_seconds ? "rgba(245,158,11,0.14)" : "rgba(148,163,184,0.14)",
                          color: row.overtime_seconds ? "#b45309" : "text.secondary",
                          fontWeight: 700,
                          fontSize: "0.72rem",
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {fmtDate(row.created_at)} {fmtTime(row.created_at)}
                      </Typography>
                    </TableCell>
                    {isAdmin && (
                      <TableCell>
                        <Stack direction="row" spacing={1}>
                          <Button size="small" variant="outlined" startIcon={<span aria-hidden="true">✏️</span>} onClick={() => setEditRecord(row)}>
                            Modifica
                          </Button>
                          <Button size="small" variant="outlined" color="error" startIcon={<span aria-hidden="true">🗑️</span>} onClick={() => setConfirmDelete(row)}>
                            Elimina
                          </Button>
                        </Stack>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Paper>

      <EditDailyRecordDialog
        record={editRecord}
        areas={areasQuery.data}
        areasLoading={areasQuery.isLoading}
        onClose={closeEdit}
        onSave={handleSaveEdit}
        isSaving={editMutation.isPending}
        error={editError}
      />

      <Dialog open={!!confirmDelete} onClose={() => !deleteMutation.isPending && setConfirmDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Elimina presenza</DialogTitle>
        <DialogContent>
          <Typography>
            Eliminare definitivamente la presenza di{" "}
            <strong>{confirmDelete?.employee_name || confirmDelete?.employee_id}</strong> del{" "}
            <strong>{fmtDate(confirmDelete?.date)}</strong>? L&apos;operazione non può essere annullata.
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
