import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
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
  IconButton,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import dayjs from "dayjs";
import "dayjs/locale/it";

dayjs.locale("it");

import { fetchMaintenanceAssetPublicImageBlobUrl, getMaintenanceAssetPublic } from "../maintenanceAssetsApi";
import { MAINTENANCE_ASSET_STATUS_COLORS, MAINTENANCE_ASSET_STATUS_LABELS } from "./maintenanceAssetsColumns";

// Pagina pubblica raggiunta scansionando il QR fisico attaccato all'asset:
// nessun login, nessuna sidebar (montata fuori da ProtectedLayout in
// App.jsx). Sola lettura. Dal 2026-09-03 (vedi manutenzioni.md §18) mostra
// tutta l'anagrafica dell'asset — custom_fields, foto e contaore inclusi —
// e dei documenti soltanto tipo e note, senza accesso al contenuto.
export default function MaintenanceAssetPublicPage() {
  const { token } = useParams();
  const query = useQuery({
    queryKey: ["maintenance-asset-public", token],
    queryFn: () => getMaintenanceAssetPublic(token),
    retry: false,
  });

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        background: "linear-gradient(180deg, rgba(0,112,64,0.10) 0, rgba(0,112,64,0.02) 260px, transparent 520px)",
        bgcolor: "background.default",
        px: { xs: 1.5, sm: 4 },
        py: { xs: 2.5, sm: 5 },
      }}
    >
      <Box sx={{ width: "100%", maxWidth: 560 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 800, letterSpacing: 1, color: "primary.main", mb: 1.5 }}>
          T-Hub · Manutenzioni
        </Typography>

        {query.isLoading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress size={28} />
          </Box>
        )}

        {query.error && (
          <Alert severity="error">
            QR code non valido o non più attivo. Se l'asset è stato dismesso o l'etichetta sostituita, contatta chi
            gestisce il parco manutenzioni.
          </Alert>
        )}

        {query.data && <AssetPublicCard asset={query.data} token={token} />}
      </Box>
    </Box>
  );
}

function AssetPublicCard({ asset, token }) {
  const activeDeadlines = asset.deadlines.filter((d) => d.is_active);
  const fields = asset.custom_field_values ?? [];
  const images = asset.images ?? [];
  const mainImage = images.find((image) => image.image_kind === "main");
  const galleryImages = images.filter((image) => image.id !== mainImage?.id);
  const documents = asset.documents ?? [];
  const notes = asset.notes ?? [];
  const counters = asset.counters ?? [];

  return (
    <Stack spacing={1.5}>
      <Paper
        variant="outlined"
        sx={{ overflow: "hidden", borderRadius: 3, boxShadow: "0 12px 36px rgba(26, 48, 39, 0.10)" }}
      >
        <AssetHeroImage token={token} image={mainImage} assetCode={asset.internal_code} />
        <Box sx={{ p: { xs: 2.25, sm: 3 } }}>
          <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1.5}>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: { xs: 24, sm: 28 }, lineHeight: 1.1, fontWeight: 850, overflowWrap: "anywhere" }}>
                {asset.internal_code}
              </Typography>
              <Typography sx={{ fontSize: 13.5, color: "text.secondary", mt: 0.75 }}>
                {asset.asset_class_label} · {asset.asset_type_label}
              </Typography>
            </Box>
            <PublicStatusChip asset={asset} notes={notes} />
          </Stack>
        </Box>
      </Paper>

      <SectionCard title="Scadenze attive">
        {activeDeadlines.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: "text.secondary" }}>Nessuna scadenza attiva registrata.</Typography>
        ) : (
          <Stack spacing={1.25}>
            {activeDeadlines.map((deadline, index) => (
              <Stack key={index} direction="row" justifyContent="space-between" sx={{ fontSize: 13.5 }}>
                <Typography sx={{ fontSize: 13.5 }}>{deadline.deadline_type}</Typography>
                <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>
                  {dayjs(deadline.due_date).format("DD/MM/YYYY")}
                </Typography>
              </Stack>
            ))}
          </Stack>
        )}
      </SectionCard>

      {fields.length > 0 && (
        <SectionCard title="Anagrafica">
          <Stack spacing={1.25}>
            {fields.map((field) => (
              <Stack key={field.field_key} direction="row" justifyContent="space-between" spacing={2} sx={{ fontSize: 13.5 }}>
                <Typography sx={{ fontSize: 13.5, color: "text.secondary" }}>{field.label}</Typography>
                <Typography sx={{ fontSize: 13.5, fontWeight: 600, textAlign: "right" }}>
                  {field.value ?? "—"}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </SectionCard>
      )}

      {galleryImages.length > 0 && (
        <SectionCard title="Foto">
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
              gap: 1.5,
            }}
          >
            {galleryImages.map((image) => (
              <PublicAssetImage key={image.id} token={token} image={image} />
            ))}
          </Box>
        </SectionCard>
      )}

      {documents.length > 0 && (
        <SectionCard title="Documenti">
          <Stack spacing={1.5}>
            {documents.map((document, index) => (
              <Box key={`${document.document_type}-${index}`}>
                <Typography sx={{ fontSize: 13.5, fontWeight: 700 }}>{document.document_type}</Typography>
                <Typography sx={{ fontSize: 13, color: "text.secondary", mt: 0.25, whiteSpace: "pre-wrap" }}>
                  {document.notes || "—"}
                </Typography>
              </Box>
            ))}
          </Stack>
        </SectionCard>
      )}

      {counters.length > 0 && (
        <SectionCard title="Ore / contaore">
          <Stack spacing={1.25}>
            {counters.map((reading, index) => (
              <Stack key={index} direction="row" justifyContent="space-between" sx={{ fontSize: 13.5 }}>
                <Typography sx={{ fontSize: 13.5 }}>{dayjs(reading.reading_date).format("DD/MM/YYYY")}</Typography>
                <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>
                  {reading.value} {reading.unit}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </SectionCard>
      )}
    </Stack>
  );
}

function PublicStatusChip({ asset, notes }) {
  const [open, setOpen] = useState(false);
  const statusLabel = MAINTENANCE_ASSET_STATUS_LABELS[asset.status] ?? asset.status;

  return (
    <>
      <Chip
        size="small"
        label={statusLabel}
        color={MAINTENANCE_ASSET_STATUS_COLORS[asset.status] ?? "default"}
        clickable
        onClick={() => setOpen(true)}
        aria-label={`${statusLabel}: mostra il motivo`}
        sx={{ flexShrink: 0, fontWeight: 700 }}
      />
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{statusLabel}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: "text.secondary", mb: 0.75 }}>
            Motivo
          </Typography>
          <Typography sx={{ color: asset.status_reason ? "text.primary" : "text.secondary", whiteSpace: "pre-wrap" }}>
            {asset.status_reason || "Nessun motivo indicato per questo stato."}
          </Typography>
          <Typography sx={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: "text.secondary", mt: 2.5, mb: 0.75 }}>
            Note
          </Typography>
          {notes.length > 0 ? (
            <Stack spacing={1}>
              {notes.map((note, index) => (
                <Box key={index} sx={{ p: 1.25, borderRadius: 1.5, bgcolor: "action.hover" }}>
                  <Typography sx={{ fontSize: 13.5, whiteSpace: "pre-wrap" }}>{note.text}</Typography>
                  <Typography sx={{ fontSize: 11.5, color: "text.secondary", mt: 0.75 }}>
                    {note.created_by || "Utente non disponibile"} · {dayjs(note.created_at).format("DD/MM/YYYY HH:mm")}
                  </Typography>
                </Box>
              ))}
            </Stack>
          ) : (
            <Typography sx={{ color: "text.secondary" }}>Nessuna nota registrata.</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Chiudi</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function SectionCard({ title, children }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2.25, sm: 3 }, borderRadius: 2.5 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.7, textTransform: "uppercase", color: "text.secondary", mb: 1.75 }}>
        {title}
      </Typography>
      {children}
    </Paper>
  );
}

