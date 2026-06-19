import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Collapse,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";

import {
  deleteTimesheetWorker,
  getEmployeeOptions,
  getLocalProjects,
  getOperationalAreas,
  getTimesheetAdminOverview,
  getTimesheetCostCenters,
  getTimesheetProjects,
  getTimesheetSyncRuns,
  getTimesheetWorkers,
  runTimesheetManualSync,
  updateTimesheetCostCenterLink,
  updateTimesheetProjectLink,
  updateTimesheetWorkerEmployeeLink,
} from "../api";

function OverviewCard({ label, value, accent }) {
  return (
    <Paper sx={{ p: 2.5, borderRadius: 3, border: `1px solid ${accent}30` }}>
      <Typography sx={{ color: accent, fontSize: 12, fontWeight: 800, textTransform: "uppercase" }}>{label}</Typography>
      <Typography variant="h4" sx={{ mt: 1, fontWeight: 800 }}>{value ?? 0}</Typography>
    </Paper>
  );
}

function LinkStatus({ linked, linkedLabel, emptyLabel }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      {linked ? (
        <Typography component="span" sx={{ color: "#1f9d55", fontSize: 20, lineHeight: 1 }} title={linkedLabel}>
          🔗
        </Typography>
      ) : null}
      <Typography>{linked ? linkedLabel : emptyLabel}</Typography>
    </Stack>
  );
}

function WorkerLinkRow({ worker, employeeOptions, isSaving, onSave }) {
  const [selectedTmsEmployeeId, setSelectedTmsEmployeeId] = useState(worker.tms_employee_id || worker.suggested_employee_id || "");

  useEffect(() => {
    setSelectedTmsEmployeeId(worker.tms_employee_id || worker.suggested_employee_id || "");
  }, [worker.tms_employee_id, worker.suggested_employee_id]);

  return (
    <TableRow sx={!worker.is_active ? { backgroundColor: "rgba(188, 71, 73, 0.06)" } : undefined}>
      <TableCell>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography sx={{ fontWeight: 700 }}>{worker.full_name}</Typography>
          {worker.is_linked_to_employee ? (
            <Typography component="span" sx={{ color: "#1f9d55", fontSize: 20, lineHeight: 1 }} title="Collegato a dipendente locale">
              🔗
            </Typography>
          ) : null}
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {worker.department || "-"}{worker.company ? ` • ${worker.company}` : ""}
        </Typography>
      </TableCell>
      <TableCell>
        <Typography sx={{ fontWeight: 700 }}>{worker.external_code || worker.external_id}</Typography>
        {worker.external_code && worker.external_code !== worker.external_id ? (
          <Typography variant="caption" color="text.secondary">
            ID AWS: {worker.external_id}
          </Typography>
        ) : null}
      </TableCell>
      <TableCell sx={{ minWidth: 380 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ xs: "stretch", md: "center" }}>
          <Select
            size="small"
            fullWidth
            value={selectedTmsEmployeeId}
            onChange={(event) => setSelectedTmsEmployeeId(event.target.value)}
          >
            <MenuItem value="">Nessun collegamento</MenuItem>
            {employeeOptions.map((option) => (
              <MenuItem key={option.id} value={option.id}>
                {option.full_name} ({option.tms_id})
              </MenuItem>
            ))}
          </Select>
          <Button variant="outlined" onClick={() => onSave("save", worker.id, selectedTmsEmployeeId)} disabled={isSaving}>
            Salva
          </Button>
          <Button variant="text" color="inherit" onClick={() => onSave("unlink", worker.id, "")} disabled={isSaving || !worker.tms_employee_id}>
            Scollega
          </Button>
          <Button variant="text" color="error" onClick={() => onSave("delete", worker.id, "")} disabled={isSaving}>
            Elimina
          </Button>
        </Stack>
        {worker.tms_employee_name ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
            Collegato a: {worker.tms_employee_name} ({worker.tms_employee_tms_id})
          </Typography>
        ) : null}
        {!worker.tms_employee_id && worker.suggested_employee_name ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
            Suggerito da matricola: {worker.suggested_employee_name} ({worker.suggested_employee_tms_id})
          </Typography>
        ) : null}
      </TableCell>
      <TableCell>
        {!worker.is_active ? "Non piu esistente su AWS" : worker.is_linked_to_employee ? "Collegato" : "Da collegare"}
      </TableCell>
      <TableCell>{worker.last_synced_at ? new Date(worker.last_synced_at).toLocaleString("it-IT") : "-"}</TableCell>
    </TableRow>
  );
}

