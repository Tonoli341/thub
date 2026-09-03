import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import { Icon, ICON_NAMES } from "../components/Icon";
import {
  createMaintenanceAssetClass,
  createMaintenanceAssetFamily,
  createMaintenanceAssetField,
  createMaintenanceAssetType,
  createMaintenanceClassField,
  deleteMaintenanceAssetClass,
  deleteMaintenanceAssetFamily,
  deleteMaintenanceAssetField,
  deleteMaintenanceAssetType,
  getMaintenanceAssetFamilies,
  reorderMaintenanceAssetClasses,
  reorderMaintenanceAssetFamilies,
  reorderMaintenanceAssetTypes,
  updateMaintenanceAssetClass,
  updateMaintenanceAssetField,
  updateMaintenanceAssetFamily,
  updateMaintenanceAssetType,
} from "../maintenanceAssetsApi";
import PageHeader, { HeaderButton } from "../components/PageHeader";

const FIELD_TYPE_LABELS = { text: "Testo", number: "Numero", date: "Data", bool: "Sì/No", select: "Elenco", image: "Immagine", employee: "Dipendente" };

function TrashIcon({ size = 18 }) {
  return (
    <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{ width: size, height: size, display: "block" }}>
      <path
        d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Box>
  );
}

function PencilIcon({ size = 18 }) {
  return (
    <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{ width: size, height: size, display: "block" }}>
      <path
        d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Box>
  );
}

function DragHandleIcon({ size = 16 }) {
  return (
    <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{ width: size, height: size, display: "block" }}>
      {[7, 12, 17].map((y) => (
        <g key={y}>
          <circle cx="9" cy={y} r="1.4" fill="currentColor" />
          <circle cx="15" cy={y} r="1.4" fill="currentColor" />
        </g>
      ))}
    </Box>
  );
}

function DragHandle({ dragHandlers }) {
  return (
    <Box
      {...dragHandlers}
      onClick={(e) => e.stopPropagation()}
      sx={{
        width: 22,
        height: 22,
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "text.disabled",
        cursor: "grab",
        "&:active": { cursor: "grabbing" },
      }}
    >
      <DragHandleIcon />
    </Box>
  );
}

// Riordino via drag & drop nativo (nessuna libreria): tiene un ordine locale
// sincronizzato con i dati del server, aggiorna otticamente durante il drag
// e salva la lista completa di id al drop, invariata per scelta (§2 con
// l'utente): sposta solo dentro lo stesso genitore, mai tra genitori diversi.
// Riferimento stabile: se `items` fosse `data ?? []` inline, un errore
// persistente della query (data sempre undefined) genererebbe un nuovo array
// a ogni render, l'effetto sotto rientrerebbe in loop infinito ("Maximum
// update depth exceeded") invece di stabilizzarsi su una lista vuota.
const EMPTY_LIST = [];

function useReorderableList(items, onReorder) {
  const [order, setOrder] = useState(() => items.map((item) => item.id));
  const orderRef = useRef(order);
  const dragIndexRef = useRef(null);

  useEffect(() => {
    setOrder(items.map((item) => item.id));
  }, [items]);

  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered = order.map((id) => byId.get(id)).filter(Boolean);

  // Sul manico: avvia/termina il drag. Sul contenitore della riga intera:
  // intercetta l'hover per spostare l'elemento mentre si trascina sopra.
  const handleProps = (index) => ({
    draggable: true,
    onDragStart: (e) => {
      dragIndexRef.current = index;
      e.dataTransfer.effectAllowed = "move";
    },
    onDragEnd: () => {
      dragIndexRef.current = null;
      onReorder(orderRef.current);
    },
  });

  const containerProps = (index) => ({
    onDragOver: (e) => {
      e.preventDefault();
      const from = dragIndexRef.current;
      if (from === null || from === index) return;
      setOrder((prev) => {
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(index, 0, moved);
        return next;
      });
      dragIndexRef.current = index;
    },
    onDrop: (e) => e.preventDefault(),
  });

  return { ordered, handleProps, containerProps };
}

function ConfirmDeleteDialog({ open, onClose, title, message, onConfirm, isPending, error }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 13.5 }}>{message}</Typography>
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error.message}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button color="error" variant="contained" disabled={isPending} onClick={onConfirm}>
          {isPending ? "Eliminazione..." : "Elimina"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function IconPicker({ value, onChange }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 12.5, fontWeight: 600, mb: 0.75, color: "text.secondary" }}>Icona</Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, p: 1, borderRadius: 1.5, bgcolor: "action.hover", maxHeight: 260, overflowY: "auto" }}>
        {ICON_NAMES.map((iconName) => (
          <Tooltip key={iconName} title={iconName}>
            <IconButton
              onClick={() => onChange(iconName)}
              sx={{
                width: 52,
                height: 52,
                borderRadius: 2,
                border: "2px solid",
                borderColor: value === iconName ? "primary.main" : "transparent",
                bgcolor: value === iconName ? "action.selected" : "transparent",
                color: value === iconName ? "primary.main" : "text.secondary",
              }}
            >
              <Icon name={iconName} size={28} />
            </IconButton>
          </Tooltip>
        ))}
      </Box>
    </Box>
  );
}