function AssetHeroImage({ token, image, assetCode }) {
  if (!image) {
    return (
      <Box
        sx={{
          height: { xs: 180, sm: 240 },
          display: "grid",
          placeItems: "center",
          background: "linear-gradient(145deg, rgba(0,112,64,0.20), rgba(0,112,64,0.05))",
        }}
      >
        <Typography sx={{ fontSize: 42, fontWeight: 850, letterSpacing: -1, color: "primary.main", opacity: 0.7 }}>
          {assetCode.slice(0, 2).toUpperCase()}
        </Typography>
      </Box>
    );
  }
  return <PublicAssetImage token={token} image={image} aspectRatio="16 / 9" borderRadius={0} alt="Foto principale asset" />;
}

function PublicAssetImage({ token, image, aspectRatio = "1 / 1", borderRadius = 1.5, alt = image.title }) {
  const [url, setUrl] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;
    fetchMaintenanceAssetPublicImageBlobUrl(token, image.id).then((blobUrl) => {
      if (cancelled) {
        URL.revokeObjectURL(blobUrl);
        return;
      }
      objectUrl = blobUrl;
      setUrl(blobUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, image.id]);

  return (
    <>
      <Box
        component="button"
        type="button"
        aria-label={`Apri ${alt} a schermo intero`}
        disabled={!url}
        onClick={() => setOpen(true)}
        sx={{
          width: "100%",
          aspectRatio,
          border: 0,
          p: 0,
          borderRadius,
          overflow: "hidden",
          bgcolor: "action.hover",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: url ? "zoom-in" : "default",
        }}
      >
        {url ? (
          <Box component="img" src={url} alt={alt} sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <CircularProgress size={20} />
        )}
      </Box>

      <Dialog
        fullScreen
        open={open}
        onClose={() => setOpen(false)}
        PaperProps={{ sx: { bgcolor: "#111" } }}
      >
        <IconButton
          aria-label="Chiudi immagine"
          onClick={() => setOpen(false)}
          sx={{
            position: "absolute",
            top: { xs: 12, sm: 20 },
            right: { xs: 12, sm: 20 },
            zIndex: 1,
            width: 44,
            height: 44,
            color: "common.white",
            bgcolor: "rgba(0, 0, 0, 0.55)",
            "&:hover": { bgcolor: "rgba(0, 0, 0, 0.75)" },
          }}
        >
          <Typography component="span" aria-hidden="true" sx={{ fontSize: 30, lineHeight: 1, fontWeight: 300 }}>
            ×
          </Typography>
        </IconButton>
        {url && (
          <Box
            component="img"
            src={url}
            alt={alt}
            sx={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        )}
      </Dialog>
    </>
  );
}
