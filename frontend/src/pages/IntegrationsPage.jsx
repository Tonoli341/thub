import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  Link,
  Paper,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";

import { getOffice365Integration, updateOffice365Integration } from "../api";

const EMPTY_FORM = {
  enabled: false,
  oof_enabled: false,
  tenant_id: "",
  client_id: "",
  oof_use_manager: false,
  oof_fallback_contact: "",
};

function StatusChip({ data }) {
  if (!data?.enabled) {
    return <Chip size="small" label="Disattivata" variant="outlined" />;
  }
  if (!data.credentials_complete) {
    return <Chip size="small" color="warning" label="Credenziali incomplete" variant="outlined" />;
  }
  if (!data.oof_enabled) {
    return <Chip size="small" color="info" label="Attiva, nessuna funzione accesa" variant="outlined" />;
  }
  return <Chip size="small" color="success" label="Operativa" variant="outlined" />;
}

function Step({ n, title, children }) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="flex-start">
      <Box
        sx={{
          flexShrink: 0,
          width: 22,
          height: 22,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          fontSize: 12,
          fontWeight: 700,
          bgcolor: "action.selected",
          color: "text.secondary",
        }}
      >
        {n}
      </Box>
      <Box>
        <Typography fontSize={13} fontWeight={600}>{title}</Typography>
        <Typography fontSize={13} color="text.secondary">{children}</Typography>
      </Box>
    </Stack>
  );
}

