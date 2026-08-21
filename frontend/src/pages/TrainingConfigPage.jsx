import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import FilterBar from "../components/FilterBar";
import FilterSelect from "../components/FilterSelect";
import PageHeader from "../components/PageHeader";
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
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { useMemo, useState } from "react";

import {
  createTrainingCourse,
  createTrainingMacroArea,
  deleteTrainingCourse,
  deleteTrainingMacroArea,
  downloadTrainingHoursReport,
  getEmployeeOptions,
  getTrainingCourses,
  getTrainingHoursReport,
  getTrainingMacroAreas,
  updateTrainingCourse,
  updateTrainingMacroArea,
} from "../api";

function monthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

export default function TrainingConfigPage() {
  const [tab, setTab] = useState("config");
  const [snackbar, setSnackbar] = useState(null);

  return (
    <>
      <Stack spacing={3}>
        <PageHeader section="Configurazione" title="Formazione" />

        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          <Tab value="config" label="Corsi & Macro aree" />
          <Tab value="report" label="Report ore" />
        </Tabs>

        {tab === "config" ? (
          <ConfigTab onNotify={setSnackbar} />
        ) : (
          <ReportTab onNotify={setSnackbar} />
        )}
      </Stack>

      <Snackbar
        open={Boolean(snackbar)}
        autoHideDuration={4000}
        onClose={() => setSnackbar(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity={snackbar?.severity ?? "success"}
          onClose={() => setSnackbar(null)}
          variant="filled"
        >
          {snackbar?.message}
        </Alert>
      </Snackbar>
    </>
  );
}

// ── Tab configurazione ────────────────────────────────────────────────────
function ConfigTab({ onNotify }) {
  const queryClient = useQueryClient();
  const [macroDialog, setMacroDialog] = useState(null);
  const [courseDialog, setCourseDialog] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [showInactive, setShowInactive] = useState(false);

  const macroQuery = useQuery({ queryKey: ["training-macro-areas"], queryFn: () => getTrainingMacroAreas() });
  const coursesQuery = useQuery({ queryKey: ["training-courses"], queryFn: () => getTrainingCourses() });

  const macroAreas = macroQuery.data ?? [];
  const courses = coursesQuery.data ?? [];

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["training-macro-areas"] });
    queryClient.invalidateQueries({ queryKey: ["training-courses"] });
  };
  const onError = (err) => onNotify({ message: err.message, severity: "error" });

  const macroCreate = useMutation({ mutationFn: createTrainingMacroArea, onSuccess: () => { invalidateAll(); setMacroDialog(null); onNotify({ message: "Macro area creata" }); }, onError });
  const macroUpdate = useMutation({ mutationFn: ({ id, payload }) => updateTrainingMacroArea(id, payload), onSuccess: () => { invalidateAll(); setMacroDialog(null); onNotify({ message: "Macro area aggiornata" }); }, onError });
  const macroDelete = useMutation({ mutationFn: deleteTrainingMacroArea, onSuccess: () => { invalidateAll(); setConfirmDelete(null); onNotify({ message: "Macro area eliminata" }); }, onError });

  const courseCreate = useMutation({ mutationFn: createTrainingCourse, onSuccess: () => { invalidateAll(); setCourseDialog(null); onNotify({ message: "Corso creato" }); }, onError });
  const courseUpdate = useMutation({ mutationFn: ({ id, payload }) => updateTrainingCourse(id, payload), onSuccess: () => { invalidateAll(); setCourseDialog(null); onNotify({ message: "Corso aggiornato" }); }, onError });
  const courseDelete = useMutation({ mutationFn: deleteTrainingCourse, onSuccess: () => { invalidateAll(); setConfirmDelete(null); onNotify({ message: "Corso eliminato" }); }, onError });

  const visibleMacro = macroAreas.filter((m) => showInactive || m.is_active);
  const visibleCourses = courses.filter((c) => showInactive || c.is_active);

  return (
    <>
      <FormControlLabel
        control={<Switch checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />}
        label="Mostra disattivati"
      />

      <Stack direction={{ xs: "column", md: "row" }} spacing={3} alignItems="flex-start">
        {/* Macro aree */}
        <Paper sx={{ p: 2.5, borderRadius: 3, flex: 1, width: "100%" }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1.5}>
            <Typography variant="h6">Macro aree</Typography>
            <Button size="small" variant="outlined" onClick={() => setMacroDialog({ mode: "create", form: { name: "", is_active: true } })}>+ Nuova</Button>
          </Stack>
          {macroQuery.isLoading ? <CircularProgress size={24} /> : (
            <Stack divider={<Box sx={{ borderBottom: "1px solid var(--mui-palette-divider, #eee)" }} />}>
              {visibleMacro.length === 0 && <Typography color="text.secondary" variant="body2">Nessuna macro area.</Typography>}
              {visibleMacro.map((m) => (
                <Stack key={m.id} direction="row" alignItems="center" justifyContent="space-between" py={1}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography sx={{ fontWeight: 500, opacity: m.is_active ? 1 : 0.5 }}>{m.name}</Typography>
                    {!m.is_active && <Chip label="Disattiva" size="small" />}
                  </Stack>
                  <Stack direction="row" spacing={0.5}>
                    <Switch size="small" checked={m.is_active} onChange={() => macroUpdate.mutate({ id: m.id, payload: { is_active: !m.is_active } })} />
                    <IconButton size="small" onClick={() => setMacroDialog({ mode: "edit", id: m.id, form: { name: m.name, is_active: m.is_active } })}>✏️</IconButton>
                    <IconButton size="small" onClick={() => setConfirmDelete({ kind: "macro", id: m.id, label: m.name })}>🗑️</IconButton>
                  </Stack>
                </Stack>
              ))}
            </Stack>
          )}
        </Paper>

        {/* Corsi */}
        <Paper sx={{ p: 2.5, borderRadius: 3, flex: 1.4, width: "100%" }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1.5}>
            <Typography variant="h6">Titoli corsi</Typography>
            <Button size="small" variant="outlined" onClick={() => setCourseDialog({ mode: "create", form: { title: "", macro_area_id: "", is_active: true } })}>+ Nuovo</Button>
          </Stack>
          {coursesQuery.isLoading ? <CircularProgress size={24} /> : (
            <Stack divider={<Box sx={{ borderBottom: "1px solid var(--mui-palette-divider, #eee)" }} />}>
              {visibleCourses.length === 0 && <Typography color="text.secondary" variant="body2">Nessun corso.</Typography>}
              {visibleCourses.map((c) => (
                <Stack key={c.id} direction="row" alignItems="center" justifyContent="space-between" py={1}>
                  <Box sx={{ opacity: c.is_active ? 1 : 0.5 }}>
                    <Typography sx={{ fontWeight: 500 }}>{c.title}</Typography>
                    <Typography variant="caption" color="text.secondary">{c.macro_area_name || "— nessuna macro area"}</Typography>
                  </Box>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Switch size="small" checked={c.is_active} onChange={() => courseUpdate.mutate({ id: c.id, payload: { is_active: !c.is_active } })} />
                    <IconButton size="small" onClick={() => setCourseDialog({ mode: "edit", id: c.id, form: { title: c.title, macro_area_id: c.macro_area_id || "", is_active: c.is_active } })}>✏️</IconButton>
                    <IconButton size="small" onClick={() => setConfirmDelete({ kind: "course", id: c.id, label: c.title })}>🗑️</IconButton>
                  </Stack>
                </Stack>
              ))}
            </Stack>
          )}
        </Paper>
      </Stack>

      {/* Dialog macro area */}
      <Dialog open={Boolean(macroDialog)} onClose={() => setMacroDialog(null)} fullWidth maxWidth="xs">
        <DialogTitle>{macroDialog?.mode === "create" ? "Nuova macro area" : "Modifica macro area"}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Nome"
            margin="normal"
            value={macroDialog?.form.name ?? ""}
            onChange={(e) => setMacroDialog((s) => ({ ...s, form: { ...s.form, name: e.target.value } }))}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMacroDialog(null)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!macroDialog?.form.name.trim() || macroCreate.isPending || macroUpdate.isPending}
            onClick={() => {
              const payload = { name: macroDialog.form.name.trim() };
              if (macroDialog.mode === "create") macroCreate.mutate({ ...payload, is_active: true });
              else macroUpdate.mutate({ id: macroDialog.id, payload });
            }}
          >
            Salva
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog corso */}
      <Dialog open={Boolean(courseDialog)} onClose={() => setCourseDialog(null)} fullWidth maxWidth="xs">
        <DialogTitle>{courseDialog?.mode === "create" ? "Nuovo corso" : "Modifica corso"}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Titolo corso"
            margin="normal"
            value={courseDialog?.form.title ?? ""}
            onChange={(e) => setCourseDialog((s) => ({ ...s, form: { ...s.form, title: e.target.value } }))}
          />
          <TextField
            select
            fullWidth
            label="Macro area"
            margin="normal"
            value={courseDialog?.form.macro_area_id ?? ""}
            onChange={(e) => setCourseDialog((s) => ({ ...s, form: { ...s.form, macro_area_id: e.target.value } }))}
          >
            <MenuItem value="">— nessuna —</MenuItem>
            {macroAreas.filter((m) => m.is_active || m.id === courseDialog?.form.macro_area_id).map((m) => (
              <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCourseDialog(null)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!courseDialog?.form.title.trim() || courseCreate.isPending || courseUpdate.isPending}
            onClick={() => {
              const payload = {
                title: courseDialog.form.title.trim(),
                macro_area_id: courseDialog.form.macro_area_id || null,
              };
              if (courseDialog.mode === "create") courseCreate.mutate({ ...payload, is_active: true });
              else courseUpdate.mutate({ id: courseDialog.id, payload });
            }}
          >
            Salva
          </Button>
        </DialogActions>
      </Dialog>

      {/* Conferma eliminazione */}
      <Dialog open={Boolean(confirmDelete)} onClose={() => setConfirmDelete(null)}>
        <DialogTitle>Conferma eliminazione</DialogTitle>
        <DialogContent>
          <Typography>Eliminare «{confirmDelete?.label}»? L'operazione non è reversibile.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>Annulla</Button>
          <Button
            color="error"
            variant="contained"
            disabled={macroDelete.isPending || courseDelete.isPending}
            onClick={() => {
              if (confirmDelete.kind === "macro") macroDelete.mutate(confirmDelete.id);
              else courseDelete.mutate(confirmDelete.id);
            }}
          >
            Elimina
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// ── Tab report ────────────────────────────────────────────────────────────
function ReportTab({ onNotify }) {
  const defaults = useMemo(monthRange, []);
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);
  const [employeeId, setEmployeeId] = useState("");
  const [downloading, setDownloading] = useState(false);

  const employeesQuery = useQuery({ queryKey: ["employee-options"], queryFn: () => getEmployeeOptions() });
  const reportQuery = useQuery({
    queryKey: ["training-report", start, end, employeeId],
    queryFn: () => getTrainingHoursReport(start, end, employeeId),
    enabled: Boolean(start && end),
  });

  const report = reportQuery.data;
  const employees = employeesQuery.data ?? [];

  async function handleExport() {
    setDownloading(true);
    try {
      await downloadTrainingHoursReport(start, end, employeeId);
    } catch (err) {
      onNotify({ message: err.message, severity: "error" });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Paper sx={{ p: 2.5, borderRadius: 3 }}>
      <Box sx={{ mb: 2 }}>
        <FilterBar>
          <TextField type="date" label="Dal" size="small" InputLabelProps={{ shrink: true }} value={start} onChange={(e) => setStart(e.target.value)} />
          <TextField type="date" label="Al" size="small" InputLabelProps={{ shrink: true }} value={end} onChange={(e) => setEnd(e.target.value)} />
          <FilterSelect
            label="Dipendente"
            value={employeeId}
            onChange={setEmployeeId}
            options={employees.map((emp) => ({ value: emp.id, label: emp.full_name }))}
            placeholder="Tutti"
          />
          <Box sx={{ flex: 1 }} />
          <Button variant="outlined" size="small" onClick={handleExport} disabled={downloading || !report?.rows?.length}>
            {downloading ? "Esporto…" : "Esporta CSV"}
          </Button>
        </FilterBar>
      </Box>

      {reportQuery.isLoading ? (
        <CircularProgress size={24} />
      ) : reportQuery.isError ? (
        <Alert severity="error">{reportQuery.error.message}</Alert>
      ) : (
        <>
          <Stack direction="row" spacing={1} alignItems="baseline" mb={1.5}>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>{(report?.total_hours ?? 0).toLocaleString("it-IT")}</Typography>
            <Typography color="text.secondary">ore di formazione totali nel periodo</Typography>
          </Stack>
          <TableContainer sx={{ overflowX: "auto" }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Dipendente</TableCell>
                  <TableCell>Corso</TableCell>
                  <TableCell>Macro area</TableCell>
                  <TableCell align="right">Ore</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(report?.rows ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={4}><Typography color="text.secondary" variant="body2">Nessuna ora di formazione registrata nel periodo.</Typography></TableCell></TableRow>
                )}
                {(report?.rows ?? []).map((row, idx) => (
                  <TableRow key={`${row.employee_id}-${row.training_course_id ?? idx}`}>
                    <TableCell>{row.employee_name}</TableCell>
                    <TableCell>{row.course_title || <em>(nessun corso)</em>}</TableCell>
                    <TableCell>{row.macro_area_name || "—"}</TableCell>
                    <TableCell align="right">{row.hours.toLocaleString("it-IT")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Paper>
  );
}
