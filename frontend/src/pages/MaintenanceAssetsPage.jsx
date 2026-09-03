import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  InputAdornment,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import dayjs from "dayjs";
import { alpha } from "@mui/material/styles";

import { getEmployeeOptions } from "../api";
import {
  createMaintenanceAsset,
  downloadMaintenanceAssetCountersExport,
  downloadMaintenanceAssetsExport,
  fetchMaintenanceImageBlobUrl,
  getMaintenanceAssetClassCounters,
  getMaintenanceAssetClasses,
  getMaintenanceAssets,
} from "../maintenanceAssetsApi";
import FilterBar from "../components/FilterBar";
import FilterSelect from "../components/FilterSelect";
import PageHeader, { HeaderButton } from "../components/PageHeader";
import { HEADER_GRADIENT } from "../components/pageTokens";
import { bodyRowSx, headRowSx, tableSx } from "../components/tableStyles";
import {
  MAINTENANCE_ASSETS_COLUMNS,
  MAINTENANCE_ASSET_STATUS_LABELS,
} from "./maintenanceAssetsColumns";
import { computeFleetHoursLeaderboard } from "./maintenanceCounterStats";
import {
  countMaintenanceAssetFilters,
  emptyMaintenanceAssetFilters,
  filterMaintenanceAssets,
} from "./maintenanceAssetFilters";

function CustomFieldInput({ field, value, onChange, employeeOptions = [] }) {
  if (field.field_type === "employee") {
    const selected = employeeOptions.find((o) => o.id === value) ?? null;
    return (
      <Autocomplete
        options={employeeOptions}
        getOptionLabel={(o) => o.full_name}
        value={selected}
        onChange={(_, v) => onChange(v?.id ?? null)}
        size="small"
        renderInput={(params) => <TextField {...params} label={field.label} required={field.is_required} />}
      />
    );
  }
  if (field.field_type === "select") {
    return (
      <TextField
        select
        label={field.label}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        size="small"
        fullWidth
        required={field.is_required}
      >
        <MenuItem value="">—</MenuItem>
        {field.options.map((option) => (
          <MenuItem key={option} value={option}>{option}</MenuItem>
        ))}
      </TextField>
    );
  }
  if (field.field_type === "bool") {
    return (
      <FormControlLabel
        control={<Checkbox checked={!!value} onChange={(e) => onChange(e.target.checked)} />}
        label={field.label}
      />
    );
  }
  return (
    <TextField
      label={field.label}
      type={field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : "text"}
      value={value ?? ""}
      onChange={(e) => onChange(field.field_type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)}
      size="small"
      fullWidth
      required={field.is_required}
      InputLabelProps={field.field_type === "date" ? { shrink: true } : undefined}
    />
  );
}

// Unione degli attributi generici di classe e di quelli specifici di
// sottoclasse, nell'ordine sort_order: dal punto di vista del form dell'asset
// sono lo stesso tipo di campo, cambia solo dove è definito (§ decisione
// backend maintenance_assets.py::_field_defs_for_asset_type).
function combinedFields(assetClass, assetType) {
  return [...(assetClass?.fields ?? []), ...(assetType?.fields ?? [])].sort((a, b) => a.sort_order - b.sort_order);
}

function AssetImagePlaceholder() {
  return (
    <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{ width: 21, height: 21 }}>
      <path d="M4 7.5h3l1.4-2h7.2l1.4 2h3a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9.5a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="13.5" r="3.25" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </Box>
  );
}

function AssetListIcon({ type, size = 18 }) {
  const paths = {
    asset: <><rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="M8 9h8M8 13h8M8 17h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="m15.5 15.5 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></>,
    download: <><path d="M12 4v10m-4-4 4 4 4-4M5 19h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></>,
    clock: <><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="M12 7.5v5l3 2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></>,
    plus: <><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></>,
    location: <><path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z" fill="none" stroke="currentColor" strokeWidth="1.7" /><circle cx="12" cy="10" r="2" fill="none" stroke="currentColor" strokeWidth="1.7" /></>,
    arrow: <path d="M6 12h12m-4.5-4.5L18 12l-4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
    layers: <><path d="m12 4 8 4-8 4-8-4 8-4Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="m4 12 8 4 8-4M4 16l8 4 8-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></>,
    unavailable: <><path d="M12 3.5 2.8 20h18.4L12 3.5Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M12 9v4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="12" cy="17" r="1" fill="currentColor" /></>,
    active: <><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="m8.5 12 2.25 2.25 4.75-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></>,
    filter: <><path d="M4 6h16M7 12h10M10 18h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="8" cy="6" r="1.6" fill="currentColor" /><circle cx="15" cy="12" r="1.6" fill="currentColor" /><circle cx="12" cy="18" r="1.6" fill="currentColor" /></>,
  };
  return (
    <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{ width: size, height: size, display: "block" }}>
      {paths[type]}
    </Box>
  );
}

const STATUS_BADGE_TONES = {
  attivo: "success",
  in_manutenzione: "warning",
  fuori_servizio: "error",
};

function statusBadgeColor(theme, status) {
  const tone = STATUS_BADGE_TONES[status];
  return tone ? theme.palette[tone].main : theme.palette.text.secondary;
}

function AssetStatusBadge({ status }) {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.75,
        minHeight: 28,
        px: 1.15,
        borderRadius: 99,
        color: (theme) => statusBadgeColor(theme, status),
        bgcolor: (theme) => alpha(statusBadgeColor(theme, status), 0.1),
        border: "1px solid",
        borderColor: (theme) => alpha(statusBadgeColor(theme, status), 0.24),
        fontSize: 11.5,
        lineHeight: 1,
        fontWeight: 750,
        whiteSpace: "nowrap",
      }}
    >
      <Box component="span" sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: (theme) => statusBadgeColor(theme, status), boxShadow: (theme) => `0 0 0 3px ${alpha(statusBadgeColor(theme, status), 0.1)}` }} />
      {MAINTENANCE_ASSET_STATUS_LABELS[status] ?? status}
    </Box>
  );
}

