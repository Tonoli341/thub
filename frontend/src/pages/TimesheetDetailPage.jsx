import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { Link as RouterLink, useParams } from "react-router-dom";

import { approveTimesheet, getTimesheetDetail, manualUpdateTimesheet, requestTimesheetCorrection } from "../api";

function statusLabel(value) {
  const map = {
    COMPILED: "Compilata",
    CONFIRMED: "Confermata",
    APPROVED: "Fonte approvata",
    PENDING: "Da approvare",
    CORRECTION_REQUESTED: "Correzione richiesta",
    UNKNOWN: "Sconosciuto",
  };
  return map[value] ?? value ?? "-";
}

function emptySlot() {
  return {
    start_time: "",
    end_time: "",
    break_minutes: 0,
    project_code: "",
    project_description: "",
    cost_center_code: "",
    cost_center_description: "",
    notes: "",
  };
}

function formatTime(value) {
  return value ? value.slice(0, 5) : "";
}

function formatReference(code, label) {
  if (code && label && code !== label) {
    return `${code} - ${label}`;
  }
  return label || code || "-";
}

function AllocationTable({ title, rows }) {
  return (
    <Paper sx={{ p: 2.5, borderRadius: 3 }}>
      <Typography variant="h6" sx={{ fontWeight: 800, mb: 1.5 }}>{title}</Typography>
      {rows?.length ? (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Commessa</TableCell>
              <TableCell>Centro di costo</TableCell>
              <TableCell align="right">Minuti</TableCell>
              <TableCell align="right">Ore</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={`${title}-${index}`}>
                <TableCell>{formatReference(row.project_code, row.project_label)}</TableCell>
                <TableCell>{formatReference(row.cost_center_code, row.cost_center_label)}</TableCell>
                <TableCell align="right">{row.minutes}</TableCell>
                <TableCell align="right">{row.hours}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Typography color="text.secondary">Nessuna ripartizione disponibile.</Typography>
      )}
    </Paper>
  );
}

