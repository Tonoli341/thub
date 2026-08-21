import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";

import { getSystemStatus } from "../api";
import PageHeader from "../components/PageHeader";

const REFRESH_MS = 30000;

function formatBytes(value) {
  if (value == null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDuration(seconds) {
  if (seconds == null) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}g ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function usageColor(percent) {
  if (percent == null) return "info";
  if (percent >= 85) return "error";
  if (percent >= 70) return "warning";
  return "success";
}

function UsageCard({ title, percent, primary, secondary }) {
  const color = usageColor(percent);
  return (
    <Paper sx={{ p: 2.5, borderRadius: 3, flex: 1, minWidth: 240 }}>
      <Stack direction="row" alignItems="baseline" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography fontSize={14} fontWeight={700}>{title}</Typography>
        <Typography fontSize={22} fontWeight={700} color={percent != null && percent >= 85 ? "error.main" : "text.primary"}>
          {percent != null ? `${percent}%` : "—"}
        </Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={Math.min(percent ?? 0, 100)}
        color={color}
        sx={{ height: 8, borderRadius: 4, mb: 1.25 }}
      />
      <Typography fontSize={13} color="text.secondary">{primary}</Typography>
      {secondary && (
        <Typography fontSize={12} color="text.secondary" sx={{ mt: 0.25 }}>{secondary}</Typography>
      )}
    </Paper>
  );
}

function InfoItem({ label, value }) {
  return (
    <Box sx={{ minWidth: 130 }}>
      <Typography fontSize={12} color="text.secondary">{label}</Typography>
      <Typography fontSize={14} fontWeight={600}>{value}</Typography>
    </Box>
  );
}

export default function SystemStatusPage() {
  // Il monitoraggio vive solo dentro questa pagina: il polling parte al mount,
  // si ferma quando la finestra non è in primo piano e la cache viene scartata
  // all'uscita, così durante l'operatività normale il portale non fa alcuna
  // chiamata di stato.
  const statusQuery = useQuery({
    queryKey: ["system-status"],
    queryFn: getSystemStatus,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
    staleTime: REFRESH_MS,
    gcTime: 0,
  });

  const data = statusQuery.data;
  const db = data?.database;
  const dbOk = db?.status === "ok";

  return (
    <Box>
      <Box sx={{ mb: 2 }}>
        <PageHeader
          section="Configurazione"
          title="Stato sistema"
          meta={`Aggiornamento ogni ${REFRESH_MS / 1000}s mentre la pagina è aperta`}
        />
      </Box>

      {statusQuery.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {String(statusQuery.error?.message || "Errore di caricamento dello stato")}
        </Alert>
      )}

      {statusQuery.isLoading ? (
        <Box sx={{ py: 6, display: "grid", placeItems: "center" }}>
          <CircularProgress size={28} />
        </Box>
      ) : data && (
        <Stack spacing={2}>
          <Stack direction={{ xs: "column", md: "row" }} spacing={2} useFlexGap flexWrap="wrap">
            <UsageCard
              title="Disco"
              percent={data.disk?.percent}
              primary={`${formatBytes(data.disk?.used_bytes)} usati su ${formatBytes(data.disk?.total_bytes)}`}
              secondary={`${formatBytes(data.disk?.free_bytes)} liberi`}
            />
            <UsageCard
              title="Memoria"
              percent={data.memory?.percent}
              primary={`${formatBytes(data.memory?.used_bytes)} usati su ${formatBytes(data.memory?.total_bytes)}`}
              secondary={data.memory?.container
                ? `Container: ${formatBytes(data.memory.container.used_bytes)} su ${formatBytes(data.memory.container.limit_bytes)} (${data.memory.container.percent}%)`
                : `${formatBytes(data.memory?.available_bytes)} disponibili`}
            />
            <UsageCard
              title="CPU"
              percent={data.cpu?.percent}
              primary={`${data.cpu?.cores ?? "—"} core`}
              secondary={`Load average: ${(data.cpu?.load_avg ?? []).join(" / ") || "—"}`}
            />
          </Stack>

          <Paper sx={{ p: 2.5, borderRadius: 3 }}>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1.5 }}>
              <Typography fontSize={14} fontWeight={700}>Database</Typography>
              <Chip
                size="small"
                label={dbOk ? "Operativo" : "Errore"}
                color={dbOk ? "success" : "error"}
                variant="outlined"
              />
            </Stack>
            {dbOk ? (
              <Stack direction="row" spacing={4} useFlexGap flexWrap="wrap">
                <InfoItem label="Latenza" value={`${db.latency_ms} ms`} />
                <InfoItem label="Dimensione" value={formatBytes(db.size_bytes)} />
                <InfoItem label="Connessioni attive" value={db.connections ?? "—"} />
              </Stack>
            ) : (
              <Typography fontSize={13} color="error.main">{db?.detail || "Database non raggiungibile"}</Typography>
            )}
          </Paper>

          <Paper sx={{ p: 2.5, borderRadius: 3 }}>
            <Typography fontSize={14} fontWeight={700} sx={{ mb: 1.5 }}>Applicazione</Typography>
            <Stack direction="row" spacing={4} useFlexGap flexWrap="wrap">
              <InfoItem label="Ambiente" value={data.app?.env || "—"} />
              <InfoItem label="Uptime backend" value={formatDuration(data.app?.backend_uptime_seconds)} />
              <InfoItem label="Uptime server" value={formatDuration(data.app?.host_uptime_seconds)} />
              <InfoItem
                label="Ultimo controllo"
                value={data.checked_at ? new Date(data.checked_at).toLocaleTimeString("it-IT") : "—"}
              />
            </Stack>
            <Typography fontSize={12} color="text.secondary" sx={{ mt: 1.5 }}>
              Disco, memoria e CPU si riferiscono al server host su cui girano i container Docker del portale.
            </Typography>
          </Paper>
        </Stack>
      )}
    </Box>
  );
}