export default function TimesheetAdminPage() {
  const queryClient = useQueryClient();
  const [workerSearch, setWorkerSearch] = useState("");
  const [projectDrafts, setProjectDrafts] = useState({});
  const [costCenterDrafts, setCostCenterDrafts] = useState({});
  const [syncHistoryOpen, setSyncHistoryOpen] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", message: "" });

  const overviewQuery = useQuery({
    queryKey: ["timesheets-admin-overview"],
    queryFn: () => getTimesheetAdminOverview(),
  });

  const syncRunsQuery = useQuery({
    queryKey: ["timesheets-sync-runs"],
    queryFn: () => getTimesheetSyncRuns(),
  });

  const workersQuery = useQuery({
    queryKey: ["timesheets-worker-links", workerSearch],
    queryFn: () => getTimesheetWorkers(workerSearch),
  });

  const employeeOptionsQuery = useQuery({
    queryKey: ["employee-options", "timesheets-admin"],
    queryFn: getEmployeeOptions,
  });

  const projectsQuery = useQuery({
    queryKey: ["timesheets-projects"],
    queryFn: getTimesheetProjects,
  });

  const localProjectsQuery = useQuery({
    queryKey: ["local-projects", "timesheets-admin", "active-only"],
    queryFn: () => getLocalProjects({ activeOnly: true }),
  });

  const costCentersQuery = useQuery({
    queryKey: ["timesheets-cost-centers"],
    queryFn: getTimesheetCostCenters,
  });

  const operationalAreasQuery = useQuery({
    queryKey: ["operational-areas", "timesheets-admin", "operational-only"],
    queryFn: () => getOperationalAreas({ activeOnly: true, operationalOnly: true }),
  });

  useEffect(() => {
    const nextDrafts = {};
    for (const item of projectsQuery.data ?? []) {
      nextDrafts[item.external_key] = item.local_project_id ?? "";
    }
    setProjectDrafts(nextDrafts);
  }, [projectsQuery.data]);

  useEffect(() => {
    const nextDrafts = {};
    for (const item of costCentersQuery.data ?? []) {
      nextDrafts[item.external_key] = item.operational_area_code ?? "";
    }
    setCostCenterDrafts(nextDrafts);
  }, [costCentersQuery.data]);

  async function refreshAdmin() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["timesheets-admin-overview"] }),
      queryClient.invalidateQueries({ queryKey: ["timesheets-sync-runs"] }),
      queryClient.invalidateQueries({ queryKey: ["timesheets-projects"] }),
      queryClient.invalidateQueries({ queryKey: ["timesheets-worker-links"] }),
      queryClient.invalidateQueries({ queryKey: ["timesheets-cost-centers"] }),
      queryClient.invalidateQueries({ queryKey: ["timesheets-dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["timesheets-list"] }),
    ]);
  }

  const syncMutation = useMutation({
    mutationFn: () => runTimesheetManualSync(),
    onSuccess: async () => {
      setFeedback({ type: "success", message: "Sync manuale completata." });
      await refreshAdmin();
    },
    onError: (error) => setFeedback({ type: "error", message: error.message }),
  });

  const linkMutation = useMutation({
    mutationFn: ({ workerId, tmsEmployeeId }) => updateTimesheetWorkerEmployeeLink(workerId, { tms_employee_id: tmsEmployeeId || null }),
    onSuccess: async () => {
      setFeedback({ type: "success", message: "Collegamento operatore aggiornato." });
      await refreshAdmin();
    },
    onError: (error) => setFeedback({ type: "error", message: error.message }),
  });

  const costCenterMutation = useMutation({
    mutationFn: ({ externalKey, operationalAreaCode }) => updateTimesheetCostCenterLink(externalKey, { operational_area_code: operationalAreaCode || null }),
    onSuccess: async () => {
      setFeedback({ type: "success", message: "Centro di costo aggiornato." });
      await refreshAdmin();
    },
    onError: (error) => setFeedback({ type: "error", message: error.message }),
  });

  const deleteWorkerMutation = useMutation({
    mutationFn: (workerId) => deleteTimesheetWorker(workerId),
    onSuccess: async () => {
      setFeedback({ type: "success", message: "Operatore AWS eliminato." });
      await refreshAdmin();
    },
    onError: (error) => setFeedback({ type: "error", message: error.message }),
  });

  const projectMutation = useMutation({
    mutationFn: ({ externalKey, localProjectId }) => updateTimesheetProjectLink(externalKey, { local_project_id: localProjectId || null }),
    onSuccess: async () => {
      setFeedback({ type: "success", message: "Commessa aggiornata." });
      await refreshAdmin();
    },
    onError: (error) => setFeedback({ type: "error", message: error.message }),
  });

  const busy = syncMutation.isPending || linkMutation.isPending || projectMutation.isPending || costCenterMutation.isPending || deleteWorkerMutation.isPending;

  return (
    <Stack spacing={3}>
      <Paper sx={{ p: 3.5, borderRadius: 4, background: "linear-gradient(135deg, rgba(0,112,64,0.96), rgba(0,80,46,0.92))", color: "#fff" }}>
        <Typography variant="overline" sx={{ opacity: 0.8 }}>Area admin</Typography>
        <Typography variant="h4">Supervisione sistema e sync AWS</Typography>
        <Typography sx={{ mt: 1, maxWidth: 780, opacity: 0.9 }}>
          Controllo stato del servizio, sincronizzazioni manuali e collegamento operatori AWS ai dipendenti locali tramite matricola.
        </Typography>
      </Paper>

      {feedback.message ? <Alert severity={feedback.type || "info"}>{feedback.message}</Alert> : null}
      {overviewQuery.error ? <Alert severity="error">{overviewQuery.error.message}</Alert> : null}
      {syncRunsQuery.error ? <Alert severity="error">{syncRunsQuery.error.message}</Alert> : null}
      {workersQuery.error ? <Alert severity="error">{workersQuery.error.message}</Alert> : null}
      {employeeOptionsQuery.error ? <Alert severity="error">{employeeOptionsQuery.error.message}</Alert> : null}
      {projectsQuery.error ? <Alert severity="error">{projectsQuery.error.message}</Alert> : null}
      {localProjectsQuery.error ? <Alert severity="error">{localProjectsQuery.error.message}</Alert> : null}
      {costCentersQuery.error ? <Alert severity="error">{costCentersQuery.error.message}</Alert> : null}
      {operationalAreasQuery.error ? <Alert severity="error">{operationalAreasQuery.error.message}</Alert> : null}
      {(overviewQuery.isLoading || syncRunsQuery.isLoading || workersQuery.isLoading || employeeOptionsQuery.isLoading || projectsQuery.isLoading || localProjectsQuery.isLoading || costCentersQuery.isLoading || operationalAreasQuery.isLoading) ? <CircularProgress /> : null}

      {overviewQuery.data ? (
        <>
          {!overviewQuery.data.sync_configured ? <Alert severity="warning">Configurazione AWS non completa nel file .env.</Alert> : null}

          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", xl: "repeat(5, 1fr)" } }}>
            <OverviewCard label="Worker attivi" value={overviewQuery.data.active_workers} accent="#007040" />
            <OverviewCard label="Giornate locali" value={overviewQuery.data.total_days} accent="#335c67" />
            <OverviewCard label="Da approvare" value={overviewQuery.data.pending_approvals} accent="#d97706" />
            <OverviewCard label="Anomalie" value={overviewQuery.data.anomaly_days} accent="#bc4749" />
            <OverviewCard label={`Scheduler · ogni ${overviewQuery.data.sync_interval_minutes} min`} value={overviewQuery.data.scheduler_running ? "ON" : "OFF"} accent="#4f772d" />
          </Box>

          <Paper sx={{ p: 3, borderRadius: 3 }}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2} justifyContent="space-between" alignItems={{ md: "center" }}>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>Controllo sync</Typography>
                <Typography color="text.secondary">
                  Ultima sync: {overviewQuery.data.last_sync?.finished_at || overviewQuery.data.last_sync?.started_at || "mai"}
                </Typography>
              </Box>
              <Button variant="contained" onClick={() => syncMutation.mutate()} disabled={busy || !overviewQuery.data.sync_configured}>
                {syncMutation.isPending ? "Sync..." : "Esegui sync manuale"}
              </Button>
            </Stack>
            <Stack direction="row" spacing={3} useFlexGap flexWrap="wrap" sx={{ mt: 2.5 }}>
              <Typography>Operatori AWS da collegare: <strong>{overviewQuery.data.unmapped_workers}</strong></Typography>
              <Typography>Commesse non mappate: <strong>{overviewQuery.data.unmapped_projects}</strong></Typography>
              <Typography>Centri costo non mappati: <strong>{overviewQuery.data.unmapped_cost_centers}</strong></Typography>
            </Stack>
          </Paper>

          <Paper sx={{ p: 3, borderRadius: 3 }}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2} justifyContent="space-between" alignItems={{ md: "center" }}>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>Collegamento operatori AWS</Typography>
                <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                  Ogni operatore AWS va collegato al dipendente locale di Organizzazione tramite ID Matricola.
                </Typography>
              </Box>
              <TextField
                label="Cerca operatore AWS"
                value={workerSearch}
                onChange={(event) => setWorkerSearch(event.target.value)}
                sx={{ minWidth: { md: 280 } }}
              />
            </Stack>
            <Box sx={{ overflowX: "auto", mt: 2 }}>
              <Table sx={{ minWidth: 1180 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Operatore AWS</TableCell>
                    <TableCell>Matricola / ID AWS</TableCell>
                    <TableCell>Dipendente locale</TableCell>
                    <TableCell>Stato</TableCell>
                    <TableCell>Ultima sync</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(workersQuery.data ?? []).map((worker) => (
                    <WorkerLinkRow
                      key={worker.id}
                      worker={worker}
                      employeeOptions={employeeOptionsQuery.data ?? []}
                      isSaving={linkMutation.isPending}
                      onSave={(action, workerId, tmsEmployeeId) => {
                        if (action === "delete") {
                          deleteWorkerMutation.mutate(workerId);
                          return;
                        }
                        linkMutation.mutate({ workerId, tmsEmployeeId });
                      }}
                    />
                  ))}
                  {!workersQuery.isLoading && !workersQuery.data?.length ? (
                    <TableRow>
                      <TableCell colSpan={5}>Nessun operatore AWS disponibile.</TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </Box>
          </Paper>

          <Paper sx={{ p: 3, borderRadius: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>Mapping commesse</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              Ogni commessa AWS va collegata a una commessa locale definita nella sezione Impresa &gt; Commesse.
            </Typography>
            <Box sx={{ overflowX: "auto", mt: 2 }}>
              <Table sx={{ minWidth: 1080 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Commessa AWS</TableCell>
                    <TableCell>Descrizione AWS</TableCell>
                    <TableCell>Commessa locale</TableCell>
                    <TableCell>Stato</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(projectsQuery.data ?? []).map((item) => (
                    <TableRow key={item.external_key}>
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography sx={{ fontWeight: 700 }}>{item.external_key}</Typography>
                          {item.is_mapped ? (
                            <Typography component="span" sx={{ color: "#1f9d55", fontSize: 20, lineHeight: 1 }} title="Collegato a commessa locale">
                              🔗
                            </Typography>
                          ) : null}
                        </Stack>
                      </TableCell>
                      <TableCell>{item.external_label || "-"}</TableCell>
                      <TableCell sx={{ minWidth: 380 }}>
                        <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ xs: "stretch", md: "center" }}>
                          <Select
                            size="small"
                            fullWidth
                            value={projectDrafts[item.external_key] ?? ""}
                            onChange={(event) => setProjectDrafts((current) => ({ ...current, [item.external_key]: event.target.value }))}
                          >
                            <MenuItem value="">Nessun collegamento</MenuItem>
                            {(localProjectsQuery.data ?? []).map((project) => (
                              <MenuItem key={project.id} value={project.id}>
                                {project.project_code} - {project.name}
                              </MenuItem>
                            ))}
                          </Select>
                          <Button variant="outlined" onClick={() => projectMutation.mutate({ externalKey: item.external_key, localProjectId: projectDrafts[item.external_key] ?? "" })} disabled={busy}>
                            Salva
                          </Button>
                          <Button variant="text" color="inherit" onClick={() => projectMutation.mutate({ externalKey: item.external_key, localProjectId: "" })} disabled={busy || !item.is_mapped}>
                            Scollega
                          </Button>
                        </Stack>
                        {item.is_mapped ? (
                          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
                            Collegato a: {item.local_project_code} - {item.local_project_name}
                          </Typography>
                        ) : null}
                      </TableCell>
                      <TableCell>{item.is_mapped ? "Collegato" : "Da collegare"}</TableCell>
                    </TableRow>
                  ))}
                  {!projectsQuery.isLoading && !projectsQuery.data?.length ? (
                    <TableRow>
                      <TableCell colSpan={4}>Nessuna commessa AWS disponibile.</TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </Box>
          </Paper>

          <Paper sx={{ p: 3, borderRadius: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>Mapping centri di costo</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              Ogni centro di costo AWS va collegato a un&apos;Area Operativa locale usando il Codice area come identificativo.
            </Typography>
            <Box sx={{ overflowX: "auto", mt: 2 }}>
              <Table sx={{ minWidth: 1080 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Centro di costo AWS</TableCell>
                    <TableCell>Descrizione AWS</TableCell>
                    <TableCell>Area Operativa locale</TableCell>
                    <TableCell>Stato</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(costCentersQuery.data ?? []).map((item) => (
                    <TableRow key={item.external_key}>
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography sx={{ fontWeight: 700 }}>{item.external_key}</Typography>
                          {item.is_mapped ? (
                            <Typography component="span" sx={{ color: "#1f9d55", fontSize: 20, lineHeight: 1 }} title="Collegato ad area operativa locale">
                              🔗
                            </Typography>
                          ) : null}
                        </Stack>
                      </TableCell>
                      <TableCell>{item.external_label || "-"}</TableCell>
                      <TableCell sx={{ minWidth: 380 }}>
                        <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ xs: "stretch", md: "center" }}>
                          <Select
                            size="small"
                            fullWidth
                            value={costCenterDrafts[item.external_key] ?? ""}
                            onChange={(event) => setCostCenterDrafts((current) => ({ ...current, [item.external_key]: event.target.value }))}
                          >
                            <MenuItem value="">Nessun collegamento</MenuItem>
                            {(operationalAreasQuery.data ?? []).map((area) => (
                              <MenuItem key={area.id} value={area.area_code}>
                                {area.area_code} - {area.name}
                              </MenuItem>
                            ))}
                          </Select>
                          <Button variant="outlined" onClick={() => costCenterMutation.mutate({ externalKey: item.external_key, operationalAreaCode: costCenterDrafts[item.external_key] ?? "" })} disabled={busy}>
                            Salva
                          </Button>
                          <Button variant="text" color="inherit" onClick={() => costCenterMutation.mutate({ externalKey: item.external_key, operationalAreaCode: "" })} disabled={busy || !item.is_mapped}>
                            Scollega
                          </Button>
                        </Stack>
                        {item.is_mapped ? (
                          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
                            Collegato a: {item.operational_area_code} - {item.operational_area_name}
                          </Typography>
                        ) : null}
                      </TableCell>
                      <TableCell>{item.is_mapped ? "Collegato" : "Da collegare"}</TableCell>
                    </TableRow>
                  ))}
                  {!costCentersQuery.isLoading && !costCentersQuery.data?.length ? (
                    <TableRow>
                      <TableCell colSpan={4}>Nessun centro di costo AWS disponibile.</TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </Box>
          </Paper>

          <Paper sx={{ p: 3, borderRadius: 3 }}>
            <Button
              onClick={() => setSyncHistoryOpen((prev) => !prev)}
              sx={{ width: "100%", justifyContent: "space-between", px: 0, py: 0, textTransform: "none", color: "inherit", "&:hover": { background: "transparent" } }}
              disableRipple
            >
              <Typography variant="h6" sx={{ fontWeight: 800 }}>Storico sync</Typography>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>{syncHistoryOpen ? "Nascondi ▲" : "Mostra ▼"}</Typography>
            </Button>
            <Collapse in={syncHistoryOpen}>
              <Table size="small" sx={{ mt: 2 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Avvio</TableCell>
                    <TableCell>Origine</TableCell>
                    <TableCell>Stato</TableCell>
                    <TableCell align="right">Utenti</TableCell>
                    <TableCell align="right">Giornate</TableCell>
                    <TableCell align="right">Errori</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(syncRunsQuery.data ?? []).map((run) => (
                    <TableRow key={run.id}>
                      <TableCell>{run.started_at}</TableCell>
                      <TableCell>{run.trigger_source}</TableCell>
                      <TableCell>{run.status}</TableCell>
                      <TableCell align="right">{run.users_upserted} / {run.users_read}</TableCell>
                      <TableCell align="right">{run.timesheets_upserted} / {run.timesheets_read}</TableCell>
                      <TableCell align="right">{run.errors_count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Collapse>
          </Paper>
        </>
      ) : null}
    </Stack>
  );
}
