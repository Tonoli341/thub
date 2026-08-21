import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import FilterBar from "../components/FilterBar";
import PageHeader, { HeaderButton } from "../components/PageHeader";
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
  Divider,
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Skeleton,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";

import { createOperationalArea, deleteOperationalArea, getOperationalAreas, updateOperationalArea } from "../api";
import { normalizeBuildings } from "../buildings";

const EMPTY_FORM = { area_code: "", name: "", description: "", is_operational: true, buildings: [] };

export default function OperationalAreasPage() {
  const queryClient = useQueryClient();
  const [dialogState, setDialogState] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [snackbar, setSnackbar] = useState(null);
  const [showInactive, setShowInactive] = useState(false);
  const [filterType, setFilterType] = useState("all");

  const areasQuery = useQuery({
    queryKey: ["operational-areas", "all"],
    queryFn: () => getOperationalAreas({ activeOnly: false }),
  });

  const createMutation = useMutation({
    mutationFn: createOperationalArea,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["operational-areas"] });
      setDialogState(null);
      setSnackbar("Area operativa creata con successo");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ areaId, payload }) => updateOperationalArea(areaId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["operational-areas"] });
      setDialogState(null);
      setSnackbar("Area aggiornata");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteOperationalArea,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["operational-areas"] });
      setConfirmDelete(null);
      setSnackbar("Area eliminata");
    },
  });

  const areas = areasQuery.data ?? [];
  const filtered = areas.filter((a) => {
    if (!showInactive && !a.is_active) return false;
    if (filterType === "operative" && !a.is_operational) return false;
    if (filterType === "uffici" && a.is_operational) return false;
    return true;
  });
  const activeCount = areas.filter((a) => a.is_active).length;

  function openCreate() {
    setDialogState({ mode: "create", form: { ...EMPTY_FORM } });
  }

  function openEdit(area) {
    setDialogState({
      mode: "edit",
      areaId: area.id,
      form: {
        area_code: area.area_code,
        name: area.name,
        description: area.description || "",
        is_operational: area.is_operational,
        is_active: area.is_active,
        buildings: normalizeBuildings(area.buildings),
      },
    });
  }

  function handleSaveDialog(form) {
    if (dialogState.mode === "create") {
      createMutation.mutate({ ...form, is_active: true });
    } else {
      updateMutation.mutate({ areaId: dialogState.areaId, payload: form });
    }
  }

  function handleToggleActive(area) {
    updateMutation.mutate({ areaId: area.id, payload: { is_active: !area.is_active } });
  }

  return (
    <>
      <Stack spacing={3}>
        {/* Header */}
        <PageHeader
          section="Configurazione"
          title="Aree operative"
          meta={areasQuery.isLoading ? undefined : `${activeCount} area${activeCount !== 1 ? "e" : ""} attiv${activeCount !== 1 ? "e" : "a"}`}
          actions={<HeaderButton onClick={openCreate}>+ Nuova area</HeaderButton>}
        />

        {/* Filtri (regola 3) */}
        <FilterBar dense>
          <Stack direction="row" spacing={0.5}>
            {[
              { key: "all", label: "Tutte" },
              { key: "operative", label: "Operative" },
              { key: "uffici", label: "Uffici" },
            ].map(({ key, label }) => (
              <Button
                key={key}
                size="small"
                variant={filterType === key ? "contained" : "outlined"}
                onClick={() => setFilterType(key)}
                sx={{ minWidth: 80 }}
              >
                {label}
              </Button>
            ))}
          </Stack>
          <FormControlLabel
            control={
              <Switch
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                size="small"
              />
            }
            label={
              <Typography variant="body2" color="text.secondary">
                Mostra inattive
              </Typography>
            }
          />
        </FilterBar>

        {/* Error alerts */}
        {areasQuery.error && <Alert severity="error">{areasQuery.error.message}</Alert>}
        {updateMutation.error && !dialogState && <Alert severity="error">{updateMutation.error.message}</Alert>}
        {deleteMutation.error && !confirmDelete && <Alert severity="error">{deleteMutation.error.message}</Alert>}

        {/* Loading skeletons */}
        {areasQuery.isLoading && (
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "1fr 1fr 1fr" }, gap: 2 }}>
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} variant="rounded" height={220} sx={{ borderRadius: 3 }} />
            ))}
          </Box>
        )}

        {/* Empty state */}
        {!areasQuery.isLoading && filtered.length === 0 && (
          <Paper
            sx={{
              p: 6,
              textAlign: "center",
              borderRadius: 3,
              border: "2px dashed",
              borderColor: "divider",
              bgcolor: "background.paper",
            }}
          >
            <Typography variant="h6" color="text.secondary" gutterBottom>
              {areas.length === 0
                ? "Nessuna area operativa"
                : "Nessuna area corrisponde ai filtri"}
            </Typography>
            <Typography variant="body2" color="text.disabled" sx={{ mb: 3 }}>
              {areas.length === 0
                ? "Crea la prima area operativa per configurare il Planner."
                : "Prova a cambiare i filtri oppure abilita la visualizzazione delle aree inattive."}
            </Typography>
            {areas.length === 0 && (
              <Button variant="contained" onClick={openCreate}>
                + Nuova area
              </Button>
            )}
          </Paper>
        )}

        {/* Card grid */}
        {!areasQuery.isLoading && filtered.length > 0 && (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "1fr 1fr 1fr" },
              gap: 2,
            }}
          >
            {filtered.map((area) => (
              <AreaCard
                key={area.id}
                area={area}
                onEdit={() => openEdit(area)}
                onToggleActive={() => handleToggleActive(area)}
                onDelete={() => setConfirmDelete(area)}
              />
            ))}
          </Box>
        )}
      </Stack>

      {/* Create / Edit dialog */}
      {dialogState && (
        <AreaDialog
          state={dialogState}
          onClose={() => setDialogState(null)}
          onSave={handleSaveDialog}
          isPending={createMutation.isPending || updateMutation.isPending}
          error={createMutation.error || updateMutation.error}
        />
      )}

      {/* Confirm delete dialog */}
      <Dialog
        open={!!confirmDelete}
        onClose={() => !deleteMutation.isPending && setConfirmDelete(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Elimina area operativa</DialogTitle>
        <DialogContent>
          <Typography>
            Sei sicuro di voler eliminare l&apos;area <strong>{confirmDelete?.name}</strong>?
            L&apos;operazione non può essere annullata.
          </Typography>
          {deleteMutation.error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {deleteMutation.error.message}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)} disabled={deleteMutation.isPending}>
            Annulla
          </Button>
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

      {/* Success snackbar */}
      <Snackbar
        open={!!snackbar}
        autoHideDuration={3000}
        onClose={() => setSnackbar(null)}
        message={snackbar}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </>
  );
}