function FleetMetric({ icon, value, label, tone = "neutral", selected = false, onClick, title }) {
  const tones = {
    green: "#8de3b7",
    amber: "#ffd080",
    neutral: "rgba(255,255,255,0.82)",
  };
  const color = tones[tone];
  return (
    <ButtonBase
      onClick={onClick}
      aria-pressed={selected}
      title={title}
      sx={{
        width: "100%", minHeight: "100%", p: { xs: 1.5, md: 2 }, justifyContent: "flex-start",
        textAlign: "left", transition: "background-color 150ms ease, box-shadow 150ms ease",
        bgcolor: selected ? "rgba(255,255,255,0.14)" : "transparent",
        boxShadow: selected ? "inset 0 -3px 0 rgba(255,255,255,0.85)" : "none",
        "&:hover": { bgcolor: "rgba(255,255,255,0.10)" },
        "&:focus-visible": { outline: "2px solid rgba(255,255,255,0.9)", outlineOffset: -3 },
      }}
    >
      <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
        <Box sx={{ width: 36, height: 36, flexShrink: 0, display: "grid", placeItems: "center", borderRadius: "50%", color, bgcolor: "rgba(255,255,255,0.10)", border: "1px solid", borderColor: "rgba(255,255,255,0.16)" }}>
          <AssetListIcon type={icon} size={18} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ color: "#fff", fontSize: 19, fontWeight: 780, lineHeight: 1.05, letterSpacing: "-0.02em" }}>{value}</Typography>
          <Typography sx={{ mt: 0.3, color: selected ? "#fff" : "rgba(255,255,255,0.72)", fontSize: 11.5, lineHeight: 1.2, fontWeight: selected ? 750 : 400 }} noWrap>{label}</Typography>
        </Box>
      </Stack>
    </ButtonBase>
  );
}

