import dayjs from "dayjs";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  ButtonGroup,
  CircularProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useNavigate } from "react-router-dom";

import { getTimesheetStats } from "../api";

const PRESETS = [
  { label: "Questa settimana", start: () => dayjs().startOf("isoWeek").format("YYYY-MM-DD"), end: () => dayjs().format("YYYY-MM-DD") },
  { label: "Questo mese", start: () => dayjs().startOf("month").format("YYYY-MM-DD"), end: () => dayjs().format("YYYY-MM-DD") },
  { label: "Mese scorso", start: () => dayjs().subtract(1, "month").startOf("month").format("YYYY-MM-DD"), end: () => dayjs().subtract(1, "month").endOf("month").format("YYYY-MM-DD") },
  { label: "Ultimi 90 giorni", start: () => dayjs().subtract(89, "day").format("YYYY-MM-DD"), end: () => dayjs().format("YYYY-MM-DD") },
];

function KpiCard({ label, value, sub, accent }) {
  return (
    <Paper sx={{ p: 2.5, borderRadius: 3, border: `1px solid ${accent}28` }}>
      <Typography sx={{ color: accent, fontWeight: 800, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</Typography>
      <Typography variant="h4" sx={{ mt: 0.75, fontWeight: 800 }}>{value ?? 0}</Typography>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </Paper>
  );
}

function HoursBar({ hours, maxHours }) {
  const pct = maxHours > 0 ? Math.min((hours / maxHours) * 100, 100) : 0;
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, minWidth: 160 }}>
      <Box sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: "rgba(0,112,64,0.1)", overflow: "hidden" }}>
        <Box sx={{ width: `${pct}%`, height: "100%", borderRadius: 3, bgcolor: "#007040", transition: "width 0.4s ease" }} />
      </Box>
      <Typography sx={{ fontSize: 13, fontWeight: 700, minWidth: 48, textAlign: "right" }}>{hours.toFixed(1)}h</Typography>
    </Box>
  );
}

