import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppTheme } from "../ThemeContext";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  Divider,
  Link,
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
  getEmployees,
  getJustifications,
  getOperationalAreas,
  getTeams,
  updateAssignment,
} from "../api";
import "./PlannerPage.css";

// ── constants ──────────────────────────────────────────────────────────────
const HOUR_START = 5;
const HOUR_END = 22;
const HOUR_WIDTH = 64; // px per ora
const HOURS = HOUR_END - HOUR_START; // 17
const TRACK_WIDTH = HOURS * HOUR_WIDTH; // 1088 px
const LANE_H = 38; // px per lane nella vista Area

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

// ── helpers ────────────────────────────────────────────────────────────────
function normalizeAreaKey(area) { return String(area ?? "").trim().toUpperCase(); }
function getImmobileOptions(area, areasData) {
  const key = normalizeAreaKey(area);
  const found = (areasData ?? []).find((a) => normalizeAreaKey(a.name) === key || normalizeAreaKey(a.area_code) === key);
  return found?.buildings ?? [];
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
function renderAssignmentTooltip(a, startH, endH, breakSegment = null) {
  return (
    <Box sx={{ py: 0.25 }}>
      <Typography sx={{ fontSize: 11, fontWeight: 700 }}>
        {formatAssignmentAreaLabel(a.area, a.immobile)}
      </Typography>
      <Typography sx={{ fontSize: 10.5, opacity: 0.8 }}>
        {pad2(startH)}:00–{pad2(endH)}:00
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
    </Box>
  );
}
function hourOffset(h) { return (h - HOUR_START) * HOUR_WIDTH; }
function pxToHourRaw(px) { return HOUR_START + px / HOUR_WIDTH; }
function pxToHour(px) { return Math.max(HOUR_START, Math.min(HOUR_END, Math.round(pxToHourRaw(px)))); }
function timeToHour(t) { return parseInt(String(t).slice(0, 2), 10); }
function hourToTime(h) { return `${String(h).padStart(2, "0")}:00`; }
function pad2(n) { return String(n).padStart(2, "0"); }
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
  const queryClient = useQueryClient();

  const [selectedDate, setSelectedDate] = useState(dayjs().format("YYYY-MM-DD"));
  const [roleFilter, setRoleFilter] = useState("MAGAZZINIERE");
  const [plannerView, setPlannerView] = useState("employees"); // "employees" | "areas"
  const [areaPickerState, setAreaPickerState] = useState(null);
  const [editingBlock, setEditingBlock] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [absenceBlockMsg, setAbsenceBlockMsg] = useState(null);
  const absenceBlockTimerRef = useRef(null);
  const [copyFromOpen, setCopyFromOpen] = useState(false);
  const [copyFromDate, setCopyFromDate] = useState("");
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateSnackbar, setGenerateSnackbar] = useState(null);
  const [sortMode, setSortMode] = useState("alpha"); // "alpha" | "team"
  const { darkMode } = useAppTheme();

  // ref so copyFromMutation always sees current justifications
  const justificationsRef = useRef(null);

  // drag (ref avoids stale closures; tick forces re-render)
  const dragRef = useRef(null);
  const suppressClickRef = useRef(null);
  const [, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick((n) => n + 1), []);

  // local overrides for immediate visual feedback
  const [localOverrides, setLocalOverrides] = useState({});

  const trackRefs = useRef({});

  // ── queries ──────────────────────────────────────────────────────────────
  const employeesQuery = useQuery({
    queryKey: ["employees", "planner", roleFilter],
    queryFn: () => getEmployees("", roleFilter ? [roleFilter] : []),
  });

  const allEmployeesQuery = useQuery({
    queryKey: ["employees", "planner", "all"],
    queryFn: () => getEmployees("", []),
    staleTime: 30000,
  });

  const assignmentsQuery = useQuery({
    queryKey: ["assignments", selectedDate],
    queryFn: () => getAssignments(selectedDate, selectedDate),
  });

  const justificationsQuery = useQuery({
    queryKey: ["justifications", "planner", selectedDate],
    queryFn: () => getJustifications(selectedDate, selectedDate),
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

  const prenotazioniQuery = useQuery({
    queryKey: ["prenotazioni-gesap", selectedDate],
    queryFn: async () => {
      const res = await fetch(
        `/gesap-proxy/prenotazioni_domani_senza_login.php?data=${selectedDate}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 60000,
    retry: 1,
  });

  // keep ref in sync so mutations can access latest justification list
  justificationsRef.current = justificationsQuery.data ?? [];

  // ── mutations ────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: createAssignment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      setAreaPickerState(null);
    },
    onError: () => setAreaPickerState(null),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => updateAssignment(id, payload),
    onSuccess: (_, { id }) => {
      setLocalOverrides((o) => { const n = { ...o }; delete n[id]; return n; });
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
    },
    onError: (_, { id }) => {
      setLocalOverrides((o) => { const n = { ...o }; delete n[id]; return n; });
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAssignment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      setEditingBlock(null);
    },
  });

  const copyFromMutation = useMutation({
    mutationFn: async (sourceDate) => {
      const sourceAssignments = await getAssignments(sourceDate, sourceDate);
      // employees absent on the TARGET day — use current ref value
      const absentIds = new Set((justificationsRef.current).map((j) => j.employee_id));
      const results = [];
      for (const a of sourceAssignments) {
        if (absentIds.has(a.employee_id)) continue; // skip absent employees
        try {
          const created = await createAssignment({
            employee_id: a.employee_id,
            work_date: selectedDate,
            start_time: typeof a.start_time === "string" ? a.start_time.slice(0, 5) : a.start_time,
            end_time: typeof a.end_time === "string" ? a.end_time.slice(0, 5) : a.end_time,
            area: a.area,
            immobile: a.immobile,
            cause: a.cause,
            notes: a.notes,
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
      setCopyFromOpen(false);
      setCopyFromDate("");
    },
  });

  const generateMutation = useMutation({
    mutationFn: async (candidates) => {
      let count = 0;
      for (const { emp, day, area, immobile } of candidates) {
        try {
          await createAssignment({
            employee_id: emp.id,
            work_date: selectedDate,
            start_time: day.start,
            end_time: day.end,
            area: area.name,
            immobile: immobile ?? null,
            cause: "PRESENZA",
            notes: null,
          });
          count++;
        } catch {
          // skip overlaps / conflicts
        }
      }
      return count;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      setGenerateOpen(false);
      setGenerateSnackbar(`Creati ${count} turni da orario standard`);
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
      drag.endHour = Math.max(drag.startHour + 1, Math.min(HOUR_END, Math.round(pxToHourRaw(px))));
    } else if (drag.type === "resize-start") {
      drag.startHour = Math.max(HOUR_START, Math.min(drag.endHour - 1, Math.round(pxToHourRaw(px))));
    } else if (drag.type === "move") {
      const dur = drag.origEnd - drag.origStart;
      const newStart = Math.max(HOUR_START, Math.min(HOUR_END - dur, Math.round(pxToHourRaw(px - drag.offsetPx))));
      drag.startHour = newStart;
      drag.endHour = newStart + dur;
    } else if (drag.type === "create") {
      drag.endHour = Math.max(drag.startHour + 1, Math.min(HOUR_END, Math.round(pxToHourRaw(px))));
    }
    forceUpdate();
  };

  onUpRef.current = () => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.type === "create") {
      if (drag.endHour > drag.startHour) {
        setAreaPickerState({ employeeId: drag.employeeId, startHour: drag.startHour, endHour: drag.endHour, area: "", immobile: "", notes: "" });
      }
    } else if (drag.assignmentId) {
      const moved = drag.startHour !== drag.origStart || drag.endHour !== drag.origEnd;
      if (moved) {
        suppressClickRef.current = drag.assignmentId;
        const newStart = hourToTime(drag.startHour);
        const newEnd = hourToTime(drag.endHour);
        setLocalOverrides((o) => ({ ...o, [drag.assignmentId]: { start_time: newStart, end_time: newEnd } }));
        updateMutation.mutate({ id: drag.assignmentId, payload: { start_time: newStart, end_time: newEnd } });
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
    e.stopPropagation();
    e.preventDefault();
    const trackEl = trackRefs.current[assignment.employee_id];
    if (!trackEl) return;
    const rect = trackEl.getBoundingClientRect();
    const startH = timeToHour(assignment.start_time);
    const endH = timeToHour(assignment.end_time);
    const clickPx = e.clientX - rect.left;
    dragRef.current = {
      type,
      employeeId: assignment.employee_id,
      assignmentId: assignment.id,
      startHour: startH,
      endHour: endH,
      origStart: startH,
      origEnd: endH,
      offsetPx: type === "move" ? clickPx - hourOffset(startH) : 0,
      trackLeft: rect.left,
    };
    forceUpdate();
  }

  function startCreateDrag(e, employeeId) {
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
      const type = hit.justification_type === "FERIE" ? "ferie" : "permesso";
      setAbsenceBlockMsg(`${emp?.full_name ?? "Dipendente"} è in ${type} in questo orario – impossibile aggiungere attività.`);
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

  const employees = useMemo(() => {
    const filteredEmployees = employeesQuery.data ?? [];
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
  }, [allEmployeesQuery.data, employeeTeamMap, employeesQuery.data, sortMode]);

  const selectedScheduleIdx = useMemo(() => (dayjs(selectedDate).day() + 6) % 7, [selectedDate]);

  const employeeById = useMemo(() => {
    const map = {};
    for (const employee of allEmployeesQuery.data ?? []) map[employee.id] = employee;
    for (const employee of employeesQuery.data ?? []) map[employee.id] = employee;
    return map;
  }, [allEmployeesQuery.data, employeesQuery.data]);

  const areas = areasQuery.data ?? [];
  const drag = dragRef.current;

  // Mon=0 … Sun=6 mapping from dayjs (dayjs: Sun=0)
  const generateCandidates = useMemo(() => {
    if (!generateOpen) return { toCreate: [], skipCount: 0, skipImmobile: 0 };
    const schedIdx = (dayjs(selectedDate).day() + 6) % 7;
    const absentIds = new Set((justificationsQuery.data ?? []).map((j) => j.employee_id));
    const toCreate = [];
    let skipCount = 0;
    let skipImmobile = 0;
    // Iterate ALL active employees (not just visible role filter) so team leaders
    // and employees with different roles still get their shifts generated.
    for (const emp of (allEmployeesQuery.data ?? [])) {
      if ((assignmentsByEmployee[emp.id] ?? []).length > 0) { skipCount++; continue; }
      if (absentIds.has(emp.id)) { skipCount++; continue; }
      const sched = emp.default_schedule;
      if (!sched || sched.length !== 7 || !sched[schedIdx]?.enabled) { skipCount++; continue; }
      const day = sched[schedIdx];
      if (!day.start || !day.end) { skipCount++; continue; }
      const area = areas.find((a) => a.id === emp.default_operational_area_id);
      if (!area) { skipCount++; continue; }
      if ((area.buildings ?? []).length > 0 && !emp.default_immobile) { skipImmobile++; continue; }
      toCreate.push({ emp, day, area, immobile: emp.default_immobile || null });
    }
    return { toCreate, skipCount, skipImmobile };
  }, [generateOpen, selectedDate, employees, assignmentsByEmployee, justificationsQuery.data, areas]);

  const sortedItems = useMemo(() => {
    if (sortMode === "alpha") {
      return employees.map((e) => ({ type: "employee", employee: e }));
    }
    const groups = {};
    const noTeam = [];
    for (const emp of employees) {
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
      for (const e of [...g.emps].sort((a, b) => a.full_name.localeCompare(b.full_name))) {
        items.push({ type: "employee", employee: e });
      }
    }
    if (noTeam.length > 0) {
      items.push({ type: "teamHeader", team: null });
      for (const e of noTeam) items.push({ type: "employee", employee: e });
    }
    return items;
  }, [employees, sortMode, employeeTeamMap]);

  function getDisplayBlocks(employeeId) {
    const saved = assignmentsByEmployee[employeeId] ?? [];
    const drag = dragRef.current;
    if (!drag || drag.employeeId !== employeeId) return { blocks: saved, ghost: null };
    if (drag.type === "create") return { blocks: saved, ghost: { startHour: drag.startHour, endHour: drag.endHour } };
    const blocks = saved.map((a) =>
      a.id !== drag.assignmentId ? a : { ...a, start_time: hourToTime(drag.startHour), end_time: hourToTime(drag.endHour) }
    );
    return { blocks, ghost: null };
  }

  function getBreakSegmentForAssignment(employeeId, assignment) {
    const scheduleDay = employeeById[employeeId]?.default_schedule?.[selectedScheduleIdx];
    const breakSegment = getScheduleBreakSegment(scheduleDay);
    if (!breakSegment) return null;

    const assignmentStart = timeToHourRaw(assignment.start_time);
    const assignmentEnd = timeToHourRaw(assignment.end_time);
    if (!Number.isFinite(assignmentStart) || !Number.isFinite(assignmentEnd)) return null;
    if (assignmentStart > breakSegment.startHour || assignmentEnd < breakSegment.endHour) return null;

    return breakSegment;
  }

  function openEditBlock(e, a) {
    e.stopPropagation();
    if (suppressClickRef.current === a.id) { suppressClickRef.current = null; return; }
    setEditingBlock(a);
    setEditForm({ area: a.area ?? "", immobile: a.immobile ?? "", notes: a.notes ?? "" });
  }

  function saveEditBlock() {
    if (!editingBlock) return;
    updateMutation.mutate(
      {
        id: editingBlock.id,
        payload: {
          area: editForm.area || null,
          immobile: normalizeImmobile(editForm.area, editForm.immobile, areas),
          notes: editForm.notes || null,
        },
      },
      { onSuccess: () => setEditingBlock(null) }
    );
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <Stack spacing={2} className="planner-page">

      {/* ── Topbar ──────────────────────────────────────────────────── */}
      <Paper className="planner-topbar">
        <Box className="planner-topbar-left">
          <Box className="planner-title-badge">📋</Box>
          <Typography variant="h5" className="planner-title-text">Planner</Typography>
        </Box>

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

        <Box className="planner-topbar-right">
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
                select
                size="small"
                label="Ruolo"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="planner-role-filter"
              >
                {ROLE_OPTIONS.map((r) => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
              </TextField>
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

          {plannerView === "employees" && (
            <Button
              variant="outlined"
              size="small"
              className="planner-copy-btn"
              onClick={() => setGenerateOpen(true)}
            >
              ✨ Genera da standard
            </Button>
          )}
          <Button
            variant="outlined"
            size="small"
            className="planner-copy-btn"
            onClick={() => { setCopyFromDate(""); setCopyFromOpen(true); }}
          >
            Copia da…
          </Button>
        </Box>
      </Paper>

      {/* ── errors / warnings ───────────────────────────────────────── */}
      {createMutation.error && <Alert severity="error">{createMutation.error.message}</Alert>}
      {updateMutation.error && <Alert severity="error">{updateMutation.error.message}</Alert>}
      {absenceBlockMsg && (
        <Alert severity="warning" onClose={() => setAbsenceBlockMsg(null)}>{absenceBlockMsg}</Alert>
      )}

      {/* ── Timeline + Prenotazioni panel ───────────────────────────── */}
      <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start" }}>
      <Paper className="planner-shell" sx={{ flex: 1, minWidth: 0 }}>
        <Box className="planner-layout">

          {/* sticky name column */}
          <Box className="planner-names">
            <Box className="planner-name-header-cell" />
            {plannerView === "employees" && sortedItems.map((item) => {
              if (item.type === "teamHeader") {
                const t = item.team;
                return (
                  <Box key={`nh-${t?.id ?? "none"}`} sx={{
                    height: 26, px: 1.5, display: "flex", alignItems: "center", gap: 1,
                    background: t ? t.color + "14" : "#f5f5f7",
                    borderBottom: "1px solid var(--pl-border)",
                  }}>
                    {t ? (
                      <>
                        <span style={{ fontSize: 13, lineHeight: 1 }}>{t.icon}</span>
                        <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: t.color, lineHeight: 1, textTransform: "uppercase", letterSpacing: "0.05em" }}>{t.name}</Typography>
                      </>
                    ) : (
                      <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: "#888", lineHeight: 1, textTransform: "uppercase", letterSpacing: "0.05em" }}>Senza squadra</Typography>
                    )}
                  </Box>
                );
              }
              const emp = item.employee;
              const empTeam = employeeTeamMap[emp.id];
              return (
                <Box key={emp.id} className="planner-name-cell">
                  <EmployeeAvatar employee={emp} size={32} />
                  <Box className="planner-name-text">
                    <Typography className="planner-emp-name">{emp.full_name}</Typography>
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
          <Box className="planner-scroll">

            {/* hour header */}
            <Box className="planner-hour-header" style={{ width: TRACK_WIDTH }}>
              {Array.from({ length: HOURS + 1 }, (_, i) => i + HOUR_START).map((h) => (
                <span key={h} className="planner-hour-label" style={{ left: hourOffset(h) }}>
                  {pad2(h)}
                </span>
              ))}
            </Box>

            {/* ── employee view ── */}
            {plannerView === "employees" && (
              <>
                {employees.length === 0 && !employeesQuery.isLoading && !allEmployeesQuery.isLoading && (
                  <Box className="planner-empty" style={{ width: TRACK_WIDTH }}>
                    Nessun dipendente trovato per il ruolo selezionato.
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
                      style={{ width: TRACK_WIDTH }}
                      ref={(el) => { trackRefs.current[emp.id] = el; }}
                      onPointerDown={(e) => startCreateDrag(e, emp.id)}
                    >
                      {absences.map((j) => {
                        const absStartH = timeToHour(j.start_time);
                        const absEndH = timeToHour(j.end_time);
                        const absDur = absEndH - absStartH;
                        const clampedLeft = Math.max(0, hourOffset(absStartH));
                        const clampedW = Math.max(HOUR_WIDTH, absDur * HOUR_WIDTH);
                        return (
                          <Tooltip key={j.id} title={`${j.justification_type}${j.description ? ` — ${j.description}` : ""}  ·  ${pad2(absStartH)}:00–${pad2(absEndH)}:00`} placement="top">
                            <Box
                              className={`planner-absence ${j.justification_type === "FERIE" ? "ferie" : "permesso"}`}
                              style={{ left: clampedLeft, width: clampedW, cursor: "not-allowed" }}
                            >
                              <span>{j.justification_type === "FERIE" ? "🌴" : "🏖️"}</span>
                              <span className="planner-absence-label">{j.justification_type}</span>
                              {absDur <= 4 && null}
                            </Box>
                          </Tooltip>
                        );
                      })}
                      {blocks.map((a) => {
                        const startH = timeToHour(a.start_time);
                        const endH = timeToHour(a.end_time);
                        const startHourRaw = timeToHourRaw(a.start_time);
                        const dur = endH - startH;
                        const color = areaColorMap[a.area ?? ""] ?? AREA_PALETTE[0];
                        const isDragged = drag?.assignmentId === a.id;
                        const breakSegment = getBreakSegmentForAssignment(emp.id, a);
                        const breakWidth = breakSegment ? Math.max(6, (breakSegment.endHour - breakSegment.startHour) * HOUR_WIDTH) : 0;
                        return (
                          <Tooltip key={a.id} title={renderAssignmentTooltip(a, startH, endH, breakSegment)} placement="top" arrow enterDelay={150}>
                            <Box
                              className={`planner-block${isDragged ? " is-dragging" : ""}`}
                              style={{ left: hourOffset(startH), width: dur * HOUR_WIDTH, background: color.bg, borderColor: color.border, color: color.text }}
                              onClick={(e) => openEditBlock(e, a)}
                            >
                              {breakSegment && (
                                <Box
                                  className="planner-break-overlay"
                                  style={{ left: Math.max(0, (breakSegment.startHour - startHourRaw) * HOUR_WIDTH), width: breakWidth }}
                                >
                                  {breakWidth >= 48 && <span className="planner-break-label">Pausa</span>}
                                </Box>
                              )}
                              <Box className="planner-handle planner-handle-left" onPointerDown={(e) => startBlockDrag(e, "resize-start", a)} />
                              <Box className="planner-block-body" onPointerDown={(e) => startBlockDrag(e, "move", a)}>
                                <span className="planner-block-area">{formatAssignmentAreaLabel(a.area, a.immobile)}</span>
                                {dur >= 2 && <span className="planner-block-time">{pad2(startH)}–{pad2(endH)}</span>}
                              </Box>
                              <Box className="planner-handle planner-handle-right" onPointerDown={(e) => startBlockDrag(e, "resize-end", a)} />
                              <button
                                className="planner-block-delete"
                                title="Elimina"
                                onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(a.id); }}
                                onPointerDown={(e) => e.stopPropagation()}
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
                    const startHourRaw = timeToHourRaw(a.start_time);
                    const dur = endH - startH;
                    const blockTop = 4 + a.lane * LANE_H;
                    const emp = employeeById[a.employee_id];
                    const breakSegment = getBreakSegmentForAssignment(a.employee_id, a);
                    const breakWidth = breakSegment ? Math.max(6, (breakSegment.endHour - breakSegment.startHour) * HOUR_WIDTH) : 0;
                    return (
                      <Tooltip key={a.id} title={renderAssignmentTooltip(a, startH, endH, breakSegment)} placement="top" arrow enterDelay={150}>
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
                          {breakSegment && (
                            <Box
                              className="planner-break-overlay"
                              style={{ left: Math.max(0, (breakSegment.startHour - startHourRaw) * HOUR_WIDTH), width: breakWidth }}
                            >
                              {breakWidth >= 48 && <span className="planner-break-label">Pausa</span>}
                            </Box>
                          )}
                          <Box className="planner-block-body planner-area-block-body">
                            {emp && <EmployeeAvatar employee={emp} size={20} />}
                            <span className="planner-block-area">{a.employee_name}</span>
                          </Box>
                          <button
                            className="planner-block-delete"
                            title="Elimina"
                            onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(a.id); }}
                            onPointerDown={(e) => e.stopPropagation()}
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
          width: 310,
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
        <Box sx={{ px: 2, py: 1.5, borderBottom: "1px solid var(--pl-border)", background: darkMode ? "var(--pl-bg)" : "#fbfbfc", display: "flex", alignItems: "center", gap: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: 13, color: "var(--pl-text)", flex: 1 }}>
            Prenotazioni
          </Typography>
          {prenotazioniQuery.isLoading && <CircularProgress size={14} />}
          {!prenotazioniQuery.isLoading && (
            <Chip
              label={prenotazioniQuery.data?.count ?? 0}
              size="small"
              sx={{ height: 20, fontSize: 11, fontWeight: 700, "& .MuiChip-label": { px: "6px" } }}
            />
          )}
        </Box>

        <Box sx={{ flex: 1, overflowY: "auto", maxHeight: 600 }}>
          {prenotazioniQuery.isError && (
            <Box sx={{ p: 2 }}>
              <Alert severity="warning" sx={{ fontSize: 12 }}>
                Impossibile caricare le prenotazioni
              </Alert>
            </Box>
          )}

          {!prenotazioniQuery.isLoading && !prenotazioniQuery.isError && (prenotazioniQuery.data?.items ?? []).length === 0 && (
            <Box sx={{ p: 2, textAlign: "center" }}>
              <Typography sx={{ fontSize: 12, color: "var(--pl-faded)" }}>Nessuna prenotazione</Typography>
            </Box>
          )}

          {(prenotazioniQuery.data?.items ?? []).map((item, idx) => (
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
              </Box>
            </Box>
          ))}
        </Box>
      </Paper>

      </Box>

      {/* ── Area picker ─────────────────────────────────────────────── */}
      <Dialog open={!!areaPickerState} onClose={() => setAreaPickerState(null)} PaperProps={{ className: "planner-dialog" }}>
        <DialogTitle className="planner-dialog-title">
          Seleziona building
          {areaPickerState && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {pad2(areaPickerState.startHour)}:00 – {pad2(areaPickerState.endHour)}:00
            </Typography>
          )}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
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
              createMutation.isPending
              || !areaPickerState?.area
              || (getImmobileOptions(areaPickerState?.area, areas).length > 0 && !normalizeImmobile(areaPickerState?.area, areaPickerState?.immobile, areas))
            }
            onClick={() => {
              if (!areaPickerState) return;
              createMutation.mutate({
                employee_id: areaPickerState.employeeId,
                work_date: selectedDate,
                start_time: hourToTime(areaPickerState.startHour),
                end_time: hourToTime(areaPickerState.endHour),
                area: areaPickerState.area,
                immobile: normalizeImmobile(areaPickerState.area, areaPickerState.immobile, areas),
                cause: "PRESENZA",
                notes: areaPickerState.notes?.trim() || null,
              });
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
              {pad2(timeToHour(editingBlock.start_time))}:00 – {pad2(timeToHour(editingBlock.end_time))}:00
              &nbsp;·&nbsp;{editingBlock.employee_name ?? ""}
            </Typography>
          )}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
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
            <TextField label="Note" value={editForm.notes ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} multiline minRows={2} fullWidth size="small" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button color="error" onClick={() => { if (editingBlock) deleteMutation.mutate(editingBlock.id); }} disabled={deleteMutation.isPending}>
            {deleteMutation.isPending ? "Eliminazione…" : "Elimina"}
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setEditingBlock(null)}>Annulla</Button>
          <Button
            variant="contained"
            onClick={saveEditBlock}
            disabled={
              updateMutation.isPending
              || (getImmobileOptions(editForm.area, areas).length > 0 && !normalizeImmobile(editForm.area, editForm.immobile, areas))
            }
          >
            {updateMutation.isPending ? "Salvataggio…" : "Salva"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Genera da standard dialog ──────────────────────────────── */}
      <Dialog
        open={generateOpen}
        onClose={() => !generateMutation.isPending && setGenerateOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ className: "planner-dialog" }}
      >
        <DialogTitle className="planner-dialog-title">
          Genera turni da standard
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {dayjs(selectedDate).format("dddd D MMMM YYYY")} · tutti i dipendenti con orario configurato
          </Typography>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1} sx={{ pt: 0.5 }}>
            <Stack direction="row" spacing={1.5} alignItems="baseline">
              <Typography variant="h3" fontWeight={800} color="primary.main" lineHeight={1}>
                {generateCandidates.toCreate.length}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {generateCandidates.toCreate.length === 1 ? "turno da creare" : "turni da creare"}
              </Typography>
            </Stack>
            {generateCandidates.skipCount > 0 && (
              <Typography variant="body2" color="text.secondary">
                {generateCandidates.skipCount} saltati — già assegnati, assenti o senza orario / area
              </Typography>
            )}
            {generateCandidates.skipImmobile > 0 && (
              <Typography variant="body2" color="warning.main">
                {generateCandidates.skipImmobile} da assegnare manualmente — area con immobile obbligatorio
              </Typography>
            )}
            {generateCandidates.toCreate.length === 0 && generateCandidates.skipCount === 0 && generateCandidates.skipImmobile === 0 && (
              <Typography variant="body2" color="text.secondary">
                Nessun dipendente trovato per il ruolo selezionato.
              </Typography>
            )}
            {generateMutation.isError && (
              <Alert severity="error" sx={{ mt: 1 }}>{String(generateMutation.error?.message)}</Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGenerateOpen(false)} disabled={generateMutation.isPending}>
            Annulla
          </Button>
          <Button
            variant="contained"
            disabled={generateCandidates.toCreate.length === 0 || generateMutation.isPending}
            onClick={() => generateMutation.mutate(generateCandidates.toCreate)}
          >
            {generateMutation.isPending
              ? <><CircularProgress size={16} color="inherit" sx={{ mr: 1 }} />Creazione…</>
              : `Crea ${generateCandidates.toCreate.length} turni`}
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
              onChange={(e) => setCopyFromDate(e.target.value)}
              inputProps={{ max: dayjs(selectedDate).subtract(1, "day").format("YYYY-MM-DD") }}
              InputLabelProps={{ shrink: true }}
              fullWidth
              size="small"
            />
            <Alert severity="info" sx={{ fontSize: 13 }}>
              Verranno copiati tutti i blocchi del giorno selezionato verso il <strong>{dayjs(selectedDate).format("D MMMM YYYY")}</strong>.
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
            disabled={!copyFromDate || copyFromMutation.isPending}
            onClick={() => copyFromMutation.mutate(copyFromDate)}
          >
            {copyFromMutation.isPending ? "Copia in corso…" : "Copia"}
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
