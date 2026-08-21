import { useState, useEffect, useCallback } from "react";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  InputBase,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";

import { getToolChanges, createToolChange, updateToolChange, deleteToolChange } from "../api";
import FilterBar from "../components/FilterBar";
import PageHeader from "../components/PageHeader";

function TrashIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

const FILTERS = [
  { key: "all", label: "Tutte" },
  { key: "pending", label: "Da fare" },
  { key: "done", label: "Completate" },
];

export default function ToolChangesPage() {
  const [changes, setChanges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState("all");

  const fetchChanges = useCallback(async () => {
    try {
      const data = await getToolChanges();
      setChanges(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChanges();
  }, [fetchChanges]);

  async function addChange() {
    const text = draft.trim();
    if (!text || adding) return;
    setAdding(true);
    try {
      const created = await createToolChange({ text });
      setChanges((prev) => [...prev, created]);
      setDraft("");
    } finally {
      setAdding(false);
    }
  }

  async function toggleDone(change) {
    const updated = await updateToolChange(change.id, { done: !change.done });
    setChanges((prev) => prev.map((c) => (c.id === change.id ? updated : c)));
  }

  async function removeChange(id) {
    await deleteToolChange(id);
    setChanges((prev) => prev.filter((c) => c.id !== id));
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") addChange();
  }

  const filtered = changes.filter((c) => {
    if (filter === "pending") return !c.done;
    if (filter === "done") return c.done;
    return true;
  });

  const doneCount = changes.filter((c) => c.done).length;
  const totalCount = changes.length;

  return (
    <Box>
      {/* Toolbar */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2.5 }}>
        <Stack direction="row" spacing={0.75}>
          {FILTERS.map((f) => (
            <Chip
              key={f.key}
              label={f.label}
              onClick={() => setFilter(f.key)}
              size="small"
              sx={{
                fontWeight: 600,
                fontSize: 13,
                px: 0.5,
                bgcolor: filter === f.key ? "rgb(5, 38, 87)" : "rgba(0, 112, 64, 0.07)",
                color: filter === f.key ? "#fff" : "rgb(13, 22, 38)",
                "&:hover": {
                  bgcolor: filter === f.key ? "rgb(5, 38, 87)" : "rgba(0, 112, 64, 0.13)",
                },
              }}
            />
          ))}
        </Stack>
        {totalCount > 0 && (
          <Typography sx={{ fontSize: 13, color: "text.secondary", fontWeight: 500 }}>
            {doneCount}/{totalCount} completate
          </Typography>
        )}
      </Stack>

      {/* Add new */}
      <Paper
        elevation={0}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 2,
          py: 1.25,
          mb: 2.5,
          border: "1px solid rgba(226, 226, 229, 0.95)",
          borderRadius: 2.5,
          bgcolor: "rgba(255, 253, 248, 0.84)",
        }}
      >
        <InputBase
          fullWidth
          placeholder="Descrivi la modifica da fare..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          sx={{ fontSize: 14, flex: 1 }}
          inputProps={{ "aria-label": "nuova modifica" }}
        />
        <Button
          onClick={addChange}
          disabled={!draft.trim() || adding}
          startIcon={adding ? <CircularProgress size={14} color="inherit" /> : <PlusIcon />}
          size="small"
          sx={{
            textTransform: "none",
            fontWeight: 600,
            fontSize: 13,
            px: 1.5,
            borderRadius: 1.5,
            bgcolor: "rgb(5, 38, 87)",
            color: "#fff",
            flexShrink: 0,
            "&:hover": { bgcolor: "rgb(4, 28, 65)" },
            "&.Mui-disabled": { bgcolor: "rgba(0, 112, 64, 0.15)", color: "rgba(255,255,255,0.6)" },
          }}
        >
          Aggiungi
        </Button>
      </Paper>

      {/* List */}
      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress size={28} />
        </Box>
      ) : filtered.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 8, color: "text.secondary" }}>
          <Typography sx={{ fontSize: 14 }}>
            {filter === "all" ? "Nessuna modifica ancora. Aggiungine una sopra." : "Nessun elemento in questa categoria."}
          </Typography>
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
          {filtered.map((change, idx) => (
            <Box key={change.id}>
              {idx > 0 && <Divider sx={{ borderColor: "rgba(226, 226, 229, 0.7)" }} />}
              <Stack
                direction="row"
                alignItems="flex-start"
                sx={{
                  px: 2,
                  py: 1.5,
                  gap: 1,
                  transition: "background 0.1s",
                  "&:hover": { bgcolor: "rgba(0, 112, 64, 0.025)" },
                  "&:hover .delete-btn": { opacity: 1 },
                }}
              >
                <Checkbox
                  checked={change.done}
                  onChange={() => toggleDone(change)}
                  size="small"
                  sx={{
                    mt: "-2px",
                    p: 0.5,
                    color: "rgba(0, 112, 64, 0.3)",
                    "&.Mui-checked": { color: "rgb(5, 38, 87)" },
                  }}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    sx={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: change.done ? "text.disabled" : "rgb(13, 22, 38)",
                      textDecoration: change.done ? "line-through" : "none",
                      wordBreak: "break-word",
                    }}
                  >
                    {change.text}
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: "text.disabled", mt: 0.25 }}>
                    {new Date(change.created_at).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </Typography>
                </Box>
                <Tooltip title="Elimina">
                  <IconButton
                    className="delete-btn"
                    size="small"
                    onClick={() => removeChange(change.id)}
                    sx={{
                      opacity: 0,
                      color: "rgba(200, 40, 40, 0.7)",
                      transition: "opacity 0.15s",
                      flexShrink: 0,
                      "&:hover": { color: "rgb(200, 40, 40)", bgcolor: "rgba(200, 40, 40, 0.07)" },
                    }}
                  >
                    <TrashIcon />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Box>
          ))}
        </Paper>
      )}
    </Box>
  );
}
