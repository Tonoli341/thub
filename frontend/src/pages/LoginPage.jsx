import { useState } from "react";
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from "@mui/material";

import { useAuth } from "../auth";

function THubLogo({ size = 40 }) {
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: "0.38em", lineHeight: 1 }}>
      <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" style={{ flexShrink: 0, display: "block" }}>
        <defs><clipPath id="thub-login-cl"><circle cx="100" cy="100" r="62" /></clipPath></defs>
        <rect width="200" height="200" rx="44" fill="#F0ECE0" />
        <g clipPath="url(#thub-login-cl)">
          <rect x="38" y="38" width="124" height="124" fill="#007040" />
          <rect x="38" y="71.5" width="124" height="29.8" fill="#F0ECE0" />
          <rect x="84.5" y="71.5" width="31" height="90.5" fill="#F0ECE0" />
        </g>
      </svg>
      <Box
        component="span"
        sx={{
          fontFamily: '"Lexend", "Segoe UI", sans-serif',
          fontWeight: 600,
          fontSize: size * 0.65,
          letterSpacing: "-0.02em",
          lineHeight: 1,
          color: "#2B2B2B",
        }}
      >
        T<Box component="span" sx={{ color: "#007040" }}>-</Box>Hub
      </Box>
    </Box>
  );
}

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      await login(username, password);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        px: 2,
        bgcolor: "#F3F0E8",
      }}
    >
      <Paper sx={{ width: "100%", maxWidth: 460, p: 4, border: "1px solid rgba(0, 112, 64, 0.16)", bgcolor: "#FBFAF6" }}>
        <Stack spacing={3} component="form" onSubmit={handleSubmit}>
          <Stack spacing={1.5} alignItems="flex-start">
            <THubLogo size={40} />
            <Box sx={{ pt: 0.5 }}>
              <Typography variant="h4" sx={{ color: "#2B2B2B" }}>Accesso portale</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                Inserisci le credenziali per accedere a T-Hub.
              </Typography>
            </Box>
          </Stack>

          <TextField
            label="Username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
            fullWidth
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
            fullWidth
          />

          {error && <Alert severity="error">{error}</Alert>}

          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={isSubmitting}
            sx={{ bgcolor: "#007040", "&:hover": { bgcolor: "#005c34" } }}
          >
            {isSubmitting ? "Accesso..." : "Accedi"}
          </Button>
        </Stack>
      </Paper>

      <Box sx={{ position: "fixed", bottom: 20, left: 0, right: 0, textAlign: "center" }}>
        <Typography sx={{ fontSize: 12, color: "rgba(43,43,43,0.4)", fontWeight: 500 }}>
          Tonoli Spedizioni · T-Hub Workforce Hub
        </Typography>
      </Box>
    </Box>
  );
}
