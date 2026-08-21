import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import { useState } from "react";
import { Box, Button, Paper, Stack, TextField } from "@mui/material";

dayjs.extend(isoWeek);

const PRESETS = [
  { label: "Ieri", start: () => dayjs().subtract(1, "day").format("YYYY-MM-DD"), end: () => dayjs().subtract(1, "day").format("YYYY-MM-DD") },
  { label: "Questa settimana", start: () => dayjs().startOf("isoWeek").format("YYYY-MM-DD"), end: () => dayjs().format("YYYY-MM-DD") },
  { label: "Settimana scorsa", start: () => dayjs().subtract(1, "week").startOf("isoWeek").format("YYYY-MM-DD"), end: () => dayjs().subtract(1, "week").endOf("isoWeek").format("YYYY-MM-DD") },
  { label: "Questo mese", start: () => dayjs().startOf("month").format("YYYY-MM-DD"), end: () => dayjs().format("YYYY-MM-DD") },
  { label: "Mese scorso", start: () => dayjs().subtract(1, "month").startOf("month").format("YYYY-MM-DD"), end: () => dayjs().subtract(1, "month").endOf("month").format("YYYY-MM-DD") },
  { label: "Ultimi 90 giorni", start: () => dayjs().subtract(89, "day").format("YYYY-MM-DD"), end: () => dayjs().format("YYYY-MM-DD") },
];

export default function ReportingPeriodFilter({ start, end, onChange, children, gridTemplateColumns }) {
  const [activePreset, setActivePreset] = useState(null);
  const today = dayjs().format("YYYY-MM-DD");
  const isToday = start === today && end === today;

  function selectToday() {
    setActivePreset(null);
    onChange({ start: today, end: today });
  }

  function updateDate(key, value) {
    setActivePreset(null);
    onChange({ start, end, [key]: value });
  }

  function applyPreset(index) {
    const preset = PRESETS[index];
    setActivePreset(index);
    onChange({ start: preset.start(), end: preset.end() });
  }

  return (
    <Paper variant="outlined" sx={{ px: 1.25, py: 1.25, borderRadius: 2 }}>
      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: gridTemplateColumns ?? { xs: "1fr", sm: "auto 1fr 1fr" },
          alignItems: "center",
        }}
      >
        <Button
          variant={isToday ? "contained" : "outlined"}
          onClick={selectToday}
          startIcon={<span aria-hidden="true">📅</span>}
          sx={{ alignSelf: "stretch", whiteSpace: "nowrap", px: 3 }}
        >
          Oggi
        </Button>
        <TextField
          type="date"
          label="Dal"
          value={start}
          onChange={(event) => updateDate("start", event.target.value)}
          InputLabelProps={{ shrink: true }}
          size="small"
        />
        <TextField
          type="date"
          label="Al"
          value={end}
          onChange={(event) => updateDate("end", event.target.value)}
          InputLabelProps={{ shrink: true }}
          size="small"
        />
        {children}
      </Box>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.25 }}>
        {PRESETS.map((preset, index) => (
          <Button
            key={preset.label}
            size="small"
            onClick={() => applyPreset(index)}
            variant={activePreset === index ? "contained" : "outlined"}
            sx={{ whiteSpace: "nowrap", fontSize: 13 }}
          >
            {preset.label}
          </Button>
        ))}
      </Stack>
    </Paper>
  );
}
