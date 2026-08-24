import dayjs from "dayjs";

import FilterSelect from "../components/FilterSelect";
import { absenceWindowLabel } from "./presenceLookup";
import PageHeader from "../components/PageHeader";
import { getRoleColor, getRoleLabel } from "../roles";
import isoWeek from "dayjs/plugin/isoWeek";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  Grid2,
  IconButton,
  InputAdornment,
  InputBase,
  MenuItem,
  Paper,
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";

import { useAuth } from "../auth";
import { getDashboard, getDashboardApprover, getDashboardBirthdays, getDashboardExpirations, getDashboardMe, getEmployeeOptions, getJustifications, getEmployeePhoto, updateJustificationApproval } from "../api";

dayjs.extend(isoWeek);

// ─── avatar / color utilities ─────────────────────────────────────────────────

const AVATAR_HUES = [
  "#2563eb", "#0891b2", "#0d9488", "#059669", "#65a30d",
  "#ca8a04", "#ea580c", "#dc2626", "#9333ea", "#db2777",
];

function stringToColor(str) {
  let h = 0;
  for (let i = 0; i < (str || "").length; i++) h = (str.charCodeAt(i) + ((h << 5) - h)) | 0;
  return AVATAR_HUES[Math.abs(h) % AVATAR_HUES.length];
}

function nameInitials(name) {
  const w = (name || "").trim().split(/\s+/);
  return w.length >= 2
    ? `${w[0][0]}${w[w.length - 1][0]}`.toUpperCase()
    : (name || "?").slice(0, 2).toUpperCase();
}

function EmployeeAvatar({ name, employeeId, size = 30 }) {
  const color = stringToColor(name);

  const { data: photoUrl } = useQuery({
    queryKey: ["employee-photo", employeeId],
    queryFn: async () => {
      const blob = await getEmployeePhoto(employeeId);
      return URL.createObjectURL(blob);
    },
    enabled: Boolean(employeeId),
    staleTime: 15 * 60 * 1000,
    gcTime: 20 * 60 * 1000,
    retry: false,
  });

  return (
    <Tooltip title={name || "—"} arrow placement="top">
      <Box sx={{
        width: size, height: size, borderRadius: "50%", flexShrink: 0,
        bgcolor: color,
        backgroundImage: photoUrl ? `url(${photoUrl})` : "none",
        backgroundSize: "cover",
        backgroundPosition: "center top",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#fff", fontSize: Math.round(size * 0.37), fontWeight: 700,
        letterSpacing: "-0.01em", userSelect: "none", cursor: "default",
        border: "1.5px solid rgba(255,255,255,0.75)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.14)",
      }}>
        {!photoUrl && nameInitials(name)}
      </Box>
    </Tooltip>
  );
}

function AbsenceBorderRing({ size, isPartial, color = "#007040", children }) {
  const pad = 3;
  const outer = size + pad * 2;
  const r = outer / 2 - 2;
  return (
    <Box sx={{ position: "relative", display: "inline-flex", flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
      {children}
      <Box
        component="svg"
        viewBox={`0 0 ${outer} ${outer}`}
        sx={{ position: "absolute", top: -pad, left: -pad, width: outer, height: outer, pointerEvents: "none", overflow: "visible" }}
      >
        <circle
          cx={outer / 2}
          cy={outer / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={2.0}
          strokeLinecap="round"
          strokeDasharray={isPartial ? "6 5" : undefined}
        />
      </Box>
    </Box>
  );
}

// ─── constants ────────────────────────────────────────────────────────────────

const STATUS_COLOR = { approved: "#4f772d", pending: "#d97706", rejected: "#bc4749" };
const STATUS_LABEL = { approved: "Approvata", pending: "In attesa", rejected: "Rifiutata" };
const WEEKDAYS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
const WEEKDAYS_FULL = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];
const MONTHS_IT = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno",
                   "Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
const DASHBOARD_PANEL_PREFERENCES_PREFIX = "thub-dashboard-panels";

function getDashboardPanelPreferences(storageKey) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    return {
      presenceExpanded: saved?.presenceExpanded ?? true,
      weekExpanded: saved?.weekExpanded ?? true,
      monthExpanded: saved?.monthExpanded ?? true,
    };
  } catch {
    return { presenceExpanded: true, weekExpanded: true, monthExpanded: true };
  }
}

function saveDashboardPanelPreference(storageKey, panel, expanded) {
  try {
    const current = getDashboardPanelPreferences(storageKey);
    localStorage.setItem(storageKey, JSON.stringify({ ...current, [panel]: expanded }));
  } catch {
    // La dashboard resta utilizzabile anche se lo storage del browser non è disponibile.
  }
}

const SURFACE_TONES = {
  neutral: {
    accent: "#2B2B2B",
    border: "rgba(43,43,43,0.14)",
    topBorder: "#2B2B2B",
    headerBg: "linear-gradient(180deg, rgba(43,43,43,0.06), rgba(43,43,43,0.02))",
    bodyBg: "linear-gradient(180deg, rgba(255,255,255,0.92), rgba(248,246,241,0.96))",
  },
  teal: {
    accent: "#0e6e8a",
    border: "rgba(14,110,138,0.22)",
    topBorder: "#0e6e8a",
    headerBg: "linear-gradient(180deg, rgba(14,110,138,0.13), rgba(14,110,138,0.03))",
    bodyBg: "linear-gradient(180deg, rgba(224,242,254,0.55), rgba(255,255,255,0.98))",
  },
  green: {
    accent: "#007040",
    border: "rgba(0,112,64,0.18)",
    topBorder: "#007040",
    headerBg: "linear-gradient(180deg, rgba(0,112,64,0.10), rgba(0,112,64,0.03))",
    bodyBg: "linear-gradient(180deg, rgba(220,252,231,0.5), rgba(255,255,255,0.98))",
  },
  olive: {
    accent: "#4f772d",
    border: "rgba(79,119,45,0.18)",
    topBorder: "#4f772d",
    headerBg: "linear-gradient(180deg, rgba(79,119,45,0.10), rgba(79,119,45,0.03))",
    bodyBg: "linear-gradient(180deg, rgba(240,253,220,0.55), rgba(255,255,255,0.98))",
  },
  amber: {
    accent: "#d97706",
    border: "rgba(217,119,6,0.22)",
    topBorder: "#d97706",
    headerBg: "linear-gradient(180deg, rgba(217,119,6,0.11), rgba(217,119,6,0.03))",
    bodyBg: "linear-gradient(180deg, rgba(255,251,235,0.65), rgba(255,255,255,0.98))",
  },
  red: {
    accent: "#bc4749",
    border: "rgba(188,71,73,0.2)",
    topBorder: "#bc4749",
    headerBg: "linear-gradient(180deg, rgba(188,71,73,0.10), rgba(188,71,73,0.03))",
    bodyBg: "linear-gradient(180deg, rgba(255,255,255,0.94), rgba(252,244,244,0.98))",
  },
};

const ORG_CARDS = [
  { key: "present", title: "In Planner oggi",   dataKey: "present_count",           accent: "#4f772d", detailKey: "present_detail",          detailTitle: "In Planner oggi" },
  { key: "pending", title: "Assenze in attesa",  dataKey: "pending_approvals_count", accent: "#d97706", detailKey: "pending_approvals_detail", detailTitle: "Tutte le richieste in attesa" },
];

// ─── generic helpers ──────────────────────────────────────────────────────────

const FULL_DAY_START = "08:00";
const FULL_DAY_END = "18:00";
// Marcatore storico della giornata intera, ancora presente sulle assenze gia'
// salvate e su quelle create dai client esterni.
const LEGACY_FULL_DAY_END = "17:00";

function fmtAbsenceTime(startTime, endTime) {
  if (!startTime || !endTime) return null;
  const s = String(startTime).slice(0, 5);
  const e = String(endTime).slice(0, 5);
  if (s === FULL_DAY_START && (e === FULL_DAY_END || e === LEGACY_FULL_DAY_END)) return "Giornata intera";
  return `${s}–${e}`;
}

// Persone distinte dentro un'area: la stessa persona puo' avere piu' turni
// nello stesso immobile, ma nel conteggio va contata una volta sola.
function areaPeopleCount(item) {
  if (item.people?.length) return new Set(item.people.map((person) => person.employee_id)).size;
  return item.info ? item.info.split(",").filter(Boolean).length : 0;
}

