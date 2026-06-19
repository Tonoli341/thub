import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Skeleton,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";

import {
  createOrgDepartment,
  createOrgFunction,
  deleteOrgDepartment,
  deleteOrgFunction,
  getEmployeeOptions,
  getOrgDepartments,
  getOrgFunctions,
  updateOrgDepartment,
  updateOrgFunction,
} from "../api";

function EntityDialog({ open, onClose, onSave, item, entityLabel }) {
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
      <DialogTitle
        sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", pb: 1 }}
      >
        <Typography variant="h6" fontWeight={700}>
          {isEdit ? `Modifica ${entityLabel}` : `Nuova ${entityLabel}`}
        </Typography>
        <IconButton size="small" onClick={onClose} disabled={isSaving} sx={{ fontSize: 16, lineHeight: 1 }}>
          ✕
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Nome"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            size="small"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) handleSave(); }}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
            }
            label={<Typography variant="body2">Attivo</Typography>}
          />
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={isSaving}>Annulla</Button>
        <Button
          variant="contained"
          disabled={isSaving || !name.trim()}
          onClick={handleSave}
        >
          {isSaving
            ? <CircularProgress size={18} color="inherit" />
            : isEdit ? "Salva" : `Crea ${entityLabel.toLowerCase()}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

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
    <Dialog open={open} onClose={!isSaving ? onClose : undefined} maxWidth="xs" fullWidth>
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

function DepartmentDialog({ open, onClose, onSave, item, employeeOptions, orgFunctions }) {
  const isEdit = Boolean(item?.id);
  const [name, setName] = useState(item?.name ?? "");
  const [isActive, setIsActive] = useState(item?.is_active ?? true);
  const [responsibleId, setResponsibleId] = useState(item?.responsible_employee_id ?? null);
  const [functionId, setFunctionId] = useState(item?.function_id ?? null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  function handleOpen() {
    setName(item?.name ?? "");
    setIsActive(item?.is_active ?? true);
    setResponsibleId(item?.responsible_employee_id ?? null);
    setFunctionId(item?.function_id ?? null);
    setError(null);
  }

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      await onSave({ name: name.trim(), is_active: isActive, responsible_employee_id: responsibleId, function_id: functionId });
      onClose();
    } catch (e) {
      setError(e?.message || "Errore durante il salvataggio");
    } finally {
      setIsSaving(false);
    }
  }

  const selectedEmployee = (employeeOptions ?? []).find((e) => e.id === responsibleId) ?? null;
  const selectedFunction = (orgFunctions ?? []).find((f) => f.id === functionId) ?? null;

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
          {isEdit ? "Modifica Dipartimento" : "Nuovo Dipartimento"}
        </Typography>
        <IconButton size="small" onClick={onClose} disabled={isSaving} sx={{ fontSize: 16, lineHeight: 1 }}>
          ✕
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Nome"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            size="small"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) handleSave(); }}
          />
          <Autocomplete
            options={(orgFunctions ?? []).filter((f) => f.is_active)}
            value={selectedFunction}
            onChange={(_, v) => setFunctionId(v?.id ?? null)}
            getOptionLabel={(o) => o.name}
            isOptionEqualToValue={(o, v) => o.id === v.id}
            renderInput={(params) => (
              <TextField {...params} label="Funzione" size="small" />
            )}
            noOptionsText="Nessuna funzione disponibile"
          />
          <Autocomplete
            options={employeeOptions ?? []}
            value={selectedEmployee}
            onChange={(_, v) => setResponsibleId(v?.id ?? null)}
            getOptionLabel={(o) => `${o.full_name} (${o.tms_id})`}
            isOptionEqualToValue={(o, v) => o.id === v.id}
            renderInput={(params) => (
              <TextField {...params} label="Responsabile di dipartimento" size="small" />
            )}
            noOptionsText="Nessun dipendente disponibile"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
            }
            label={<Typography variant="body2">Attivo</Typography>}
          />
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={isSaving}>Annulla</Button>
        <Button
          variant="contained"
          disabled={isSaving || !name.trim()}
          onClick={handleSave}
        >
          {isSaving
            ? <CircularProgress size={18} color="inherit" />
            : isEdit ? "Salva" : "Crea dipartimento"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DepartmentRow({ item, onEdit, onToggleActive, onDelete }) {
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
        <Typography variant="body2" fontWeight={600} noWrap>
          {item.name}
        </Typography>
        {item.function_name && (
          <Typography variant="caption" color="primary.main" noWrap sx={{ display: "block", fontWeight: 600 }}>
            {item.function_name}
          </Typography>
        )}
        {item.responsible_employee_name && (
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
            👤 {item.responsible_employee_name}
          </Typography>
        )}
      </Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
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

function DepartmentSection({ items = [], isLoading, error, employeeOptions, orgFunctions, onCreate, onEdit, onDelete, onToggleActive }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteItem, setDeleteItem] = useState(null);
  const [snackbar, setSnackbar] = useState(null);

  function handleAdd() {
    setEditItem(null);
    setDialogOpen(true);
  }

  function handleEdit(item) {
    setEditItem(item);
    setDialogOpen(true);
  }

  async function handleSave(payload) {
    if (editItem) {
      await onEdit(editItem.id, payload);
      setSnackbar("Dipartimento aggiornato");
    } else {
      await onCreate(payload);
      setSnackbar("Dipartimento creato");
    }
  }

  async function handleConfirmDelete() {
    await onDelete(deleteItem.id);
    setSnackbar("Dipartimento eliminato");
  }

  const activeCount = items.filter((i) => i.is_active).length;

  return (
    <>
      <Paper sx={{ p: 3, borderRadius: 3, height: "100%" }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight={700}>Dipartimenti</Typography>
            {!isLoading && items.length > 0 && (
              <Typography variant="caption" color="text.secondary">
                {activeCount} attiv{activeCount !== 1 ? "i" : "o"} su {items.length}
              </Typography>
            )}
          </Box>
          <Button variant="contained" size="small" onClick={handleAdd}>
            + Aggiungi
          </Button>
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
              Nessun dipartimento presente
            </Typography>
            <Button size="small" variant="outlined" onClick={handleAdd} sx={{ mt: 1 }}>
              + Aggiungi il primo
            </Button>
          </Box>
        )}

        {!isLoading && items.length > 0 && (
          <Stack spacing={0.25}>
            {items.map((item, idx) => (
              <Box key={item.id}>
                <DepartmentRow
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

      <DepartmentDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
        item={editItem}
        employeeOptions={employeeOptions}
        orgFunctions={orgFunctions}
      />

      <ConfirmDeleteDialog
        open={Boolean(deleteItem)}
        onClose={() => setDeleteItem(null)}
        onConfirm={handleConfirmDelete}
        entityLabel="Dipartimento"
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

function FunctionDialog({ open, onClose, onSave, item, employeeOptions }) {
  const isEdit = Boolean(item?.id);
  const [name, setName] = useState(item?.name ?? "");
  const [isActive, setIsActive] = useState(item?.is_active ?? true);
  const [responsibleId, setResponsibleId] = useState(item?.responsible_employee_id ?? null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  function handleOpen() {
    setName(item?.name ?? "");
    setIsActive(item?.is_active ?? true);
    setResponsibleId(item?.responsible_employee_id ?? null);
    setError(null);
  }

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      await onSave({ name: name.trim(), is_active: isActive, responsible_employee_id: responsibleId });
      onClose();
    } catch (e) {
      setError(e?.message || "Errore durante il salvataggio");
    } finally {
      setIsSaving(false);
    }
  }

  const selectedEmployee = (employeeOptions ?? []).find((e) => e.id === responsibleId) ?? null;

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
          {isEdit ? "Modifica Funzione" : "Nuova Funzione"}
        </Typography>
        <IconButton size="small" onClick={onClose} disabled={isSaving} sx={{ fontSize: 16, lineHeight: 1 }}>
          ✕
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Nome"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            size="small"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) handleSave(); }}
          />
          <Autocomplete
            options={employeeOptions ?? []}
            value={selectedEmployee}
            onChange={(_, v) => setResponsibleId(v?.id ?? null)}
            getOptionLabel={(o) => `${o.full_name} (${o.tms_id})`}
            isOptionEqualToValue={(o, v) => o.id === v.id}
            renderInput={(params) => (
              <TextField {...params} label="Responsabile di funzione" size="small" />
            )}
            noOptionsText="Nessun dipendente disponibile"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
            }
            label={<Typography variant="body2">Attivo</Typography>}
          />
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={isSaving}>Annulla</Button>
        <Button
          variant="contained"
          disabled={isSaving || !name.trim()}
          onClick={handleSave}
        >
          {isSaving
            ? <CircularProgress size={18} color="inherit" />
            : isEdit ? "Salva" : "Crea funzione"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function FunctionRow({ item, onEdit, onToggleActive, onDelete }) {
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
        <Typography variant="body2" fontWeight={600} noWrap>
          {item.name}
        </Typography>
        {item.responsible_employee_name && (
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
            👤 {item.responsible_employee_name}
          </Typography>
        )}
      </Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
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

function FunctionSection({ items = [], isLoading, error, employeeOptions, onCreate, onEdit, onDelete, onToggleActive }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteItem, setDeleteItem] = useState(null);
  const [snackbar, setSnackbar] = useState(null);

  function handleAdd() {
    setEditItem(null);
    setDialogOpen(true);
  }

  function handleEdit(item) {
    setEditItem(item);
    setDialogOpen(true);
  }

  async function handleSave(payload) {
    if (editItem) {
      await onEdit(editItem.id, payload);
      setSnackbar("Funzione aggiornata");
    } else {
      await onCreate(payload);
      setSnackbar("Funzione creata");
    }
  }

  async function handleConfirmDelete() {
    await onDelete(deleteItem.id);
    setSnackbar("Funzione eliminata");
  }

  const activeCount = items.filter((i) => i.is_active).length;

  return (
    <>
      <Paper sx={{ p: 3, borderRadius: 3, height: "100%" }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight={700}>Funzioni</Typography>
            {!isLoading && items.length > 0 && (
              <Typography variant="caption" color="text.secondary">
                {activeCount} attiv{activeCount !== 1 ? "e" : "a"} su {items.length}
              </Typography>
            )}
          </Box>
          <Button variant="contained" size="small" onClick={handleAdd}>
            + Aggiungi
          </Button>
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
              Nessuna funzione presente
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
                <FunctionRow
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

      <FunctionDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
        item={editItem}
        employeeOptions={employeeOptions}
      />

      <ConfirmDeleteDialog
        open={Boolean(deleteItem)}
        onClose={() => setDeleteItem(null)}
        onConfirm={handleConfirmDelete}
        entityLabel="Funzione"
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

function EntityRow({ item, entityLabel, onEdit, onToggleActive, onDelete }) {
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
      <Typography variant="body2" fontWeight={600} sx={{ flex: 1, minWidth: 0 }} noWrap>
        {item.name}
      </Typography>
      <Stack direction="row" spacing={1} alignItems="center">
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
        <MenuItem onClick={() => { setMenuAnchor(null); onEdit(item); }}>
          Modifica
        </MenuItem>
        <MenuItem onClick={() => { setMenuAnchor(null); onToggleActive(item); }}>
          {item.is_active ? "Disattiva" : "Riattiva"}
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => { setMenuAnchor(null); onDelete(item); }}
          sx={{ color: "error.main" }}
        >
          Elimina
        </MenuItem>
      </Menu>
    </Stack>
  );
}

function EntitySection({
  title,
  items = [],
  isLoading,
  error,
  entityLabel,
  onCreate,
  onEdit,
  onDelete,
  onToggleActive,
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteItem, setDeleteItem] = useState(null);
  const [snackbar, setSnackbar] = useState(null);

  function handleAdd() {
    setEditItem(null);
    setDialogOpen(true);
  }

  function handleEdit(item) {
    setEditItem(item);
    setDialogOpen(true);
  }

  async function handleSave(payload) {
    if (editItem) {
      await onEdit(editItem.id, payload);
      setSnackbar(`${entityLabel} aggiornata`);
    } else {
      await onCreate(payload);
      setSnackbar(`${entityLabel} creata`);
    }
  }

  async function handleConfirmDelete() {
    await onDelete(deleteItem.id);
    setSnackbar(`${entityLabel} eliminata`);
  }

  const activeCount = items.filter((i) => i.is_active).length;

  return (
    <>
      <Paper sx={{ p: 3, borderRadius: 3, height: "100%" }}>
        {/* Section header */}
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight={700}>{title}</Typography>
            {!isLoading && items.length > 0 && (
              <Typography variant="caption" color="text.secondary">
                {activeCount} attiv{activeCount !== 1 ? "e" : "a"} su {items.length}
              </Typography>
            )}
          </Box>
          <Button variant="contained" size="small" onClick={handleAdd}>
            + Aggiungi
          </Button>
        </Stack>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error.message}</Alert>}

        {/* Loading skeletons */}
        {isLoading && (
          <Stack spacing={0.5}>
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} variant="rounded" height={44} />
            ))}
          </Stack>
        )}

        {/* Empty state */}
        {!isLoading && items.length === 0 && (
          <Box
            sx={{
              py: 4,
              textAlign: "center",
              border: "2px dashed",
              borderColor: "divider",
              borderRadius: 2,
            }}
          >
            <Typography variant="body2" color="text.disabled" gutterBottom>
              Nessuna {entityLabel.toLowerCase()} presente
            </Typography>
            <Button size="small" variant="outlined" onClick={handleAdd} sx={{ mt: 1 }}>
              + Aggiungi la prima
            </Button>
          </Box>
        )}

        {/* Item list */}
        {!isLoading && items.length > 0 && (
          <Stack spacing={0.25}>
            {items.map((item, idx) => (
              <Box key={item.id}>
                <EntityRow
                  item={item}
                  entityLabel={entityLabel}
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

      <EntityDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
        item={editItem}
        entityLabel={entityLabel}
      />

      <ConfirmDeleteDialog
        open={Boolean(deleteItem)}
        onClose={() => setDeleteItem(null)}
        onConfirm={handleConfirmDelete}
        entityLabel={entityLabel}
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

export default function FunctionsDepartmentsPage() {
  const queryClient = useQueryClient();

  const functionsQuery = useQuery({
    queryKey: ["org-functions"],
    queryFn: () => getOrgFunctions(),
  });

  const departmentsQuery = useQuery({
    queryKey: ["org-departments"],
    queryFn: () => getOrgDepartments(),
  });

  const employeeOptionsQuery = useQuery({
    queryKey: ["employee-options"],
    queryFn: () => getEmployeeOptions(),
  });

  const createFunctionMutation = useMutation({
    mutationFn: createOrgFunction,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["org-functions"] }),
  });

  const updateFunctionMutation = useMutation({
    mutationFn: ({ id, payload }) => updateOrgFunction(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["org-functions"] }),
  });

  const deleteFunctionMutation = useMutation({
    mutationFn: deleteOrgFunction,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["org-functions"] }),
  });

  const createDepartmentMutation = useMutation({
    mutationFn: createOrgDepartment,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["org-departments"] }),
  });

  const updateDepartmentMutation = useMutation({
    mutationFn: ({ id, payload }) => updateOrgDepartment(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["org-departments"] }),
  });

  const deleteDepartmentMutation = useMutation({
    mutationFn: deleteOrgDepartment,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["org-departments"] }),
  });

  return (
    <Stack spacing={3}>
      {/* ── Header ── */}
      <Paper
        sx={{
          p: 3.5,
          borderRadius: 4,
          background: "linear-gradient(135deg, rgba(0,112,64,0.96), rgba(0,80,46,0.92))",
          color: "#fff",
        }}
      >
        <Typography variant="overline" sx={{ opacity: 0.8 }}>Impresa</Typography>
        <Typography variant="h4">Funzione / Dipartimento</Typography>
        <Typography sx={{ mt: 0.5, maxWidth: 680, opacity: 0.9, fontSize: "0.95rem" }}>
          Gestione delle funzioni aziendali e dei dipartimenti associabili ai dipendenti.
        </Typography>
      </Paper>

      {/* ── Two-column grid ── */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
          gap: 3,
          alignItems: "start",
        }}
      >
        <FunctionSection
          items={functionsQuery.data ?? []}
          isLoading={functionsQuery.isLoading}
          error={functionsQuery.error}
          employeeOptions={employeeOptionsQuery.data ?? []}
          onCreate={(payload) => createFunctionMutation.mutateAsync(payload)}
          onEdit={(id, payload) => updateFunctionMutation.mutateAsync({ id, payload })}
          onDelete={(id) => deleteFunctionMutation.mutateAsync(id)}
          onToggleActive={(id, payload) => updateFunctionMutation.mutateAsync({ id, payload })}
        />

        <DepartmentSection
          items={departmentsQuery.data ?? []}
          isLoading={departmentsQuery.isLoading}
          error={departmentsQuery.error}
          employeeOptions={employeeOptionsQuery.data ?? []}
          orgFunctions={functionsQuery.data ?? []}
          onCreate={(payload) => createDepartmentMutation.mutateAsync(payload)}
          onEdit={(id, payload) => updateDepartmentMutation.mutateAsync({ id, payload })}
          onDelete={(id) => deleteDepartmentMutation.mutateAsync(id)}
          onToggleActive={(id, payload) => updateDepartmentMutation.mutateAsync({ id, payload })}
        />
      </Box>
    </Stack>
  );
}
