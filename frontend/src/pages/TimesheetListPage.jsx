import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
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
import { useNavigate } from "react-router-dom";

import { approveTimesheet, exportTimesheetsCsv, getEmployeePhoto, getTimesheetFilters, getTimesheets } from "../api";

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

function WorkerAvatar({ employeeId, hasPhoto, name, size = 36 }) {
  const [photoUrl, setPhotoUrl] = useState(null);

  useEffect(() => {
    if (!hasPhoto || !employeeId) {
      setPhotoUrl(null);
      return undefined;
    }
    let isActive = true;
    let objectUrl = null;
    getEmployeePhoto(employeeId)
      .then((blob) => {
        if (!isActive) return;
        objectUrl = URL.createObjectURL(blob);
        setPhotoUrl(objectUrl);
      })
      .catch(() => { if (isActive) setPhotoUrl(null); });
    return () => {
      isActive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [employeeId, hasPhoto]);

  return (
    <Avatar src={photoUrl || undefined} alt={name} sx={{ width: size, height: size, bgcolor: "primary.main", fontWeight: 700, fontSize: size * 0.4 }}>
      {(name || "?").slice(0, 1).toUpperCase()}
    </Avatar>
  );
}

function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.URL.revokeObjectURL(url);
}

export default function TimesheetListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({
    start: dayjs().subtract(13, "day").format("YYYY-MM-DD"),
    end: dayjs().format("YYYY-MM-DD"),
    workerId: "",
    department: "",
    project: "",
    costCenter: "",
    status: "",
    approvalStatus: "",
    search: "",
  });
  const [exportError, setExportError] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const approveMutation = useMutation({
    mutationFn: (dayId) => approveTimesheet(dayId, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["timesheets-list"] }),
  });

  const filtersQuery = useQuery({
    queryKey: ["timesheets-filters", filters.start, filters.end],
    queryFn: () => getTimesheetFilters(filters.start, filters.end),
  });

  const listQuery = useQuery({
    queryKey: ["timesheets-list", filters],
    queryFn: () => getTimesheets(filters),
  });

  function updateField(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  async function handleExport() {
    setIsExporting(true);
    setExportError("");
    try {
      const blob = await exportTimesheetsCsv(filters);
      downloadBlob(blob, `timesheets-${filters.start || "all"}-${filters.end || "all"}.csv`);
    } catch (error) {
      setExportError(error.message);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <Stack spacing={3}>
      <Paper sx={{ p: 3.5, borderRadius: 4, background: "linear-gradient(135deg, rgba(0,112,64,0.96), rgba(0,80,46,0.92))", color: "#fff" }}>
        <Typography variant="overline" sx={{ opacity: 0.8 }}>Rendicontazioni</Typography>
        <Typography variant="h4">Giornate sincronizzate</Typography>
        <Typography sx={{ mt: 1, maxWidth: 760, opacity: 0.9 }}>
          Filtra per data, operatore, reparto, commessa, centro di costo e stato. L&apos;export CSV usa gli stessi filtri attivi.
        </Typography>
      </Paper>

      <Paper sx={{ p: 3, borderRadius: 3 }}>
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "repeat(3, minmax(0, 1fr))", xl: "repeat(5, minmax(0, 1fr))" } }}>
          <TextField type="date" label="Dal" value={filters.start} onChange={(event) => updateField("start", event.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField type="date" label="Al" value={filters.end} onChange={(event) => updateField("end", event.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField select label="Operatore" value={filters.workerId} onChange={(event) => updateField("workerId", event.target.value)}>
            <MenuItem value="">Tutti</MenuItem>
            {(filtersQuery.data?.workers ?? []).map((worker) => (
              <MenuItem key={worker.value} value={worker.value}>{worker.label}</MenuItem>
            ))}
          </TextField>
          <TextField select label="Reparto" value={filters.department} onChange={(event) => updateField("department", event.target.value)}>
            <MenuItem value="">Tutti</MenuItem>
            {(filtersQuery.data?.departments ?? []).map((department) => (
              <MenuItem key={department} value={department}>{department}</MenuItem>
            ))}
          </TextField>
          <TextField label="Ricerca" value={filters.search} onChange={(event) => updateField("search", event.target.value)} placeholder="Operatore, note, codici..." />
          <TextField select label="Commessa" value={filters.project} onChange={(event) => updateField("project", event.target.value)}>
            <MenuItem value="">Tutte</MenuItem>
            {(filtersQuery.data?.projects ?? []).map((project) => (
              <MenuItem key={project.value} value={project.value}>{project.label}</MenuItem>
            ))}
          </TextField>
          <TextField select label="Centro di costo" value={filters.costCenter} onChange={(event) => updateField("costCenter", event.target.value)}>
            <MenuItem value="">Tutti</MenuItem>
            {(filtersQuery.data?.cost_centers ?? []).map((costCenter) => (
              <MenuItem key={costCenter.value} value={costCenter.value}>{costCenter.label}</MenuItem>
            ))}
          </TextField>
          <TextField select label="Stato fonte" value={filters.status} onChange={(event) => updateField("status", event.target.value)}>
            <MenuItem value="">Tutti</MenuItem>
            {(filtersQuery.data?.statuses ?? []).map((status) => (
              <MenuItem key={status} value={status}>{statusLabel(status)}</MenuItem>
            ))}
          </TextField>
          <TextField select label="Approvazione" value={filters.approvalStatus} onChange={(event) => updateField("approvalStatus", event.target.value)}>
            <MenuItem value="">Tutte</MenuItem>
            {(filtersQuery.data?.approval_statuses ?? []).map((status) => (
              <MenuItem key={status} value={status}>{statusLabel(status)}</MenuItem>
            ))}
          </TextField>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ gridColumn: { xl: "span 1" }, alignItems: "stretch" }}>
            <Button variant="contained" onClick={handleExport} disabled={isExporting} sx={{ minHeight: 56 }}>
              {isExporting ? "Export..." : "Export CSV"}
            </Button>
            <Button variant="outlined" onClick={() => setFilters({ start: dayjs().subtract(13, "day").format("YYYY-MM-DD"), end: dayjs().format("YYYY-MM-DD"), workerId: "", department: "", project: "", costCenter: "", status: "", approvalStatus: "", search: "" })} sx={{ minHeight: 56 }}>
              Reset
            </Button>
          </Stack>
        </Box>
      </Paper>

      {exportError && <Alert severity="error">{exportError}</Alert>}
      {filtersQuery.error && <Alert severity="error">{filtersQuery.error.message}</Alert>}
      {listQuery.error && <Alert severity="error">{listQuery.error.message}</Alert>}
      {(filtersQuery.isLoading || listQuery.isLoading) && <CircularProgress />}

      <Paper sx={{ borderRadius: 3, overflow: "hidden" }}>
        <Box sx={{ px: 3, py: 2, borderBottom: "1px solid rgba(226,226,229,0.9)", bgcolor: "#faf7f2" }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>Risultati</Typography>
          <Typography color="text.secondary">{listQuery.data?.length ?? 0} giornate trovate</Typography>
        </Box>
        <Box sx={{ overflowX: "auto" }}>
          <Table sx={{ minWidth: 1120 }}>
            <TableHead>
              <TableRow>
                <TableCell>Operatore</TableCell>
                <TableCell>Reparto</TableCell>
                <TableCell>Data</TableCell>
                <TableCell>Entrata</TableCell>
                <TableCell>Uscita</TableCell>
                <TableCell>Ore</TableCell>
                <TableCell>Stato</TableCell>
                <TableCell>Approvazione</TableCell>
                <TableCell>Commesse</TableCell>
                <TableCell>Anomalie</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {(listQuery.data ?? []).map((row) => (
                <TableRow key={row.id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/rendicontazioni/giorni/${row.id}`)}>
                  <TableCell>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      <WorkerAvatar
                        employeeId={row.linked_employee_id}
                        hasPhoto={row.linked_employee_has_photo}
                        name={row.worker_name}
                      />
                      <Box>
                        <Typography sx={{ fontWeight: 700 }}>{row.worker_name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {row.worker_code ? `Matr. ${row.worker_code}` : "-"} • {row.manual_override ? "Modifica manuale" : "Sincronizzato"}
                        </Typography>
                      </Box>
                    </Stack>
                  </TableCell>
                  <TableCell>{row.department || "-"}</TableCell>
                  <TableCell>{dayjs(row.work_date).format("DD/MM/YYYY")}</TableCell>
                  <TableCell>{row.check_in ? row.check_in.slice(0, 5) : "-"}</TableCell>
                  <TableCell>{row.check_out ? row.check_out.slice(0, 5) : "-"}</TableCell>
                  <TableCell>{row.total_hours}</TableCell>
                  <TableCell><Chip size="small" label={statusLabel(row.status)} /></TableCell>
                  <TableCell><Chip size="small" color={row.approval_status === "APPROVED" ? "success" : row.approval_status === "CORRECTION_REQUESTED" ? "warning" : "default"} label={statusLabel(row.approval_status)} /></TableCell>
                  <TableCell>{row.projects?.length ? row.projects.join(", ") : "-"}</TableCell>
                  <TableCell>{row.anomaly_reasons?.length ? row.anomaly_reasons.join(", ") : "-"}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                    {row.approval_status === "PENDING" && (
                      <Button
                        size="small"
                        variant="contained"
                        color="success"
                        disabled={approveMutation.isPending}
                        onClick={(event) => { event.stopPropagation(); approveMutation.mutate(row.id); }}
                      >
                        Approva
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Paper>
    </Stack>
  );
}