function StatusBadge({ status }) {
  const color = STATUS_COLOR[status] ?? "#6c757d";
  return (
    <Box sx={{ px: 0.6, py: 0.1, borderRadius: 1, bgcolor: `${color}18`, color, fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
      {STATUS_LABEL[status] ?? status}
    </Box>
  );
}

function SectionTitle({ children, accent = "#007040" }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
      <Box sx={{ width: 3, height: 18, borderRadius: 2, bgcolor: accent, flexShrink: 0 }} />
      <Typography sx={{ fontSize: 12, fontWeight: 800, color: accent, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {children}
      </Typography>
    </Box>
  );
}

function EmptyState({ label }) {
  return (
    <Typography sx={{ fontSize: 13, color: "text.disabled", fontStyle: "italic" }}>{label}</Typography>
  );
}

function SectionShell({ tone = "green", title, subtitle, action, bodySx, children }) {
  const colors = SURFACE_TONES[tone] ?? SURFACE_TONES.green;

  return (
    <Paper
      elevation={0}
      sx={{
        border: `1.5px solid ${colors.border}`,
        borderTop: `3px solid ${colors.topBorder}`,
        borderRadius: 2,
        overflow: "hidden",
        background: colors.bodyBg,
      }}
    >
      {title && (
        <Box
          sx={{
            px: 2.5,
            py: 1.75,
            borderBottom: `1px solid ${colors.border}`,
            background: colors.headerBg,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 2,
            flexWrap: "wrap",
          }}
        >
          <Box>
            <Typography sx={{ fontSize: 14, fontWeight: 800, color: colors.accent }}>{title}</Typography>
            {subtitle && <Typography sx={{ fontSize: 11, color: "text.secondary", mt: 0.25 }}>{subtitle}</Typography>}
          </Box>
          {action}
        </Box>
      )}
      <Box sx={bodySx}>{children}</Box>
    </Paper>
  );
}

function overlapsDay(item, date) {
  const day = dayjs(date);
  const isoDate = day.format("YYYY-MM-DD");
  if (item.justification_type === "FERIE" && (day.day() === 0 || day.day() === 6)) {
    return false;
  }
  return item.start_date <= isoDate && item.end_date >= isoDate;
}

// ─── personal section ─────────────────────────────────────────────────────────

function TodayPlanner({ assignments }) {
  if (!assignments?.length) {
    return <EmptyState label="Non inserito nel planner oggi" />;
  }
  return (
    <Stack spacing={0.75}>
      {assignments.map((a, i) => {
        const color = stringToColor(a.area || "—");
        // testo principale: site (o area se site è assente) + immobile → "Kimberly K1"
        const siteOrArea = a.site || a.area;
        const mainLabel = [siteOrArea, a.immobile].filter(Boolean).join(" ") || null;
        // chip area solo se area e site sono distinti (evita la ripetizione)
        const showAreaChip = a.area && (!a.site || a.site !== a.area);
        return (
          <Box
            key={i}
            sx={{
              display: "flex", alignItems: "stretch", borderRadius: 2,
              border: `1px solid ${color}33`, overflow: "hidden",
            }}
          >
            <Box sx={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              minWidth: 76, px: 1, py: 1, bgcolor: `${color}12`,
              borderRight: `1px solid ${color}22`, flexShrink: 0,
            }}>
              <Typography sx={{ fontSize: 11, fontWeight: 800, color, fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
                {a.start_time ?? "—"}
              </Typography>
              <Typography sx={{ fontSize: 9, color, opacity: 0.4, lineHeight: 1.2 }}>│</Typography>
              <Typography sx={{ fontSize: 11, fontWeight: 800, color, fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
                {a.end_time ?? "—"}
              </Typography>
            </Box>
            <Box sx={{ px: 1.25, py: 0.875, flex: 1, minWidth: 0 }}>
              {showAreaChip && (
                <Box sx={{ display: "inline-block", mb: 0.35, px: 0.65, py: 0.1, borderRadius: 0.75, bgcolor: `${color}15`, border: `1px solid ${color}30` }}>
                  <Typography sx={{ fontSize: 10, fontWeight: 700, color, lineHeight: 1.3, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    {a.area}
                  </Typography>
                </Box>
              )}
              {mainLabel ? (
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: "text.primary", lineHeight: 1.35 }} noWrap>
                  {mainLabel}
                </Typography>
              ) : (
                <Typography sx={{ fontSize: 13, fontWeight: 400, color: "text.disabled", lineHeight: 1.3 }}>
                  Area non specificata
                </Typography>
              )}
            </Box>
          </Box>
        );
      })}
    </Stack>
  );
}

function UpcomingAbsences({ absences }) {
  const todayIso = dayjs().format("YYYY-MM-DD");
  const [filter, setFilter] = useState("future");

  const filtered = (absences ?? []).filter((a) => {
    if (filter === "past") return a.end_date < todayIso;
    if (filter === "future") return a.end_date >= todayIso;
    return true;
  });

  const emptyLabel = filter === "past" ? "Nessuna assenza passata."
    : filter === "future" ? "Nessuna assenza futura programmata."
    : "Nessuna assenza registrata.";

  return (
    <Paper elevation={0} sx={{ border: "1px solid rgba(0,112,64,0.14)", borderRadius: 2, bgcolor: "rgba(240,253,240,0.4)", overflow: "hidden" }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 1.5, py: 0.875, borderBottom: "1px solid rgba(0,112,64,0.12)", gap: 1 }}>
        <Typography fontSize={12} color="text.secondary">
          {filtered.length} assenz{filtered.length === 1 ? "a" : "e"}
        </Typography>
        <ToggleButtonGroup
          value={filter}
          exclusive
          size="small"
          onChange={(_, val) => { if (val) setFilter(val); }}
          sx={{
            "& .MuiToggleButton-root": {
              fontSize: 11, py: 0.3, px: 1.25, fontWeight: 600, textTransform: "none",
              borderColor: "rgba(0,112,64,0.28)", color: "text.secondary",
              "&.Mui-selected": { bgcolor: "rgba(0,112,64,0.13)", color: "#007040", borderColor: "rgba(0,112,64,0.45)" },
            },
          }}
        >
          <ToggleButton value="future">Future</ToggleButton>
          <ToggleButton value="all">Tutte</ToggleButton>
          <ToggleButton value="past">Passate</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {filtered.length === 0 ? (
        <Typography color="text.secondary" fontSize={13} sx={{ px: 1.5, py: 1.5 }}>{emptyLabel}</Typography>
      ) : (
        <Stack spacing={0}>
          {filtered.map((a) => {
            const isActive = a.start_date <= todayIso && a.end_date >= todayIso;
            const isPast = a.end_date < todayIso;
            const isRejected = a.approval_status === "rejected";
            const timeLabel = fmtAbsenceTime(a.start_time, a.end_time);
            return (
              <Box
                key={a.id}
                sx={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: 1, px: 1.25, py: 0.625,
                  bgcolor: isRejected ? "rgba(188,71,73,0.04)" : isActive ? "rgba(0,112,64,0.05)" : "transparent",
                  opacity: isPast && !isRejected ? 0.45 : 1,
                  "&:not(:last-child)": { borderBottom: "1px solid rgba(226,226,229,0.5)" },
                }}
              >
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                  {isActive && !isRejected && (
                    <Box sx={{ px: 0.6, borderRadius: 1, bgcolor: "#00ff40", color: "#000000", fontSize: 9, fontWeight: 800 }}>IN CORSO</Box>
                  )}
                </Stack>
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <Typography sx={{ fontSize: 11, color: isRejected ? "text.disabled" : "text.secondary", textDecoration: isRejected ? "line-through" : "none" }}>
                    {a.start_date === a.end_date
                      ? dayjs(a.start_date).format("DD/MM")
                      : `${dayjs(a.start_date).format("DD/MM")} – ${dayjs(a.end_date).format("DD/MM")}`}
                  </Typography>
                  {timeLabel && (
                    <Box sx={{ px: 0.6, py: 0.1, borderRadius: 1, bgcolor: "rgba(0,0,0,0.06)", fontSize: 10, fontWeight: 700, color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>
                      {timeLabel}
                    </Box>
                  )}
                  {(!isPast || isRejected) && <StatusBadge status={a.approval_status} />}
                </Stack>
              </Box>
            );
          })}
        </Stack>
      )}
    </Paper>
  );
}

function PersonalSection({ meData, isLoading }) {
  if (isLoading) return <Typography fontSize={13} color="text.secondary">Caricamento...</Typography>;

  return (
    <Stack spacing={2}>
      <Box>
        <SectionTitle accent="#007040">Pianificazione oggi</SectionTitle>
        <TodayPlanner assignments={meData?.today_assignments} />
      </Box>

      <Divider />

      <Box>
        <SectionTitle accent="#007040">Le mie assenze</SectionTitle>
        <UpcomingAbsences absences={meData?.upcoming_absences} />
      </Box>
    </Stack>
  );
}

// ─── team section ─────────────────────────────────────────────────────────────


function TeamAllocations({ areas }) {
  if (!areas?.length) return <EmptyState label="Nessuna pianificazione per oggi" />;
  return (
    <Stack spacing={1.25}>
      {areas.map((a) => {
        const color = stringToColor(a.area);
        return (
          <Box key={a.area}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.6 }}>
              <Box sx={{ width: 3, height: 14, borderRadius: 1, bgcolor: color, flexShrink: 0 }} />
              <Typography sx={{ fontSize: 11, fontWeight: 800, color, textTransform: "uppercase", letterSpacing: "0.04em", flex: 1 }}>
                {a.area}
              </Typography>
              <Box sx={{ px: 0.7, py: 0.1, borderRadius: 1, bgcolor: `${color}18`, color, fontSize: 11, fontWeight: 800 }}>
                {a.count}
              </Box>
            </Box>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, pl: 1.25 }}>
              {(a.employees ?? a.employee_names.map((name) => ({ id: null, name }))).map((emp) => (
                <EmployeeAvatar key={emp.id ?? emp.name} name={emp.name} employeeId={emp.id} size={52} />
              ))}
            </Box>
          </Box>
        );
      })}
    </Stack>
  );
}

function TeamSection({ meData, isLoading }) {
  const [absentPopup, setAbsentPopup] = useState(null);

  if (isLoading) return <Typography fontSize={13} color="text.secondary">Caricamento...</Typography>;

  const hasTeam = meData?.team_size > 0;
  const hasAllocations = meData?.team_allocations?.length > 0;
  const today = dayjs();
  const absentToday = (meData?.team_absent_today ?? []).filter((item) => overlapsDay(item, today));

  return (
    <Stack spacing={0}>
      {absentToday.length > 0 && (
        <Box sx={{ pb: 2 }}>
          <SectionTitle accent="#bc4749">Assenti oggi</SectionTitle>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {absentToday.map((item) => {
              const timeLabel = fmtAbsenceTime(item.start_time, item.end_time);
              const isPartial = timeLabel !== null && timeLabel !== "Giornata intera";
              const ringColor = STATUS_COLOR[item.approval_status] ?? "#007040";
              return (
                <Box key={item.employee_id} onClick={() => setAbsentPopup(item)} sx={{ cursor: "pointer" }}>
                  <WeekAvatarDot
                    name={item.employee_name}
                    employeeId={item.employee_id}
                    timeLabel={timeLabel}
                    isPartial={isPartial}
                    isPast={false}
                    ringColor={ringColor}
                  />
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {absentToday.length > 0 && <Divider sx={{ mb: 2 }} />}

      <Box>
        <SectionTitle accent="#4f772d">Allocazioni oggi</SectionTitle>
        {!hasTeam
          ? <EmptyState label="Nessun riporto diretto trovato" />
          : hasAllocations
            ? <TeamAllocations areas={meData.team_allocations} />
            : <EmptyState label="Nessuna risorsa pianificata oggi" />
        }
      </Box>

      <Dialog open={Boolean(absentPopup)} onClose={() => setAbsentPopup(null)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 2.5 } }}>
        <DialogTitle sx={{ pb: 0.5, pr: 6 }}>
          <Typography fontWeight={800} fontSize={15}>{absentPopup?.employee_name}</Typography>
          <Typography fontSize={12} color="text.secondary" sx={{ mt: 0.25 }}>Assente oggi</Typography>
        </DialogTitle>
        <IconButton onClick={() => setAbsentPopup(null)} size="small" sx={{ position: "absolute", top: 12, right: 12, color: "text.secondary" }}>
          <Box component="svg" viewBox="0 0 24 24" sx={{ width: 18, height: 18, fill: "currentColor" }}>
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </Box>
        </IconButton>
        <DialogContent sx={{ pt: 0.5, pb: 2 }}>
          <Stack spacing={0}>
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", px: 1, py: 0.875 }}>
              <Typography fontSize={13} color="text.secondary">Periodo</Typography>
              <Typography fontSize={13} fontWeight={600}>
                {absentPopup && (absentPopup.start_date === absentPopup.end_date
                  ? dayjs(absentPopup.start_date).format("DD/MM/YYYY")
                  : `${dayjs(absentPopup.start_date).format("DD/MM")} – ${dayjs(absentPopup.end_date).format("DD/MM/YYYY")}`)}
              </Typography>
            </Box>
            {absentPopup && fmtAbsenceTime(absentPopup.start_time, absentPopup.end_time) && (
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", px: 1, py: 0.875, borderTop: "1px solid rgba(226,226,229,0.6)" }}>
                <Typography fontSize={13} color="text.secondary">Orario</Typography>
                <Box sx={{ px: 0.75, py: 0.2, borderRadius: 1, bgcolor: "rgba(0,0,0,0.06)", fontSize: 12, fontWeight: 700, color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>
                  {fmtAbsenceTime(absentPopup.start_time, absentPopup.end_time)}
                </Box>
              </Box>
            )}
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", px: 1, py: 0.875, borderTop: "1px solid rgba(226,226,229,0.6)" }}>
              <Typography fontSize={13} color="text.secondary">Stato</Typography>
              {absentPopup && <StatusBadge status={absentPopup.approval_status} />}
            </Box>
          </Stack>
        </DialogContent>
      </Dialog>
    </Stack>
  );
}

// ─── org section ──────────────────────────────────────────────────────────────

function OrgMetricCard({ title, value, accent, onClick, active, showBell = false, pulse = false }) {
  return (
    <Paper
      elevation={0}
      onClick={onClick}
      sx={{
        px: 2, py: 1.5, border: "1.5px solid",
        borderColor: active ? accent : pulse ? `${accent}88` : `${accent}33`,
        background: active
          ? `linear-gradient(180deg, ${accent}14, rgba(255,255,255,0.98))`
          : `linear-gradient(180deg, ${accent}08, rgba(255,255,255,0.98))`,
        cursor: "pointer",
        transition: "border-color 0.15s, background 0.15s, transform 0.15s",
        "&:hover": { borderColor: accent, transform: "translateY(-1px)" },
        userSelect: "none",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1,
        ...(pulse && !active && {
          animation: "orgCardPulse 2s ease-in-out infinite",
          "@keyframes orgCardPulse": {
            "0%, 100%": { borderColor: `${accent}55`, boxShadow: "none" },
            "50%": { borderColor: accent, boxShadow: `0 0 0 3px ${accent}2e` },
          },
        }),
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
        {showBell && (
          <Box component="svg" viewBox="0 0 24 24" sx={{ width: 15, height: 15, fill: accent, flexShrink: 0 }}>
            <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
          </Box>
        )}
        <Typography sx={{ fontSize: 13, fontWeight: showBell ? 700 : 600, color: active ? accent : showBell ? accent : "text.secondary", lineHeight: 1.3 }}>{title}</Typography>
      </Box>
      <Typography sx={{ fontSize: 22, fontWeight: 800, color: active ? accent : "text.primary", lineHeight: 1 }}>{value ?? 0}</Typography>
    </Paper>
  );
}

function OrgDetailPanel({ title, accent, items, altItems, altTitle, onOpenJustification }) {
  const [view, setView] = useState("area");
  const hasAlt = Boolean(altItems);
  const displayed = hasAlt && view === "area" ? altItems : items;
  const isAreaView = hasAlt && view === "area";

  return (
    <Paper elevation={0} sx={{ border: `1.5px solid ${accent}33`, borderTop: `3px solid ${accent}`, overflow: "hidden" }}>
      <Box sx={{ px: 2, py: 1.25, borderBottom: "1px solid rgba(226,226,229,0.8)", bgcolor: `${accent}08`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
        <Box>
          <Typography fontWeight={700} fontSize={14} sx={{ color: accent }}>{hasAlt && view === "area" ? altTitle : title}</Typography>
          <Typography fontSize={12} color="text.secondary">{displayed.length} element{displayed.length === 1 ? "o" : "i"}</Typography>
        </Box>
        {hasAlt && (
          <ToggleButtonGroup value={view} exclusive size="small" onChange={(_, val) => { if (val) setView(val); }}
            sx={{ "& .MuiToggleButton-root": { fontSize: 11, py: 0.4, px: 1.25, fontWeight: 600, textTransform: "none", borderColor: `${accent}44`, color: "text.secondary", "&.Mui-selected": { bgcolor: `${accent}14`, color: accent, borderColor: `${accent}66` } } }}
          >
            <ToggleButton value="user">Per utente</ToggleButton>
            <ToggleButton value="area">Per area</ToggleButton>
          </ToggleButtonGroup>
        )}
      </Box>
      {displayed.length === 0
        ? <Box sx={{ px: 2, py: 1.5 }}><Typography color="text.secondary" fontSize={13}>Nessun elemento.</Typography></Box>
        : (
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(3, 1fr)" }, px: 0.75, py: 0.5, gap: 0.5 }}>
            {displayed.map((item, i) => {
              // Le righe che nascono da una giustificazione portano il suo id:
              // solo quelle possono aprire il pannello di approvazione.
              const openable = Boolean(item.justification_id && onOpenJustification);
              const open = () => onOpenJustification(item.justification_id);
              return (
              <Box
                key={`${item.employee_id}-${i}`}
                role={openable ? "button" : undefined}
                tabIndex={openable ? 0 : undefined}
                title={openable ? "Apri la richiesta in Assenze › Richieste" : undefined}
                onClick={openable ? open : undefined}
                onKeyDown={openable ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    open();
                  }
                } : undefined}
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "stretch",
                  justifyContent: "space-between",
                  minWidth: 0,
                  px: 1.25,
                  py: 0.875,
                  borderRadius: 2,
                  gap: 0.75,
                  cursor: openable ? "pointer" : "default",
                  background: isAreaView ? `${accent}08` : "transparent",
                  border: isAreaView ? `1px solid ${accent}22` : "1px solid transparent",
                  "&:hover": { bgcolor: isAreaView ? `${accent}10` : "#f8f8fa" },
                  "&:focus-visible": { outline: `2px solid ${accent}`, outlineOffset: 2 },
                }}
              >
                <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between" sx={{ minWidth: 0 }}>
                  {isAreaView ? (
                    <Typography fontSize={13} fontWeight={700} sx={{ minWidth: 0, color: accent }}>
                      {item.employee_name}
                    </Typography>
                  ) : (
                    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
                      <EmployeeAvatar name={item.employee_name} employeeId={item.employee_id} size={44} />
                      <Typography fontSize={13} fontWeight={500} sx={{ minWidth: 0, color: "text.primary" }} noWrap>
                        {item.employee_name}
                      </Typography>
                    </Stack>
                  )}
                  {isAreaView && (
                    <Box sx={{ px: 0.75, py: 0.2, borderRadius: 999, bgcolor: `${accent}18`, color: accent, fontSize: 10, fontWeight: 800, flexShrink: 0, whiteSpace: "nowrap" }}>
                      {areaPeopleCount(item)} pers.
                    </Box>
                  )}
                </Stack>
                <Stack direction="row" spacing={0.5} alignItems="flex-start" justifyContent="space-between" sx={{ minWidth: 0, gap: 1 }}>
                  {isAreaView && item.people?.length > 0 ? (
                    <Stack spacing={0.25} sx={{ minWidth: 0, flex: 1 }}>
                      {item.people.map((person, personIndex) => (
                        <Stack
                          key={`${person.employee_id}-${personIndex}`}
                          direction="row"
                          spacing={0.75}
                          alignItems="baseline"
                          justifyContent="space-between"
                          sx={{ minWidth: 0 }}
                        >
                          <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                            <Typography fontSize={11.5} sx={{ minWidth: 0, color: "text.primary", overflowWrap: "anywhere" }}>
                              {person.employee_name}
                            </Typography>
                            {person.role && (
                              <Box sx={{
                                alignSelf: "flex-start",
                                px: 0.55, py: 0.1, borderRadius: 1,
                                bgcolor: `${getRoleColor(person.role)}18`,
                                color: getRoleColor(person.role),
                                fontSize: 9.5, fontWeight: 700, whiteSpace: "nowrap",
                              }}>
                                {getRoleLabel(person.role)}
                              </Box>
                            )}
                          </Stack>
                          {person.time_range && (
                            <Box sx={{ px: 0.55, py: 0.1, borderRadius: 1, bgcolor: `${accent}14`, color: accent, fontSize: 10, fontWeight: 700, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", flexShrink: 0 }}>
                              {person.time_range}
                            </Box>
                          )}
                        </Stack>
                      ))}
                    </Stack>
                  ) : (
                  <Typography
                    fontSize={11}
                    color="text.secondary"
                    sx={{
                      textAlign: "left",
                      lineHeight: 1.45,
                      minWidth: 0,
                      flex: 1,
                      whiteSpace: isAreaView ? "normal" : "nowrap",
                      overflow: "hidden",
                      textOverflow: isAreaView ? "clip" : "ellipsis",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {item.info}
                  </Typography>
                  )}
                  {fmtAbsenceTime(item.start_time, item.end_time) && (
                    <Box sx={{ px: 0.6, py: 0.1, borderRadius: 1, bgcolor: "rgba(0,0,0,0.06)", fontSize: 10, fontWeight: 700, color: "text.secondary", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", flexShrink: 0 }}>
                      {fmtAbsenceTime(item.start_time, item.end_time)}
                    </Box>
                  )}
                </Stack>
              </Box>
              );
            })}
          </Box>
        )
      }
    </Paper>
  );
}

/**
 * Ricerca della presenza di oggi per un singolo dipendente.
 *
 * Non chiama il backend: incrocia i due elenchi che il box Organizzazione ha già
 * in pagina — assenti di oggi e assegnazioni Planner di oggi — così la risposta
 * è immediata e non può divergere dai contatori qui sopra. "Assente" segue la
 * stessa regola della card Assenti (giustificazione che copre oggi e non
 * rifiutata), quindi comprende anche le richieste ancora da approvare.
 */
function PresenceLookup({ employees, absentToday, presentToday, isLoading, expanded, onToggleExpanded }) {
  const [employeeId, setEmployeeId] = useState("");

  const options = useMemo(
    () => employees.map((employee) => ({ value: employee.id, label: employee.full_name })),
    [employees],
  );

  const selected = employees.find((employee) => employee.id === employeeId) ?? null;
  // filter e non find: più giustificazioni possono coprire lo stesso giorno
  // (per esempio due permessi orari).
  const absences = absentToday.filter((item) => item.employee_id === employeeId);
  const planned = presentToday.find((item) => item.employee_id === employeeId) ?? null;
  const isAbsent = absences.length > 0;
  const accent = isAbsent ? "#bc4749" : "#007040";
  // present_detail porta l'area del Planner, ma vale "—" quando l'assegnazione
  // non ne ha una: in quel caso si dice solo che è in Planner.
  const plannerInfo = planned
    ? (planned.info && planned.info !== "—" ? `In Planner oggi · ${planned.info}` : "In Planner oggi")
    : null;

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
        <Box sx={{ width: 3, height: 18, borderRadius: 2, bgcolor: "#0e6e8a", flexShrink: 0 }} />
        <Typography sx={{ fontSize: 12, fontWeight: 800, color: "#0e6e8a", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Verifica Presenza Oggi:
        </Typography>
        <Tooltip title={expanded ? "Comprimi" : "Espandi"}>
          <IconButton
            size="small"
            aria-label={expanded ? "Comprimi verifica presenza" : "Espandi verifica presenza"}
            aria-expanded={expanded}
            aria-controls="presence-lookup-panel"
            onClick={onToggleExpanded}
            sx={{
              width: 24,
              height: 24,
              color: "#0e6e8a",
              fontSize: 12,
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.2s",
            }}
          >
            ▾
          </IconButton>
        </Tooltip>
      </Box>
      <Collapse in={expanded} timeout="auto">
        <Paper id="presence-lookup-panel" elevation={0} sx={{ border: "1.5px solid rgba(226,226,229,0.9)", borderRadius: 2, px: 1.5, py: 1.25 }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ xs: "stretch", sm: "center" }}>
            <FilterSelect
              label="Cerca dipendente"
              placeholder="Nome e cognome"
              value={employeeId}
              onChange={setEmployeeId}
              options={options}
              disabled={isLoading || options.length === 0}
              sx={{ width: { xs: "100%", sm: 300 }, flexShrink: 0 }}
            />

            {!selected ? (
              <Typography fontSize={12.5} color="text.secondary">
                {isLoading ? "Caricamento dipendenti…" : "Cerca un dipendente per sapere se oggi è presente."}
              </Typography>
            ) : (
              <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
                <EmployeeAvatar name={selected.full_name} employeeId={selected.id} size={36} />
                <Box sx={{ minWidth: 0 }}>
                  <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                    <Typography fontSize={13} fontWeight={700} noWrap title={selected.full_name}>
                      {selected.full_name}
                    </Typography>
                    <Box sx={{ px: 0.75, py: 0.15, borderRadius: 999, bgcolor: `${accent}18`, color: accent, fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
                      {isAbsent ? "Assente" : "Presente"}
                    </Box>
                  </Stack>

                  {isAbsent ? (
                    <Stack spacing={0.15} sx={{ mt: 0.25 }}>
                      {absences.map((item, index) => {
                        const hours = fmtAbsenceTime(item.start_time, item.end_time);
                        return (
                          <Typography
                            key={`${item.employee_id}-${index}`}
                            fontSize={12}
                            color="text.secondary"
                            sx={{ fontVariantNumeric: "tabular-nums" }}
                          >
                            {absenceWindowLabel(item.info)}{hours ? ` · ${hours}` : ""}
                          </Typography>
                        );
                      })}
                    </Stack>
                  ) : (
                    <Typography fontSize={12} color="text.secondary" noWrap>
                      {plannerInfo ?? "Nessuna assenza registrata per oggi"}
                    </Typography>
                  )}
                </Box>
              </Stack>
            )}
          </Stack>
        </Paper>
      </Collapse>
    </Box>
  );
}

function ExpirationsPanel({ accent, days, onDaysChange, items, isLoading }) {
  const today = dayjs();
  const [nameFilter, setNameFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  const typeOptions = Array.from(
    new Set(items.map((i) => i.type_description).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  const nameNeedle = nameFilter.trim().toLowerCase();
  const filtered = items.filter((i) => {
    if (nameNeedle && !(i.employee_name || "").toLowerCase().includes(nameNeedle)) return false;
    if (typeFilter !== "all" && i.type_description !== typeFilter) return false;
    return true;
  });

  return (
    <Paper elevation={0} sx={{ border: `1.5px solid ${accent}33`, borderTop: `3px solid ${accent}`, overflow: "hidden" }}>
      <Box sx={{ px: 2, py: 1.25, borderBottom: "1px solid rgba(226,226,229,0.8)", bgcolor: `${accent}08`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
        <Box>
          <Typography fontWeight={700} fontSize={14} sx={{ color: accent }}>Scadenze dipendenti</Typography>
          <Typography fontSize={12} color="text.secondary">
            {isLoading
              ? "Caricamento..."
              : `${filtered.length} di ${items.length} scadenz${items.length === 1 ? "a" : "e"} nei prossimi ${days} giorn${days === 1 ? "o" : "i"}`}
          </Typography>
        </Box>
        <ToggleButtonGroup
          value={days}
          exclusive
          size="small"
          onChange={(_, val) => { if (val) onDaysChange(val); }}
          sx={{ flexWrap: "wrap", "& .MuiToggleButton-root": { fontSize: 11, py: 0.4, px: 1.25, fontWeight: 600, textTransform: "none", borderColor: `${accent}44`, color: "text.secondary", "&.Mui-selected": { bgcolor: `${accent}14`, color: accent, borderColor: `${accent}66` } } }}
        >
          <ToggleButton value={1}>1 giorno</ToggleButton>
          <ToggleButton value={7}>7 giorni</ToggleButton>
          <ToggleButton value={14}>14 giorni</ToggleButton>
          <ToggleButton value={30}>30 giorni</ToggleButton>
          <ToggleButton value={45}>45 giorni</ToggleButton>
          <ToggleButton value={60}>60 giorni</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Box sx={{ px: 2, py: 1.25, borderBottom: "1px solid rgba(226,226,229,0.8)", display: "flex", alignItems: "center", gap: 1.25, flexWrap: "wrap" }}>
        <InputBase
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
          placeholder="Filtra per nome…"
          startAdornment={
            <InputAdornment position="start" sx={{ color: "text.disabled" }}>
              <Box component="svg" viewBox="0 0 24 24" sx={{ width: 16, height: 16, fill: "currentColor" }}>
                <path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 10-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1114 9.5 4.5 4.5 0 019.5 14z" />
              </Box>
            </InputAdornment>
          }
          endAdornment={
            nameFilter ? (
              <InputAdornment position="end">
                <IconButton size="small" onClick={() => setNameFilter("")} sx={{ color: "text.disabled" }}>
                  <Box component="svg" viewBox="0 0 24 24" sx={{ width: 15, height: 15, fill: "currentColor" }}>
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                  </Box>
                </IconButton>
              </InputAdornment>
            ) : null
          }
          sx={{ flex: "1 1 220px", minWidth: 180, px: 1.25, py: 0.35, borderRadius: 1.5, border: "1px solid rgba(0,0,0,0.14)", fontSize: 13, bgcolor: "background.paper" }}
        />
        <Select
          value={typeOptions.includes(typeFilter) ? typeFilter : "all"}
          onChange={(e) => setTypeFilter(e.target.value)}
          size="small"
          displayEmpty
          sx={{ flex: "1 1 220px", minWidth: 180, fontSize: 13, bgcolor: "background.paper", "& .MuiSelect-select": { py: 0.75 } }}
        >
          <MenuItem value="all" sx={{ fontSize: 13 }}>Tutte le scadenze</MenuItem>
          {typeOptions.map((t) => (
            <MenuItem key={t} value={t} sx={{ fontSize: 13 }}>{t}</MenuItem>
          ))}
        </Select>
      </Box>

      {isLoading ? (
        <Box sx={{ px: 2, py: 1.5 }}><Typography color="text.secondary" fontSize={13}>Caricamento scadenze...</Typography></Box>
      ) : items.length === 0 ? (
        <Box sx={{ px: 2, py: 1.5 }}><Typography color="text.secondary" fontSize={13}>Nessuna scadenza nei prossimi {days} giorn{days === 1 ? "o" : "i"}.</Typography></Box>
      ) : filtered.length === 0 ? (
        <Box sx={{ px: 2, py: 1.5 }}><Typography color="text.secondary" fontSize={13}>Nessuna scadenza corrisponde ai filtri.</Typography></Box>
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(3, 1fr)" }, px: 0.75, py: 0.5, gap: 0.5 }}>
          {filtered.map((item, i) => {
            const remaining = item.days_remaining ?? dayjs(item.expiration_date).diff(today, "day");
            const urgent = remaining <= 7;
            const chipColor = urgent ? "#bc4749" : accent;
            return (
              <Box
                key={`${item.employee_id}-${item.type_description}-${item.expiration_date}-${i}`}
                sx={{
                  display: "flex", flexDirection: "column", alignItems: "stretch", minWidth: 0,
                  px: 1.25, py: 0.875, borderRadius: 2, gap: 0.5,
                  border: "1px solid transparent", "&:hover": { bgcolor: "#f8f8fa" },
                }}
              >
                <Stack direction="row" spacing={0.75} alignItems="center" justifyContent="space-between" sx={{ minWidth: 0 }}>
                  <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
                    <EmployeeAvatar name={item.employee_name} employeeId={item.employee_id} size={44} />
                    <Typography fontSize={13} fontWeight={500} sx={{ minWidth: 0, color: "text.primary" }} noWrap>
                      {item.employee_name}
                    </Typography>
                  </Stack>
                  <Box sx={{ px: 0.75, py: 0.2, borderRadius: 999, bgcolor: `${chipColor}18`, color: chipColor, fontSize: 10, fontWeight: 800, flexShrink: 0, whiteSpace: "nowrap" }}>
                    {remaining === 0 ? "oggi" : `${remaining}g`}
                  </Box>
                </Stack>
                <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="space-between" sx={{ minWidth: 0, gap: 1 }}>
                  <Typography fontSize={11} color="text.secondary" sx={{ minWidth: 0, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {item.type_description || "Scadenza"}
                    {item.document_number ? ` · ${item.document_number}` : ""}
                  </Typography>
                  <Box sx={{ px: 0.6, py: 0.1, borderRadius: 1, bgcolor: "rgba(0,0,0,0.06)", fontSize: 10, fontWeight: 700, color: "text.secondary", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", flexShrink: 0 }}>
                    {dayjs(item.expiration_date).format("DD/MM/YYYY")}
                  </Box>
                </Stack>
              </Box>
            );
          })}
        </Box>
      )}
    </Paper>
  );
}

function WeekAvatarDot({ name, employeeId, timeLabel, isPartial, isPast, ringColor = "#007040" }) {
  const color = stringToColor(name);
  const size = 36;
  const pad = 3;
  const outer = size + pad * 2;
  const r = outer / 2 - 2;

  const { data: photoUrl } = useQuery({
    queryKey: ["employee-photo", employeeId],
    queryFn: async () => {
      const blob = await getEmployeePhoto(employeeId);
      return URL.createObjectURL(blob);
    },
    enabled: Boolean(employeeId),
    staleTime: 15 * 60 * 1000,
    gcTime: 20 * 60 * 1000,
    retry: false,
  });

  return (
    <Tooltip
      title={timeLabel && timeLabel !== "Giornata intera" ? `${name} · ${timeLabel}` : name}
      arrow
      placement="top"
    >
      <Box sx={{ position: "relative", width: outer, height: outer, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, opacity: isPast ? 0.65 : 1 }}>
        <Box sx={{
          width: size, height: size, borderRadius: "50%",
          bgcolor: color,
          backgroundImage: photoUrl ? `url(${photoUrl})` : "none",
          backgroundSize: "cover",
          backgroundPosition: "center top",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#fff", fontSize: 13, fontWeight: 800,
          cursor: "default", border: "1.5px solid rgba(255,255,255,0.7)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.14)",
        }}>
          {!photoUrl && (name || "?").trim().charAt(0).toUpperCase()}
        </Box>
        <Box
          component="svg"
          viewBox={`0 0 ${outer} ${outer}`}
          sx={{ position: "absolute", top: 0, left: 0, width: outer, height: outer, pointerEvents: "none", overflow: "visible" }}
        >
          <circle
            cx={outer / 2}
            cy={outer / 2}
            r={r}
            fill="none"
            stroke={ringColor}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeDasharray={isPartial ? "5 4" : undefined}
          />
        </Box>
      </Box>
    </Tooltip>
  );
}

function WeekAbsences({ justifications, weekStart }) {
  const today = dayjs();
  const todayIso = today.format("YYYY-MM-DD");
  const days = Array.from({ length: 7 }, (_, i) => weekStart.add(i, "day"));
  const [popup, setPopup] = useState(null); // { day: dayjsObj, items: [] }

  return (
    <>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 0.75, height: "100%" }}>
        {days.map((day, i) => {
          const iso = day.format("YYYY-MM-DD");
          const isToday = day.isSame(today, "day");
          const isPast = iso < todayIso;
          const isWeekend = i >= 5;
          const items = justifications.filter((j) => overlapsDay(j, iso));
          const clickable = items.length > 0;
          return (
            <Box
              key={iso}
              onClick={() => clickable && setPopup({ day, items, isPast })}
              sx={{
                borderRadius: 1.5, border: "1px solid",
                borderColor: isToday ? "#0e6e8a" : "rgba(226,226,229,0.9)",
                bgcolor: isPast ? "#f7f7f7" : isWeekend ? "rgba(240,236,224,0.5)" : isToday ? "rgba(14,110,138,0.07)" : "#fff",
                p: 0.75, opacity: isPast ? 0.5 : 1, minHeight: 96,
                cursor: clickable ? "pointer" : "default",
                transition: "border-color 0.15s, background 0.15s",
                "&:hover": clickable ? { borderColor: isToday ? "#0e6e8a" : "rgba(14,110,138,0.35)", bgcolor: isToday ? "rgba(14,110,138,0.11)" : isPast ? "rgba(0,0,0,0.03)" : "rgba(14,110,138,0.04)" } : {},
              }}
            >
              <Typography sx={{ fontSize: 10, fontWeight: isToday ? 800 : 600, mb: 0.5, lineHeight: 1, color: isToday ? "#0e6e8a" : "text.secondary", textDecoration: isPast ? "line-through" : "none" }}>
                {WEEKDAYS[i]}<br />
                <span style={{ fontSize: 13, fontWeight: isToday ? 800 : 700 }}>{day.format("DD")}</span>
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.35, mt: 0.25 }}>
                {items.map((j) => {
                  const timeLabel = fmtAbsenceTime(j.start_time, j.end_time);
                  const isPartial = timeLabel !== null && timeLabel !== "Giornata intera";
                  const isRejected = j.approval_status === "rejected";
                  return (
                    <WeekAvatarDot
                      key={j.id}
                      name={j.employee_name}
                      employeeId={j.employee_id}
                      timeLabel={timeLabel}
                      isPartial={isPartial}
                      isPast={isPast}
                      ringColor={isRejected ? "#bc4749" : "#007040"}
                    />
                  );
                })}
                {items.length === 0 && <Typography sx={{ fontSize: 9, color: "text.disabled", lineHeight: 2 }}>—</Typography>}
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* day detail popup */}
      <Dialog open={Boolean(popup)} onClose={() => setPopup(null)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 2.5 } }}>
        <DialogTitle sx={{ pb: 0.5, pr: 6 }}>
          <Typography fontWeight={800} fontSize={15} sx={{ color: "#0e6e8a", textTransform: "capitalize" }}>
            {popup && `${WEEKDAYS_FULL[popup.day.isoWeekday() - 1]} ${popup.day.format("D")} ${MONTHS_IT[popup.day.month()]}`}
          </Typography>
          <Typography fontSize={12} color="text.secondary" sx={{ mt: 0.25 }}>
            {popup?.items.length} assenz{popup?.items.length === 1 ? "a" : "e"}
          </Typography>
        </DialogTitle>
        <IconButton onClick={() => setPopup(null)} size="small" sx={{ position: "absolute", top: 12, right: 12, color: "text.secondary" }}>
          <Box component="svg" viewBox="0 0 24 24" sx={{ width: 18, height: 18, fill: "currentColor" }}>
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </Box>
        </IconButton>
        <DialogContent sx={{ pt: 1, pb: 2 }}>
          <Stack spacing={0}>
            {popup?.items.map((j) => {
              const timeLabel = fmtAbsenceTime(j.start_time, j.end_time);
              const isPartial = timeLabel !== null && timeLabel !== "Giornata intera";
              const todayStr = dayjs().format("YYYY-MM-DD");
              const isActive = j.start_date <= todayStr && j.end_date >= todayStr;
              const isPastItem = j.end_date < todayStr;
              const dateStr = j.start_date === j.end_date
                ? dayjs(j.start_date).format("DD/MM/YYYY")
                : `${dayjs(j.start_date).format("DD/MM")} – ${dayjs(j.end_date).format("DD/MM/YYYY")}`;
              return (
                <Box key={j.id} sx={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: 1.5, px: 1, py: 0.875, borderRadius: 1.5,
                  opacity: isPastItem ? 0.5 : 1,
                  "&:not(:last-child)": { borderBottom: "1px solid rgba(226,226,229,0.6)" },
                }}>
                  <Stack spacing={0} sx={{ minWidth: 0 }}>
                    <Typography fontSize={13} fontWeight={700} noWrap>{j.employee_name}</Typography>
                    <Typography fontSize={11} color="text.secondary">{dateStr}</Typography>
                  </Stack>
                  <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
                    {isPartial && (
                      <Box sx={{ px: 0.75, py: 0.2, borderRadius: 1, bgcolor: "rgba(0,0,0,0.06)", fontSize: 11, fontWeight: 700, color: "text.secondary", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                        {timeLabel}
                      </Box>
                    )}
                    <StatusBadge status={j.approval_status} />
                  </Stack>
                </Box>
              );
            })}
          </Stack>
        </DialogContent>
      </Dialog>
    </>
  );
}

function MonthAbsences({ justifications }) {
  const todayIso = dayjs().format("YYYY-MM-DD");
  const [filter, setFilter] = useState("future");
  const [empSearch, setEmpSearch] = useState("");

  const filtered = (justifications ?? []).filter((j) => {
    const matchTime = filter === "past" ? j.end_date < todayIso
      : filter === "future" ? j.end_date >= todayIso
      : true;
    const matchEmp = !empSearch.trim()
      || j.employee_name.toLowerCase().includes(empSearch.trim().toLowerCase());
    return matchTime && matchEmp;
  });

  const emptyLabel = filter === "past" ? "Nessuna assenza passata questo mese."
    : filter === "future" ? "Nessuna assenza futura questo mese."
    : "Nessuna assenza programmata per questo mese.";

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 1.5, py: 0.875, borderBottom: "1px solid rgba(217,119,6,0.14)", gap: 1, flexWrap: "wrap" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography fontSize={12} color="text.secondary">
            {filtered.length} assenz{filtered.length === 1 ? "a" : "e"}
          </Typography>
          <InputBase
            value={empSearch}
            onChange={(e) => setEmpSearch(e.target.value)}
            placeholder="Filtra dipendente…"
            size="small"
            startAdornment={
              <InputAdornment position="start">
                <Box component="svg" viewBox="0 0 24 24" sx={{ width: 13, height: 13, fill: "rgba(0,0,0,0.35)", flexShrink: 0 }}>
                  <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                </Box>
              </InputAdornment>
            }
            endAdornment={empSearch ? (
              <InputAdornment position="end">
                <Box
                  onClick={() => setEmpSearch("")}
                  sx={{ cursor: "pointer", display: "flex", alignItems: "center", color: "rgba(0,0,0,0.35)", "&:hover": { color: "rgba(0,0,0,0.6)" } }}
                >
                  <Box component="svg" viewBox="0 0 24 24" sx={{ width: 13, height: 13, fill: "currentColor" }}>
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                  </Box>
                </Box>
              </InputAdornment>
            ) : null}
            sx={{
              fontSize: 11, height: 26, px: 0.75,
              border: "1px solid rgba(217,119,6,0.28)", borderRadius: 1,
              bgcolor: "rgba(255,255,255,0.7)",
              "& input": { py: 0, px: 0.25 },
              "&.Mui-focused": { borderColor: "rgba(217,119,6,0.6)", bgcolor: "#fff" },
            }}
          />
        </Box>
        <ToggleButtonGroup
          value={filter}
          exclusive
          size="small"
          onChange={(_, val) => { if (val) setFilter(val); }}
          sx={{
            "& .MuiToggleButton-root": {
              fontSize: 11, py: 0.3, px: 1.25, fontWeight: 600, textTransform: "none",
              borderColor: "rgba(217,119,6,0.28)", color: "text.secondary",
              "&.Mui-selected": { bgcolor: "rgba(217,119,6,0.13)", color: "#b45309", borderColor: "rgba(217,119,6,0.45)" },
            },
          }}
        >
          <ToggleButton value="future">Future</ToggleButton>
          <ToggleButton value="all">Tutte</ToggleButton>
          <ToggleButton value="past">Passate</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {filtered.length === 0 ? (
        <Typography color="text.secondary" fontSize={13} sx={{ px: 1.5, py: 1.5 }}>{emptyLabel}</Typography>
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, 1fr)" } }}>
          {filtered.map((j) => {
            const isPast = j.end_date < todayIso;
            const isActive = j.start_date <= todayIso && j.end_date >= todayIso;
            const isRejected = j.approval_status === "rejected";
            const timeLabel = fmtAbsenceTime(j.start_time, j.end_time);
            const isPartial = timeLabel !== null && timeLabel !== "Giornata intera";
            return (
              <Box key={j.id} sx={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                px: 1.25, py: 0.5, gap: 1, borderRadius: 1.5,
                opacity: isPast ? 0.45 : 1,
                bgcolor: isActive ? "rgba(0,112,64,0.04)" : "transparent",
                "&:hover": { bgcolor: isPast ? "transparent" : "#f8f8fa" },
              }}>
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
                  <AbsenceBorderRing size={44} isPartial={isPartial} color={isRejected ? "#bc4749" : "#007040"}>
                    <EmployeeAvatar name={j.employee_name} employeeId={j.employee_id} size={44} />
                  </AbsenceBorderRing>
                  <Typography fontSize={12} fontWeight={isPast ? 400 : 600} noWrap sx={{ color: isPast ? "text.secondary" : "text.primary", textDecoration: isPast ? "line-through" : "none" }}>
                    {j.employee_name}
                  </Typography>
                  {isActive && !isRejected && <Box sx={{ px: 0.6, borderRadius: 1, bgcolor: "#00ff40", color: "#000000", fontSize: 9, fontWeight: 800, flexShrink: 0 }}>IN CORSO</Box>}
                </Stack>
                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
                  <Typography fontSize={11} color="text.secondary" sx={{ textDecoration: isPast ? "line-through" : "none" }}>
                    {j.start_date === j.end_date ? dayjs(j.start_date).format("DD/MM") : `${dayjs(j.start_date).format("DD/MM")} – ${dayjs(j.end_date).format("DD/MM")}`}
                  </Typography>
                  {timeLabel && (
                    <Box sx={{ px: 0.6, py: 0.1, borderRadius: 1, bgcolor: "rgba(0,0,0,0.06)", fontSize: 10, fontWeight: 700, color: "text.secondary", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      {timeLabel}
                    </Box>
                  )}
                  {!isPast && <StatusBadge status={j.approval_status} />}
                </Stack>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

// ─── approver row ─────────────────────────────────────────────────────────────

function ApproverRequestRow({ item, onApprove, onReject, isPending, isLoading }) {
  const todayIso = dayjs().format("YYYY-MM-DD");
  const isPast = item.end_date < todayIso;
  return (
    <Box sx={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 1.5, px: 1.25, py: 0.75, borderRadius: 1.5,
      bgcolor: isPast ? "transparent" : "rgba(217,119,6,0.04)",
      "&:hover": { bgcolor: isPast ? "transparent" : "rgba(217,119,6,0.07)" },
      opacity: isPast ? 0.55 : 1,
    }}>
      <Stack sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 600 }} noWrap>{item.employee_name}</Typography>
        {isPending && item.created_by_name && item.created_by_name !== item.employee_name && (
          <Typography sx={{ fontSize: 11, color: "text.secondary" }} noWrap>
            richiesta da {item.created_by_name}
          </Typography>
        )}
        {!isPending && item.decided_by_name && (
          <Typography sx={{ fontSize: 11, color: "text.secondary" }} noWrap>
            {item.approval_status === "rejected" ? "rifiutata" : "approvata"} da {item.decided_by_name}
          </Typography>
        )}
      </Stack>
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexShrink: 0 }}>
        <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
          {(() => {
            const timeLabel = fmtAbsenceTime(item.start_time, item.end_time);
            const isPartialHours = timeLabel && timeLabel !== "Giornata intera";
            if (isPartialHours) return `${dayjs(item.start_date).format("DD/MM")} · ${timeLabel}`;
            if (item.start_date === item.end_date) return dayjs(item.start_date).format("DD/MM");
            return `${dayjs(item.start_date).format("DD/MM")} – ${dayjs(item.end_date).format("DD/MM")}`;
          })()}
        </Typography>
        {isPending && (
          <>
            <Tooltip title="Approva">
              <Button
                size="small"
                disabled={isLoading}
                onClick={() => onApprove(item.justification_id)}
                sx={{ minWidth: 0, px: 1, py: 0.25, fontSize: 11, fontWeight: 700, color: "#4f772d", bgcolor: "rgba(79,119,45,0.1)", "&:hover": { bgcolor: "rgba(79,119,45,0.2)" }, borderRadius: 1 }}
              >
                Approva
              </Button>
            </Tooltip>
            <Tooltip title="Rifiuta">
              <Button
                size="small"
                disabled={isLoading}
                onClick={() => onReject(item.justification_id)}
                sx={{ minWidth: 0, px: 1, py: 0.25, fontSize: 11, fontWeight: 700, color: "#bc4749", bgcolor: "rgba(188,71,73,0.08)", "&:hover": { bgcolor: "rgba(188,71,73,0.16)" }, borderRadius: 1 }}
              >
                Rifiuta
              </Button>
            </Tooltip>
          </>
        )}
        {!isPending && <StatusBadge status={item.approval_status} />}
      </Stack>
    </Box>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user: authenticatedUser, effectiveUser: user } = useAuth();
  const today = dayjs();
  const todayStr = today.format("YYYY-MM-DD");
  const dashboardPreferenceOwner = authenticatedUser?.username
    ?? authenticatedUser?.linked_employee_id
    ?? "anonymous";
  const dashboardPanelPreferencesKey = `${DASHBOARD_PANEL_PREFERENCES_PREFIX}:${dashboardPreferenceOwner}`;
  const initialPanelPreferences = getDashboardPanelPreferences(dashboardPanelPreferencesKey);
  const [activeOrgCard, setActiveOrgCard] = useState(null);
  const [expirationDays, setExpirationDays] = useState(30);
  const [companyExpanded, setCompanyExpanded] = useState(false);
  const [presenceLookupExpanded, setPresenceLookupExpanded] = useState(initialPanelPreferences.presenceExpanded);
  const [weekAbsencesExpanded, setWeekAbsencesExpanded] = useState(initialPanelPreferences.weekExpanded);
  const [monthAbsencesExpanded, setMonthAbsencesExpanded] = useState(initialPanelPreferences.monthExpanded);
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const viewWeekStart = today.startOf("isoWeek").add(weekOffset, "week");
  const viewWeekEnd = viewWeekStart.endOf("isoWeek");
  const viewWeekStartStr = viewWeekStart.format("YYYY-MM-DD");
  const viewWeekEndStr = viewWeekEnd.format("YYYY-MM-DD");
  const viewMonth = today.add(monthOffset, "month").startOf("month");
  const viewMonthStart = viewMonth.format("YYYY-MM-DD");
  const viewMonthEnd = viewMonth.endOf("month").format("YYYY-MM-DD");

  useEffect(() => {
    const preferences = getDashboardPanelPreferences(dashboardPanelPreferencesKey);
    setPresenceLookupExpanded(preferences.presenceExpanded);
    setWeekAbsencesExpanded(preferences.weekExpanded);
    setMonthAbsencesExpanded(preferences.monthExpanded);
  }, [dashboardPanelPreferencesKey]);

  const hasGlobalPlannerHomeAccess = user?.planner_access_level === "all_read"
    || user?.planner_access_level === "all_write";
  const hasAdminHomeAccess = user?.effective_role === "admin"
    || user?.effective_role === "hr"
    || hasGlobalPlannerHomeAccess;
  const isManagerOrAbove = hasAdminHomeAccess || user?.effective_role === "manager";
  const queryClient = useQueryClient();

  const orgQuery = useQuery({
    queryKey: ["dashboard", todayStr],
    queryFn: () => getDashboard(todayStr),
    enabled: hasAdminHomeAccess,
  });

  const birthdaysQuery = useQuery({
    queryKey: ["dashboard-birthdays", 7],
    queryFn: () => getDashboardBirthdays(7),
    staleTime: 30 * 60 * 1000,
  });

  const meQuery = useQuery({
    queryKey: ["dashboard-me", user?.linked_employee_id, todayStr],
    queryFn: () => getDashboardMe(user.linked_employee_id, todayStr),
    enabled: Boolean(user?.linked_employee_id),
  });

  const weekQuery = useQuery({
    queryKey: ["justifications-week", viewWeekStartStr, viewWeekEndStr],
    queryFn: () => getJustifications(viewWeekStartStr, viewWeekEndStr),
    enabled: hasAdminHomeAccess,
  });

  const monthQuery = useQuery({
    queryKey: ["justifications-month", viewMonthStart, viewMonthEnd],
    queryFn: () => getJustifications(viewMonthStart, viewMonthEnd),
    enabled: hasAdminHomeAccess,
  });

  const canAccessExpirations = Boolean(user?.can_access_expirations);
  // Caricata sempre (non solo quando il box è aperto) così il numero del box riflette il
  // range selezionato; default 30 giorni. Alimenta sia il box sia il pannello di dettaglio.
  const expirationsQuery = useQuery({
    queryKey: ["dashboard-expirations", expirationDays],
    queryFn: () => getDashboardExpirations(expirationDays),
    enabled: canAccessExpirations,
    staleTime: 5 * 60 * 1000,
  });

  const approverQuery = useQuery({
    queryKey: ["dashboard-approver", user?.linked_employee_id],
    queryFn: () => getDashboardApprover(user.linked_employee_id),
    enabled: Boolean(user?.linked_employee_id) && isManagerOrAbove,
  });

  // Stessa queryKey delle altre pagine: l'elenco viaggia una volta sola e resta
  // condiviso nella cache di react-query.
  const employeeOptionsQuery = useQuery({
    queryKey: ["employee-options"],
    queryFn: () => getEmployeeOptions(),
    enabled: hasAdminHomeAccess,
    staleTime: 30 * 60 * 1000,
  });

  const approverMutation = useMutation({
    mutationFn: ({ justificationId, status }) =>
      updateJustificationApproval(justificationId, { approval_status: status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard-approver", user?.linked_employee_id] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", todayStr] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const approverPending = approverQuery.data?.pending_requests ?? [];

  function toggleOrg(key) {
    setActiveOrgCard((prev) => (prev === key ? null : key));
  }

  const activeOrgConfig = ORG_CARDS.find((c) => c.key === activeOrgCard);
  const orgData = orgQuery.data;
  const firstName = user?.linked_employee_name ?? user?.username ?? "";
  const navigate = useNavigate();

  return (
    <Stack spacing={2.5}>

      {/* ── header ── */}
      <PageHeader
        section="Home"
        title={firstName ? `Ciao, ${firstName}` : "Panoramica operativa"}
        meta={`${today.format("DD/MM/YYYY")}${orgData?.total_active_employees != null ? ` · ${orgData.total_active_employees} dipendenti attivi` : ""}`}
      />

      {(birthdaysQuery.data?.items?.length ?? 0) > 0 && (
        <SectionShell
          tone="amber"
          title="Compleanni imminenti"
          subtitle="Oggi e nei prossimi 7 giorni"
          bodySx={{ px: 2, py: 1.5 }}
        >
          <Stack direction="row" spacing={1.25} useFlexGap flexWrap="wrap">
            {birthdaysQuery.data.items.map((item) => (
              <Paper
                key={item.employee_id}
                elevation={0}
                sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.25, py: 0.9, border: "1px solid rgba(217,119,6,0.2)", borderRadius: 2, bgcolor: "rgba(255,251,235,0.72)" }}
              >
                <EmployeeAvatar name={item.employee_name} employeeId={item.employee_id} size={32} />
                <Box>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 750 }}>{item.employee_name}</Typography>
                  <Typography sx={{ fontSize: 11, color: "#b45309", fontWeight: 650 }}>
                    🎂 {item.days_remaining === 0
                      ? "Oggi"
                      : `${dayjs(item.next_birthday).format("D MMMM")} · tra ${item.days_remaining} giorn${item.days_remaining === 1 ? "o" : "i"}`}
                  </Typography>
                </Box>
              </Paper>
            ))}
          </Stack>
        </SectionShell>
      )}

      {/* ── organizzazione — visibile solo per admin e hr ── */}
      {hasAdminHomeAccess && (
      <SectionShell tone="teal" title="Organizzazione" subtitle="Vista sintetica di presenze, assenze e distribuzione attiva" bodySx={{ p: 2 }}>
        <Stack spacing={2.5}>
          {/* metric cards + dipendenti attivi */}
          <Grid2 container spacing={1.5} sx={{ alignItems: "stretch" }}>
            <Grid2 size={{ xs: 12, sm: 6, md: 3 }}>
              <Paper elevation={0} sx={{ px: 2, py: 1.5, border: "1.5px solid #00704033", borderTop: "3px solid #007040", background: "linear-gradient(180deg, rgba(0,112,64,0.07), rgba(255,255,255,0.98))", height: "100%", boxSizing: "border-box" }}>
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  onClick={() => setCompanyExpanded((v) => !v)}
                  sx={{ cursor: "pointer", userSelect: "none", borderRadius: 1, mx: -0.5, px: 0.5, py: 0.25, "&:hover": { bgcolor: "rgba(0,112,64,0.06)" }, transition: "background 0.15s" }}
                >
                  <Typography sx={{ fontSize: 13, fontWeight: 600, color: "#007040" }}>Dipendenti attivi</Typography>
                  <Stack direction="row" alignItems="center" gap={0.75}>
                    <Typography sx={{ fontSize: 22, fontWeight: 800, lineHeight: 1, color: "#007040" }}>{orgData?.total_active_employees ?? "—"}</Typography>
                    <Box sx={{ fontSize: 11, color: "#007040", lineHeight: 1, transform: companyExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>▾</Box>
                  </Stack>
                </Stack>
                {orgData?.active_by_company && Object.keys(orgData.active_by_company).length > 0 && (
                  <Collapse in={companyExpanded}>
                    <Stack spacing={0.35} sx={{ mt: 1, pt: 1, borderTop: "1px solid rgba(226,226,229,0.8)" }}>
                      {Object.entries(orgData.active_by_company).map(([company, count]) => (
                        <Box key={company} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
                          <Typography sx={{ fontSize: 11, color: "text.secondary", flexShrink: 1, minWidth: 0 }} noWrap title={company}>{company}</Typography>
                          <Chip
                            label={count}
                            size="small"
                            clickable
                            onClick={(e) => { e.stopPropagation(); navigate(`/dipendenti?company=${encodeURIComponent(company)}`); }}
                            sx={{ fontSize: 10, height: 18, fontWeight: 700, background: "#00704014", color: "#007040", flexShrink: 0, cursor: "pointer" }}
                          />
                        </Box>
                      ))}
                    </Stack>
                  </Collapse>
                )}
              </Paper>
            </Grid2>
            {ORG_CARDS.map((card) => {
              const needsMyApproval = card.key === "pending" && approverPending.length > 0;
              return (
                <Grid2 key={card.key} size={{ xs: 12, sm: 6, md: 3 }}>
                  <OrgMetricCard
                    title={card.title}
                    value={orgData?.[card.dataKey] ?? 0}
                    accent={card.accent}
                    onClick={() => toggleOrg(card.key)}
                    active={activeOrgCard === card.key}
                    showBell={needsMyApproval}
                    pulse={needsMyApproval}
                  />
                </Grid2>
              );
            })}
            {canAccessExpirations && (
              <Grid2 size={{ xs: 12, sm: 6, md: 3 }}>
                <OrgMetricCard
                  title="Scadenze"
                  value={expirationsQuery.data?.count ?? (expirationsQuery.isLoading ? "…" : 0)}
                  accent="#bc4749"
                  onClick={() => toggleOrg("expirations")}
                  active={activeOrgCard === "expirations"}
                />
              </Grid2>
            )}
          </Grid2>

          {/* detail panel */}
          {activeOrgConfig && orgData && (
            <Stack spacing={1.5}>
              {activeOrgConfig.key === "pending" && approverPending.length > 0 && (
                <Paper elevation={0} sx={{ border: "1.5px solid #d9770633", borderTop: "3px solid #d97706", overflow: "hidden" }}>
                  <Box sx={{ px: 2, py: 1.25, borderBottom: "1px solid rgba(226,226,229,0.8)", bgcolor: "#d9770608", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <Box>
                      <Typography fontWeight={700} fontSize={14} sx={{ color: "#d97706" }}>In attesa di approvazione</Typography>
                      <Typography fontSize={12} color="text.secondary">{approverPending.length} element{approverPending.length === 1 ? "o" : "i"} da gestire</Typography>
                    </Box>
                  </Box>
                  <Stack spacing={0} sx={{ px: 0.75, py: 0.5 }}>
                    {approverPending.map((item) => (
                      <ApproverRequestRow
                        key={item.justification_id}
                        item={item}
                        isPending
                        isLoading={approverMutation.isPending}
                        onApprove={(id) => approverMutation.mutate({ justificationId: id, status: "approved" })}
                        onReject={(id) => approverMutation.mutate({ justificationId: id, status: "rejected" })}
                      />
                    ))}
                  </Stack>
                </Paper>
              )}
              <OrgDetailPanel
                title={activeOrgConfig.detailTitle}
                accent={activeOrgConfig.accent}
                items={orgData[activeOrgConfig.detailKey] ?? []}
                // Il link porta su Assenze › Richieste: si offre solo a chi quella
                // pagina può aprirla davvero, altrimenti la route lo rimanda alla home.
                onOpenJustification={user?.can_access_calendar
                  ? (justificationId) => navigate(`/calendario?tab=richieste&richiesta=${justificationId}`)
                  : undefined}
                altItems={activeOrgConfig.key === "present" ? (orgData.present_by_area ?? []) : undefined}
                altTitle="In Planner oggi · per area operativa"
              />
            </Stack>
          )}

          {/* dettaglio scadenze */}
          {activeOrgCard === "expirations" && canAccessExpirations && (
            <ExpirationsPanel
              accent="#bc4749"
              days={expirationDays}
              onDaysChange={setExpirationDays}
              items={expirationsQuery.data?.items ?? []}
              isLoading={expirationsQuery.isLoading || expirationsQuery.isFetching}
            />
          )}

          {/* ricerca presenza del singolo dipendente */}
          <PresenceLookup
            employees={employeeOptionsQuery.data ?? []}
            absentToday={orgData?.absent_today_detail ?? []}
            presentToday={orgData?.present_detail ?? []}
            isLoading={employeeOptionsQuery.isLoading || orgQuery.isLoading}
            expanded={presenceLookupExpanded}
            onToggleExpanded={() => {
              const nextExpanded = !presenceLookupExpanded;
              setPresenceLookupExpanded(nextExpanded);
              saveDashboardPanelPreference(dashboardPanelPreferencesKey, "presenceExpanded", nextExpanded);
            }}
          />

          <Divider />

          {/* settimana */}
          <Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Box sx={{ width: 3, height: 18, borderRadius: 2, bgcolor: "#0e6e8a", flexShrink: 0 }} />
                <Typography sx={{ fontSize: 12, fontWeight: 800, color: "#0e6e8a", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Assenze {weekOffset === 0 ? "questa settimana" : "settimana"}
                </Typography>
                <Tooltip title={weekAbsencesExpanded ? "Comprimi" : "Espandi"}>
                  <IconButton
                    size="small"
                    aria-label={weekAbsencesExpanded ? "Comprimi assenze della settimana" : "Espandi assenze della settimana"}
                    aria-expanded={weekAbsencesExpanded}
                    aria-controls="week-absences-panel"
                    onClick={() => {
                      const nextExpanded = !weekAbsencesExpanded;
                      setWeekAbsencesExpanded(nextExpanded);
                      saveDashboardPanelPreference(dashboardPanelPreferencesKey, "weekExpanded", nextExpanded);
                    }}
                    sx={{
                      width: 24,
                      height: 24,
                      color: "#0e6e8a",
                      fontSize: 12,
                      transform: weekAbsencesExpanded ? "rotate(180deg)" : "rotate(0deg)",
                      transition: "transform 0.2s",
                    }}
                  >
                    ▾
                  </IconButton>
                </Tooltip>
              </Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <Box
                  onClick={() => setWeekOffset((o) => o - 1)}
                  sx={{ width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 1, cursor: "pointer", color: "#0e6e8a", fontSize: 14, fontWeight: 700, "&:hover": { bgcolor: "rgba(14,110,138,0.10)" }, userSelect: "none" }}
                >‹</Box>
                <Typography sx={{ fontSize: 11, color: weekOffset === 0 ? "#0e6e8a" : "text.secondary", fontWeight: weekOffset === 0 ? 700 : 400, minWidth: 90, textAlign: "center" }}>
                  {viewWeekStart.format("DD/MM")} – {viewWeekEnd.format("DD/MM")}
                </Typography>
                <Box
                  onClick={() => setWeekOffset((o) => o + 1)}
                  sx={{ width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 1, cursor: "pointer", color: "#0e6e8a", fontSize: 14, fontWeight: 700, "&:hover": { bgcolor: "rgba(14,110,138,0.10)" }, userSelect: "none" }}
                >›</Box>
              </Box>
            </Box>
            <Collapse in={weekAbsencesExpanded} timeout="auto">
              <Paper id="week-absences-panel" elevation={0} sx={{ p: 1.25, border: "1px solid rgba(14,110,138,0.14)", borderRadius: 2, bgcolor: "rgba(224,242,254,0.35)" }}>
                {weekQuery.isLoading
                  ? <Typography color="text.secondary" fontSize={13}>Caricamento...</Typography>
                  : <WeekAbsences justifications={weekQuery.data ?? []} weekStart={viewWeekStart} />
                }
              </Paper>
            </Collapse>
          </Box>

          <Divider />

          {/* mese */}
          <Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5, gap: 1, flexWrap: "wrap" }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Box sx={{ width: 3, height: 18, borderRadius: 2, bgcolor: "#d97706", flexShrink: 0 }} />
                <Typography sx={{ fontSize: 12, fontWeight: 800, color: "#d97706", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Assenze del mese
                </Typography>
                <Tooltip title={monthAbsencesExpanded ? "Comprimi" : "Espandi"}>
                  <IconButton
                    size="small"
                    aria-label={monthAbsencesExpanded ? "Comprimi assenze del mese" : "Espandi assenze del mese"}
                    aria-expanded={monthAbsencesExpanded}
                    aria-controls="month-absences-panel"
                    onClick={() => {
                      const nextExpanded = !monthAbsencesExpanded;
                      setMonthAbsencesExpanded(nextExpanded);
                      saveDashboardPanelPreference(dashboardPanelPreferencesKey, "monthExpanded", nextExpanded);
                    }}
                    sx={{
                      width: 24,
                      height: 24,
                      color: "#d97706",
                      fontSize: 12,
                      transform: monthAbsencesExpanded ? "rotate(180deg)" : "rotate(0deg)",
                      transition: "transform 0.2s",
                    }}
                  >
                    ▾
                  </IconButton>
                </Tooltip>
              </Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <Box
                  onClick={() => setMonthOffset((o) => o - 1)}
                  sx={{ width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 1, cursor: "pointer", color: "#d97706", fontSize: 14, fontWeight: 700, "&:hover": { bgcolor: "rgba(217,119,6,0.10)" }, userSelect: "none" }}
                >‹</Box>
                <Typography
                  onClick={() => setMonthOffset(0)}
                  sx={{ fontSize: 11, color: monthOffset === 0 ? "#d97706" : "text.secondary", fontWeight: monthOffset === 0 ? 700 : 400, minWidth: 100, textAlign: "center", cursor: "pointer", "&:hover": { color: "#d97706" } }}
                >
                  {MONTHS_IT[viewMonth.month()]} {viewMonth.year()}
                </Typography>
                <Box
                  onClick={() => setMonthOffset((o) => o + 1)}
                  sx={{ width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 1, cursor: "pointer", color: "#d97706", fontSize: 14, fontWeight: 700, "&:hover": { bgcolor: "rgba(217,119,6,0.10)" }, userSelect: "none" }}
                >›</Box>
              </Box>
            </Box>
            <Collapse in={monthAbsencesExpanded} timeout="auto">
              <Paper id="month-absences-panel" elevation={0} sx={{ border: "1px solid rgba(217,119,6,0.14)", borderRadius: 2, bgcolor: "rgba(252,247,240,0.5)", overflow: "hidden" }}>
                {monthQuery.isLoading
                  ? <Typography color="text.secondary" fontSize={13} sx={{ px: 1.5, py: 1 }}>Caricamento...</Typography>
                  : <MonthAbsences justifications={monthQuery.data ?? []} />
                }
              </Paper>
            </Collapse>
          </Box>
        </Stack>
      </SectionShell>
      )}

      {/* Scadenze con ambito dedicato per chi non ha la panoramica globale. */}
      {!hasAdminHomeAccess && canAccessExpirations && (
        <SectionShell
          tone="red"
          title="Scadenze"
          subtitle={user?.expirations_scope === "reports"
            ? "Documenti e abilitazioni dei riporti diretti e indiretti"
            : "Documenti e abilitazioni dei dipendenti"}
          bodySx={{ p: 2 }}
        >
          <ExpirationsPanel
            accent="#bc4749"
            days={expirationDays}
            onDaysChange={setExpirationDays}
            items={expirationsQuery.data?.items ?? []}
            isLoading={expirationsQuery.isLoading || expirationsQuery.isFetching}
          />
        </SectionShell>
      )}

      {/* ── personale + team ── */}
      <Grid2 container spacing={2} sx={{ alignItems: "stretch" }}>

        {/* personale */}
        <Grid2 size={{ xs: 12, md: 5 }}>
          <SectionShell
            tone="green"
            title="Le mie info"
            subtitle="Pianificazione personale e assenze in corso o future"
            action={user?.linked_employee_name ? (
              <Typography sx={{ fontSize: 11, color: "text.disabled" }}>{user.linked_employee_name}</Typography>
            ) : null}
            bodySx={{ p: 2.5, height: "100%", boxSizing: "border-box" }}
          >
            {!user?.linked_employee_id
              ? <EmptyState label="Profilo non collegato a un dipendente" />
              : <PersonalSection meData={meQuery.data} isLoading={meQuery.isLoading} />
            }
          </SectionShell>
        </Grid2>

        {/* team — visibile solo per manager e superiori */}
        {isManagerOrAbove && (
          <Grid2 size={{ xs: 12, md: 7 }}>
            <SectionShell
              tone="olive"
              title="Il mio team"
              subtitle="Copertura giornaliera e persone assenti tra i riporti diretti"
              action={meQuery.data?.team_size > 0 ? (
                <Typography sx={{ fontSize: 11, color: "text.disabled" }}>{meQuery.data.team_size} riporti diretti</Typography>
              ) : null}
              bodySx={{ p: 2.5, height: "100%", boxSizing: "border-box" }}
            >
              {!user?.linked_employee_id
                ? <EmptyState label="Profilo non collegato a un dipendente" />
                : (
                  <Stack spacing={2}>
                    {approverPending.length > 0 && (
                      <Box>
                        <SectionTitle accent="#d97706">In attesa di approvazione</SectionTitle>
                        <Stack spacing={0}>
                          {approverPending.map((item) => (
                            <ApproverRequestRow
                              key={item.justification_id}
                              item={item}
                              isPending
                              isLoading={approverMutation.isPending}
                              onApprove={(id) => approverMutation.mutate({ justificationId: id, status: "approved" })}
                              onReject={(id) => approverMutation.mutate({ justificationId: id, status: "rejected" })}
                            />
                          ))}
                        </Stack>
                        <Divider sx={{ mt: 2 }} />
                      </Box>
                    )}
                    <TeamSection meData={meQuery.data} isLoading={meQuery.isLoading} />
                  </Stack>
                )
              }
            </SectionShell>
          </Grid2>
        )}
      </Grid2>

    </Stack>
  );
}