function AreaCard({ area, onEdit, onToggleActive, onDelete }) {
  const [menuAnchor, setMenuAnchor] = useState(null);

  return (
    <Paper
      sx={{
        p: 2.5,
        borderRadius: 3,
        display: "flex",
        flexDirection: "column",
        gap: 1.5,
        opacity: area.is_active ? 1 : 0.55,
        border: "1.5px solid",
        borderColor: area.is_active ? "transparent" : "divider",
        borderStyle: area.is_active ? "solid" : "dashed",
        transition: "box-shadow 0.15s, opacity 0.2s",
        "&:hover": { boxShadow: 3 },
        position: "relative",
      }}
    >
      {/* Top row: code badge + name + menu */}
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
          <Box
            sx={{
              px: 1.25,
              py: 0.5,
              borderRadius: 1.5,
              bgcolor: area.is_operational ? "primary.main" : "grey.600",
              color: "#fff",
              fontFamily: '"Lexend Mono", monospace',
              fontWeight: 700,
              fontSize: "0.78rem",
              letterSpacing: "0.06em",
              flexShrink: 0,
              lineHeight: 1.4,
            }}
          >
            {area.area_code}
          </Box>
          <Typography
            variant="subtitle1"
            fontWeight={700}
            sx={{ lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            title={area.name}
          >
            {area.name}
          </Typography>
        </Stack>
        <IconButton
          size="small"
          onClick={(e) => setMenuAnchor(e.currentTarget)}
          sx={{ flexShrink: 0, mt: -0.5, fontSize: 20, lineHeight: 1, color: "text.secondary" }}
        >
          ⋮
        </IconButton>
      </Stack>

      {/* Type + status chips */}
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
        <Chip
          label={area.is_operational ? "Operativa" : "Uffici"}
          size="small"
          sx={{
            bgcolor: area.is_operational ? "rgba(0,112,64,0.1)" : "rgba(43,43,43,0.08)",
            color: area.is_operational ? "primary.main" : "text.secondary",
            fontWeight: 600,
            fontSize: "0.72rem",
          }}
        />
        <Chip
          label={area.is_active ? "Attiva" : "Inattiva"}
          size="small"
          sx={{
            bgcolor: area.is_active ? "rgba(34,197,94,0.1)" : "rgba(150,150,150,0.12)",
            color: area.is_active ? "#16a34a" : "text.disabled",
            fontWeight: 600,
            fontSize: "0.72rem",
          }}
        />
      </Stack>

      {/* Description */}
      {area.description && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            fontSize: "0.83rem",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {area.description}
        </Typography>
      )}

      {/* Buildings */}
      {normalizeBuildings(area.buildings).length > 0 ? (
        <Box>
          <Typography variant="caption" color="text.disabled" sx={{ display: "block", mb: 0.5 }}>
            Immobili
          </Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {normalizeBuildings(area.buildings).map((b) => (
              <Chip
                key={b.code}
                label={b.code}
                size="small"
                variant="outlined"
                title={[
                  b.visible_in_planner ? "Visibile nel Planner" : "Nascosto nel Planner",
                  b.visible_in_reporting ? "Visibile in rendicontazione" : "Nascosto in rendicontazione",
                ].join(" · ")}
                sx={{
                  fontFamily: '"Lexend Mono", monospace',
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  height: 22,
                  opacity: b.visible_in_planner || b.visible_in_reporting ? 1 : 0.5,
                }}
              />
            ))}
          </Stack>
        </Box>
      ) : (
        <Typography variant="caption" color="text.disabled">
          Nessun immobile
        </Typography>
      )}

      {/* Footer: date */}
      <Typography variant="caption" color="text.disabled" sx={{ mt: "auto" }}>
        Modificata{" "}
        {new Date(area.updated_at).toLocaleDateString("it-IT", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}
      </Typography>

      {/* Context menu */}
      <Menu
        anchorEl={menuAnchor}
        open={!!menuAnchor}
        onClose={() => setMenuAnchor(null)}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
      >
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            onEdit();
          }}
        >
          Modifica
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            onToggleActive();
          }}
        >
          {area.is_active ? "Disattiva" : "Riattiva"}
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            onDelete();
          }}
          sx={{ color: "error.main" }}
        >
          Elimina
        </MenuItem>
      </Menu>
    </Paper>
  );
}

