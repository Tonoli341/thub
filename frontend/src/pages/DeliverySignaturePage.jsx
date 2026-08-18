import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { getDeviceDeliveryPolicy, getMyDeviceDelivery, signMyDeviceDelivery } from "../api";

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("it-IT");
}

function SignatureCanvas({ onChange }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const [hasStrokes, setHasStrokes] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.offsetWidth;
    const height = canvas.offsetHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  const getPoint = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const handlePointerDown = (event) => {
    event.preventDefault();
    canvasRef.current.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    const ctx = canvasRef.current.getContext("2d");
    const point = getPoint(event);
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  };

  const handlePointerMove = (event) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    const point = getPoint(event);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    if (!hasStrokes) {
      setHasStrokes(true);
      onChange?.(true);
    }
  };

  const handlePointerUp = () => {
    drawingRef.current = false;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);
    setHasStrokes(false);
    onChange?.(false);
  };

  return (
    <Stack spacing={1}>
      <Box
        component="canvas"
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        sx={{
          width: "100%",
          height: { xs: 180, sm: 220, md: 260 },
          borderRadius: 2,
          border: "1px dashed",
          borderColor: "divider",
          bgcolor: "#ffffff",
          touchAction: "none",
          cursor: "crosshair",
        }}
      />
      <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center">
        <Typography variant="caption" color="text.secondary">
          Firma nel riquadro con il dito, la penna o il mouse.
        </Typography>
        <Button size="small" onClick={clear} disabled={!hasStrokes}>
          Cancella
        </Button>
      </Stack>
    </Stack>
  );
}

SignatureCanvas.getImage = (container) => {
  const canvas = container?.querySelector("canvas");
  return canvas ? canvas.toDataURL("image/png") : null;
};

export default function DeliverySignaturePage() {
  const { deliveryId } = useParams();
  const queryClient = useQueryClient();
  const containerRef = useRef(null);
  const [hasStrokes, setHasStrokes] = useState(false);
  const [signedNow, setSignedNow] = useState(false);
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const deliveryQuery = useQuery({
    queryKey: ["my-device-delivery", deliveryId],
    queryFn: () => getMyDeviceDelivery(deliveryId),
    retry: false,
  });

  const policyQuery = useQuery({
    queryKey: ["device-delivery-policy"],
    queryFn: getDeviceDeliveryPolicy,
    retry: false,
  });

  const signMutation = useMutation({
    mutationFn: (imageB64) => signMyDeviceDelivery(deliveryId, imageB64, { policyAccepted }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-device-delivery", deliveryId] });
      queryClient.invalidateQueries({ queryKey: ["device-deliveries"] });
      setSignedNow(true);
      setErrorMessage(null);
    },
    onError: (error) => setErrorMessage(error.message),
  });

  const handleSubmit = () => {
    const image = SignatureCanvas.getImage(containerRef.current);
    if (!image) return;
    signMutation.mutate(image);
  };

  const delivery = deliveryQuery.data;
  const alreadySigned = Boolean(delivery?.signature_b64);
  const isClosed = Boolean(delivery?.returned_at);
  const policy = policyQuery.data;
  const canSubmit = hasStrokes && (!policy || policyAccepted);

  return (
    <Stack spacing={3} sx={{ maxWidth: { xs: "100%", sm: 640, md: 860, lg: 1040 }, mx: "auto" }}>
      <Stack spacing={0.5}>
        <Typography variant="h5" fontWeight={700}>Firma della consegna</Typography>
        <Typography color="text.secondary">
          Conferma la presa in consegna del dispositivo aziendale apponendo la tua firma.
        </Typography>
      </Stack>

      {deliveryQuery.isLoading && (
        <Stack alignItems="center" py={6}>
          <CircularProgress />
        </Stack>
      )}

      {deliveryQuery.error && <Alert severity="error">{deliveryQuery.error.message}</Alert>}

      {delivery && (
        <Paper sx={{ borderRadius: 3, p: 3 }}>
          <Stack spacing={2}>
            <Stack spacing={0.75}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography fontWeight={700}>{delivery.device_label}</Typography>
                {alreadySigned
                  ? <Chip size="small" color="success" label="Firmata" />
                  : <Chip size="small" color="warning" label="In attesa firma" />}
              </Stack>
              <Typography variant="body2" color="text.secondary">
                Assegnato a {delivery.employee_name} · consegnato il {formatDateTime(delivery.delivered_at)}
              </Typography>
              {delivery.device_serial_number && (
                <Typography variant="body2" color="text.secondary">
                  Seriale: {delivery.device_serial_number}
                </Typography>
              )}
              {delivery.notes && (
                <Typography variant="body2" color="text.secondary">
                  Note: {delivery.notes}
                </Typography>
              )}
            </Stack>

            {signedNow ? (
              <Alert severity="success">
                Firma registrata correttamente. Puoi chiudere questa pagina.
              </Alert>
            ) : isClosed ? (
              <Alert severity="info">
                La consegna è già chiusa (dispositivo restituito): la firma non è più modificabile.
              </Alert>
            ) : (
              <>
                {alreadySigned && (
                  <Alert severity="info">
                    Hai già firmato questa consegna{delivery.signed_at ? ` il ${formatDateTime(delivery.signed_at)}` : ""}.
                    Una nuova firma sostituirà la precedente.
                  </Alert>
                )}
                {policy && (
                  <Stack spacing={1}>
                    <Typography fontWeight={700}>{policy.title}</Typography>
                    <Box
                      sx={{
                        // Area di lettura adattiva: più alta su tablet/PC, compatta su smartphone.
                        maxHeight: { xs: "45vh", sm: "50vh", md: "60vh" },
                        minHeight: 160,
                        overflowY: "auto",
                        border: "1px solid",
                        borderColor: "divider",
                        borderRadius: 2,
                        p: { xs: 1.5, sm: 2, md: 3 },
                        fontSize: { xs: 14, md: 15 },
                        lineHeight: 1.6,
                        "& p": { my: 0.5 },
                        overflowWrap: "break-word",
                      }}
                      dangerouslySetInnerHTML={{ __html: policy.content_html }}
                    />
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={policyAccepted}
                          onChange={(event) => setPolicyAccepted(event.target.checked)}
                        />
                      }
                      label={`Dichiaro di aver letto e compreso la policy "${policy.title}"`}
                    />
                  </Stack>
                )}
                <Box ref={containerRef}>
                  <SignatureCanvas onChange={setHasStrokes} />
                </Box>
                {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
                <Button
                  variant="contained"
                  size="large"
                  onClick={handleSubmit}
                  disabled={!canSubmit || signMutation.isPending}
                >
                  {signMutation.isPending ? "Invio in corso…" : alreadySigned ? "Aggiorna la firma" : "Firma la consegna"}
                </Button>
                <Typography variant="caption" color="text.secondary">
                  Firmando confermi la presa in consegna del dispositivo indicato. La firma viene registrata
                  con il tuo utente e la data/ora di invio.
                </Typography>
              </>
            )}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
