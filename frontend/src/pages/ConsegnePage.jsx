import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import FilterBar from "../components/FilterBar";
import PageHeader from "../components/PageHeader";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  Link,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useMemo, useRef, useState } from "react";

import {
  createDeviceAsset,
  deleteDeviceDeliveryAssignment,
  deleteDelivery,
  createDeviceDeliveryAssignment,
  createEquipmentItem,
  downloadDeliveriesExport,
  downloadDeviceDeliveriesExport,
  downloadEmployeeDeliverySheet,
  getDeliveries,
  getDeliverySizeGroups,
  getDeviceAssets,
  getDeviceDeliveries,
  getDeviceDeliveryPolicy,
  getEmployeeOptions,
  getEquipmentItems,
  markDeliveryReturned,
  redeliverDeviceDelivery,
  requestDeviceDeliverySignature,
  syncDeviceAssets,
  updateDeviceAsset,
  updateDeviceDeliveryPolicy,
  updateEquipmentItem,
} from "../api";

const CATEGORY_OPTIONS = [
  { value: "vestiario", label: "Vestiario" },
  { value: "dpi", label: "DPI" },
  { value: "altro", label: "Altro" },
];

const AREAS = [
  {
    key: "dpi",
    label: "DPI e Vestiario",
    icon: "shield",
    accent: "#007040",
    gradient: "linear-gradient(135deg, rgba(18,77,52,0.98), rgba(0,112,64,0.92))",
    title: "Dotazioni DPI e vestiario",
    description:
      "Dispositivi di protezione individuale e vestiario aziendale: storico consegne con firma, schede DPI e catalogo articoli con taglie. I dipendenti arrivano dall'anagrafica TMS.",
  },
  {
    key: "it",
    label: "Dotazione IT",
    icon: "laptop",
    accent: "#1565c0",
    gradient: "linear-gradient(135deg, rgba(16,42,84,0.98), rgba(21,101,192,0.90))",
    title: "Dotazione IT",
    description:
      "PC e smartphone aziendali: assegnazioni con firma dall'app tablet, riconsegne e parco dispositivi sincronizzato da NinjaOne.",
  },
];

function AreaIcon({ name, size = 20 }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
  if (name === "shield") {
    return (
      <svg {...common}>
        <path d="M12 3l7 3v5c0 4.4-2.9 7.9-7 9.5C7.9 18.9 5 15.4 5 11V6z" />
        <path d="m9 11.5 2 2 4-4.5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="4.5" y="5" width="15" height="10.5" rx="1.5" />
      <path d="M3 18.5h18" />
    </svg>
  );
}

function StatTile({ value, label }) {
  return (
    <Box sx={{ px: 1.5, py: 0.5, borderRadius: 2, bgcolor: "action.hover", minWidth: 96 }}>
      <Typography sx={{ fontSize: 17, fontWeight: 700, lineHeight: 1.2 }}>{value ?? "—"}</Typography>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Box>
  );
}

function categoryChip(category) {
  const label = CATEGORY_OPTIONS.find((option) => option.value === category)?.label || category;
  if (category === "dpi") return <Chip size="small" color="warning" variant="outlined" label={label} sx={{ fontWeight: 600 }} />;
  if (category === "vestiario") return <Chip size="small" color="success" variant="outlined" label={label} sx={{ fontWeight: 600 }} />;
  return <Chip size="small" variant="outlined" label={label} />;
}

const EMPTY_ITEM_FORM = {
  name: "",
  category: "vestiario",
  notes: "",
  available_size_ids: [],
  is_active: true,
};

const ASSET_TYPE_OPTIONS = [
  { value: "pc", label: "PC" },
  { value: "smartphone", label: "Smartphone" },
];

const EMPTY_DEVICE_FORM = {
  asset_type: "pc",
  brand: "",
  model: "",
  serial_number: "",
  imei: "",
  iccid: "",
  phone_number: "",
  notes: "",
  is_active: true,
};

const EMPTY_DEVICE_ASSIGNMENT_FORM = {
  employee: null,
  device: null,
  notes: "",
};

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("it-IT");
}

function statusChip(delivery) {
  if (delivery.status === "pending_signature") return <Chip size="small" label="In attesa firma" color="warning" />;
  if (delivery.status === "pending_return_signature") return <Chip size="small" label="In attesa firma riconsegna" color="warning" />;
  if (delivery.status === "redelivered") return <Chip size="small" label="Riconsegnato" color="info" />;
  if (delivery.returned_at) return <Chip size="small" label="Restituito" color="default" />;
  return <Chip size="small" label="Aperto" color="success" />;
}