function AreaDialog({ state, onClose, onSave, isPending, error }) {
  const [form, setForm] = useState(state.form);
  const [buildingInput, setBuildingInput] = useState("");

  const isCreate = state.mode === "create";
  const canSave = form.area_code.trim() && form.name.trim();

  function addBuilding() {
    const code = buildingInput.trim().toUpperCase();
    if (!code || form.buildings.some((b) => b.code === code)) return;
    setForm((c) => ({
      ...c,
      buildings: [...c.buildings, { code, visible_in_planner: true, visible_in_reporting: true }],
    }));
    setBuildingInput("");
  }

  function removeBuilding(code) {
    setForm((c) => ({ ...c, buildings: c.buildings.filter((b) => b.code !== code) }));
  }

  function toggleBuildingFlag(code, flag, value) {
    setForm((c) => ({
      ...c,
      buildings: c.buildings.map((b) => (b.code === code ? { ...b, [flag]: value } : b)),
    }));
  }

  return (
    <Dialog open onClose={!isPending ? onClose : undefined} maxWidth="sm" fullWidth>
      <DialogTitle
        sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", pb: 1 }}
      >
        <Typography variant="h6" fontWeight={700}>
          {isCreate ? "Nuova area operativa" : "Modifica area"}
        </Typography>
        <IconButton size="small" onClick={onClose} disabled={isPending} sx={{ fontSize: 16, lineHeight: 1 }}>
          ✕
        </IconButton>
      </DialogTitle>

      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {/* Code + Name */}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Codice area"
              value={form.area_code}
              onChange={(e) => setForm((c) => ({ ...c, area_code: e.target.value }))}
              required
              helperText="Es. NORD, MIL, F1"
              sx={{ flex: 1 }}
            />
            <TextField
              label="Nome area"
              value={form.name}
              onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
              required
              sx={{ flex: 2 }}
            />
          </Stack>

          {/* Description */}
          <TextField
            label="Descrizione"
            value={form.description}
            onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))}
            multiline
            minRows={2}
            placeholder="Breve descrizione dell'area (opzionale)"
          />

          {/* Type toggle */}
          <Box
            sx={{
              p: 2,
              borderRadius: 2,
              bgcolor: "action.hover",
              display: "flex",
              alignItems: "center",
              gap: 2,
            }}
          >
            <Switch
              checked={form.is_operational}
              onChange={(e) => setForm((c) => ({ ...c, is_operational: e.target.checked }))}
              color="primary"
            />
            <Box>
              <Typography variant="body2" fontWeight={600}>
                {form.is_operational ? "Area operativa" : "Uffici / Amministrativa"}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {form.is_operational
                  ? "Visibile nel Planner e assegnabile ai dipendenti"
                  : "Non compare nel Planner, solo uso amministrativo"}
              </Typography>
            </Box>
          </Box>

          {/* Buildings */}
          <Box>
            <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
              Immobili
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              Con &quot;Visibile nel Planner&quot; disattivo il Planner mostra solo l&apos;area, senza il
              dettaglio dell&apos;immobile. Con &quot;Visibile in rendicontazione&quot; disattivo l&apos;immobile
              non è utilizzabile nelle tabelle della rendicontazione.
            </Typography>
            <Stack spacing={1} sx={{ mb: 1.5 }}>
              {form.buildings.map((b) => (
                <Box
                  key={b.code}
                  sx={{
                    p: 1.25,
                    borderRadius: 2,
                    border: "1px solid",
                    borderColor: "divider",
                    display: "flex",
                    alignItems: "center",
                    gap: 1.5,
                    flexWrap: "wrap",
                  }}
                >
                  <Chip
                    label={b.code}
                    size="small"
                    onDelete={() => removeBuilding(b.code)}
                    sx={{ fontFamily: '"Lexend Mono", monospace', fontWeight: 700, fontSize: "0.78rem" }}
                  />
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ ml: "auto" }}>
                    <FormControlLabel
                      control={
                        <Switch
                          size="small"
                          checked={b.visible_in_planner}
                          onChange={(e) => toggleBuildingFlag(b.code, "visible_in_planner", e.target.checked)}
                        />
                      }
                      label={
                        <Typography variant="caption" color="text.secondary">
                          Visibile nel Planner
                        </Typography>
                      }
                      sx={{ mr: 0 }}
                    />
                    <FormControlLabel
                      control={
                        <Switch
                          size="small"
                          checked={b.visible_in_reporting}
                          onChange={(e) => toggleBuildingFlag(b.code, "visible_in_reporting", e.target.checked)}
                        />
                      }
                      label={
                        <Typography variant="caption" color="text.secondary">
                          Visibile in rendicontazione
                        </Typography>
                      }
                      sx={{ mr: 0 }}
                    />
                  </Stack>
                </Box>
              ))}
              {form.buildings.length === 0 && (
                <Typography variant="caption" color="text.disabled" sx={{ lineHeight: "28px" }}>
                  Nessun immobile definito
                </Typography>
              )}
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                size="small"
                placeholder="Codice (es. F1)"
                value={buildingInput}
                onChange={(e) => setBuildingInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addBuilding();
                  }
                }}
                sx={{ maxWidth: 200 }}
              />
              <Button
                size="small"
                variant="outlined"
                onClick={addBuilding}
                disabled={!buildingInput.trim()}
              >
                Aggiungi
              </Button>
            </Stack>
          </Box>

          {error && <Alert severity="error">{error.message}</Alert>}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={isPending}>
          Annulla
        </Button>
        <Button
          variant="contained"
          onClick={() => onSave(form)}
          disabled={!canSave || isPending}
          startIcon={isPending ? <CircularProgress size={16} color="inherit" /> : null}
        >
          {isCreate ? "Crea area" : "Salva modifiche"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
