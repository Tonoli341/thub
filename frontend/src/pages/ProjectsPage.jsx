import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import PageHeader, { HeaderButton } from "../components/PageHeader";
import { tableSx } from "../components/tableStyles";
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
  Drawer,
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Skeleton,
  Snackbar,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  Tabs,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";

import {
  createFieldDefinition,
  createInfinityBillingCustomerSupplierMap,
  createInfinityBillingItem,
  deleteFieldDefinition,
  deleteInfinityBillingCustomerSupplierMap,
  deleteInfinityBillingItem,
  getFieldDefinitions,
  getInfinityBillingCustomerSupplierMap,
  getInfinityBillingItems,
  getOperationalAreas,
  getValueListSourceColumns,
  getValueListSources,
  getWorkloadCustomerSuppliers,
  replaceInfinityMapFieldAssignments,
  updateFieldDefinition,
  updateInfinityBillingCustomerSupplierMap,
  updateInfinityBillingItem,
} from "../api";
import { reportingBuildingCodes } from "../buildings";

function GearIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.5v2.1M12 18.4v2.1M20.5 12h-2.1M5.6 12H3.5M17.7 6.3l-1.5 1.5M7.8 16.2l-1.5 1.5M17.7 17.7l-1.5-1.5M7.8 7.8 6.3 6.3" />
    </svg>
  );
}

function DuplicateIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15 8.5V6.5A2 2 0 0 0 13 4.5H6.5a2 2 0 0 0-2 2V13a2 2 0 0 0 2 2h2" />
    </svg>
  );
}

// ── Shared dialogs ──────────────────────────────────────────────────────────