export default function TimesheetDashboardPage() {
  const navigate = useNavigate();
  const today = dayjs().format("YYYY-MM-DD");
  const [activePreset, setActivePreset] = useState(1);
  const [range, setRange] = useState({
    start: dayjs().startOf("month").format("YYYY-MM-DD"),
    end: today,
  });

  function applyPreset(index) {
    setActivePreset(index);
    setRange({ start: PRESETS[index].start(), end: PRESETS[index].end() });
  }

  const { data, isLoading, error } = useQuery({
    queryKey: ["timesheets-stats", range.start, range.end],
    queryFn: () => getTimesheetStats(range.start, range.end),
  });

  const maxProjectHours = data?.hours_by_project?.[0]?.hours ?? 0;
  const maxWorkerHours = data?.hours_by_worker?.[0]?.hours ?? 0;

  return (
    <Stack spacing={3}>
      <Paper sx={{ p: 3.5, borderRadius: 4, background: "linear-gradient(135deg, rgba(0,112,64,0.96), rgba(0,80,46,0.92))", color: "#fff" }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2} justifyContent="space-between" alignItems={{ md: "flex-start" }}>
          <Box>
            <Typography variant="overline" sx={{ opacity: 0.8 }}>Dashboard rendicontazioni</Typography>
            <Typography variant="h4">Ore per commessa</Typography>
            <Typography sx={{ mt: 1, maxWidth: 680, opacity: 0.9 }}>
              Riepilogo ore lavorate per commessa e per risorsa nel periodo selezionato.
            </Typography>
          </Box>
          <Box>
            <ButtonGroup size="small" sx={{ bgcolor: "rgba(255,255,255,0.12)", borderRadius: 2, flexWrap: "wrap" }}>
              {PRESETS.map((preset, index) => (
                <Button
                  key={preset.label}
                  onClick={() => applyPreset(index)}
                  sx={{
                    color: activePreset === index ? "#fff" : "rgba(255,255,255,0.7)",
                    bgcolor: activePreset === index ? "rgba(255,255,255,0.18)" : "transparent",
                    borderColor: "rgba(255,255,255,0.2) !important",
                    fontWeight: activePreset === index ? 700 : 400,
                    fontSize: 13,
                    whiteSpace: "nowrap",
                    "&:hover": { bgcolor: "rgba(255,255,255,0.15)" },
                  }}
                >
                  {preset.label}
                </Button>
              ))}
            </ButtonGroup>
            <Typography variant="caption" sx={{ display: "block", mt: 1, opacity: 0.7, textAlign: "right" }}>
              {dayjs(range.start).format("DD/MM/YYYY")} – {dayjs(range.end).format("DD/MM/YYYY")}
            </Typography>
          </Box>
        </Stack>
      </Paper>

      {error && <Alert severity="error">{error.message}</Alert>}
      {isLoading && <CircularProgress />}

      {data && (
        <>
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(3, 1fr)", xl: "repeat(5, 1fr)" } }}>
            <KpiCard label="Ore totali" value={`${data.total_hours.toFixed(1)}h`} accent="#007040" />
            <KpiCard label="Commesse" value={data.project_count} sub="con ore rendicontate" accent="#335c67" />
            <KpiCard label="Risorse" value={data.worker_count} sub="operatori attivi" accent="#6c757d" />
            <KpiCard label="Da approvare" value={data.pending_count} sub="giornate in attesa" accent="#d97706" />
            <KpiCard label="Anomalie" value={data.anomaly_count} accent="#bc4749" />
          </Box>

          <Paper sx={{ borderRadius: 3, overflow: "hidden" }}>
            <Box sx={{ px: 3, py: 2, bgcolor: "#faf7f2", borderBottom: "1px solid rgba(226,226,229,0.9)" }}>
              <Stack direction={{ xs: "column", md: "row" }} spacing={1} justifyContent="space-between" alignItems={{ md: "center" }}>
                <Box>
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>Ore per commessa</Typography>
                  <Typography color="text.secondary">{data.hours_by_project.length} commesse · {data.total_hours.toFixed(1)}h totali</Typography>
                </Box>
                <Button variant="outlined" size="small" onClick={() => navigate("/rendicontazioni/elenco")}>Vai all&apos;elenco</Button>
              </Stack>
            </Box>
            <Box sx={{ overflowX: "auto" }}>
              <Table sx={{ minWidth: 640 }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: 40 }}>#</TableCell>
                    <TableCell>Commessa</TableCell>
                    <TableCell align="right">Risorse</TableCell>
                    <TableCell align="right">Giornate</TableCell>
                    <TableCell sx={{ minWidth: 220 }}>Ore</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.hours_by_project.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} sx={{ py: 3, textAlign: "center", color: "text.secondary" }}>
                        Nessuna commessa trovata nel periodo selezionato.
                      </TableCell>
                    </TableRow>
                  )}
                  {data.hours_by_project.map((item, index) => (
                    <TableRow key={item.project_key} hover>
                      <TableCell sx={{ color: "text.secondary", fontWeight: 600 }}>{index + 1}</TableCell>
                      <TableCell>
                        <Typography sx={{ fontWeight: 700 }}>{item.project_label}</Typography>
                        <Typography variant="caption" color="text.secondary">{item.project_key}</Typography>
                      </TableCell>
                      <TableCell align="right">{item.worker_count}</TableCell>
                      <TableCell align="right">{item.day_count}</TableCell>
                      <TableCell>
                        <HoursBar hours={item.hours} maxHours={maxProjectHours} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Paper>

          <Paper sx={{ borderRadius: 3, overflow: "hidden" }}>
            <Box sx={{ px: 3, py: 2, bgcolor: "#faf7f2", borderBottom: "1px solid rgba(226,226,229,0.9)" }}>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>Ore per risorsa</Typography>
              <Typography color="text.secondary">{data.hours_by_worker.length} operatori nel periodo</Typography>
            </Box>
            <Box sx={{ overflowX: "auto" }}>
              <Table sx={{ minWidth: 700 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Operatore</TableCell>
                    <TableCell>Reparto</TableCell>
                    <TableCell>Commesse principali</TableCell>
                    <TableCell sx={{ minWidth: 220 }}>Ore</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.hours_by_worker.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} sx={{ py: 3, textAlign: "center", color: "text.secondary" }}>
                        Nessun operatore trovato nel periodo selezionato.
                      </TableCell>
                    </TableRow>
                  )}
                  {data.hours_by_worker.map((worker) => (
                    <TableRow key={worker.worker_id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/rendicontazioni/elenco?workerId=${worker.worker_id}`)}>
                      <TableCell>
                        <Typography sx={{ fontWeight: 700 }}>{worker.worker_name}</Typography>
                        {worker.worker_code && (
                          <Typography variant="caption" color="text.secondary">Matr. {worker.worker_code}</Typography>
                        )}
                      </TableCell>
                      <TableCell>{worker.department || "-"}</TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                          {worker.top_projects.slice(0, 3).map((p) => (
                            <Box key={p.key} sx={{ px: 1, py: 0.25, borderRadius: 1, bgcolor: "rgba(0,112,64,0.08)", fontSize: 11, fontWeight: 600, color: "#007040", whiteSpace: "nowrap" }}>
                              {p.label} · {p.hours.toFixed(1)}h
                            </Box>
                          ))}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <HoursBar hours={worker.hours} maxHours={maxWorkerHours} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Paper>
        </>
      )}
    </Stack>
  );
}
