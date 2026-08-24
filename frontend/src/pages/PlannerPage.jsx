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
  Menu,
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

// Viste salvate: solo i filtri, per browser (come il tema chiaro/scuro in ThemeContext).
// Nessun salvataggio lato server: cambiando PC/browser le viste non seguono l'utente.
const PLANNER_VIEWS_STORAGE_KEY = "thub-planner-views";

function loadPlannerViews() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PLANNER_VIEWS_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePlannerViewsToStorage(views) {
  try {
    localStorage.setItem(PLANNER_VIEWS_STORAGE_KEY, JSON.stringify(views));
  } catch {}
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

// Raccoglitore delle allocazioni senza area, con la stessa etichetta usata
// dalla card "In Planner oggi" della dashboard.
const NO_AREA_KEY = "Senza area";

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
// Visita di idoneità: verde acqua, per non confonderla né con la formazione né con
// le aree operative.
const MEDICAL_CHECK_COLOR = { bg: "#e0f2f1", border: "#00897b", text: "#00695c" };
function formatAssignmentPrimaryLabel(a, immobile) {
  if (a.cause === "FORMAZIONE") {
    return a.training_course_title ? `🎓 ${a.training_course_title}` : "🎓 Formazione";
  }
  if (a.cause === "VISITA_IDONEITA") return "🩺 Visita idoneità";
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
  // 08:00-18:00 e' il marcatore corrente della giornata intera, 08:00-17:00 quello
  // storico: entrambi vanno letti come giornata intera, non come assenza a ore.
  if (
    isRangeMatch(justification.start_time, justification.end_time, "08:00", "18:00")
    || isRangeMatch(justification.start_time, justification.end_time, "08:00", "17:00")
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
  const meta = [allocation.role, allocation.timeRange].filter(Boolean).join(", ");
  return meta ? `${allocation.name} (${meta})` : allocation.name;
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
  const [duplicateTargetId, setDuplicateTargetId] = useState("");
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
  // Perimetro del riepilogo: elenco vuoto = tutte le squadre.
  const [reportTeamIds, setReportTeamIds] = useState([]);
  const [teamWorkloadEdit, setTeamWorkloadEdit] = useState(null);
  const [sortMode, setSortMode] = useState("team"); // "alpha" | "team"
  const { darkMode } = useAppTheme();

  const [savedPlannerViews, setSavedPlannerViews] = useState(loadPlannerViews);
  const [viewsMenuAnchor, setViewsMenuAnchor] = useState(null);
  const [saveViewDialogOpen, setSaveViewDialogOpen] = useState(false);
  const [saveViewName, setSaveViewName] = useState("");

  const applySavedPlannerView = useCallback((view) => {
    setPlannerView(view.plannerView);
    setRoleFilter(view.roleFilter);
    setTeamFilter(view.teamFilter);
    setEmployeeSearch(view.employeeSearch);
    setSortMode(view.sortMode);
    setViewsMenuAnchor(null);
  }, []);

  const handleSavePlannerView = useCallback(() => {
    const name = saveViewName.trim();
    if (!name) return;
    const newView = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      plannerView,
      roleFilter,
      teamFilter,
      employeeSearch,
      sortMode,
    };
    setSavedPlannerViews((prev) => {
      const next = [...prev.filter((v) => v.name !== name), newView];
      savePlannerViewsToStorage(next);
      return next;
    });
    setSaveViewName("");
    setSaveViewDialogOpen(false);
  }, [saveViewName, plannerView, roleFilter, teamFilter, employeeSearch, sortMode]);

  const handleDeletePlannerView = useCallback((id) => {
    setSavedPlannerViews((prev) => {
      const next = prev.filter((v) => v.id !== id);
      savePlannerViewsToStorage(next);
      return next;
    });
  }, []);

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
  // Visita di idoneità: perimetro piu' largo della formazione, come il gate del
  // backend (api/assignments.py MEDICAL_CHECK_ROLES).
  const isManager = effectiveUser?.effective_role === "manager";
  const canUseMedicalCheck = isAdmin || isHrTrainer || isManager;
  // Tipi selezionabili nel dialog: sotto i due non si mostra nemmeno la select.
  const availableBlockModes = [
    ...(isHrTrainer ? [] : ["presenza"]),
    ...(canUseTraining ? ["formazione"] : []),
    ...(canUseMedicalCheck ? ["visita"] : []),
  ];

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

  // Duplica l'allocazione aperta nel dialog su un altro dipendente della
  // stessa squadra: a differenza di "Copia da giorno" (che copia per data,
  // stesso dipendente) qui la data resta quella corrente e cambia la persona.
  const duplicateToEmployeeMutation = useMutation({
    mutationFn: ({ source, employeeId }) => createAssignment({
      employee_id: employeeId,
      work_date: selectedDate,
      start_time: typeof source.start_time === "string" ? source.start_time.slice(0, 5) : source.start_time,
      end_time: typeof source.end_time === "string" ? source.end_time.slice(0, 5) : source.end_time,
      break_start: source.break_start ? String(source.break_start).slice(0, 5) : null,
      break_end: source.break_end ? String(source.break_end).slice(0, 5) : null,
      area: source.area,
      immobile: source.immobile,
      cause: source.cause,
      notes: source.notes ?? null,
      training_course_id: source.training_course_id ?? null,
    }),
    onSuccess: (_created, { employeeId }) => {
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      queryClient.invalidateQueries({ queryKey: ["planner-day-audit"] });
      const target = duplicateCandidates.find((candidate) => candidate.id === employeeId);
      setGenerateSnackbar(`Allocazione duplicata su ${target?.name ?? "collega"}`);
      setDuplicateTargetId("");
    },
    onError: (error) => {
      setGenerateSnackbar(error?.message || "Duplicazione non riuscita.");
    },
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
    setDuplicateTargetId("");
  }

  // Colleghi della stessa squadra su cui si può duplicare l'allocazione aperta:
  // esclude il dipendente sorgente e chi è fuori dallo scope di scrittura
  // dell'utente (employeesQuery è già filtrata lato server per planner_access_level).
  const duplicateCandidates = useMemo(() => {
    if (!editingBlock) return [];
    const team = employeeTeamMap[editingBlock.employee_id];
    if (!team) return [];
    const writableIds = new Set((employeesQuery.data ?? []).map((employee) => employee.id));
    return team.members
      .filter((member) => member.employee_id !== editingBlock.employee_id && writableIds.has(member.employee_id))
      .map((member) => ({ id: member.employee_id, name: member.employee_name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [editingBlock, employeeTeamMap, employeesQuery.data]);

  function saveEditBlock() {
    if (!editingBlock || !canWritePlanning) return;
    const payload = editingBlock.cause === "FORMAZIONE"
      ? { training_course_id: editForm.trainingCourseId || null, notes: editForm.notes || null }
      : editingBlock.cause === "VISITA_IDONEITA"
      ? { notes: editForm.notes || null }
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

  // Il riepilogo ha una struttura fissa: assenze in alto, personale in turno
  // raggruppato per area+immobile con la stessa chiave della card "In Planner
  // oggi" della home, carichi di lavoro per squadra in fondo.
  function buildReportData() {
    const dateLabel = dayjs(selectedDate).format("dddd D MMMM YYYY");

    // Perimetro del riepilogo: la squadra e' l'unico filtro; senza squadre
    // selezionate il riepilogo comprende tutti i dipendenti.
    const teamFilterActive = reportTeamIds.length > 0;
    const employeeInScope = (employeeId) => {
      if (!teamFilterActive) return true;
      const teamKey = employeeTeamMap[employeeId]?.id ?? NO_TEAM_KEY;
      return reportTeamIds.includes(teamKey);
    };

    const teamNameById = Object.fromEntries((teamsQuery.data ?? []).map((team) => [team.id, team.name]));
    const scopeLabel = teamFilterActive
      ? `Squadre: ${reportTeamIds.map((id) => (id === NO_TEAM_KEY ? "Senza squadra" : teamNameById[id] ?? id)).join(", ")} (assenti: elenco completo)`
      : null;

    // Le assenze restano sempre complete, a prescindere dal perimetro:
    // il filtro si applica solo alle allocazioni.
    const absences = (justificationsQuery.data ?? [])
      .map((j) => ({
        name: employeeById[j.employee_id]?.full_name ?? "–",
        displayLabel: getAbsenceDisplayLabel(j),
        note: j.description?.trim() || null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Stessa logica della dashboard (backend/app/api/dashboard.py): la chiave e'
    // "Area Immobile" (es. "Kimberly K1"), chi non ha area finisce in "Senza
    // area" e chi lavora su piu' aree compare in ognuna.
    const groupsByKey = {};
    const allocationsPerEmployee = {};
    let allocationCount = 0;
    for (const assignment of assignmentsQuery.data ?? []) {
      if (!employeeInScope(assignment.employee_id)) continue;
      allocationCount += 1;
      const areaName = String(assignment.area ?? "").trim();
      const immobile = String(assignment.immobile ?? "").trim();
      const key = [areaName, immobile].filter(Boolean).join(" ") || NO_AREA_KEY;
      if (!groupsByKey[key]) {
        groupsByKey[key] = {
          id: `area:${key}`,
          name: key,
          color: areaColorMap[areaName]?.border ?? "#006f3d",
          allocations: [],
        };
      }
      allocationsPerEmployee[assignment.employee_id] = (allocationsPerEmployee[assignment.employee_id] ?? 0) + 1;
      groupsByKey[key].allocations.push({
        employeeId: assignment.employee_id,
        name: assignment.employee_name ?? employeeById[assignment.employee_id]?.full_name ?? "–",
        // Ruolo TMS del dipendente (es. "Magazziniere", "Officina"): a
        // differenza di area/immobile non cambia quando si sposta il turno.
        role: employeeById[assignment.employee_id]?.tms_role_description || null,
        note: assignment.notes?.trim() || null,
        startTime: String(assignment.start_time ?? "").slice(0, 5),
        timeRange: formatTimeRange(assignment.start_time, assignment.end_time),
      });
    }

    const areaGroups = Object.values(groupsByKey)
      .map((group) => ({
        ...group,
        allocations: group.allocations
          .slice()
          .sort(compareAllocations)
          // L'orario si mostra solo a chi ha piu' di un'allocazione nella
          // giornata: per gli altri e' rumore, qui serve a capire quando la
          // persona sta in K1 e quando in K2.
          .map((allocation) => (
            allocationsPerEmployee[allocation.employeeId] > 1
              ? allocation
              : { ...allocation, timeRange: null }
          )),
        peopleCount: new Set(group.allocations.map((allocation) => allocation.employeeId)).size,
      }))
      // "Senza area" in coda: e' il raccoglitore, non un'area vera.
      .sort((a, b) =>
        Number(a.name === NO_AREA_KEY) - Number(b.name === NO_AREA_KEY)
        || a.name.localeCompare(b.name));

    // Il carico di lavoro e' un dato di squadra: resta diviso per squadra
    // anche se le persone qui sopra sono raggruppate per area.
    // Il pallet segue il mezzo (come in WorkloadPage): su una riga mista
    // l'inbound ha la precedenza, quindi il pallet conta come IN.
    const sumWorkload = (rows) => rows.reduce((acc, row) => {
      const inbound = Number(row.inbound_count || 0);
      const outbound = Number(row.outbound_count || 0);
      const pallets = Number(row.pallet_count || 0);
      return {
        inb: acc.inb + inbound,
        out: acc.out + outbound,
        plt: acc.plt + pallets,
        pltIn: acc.pltIn + (inbound > 0 ? pallets : 0),
        pltOut: acc.pltOut + (inbound === 0 && outbound > 0 ? pallets : 0),
      };
    }, { inb: 0, out: 0, plt: 0, pltIn: 0, pltOut: 0 });

    const workloadTeams = (teamsQuery.data ?? [])
      .filter((team) => !teamFilterActive || reportTeamIds.includes(team.id))
      .map((team) => {
        const rows = teamWorkloadRowsByTeamId[team.id] ?? [];
        return {
          id: team.id,
          name: team.name,
          icon: team.icon ?? "👥",
          color: team.color ?? "#5f6b7a",
          // Owner predefinito della squadra; in mancanza, chi ha compilato il carico.
          ownerName: team.workload_owner_employee_name ?? teamWorkloadOwnerByTeamId[team.id] ?? null,
          rows,
          workload: teamWorkloadByTeamId[team.id] ?? null,
          totals: sumWorkload(rows),
        };
      })
      .filter((team) => team.rows.length > 0 || Boolean(team.workload))
      .sort((a, b) => a.name.localeCompare(b.name));

    const workloadTotals = workloadTeams.reduce((acc, team) => ({
      inb: acc.inb + team.totals.inb,
      out: acc.out + team.totals.out,
      plt: acc.plt + team.totals.plt,
      pltIn: acc.pltIn + team.totals.pltIn,
      pltOut: acc.pltOut + team.totals.pltOut,
    }), { inb: 0, out: 0, plt: 0, pltIn: 0, pltOut: 0 });

    return {
      title: "Planner - Riepilogo allocazioni",
      dateLabel,
      scopeLabel,
      absences,
      areaGroups,
      workloadTeams,
      workloadTotals,
      totals: {
        absences: absences.length,
        areas: areaGroups.length,
        allocations: allocationCount,
      },
    };
  }

  function generateReportText() {
    const report = buildReportData();
    const lines = [`📋 Allocazioni ${report.dateLabel}`];
    if (report.scopeLabel) lines.push(`Perimetro: ${report.scopeLabel}`);
    lines.push("");

    if (report.absences.length > 0) {
      lines.push(`Assenti (${report.absences.length})`);
      for (const item of report.absences) {
        lines.push(`• ${item.name} (${item.displayLabel})${item.note ? ` — ${item.note}` : ""}`);
      }
      lines.push("");
    }

    lines.push("Personale in turno");
    if (report.areaGroups.length === 0) lines.push("• Nessuna allocazione");
    for (const group of report.areaGroups) {
      lines.push(`🏢 ${group.name} (${group.peopleCount} ${group.peopleCount === 1 ? "persona" : "persone"})`);
      for (const allocation of group.allocations) {
        lines.push(`  - ${getAllocationDisplayLabel(allocation)}${allocation.note ? ` — Note: ${allocation.note}` : ""}`);
      }
    }
    lines.push("");

    if (report.workloadTeams.length > 0) {
      lines.push("Carichi di lavoro");
      for (const team of report.workloadTeams) {
        lines.push(`${team.icon ? `${team.icon} ` : ""}${team.name}${team.ownerName ? ` — Owner: ${team.ownerName}` : ""}`);
        if (team.rows.length > 0) {
          lines.push(`    IN ${team.totals.inb} | OUT ${team.totals.out} | PLT ${team.totals.plt}`);
          lines.push("    Cliente | Fornitore | IN | MEZZI OUT | PLT | Note/Info | Mag");
          for (const row of team.rows) {
            lines.push(
              `    ${workloadCustomerLabel(row) || "-"} | ${workloadSupplierLabel(row) || "-"} | ${row.inbound_count ?? 0} | ${row.outbound_count ?? 0} | ${row.pallet_count ?? 0} | ${row.notes || "-"} | ${row.warehouse || "-"}`
            );
          }
        } else if (team.workload) {
          for (const line of team.workload.split("\n")) {
            lines.push(`    ${line}`);
          }
        }
        lines.push("");
      }
      lines.push(`TOTALE GIORNATA | IN ${report.workloadTotals.inb} | OUT ${report.workloadTotals.out} | PLT ${report.workloadTotals.plt}`);
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

    // ── Griglia di pagina (A4) ────────────────────────────────────────────
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const margin = 40;
    const contentWidth = pageWidth - margin * 2;
    const footerHeight = 30;
    const contentBottom = footerHeight + 12;

    // Il verde Tonoli e' l'unico colore forte del documento: il colore della
    // squadra/area resta confinato al badge e alla barretta della sezione,
    // cosi' le pagine non cambiano faccia a ogni cambio di sede.
    const C = {
      green: "#006f3d",
      greenSoft: "#eef6f1",
      greenLine: "#cbe3d5",
      ink: "#1f2933",
      inkSoft: "#4d5a66",
      muted: "#8a939c",
      line: "#e4e7ea",
      zebra: "#f7f8f9",
      white: "#ffffff",
      alert: "#b4232a",
      alertSoft: "#fbefef",
    };

    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    const [lexendBytes, logoBytes] = await Promise.all([
      fetch(lexendFontUrl).then((res) => res.arrayBuffer()),
      fetch(logoTonoli).then((res) => res.arrayBuffer()),
    ]);
    const font = await pdfDoc.embedFont(lexendBytes, { subset: true });
    const logoImage = await pdfDoc.embedPng(logoBytes);
    const logoRatio = logoImage.width / logoImage.height;

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

    // L'emoji della squadra/area non esiste nel font Lexend: si disegna su
    // canvas e si incorpora come immagine (unico modo per averla nel PDF).
    const teamBadgeImages = {};
    for (const team of report.workloadTeams) {
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
    const capitalize = (value) => {
      const text = String(value ?? "");
      return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
    };
    const measureText = (text, size) => font.widthOfTextAtSize(sanitize(text), size);
    const wrapText = (text, maxWidth, size) => {
      const source = sanitize(text).trim();
      if (!source) return [""];
      const words = source.split(/\s+/);
      const lines = [];
      let current = "";
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (measureText(candidate, size) <= maxWidth || !current) current = candidate;
        else {
          lines.push(current);
          current = word;
        }
      }
      if (current) lines.push(current);
      return lines;
    };
    // Nelle colonne strette una parola sola (un codice cliente, una mail) puo'
    // superare la larghezza: senza la griglia nera sborderebbe sulla colonna
    // accanto, quindi li' si spezza a meta' parola.
    const wrapTight = (text, maxWidth, size) => {
      const lines = [];
      for (const line of wrapText(text, maxWidth, size)) {
        let rest = line;
        while (measureText(rest, size) > maxWidth && rest.length > 1) {
          let cut = rest.length;
          while (cut > 1 && measureText(rest.slice(0, cut), size) > maxWidth) cut -= 1;
          lines.push(rest.slice(0, cut));
          rest = rest.slice(cut);
        }
        lines.push(rest);
      }
      return lines;
    };

    let page = null;
    let y = pageHeight;
    // Sezione attiva: la testata la ripete solo quando la pagina si apre a
    // meta' sezione, per non duplicare il titolo appena sotto la fascia.
    let currentSection = null;
    const pages = [];

    const drawTopRect = (x, topY, width, height, fill, border = null, borderWidth = 0.6) => {
      page.drawRectangle({
        x,
        y: topY - height,
        width,
        height,
        color: fill ? hexToRgb(fill) : undefined,
        borderColor: border ? hexToRgb(border) : undefined,
        borderWidth: border ? borderWidth : 0,
      });
    };

    // Lexend e' disponibile in un solo peso: il semibold si ottiene
    // ridisegnando il testo con un micro-offset, altrimenti titoli, nomi e
    // corpo avrebbero tutti lo stesso peso e la gerarchia sparirebbe.
    const drawText = (text, x, baselineY, size, options = {}) => {
      const { bold = false, color = C.ink } = options;
      const value = sanitize(text);
      page.drawText(value, { x, y: baselineY, size, font, color: hexToRgb(color) });
      if (bold) {
        page.drawText(value, { x: x + 0.3, y: baselineY, size, font, color: hexToRgb(color) });
      }
    };

    const drawTextRight = (text, rightX, baselineY, size, options = {}) => {
      drawText(text, rightX - measureText(text, size), baselineY, size, options);
    };

    const drawImageTop = (image, x, topY, width, height) => {
      page.drawImage(image, { x, y: topY - height, width, height });
    };

    // ── Testata ───────────────────────────────────────────────────────────
    const drawHeader = () => {
      drawTopRect(0, pageHeight, pageWidth, pageHeight, C.white);
      const logoHeight = 30;
      const logoWidth = logoRatio * logoHeight;
      drawImageTop(logoImage, margin, pageHeight - 22, logoWidth, logoHeight);
      const titleX = margin + logoWidth + 14;
      const titleText = "Riepilogo giornaliero";
      drawText(titleText, titleX, pageHeight - 46, 20, { bold: true, color: C.ink });
      drawTopRect(margin, pageHeight - 58, contentWidth, 1.6, C.green);
      // Data sulla stessa riga del titolo, allineata a destra: con i giorni
      // lunghi ("mercoledi' 21 settembre") il corpo si riduce per non toccare
      // il titolo, che ha larghezza fissa.
      const dateText = capitalize(report.dateLabel);
      const dateMaxWidth = (pageWidth - margin) - (titleX + measureText(titleText, 20)) - 12;
      let dateSize = 13;
      while (dateSize > 9 && measureText(dateText, dateSize) > dateMaxWidth) dateSize -= 1;
      drawTextRight(dateText, pageWidth - margin, pageHeight - 46, dateSize, { bold: true, color: C.ink });

      if (currentSection) {
        const badge = teamBadgeImages[currentSection.id];
        let textX = margin;
        if (badge) {
          drawImageTop(badge, textX, pageHeight - 65, 15, 15);
          textX += 21;
        }
        drawText(currentSection.name, textX, pageHeight - 77, 13, { bold: true, color: C.green });
        drawText("segue", textX + measureText(currentSection.name, 13) + 8, pageHeight - 76, 8, { color: C.muted });
      }
      return pageHeight - 92;
    };

    const startPage = () => {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      pages.push(page);
      y = drawHeader();
    };

    const ensureSpace = (height) => {
      if (y - height < contentBottom) startPage();
    };

    // Valore di `y` appena dopo l'intestazione di una pagina nuova (senza
    // `currentSection`): confrontarlo con `y` dice se la pagina corrente ha
    // gia' del contenuto, per non forzare un salto su una pagina ancora vuota.
    const topOfPageY = pageHeight - 92;
    const startSectionPage = () => {
      if (y < topOfPageY) startPage();
    };

    // ── Blocchi ───────────────────────────────────────────────────────────
    const drawSectionBand = (section, count, options = {}) => {
      const bandHeight = 26;
      const badge = teamBadgeImages[section.id];
      drawTopRect(margin, y, contentWidth, bandHeight, C.greenSoft);
      drawTopRect(margin, y, 3, bandHeight, section.color || C.green);
      let textX = margin + 14;
      if (badge) {
        drawImageTop(badge, textX, y - 5, 16, 16);
        textX += 22;
      }
      drawText(section.name, textX, y - 17.5, 13, { bold: true, color: C.green });
      const rightLabel = options.rightLabel
        ?? (count > 0 ? (count === 1 ? "1 persona" : `${count} persone`) : null);
      if (rightLabel) {
        drawTextRight(rightLabel, margin + contentWidth - 12, y - 17, 8.5, { color: C.inkSoft });
      }
      y -= bandHeight + 12;
    };

    // Titolo dei tre blocchi del documento (assenze, personale, carichi).
    const drawBlockTitle = (title, subtitle = null) => {
      ensureSpace(30);
      drawText(title, margin, y - 14, 15, { bold: true, color: C.ink });
      if (subtitle) drawTextRight(subtitle, margin + contentWidth, y - 14, 8.5, { color: C.muted });
      y -= 19;
      drawTopRect(margin, y, contentWidth, 1, C.greenLine);
      y -= 12;
    };

    const drawGroupLabel = (text, options = {}) => {
      const { x = margin, size = 8, color = C.muted, bold = true } = options;
      ensureSpace(16);
      drawText(String(text ?? "").toUpperCase(), x, y - 8, size, { bold, color });
      y -= 15;
    };

    // Totali come KPI: quattro riquadri sopra la tabella, stessa
    // scomposizione della dashboard /carichi (mezzi e pallet, IN/OUT).
    const drawKpiRow = (totals) => {
      const boxWidth = 104;
      const boxHeight = 36;
      const gap = 9;
      ensureSpace(boxHeight + 12);
      let x = margin;
      const boxes = [
        ["MEZZI IN", totals.inb],
        ["MEZZI OUT", totals.out],
        ["PLT IN", totals.pltIn],
        ["PLT OUT", totals.pltOut],
      ];
      for (const [label, value] of boxes) {
        drawTopRect(x, y, boxWidth, boxHeight, C.greenSoft, C.greenLine);
        drawText(label, x + 11, y - 13, 7.5, { bold: true, color: C.inkSoft });
        drawText(String(value), x + 11, y - 28, 14, { bold: true, color: C.green });
        x += boxWidth + gap;
      }
      y -= boxHeight + 12;
    };

    const workloadColumns = [
      { label: "CLIENTE", width: 94, align: "left", bold: true },
      { label: "FORNITORE", width: 88, align: "left" },
      { label: "IN", width: 30, align: "center" },
      { label: "OUT", width: 32, align: "center" },
      { label: "N° PLT", width: 36, align: "center" },
      { label: "NOTE / INFO", width: 114, align: "left" },
      { label: "MAG", width: 36, align: "center" },
      { label: "COMPILATO DA", width: 85, align: "left" },
    ];
    const cellPadding = 7;
    const cellTextX = (column, columnX, text, size) => {
      if (column.align === "center") return columnX + (column.width - measureText(text, size)) / 2;
      if (column.align === "right") return columnX + column.width - cellPadding - measureText(text, size);
      return columnX + cellPadding;
    };

    const formatRowEditor = (row) => {
      if (!row.last_modified_by) return "";
      if (!row.last_modified_at) return row.last_modified_by;
      const modifiedAt = dayjs(row.last_modified_at);
      const sameDay = modifiedAt.format("YYYY-MM-DD") === dayjs(selectedDate).format("YYYY-MM-DD");
      return `${row.last_modified_by} · ${modifiedAt.format(sameDay ? "HH:mm" : "DD/MM HH:mm")}`;
    };

    // Larghezza reale della tabella: i bordi devono cadere sui confini delle
    // colonne, non sul margine della pagina.
    const tableWidth = workloadColumns.reduce((sum, column) => sum + column.width, 0);

    // Filetti verticali fra le colonne: separano senza tornare alla griglia
    // nera: i bordi esterni sono appena piu' marcati degli interni.
    const drawColumnRules = (topY, height) => {
      let columnX = margin;
      for (const [index, column] of workloadColumns.entries()) {
        drawTopRect(columnX, topY, 0.5, height, index === 0 ? C.greenLine : C.line);
        columnX += column.width;
      }
      drawTopRect(margin + tableWidth - 0.5, topY, 0.5, height, C.greenLine);
    };

    const drawWorkloadTableHeader = () => {
      const headerHeight = 22;
      drawTopRect(margin, y, tableWidth, 0.8, C.greenLine);
      drawTopRect(margin, y, tableWidth, headerHeight, C.greenSoft);
      let columnX = margin;
      for (const column of workloadColumns) {
        drawText(column.label, cellTextX(column, columnX, column.label, 7.4), y - 14.5, 7.4, { bold: true, color: C.inkSoft });
        columnX += column.width;
      }
      drawColumnRules(y, headerHeight);
      y -= headerHeight;
      drawTopRect(margin, y, tableWidth, 0.8, C.greenLine);
    };

    const drawWorkloadTable = (rows) => {
      const fontSize = 8.6;
      const lineGap = 11;
      const measured = rows.map((row) => {
        const values = [
          workloadCustomerLabel(row) || "-",
          workloadSupplierLabel(row) || "",
          String(row.inbound_count ?? 0),
          String(row.outbound_count ?? 0),
          String(row.pallet_count ?? 0),
          row.notes || "",
          row.warehouse || "",
          formatRowEditor(row),
        ];
        const wrapped = values.map((value, index) =>
          wrapTight(value, workloadColumns[index].width - cellPadding * 2, fontSize));
        const maxLines = Math.max(...wrapped.map((lines) => lines.length), 1);
        return { wrapped, height: maxLines * lineGap + 11 };
      });

      ensureSpace(22 + (measured[0]?.height ?? 24) + 6);
      drawWorkloadTableHeader();

      measured.forEach((row, rowIndex) => {
        if (y - row.height < contentBottom) {
          startPage();
          drawWorkloadTableHeader();
        }
        if (rowIndex % 2 === 1) drawTopRect(margin, y, tableWidth, row.height, C.zebra);
        drawColumnRules(y, row.height);
        let columnX = margin;
        row.wrapped.forEach((lines, index) => {
          const column = workloadColumns[index];
          let textY = y - 13;
          for (const line of lines) {
            if (line.trim()) {
              drawText(line, cellTextX(column, columnX, line, fontSize), textY, fontSize, {
                bold: Boolean(column.bold),
                color: column.align === "center" ? C.ink : C.inkSoft,
              });
            }
            textY -= lineGap;
          }
          columnX += column.width;
        });
        y -= row.height;
        // Chiusura della tabella: l'ultima riga prende il filetto piu' marcato.
        drawTopRect(margin, y, tableWidth, rowIndex === measured.length - 1 ? 0.8 : 0.5,
          rowIndex === measured.length - 1 ? C.greenLine : C.line);
      });
      y -= 12;
    };

    // ── Card del personale (due colonne: le sezioni piccole non sprecano
    // piu' una pagina intera a testa) ─────────────────────────────────────
    const cardGap = 10;
    const cardWidth = (contentWidth - cardGap) / 2;
    const cardNameSize = 9.8;
    const cardMetaSize = 8.4;
    const cardNoteSize = 8;

    const measureCard = (allocation) => {
      const timeText = allocation.timeRange || "";
      const timeWidth = timeText ? measureText(timeText, cardMetaSize) + 10 : 0;
      const nameLines = wrapTight(allocation.name, cardWidth - 24 - timeWidth, cardNameSize);
      const roleText = allocation.role || null;
      const noteLines = allocation.note ? wrapTight(allocation.note, cardWidth - 32, cardNoteSize) : [];
      const height = 9 + nameLines.length * 12 + (roleText ? 11 : 0) + (noteLines.length ? noteLines.length * 10.5 + 4 : 0) + 8;
      return { allocation, nameLines, roleText, noteLines, timeText, height };
    };

    const drawCard = (card, x, topY, accentColor) => {
      drawTopRect(x, topY, cardWidth, card.height, C.white, C.line);
      drawTopRect(x, topY, 2.5, card.height, accentColor || C.greenLine);
      let textY = topY - 16;
      card.nameLines.forEach((line) => {
        drawText(line, x + 12, textY, cardNameSize, { bold: true, color: C.ink });
        textY -= 12;
      });
      if (card.timeText) {
        drawTextRight(card.timeText, x + cardWidth - 10, topY - 16, cardMetaSize, { color: C.inkSoft });
      }
      if (card.roleText) {
        drawText(card.roleText, x + 12, textY, cardMetaSize, { color: C.inkSoft });
        textY -= 11;
      }
      if (card.noteLines.length > 0) {
        textY -= 2;
        const noteTop = textY + 8;
        const noteHeight = card.noteLines.length * 10.5 + 2;
        drawTopRect(x + 12, noteTop, 2, noteHeight, C.green);
        card.noteLines.forEach((line) => {
          drawText(line, x + 18, textY, cardNoteSize, { color: C.green });
          textY -= 10.5;
        });
      }
    };

    const drawCardGrid = (allocations, accentColor) => {
      const cards = allocations.map(measureCard);
      for (let index = 0; index < cards.length; index += 2) {
        const rowCards = cards.slice(index, index + 2);
        const rowHeight = Math.max(...rowCards.map((card) => card.height));
        ensureSpace(rowHeight + 6);
        rowCards.forEach((card, columnIndex) => {
          drawCard({ ...card, height: rowHeight }, margin + columnIndex * (cardWidth + cardGap), y, accentColor);
        });
        y -= rowHeight + 6;
      }
    };

    // ── Documento ─────────────────────────────────────────────────────────
    startPage();

    if (report.scopeLabel) {
      const lines = wrapText(`Perimetro: ${report.scopeLabel}`, contentWidth, 9);
      for (const line of lines) {
        drawText(line, margin, y - 8, 9, { color: C.muted });
        y -= 12;
      }
      y -= 6;
    }

    if (report.absences.length > 0) {
      const bandHeight = 24;
      ensureSpace(bandHeight + 40);
      drawTopRect(margin, y, contentWidth, bandHeight, C.alertSoft);
      drawTopRect(margin, y, 3, bandHeight, C.alert);
      drawText(`Assenti (${report.absences.length})`, margin + 14, y - 16, 12, { bold: true, color: C.alert });
      y -= bandHeight + 10;
      drawCardGrid(
        report.absences.map((item) => ({
          name: item.name,
          timeRange: item.displayLabel,
          note: item.note || null,
        })),
        C.alert,
      );
      y -= 10;
    }

    // Personale in turno, raggruppato per area+immobile come in dashboard.
    // Macro-blocco separato: parte sempre su una pagina propria.
    startSectionPage();
    drawBlockTitle("Personale in turno", `${report.totals.allocations} allocazion${report.totals.allocations === 1 ? "e" : "i"}`);
    if (report.areaGroups.length === 0) {
      ensureSpace(16);
      drawText("Nessuna allocazione per la giornata.", margin, y - 9, 9.5, { color: C.muted });
      y -= 18;
    }
    for (const group of report.areaGroups) {
      ensureSpace(38 + 46);
      drawSectionBand(group, group.peopleCount);
      currentSection = group;
      drawCardGrid(group.allocations, group.color);
      currentSection = null;
      y -= 8;
    }

    if (report.workloadTeams.length > 0) {
      // Macro-blocco separato: parte sempre su una pagina propria.
      startSectionPage();
      drawBlockTitle("Carichi di lavoro", "per squadra");
      for (const team of report.workloadTeams) {
        ensureSpace(38 + (team.rows.length > 0 ? 96 : 40));
        drawSectionBand(team, 0, { rightLabel: team.ownerName ? `Owner: ${team.ownerName}` : null });
        currentSection = team;
        if (team.rows.length > 0) {
          drawKpiRow(team.totals);
          drawWorkloadTable(team.rows);
        } else {
          for (const line of String(team.workload).split("\n")) {
            for (const wrapped of wrapText(line, contentWidth, 9.5)) {
              ensureSpace(13);
              drawText(wrapped, margin, y - 9, 9.5, { color: C.inkSoft });
              y -= 13;
            }
          }
          y -= 10;
        }
        currentSection = null;
      }

      // Totale della giornata: somma di tutte le squadre nel perimetro.
      ensureSpace(60);
      drawText("Totale giornata", margin, y - 9, 10.5, { bold: true, color: C.ink });
      y -= 16;
      drawKpiRow(report.workloadTotals);
    }

    // Footer in coda: il totale pagine si conosce solo a documento chiuso.
    const generatedAt = dayjs().format("DD/MM/YYYY");
    pages.forEach((currentPage, index) => {
      page = currentPage;
      drawTopRect(margin, footerHeight + 8, contentWidth, 0.5, C.line);
      drawText(`Generato il ${generatedAt} · Planner operativo`, margin, footerHeight - 8, 7.6, { color: C.muted });
      drawTextRight(`Pagina ${index + 1} di ${pages.length}`, pageWidth - margin, footerHeight - 8, 7.6, { color: C.muted });
    });

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
    setReportTeamIds([]);
    setReportOpen(true);
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
            onClick={(e) => setViewsMenuAnchor(e.currentTarget)}
          >
            👁 Viste
          </Button>
          <Menu
            anchorEl={viewsMenuAnchor}
            open={Boolean(viewsMenuAnchor)}
            onClose={() => setViewsMenuAnchor(null)}
          >
            {savedPlannerViews.length === 0 && (
              <MenuItem disabled>Nessuna vista salvata</MenuItem>
            )}
            {savedPlannerViews.map((view) => (
              <MenuItem
                key={view.id}
                onClick={() => applySavedPlannerView(view)}
                sx={{ display: "flex", justifyContent: "space-between", gap: 1, minWidth: 220 }}
              >
                <ListItemText primary={view.name} />
                <IconButton
                  size="small"
                  edge="end"
                  aria-label={`Elimina vista ${view.name}`}
                  onClick={(e) => { e.stopPropagation(); handleDeletePlannerView(view.id); }}
                >
                  ✕
                </IconButton>
              </MenuItem>
            ))}
            <Divider />
            <MenuItem
              onClick={() => {
                setViewsMenuAnchor(null);
                setSaveViewName("");
                setSaveViewDialogOpen(true);
              }}
            >
              💾 Salva vista corrente…
            </MenuItem>
          </Menu>
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
                        const color = a.cause === "FORMAZIONE"
                          ? TRAINING_COLOR
                          : a.cause === "VISITA_IDONEITA"
                            ? MEDICAL_CHECK_COLOR
                            : (areaColorMap[a.area ?? ""] ?? AREA_PALETTE[0]);
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
          {areaPickerState?.mode === "formazione"
            ? "Ore di formazione"
            : areaPickerState?.mode === "visita" ? "Visita di idoneità" : "Seleziona building"}
          {areaPickerState && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {formatHour(areaPickerState.startHour)} – {formatHour(areaPickerState.endHour)}
              &nbsp;·&nbsp;{Number((areaPickerState.endHour - areaPickerState.startHour).toFixed(2))} h
            </Typography>
          )}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {availableBlockModes.length > 1 && (
              <TextField
                select
                label="Tipo"
                value={areaPickerState?.mode ?? "presenza"}
                onChange={(e) => setAreaPickerState((current) => current ? { ...current, mode: e.target.value } : current)}
                fullWidth
                size="small"
              >
                {availableBlockModes.includes("presenza") && <MenuItem value="presenza">Presenza</MenuItem>}
                {availableBlockModes.includes("formazione") && <MenuItem value="formazione">Formazione</MenuItem>}
                {availableBlockModes.includes("visita") && <MenuItem value="visita">Visita idoneità</MenuItem>}
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
            ) : areaPickerState?.mode === "visita" ? (
              <Typography variant="body2" color="text.secondary">
                La visita di idoneità registra solo la fascia oraria: nessun building da scegliere.
              </Typography>
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
                : areaPickerState?.mode === "visita"
                  ? false
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
              } else if (areaPickerState.mode === "visita") {
                createMutation.mutate({ ...base, cause: "VISITA_IDONEITA" });
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
            {editingBlock?.cause === "VISITA_IDONEITA" ? (
              <Typography variant="body2" color="text.secondary">
                Visita di idoneità: si possono modificare orario e note.
              </Typography>
            ) : editingBlock?.cause === "FORMAZIONE" ? (
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
            {canWritePlanning && duplicateCandidates.length > 0 && (
              <>
                <Divider />
                <Stack direction="row" spacing={1} alignItems="center">
                  <TextField
                    select
                    label="Duplica su collega"
                    value={duplicateTargetId}
                    onChange={(e) => setDuplicateTargetId(e.target.value)}
                    fullWidth
                    size="small"
                  >
                    <MenuItem value="">Seleziona collega della squadra</MenuItem>
                    {duplicateCandidates.map((candidate) => (
                      <MenuItem key={candidate.id} value={candidate.id}>{candidate.name}</MenuItem>
                    ))}
                  </TextField>
                  <Button
                    variant="outlined"
                    onClick={() => duplicateToEmployeeMutation.mutate({ source: editingBlock, employeeId: duplicateTargetId })}
                    disabled={!duplicateTargetId || duplicateToEmployeeMutation.isPending}
                  >
                    {duplicateToEmployeeMutation.isPending ? "Duplico…" : "Duplica"}
                  </Button>
                </Stack>
              </>
            )}
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

      {/* ── Salva vista corrente dialog ──────────────────────────────── */}
      <Dialog
        open={saveViewDialogOpen}
        onClose={() => setSaveViewDialogOpen(false)}
        PaperProps={{ className: "planner-dialog" }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle className="planner-dialog-title">Salva vista corrente</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Nome vista"
            value={saveViewName}
            onChange={(e) => setSaveViewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSavePlannerView(); }}
            sx={{ mt: 1 }}
          />
          {savedPlannerViews.some((v) => v.name === saveViewName.trim()) && saveViewName.trim() && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Esiste già una vista con questo nome: verrà sovrascritta.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveViewDialogOpen(false)}>Annulla</Button>
          <Button variant="contained" onClick={handleSavePlannerView} disabled={!saveViewName.trim()}>
            Salva
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
            <Typography variant="subtitle2" sx={{ mb: 0.75 }}>Perimetro del riepilogo</Typography>
            <FilterSelect
              label="Squadre"
              multiple
              value={reportTeamIds}
              onChange={setReportTeamIds}
              options={reportTeamOptions}
              placeholder={reportTeamIds.length === 0 ? "Tutte le squadre" : undefined}
              sx={{ width: "100%" }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
              Il riepilogo elenca le assenze, il personale in turno raggruppato per area e immobile e i carichi di lavoro per squadra. Senza squadre selezionate comprende tutti i dipendenti; le assenze sono sempre elencate per intero.
            </Typography>
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