export default function TimesheetDetailPage() {
  const { dayId } = useParams();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(null);
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");

  const detailQuery = useQuery({
    queryKey: ["timesheet-detail", dayId],
    queryFn: () => getTimesheetDetail(dayId),
    enabled: Boolean(dayId),
  });

  useEffect(() => {
    if (!detailQuery.data) return;
    setForm({
      status: detailQuery.data.status || "COMPILED",
      check_in: formatTime(detailQuery.data.check_in),
      check_out: formatTime(detailQuery.data.check_out),
      break_minutes: detailQuery.data.break_minutes ?? 0,
      supervisor_note: detailQuery.data.supervisor_note ?? "",
      correction_note: detailQuery.data.correction_note ?? "",
      slots: detailQuery.data.slots?.length
        ? detailQuery.data.slots.map((slot) => ({
          start_time: formatTime(slot.start_time),
          end_time: formatTime(slot.end_time),
          break_minutes: slot.break_minutes ?? 0,
          project_code: slot.project_code ?? "",
          project_description: slot.project_description ?? "",
          cost_center_code: slot.cost_center_code ?? "",
          cost_center_description: slot.cost_center_description ?? "",
          notes: slot.notes ?? "",
        }))
        : [emptySlot()],
    });
  }, [detailQuery.data]);

  async function refreshAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["timesheet-detail", dayId] }),
      queryClient.invalidateQueries({ queryKey: ["timesheets-list"] }),
      queryClient.invalidateQueries({ queryKey: ["timesheets-dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["timesheets-admin-overview"] }),
      queryClient.invalidateQueries({ queryKey: ["timesheets-sync-runs"] }),
    ]);
  }

  const approveMutation = useMutation({
    mutationFn: () => approveTimesheet(dayId, { note: form?.supervisor_note || null }),
    onSuccess: async () => {
      setActionError("");
      setActionSuccess("Rendicontazione approvata.");
      await refreshAll();
    },
    onError: (error) => {
      setActionSuccess("");
      setActionError(error.message);
    },
  });

  const correctionMutation = useMutation({
    mutationFn: () => requestTimesheetCorrection(dayId, { note: form?.correction_note || "" }),
    onSuccess: async () => {
      setActionError("");
      setActionSuccess("Richiesta di correzione registrata.");
      await refreshAll();
    },
    onError: (error) => {
      setActionSuccess("");
      setActionError(error.message);
    },
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const slots = (form?.slots ?? []).filter((slot) => (
        slot.start_time || slot.end_time || slot.project_code || slot.cost_center_code || slot.notes || Number(slot.break_minutes) > 0
      ));
      return manualUpdateTimesheet(dayId, {
        status: form?.status,
        check_in: form?.check_in || null,
        check_out: form?.check_out || null,
        break_minutes: Number(form?.break_minutes ?? 0),
        supervisor_note: form?.supervisor_note || null,
        correction_note: form?.correction_note || null,
        slots: slots.map((slot) => ({
          start_time: slot.start_time || null,
          end_time: slot.end_time || null,
          break_minutes: Number(slot.break_minutes ?? 0),
          project_code: slot.project_code || null,
          project_description: slot.project_description || null,
          cost_center_code: slot.cost_center_code || null,
          cost_center_description: slot.cost_center_description || null,
          notes: slot.notes || null,
        })),
      });
    },
    onSuccess: async () => {
      setActionError("");
      setActionSuccess("Modifica manuale salvata.");
      await refreshAll();
    },
    onError: (error) => {
      setActionSuccess("");
      setActionError(error.message);
    },
  });

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateSlot(index, key, value) {
    setForm((current) => ({
      ...current,
      slots: current.slots.map((slot, slotIndex) => (slotIndex === index ? { ...slot, [key]: value } : slot)),
    }));
  }

  if (detailQuery.isLoading || !form) {
    return <CircularProgress />;
  }

  if (detailQuery.error) {
    return <Alert severity="error">{detailQuery.error.message}</Alert>;
  }

  const detail = detailQuery.data;
  const busy = approveMutation.isPending || correctionMutation.isPending || saveMutation.isPending;

  return (
    <Stack spacing={3}>
      <Paper sx={{ p: 3.5, borderRadius: 4, background: "linear-gradient(135deg, rgba(250,247,242,1), rgba(244,248,250,1))" }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2} justifyContent="space-between">
          <Box>
            <Typography variant="overline" sx={{ color: "#007040", fontWeight: 800 }}>Dettaglio rendicontazione</Typography>
            <Typography variant="h4">{detail.worker_name}</Typography>
            <Typography sx={{ mt: 1, color: "text.secondary" }}>
              {detail.department || "Reparto non indicato"} • {dayjs(detail.work_date).format("DD/MM/YYYY")}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <Button component={RouterLink} to="/rendicontazioni/elenco" variant="outlined">Torna elenco</Button>
            <Button variant="contained" color="success" onClick={() => approveMutation.mutate()} disabled={busy}>Approva</Button>
          </Stack>
        </Stack>
      </Paper>

      {(actionError || actionSuccess) && (
        <Alert severity={actionError ? "error" : "success"}>{actionError || actionSuccess}</Alert>
      )}

      <Paper sx={{ p: 3, borderRadius: 3 }}>
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "repeat(4, minmax(0, 1fr))" } }}>
          <Box>
            <Typography variant="caption" color="text.secondary">Operatore</Typography>
            <Typography sx={{ fontWeight: 700 }}>{detail.worker_name}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">ID locale</Typography>
            <Typography>{detail.worker_code || "-"}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Azienda</Typography>
            <Typography>{detail.company || "-"}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Ruolo</Typography>
            <Typography>{detail.role_name || "-"}</Typography>
          </Box>
        </Box>
        <Box sx={{ mt: 2 }}>
          <Typography variant="caption" color="text.secondary">Riferimento AWS</Typography>
          <Typography>{detail.worker_external_code || detail.worker_external_id}</Typography>
        </Box>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 2 }}>
          <Chip label={`Stato fonte: ${statusLabel(detail.status)}`} />
          <Chip label={`Approvazione: ${statusLabel(detail.approval_status)}`} color={detail.approval_status === "APPROVED" ? "success" : detail.approval_status === "CORRECTION_REQUESTED" ? "warning" : "default"} />
          <Chip label={`Ore totali: ${detail.total_hours}`} />
          <Chip label={detail.has_anomalies ? "Anomalie presenti" : "Nessuna anomalia"} color={detail.has_anomalies ? "warning" : "success"} />
        </Stack>
        {detail.anomaly_reasons?.length ? (
          <Alert severity="warning" sx={{ mt: 2 }}>{detail.anomaly_reasons.join(" • ")}</Alert>
        ) : null}
      </Paper>

      <Paper sx={{ p: 3, borderRadius: 3 }}>
        <Stack spacing={2.5}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>Correzione e approvazione</Typography>
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "repeat(4, minmax(0, 1fr))" } }}>
            <TextField select label="Stato fonte" value={form.status} onChange={(event) => updateField("status", event.target.value)}>
              {[
                { value: "COMPILED", label: "Compilata" },
                { value: "CONFIRMED", label: "Confermata" },
                { value: "APPROVED", label: "Fonte approvata" },
                { value: "UNKNOWN", label: "Sconosciuto" },
              ].map((item) => (
                <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>
              ))}
            </TextField>
            <TextField type="time" label="Entrata" value={form.check_in} onChange={(event) => updateField("check_in", event.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField type="time" label="Uscita" value={form.check_out} onChange={(event) => updateField("check_out", event.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField type="number" label="Pausa minuti" value={form.break_minutes} onChange={(event) => updateField("break_minutes", event.target.value)} inputProps={{ min: 0 }} />
          </Box>
          <TextField label="Note responsabile" value={form.supervisor_note} onChange={(event) => updateField("supervisor_note", event.target.value)} multiline minRows={2} />
          <TextField label="Nota correzione" value={form.correction_note} onChange={(event) => updateField("correction_note", event.target.value)} multiline minRows={2} />
          <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
            <Button variant="contained" onClick={() => saveMutation.mutate()} disabled={busy}>Salva modifica manuale</Button>
            <Button variant="outlined" color="warning" onClick={() => correctionMutation.mutate()} disabled={busy || !form.correction_note.trim()}>
              Richiedi correzione
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Paper sx={{ p: 3, borderRadius: 3 }}>
        <Stack spacing={2}>
          <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} justifyContent="space-between" alignItems={{ md: "center" }}>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>Fasce orarie</Typography>
            <Button variant="outlined" onClick={() => setForm((current) => ({ ...current, slots: [...current.slots, emptySlot()] }))}>Aggiungi fascia</Button>
          </Stack>
          <Divider />
          <Stack spacing={2}>
            {form.slots.map((slot, index) => (
              <Paper key={`slot-${index}`} variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
                <Stack spacing={2}>
                  <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                    <TextField type="time" label="Inizio" value={slot.start_time} onChange={(event) => updateSlot(index, "start_time", event.target.value)} InputLabelProps={{ shrink: true }} />
                    <TextField type="time" label="Fine" value={slot.end_time} onChange={(event) => updateSlot(index, "end_time", event.target.value)} InputLabelProps={{ shrink: true }} />
                    <TextField type="number" label="Pausa" value={slot.break_minutes} onChange={(event) => updateSlot(index, "break_minutes", event.target.value)} inputProps={{ min: 0 }} />
                    <Button color="error" onClick={() => setForm((current) => ({ ...current, slots: current.slots.filter((_, slotIndex) => slotIndex !== index) || [emptySlot()] }))}>
                      Rimuovi
                    </Button>
                  </Stack>
                  <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" } }}>
                    <TextField label="Commessa" value={slot.project_code} onChange={(event) => updateSlot(index, "project_code", event.target.value)} />
                    <TextField label="Descrizione commessa" value={slot.project_description} onChange={(event) => updateSlot(index, "project_description", event.target.value)} />
                    <TextField label="Centro di costo" value={slot.cost_center_code} onChange={(event) => updateSlot(index, "cost_center_code", event.target.value)} />
                    <TextField label="Descrizione centro di costo" value={slot.cost_center_description} onChange={(event) => updateSlot(index, "cost_center_description", event.target.value)} />
                  </Box>
                  <TextField label="Note fascia" value={slot.notes} onChange={(event) => updateSlot(index, "notes", event.target.value)} multiline minRows={2} />
                </Stack>
              </Paper>
            ))}
          </Stack>
        </Stack>
      </Paper>

      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", xl: "repeat(3, minmax(0, 1fr))" } }}>
        <AllocationTable title="Ripartizione giorno" rows={detail.day_allocations} />
        <AllocationTable title="Ripartizione settimana" rows={detail.week_allocations} />
        <AllocationTable title="Ripartizione mese" rows={detail.month_allocations} />
      </Box>
    </Stack>
  );
}
