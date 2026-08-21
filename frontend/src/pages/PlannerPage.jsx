import dayjs from "dayjs";

import FilterSelect from "../components/FilterSelect";
import PageHeader from "../components/PageHeader";
import "dayjs/locale/it";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppTheme } from "../ThemeContext";
import { useAuth } from "../auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Link,
  ListItemText,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";

import {
  createAssignment,
  deleteAssignment,
  getAssignments,
  getEmployeePhoto,
  getGesapPrenotazioni,
  getPlannerEmployees,
  getJustifications,
  getOperationalAreas,
  getPlannerDayAudit,
  getTeamDailyNotes,
  getTeams,
  getTrainingCourses,
  importGesapBookingToWorkload,
  syncGesapWorkloads,
  updateAssignment,
  upsertTeamDailyNote,
} from "../api";
import { plannerBuildingCodes } from "../buildings";
import lexendFontUrl from "../assets/fonts/Lexend-VariableFont_wght.ttf";
import logoTonoli from "../upload/logoTonoli.png";
import { buildCopySourceTeams, notesForCopiedAssignment } from "./plannerCopy";
import {
  WORKLOAD_NO_WAREHOUSE_KEY,
  groupWorkloadRowsByArea,
  isCancelledGesapBooking,
  workloadCustomerLabel,
  workloadSupplierLabel,
} from "./workloadRows";
import "./PlannerPage.css";

dayjs.locale("it");

// ── constants ──────────────────────────────────────────────────────────────
const HOUR_START = 5;
const HOUR_END = 22;
const HOUR_WIDTH = 64; // px per ora
const HOURS = HOUR_END - HOUR_START; // 17
const TRACK_WIDTH = HOURS * HOUR_WIDTH; // 1088 px
const LANE_H = 38; // px per lane nella vista Area
// Offset del contenuto del blocco rispetto al suo bordo sinistro — deve restare
// in sync con PlannerPage.css: serve per ancorare il segmento "Pausa" alla griglia oraria.
const BLOCK_BODY_INSET = 9.5; // 1.5px bordo .planner-block + 8px .planner-handle-left
const AREA_BLOCK_BODY_INSET = 7.5; // 1.5px bordo + 6px padding .planner-area-block-body

// Ricerca dipendente: confronto senza accenti/maiuscole, così "Rossi" trova "ROSSÌ".
function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// Ogni parola digitata deve comparire nel nome (in qualsiasi ordine):
// "mario ros" trova "ROSSI MARIO".
function employeeMatchesSearch(employee, searchTokens) {
  if (searchTokens.length === 0) return true;
  const name = normalizeSearchText(employee.full_name);
  return searchTokens.every((token) => name.includes(token));
}

const ROLE_OPTIONS = [
  { value: "MAGAZZINIERE", label: "Magazziniere" },
  { value: "AUTISTA", label: "Autista" },
  { value: "IMPIEGATO", label: "Impiegato" },
  { value: "OFFICINA", label: "Officina" },
  { value: "PULIZIE", label: "Pulizie" },
  { value: "ALTRO", label: "Altro" },
  { value: "", label: "Tutti i ruoli" },
];

const AREA_PALETTE = [
  { bg: "rgba(7,162,173,0.18)", border: "#07a2ad", text: "#004f55" },
  { bg: "rgba(124,58,237,0.15)", border: "#7c3aed", text: "#4c1d95" },
  { bg: "rgba(245,158,11,0.18)", border: "#d97706", text: "#78350f" },
  { bg: "rgba(16,185,129,0.16)", border: "#059669", text: "#064e3b" },
  { bg: "rgba(239,68,68,0.14)", border: "#dc2626", text: "#7f1d1d" },
  { bg: "rgba(59,130,246,0.16)", border: "#2563eb", text: "#1e3a5f" },
  { bg: "rgba(236,72,153,0.14)", border: "#db2777", text: "#831843" },
  { bg: "rgba(251,146,60,0.18)", border: "#ea580c", text: "#7c2d12" },
];

const AREA_PALETTE_DARK = [
  { bg: "rgba(7,162,173,0.22)", border: "#0dbcc9", text: "#5de8f0" },
  { bg: "rgba(124,58,237,0.22)", border: "#9c66ff", text: "#c4aaff" },
  { bg: "rgba(245,158,11,0.22)", border: "#f0a020", text: "#f5c870" },
  { bg: "rgba(16,185,129,0.20)", border: "#20c070", text: "#60e0a0" },
  { bg: "rgba(239,68,68,0.20)", border: "#f05050", text: "#ff9090" },
  { bg: "rgba(59,130,246,0.20)", border: "#4080ff", text: "#90b8ff" },
  { bg: "rgba(236,72,153,0.20)", border: "#e050a0", text: "#ff90cc" },
  { bg: "rgba(251,146,60,0.22)", border: "#f07020", text: "#ffa060" },
];

const NO_TEAM_KEY = "__no_team__";

// Etichetta della sezione che raccoglie, dentro un'area divisa per immobili,
// le allocazioni rimaste senza immobile.
const NO_BUILDING_KEY = "SENZA IMMOBILE";

// Perimetro di default del riepilogo: tutti i dipendenti, nessun filtro attivo.
const DEFAULT_REPORT_SCOPE = {
  allEmployees: true,
  byTeam: false,
  teamIds: [],
  byRole: false,
  roles: [],
  byArea: false,
  areaNames: [],
  byImmobile: false,
  immobili: [],
};

