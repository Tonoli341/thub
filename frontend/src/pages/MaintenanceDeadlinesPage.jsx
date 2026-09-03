import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import dayjs from "dayjs";

import FilterBar from "../components/FilterBar";
import FilterSelect from "../components/FilterSelect";
import PageHeader, { HeaderButton } from "../components/PageHeader";
import { bodyRowSx, headRowSx, tableSx } from "../components/tableStyles";
import { downloadMaintenanceDeadlinesExport, getMaintenanceDeadlines } from "../maintenanceAssetsApi";

const URGENCY_LABELS = { regolare: "Regolare", in_scadenza: "In scadenza", urgente: "Urgente", scaduta: "Scaduta" };
const URGENCY_COLORS = { regolare: "success", in_scadenza: "warning", urgente: "warning", scaduta: "error" };
const URGENCY_ORDER = { scaduta: 0, urgente: 1, in_scadenza: 2, regolare: 3 };

export default function MaintenanceDeadlinesPage() {
  const navigate = useNavigate();
  const [urgencyFilter, setUrgencyFilter] = useState("");
  const [exportError, setExportError] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const deadlinesQuery = useQuery({ queryKey: ["maintenance-deadlines"], queryFn: getMaintenanceDeadlines });
  const deadlines = deadlinesQuery.data ?? [];

  const filtered = useMemo(() => {
    const list = urgencyFilter ? deadlines.filter((d) => d.urgency === urgencyFilter) : deadlines;
    return [...list].sort((a, b) => {
      const urgencyDiff = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
      if (urgencyDiff !== 0) return urgencyDiff;
      return dayjs(a.due_date).diff(dayjs(b.due_date));
    });
  }, [deadlines, urgencyFilter]);

  const urgencyOptions = Object.entries(URGENCY_LABELS).map(([value, label]) => ({ value, label }));

  async function handleExport() {
    setIsExporting(true);
    setExportError("");
    try {
      await downloadMaintenanceDeadlinesExport();
    } catch (error) {
      setExportError(error?.message || "Errore durante l'esportazione");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <Box sx={{ minHeight: "100%" }}>
      <Stack spacing={2}>
        <PageHeader
          section="Manutenzioni"
          title="Scadenze"
          meta={`${deadlines.length} ${deadlines.length === 1 ? "scadenza" : "scadenze"}`}
          actions={
            <HeaderButton onClick={handleExport} disabled={isExporting}>
              {isExporting ? "Esportazione..." : "Esporta"}
            </HeaderButton>
          }
        />

        {deadlinesQuery.error && <Alert severity="error">{deadlinesQuery.error.message}</Alert>}
        {exportError && <Alert severity="error" onClose={() => setExportError("")}>{exportError}</Alert>}

        <FilterBar onReset={() => setUrgencyFilter("")} resetDisabled={!urgencyFilter} dense>
          <FilterSelect label="Stato" value={urgencyFilter} onChange={setUrgencyFilter} options={urgencyOptions} />
        </FilterBar>

        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
          <TableContainer>
            <Table size="small" sx={tableSx({ minWidth: 720 })}>
              <TableHead>
                <TableRow sx={headRowSx}>
                  <TableCell sx={{ width: "18%" }}>Asset</TableCell>
                  <TableCell sx={{ width: "30%" }}>Tipo scadenza</TableCell>
                  <TableCell sx={{ width: "16%" }}>Scadenza</TableCell>
                  <TableCell sx={{ width: "16%" }} align="center">Stato</TableCell>
                  <TableCell sx={{ width: "20%" }}>Ultimo completamento</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map((deadline) => (
                  <TableRow
                    key={deadline.id}
                    hover
                    onClick={() => navigate(`/manutenzioni/asset/dettaglio/${deadline.asset_id}`)}
                    sx={bodyRowSx({ clickable: true })}
                  >
                    <TableCell><Typography sx={{ fontSize: 13, fontWeight: 700 }}>{deadline.asset_internal_code}</Typography></TableCell>
                    <TableCell><Typography sx={{ fontSize: 13 }} noWrap>{deadline.deadline_type}</Typography></TableCell>
                    <TableCell><Typography sx={{ fontSize: 13 }}>{dayjs(deadline.due_date).format("DD/MM/YYYY")}</Typography></TableCell>
                    <TableCell align="center">
                      <Chip label={URGENCY_LABELS[deadline.urgency]} size="small" color={URGENCY_COLORS[deadline.urgency]} sx={{ fontSize: 11, fontWeight: 700 }} />
                    </TableCell>
                    <TableCell>
                      <Typography sx={{ fontSize: 13 }}>
                        {deadline.last_completed_at ? dayjs(deadline.last_completed_at).format("DD/MM/YYYY") : "—"}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}

                {filtered.length === 0 && !deadlinesQuery.isLoading && (
                  <TableRow>
                    <TableCell colSpan={5} sx={{ py: 4, textAlign: "center" }}>
                      <Typography sx={{ fontSize: 14, fontWeight: 600 }}>Nessuna scadenza trovata</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      </Stack>
    </Box>
  );
}
