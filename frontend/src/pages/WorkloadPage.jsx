import dayjs from "dayjs";
import "dayjs/locale/it";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Paper,
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

import { getOperationalAreas, getWorkloadCustomerSuppliers, getWorkloadTeams, upsertStructuredWorkload } from "../api";

dayjs.locale("it");

function createEmptyRow() {
  return {
    client_supplier_code: "",
    client_supplier: "",
    inbound_count: 0,
    outbound_count: 0,
    pallet_count: 0,
    notes: "",
    warehouse: "",
  };
}

function normalizeNumericInput(value) {
  if (value === "" || value == null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function parseWarehouseValue(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function serializeWarehouseValue(values) {
  return [...new Set(values.map((item) => String(item).trim()).filter(Boolean))].join(", ");
}

function rowSignature(row) {
  return JSON.stringify({
    code: String(row?.client_supplier_code ?? "").trim(),
    supplier: String(row?.client_supplier ?? "").trim(),
    inbound: normalizeNumericInput(row?.inbound_count),
    outbound: normalizeNumericInput(row?.outbound_count),
    pallet: normalizeNumericInput(row?.pallet_count),
    notes: String(row?.notes ?? "").trim(),
    warehouse: serializeWarehouseValue(parseWarehouseValue(row?.warehouse)),
  });
}

function isRowEmpty(row) {
  return rowSignature(row) === rowSignature(createEmptyRow());
}

function RowStamp({ row }) {
  if (!row?.last_modified_by) {
    return <Typography sx={{ fontSize: 12, color: "#b0b0b8" }}>—</Typography>;
  }
  return (
    <Stack spacing={0.25}>
      <Typography sx={{ fontSize: 12, fontWeight: 600, color: "#1e1e31", lineHeight: 1.2 }}>
        {row.last_modified_by}
      </Typography>
      {row.last_modified_at && (
        <Typography sx={{ fontSize: 11, color: "text.secondary", lineHeight: 1.2 }}>
          {dayjs(row.last_modified_at).format("DD/MM/YYYY HH:mm")}
        </Typography>
      )}
    </Stack>
  );
}

function StatCard({ label, value, color, icon }) {
  return (
    <Box
      sx={{
        flex: "1 1 120px",
        minWidth: 100,
        bgcolor: `${color}12`,
        border: `1.5px solid ${color}30`,
        borderRadius: 2.5,
        px: 2,
        py: 1.5,
        display: "flex",
        flexDirection: "column",
        gap: 0.25,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={0.75}>
        <Box sx={{ fontSize: 16, lineHeight: 1 }}>{icon}</Box>
        <Typography sx={{ fontSize: 11, fontWeight: 600, color, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {label}
        </Typography>
      </Stack>
      <Typography sx={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1.1 }}>
        {value}
      </Typography>
    </Box>
  );
}

function PalletIcon({ size = 18, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Top planks */}
      <rect x="2" y="4" width="20" height="3" rx="0.8" fill={color} />
      <rect x="2" y="8.5" width="20" height="3" rx="0.8" fill={color} />
      {/* Support blocks */}
      <rect x="2" y="13" width="5" height="4" rx="0.6" fill={color} />
      <rect x="9.5" y="13" width="5" height="4" rx="0.6" fill={color} />
      <rect x="17" y="13" width="5" height="4" rx="0.6" fill={color} />
      {/* Bottom runner */}
      <rect x="2" y="17.5" width="20" height="2.5" rx="0.8" fill={color} />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

const COL_HEADER = {
  fontSize: "11px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "#555",
  py: 1.25,
  borderBottom: "2px solid #e2e2e5",
  bgcolor: "#f8f8fa",
  whiteSpace: "nowrap",
};

const NUM_CELL = { width: 96, px: 1 };

export default function WorkloadPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedDate, setSelectedDate] = useState(searchParams.get("date") || dayjs().add(1, "day").format("YYYY-MM-DD"));
  const [selectedTeamId, setSelectedTeamId] = useState(searchParams.get("teamId") || "");
  const [rows, setRows] = useState([createEmptyRow()]);
  const [ownerName, setOwnerName] = useState(null);
  const [snackbar, setSnackbar] = useState(null);
  const [copyFromDateOpen, setCopyFromDateOpen] = useState(false);
  const [copyFromDate, setCopyFromDate] = useState("");
  const [copyRowSelection, setCopyRowSelection] = useState({});

  const { data: teams = [], isLoading, isError, error } = useQuery({
    queryKey: ["workload-teams", selectedDate],
    queryFn: () => getWorkloadTeams(selectedDate),
  });
  const { data: customerSuppliers = [] } = useQuery({
    queryKey: ["workload-customer-suppliers"],
    queryFn: () => getWorkloadCustomerSuppliers(),
    staleTime: 1000 * 60 * 30,
  });
  const { data: operationalAreas = [] } = useQuery({
    queryKey: ["workload-operational-areas"],
    queryFn: () => getOperationalAreas({ activeOnly: true, operationalOnly: true }),
    staleTime: 1000 * 60 * 30,
  });

  useEffect(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("date", selectedDate);
      if (selectedTeamId) next.set("teamId", selectedTeamId);
      else next.delete("teamId");
      return next;
    }, { replace: true });
  }, [selectedDate, selectedTeamId, setSearchParams]);

  useEffect(() => {
    if (isLoading) {
      return;
    }

    // No team is preselected: the user has to pick one explicitly.
    if (!teams.length || !selectedTeamId) {
      if (!teams.length && selectedTeamId) setSelectedTeamId("");
      setRows([createEmptyRow()]);
      setOwnerName(null);
      return;
    }

    // The selected team may not exist for the newly chosen date.
    if (!teams.some((team) => team.team_id === selectedTeamId)) {
      setSelectedTeamId("");
      return;
    }

    const selectedTeam = teams.find((team) => team.team_id === selectedTeamId);
    const sourceRows = selectedTeam?.rows ?? selectedTeam?.table_rows ?? [];
    const nextRows = sourceRows.length ? sourceRows : [createEmptyRow()];
    setRows(nextRows.map((row) => ({ ...createEmptyRow(), ...row })));
    setOwnerName(selectedTeam?.owner_employee_name ?? null);
  }, [teams, selectedTeamId, isLoading]);

  const copyFromPreviewQuery = useQuery({
    queryKey: ["workload-teams", copyFromDate],
    queryFn: () => getWorkloadTeams(copyFromDate),
    enabled: copyFromDateOpen && !!copyFromDate && copyFromDate !== selectedDate,
    staleTime: 30000,
  });

  const copyFromPreviewRows = useMemo(() => {
    if (!copyFromPreviewQuery.data || !selectedTeamId) return null;
    const team = copyFromPreviewQuery.data.find((t) => t.team_id === selectedTeamId) ?? null;
    const sourceRows = team?.rows ?? team?.table_rows ?? [];
    return sourceRows.map((row) => ({ ...createEmptyRow(), ...row }));
  }, [copyFromPreviewQuery.data, selectedTeamId]);

  // Signatures of the rows already present, to prevent copying duplicates.
  const existingSignatures = useMemo(() => new Set(rows.map(rowSignature)), [rows]);

  // Each preview row annotated with whether it already exists in the current table.
  const previewRowsWithMeta = useMemo(() => {
    if (!copyFromPreviewRows) return null;
    return copyFromPreviewRows.map((row) => ({
      row,
      isDuplicate: existingSignatures.has(rowSignature(row)),
    }));
  }, [copyFromPreviewRows, existingSignatures]);

  // (Re)initialise the checkbox selection whenever the preview changes:
  // pre-select every row that is not already present.
  useEffect(() => {
    if (!copyFromPreviewRows) {
      setCopyRowSelection({});
      return;
    }
    const next = {};
    copyFromPreviewRows.forEach((row, index) => {
      next[index] = !existingSignatures.has(rowSignature(row));
    });
    setCopyRowSelection(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copyFromPreviewRows]);

  const selectableCount = previewRowsWithMeta
    ? previewRowsWithMeta.filter((meta) => !meta.isDuplicate).length
    : 0;
  const selectedCount = previewRowsWithMeta
    ? previewRowsWithMeta.filter((meta, index) => !meta.isDuplicate && copyRowSelection[index]).length
    : 0;
  const allSelectableSelected = selectableCount > 0 && selectedCount === selectableCount;
  const someSelectableSelected = selectedCount > 0 && selectedCount < selectableCount;

  function toggleAllCopyRows() {
    if (!previewRowsWithMeta) return;
    const selectAll = !allSelectableSelected;
    const next = {};
    previewRowsWithMeta.forEach((meta, index) => {
      next[index] = selectAll && !meta.isDuplicate;
    });
    setCopyRowSelection(next);
  }

  const selectedTeam = useMemo(
    () => teams.find((team) => team.team_id === selectedTeamId) ?? null,
    [teams, selectedTeamId],
  );

  const warehouseOptions = useMemo(() => {
    const names = new Set();
    for (const area of operationalAreas) {
      const name = String(area?.name ?? "").trim();
      if (name) names.add(name);
    }
    for (const row of rows) {
      for (const value of parseWarehouseValue(row?.warehouse)) {
        names.add(value);
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [operationalAreas, rows]);

  const totals = useMemo(
    () => rows.reduce(
      (acc, row) => {
        const inbound = normalizeNumericInput(row.inbound_count);
        const outbound = normalizeNumericInput(row.outbound_count);
        const pallets = normalizeNumericInput(row.pallet_count);
        // I pallet della riga seguono il mezzo: inbound ha la precedenza sulle righe miste.
        return {
          inbound: acc.inbound + inbound,
          outbound: acc.outbound + outbound,
          pallets: acc.pallets + pallets,
          palletsIn: acc.palletsIn + (inbound > 0 ? pallets : 0),
          palletsOut: acc.palletsOut + (inbound === 0 && outbound > 0 ? pallets : 0),
        };
      },
      { inbound: 0, outbound: 0, pallets: 0, palletsIn: 0, palletsOut: 0 },
    ),
    [rows],
  );

  const saveMutation = useMutation({
    mutationFn: () => upsertStructuredWorkload(selectedTeamId, selectedDate, { rows }),
    onSuccess: (savedNote) => {
      queryClient.invalidateQueries({ queryKey: ["workload-teams", selectedDate] });
      queryClient.invalidateQueries({ queryKey: ["team-daily-notes", selectedDate] });
      setOwnerName(savedNote?.owner_employee_name ?? null);
      setSnackbar({ severity: "success", message: "Carico salvato con successo." });
    },
    onError: (mutationError) => {
      setSnackbar({ severity: "error", message: mutationError.message || "Salvataggio non riuscito." });
    },
  });

  function updateRow(index, field, value) {
    setRows((current) => current.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      return {
        ...row,
        [field]: field.endsWith("_count") ? normalizeNumericInput(value) : value,
      };
    }));
  }

  function updateClientSupplier(index, code) {
    const selectedOption = customerSuppliers.find((item) => item.code === code);
    setRows((current) => current.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      return {
        ...row,
        client_supplier_code: code,
        client_supplier: selectedOption?.description ?? "",
      };
    }));
  }

  function addRow() {
    setRows((current) => [...current, createEmptyRow()]);
  }

  function removeRow(index) {
    setRows((current) => {
      if (current.length === 1) return [createEmptyRow()];
      return current.filter((_, rowIndex) => rowIndex !== index);
    });
  }

  if (isLoading) {
    return (
      <Box sx={{ minHeight: 320, display: "grid", placeItems: "center" }}>
        <CircularProgress sx={{ color: "#007040" }} />
      </Box>
    );
  }

  if (isError) {
    return <Alert severity="error">{error.message || "Errore durante il caricamento dei carichi."}</Alert>;
  }

  const dateLabel = dayjs(selectedDate).format("dddd D MMMM YYYY");

  return (
    <Stack spacing={2.5}>
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <Paper
        elevation={0}
        sx={{
          p: { xs: 2, md: 2.5 },
          borderRadius: 3,
          border: "1px solid #e2e2e5",
          boxShadow: "0 0 1px rgba(226,226,229,.95), 0 4px 16px rgba(30,30,49,.04)",
        }}
      >
        <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ xs: "stretch", md: "center" }} justifyContent="space-between">
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: "13px",
                background: "linear-gradient(160deg, #009e5a 0%, #007040 100%)",
                display: "grid",
                placeItems: "center",
                fontSize: 22,
                flexShrink: 0,
              }}
            >
              📦
            </Box>
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.2, color: "#1e1e31" }}>
                Carichi di lavoro
              </Typography>
              <Typography sx={{ fontSize: 13, color: "text.secondary", mt: 0.25, textTransform: "capitalize" }}>
                {dateLabel}
              </Typography>
            </Box>
          </Stack>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }}>
            <TextField
              type="date"
              size="small"
              label="Data"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ "& .MuiOutlinedInput-root": { borderRadius: "10px" } }}
            />
            <TextField
              select
              size="small"
              label="Squadra"
              value={selectedTeamId}
              onChange={(event) => setSelectedTeamId(event.target.value)}
              sx={{ minWidth: 220, "& .MuiOutlinedInput-root": { borderRadius: "10px" } }}
              disabled={!teams.length}
            >
              <MenuItem value="">
                <em>Seleziona squadra</em>
              </MenuItem>
              {teams.map((team) => (
                <MenuItem key={team.team_id} value={team.team_id}>
                  {team.team_icon} {team.team_name}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </Stack>
      </Paper>

      {!teams.length ? (
        <Alert severity="info" sx={{ borderRadius: 2.5 }}>
          Nessuna squadra disponibile per l'inserimento del carico.
        </Alert>
      ) : !selectedTeamId ? (
        <Alert severity="info" sx={{ borderRadius: 2.5 }}>
          Seleziona una squadra per visualizzare e inserire il carico di lavoro.
        </Alert>
      ) : (
        <>
          {/* ── Totals cards ─────────────────────────────────────────────── */}
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            <StatCard label="Mezzi IN" value={totals.inbound} color="#007040" icon="↓" />
            <StatCard label="Mezzi OUT" value={totals.outbound} color="#0057b8" icon="↑" />
            <StatCard label="Pallet" value={totals.pallets} color="#7c3aed" icon={<PalletIcon size={18} color="#7c3aed" />} />
            <StatCard
              label="Pallet IN"
              value={totals.palletsIn}
              color="#007040"
              icon={<PalletIcon size={18} color="#007040" />}
            />
            <StatCard
              label="Pallet OUT"
              value={totals.palletsOut}
              color="#0057b8"
              icon={<PalletIcon size={18} color="#0057b8" />}
            />
            <Box
              sx={{
                flex: "2 1 200px",
                minWidth: 180,
                bgcolor: "#fafafa",
                border: "1.5px solid #e2e2e5",
                borderRadius: 2.5,
                px: 2,
                py: 1.5,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                gap: 0.25,
              }}
            >
              {selectedTeam && (
                <>
                  <Typography sx={{ fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Squadra
                  </Typography>
                  <Typography sx={{ fontSize: 15, fontWeight: 700, color: "#1e1e31" }}>
                    {selectedTeam.team_icon} {selectedTeam.team_name}
                  </Typography>
                </>
              )}
            </Box>
          </Stack>

          {/* ── Table ────────────────────────────────────────────────────── */}
          <Paper
            elevation={0}
            sx={{
              borderRadius: 3,
              border: "1px solid #e2e2e5",
              boxShadow: "0 0 1px rgba(226,226,229,.95), 0 4px 16px rgba(30,30,49,.04)",
              overflow: "hidden",
            }}
          >
            {/* Table meta bar */}
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                px: 2.5,
                py: 1.5,
                bgcolor: "#f8f8fa",
                borderBottom: "1px solid #e2e2e5",
                flexWrap: "wrap",
                gap: 1,
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: "#1e1e31" }}>
                  {selectedTeam?.team_icon} {selectedTeam?.team_name}
                </Typography>
                <Chip
                  label={`${rows.length} ${rows.length === 1 ? "riga" : "righe"}`}
                  size="small"
                  sx={{ fontSize: 11, height: 20, bgcolor: "#e8f5ee", color: "#007040", fontWeight: 600 }}
                />
              </Stack>
              <Stack direction="row" spacing={2} alignItems="center" sx={{ flexWrap: "wrap" }}>
                <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                  Owner: <strong>{selectedTeam?.workload_owner_employee_name || "Non definito"}</strong>
                </Typography>
                <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                  Ultima modifica: <strong>{ownerName || "Non definito"}</strong>
                  {selectedTeam?.updated_at && (
                    <> · {dayjs(selectedTeam.updated_at).format("DD/MM/YYYY [alle] HH:mm")}</>
                  )}
                </Typography>
              </Stack>
            </Box>

            <Box sx={{ overflowX: "auto" }}>
              <Box sx={{ minWidth: 1080 }}>
                <Table size="small" sx={{ "& .MuiTableCell-root": { verticalAlign: "middle" } }}>
                  <TableHead>
                    {/* Row 1 — group headers */}
                    <TableRow>
                      <TableCell rowSpan={2} sx={{ ...COL_HEADER, pl: 2.5, width: "32%", verticalAlign: "middle" }}>Cliente / Fornitore</TableCell>
                      <TableCell
                        colSpan={2}
                        sx={{
                          ...COL_HEADER,
                          textAlign: "center",
                          color: "#0057b8",
                          borderBottom: "1px solid #e2e2e5",
                          pb: 0.5,
                        }}
                      >
                        MEZZI
                      </TableCell>
                      <TableCell rowSpan={2} sx={{ ...COL_HEADER, ...NUM_CELL, color: "#7c3aed", verticalAlign: "middle" }}>PLT</TableCell>
                      <TableCell rowSpan={2} sx={{ ...COL_HEADER, verticalAlign: "middle" }}>Note / Info</TableCell>
                      <TableCell rowSpan={2} sx={{ ...COL_HEADER, width: 150, verticalAlign: "middle" }}>Magazzino</TableCell>
                      <TableCell rowSpan={2} sx={{ ...COL_HEADER, width: 160, verticalAlign: "middle" }}>Ultima modifica</TableCell>
                      <TableCell rowSpan={2} sx={{ ...COL_HEADER, width: 48, pr: 1.5 }} />
                    </TableRow>
                    {/* Row 2 — IN / OUT */}
                    <TableRow>
                      <TableCell sx={{ ...COL_HEADER, ...NUM_CELL, color: "#007040", pt: 0.5 }}>
                        <Stack direction="row" alignItems="center" spacing={0.5}>
                          <Box sx={{ fontSize: 10 }}>↓</Box>
                          <span>IN</span>
                        </Stack>
                      </TableCell>
                      <TableCell sx={{ ...COL_HEADER, ...NUM_CELL, color: "#0057b8", pt: 0.5 }}>
                        <Stack direction="row" alignItems="center" spacing={0.5}>
                          <Box sx={{ fontSize: 10 }}>↑</Box>
                          <span>OUT</span>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row, index) => (
                      <TableRow
                        key={index}
                        sx={{
                          bgcolor: index % 2 === 0 ? "#fff" : "#fafbfc",
                          "&:hover": { bgcolor: "#f0f7f4" },
                          transition: "background 0.1s",
                        }}
                      >
                        <TableCell sx={{ pl: 2.5, py: 1 }}>
                          <Autocomplete
                            options={customerSuppliers}
                            value={customerSuppliers.find((item) => item.code === (row.client_supplier_code || "")) ?? null}
                            onChange={(_event, option) => updateClientSupplier(index, option?.code ?? "")}
                            getOptionLabel={(option) => `${option.code} - ${option.description}`}
                            isOptionEqualToValue={(option, value) => option.code === value.code}
                            filterOptions={(options, state) => {
                              const query = state.inputValue.trim().toLowerCase();
                              if (!query) return options;
                              return options.filter((option) =>
                                option.code.toLowerCase().includes(query)
                                || option.description.toLowerCase().includes(query)
                              );
                            }}
                            renderInput={(params) => (
                              <TextField
                                {...params}
                                size="small"
                                placeholder="Cerca cliente/fornitore…"
                                sx={{ "& .MuiOutlinedInput-root": { borderRadius: "8px" } }}
                              />
                            )}
                            fullWidth
                          />
                        </TableCell>
                        <TableCell sx={{ ...NUM_CELL, py: 1 }}>
                          <TextField
                            type="number"
                            value={row.inbound_count}
                            onChange={(event) => updateRow(index, "inbound_count", event.target.value)}
                            size="small"
                            inputProps={{ min: 0, style: { textAlign: "center", fontWeight: 600 } }}
                            sx={{
                              "& .MuiOutlinedInput-root": {
                                borderRadius: "8px",
                                "& fieldset": { borderColor: "#007040" + "44" },
                                "&:hover fieldset": { borderColor: "#007040" + "88" },
                                "&.Mui-focused fieldset": { borderColor: "#007040" },
                              },
                            }}
                            fullWidth
                          />
                        </TableCell>
                        <TableCell sx={{ ...NUM_CELL, py: 1 }}>
                          <TextField
                            type="number"
                            value={row.outbound_count}
                            onChange={(event) => updateRow(index, "outbound_count", event.target.value)}
                            size="small"
                            inputProps={{ min: 0, style: { textAlign: "center", fontWeight: 600 } }}
                            sx={{
                              "& .MuiOutlinedInput-root": {
                                borderRadius: "8px",
                                "& fieldset": { borderColor: "#0057b8" + "44" },
                                "&:hover fieldset": { borderColor: "#0057b8" + "88" },
                                "&.Mui-focused fieldset": { borderColor: "#0057b8" },
                              },
                            }}
                            fullWidth
                          />
                        </TableCell>
                        <TableCell sx={{ ...NUM_CELL, py: 1 }}>
                          <TextField
                            type="number"
                            value={row.pallet_count}
                            onChange={(event) => updateRow(index, "pallet_count", event.target.value)}
                            size="small"
                            inputProps={{ min: 0, style: { textAlign: "center", fontWeight: 600 } }}
                            sx={{
                              "& .MuiOutlinedInput-root": {
                                borderRadius: "8px",
                                "& fieldset": { borderColor: "#7c3aed" + "44" },
                                "&:hover fieldset": { borderColor: "#7c3aed" + "88" },
                                "&.Mui-focused fieldset": { borderColor: "#7c3aed" },
                              },
                            }}
                            fullWidth
                          />
                        </TableCell>
                        <TableCell sx={{ py: 1 }}>
                          <TextField
                            value={row.notes}
                            onChange={(event) => updateRow(index, "notes", event.target.value)}
                            size="small"
                            fullWidth
                            multiline
                            minRows={1}
                            placeholder="Note…"
                            sx={{ "& .MuiOutlinedInput-root": { borderRadius: "8px" } }}
                          />
                        </TableCell>
                        <TableCell sx={{ py: 1 }}>
                          <Autocomplete
                            multiple
                            options={warehouseOptions}
                            value={parseWarehouseValue(row.warehouse)}
                            onChange={(_event, values) => updateRow(index, "warehouse", serializeWarehouseValue(values))}
                            disableCloseOnSelect
                            fullWidth
                            renderTags={(value, getTagProps) =>
                              value.map((option, tagIndex) => (
                                <Chip
                                  {...getTagProps({ index: tagIndex })}
                                  key={option}
                                  label={option}
                                  size="small"
                                  sx={{ borderRadius: "8px" }}
                                />
                              ))
                            }
                            renderInput={(params) => (
                              <TextField
                                {...params}
                                size="small"
                                placeholder={parseWarehouseValue(row.warehouse).length ? "" : "Seleziona aree…"}
                                sx={{ "& .MuiOutlinedInput-root": { borderRadius: "8px" } }}
                              />
                            )}
                          />
                        </TableCell>
                        <TableCell sx={{ py: 1 }}>
                          <RowStamp row={row} />
                        </TableCell>
                        <TableCell sx={{ pr: 1.5, py: 1 }}>
                          <Tooltip title="Elimina riga" placement="left">
                            <IconButton
                              size="small"
                              onClick={() => removeRow(index)}
                              disabled={saveMutation.isPending}
                              sx={{
                                color: "#aaa",
                                borderRadius: "8px",
                                "&:hover": { color: "#dc2626", bgcolor: "#fee2e2" },
                                transition: "color 0.15s, background 0.15s",
                              }}
                            >
                              <TrashIcon />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}

                    {/* Totals row */}
                    <TableRow>
                      <TableCell
                        sx={{
                          pl: 2.5,
                          py: 1.25,
                          bgcolor: "#007040",
                          color: "#fff",
                          fontWeight: 800,
                          fontSize: 13,
                          borderTop: "2px solid #005c33",
                          letterSpacing: "0.05em",
                        }}
                      >
                        TOTALE
                      </TableCell>
                      <TableCell
                        sx={{
                          ...NUM_CELL,
                          bgcolor: "#007040",
                          color: "#fff",
                          fontWeight: 800,
                          fontSize: 18,
                          textAlign: "center",
                          borderTop: "2px solid #005c33",
                        }}
                      >
                        {totals.inbound}
                      </TableCell>
                      <TableCell
                        sx={{
                          ...NUM_CELL,
                          bgcolor: "#0057b8",
                          color: "#fff",
                          fontWeight: 800,
                          fontSize: 18,
                          textAlign: "center",
                          borderTop: "2px solid #004499",
                        }}
                      >
                        {totals.outbound}
                      </TableCell>
                      <TableCell
                        sx={{
                          ...NUM_CELL,
                          bgcolor: "#7c3aed",
                          color: "#fff",
                          fontWeight: 800,
                          fontSize: 18,
                          textAlign: "center",
                          borderTop: "2px solid #6d28d9",
                        }}
                      >
                        {totals.pallets}
                      </TableCell>
                      <TableCell colSpan={4} sx={{ bgcolor: "#f1f5f9", borderTop: "2px solid #e2e2e5" }} />
                    </TableRow>
                  </TableBody>
                </Table>
              </Box>
            </Box>

            <Divider />

            {/* Footer */}
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1.5}
              justifyContent="space-between"
              alignItems={{ sm: "center" }}
              sx={{ px: 2.5, py: 2 }}
            >
              <Box>
                {selectedTeam?.updated_at && (
                  <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                    Ultimo salvataggio: {dayjs(selectedTeam.updated_at).format("DD/MM/YYYY [alle] HH:mm")}
                  </Typography>
                )}
              </Box>
              <Stack direction="row" spacing={1.5}>
                <Button
                  variant="outlined"
                  onClick={() => {
                    setCopyFromDate(dayjs(selectedDate).subtract(1, "day").format("YYYY-MM-DD"));
                    setCopyFromDateOpen(true);
                  }}
                  disabled={!selectedTeamId || saveMutation.isPending}
                  sx={{
                    borderRadius: "10px",
                    textTransform: "none",
                    fontWeight: 600,
                    borderColor: "#cbd5e1",
                    color: "#334155",
                    "&:hover": { bgcolor: "#f8fafc", borderColor: "#94a3b8" },
                  }}
                >
                  Copia da data…
                </Button>
                <Button
                  variant="outlined"
                  onClick={addRow}
                  disabled={saveMutation.isPending}
                  startIcon={<PlusIcon />}
                  sx={{
                    borderRadius: "10px",
                    textTransform: "none",
                    fontWeight: 600,
                    borderColor: "#007040",
                    color: "#007040",
                    "&:hover": { bgcolor: "#e8f5ee", borderColor: "#005c33" },
                  }}
                >
                  Aggiungi riga
                </Button>
                <Button
                  variant="contained"
                  onClick={() => saveMutation.mutate()}
                  disabled={!selectedTeamId || saveMutation.isPending}
                  startIcon={saveMutation.isPending ? <CircularProgress size={14} sx={{ color: "#fff" }} /> : <SaveIcon />}
                  sx={{
                    borderRadius: "10px",
                    textTransform: "none",
                    fontWeight: 700,
                    bgcolor: "#007040",
                    "&:hover": { bgcolor: "#005c33" },
                    "&:disabled": { bgcolor: "#ccc" },
                    minWidth: 140,
                  }}
                >
                  {saveMutation.isPending ? "Salvataggio…" : "Salva carico"}
                </Button>
              </Stack>
            </Stack>
          </Paper>
        </>
      )}

      {/* ── Copy from date dialog ────────────────────────────────────── */}
      <Dialog
        open={copyFromDateOpen}
        onClose={() => setCopyFromDateOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { borderRadius: 3 } }}
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Typography fontWeight={800} fontSize={16}>Copia carico da data</Typography>
          <Typography fontSize={12} color="text.secondary" sx={{ mt: 0.25 }}>
            Scegli la data sorgente e seleziona le righe da aggiungere al carico corrente
          </Typography>
        </DialogTitle>

        <DialogContent sx={{ pt: 1 }}>
          <Stack spacing={2.5}>
            <TextField
              type="date"
              size="small"
              label="Data sorgente"
              value={copyFromDate}
              onChange={(e) => setCopyFromDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              inputProps={{ max: dayjs().format("YYYY-MM-DD") }}
              sx={{ maxWidth: 200, "& .MuiOutlinedInput-root": { borderRadius: "10px" } }}
            />

            {/* Preview area */}
            {!copyFromDate ? (
              <Typography fontSize={13} color="text.secondary" sx={{ fontStyle: "italic" }}>
                Seleziona una data per vedere l'anteprima.
              </Typography>
            ) : copyFromDate === selectedDate ? (
              <Alert severity="warning" sx={{ borderRadius: 2 }}>
                La data sorgente coincide con la data corrente.
              </Alert>
            ) : copyFromPreviewQuery.isFetching ? (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 1 }}>
                <CircularProgress size={18} sx={{ color: "#007040" }} />
                <Typography fontSize={13} color="text.secondary">Caricamento anteprima…</Typography>
              </Box>
            ) : copyFromPreviewRows !== null && copyFromPreviewRows.length === 0 ? (
              <Alert severity="info" sx={{ borderRadius: 2 }}>
                Nessun carico trovato per il{" "}
                <strong>{dayjs(copyFromDate).format("DD/MM/YYYY")}</strong> per questa squadra.
              </Alert>
            ) : previewRowsWithMeta !== null ? (
              <Box>
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1, flexWrap: "wrap", gap: 0.5 }}>
                  <Typography fontSize={12} fontWeight={700} color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Anteprima — {dayjs(copyFromDate).format("dddd D MMMM YYYY")} · {selectedCount}/{selectableCount} selezionate
                  </Typography>
                  {selectableCount === 0 && (
                    <Typography fontSize={12} color="text.secondary" sx={{ fontStyle: "italic" }}>
                      Tutte le righe sono già presenti nel carico corrente.
                    </Typography>
                  )}
                </Stack>
                <Box sx={{ overflowX: "auto", border: "1px solid #e2e2e5", borderRadius: 2, overflow: "hidden" }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox" sx={{ ...COL_HEADER, py: 1 }}>
                          <Checkbox
                            size="small"
                            checked={allSelectableSelected}
                            indeterminate={someSelectableSelected}
                            disabled={selectableCount === 0}
                            onChange={toggleAllCopyRows}
                            sx={{ p: 0.5, color: "#007040", "&.Mui-checked": { color: "#007040" }, "&.MuiCheckbox-indeterminate": { color: "#007040" } }}
                          />
                        </TableCell>
                        {["Cliente / Fornitore", "↓ IN", "↑ OUT", "PLT", "Note / Info", "Magazzino"].map((h) => (
                          <TableCell key={h} sx={{ ...COL_HEADER, py: 1 }}>{h}</TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {previewRowsWithMeta.map(({ row, isDuplicate }, i) => (
                        <TableRow
                          key={i}
                          sx={{ bgcolor: isDuplicate ? "#f4f4f6" : i % 2 === 0 ? "#fff" : "#fafbfc", opacity: isDuplicate ? 0.65 : 1 }}
                        >
                          <TableCell padding="checkbox" sx={{ pl: 1 }}>
                            {isDuplicate ? (
                              <Tooltip title="Riga già presente nel carico corrente">
                                <span>
                                  <Checkbox size="small" checked={false} disabled sx={{ p: 0.5 }} />
                                </span>
                              </Tooltip>
                            ) : (
                              <Checkbox
                                size="small"
                                checked={!!copyRowSelection[i]}
                                onChange={(e) => setCopyRowSelection((current) => ({ ...current, [i]: e.target.checked }))}
                                sx={{ p: 0.5, color: "#007040", "&.Mui-checked": { color: "#007040" } }}
                              />
                            )}
                          </TableCell>
                          <TableCell sx={{ pl: 2, py: 0.875, fontSize: 13 }}>
                            {row.client_supplier || row.client_supplier_code || <span style={{ color: "#aaa" }}>—</span>}
                            {isDuplicate && (
                              <Chip label="Già presente" size="small" sx={{ ml: 1, height: 18, fontSize: 10, fontWeight: 700, bgcolor: "#e2e8f0", color: "#64748b" }} />
                            )}
                          </TableCell>
                          <TableCell sx={{ ...NUM_CELL, textAlign: "center", fontWeight: 700, color: "#007040", fontSize: 13 }}>
                            {row.inbound_count ?? 0}
                          </TableCell>
                          <TableCell sx={{ ...NUM_CELL, textAlign: "center", fontWeight: 700, color: "#0057b8", fontSize: 13 }}>
                            {row.outbound_count ?? 0}
                          </TableCell>
                          <TableCell sx={{ ...NUM_CELL, textAlign: "center", fontWeight: 700, color: "#7c3aed", fontSize: 13 }}>
                            {row.pallet_count ?? 0}
                          </TableCell>
                          <TableCell sx={{ fontSize: 12, color: "text.secondary", maxWidth: 200 }}>
                            {row.notes || <span style={{ color: "#ccc" }}>—</span>}
                          </TableCell>
                          <TableCell sx={{ fontSize: 12, color: "text.secondary" }}>
                            {row.warehouse || <span style={{ color: "#ccc" }}>—</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow>
                        <TableCell sx={{ bgcolor: "#f1f5f9" }} />
                        <TableCell sx={{ pl: 2, py: 1, bgcolor: "#f1f5f9", fontWeight: 700, fontSize: 12, color: "#555", letterSpacing: "0.05em" }}>
                          TOTALE
                        </TableCell>
                        <TableCell sx={{ ...NUM_CELL, textAlign: "center", fontWeight: 800, color: "#007040", bgcolor: "#f1f5f9" }}>
                          {copyFromPreviewRows.reduce((s, r) => s + normalizeNumericInput(r.inbound_count), 0)}
                        </TableCell>
                        <TableCell sx={{ ...NUM_CELL, textAlign: "center", fontWeight: 800, color: "#0057b8", bgcolor: "#f1f5f9" }}>
                          {copyFromPreviewRows.reduce((s, r) => s + normalizeNumericInput(r.outbound_count), 0)}
                        </TableCell>
                        <TableCell sx={{ ...NUM_CELL, textAlign: "center", fontWeight: 800, color: "#7c3aed", bgcolor: "#f1f5f9" }}>
                          {copyFromPreviewRows.reduce((s, r) => s + normalizeNumericInput(r.pallet_count), 0)}
                        </TableCell>
                        <TableCell colSpan={2} sx={{ bgcolor: "#f1f5f9" }} />
                      </TableRow>
                    </TableBody>
                  </Table>
                </Box>
              </Box>
            ) : null}
          </Stack>
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
          <Button
            onClick={() => setCopyFromDateOpen(false)}
            sx={{ borderRadius: "10px", textTransform: "none", fontWeight: 600, color: "#64748b" }}
          >
            Annulla
          </Button>
          <Button
            variant="contained"
            disabled={selectedCount === 0 || copyFromPreviewQuery.isFetching}
            onClick={() => {
              const toCopy = previewRowsWithMeta
                .filter((meta, index) => !meta.isDuplicate && copyRowSelection[index])
                .map((meta) => ({ ...createEmptyRow(), ...meta.row }));
              setRows((current) => {
                const kept = current.filter((row) => !isRowEmpty(row));
                const merged = [...kept, ...toCopy];
                return merged.length ? merged : [createEmptyRow()];
              });
              setOwnerName(null);
              setCopyFromDateOpen(false);
              setSnackbar({
                severity: "success",
                message: `${toCopy.length} ${toCopy.length === 1 ? "riga copiata" : "righe copiate"} dal ${dayjs(copyFromDate).format("DD/MM/YYYY")}.`,
              });
            }}
            sx={{
              borderRadius: "10px",
              textTransform: "none",
              fontWeight: 700,
              bgcolor: "#007040",
              "&:hover": { bgcolor: "#005c33" },
              "&:disabled": { bgcolor: "#ccc" },
            }}
          >
            {selectedCount > 0 ? `Copia ${selectedCount} ${selectedCount === 1 ? "riga" : "righe"}` : "Copia carico"}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!snackbar}
        autoHideDuration={3500}
        onClose={() => setSnackbar(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {snackbar ? (
          <Alert
            severity={snackbar.severity}
            onClose={() => setSnackbar(null)}
            sx={{ borderRadius: 2.5, boxShadow: "0 4px 20px rgba(0,0,0,0.15)" }}
          >
            {snackbar.message}
          </Alert>
        ) : <span />}
      </Snackbar>
    </Stack>
  );
}