// ── helpers ────────────────────────────────────────────────────────────────
function normalizeAreaKey(area) { return String(area ?? "").trim().toUpperCase(); }
function getImmobileOptions(area, areasData) {
  const key = normalizeAreaKey(area);
  const found = (areasData ?? []).find((a) => normalizeAreaKey(a.name) === key || normalizeAreaKey(a.area_code) === key);
  // Solo gli immobili con visible_in_planner: quelli nascosti non compaiono
  // nel Planner, che per loro mostra soltanto l'area.
  return plannerBuildingCodes(found?.buildings);
}
function normalizeImmobile(area, immobile, areasData) {
  const allowed = getImmobileOptions(area, areasData);
  const normalized = String(immobile ?? "").trim().toUpperCase();
  if (allowed.length === 0) return null;
  return allowed.includes(normalized) ? normalized : null;
}
function formatAssignmentAreaLabel(area, immobile) {
  if (!area && !immobile) return "–";
  if (!immobile) return area || "–";
  return `${area} · ${immobile}`;
}
// Colore dedicato per gli slot di formazione (viola), distinto dalle aree operative.
const TRAINING_COLOR = { bg: "#ede7f6", border: "#7e57c2", text: "#4527a0" };
function formatAssignmentPrimaryLabel(a, immobile) {
  if (a.cause === "FORMAZIONE") {
    return a.training_course_title ? `🎓 ${a.training_course_title}` : "🎓 Formazione";
  }
  return formatAssignmentAreaLabel(a.area, immobile);
}
function renderAssignmentTooltip(a, startH, endH, breakSegment = null) {
  return (
    <Box sx={{ py: 0.25 }}>
      <Typography sx={{ fontSize: 11, fontWeight: 700 }}>
        {formatAssignmentPrimaryLabel(a, a.immobile)}
      </Typography>
      <Typography sx={{ fontSize: 10.5, opacity: 0.8 }}>
        {formatHour(startH)}–{formatHour(endH)}
      </Typography>
      {breakSegment && (
        <Typography sx={{ fontSize: 10.5, opacity: 0.8 }}>
          Pausa {breakSegment.startLabel}–{breakSegment.endLabel}
        </Typography>
      )}
      {a.notes && (
        <Typography sx={{ fontSize: 10.5, mt: 0.5, maxWidth: 260, whiteSpace: 'pre-wrap' }}>
          {a.notes}
        </Typography>
      )}
      {a.workload && (
        <Typography sx={{ fontSize: 10.5, mt: 0.5, maxWidth: 260, whiteSpace: "pre-wrap", fontWeight: 600 }}>
          Carico di lavoro: {a.workload}
        </Typography>
      )}
      {a.last_modified_by_name && a.updated_at && (
        <Typography sx={{ fontSize: 10, mt: 0.75, pt: 0.6, borderTop: "1px solid rgba(255,255,255,0.25)", opacity: 0.82 }}>
          Ultima modifica di {a.last_modified_by_name} il {dayjs(a.updated_at).format("DD/MM/YYYY [alle] HH:mm")}
        </Typography>
      )}
    </Box>
  );
}
function hourOffset(h) { return (h - HOUR_START) * HOUR_WIDTH; }
function pxToHourRaw(px) { return HOUR_START + px / HOUR_WIDTH; }
function snapToHalf(h) { return Math.round(h * 2) / 2; }
function pxToHour(px) { return Math.max(HOUR_START, Math.min(HOUR_END, snapToHalf(pxToHourRaw(px)))); }
function timeToHour(t) { return timeToHourRaw(t); }
function hourToTime(h) { const hrs = Math.floor(h); const mins = Math.round((h % 1) * 60); return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}`; }
function pad2(n) { return String(n).padStart(2, "0"); }
function formatHour(h) { return hourToTime(h); }
function timeToHourRaw(t) {
  const s = String(t);
  return parseInt(s.slice(0, 2), 10) + parseInt(s.slice(3, 5), 10) / 60;
}
function decimalHourToTime(value) {
  const totalMinutes = Math.round(value * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
function isFullDayRange(startTime, endTime) {
  const start = String(startTime ?? "").slice(0, 5);
  const end = String(endTime ?? "").slice(0, 5);
  return start === "05:00" && end === "22:00";
}
function formatTimeRange(startTime, endTime) {
  const start = String(startTime ?? "").slice(0, 5);
  const end = String(endTime ?? "").slice(0, 5);
  return `${start}-${end}`;
}
function isRangeMatch(startTime, endTime, expectedStart, expectedEnd) {
  const start = String(startTime ?? "").slice(0, 5);
  const end = String(endTime ?? "").slice(0, 5);
  return start === expectedStart && end === expectedEnd;
}
function isDaysModeJustification(justification) {
  if (justification.start_date && justification.end_date && justification.start_date !== justification.end_date) {
    return true;
  }
  if (
    isRangeMatch(justification.start_time, justification.end_time, "08:00", "17:00")
  ) {
    return true;
  }
  return isFullDayRange(justification.start_time, justification.end_time);
}
function getAbsenceDisplayLabel(justification) {
  if (isDaysModeJustification(justification)) return "Giornata intera";
  return formatTimeRange(justification.start_time, justification.end_time);
}
// Nome + fascia oraria per il riepilogo: la stessa persona puo' comparire su
// piu' immobili nella stessa giornata, l'orario e' cio' che li distingue.
function getAllocationDisplayLabel(allocation) {
  return allocation.timeRange ? `${allocation.name} (${allocation.timeRange})` : allocation.name;
}
function compareAllocations(a, b) {
  return a.name.localeCompare(b.name) || String(a.startTime ?? "").localeCompare(String(b.startTime ?? ""));
}
function getScheduleBreakSegment(day) {
  if (!day?.enabled || !day.start || !day.end) return null;

  const explicitBreakStart = typeof day.break_start === "string" ? day.break_start.slice(0, 5) : null;
  const explicitBreakEnd = typeof day.break_end === "string" ? day.break_end.slice(0, 5) : null;

  if (explicitBreakStart && explicitBreakEnd) {
    const startHour = timeToHourRaw(explicitBreakStart);
    const endHour = timeToHourRaw(explicitBreakEnd);
    if (Number.isFinite(startHour) && Number.isFinite(endHour) && endHour > startHour) {
      return {
        startHour,
        endHour,
        startLabel: explicitBreakStart,
        endLabel: explicitBreakEnd,
      };
    }
  }

  const breakMinutes = Number(day.break_minutes ?? 0);
  if (breakMinutes <= 0) return null;

  const shiftStart = timeToHourRaw(day.start);
  const shiftEnd = timeToHourRaw(day.end);
  const breakHours = breakMinutes / 60;
  const netHours = shiftEnd - shiftStart - breakHours;
  if (!Number.isFinite(netHours) || netHours <= 0) return null;

  const breakStartHour = shiftStart + netHours / 2;
  const breakEndHour = breakStartHour + breakHours;
  return {
    startHour: breakStartHour,
    endHour: breakEndHour,
    startLabel: decimalHourToTime(breakStartHour),
    endLabel: decimalHourToTime(breakEndHour),
  };
}

function normalizeBreakHours(startHour, endHour, breakStartHour, breakEndHour) {
  if (!Number.isFinite(breakStartHour) || !Number.isFinite(breakEndHour)) {
    return { break_start: null, break_end: null };
  }
  if (breakEndHour - breakStartHour < 0.5) {
    return { break_start: null, break_end: null };
  }
  if (!(startHour < breakStartHour && breakStartHour < breakEndHour && breakEndHour < endHour)) {
    return { break_start: null, break_end: null };
  }
  return {
    break_start: hourToTime(breakStartHour),
    break_end: hourToTime(breakEndHour),
  };
}

/** Assign time-based lanes to assignments (for area view stacking). */
function computeLanes(assignments) {
  const sorted = [...assignments].sort((a, b) => timeToHour(a.start_time) - timeToHour(b.start_time));
  const laneEnds = [];
  const withLanes = sorted.map((a) => {
    const sh = timeToHour(a.start_time);
    const eh = timeToHour(a.end_time);
    let lane = laneEnds.findIndex((end) => end <= sh);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(eh); }
    else laneEnds[lane] = eh;
    return { ...a, lane };
  });
  return { assignments: withLanes, numLanes: Math.max(laneEnds.length, 1) };
}

// ── EmployeeAvatar ─────────────────────────────────────────────────────────
function EmployeeAvatar({ employee, size = 36 }) {
  const { data: photoUrl } = useQuery({
    queryKey: ["employee-photo", employee.id],
    queryFn: async () => {
      const blob = await getEmployeePhoto(employee.id);
      return URL.createObjectURL(blob);
    },
    enabled: Boolean(employee.has_photo),
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
  });

  const initials = employee.full_name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join("");

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        className="planner-avatar"
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
      />
    );
  }
  return (
    <Box
      className="planner-avatar-initials"
      style={{ width: size, height: size, fontSize: size < 28 ? 9 : 12 }}
    >
      {initials}
    </Box>
  );
}

// ── component ──────────────────────────────────────────────────────────────
export default function PlannerPage() {
  const { effectiveUser } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedDate, setSelectedDate] = useState(dayjs().format("YYYY-MM-DD"));
  const [roleFilter, setRoleFilter] = useState("MAGAZZINIERE");
  const [teamFilter, setTeamFilter] = useState([]); // vuoto = tutte le squadre
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [plannerView, setPlannerView] = useState("employees"); // "employees" | "areas"
  const [collapsedTeams, setCollapsedTeams] = useState({});
  const [prenotazioniCollapsed, setPrenotazioniCollapsed] = useState(false);
  const [prenotazioniClientFilter, setPrenotazioniClientFilter] = useState("");
  const [prenotazioniImportFilter, setPrenotazioniImportFilter] = useState("all"); // "all" | "imported" | "pending"
  const [gesapImportItem, setGesapImportItem] = useState(null);
  const [gesapImportTeamId, setGesapImportTeamId] = useState("");
  const [areaPickerState, setAreaPickerState] = useState(null);
  const [editingBlock, setEditingBlock] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [absenceBlockMsg, setAbsenceBlockMsg] = useState(null);
  const absenceBlockTimerRef = useRef(null);
  const [copyFromOpen, setCopyFromOpen] = useState(false);
  const [copyFromDate, setCopyFromDate] = useState("");
  const [copyFromTeamIds, setCopyFromTeamIds] = useState(null); // null = tutte le squadre
  const [copyFromNoteIds, setCopyFromNoteIds] = useState(new Set());
  const [expandedCopyTeams, setExpandedCopyTeams] = useState(new Set());
  const [generateSnackbar, setGenerateSnackbar] = useState(null);
  const [clearDayOpen, setClearDayOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportScope, setReportScope] = useState(DEFAULT_REPORT_SCOPE);
  const [reportGrouping, setReportGrouping] = useState("team"); // "team" | "building"
  const [teamWorkloadEdit, setTeamWorkloadEdit] = useState(null);
  const [sortMode, setSortMode] = useState("team"); // "alpha" | "team"
  const { darkMode } = useAppTheme();

  // ref so copyFromMutation always sees current justifications
  const justificationsRef = useRef(null);

  const [nameColWidth, setNameColWidth] = useState(210);

  const handleNameColResizeStart = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = nameColWidth;
    const onMove = (ev) => setNameColWidth(Math.max(120, Math.min(480, startW + ev.clientX - startX)));
    const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [nameColWidth]);

  // drag (ref avoids stale closures; tick forces re-render)
  const dragRef = useRef(null);
  const suppressClickRef = useRef(null);
  const [, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick((n) => n + 1), []);

  // local overrides for immediate visual feedback
  const [localOverrides, setLocalOverrides] = useState({});
  const [timelineScrollLeft, setTimelineScrollLeft] = useState(0);

  const trackRefs = useRef({});
  const plannerAccessLevel = effectiveUser?.planner_access_level ?? null;
  const canWritePlanning = plannerAccessLevel === "team_write" || plannerAccessLevel === "all_write";
  // Formazione: gli HR inseriscono SOLO formazione, gli altri planner SOLO presenza,
  // gli admin possono scegliere (vedono entrambi i tipi).
  const isAdmin = effectiveUser?.effective_role === "admin";
  const isHrTrainer = effectiveUser?.effective_role === "hr";
  const canUseTraining = isAdmin || isHrTrainer;

  // ── queries ──────────────────────────────────────────────────────────────
  const employeesQuery = useQuery({
    queryKey: ["employees", "planner", roleFilter],
    queryFn: () => getPlannerEmployees("", roleFilter ? [roleFilter] : []),
    staleTime: 30000,
  });

  const allEmployeesQuery = useQuery({
    queryKey: ["employees", "planner", "all"],
    queryFn: () => getPlannerEmployees("", []),
    staleTime: 30000,
  });

  const assignmentsQuery = useQuery({
    queryKey: ["assignments", selectedDate],
    queryFn: () => getAssignments(selectedDate, selectedDate),
  });

  const plannerDayAuditQuery = useQuery({
    queryKey: ["planner-day-audit", selectedDate],
    queryFn: () => getPlannerDayAudit(selectedDate),
  });

  const justificationsQuery = useQuery({
    queryKey: ["justifications", "planner", selectedDate],
    queryFn: () => getJustifications(selectedDate, selectedDate),
  });

  // Allocazioni del giorno di origine, per costruire l'elenco squadre nel dialog "Copia da"
  const copySourceQuery = useQuery({
    queryKey: ["assignments", "copy-source", copyFromDate],
    queryFn: () => getAssignments(copyFromDate, copyFromDate),
    enabled: copyFromOpen && Boolean(copyFromDate),
  });

  // corsi di formazione attivi (solo HR può inserirli)
  const trainingCoursesQuery = useQuery({
    queryKey: ["training-courses", "active"],
    queryFn: () => getTrainingCourses({ activeOnly: true }),
    enabled: canUseTraining,
    staleTime: 60000,
  });

  // operational areas only (for picker + area view)
  const areasQuery = useQuery({
    queryKey: ["operational-areas", "planner"],
    queryFn: () => getOperationalAreas({ activeOnly: true, operationalOnly: true }),
    staleTime: Infinity,
  });

  const teamsQuery = useQuery({
    queryKey: ["teams"],
    queryFn: getTeams,
    staleTime: 30000,
  });

  const teamDailyNotesQuery = useQuery({
    queryKey: ["team-daily-notes", selectedDate],
    queryFn: () => getTeamDailyNotes(selectedDate),
    staleTime: 30000,
  });

  const prenotazioniQuery = useQuery({
    queryKey: ["prenotazioni-gesap", selectedDate, effectiveUser?.can_access_workloads ? "sync" : "read"],
    queryFn: () => effectiveUser?.can_access_workloads
      ? syncGesapWorkloads(selectedDate)
      : getGesapPrenotazioni(selectedDate),
    staleTime: effectiveUser?.can_access_workloads ? 0 : 60000,
    refetchOnMount: effectiveUser?.can_access_workloads ? "always" : true,
    retry: 1,
  });

  const prenotazioniItems = useMemo(() => prenotazioniQuery.data?.items ?? [], [prenotazioniQuery.data]);

  const prenotazioniClientOptions = useMemo(() => {
    const names = new Set(
      prenotazioniItems.map((item) => (item.cliente?.nome ?? "").trim()).filter(Boolean),
    );
    return [...names].sort((a, b) => a.localeCompare(b, "it"));
  }, [prenotazioniItems]);

  // `workload_imported` arriva solo dalla sincronizzazione dei carichi: senza quel
  // permesso il dato non c'è e il filtro importate/non importate non ha senso.
  const canFilterPrenotazioniImport = !!effectiveUser?.can_access_workloads;

  const prenotazioniFiltered = useMemo(() => prenotazioniItems.filter((item) => {
    if (prenotazioniClientFilter && (item.cliente?.nome ?? "").trim() !== prenotazioniClientFilter) return false;
    if (!canFilterPrenotazioniImport) return true;
    if (prenotazioniImportFilter === "imported" && !item.workload_imported) return false;
    if (prenotazioniImportFilter === "pending" && item.workload_imported) return false;
    return true;
  }), [prenotazioniItems, prenotazioniClientFilter, prenotazioniImportFilter, canFilterPrenotazioniImport]);

  // Cambiando giorno il cliente selezionato può non essere più in elenco:
  // senza questo reset il pannello resterebbe vuoto senza motivo apparente.
  useEffect(() => {
    if (prenotazioniClientFilter && !prenotazioniClientOptions.includes(prenotazioniClientFilter)) {
      setPrenotazioniClientFilter("");
    }
  }, [prenotazioniClientOptions, prenotazioniClientFilter]);

  // keep ref in sync so mutations can access latest justification list
  justificationsRef.current = justificationsQuery.data ?? [];

  const handleTimelineScroll = useCallback((event) => {
    setTimelineScrollLeft(event.currentTarget.scrollLeft);
  }, []);

  // ── mutations ────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: createAssignment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      queryClient.invalidateQueries({ queryKey: ["planner-day-audit"] });
      setAreaPickerState(null);
    },
    onError: () => setAreaPickerState(null),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => updateAssignment(id, payload),
    onSuccess: (_, { id }) => {
      setLocalOverrides((o) => { const n = { ...o }; delete n[id]; return n; });
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      queryClient.invalidateQueries({ queryKey: ["planner-day-audit"] });
    },
    onError: (_, { id }) => {
      setLocalOverrides((o) => { const n = { ...o }; delete n[id]; return n; });
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
    },
  });

  const upsertTeamDailyNoteMutation = useMutation({
    mutationFn: ({ teamId, workload }) => upsertTeamDailyNote(teamId, selectedDate, workload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-daily-notes"] });
      setTeamWorkloadEdit(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAssignment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      queryClient.invalidateQueries({ queryKey: ["planner-day-audit"] });
      setEditingBlock(null);
    },
  });

  const importGesapMutation = useMutation({
    mutationFn: () => importGesapBookingToWorkload({
      team_id: gesapImportTeamId,
      work_date: selectedDate,
      booking_id: String(gesapImportItem?.id ?? ""),
    }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["prenotazioni-gesap"] });
      queryClient.invalidateQueries({ queryKey: ["workload-teams"] });
      setGesapImportItem(null);
      setGesapImportTeamId("");
      navigate(`/carichi?date=${result.work_date}&teamId=${result.team_id}`);
    },
  });

  const clearDayMutation = useMutation({
    mutationFn: async () => {
      const assignments = assignmentsQuery.data ?? [];
      for (const assignment of assignments) {
        await deleteAssignment(assignment.id);
      }
      return assignments.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      queryClient.invalidateQueries({ queryKey: ["planner-day-audit"] });
      setClearDayOpen(false);
      setEditingBlock(null);
      setGenerateSnackbar(
        count === 1
          ? `Eliminata 1 allocazione del ${dayjs(selectedDate).format("D MMMM YYYY")}`
          : `Eliminate ${count} allocazioni del ${dayjs(selectedDate).format("D MMMM YYYY")}`
      );
    },
  });

  const copyFromMutation = useMutation({
    mutationFn: async ({ sourceDate, teamIds, noteIds }) => {
      const sourceAssignments = await getAssignments(sourceDate, sourceDate);
      // employees absent on the TARGET day — use current ref value
      const absentIds = new Set((justificationsRef.current).map((j) => j.employee_id));
      // teamIds === null → tutte le squadre; altrimenti solo le squadre selezionate
      const results = [];
      for (const a of sourceAssignments) {
        if (absentIds.has(a.employee_id)) continue; // skip absent employees
        if (teamIds) {
          const teamKey = employeeTeamMap[a.employee_id]?.id ?? NO_TEAM_KEY;
          if (!teamIds.has(teamKey)) continue; // squadra non selezionata
        }
        try {
          const created = await createAssignment({
            employee_id: a.employee_id,
            work_date: selectedDate,
            start_time: typeof a.start_time === "string" ? a.start_time.slice(0, 5) : a.start_time,
            end_time: typeof a.end_time === "string" ? a.end_time.slice(0, 5) : a.end_time,
            break_start: a.break_start ? String(a.break_start).slice(0, 5) : null,
            break_end: a.break_end ? String(a.break_end).slice(0, 5) : null,
            area: a.area,
            immobile: a.immobile,
            cause: a.cause,
            notes: notesForCopiedAssignment(a, noteIds),
            copy_source_date: sourceDate,
          });
          results.push(created);
        } catch {
          // skip overlapping
        }
      }
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      queryClient.invalidateQueries({ queryKey: ["planner-day-audit"] });
      setCopyFromOpen(false);
      setCopyFromDate("");
      setCopyFromTeamIds(null);
      setCopyFromNoteIds(new Set());
      setExpandedCopyTeams(new Set());
    },
  });

  // ── drag callbacks via refs ──────────────────────────────────────────────
  const onMoveRef = useRef(null);
  const onUpRef = useRef(null);

  onMoveRef.current = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const px = e.clientX - drag.trackLeft;

    if (drag.type === "resize-end") {
      drag.endHour = Math.max(drag.startHour + 0.5, Math.min(HOUR_END, snapToHalf(pxToHourRaw(px))));
    } else if (drag.type === "resize-start") {
      drag.startHour = Math.max(HOUR_START, Math.min(drag.endHour - 0.5, snapToHalf(pxToHourRaw(px))));
    } else if (drag.type === "move") {
      const dur = drag.origEnd - drag.origStart;
      const newStart = Math.max(HOUR_START, Math.min(HOUR_END - dur, snapToHalf(pxToHourRaw(px - drag.offsetPx))));
      drag.startHour = newStart;
      drag.endHour = newStart + dur;
      if (Number.isFinite(drag.origBreakStart) && Number.isFinite(drag.origBreakEnd)) {
        const delta = newStart - drag.origStart;
        drag.breakStartHour = drag.origBreakStart + delta;
        drag.breakEndHour = drag.origBreakEnd + delta;
      }
    } else if (drag.type === "break-move") {
      const breakDur = drag.origBreakEnd - drag.origBreakStart;
      const nextBreakStart = Math.max(
        drag.startHour + 0.5,
        Math.min(drag.endHour - breakDur - 0.5, snapToHalf(pxToHourRaw(px - drag.offsetPx))),
      );
      drag.breakStartHour = nextBreakStart;
      drag.breakEndHour = nextBreakStart + breakDur;
    } else if (drag.type === "break-resize-start") {
      drag.breakStartHour = Math.max(
        drag.startHour + 0.5,
        Math.min(drag.breakEndHour - 0.5, snapToHalf(pxToHourRaw(px))),
      );
    } else if (drag.type === "break-resize-end") {
      drag.breakEndHour = Math.max(
        drag.breakStartHour + 0.5,
        Math.min(drag.endHour - 0.5, snapToHalf(pxToHourRaw(px))),
      );
    } else if (drag.type === "create") {
      drag.endHour = Math.max(drag.startHour + 0.5, Math.min(HOUR_END, snapToHalf(pxToHourRaw(px))));
    }
    forceUpdate();
  };

  onUpRef.current = () => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.type === "create") {
      if (drag.endHour > drag.startHour) {
        setAreaPickerState({ employeeId: drag.employeeId, startHour: drag.startHour, endHour: drag.endHour, area: "", immobile: "", notes: "", mode: isHrTrainer ? "formazione" : "presenza", trainingCourseId: "" });
      }
    } else if (drag.assignmentId) {
      const moved = drag.startHour !== drag.origStart || drag.endHour !== drag.origEnd;
      const breakMoved = drag.breakStartHour !== drag.origBreakStart || drag.breakEndHour !== drag.origBreakEnd;
      if (moved) {
        suppressClickRef.current = drag.assignmentId;
        const newStart = hourToTime(drag.startHour);
        const newEnd = hourToTime(drag.endHour);
        const nextBreak = drag.breakWasVisible
          ? normalizeBreakHours(drag.startHour, drag.endHour, drag.breakStartHour, drag.breakEndHour)
          : {};
        setLocalOverrides((o) => ({ ...o, [drag.assignmentId]: { start_time: newStart, end_time: newEnd, ...nextBreak } }));
        updateMutation.mutate({ id: drag.assignmentId, payload: { start_time: newStart, end_time: newEnd, ...nextBreak } });
      } else if (breakMoved) {
        suppressClickRef.current = drag.assignmentId;
        const nextBreak = normalizeBreakHours(drag.startHour, drag.endHour, drag.breakStartHour, drag.breakEndHour);
        setLocalOverrides((o) => ({ ...o, [drag.assignmentId]: { ...nextBreak } }));
        updateMutation.mutate({ id: drag.assignmentId, payload: nextBreak });
      }
    }
    dragRef.current = null;
    forceUpdate();
  };

  useEffect(() => {
    const onMove = (e) => onMoveRef.current?.(e);
    const onUp = () => onUpRef.current?.();
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
  }, []);

  // ── drag starters ─────────────────────────────────────────────────────────
  function startBlockDrag(e, type, assignment) {
    if (!canWritePlanning) return;
    e.stopPropagation();
    e.preventDefault();
    const trackEl = trackRefs.current[assignment.employee_id];
    if (!trackEl) return;
    const rect = trackEl.getBoundingClientRect();
    const startH = timeToHour(assignment.start_time);
    const endH = timeToHour(assignment.end_time);
    const clickPx = e.clientX - rect.left;
    const breakSegment = getBreakSegmentForAssignment(assignment.employee_id, assignment);
    dragRef.current = {
      type,
      employeeId: assignment.employee_id,
      assignmentId: assignment.id,
      startHour: startH,
      endHour: endH,
      origStart: startH,
      origEnd: endH,
      breakStartHour: breakSegment?.startHour ?? null,
      breakEndHour: breakSegment?.endHour ?? null,
      origBreakStart: breakSegment?.startHour ?? null,
      origBreakEnd: breakSegment?.endHour ?? null,
      breakWasVisible: Boolean(breakSegment),
      offsetPx: type === "move" ? clickPx - hourOffset(startH) : 0,
      trackLeft: rect.left,
    };
    forceUpdate();
  }

  function startBreakDrag(e, type, assignment) {
    if (!canWritePlanning) return;
    e.stopPropagation();
    e.preventDefault();
    const trackEl = trackRefs.current[assignment.employee_id];
    if (!trackEl) return;
    const breakSegment = getBreakSegmentForAssignment(assignment.employee_id, assignment);
    if (!breakSegment) return;
    const rect = trackEl.getBoundingClientRect();
    const clickPx = e.clientX - rect.left;
    const startH = timeToHour(assignment.start_time);
    const endH = timeToHour(assignment.end_time);
    dragRef.current = {
      type,
      employeeId: assignment.employee_id,
      assignmentId: assignment.id,
      startHour: startH,
      endHour: endH,
      origStart: startH,
      origEnd: endH,
      breakStartHour: breakSegment.startHour,
      breakEndHour: breakSegment.endHour,
      origBreakStart: breakSegment.startHour,
      origBreakEnd: breakSegment.endHour,
      breakWasVisible: true,
      offsetPx: type === "break-move" ? clickPx - hourOffset(breakSegment.startHour) : 0,
      trackLeft: rect.left,
    };
    forceUpdate();
  }

  function startCreateDrag(e, employeeId) {
    if (!canWritePlanning) return;
    if (e.target.closest(".planner-block") || e.target.closest(".planner-absence")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickHourRaw = pxToHourRaw(e.clientX - rect.left);
    const absences = justificationsByEmployee[employeeId] ?? [];
    const hit = absences.find((j) => {
      const sh = timeToHourRaw(j.start_time);
      const eh = timeToHourRaw(j.end_time);
      return clickHourRaw >= sh && clickHourRaw < eh;
    });
    if (hit) {
      e.preventDefault();
      const emp = (employeesQuery.data ?? []).find((x) => x.id === employeeId);
      setAbsenceBlockMsg(`${emp?.full_name ?? "Dipendente"} è in assenza in questo orario – impossibile aggiungere attività.`);
      clearTimeout(absenceBlockTimerRef.current);
      absenceBlockTimerRef.current = setTimeout(() => setAbsenceBlockMsg(null), 4500);
      return;
    }
    e.preventDefault();
    const startH = pxToHour(e.clientX - rect.left);
    dragRef.current = {
      type: "create",
      employeeId,
      assignmentId: null,
      startHour: startH,
      endHour: Math.min(HOUR_END, startH + 1),
      trackLeft: rect.left,
    };
    forceUpdate();
  }

  // ── derived data ──────────────────────────────────────────────────────────
  const areaColorMap = useMemo(() => {
    const palette = darkMode ? AREA_PALETTE_DARK : AREA_PALETTE;
    const map = {};
    (areasQuery.data ?? []).forEach((area, i) => {
      map[area.name] = palette[i % palette.length];
    });
    return map;
  }, [areasQuery.data, darkMode]);

  const assignmentsByEmployee = useMemo(() => {
    const map = {};
    for (const a of assignmentsQuery.data ?? []) {
      if (!map[a.employee_id]) map[a.employee_id] = [];
      const override = localOverrides[a.id];
      map[a.employee_id].push(override ? { ...a, ...override } : a);
    }
    return map;
  }, [assignmentsQuery.data, localOverrides]);

  const assignmentsByArea = useMemo(() => {
    const map = {};
    for (const a of assignmentsQuery.data ?? []) {
      const key = a.area ?? "—";
      if (!map[key]) map[key] = [];
      map[key].push(a);
    }
    return map;
  }, [assignmentsQuery.data]);

  const teamWorkloadByTeamId = useMemo(() => {
    const map = {};
    for (const note of teamDailyNotesQuery.data ?? []) {
      if (note.workload) map[note.team_id] = note.workload;
    }
    return map;
  }, [teamDailyNotesQuery.data]);

  const teamWorkloadRowsByTeamId = useMemo(() => {
    const map = {};
    for (const note of teamDailyNotesQuery.data ?? []) {
      const rows = note.rows ?? note.table_rows ?? [];
      if (rows.length) map[note.team_id] = rows;
    }
    return map;
  }, [teamDailyNotesQuery.data]);

  const teamWorkloadOwnerByTeamId = useMemo(() => {
    const map = {};
    for (const note of teamDailyNotesQuery.data ?? []) {
      if (note.owner_employee_name) map[note.team_id] = note.owner_employee_name;
    }
    return map;
  }, [teamDailyNotesQuery.data]);

  const justificationsByEmployee = useMemo(() => {
    const map = {};
    for (const j of justificationsQuery.data ?? []) {
      if (!map[j.employee_id]) map[j.employee_id] = [];
      map[j.employee_id].push(j);
    }
    return map;
  }, [justificationsQuery.data]);

  const employeeTeamMap = useMemo(() => {
    const map = {};
    for (const team of teamsQuery.data ?? []) {
      for (const m of team.members) {
        map[m.employee_id] = team;
      }
    }
    return map;
  }, [teamsQuery.data]);

  const copyEmployeeNameMap = useMemo(() => {
    const map = {};
    for (const employee of allEmployeesQuery.data ?? []) {
      map[employee.id] = employee.full_name;
    }
    return map;
  }, [allEmployeesQuery.data]);

  // ── Copia da: squadre presenti nel giorno di origine ─────────────────────
  const copySourceTeams = useMemo(
    () => buildCopySourceTeams(copySourceQuery.data, employeeTeamMap, copyEmployeeNameMap),
    [copySourceQuery.data, employeeTeamMap, copyEmployeeNameMap],
  );

  const allCopyTeamIds = copySourceTeams.map((t) => t.id);
  const copyTeamSelection = copyFromTeamIds ?? new Set(allCopyTeamIds);
  const allCopyTeamsSelected = allCopyTeamIds.length > 0 && allCopyTeamIds.every((id) => copyTeamSelection.has(id));
  const anyCopyTeamSelected = allCopyTeamIds.some((id) => copyTeamSelection.has(id));

  function toggleCopyTeam(id) {
    const next = new Set(copyTeamSelection);
    if (next.has(id)) {
      next.delete(id);
      const team = copySourceTeams.find((item) => item.id === id);
      const teamNoteIds = new Set((team?.notedAssignments ?? []).map((assignment) => assignment.id));
      setCopyFromNoteIds((current) => new Set([...current].filter((noteId) => !teamNoteIds.has(noteId))));
      setExpandedCopyTeams((current) => new Set([...current].filter((teamId) => teamId !== id)));
    } else {
      next.add(id);
    }
    setCopyFromTeamIds(next);
  }

  function toggleCopyAllTeams() {
    if (allCopyTeamsSelected) {
      setCopyFromTeamIds(new Set());
      setCopyFromNoteIds(new Set());
      setExpandedCopyTeams(new Set());
    } else {
      setCopyFromTeamIds(null);
    }
  }

  function toggleCopyTeamDetails(id) {
    setExpandedCopyTeams((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleCopyNote(id) {
    setCopyFromNoteIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAllCopyNotes(team) {
    const ids = team.notedAssignments.map((assignment) => assignment.id);
    const allSelected = ids.every((id) => copyFromNoteIds.has(id));
    setCopyFromNoteIds((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (allSelected) next.delete(id); else next.add(id);
      }
      return next;
    });
  }

  const teamFilterOptions = useMemo(() => {
    const teamOptions = (teamsQuery.data ?? [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((team) => ({ value: team.id, label: `${team.icon ? `${team.icon} ` : ""}${team.name}` }));

    return [
      ...teamOptions,
      { value: NO_TEAM_KEY, label: "Senza squadra" },
    ];
  }, [teamsQuery.data]);

  const searchTokens = useMemo(() => {
    const normalized = normalizeSearchText(employeeSearch);
    return normalized ? normalized.split(/\s+/) : [];
  }, [employeeSearch]);
  const searchActive = searchTokens.length > 0;

  const employees = useMemo(() => {
    // Con la ricerca attiva si cerca su tutta la rubrica: i filtri Ruolo/Squadra
    // non devono nascondere il dipendente che si sta cercando.
    if (searchActive) {
      const pool = (allEmployeesQuery.data ?? []).length > 0
        ? allEmployeesQuery.data
        : (employeesQuery.data ?? []);
      return pool.filter((employee) => employeeMatchesSearch(employee, searchTokens));
    }

    const filteredEmployees = (employeesQuery.data ?? []).filter((employee) => {
      if (teamFilter.length === 0) return true;
      const team = employeeTeamMap[employee.id];
      return teamFilter.includes(team?.id ?? NO_TEAM_KEY);
    });
    if (sortMode !== "team") return filteredEmployees;

    const allEmployees = allEmployeesQuery.data ?? [];
    if (allEmployees.length === 0) return filteredEmployees;

    const filteredIds = new Set(filteredEmployees.map((employee) => employee.id));
    const includedTeamIds = new Set();
    for (const employee of filteredEmployees) {
      const team = employeeTeamMap[employee.id];
      if (team) includedTeamIds.add(team.id);
    }

    if (includedTeamIds.size === 0) return filteredEmployees;

    const next = [...filteredEmployees];
    for (const employee of allEmployees) {
      if (filteredIds.has(employee.id)) continue;
      const team = employeeTeamMap[employee.id];
      if (team && includedTeamIds.has(team.id)) {
        next.push(employee);
      }
    }
    return next;
  }, [allEmployeesQuery.data, employeeTeamMap, employeesQuery.data, searchActive, searchTokens, sortMode, teamFilter]);

  const selectedScheduleIdx = useMemo(() => (dayjs(selectedDate).day() + 6) % 7, [selectedDate]);

  const employeeById = useMemo(() => {
    const map = {};
    for (const employee of allEmployeesQuery.data ?? []) map[employee.id] = employee;
    for (const employee of employeesQuery.data ?? []) map[employee.id] = employee;
    return map;
  }, [allEmployeesQuery.data, employeesQuery.data]);

  // ── opzioni per il perimetro del riepilogo ────────────────────────────────
  const reportTeamOptions = useMemo(() => [
    ...(teamsQuery.data ?? [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((team) => ({ value: team.id, label: `${team.icon ? `${team.icon} ` : ""}${team.name}` })),
    { value: NO_TEAM_KEY, label: "Senza squadra" },
  ], [teamsQuery.data]);

  const reportRoleOptions = useMemo(() => {
    const roles = new Set();
    for (const employee of Object.values(employeeById)) {
      const role = String(employee.tms_role_description ?? "").trim().toUpperCase();
      if (role) roles.add(role);
    }
    return [...roles].sort((a, b) => a.localeCompare(b));
  }, [employeeById]);

  const reportAreaOptions = useMemo(() => {
    const names = new Set();
    for (const area of areasQuery.data ?? []) {
      const name = String(area.name ?? "").trim();
      if (name) names.add(name);
    }
    // Le allocazioni possono puntare ad aree non piu' in anagrafica: restano
    // filtrabili, altrimenti sparirebbero dal perimetro senza spiegazione.
    for (const assignment of assignmentsQuery.data ?? []) {
      const name = String(assignment.area ?? "").trim();
      if (name) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [areasQuery.data, assignmentsQuery.data]);

  const reportImmobileOptions = useMemo(() => {
    const buildings = new Set();
    for (const area of areasQuery.data ?? []) {
      for (const code of plannerBuildingCodes(area.buildings)) {
        buildings.add(code);
      }
    }
    return [...buildings].sort((a, b) => a.localeCompare(b));
  }, [areasQuery.data]);

  // Dipendenti diventati inattivi (es. usciti dal TMS) che hanno ancora allocazioni o assenze
  // residue sul giorno selezionato: non compaiono più nella rubrica attiva, ma vanno comunque
  // mostrati (in sola pulizia) così da poter eliminare i record orfani dal Planner.
  const orphanEmployees = useMemo(() => {
    const seen = new Set();
    const orphans = [];
    const addOrphan = (employeeId, fullName) => {
      if (!employeeId || employeeById[employeeId] || seen.has(employeeId)) return;
      if (!employeeMatchesSearch({ full_name: fullName }, searchTokens)) return;
      seen.add(employeeId);
      orphans.push({
        id: employeeId,
        full_name: fullName || "–",
        tms_role_description: null,
        has_photo: false,
        default_schedule: null,
        is_active: false,
        _isOrphan: true,
      });
    };
    for (const a of assignmentsQuery.data ?? []) addOrphan(a.employee_id, a.employee_name);
    for (const j of justificationsQuery.data ?? []) addOrphan(j.employee_id, j.employee_name);
    return orphans;
  }, [assignmentsQuery.data, justificationsQuery.data, employeeById, searchTokens]);

  const areas = areasQuery.data ?? [];
  const trainingCourses = trainingCoursesQuery.data ?? [];
  const drag = dragRef.current;

  const sortedItems = useMemo(() => {
    const allEmployees = [...employees, ...orphanEmployees];
    if (sortMode === "alpha") {
      return allEmployees.map((e) => ({ type: "employee", employee: e }));
    }
    const groups = {};
    const noTeam = [];
    for (const emp of allEmployees) {
      const team = employeeTeamMap[emp.id];
      if (team) {
        if (!groups[team.id]) groups[team.id] = { team, emps: [] };
        groups[team.id].emps.push(emp);
      } else {
        noTeam.push(emp);
      }
    }
    const items = [];
    const sortedGroups = Object.values(groups).sort((a, b) => a.team.name.localeCompare(b.team.name));
    for (const g of sortedGroups) {
      items.push({ type: "teamHeader", team: g.team });
      // durante una ricerca le squadre restano aperte, altrimenti i risultati
      // finirebbero dentro un gruppo chiuso e sembrerebbero assenti
      if (searchActive || !collapsedTeams[g.team.id]) {
        for (const e of [...g.emps].sort((a, b) => a.full_name.localeCompare(b.full_name))) {
          items.push({ type: "employee", employee: e });
        }
      }
    }
    if (noTeam.length > 0) {
      items.push({ type: "teamHeader", team: null });
      if (searchActive || !collapsedTeams[NO_TEAM_KEY]) {
        for (const e of noTeam) items.push({ type: "employee", employee: e });
      }
    }
    return items;
  }, [employees, orphanEmployees, sortMode, employeeTeamMap, collapsedTeams, searchActive]);

  const teamMemberCountByKey = useMemo(() => {
    const counts = {};
    for (const emp of [...employees, ...orphanEmployees]) {
      const team = employeeTeamMap[emp.id];
      const key = team?.id ?? NO_TEAM_KEY;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [employees, orphanEmployees, employeeTeamMap]);

  const toggleTeamCollapsed = useCallback((teamId) => {
    const key = teamId ?? NO_TEAM_KEY;
    setCollapsedTeams((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  const expandAllTeams = useCallback(() => setCollapsedTeams({}), []);

  const collapseAllTeams = useCallback(() => {
    setCollapsedTeams(
      Object.keys(teamMemberCountByKey).reduce((acc, key) => ({ ...acc, [key]: true }), {})
    );
  }, [teamMemberCountByKey]);

  function getDisplayBlocks(employeeId) {
    const saved = assignmentsByEmployee[employeeId] ?? [];
    const drag = dragRef.current;
    if (!drag || drag.employeeId !== employeeId) return { blocks: saved, ghost: null };
    if (drag.type === "create") return { blocks: saved, ghost: { startHour: drag.startHour, endHour: drag.endHour } };
    const blocks = saved.map((a) =>
      a.id !== drag.assignmentId
        ? a
        : {
            ...a,
            start_time: hourToTime(drag.startHour),
            end_time: hourToTime(drag.endHour),
            break_start: Number.isFinite(drag.breakStartHour) ? hourToTime(drag.breakStartHour) : null,
            break_end: Number.isFinite(drag.breakEndHour) ? hourToTime(drag.breakEndHour) : null,
          }
    );
    return { blocks, ghost: null };
  }

  function getBreakSegmentForAssignment(employeeId, assignment) {
    const assignmentStart = timeToHourRaw(assignment.start_time);
    const assignmentEnd = timeToHourRaw(assignment.end_time);
    const explicitBreakStart = assignment.break_start ? timeToHourRaw(assignment.break_start) : null;
    const explicitBreakEnd = assignment.break_end ? timeToHourRaw(assignment.break_end) : null;
    if (
      Number.isFinite(explicitBreakStart)
      && Number.isFinite(explicitBreakEnd)
      && assignmentStart < explicitBreakStart
      && explicitBreakStart < explicitBreakEnd
      && explicitBreakEnd < assignmentEnd
    ) {
      return {
        startHour: explicitBreakStart,
        endHour: explicitBreakEnd,
        startLabel: String(assignment.break_start).slice(0, 5),
        endLabel: String(assignment.break_end).slice(0, 5),
        explicit: true,
      };
    }

    const scheduleDay = employeeById[employeeId]?.default_schedule?.[selectedScheduleIdx];
    const breakSegment = getScheduleBreakSegment(scheduleDay);
    if (!breakSegment) return null;

    if (!Number.isFinite(assignmentStart) || !Number.isFinite(assignmentEnd)) return null;
    if (assignmentStart > breakSegment.startHour || assignmentEnd < breakSegment.endHour) return null;

    return { ...breakSegment, explicit: false };
  }

  function openEditBlock(e, a) {
    e.stopPropagation();
    if (!canWritePlanning) return;
    if (suppressClickRef.current === a.id) { suppressClickRef.current = null; return; }
    setEditingBlock(a);
    setEditForm({
      area: a.area ?? "",
      immobile: normalizeImmobile(a.area, a.immobile, areas) ?? "",
      notes: a.notes ?? "",
      trainingCourseId: a.training_course_id ?? "",
    });
  }

  function saveEditBlock() {
    if (!editingBlock || !canWritePlanning) return;
    const payload = editingBlock.cause === "FORMAZIONE"
      ? { training_course_id: editForm.trainingCourseId || null, notes: editForm.notes || null }
      : {
          area: editForm.area || null,
          immobile: normalizeImmobile(editForm.area, editForm.immobile, areas),
          notes: editForm.notes || null,
        };
    updateMutation.mutate(
      { id: editingBlock.id, payload },
      { onSuccess: () => setEditingBlock(null) }
    );
  }

  function buildReportData() {
    const dateLabel = dayjs(selectedDate).format("dddd D MMMM YYYY");
    const teams = (teamsQuery.data ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
    const teamSectionsMap = {};

    // Perimetro del riepilogo: i filtri attivi si combinano in AND; un filtro
    // spuntato ma senza valori selezionati non restringe il risultato.
    const scope = reportScope;
    const teamFilterActive = !scope.allEmployees && scope.byTeam && scope.teamIds.length > 0;
    const roleFilterActive = !scope.allEmployees && scope.byRole && scope.roles.length > 0;
    const areaFilterActive = !scope.allEmployees && scope.byArea && scope.areaNames.length > 0;
    const immobileFilterActive = !scope.allEmployees && scope.byImmobile && scope.immobili.length > 0;
    const scopeAreaKeys = areaFilterActive ? scope.areaNames.map(normalizeAreaKey) : [];

    const employeeInScope = (employeeId) => {
      if (teamFilterActive) {
        const teamKey = employeeTeamMap[employeeId]?.id ?? NO_TEAM_KEY;
        if (!scope.teamIds.includes(teamKey)) return false;
      }
      if (roleFilterActive) {
        const role = String(employeeById[employeeId]?.tms_role_description ?? "").trim().toUpperCase();
        if (!scope.roles.includes(role)) return false;
      }
      return true;
    };

    const assignmentInScope = (assignment) => {
      if (!employeeInScope(assignment.employee_id)) return false;
      if (areaFilterActive && !scopeAreaKeys.includes(normalizeAreaKey(assignment.area))) return false;
      if (immobileFilterActive) {
        const immobile = String(assignment.immobile ?? "").trim().toUpperCase();
        if (!scope.immobili.includes(immobile)) return false;
      }
      return true;
    };

    const scopeParts = [];
    if (teamFilterActive) {
      const teamNameById = Object.fromEntries((teamsQuery.data ?? []).map((team) => [team.id, team.name]));
      scopeParts.push(`Squadre: ${scope.teamIds.map((id) => (id === NO_TEAM_KEY ? "Senza squadra" : teamNameById[id] ?? id)).join(", ")}`);
    }
    if (roleFilterActive) scopeParts.push(`Ruoli: ${scope.roles.join(", ")}`);
    if (areaFilterActive) scopeParts.push(`Aree: ${scope.areaNames.join(", ")}`);
    if (immobileFilterActive) scopeParts.push(`Immobili: ${scope.immobili.join(", ")}`);
    const scopeLabel = scopeParts.length > 0 ? `${scopeParts.join(" · ")} (assenti: elenco completo)` : null;

    for (const team of teams) {
      teamSectionsMap[team.id] = {
        id: team.id,
        name: team.name,
        icon: team.icon ?? "👥",
        color: team.color ?? "#5f6b7a",
        // Owner predefinito della squadra; in mancanza, chi ha compilato il carico.
        ownerName: team.workload_owner_employee_name ?? teamWorkloadOwnerByTeamId[team.id] ?? null,
        absences: [],
        areas: [],
      };
    }

    const noTeamSection = {
      id: "no-team",
      name: "Senza squadra",
      icon: null,
      color: "#888888",
      absences: [],
      areas: [],
    };

    const getSectionForEmployee = (employeeId) => {
      const team = employeeTeamMap[employeeId];
      if (!team) return noTeamSection;
      if (!teamSectionsMap[team.id]) {
        teamSectionsMap[team.id] = {
          id: team.id,
          name: team.name,
          icon: team.icon ?? "👥",
          color: team.color ?? "#5f6b7a",
          ownerName: team.workload_owner_employee_name ?? teamWorkloadOwnerByTeamId[team.id] ?? null,
          absences: [],
          areas: [],
        };
      }
      return teamSectionsMap[team.id];
    };

    // Le assenze restano sempre complete, a prescindere dal perimetro:
    // il filtro si applica solo alle allocazioni.
    const allAbsences = [];
    for (const j of justificationsQuery.data ?? []) {
      const section = getSectionForEmployee(j.employee_id);
      const name = employeeById[j.employee_id]?.full_name ?? "–";
      const displayLabel = getAbsenceDisplayLabel(j);
      const absenceEntry = { name, displayLabel, note: j.description?.trim() || null };
      section.absences.push(absenceEntry);
      allAbsences.push(absenceEntry);
    }
    allAbsences.sort((a, b) => a.name.localeCompare(b.name));

    const areaSectionsMap = {};

    const orderedAreaNames = areas.map((a) => a.name).filter((name) => (assignmentsByArea[name] ?? []).length > 0);
    const extraAreaNames = Object.keys(assignmentsByArea).filter((n) => !orderedAreaNames.includes(n) && (assignmentsByArea[n] ?? []).length > 0);
    let allocationCount = 0;

    for (const areaName of [...orderedAreaNames, ...extraAreaNames]) {
      const sorted = (assignmentsByArea[areaName] ?? []).filter(assignmentInScope).sort((a, b) => {
        const nameA = a.employee_name ?? employeeById[a.employee_id]?.full_name ?? "";
        const nameB = b.employee_name ?? employeeById[b.employee_id]?.full_name ?? "";
        return nameA.localeCompare(nameB) || String(a.start_time).localeCompare(String(b.start_time));
      });
      if (sorted.length === 0) continue;

      const areaBuildings = getImmobileOptions(areaName, areas);
      // Nel raggruppamento per Area/Immobile ogni immobile e' una sezione a se':
      // ha senso solo se almeno un'allocazione dell'area ha l'immobile compilato,
      // altrimenti l'area resta una sezione unica come prima.
      const areaSplitByBuilding = reportGrouping === "building"
        && sorted.some((a) => String(a.immobile ?? "").trim() !== "");
      for (const assignment of sorted) {
        allocationCount += 1;
        const rawImmobile = String(assignment.immobile ?? "").trim().toUpperCase();
        let section;
        if (reportGrouping === "building") {
          const areaKey = areaName || "SENZA AREA";
          const buildingKey = areaSplitByBuilding ? (rawImmobile || NO_BUILDING_KEY) : null;
          const sectionKey = buildingKey ? `${areaKey}::${buildingKey}` : areaKey;
          if (!areaSectionsMap[sectionKey]) {
            areaSectionsMap[sectionKey] = {
              id: buildingKey ? `area:${areaKey}:${buildingKey}` : `area:${areaKey}`,
              name: buildingKey ? `${areaKey} · ${buildingKey}` : areaKey,
              areaName: areaKey,
              immobile: buildingKey,
              icon: "🏢",
              color: areaColorMap[areaName]?.border ?? "#006f3d",
              absences: [],
              areas: [],
              workload: null,
              workloadRows: [],
              ownerName: null,
            };
          }
          section = areaSectionsMap[sectionKey];
        } else {
          section = getSectionForEmployee(assignment.employee_id);
        }
        const areaKey = areaName || "—";
        let areaEntry = section.areas.find((area) => area.name === areaKey);
        if (!areaEntry) {
          areaEntry = {
            name: areaKey,
            buildings: reportGrouping === "team" && areaBuildings.length > 0
              ? areaBuildings.map((buildingName) => ({ name: buildingName, allocations: [] }))
              : [],
            allocations: [],
          };
          section.areas.push(areaEntry);
        }

        const item = {
          name: assignment.employee_name ?? employeeById[assignment.employee_id]?.full_name ?? "–",
          note: assignment.notes?.trim() || null,
          startTime: String(assignment.start_time ?? "").slice(0, 5),
          timeRange: formatTimeRange(assignment.start_time, assignment.end_time),
        };

        if (reportGrouping === "team" && areaEntry.buildings.length > 0) {
          // Gli immobili non visibili nel Planner confluiscono in "SENZA IMMOBILE".
          const teamImmobileKey = areaBuildings.includes(rawImmobile) ? rawImmobile : NO_BUILDING_KEY;
          let buildingEntry = areaEntry.buildings.find((building) => building.name === teamImmobileKey);
          if (!buildingEntry) {
            buildingEntry = { name: teamImmobileKey, allocations: [] };
            areaEntry.buildings.push(buildingEntry);
          }
          buildingEntry.allocations.push(item);
        } else {
          // Nel raggruppamento per Area/Immobile l'immobile e' gia' l'intestazione
          // della sezione: qui l'elenco delle persone e' piatto.
          areaEntry.allocations.push(item);
        }
      }
    }

    const teamSections = [...teams.map((team) => teamSectionsMap[team.id]).filter(Boolean), noTeamSection]
      .map((section) => ({
        ...section,
        absences: section.absences.slice().sort((a, b) => a.name.localeCompare(b.name)),
        areas: section.areas
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((area) => ({
            ...area,
            buildings: area.buildings
              .map((building) => ({
                ...building,
                allocations: building.allocations.slice().sort(compareAllocations),
              }))
              .filter((building) => building.allocations.length > 0),
            allocations: area.allocations.slice().sort(compareAllocations),
          })),
      }))
      .map((section) => ({
        ...section,
        workload: section.id !== "no-team" ? (teamWorkloadByTeamId[section.id] ?? null) : null,
        workloadRows: section.id !== "no-team" ? (teamWorkloadRowsByTeamId[section.id] ?? []) : [],
        ownerName: section.id !== "no-team" ? (section.ownerName ?? teamWorkloadOwnerByTeamId[section.id] ?? null) : null,
      }))
      .filter((section) => {
        if (teamFilterActive) {
          const sectionKey = section.id === "no-team" ? NO_TEAM_KEY : section.id;
          if (!scope.teamIds.includes(sectionKey)) return false;
        }
        const hasAllocations = section.areas.some((area) => area.allocations.length > 0 || area.buildings.some((building) => building.allocations.length > 0));
        // Con filtri su ruolo/area/immobile le sezioni con solo carico di lavoro
        // (dato di squadra, non di persona) vengono escluse se vuote.
        if (roleFilterActive || areaFilterActive || immobileFilterActive) {
          return hasAllocations;
        }
        return section.workloadRows?.length > 0 || Boolean(section.workload) || hasAllocations;
      });

    // Il carico di lavoro è un dato di squadra: nel raggruppamento per
    // Area/Immobile le righe si redistribuiscono sulle aree indicate nella
    // colonna "Mag". Con i filtri per ruolo/area/immobile attivi restano solo le
    // aree che hanno anche allocazioni, come già avviene per le squadre.
    if (reportGrouping === "building") {
      const workloadRowsByArea = groupWorkloadRowsByArea(teamDailyNotesQuery.data, {
        teamIds: teamFilterActive ? scope.teamIds : null,
      });
      const allowWorkloadOnlySections = !roleFilterActive && !areaFilterActive && !immobileFilterActive;
      const sectionsByAreaKey = {};
      for (const section of Object.values(areaSectionsMap)) {
        const key = normalizeAreaKey(section.areaName ?? section.name);
        if (!sectionsByAreaKey[key]) sectionsByAreaKey[key] = [];
        sectionsByAreaKey[key].push(section);
      }
      for (const [areaKey, rows] of Object.entries(workloadRowsByArea)) {
        const areaSectionsForKey = sectionsByAreaKey[areaKey] ?? [];
        // Il carico e' un dato di area, non di immobile: finisce dentro la sezione
        // solo quando l'area non e' divisa, altrimenti comparirebbe ripetuto sotto
        // ogni immobile. Nelle aree divise prende una sezione propria, intestata
        // all'area e ordinata prima dei suoi immobili.
        if (areaSectionsForKey.length === 1) {
          areaSectionsForKey[0].workloadRows = rows;
          continue;
        }
        if (areaSectionsForKey.length === 0 && !allowWorkloadOnlySections) continue;
        const isNoWarehouse = areaKey === WORKLOAD_NO_WAREHOUSE_KEY;
        const areaName = areas.find((area) => normalizeAreaKey(area.name) === areaKey)?.name ?? areaKey;
        areaSectionsMap[isNoWarehouse ? `workload:${areaKey}` : areaName] = {
          id: isNoWarehouse ? "workload:no-warehouse" : `area:${areaName}`,
          name: isNoWarehouse ? WORKLOAD_NO_WAREHOUSE_KEY : areaName,
          areaName: isNoWarehouse ? WORKLOAD_NO_WAREHOUSE_KEY : areaName,
          immobile: null,
          icon: isNoWarehouse ? "📦" : "🏢",
          color: areaColorMap[areaName]?.border ?? "#006f3d",
          absences: [],
          areas: [],
          workload: null,
          workloadRows: rows,
          ownerName: null,
          // Le righe senza magazzino non appartengono a nessuna area: in coda.
          sortLast: isNoWarehouse,
        };
      }
    }

    const areaSections = Object.values(areaSectionsMap)
      .sort((a, b) =>
        Number(a.sortLast ?? false) - Number(b.sortLast ?? false)
        || normalizeAreaKey(a.areaName ?? a.name).localeCompare(normalizeAreaKey(b.areaName ?? b.name))
        // Dentro l'area: prima il carico di lavoro (sezione senza immobile),
        // poi gli immobili in ordine, e in fondo chi l'immobile non ce l'ha.
        || Number(a.immobile === NO_BUILDING_KEY) - Number(b.immobile === NO_BUILDING_KEY)
        || String(a.immobile ?? "").localeCompare(String(b.immobile ?? "")))
      .map((section) => ({
        ...section,
        areas: section.areas
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((area) => ({
            ...area,
            buildings: area.buildings
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((building) => ({
                ...building,
                allocations: building.allocations.slice().sort(compareAllocations),
              })),
            allocations: area.allocations.slice().sort(compareAllocations),
          })),
      }));

    const reportSections = reportGrouping === "building" ? areaSections : teamSections;

    return {
      title: "Planner - Riepilogo allocazioni",
      dateLabel,
      scopeLabel,
      allAbsences,
      grouping: reportGrouping,
      teams: reportSections,
      totals: {
        absences: allAbsences.length,
        areas: reportSections.reduce((sum, section) => sum + section.areas.length, 0),
        allocations: allocationCount,
      },
    };
  }

  function generateReportText() {
    const report = buildReportData();
    const lines = [`📋 Allocazioni ${report.dateLabel}`];
    if (report.scopeLabel) lines.push(`Perimetro: ${report.scopeLabel}`);
    lines.push("");

    if (report.allAbsences.length > 0) {
    lines.push(`Assenti (${report.allAbsences.length})`);
    for (const item of report.allAbsences) {
      lines.push(`• ${item.name} (${item.displayLabel})${item.note ? ` — ${item.note}` : ""}`);
    }
    lines.push("");
  }

  for (const team of report.teams) {
      lines.push(`${team.icon ? `${team.icon} ` : ""}${team.name}`);
      if (team.workloadRows?.length) {
        const totals = team.workloadRows.reduce((acc, row) => ({
          inb: acc.inb + Number(row.inbound_count || 0),
          out: acc.out + Number(row.outbound_count || 0),
          plt: acc.plt + Number(row.pallet_count || 0),
        }), { inb: 0, out: 0, plt: 0 });
        lines.push("  Carico di lavoro:");
        lines.push("    Cliente | Fornitore | IN | MEZZI OUT | PLT | Note/Info | Mag");
        for (const row of team.workloadRows) {
          lines.push(
            `    ${workloadCustomerLabel(row) || "-"} | ${workloadSupplierLabel(row) || "-"} | ${row.inbound_count ?? 0} | ${row.outbound_count ?? 0} | ${row.pallet_count ?? 0} | ${row.notes || "-"} | ${row.warehouse || "-"}`
          );
        }
        lines.push(`    TOT | ${totals.inb} | ${totals.out} | ${totals.plt} | - | -`);
      } else if (team.workload) {
        lines.push("  Carico di lavoro:");
        for (const line of team.workload.split("\n")) {
          lines.push(`    ${line}`);
        }
      }

      for (const area of team.areas) {
        if (report.grouping !== "building") lines.push(`🏢 ${area.name}`);
        if (area.buildings.length > 0) {
          for (const building of area.buildings) {
            lines.push(`• ${building.name}`);
            for (const allocation of building.allocations) {
              lines.push(`  - ${getAllocationDisplayLabel(allocation)}${allocation.note ? ` — Note: ${allocation.note}` : ""}`);
            }
          }
        }
        for (const allocation of area.allocations) {
          lines.push(`• ${getAllocationDisplayLabel(allocation)}${allocation.note ? ` — Note: ${allocation.note}` : ""}`);
        }
      }
      lines.push("");
    }

    return lines.join("\n").trim();
  }

  async function exportReportPdf() {
    // pdf-lib e fontkit vengono caricati solo al momento dell'export:
    // tenerli fuori dal bundle iniziale alleggerisce il primo caricamento.
    const [{ PDFDocument, rgb }, { default: fontkit }] = await Promise.all([
      import("pdf-lib"),
      import("@pdf-lib/fontkit"),
    ]);
    const report = buildReportData();
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const margin = 36;
    const bottomMargin = 34;
    const contentWidth = pageWidth - margin * 2;

    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    const [lexendBytes, logoBytes] = await Promise.all([
      fetch(lexendFontUrl).then((res) => res.arrayBuffer()),
      fetch(logoTonoli).then((res) => res.arrayBuffer()),
    ]);
    const lexendLight = await pdfDoc.embedFont(lexendBytes, { subset: true });
    const lexendBlack = await pdfDoc.embedFont(lexendBytes, { subset: true });
    const logoImage = await pdfDoc.embedPng(logoBytes);

    const loadCanvasPngBytes = async (draw, width, height) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, width, height);
      draw(ctx, width, height);
      const pngDataUrl = canvas.toDataURL("image/png");
      const base64 = pngDataUrl.split(",")[1] ?? "";
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    };

    const teamBadgeImages = {};
    for (const team of report.teams) {
      if (!team.icon) continue;
      try {
        const bytes = await loadCanvasPngBytes((ctx, width, height) => {
          const centerX = width / 2;
          const centerY = height / 2;
          const radius = Math.min(width, height) / 2 - 3;
          ctx.fillStyle = team.color || "#5f6b7a";
          ctx.beginPath();
          ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.font = "28px Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(team.icon, centerX, centerY + 1);
        }, 44, 44);
        teamBadgeImages[team.id] = await pdfDoc.embedPng(bytes);
      } catch {
        teamBadgeImages[team.id] = null;
      }
    }

    const hexToRgb = (hex) => {
      const clean = String(hex || "#000000").replace("#", "");
      const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
      return rgb(
        parseInt(full.slice(0, 2), 16) / 255,
        parseInt(full.slice(2, 4), 16) / 255,
        parseInt(full.slice(4, 6), 16) / 255,
      );
    };
    const sanitize = (value) => String(value ?? "").replace(/[•]/g, "-").replace(/[–—]/g, "-");
    const measureText = (font, size, text) => font.widthOfTextAtSize(sanitize(text), size);
    const wrapText = (text, maxWidth, font, size) => {
      const source = sanitize(text).trim();
      if (!source) return [""];
      const words = source.split(/\s+/);
      const lines = [];
      let current = "";
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (measureText(font, size, candidate) <= maxWidth || !current) current = candidate;
        else {
          lines.push(current);
          current = word;
        }
      }
      if (current) lines.push(current);
      return lines;
    };

    let page = null;
    let y = pageHeight;
    let pageNumber = 0;

    const drawTopRect = (x, topY, width, height, fill, border = null, borderWidth = 1) => {
      page.drawRectangle({
        x,
        y: topY - height,
        width,
        height,
        color: fill ? hexToRgb(fill) : undefined,
        borderColor: border ? hexToRgb(border) : undefined,
        borderWidth,
      });
    };

    const drawText = (text, x, baselineY, size, options = {}) => {
      const { bold = false, color = "#1e1e31" } = options;
      page.drawText(sanitize(text), {
        x,
        y: baselineY,
        size,
        font: bold ? lexendBlack : lexendLight,
        color: hexToRgb(color),
      });
    };

    const drawImageTop = (image, x, topY, width, height) => {
      page.drawImage(image, { x, y: topY - height, width, height });
    };

    let currentPageTeam = null;

    const startPage = () => {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      pageNumber += 1;
      const bannerColor = currentPageTeam?.color || "#006f3d";
      drawTopRect(0, pageHeight, pageWidth, pageHeight, "#ffffff");
      drawTopRect(margin, pageHeight - 28, contentWidth, 68, bannerColor);
      const logoHeight = 32;
      const logoWidth = (logoImage.width / logoImage.height) * logoHeight;
      drawTopRect(margin + 12, pageHeight - 36, logoWidth + 10, logoHeight + 10, "#ffffff");
      drawImageTop(logoImage, margin + 17, pageHeight - 41, logoWidth, logoHeight);
      const titleX = margin + 17 + logoWidth + 20;
      if (currentPageTeam) {
        const badge = teamBadgeImages[currentPageTeam.id];
        const badgeX = titleX;
        const badgeSize = 22;
        if (badge) drawImageTop(badge, badgeX, pageHeight - 37, badgeSize, badgeSize);
        const nameX = badge ? badgeX + badgeSize + 7 : badgeX;
        drawText(currentPageTeam.name, nameX, pageHeight - 58, 20, { bold: true, color: "#ffffff" });
        drawText(report.dateLabel, nameX, pageHeight - 80, 10, { color: "#ffffffbb" });
      } else {
        drawText(report.dateLabel, titleX, pageHeight - 60, 16, { bold: true, color: "#ffffff" });
      }
      drawText(`Pagina ${pageNumber}`, pageWidth - margin - 58, pageHeight - 60, 10, { bold: true, color: "#ffffff" });
      y = pageHeight - 112;
    };

    const ensureSpace = (height) => {
      if (y - height < bottomMargin) startPage(false);
    };

    const getParagraphHeight = (text, width, font = lexendLight, fontSize = 10.5, lineGap = 14) => {
      const lines = wrapText(text, width, font, fontSize);
      return lines.length * lineGap;
    };

    // Riga di allocazione: usata sia per disegnare sia per misurare l'altezza,
    // cosi' le due cose non possono divergere.
    const allocationPdfText = (allocation) =>
      `- ${getAllocationDisplayLabel(allocation)}${allocation.note ? ` - Note: ${allocation.note}` : ""}`;

    const getBuildingBlockHeight = (building) => {
      let height = 18;
      if (building.allocations.length === 0) {
        height += getParagraphHeight("Nessuna allocazione", contentWidth - 68) + 4;
        return height;
      }
      for (const allocation of building.allocations) {
        height += getParagraphHeight(allocationPdfText(allocation), contentWidth - 68) + 4;
      }
      return height;
    };

    const getAreaIntroHeight = (area) => {
      const areaHeaderHeight = report.grouping === "building" ? 0 : 28;
      if (area.buildings.length > 0) {
        const firstBuilding = area.buildings[0];
        return areaHeaderHeight + getBuildingBlockHeight(firstBuilding);
      }
      if (area.allocations.length > 0) {
        return areaHeaderHeight + getParagraphHeight(allocationPdfText(area.allocations[0]), contentWidth - 56);
      }
      return areaHeaderHeight;
    };

    const drawSectionHeader = (title, options = {}) => {
      const { color = "#006f3d" } = options;
      ensureSpace(34);
      drawTopRect(margin, y, contentWidth, 24, "#eef8f2", "#cfe7d8");
      drawText(title, margin + 12, y - 16, 12, { bold: true, color });
      y -= 34;
    };

    const drawWrappedParagraph = (text, options = {}) => {
      const { x = margin + 14, width = contentWidth - 28, fontSize = 10.5, color = "#1e1e31", bold = false, lineGap = 14 } = options;
      const lines = wrapText(text, width, bold ? lexendBlack : lexendLight, fontSize);
      for (const line of lines) {
        ensureSpace(lineGap);
        drawText(line, x, y - 10, fontSize, { color, bold });
        y -= lineGap;
      }
    };

    const drawWorkloadTable = (team) => {
      const rows = team.workloadRows?.length
        ? team.workloadRows
        : (team.workload ? [{
          client_supplier: "",
          client_supplier_code: "",
          inbound_count: "",
          outbound_count: "",
          pallet_count: "",
          notes: team.workload,
          warehouse: "",
        }] : []);
      if (rows.length === 0) return false;

      const tableX = margin + 4;
      const tableW = contentWidth - 8;
      const metaH = 28;
      const headerH = 26;
      const rowPadY = 5;
      const lineGap = 11;
      const colWidths = [82, 82, 30, 34, 38, 100, 43, 106];
      const headers = ["CLIENTE", "FORNITORE", "IN", "OUT", "N° PLT", "NOTE/INFO", "MAG", "COMPILATO DA"];
      const formatRowEditor = (row) => {
        if (!row.last_modified_by) return "";
        if (!row.last_modified_at) return row.last_modified_by;
        const modifiedAt = dayjs(row.last_modified_at);
        const sameDay = modifiedAt.format("YYYY-MM-DD") === dayjs(selectedDate).format("YYYY-MM-DD");
        return `${row.last_modified_by} · ${modifiedAt.format(sameDay ? "HH:mm" : "DD/MM HH:mm")}`;
      };
      const total = rows.reduce((acc, row) => ({
        inb: acc.inb + Number(row.inbound_count || 0),
        out: acc.out + Number(row.outbound_count || 0),
        plt: acc.plt + Number(row.pallet_count || 0),
      }), { inb: 0, out: 0, plt: 0 });

      const wrapCell = (text, width, font = lexendLight, fontSize = 8.7) =>
        wrapText(String(text ?? "").trim() || " ", Math.max(width - 8, 8), font, fontSize);

      const dataRows = rows.map((row) => ({
        values: [
          workloadCustomerLabel(row),
          workloadSupplierLabel(row),
          String(row.inbound_count ?? 0),
          String(row.outbound_count ?? 0),
          String(row.pallet_count ?? 0),
          row.notes || "",
          row.warehouse || "",
          formatRowEditor(row),
        ],
        total: false,
      }));
      dataRows.push({
        values: ["TOT", "", String(total.inb), String(total.out), String(total.plt), "", "", ""],
        total: true,
      });

      const measuredRows = dataRows.map((row) => {
        const wrapped = row.values.map((value, index) => wrapCell(value, colWidths[index], row.total ? lexendBlack : lexendLight, row.total ? 9.2 : 8.7));
        const maxLines = Math.max(...wrapped.map((lines) => lines.length), 1);
        return { ...row, wrapped, height: maxLines * lineGap + rowPadY * 2 };
      });

      const blockH = metaH + headerH + measuredRows.reduce((sum, row) => sum + row.height, 0);
      ensureSpace(blockH + 6);

      const leftMetaW = 174;
      const centerMetaW = 126;
      const rightMetaW = tableW - leftMetaW - centerMetaW;
      const topDate = dayjs(selectedDate).format("DD/MM/YYYY");
      const ownerLabel = `OWNER: ${team.ownerName || "-"}`;

      drawTopRect(tableX, y, tableW, blockH, "#ffffff", "#202020");

      let top = y;
      drawTopRect(tableX, top, leftMetaW, metaH, "#ffffff", "#202020");
      drawTopRect(tableX + leftMetaW, top, centerMetaW, metaH, "#ffffff", "#202020");
      drawTopRect(tableX + leftMetaW + centerMetaW, top, rightMetaW, metaH, "#ffffff", "#202020");
      drawText(topDate, tableX + 58, top - 18, 10.5, { bold: true, color: "#1e1e31" });
      const miniLogoHeight = 14;
      const miniLogoWidth = (logoImage.width / logoImage.height) * miniLogoHeight;
      drawImageTop(logoImage, tableX + leftMetaW + (centerMetaW - miniLogoWidth) / 2, top - 7, miniLogoWidth, miniLogoHeight);
      drawText(ownerLabel, tableX + leftMetaW + centerMetaW + 18, top - 18, 10, { bold: true, color: "#1e1e31" });
      top -= metaH;

      let cellX = tableX;
      headers.forEach((header, index) => {
        drawTopRect(cellX, top, colWidths[index], headerH, "#ffffff", "#202020");
        drawText(header, cellX + 4, top - 17, 8.6, { bold: true, color: "#1e1e31" });
        cellX += colWidths[index];
      });
      top -= headerH;

      measuredRows.forEach((row) => {
        let currentX = tableX;
        const fill = row.total ? "#94d051" : "#ffffff";
        row.wrapped.forEach((_lines, index) => {
          drawTopRect(currentX, top, colWidths[index], row.height, fill, "#202020");
          currentX += colWidths[index];
        });
        currentX = tableX;
        row.wrapped.forEach((lines, index) => {
          let textY = top - 10;
          for (const line of lines) {
            drawText(line, currentX + 4, textY, row.total ? 9.2 : 8.7, {
              bold: row.total || index === 0,
              color: "#1e1e31",
            });
            textY -= lineGap;
          }
          currentX += colWidths[index];
        });
        top -= row.height;
      });

      y -= blockH + 6;
      return true;
    };

    const drawTeamHeader = (team) => {
      ensureSpace(40);
      const badge = teamBadgeImages[team.id];
      if (badge) drawImageTop(badge, margin, y - 2, 22, 22);
      drawSectionHeader(team.name, { color: team.color || "#006f3d" });
    };

    startPage();

    if (report.scopeLabel) {
      drawWrappedParagraph(`Perimetro: ${report.scopeLabel}`, { x: margin, width: contentWidth, fontSize: 9.5, color: "#515164" });
      y -= 8;
    }

    if (report.allAbsences.length > 0) {
      drawSectionHeader(`Assenti (${report.allAbsences.length})`, { color: "#dc2626" });
      for (const item of report.allAbsences) {
        const text = `- ${item.name} (${item.displayLabel})${item.note ? ` — ${item.note}` : ""}`;
        const lines = wrapText(text, contentWidth - 28, lexendLight, 10.5);
        ensureSpace(lines.length * 14 + 2);
        drawWrappedParagraph(text, { color: "#1e1e31" });
      }
      y -= 8;
    }

    for (const team of report.teams) {
      currentPageTeam = team;
      startPage();

      if (team.workloadRows?.length || team.workload) {
        drawWorkloadTable(team);
      }

      for (const area of team.areas) {
        ensureSpace(getAreaIntroHeight(area));
        if (report.grouping !== "building") {
          drawTopRect(margin + 12, y, contentWidth - 24, 20, "#f8f8fa", "#e2e2e5");
          drawText(area.name, margin + 24, y - 14, 10.5, { bold: true, color: "#515164" });
          y -= 28;
        }

        if (area.buildings.length > 0) {
          for (const building of area.buildings) {
            ensureSpace(getBuildingBlockHeight(building));
            drawText(building.name, margin + 28, y - 10, 10.5, { bold: true, color: "#1e1e31" });
            y -= 18;
            if (building.allocations.length === 0) {
              drawWrappedParagraph("Nessuna allocazione", { x: margin + 40, width: contentWidth - 68, color: "#8a8a98" });
            } else {
              for (const allocation of building.allocations) {
                const text = allocationPdfText(allocation);
                const lines = wrapText(text, contentWidth - 68, lexendLight, 10.5);
                ensureSpace(lines.length * 14 + 2);
                drawWrappedParagraph(text, { x: margin + 40, width: contentWidth - 68 });
              }
            }
            y -= 4;
          }
        }
        for (const allocation of area.allocations) {
          const text = allocationPdfText(allocation);
          const lines = wrapText(text, contentWidth - 56, lexendLight, 10.5);
          ensureSpace(lines.length * 14 + 2);
          drawWrappedParagraph(text, { x: margin + 28, width: contentWidth - 56 });
        }
        y -= 4;
      }

      y -= 8;
    }

    const bytes = await pdfDoc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `planner-riepilogo-${selectedDate}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function handleCopyReport() {
    setReportScope(DEFAULT_REPORT_SCOPE);
    setReportGrouping("team");
    setReportOpen(true);
  }

  function toggleReportScopeFilter(key) {
    setReportScope((current) => {
      if (key === "allEmployees") return { ...DEFAULT_REPORT_SCOPE };
      const next = { ...current, [key]: !current[key] };
      next.allEmployees = !next.byTeam && !next.byRole && !next.byArea && !next.byImmobile;
      return next;
    });
  }

  function setReportScopeValues(key, values) {
    setReportScope((current) => ({ ...current, [key]: values }));
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <Stack spacing={2} className="planner-page">

      {/* ── Topbar ──────────────────────────────────────────────────── */}
      <PageHeader section="Pianificazione" title="Planner" />

      {/* Il topbar resta, ma senza il titolo: è la seconda barra dei filtri (regole 1-3) */}
      <Paper className="planner-topbar">
        <Box className="planner-date-nav">
          <button className="planner-nav-btn" onClick={() => setSelectedDate((d) => dayjs(d).subtract(1, "day").format("YYYY-MM-DD"))}>‹</button>
          <TextField
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            size="small"
            className="planner-date-input"
          />
          <button className="planner-nav-btn" onClick={() => setSelectedDate((d) => dayjs(d).add(1, "day").format("YYYY-MM-DD"))}>›</button>
          <Typography className="planner-date-label">
            {dayjs(selectedDate).format("dddd D MMMM YYYY")}
          </Typography>
        </Box>

        <Box className="planner-topbar-break" />

        <Box className="planner-topbar-filters">
          <ToggleButtonGroup
            value={plannerView}
            exclusive
            onChange={(_, v) => v && setPlannerView(v)}
            size="small"
            className="planner-view-toggle"
          >
            <ToggleButton value="employees">Dipendenti</ToggleButton>
            <ToggleButton value="areas">Aree</ToggleButton>
          </ToggleButtonGroup>

          {plannerView === "employees" && (
            <>
              <TextField
                size="small"
                placeholder="Cerca dipendente…"
                value={employeeSearch}
                onChange={(e) => setEmployeeSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") setEmployeeSearch(""); }}
                className="planner-search-filter"
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <span className="planner-search-icon">🔍</span>
                    </InputAdornment>
                  ),
                  endAdornment: employeeSearch ? (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        aria-label="Cancella ricerca"
                        onClick={() => setEmployeeSearch("")}
                      >
                        ✕
                      </IconButton>
                    </InputAdornment>
                  ) : null,
                }}
              />
              <FilterSelect
                label="Ruolo"
                value={roleFilter}
                onChange={setRoleFilter}
                options={ROLE_OPTIONS.map((role) => ({ value: role.value, label: role.label }))}
                disabled={searchActive}
                sx={{ minWidth: 150 }}
              />
              <FilterSelect
                label="Squadra"
                multiple
                value={teamFilter}
                onChange={(values) => {
                  setTeamFilter(values);
                  setRoleFilter("");
                }}
                options={teamFilterOptions}
                placeholder={teamFilter.length === 0 ? "Tutte le squadre" : undefined}
                disabled={searchActive}
              />
              <ToggleButtonGroup
                value={sortMode}
                exclusive
                onChange={(_, v) => v && setSortMode(v)}
                size="small"
                className="planner-view-toggle"
              >
                <ToggleButton value="alpha">A–Z</ToggleButton>
                <ToggleButton value="team">Squadra</ToggleButton>
              </ToggleButtonGroup>
            </>
          )}
        </Box>

        <Box className="planner-topbar-actions">
          <Button
            variant="outlined"
            size="small"
            className="planner-copy-btn"
            onClick={() => {
              setCopyFromDate("");
              setCopyFromTeamIds(null);
              setCopyFromNoteIds(new Set());
              setExpandedCopyTeams(new Set());
              setCopyFromOpen(true);
            }}
            disabled={!canWritePlanning}
          >
            Copia da…
          </Button>
          <Button
            variant="outlined"
            color="error"
            size="small"
            className="planner-copy-btn"
            onClick={() => setClearDayOpen(true)}
            disabled={(assignmentsQuery.data?.length ?? 0) === 0 || clearDayMutation.isPending}
          >
            Pulisci pianificazione
          </Button>
          <Button
            variant="outlined"
            size="small"
            className="planner-copy-btn"
            onClick={handleCopyReport}
          >
            📋 Riepilogo
          </Button>
        </Box>
      </Paper>

      {plannerDayAuditQuery.data && (
        <Paper elevation={0} sx={{ px: 1.5, py: 1, border: "1px solid var(--pl-border, #e2e2e5)", bgcolor: "rgba(248,246,241,0.72)" }}>
          <Stack direction={{ xs: "column", md: "row" }} spacing={{ xs: 0.5, md: 2 }} alignItems={{ xs: "flex-start", md: "center" }}>
            {plannerDayAuditQuery.data.first_copied_at && (
              <Typography sx={{ fontSize: 11.5, color: "text.secondary" }}>
                <strong>Prima copia:</strong> dal {dayjs(plannerDayAuditQuery.data.first_copied_from_date).format("DD/MM/YYYY")} da {plannerDayAuditQuery.data.first_copied_by_name} il {dayjs(plannerDayAuditQuery.data.first_copied_at).format("DD/MM/YYYY [alle] HH:mm")}
              </Typography>
            )}
            {plannerDayAuditQuery.data.last_modified_at && (
              <Typography sx={{ fontSize: 11.5, color: "text.secondary" }}>
                <strong>Ultima modifica:</strong> {plannerDayAuditQuery.data.last_modified_by_name} il {dayjs(plannerDayAuditQuery.data.last_modified_at).format("DD/MM/YYYY [alle] HH:mm")}
              </Typography>
            )}
          </Stack>
        </Paper>
      )}

      {/* ── errors / warnings ───────────────────────────────────────── */}
      {createMutation.error && <Alert severity="error">{createMutation.error.message}</Alert>}
      {updateMutation.error && <Alert severity="error">{updateMutation.error.message}</Alert>}
      {absenceBlockMsg && (
        <Alert severity="warning" onClose={() => setAbsenceBlockMsg(null)}>{absenceBlockMsg}</Alert>
      )}

      {/* ── Timeline + Prenotazioni panel ───────────────────────────── */}
      <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start" }}>
      <Paper className="planner-shell" sx={{ flex: 1, minWidth: 0 }}>
        <Box className="planner-header-row" style={{ "--pl-name-w": `${nameColWidth}px` }}>
          <Box className="planner-name-header-cell" sx={{ position: "relative", display: "flex", alignItems: "center", gap: 0.5, px: 0.75 }}>
            {plannerView === "employees" && sortMode === "team" && (
              <>
                <Tooltip title="Espandi tutte le squadre">
                  <button
                    type="button"
                    className="planner-header-collapse-btn"
                    aria-label="Espandi tutte le squadre"
                    onClick={expandAllTeams}
                  >
                    ⊞
                  </button>
                </Tooltip>
                <Tooltip title="Comprimi tutte le squadre">
                  <button
                    type="button"
                    className="planner-header-collapse-btn"
                    aria-label="Comprimi tutte le squadre"
                    onClick={collapseAllTeams}
                  >
                    ⊟
                  </button>
                </Tooltip>
              </>
            )}
            <Box className="planner-resize-handle" onMouseDown={handleNameColResizeStart} />
          </Box>
          <Box className="planner-header-scroll">
            <Box
              className="planner-hour-header"
              style={{ width: TRACK_WIDTH, transform: `translateX(-${timelineScrollLeft}px)` }}
            >
              {Array.from({ length: HOURS + 1 }, (_, i) => i + HOUR_START).map((h) => (
                <span key={h} className="planner-hour-label" style={{ left: hourOffset(h) }}>
                  {pad2(h)}
                </span>
              ))}
              {Array.from({ length: HOURS }, (_, i) => HOUR_START + i + 0.5).map((h) => (
                <span key={`t${h}`} className="planner-half-tick" style={{ left: hourOffset(h) }} />
              ))}
            </Box>
          </Box>
        </Box>

        <Box className="planner-body">
        <Box className="planner-layout" style={{ "--pl-name-w": `${nameColWidth}px` }}>

          {/* name column */}
          <Box className="planner-names" style={{ position: "relative" }}>
            {plannerView === "employees" && sortedItems.map((item) => {
              if (item.type === "teamHeader") {
                const t = item.team;
                const twl = t ? (teamWorkloadByTeamId[t.id] ?? null) : null;
                const teamKey = t?.id ?? NO_TEAM_KEY;
                const isCollapsed = Boolean(collapsedTeams[teamKey]);
                const memberCount = teamMemberCountByKey[teamKey] ?? 0;
                return (
                  <Box
                    key={`nh-${t?.id ?? "none"}`}
                    className="planner-team-header"
                    onClick={() => toggleTeamCollapsed(t?.id ?? null)}
                    sx={{
                      height: 26,
                      px: 1,
                      display: "flex",
                      alignItems: "center",
                      gap: 0.75,
                      background: t ? t.color + "14" : "#f5f5f7",
                      borderBottom: "1px solid var(--pl-border)",
                    }}
                  >
                    <button
                      type="button"
                      className={`planner-team-collapse-btn${isCollapsed ? " is-collapsed" : ""}`}
                      aria-label={isCollapsed ? "Espandi squadra" : "Collassa squadra"}
                      onClick={(e) => { e.stopPropagation(); toggleTeamCollapsed(t?.id ?? null); }}
                    >
                      ▾
                    </button>
                    {t ? (
                      <>
                        <span style={{ fontSize: 13, lineHeight: 1 }}>{t.icon}</span>
                        <Box className="planner-team-header-main">
                          <Typography className="planner-team-header-name" sx={{ color: t.color }}>
                            {t.name}
                          </Typography>
                          <Typography className="planner-team-header-count">
                            {memberCount}
                          </Typography>
                        </Box>
                        <Tooltip title={twl ? `Carico: ${twl}` : "Apri scheda carico"} placement="right">
                          <button
                            onClick={(e) => { e.stopPropagation(); navigate(`/carichi?date=${selectedDate}&teamId=${t.id}`); }}
                            style={{
                              background: twl ? t.color + "28" : "rgba(0,0,0,0.06)",
                              border: `1px solid ${twl ? t.color + "70" : "rgba(0,0,0,0.13)"}`,
                              borderRadius: 5,
                              cursor: "pointer",
                              padding: "1px 5px",
                              fontSize: 12,
                              lineHeight: 1.4,
                              flexShrink: 0,
                              display: "flex",
                              alignItems: "center",
                              gap: 3,
                              color: twl ? t.color : "var(--pl-faded)",
                              fontWeight: 600,
                            }}
                          >
                            📋{twl && <span style={{ fontSize: 10, maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{twl}</span>}
                          </button>
                        </Tooltip>
                      </>
                    ) : (
                      <>
                        <Box className="planner-team-header-main">
                          <Typography className="planner-team-header-name" sx={{ color: "#888" }}>
                            Senza squadra
                          </Typography>
                          <Typography className="planner-team-header-count">
                            {memberCount}
                          </Typography>
                        </Box>
                      </>
                    )}
                  </Box>
                );
              }
              const emp = item.employee;
              const empTeam = employeeTeamMap[emp.id];
              const isBirthday = emp.birth_date
                ? emp.birth_date.slice(5, 10) === selectedDate.slice(5, 10)
                : false;
              return (
                <Box key={emp.id} className="planner-name-cell" sx={emp._isOrphan ? { opacity: 0.55 } : undefined}>
                  <EmployeeAvatar employee={emp} size={32} />
                  <Box className="planner-name-text">
                    <Typography className="planner-emp-name">
                      {emp.full_name}
                      {emp._isOrphan && (
                        <Tooltip title="Dipendente non più attivo: le allocazioni residue possono essere solo eliminate" placement="right">
                          <span style={{ marginLeft: 4, fontSize: 9, fontWeight: 700, letterSpacing: "0.04em", color: "#b91c1c", textTransform: "uppercase", verticalAlign: "middle" }}>Inattivo</span>
                        </Tooltip>
                      )}
                      {isBirthday && (
                        <Tooltip title={`Buon compleanno ${emp.first_name || emp.full_name.split(" ")[0]}!`} placement="right">
                          <span style={{ marginLeft: 4, fontSize: 13, verticalAlign: "middle", cursor: "default" }}>🎂</span>
                        </Tooltip>
                      )}
                    </Typography>
                    {emp.tms_role_description && (
                      <Typography className="planner-emp-role">{emp.tms_role_description}</Typography>
                    )}
                  </Box>
                  {empTeam && (
                    <Box title={empTeam.name} sx={{
                      width: 22, height: 22, borderRadius: "50%", background: empTeam.color,
                      display: "grid", placeItems: "center", fontSize: 12, flexShrink: 0,
                      boxShadow: `0 1px 4px ${empTeam.color}55`,
                    }}>
                      {empTeam.icon}
                    </Box>
                  )}
                </Box>
              );
            })}
            {plannerView === "areas" && areas.map((area) => {
              const color = areaColorMap[area.name] ?? AREA_PALETTE[0];
              const areaAssignments = assignmentsByArea[area.name] ?? [];
              const { numLanes } = computeLanes(areaAssignments);
              const rowH = Math.max(52, numLanes * LANE_H + 8);
              return (
                <Box key={area.id} className="planner-name-cell planner-area-name-cell" style={{ height: rowH }}>
                  <Box className="planner-area-dot" style={{ background: color.border }} />
                  <Box className="planner-name-text">
                    <Typography className="planner-emp-name">{area.name}</Typography>
                    {areaAssignments.length > 0 && (
                      <Typography className="planner-emp-role">{areaAssignments.length} pers.</Typography>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>

          {/* scrollable timeline */}
          <Box className="planner-scroll" onScroll={handleTimelineScroll}>
            {/* ── employee view ── */}
            {plannerView === "employees" && (
              <>
                {employees.length === 0 && !employeesQuery.isLoading && !allEmployeesQuery.isLoading && (
                  <Box className="planner-empty" style={{ width: TRACK_WIDTH }}>
                    {searchActive
                      ? `Nessun dipendente trovato per "${employeeSearch.trim()}".`
                      : "Nessun dipendente trovato per la squadra selezionata."}
                  </Box>
                )}
                {sortedItems.map((item) => {
                  if (item.type === "teamHeader") {
                    const t = item.team;
                    return (
                      <Box key={`th-${t?.id ?? "none"}`} style={{
                        height: 26, width: TRACK_WIDTH,
                        background: t ? t.color + "0d" : "#f5f5f7",
                        borderBottom: "1px solid var(--pl-border)",
                      }} />
                    );
                  }
                  const emp = item.employee;
                  const { blocks, ghost } = getDisplayBlocks(emp.id);
                  const absences = justificationsByEmployee[emp.id] ?? [];
                  return (
                    <Box
                      key={emp.id}
                      className="planner-track"
                      style={{ width: TRACK_WIDTH, ...(emp._isOrphan ? { cursor: "default" } : null) }}
                      ref={(el) => { trackRefs.current[emp.id] = el; }}
                      onPointerDown={emp._isOrphan ? undefined : (e) => startCreateDrag(e, emp.id)}
                    >
                      {absences.map((j) => {
                        const absStartH = timeToHour(j.start_time);
                        const absEndH = timeToHour(j.end_time);
                        const absDur = absEndH - absStartH;
                        const clampedLeft = Math.max(0, hourOffset(absStartH));
                        const clampedW = Math.max(6, absDur * HOUR_WIDTH);
                        return (
                          <Tooltip key={j.id} title={`Assenza${j.description ? ` — ${j.description}` : ""}  ·  ${formatHour(absStartH)}–${formatHour(absEndH)}`} placement="top">
                            <Box
                              className="planner-absence altro"
                              style={{ left: clampedLeft, width: clampedW, cursor: "not-allowed" }}
                            >
                              <span>🌴</span>
                              <Box sx={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1, overflow: "hidden" }}>
                                <span className="planner-absence-label">Assenza</span>
                                {j.description && <span className="planner-block-note">📝 {j.description}</span>}
                              </Box>
                            </Box>
                          </Tooltip>
                        );
                      })}
                      {blocks.map((a) => {
                        const startH = timeToHour(a.start_time);
                        const endH = timeToHour(a.end_time);
                        const dur = endH - startH;
                        const color = a.cause === "FORMAZIONE" ? TRAINING_COLOR : (areaColorMap[a.area ?? ""] ?? AREA_PALETTE[0]);
                        const isDragged = drag?.assignmentId === a.id;
                        const breakSegment = getBreakSegmentForAssignment(emp.id, a);
                        const morningPx = breakSegment ? Math.max(0, (breakSegment.startHour - startH) * HOUR_WIDTH - BLOCK_BODY_INSET) : 0;
                        const breakPx = breakSegment ? (breakSegment.endHour - breakSegment.startHour) * HOUR_WIDTH : 0;
                        const hasAfternoon = breakSegment ? endH > breakSegment.endHour : false;
                        // Immobile mostrato solo se ancora visibile nel Planner.
                        const displayImmobile = normalizeImmobile(a.area, a.immobile, areas);
                        return (
                          <Tooltip key={a.id} title={renderAssignmentTooltip({ ...a, immobile: displayImmobile }, startH, endH, breakSegment)} placement="top" arrow enterDelay={150}>
                            <Box
                              className={`planner-block${isDragged ? " is-dragging" : ""}`}
                              style={{ left: hourOffset(startH), width: dur * HOUR_WIDTH, background: color.bg, borderColor: color.border, color: color.text }}
                              onClick={(e) => openEditBlock(e, a)}
                            >
                              <Box className="planner-handle planner-handle-left" onPointerDown={(e) => startBlockDrag(e, "resize-start", a)} />
                              <Box
                                className={`planner-block-body${breakSegment ? " planner-block-body--segmented" : ""}`}
                                onPointerDown={(e) => startBlockDrag(e, "move", a)}
                              >
                                {breakSegment ? (
                                  <>
                                    {morningPx > 0 && (
                                      <Box className="planner-segment planner-segment-work" style={{ flex: `0 0 ${morningPx}px` }}>
                                        <span className="planner-block-area">{formatAssignmentPrimaryLabel(a, displayImmobile)}</span>
                                        {dur >= 2 && <span className="planner-block-time">{formatHour(startH)}–{formatHour(endH)}</span>}
                                        {a.notes && <span className="planner-block-note">📝 {a.notes}</span>}
                                      </Box>
                                    )}
                                    <Box className={`planner-segment planner-segment-break${canWritePlanning && !emp._isOrphan ? " is-editable" : ""}`} style={{ flex: `0 0 ${breakPx}px` }}>
                                      {canWritePlanning && !emp._isOrphan ? (
                                        <>
                                          <Box
                                            className="planner-break-handle planner-break-handle-left"
                                            onPointerDown={(e) => startBreakDrag(e, "break-resize-start", a)}
                                          />
                                          <Box
                                            className="planner-break-drag-zone"
                                            onPointerDown={(e) => startBreakDrag(e, "break-move", a)}
                                          >
                                            {breakPx >= 48 && <span className="planner-break-label">Pausa</span>}
                                          </Box>
                                          <Box
                                            className="planner-break-handle planner-break-handle-right"
                                            onPointerDown={(e) => startBreakDrag(e, "break-resize-end", a)}
                                          />
                                        </>
                                      ) : (
                                        breakPx >= 48 && <span className="planner-break-label">Pausa</span>
                                      )}
                                    </Box>
                                    {hasAfternoon && (
                                      <Box className="planner-segment planner-segment-work" style={{ flex: "1 1 0" }} />
                                    )}
                                  </>
                                ) : (
                                  <>
                                    <span className="planner-block-area">{formatAssignmentPrimaryLabel(a, displayImmobile)}</span>
                                    {dur >= 2 && <span className="planner-block-time">{formatHour(startH)}–{formatHour(endH)}</span>}
                                    {a.notes && <span className="planner-block-note">📝 {a.notes}</span>}
                                  </>
                                )}
                              </Box>
                              <Box className="planner-handle planner-handle-right" onPointerDown={(e) => startBlockDrag(e, "resize-end", a)} />
                              <button
                                className="planner-block-delete"
                                title="Elimina"
                                onClick={(e) => { e.stopPropagation(); if (canWritePlanning) deleteMutation.mutate(a.id); }}
                                onPointerDown={(e) => e.stopPropagation()}
                                disabled={!canWritePlanning}
                              >×</button>
                            </Box>
                          </Tooltip>
                        );
                      })}
                      {ghost && (
                        <Box
                          className="planner-block planner-ghost"
                          style={{ left: hourOffset(ghost.startHour), width: (ghost.endHour - ghost.startHour) * HOUR_WIDTH }}
                        />
                      )}
                    </Box>
                  );
                })}
              </>
            )}

            {/* ── area view (read-only) ── */}
            {plannerView === "areas" && areas.map((area) => {
              const color = areaColorMap[area.name] ?? AREA_PALETTE[0];
              const { assignments: laned, numLanes } = computeLanes(assignmentsByArea[area.name] ?? []);
              const rowH = Math.max(52, numLanes * LANE_H + 8);
              const blockH = LANE_H - 6;

              return (
                <Box
                  key={area.id}
                  className="planner-track planner-track-area"
                  style={{ width: TRACK_WIDTH, height: rowH }}
                >
                  {laned.map((a) => {
                    const startH = timeToHour(a.start_time);
                    const endH = timeToHour(a.end_time);
                    const dur = endH - startH;
                    const blockTop = 4 + a.lane * LANE_H;
                    const emp = employeeById[a.employee_id];
                    const breakSegment = getBreakSegmentForAssignment(a.employee_id, a);
                    const morningPx = breakSegment ? Math.max(0, (breakSegment.startHour - startH) * HOUR_WIDTH - AREA_BLOCK_BODY_INSET) : 0;
                    const breakPx = breakSegment ? (breakSegment.endHour - breakSegment.startHour) * HOUR_WIDTH : 0;
                    const hasAfternoon = breakSegment ? endH > breakSegment.endHour : false;
                    return (
                      <Tooltip key={a.id} title={renderAssignmentTooltip({ ...a, immobile: normalizeImmobile(a.area, a.immobile, areas) }, startH, endH, breakSegment)} placement="top" arrow enterDelay={150}>
                        <Box
                          className="planner-block planner-block-area-view"
                          style={{
                            left: hourOffset(startH),
                            width: dur * HOUR_WIDTH,
                            top: blockTop,
                            height: blockH,
                            background: color.bg,
                            borderColor: color.border,
                            color: color.text,
                          }}
                          onClick={(e) => openEditBlock(e, a)}
                        >
                          <Box className={`planner-block-body planner-area-block-body${breakSegment ? " planner-block-body--segmented" : ""}`}>
                            {breakSegment ? (
                              <>
                                {morningPx > 0 && (
                                  <Box className="planner-segment planner-segment-work" style={{ flex: `0 0 ${morningPx}px`, flexDirection: "row", alignItems: "center", gap: 5, padding: "0 5px" }}>
                                    {emp && <EmployeeAvatar employee={emp} size={20} />}
                                    <span className="planner-block-area">{a.employee_name}</span>
                                  </Box>
                                )}
                                <Box className="planner-segment planner-segment-break" style={{ flex: `0 0 ${breakPx}px` }}>
                                  {breakPx >= 48 && <span className="planner-break-label">Pausa</span>}
                                </Box>
                                {hasAfternoon && (
                                  <Box className="planner-segment planner-segment-work" style={{ flex: "1 1 0" }} />
                                )}
                              </>
                            ) : (
                              <>
                                {emp && <EmployeeAvatar employee={emp} size={20} />}
                                <span className="planner-block-area">{a.employee_name}</span>
                              </>
                            )}
                          </Box>
                          <button
                            className="planner-block-delete"
                            title="Elimina"
                            onClick={(e) => { e.stopPropagation(); if (canWritePlanning) deleteMutation.mutate(a.id); }}
                            onPointerDown={(e) => e.stopPropagation()}
                            disabled={!canWritePlanning}
                          >×</button>
                        </Box>
                      </Tooltip>
                    );
                  })}
                </Box>
              );
            })}
          </Box>
        </Box>
        </Box>

        {/* legend */}
        {areas.length > 0 && (
          <Box className="planner-legend">
            {areas.map((area) => {
              const color = areaColorMap[area.name] ?? AREA_PALETTE[0];
              return (
                <Box key={area.id} className="planner-legend-item">
                  <Box className="planner-legend-dot" style={{ background: color.border }} />
                  <span>{area.name}</span>
                </Box>
              );
            })}
            {plannerView === "employees" && (
              <Box className="planner-legend-item planner-legend-hint">
                <span>Trascina per creare · Ridimensiona con le maniglie · Clicca per modificare</span>
              </Box>
            )}
          </Box>
        )}
      </Paper>

      {/* ── Prenotazioni panel ───────────────────────────────────────── */}
      <Paper
        className="planner-prenotazioni-panel"
        sx={{
          width: prenotazioniCollapsed ? "auto" : 310,
          minWidth: prenotazioniCollapsed ? 64 : 310,
          flexShrink: 0,
          border: "1px solid var(--pl-border)",
          borderRadius: "18px",
          boxShadow: "var(--pl-shadow)",
          background: "var(--pl-surface)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Box sx={{ px: 2, py: 1.5, borderBottom: prenotazioniCollapsed ? "none" : "1px solid var(--pl-border)", background: darkMode ? "var(--pl-bg)" : "#fbfbfc", display: "flex", alignItems: "center", gap: 1 }}>
          <Tooltip title={prenotazioniCollapsed ? "Espandi prenotazioni" : "Comprimi prenotazioni"}>
            <button
              type="button"
              className={`planner-team-collapse-btn${prenotazioniCollapsed ? " is-collapsed" : ""}`}
              aria-label={prenotazioniCollapsed ? "Espandi prenotazioni" : "Comprimi prenotazioni"}
              onClick={() => setPrenotazioniCollapsed((v) => !v)}
            >
              ▾
            </button>
          </Tooltip>
          {!prenotazioniCollapsed && (
            <Typography sx={{ fontWeight: 700, fontSize: 13, color: "var(--pl-text)", flex: 1 }}>
              Prenotazioni
            </Typography>
          )}
          {prenotazioniQuery.isLoading && <CircularProgress size={14} />}
          {!prenotazioniQuery.isLoading && (
            <Chip
              label={prenotazioniFiltered.length === prenotazioniItems.length
                ? prenotazioniItems.length
                : `${prenotazioniFiltered.length}/${prenotazioniItems.length}`}
              size="small"
              sx={{ height: 20, fontSize: 11, fontWeight: 700, "& .MuiChip-label": { px: "6px" } }}
            />
          )}
        </Box>

        {!prenotazioniCollapsed && prenotazioniItems.length > 0 && (
          <Box sx={{ px: 2, py: 1.25, borderBottom: "1px solid var(--pl-border)", display: "flex", flexDirection: "column", gap: 1 }}>
            <FilterSelect
              label="Cliente"
              value={prenotazioniClientFilter}
              onChange={setPrenotazioniClientFilter}
              options={prenotazioniClientOptions}
              placeholder="Tutti i clienti"
              sx={{ width: "100%" }}
            />
            {canFilterPrenotazioniImport && (
            <ToggleButtonGroup
              value={prenotazioniImportFilter}
              exclusive
              fullWidth
              size="small"
              onChange={(_, value) => value && setPrenotazioniImportFilter(value)}
              sx={{ "& .MuiToggleButton-root": { textTransform: "none", fontSize: 10.5, fontWeight: 600, py: 0.4 } }}
            >
              <ToggleButton value="all">Tutte</ToggleButton>
              <ToggleButton value="imported">Importate</ToggleButton>
              <ToggleButton value="pending">Non importate</ToggleButton>
            </ToggleButtonGroup>
            )}
          </Box>
        )}

        {!prenotazioniCollapsed && (
        <Box sx={{ flex: 1, overflowY: "auto", maxHeight: 600 }}>
          {prenotazioniQuery.isError && (
            <Box sx={{ p: 2 }}>
              <Alert severity="warning" sx={{ fontSize: 12 }}>
                Impossibile caricare le prenotazioni
              </Alert>
            </Box>
          )}

          {!prenotazioniQuery.isLoading && !prenotazioniQuery.isError && prenotazioniFiltered.length === 0 && (
            <Box sx={{ p: 2, textAlign: "center" }}>
              <Typography sx={{ fontSize: 12, color: "var(--pl-faded)" }}>
                {prenotazioniItems.length === 0 ? "Nessuna prenotazione" : "Nessuna prenotazione con questi filtri"}
              </Typography>
            </Box>
          )}

          {prenotazioniFiltered.map((item, idx) => (
            <Box key={item.id}>
              {idx > 0 && <Divider />}
              <Box sx={{ px: 2, py: 1.5 }}>
                {/* ora + badge */}
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75 }}>
                  <Typography sx={{ fontSize: 15, fontWeight: 700, color: "var(--pl-text)" }}>
                    {item.prenotazione?.ora ?? "–"}
                  </Typography>
                  <Chip
                    label={item.tipo_movimento}
                    size="small"
                    sx={{
                      height: 18,
                      fontSize: 10,
                      fontWeight: 700,
                      "& .MuiChip-label": { px: "6px" },
                      background: item.tipo_movimento === "IN" ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.12)",
                      color: item.tipo_movimento === "IN" ? "#064e3b" : "#7f1d1d",
                      border: `1px solid ${item.tipo_movimento === "IN" ? "#059669" : "#dc2626"}`,
                    }}
                  />
                  <Chip
                    label={item.stato}
                    size="small"
                    sx={{
                      height: 18,
                      fontSize: 10,
                      fontWeight: 600,
                      "& .MuiChip-label": { px: "6px" },
                      background: "rgba(59,130,246,0.1)",
                      color: "#1e3a5f",
                      border: "1px solid #2563eb",
                    }}
                  />
                  <Box sx={{ flex: 1 }} />
                  <Link
                    href={`http://192.168.24.21/gesap_dev/sito/dettaglio_movimento.php?id=${item.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Apri nel portale"
                    sx={{ fontSize: 11, fontWeight: 600, color: "#007040", textDecoration: "none", display: "flex", alignItems: "center", gap: 0.25, "&:hover": { textDecoration: "underline" } }}
                  >
                    ToolTo ↗
                  </Link>
                </Box>

                {/* cliente */}
                <Box sx={{ display: "flex", gap: 0.5, mb: 0.4 }}>
                  <Typography sx={{ fontSize: 10.5, color: "var(--pl-faded)", fontWeight: 600, minWidth: 56 }}>Cliente</Typography>
                  <Typography sx={{ fontSize: 10.5, color: "var(--pl-text)", fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.cliente?.nome ?? "–"}</Typography>
                </Box>

                {/* fornitore */}
                <Box sx={{ display: "flex", gap: 0.5, mb: 0.4 }}>
                  <Typography sx={{ fontSize: 10.5, color: "var(--pl-faded)", fontWeight: 600, minWidth: 56 }}>Fornitore</Typography>
                  <Typography sx={{ fontSize: 10.5, color: "var(--pl-text)", fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.fornitore?.nome ?? "–"}</Typography>
                </Box>

                {/* vettore */}
                {item.vettore && (
                  <Box sx={{ display: "flex", gap: 0.5, mb: 0.4 }}>
                    <Typography sx={{ fontSize: 10.5, color: "var(--pl-faded)", fontWeight: 600, minWidth: 56 }}>Vettore</Typography>
                    <Typography sx={{ fontSize: 10.5, color: "var(--pl-text)", fontWeight: 500 }}>{item.vettore}</Typography>
                  </Box>
                )}

                {/* sede */}
                {item.sede?.nome && (
                  <Box sx={{ display: "flex", gap: 0.5, mb: 0.4 }}>
                    <Typography sx={{ fontSize: 10.5, color: "var(--pl-faded)", fontWeight: 600, minWidth: 56 }}>Sede</Typography>
                    <Typography sx={{ fontSize: 10.5, color: "var(--pl-text)", fontWeight: 500 }}>{item.sede.nome}</Typography>
                  </Box>
                )}

                {/* note */}
                {item.note && (
                  <Box sx={{ mt: 0.5, px: 1, py: 0.5, background: "var(--pl-bg)", borderRadius: "6px" }}>
                    <Typography sx={{ fontSize: 10.5, color: "var(--pl-subtle)", fontStyle: "italic" }}>{item.note}</Typography>
                  </Box>
                )}
                {item.workload && (
                  <Box sx={{ mt: 0.5, px: 1, py: 0.5, background: "var(--pl-bg)", borderRadius: "6px" }}>
                    <Typography sx={{ fontSize: 10.5, color: "var(--pl-subtle)", fontWeight: 600 }}>Carico di lavoro</Typography>
                    <Typography sx={{ fontSize: 10.5, color: "var(--pl-text)", whiteSpace: "pre-wrap" }}>{item.workload}</Typography>
                  </Box>
                )}
                {effectiveUser?.can_access_workloads && (
                  <Button
                    size="small"
                    variant={item.workload_imported ? "outlined" : "contained"}
                    fullWidth
                    sx={{ mt: 1, textTransform: "none", fontWeight: 700 }}
                    disabled={isCancelledGesapBooking(item)}
                    onClick={() => {
                      if (item.workload_imported) {
                        navigate(`/carichi?date=${item.prenotazione?.data || selectedDate}&teamId=${item.workload_team_id}`);
                        return;
                      }
                      setGesapImportItem(item);
                      setGesapImportTeamId("");
                      importGesapMutation.reset();
                    }}
                  >
                    {isCancelledGesapBooking(item)
                      ? "Prenotazione annullata"
                      : item.workload_imported
                        ? `Importata · ${item.workload_team_name || "Apri carico"}`
                        : "Importa nei carichi"}
                  </Button>
                )}
              </Box>
            </Box>
          ))}
        </Box>
        )}
      </Paper>

      </Box>

      <Dialog
        open={!!gesapImportItem}
        onClose={() => !importGesapMutation.isPending && setGesapImportItem(null)}
        PaperProps={{ className: "planner-dialog" }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle className="planner-dialog-title">Importa nei carichi</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Box sx={{ p: 1.5, border: "1px solid var(--pl-border)", borderRadius: 2 }}>
              <Typography variant="body2"><strong>Cliente:</strong> {gesapImportItem?.cliente?.nome || "–"}</Typography>
              <Typography variant="body2"><strong>Fornitore:</strong> {gesapImportItem?.fornitore?.nome || "–"}</Typography>
              <Typography variant="body2"><strong>Sede:</strong> {gesapImportItem?.sede?.nome || "–"}</Typography>
              <Typography variant="body2"><strong>Movimento:</strong> {gesapImportItem?.tipo_movimento || "–"}</Typography>
            </Box>
            <TextField
              select
              label="Squadra"
              value={gesapImportTeamId}
              onChange={(event) => setGesapImportTeamId(event.target.value)}
              size="small"
              fullWidth
            >
              <MenuItem value=""><em>Seleziona squadra</em></MenuItem>
              {(teamsQuery.data ?? []).map((team) => (
                <MenuItem key={team.id} value={team.id}>{team.icon} {team.name}</MenuItem>
              ))}
            </TextField>
            <Alert severity="info">
              Mezzi IN/OUT saranno impostati dal movimento ToolTo. Nei Carichi sarà modificabile soltanto il numero pallet.
            </Alert>
            {importGesapMutation.error && <Alert severity="error">{importGesapMutation.error.message}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGesapImportItem(null)} disabled={importGesapMutation.isPending}>Annulla</Button>
          <Button
            variant="contained"
            onClick={() => importGesapMutation.mutate()}
            disabled={!gesapImportTeamId || importGesapMutation.isPending}
          >
            {importGesapMutation.isPending ? "Importazione…" : "Importa"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Area picker ─────────────────────────────────────────────── */}
      <Dialog open={!!areaPickerState} onClose={() => setAreaPickerState(null)} PaperProps={{ className: "planner-dialog" }}>
        <DialogTitle className="planner-dialog-title">
          {areaPickerState?.mode === "formazione" ? "Ore di formazione" : "Seleziona building"}
          {areaPickerState && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {formatHour(areaPickerState.startHour)} – {formatHour(areaPickerState.endHour)}
              &nbsp;·&nbsp;{Number((areaPickerState.endHour - areaPickerState.startHour).toFixed(2))} h
            </Typography>
          )}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {isAdmin && (
              <TextField
                select
                label="Tipo"
                value={areaPickerState?.mode ?? "presenza"}
                onChange={(e) => setAreaPickerState((current) => current ? { ...current, mode: e.target.value } : current)}
                fullWidth
                size="small"
              >
                <MenuItem value="presenza">Presenza</MenuItem>
                <MenuItem value="formazione">Formazione</MenuItem>
              </TextField>
            )}
            {areaPickerState?.mode === "formazione" ? (
              <TextField
                select
                label="Titolo corso"
                value={areaPickerState?.trainingCourseId ?? ""}
                onChange={(e) => setAreaPickerState((current) => current ? { ...current, trainingCourseId: e.target.value } : current)}
                fullWidth
                size="small"
                helperText={trainingCourses.length === 0 ? "Nessun corso configurato: aggiungili in Configurazione → Formazione." : undefined}
              >
                <MenuItem value="">Seleziona corso</MenuItem>
                {trainingCourses.map((course) => (
                  <MenuItem key={course.id} value={course.id}>{course.title}</MenuItem>
                ))}
              </TextField>
            ) : (
              <>
                <TextField
                  select
                  label="Building"
                  value={areaPickerState?.area ?? ""}
                  onChange={(e) => {
                    const nextArea = e.target.value;
                    setAreaPickerState((current) => {
                      if (!current) return current;
                      const immobileOptions = getImmobileOptions(nextArea, areas);
                      const nextImmobile = immobileOptions.includes(current.immobile) ? current.immobile : "";
                      return { ...current, area: nextArea, immobile: nextImmobile };
                    });
                  }}
                  fullWidth
                  size="small"
                >
                  <MenuItem value="">Seleziona building</MenuItem>
                  {areas.map((area) => <MenuItem key={area.id} value={area.name}>{area.name}</MenuItem>)}
                </TextField>
                {getImmobileOptions(areaPickerState?.area, areas).length > 0 && (
                  <TextField
                    select
                    label="Immobile"
                    value={areaPickerState?.immobile ?? ""}
                    onChange={(e) => setAreaPickerState((current) => current ? { ...current, immobile: e.target.value } : current)}
                    fullWidth
                    size="small"
                  >
                    <MenuItem value="">Seleziona immobile</MenuItem>
                    {getImmobileOptions(areaPickerState?.area, areas).map((immobile) => (
                      <MenuItem key={immobile} value={immobile}>{immobile}</MenuItem>
                    ))}
                  </TextField>
                )}
              </>
            )}
            <TextField
              label="Note"
              value={areaPickerState?.notes ?? ""}
              onChange={(e) => setAreaPickerState((current) => current ? { ...current, notes: e.target.value } : current)}
              multiline
              minRows={2}
              fullWidth
              size="small"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAreaPickerState(null)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={
              !canWritePlanning
              || createMutation.isPending
              || (areaPickerState?.mode === "formazione"
                ? !areaPickerState?.trainingCourseId
                : (!areaPickerState?.area
                    || (getImmobileOptions(areaPickerState?.area, areas).length > 0 && !normalizeImmobile(areaPickerState?.area, areaPickerState?.immobile, areas))))
            }
            onClick={() => {
              if (!areaPickerState) return;
              const base = {
                employee_id: areaPickerState.employeeId,
                work_date: selectedDate,
                start_time: hourToTime(areaPickerState.startHour),
                end_time: hourToTime(areaPickerState.endHour),
                notes: areaPickerState.notes?.trim() || null,
              };
              if (areaPickerState.mode === "formazione") {
                createMutation.mutate({
                  ...base,
                  cause: "FORMAZIONE",
                  training_course_id: areaPickerState.trainingCourseId,
                });
              } else {
                createMutation.mutate({
                  ...base,
                  area: areaPickerState.area,
                  immobile: normalizeImmobile(areaPickerState.area, areaPickerState.immobile, areas),
                  cause: "PRESENZA",
                });
              }
            }}
          >
            {createMutation.isPending ? "Salvataggio…" : "Conferma"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Block edit dialog ───────────────────────────────────────── */}
      <Dialog open={!!editingBlock} onClose={() => setEditingBlock(null)} PaperProps={{ className: "planner-dialog" }}>
        <DialogTitle className="planner-dialog-title">
          Modifica assegnazione
          {editingBlock && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {formatHour(timeToHour(editingBlock.start_time))} – {formatHour(timeToHour(editingBlock.end_time))}
              &nbsp;·&nbsp;{editingBlock.employee_name ?? ""}
            </Typography>
          )}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {editingBlock?.cause === "FORMAZIONE" ? (
              <TextField
                select
                label="Titolo corso"
                value={editForm.trainingCourseId ?? ""}
                onChange={(e) => setEditForm((f) => ({ ...f, trainingCourseId: e.target.value }))}
                fullWidth
                size="small"
              >
                <MenuItem value="">Seleziona corso</MenuItem>
                {trainingCourses
                  .filter((c) => c.is_active || c.id === editForm.trainingCourseId)
                  .map((course) => <MenuItem key={course.id} value={course.id}>{course.title}</MenuItem>)}
              </TextField>
            ) : (
              <>
                <TextField
                  select
                  label="Building"
                  value={editForm.area ?? ""}
                  onChange={(e) => {
                    const nextArea = e.target.value;
                    setEditForm((f) => {
                      const immobileOptions = getImmobileOptions(nextArea, areas);
                      const nextImmobile = immobileOptions.includes(f.immobile) ? f.immobile : "";
                      return { ...f, area: nextArea, immobile: nextImmobile };
                    });
                  }}
                  fullWidth
                  size="small"
                >
                  <MenuItem value="">Nessun building</MenuItem>
                  {areas.map((area) => <MenuItem key={area.id} value={area.name}>{area.name}</MenuItem>)}
                </TextField>
                {getImmobileOptions(editForm.area, areas).length > 0 && (
                  <TextField
                    select
                    label="Immobile"
                    value={editForm.immobile ?? ""}
                    onChange={(e) => setEditForm((f) => ({ ...f, immobile: e.target.value }))}
                    fullWidth
                    size="small"
                  >
                    <MenuItem value="">Seleziona immobile</MenuItem>
                    {getImmobileOptions(editForm.area, areas).map((immobile) => (
                      <MenuItem key={immobile} value={immobile}>{immobile}</MenuItem>
                    ))}
                  </TextField>
                )}
              </>
            )}
            <TextField label="Note" value={editForm.notes ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} multiline minRows={2} fullWidth size="small" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button color="error" onClick={() => { if (editingBlock && canWritePlanning) deleteMutation.mutate(editingBlock.id); }} disabled={!canWritePlanning || deleteMutation.isPending}>
            {deleteMutation.isPending ? "Eliminazione…" : "Elimina"}
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setEditingBlock(null)}>Annulla</Button>
          <Button
            variant="contained"
            onClick={saveEditBlock}
            disabled={
              !canWritePlanning
              || updateMutation.isPending
              || (getImmobileOptions(editForm.area, areas).length > 0 && !normalizeImmobile(editForm.area, editForm.immobile, areas))
            }
          >
            {updateMutation.isPending ? "Salvataggio…" : "Salva"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Copia da dialog ─────────────────────────────────────────── */}
      <Dialog open={copyFromOpen} onClose={() => setCopyFromOpen(false)} PaperProps={{ className: "planner-dialog" }}>
        <DialogTitle className="planner-dialog-title">Copia allocazioni da un giorno precedente</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              type="date"
              label="Giorno di origine"
              value={copyFromDate}
              onChange={(e) => {
                setCopyFromDate(e.target.value);
                setCopyFromTeamIds(null);
                setCopyFromNoteIds(new Set());
                setExpandedCopyTeams(new Set());
              }}
              inputProps={{ max: dayjs(selectedDate).subtract(1, "day").format("YYYY-MM-DD") }}
              InputLabelProps={{ shrink: true }}
              fullWidth
              size="small"
            />
            {copyFromDate && (
              <Box sx={{ px: 1.5, py: 1, border: "1px solid var(--pl-border, #e2e2e5)", borderRadius: 1.5 }}>
                <Typography variant="subtitle2" sx={{ mb: 0.25 }}>Squadre da copiare</Typography>
                {copySourceQuery.isLoading ? (
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 1 }}>
                    <CircularProgress size={16} />
                    <Typography variant="body2" color="text.secondary">Caricamento allocazioni…</Typography>
                  </Stack>
                ) : copySourceTeams.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ py: 0.5 }}>
                    Nessuna allocazione nel giorno selezionato.
                  </Typography>
                ) : (
                  <>
                    <FormControlLabel
                      control={
                        <Checkbox
                          size="small"
                          checked={allCopyTeamsSelected}
                          indeterminate={!allCopyTeamsSelected && anyCopyTeamSelected}
                          onChange={toggleCopyAllTeams}
                        />
                      }
                      label="Tutte le squadre"
                      sx={{ display: "flex" }}
                      componentsProps={{ typography: { fontWeight: 700 } }}
                    />
                    <Divider sx={{ my: 0.5 }} />
                    <Box sx={{ maxHeight: 240, overflowY: "auto" }}>
                      {copySourceTeams.map((team) => (
                        <Box key={team.id}>
                          <Stack direction="row" alignItems="center">
                            <FormControlLabel
                              control={
                                <Checkbox
                                  size="small"
                                  checked={copyTeamSelection.has(team.id)}
                                  onChange={() => toggleCopyTeam(team.id)}
                                />
                              }
                              label={
                                <ListItemText
                                  primary={`${team.icon ? `${team.icon} ` : ""}${team.name}`}
                                  secondary={`${team.count} ${team.count === 1 ? "allocazione" : "allocazioni"}`}
                                />
                              }
                              sx={{ display: "flex", flex: 1, mr: 0 }}
                            />
                            {team.notedAssignments.length > 0 && copyTeamSelection.has(team.id) && (
                              <Button
                                size="small"
                                onClick={() => toggleCopyTeamDetails(team.id)}
                                aria-expanded={expandedCopyTeams.has(team.id)}
                                sx={{ minWidth: 0, whiteSpace: "nowrap" }}
                              >
                                {expandedCopyTeams.has(team.id) ? "Nascondi note" : `Note (${team.notedAssignments.length})`}
                              </Button>
                            )}
                          </Stack>
                          {expandedCopyTeams.has(team.id) && copyTeamSelection.has(team.id) && (
                            <Box sx={{ ml: 4, mb: 1, pl: 1.5, borderLeft: "2px solid var(--pl-border, #e2e2e5)" }}>
                              <FormControlLabel
                                control={
                                  <Checkbox
                                    size="small"
                                    checked={team.notedAssignments.every((assignment) => copyFromNoteIds.has(assignment.id))}
                                    indeterminate={
                                      team.notedAssignments.some((assignment) => copyFromNoteIds.has(assignment.id))
                                      && !team.notedAssignments.every((assignment) => copyFromNoteIds.has(assignment.id))
                                    }
                                    onChange={() => toggleAllCopyNotes(team)}
                                  />
                                }
                                label="Copia tutte le note della squadra"
                                componentsProps={{ typography: { variant: "caption", fontWeight: 700 } }}
                              />
                              {team.notedAssignments.map((assignment) => (
                                <FormControlLabel
                                  key={assignment.id}
                                  control={
                                    <Checkbox
                                      size="small"
                                      checked={copyFromNoteIds.has(assignment.id)}
                                      onChange={() => toggleCopyNote(assignment.id)}
                                    />
                                  }
                                  label={
                                    <ListItemText
                                      primary={`${assignment.employeeName}${assignment.startTime && assignment.endTime ? ` · ${assignment.startTime}-${assignment.endTime}` : ""}`}
                                      secondary={assignment.notes}
                                      secondaryTypographyProps={{ sx: { whiteSpace: "pre-wrap" } }}
                                    />
                                  }
                                  sx={{ display: "flex", alignItems: "flex-start" }}
                                />
                              ))}
                            </Box>
                          )}
                        </Box>
                      ))}
                    </Box>
                  </>
                )}
              </Box>
            )}
            <Alert severity="info" sx={{ fontSize: 13 }}>
              Verranno copiati i blocchi delle squadre selezionate verso il <strong>{dayjs(selectedDate).format("D MMMM YYYY")}</strong>.
              {copyFromNoteIds.size > 0 && <> Saranno copiate anche {copyFromNoteIds.size} {copyFromNoteIds.size === 1 ? "nota selezionata" : "note selezionate"}.</>}
              Le sovrapposizioni verranno ignorate automaticamente.
            </Alert>
            {copyFromMutation.error && <Alert severity="error">{String(copyFromMutation.error.message)}</Alert>}
            {copyFromMutation.isSuccess && (
              <Alert severity="success">{copyFromMutation.data?.length ?? 0} allocazioni copiate.</Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCopyFromOpen(false)}>Annulla</Button>
          <Button
            variant="contained"
            disabled={!canWritePlanning || !copyFromDate || !anyCopyTeamSelected || copyFromMutation.isPending}
            onClick={() => copyFromMutation.mutate({ sourceDate: copyFromDate, teamIds: copyFromTeamIds, noteIds: copyFromNoteIds })}
          >
            {copyFromMutation.isPending ? "Copia in corso…" : "Copia"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Pulisci pianificazione dialog ─────────────────────────── */}
      <Dialog
        open={clearDayOpen}
        onClose={() => !clearDayMutation.isPending && setClearDayOpen(false)}
        PaperProps={{ className: "planner-dialog" }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle className="planner-dialog-title">Pulisci pianificazione</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="warning">
              Stai per eliminare tutte le allocazioni del <strong>{dayjs(selectedDate).format("D MMMM YYYY")}</strong>.
            </Alert>
            <Typography variant="body2" color="text.secondary">
              Totale allocazioni da rimuovere: <strong>{assignmentsQuery.data?.length ?? 0}</strong>
            </Typography>
            <Typography variant="body2" color="text.secondary">
              L'operazione non salva un backup e non può essere annullata automaticamente.
            </Typography>
            {clearDayMutation.error && <Alert severity="error">{String(clearDayMutation.error.message)}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearDayOpen(false)} disabled={clearDayMutation.isPending}>
            Annulla
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => clearDayMutation.mutate()}
            disabled={!canWritePlanning || (assignmentsQuery.data?.length ?? 0) === 0 || clearDayMutation.isPending}
          >
            {clearDayMutation.isPending ? "Eliminazione…" : "Conferma eliminazione"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Report riepilogo dialog ──────────────────────────────────── */}
      <Dialog open={reportOpen} onClose={() => setReportOpen(false)} PaperProps={{ className: "planner-dialog" }} maxWidth="sm" fullWidth>
        <DialogTitle className="planner-dialog-title">
          Riepilogo allocazioni
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {dayjs(selectedDate).format("dddd D MMMM YYYY")}
          </Typography>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1, px: 1.5, py: 1, border: "1px solid var(--pl-border, #e2e2e5)", borderRadius: 1.5 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.75 }}>Raggruppa per</Typography>
            <ToggleButtonGroup
              value={reportGrouping}
              exclusive
              fullWidth
              size="small"
              onChange={(_, value) => value && setReportGrouping(value)}
              aria-label="Raggruppamento riepilogo allocazioni"
            >
              <ToggleButton value="team">Squadra</ToggleButton>
              <ToggleButton value="building">Area / Immobile</ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
              {reportGrouping === "building"
                ? "Le persone sono raggruppate prima per Area e poi per Immobile. Nelle Aree senza immobili sono elencate direttamente sotto l’Area. Il carico di lavoro segue le aree indicate nella colonna «Mag» delle righe."
                : "Le persone e il carico di lavoro sono organizzati in base alla squadra di appartenenza."}
            </Typography>
          </Box>
          <Box sx={{ mt: 1, px: 1.5, py: 1, border: "1px solid var(--pl-border, #e2e2e5)", borderRadius: 1.5 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.25 }}>Perimetro del riepilogo</Typography>
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={reportScope.allEmployees}
                  onChange={() => toggleReportScopeFilter("allEmployees")}
                />
              }
              label="Tutti i dipendenti"
              sx={{ display: "flex" }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={reportScope.byTeam}
                  onChange={() => toggleReportScopeFilter("byTeam")}
                />
              }
              label="Filtra per squadra"
              sx={{ display: "flex" }}
            />
            {reportScope.byTeam && (
              <FilterSelect
                label="Squadre"
                multiple
                value={reportScope.teamIds}
                onChange={(values) => setReportScopeValues("teamIds", values)}
                options={reportTeamOptions}
                sx={{ mt: 0.5, mb: 1, width: "100%" }}
              />
            )}
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={reportScope.byRole}
                  onChange={() => toggleReportScopeFilter("byRole")}
                />
              }
              label="Filtra per ruolo"
              sx={{ display: "flex" }}
            />
            {reportScope.byRole && (
              <FilterSelect
                label="Ruoli"
                multiple
                value={reportScope.roles}
                onChange={(values) => setReportScopeValues("roles", values)}
                options={reportRoleOptions}
                sx={{ mt: 0.5, mb: 1, width: "100%" }}
              />
            )}
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={reportScope.byArea}
                  onChange={() => toggleReportScopeFilter("byArea")}
                />
              }
              label="Filtra per area operativa"
              sx={{ display: "flex" }}
            />
            {reportScope.byArea && (
              <FilterSelect
                label="Aree operative"
                multiple
                value={reportScope.areaNames}
                onChange={(values) => setReportScopeValues("areaNames", values)}
                options={reportAreaOptions}
                sx={{ mt: 0.5, mb: 1, width: "100%" }}
              />
            )}
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={reportScope.byImmobile}
                  onChange={() => toggleReportScopeFilter("byImmobile")}
                />
              }
              label="Filtra per immobile"
              sx={{ display: "flex" }}
            />
            {reportScope.byImmobile && (
              <FilterSelect
                label="Immobili"
                multiple
                value={reportScope.immobili}
                onChange={(values) => setReportScopeValues("immobili", values)}
                options={reportImmobileOptions}
                sx={{ mt: 0.5, mb: 1, width: "100%" }}
              />
            )}
          </Box>
          <TextField
            multiline
            fullWidth
            value={reportOpen ? generateReportText() : ""}
            InputProps={{ readOnly: true }}
            minRows={8}
            maxRows={20}
            size="small"
            onFocus={(e) => e.target.select()}
            sx={{ mt: 1.5, "& textarea": { fontFamily: "monospace", fontSize: 13, lineHeight: 1.6 } }}
          />
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={exportReportPdf}>
            Esporta PDF
          </Button>
          <Button onClick={() => setReportOpen(false)}>Chiudi</Button>
        </DialogActions>
      </Dialog>

      {/* ── Team workload dialog ─────────────────────────────────── */}
      <Dialog open={!!teamWorkloadEdit} onClose={() => setTeamWorkloadEdit(null)} PaperProps={{ className: "planner-dialog" }}>
        <DialogTitle className="planner-dialog-title">
          {teamWorkloadEdit?.teamIcon} {teamWorkloadEdit?.teamName}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Carico di lavoro · {dayjs(selectedDate).format("D MMMM YYYY")}
          </Typography>
        </DialogTitle>
        <DialogContent>
          {teamWorkloadEdit?.workload && (
            <Box sx={{
              mt: 1, mb: 2, p: 1.5,
              background: teamWorkloadEdit.teamColor ? teamWorkloadEdit.teamColor + "12" : "var(--pl-bg)",
              border: `1px solid ${teamWorkloadEdit.teamColor ? teamWorkloadEdit.teamColor + "40" : "var(--pl-border)"}`,
              borderRadius: "10px",
            }}>
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: teamWorkloadEdit.teamColor ?? "var(--pl-faded)", mb: 0.5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Carico attuale
              </Typography>
              <Typography sx={{ fontSize: 13, color: "var(--pl-text)", whiteSpace: "pre-wrap", lineHeight: 1.55 }}>
                {teamWorkloadEdit.workload}
              </Typography>
            </Box>
          )}
          <TextField
            label="Modifica carico di lavoro"
            value={teamWorkloadEdit?.workload ?? ""}
            onChange={(e) => setTeamWorkloadEdit((s) => s ? { ...s, workload: e.target.value } : s)}
            multiline
            minRows={3}
            fullWidth
            size="small"
            placeholder="Descrivi il carico di lavoro per questa squadra…"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTeamWorkloadEdit(null)}>Annulla</Button>
          <Button
            variant="contained"
            onClick={() => {
              if (!teamWorkloadEdit) return;
              upsertTeamDailyNoteMutation.mutate({ teamId: teamWorkloadEdit.teamId, workload: teamWorkloadEdit.workload?.trim() || null });
            }}
            disabled={upsertTeamDailyNoteMutation.isPending}
          >
            {upsertTeamDailyNoteMutation.isPending ? "Salvataggio…" : "Salva"}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!generateSnackbar}
        autoHideDuration={4000}
        onClose={() => setGenerateSnackbar(null)}
        message={generateSnackbar}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Stack>
  );
}
