import { useCallback, useEffect, useState } from "react";
import { Box, Button, CircularProgress, MenuItem, Paper, Select, Stack, TextField, Typography } from "@mui/material";

import { createNinjaOneTicket, getNinjaOneTickets } from "../ninjaoneTicketsApi";
import PageHeader from "../components/PageHeader";

const PRIORITIES = [
  { value: "LOW", label: "Bassa" },
  { value: "NORMAL", label: "Normale" },
  { value: "HIGH", label: "Alta" },
  { value: "URGENT", label: "Urgente" },
];

export default function NinjaOneTicketsPage() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      setTickets(await getNinjaOneTickets());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  async function submit() {
    if (!subject.trim() || !description.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createNinjaOneTicket({ subject: subject.trim(), description: description.trim(), priority });
      setTickets((prev) => [created, ...prev]);
      setSubject("");
      setDescription("");
      setPriority("NORMAL");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Box>
      <PageHeader
        section="Assistenza"
        title="Ticket NinjaOne"
        meta="Apri un ticket di assistenza IT: viene creato su NinjaOne e tracciato qui sotto"
      />

      <Paper
        elevation={0}
        sx={{
          p: 2.5,
          mb: 2.5,
          border: "1px solid rgba(226, 226, 229, 0.95)",
          borderRadius: 2.5,
          bgcolor: "rgba(255, 253, 248, 0.84)",
        }}
      >
        <Stack spacing={1.5}>
          <TextField
            label="Oggetto"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            size="small"
            fullWidth
          />
          <TextField
            label="Descrizione"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            size="small"
            fullWidth
            multiline
            minRows={3}
          />
          <Select value={priority} onChange={(e) => setPriority(e.target.value)} size="small" sx={{ maxWidth: 220 }}>
            {PRIORITIES.map((p) => (
              <MenuItem key={p.value} value={p.value}>
                {p.label}
              </MenuItem>
            ))}
          </Select>
          {error && (
            <Typography sx={{ fontSize: 13, color: "rgb(180, 40, 40)" }}>{error}</Typography>
          )}
          <Box>
            <Button
              onClick={submit}
              disabled={!subject.trim() || !description.trim() || submitting}
              startIcon={submitting ? <CircularProgress size={14} color="inherit" /> : null}
              size="small"
              sx={{
                textTransform: "none",
                fontWeight: 600,
                fontSize: 13,
                px: 2,
                borderRadius: 1.5,
                bgcolor: "rgb(5, 38, 87)",
                color: "#fff",
                "&:hover": { bgcolor: "rgb(4, 28, 65)" },
                "&.Mui-disabled": { bgcolor: "rgba(0, 112, 64, 0.15)", color: "rgba(255,255,255,0.6)" },
              }}
            >
              Apri ticket
            </Button>
          </Box>
        </Stack>
      </Paper>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress size={28} />
        </Box>
      ) : tickets.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 8, color: "text.secondary" }}>
          <Typography sx={{ fontSize: 14 }}>Nessun ticket aperto finora.</Typography>
        </Box>
      ) : (
        <Paper
          elevation={0}
          sx={{
            border: "1px solid rgba(226, 226, 229, 0.95)",
            borderRadius: 2.5,
            bgcolor: "rgba(255, 253, 248, 0.84)",
            overflow: "hidden",
          }}
        >
          {tickets.map((ticket, idx) => (
            <Box
              key={ticket.id}
              sx={{
                px: 2,
                py: 1.5,
                borderTop: idx > 0 ? "1px solid rgba(226, 226, 229, 0.7)" : "none",
              }}
            >
              <Stack direction="row" alignItems="baseline" justifyContent="space-between">
                <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{ticket.subject}</Typography>
                <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                  #{ticket.ninja_ticket_id} · {ticket.priority} · {ticket.status}
                </Typography>
              </Stack>
              <Typography sx={{ fontSize: 13, color: "text.secondary", mt: 0.5, whiteSpace: "pre-wrap" }}>
                {ticket.description}
              </Typography>
              <Typography sx={{ fontSize: 11, color: "text.disabled", mt: 0.5 }}>
                {new Date(ticket.created_at).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
              </Typography>
            </Box>
          ))}
        </Paper>
      )}
    </Box>
  );
}