function AssetThumbnail({ imageId, assetCode }) {
  const rootRef = useRef(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [imageUrl, setImageUrl] = useState("");

  useEffect(() => {
    setShouldLoad(false);
    if (!imageId) return undefined;

    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: "180px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [imageId]);

  useEffect(() => {
    let active = true;
    let blobUrl = "";
    setImageUrl("");

    if (!imageId || !shouldLoad) return () => {};

    fetchMaintenanceImageBlobUrl(imageId)
      .then((url) => {
        blobUrl = url;
        if (active) setImageUrl(url);
        else URL.revokeObjectURL(url);
      })
      .catch(() => {
        if (active) setImageUrl("");
      });

    return () => {
      active = false;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [imageId, shouldLoad]);

  return (
    <Box
      ref={rootRef}
      title={imageId ? `Foto principale di ${assetCode}` : "Foto non disponibile"}
      sx={{
        width: 58,
        height: 58,
        flexShrink: 0,
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
        borderRadius: 2,
        color: "primary.main",
        bgcolor: (theme) => alpha(theme.palette.primary.main, 0.07),
        border: "1px solid",
        borderColor: imageUrl ? "divider" : (theme) => alpha(theme.palette.primary.main, 0.18),
      }}
    >
      {imageUrl ? (
        <Box
          component="img"
          src={imageUrl}
          alt={`Foto asset ${assetCode}`}
          sx={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <AssetImagePlaceholder />
      )}
    </Box>
  );
}

function CreateAssetDialog({ open, onClose, assetClasses, defaultAssetClassId }) {
  const queryClient = useQueryClient();
  const [assetClassId, setAssetClassId] = useState("");
  const [assetTypeId, setAssetTypeId] = useState("");
  const [internalCode, setInternalCode] = useState("");
  const [customFields, setCustomFields] = useState({});

  const employeesQuery = useQuery({ queryKey: ["employee-options"], queryFn: getEmployeeOptions, staleTime: 60000 });
  const selectedClass = assetClasses.find((c) => c.id === assetClassId) ?? assetClasses.find((c) => c.id === defaultAssetClassId) ?? assetClasses[0] ?? null;
  const typeOptions = selectedClass?.types ?? [];
  const selectedType = typeOptions.find((t) => t.id === assetTypeId) ?? typeOptions[0] ?? null;
  const fields = combinedFields(selectedClass, selectedType);

  function reset() {
    const initialClass = assetClasses.find((c) => c.id === defaultAssetClassId) ?? assetClasses[0];
    setAssetClassId(initialClass?.id ?? "");
    setAssetTypeId(initialClass?.types?.[0]?.id ?? "");
    setInternalCode("");
    setCustomFields({});
  }

  const createMutation = useMutation({
    mutationFn: createMaintenanceAsset,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-assets"] });
      onClose();
      reset();
    },
  });

  function handleSubmit() {
    if (!selectedType) return;
    createMutation.mutate({
      asset_type_id: selectedType.id,
      internal_code: internalCode.trim() || null,
      custom_fields: customFields,
    });
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ fontWeight: 700 }}>Nuovo asset</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Stack direction="row" spacing={1.5}>
            <TextField
              select
              label="Classe"
              value={selectedClass?.id ?? ""}
              onChange={(e) => {
                setAssetClassId(e.target.value);
                const newClass = assetClasses.find((c) => c.id === e.target.value);
                setAssetTypeId(newClass?.types?.[0]?.id ?? "");
                setCustomFields({});
              }}
              size="small"
              fullWidth
            >
              {assetClasses.map((c) => (
                <MenuItem key={c.id} value={c.id}>{c.label}</MenuItem>
              ))}
            </TextField>

            <TextField
              select
              label="Sottoclasse"
              value={selectedType?.id ?? ""}
              onChange={(e) => { setAssetTypeId(e.target.value); setCustomFields({}); }}
              size="small"
              fullWidth
              disabled={typeOptions.length === 0}
              helperText={typeOptions.length === 0 ? "Nessuna sottoclasse configurata per questa classe" : undefined}
            >
              {typeOptions.map((t) => (
                <MenuItem key={t.id} value={t.id}>{t.label}</MenuItem>
              ))}
            </TextField>
          </Stack>

          <TextField
            label="Codice interno"
            value={internalCode}
            onChange={(e) => setInternalCode(e.target.value)}
            size="small"
            fullWidth
            placeholder="Codifica interna aziendale"
            helperText="Lascia vuoto per generarlo automaticamente"
          />

          {selectedType && fields.some((f) => f.field_type !== "image") && (
            <Box>
              <Typography variant="caption" sx={{ display: "block", mb: 1, fontWeight: 700, textTransform: "uppercase", color: "text.secondary" }}>
                Attributi {selectedType.label.toLowerCase()}
              </Typography>
              <Stack spacing={1.5}>
                {fields.filter((f) => f.field_type !== "image").map((field) => (
                  <CustomFieldInput
                    key={field.id}
                    field={field}
                    value={customFields[field.field_key]}
                    onChange={(value) => setCustomFields((prev) => ({ ...prev, [field.field_key]: value }))}
                    employeeOptions={employeesQuery.data ?? []}
                  />
                ))}
              </Stack>
            </Box>
          )}
          {selectedType && fields.some((f) => f.field_type === "image") && (
            <Alert severity="info">Potrai caricare le immagini di questa sottoclasse dopo aver creato l'asset, dalla sua scheda.</Alert>
          )}

          {createMutation.error && <Alert severity="error">{createMutation.error.message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>Annulla</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={!selectedType || createMutation.isPending}>
          {createMutation.isPending ? "Creazione..." : "Crea asset"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const HOURS_LEADERBOARD_SECTIONS = [
  { key: "total", label: "Totale ore", empty: "Nessuna lettura registrata." },
  { key: "today", label: "Ore oggi", empty: "Nessun asset con una lettura registrata oggi e una precedente." },
  { key: "month", label: "Ore questo mese", empty: "Nessun asset con letture nel mese corrente e nel precedente." },
  { key: "year", label: "Ore quest'anno", empty: "Nessun asset con letture nell'anno corrente e nel precedente." },
];

// Classifica del parco per ore di utilizzo (contaore), per la classe
// corrente: quale asset ha accumulato più ore in totale / oggi / questo
// mese / quest'anno. "Oggi"/"mese"/"anno" sono variazioni (delta tra
// letture), non il totale — vedi computeFleetHoursLeaderboard per la
// definizione esatta di ciascun periodo.
function HoursStatsDialog({ open, onClose, assetClassId, assetClassLabel }) {
  const navigate = useNavigate();
  const countersQuery = useQuery({
    queryKey: ["maintenance-asset-class-counters", assetClassId],
    queryFn: () => getMaintenanceAssetClassCounters(assetClassId),
    enabled: open && Boolean(assetClassId),
  });

  const leaderboard = useMemo(
    () => computeFleetHoursLeaderboard(countersQuery.data ?? []),
    [countersQuery.data],
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ fontWeight: 700 }}>
        Statistiche ore · {assetClassLabel}
      </DialogTitle>
      <DialogContent>
        {countersQuery.isLoading && <Typography sx={{ py: 2, color: "text.secondary" }}>Caricamento...</Typography>}
        {countersQuery.error && <Alert severity="error">{countersQuery.error.message}</Alert>}
        {!countersQuery.isLoading && !countersQuery.error && (
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2, py: 1 }}>
            {HOURS_LEADERBOARD_SECTIONS.map((section) => {
              const rows = leaderboard[section.key].slice(0, 5);
              return (
                <Paper key={section.key} variant="outlined" sx={{ borderRadius: 2.5, overflow: "hidden" }}>
                  <Box sx={{ px: 1.75, py: 1.1, borderBottom: "1px solid", borderColor: "divider", bgcolor: (theme) => alpha(theme.palette.primary.main, 0.06) }}>
                    <Typography sx={{ fontSize: 12.5, fontWeight: 780 }}>{section.label}</Typography>
                  </Box>
                  {rows.length === 0 ? (
                    <Typography sx={{ px: 1.75, py: 2, fontSize: 12.5, color: "text.secondary" }}>{section.empty}</Typography>
                  ) : (
                    <Stack sx={{ py: 0.5 }}>
                      {rows.map((row, index) => (
                        <Stack
                          key={row.asset_id}
                          direction="row"
                          alignItems="center"
                          justifyContent="space-between"
                          onClick={() => navigate(`/manutenzioni/asset/dettaglio/${row.asset_id}`)}
                          sx={{
                            px: 1.75, py: 0.85, cursor: "pointer",
                            "&:hover": { bgcolor: "action.hover" },
                          }}
                        >
                          <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                            <Typography sx={{ fontSize: 11.5, fontWeight: 780, color: "text.secondary", width: 16 }}>{index + 1}</Typography>
                            <Typography sx={{ fontSize: 13, fontWeight: 650 }} noWrap>{row.asset_internal_code}</Typography>
                          </Stack>
                          <Typography sx={{ fontSize: 13, fontWeight: 780, whiteSpace: "nowrap" }}>
                            {row.value.toFixed(1)} <Box component="span" sx={{ fontSize: 11, fontWeight: 600, color: "text.secondary" }}>ore</Box>
                          </Typography>
                        </Stack>
                      ))}
                    </Stack>
                  )}
                </Paper>
              );
            })}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>Chiudi</Button>
      </DialogActions>
    </Dialog>
  );
}

function attributeOptions(field, assets) {
  if (field.field_type === "image") {
    return [
      { value: "present", label: "Immagine presente" },
      { value: "missing", label: "Immagine assente" },
    ];
  }
  if (field.field_type === "bool") {
    return [
      { value: "true", label: "Sì" },
      { value: "false", label: "No" },
      { value: "__missing__", label: "Non valorizzato" },
    ];
  }

  const seen = new Map(
    field.field_type === "select"
      ? (field.options ?? []).map((option) => [String(option), String(option)])
      : [],
  );
  for (const asset of assets) {
    if (field.assetTypeIds.length > 0 && !field.assetTypeIds.includes(asset.asset_type_id)) continue;
    const rawValue = asset.custom_fields?.[field.field_key];
    if (rawValue === null || rawValue === undefined || rawValue === "") continue;
    const label = field.field_type === "employee"
      ? asset.employee_field_names?.[field.field_key] || String(rawValue)
      : String(rawValue);
    seen.set(String(rawValue), label);
  }
  const options = Array.from(seen.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "it", { numeric: true }));
  options.push({ value: "__missing__", label: "Non valorizzato" });
  return options;
}

function AttributeFilterControl({ field, assets, value, onChange }) {
  if (field.field_type === "number") {
    return (
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <TextField
          label="Esattamente"
          type="number"
          size="small"
          fullWidth
          value={value?.exact ?? ""}
          onChange={(event) => onChange({ ...value, exact: event.target.value })}
        />
        <TextField
          label="Minimo"
          type="number"
          size="small"
          fullWidth
          value={value?.min ?? ""}
          onChange={(event) => onChange({ ...value, min: event.target.value })}
        />
        <TextField
          label="Massimo"
          type="number"
          size="small"
          fullWidth
          value={value?.max ?? ""}
          onChange={(event) => onChange({ ...value, max: event.target.value })}
        />
      </Stack>
    );
  }
  if (field.field_type === "date") {
    return (
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <TextField label="Dal" type="date" size="small" fullWidth value={value?.min ?? ""} onChange={(event) => onChange({ ...value, min: event.target.value })} InputLabelProps={{ shrink: true }} />
        <TextField label="Al" type="date" size="small" fullWidth value={value?.max ?? ""} onChange={(event) => onChange({ ...value, max: event.target.value })} InputLabelProps={{ shrink: true }} />
      </Stack>
    );
  }

  return (
    <FilterSelect
      label="Valori"
      value={value?.values ?? []}
      onChange={(values) => onChange({ ...value, values })}
      options={attributeOptions(field, assets)}
      multiple
      sx={{ width: "100%", maxWidth: "none" }}
    />
  );
}

function AssetFiltersDialog({ open, onClose, filters, onApply, assetClass, assets, fields, yearField }) {
  const [draft, setDraft] = useState(() => emptyMaintenanceAssetFilters());

  useEffect(() => {
    if (open) setDraft({ ...filters, statuses: [...filters.statuses], assetTypeIds: [...filters.assetTypeIds], attributes: { ...filters.attributes } });
  }, [open, filters]);

  const visibleFields = fields.filter((field) =>
    draft.assetTypeIds.length === 0
    || field.assetTypeIds.length === 0
    || field.assetTypeIds.some((id) => draft.assetTypeIds.includes(id)),
  );
  const commonFields = visibleFields.filter((field) => field.assetTypeIds.length === 0);
  const typeFields = assetClass.types
    .map((assetType) => ({
      assetType,
      fields: visibleFields.filter((field) => field.assetTypeIds.includes(assetType.id)),
    }))
    .filter((group) => group.fields.length > 0);

  function setAttribute(filterId, value) {
    setDraft((current) => ({
      ...current,
      attributes: { ...current.attributes, [filterId]: value },
    }));
  }

  function renderAttribute(field) {
    return (
      <Paper key={field.filterId} variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: "background.default" }}>
        <Stack direction="row" justifyContent="space-between" spacing={1} sx={{ mb: 1.1 }}>
          <Box>
            <Typography sx={{ fontSize: 13, fontWeight: 750 }}>{field.label}</Typography>
            <Typography sx={{ mt: 0.2, fontSize: 11, color: "text.secondary" }}>
              {field.field_type === "number" ? "Valore esatto oppure intervallo numerico inclusivo." : field.field_type === "date" ? "Intervallo di date inclusivo." : "Puoi selezionare più valori."}
            </Typography>
          </Box>
          {field.is_required && <Chip label="Obbligatorio" size="small" variant="outlined" sx={{ height: 22, fontSize: 10.5 }} />}
        </Stack>
        <AttributeFilterControl
          field={field}
          assets={assets}
          value={draft.attributes[field.filterId]}
          onChange={(value) => setAttribute(field.filterId, value)}
        />
      </Paper>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: 3, maxHeight: "92vh" } }}>
      <DialogTitle sx={{ pb: 1.25 }}>
        <Stack direction="row" alignItems="center" spacing={1.25}>
          <Box sx={{ width: 38, height: 38, display: "grid", placeItems: "center", borderRadius: 2, color: "primary.main", bgcolor: (theme) => alpha(theme.palette.primary.main, 0.1) }}>
            <AssetListIcon type="filter" size={19} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: 18, fontWeight: 800 }}>Filtri asset</Typography>
            <Typography sx={{ fontSize: 12, color: "text.secondary", fontWeight: 500 }}>Affina il parco {assetClass.label.toLowerCase()} per dati anagrafici e tecnici.</Typography>
          </Box>
        </Stack>
      </DialogTitle>
      <Divider />
      <DialogContent sx={{ py: 2.25 }}>
        <Stack spacing={2.5}>
          <Box>
            <Typography sx={{ mb: 1.2, fontSize: 11, fontWeight: 800, color: "text.secondary", letterSpacing: "0.08em", textTransform: "uppercase" }}>Identificazione e stato</Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5 }}>
              <FilterSelect
                label="Stato"
                value={draft.statuses}
                onChange={(statuses) => setDraft((current) => ({ ...current, statuses }))}
                options={Object.entries(MAINTENANCE_ASSET_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
                multiple
              />
              <FilterSelect
                label="Sottoclasse"
                value={draft.assetTypeIds}
                onChange={(assetTypeIds) => setDraft((current) => ({
                  ...current,
                  assetTypeIds,
                  // Un criterio di una sottoclasse esclusa non deve restare
                  // attivo e invisibile dopo la modifica di questo filtro.
                  attributes: Object.fromEntries(Object.entries(current.attributes).filter(([fieldId]) => {
                    const field = fields.find((item) => item.filterId === fieldId);
                    return !field || field.assetTypeIds.length === 0 || assetTypeIds.length === 0 || field.assetTypeIds.some((id) => assetTypeIds.includes(id));
                  })),
                }))}
                options={assetClass.types.map((type) => ({ value: type.id, label: type.label }))}
                multiple
              />
              <FilterSelect
                label="Foto principale"
                value={draft.hasMainImage}
                onChange={(hasMainImage) => setDraft((current) => ({ ...current, hasMainImage }))}
                options={[{ value: "yes", label: "Presente" }, { value: "no", label: "Assente" }]}
              />
              <FilterSelect
                label="Completezza scheda"
                value={draft.requiredFields}
                onChange={(requiredFields) => setDraft((current) => ({ ...current, requiredFields }))}
                options={[{ value: "complete", label: "Campi obbligatori completi" }, { value: "incomplete", label: "Con dati obbligatori mancanti" }]}
              />
            </Box>
          </Box>

          <Divider />
          <Box>
            <Typography sx={{ mb: 1.2, fontSize: 11, fontWeight: 800, color: "text.secondary", letterSpacing: "0.08em", textTransform: "uppercase" }}>Date e ordinamento</Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5 }}>
              <Stack direction="row" spacing={1}>
                <TextField label="Creato dal" type="date" size="small" fullWidth value={draft.createdFrom} onChange={(event) => setDraft((current) => ({ ...current, createdFrom: event.target.value }))} InputLabelProps={{ shrink: true }} />
                <TextField label="Creato al" type="date" size="small" fullWidth value={draft.createdTo} onChange={(event) => setDraft((current) => ({ ...current, createdTo: event.target.value }))} InputLabelProps={{ shrink: true }} />
              </Stack>
              <Stack direction="row" spacing={1}>
                <TextField label="Aggiornato dal" type="date" size="small" fullWidth value={draft.updatedFrom} onChange={(event) => setDraft((current) => ({ ...current, updatedFrom: event.target.value }))} InputLabelProps={{ shrink: true }} />
                <TextField label="Aggiornato al" type="date" size="small" fullWidth value={draft.updatedTo} onChange={(event) => setDraft((current) => ({ ...current, updatedTo: event.target.value }))} InputLabelProps={{ shrink: true }} />
              </Stack>
              <TextField select label="Ordina per" size="small" value={draft.sort} onChange={(event) => setDraft((current) => ({ ...current, sort: event.target.value }))} fullWidth>
                <MenuItem value="updated_desc">Ultima modifica · più recenti</MenuItem>
                <MenuItem value="updated_asc">Ultima modifica · meno recenti</MenuItem>
                <MenuItem value="created_desc">Inserimento · più recenti</MenuItem>
                <MenuItem value="created_asc">Inserimento · meno recenti</MenuItem>
                <MenuItem value="code_asc">Codice interno · A–Z</MenuItem>
                {yearField && <MenuItem value="oldest">Asset più vecchi</MenuItem>}
              </TextField>
            </Box>
          </Box>

          {(commonFields.length > 0 || typeFields.length > 0) && <Divider />}
          {commonFields.length > 0 && (
            <Box>
              <Typography sx={{ mb: 0.35, fontSize: 11, fontWeight: 800, color: "text.secondary", letterSpacing: "0.08em", textTransform: "uppercase" }}>Attributi comuni</Typography>
              <Typography sx={{ mb: 1.25, fontSize: 12, color: "text.secondary" }}>Campi presenti su tutte le sottoclassi.</Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1.25 }}>{commonFields.map(renderAttribute)}</Box>
            </Box>
          )}
          {typeFields.map(({ assetType, fields: groupFields }) => (
            <Box key={assetType.id}>
              <Typography sx={{ mb: 0.35, fontSize: 11, fontWeight: 800, color: "text.secondary", letterSpacing: "0.08em", textTransform: "uppercase" }}>Attributi · {assetType.label}</Typography>
              <Typography sx={{ mb: 1.25, fontSize: 12, color: "text.secondary" }}>Un filtro specifico include soltanto gli asset di questa sottoclasse.</Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1.25 }}>{groupFields.map(renderAttribute)}</Box>
            </Box>
          ))}
        </Stack>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 1.75 }}>
        <Button onClick={() => setDraft(emptyMaintenanceAssetFilters())} disabled={countMaintenanceAssetFilters(draft) === 0} sx={{ mr: "auto", textTransform: "none" }}>Azzera tutto</Button>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>Annulla</Button>
        <Button variant="contained" onClick={() => { onApply(draft); onClose(); }}>Applica filtri</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function MaintenanceAssetsPage() {
  const navigate = useNavigate();
  const { classCode } = useParams();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(() => emptyMaintenanceAssetFilters());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [hoursStatsOpen, setHoursStatsOpen] = useState(false);
  const [exportError, setExportError] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingHours, setIsExportingHours] = useState(false);

  const assetClassesQuery = useQuery({ queryKey: ["maintenance-asset-classes"], queryFn: getMaintenanceAssetClasses });
  const assetClasses = assetClassesQuery.data ?? [];
  const currentClass = assetClasses.find((c) => c.code === classCode) ?? null;

  // Ogni classe espone attributi differenti: conservare i filtri quando si
  // cambia voce di menu produrrebbe risultati vuoti e criteri invisibili.
  useEffect(() => {
    setSearch("");
    setFilters(emptyMaintenanceAssetFilters());
  }, [classCode]);

  const assetsQuery = useQuery({
    queryKey: ["maintenance-assets", currentClass?.id],
    queryFn: () => getMaintenanceAssets({ assetClassId: currentClass.id }),
    enabled: Boolean(currentClass),
  });

  const overviewAssets = assetsQuery.data ?? [];
  // Ogni definizione mantiene il proprio ambito: due sottoclassi possono
  // avere la stessa field_key, ma il filtro deve restare attribuito a quella
  // corretta. Sono inclusi anche i campi immagine e quelli non ricercabili
  // nella ricerca testuale: il dialog permette di filtrarne la presenza.
  const filterFields = useMemo(
    () => [
      ...(currentClass?.fields ?? []).map((field) => ({
        ...field,
        filterId: `class:${field.id}`,
        assetTypeIds: [],
      })),
      ...(currentClass?.types ?? []).flatMap((assetType) =>
        assetType.fields.map((field) => ({
          ...field,
          filterId: `type:${assetType.id}:${field.id}`,
          assetTypeIds: [assetType.id],
        })),
      ),
    ],
    [currentClass],
  );
  const yearField = useMemo(
    () => filterFields.find((field) =>
      ["number", "text"].includes(field.field_type)
      && /(anno|year|costru|install)/i.test(`${field.field_key} ${field.label}`),
    ) ?? null,
    [filterFields],
  );
  const assets = useMemo(
    () => filterMaintenanceAssets(overviewAssets, filters, filterFields, search, yearField),
    [overviewAssets, filters, filterFields, search, yearField],
  );
  const activeFilterCount = countMaintenanceAssetFilters(filters);
  const hasActiveFilters = Boolean(search) || activeFilterCount > 0;
  const activeKpiSelected = filters.statuses.length === 1 && filters.statuses[0] === "attivo";
  const unavailableKpiSelected = filters.statuses.length === 2
    && filters.statuses.includes("in_manutenzione")
    && filters.statuses.includes("fuori_servizio");
  const isOverviewLoading = assetsQuery.isLoading;
  const activeAssetCount = overviewAssets.filter((asset) => asset.status === "attivo").length;
  const unavailableAssetCount = overviewAssets.filter((asset) => ["in_manutenzione", "fuori_servizio"].includes(asset.status)).length;
  const assetTypeCount = new Set(overviewAssets.map((asset) => asset.asset_type_label).filter(Boolean)).size;
  const tracksUsageHours = (currentClass?.types ?? []).some((assetType) => assetType.tracks_usage_hours);
  const filterSummary = useMemo(() => {
    const labels = [];
    if (filters.statuses.length > 0) {
      labels.push(`Stato: ${filters.statuses.map((status) => MAINTENANCE_ASSET_STATUS_LABELS[status] ?? status).join(", ")}`);
    }
    if (filters.assetTypeIds.length > 0) {
      const names = filters.assetTypeIds.map((id) => currentClass?.types.find((type) => type.id === id)?.label ?? id);
      labels.push(`Sottoclasse: ${names.join(", ")}`);
    }
    if (filters.hasMainImage) labels.push(filters.hasMainImage === "yes" ? "Con foto principale" : "Senza foto principale");
    if (filters.requiredFields) labels.push(filters.requiredFields === "complete" ? "Scheda completa" : "Dati obbligatori mancanti");
    if (filters.createdFrom || filters.createdTo) labels.push(`Inserimento: ${filters.createdFrom || "inizio"} → ${filters.createdTo || "oggi"}`);
    if (filters.updatedFrom || filters.updatedTo) labels.push(`Aggiornamento: ${filters.updatedFrom || "inizio"} → ${filters.updatedTo || "oggi"}`);
    if (filters.sort !== "updated_desc") {
      const sortLabels = {
        updated_asc: "Modificati meno di recente",
        created_desc: "Inseriti più di recente",
        created_asc: "Inseriti meno di recente",
        code_asc: "Codice A–Z",
        oldest: "Asset più vecchi",
      };
      labels.push(`Ordine: ${sortLabels[filters.sort]}`);
    }
    for (const [fieldId, condition] of Object.entries(filters.attributes)) {
      const field = filterFields.find((item) => item.filterId === fieldId);
      if (!field) continue;
      if ((condition.values?.length ?? 0) > 0) {
        const optionLabels = new Map(attributeOptions(field, overviewAssets).map((option) => [option.value, option.label]));
        labels.push(`${field.label}: ${condition.values.map((value) => optionLabels.get(value) ?? value).join(", ")}`);
      } else if ((condition.exact ?? "") !== "") {
        labels.push(`${field.label}: ${condition.exact}`);
      } else if ((condition.min ?? "") !== "" || (condition.max ?? "") !== "") {
        labels.push(`${field.label}: ${condition.min || "−∞"} → ${condition.max || "+∞"}`);
      }
    }
    return labels;
  }, [currentClass, filterFields, filters, overviewAssets]);

  async function handleExport() {
    if (!currentClass) return;
    setIsExporting(true);
    setExportError("");
    try {
      await downloadMaintenanceAssetsExport({
        assetClassId: currentClass.id,
        assetTypeId: filters.assetTypeIds.length === 1 ? filters.assetTypeIds[0] : "",
        search,
        status: filters.statuses.length === 1 ? filters.statuses[0] : "",
      });
    } catch (error) {
      setExportError(error?.message || "Errore durante l'esportazione");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleExportHours() {
    setIsExportingHours(true);
    setExportError("");
    try {
      await downloadMaintenanceAssetCountersExport();
    } catch (error) {
      setExportError(error?.message || "Errore durante l'esportazione");
    } finally {
      setIsExportingHours(false);
    }
  }

  function toggleStatusKpi(statuses, isSelected) {
    setFilters((current) => ({ ...current, statuses: isSelected ? [] : statuses }));
  }

  if (assetClassesQuery.isLoading) return <Typography sx={{ p: 3 }}>Caricamento...</Typography>;
  if (!currentClass) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">Classe non trovata. Verifica la configurazione in Manutenzioni · Famiglie/classi.</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: "100%", borderRadius: 3 }}>
      <Stack spacing={2}>
        <PageHeader
          section="Manutenzioni"
          title={currentClass.label}
          meta={isOverviewLoading ? "Caricamento asset…" : `${overviewAssets.length} ${overviewAssets.length === 1 ? "asset registrato" : "asset registrati"}`}
          actions={
            <>
              <HeaderButton startIcon={<AssetListIcon type="download" size={16} />} onClick={handleExport} disabled={isExporting}>
                {isExporting ? "Esportazione..." : "Esporta"}
              </HeaderButton>
              <HeaderButton startIcon={<AssetListIcon type="clock" size={16} />} onClick={handleExportHours} disabled={isExportingHours}>
                {isExportingHours ? "Esportazione..." : "Esporta ore"}
              </HeaderButton>
              {tracksUsageHours && (
                <HeaderButton startIcon={<AssetListIcon type="clock" size={16} />} onClick={() => setHoursStatsOpen(true)}>
                  Statistiche ore
                </HeaderButton>
              )}
              <HeaderButton startIcon={<AssetListIcon type="plus" size={16} />} onClick={() => setCreateOpen(true)}>Nuovo asset</HeaderButton>
            </>
          }
        />

        {assetsQuery.error && <Alert severity="error">{assetsQuery.error.message}</Alert>}
        {exportError && <Alert severity="error" onClose={() => setExportError("")}>{exportError}</Alert>}

        <Paper
          variant="outlined"
          sx={{
            position: "relative",
            overflow: "hidden",
            borderRadius: 3,
            borderColor: (theme) => alpha(theme.palette.primary.main, 0.34),
            background: HEADER_GRADIENT,
            boxShadow: (theme) => `0 10px 28px ${alpha(theme.palette.primary.dark, 0.16)}`,
            "&::after": {
              content: '\"\"',
              position: "absolute",
              width: 260,
              height: 260,
              right: -100,
              top: -150,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.06)",
            },
          }}
        >
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", md: "1.35fr repeat(4, 1fr)" }, position: "relative", zIndex: 1 }}>
            <Box sx={{ gridColumn: { xs: "1 / -1", md: "auto" }, p: { xs: 1.75, md: 2 }, borderRight: { md: "1px solid rgba(255,255,255,0.10)" }, borderBottom: { xs: "1px solid rgba(255,255,255,0.10)", md: 0 } }}>
              <Typography sx={{ color: "rgba(255,255,255,0.70)", fontSize: 10.5, fontWeight: 750, letterSpacing: "0.09em", textTransform: "uppercase" }}>
                Parco della classe
              </Typography>
              <Typography sx={{ mt: 0.55, color: "#fff", fontSize: 15, fontWeight: 720 }} noWrap>
                {currentClass.label}
              </Typography>
            </Box>
            <Box sx={{ borderBottom: { xs: "1px solid rgba(255,255,255,0.10)", md: 0 }, borderRight: "1px solid rgba(255,255,255,0.10)" }}>
              <FleetMetric
                icon="asset"
                value={isOverviewLoading ? "—" : overviewAssets.length}
                label="Asset registrati"
                selected={!hasActiveFilters}
                onClick={() => { setSearch(""); setFilters(emptyMaintenanceAssetFilters()); }}
                title="Mostra tutti gli asset registrati"
              />
            </Box>
            <Box sx={{ borderBottom: { xs: "1px solid rgba(255,255,255,0.10)", md: 0 }, borderRight: { md: "1px solid rgba(255,255,255,0.10)" } }}>
              <FleetMetric
                icon="active"
                value={isOverviewLoading ? "—" : activeAssetCount}
                label="Attivi"
                tone="green"
                selected={activeKpiSelected}
                onClick={() => toggleStatusKpi(["attivo"], activeKpiSelected)}
                title={activeKpiSelected ? "Rimuovi il filtro sugli asset attivi" : "Mostra soltanto gli asset attivi"}
              />
            </Box>
            <Box sx={{ borderRight: "1px solid rgba(255,255,255,0.10)" }}>
              <FleetMetric
                icon="unavailable"
                value={isOverviewLoading ? "—" : unavailableAssetCount}
                label="Non disponibili"
                tone="amber"
                selected={unavailableKpiSelected}
                onClick={() => toggleStatusKpi(["in_manutenzione", "fuori_servizio"], unavailableKpiSelected)}
                title={unavailableKpiSelected ? "Rimuovi il filtro sugli asset non disponibili" : "Mostra asset in manutenzione o fuori servizio"}
              />
            </Box>
            <Box>
              <FleetMetric
                icon="layers"
                value={isOverviewLoading ? "—" : assetTypeCount}
                label={assetTypeCount === 1 ? "Sottoclasse presente" : "Sottoclassi presenti"}
                selected={filters.assetTypeIds.length > 0}
                onClick={() => setFiltersOpen(true)}
                title="Scegli le sottoclassi da visualizzare"
              />
            </Box>
          </Box>
        </Paper>

        <FilterBar
          onReset={() => { setSearch(""); setFilters(emptyMaintenanceAssetFilters()); }}
          resetDisabled={!hasActiveFilters}
          dense
        >
          <TextField
            size="small"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca per codice, produttore, modello, sito..."
            InputProps={{
              startAdornment: <InputAdornment position="start" sx={{ color: "text.disabled" }}><AssetListIcon type="search" size={17} /></InputAdornment>,
            }}
            sx={{ flex: "1 1 280px" }}
          />
          <Button
            variant={activeFilterCount > 0 ? "contained" : "outlined"}
            startIcon={<AssetListIcon type="filter" size={17} />}
            onClick={() => setFiltersOpen(true)}
            sx={{ minHeight: 40, px: 1.75, flexShrink: 0, textTransform: "none", borderRadius: 2, fontWeight: 750 }}
          >
            Filtri{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
          </Button>
        </FilterBar>

        {filterSummary.length > 0 && (
          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" alignItems="center">
            <Typography sx={{ mr: 0.25, fontSize: 11.5, fontWeight: 750, color: "text.secondary" }}>Filtri applicati</Typography>
            {filterSummary.slice(0, 6).map((label) => (
              <Chip key={label} label={label} size="small" variant="outlined" sx={{ height: 27, bgcolor: "background.paper", fontSize: 11.5 }} />
            ))}
            {filterSummary.length > 6 && <Chip label={`+${filterSummary.length - 6} altri`} size="small" color="primary" sx={{ height: 27, fontSize: 11.5 }} />}
          </Stack>
        )}

        <Paper
          variant="outlined"
          sx={{
            borderRadius: 3,
            overflow: "hidden",
            borderColor: (theme) => alpha(theme.palette.primary.main, 0.2),
            boxShadow: (theme) => `0 10px 30px ${alpha(theme.palette.common.black, theme.palette.mode === "dark" ? 0.16 : 0.06)}`,
          }}
        >
          <Stack
            direction="row"
            alignItems="center"
            spacing={2}
            sx={{
              px: 2,
              py: 1.6,
              borderBottom: "1px solid",
              borderColor: "divider",
              background: (theme) => `linear-gradient(180deg, ${alpha(theme.palette.primary.main, 0.1)}, ${alpha(theme.palette.background.paper, 0.96)})`,
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: 15, fontWeight: 780, color: "text.primary", letterSpacing: "-0.01em" }}>
                Registro asset
              </Typography>
              <Typography sx={{ mt: 0.15, fontSize: 12, color: "text.secondary" }}>
                Identificazione, collocazione e stato operativo della classe.
              </Typography>
            </Box>
            <Typography sx={{ fontSize: 12, color: "text.secondary", fontWeight: 650, whiteSpace: "nowrap" }}>
              {assets.length} {assets.length === 1 ? "risultato" : "risultati"}
              {overviewAssets.length !== assets.length ? ` su ${overviewAssets.length}` : ""}
            </Typography>
          </Stack>
          <TableContainer>
            <Table size="small" sx={tableSx({ minWidth: 860 })}>
              <TableHead>
                <TableRow sx={headRowSx}>
                  {MAINTENANCE_ASSETS_COLUMNS.map((column) => (
                    <TableCell key={column.key} align={column.align} sx={{ width: `${column.width}%` }}>
                      {column.label}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {assets.map((asset) => (
                  <TableRow
                    key={asset.id}
                    hover
                    tabIndex={0}
                    role="link"
                    onClick={() => navigate(`/manutenzioni/asset/dettaglio/${asset.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        navigate(`/manutenzioni/asset/dettaglio/${asset.id}`);
                      }
                    }}
                    sx={{
                      ...bodyRowSx({ clickable: true }),
                      transition: "background-color 140ms ease, box-shadow 140ms ease",
                      "& > td": { py: 1.05, borderColor: "divider" },
                      "& > td:first-of-type": { borderLeft: "3px solid", borderLeftColor: (theme) => statusBadgeColor(theme, asset.status) },
                      "&:hover": { bgcolor: "action.selected" },
                      "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 },
                    }}
                  >
                    <TableCell>
                      <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
                        <AssetThumbnail imageId={asset.main_image_id} assetCode={asset.internal_code} />
                        <Box sx={{ minWidth: 0 }}>
                          <Typography sx={{ fontSize: 14, lineHeight: 1.25, fontWeight: 780, letterSpacing: "-0.01em" }} noWrap title={asset.internal_code}>
                            {asset.internal_code}
                          </Typography>
                          <Typography sx={{ mt: 0.45, fontSize: 11.75, lineHeight: 1.2, color: "text.secondary" }} noWrap title={asset.asset_type_label}>
                            {asset.asset_type_label}
                          </Typography>
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography sx={{ fontSize: 13, fontWeight: 650 }} noWrap title={[asset.custom_fields?.brand, asset.custom_fields?.model].filter(Boolean).join(" ")}>
                        {[asset.custom_fields?.brand, asset.custom_fields?.model].filter(Boolean).join(" ") || "—"}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.7} alignItems="center" sx={{ color: asset.custom_fields?.site ? "text.secondary" : "text.disabled" }}>
                        <AssetListIcon type="location" size={15} />
                        <Typography sx={{ minWidth: 0, fontSize: 12.5, color: "inherit" }} noWrap title={asset.custom_fields?.site || ""}>{asset.custom_fields?.site || "Non assegnato"}</Typography>
                      </Stack>
                    </TableCell>
                    <TableCell align="center">
                      <AssetStatusBadge status={asset.status} />
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.8} alignItems="center" justifyContent="flex-end">
                        <Typography sx={{ fontSize: 11.75, color: "text.secondary", whiteSpace: "nowrap" }}>{dayjs(asset.updated_at).format("DD/MM/YYYY")}</Typography>
                        <Box sx={{ width: 26, height: 26, flexShrink: 0, display: "grid", placeItems: "center", borderRadius: "50%", color: "primary.main", bgcolor: (theme) => alpha(theme.palette.primary.main, 0.08) }}>
                          <AssetListIcon type="arrow" size={15} />
                        </Box>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}

                {assetsQuery.isLoading && Array.from({ length: 4 }, (_, index) => (
                  <TableRow key={`asset-skeleton-${index}`}>
                    {MAINTENANCE_ASSETS_COLUMNS.map((column) => (
                      <TableCell key={column.key} sx={{ py: 1.4 }}>
                        <Skeleton variant="rounded" height={column.key === "asset" ? 44 : 18} sx={{ borderRadius: 1.5 }} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}

                {assets.length === 0 && !assetsQuery.isLoading && (
                  <TableRow>
                    <TableCell colSpan={MAINTENANCE_ASSETS_COLUMNS.length} sx={{ py: 6, textAlign: "center" }}>
                      <Box
                        sx={{
                          width: 48,
                          height: 48,
                          mx: "auto",
                          mb: 1.25,
                          display: "grid",
                          placeItems: "center",
                          borderRadius: 2,
                          bgcolor: (theme) => alpha(theme.palette.primary.main, 0.09),
                          color: "primary.main",
                        }}
                      >
                        <AssetImagePlaceholder />
                      </Box>
                      <Typography sx={{ fontSize: 14, fontWeight: 700 }}>Nessun asset trovato</Typography>
                      <Typography sx={{ mt: 0.35, fontSize: 12.5, color: "text.secondary" }}>
                        {hasActiveFilters ? "Prova a modificare o azzerare i filtri." : "Crea il primo asset di questa classe."}
                      </Typography>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => {
                          if (hasActiveFilters) {
                            setSearch("");
                            setFilters(emptyMaintenanceAssetFilters());
                          } else {
                            setCreateOpen(true);
                          }
                        }}
                        sx={{ mt: 1.5, textTransform: "none", borderRadius: 2 }}
                      >
                        {hasActiveFilters ? "Azzera filtri" : "+ Nuovo asset"}
                      </Button>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      </Stack>

      <AssetFiltersDialog
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={filters}
        onApply={setFilters}
        assetClass={currentClass}
        assets={overviewAssets}
        fields={filterFields}
        yearField={yearField}
      />
      <CreateAssetDialog open={createOpen} onClose={() => setCreateOpen(false)} assetClasses={assetClasses} defaultAssetClassId={currentClass.id} />
      {tracksUsageHours && (
        <HoursStatsDialog
          open={hoursStatsOpen}
          onClose={() => setHoursStatsOpen(false)}
          assetClassId={currentClass.id}
          assetClassLabel={currentClass.label}
        />
      )}
    </Box>
  );
}