function ConfirmDeleteDialog({ open, onClose, onConfirm, entityLabel, name }) {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleConfirm() {
    setIsSaving(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e?.message || "Errore durante l'eliminazione");
      setIsSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={!isSaving ? onClose : undefined}
      maxWidth="xs"
      fullWidth
      TransitionProps={{ onEnter: () => { setIsSaving(false); setError(null); } }}
    >
      <DialogTitle fontWeight={700}>Elimina {entityLabel}</DialogTitle>
      <DialogContent>
        <Typography>
          Confermi l&apos;eliminazione di <strong>{name}</strong>?
          L&apos;operazione non può essere annullata.
        </Typography>
        {error && <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={isSaving}>Annulla</Button>
        <Button variant="contained" color="error" disabled={isSaving} onClick={handleConfirm}>
          {isSaving ? <CircularProgress size={18} color="inherit" /> : "Elimina"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Voci Infinity ────────────────────────────────────────────────────────────

function InfinityItemDialog({ open, onClose, onSave, item }) {
  const isEdit = Boolean(item?.id);
  const [name, setName] = useState(item?.name ?? "");
  const [isActive, setIsActive] = useState(item?.is_active ?? true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  function handleOpen() {
    setName(item?.name ?? "");
    setIsActive(item?.is_active ?? true);
    setError(null);
  }

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      await onSave({ name: name.trim(), is_active: isActive });
      onClose();
    } catch (e) {
      setError(e?.message || "Errore durante il salvataggio");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={!isSaving ? onClose : undefined}
      maxWidth="xs"
      fullWidth
      TransitionProps={{ onEnter: handleOpen }}
    >
      <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", pb: 1 }}>
        <Typography variant="h6" fontWeight={700}>
          {isEdit ? "Modifica voce Infinity" : "Nuova voce Infinity"}
        </Typography>
        <IconButton size="small" onClick={onClose} disabled={isSaving} sx={{ fontSize: 16, lineHeight: 1 }}>
          ✕
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Nome voce"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            size="small"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) handleSave(); }}
          />
          <FormControlLabel
            control={<Checkbox checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />}
            label={<Typography variant="body2">Attiva</Typography>}
          />
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={isSaving}>Annulla</Button>
        <Button variant="contained" disabled={isSaving || !name.trim()} onClick={handleSave}>
          {isSaving ? <CircularProgress size={18} color="inherit" /> : isEdit ? "Salva" : "Crea voce"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function InfinityItemRow({ item, onEdit, onToggleActive, onDelete }) {
  const [menuAnchor, setMenuAnchor] = useState(null);

  return (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      sx={{
        px: 2,
        py: 1.25,
        borderRadius: 2,
        opacity: item.is_active ? 1 : 0.55,
        transition: "background 0.1s",
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" fontWeight={600} noWrap>{item.name}</Typography>
        <Typography variant="caption" color="text.secondary">
          Modificata il {new Date(item.updated_at).toLocaleDateString("it-IT")}
        </Typography>
      </Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
        <Chip
          label={item.is_active ? "Attiva" : "Inattiva"}
          size="small"
          sx={{
            bgcolor: item.is_active ? "rgba(34,197,94,0.1)" : "rgba(150,150,150,0.1)",
            color: item.is_active ? "#16a34a" : "text.disabled",
            fontWeight: 600,
            fontSize: "0.72rem",
          }}
        />
        <IconButton
          size="small"
          onClick={(e) => setMenuAnchor(e.currentTarget)}
          sx={{ color: "text.secondary", fontSize: 20, lineHeight: 1 }}
        >
          ⋮
        </IconButton>
      </Stack>

      <Menu
        anchorEl={menuAnchor}
        open={!!menuAnchor}
        onClose={() => setMenuAnchor(null)}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
      >
        <MenuItem onClick={() => { setMenuAnchor(null); onEdit(item); }}>Modifica</MenuItem>
        <MenuItem onClick={() => { setMenuAnchor(null); onToggleActive(item); }}>
          {item.is_active ? "Disattiva" : "Riattiva"}
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => { setMenuAnchor(null); onDelete(item); }} sx={{ color: "error.main" }}>
          Elimina
        </MenuItem>
      </Menu>
    </Stack>
  );
}

function InfinityItemSection({ items = [], isLoading, error, onCreate, onEdit, onDelete, onToggleActive }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteItem, setDeleteItem] = useState(null);
  const [snackbar, setSnackbar] = useState(null);

  function handleAdd() { setEditItem(null); setDialogOpen(true); }
  function handleEdit(item) { setEditItem(item); setDialogOpen(true); }

  async function handleSave(payload) {
    if (editItem) {
      await onEdit(editItem.id, payload);
      setSnackbar("Voce aggiornata");
    } else {
      await onCreate(payload);
      setSnackbar("Voce creata");
    }
  }

  async function handleConfirmDelete() {
    await onDelete(deleteItem.id);
    setSnackbar("Voce eliminata");
  }

  const activeCount = items.filter((i) => i.is_active).length;

  return (
    <>
      <Paper sx={{ p: 3, borderRadius: 3, height: "100%" }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight={700}>Voci Infinity</Typography>
            {!isLoading && items.length > 0 && (
              <Typography variant="caption" color="text.secondary">
                {activeCount} attiv{activeCount !== 1 ? "e" : "a"} su {items.length}
              </Typography>
            )}
          </Box>
          <Button variant="contained" size="small" onClick={handleAdd}>+ Aggiungi</Button>
        </Stack>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error.message}</Alert>}

        {isLoading && (
          <Stack spacing={0.5}>
            {[1, 2, 3].map((i) => <Skeleton key={i} variant="rounded" height={52} />)}
          </Stack>
        )}

        {!isLoading && items.length === 0 && (
          <Box sx={{ py: 4, textAlign: "center", border: "2px dashed", borderColor: "divider", borderRadius: 2 }}>
            <Typography variant="body2" color="text.disabled" gutterBottom>
              Nessuna voce Infinity presente
            </Typography>
            <Button size="small" variant="outlined" onClick={handleAdd} sx={{ mt: 1 }}>
              + Aggiungi la prima
            </Button>
          </Box>
        )}

        {!isLoading && items.length > 0 && (
          <Stack spacing={0.25}>
            {items.map((item, idx) => (
              <Box key={item.id}>
                <InfinityItemRow
                  item={item}
                  onEdit={handleEdit}
                  onToggleActive={(i) => onToggleActive(i.id, { is_active: !i.is_active })}
                  onDelete={setDeleteItem}
                />
                {idx < items.length - 1 && <Divider sx={{ mx: 2 }} />}
              </Box>
            ))}
          </Stack>
        )}
      </Paper>

      <InfinityItemDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
        item={editItem}
      />

      <ConfirmDeleteDialog
        open={Boolean(deleteItem)}
        onClose={() => setDeleteItem(null)}
        onConfirm={handleConfirmDelete}
        entityLabel="voce Infinity"
        name={deleteItem?.name ?? ""}
      />

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

// ── Incroci ──────────────────────────────────────────────────────────────────

// ── Field Library ─────────────────────────────────────────────────────────────

const FIELD_TYPE_LABELS = { text: "Testo", number: "Numero", date: "Data", select: "Selezione", mssql_list: "Value list (MSSQL)" };

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .slice(0, 64);
}

const EMPTY_FIELD_FORM = { field_key: "", field_label: "", field_type: "text", options: [], config: null, description: "", is_active: true };

function FieldDefinitionDialog({ open, onClose, onSave, item }) {
  const isEdit = Boolean(item?.id);
  const [form, setForm] = useState(EMPTY_FIELD_FORM);
  const [optionInput, setOptionInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const isValueList = form.field_type === "mssql_list";
  const sourceKey = form.config?.source ?? "";

  const sourcesQuery = useQuery({
    queryKey: ["value-list-sources"],
    queryFn: getValueListSources,
    enabled: open && isValueList,
  });

  // Le colonne arrivano dal server eseguendo la query della sorgente a vuoto:
  // la SQL non è mai esposta alla UI.
  const columnsQuery = useQuery({
    queryKey: ["value-list-source-columns", sourceKey],
    queryFn: () => getValueListSourceColumns(sourceKey),
    enabled: open && isValueList && Boolean(sourceKey),
  });

  // Riconcilia le colonne salvate con quelle realmente esposte dalla sorgente:
  // conserva visibilità/label di quelle ancora presenti, aggiunge le nuove e
  // scarta quelle sparite. Il confronto JSON evita il loop di render.
  useEffect(() => {
    const detected = columnsQuery.data?.columns;
    if (!detected?.length) return;
    setForm((c) => {
      if (c.field_type !== "mssql_list" || !c.config?.source) return c;
      const prev = new Map((c.config.columns ?? []).map((col) => [col.name, col]));
      const columns = detected.map((name) => prev.get(name) ?? { name, label: null, visible: true });
      const key_column = detected.includes(c.config.key_column) ? c.config.key_column : detected[0];
      const next = { ...c.config, key_column, columns };
      return JSON.stringify(next) === JSON.stringify(c.config) ? c : { ...c, config: next };
    });
  }, [columnsQuery.data]);

  function handleOpen() {
    if (item) {
      setForm({
        field_key: item.field_key ?? "",
        field_label: item.field_label ?? "",
        field_type: item.field_type ?? "text",
        options: item.options ?? [],
        config: item.config ?? null,
        description: item.description ?? "",
        is_active: item.is_active ?? true,
      });
    } else {
      setForm(EMPTY_FIELD_FORM);
    }
    setOptionInput("");
    setError(null);
  }

  function selectSource(value) {
    setForm((c) => ({ ...c, config: value ? { source: value, key_column: "", columns: [] } : null }));
  }

  function selectKeyColumn(name) {
    setForm((c) => (c.config ? { ...c, config: { ...c.config, key_column: name } } : c));
  }

  function toggleColumnVisible(name) {
    setForm((c) =>
      c.config
        ? {
            ...c,
            config: {
              ...c.config,
              columns: c.config.columns.map((col) => (col.name === name ? { ...col, visible: !col.visible } : col)),
            },
          }
        : c,
    );
  }

  function handleLabelChange(val) {
    setForm((c) => ({
      ...c,
      field_label: val,
      field_key: isEdit ? c.field_key : slugify(val),
    }));
  }

  function addOption() {
    const v = optionInput.trim();
    if (!v || form.options.includes(v)) return;
    setForm((c) => ({ ...c, options: [...c.options, v] }));
    setOptionInput("");
  }

  function removeOption(opt) {
    setForm((c) => ({ ...c, options: c.options.filter((o) => o !== opt) }));
  }

  async function handleSave() {
    if (!form.field_label.trim() || !form.field_key.trim()) return;
    setIsSaving(true);
    setError(null);
    try {
      const payload = {
        field_key: form.field_key.trim(),
        field_label: form.field_label.trim(),
        field_type: form.field_type,
        options: form.field_type === "select" ? form.options : [],
        config: isValueList ? form.config : null,
        description: form.description.trim() || null,
        ...(isEdit ? { is_active: form.is_active } : {}),
      };
      await onSave(payload);
      onClose();
    } catch (e) {
      setError(e?.message || "Errore durante il salvataggio");
    } finally {
      setIsSaving(false);
    }
  }

  const valueListReady = !isValueList || Boolean(form.config?.source && form.config?.key_column && form.config?.columns?.length);
  const canSave = Boolean(form.field_label.trim() && form.field_key.trim() && valueListReady);

  return (
    <Dialog open={open} onClose={!isSaving ? onClose : undefined} maxWidth="xs" fullWidth TransitionProps={{ onEnter: handleOpen }}>
      <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", pb: 1 }}>
        <Typography variant="h6" fontWeight={700}>{isEdit ? "Modifica campo" : "Nuovo campo"}</Typography>
        <IconButton size="small" onClick={onClose} disabled={isSaving} sx={{ fontSize: 16, lineHeight: 1 }}>✕</IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Etichetta *"
            value={form.field_label}
            onChange={(e) => handleLabelChange(e.target.value)}
            size="small"
            autoFocus
          />
          <TextField
            label="Chiave tecnica *"
            value={form.field_key}
            onChange={(e) => setForm((c) => ({ ...c, field_key: slugify(e.target.value) }))}
            size="small"
            helperText="Identificatore univoco, solo lettere/numeri/underscore"
            inputProps={{ style: { fontFamily: "monospace" } }}
          />
          <TextField
            label="Tipo campo"
            value={form.field_type}
            onChange={(e) => setForm((c) => ({ ...c, field_type: e.target.value, options: [], config: null }))}
            select
            size="small"
          >
            {Object.entries(FIELD_TYPE_LABELS).map(([v, l]) => (
              <MenuItem key={v} value={v}>{l}</MenuItem>
            ))}
          </TextField>
          {form.field_type === "select" && (
            <Box>
              <Typography variant="caption" color="text.secondary" gutterBottom>Opzioni selezione</Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 0.5, mb: 1 }}>
                <TextField
                  size="small"
                  value={optionInput}
                  onChange={(e) => setOptionInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOption(); } }}
                  placeholder="Aggiungi opzione..."
                  sx={{ flex: 1 }}
                />
                <Button size="small" variant="outlined" onClick={addOption} disabled={!optionInput.trim()}>+</Button>
              </Stack>
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                {form.options.map((opt) => (
                  <Chip key={opt} label={opt} size="small" onDelete={() => removeOption(opt)} />
                ))}
              </Stack>
            </Box>
          )}
          {isValueList && (
            <Box>
              <Typography variant="caption" color="text.secondary" gutterBottom>Sorgente MSSQL</Typography>
              <TextField
                select
                fullWidth
                size="small"
                value={sourceKey}
                onChange={(e) => selectSource(e.target.value)}
                helperText={sourcesQuery.isError ? "Impossibile caricare le sorgenti." : "La query è definita lato server; qui scegli solo la sorgente."}
                error={sourcesQuery.isError}
                sx={{ mt: 0.5 }}
              >
                {(sourcesQuery.data ?? []).map((src) => (
                  <MenuItem key={src.key} value={src.key}>{src.label}</MenuItem>
                ))}
              </TextField>

              {sourceKey && columnsQuery.isFetching && (
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5 }}>
                  <CircularProgress size={16} />
                  <Typography variant="caption" color="text.secondary">Lettura colonne…</Typography>
                </Stack>
              )}
              {sourceKey && columnsQuery.isError && (
                <Alert severity="warning" sx={{ mt: 1.5 }}>
                  Impossibile leggere le colonne dalla sorgente (MSSQL non raggiungibile?).
                </Alert>
              )}

              {form.config?.columns?.length > 0 && (
                <Box sx={{ mt: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    Colonna chiave (radio) e colonne visibili come dettaglio (checkbox). La chiave è sempre mostrata.
                  </Typography>
                  <Stack spacing={0.25} sx={{ mt: 0.75 }}>
                    {form.config.columns.map((col) => {
                      const isKey = col.name === form.config.key_column;
                      return (
                        <Stack
                          key={col.name}
                          direction="row"
                          alignItems="center"
                          spacing={1}
                          sx={{ px: 1, py: 0.5, borderRadius: 1.5, border: "1px solid", borderColor: isKey ? "primary.main" : "divider" }}
                        >
                          <input
                            type="radio"
                            name="value-list-key"
                            checked={isKey}
                            onChange={() => selectKeyColumn(col.name)}
                            title="Colonna chiave"
                          />
                          <Typography variant="body2" sx={{ flex: 1, fontFamily: "monospace" }}>{col.name}</Typography>
                          {isKey ? (
                            <Chip label="chiave" size="small" color="primary" />
                          ) : (
                            <FormControlLabel
                              control={<Checkbox size="small" checked={col.visible} onChange={() => toggleColumnVisible(col.name)} />}
                              label={<Typography variant="caption">Visibile</Typography>}
                              sx={{ mr: 0 }}
                            />
                          )}
                        </Stack>
                      );
                    })}
                  </Stack>
                </Box>
              )}
            </Box>
          )}
          <TextField
            label="Descrizione (opzionale)"
            value={form.description}
            onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))}
            size="small"
            multiline
            rows={2}
          />
          {isEdit && (
            <FormControlLabel
              control={<Checkbox checked={form.is_active} onChange={(e) => setForm((c) => ({ ...c, is_active: e.target.checked }))} />}
              label={<Typography variant="body2">Attivo</Typography>}
            />
          )}
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={isSaving}>Annulla</Button>
        <Button variant="contained" disabled={isSaving || !canSave} onClick={handleSave}>
          {isSaving ? <CircularProgress size={18} color="inherit" /> : isEdit ? "Salva" : "Crea campo"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function FieldLibrarySection({ items = [], isLoading, error, onCreate, onEdit, onDelete }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteItem, setDeleteItem] = useState(null);
  const [snackbar, setSnackbar] = useState(null);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuItem, setMenuItem] = useState(null);

  function handleAdd() { setEditItem(null); setDialogOpen(true); }
  function handleEdit(item) { setEditItem(item); setDialogOpen(true); setMenuAnchor(null); }

  async function handleSave(payload) {
    if (editItem) {
      await onEdit(editItem.id, payload);
      setSnackbar("Campo aggiornato");
    } else {
      await onCreate(payload);
      setSnackbar("Campo creato");
    }
  }

  async function handleConfirmDelete() {
    await onDelete(deleteItem.id);
    setSnackbar("Campo eliminato");
  }

  return (
    <>
      <Paper sx={{ p: 3, borderRadius: 3 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight={700}>Libreria Campi</Typography>
            {!isLoading && items.length > 0 && (
              <Typography variant="caption" color="text.secondary">{items.length} campo{items.length !== 1 ? "" : ""} disponibil{items.length !== 1 ? "i" : "e"}</Typography>
            )}
          </Box>
          <Button variant="contained" size="small" onClick={handleAdd}>+ Aggiungi</Button>
        </Stack>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error.message}</Alert>}

        {isLoading && (
          <Stack spacing={0.5}>
            {[1, 2, 3].map((i) => <Skeleton key={i} variant="rounded" height={36} />)}
          </Stack>
        )}

        {!isLoading && items.length === 0 && (
          <Box sx={{ py: 4, textAlign: "center", border: "2px dashed", borderColor: "divider", borderRadius: 2 }}>
            <Typography variant="body2" color="text.disabled" gutterBottom>Nessun campo definito</Typography>
            <Button size="small" variant="outlined" onClick={handleAdd} sx={{ mt: 0.5 }}>+ Aggiungi il primo</Button>
          </Box>
        )}

        {!isLoading && items.length > 0 && (
          <Stack spacing={0.5}>
            {items.map((fd) => (
              <Stack
                key={fd.id}
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{
                  px: 1.5,
                  py: 1,
                  borderRadius: 1.5,
                  border: "1px solid",
                  borderColor: "divider",
                  opacity: fd.is_active ? 1 : 0.5,
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600} noWrap>{fd.field_label}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>{fd.field_key}</Typography>
                </Box>
                <Chip
                  label={FIELD_TYPE_LABELS[fd.field_type] ?? fd.field_type}
                  size="small"
                  variant="outlined"
                  sx={{ fontSize: "0.68rem", height: 20 }}
                />
                <IconButton
                  size="small"
                  onClick={(e) => { setMenuAnchor(e.currentTarget); setMenuItem(fd); }}
                  sx={{ color: "text.secondary", fontSize: 18, lineHeight: 1 }}
                >
                  ⋮
                </IconButton>
              </Stack>
            ))}
          </Stack>
        )}
      </Paper>

      <Menu
        anchorEl={menuAnchor}
        open={!!menuAnchor}
        onClose={() => setMenuAnchor(null)}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
      >
        <MenuItem onClick={() => handleEdit(menuItem)}>Modifica</MenuItem>
        <Divider />
        <MenuItem onClick={() => { setDeleteItem(menuItem); setMenuAnchor(null); }} sx={{ color: "error.main" }}>Elimina</MenuItem>
      </Menu>

      <FieldDefinitionDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
        item={editItem}
      />

      <ConfirmDeleteDialog
        open={Boolean(deleteItem)}
        onClose={() => setDeleteItem(null)}
        onConfirm={handleConfirmDelete}
        entityLabel="campo"
        name={deleteItem?.field_label ?? ""}
      />

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

function InfinityMapDialog({ open, onClose, onSave, item, infinityItems, customerSuppliers, operationalAreas, fieldDefinitions }) {
  const isEdit = Boolean(item?.id);
  const [form, setForm] = useState({
    infinityBillingItem: null,
    customerSupplier: null,
    jupiterDescription: "",
    operationalArea: null,
    buildings: [],
    isActive: true,
  });
  const [fieldAssignments, setFieldAssignments] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const [warningOpen, setWarningOpen] = useState(false);

  function handleOpen() {
    if (item) {
      setForm({
        infinityBillingItem: infinityItems.find((e) => e.id === item.infinity_billing_item_id) ?? null,
        customerSupplier: customerSuppliers.find((e) => e.code === item.customer_supplier_code) ?? {
          code: item.customer_supplier_code,
          description: item.customer_supplier_description,
        },
        jupiterDescription: item.jupiter_description ?? "",
        operationalArea: operationalAreas.find((e) => e.id === item.operational_area_id) ?? null,
        buildings: item.buildings ?? [],
        isActive: item.is_active,
      });
      setFieldAssignments(
        (item.field_assignments ?? [])
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((fa) => ({
            field_def: fieldDefinitions.find((fd) => fd.id === fa.field_definition_id) ?? null,
            is_required: fa.is_required,
          }))
          .filter((fa) => fa.field_def !== null)
      );
    } else {
      setForm({ infinityBillingItem: null, customerSupplier: null, jupiterDescription: "", operationalArea: null, buildings: [], isActive: true });
      setFieldAssignments([]);
    }
    setError(null);
    setWarningOpen(false);
  }

  function addFieldDef(fd) {
    if (!fd || fieldAssignments.some((a) => a.field_def.id === fd.id)) return;
    setFieldAssignments((c) => [...c, { field_def: fd, is_required: false }]);
  }

  function removeFieldAssignment(idx) {
    setFieldAssignments((c) => c.filter((_, i) => i !== idx));
  }

  // L'ordine nell'array determina sort_order al salvataggio.
  function moveFieldAssignment(idx, dir) {
    setFieldAssignments((c) => {
      const target = idx + dir;
      if (target < 0 || target >= c.length) return c;
      const next = [...c];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  function toggleRequired(idx) {
    setFieldAssignments((c) => c.map((a, i) => i === idx ? { ...a, is_required: !a.is_required } : a));
  }

  async function performSave() {
    if (!form.infinityBillingItem || !form.customerSupplier) return;
    setIsSaving(true);
    setError(null);
    try {
      const mapPayload = {
        infinity_billing_item_id: form.infinityBillingItem.id,
        customer_supplier_code: form.customerSupplier.code,
        customer_supplier_description: form.customerSupplier.description,
        jupiter_description: form.jupiterDescription.trim() || null,
        operational_area_id: form.operationalArea?.id ?? null,
        buildings: form.buildings,
        is_active: form.isActive,
      };
      const assignments = fieldAssignments.map((a, idx) => ({
        field_definition_id: a.field_def.id,
        is_required: a.is_required,
        sort_order: idx,
      }));
      await onSave({ mapPayload, assignments });
      setWarningOpen(false);
      onClose();
    } catch (e) {
      setError(e?.message || "Errore durante il salvataggio");
    } finally {
      setIsSaving(false);
    }
  }

  function handleSave() {
    if (isEdit) {
      setWarningOpen(true);
      return;
    }
    performSave();
  }

  const canSave = Boolean(form.infinityBillingItem && form.customerSupplier);
  const availableFieldDefs = fieldDefinitions.filter((fd) => fd.is_active && !fieldAssignments.some((a) => a.field_def.id === fd.id));

  return (
    <>
    <Dialog
      open={open}
      onClose={!isSaving ? onClose : undefined}
      maxWidth="sm"
      fullWidth
      TransitionProps={{ onEnter: handleOpen }}
    >
      <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", pb: 1 }}>
        <Typography variant="h6" fontWeight={700}>
          {isEdit ? "Modifica incrocio" : "Nuovo incrocio"}
        </Typography>
        <IconButton size="small" onClick={onClose} disabled={isSaving} sx={{ fontSize: 16, lineHeight: 1 }}>
          ✕
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Autocomplete
            options={operationalAreas}
            value={form.operationalArea}
            onChange={(_, value) => setForm((c) => ({ ...c, operationalArea: value, buildings: [] }))}
            getOptionLabel={(o) => o.name}
            isOptionEqualToValue={(o, v) => o.id === v.id}
            renderInput={(params) => <TextField {...params} label="Area operativa" size="small" />}
          />
          <Autocomplete
            multiple
            options={reportingBuildingCodes(form.operationalArea?.buildings)}
            value={form.buildings}
            onChange={(_, value) => setForm((c) => ({ ...c, buildings: value }))}
            disabled={!form.operationalArea || reportingBuildingCodes(form.operationalArea?.buildings).length === 0}
            renderInput={(params) => <TextField {...params} label="Immobili" size="small" />}
          />
          <Autocomplete
            options={customerSuppliers}
            value={form.customerSupplier}
            onChange={(_, value) => setForm((c) => ({ ...c, customerSupplier: value }))}
            getOptionLabel={(o) => `${o.description} (${o.code})`}
            isOptionEqualToValue={(o, v) => o.code === v.code}
            renderInput={(params) => <TextField {...params} label="Cliente / Fornitore *" size="small" />}
          />
          {form.customerSupplier && (
            <TextField
              label="Codice"
              value={form.customerSupplier.code}
              size="small"
              InputProps={{ readOnly: true }}
              sx={{ bgcolor: "action.hover" }}
            />
          )}
          <Autocomplete
            options={infinityItems}
            value={form.infinityBillingItem}
            onChange={(_, value) => setForm((c) => ({ ...c, infinityBillingItem: value }))}
            getOptionLabel={(o) => o.name}
            isOptionEqualToValue={(o, v) => o.id === v.id}
            renderInput={(params) => <TextField {...params} label="Voce Infinity *" size="small" />}
          />
          <TextField
            label="Descrizione Jupiter"
            value={form.jupiterDescription}
            onChange={(e) => setForm((c) => ({ ...c, jupiterDescription: e.target.value }))}
            size="small"
          />
          <FormControlLabel
            control={<Checkbox checked={form.isActive} onChange={(e) => setForm((c) => ({ ...c, isActive: e.target.checked }))} />}
            label={<Typography variant="body2">Attivo</Typography>}
          />

          {/* ── Campi extra ── */}
          <Box>
            <Divider sx={{ mb: 1.5 }} />
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>Campi extra</Typography>
            <Autocomplete
              options={availableFieldDefs}
              value={null}
              onChange={(_, fd) => { addFieldDef(fd); }}
              getOptionLabel={(o) => o.field_label}
              isOptionEqualToValue={(o, v) => o.id === v.id}
              renderInput={(params) => <TextField {...params} label="Aggiungi campo..." size="small" />}
              disabled={availableFieldDefs.length === 0}
              blurOnSelect
            />
            {fieldAssignments.length > 0 && (
              <Stack spacing={0.5} sx={{ mt: 1 }}>
                {fieldAssignments.map((fa, idx) => (
                  <Stack
                    key={fa.field_def.id}
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    sx={{ px: 1.5, py: 0.75, borderRadius: 1.5, border: "1px solid", borderColor: "divider" }}
                  >
                    <Stack sx={{ mr: 0.25 }}>
                      <Tooltip title="Sposta su">
                        <span>
                          <IconButton
                            size="small"
                            disabled={idx === 0}
                            onClick={() => moveFieldAssignment(idx, -1)}
                            sx={{ p: 0.25, fontSize: 11, lineHeight: 1 }}
                          >
                            ▲
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Sposta giù">
                        <span>
                          <IconButton
                            size="small"
                            disabled={idx === fieldAssignments.length - 1}
                            onClick={() => moveFieldAssignment(idx, 1)}
                            sx={{ p: 0.25, fontSize: 11, lineHeight: 1 }}
                          >
                            ▼
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={500} noWrap>{fa.field_def.field_label}</Typography>
                      <Typography variant="caption" color="text.secondary">{FIELD_TYPE_LABELS[fa.field_def.field_type] ?? fa.field_def.field_type}</Typography>
                    </Box>
                    <FormControlLabel
                      control={
                        <Checkbox
                          size="small"
                          checked={fa.is_required}
                          onChange={() => toggleRequired(idx)}
                        />
                      }
                      label={<Typography variant="caption">Obbligatorio</Typography>}
                      sx={{ mr: 0 }}
                    />
                    <IconButton size="small" onClick={() => removeFieldAssignment(idx)} sx={{ color: "error.light" }}>✕</IconButton>
                  </Stack>
                ))}
              </Stack>
            )}
            {fieldAssignments.length === 0 && fieldDefinitions.length === 0 && (
              <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 0.5 }}>
                Nessun campo disponibile — crea prima i campi nella Libreria.
              </Typography>
            )}
          </Box>

          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={isSaving}>Annulla</Button>
        <Button variant="contained" disabled={isSaving || !canSave} onClick={handleSave}>
          {isSaving ? <CircularProgress size={18} color="inherit" /> : isEdit ? "Salva" : "Crea incrocio"}
        </Button>
      </DialogActions>
    </Dialog>
    <Dialog
      open={warningOpen}
      onClose={!isSaving ? () => setWarningOpen(false) : undefined}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle sx={{ color: "error.main", fontWeight: 800 }}>
        Attenzione: modifica dello storico
      </DialogTitle>
      <DialogContent>
        <Alert severity="error" variant="filled" sx={{ mb: 2 }}>
          La modifica di questo incrocio aggiornerà anche le rendicontazioni operative storiche collegate.
        </Alert>
        <Typography variant="body2" sx={{ mb: 1 }}>
          Codice cliente, descrizione cliente e Descrizione Jupiter saranno propagati ai box già salvati e confermati.
          Tempi, note e attribuzioni non verranno modificati.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Se l’incrocio verrà eliminato in futuro, lo storico conserverà invece l’ultima configurazione propagata.
        </Typography>
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={() => setWarningOpen(false)} disabled={isSaving}>Annulla</Button>
        <Button color="error" variant="contained" disabled={isSaving} onClick={performSave}>
          {isSaving ? <CircularProgress size={18} color="inherit" /> : "Conferma e propaga"}
        </Button>
      </DialogActions>
    </Dialog>
    </>
  );
}

function DuplicateClientDialog({ open, onClose, onConfirm, sourceItem, relatedCount, customerSuppliers }) {
  const [target, setTarget] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setTarget(null);
      setError(null);
    }
  }, [open]);

  async function handleConfirm() {
    if (!target) return;
    setIsSaving(true);
    setError(null);
    try {
      await onConfirm(target);
      onClose();
    } catch (e) {
      setError(e?.message || "Errore durante la duplicazione");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={!isSaving ? onClose : undefined} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", pb: 1 }}>
        <Typography variant="h6" fontWeight={700}>Duplica cliente</Typography>
        <IconButton size="small" onClick={onClose} disabled={isSaving} sx={{ fontSize: 16, lineHeight: 1 }}>✕</IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Verranno duplicati {relatedCount} incroci{relatedCount !== 1 ? "" : ""} di{" "}
            <strong>{sourceItem?.customer_supplier_description || sourceItem?.customer_supplier_code}</strong> sul nuovo Cliente / Fornitore selezionato, comprese aree, immobili e campi obbligatori configurati.
          </Typography>
          <Autocomplete
            options={customerSuppliers.filter((cs) => cs.code.toLowerCase() !== sourceItem?.customer_supplier_code?.toLowerCase())}
            value={target}
            onChange={(_, value) => setTarget(value)}
            getOptionLabel={(o) => `${o.description} (${o.code})`}
            isOptionEqualToValue={(o, v) => o.code === v.code}
            renderInput={(params) => <TextField {...params} label="Nuovo Cliente / Fornitore *" size="small" autoFocus />}
          />
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={isSaving}>Annulla</Button>
        <Button variant="contained" disabled={isSaving || !target} onClick={handleConfirm}>
          {isSaving ? <CircularProgress size={18} color="inherit" /> : "Duplica cliente"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function InfinityMapRow({ item, onEdit, onDuplicate, onDuplicateClient, onToggleActive, onDelete }) {
  const [menuAnchor, setMenuAnchor] = useState(null);

  return (
    <TableRow hover>
      <TableCell>
        {item.operational_area_name ? (
          <Box
            sx={{
              display: "inline-block",
              px: 0.75,
              py: 0.2,
              borderRadius: 1,
              bgcolor: "rgba(0,112,64,0.1)",
              color: "primary.main",
              fontWeight: 700,
              fontSize: "0.78rem",
            }}
          >
            {item.operational_area_name}
          </Box>
        ) : (
          <Typography variant="caption" color="text.disabled">—</Typography>
        )}
      </TableCell>
      <TableCell>
        {item.buildings?.length > 0 ? (
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {item.buildings.map((b) => (
              <Chip key={b} label={b} size="small" variant="outlined" sx={{ fontSize: "0.72rem" }} />
            ))}
          </Stack>
        ) : (
          <Typography variant="caption" color="text.disabled">—</Typography>
        )}
      </TableCell>
      <TableCell>
        <Typography variant="body2" fontWeight={500} noWrap sx={{ maxWidth: 220 }}>
          {item.customer_supplier_description || "—"}
        </Typography>
      </TableCell>
      <TableCell>
        <Typography
          variant="caption"
          sx={{ fontFamily: "monospace", bgcolor: "action.hover", px: 0.75, py: 0.25, borderRadius: 0.75 }}
        >
          {item.customer_supplier_code}
        </Typography>
      </TableCell>
      <TableCell>
        <Typography variant="body2" noWrap sx={{ maxWidth: 180 }}>{item.infinity_billing_item_name || "—"}</Typography>
      </TableCell>
      <TableCell>
        <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 160 }}>
          {item.jupiter_description || "—"}
        </Typography>
      </TableCell>
      <TableCell>
        {item.field_assignments?.length > 0 ? (
          <Chip
            label={`${item.field_assignments.length} campo${item.field_assignments.length !== 1 ? "" : ""}`}
            size="small"
            variant="outlined"
            sx={{ fontSize: "0.68rem", height: 20 }}
          />
        ) : (
          <Typography variant="caption" color="text.disabled">—</Typography>
        )}
      </TableCell>
      <TableCell>
        <Chip
          label={item.is_active ? "Attivo" : "Inattivo"}
          size="small"
          sx={{
            bgcolor: item.is_active ? "rgba(34,197,94,0.1)" : "rgba(150,150,150,0.1)",
            color: item.is_active ? "#16a34a" : "text.disabled",
            fontWeight: 600,
            fontSize: "0.72rem",
          }}
        />
      </TableCell>
      <TableCell>
        <Typography variant="caption" color="text.secondary" noWrap>
          {new Date(item.updated_at).toLocaleDateString("it-IT")}
        </Typography>
      </TableCell>
      <TableCell align="right" sx={{ pr: 1 }}>
        <Tooltip title="Duplica incrocio">
          <IconButton
            size="small"
            onClick={() => onDuplicate(item)}
            sx={{ color: "text.secondary", mr: 0.25 }}
          >
            <DuplicateIcon size={17} />
          </IconButton>
        </Tooltip>
        <IconButton
          size="small"
          onClick={(e) => setMenuAnchor(e.currentTarget)}
          sx={{ color: "text.secondary", fontSize: 20, lineHeight: 1 }}
        >
          ⋮
        </IconButton>
        <Menu
          anchorEl={menuAnchor}
          open={!!menuAnchor}
          onClose={() => setMenuAnchor(null)}
          transformOrigin={{ horizontal: "right", vertical: "top" }}
          anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
        >
          <MenuItem onClick={() => { setMenuAnchor(null); onEdit(item); }}>Modifica</MenuItem>
          <MenuItem onClick={() => { setMenuAnchor(null); onDuplicate(item); }}>Duplica</MenuItem>
          <MenuItem onClick={() => { setMenuAnchor(null); onDuplicateClient(item); }}>Duplica cliente...</MenuItem>
          <MenuItem onClick={() => { setMenuAnchor(null); onToggleActive(item); }}>
            {item.is_active ? "Disattiva" : "Riattiva"}
          </MenuItem>
          <Divider />
          <MenuItem onClick={() => { setMenuAnchor(null); onDelete(item); }} sx={{ color: "error.main" }}>
            Elimina
          </MenuItem>
        </Menu>
      </TableCell>
    </TableRow>
  );
}

function InfinityMapSection({ items = [], isLoading, error, infinityItems, customerSuppliers, operationalAreas, fieldDefinitions, onCreate, onEdit, onDelete, onToggleActive, onReplaceAssignments }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [dialogItem, setDialogItem] = useState(null);
  const [deleteItem, setDeleteItem] = useState(null);
  const [duplicateClientItem, setDuplicateClientItem] = useState(null);
  const [clientFilter, setClientFilter] = useState(null);
  const [snackbar, setSnackbar] = useState(null);

  function handleAdd() { setEditItem(null); setDialogItem(null); setDialogOpen(true); }
  function handleEdit(item) { setEditItem(item); setDialogItem(item); setDialogOpen(true); }
  function handleDuplicate(item) {
    setEditItem(null);
    setDialogItem({ ...item, id: undefined });
    setDialogOpen(true);
  }

  async function handleSave({ mapPayload, assignments }) {
    let mapId;
    if (editItem) {
      await onEdit(editItem.id, mapPayload);
      mapId = editItem.id;
      setSnackbar("Incrocio aggiornato");
    } else {
      const newMap = await onCreate(mapPayload);
      mapId = newMap.id;
      setSnackbar(dialogItem ? "Incrocio duplicato" : "Incrocio creato");
    }
    await onReplaceAssignments(mapId, assignments);
  }

  async function handleConfirmDelete() {
    await onDelete(deleteItem.id);
    setSnackbar("Incrocio eliminato");
  }

  const relatedClientItems = duplicateClientItem
    ? items.filter(
        (i) => i.customer_supplier_code.toLowerCase() === duplicateClientItem.customer_supplier_code.toLowerCase()
      )
    : [];

  async function handleConfirmDuplicateClient(target) {
    let created = 0;
    let skipped = 0;
    for (const src of relatedClientItems) {
      const mapPayload = {
        infinity_billing_item_id: src.infinity_billing_item_id,
        customer_supplier_code: target.code,
        customer_supplier_description: target.description,
        jupiter_description: src.jupiter_description ?? null,
        operational_area_id: src.operational_area_id ?? null,
        buildings: src.buildings ?? [],
        is_active: src.is_active,
      };
      try {
        const newMap = await onCreate(mapPayload);
        const assignments = (src.field_assignments ?? []).map((fa, idx) => ({
          field_definition_id: fa.field_definition_id,
          is_required: fa.is_required,
          sort_order: idx,
        }));
        if (assignments.length > 0) {
          await onReplaceAssignments(newMap.id, assignments);
        }
        created += 1;
      } catch {
        skipped += 1;
      }
    }
    setSnackbar(
      skipped > 0
        ? `${created} incroci duplicati su "${target.description}", ${skipped} già esistenti`
        : `${created} incroci duplicati su "${target.description}"`
    );
  }

  const activeCount = items.filter((i) => i.is_active).length;

  // Clienti / Fornitori distinti presenti fra gli incroci, per i filtri.
  const clientOptions = [
    ...items
      .reduce((map, i) => {
        if (!map.has(i.customer_supplier_code)) {
          map.set(i.customer_supplier_code, i.customer_supplier_description || i.customer_supplier_code);
        }
        return map;
      }, new Map())
      .entries(),
  ]
    .map(([code, description]) => ({ code, description }))
    .sort((a, b) => a.description.localeCompare(b.description));

  // Se il cliente filtrato sparisce (incrocio eliminato), torna a "Tutti".
  const activeFilterExists = clientFilter === null || clientOptions.some((c) => c.code === clientFilter);
  const effectiveFilter = activeFilterExists ? clientFilter : null;
  const filteredItems = effectiveFilter
    ? items.filter((i) => i.customer_supplier_code === effectiveFilter)
    : items;

  return (
    <>
      <Paper sx={{ p: 3, borderRadius: 3 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight={700}>Incroci Infinity / Cliente-Fornitore</Typography>
            {!isLoading && items.length > 0 && (
              <Typography variant="caption" color="text.secondary">
                {activeCount} attiv{activeCount !== 1 ? "i" : "o"} su {items.length}
              </Typography>
            )}
          </Box>
          <Button variant="contained" size="small" onClick={handleAdd}>+ Aggiungi</Button>
        </Stack>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error.message}</Alert>}

        {!isLoading && clientOptions.length > 1 && (
          <Stack direction="row" useFlexGap sx={{ mb: 2, flexWrap: "wrap", gap: 1, alignItems: "center" }}>
            <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>Cliente:</Typography>
            <Chip
              label="Tutti"
              size="small"
              color={effectiveFilter === null ? "primary" : "default"}
              variant={effectiveFilter === null ? "filled" : "outlined"}
              onClick={() => setClientFilter(null)}
            />
            {clientOptions.map((c) => (
              <Chip
                key={c.code}
                label={c.description}
                size="small"
                color={effectiveFilter === c.code ? "primary" : "default"}
                variant={effectiveFilter === c.code ? "filled" : "outlined"}
                onClick={() => setClientFilter(effectiveFilter === c.code ? null : c.code)}
              />
            ))}
          </Stack>
        )}

        {isLoading && (
          <Stack spacing={0.5}>
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} variant="rounded" height={44} />)}
          </Stack>
        )}

        {!isLoading && items.length === 0 && (
          <Box sx={{ py: 5, textAlign: "center", border: "2px dashed", borderColor: "divider", borderRadius: 2 }}>
            <Typography variant="body2" color="text.disabled" gutterBottom>
              Nessun incrocio configurato
            </Typography>
            <Button size="small" variant="outlined" onClick={handleAdd} sx={{ mt: 1 }}>
              + Aggiungi il primo
            </Button>
          </Box>
        )}

        {!isLoading && items.length > 0 && (
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small" sx={tableSx({ minWidth: 900, dense: true })}>
              <TableHead>
                <TableRow>
                  <TableCell>Area</TableCell>
                  <TableCell>Immobili</TableCell>
                  <TableCell>Cliente / Fornitore</TableCell>
                  <TableCell>Codice</TableCell>
                  <TableCell>Voce Infinity</TableCell>
                  <TableCell>Descrizione Jupiter</TableCell>
                  <TableCell>Campi</TableCell>
                  <TableCell>Stato</TableCell>
                  <TableCell>Aggiornato</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredItems.map((item) => (
                  <InfinityMapRow
                    key={item.id}
                    item={item}
                    onEdit={handleEdit}
                    onDuplicate={handleDuplicate}
                    onDuplicateClient={setDuplicateClientItem}
                    onToggleActive={(i) => onToggleActive(i.id, { is_active: !i.is_active })}
                    onDelete={setDeleteItem}
                  />
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Paper>

      <InfinityMapDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
        item={dialogItem}
        infinityItems={infinityItems}
        customerSuppliers={customerSuppliers}
        operationalAreas={operationalAreas}
        fieldDefinitions={fieldDefinitions}
      />

      <DuplicateClientDialog
        open={Boolean(duplicateClientItem)}
        onClose={() => setDuplicateClientItem(null)}
        onConfirm={handleConfirmDuplicateClient}
        sourceItem={duplicateClientItem}
        relatedCount={relatedClientItems.length}
        customerSuppliers={customerSuppliers}
      />

      <ConfirmDeleteDialog
        open={Boolean(deleteItem)}
        onClose={() => setDeleteItem(null)}
        onConfirm={handleConfirmDelete}
        entityLabel="incrocio"
        name={deleteItem ? `${deleteItem.infinity_billing_item_name ?? ""} / ${deleteItem.customer_supplier_description ?? ""}` : ""}
      />

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

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const queryClient = useQueryClient();
  const [paramsOpen, setParamsOpen] = useState(false);
  const [paramsTab, setParamsTab] = useState(0);

  const infinityItemsQuery = useQuery({
    queryKey: ["infinity-billing-items", "all"],
    queryFn: () => getInfinityBillingItems({ activeOnly: false }),
  });

  const workloadCustomerSuppliersQuery = useQuery({
    queryKey: ["workload-customer-suppliers"],
    queryFn: () => getWorkloadCustomerSuppliers(),
    staleTime: 1000 * 60 * 30,
  });

  const operationalAreasQuery = useQuery({
    queryKey: ["operational-areas", "all"],
    queryFn: () => getOperationalAreas({ activeOnly: false }),
    staleTime: 1000 * 60 * 30,
  });

  const infinityMapQuery = useQuery({
    queryKey: ["infinity-billing-customer-supplier-map"],
    queryFn: () => getInfinityBillingCustomerSupplierMap(),
  });

  const fieldDefinitionsQuery = useQuery({
    queryKey: ["field-definitions"],
    queryFn: () => getFieldDefinitions(),
  });

  const createInfinityMutation = useMutation({
    mutationFn: createInfinityBillingItem,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["infinity-billing-items"] }),
  });

  const updateInfinityMutation = useMutation({
    mutationFn: ({ id, payload }) => updateInfinityBillingItem(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["infinity-billing-items"] }),
  });

  const deleteInfinityMutation = useMutation({
    mutationFn: deleteInfinityBillingItem,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["infinity-billing-items"] }),
  });

  const createInfinityMapMutation = useMutation({
    mutationFn: createInfinityBillingCustomerSupplierMap,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["infinity-billing-customer-supplier-map"] }),
  });

  const updateInfinityMapMutation = useMutation({
    mutationFn: ({ id, payload }) => updateInfinityBillingCustomerSupplierMap(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["infinity-billing-customer-supplier-map"] }),
  });

  const deleteInfinityMapMutation = useMutation({
    mutationFn: deleteInfinityBillingCustomerSupplierMap,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["infinity-billing-customer-supplier-map"] }),
  });

  const replaceAssignmentsMutation = useMutation({
    mutationFn: ({ mapId, assignments }) => replaceInfinityMapFieldAssignments(mapId, assignments),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["infinity-billing-customer-supplier-map"] }),
  });

  const createFieldDefMutation = useMutation({
    mutationFn: createFieldDefinition,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["field-definitions"] }),
  });

  const updateFieldDefMutation = useMutation({
    mutationFn: ({ id, payload }) => updateFieldDefinition(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["field-definitions"] }),
  });

  const deleteFieldDefMutation = useMutation({
    mutationFn: deleteFieldDefinition,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["field-definitions"] }),
  });

  const infinityItemsCount = infinityItemsQuery.data?.length ?? 0;
  const fieldDefinitionsCount = fieldDefinitionsQuery.data?.length ?? 0;

  return (
    <Stack spacing={3}>
      {/* ── Header ── */}
      <PageHeader
        section="Configurazione"
        title="Jupiter"
        actions={<HeaderButton onClick={() => setParamsOpen(true)} startIcon={<GearIcon />}>Parametri</HeaderButton>}
      />

      {/* ── Tabella incroci: elemento centrale della pagina ── */}
      <InfinityMapSection
        items={infinityMapQuery.data ?? []}
        isLoading={infinityMapQuery.isLoading}
        error={infinityMapQuery.error}
        infinityItems={infinityItemsQuery.data ?? []}
        customerSuppliers={workloadCustomerSuppliersQuery.data ?? []}
        operationalAreas={operationalAreasQuery.data ?? []}
        fieldDefinitions={fieldDefinitionsQuery.data ?? []}
        onCreate={(payload) => createInfinityMapMutation.mutateAsync(payload)}
        onEdit={(id, payload) => updateInfinityMapMutation.mutateAsync({ id, payload })}
        onDelete={(id) => deleteInfinityMapMutation.mutateAsync(id)}
        onToggleActive={(id, payload) => updateInfinityMapMutation.mutateAsync({ id, payload })}
        onReplaceAssignments={(mapId, assignments) => replaceAssignmentsMutation.mutateAsync({ mapId, assignments })}
      />

      {/* ── Drawer parametri: voci Infinity + libreria campi, non sempre visibili ── */}
      <Drawer
        anchor="right"
        open={paramsOpen}
        onClose={() => setParamsOpen(false)}
        slotProps={{ paper: { sx: { width: { xs: "100%", sm: 420 }, p: 2.5 } } }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="h6" fontWeight={700}>Parametri incroci</Typography>
          <IconButton size="small" onClick={() => setParamsOpen(false)} sx={{ fontSize: 16, lineHeight: 1 }}>✕</IconButton>
        </Stack>
        <Tabs
          value={paramsTab}
          onChange={(_, v) => setParamsTab(v)}
          variant="fullWidth"
          sx={{ mb: 2, borderBottom: "1px solid", borderColor: "divider" }}
        >
          <Tab label={`Voci Infinity${infinityItemsCount ? ` (${infinityItemsCount})` : ""}`} sx={{ textTransform: "none" }} />
          <Tab label={`Libreria Campi${fieldDefinitionsCount ? ` (${fieldDefinitionsCount})` : ""}`} sx={{ textTransform: "none" }} />
        </Tabs>

        {paramsTab === 0 && (
          <InfinityItemSection
            items={infinityItemsQuery.data ?? []}
            isLoading={infinityItemsQuery.isLoading}
            error={infinityItemsQuery.error}
            onCreate={(payload) => createInfinityMutation.mutateAsync(payload)}
            onEdit={(id, payload) => updateInfinityMutation.mutateAsync({ id, payload })}
            onDelete={(id) => deleteInfinityMutation.mutateAsync(id)}
            onToggleActive={(id, payload) => updateInfinityMutation.mutateAsync({ id, payload })}
          />
        )}

        {paramsTab === 1 && (
          <FieldLibrarySection
            items={fieldDefinitionsQuery.data ?? []}
            isLoading={fieldDefinitionsQuery.isLoading}
            error={fieldDefinitionsQuery.error}
            onCreate={(payload) => createFieldDefMutation.mutateAsync(payload)}
            onEdit={(id, payload) => updateFieldDefMutation.mutateAsync({ id, payload })}
            onDelete={(id) => deleteFieldDefMutation.mutateAsync(id)}
          />
        )}
      </Drawer>
    </Stack>
  );
}