function NewFamilyDialog({ open, onClose }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [icon, setIcon] = useState("tools");

  const createMutation = useMutation({
    mutationFn: () => createMaintenanceAssetFamily({ code: code.trim(), label: label.trim(), icon }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-families"] });
      onClose();
      setCode("");
      setLabel("");
      setIcon("tools");
    },
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Nuova famiglia</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Codice (minuscolo, senza spazi)"
            placeholder="es. sollevamento"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            size="small"
            fullWidth
          />
          <TextField label="Etichetta" placeholder="es. Sollevamento" value={label} onChange={(e) => setLabel(e.target.value)} size="small" fullWidth />
          <IconPicker value={icon} onChange={setIcon} />
          {createMutation.error && <Alert severity="error">{createMutation.error.message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={!code.trim() || !label.trim() || createMutation.isPending} onClick={() => createMutation.mutate()}>
          Crea
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function EditFamilyDialog({ open, onClose, assetFamily }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState(assetFamily.label);
  const [icon, setIcon] = useState(assetFamily.icon);

  useEffect(() => {
    if (!open) return;
    setLabel(assetFamily.label);
    setIcon(assetFamily.icon);
  }, [open, assetFamily.label, assetFamily.icon]);

  const updateMutation = useMutation({
    mutationFn: () => updateMaintenanceAssetFamily(assetFamily.id, { label: label.trim(), icon }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-families"] });
      onClose();
    },
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Modifica famiglia</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField label="Etichetta" value={label} onChange={(e) => setLabel(e.target.value)} size="small" fullWidth />
          <IconPicker value={icon} onChange={setIcon} />
          {updateMutation.error && <Alert severity="error">{updateMutation.error.message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={!label.trim() || updateMutation.isPending} onClick={() => updateMutation.mutate()}>
          Salva
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function NewClassDialog({ open, onClose, assetFamilyId }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [icon, setIcon] = useState("tools");

  const createMutation = useMutation({
    mutationFn: () => createMaintenanceAssetClass(assetFamilyId, { code: code.trim(), label: label.trim(), icon }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-classes"] });
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-families"] });
      onClose();
      setCode("");
      setLabel("");
      setIcon("tools");
    },
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Nuova classe</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Codice (minuscolo, senza spazi)"
            placeholder="es. attrezzature"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            size="small"
            fullWidth
          />
          <TextField label="Etichetta" placeholder="es. Attrezzature" value={label} onChange={(e) => setLabel(e.target.value)} size="small" fullWidth />
          <IconPicker value={icon} onChange={setIcon} />
          {createMutation.error && <Alert severity="error">{createMutation.error.message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={!code.trim() || !label.trim() || createMutation.isPending} onClick={() => createMutation.mutate()}>
          Crea
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function NewTypeDialog({ open, onClose, assetClassId }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [tracksUsageHours, setTracksUsageHours] = useState(false);

  const createMutation = useMutation({
    mutationFn: () =>
      createMaintenanceAssetType(assetClassId, {
        code: code.trim(),
        label: label.trim(),
        tracks_usage_hours: tracksUsageHours,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-classes"] });
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-families"] });
      onClose();
      setCode("");
      setLabel("");
      setTracksUsageHours(false);
    },
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Nuova sottoclasse</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Codice (minuscolo, senza spazi)"
            placeholder="es. retrattile"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            size="small"
            fullWidth
          />
          <TextField label="Etichetta" placeholder="es. Retrattile" value={label} onChange={(e) => setLabel(e.target.value)} size="small" fullWidth />
          <FormControlLabel
            control={<Checkbox checked={tracksUsageHours} onChange={(e) => setTracksUsageHours(e.target.checked)} />}
            label="Gestisce le ore (contaore)"
          />
          {createMutation.error && <Alert severity="error">{createMutation.error.message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={!code.trim() || !label.trim() || createMutation.isPending} onClick={() => createMutation.mutate()}>
          Crea
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// assetTypeId (attributo di sottoclasse) o assetClassId (attributo generico
// di classe, condiviso da tutte le sue sottoclassi): esattamente uno dei due
// va passato, riflette il vincolo backend su MaintenanceAssetField.
function NewFieldDialog({ open, onClose, assetTypeId, assetClassId }) {
  const queryClient = useQueryClient();
  const [fieldKey, setFieldKey] = useState("");
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState("text");
  const [isRequired, setIsRequired] = useState(false);
  const [isSearchable, setIsSearchable] = useState(true);
  const [optionsText, setOptionsText] = useState("");

  const createMutation = useMutation({
    mutationFn: () => {
      const payload = {
        field_key: fieldKey.trim(),
        label: label.trim(),
        field_type: fieldType,
        is_required: isRequired,
        is_searchable: isSearchable,
        options: fieldType === "select" ? optionsText.split(",").map((o) => o.trim()).filter(Boolean) : [],
        sort_order: 0,
      };
      return assetClassId ? createMaintenanceClassField(assetClassId, payload) : createMaintenanceAssetField(assetTypeId, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-classes"] });
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-families"] });
      onClose();
      setFieldKey("");
      setLabel("");
      setFieldType("text");
      setIsRequired(false);
      setIsSearchable(true);
      setOptionsText("");
    },
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Nuovo attributo</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Chiave (minuscolo, underscore)"
            placeholder="es. altezza_montante_mm"
            value={fieldKey}
            onChange={(e) => setFieldKey(e.target.value)}
            size="small"
            fullWidth
          />
          <TextField label="Etichetta" placeholder="es. Altezza montante (mm)" value={label} onChange={(e) => setLabel(e.target.value)} size="small" fullWidth />
          <TextField select label="Tipo" value={fieldType} onChange={(e) => setFieldType(e.target.value)} size="small" fullWidth>
            {Object.entries(FIELD_TYPE_LABELS).map(([value, l]) => (
              <MenuItem key={value} value={value}>{l}</MenuItem>
            ))}
          </TextField>
          {fieldType === "select" && (
            <TextField
              label="Opzioni (separate da virgola)"
              placeholder="es. elettrico, gpl, diesel"
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              size="small"
              fullWidth
            />
          )}
          {fieldType === "image" && (
            <Alert severity="info" sx={{ fontSize: 12.5 }}>
              Il caricamento avviene dalla scheda dell'asset dopo la creazione: non può essere obbligatorio.
            </Alert>
          )}
          <Stack direction="row" spacing={2}>
            <FormControlLabel
              control={<Checkbox checked={isRequired} disabled={fieldType === "image"} onChange={(e) => setIsRequired(e.target.checked)} />}
              label="Obbligatorio"
            />
            <FormControlLabel control={<Checkbox checked={isSearchable} onChange={(e) => setIsSearchable(e.target.checked)} />} label="Ricercabile" />
          </Stack>
          {createMutation.error && <Alert severity="error">{createMutation.error.message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={!fieldKey.trim() || !label.trim() || createMutation.isPending} onClick={() => createMutation.mutate()}>
          Crea
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Modifica di un attributo esistente, di classe o di sottoclasse (endpoint
// unico lato backend): field_key resta di sola lettura, non è rinominabile
// una volta creato (decisione esplicita dell'utente).
function EditFieldDialog({ open, onClose, field }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState(field.label);
  const [fieldType, setFieldType] = useState(field.field_type);
  const [isRequired, setIsRequired] = useState(field.is_required);
  const [isSearchable, setIsSearchable] = useState(field.is_searchable);
  const [optionsText, setOptionsText] = useState((field.options || []).join(", "));

  useEffect(() => {
    if (!open) return;
    setLabel(field.label);
    setFieldType(field.field_type);
    setIsRequired(field.is_required);
    setIsSearchable(field.is_searchable);
    setOptionsText((field.options || []).join(", "));
  }, [open, field]);

  const updateMutation = useMutation({
    mutationFn: () =>
      updateMaintenanceAssetField(field.id, {
        label: label.trim(),
        field_type: fieldType,
        is_required: isRequired,
        is_searchable: isSearchable,
        options: fieldType === "select" ? optionsText.split(",").map((o) => o.trim()).filter(Boolean) : [],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-classes"] });
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-families"] });
      onClose();
    },
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Modifica attributo</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField label="Chiave" value={field.field_key} size="small" fullWidth disabled helperText="Non modificabile dopo la creazione" />
          <TextField label="Etichetta" value={label} onChange={(e) => setLabel(e.target.value)} size="small" fullWidth />
          <TextField select label="Tipo" value={fieldType} onChange={(e) => setFieldType(e.target.value)} size="small" fullWidth>
            {Object.entries(FIELD_TYPE_LABELS).map(([value, l]) => (
              <MenuItem key={value} value={value}>{l}</MenuItem>
            ))}
          </TextField>
          {fieldType === "select" && (
            <TextField
              label="Opzioni (separate da virgola)"
              placeholder="es. elettrico, gpl, diesel"
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              size="small"
              fullWidth
            />
          )}
          <Stack direction="row" spacing={2}>
            <FormControlLabel
              control={<Checkbox checked={isRequired} disabled={fieldType === "image"} onChange={(e) => setIsRequired(e.target.checked)} />}
              label="Obbligatorio"
            />
            <FormControlLabel control={<Checkbox checked={isSearchable} onChange={(e) => setIsSearchable(e.target.checked)} />} label="Ricercabile" />
          </Stack>
          {updateMutation.error && <Alert severity="error">{updateMutation.error.message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={!label.trim() || updateMutation.isPending} onClick={() => updateMutation.mutate()}>
          Salva
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DuplicateFieldsDialog({ open, onClose, assetType, assetFamilies }) {
  const queryClient = useQueryClient();
  const [sourceTypeId, setSourceTypeId] = useState("");
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [duplicateError, setDuplicateError] = useState(null);

  const sourceOptions = [];
  assetFamilies.forEach((family) => {
    family.classes.forEach((assetClass) => {
      assetClass.types.forEach((type) => {
        if (type.id !== assetType.id && type.fields.length > 0) {
          sourceOptions.push({ id: type.id, label: `${family.label} / ${assetClass.label} / ${type.label}`, fields: type.fields });
        }
      });
    });
  });

  const sourceType = sourceOptions.find((o) => o.id === sourceTypeId) || null;
  const existingKeys = new Set(assetType.fields.map((f) => f.field_key));

  useEffect(() => {
    if (!open) return;
    setSourceTypeId("");
    setSelectedKeys([]);
    setDuplicateError(null);
  }, [open]);

  useEffect(() => {
    setSelectedKeys([]);
    setDuplicateError(null);
  }, [sourceTypeId]);

  const toggleKey = (key) => {
    setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const duplicateMutation = useMutation({
    mutationFn: async () => {
      const fieldsToCreate = sourceType.fields.filter((f) => selectedKeys.includes(f.field_key));
      for (const field of fieldsToCreate) {
        await createMaintenanceAssetField(assetType.id, {
          field_key: field.field_key,
          label: field.label,
          field_type: field.field_type,
          is_required: field.is_required,
          is_searchable: field.is_searchable,
          options: field.options || [],
          sort_order: 0,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-classes"] });
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-families"] });
      onClose();
    },
    onError: (err) => setDuplicateError(err),
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Duplica attributi</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            select
            label="Sottoclasse di origine"
            value={sourceTypeId}
            onChange={(e) => setSourceTypeId(e.target.value)}
            size="small"
            fullWidth
          >
            {sourceOptions.length === 0 && (
              <MenuItem value="" disabled>Nessuna sottoclasse con attributi disponibile</MenuItem>
            )}
            {sourceOptions.map((option) => (
              <MenuItem key={option.id} value={option.id}>{option.label}</MenuItem>
            ))}
          </TextField>

          {sourceType && (
            <Stack spacing={0.5}>
              <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: "text.secondary" }}>Attributi da copiare</Typography>
              {sourceType.fields.map((field) => {
                const alreadyPresent = existingKeys.has(field.field_key);
                return (
                  <FormControlLabel
                    key={field.field_key}
                    control={
                      <Checkbox
                        checked={selectedKeys.includes(field.field_key)}
                        disabled={alreadyPresent}
                        onChange={() => toggleKey(field.field_key)}
                      />
                    }
                    label={`${field.label} (${FIELD_TYPE_LABELS[field.field_type]})${alreadyPresent ? " — già presente" : ""}`}
                    sx={{ "& .MuiFormControlLabel-label": { fontSize: 13 } }}
                  />
                );
              })}
            </Stack>
          )}

          {duplicateError && <Alert severity="error">{duplicateError.message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button
          variant="contained"
          disabled={selectedKeys.length === 0 || duplicateMutation.isPending}
          onClick={() => duplicateMutation.mutate()}
        >
          {duplicateMutation.isPending ? "Duplicazione..." : `Duplica (${selectedKeys.length})`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function EditTypeDialog({ open, onClose, assetType }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState(assetType.label);
  const [tracksUsageHours, setTracksUsageHours] = useState(assetType.tracks_usage_hours);
  const [documentTypesText, setDocumentTypesText] = useState((assetType.document_type_options || []).join(", "));
  const [deadlineTypesText, setDeadlineTypesText] = useState((assetType.deadline_type_options || []).join(", "));

  useEffect(() => {
    if (!open) return;
    setLabel(assetType.label);
    setTracksUsageHours(assetType.tracks_usage_hours);
    setDocumentTypesText((assetType.document_type_options || []).join(", "));
    setDeadlineTypesText((assetType.deadline_type_options || []).join(", "));
  }, [open, assetType.label, assetType.tracks_usage_hours, assetType.document_type_options, assetType.deadline_type_options]);

  const updateMutation = useMutation({
    mutationFn: () =>
      updateMaintenanceAssetType(assetType.id, {
        label: label.trim(),
        tracks_usage_hours: tracksUsageHours,
        document_type_options: documentTypesText.split(",").map((o) => o.trim()).filter(Boolean),
        deadline_type_options: deadlineTypesText.split(",").map((o) => o.trim()).filter(Boolean),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-classes"] });
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-families"] });
      onClose();
    },
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Modifica sottoclasse</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField label="Etichetta" value={label} onChange={(e) => setLabel(e.target.value)} size="small" fullWidth />
          <FormControlLabel
            control={<Checkbox checked={tracksUsageHours} onChange={(e) => setTracksUsageHours(e.target.checked)} />}
            label="Gestisce le ore (contaore)"
          />
          <TextField
            label="Tipi documento (separati da virgola)"
            placeholder="es. Certificato CE, Libretto uso e manutenzione"
            value={documentTypesText}
            onChange={(e) => setDocumentTypesText(e.target.value)}
            size="small"
            fullWidth
            multiline
            helperText="Elenco selezionabile in upload documento per gli asset di questa sottoclasse."
          />
          <TextField
            label="Tipi scadenza (separati da virgola)"
            placeholder="es. Revisione annuale, Verifica INAIL"
            value={deadlineTypesText}
            onChange={(e) => setDeadlineTypesText(e.target.value)}
            size="small"
            fullWidth
            multiline
            helperText="Elenco selezionabile in creazione scadenza per gli asset di questa sottoclasse."
          />
          {updateMutation.error && <Alert severity="error">{updateMutation.error.message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={!label.trim() || updateMutation.isPending} onClick={() => updateMutation.mutate()}>
          Salva
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function AssetTypeBlock({ assetType, assetFamilies, dragHandleProps }) {
  const queryClient = useQueryClient();
  const [fieldDialogOpen, setFieldDialogOpen] = useState(false);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [deleteTypeOpen, setDeleteTypeOpen] = useState(false);
  const [editTypeOpen, setEditTypeOpen] = useState(false);
  const [deleteFieldTarget, setDeleteFieldTarget] = useState(null);
  const [editFieldTarget, setEditFieldTarget] = useState(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["maintenance-asset-classes"] });
    queryClient.invalidateQueries({ queryKey: ["maintenance-asset-families"] });
  };

  const deleteTypeMutation = useMutation({
    mutationFn: () => deleteMaintenanceAssetType(assetType.id),
    onSuccess: () => { invalidate(); setDeleteTypeOpen(false); },
  });

  const deleteFieldMutation = useMutation({
    mutationFn: () => deleteMaintenanceAssetField(deleteFieldTarget.id),
    onSuccess: () => { invalidate(); setDeleteFieldTarget(null); },
  });

  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <DragHandle dragHandlers={dragHandleProps} />
          <Typography sx={{ fontWeight: 700, fontSize: 14 }}>{assetType.label}</Typography>
          {assetType.tracks_usage_hours && (
            <Chip label="Ore" size="small" color="info" variant="outlined" sx={{ fontSize: 11, fontWeight: 700 }} />
          )}
        </Stack>
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Button size="small" onClick={() => setFieldDialogOpen(true)}>+ Attributo</Button>
          <Button size="small" onClick={() => setDuplicateDialogOpen(true)}>Duplica attributi</Button>
          <Tooltip title="Modifica sottoclasse">
            <IconButton size="small" onClick={() => setEditTypeOpen(true)}>
              <PencilIcon size={15} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Elimina sottoclasse">
            <IconButton size="small" color="error" onClick={() => setDeleteTypeOpen(true)}>
              <TrashIcon size={17} />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>
      {assetType.fields.length === 0 ? (
        <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>Nessun attributo configurato.</Typography>
      ) : (
        <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", rowGap: 0.75 }}>
          {assetType.fields.map((field) => (
            <Chip
              key={field.id}
              label={`${field.label} (${FIELD_TYPE_LABELS[field.field_type]}${field.is_required ? ", obbligatorio" : ""})`}
              size="small"
              variant="outlined"
              onClick={() => setEditFieldTarget(field)}
              onDelete={() => setDeleteFieldTarget(field)}
              sx={{ fontSize: 11.5, cursor: "pointer" }}
            />
          ))}
        </Stack>
      )}
      <NewFieldDialog open={fieldDialogOpen} onClose={() => setFieldDialogOpen(false)} assetTypeId={assetType.id} />
      <DuplicateFieldsDialog
        open={duplicateDialogOpen}
        onClose={() => setDuplicateDialogOpen(false)}
        assetType={assetType}
        assetFamilies={assetFamilies}
      />
      <EditTypeDialog open={editTypeOpen} onClose={() => setEditTypeOpen(false)} assetType={assetType} />
      {editFieldTarget && (
        <EditFieldDialog open={!!editFieldTarget} onClose={() => setEditFieldTarget(null)} field={editFieldTarget} />
      )}

      <ConfirmDeleteDialog
        open={deleteTypeOpen}
        onClose={() => setDeleteTypeOpen(false)}
        title="Elimina sottoclasse"
        message={`Stai per eliminare la sottoclasse «${assetType.label}» e tutti i suoi attributi configurati. Non è possibile se esistono ancora asset di questa sottoclasse.`}
        onConfirm={() => deleteTypeMutation.mutate()}
        isPending={deleteTypeMutation.isPending}
        error={deleteTypeMutation.error}
      />
      <ConfirmDeleteDialog
        open={!!deleteFieldTarget}
        onClose={() => setDeleteFieldTarget(null)}
        title="Elimina attributo"
        message={`Stai per eliminare l'attributo «${deleteFieldTarget?.label}». I valori già inseriti sugli asset esistenti restano, ma il campo non sarà più modificabile da qui.`}
        onConfirm={() => deleteFieldMutation.mutate()}
        isPending={deleteFieldMutation.isPending}
        error={deleteFieldMutation.error}
      />
    </Paper>
  );
}

// Sezione "Attributi generici" di una classe: stessa UI degli attributi di
// sottoclasse (chip con modifica/elimina, dialog di creazione condiviso),
// ma agganciata alla classe intera — condivisa da tutte le sue sottoclassi.
function ClassFieldsSection({ assetClass }) {
  const queryClient = useQueryClient();
  const [fieldDialogOpen, setFieldDialogOpen] = useState(false);
  const [deleteFieldTarget, setDeleteFieldTarget] = useState(null);
  const [editFieldTarget, setEditFieldTarget] = useState(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["maintenance-asset-classes"] });
    queryClient.invalidateQueries({ queryKey: ["maintenance-asset-families"] });
  };

  const deleteFieldMutation = useMutation({
    mutationFn: () => deleteMaintenanceAssetField(deleteFieldTarget.id),
    onSuccess: () => { invalidate(); setDeleteFieldTarget(null); },
  });

  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: "action.hover" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography sx={{ fontWeight: 700, fontSize: 13 }}>
          Attributi generici <Typography component="span" sx={{ fontSize: 11.5, fontWeight: 400, color: "text.secondary" }}>(comuni a tutte le sottoclassi)</Typography>
        </Typography>
        <Button size="small" onClick={() => setFieldDialogOpen(true)}>+ Attributo</Button>
      </Stack>
      {assetClass.fields.length === 0 ? (
        <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>Nessun attributo generico configurato.</Typography>
      ) : (
        <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", rowGap: 0.75 }}>
          {assetClass.fields.map((field) => (
            <Chip
              key={field.id}
              label={`${field.label} (${FIELD_TYPE_LABELS[field.field_type]}${field.is_required ? ", obbligatorio" : ""})`}
              size="small"
              variant="outlined"
              onClick={() => setEditFieldTarget(field)}
              onDelete={() => setDeleteFieldTarget(field)}
              sx={{ fontSize: 11.5, cursor: "pointer" }}
            />
          ))}
        </Stack>
      )}
      <NewFieldDialog open={fieldDialogOpen} onClose={() => setFieldDialogOpen(false)} assetClassId={assetClass.id} />
      {editFieldTarget && (
        <EditFieldDialog open={!!editFieldTarget} onClose={() => setEditFieldTarget(null)} field={editFieldTarget} />
      )}
      <ConfirmDeleteDialog
        open={!!deleteFieldTarget}
        onClose={() => setDeleteFieldTarget(null)}
        title="Elimina attributo"
        message={`Stai per eliminare l'attributo generico «${deleteFieldTarget?.label}». I valori già inseriti sugli asset esistenti restano, ma il campo non sarà più modificabile da qui.`}
        onConfirm={() => deleteFieldMutation.mutate()}
        isPending={deleteFieldMutation.isPending}
        error={deleteFieldMutation.error}
      />
    </Paper>
  );
}

function EditClassDialog({ open, onClose, assetClass }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState(assetClass.label);
  const [icon, setIcon] = useState(assetClass.icon);

  useEffect(() => {
    if (!open) return;
    setLabel(assetClass.label);
    setIcon(assetClass.icon);
  }, [open, assetClass.label, assetClass.icon]);

  const updateMutation = useMutation({
    mutationFn: () => updateMaintenanceAssetClass(assetClass.id, { label: label.trim(), icon }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-classes"] });
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-families"] });
      onClose();
    },
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Modifica classe</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField label="Etichetta" value={label} onChange={(e) => setLabel(e.target.value)} size="small" fullWidth />
          <IconPicker value={icon} onChange={setIcon} />
          {updateMutation.error && <Alert severity="error">{updateMutation.error.message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={!label.trim() || updateMutation.isPending} onClick={() => updateMutation.mutate()}>
          Salva
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function AssetClassAccordion({ assetClass, assetFamilies, collapseAllVersion, dragHandleProps }) {
  const queryClient = useQueryClient();
  const [typeDialogOpen, setTypeDialogOpen] = useState(false);
  const [deleteClassOpen, setDeleteClassOpen] = useState(false);
  const [editClassOpen, setEditClassOpen] = useState(false);

  const deleteClassMutation = useMutation({
    mutationFn: () => deleteMaintenanceAssetClass(assetClass.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-classes"] });
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-families"] });
      setDeleteClassOpen(false);
    },
  });

  const reorderTypesMutation = useMutation({
    mutationFn: (orderedIds) => reorderMaintenanceAssetTypes(assetClass.id, orderedIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-classes"] });
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-families"] });
    },
  });
  const { ordered: orderedTypes, handleProps: typeHandleProps, containerProps: typeContainerProps } =
    useReorderableList(assetClass.types, (orderedIds) => reorderTypesMutation.mutate(orderedIds));

  return (
    <Accordion key={collapseAllVersion} variant="outlined" disableGutters sx={{ borderRadius: 2, "&:before": { display: "none" } }}>
      <AccordionSummary expandIcon={<Box component="span">▼</Box>}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
          <DragHandle dragHandlers={dragHandleProps} />
          <Box sx={{ width: 28, height: 28, flexShrink: 0, color: "text.secondary", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name={assetClass.icon} size={25} />
          </Box>
          <Typography sx={{ fontWeight: 700 }}>{assetClass.label}</Typography>
          <Chip label={`${assetClass.types.length} ${assetClass.types.length === 1 ? "sottoclasse" : "sottoclassi"}`} size="small" sx={{ fontSize: 11 }} />
          <Box sx={{ flex: 1 }} />
          <Tooltip title="Modifica classe">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); setEditClassOpen(true); }}>
              <PencilIcon size={16} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Elimina classe">
            <IconButton
              size="small"
              color="error"
              onClick={(e) => { e.stopPropagation(); setDeleteClassOpen(true); }}
              sx={{ mr: 1 }}
            >
              <TrashIcon size={17} />
            </IconButton>
          </Tooltip>
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1.5}>
          <ClassFieldsSection assetClass={assetClass} />
          {orderedTypes.map((assetType, index) => (
            <Box key={assetType.id} {...typeContainerProps(index)}>
              <AssetTypeBlock assetType={assetType} assetFamilies={assetFamilies} dragHandleProps={typeHandleProps(index)} />
            </Box>
          ))}
          <Box>
            <Button size="small" variant="outlined" onClick={(e) => { e.stopPropagation(); setTypeDialogOpen(true); }}>
              + Nuova sottoclasse
            </Button>
          </Box>
        </Stack>
      </AccordionDetails>
      <NewTypeDialog open={typeDialogOpen} onClose={() => setTypeDialogOpen(false)} assetClassId={assetClass.id} />
      <EditClassDialog open={editClassOpen} onClose={() => setEditClassOpen(false)} assetClass={assetClass} />
      <ConfirmDeleteDialog
        open={deleteClassOpen}
        onClose={() => setDeleteClassOpen(false)}
        title="Elimina classe"
        message={`Stai per eliminare la classe «${assetClass.label}» con tutte le sue sottoclassi e attributi. Non è possibile se esistono ancora asset in una qualsiasi delle sue sottoclassi.`}
        onConfirm={() => deleteClassMutation.mutate()}
        isPending={deleteClassMutation.isPending}
        error={deleteClassMutation.error}
      />
    </Accordion>
  );
}

function AssetFamilyAccordion({ assetFamily, assetFamilies, collapseAllVersion, dragHandleProps }) {
  const queryClient = useQueryClient();
  const [classDialogOpen, setClassDialogOpen] = useState(false);
  const [deleteFamilyOpen, setDeleteFamilyOpen] = useState(false);
  const [editFamilyOpen, setEditFamilyOpen] = useState(false);

  const deleteFamilyMutation = useMutation({
    mutationFn: () => deleteMaintenanceAssetFamily(assetFamily.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-asset-families"] });
      setDeleteFamilyOpen(false);
    },
  });

  const reorderClassesMutation = useMutation({
    mutationFn: (orderedIds) => reorderMaintenanceAssetClasses(assetFamily.id, orderedIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["maintenance-asset-families"] }),
  });
  const { ordered: orderedClasses, handleProps: classHandleProps, containerProps: classContainerProps } =
    useReorderableList(assetFamily.classes, (orderedIds) => reorderClassesMutation.mutate(orderedIds));

  return (
    <Accordion key={collapseAllVersion} variant="outlined" disableGutters sx={{ borderRadius: 2, "&:before": { display: "none" } }}>
      <AccordionSummary expandIcon={<Box component="span">▼</Box>}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
          <DragHandle dragHandlers={dragHandleProps} />
          <Box sx={{ width: 32, height: 32, flexShrink: 0, color: "text.secondary", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <Icon name={assetFamily.icon} size={29} />
          </Box>
          <Typography sx={{ fontWeight: 800 }}>{assetFamily.label}</Typography>
          <Chip label={`${assetFamily.classes.length} ${assetFamily.classes.length === 1 ? "classe" : "classi"}`} size="small" sx={{ fontSize: 11 }} />
          <Box sx={{ flex: 1 }} />
          <Tooltip title="Modifica famiglia">
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); setEditFamilyOpen(true); }}>
              <PencilIcon size={16} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Elimina famiglia">
            <IconButton
              size="small"
              color="error"
              onClick={(e) => { e.stopPropagation(); setDeleteFamilyOpen(true); }}
              sx={{ mr: 1 }}
            >
              <TrashIcon size={17} />
            </IconButton>
          </Tooltip>
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1.5}>
          {orderedClasses.map((assetClass, index) => (
            <Box key={assetClass.id} {...classContainerProps(index)}>
              <AssetClassAccordion
                assetClass={assetClass}
                assetFamilies={assetFamilies}
                collapseAllVersion={collapseAllVersion}
                dragHandleProps={classHandleProps(index)}
              />
            </Box>
          ))}
          <Box>
            <Button size="small" variant="outlined" onClick={(e) => { e.stopPropagation(); setClassDialogOpen(true); }}>
              + Nuova classe
            </Button>
          </Box>
        </Stack>
      </AccordionDetails>
      <NewClassDialog open={classDialogOpen} onClose={() => setClassDialogOpen(false)} assetFamilyId={assetFamily.id} />
      <EditFamilyDialog open={editFamilyOpen} onClose={() => setEditFamilyOpen(false)} assetFamily={assetFamily} />
      <ConfirmDeleteDialog
        open={deleteFamilyOpen}
        onClose={() => setDeleteFamilyOpen(false)}
        title="Elimina famiglia"
        message={`Stai per eliminare la famiglia «${assetFamily.label}» con tutte le sue classi, sottoclassi e attributi. Non è possibile se esistono ancora asset in una qualsiasi delle sue classi.`}
        onConfirm={() => deleteFamilyMutation.mutate()}
        isPending={deleteFamilyMutation.isPending}
        error={deleteFamilyMutation.error}
      />
    </Accordion>
  );
}

export default function MaintenanceAssetTypesAdminPage() {
  const queryClient = useQueryClient();
  const [familyDialogOpen, setFamilyDialogOpen] = useState(false);
  const [collapseAllVersion, setCollapseAllVersion] = useState(0);
  const assetFamiliesQuery = useQuery({ queryKey: ["maintenance-asset-families"], queryFn: getMaintenanceAssetFamilies });
  const assetFamilies = assetFamiliesQuery.data ?? EMPTY_LIST;

  const reorderFamiliesMutation = useMutation({
    mutationFn: (orderedIds) => reorderMaintenanceAssetFamilies(orderedIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["maintenance-asset-families"] }),
  });
  const { ordered: orderedFamilies, handleProps: familyHandleProps, containerProps: familyContainerProps } =
    useReorderableList(assetFamilies, (orderedIds) => reorderFamiliesMutation.mutate(orderedIds));

  return (
    <Box sx={{ minHeight: "100%" }}>
      <Stack spacing={2}>
        <PageHeader
          section="Manutenzioni"
          title="Famiglie, classi e sottoclassi"
          meta="Configurazione anagrafica"
          actions={
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" onClick={() => setCollapseAllVersion((v) => v + 1)}>
                Comprimi tutto
              </Button>
              <HeaderButton onClick={() => setFamilyDialogOpen(true)}>+ Nuova famiglia</HeaderButton>
            </Stack>
          }
        />

        {assetFamiliesQuery.error && <Alert severity="error">{assetFamiliesQuery.error.message}</Alert>}

        <Stack spacing={1.5}>
          {orderedFamilies.map((assetFamily, index) => (
            <Box key={assetFamily.id} {...familyContainerProps(index)}>
              <AssetFamilyAccordion
                assetFamily={assetFamily}
                assetFamilies={assetFamilies}
                collapseAllVersion={collapseAllVersion}
                dragHandleProps={familyHandleProps(index)}
              />
            </Box>
          ))}
          {assetFamilies.length === 0 && !assetFamiliesQuery.isLoading && (
            <Alert severity="info">Nessuna famiglia configurata. Creane una per iniziare.</Alert>
          )}
        </Stack>
      </Stack>

      <NewFamilyDialog open={familyDialogOpen} onClose={() => setFamilyDialogOpen(false)} />
    </Box>
  );
}
