import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
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
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import { getLdapEmployees } from "../api";
import {
  createMaintenanceNotificationRule,
  deleteMaintenanceNotificationRule,
  getMaintenanceAssetClasses,
  getMaintenanceNotificationRules,
  updateMaintenanceNotificationRule,
} from "../maintenanceAssetsApi";
import PageHeader, { HeaderButton } from "../components/PageHeader";
import { bodyRowSx, headRowSx, tableSx } from "../components/tableStyles";

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

function RuleDialog({ open, onClose, rule, assetClasses }) {
  const queryClient = useQueryClient();
  const [assetClassId, setAssetClassId] = useState("");
  const [site, setSite] = useState("");
  const [recipients, setRecipients] = useState([]);
  const [isActive, setIsActive] = useState(true);

  const ldapEmployeesQuery = useQuery({ queryKey: ["ldap-employees", ""], queryFn: () => getLdapEmployees(""), enabled: open });
  const ldapEmployees = ldapEmployeesQuery.data ?? [];

  useEffect(() => {
    if (!open) return;
    setAssetClassId(rule?.asset_class_id ?? "");
    setSite(rule?.site ?? "");
    setIsActive(rule?.is_active ?? true);
  }, [open, rule]);

  useEffect(() => {
    if (!open || ldapEmployees.length === 0) return;
    const ids = rule?.recipient_ldap_employee_ids ?? [];
    setRecipients(ldapEmployees.filter((e) => ids.includes(e.id)));
  }, [open, rule, ldapEmployees.length]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["maintenance-notification-rules"] });

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        asset_class_id: assetClassId || null,
        site: site.trim() || null,
        recipient_ldap_employee_ids: recipients.map((r) => r.id),
        is_active: isActive,
      };
      return rule ? updateMaintenanceNotificationRule(rule.id, payload) : createMaintenanceNotificationRule(payload);
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ fontWeight: 700 }}>{rule ? "Modifica regola" : "Nuova regola di notifica"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            select
            label="Categoria di asset"
            value={assetClassId}
            onChange={(e) => setAssetClassId(e.target.value)}
            size="small"
            fullWidth
            helperText="Vuoto = qualunque categoria"
          >
            <MenuItem value="">Tutte le categorie</MenuItem>
            {assetClasses.map((c) => (
              <MenuItem key={c.id} value={c.id}>{c.label}</MenuItem>
            ))}
          </TextField>

          <TextField
            label="Sito"
            placeholder="es. Saluzzo"
            value={site}
            onChange={(e) => setSite(e.target.value)}
            size="small"
            fullWidth
            helperText="Vuoto = qualunque sito"
          />

          <Autocomplete
            multiple
            options={ldapEmployees}
            value={recipients}
            onChange={(_, value) => setRecipients(value)}
            getOptionLabel={(o) => o.display_name || o.username}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            loading={ldapEmployeesQuery.isLoading}
            renderInput={(params) => (
              <TextField {...params} label="Destinatari" placeholder="Cerca per nome..." helperText="Solo utenti con email valorizzata riceveranno l'avviso" />
            )}
          />

          <FormControlLabel control={<Switch checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />} label="Regola attiva" />

          {saveMutation.error && <Alert severity="error">{saveMutation.error.message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>Annulla</Button>
        <Button variant="contained" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? "Salvataggio..." : "Salva"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function MaintenanceNotificationRulesPage() {
  const queryClient = useQueryClient();
  const [dialogRule, setDialogRule] = useState(undefined);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const rulesQuery = useQuery({ queryKey: ["maintenance-notification-rules"], queryFn: getMaintenanceNotificationRules });
  const assetClassesQuery = useQuery({ queryKey: ["maintenance-asset-classes"], queryFn: getMaintenanceAssetClasses });
  const rules = rulesQuery.data ?? [];
  const assetClasses = assetClassesQuery.data ?? [];

  const deleteMutation = useMutation({
    mutationFn: () => deleteMaintenanceNotificationRule(deleteTarget.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance-notification-rules"] });
      setDeleteTarget(null);
    },
  });

  return (
    <Box sx={{ minHeight: "100%" }}>
      <Stack spacing={2}>
        <PageHeader
          section="Manutenzioni"
          title="Notifiche"
          meta="Destinatari email delle scadenze, per categoria e sito"
          actions={<HeaderButton onClick={() => setDialogRule(null)}>+ Nuova regola</HeaderButton>}
        />

        <Alert severity="info">
          Il promemoria giornaliero via email parte solo per gli asset coperti da almeno una regola attiva qui sotto.
          Senza regole, le scadenze restano comunque visibili in campanella e in dashboard.
        </Alert>

        {(rulesQuery.error || assetClassesQuery.error) && (
          <Alert severity="error">{(rulesQuery.error || assetClassesQuery.error).message}</Alert>
        )}

        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
          <TableContainer>
            <Table size="small" sx={tableSx({ minWidth: 720 })}>
              <TableHead>
                <TableRow sx={headRowSx}>
                  <TableCell sx={{ width: "22%" }}>Categoria</TableCell>
                  <TableCell sx={{ width: "16%" }}>Sito</TableCell>
                  <TableCell sx={{ width: "38%" }}>Destinatari</TableCell>
                  <TableCell sx={{ width: "12%" }} align="center">Attiva</TableCell>
                  <TableCell sx={{ width: "12%" }} align="right">Azioni</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rules.map((rule) => (
                  <TableRow key={rule.id} hover sx={bodyRowSx({})}>
                    <TableCell><Typography sx={{ fontSize: 13, fontWeight: 600 }}>{rule.asset_class_label || "Tutte le categorie"}</Typography></TableCell>
                    <TableCell><Typography sx={{ fontSize: 13 }}>{rule.site || "Tutti i siti"}</Typography></TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", rowGap: 0.5 }}>
                        {rule.recipient_labels.length === 0 && (
                          <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>Nessun destinatario</Typography>
                        )}
                        {rule.recipient_labels.map((label, index) => (
                          <Chip key={`${rule.id}-${index}`} label={label} size="small" sx={{ fontSize: 11 }} />
                        ))}
                      </Stack>
                    </TableCell>
                    <TableCell align="center">
                      <Chip label={rule.is_active ? "Sì" : "No"} size="small" color={rule.is_active ? "success" : "default"} sx={{ fontSize: 11, fontWeight: 700 }} />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Modifica">
                        <IconButton size="small" onClick={() => setDialogRule(rule)}>
                          <Typography sx={{ fontSize: 12 }}>✎</Typography>
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Elimina">
                        <IconButton size="small" color="error" onClick={() => setDeleteTarget(rule)}>
                          <TrashIcon size={16} />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
                {rules.length === 0 && !rulesQuery.isLoading && (
                  <TableRow>
                    <TableCell colSpan={5} sx={{ py: 4, textAlign: "center" }}>
                      <Typography sx={{ fontSize: 14, fontWeight: 600 }}>Nessuna regola configurata</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      </Stack>

      <RuleDialog open={dialogRule !== undefined} onClose={() => setDialogRule(undefined)} rule={dialogRule} assetClasses={assetClasses} />

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Elimina regola</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13.5 }}>Stai per eliminare questa regola di notifica. Le scadenze coperte non riceveranno più email finché non ne configuri un'altra.</Typography>
          {deleteMutation.error && <Alert severity="error" sx={{ mt: 2 }}>{deleteMutation.error.message}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Annulla</Button>
          <Button color="error" variant="contained" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
            {deleteMutation.isPending ? "Eliminazione..." : "Elimina"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