function Office365Card({ onNotify }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["integration-office365"], queryFn: getOffice365Integration });
  const data = query.data;

  const [form, setForm] = useState(EMPTY_FORM);
  // Il segreto non torna mai dal server: il campo resta vuoto e vale solo se
  // l'amministratore ci scrive dentro.
  const [secret, setSecret] = useState("");
  const [clearSecret, setClearSecret] = useState(false);

  useEffect(() => {
    if (!data) return;
    setForm({
      enabled: data.enabled,
      oof_enabled: data.oof_enabled,
      tenant_id: data.tenant_id ?? "",
      client_id: data.client_id ?? "",
      oof_use_manager: data.oof_use_manager,
      oof_fallback_contact: data.oof_fallback_contact ?? "",
    });
    setSecret("");
    setClearSecret(false);
  }, [data]);

  const save = useMutation({
    mutationFn: updateOffice365Integration,
    onSuccess: (result) => {
      queryClient.setQueryData(["integration-office365"], result);
      onNotify({ severity: "success", message: "Integrazione salvata" });
    },
    onError: (error) => onNotify({ severity: "error", message: error.message }),
  });

  const setField = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = () => {
    const payload = { ...form };
    if (clearSecret) payload.client_secret = "";
    else if (secret.trim()) payload.client_secret = secret.trim();
    save.mutate(payload);
  };

  // Con l'interruttore generale spento il resto della scheda è inerte: si può
  // ancora leggere e preparare la configurazione, ma nulla parte.
  const locked = !form.enabled;

  if (query.isLoading) {
    return (
      <Paper sx={{ p: 4, borderRadius: 3, display: "grid", placeItems: "center" }}>
        <CircularProgress size={26} />
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 3, borderRadius: 3 }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }} justifyContent="space-between">
        <Box>
          <Stack direction="row" spacing={1.25} alignItems="center">
            <Typography fontSize={16} fontWeight={700}>Microsoft 365 — Outlook</Typography>
            <StatusChip data={data} />
          </Stack>
          <Typography fontSize={13} color="text.secondary" sx={{ mt: 0.5 }}>
            Imposta la risposta automatica “Fuori sede” sulla casella del dipendente quando una ferie viene approvata.
          </Typography>
        </Box>
        <FormControlLabel
          sx={{ m: 0 }}
          control={
            <Switch
              checked={form.enabled}
              onChange={(event) => setField("enabled")(event.target.checked)}
            />
          }
          label={<Typography fontSize={14} fontWeight={600}>{form.enabled ? "Attiva" : "Disattivata"}</Typography>}
          labelPlacement="start"
        />
      </Stack>

      <Alert severity={form.enabled ? "info" : "success"} sx={{ mt: 2 }}>
        {form.enabled
          ? "Interruttore generale acceso: T-Hub può contattare Microsoft 365 per le funzioni abilitate qui sotto."
          : "Interruttore generale spento: T-Hub non contatta Microsoft 365 in alcun modo — nessuna scrittura sulle caselle, nessuna richiesta di token."}
      </Alert>
      <Typography fontSize={12} color="text.secondary" sx={{ mt: 1 }}>
        Non riguarda l'invio delle email: le notifiche del portale passano dal relay SMTP e restano attive comunque.
      </Typography>

      <Divider sx={{ my: 2.5 }} />

      <Typography fontSize={14} fontWeight={700} sx={{ mb: 0.5 }}>Cosa fa</Typography>
      <Typography fontSize={13} color="text.secondary" sx={{ mb: 2 }}>
        All'approvazione, modifica o cancellazione di una <strong>ferie</strong>, T-Hub ricalcola la risposta automatica
        programmata della casella Outlook del dipendente. Exchange gestisce una sola finestra di fuori sede per casella,
        quindi vince sempre la ferie approvata più imminente; se non ne resta nessuna, la risposta automatica viene
        disattivata. Il dipendente deve avere un'email nel mapping LDAP, altrimenti viene semplicemente saltato.
      </Typography>

      <Typography fontSize={14} fontWeight={700} sx={{ mb: 1.25 }}>Come configurarla</Typography>
      <Stack spacing={1.25} sx={{ mb: 2.5 }}>
        <Step n={1} title="Registra un'applicazione su Microsoft Entra ID">
          Portale Entra › Identità › Registrazioni app › Nuova registrazione. Non serve alcun URI di reindirizzamento:
          l'accesso è di tipo applicativo, senza utente.
        </Step>
        <Step n={2} title="Assegna il permesso applicativo MailboxSettings.ReadWrite">
          API autorizzate › Microsoft Graph › <em>Autorizzazioni applicazione</em> (non delegate) ›
          <code> MailboxSettings.ReadWrite</code>. Poi clicca <strong>Concedi consenso amministratore</strong>: senza
          consenso ogni chiamata torna 403.
        </Step>
        <Step n={3} title="Crea un client secret e copialo subito">
          Certificati e segreti › Nuovo segreto client. Il valore è visibile una sola volta. Annota anche la scadenza:
          quando scade, la risposta automatica smette di aggiornarsi.
        </Step>
        <Step n={4} title="Incolla qui i tre valori e salva">
          Directory (tenant) ID, Application (client) ID e il segreto. Il segreto viene cifrato prima di essere salvato
          e non è più rileggibile da nessuna schermata né da questa API.
        </Step>
        <Step n={5} title="Accendi l'interruttore generale e la funzione">
          Prima l'interruttore in alto, poi “Risposta automatica ferie”. Consigliato provare con una ferie di prova su
          una casella di servizio prima di estendere a tutti.
        </Step>
      </Stack>
      <Typography fontSize={12} color="text.secondary" sx={{ mb: 2.5 }}>
        Riferimento Microsoft:{" "}
        <Link href="https://learn.microsoft.com/graph/api/user-update-mailboxsettings" target="_blank" rel="noreferrer">
          update mailboxSettings
        </Link>
      </Typography>

      <Divider sx={{ my: 2.5 }} />

      <Typography fontSize={14} fontWeight={700} sx={{ mb: 1.5 }}>Credenziali applicazione Entra</Typography>
      {data && !data.encryption_available && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Cifratura non disponibile sul backend: il client secret non può essere salvato. Ricostruire l'immagine
          (<code>docker compose build backend</code>) e riavviare il servizio.
        </Alert>
      )}
      <Stack spacing={2} sx={{ mb: 2.5 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          <TextField
            label="Directory (tenant) ID"
            value={form.tenant_id}
            onChange={(event) => setField("tenant_id")(event.target.value)}
            size="small"
            fullWidth
          />
          <TextField
            label="Application (client) ID"
            value={form.client_id}
            onChange={(event) => setField("client_id")(event.target.value)}
            size="small"
            fullWidth
          />
        </Stack>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "flex-start" }}>
          <TextField
            label="Client secret"
            type="password"
            value={clearSecret ? "" : secret}
            disabled={clearSecret}
            onChange={(event) => setSecret(event.target.value)}
            size="small"
            fullWidth
            autoComplete="new-password"
            placeholder={data?.client_secret_set ? `salvato ${data.client_secret_hint}` : "nessun segreto salvato"}
            helperText={
              clearSecret
                ? "Il segreto salvato verrà cancellato al salvataggio."
                : data?.client_secret_set
                  ? "Lascia vuoto per mantenere il segreto già salvato."
                  : "Cifrato a database, non sarà più rileggibile."
            }
          />
          {data?.client_secret_set && (
            <Button
              size="small"
              color={clearSecret ? "inherit" : "error"}
              onClick={() => { setClearSecret((prev) => !prev); setSecret(""); }}
              sx={{ mt: { md: 0.5 }, flexShrink: 0 }}
            >
              {clearSecret ? "Annulla rimozione" : "Rimuovi segreto"}
            </Button>
          )}
        </Stack>
      </Stack>

      <Divider sx={{ my: 2.5 }} />

      <Typography fontSize={14} fontWeight={700} sx={{ mb: 1 }}>Funzioni</Typography>
      <Stack spacing={0.5} sx={{ mb: 2 }}>
        <FormControlLabel
          control={
            <Switch
              checked={form.oof_enabled}
              disabled={locked}
              onChange={(event) => setField("oof_enabled")(event.target.checked)}
            />
          }
          label={<Typography fontSize={14}>Risposta automatica ferie (Fuori sede)</Typography>}
        />
        <FormControlLabel
          control={
            <Switch
              checked={form.oof_use_manager}
              disabled={locked || !form.oof_enabled}
              onChange={(event) => setField("oof_use_manager")(event.target.checked)}
            />
          }
          label={<Typography fontSize={14}>Indica il responsabile come contatto per le urgenze</Typography>}
        />
        <TextField
          label="Contatto di riserva"
          value={form.oof_fallback_contact}
          onChange={(event) => setField("oof_fallback_contact")(event.target.value)}
          disabled={locked || !form.oof_enabled}
          size="small"
          fullWidth
          sx={{ mt: 1.5, maxWidth: 460 }}
          helperText="Usato quando il dipendente non ha un responsabile, o quando l'opzione qui sopra è spenta."
        />
      </Stack>

      {form.enabled && form.oof_enabled && !data?.credentials_complete && !secret.trim() && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Mancano tenant, client id o client secret: finché le credenziali non sono complete la funzione resta inerte.
        </Alert>
      )}

      <Stack direction="row" spacing={1.5} alignItems="center">
        <Button variant="contained" onClick={handleSave} disabled={save.isPending}>
          {save.isPending ? "Salvataggio…" : "Salva"}
        </Button>
        {data?.updated_at && (
          <Typography fontSize={12} color="text.secondary">
            Ultima modifica {new Date(data.updated_at).toLocaleString("it-IT")}
            {data.updated_by ? ` da ${data.updated_by}` : ""}
          </Typography>
        )}
      </Stack>

      {query.isError && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {String(query.error?.message || "Errore di caricamento")}
        </Alert>
      )}
    </Paper>
  );
}

export default function IntegrationsPage() {
  const [snackbar, setSnackbar] = useState(null);

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 0.5 }}>
        Integrazioni
      </Typography>
      <Typography fontSize={13} color="text.secondary" sx={{ mb: 2.5 }}>
        Servizi esterni collegati a T-Hub. Ogni integrazione ha un interruttore generale: a spento non viene effettuata
        alcuna chiamata verso il servizio. Le credenziali sono cifrate a database e non sono più rileggibili una volta salvate.
      </Typography>

      <Stack spacing={2.5}>
        <Office365Card onNotify={setSnackbar} />
      </Stack>

      <Snackbar
        open={Boolean(snackbar)}
        autoHideDuration={4000}
        onClose={() => setSnackbar(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={snackbar?.severity ?? "success"} onClose={() => setSnackbar(null)} variant="filled">
          {snackbar?.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