function DeviceAssignmentDialog({ open, value, employees, devices, saving, onClose, onSave }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Assegnazione dispositivo</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Autocomplete
            options={employees}
            getOptionLabel={(option) => option.full_name ?? ""}
            isOptionEqualToValue={(option, selected) => option.id === selected.id}
            value={value.employee}
            onChange={(_event, next) => onSave({ ...value, employee: next }, false)}
            renderInput={(params) => <TextField {...params} label="Dipendente TMS" />}
          />
          <Autocomplete
            options={devices}
            getOptionLabel={(option) =>
              [option.brand, option.model, option.serial_number ? `S/N ${option.serial_number}` : null, option.system_name]
                .filter(Boolean)
                .join(" - ")
            }
            isOptionEqualToValue={(option, selected) => option.id === selected.id}
            value={value.device}
            onChange={(_event, next) => onSave({ ...value, device: next }, false)}
            renderInput={(params) => <TextField {...params} label="Dispositivo" />}
          />
          <TextField
            label="Note"
            value={value.notes}
            onChange={(event) => onSave({ ...value, notes: event.target.value }, false)}
            fullWidth
            multiline
            minRows={3}
          />
          <Alert severity="info">
            Questa operazione crea l&apos;assegnazione. La firma del dipendente verra raccolta successivamente dall&apos;app tablet
            oppure via web, inviando la richiesta di firma per email dalla lista assegnazioni.
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button
          variant="contained"
          disabled={saving || !value.employee || !value.device}
          onClick={() => onSave(value, true)}
        >
          Crea assegnazione
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function PolicyEditorDialog({ open, policy, saving, onClose, onSave }) {
  const [title, setTitle] = useState("");
  const contentRef = useRef(null);
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      fullScreen={fullScreen}
      TransitionProps={{ onEnter: () => setTitle(policy?.title || "Information Security Tonoli") }}
    >
      <DialogTitle>{policy ? "Modifica policy" : "Pubblica policy"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Titolo"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            fullWidth
          />
          <Box
            ref={(node) => {
              contentRef.current = node;
              if (node && node.dataset.initialized !== "1") {
                node.innerHTML = policy?.content_html || "";
                node.dataset.initialized = "1";
              }
            }}
            contentEditable
            suppressContentEditableWarning
            sx={{
              // Area di modifica adattiva: sfrutta l'altezza disponibile del dispositivo.
              minHeight: { xs: "40vh", sm: 320 },
              maxHeight: { xs: "none", sm: "55vh", md: "60vh" },
              overflowY: "auto",
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 2,
              p: { xs: 1.5, sm: 2 },
              fontSize: { xs: 14, md: 15 },
              lineHeight: 1.6,
              outline: "none",
              "&:focus": { borderColor: "primary.main" },
              "& p": { my: 0.5 },
            }}
          />
          <Typography variant="caption" color="text.secondary">
            Incolla qui il testo formattato della policy (es. da Word o PDF): la formattazione viene mantenuta.
            Il testo verrà mostrato al dipendente prima della firma, sia via web sia dall&apos;app tablet.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button
          variant="contained"
          disabled={saving || !title.trim()}
          onClick={() => {
            const contentHtml = contentRef.current?.innerHTML?.trim() || "";
            if (!contentHtml || contentHtml === "<br>") return;
            onSave({ title: title.trim(), content_html: contentHtml });
          }}
        >
          Salva policy
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function MaterialDialog({ open, value, sizeGroups, saving, onClose, onSave }) {
  const availableOptions = useMemo(
    () => sizeGroups.flatMap((group) => group.options.map((option) => ({ ...option, groupName: group.name }))),
    [sizeGroups]
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{value.id ? "Modifica articolo" : "Nuovo articolo"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Nome articolo"
            value={value.name}
            onChange={(event) => onSave({ ...value, name: event.target.value }, false)}
            fullWidth
          />
          <FormControl fullWidth>
            <InputLabel id="material-category-label">Categoria</InputLabel>
            <Select
              labelId="material-category-label"
              label="Categoria"
              value={value.category}
              onChange={(event) => onSave({ ...value, category: event.target.value }, false)}
            >
              {CATEGORY_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl fullWidth>
            <InputLabel id="material-size-label">Taglie disponibili</InputLabel>
            <Select
              labelId="material-size-label"
              multiple
              label="Taglie disponibili"
              value={value.available_size_ids}
              onChange={(event) => onSave({
                ...value,
                available_size_ids: Array.isArray(event.target.value) ? event.target.value : String(event.target.value).split(","),
              }, false)}
              renderValue={(selected) => {
                const selectedIds = Array.isArray(selected) ? selected : String(selected).split(",");
                const selectedLabels = availableOptions
                  .filter((option) => selectedIds.includes(option.id))
                  .map((option) => option.value);
                return selectedLabels.join(", ");
              }}
            >
              {sizeGroups.map((group) => [
                <MenuItem key={`group-${group.id}`} disabled sx={{ opacity: 1, fontWeight: 700 }}>
                  {group.name}
                </MenuItem>,
                ...group.options.map((option) => (
                  <MenuItem key={option.id} value={option.id} sx={{ pl: 3 }}>
                    <Checkbox checked={value.available_size_ids.includes(option.id)} />
                    <ListItemText primary={option.value} />
                  </MenuItem>
                )),
              ])}
            </Select>
          </FormControl>
          <TextField
            label="Note"
            value={value.notes}
            onChange={(event) => onSave({ ...value, notes: event.target.value }, false)}
            fullWidth
            multiline
            minRows={3}
          />
          {value.id && (
            <FormControlLabel
              control={
                <Checkbox
                  checked={Boolean(value.is_active)}
                  onChange={(event) => onSave({ ...value, is_active: event.target.checked }, false)}
                />
              }
              label="Articolo attivo"
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button
          variant="contained"
          disabled={saving || !value.name.trim()}
          onClick={() => onSave(value, true)}
        >
          Salva
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DeviceDialog({ open, value, saving, onClose, onSave }) {
  const isSmartphoneLike = value.asset_type === "smartphone";

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{value.id ? "Modifica dispositivo" : "Nuovo dispositivo"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <FormControl fullWidth>
            <InputLabel id="device-type-label">Tipo dispositivo</InputLabel>
            <Select
              labelId="device-type-label"
              label="Tipo dispositivo"
              value={value.asset_type}
              onChange={(event) => onSave({ ...value, asset_type: event.target.value }, false)}
            >
              {ASSET_TYPE_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Marca"
              value={value.brand}
              onChange={(event) => onSave({ ...value, brand: event.target.value }, false)}
              fullWidth
            />
            <TextField
              label="Modello"
              value={value.model}
              onChange={(event) => onSave({ ...value, model: event.target.value }, false)}
              fullWidth
            />
          </Stack>
          <TextField
            label="Numero seriale"
            value={value.serial_number}
            onChange={(event) => onSave({ ...value, serial_number: event.target.value }, false)}
            fullWidth
            required
          />
          {isSmartphoneLike && (
            <>
              <TextField
                label="IMEI"
                value={value.imei}
                onChange={(event) => onSave({ ...value, imei: event.target.value }, false)}
                fullWidth
              />
              <TextField
                label="ICCID"
                value={value.iccid}
                onChange={(event) => onSave({ ...value, iccid: event.target.value }, false)}
                fullWidth
              />
              <TextField
                label="Numero di telefono"
                value={value.phone_number}
                onChange={(event) => onSave({ ...value, phone_number: event.target.value }, false)}
                fullWidth
              />
            </>
          )}
          <TextField
            label="Note"
            value={value.notes}
            onChange={(event) => onSave({ ...value, notes: event.target.value }, false)}
            fullWidth
            multiline
            minRows={3}
          />
          {value.id && (
            <FormControlLabel
              control={
                <Checkbox
                  checked={Boolean(value.is_active)}
                  onChange={(event) => onSave({ ...value, is_active: event.target.checked }, false)}
                />
              }
              label="Dispositivo attivo"
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button
          variant="contained"
          disabled={saving}
          onClick={() => onSave(value, true)}
        >
          Salva
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DeviceDetailRow({ label, value }) {
  return (
    <Stack direction="row" spacing={2} justifyContent="space-between">
      <Typography color="text.secondary">{label}</Typography>
      <Typography fontWeight={600} textAlign="right">{value || "—"}</Typography>
    </Stack>
  );
}

function DeviceDetailsDialog({ details, onClose }) {
  const device = details?.device;
  const delivery = details?.delivery;
  const isSmartphoneLike = (device?.asset_type ?? delivery?.device_asset_type) === "smartphone";

  return (
    <Dialog open={Boolean(details)} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Dettagli dispositivo</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          <DeviceDetailRow
            label="Tipo"
            value={ASSET_TYPE_OPTIONS.find((option) => option.value === (device?.asset_type ?? delivery?.device_asset_type))?.label || device?.asset_type || delivery?.device_asset_type}
          />
          {device ? (
            <>
              <DeviceDetailRow label="Marca" value={device.brand} />
              <DeviceDetailRow label="Modello" value={device.model} />
              <DeviceDetailRow label="Numero seriale" value={device.serial_number} />
              {isSmartphoneLike && (
                <>
                  <DeviceDetailRow label="IMEI" value={device.imei} />
                  <DeviceDetailRow label="ICCID" value={device.iccid} />
                  <DeviceDetailRow label="Numero di telefono" value={device.phone_number} />
                </>
              )}
              <DeviceDetailRow label="Origine" value={device.source === "ninjaone" ? "NinjaOne" : "Manuale"} />
              {device.system_name && <DeviceDetailRow label="Nome sistema" value={device.system_name} />}
              <DeviceDetailRow label="Stato" value={device.is_active ? "Attivo" : "Disattivato"} />
              {device.notes && (
                <Stack spacing={0.5}>
                  <Typography color="text.secondary">Note</Typography>
                  <Typography whiteSpace="pre-wrap">{device.notes}</Typography>
                </Stack>
              )}
            </>
          ) : (
            <>
              <DeviceDetailRow label="Dispositivo" value={delivery?.device_label} />
              <DeviceDetailRow label="Numero seriale" value={delivery?.device_serial_number} />
              <Alert severity="info">
                Dettagli completi non disponibili: il dispositivo potrebbe essere stato disattivato. Abilita i dispositivi disattivati nel tab Dispositivi per vederli.
              </Alert>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Chiudi</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function ConsegnePage() {
  const queryClient = useQueryClient();
  const [area, setArea] = useState("dpi");
  const [dpiTab, setDpiTab] = useState(0);
  const [itTab, setItTab] = useState(0);
  const [statusFilter, setStatusFilter] = useState("open");
  const [deliverySearch, setDeliverySearch] = useState("");
  const [deliveryEmployeeId, setDeliveryEmployeeId] = useState("");
  const [showInactiveItems, setShowInactiveItems] = useState(false);
  const [itemDialog, setItemDialog] = useState(null);
  const [snackbar, setSnackbar] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [signaturePreview, setSignaturePreview] = useState(null);
  const [deliveryDeleteDialog, setDeliveryDeleteDialog] = useState(null);
  const [deviceStatusFilter, setDeviceStatusFilter] = useState("open");
  const [deviceSearch, setDeviceSearch] = useState("");
  const [deviceEmployeeId, setDeviceEmployeeId] = useState("");
  const [showInactiveDevices, setShowInactiveDevices] = useState(false);
  const [deviceDialog, setDeviceDialog] = useState(null);
  const [deviceDetails, setDeviceDetails] = useState(null);
  const [deviceAssignmentDialog, setDeviceAssignmentDialog] = useState(null);
  const [deviceDeleteDialog, setDeviceDeleteDialog] = useState(null);
  const [policyDialog, setPolicyDialog] = useState(false);

  const deliveriesQuery = useQuery({
    queryKey: ["deliveries", statusFilter, deliverySearch, deliveryEmployeeId],
    queryFn: () => getDeliveries({ status: statusFilter, search: deliverySearch, employeeId: deliveryEmployeeId, size: 200 }),
  });

  const employeeOptionsQuery = useQuery({
    queryKey: ["employee-options", "consegne"],
    queryFn: () => getEmployeeOptions(),
  });

  const materialsQuery = useQuery({
    queryKey: ["equipment-items", showInactiveItems],
    queryFn: () => getEquipmentItems({ includeInactive: showInactiveItems }),
  });

  const sizeGroupsQuery = useQuery({
    queryKey: ["delivery-size-groups"],
    queryFn: getDeliverySizeGroups,
  });

  const deviceDeliveriesQuery = useQuery({
    queryKey: ["device-deliveries", deviceStatusFilter, deviceSearch, deviceEmployeeId],
    queryFn: () => getDeviceDeliveries({ status: deviceStatusFilter, search: deviceSearch, employeeId: deviceEmployeeId, size: 200 }),
  });

  const devicesQuery = useQuery({
    queryKey: ["device-assets", showInactiveDevices],
    queryFn: () => getDeviceAssets({ includeInactive: showInactiveDevices }),
  });

  const policyQuery = useQuery({
    queryKey: ["device-delivery-policy"],
    queryFn: getDeviceDeliveryPolicy,
    enabled: area === "it",
  });

  // Conteggi per le stat dell'header: query leggere (size=1, serve solo total).
  const dpiOpenCountQuery = useQuery({
    queryKey: ["deliveries", "count", "open"],
    queryFn: () => getDeliveries({ status: "open", size: 1 }),
  });
  const dpiReturnedCountQuery = useQuery({
    queryKey: ["deliveries", "count", "returned"],
    queryFn: () => getDeliveries({ status: "returned", size: 1 }),
  });
  const itOpenCountQuery = useQuery({
    queryKey: ["device-deliveries", "count", "open"],
    queryFn: () => getDeviceDeliveries({ status: "open", size: 1 }),
  });
  const itPendingCountQuery = useQuery({
    queryKey: ["device-deliveries", "count", "pending_signature"],
    queryFn: () => getDeviceDeliveries({ status: "pending_signature", size: 1 }),
  });

  const returnMutation = useMutation({
    mutationFn: (deliveryId) => markDeliveryReturned(deliveryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deliveries"] });
      setSnackbar("Consegna segnata come restituita");
    },
    onError: (error) => setErrorMessage(error.message),
  });

  const deleteDeliveryMutation = useMutation({
    mutationFn: (deliveryId) => deleteDelivery(deliveryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deliveries"] });
      setDeliveryDeleteDialog(null);
      setSnackbar("Consegna eliminata");
    },
    onError: (error) => setErrorMessage(error.message),
  });

  const createItemMutation = useMutation({
    mutationFn: createEquipmentItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["equipment-items"] });
      setItemDialog(null);
      setSnackbar("Articolo creato");
    },
    onError: (error) => setErrorMessage(error.message),
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ itemId, payload }) => updateEquipmentItem(itemId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["equipment-items"] });
      setItemDialog(null);
      setSnackbar("Articolo aggiornato");
    },
    onError: (error) => setErrorMessage(error.message),
  });

  const createDeviceMutation = useMutation({
    mutationFn: createDeviceAsset,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["device-assets"] });
      setDeviceDialog(null);
      setSnackbar("Dispositivo creato");
    },
    onError: (error) => setErrorMessage(error.message),
  });

  const updateDeviceMutation = useMutation({
    mutationFn: ({ deviceId, payload }) => updateDeviceAsset(deviceId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["device-assets"] });
      setDeviceDialog(null);
      setSnackbar("Dispositivo aggiornato");
    },
    onError: (error) => setErrorMessage(error.message),
  });

  const syncDevicesMutation = useMutation({
    mutationFn: syncDeviceAssets,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["device-assets"] });
      setSnackbar(`Sincronizzazione completata: ${result.fetched} dispositivi (${result.created} nuovi, ${result.updated} aggiornati)`);
    },
    onError: (error) => setErrorMessage(error.message),
  });

  const createDeviceAssignmentMutation = useMutation({
    mutationFn: createDeviceDeliveryAssignment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["device-deliveries"] });
      setDeviceAssignmentDialog(null);
      setSnackbar("Assegnazione dispositivo creata");
    },
    onError: (error) => setErrorMessage(error.message),
  });

  const redeliverDeviceMutation = useMutation({
    mutationFn: (deliveryId) => redeliverDeviceDelivery(deliveryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["device-deliveries"] });
      setSnackbar("Riconsegna avviata: in attesa della firma dall'app tablet");
    },
    onError: (error) => setErrorMessage(error.message),
  });

  const savePolicyMutation = useMutation({
    mutationFn: updateDeviceDeliveryPolicy,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["device-delivery-policy"] });
      setPolicyDialog(false);
      setSnackbar("Policy salvata");
    },
    onError: (error) => setErrorMessage(error.message),
  });

  const requestSignatureMutation = useMutation({
    mutationFn: (deliveryId) => requestDeviceDeliverySignature(deliveryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["device-deliveries"] });
      setSnackbar("Email di richiesta firma inviata al dipendente");
    },
    onError: (error) => setErrorMessage(error.message),
  });

  const deleteDeviceAssignmentMutation = useMutation({
    mutationFn: (deliveryId) => deleteDeviceDeliveryAssignment(deliveryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["device-deliveries"] });
      setDeviceDeleteDialog(null);
      setSnackbar("Assegnazione eliminata");
    },
    onError: (error) => setErrorMessage(error.message),
  });

  const deliveryItems = deliveriesQuery.data?.items ?? [];
  const materials = materialsQuery.data ?? [];
  const sizeGroups = sizeGroupsQuery.data ?? [];
  const employeeOptions = employeeOptionsQuery.data ?? [];
  const selectedDeliveryEmployee = employeeOptions.find((employee) => employee.id === deliveryEmployeeId) ?? null;
  const deviceDeliveryItems = deviceDeliveriesQuery.data?.items ?? [];
  const devices = devicesQuery.data ?? [];
  const selectedDeviceEmployee = employeeOptions.find((employee) => employee.id === deviceEmployeeId) ?? null;
  const showImportHint = !deliveriesQuery.isLoading && !materialsQuery.isLoading && deliveryItems.length === 0 && materials.length === 0;
  const assignableDevices = devices.filter((device) => device.is_active);

  function handleItemDialogSave(nextValue, shouldSubmit = false) {
    if (!shouldSubmit) {
      setItemDialog(nextValue);
      return;
    }
    const payload = {
      name: nextValue.name.trim(),
      category: nextValue.category,
      notes: nextValue.notes.trim() || null,
      available_size_ids: nextValue.available_size_ids,
      ...(nextValue.id ? { is_active: Boolean(nextValue.is_active) } : {}),
    };
    if (nextValue.id) {
      updateItemMutation.mutate({ itemId: nextValue.id, payload });
      return;
    }
    createItemMutation.mutate(payload);
  }

  async function handleExportExcel() {
    try {
      await downloadDeliveriesExport({ status: statusFilter, search: deliverySearch, employeeId: deliveryEmployeeId });
    } catch (error) {
      setErrorMessage(error.message);
    }
  }

  async function handleExportEmployeeSheet(employeeId) {
    try {
      await downloadEmployeeDeliverySheet(employeeId, { includeReturned: false });
    } catch (error) {
      setErrorMessage(error.message);
    }
  }

  function handleDeviceDialogSave(nextValue, shouldSubmit = false) {
    if (!shouldSubmit) {
      setDeviceDialog(nextValue);
      return;
    }
    const payload = {
      asset_type: nextValue.asset_type,
      brand: nextValue.brand.trim() || null,
      model: nextValue.model.trim() || null,
      serial_number: nextValue.serial_number.trim() || null,
      imei: nextValue.imei.trim() || null,
      iccid: nextValue.iccid.trim() || null,
      phone_number: nextValue.phone_number.trim() || null,
      notes: nextValue.notes.trim() || null,
      ...(nextValue.id ? { is_active: Boolean(nextValue.is_active) } : {}),
    };
    if (nextValue.id) {
      updateDeviceMutation.mutate({ deviceId: nextValue.id, payload });
      return;
    }
    createDeviceMutation.mutate(payload);
  }

  async function handleExportDeviceExcel() {
    try {
      await downloadDeviceDeliveriesExport({ status: deviceStatusFilter, search: deviceSearch, employeeId: deviceEmployeeId });
    } catch (error) {
      setErrorMessage(error.message);
    }
  }

  function handleDeviceAssignmentSave(nextValue, shouldSubmit = false) {
    if (!shouldSubmit) {
      setDeviceAssignmentDialog(nextValue);
      return;
    }
    createDeviceAssignmentMutation.mutate({
      employee_id: nextValue.employee.id,
      device_id: nextValue.device.id,
      notes: nextValue.notes.trim() || null,
    });
  }

  function handleDeleteDeviceAssignment() {
    if (!deviceDeleteDialog) {
      return;
    }
    deleteDeviceAssignmentMutation.mutate(deviceDeleteDialog.id);
  }

  function handleDeleteDelivery() {
    if (!deliveryDeleteDialog) {
      return;
    }
    deleteDeliveryMutation.mutate(deliveryDeleteDialog.id);
  }

  const activeArea = AREAS.find((entry) => entry.key === area) ?? AREAS[0];
  const activeMaterialsCount = materialsQuery.isLoading ? undefined : materials.filter((item) => item.is_active).length;
  const activeDevicesCount = devicesQuery.isLoading ? undefined : devices.filter((device) => device.is_active).length;

  return (
    <>
      <Stack spacing={3}>
        <PageHeader section="Dotazioni" title={activeArea.title} />

        {/* Area e contatori: seconda barra, non nella banda del titolo (regole 2-3) */}
        <FilterBar dense>
          <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
            {AREAS.map((entry) => (
              <Button
                key={entry.key}
                size="small"
                variant={entry.key === area ? "contained" : "outlined"}
                onClick={() => setArea(entry.key)}
                startIcon={<AreaIcon name={entry.icon} size={16} />}
                sx={{ whiteSpace: "nowrap", fontWeight: 700 }}
              >
                {entry.label}
              </Button>
            ))}
          </Stack>
          <Box sx={{ flexGrow: 1 }} />
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ flexShrink: 0 }}>
            {area === "dpi" ? (
              <>
                <StatTile value={dpiOpenCountQuery.data?.total} label="Consegne aperte" />
                <StatTile value={dpiReturnedCountQuery.data?.total} label="Restituite" />
                <StatTile value={activeMaterialsCount} label="Articoli a catalogo" />
              </>
            ) : (
              <>
                <StatTile value={itOpenCountQuery.data?.total} label="Assegnazioni aperte" />
                <StatTile value={itPendingCountQuery.data?.total} label="In attesa firma" />
                <StatTile value={activeDevicesCount} label="Dispositivi attivi" />
              </>
            )}
          </Stack>
        </FilterBar>

        <Paper sx={{ borderRadius: 4, overflow: "hidden" }}>
          {area === "dpi" ? (
            <Tabs
              value={dpiTab}
              onChange={(_event, next) => setDpiTab(next)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{
                "& .MuiTab-root.Mui-selected": { color: activeArea.accent },
                "& .MuiTabs-indicator": { bgcolor: activeArea.accent },
              }}
            >
              <Tab label="Storico consegne" />
              <Tab label="Materiale" />
            </Tabs>
          ) : (
            <Tabs
              value={itTab}
              onChange={(_event, next) => setItTab(next)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{
                "& .MuiTab-root.Mui-selected": { color: activeArea.accent },
                "& .MuiTabs-indicator": { bgcolor: activeArea.accent },
              }}
            >
              <Tab label="Assegnazioni" />
              <Tab label="Dispositivi" />
              <Tab label="Policy" />
            </Tabs>
          )}
        </Paper>

        {area === "dpi" && dpiTab === 0 && (
          <Stack spacing={2}>
            <Alert severity="info">
              La creazione della consegna resta lato API/client esterno. Qui puoi consultare lo storico, segnare i rientri ed esportare i documenti.
            </Alert>
            {showImportHint && (
              <Alert severity="warning">
                Al momento non risultano consegne o articoli caricati. Se hai eseguito l&apos;import dal dump, verifica di aver usato il flag <code>--apply</code>: senza quel flag viene fatto solo un dry-run e nessun dato viene salvato.
              </Alert>
            )}
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <FormControl sx={{ minWidth: 180 }}>
                <InputLabel id="delivery-status-label">Stato</InputLabel>
                <Select
                  labelId="delivery-status-label"
                  label="Stato"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <MenuItem value="open">Aperte</MenuItem>
                  <MenuItem value="redelivered">Riconsegnate</MenuItem>
                  <MenuItem value="returned">Restituite</MenuItem>
                  <MenuItem value="all">Tutte</MenuItem>
                </Select>
              </FormControl>
              <Autocomplete
                sx={{ minWidth: 240 }}
                options={employeeOptions}
                getOptionLabel={(option) => option.full_name ?? ""}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                value={selectedDeliveryEmployee}
                onChange={(_event, value) => setDeliveryEmployeeId(value?.id ?? "")}
                loading={employeeOptionsQuery.isLoading}
                renderInput={(params) => <TextField {...params} label="Dipendente" />}
                fullWidth
              />
              <TextField
                label="Cerca per articolo"
                value={deliverySearch}
                onChange={(event) => setDeliverySearch(event.target.value)}
                fullWidth
              />
              <Button variant="outlined" onClick={() => deliveriesQuery.refetch()}>Aggiorna</Button>
              <Button variant="contained" onClick={handleExportExcel}>Export Excel</Button>
            </Stack>

            {deliveriesQuery.error && <Alert severity="error">{deliveriesQuery.error.message}</Alert>}

            <Paper sx={{ borderRadius: 3, overflowX: "auto" }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Dipendente</TableCell>
                    <TableCell>Articolo</TableCell>
                    <TableCell>Taglia</TableCell>
                    <TableCell>Qtà</TableCell>
                    <TableCell>Consegnata il</TableCell>
                    <TableCell>Stato</TableCell>
                    <TableCell align="right">Azioni</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {deliveryItems.map((delivery) => (
                    <TableRow key={delivery.id} hover>
                      <TableCell>
                        <Stack spacing={0.25}>
                          <Typography fontWeight={600}>{delivery.employee_name}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {delivery.employee_role || "Ruolo non valorizzato"}
                          </Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography>{delivery.item_name}</Typography>
                          {categoryChip(delivery.item_category)}
                        </Stack>
                      </TableCell>
                      <TableCell>{delivery.item_size || "—"}</TableCell>
                      <TableCell>{delivery.quantity}</TableCell>
                      <TableCell>{formatDateTime(delivery.delivered_at)}</TableCell>
                      <TableCell>{statusChip(delivery)}</TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
                          <Button size="small" onClick={() => setSignaturePreview(delivery.signature_b64)}>Firma</Button>
                          <Button size="small" onClick={() => handleExportEmployeeSheet(delivery.employee_id)}>Scheda DPI</Button>
                          {!delivery.returned_at && (
                            <Button
                              size="small"
                              variant="contained"
                              color="success"
                              onClick={() => returnMutation.mutate(delivery.id)}
                              disabled={returnMutation.isPending}
                            >
                              Segna restituito
                            </Button>
                          )}
                          <Button
                            size="small"
                            color="error"
                            onClick={() => setDeliveryDeleteDialog(delivery)}
                            disabled={deleteDeliveryMutation.isPending}
                          >
                            Elimina
                          </Button>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!deliveriesQuery.isLoading && deliveryItems.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7}>
                        <Typography color="text.secondary">
                          Nessuna consegna trovata con i filtri correnti. Se hai appena importato il dump, controlla di aver lanciato il comando con <code>--apply</code>.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Paper>
          </Stack>
        )}

        {area === "dpi" && dpiTab === 1 && (
          <Stack spacing={2}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2} justifyContent="space-between">
              <FormControlLabel
                control={
                  <Checkbox
                    checked={showInactiveItems}
                    onChange={(event) => setShowInactiveItems(event.target.checked)}
                  />
                }
                label="Mostra articoli inattivi"
              />
              <Button variant="contained" onClick={() => setItemDialog({ ...EMPTY_ITEM_FORM })}>
                Nuovo articolo
              </Button>
            </Stack>

            {(materialsQuery.error || sizeGroupsQuery.error) && (
              <Alert severity="error">{materialsQuery.error?.message || sizeGroupsQuery.error?.message}</Alert>
            )}

            <Paper sx={{ borderRadius: 3, overflowX: "auto" }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Articolo</TableCell>
                    <TableCell>Categoria</TableCell>
                    <TableCell>Taglie</TableCell>
                    <TableCell>Stato</TableCell>
                    <TableCell align="right">Azioni</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {materials.map((item) => (
                    <TableRow key={item.id} hover>
                      <TableCell>
                        <Stack spacing={0.25}>
                          <Typography fontWeight={600}>{item.name}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {item.notes || "Nessuna nota"}
                          </Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>{categoryChip(item.category)}</TableCell>
                      <TableCell>{item.available_sizes.length ? item.available_sizes.join(", ") : "—"}</TableCell>
                      <TableCell>
                        <Chip size="small" color={item.is_active ? "success" : "default"} label={item.is_active ? "Attivo" : "Inattivo"} />
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          onClick={() => setItemDialog({
                            id: item.id,
                            name: item.name,
                            category: item.category,
                            notes: item.notes || "",
                            available_size_ids: item.available_size_ids || [],
                            is_active: item.is_active,
                          })}
                        >
                          Modifica
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!materialsQuery.isLoading && materials.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <Typography color="text.secondary">
                          Nessun articolo disponibile. Un import senza <code>--apply</code> non popola il catalogo materiali.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Paper>
          </Stack>
        )}

        {area === "it" && itTab === 0 && (
          <Stack spacing={2}>
            <Alert severity="info">
              Qui puoi creare nuove assegnazioni, consultare lo storico delle consegne dispositivi, avviare le riconsegne ed esportare i documenti. La firma di consegna viene raccolta dall&apos;app tablet oppure via web: con &quot;Richiedi firma via email&quot; il dipendente riceve un link, accede con le sue credenziali e firma dal portale (l&apos;ultima firma sostituisce la precedente). Le firme di riconsegna restano sull&apos;app tablet.
            </Alert>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <FormControl sx={{ minWidth: 180 }}>
                <InputLabel id="device-delivery-status-label">Stato</InputLabel>
                <Select
                  labelId="device-delivery-status-label"
                  label="Stato"
                  value={deviceStatusFilter}
                  onChange={(event) => setDeviceStatusFilter(event.target.value)}
                >
                  <MenuItem value="open">Aperte</MenuItem>
                  <MenuItem value="pending_signature">In attesa firma</MenuItem>
                  <MenuItem value="pending_return_signature">In attesa firma riconsegna</MenuItem>
                  <MenuItem value="redelivered">Riconsegnate</MenuItem>
                  <MenuItem value="returned">Restituite</MenuItem>
                  <MenuItem value="all">Tutte</MenuItem>
                </Select>
              </FormControl>
              <Autocomplete
                sx={{ minWidth: 240 }}
                options={employeeOptions}
                getOptionLabel={(option) => option.full_name ?? ""}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                value={selectedDeviceEmployee}
                onChange={(_event, value) => setDeviceEmployeeId(value?.id ?? "")}
                loading={employeeOptionsQuery.isLoading}
                renderInput={(params) => <TextField {...params} label="Dipendente" />}
                fullWidth
              />
              <TextField
                label="Cerca per dispositivo"
                value={deviceSearch}
                onChange={(event) => setDeviceSearch(event.target.value)}
                fullWidth
              />
              <Button variant="outlined" onClick={() => deviceDeliveriesQuery.refetch()}>Aggiorna</Button>
              <Button variant="outlined" onClick={handleExportDeviceExcel}>Export Excel</Button>
              <Button
                variant="contained"
                sx={{ whiteSpace: "nowrap", flexShrink: 0 }}
                onClick={() => setDeviceAssignmentDialog({ ...EMPTY_DEVICE_ASSIGNMENT_FORM })}
              >
                Nuova assegnazione
              </Button>
            </Stack>

            {deviceDeliveriesQuery.error && <Alert severity="error">{deviceDeliveriesQuery.error.message}</Alert>}

            <Paper sx={{ borderRadius: 3, overflowX: "auto" }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Dipendente</TableCell>
                    <TableCell>Dispositivo</TableCell>
                    <TableCell>Tipo</TableCell>
                    <TableCell>Seriale</TableCell>
                    <TableCell>Consegnato il</TableCell>
                    <TableCell>Stato</TableCell>
                    <TableCell align="right">Azioni</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {deviceDeliveryItems.map((delivery) => (
                    <TableRow key={delivery.id} hover>
                      <TableCell>
                        <Stack spacing={0.25}>
                          <Typography fontWeight={600}>{delivery.employee_name}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {delivery.employee_role || "Ruolo non valorizzato"}
                          </Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Link
                          component="button"
                          type="button"
                          underline="hover"
                          textAlign="left"
                          onClick={() => setDeviceDetails({
                            device: devices.find((device) => device.id === delivery.device_id) ?? null,
                            delivery,
                          })}
                        >
                          {delivery.device_label}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Chip size="small" variant="outlined" label={ASSET_TYPE_OPTIONS.find((option) => option.value === delivery.device_asset_type)?.label || delivery.device_asset_type} />
                      </TableCell>
                      <TableCell>{delivery.device_serial_number}</TableCell>
                      <TableCell>{formatDateTime(delivery.delivered_at)}</TableCell>
                      <TableCell>
                        <Stack spacing={0.5} alignItems="flex-start">
                          {statusChip(delivery)}
                          {delivery.signature_b64 && delivery.signature_source && (
                            <Typography variant="caption" color="text.secondary">
                              Firma {delivery.signature_source === "web" ? "via web" : "da tablet"}
                              {delivery.signed_at ? ` · ${formatDateTime(delivery.signed_at)}` : ""}
                            </Typography>
                          )}
                          {delivery.status === "pending_signature" && delivery.signature_requested_at && (
                            <Typography variant="caption" color="text.secondary">
                              Invito email del {formatDateTime(delivery.signature_requested_at)}
                            </Typography>
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
                          {delivery.signature_b64 && <Button size="small" onClick={() => setSignaturePreview(delivery.signature_b64)}>Firma</Button>}
                          {(delivery.status === "pending_signature" || delivery.status === "open") && (
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => requestSignatureMutation.mutate(delivery.id)}
                              disabled={requestSignatureMutation.isPending}
                            >
                              {delivery.status === "open" ? "Aggiorna firma via email" : "Richiedi firma via email"}
                            </Button>
                          )}
                          {delivery.return_signature_b64 && (
                            <Button size="small" onClick={() => setSignaturePreview(delivery.return_signature_b64)}>Firma riconsegna</Button>
                          )}
                          {delivery.status === "open" && (
                            <Button
                              size="small"
                              variant="contained"
                              color="success"
                              onClick={() => redeliverDeviceMutation.mutate(delivery.id)}
                              disabled={redeliverDeviceMutation.isPending}
                            >
                              Riconsegna
                            </Button>
                          )}
                          <Button
                            size="small"
                            color="error"
                            onClick={() => setDeviceDeleteDialog(delivery)}
                            disabled={deleteDeviceAssignmentMutation.isPending}
                          >
                            Elimina
                          </Button>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!deviceDeliveriesQuery.isLoading && deviceDeliveryItems.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7}>
                        <Typography color="text.secondary">
                          Nessuna consegna di dispositivi trovata con i filtri correnti.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Paper>
          </Stack>
        )}

        {area === "it" && itTab === 1 && (
          <Stack spacing={2}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2} justifyContent="space-between">
              <FormControlLabel
                control={
                  <Checkbox
                    checked={showInactiveDevices}
                    onChange={(event) => setShowInactiveDevices(event.target.checked)}
                  />
                }
                label="Mostra dispositivi inattivi"
              />
              <Stack direction="row" spacing={1}>
                <Button
                  variant="outlined"
                  onClick={() => syncDevicesMutation.mutate()}
                  disabled={syncDevicesMutation.isPending}
                >
                  Sincronizza da NinjaOne
                </Button>
                <Button variant="contained" onClick={() => setDeviceDialog({ ...EMPTY_DEVICE_FORM })}>
                  Nuovo dispositivo
                </Button>
              </Stack>
            </Stack>

            {devicesQuery.error && <Alert severity="error">{devicesQuery.error.message}</Alert>}

            <Paper sx={{ borderRadius: 3, overflowX: "auto" }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Dispositivo</TableCell>
                    <TableCell>Tipo</TableCell>
                    <TableCell>Origine</TableCell>
                    <TableCell>Seriale</TableCell>
                    <TableCell>IMEI / ICCID / Telefono</TableCell>
                    <TableCell>Stato</TableCell>
                    <TableCell align="right">Azioni</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {devices.map((device) => (
                    <TableRow key={device.id} hover>
                      <TableCell>
                        <Stack spacing={0.25}>
                          <Typography fontWeight={600}>
                            {[device.brand, device.model].filter(Boolean).join(" ") || device.system_name || "—"}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {device.system_name || device.notes || "Nessuna nota"}
                          </Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        {ASSET_TYPE_OPTIONS.find((option) => option.value === device.asset_type)?.label || device.asset_type}
                      </TableCell>
                      <TableCell>
                        <Chip size="small" variant="outlined" label={device.source === "ninjaone" ? "NinjaOne" : "Manuale"} />
                      </TableCell>
                      <TableCell>{device.serial_number || "—"}</TableCell>
                      <TableCell>{[device.imei, device.iccid, device.phone_number].filter(Boolean).join(" / ") || "—"}</TableCell>
                      <TableCell>
                        <Chip size="small" color={device.is_active ? "success" : "default"} label={device.is_active ? "Attivo" : "Inattivo"} />
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          onClick={() => setDeviceDialog({
                            id: device.id,
                            asset_type: device.asset_type,
                            brand: device.brand || "",
                            model: device.model || "",
                            serial_number: device.serial_number || "",
                            imei: device.imei || "",
                            iccid: device.iccid || "",
                            phone_number: device.phone_number || "",
                            notes: device.notes || "",
                            is_active: device.is_active,
                          })}
                        >
                          Modifica
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!devicesQuery.isLoading && devices.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7}>
                        <Typography color="text.secondary">
                          Nessun dispositivo registrato. Usa &quot;Sincronizza da NinjaOne&quot; per importarli oppure aggiungine uno manualmente.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Paper>
          </Stack>
        )}

        {area === "it" && itTab === 2 && (
          <Stack spacing={2}>
            <Alert severity="info">
              La policy viene mostrata al dipendente prima della firma della consegna, sia dalla pagina web
              sia dall&apos;app tablet, e la lettura è obbligatoria per firmare. Incolla il testo formattato
              (es. da Word): la formattazione viene mantenuta.
            </Alert>
            <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap spacing={1}>
              <Typography variant="h6" fontWeight={700}>
                {policyQuery.data?.title || "Policy di consegna dispositivi"}
              </Typography>
              <Button variant="contained" onClick={() => setPolicyDialog(true)}>
                {policyQuery.data ? "Modifica policy" : "Pubblica policy"}
              </Button>
            </Stack>

            {policyQuery.error && <Alert severity="error">{policyQuery.error.message}</Alert>}

            {policyQuery.data ? (
              <Paper sx={{ borderRadius: 3, p: 3 }}>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
                  Ultimo aggiornamento{policyQuery.data.updated_by ? ` di ${policyQuery.data.updated_by}` : ""} il {formatDateTime(policyQuery.data.updated_at)}
                </Typography>
                <Box
                  sx={{ "& p": { my: 0.5 }, overflowWrap: "break-word", fontSize: { xs: 14, md: 15 }, lineHeight: 1.6 }}
                  dangerouslySetInnerHTML={{ __html: policyQuery.data.content_html }}
                />
              </Paper>
            ) : (
              !policyQuery.isLoading && (
                <Paper sx={{ borderRadius: 3, p: 3 }}>
                  <Typography color="text.secondary">
                    Nessuna policy pubblicata. Finché non viene pubblicata, la firma web non richiede la conferma di lettura.
                  </Typography>
                </Paper>
              )
            )}
          </Stack>
        )}
      </Stack>

      <PolicyEditorDialog
        open={policyDialog}
        policy={policyQuery.data || null}
        saving={savePolicyMutation.isPending}
        onClose={() => setPolicyDialog(false)}
        onSave={(payload) => savePolicyMutation.mutate(payload)}
      />

      <MaterialDialog
        open={Boolean(itemDialog)}
        value={itemDialog || EMPTY_ITEM_FORM}
        sizeGroups={sizeGroups}
        saving={createItemMutation.isPending || updateItemMutation.isPending}
        onClose={() => setItemDialog(null)}
        onSave={handleItemDialogSave}
      />

      <DeviceDialog
        open={Boolean(deviceDialog)}
        value={deviceDialog || EMPTY_DEVICE_FORM}
        saving={createDeviceMutation.isPending || updateDeviceMutation.isPending}
        onClose={() => setDeviceDialog(null)}
        onSave={handleDeviceDialogSave}
      />

      <DeviceDetailsDialog details={deviceDetails} onClose={() => setDeviceDetails(null)} />

      <DeviceAssignmentDialog
        open={Boolean(deviceAssignmentDialog)}
        value={deviceAssignmentDialog || EMPTY_DEVICE_ASSIGNMENT_FORM}
        employees={employeeOptions}
        devices={assignableDevices}
        saving={createDeviceAssignmentMutation.isPending || redeliverDeviceMutation.isPending || deleteDeviceAssignmentMutation.isPending}
        onClose={() => setDeviceAssignmentDialog(null)}
        onSave={handleDeviceAssignmentSave}
      />

      <Dialog
        open={Boolean(deliveryDeleteDialog)}
        onClose={() => {
          if (!deleteDeliveryMutation.isPending) {
            setDeliveryDeleteDialog(null);
          }
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Conferma eliminazione</DialogTitle>
        <DialogContent>
          <Typography>
            Vuoi eliminare la consegna di <strong>{deliveryDeleteDialog?.item_name}</strong> a{" "}
            <strong>{deliveryDeleteDialog?.employee_name}</strong>?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            La consegna e la relativa firma verranno eliminate definitivamente.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeliveryDeleteDialog(null)} disabled={deleteDeliveryMutation.isPending}>
            Annulla
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDeleteDelivery}
            disabled={deleteDeliveryMutation.isPending}
          >
            Elimina
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(deviceDeleteDialog)}
        onClose={() => {
          if (!deleteDeviceAssignmentMutation.isPending) {
            setDeviceDeleteDialog(null);
          }
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Conferma eliminazione</DialogTitle>
        <DialogContent>
          <Typography>
            Vuoi eliminare l&apos;assegnazione di <strong>{deviceDeleteDialog?.device_label}</strong> a{" "}
            <strong>{deviceDeleteDialog?.employee_name}</strong>?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            L&apos;operazione disassocerà il dispositivo in qualunque stato si trovi.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeviceDeleteDialog(null)} disabled={deleteDeviceAssignmentMutation.isPending}>
            Annulla
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDeleteDeviceAssignment}
            disabled={deleteDeviceAssignmentMutation.isPending}
          >
            Elimina
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(signaturePreview)} onClose={() => setSignaturePreview(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Firma acquisita</DialogTitle>
        <DialogContent>
          {signaturePreview ? (
            <Box
              component="img"
              src={signaturePreview}
              alt="Firma consegna"
              sx={{ width: "100%", maxHeight: 320, objectFit: "contain", bgcolor: "#fafafa", borderRadius: 2 }}
            />
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSignaturePreview(null)}>Chiudi</Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(snackbar)}
        autoHideDuration={3500}
        onClose={() => setSnackbar(null)}
        message={snackbar || ""}
      />
      <Snackbar
        open={Boolean(errorMessage)}
        autoHideDuration={5000}
        onClose={() => setErrorMessage(null)}
        message={errorMessage || ""}
      />
    </>
  );
}
