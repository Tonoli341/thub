import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import FilterBar from "../components/FilterBar";
import PageHeader, { HeaderButton } from "../components/PageHeader";
import { headRowSx, tableSx } from "../components/tableStyles";
import { employeesColumns } from "./employeesColumns";
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  getEmployeeCourseBadges,
  getEmployeeOptions,
  getEmployeeExpirations,
  getEmployeePhoto,
  getEmployees,
  getOperationalAreas,
  getOrgDepartments,
  getOrgFunctions,
  syncEmployees,
  updateEmployeeAppRole,
  updateEmployeeDefaultArea,
  updateEmployeeAbsencePermissions,
  updateEmployeeConfigurationPermissions,
  updateEmployeeLocalUser,
  updateEmployeeManager,
  updateEmployeeOrganization,
  updateEmployeePhone,
  updateEmployeeSchedule,
} from "../api";
import { useAuth } from "../auth";
import { plannerBuildingCodes } from "../buildings";

const RLS_EXPIRATION_DESCRIPTION = "RLS";

const roleOptions = [
  { value: "IMPIEGATO", label: "Impiegato", icon: "💻" },
  { value: "MAGAZZINIERE", label: "Magazziniere", icon: "📦" },
  { value: "AUTISTA", label: "Autista", icon: "🚚" },
  { value: "OFFICINA", label: "Officina", icon: "🔧" },
  { value: "PULIZIE", label: "Pulizie", icon: "🧹" },
];

const badgeFilterOptions = [
  { value: "antincendio", label: "Antincendio", icon: "🔥" },
  { value: "rls", label: "RLS", icon: "🛡️" },
  { value: "preposto", label: "Preposto", icon: "👷" },
  { value: "primo_soccorso", label: "Primo soccorso", icon: "⛑️" },
];

const employeeStatusOptions = [
  { value: "active", label: "Attivi", icon: "🟢" },
  { value: "inactive", label: "Licenziati", icon: "⚫" },
  { value: "all", label: "Tutti", icon: "📋" },
];

const portalRoleFilterOptions = [
  { value: "admin", label: "Admin", icon: "admin-eye" },
  { value: "hr", label: "HR", icon: "🧾" },
  { value: "manager", label: "Manager", icon: "👔" },
  { value: "collaboratore", label: "Collaboratore", icon: "👨🏻" },
];

const portalRoleVisualStyles = {
  admin: { bg: "rgba(124,58,237,0.12)", color: "#6d28d9" },
  hr: { bg: "rgba(14,116,144,0.12)", color: "#0e7490" },
  manager: { bg: "rgba(180,83,9,0.12)", color: "#b45309" },
  collaboratore: { bg: "rgba(55,65,81,0.10)", color: "#374151" },
};

const filterCategoryStyles = {
  role: {
    labelColor: "#0f766e",
    activeBg: "#0f766e",
    activeHover: "#0b5f59",
    hoverBg: "rgba(15,118,110,0.08)",
    borderColor: "rgba(15,118,110,0.28)",
  },
  status: {
    labelColor: "#b45309",
    activeBg: "#b45309",
    activeHover: "#92400e",
    hoverBg: "rgba(180,83,9,0.08)",
    borderColor: "rgba(180,83,9,0.28)",
  },
  badge: {
    labelColor: "#7c3aed",
    activeBg: "#7c3aed",
    activeHover: "#6d28d9",
    hoverBg: "rgba(124,58,237,0.08)",
    borderColor: "rgba(124,58,237,0.28)",
  },
};

// Testo lungo troncato con l'ellissi: il valore pieno resta nel `title`.
const ellipsisCellSx = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

function roleMeta(role) {
  return roleOptions.find((option) => option.value === role) ?? { label: role || "Altro", icon: "👤" };
}

const DAY_LABELS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

const EMPTY_SCHEDULE = [
  { enabled: false, morning_start: null, morning_end: null, afternoon_start: null, afternoon_end: null },
  { enabled: false, morning_start: null, morning_end: null, afternoon_start: null, afternoon_end: null },
  { enabled: false, morning_start: null, morning_end: null, afternoon_start: null, afternoon_end: null },
  { enabled: false, morning_start: null, morning_end: null, afternoon_start: null, afternoon_end: null },
  { enabled: false, morning_start: null, morning_end: null, afternoon_start: null, afternoon_end: null },
  { enabled: false, morning_start: null, morning_end: null, afternoon_start: null, afternoon_end: null },
  { enabled: false, morning_start: null, morning_end: null, afternoon_start: null, afternoon_end: null },
];

const DEFAULT_SCHEDULE = [
  { enabled: true, morning_start: "08:00", morning_end: "12:00", afternoon_start: "13:00", afternoon_end: "18:00" },
  { enabled: true, morning_start: "08:00", morning_end: "12:00", afternoon_start: "13:00", afternoon_end: "18:00" },
  { enabled: true, morning_start: "08:00", morning_end: "12:00", afternoon_start: "13:00", afternoon_end: "18:00" },
  { enabled: true, morning_start: "08:00", morning_end: "12:00", afternoon_start: "13:00", afternoon_end: "18:00" },
  { enabled: true, morning_start: "08:00", morning_end: "12:00", afternoon_start: "13:00", afternoon_end: "18:00" },
  { enabled: false, morning_start: null,    morning_end: null,    afternoon_start: null,    afternoon_end: null    },
  { enabled: false, morning_start: null,    morning_end: null,    afternoon_start: null,    afternoon_end: null    },
];

const plannerAccessLevelOptions = [
  { value: "self_read", label: "Solo se stesso · lettura" },
  { value: "team_read", label: "Se stesso + team · lettura" },
  { value: "team_write", label: "Se stesso + team · scrittura" },
  { value: "all_read", label: "Tutti · lettura" },
  { value: "all_write", label: "Tutti · scrittura" },
];

function resolveEffectivePlannerLevel(appRole, storedLevel, hasDirectReports) {
  if (storedLevel) return storedLevel;
  if (appRole === "ADMIN") return "all_write";
  if (appRole === "HR") return "all_read";
  if (hasDirectReports) return "team_read";
  return "self_read";
}

function resolveEffectivePortalRole(appRole, hasDirectReports) {
  if (appRole === "ADMIN") return "admin";
  if (appRole === "HR") return "hr";
  if (hasDirectReports) return "manager";
  return "collaboratore";
}

function resolveEffectiveOrganizationAccess(appRole, storedEnabled, hasDirectReports) {
  const effectiveRole = resolveEffectivePortalRole(appRole, hasDirectReports);
  if (effectiveRole === "admin" || effectiveRole === "hr") return true;
  if (effectiveRole === "manager") return Boolean(storedEnabled);
  return false;
}

function canEditOrganizationAccess(appRole, hasDirectReports) {
  return resolveEffectivePortalRole(appRole, hasDirectReports) === "manager";
}

function getAutoPortalRoleLabel(hasDirectReports) {
  return hasDirectReports ? "Manager (Auto)" : "Collaboratore (Auto)";
}

function portalRoleMeta(role) {
  return portalRoleFilterOptions.find((option) => option.value === role) ?? { label: role || "Sconosciuto", icon: "👤" };
}

function getPortalRoleDisplayLabel(appRole, hasDirectReports) {
  if (appRole === "ADMIN") return "Admin";
  if (appRole === "HR") return "HR";
  return hasDirectReports ? "Mgr" : "Collab";
}

function PortalRoleIcon({ role, size = 14 }) {
  const meta = portalRoleMeta(role);
  if (meta.icon !== "admin-eye") {
    return (
      <Box component="span" sx={{ fontSize: size, lineHeight: 1 }}>
        {meta.icon}
      </Box>
    );
  }

  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      sx={{ width: size + 2, height: size + 2, display: "block" }}
      aria-hidden="true"
    >
      <path d="M12 3 21 19H3z" fill="currentColor" opacity="0.22" />
      <path d="M12 3 21 19H3z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M8 12c1.2-1.5 2.5-2.2 4-2.2s2.8.7 4 2.2c-1.2 1.5-2.5 2.2-4 2.2S9.2 13.5 8 12Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" />
    </Box>
  );
}

function timeToMinutes(value) {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

function minutesToTime(totalMinutes) {
  if (totalMinutes === null || totalMinutes === undefined) return null;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function diffMinutes(start, end) {
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  if (startMinutes === null || endMinutes === null) return null;
  return endMinutes - startMinutes;
}

function createStoredScheduleDay(day) {
  if (!day?.enabled) {
    return { enabled: false, start: null, end: null, break_minutes: 0, break_start: null, break_end: null };
  }

  const morningStart = day.morning_start ?? null;
  const morningEnd = day.morning_end ?? null;
  const afternoonStart = day.afternoon_start ?? null;
  const afternoonEnd = day.afternoon_end ?? null;
  const hasMorning = Boolean(morningStart && morningEnd);
  const hasAfternoon = Boolean(afternoonStart && afternoonEnd);

  if (!hasMorning && !hasAfternoon) {
    return { enabled: true, start: null, end: null, break_minutes: 0, break_start: null, break_end: null };
  }

  // Part-time: solo mattina o solo pomeriggio, nessuna pausa da calcolare
  if (!hasMorning) {
    return { enabled: true, start: afternoonStart, end: afternoonEnd, break_minutes: 0, break_start: null, break_end: null };
  }
  if (!hasAfternoon) {
    return { enabled: true, start: morningStart, end: morningEnd, break_minutes: 0, break_start: null, break_end: null };
  }

  return {
    enabled: true,
    start: morningStart,
    end: afternoonEnd,
    break_minutes: Math.max(diffMinutes(morningEnd, afternoonStart) ?? 0, 0),
    break_start: morningEnd,
    break_end: afternoonStart,
  };
}

function buildDraftSchedule(schedule = DEFAULT_SCHEDULE) {
  return (schedule ?? DEFAULT_SCHEDULE).map((day) => {
    if (!day?.enabled) {
      return {
        enabled: false,
        morning_start: null,
        morning_end: null,
        afternoon_start: null,
        afternoon_end: null,
        ...createStoredScheduleDay({ enabled: false }),
      };
    }

    if (day.morning_start || day.morning_end || day.afternoon_start || day.afternoon_end) {
      return {
        enabled: true,
        morning_start: day.morning_start ?? null,
        morning_end: day.morning_end ?? null,
        afternoon_start: day.afternoon_start ?? null,
        afternoon_end: day.afternoon_end ?? null,
        ...createStoredScheduleDay(day),
      };
    }

    const breakMinutes = Math.max(day.break_minutes ?? 0, 0);
    const storedBreakStart = day.break_start ?? null;
    const storedBreakEnd = day.break_end ?? null;

    let morningStart = null;
    let morningEnd = null;
    let afternoonStart = null;
    let afternoonEnd = null;

    if (day.start && day.end && storedBreakStart && storedBreakEnd) {
      morningStart = day.start;
      morningEnd = storedBreakStart;
      afternoonStart = storedBreakEnd;
      afternoonEnd = day.end;
    } else if (day.start && day.end && breakMinutes > 0) {
      const totalNetMinutes = calcNetMinutes(day.start, day.end, breakMinutes);
      const morningMinutes = totalNetMinutes && totalNetMinutes > 0 ? Math.floor(totalNetMinutes / 2) : null;
      if (morningMinutes !== null) {
        morningStart = day.start;
        morningEnd = minutesToTime(timeToMinutes(day.start) + morningMinutes);
        afternoonStart = minutesToTime(timeToMinutes(morningEnd) + breakMinutes);
        afternoonEnd = day.end;
      } else {
        morningStart = day.start;
        morningEnd = day.end;
      }
    } else if (day.start && day.end) {
      // Fascia unica senza pausa: orario part-time (solo mattina o solo pomeriggio).
      // Lo storage non distingue le due fasce, quindi si usa il mezzogiorno come
      // spartiacque, coerente con l'uso comune di "mattino"/"pomeriggio".
      const startMinutes = timeToMinutes(day.start);
      if (startMinutes !== null && startMinutes >= 12 * 60) {
        afternoonStart = day.start;
        afternoonEnd = day.end;
      } else {
        morningStart = day.start;
        morningEnd = day.end;
      }
    }

    const draftDay = {
      enabled: true,
      morning_start: morningStart,
      morning_end: morningEnd,
      afternoon_start: afternoonStart,
      afternoon_end: afternoonEnd,
    };

    return { ...draftDay, ...createStoredScheduleDay(draftDay) };
  });
}

function getDraftDayWorkedMinutes(day) {
  if (!day?.enabled) return null;
  const morningMinutes = diffMinutes(day.morning_start, day.morning_end);
  const afternoonMinutes = diffMinutes(day.afternoon_start, day.afternoon_end);
  return Math.max(morningMinutes ?? 0, 0) + Math.max(afternoonMinutes ?? 0, 0);
}

function calcNetMinutes(start, end, breakMins) {
  if (!start || !end) return null;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const net = (eh * 60 + em) - (sh * 60 + sm) - (breakMins || 0);
  return net;
}

function fmtMinutes(mins) {
  if (mins === null || mins === undefined || mins < 0) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatShortDate(value) {
  if (!value) return "—";
  const parsed = value.includes("T") ? new Date(value) : new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

function generateLocalUserPassword(length = 16) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const randomValues = new Uint32Array(length);
  window.crypto.getRandomValues(randomValues);
  return Array.from(randomValues, (value) => alphabet[value % alphabet.length]).join("");
}

function getExpirationStatus(value) {
  if (!value) return { label: "Senza data", color: "default" };

  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const target = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) return null;

  const targetUtc = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  const diffDays = Math.round((targetUtc - todayUtc) / 86400000);

  if (diffDays < 0) return { label: "Scaduta", color: "error" };
  if (diffDays === 0) return { label: "Oggi", color: "warning" };
  if (diffDays <= 30) return { label: `${diffDays} gg`, color: "warning" };
  return { label: "Valida", color: "success" };
}

function EmployeeAvatar({ employee, size = 48 }) {
  // stessa queryKey usata dal Planner/Calendario: la foto viene scaricata una
  // sola volta e condivisa tra tutte le pagine tramite la cache di react-query
  const { data: photoUrl } = useQuery({
    queryKey: ["employee-photo", employee.id],
    queryFn: () => getEmployeePhoto(employee.id).then((blob) => URL.createObjectURL(blob)),
    enabled: Boolean(employee.has_photo),
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
    retry: false,
  });

  return (
    <Avatar
      src={photoUrl || undefined}
      alt={employee.full_name}
      sx={{ width: size, height: size, bgcolor: "primary.main", fontWeight: 700, fontSize: size * 0.4 }}
    >
      {employee.full_name?.slice(0, 1) || "?"}
    </Avatar>
  );
}

function TabPanel({ children, value, index }) {
  return value === index ? <Box sx={{ pt: 2.5, pb: 3 }}>{children}</Box> : null;
}

function InfoRow({ label, value }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={500}>
        {value || "—"}
      </Typography>
    </Box>
  );
}

function InfoTile({ label, value, icon }) {
  return (
    <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: "action.hover" }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.25 }}>
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={600}>
        {value ? (icon ? `${icon} ${value}` : value) : "—"}
      </Typography>
    </Box>
  );
}

function EmployeeProfileDialog({
  employee,
  isAdmin,
  employeeOptions,
  areas,
  orgFunctions,
  orgDepartments,
  open,
  onClose,
  onSavePhone,
  onSaveArea,
  onSaveAbsencePermissions,
  onSaveConfigurationPermissions,
  onSaveAppRole,
  onSaveLocalUser,
  onSaveOrganization,
  onSaveSchedule,
}) {
  const [activeTab, setActiveTab] = useState(0);
  const [scheduleDraft, setScheduleDraft] = useState(() => buildDraftSchedule(EMPTY_SCHEDULE));
  const [phoneDraft, setPhoneDraft] = useState("");
  const [areaDraft, setAreaDraft] = useState("");
  const [immobileDraft, setImmobileDraft] = useState("");
  const [absenceConfig, setAbsenceConfig] = useState({
    absence_can_request_for_self: true,
    absence_can_request_for_reports: false,
    absence_can_request_for_all: false,
    absence_can_view_all: false,
    absence_can_edit_balances: false,
    absence_allowed_role_descriptions: [],
    absence_requires_approval: true,
    absence_approver_1_employee_id: null,
    absence_approver_2_employee_id: null,
    absence_approver_3_employee_id: null,
  });
  const [roleConfig, setRoleConfig] = useState({
    app_role: null,
    planner_access_level: null,
    config_can_access_organization: false,
    config_can_access_timesheets: false,
    config_can_access_workloads: true,
    config_can_access_expirations: true,
    config_expirations_scope: "all",
    config_can_access_deliveries: false,
    config_can_access_maintenance: false,
  });
  const [managerEmployeeId, setManagerEmployeeId] = useState(null);
  const [departmentDraft, setDepartmentDraft] = useState(null);
  const [isDirettivo, setIsDirettivo] = useState(false);
  const [localUserDraft, setLocalUserDraft] = useState({ username: "", password: "" });
  const [snackbar, setSnackbar] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const employeeExpirationsQuery = useQuery({
    queryKey: ["employee-expirations", employee?.id],
    queryFn: () => getEmployeeExpirations(employee.id),
    enabled: open && Boolean(employee?.id),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!employee) return;
    setPhoneDraft(employee.phone ?? "");
    setAreaDraft(employee.default_operational_area_id ?? "");
    setImmobileDraft(employee.default_immobile ?? "");

    const resolve = (storedId, fallbackFn) => {
      const explicit = storedId && storedId !== employee.id
        ? employeeOptions.find((o) => o.id === storedId) ?? null
        : null;
      return explicit ?? fallbackFn() ?? null;
    };

    const defaultApprover1 = resolve(
      employee.absence_approver_1_employee_id,
      () => employeeOptions.find((o) => o.id === employee.manager_employee_id && o.id !== employee.id),
    );
    const defaultApprover2 = resolve(
      employee.absence_approver_2_employee_id,
      () => employeeOptions.find((o) => o.tms_id === "85" && o.id !== employee.id),
    );
    const defaultApprover3 = resolve(
      employee.absence_approver_3_employee_id,
      () => employeeOptions.find((o) => o.tms_id === "86" && o.id !== employee.id),
    );

    setAbsenceConfig({
      absence_can_request_for_self: employee.absence_can_request_for_self,
      absence_can_request_for_reports: employee.absence_can_request_for_reports,
      absence_can_request_for_all: employee.absence_can_request_for_all,
      absence_can_view_all: employee.absence_can_view_all,
      absence_can_edit_balances: employee.absence_can_edit_balances ?? false,
      absence_allowed_role_descriptions: employee.absence_allowed_role_descriptions ?? [],
      absence_requires_approval: employee.absence_requires_approval,
      absence_approver_1_employee_id: defaultApprover1?.id ?? null,
      absence_approver_2_employee_id: defaultApprover2?.id ?? null,
      absence_approver_3_employee_id: defaultApprover3?.id ?? null,
    });

    setRoleConfig({
      app_role: employee.app_role ?? null,
      planner_access_level: resolveEffectivePlannerLevel(
        employee.app_role,
        employee.planner_access_level,
        employee.has_direct_reports,
      ),
      config_can_access_organization: resolveEffectiveOrganizationAccess(
        employee.app_role,
        employee.config_can_access_organization,
        employee.has_direct_reports,
      ),
      config_can_access_timesheets: employee.config_can_access_timesheets ?? false,
      config_can_access_workloads: employee.config_can_access_workloads ?? true,
      config_can_access_expirations: employee.config_can_access_expirations ?? true,
      config_expirations_scope: employee.config_expirations_scope
        ?? ((employee.config_can_access_expirations ?? true) ? "all" : "none"),
      config_can_access_deliveries: employee.config_can_access_deliveries ?? false,
      config_can_access_maintenance: employee.config_can_access_maintenance ?? false,
    });

    setManagerEmployeeId(employee.manager_employee_id ?? null);
    setDepartmentDraft(employee.organization_department ?? null);
    setIsDirettivo(employee.is_direttivo ?? false);
    setLocalUserDraft({
      username: employee.local_user_username ?? employee.tms_id ?? "",
      password: employee.local_user_username ? "" : generateLocalUserPassword(),
    });

    if (employee.default_schedule && employee.default_schedule.length === 7) {
      setScheduleDraft(buildDraftSchedule(employee.default_schedule));
    } else {
      setScheduleDraft(buildDraftSchedule(EMPTY_SCHEDULE));
    }
    setActiveTab(0);
    setSaveError(null);
  }, [employee, employeeOptions]);

  if (!employee) return null;

  const role = roleMeta(employee.tms_role_description);
  const managerOptions = employeeOptions.filter((o) => o.id !== employee.id);
  const selectedManager = managerOptions.find((o) => o.id === managerEmployeeId) ?? null;
  const currentArea = areas.find((a) => a.id === employee.default_operational_area_id);
  const employeeExpirations = employeeExpirationsQuery.data ?? [];

  async function withSave(fn) {
    setIsSaving(true);
    setSaveError(null);
    try {
      await fn();
    } catch (e) {
      setSaveError(e?.message || "Errore durante il salvataggio");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveProfile() {
    await withSave(async () => {
      if (!employee.phone_from_tms) await onSavePhone(employee.id, phoneDraft);
      setSnackbar("Profilo salvato");
    });
  }

  async function handleSaveOrganization() {
    await withSave(async () => {
      await onSaveOrganization(employee.id, {
        organization_role: employee.organization_role ?? null,
        organization_department: departmentDraft,
        manager_employee_id: managerEmployeeId,
        is_direttivo: isDirettivo,
      });
      setSnackbar("Organizzazione salvata");
    });
  }

  async function handleSaveAbsence() {
    await withSave(async () => {
      await onSaveAbsencePermissions(employee.id, absenceConfig);
      setSnackbar("Permessi assenze salvati");
    });
  }

  async function handleSaveAccess() {
    await withSave(async () => {
      await onSaveConfigurationPermissions(employee.id, {
        config_can_access_planning: employee.config_can_access_planning ?? false,
        config_can_access_organization: roleConfig.config_can_access_organization,
        config_can_access_timesheets: roleConfig.config_can_access_timesheets,
        config_can_access_workloads: roleConfig.config_can_access_workloads,
        config_can_access_expirations: roleConfig.config_expirations_scope !== "none",
        config_expirations_scope: roleConfig.config_expirations_scope,
        config_can_access_deliveries: roleConfig.config_can_access_deliveries,
        config_can_access_maintenance: roleConfig.config_can_access_maintenance,
      });
      await onSaveAppRole(employee.id, {
        app_role: roleConfig.app_role,
        planner_access_level: roleConfig.planner_access_level,
      });
      setSnackbar("Accessi portale salvati");
    });
  }

  async function handleSaveSchedule() {
    await withSave(async () => {
      const normalizedSchedule = scheduleDraft.map((day, idx) => {
        if (!day.enabled) {
          return { enabled: false, start: null, end: null, break_minutes: 0, break_start: null, break_end: null };
        }

        const hasMorning = Boolean(day.morning_start || day.morning_end);
        const hasAfternoon = Boolean(day.afternoon_start || day.afternoon_end);

        if (!hasMorning && !hasAfternoon) {
          throw new Error(`${DAY_LABELS[idx]}: inserisci almeno una fascia oraria (mattina o pomeriggio)`);
        }

        if (hasMorning) {
          if (!day.morning_start || !day.morning_end) {
            throw new Error(`${DAY_LABELS[idx]}: completa l'orario del mattino`);
          }
          const morningMinutes = diffMinutes(day.morning_start, day.morning_end);
          if (morningMinutes === null || morningMinutes <= 0) {
            throw new Error(`${DAY_LABELS[idx]}: l'orario del mattino non e valido`);
          }
        }

        if (hasAfternoon) {
          if (!day.afternoon_start || !day.afternoon_end) {
            throw new Error(`${DAY_LABELS[idx]}: completa l'orario del pomeriggio`);
          }
          const afternoonMinutes = diffMinutes(day.afternoon_start, day.afternoon_end);
          if (afternoonMinutes === null || afternoonMinutes <= 0) {
            throw new Error(`${DAY_LABELS[idx]}: l'orario del pomeriggio non e valido`);
          }
        }

        // Solo pomeriggio: nessuna pausa da validare, la mattina non e' lavorata
        if (!hasMorning) {
          return {
            enabled: true,
            start: day.afternoon_start,
            end: day.afternoon_end,
            break_minutes: 0,
            break_start: null,
            break_end: null,
          };
        }

        // Solo mattina: nessuna pausa da validare, il pomeriggio non e' lavorato
        if (!hasAfternoon) {
          return {
            enabled: true,
            start: day.morning_start,
            end: day.morning_end,
            break_minutes: 0,
            break_start: null,
            break_end: null,
          };
        }

        const breakMinutes = diffMinutes(day.morning_end, day.afternoon_start);
        if (breakMinutes === null || breakMinutes < 0) {
          throw new Error(`${DAY_LABELS[idx]}: la pausa deve essere tra mattino e pomeriggio`);
        }

        return {
          enabled: true,
          start: day.morning_start,
          end: day.afternoon_end,
          break_minutes: breakMinutes,
          break_start: day.morning_end,
          break_end: day.afternoon_start,
        };
      });

      await onSaveArea(employee.id, areaDraft, immobileDraft);
      await onSaveSchedule(employee.id, { default_schedule: normalizedSchedule });
      setSnackbar("Orario e area salvati");
    });
  }

  async function handleSaveLocalUser() {
    await withSave(async () => {
      const username = localUserDraft.username.trim();
      const password = localUserDraft.password.trim();
      if (!username) throw new Error("Compila il campo User");
      if (!password) throw new Error("Compila il campo Password");
      await onSaveLocalUser(employee.id, { username, password });
      setLocalUserDraft((current) => ({ ...current, password: "" }));
      setSnackbar("Credenziali Local User salvate");
    });
  }

  function updateDay(idx, patch) {
    setScheduleDraft((prev) => prev.map((day, i) => {
      if (i !== idx) return day;
      const next = { ...day, ...patch };
      return { ...next, ...createStoredScheduleDay(next) };
    }));
  }

  // Attiva/disattiva la fascia mattina o pomeriggio di un giorno, per orari part-time
  // (solo mattina / solo pomeriggio). Se si disattiva l'ultima fascia rimasta, si
  // disattiva l'intero giorno: non ha senso un giorno "lavorativo" senza orario.
  function toggleBlock(idx, block, checked) {
    const day = scheduleDraft[idx];
    if (checked) {
      updateDay(idx, block === "morning"
        ? { morning_start: day.morning_start ?? "08:00", morning_end: day.morning_end ?? "12:00" }
        : { afternoon_start: day.afternoon_start ?? "13:00", afternoon_end: day.afternoon_end ?? "18:00" });
      return;
    }

    const otherBlockHasValue = block === "morning"
      ? Boolean(day.afternoon_start || day.afternoon_end)
      : Boolean(day.morning_start || day.morning_end);

    if (!otherBlockHasValue) {
      updateDay(idx, {
        enabled: false,
        morning_start: null,
        morning_end: null,
        afternoon_start: null,
        afternoon_end: null,
      });
      return;
    }

    updateDay(idx, block === "morning"
      ? { morning_start: null, morning_end: null }
      : { afternoon_start: null, afternoon_end: null });
  }

  function copyMonToWeekdays() {
    const mon = scheduleDraft[0];
    setScheduleDraft((prev) =>
      prev.map((day, i) => (i >= 1 && i <= 4) ? { ...mon, ...createStoredScheduleDay(mon) } : day),
    );
  }

  const saveButton = (label, handler, disabled = false) => (
    <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}>
      <Button variant="contained" disabled={isSaving || disabled} onClick={handler}>
        {isSaving
          ? <CircularProgress size={18} color="inherit" />
          : label}
      </Button>
    </Stack>
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      {/* ── Header ── */}
      <Box sx={{ px: 3, pt: 2, pb: 2, borderBottom: "1px solid", borderColor: "divider" }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <EmployeeAvatar employee={employee} size={48} />
          <Typography variant="h6" fontWeight={800} noWrap sx={{ flex: 1, minWidth: 0 }}>
            {employee.full_name}
          </Typography>
          <Chip size="small" label={`Matr. ${employee.tms_id}`} variant="outlined" sx={{ flexShrink: 0 }} />
          <IconButton onClick={onClose} size="small" sx={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>
            ✕
          </IconButton>
        </Stack>
      </Box>

      {/* ── Tabs ── */}
      <Box sx={{ borderBottom: "1px solid", borderColor: "divider", px: 3 }}>
        <Tabs
          value={activeTab}
          onChange={(_, v) => { setActiveTab(v); setSaveError(null); }}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab label="Profilo" />
          <Tab label="Organizzazione" />
          <Tab label="Assenze" />
          <Tab label="Orario e Area" />
          <Tab label="Scadenze" />
          <Tab label="Accessi" />
          {isAdmin && <Tab label="Local User" />}
        </Tabs>
      </Box>

      <DialogContent sx={{ px: 3, py: 0 }}>

        {/* ── Tab 0: Profilo ── */}
        <TabPanel value={activeTab} index={0}>
          {/* Grid di info tiles */}
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(155px, 1fr))",
              gap: 1.5,
              mb: 2.5,
            }}
          >
            <InfoTile label="Ruolo" value={`${role.icon} ${role.label}`} />
            <InfoTile
              label="Stato"
              icon={employee.is_active ? "🟢" : "⚫"}
              value={employee.is_active ? "Attivo" : "Inattivo"}
            />
            <InfoTile label="Telefono" icon="📞" value={employee.phone} />
            <InfoTile label="Responsabile" icon="👤" value={employee.manager_employee_name} />
            <InfoTile label="Tipo contratto" icon="📋" value={employee.contract_type} />
            <InfoTile label="Datore di lavoro" icon="🏢" value={employee.datore_lavoro} />
            <InfoTile label="Funzione" icon="🎯" value={employee.organization_function} />
            <InfoTile label="Dipartimento" icon="🏛️" value={employee.organization_department} />
            <InfoTile
              label="Area operativa"
              icon="📍"
              value={areas.find((a) => a.id === employee.default_operational_area_id)?.name}
            />
          </Box>

          {/* Orario standard recap */}
          {(() => {
            const sched = employee.default_schedule;
            const hasSched = sched && sched.length === 7;
            const enabledDays = hasSched
              ? sched.map((d, i) => ({ ...d, label: DAY_LABELS[i] })).filter((d) => d.enabled)
              : [];
            const totalMins = enabledDays.reduce((s, d) => {
              const n = calcNetMinutes(d.start, d.end, d.break_minutes);
              return s + (n > 0 ? n : 0);
            }, 0);
            const isStdMonFri = hasSched
              && sched.slice(0, 5).every((d) => d.enabled && d.start === sched[0].start && d.end === sched[0].end && d.break_minutes === sched[0].break_minutes)
              && !sched[5].enabled && !sched[6].enabled;
            return (
              <Box
                sx={{
                  p: 1.5,
                  mb: 2.5,
                  borderRadius: 2,
                  border: "1px dashed",
                  borderColor: "divider",
                }}
              >
                <Typography
                  variant="caption"
                  color="text.secondary"
                  fontWeight={700}
                  sx={{ display: "block", mb: 0.5, textTransform: "uppercase", letterSpacing: "0.05em" }}
                >
                  Orario standard
                </Typography>
                {enabledDays.length === 0 ? (
                  <Typography variant="body2" color="text.disabled" fontStyle="italic">
                    Non configurato
                  </Typography>
                ) : isStdMonFri ? (
                  <Typography variant="body2" fontWeight={500}>
                    {"Lun–Ven "}
                    {sched[0].start}{"–"}{sched[0].end}
                    <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                      · {fmtMinutes(totalMins)}/sett.
                    </Typography>
                  </Typography>
                ) : (
                  <Typography variant="body2" fontWeight={500}>
                    {enabledDays.map((d) => `${d.label} ${d.start}–${d.end}`).join(" · ")}
                    <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                      · {fmtMinutes(totalMins)}/sett.
                    </Typography>
                  </Typography>
                )}
                <Typography
                  variant="caption"
                  color="primary.main"
                  sx={{ display: "block", mt: 0.5, cursor: "pointer", "&:hover": { textDecoration: "underline" } }}
                  onClick={() => setActiveTab(3)}
                >
                  Modifica in "Orario e Area" →
                </Typography>
              </Box>
            );
          })()}

        </TabPanel>

        {/* ── Tab 4: Scadenze ── */}
        <TabPanel value={activeTab} index={4}>
          {employeeExpirationsQuery.isLoading ? (
            <Stack alignItems="center" sx={{ py: 4 }}>
              <CircularProgress size={28} />
            </Stack>
          ) : employeeExpirationsQuery.isError ? (
            <Alert severity="error">
              {employeeExpirationsQuery.error?.message || "Errore durante il caricamento delle scadenze"}
            </Alert>
          ) : employeeExpirations.length === 0 ? (
            <Alert severity="info">Nessuna scadenza trovata nel TMS per questo dipendente.</Alert>
          ) : (
            <Stack spacing={2}>
              <Box sx={{ p: 2, borderRadius: 2, bgcolor: "action.hover" }}>
                <Typography variant="body2" color="text.secondary">
                  Documenti e abilitazioni recuperati in tempo reale dal TMS, ordinati per prossima scadenza.
                </Typography>
              </Box>
              <Paper variant="outlined" sx={{ overflowX: "auto" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Tipo</TableCell>
                      <TableCell>Scadenza</TableCell>
                      <TableCell>Rilascio</TableCell>
                      <TableCell>Numero</TableCell>
                      <TableCell>Autorità</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {employeeExpirations.map((item) => {
                      const status = getExpirationStatus(item.expiration_date);
                      const isRlsDocument = (item.type_description || "").trim().toUpperCase() === RLS_EXPIRATION_DESCRIPTION;
                      return (
                        <TableRow key={`${item.type_code || item.type_description || "expiration"}-${item.document_number || ""}-${item.expiration_date || ""}`}>
                          <TableCell sx={{ minWidth: 240 }}>
                            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                              <Typography variant="body2" fontWeight={600}>
                                {item.type_description || item.type_code || "Scadenza"}
                              </Typography>
                              {isRlsDocument && (
                                <Chip
                                  size="small"
                                  label="🛡️ RLS"
                                  variant="outlined"
                                  sx={{ fontWeight: 700 }}
                                />
                              )}
                              {status && (
                                <Chip
                                  size="small"
                                  label={status.label}
                                  color={status.color}
                                  variant={status.color === "default" ? "outlined" : "filled"}
                                />
                              )}
                            </Stack>
                          </TableCell>
                          <TableCell>{formatShortDate(item.expiration_date)}</TableCell>
                          <TableCell>{formatShortDate(item.issue_date)}</TableCell>
                          <TableCell>{item.document_number || "—"}</TableCell>
                          <TableCell>{item.issuing_authority || "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Paper>
            </Stack>
          )}
        </TabPanel>

        {/* ── Tab 1: Organizzazione ── */}
        <TabPanel value={activeTab} index={1}>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Responsabile diretto per l&apos;organigramma.
            </Typography>
            <Autocomplete
              options={managerOptions}
              value={selectedManager}
              onChange={(_e, v) => setManagerEmployeeId(v?.id ?? null)}
              getOptionLabel={(o) => `${o.full_name} (${o.tms_id})`}
              isOptionEqualToValue={(o, v) => o.id === v.id}
              renderInput={(params) => (
                <TextField {...params} label="Responsabile diretto" size="small" />
              )}
            />
            {/* Funzione: sola lettura — si gestisce dalla sezione Funzione / Dipartimento */}
            {(() => {
              const responsibleOfFunctions = (orgFunctions ?? []).filter(
                (f) => f.responsible_employee_id === employee.id,
              );
              return (
                <Box
                  sx={{
                    p: 1.5,
                    borderRadius: 2,
                    border: "1px solid",
                    borderColor: "divider",
                    bgcolor: "action.hover",
                  }}
                >
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    fontWeight={700}
                    sx={{ display: "block", mb: 0.5, textTransform: "uppercase", letterSpacing: "0.05em" }}
                  >
                    Funzione
                  </Typography>
                  {responsibleOfFunctions.length > 0 ? (
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                      {responsibleOfFunctions.map((f) => (
                        <Chip
                          key={f.id}
                          label={f.name}
                          size="small"
                          sx={{ fontWeight: 600, bgcolor: "rgba(0,112,64,0.1)", color: "primary.main" }}
                        />
                      ))}
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.disabled" fontStyle="italic">
                      {employee.organization_function || "Non assegnata"}
                    </Typography>
                  )}
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
                    La funzione si gestisce dalla sezione Funzione / Dipartimento
                  </Typography>
                </Box>
              );
            })()}
            {/* Dipartimento: modificabile tra quelli della funzione del dipendente */}
            {(() => {
              const responsibleOfDepartments = (orgDepartments ?? []).filter(
                (d) => d.responsible_employee_id === employee.id,
              );
              const responsibleOfFunctions = (orgFunctions ?? []).filter(
                (f) => f.responsible_employee_id === employee.id,
              );
              const availableDepts = managerEmployeeId
                ? (orgDepartments ?? []).filter(
                    (d) => d.responsible_employee_id === managerEmployeeId && d.is_active !== false,
                  )
                : [];
              const selectedDept = availableDepts.find((d) => d.name === departmentDraft) ?? null;

              // Responsabili di dipartimento: campo read-only (il dipartimento li identifica)
              if (responsibleOfDepartments.length > 0) {
                return (
                  <Box sx={{ p: 1.5, borderRadius: 2, border: "1px solid", borderColor: "divider", bgcolor: "action.hover" }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ display: "block", mb: 0.5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Dipartimento
                    </Typography>
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                      {responsibleOfDepartments.map((d) => (
                        <Chip key={d.id} label={d.name} size="small" sx={{ fontWeight: 600, bgcolor: "rgba(0,112,64,0.1)", color: "primary.main" }} />
                      ))}
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
                      Il dipartimento si gestisce dalla sezione Funzione / Dipartimento
                    </Typography>
                  </Box>
                );
              }

              return (
                <Autocomplete
                  options={availableDepts}
                  value={selectedDept}
                  onChange={(_e, v) => setDepartmentDraft(v?.name ?? null)}
                  getOptionLabel={(o) => o.name}
                  isOptionEqualToValue={(o, v) => o.id === v.id}
                  disabled={!managerEmployeeId}
                  noOptionsText="Il responsabile diretto non è associato a nessun dipartimento"
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Dipartimento"
                      size="small"
                      helperText={!managerEmployeeId ? "Assegna prima un responsabile diretto" : undefined}
                    />
                  )}
                />
              );
            })()}
            <Box
              sx={{
                p: 1.5,
                borderRadius: 2,
                border: "1px solid",
                borderColor: "divider",
                bgcolor: "action.hover",
              }}
            >
              <Typography
                variant="caption"
                color="text.secondary"
                fontWeight={700}
                sx={{ display: "block", mb: 0.5, textTransform: "uppercase", letterSpacing: "0.05em" }}
              >
                Board
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={isDirettivo}
                    onChange={(e) => setIsDirettivo(e.target.checked)}
                    color="primary"
                    size="small"
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2" fontWeight={600}>Membro del Board</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Compare nel box Board in cima all&apos;organigramma
                    </Typography>
                  </Box>
                }
                sx={{ alignItems: "flex-start", mt: 0 }}
              />
            </Box>
            {saveError && <Alert severity="error" onClose={() => setSaveError(null)}>{saveError}</Alert>}
            {saveButton("Salva organizzazione", handleSaveOrganization)}
          </Stack>
        </TabPanel>

        {/* ── Tab 2: Assenze ── */}
        <TabPanel value={activeTab} index={2}>
          <Stack spacing={2.5}>
            {/* Who can request */}
            <Box sx={{ p: 2, borderRadius: 2, bgcolor: "action.hover" }}>
              <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
                Può richiedere assenze per:
              </Typography>
              <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={absenceConfig.absence_can_request_for_self}
                      onChange={(e) =>
                        setAbsenceConfig((c) => ({ ...c, absence_can_request_for_self: e.target.checked }))
                      }
                    />
                  }
                  label="Se stesso"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={absenceConfig.absence_can_request_for_reports}
                      onChange={(e) =>
                        setAbsenceConfig((c) => ({ ...c, absence_can_request_for_reports: e.target.checked }))
                      }
                    />
                  }
                  label="Sottoposti"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={absenceConfig.absence_can_request_for_all}
                      onChange={(e) =>
                        setAbsenceConfig((c) => ({ ...c, absence_can_request_for_all: e.target.checked }))
                      }
                    />
                  }
                  label="Tutti"
                />
              </Stack>
            </Box>

            <Box sx={{ p: 2, borderRadius: 2, bgcolor: "action.hover" }}>
              <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                Può vedere le ferie di tutti
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                Permette di visualizzare tutte le assenze anche se non può richiederle per tutti.
              </Typography>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={absenceConfig.absence_can_view_all}
                    onChange={(e) =>
                      setAbsenceConfig((c) => ({ ...c, absence_can_view_all: e.target.checked }))
                    }
                  />
                }
                label="Abilitato"
              />
            </Box>

            <Box sx={{ p: 2, borderRadius: 2, bgcolor: "action.hover" }}>
              <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                Può modificare ferie e permessi residui
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                Disponibile esclusivamente per utenti con ruolo Admin o HR. Senza questa abilitazione il tab Residui resta in sola lettura.
              </Typography>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={absenceConfig.absence_can_edit_balances}
                    disabled={!['ADMIN', 'HR'].includes((employee.app_role ?? '').toUpperCase())}
                    onChange={(e) =>
                      setAbsenceConfig((c) => ({ ...c, absence_can_edit_balances: e.target.checked }))
                    }
                  />
                }
                label="Abilitato"
              />
            </Box>

            <Autocomplete
              multiple
              options={roleOptions.map((o) => o.value)}
              value={absenceConfig.absence_allowed_role_descriptions}
              onChange={(_e, v) =>
                setAbsenceConfig((c) => ({ ...c, absence_allowed_role_descriptions: v }))
              }
              getOptionLabel={(v) => {
                const opt = roleOptions.find((o) => o.value === v);
                return opt ? `${opt.icon} ${opt.label}` : v;
              }}
              renderTags={(v, getTagProps) =>
                v.map((val, i) => {
                  const opt = roleOptions.find((o) => o.value === val);
                  return (
                    <Chip
                      key={val}
                      label={opt ? `${opt.icon} ${opt.label}` : val}
                      size="small"
                      {...getTagProps({ index: i })}
                    />
                  );
                })
              }
              renderInput={(params) => (
                <TextField {...params} label="Categorie autorizzate" size="small" />
              )}
            />

            <Divider />

            <FormControlLabel
              control={
                <Checkbox
                  checked={absenceConfig.absence_requires_approval}
                  onChange={(e) =>
                    setAbsenceConfig((c) => ({ ...c, absence_requires_approval: e.target.checked }))
                  }
                />
              }
              label={<Typography variant="body2" fontWeight={600}>Richiede approvazione</Typography>}
            />

            {absenceConfig.absence_requires_approval && (
              <Stack spacing={2}>
                {[1, 2, 3].map((idx) => {
                  const field = `absence_approver_${idx}_employee_id`;
                  const selected = employeeOptions.find((o) => o.id === absenceConfig[field]) ?? null;
                  return (
                    <Autocomplete
                      key={field}
                      options={employeeOptions.filter((o) => o.id !== employee.id)}
                      value={selected}
                      onChange={(_e, v) =>
                        setAbsenceConfig((c) => ({ ...c, [field]: v?.id ?? null }))
                      }
                      getOptionLabel={(o) => `${o.full_name} (${o.tms_id})`}
                      isOptionEqualToValue={(o, v) => o.id === v.id}
                      renderInput={(params) => (
                        <TextField {...params} label={`Approvatore ${idx}`} size="small" />
                      )}
                    />
                  );
                })}
              </Stack>
            )}

            {saveError && <Alert severity="error" onClose={() => setSaveError(null)}>{saveError}</Alert>}
            {saveButton("Salva permessi", handleSaveAbsence)}
          </Stack>
        </TabPanel>

        {/* ── Tab 5: Accessi portale ── */}
        <TabPanel value={activeTab} index={5}>
          <Stack spacing={2.5}>
            <Box sx={{ p: 2, borderRadius: 2, bgcolor: "action.hover" }}>
              <Typography variant="body2" color="text.secondary">
                Il ruolo determina le sezioni del portale visibili. Admin e HR si impostano manualmente;
                Manager e Collaboratore vengono assegnati automaticamente in base ai riporti diretti.
              </Typography>
              {!isAdmin && (
                <Typography variant="body2" color="warning.main" sx={{ mt: 1 }}>
                  Solo gli amministratori possono modificare questa sezione.
                </Typography>
              )}
            </Box>
            <FormControl size="small" fullWidth>
              <InputLabel shrink>Ruolo portale</InputLabel>
              <Select
                label="Ruolo portale"
                value={roleConfig.app_role ?? ""}
                displayEmpty
                disabled={!isAdmin}
                renderValue={(value) => {
                  if (value === "ADMIN") return "Admin";
                  if (value === "HR") return "HR / Responsabile HR";
                  return getAutoPortalRoleLabel(employee.has_direct_reports);
                }}
                onChange={(e) => {
                  const newAppRole = e.target.value || null;
                  setRoleConfig((c) => ({
                    ...c,
                    app_role: newAppRole,
                    planner_access_level: resolveEffectivePlannerLevel(
                      newAppRole,
                      null,
                      employee.has_direct_reports,
                    ),
                    config_can_access_organization: resolveEffectiveOrganizationAccess(
                      newAppRole,
                      false,
                      employee.has_direct_reports,
                    ),
                  }));
                }}
              >
                <MenuItem value="">{getAutoPortalRoleLabel(employee.has_direct_reports)}</MenuItem>
                <MenuItem value="ADMIN">Admin</MenuItem>
                <MenuItem value="HR">HR / Responsabile HR</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth>
              <InputLabel>Livello planner</InputLabel>
              <Select
                label="Livello planner"
                value={roleConfig.planner_access_level ?? ""}
                disabled={!isAdmin || roleConfig.app_role === "ADMIN"}
                onChange={(e) =>
                  setRoleConfig((c) => ({ ...c, planner_access_level: e.target.value || null }))
                }
              >
                {plannerAccessLevelOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Typography variant="caption" color="text.secondary">
              Il livello mostrato è quello effettivo: Admin → tutti scrittura (fisso), HR → tutti lettura (default), Manager → team lettura (default), Collaboratore → solo se stesso (default). In Auto puoi comunque assegnare manualmente qualsiasi livello planner.
            </Typography>
            <Box sx={{ p: 2, borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={Boolean(roleConfig.config_can_access_organization)}
                    onChange={(e) =>
                      setRoleConfig((current) => ({ ...current, config_can_access_organization: e.target.checked }))
                    }
                    color="primary"
                    size="small"
                    disabled={!isAdmin || !canEditOrganizationAccess(roleConfig.app_role, employee.has_direct_reports)}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2" fontWeight={600}>Accesso organizzazione</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Admin e HR sempre abilitati. Manager configurabile da toggle. Collaboratore sempre disabilitato.
                    </Typography>
                  </Box>
                }
                sx={{ alignItems: "flex-start", mt: 0 }}
              />
            </Box>
            <Box sx={{ p: 2, borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={Boolean(roleConfig.config_can_access_timesheets)}
                    onChange={(e) =>
                      setRoleConfig((current) => ({ ...current, config_can_access_timesheets: e.target.checked }))
                    }
                    color="primary"
                    size="small"
                    disabled={!isAdmin}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2" fontWeight={600}>Accesso rendicontazioni</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Admin sempre abilitato. Per HR e Manager il toggle deve essere attivo (visibilità su tutta
                      l'azienda). Per un Collaboratore il toggle non dà accesso alle rendicontazioni aziendali, ma
                      abilita la Rendicontazione operativa solo per le squadre di cui è indicato come owner.
                    </Typography>
                  </Box>
                }
                sx={{ alignItems: "flex-start", mt: 0 }}
              />
            </Box>
            <Box sx={{ p: 2, borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={Boolean(roleConfig.config_can_access_workloads)}
                    onChange={(e) =>
                      setRoleConfig((current) => ({ ...current, config_can_access_workloads: e.target.checked }))
                    }
                    color="primary"
                    size="small"
                    disabled={!isAdmin}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2" fontWeight={600}>Accesso carichi</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Attivo di default. Se disattivato, la pagina Carichi non è visibile al dipendente.
                    </Typography>
                  </Box>
                }
                sx={{ alignItems: "flex-start", mt: 0 }}
              />
            </Box>
            <Box sx={{ p: 2, borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
              <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>Accesso scadenze</Typography>
              <ToggleButtonGroup
                value={roleConfig.config_expirations_scope}
                exclusive
                fullWidth
                size="small"
                disabled={!isAdmin}
                aria-label="Ambito accesso scadenze"
                onChange={(_event, nextValue) => {
                  if (nextValue === null) return;
                  setRoleConfig((current) => ({
                    ...current,
                    config_expirations_scope: nextValue,
                    config_can_access_expirations: nextValue !== "none",
                  }));
                }}
                sx={{
                  flexWrap: "nowrap",
                  "& .MuiToggleButton-root": {
                    flex: 1,
                    whiteSpace: "nowrap",
                    textTransform: "none",
                    fontWeight: 600,
                    "&.Mui-selected": {
                      bgcolor: "#007040",
                      color: "#fff",
                      borderColor: "#007040",
                      "&:hover": {
                        bgcolor: "#005c35",
                        color: "#fff",
                      },
                    },
                  },
                }}
              >
                <ToggleButton value="all">Tutte</ToggleButton>
                <ToggleButton value="reports">Solo riporti</ToggleButton>
                <ToggleButton value="none">Nessuna</ToggleButton>
              </ToggleButtonGroup>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                “Solo riporti” mostra nella home le scadenze dei riporti diretti e indiretti.
              </Typography>
            </Box>
            <Box sx={{ p: 2, borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={Boolean(roleConfig.config_can_access_deliveries)}
                    onChange={(e) =>
                      setRoleConfig((current) => ({ ...current, config_can_access_deliveries: e.target.checked }))
                    }
                    color="primary"
                    size="small"
                    disabled={!isAdmin}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2" fontWeight={600}>Accesso consegne</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Admin e HR sempre abilitati. Per gli altri ruoli il toggle deve essere attivo per vedere la sezione Consegne (DPI, vestiario e dotazione IT).
                    </Typography>
                  </Box>
                }
                sx={{ alignItems: "flex-start", mt: 0 }}
              />
            </Box>
            <Box sx={{ p: 2, borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={Boolean(roleConfig.config_can_access_maintenance)}
                    onChange={(e) =>
                      setRoleConfig((current) => ({ ...current, config_can_access_maintenance: e.target.checked }))
                    }
                    color="primary"
                    size="small"
                    disabled={!isAdmin}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2" fontWeight={600}>Accesso manutenzioni</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Admin sempre abilitato. Per gli altri utenti il toggle rende visibile la sezione Manutenzioni e il questionario condiviso.
                    </Typography>
                  </Box>
                }
                sx={{ alignItems: "flex-start", mt: 0 }}
              />
            </Box>
            {saveError && <Alert severity="error" onClose={() => setSaveError(null)}>{saveError}</Alert>}
            {saveButton("Salva accessi", handleSaveAccess, !isAdmin)}
          </Stack>
        </TabPanel>

        {isAdmin && (
          <TabPanel value={activeTab} index={6}>
            <Stack spacing={2.5}>
              <Box sx={{ p: 2, borderRadius: 2, bgcolor: "action.hover" }}>
                <Typography variant="body2" color="text.secondary">
                  Credenziali locali usate da tool esterni. La password scade e dopo la scadenza l&apos;autenticazione viene rifiutata finché non viene aggiornata.
                </Typography>
              </Box>
              <TextField
                label="User"
                size="small"
                value={localUserDraft.username}
                onChange={(e) => setLocalUserDraft((current) => ({ ...current, username: e.target.value }))}
                helperText="Precompilato con la matricola ma modificabile"
                fullWidth
              />
              <TextField
                label="Password"
                size="small"
                type="text"
                value={localUserDraft.password}
                onChange={(e) => setLocalUserDraft((current) => ({ ...current, password: e.target.value }))}
                placeholder={employee.local_user_username ? "Inserisci una nuova password per aggiornarla" : ""}
                helperText={employee.local_user_username ? "La password attuale non è visibile. Inseriscine una nuova oppure rigenerala." : "Password generata automaticamente ma modificabile"}
                fullWidth
              />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                <Button
                  variant="outlined"
                  onClick={() => setLocalUserDraft((current) => ({ ...current, password: generateLocalUserPassword() }))}
                >
                  Genera password
                </Button>
                <Paper variant="outlined" sx={{ p: 1.5, flex: 1 }}>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Chip
                      size="small"
                      color={employee.local_user_password_is_expired ? "error" : "success"}
                      label={employee.local_user_password_is_expired ? "Password scaduta" : "Password valida"}
                    />
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`Scadenza: ${formatShortDate(employee.local_user_password_expires_at)}`}
                    />
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`Ultimo cambio: ${formatShortDate(employee.local_user_password_updated_at)}`}
                    />
                  </Stack>
                </Paper>
              </Stack>
              {saveError && <Alert severity="error" onClose={() => setSaveError(null)}>{saveError}</Alert>}
              {saveButton("Salva Local User", handleSaveLocalUser)}
            </Stack>
          </TabPanel>
        )}

        {/* ── Tab 3: Orario e Area ── */}
        <TabPanel value={activeTab} index={3}>
          <Stack spacing={2.5}>
            <Typography variant="body2" color="text.secondary">
              Imposta l&apos;area operativa di appartenenza e l&apos;orario contrattuale settimanale.
              L&apos;orario viene usato come riferimento nel Planner per precompilare i turni.
              Deseleziona la casella di mattino o pomeriggio per un orario part-time (solo mattina o solo pomeriggio).
            </Typography>

            {/* Area operativa */}
            <FormControl size="small" fullWidth>
              <InputLabel>Area operativa</InputLabel>
              <Select
                label="Area operativa"
                value={areaDraft}
                onChange={(e) => { setAreaDraft(e.target.value); setImmobileDraft(""); }}
              >
                <MenuItem value=""><em>Nessuna area</em></MenuItem>
                {(areas ?? []).map((area) => (
                  <MenuItem key={area.id} value={area.id}>{area.name}</MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Immobile (solo se l'area ha buildings visibili nel Planner) */}
            {(() => {
              const selectedArea = (areas ?? []).find((a) => a.id === areaDraft);
              const buildings = plannerBuildingCodes(selectedArea?.buildings);
              if (buildings.length === 0) return null;
              return (
                <FormControl size="small" fullWidth>
                  <InputLabel>Immobile</InputLabel>
                  <Select
                    label="Immobile"
                    value={immobileDraft}
                    onChange={(e) => setImmobileDraft(e.target.value)}
                  >
                    <MenuItem value=""><em>Nessuno</em></MenuItem>
                    {buildings.map((b) => (
                      <MenuItem key={b} value={b}>{b}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              );
            })()}

            <Divider />

            {/* Compact schedule grid */}
            <Box>
              {/* Header */}
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "105px 1fr 82px 1fr 58px",
                  columnGap: 1,
                  px: 1,
                  pb: 0.75,
                  borderBottom: "1.5px solid",
                  borderColor: "divider",
                }}
              >
                {[
                  { label: "Giorno", align: "left" },
                  { label: "Mattino", align: "left" },
                  { label: "Pausa", align: "center" },
                  { label: "Pomeriggio", align: "left" },
                  { label: "Ore", align: "right" },
                ].map(({ label, align }) => (
                  <Typography
                    key={label}
                    variant="caption"
                    color="text.secondary"
                    fontWeight={700}
                    sx={{ textAlign: align, letterSpacing: "0.06em", textTransform: "uppercase", fontSize: "10px" }}
                  >
                    {label}
                  </Typography>
                ))}
              </Box>

              {/* Day rows */}
              {scheduleDraft.map((day, idx) => {
                const total = day.enabled ? getDraftDayWorkedMinutes(day) : null;
                const pauseLabel = day.morning_end && day.afternoon_start
                  ? `${day.morning_end}–${day.afternoon_start}`
                  : "—";
                return (
                  <Box
                    key={idx}
                    sx={{
                      display: "grid",
                      gridTemplateColumns: "105px 1fr 82px 1fr 58px",
                      columnGap: 1,
                      alignItems: "center",
                      px: 1,
                      py: 0.625,
                      borderRadius: 1,
                      opacity: day.enabled ? 1 : 0.5,
                      bgcolor: idx % 2 !== 0 ? "action.hover" : "transparent",
                      transition: "background 0.12s",
                      "&:hover": { bgcolor: "action.selected" },
                    }}
                  >
                    {/* Col 1: giorno + switch */}
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <Typography
                        variant="body2"
                        fontWeight={700}
                        sx={{ minWidth: 28, color: idx >= 5 ? "text.disabled" : "text.primary" }}
                      >
                        {DAY_LABELS[idx]}
                      </Typography>
                      <Switch
                        size="small"
                        checked={day.enabled}
                        onChange={(e) => {
                          if (e.target.checked) {
                            updateDay(idx, {
                              enabled: true,
                              morning_start: "08:00",
                              morning_end: "12:00",
                              afternoon_start: "13:00",
                              afternoon_end: "18:00",
                            });
                          } else {
                            updateDay(idx, {
                              enabled: false,
                              morning_start: null,
                              morning_end: null,
                              afternoon_start: null,
                              afternoon_end: null,
                            });
                          }
                        }}
                      />
                    </Stack>

                    {day.enabled ? (() => {
                      const hasMorning = Boolean(day.morning_start || day.morning_end);
                      const hasAfternoon = Boolean(day.afternoon_start || day.afternoon_end);
                      return (
                      <>
                        {/* Col 2: mattino */}
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <Checkbox
                            size="small"
                            checked={hasMorning}
                            onChange={(e) => toggleBlock(idx, "morning", e.target.checked)}
                            title="Lavora al mattino"
                            sx={{ p: 0.25, flexShrink: 0 }}
                          />
                          {hasMorning ? (
                            <>
                              <TextField
                                type="time"
                                size="small"
                                value={day.morning_start ?? ""}
                                onChange={(e) => updateDay(idx, { morning_start: e.target.value || null })}
                                inputProps={{ step: 300 }}
                                sx={{ width: 110 }}
                              />
                              <Typography variant="body2" color="text.disabled" sx={{ flexShrink: 0 }}>→</Typography>
                              <TextField
                                type="time"
                                size="small"
                                value={day.morning_end ?? ""}
                                onChange={(e) => updateDay(idx, { morning_end: e.target.value || null })}
                                inputProps={{ step: 300 }}
                                sx={{ width: 110 }}
                              />
                            </>
                          ) : (
                            <Typography variant="caption" color="text.disabled" fontStyle="italic">non lavorativo</Typography>
                          )}
                        </Stack>

                        {/* Col 3: pausa */}
                        <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center" }}>
                          {pauseLabel}
                        </Typography>

                        {/* Col 4: pomeriggio */}
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <Checkbox
                            size="small"
                            checked={hasAfternoon}
                            onChange={(e) => toggleBlock(idx, "afternoon", e.target.checked)}
                            title="Lavora al pomeriggio"
                            sx={{ p: 0.25, flexShrink: 0 }}
                          />
                          {hasAfternoon ? (
                            <>
                              <TextField
                                type="time"
                                size="small"
                                value={day.afternoon_start ?? ""}
                                onChange={(e) => updateDay(idx, { afternoon_start: e.target.value || null })}
                                inputProps={{ step: 300 }}
                                sx={{ width: 110 }}
                              />
                              <Typography variant="body2" color="text.disabled" sx={{ flexShrink: 0 }}>→</Typography>
                              <TextField
                                type="time"
                                size="small"
                                value={day.afternoon_end ?? ""}
                                onChange={(e) => updateDay(idx, { afternoon_end: e.target.value || null })}
                                inputProps={{ step: 300 }}
                                sx={{ width: 110 }}
                              />
                            </>
                          ) : (
                            <Typography variant="caption" color="text.disabled" fontStyle="italic">non lavorativo</Typography>
                          )}
                        </Stack>

                        {/* Col 5: ore */}
                        <Typography
                          variant="body2"
                          fontWeight={700}
                          sx={{
                            textAlign: "right",
                            color: total !== null && total > 0 ? "primary.main" : "error.main",
                          }}
                        >
                          {fmtMinutes(total)}
                        </Typography>
                      </>
                      );
                    })() : (
                      <Typography
                        variant="caption"
                        color="text.disabled"
                        sx={{ gridColumn: "2 / -1", fontStyle: "italic" }}
                      >
                        non lavorativo
                      </Typography>
                    )}
                  </Box>
                );
              })}
            </Box>

            {/* Totale settimanale */}
            {(() => {
              const total = scheduleDraft.reduce((sum, day) => {
                if (!day.enabled) return sum;
                return sum + Math.max(getDraftDayWorkedMinutes(day) ?? 0, 0);
              }, 0);
              return (
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    px: 1.5,
                    py: 1,
                    borderRadius: 2,
                    bgcolor: "rgba(0,112,64,0.06)",
                    borderLeft: "3px solid",
                    borderColor: "primary.main",
                  }}
                >
                  <Typography variant="body2" color="text.secondary">Totale settimanale</Typography>
                  <Typography variant="subtitle1" fontWeight={700} color="primary.main">
                    {fmtMinutes(total)}
                  </Typography>
                </Box>
              );
            })()}

            {/* Helper: copia lunedì */}
            <Button
              variant="outlined"
              size="small"
              onClick={copyMonToWeekdays}
              fullWidth
              sx={{ borderStyle: "dashed" }}
            >
              Copia orario Lunedì → Mar, Mer, Gio, Ven
            </Button>

            {saveError && <Alert severity="error" onClose={() => setSaveError(null)}>{saveError}</Alert>}
            {saveButton("Salva orario e area", handleSaveSchedule)}
          </Stack>
        </TabPanel>

      </DialogContent>

      <Snackbar
        open={!!snackbar}
        autoHideDuration={3000}
        onClose={() => setSnackbar(null)}
        message={snackbar}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Dialog>
  );
}

export default function EmployeesPage({ onImpersonate }) {
  const { effectiveUser } = useAuth();
  const [searchParams] = useSearchParams();
  const companyFilter = searchParams.get("company") ?? "";
  const [search, setSearch] = useState(companyFilter);
  const [selectedRole, setSelectedRole] = useState(null);
  const [selectedPortalRole, setSelectedPortalRole] = useState(null);
  const [selectedStatus, setSelectedStatus] = useState("active");
  const [selectedBadgeFilter, setSelectedBadgeFilter] = useState(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [syncSnackbar, setSyncSnackbar] = useState(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    setSearch(companyFilter);
  }, [companyFilter]);

  const employeesQuery = useQuery({
    queryKey: ["employees", selectedRole],
    queryFn: () => getEmployees("", selectedRole ? [selectedRole] : [], false),
  });

  const employeeOptionsQuery = useQuery({
    queryKey: ["employee-options"],
    queryFn: getEmployeeOptions,
  });

  const employeeCourseBadgesQuery = useQuery({
    queryKey: ["employee-course-badges"],
    queryFn: getEmployeeCourseBadges,
    staleTime: 60_000,
  });

  const areasQuery = useQuery({
    queryKey: ["operational-areas", "active"],
    queryFn: () => getOperationalAreas({ activeOnly: true }),
  });

  const orgFunctionsQuery = useQuery({
    queryKey: ["org-functions"],
    queryFn: () => getOrgFunctions(),
  });

  const orgDepartmentsQuery = useQuery({
    queryKey: ["org-departments"],
    queryFn: () => getOrgDepartments(),
  });

  const syncMutation = useMutation({
    mutationFn: syncEmployees,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["employee-options"] });
    },
  });

  const phoneMutation = useMutation({
    mutationFn: ({ employeeId, phone }) => updateEmployeePhone(employeeId, { phone }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employees"] }),
  });

  const defaultAreaMutation = useMutation({
    mutationFn: ({ employeeId, defaultOperationalAreaId, defaultImmobile }) =>
      updateEmployeeDefaultArea(employeeId, {
        default_operational_area_id: defaultOperationalAreaId || null,
        default_immobile: defaultImmobile || null,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employees"] }),
  });

  const employeeOrganizationMutation = useMutation({
    mutationFn: ({ employeeId, payload }) => updateEmployeeOrganization(employeeId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["employee-options"] });
    },
  });

  const managerMutation = useMutation({
    mutationFn: ({ employeeId, payload }) => updateEmployeeManager(employeeId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["employee-options"] });
    },
  });

  const absencePermissionsMutation = useMutation({
    mutationFn: ({ employeeId, payload }) => updateEmployeeAbsencePermissions(employeeId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["employee-options"] });
    },
  });

  const configurationPermissionsMutation = useMutation({
    mutationFn: ({ employeeId, payload }) => updateEmployeeConfigurationPermissions(employeeId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employees"] }),
  });

  const appRoleMutation = useMutation({
    mutationFn: ({ employeeId, payload }) => updateEmployeeAppRole(employeeId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employees"] }),
  });

  const scheduleMutation = useMutation({
    mutationFn: ({ employeeId, payload }) => updateEmployeeSchedule(employeeId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employees"] }),
  });

  const localUserMutation = useMutation({
    mutationFn: ({ employeeId, payload }) => updateEmployeeLocalUser(employeeId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employees"] }),
  });

  const badgeByEmployeeId = useMemo(() => {
    const map = new Map();
    for (const badge of employeeCourseBadgesQuery.data ?? []) {
      map.set(badge.employee_id, badge);
    }
    return map;
  }, [employeeCourseBadgesQuery.data]);

  const filteredEmployees = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const employees = employeesQuery.data ?? [];
    return employees.filter((e) => {
      const effectivePortalRole = resolveEffectivePortalRole(e.app_role, e.has_direct_reports);

      const matchesStatus = selectedStatus === "all"
        ? true
        : selectedStatus === "active"
          ? e.is_active !== false
          : e.is_active === false;
      if (!matchesStatus) return false;

      const matchesPortalRole = !selectedPortalRole || effectivePortalRole === selectedPortalRole;
      if (!matchesPortalRole) return false;

      const matchesSearch = !normalizedSearch || (e.full_name ?? "").toLowerCase().includes(normalizedSearch)
        || (e.tms_id ?? "").toLowerCase().includes(normalizedSearch)
        || (e.datore_lavoro ?? "").toLowerCase().includes(normalizedSearch);
      if (!matchesSearch) return false;

      if (!selectedBadgeFilter) return true;
      const badge = badgeByEmployeeId.get(e.id);
      if (!badge) return false;
      return badge[selectedBadgeFilter] && badge[selectedBadgeFilter] !== "missing";
    });
  }, [badgeByEmployeeId, employeesQuery.data, search, selectedBadgeFilter, selectedPortalRole, selectedStatus]);

  const selectedEmployee = useMemo(
    () => filteredEmployees.find((e) => e.id === selectedEmployeeId) ?? null,
    [selectedEmployeeId, filteredEmployees],
  );

  const areas = areasQuery.data ?? [];
  const columns = employeesColumns({ withImpersonate: Boolean(onImpersonate) });

  // "Azzera filtri" resta spento finché tutti i filtri sono sui valori iniziali
  // (lo stato parte da "active", non da nessun filtro).
  const filtersActive = Boolean(search)
    || selectedRole !== null
    || selectedPortalRole !== null
    || selectedStatus !== "active"
    || selectedBadgeFilter !== null;

  return (
    <Stack spacing={3}>
      {/* ── Header ── */}
      <PageHeader
        section="Impresa"
        title="Dipendenti"
        actions={
          <HeaderButton onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
            {syncMutation.isPending ? "Sincronizzazione…" : "Sincronizza da TMS"}
          </HeaderButton>
        }
      />

      {/* ── Filtri: pannello separato dalla tabella ── */}
      <FilterBar
        onReset={() => {
          setSearch("");
          setSelectedRole(null);
          setSelectedPortalRole(null);
          setSelectedStatus("active");
          setSelectedBadgeFilter(null);
        }}
        resetDisabled={!filtersActive}
      >
        <TextField
          size="small"
          label="Cerca per nome, matricola o datore di lavoro"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <Stack direction="row" spacing={1} alignItems="center" flexShrink={0}>
          <Typography
            variant="body2"
            sx={{ minWidth: 95, flexShrink: 0, color: filterCategoryStyles.role.labelColor, fontWeight: 700 }}
          >
            Filtra per ruolo
          </Typography>
          <ToggleButtonGroup
            value={selectedRole}
            onChange={(_e, value) => setSelectedRole(value)}
            exclusive
            size="small"
          >
            {roleOptions.map((role) => (
              <Tooltip key={role.value} title={role.label}>
                <ToggleButton
                  value={role.value}
                  sx={{
                    gap: 0.75,
                    px: 1.5,
                    color: "#4b5563",
                    borderColor: filterCategoryStyles.role.borderColor,
                    "&:hover": {
                      bgcolor: filterCategoryStyles.role.hoverBg,
                      borderColor: filterCategoryStyles.role.activeBg,
                    },
                    "&.Mui-selected": {
                      bgcolor: filterCategoryStyles.role.activeBg,
                      color: "#ffffff",
                      borderColor: filterCategoryStyles.role.activeBg,
                    },
                    "&.Mui-selected:hover": {
                      bgcolor: filterCategoryStyles.role.activeHover,
                      borderColor: filterCategoryStyles.role.activeHover,
                    },
                  }}
                >
                  <Box component="span" sx={{ fontSize: 18, lineHeight: 1 }}>{role.icon}</Box>
                  <Box component="span" sx={{ display: { xs: "none", lg: "inline" } }}>
                    {role.label}
                  </Box>
                </ToggleButton>
              </Tooltip>
            ))}
          </ToggleButtonGroup>
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center" flexShrink={0}>
          <Typography
            variant="body2"
            sx={{ minWidth: 110, flexShrink: 0, color: filterCategoryStyles.role.labelColor, fontWeight: 700 }}
          >
            Ruolo portale
          </Typography>
          <ToggleButtonGroup
            value={selectedPortalRole}
            onChange={(_e, value) => setSelectedPortalRole(value)}
            exclusive
            size="small"
          >
            {portalRoleFilterOptions.map((role) => (
              <Tooltip key={role.value} title={role.label}>
                <ToggleButton
                  value={role.value}
                  sx={{
                    gap: 0.75,
                    px: 1.5,
                    color: "#4b5563",
                    borderColor: filterCategoryStyles.role.borderColor,
                    "&:hover": {
                      bgcolor: filterCategoryStyles.role.hoverBg,
                      borderColor: filterCategoryStyles.role.activeBg,
                    },
                    "&.Mui-selected": {
                      bgcolor: filterCategoryStyles.role.activeBg,
                      color: "#ffffff",
                      borderColor: filterCategoryStyles.role.activeBg,
                    },
                    "&.Mui-selected:hover": {
                      bgcolor: filterCategoryStyles.role.activeHover,
                      borderColor: filterCategoryStyles.role.activeHover,
                    },
                  }}
                >
                  <PortalRoleIcon role={role.value} size={16} />
                  <Box component="span" sx={{ display: { xs: "none", lg: "inline" } }}>
                    {role.label}
                  </Box>
                </ToggleButton>
              </Tooltip>
            ))}
          </ToggleButtonGroup>
        </Stack>

        <Divider orientation="vertical" flexItem sx={{ display: { xs: "none", sm: "block" } }} />

        <Stack direction="row" spacing={1} alignItems="center" flexShrink={0}>
          <Typography
            variant="body2"
            sx={{ minWidth: 70, flexShrink: 0, color: filterCategoryStyles.status.labelColor, fontWeight: 700 }}
          >
            Stato
          </Typography>
          <ToggleButtonGroup
            value={selectedStatus}
            onChange={(_e, value) => value && setSelectedStatus(value)}
            exclusive
            size="small"
          >
            {employeeStatusOptions.map((status) => (
              <ToggleButton
                key={status.value}
                value={status.value}
                sx={{
                  gap: 0.75,
                  px: 1.5,
                  color: "#4b5563",
                  borderColor: filterCategoryStyles.status.borderColor,
                  "&:hover": {
                    bgcolor: filterCategoryStyles.status.hoverBg,
                    borderColor: filterCategoryStyles.status.activeBg,
                  },
                  "&.Mui-selected": {
                    bgcolor: filterCategoryStyles.status.activeBg,
                    color: "#ffffff",
                    borderColor: filterCategoryStyles.status.activeBg,
                  },
                  "&.Mui-selected:hover": {
                    bgcolor: filterCategoryStyles.status.activeHover,
                    borderColor: filterCategoryStyles.status.activeHover,
                  },
                }}
              >
                <Box component="span" sx={{ fontSize: 16, lineHeight: 1 }}>{status.icon}</Box>
                <Box component="span" sx={{ display: { xs: "none", lg: "inline" } }}>
                  {status.label}
                </Box>
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center" flexShrink={0}>
          <Typography
            variant="body2"
            sx={{ minWidth: 95, flexShrink: 0, color: filterCategoryStyles.badge.labelColor, fontWeight: 700 }}
          >
            Filtra per badge
          </Typography>
          <ToggleButtonGroup
            value={selectedBadgeFilter}
            onChange={(_e, value) => setSelectedBadgeFilter(value)}
            exclusive
            size="small"
          >
            {badgeFilterOptions.map((badge) => (
              <Tooltip key={badge.value} title={badge.label}>
                <ToggleButton
                  value={badge.value}
                  sx={{
                    gap: 0.75,
                    px: 1.5,
                    color: "#4b5563",
                    borderColor: filterCategoryStyles.badge.borderColor,
                    "&:hover": {
                      bgcolor: filterCategoryStyles.badge.hoverBg,
                      borderColor: filterCategoryStyles.badge.activeBg,
                    },
                    "&.Mui-selected": {
                      bgcolor: filterCategoryStyles.badge.activeBg,
                      color: "#ffffff",
                      borderColor: filterCategoryStyles.badge.activeBg,
                    },
                    "&.Mui-selected:hover": {
                      bgcolor: filterCategoryStyles.badge.activeHover,
                      borderColor: filterCategoryStyles.badge.activeHover,
                    },
                  }}
                >
                  <Box component="span" sx={{ fontSize: 18, lineHeight: 1 }}>{badge.icon}</Box>
                  <Box component="span" sx={{ display: { xs: "none", lg: "inline" } }}>
                    {badge.label}
                  </Box>
                </ToggleButton>
              </Tooltip>
            ))}
          </ToggleButtonGroup>
        </Stack>
      </FilterBar>

      {/* Sync feedback */}
      {syncMutation.error && (
        <Alert severity="error">{syncMutation.error.message}</Alert>
      )}
      {syncMutation.data && (
        <Alert severity="success">
          Sync completato: letti {syncMutation.data.fetched}, creati {syncMutation.data.created},
          aggiornati {syncMutation.data.updated}, disattivati {syncMutation.data.deactivated}.
        </Alert>
      )}
      {employeesQuery.error && (
        <Alert severity="error">{employeesQuery.error.message}</Alert>
      )}
      {employeeCourseBadgesQuery.error && (
        <Alert severity="error">{employeeCourseBadgesQuery.error.message}</Alert>
      )}

      {/* ── Tabella dei dipendenti filtrati ── */}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small" sx={tableSx({ minWidth: 760, dense: true })}>
            <TableHead>
              <TableRow sx={headRowSx}>
                {columns.map((column) => (
                  <TableCell key={column.key} align={column.align} sx={{ width: `${column.width}%` }}>
                    {column.label}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredEmployees.map((employee) => {
                const meta = roleMeta(employee.tms_role_description);
                const effectivePortalRole = resolveEffectivePortalRole(employee.app_role, employee.has_direct_reports);
                const portalRoleLabel = portalRoleMeta(effectivePortalRole).label;
                const area = areas.find((a) => a.id === employee.default_operational_area_id);
                return (
                  <TableRow
                    key={employee.id}
                    hover
                    onClick={() => setSelectedEmployeeId(employee.id)}
                    sx={{ cursor: "pointer" }}
                  >
                    {/* Dipendente: avatar + nome + matricola */}
                    <TableCell>
                      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
                        <EmployeeAvatar employee={employee} size={36} />
                        {/* minWidth: 0 sul figlio flex, altrimenti l'ellissi non scatta
                            e il nome lungo esce dalla cella (regola 6) */}
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" fontWeight={700} noWrap title={employee.full_name}>
                            {employee.full_name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Matr.&nbsp;{employee.tms_id}
                          </Typography>
                        </Box>
                      </Stack>
                    </TableCell>

                    {/* Ruolo: sola icona, la descrizione è nel tooltip per lasciare
                        larghezza alla colonna del nome */}
                    <TableCell align="center">
                      <Tooltip title={employee.tms_role_description || "Altro"}>
                        <Typography component="span" sx={{ fontSize: 18, lineHeight: 1 }}>
                          {meta.icon}
                        </Typography>
                      </Tooltip>
                    </TableCell>

                    {/* Ruolo portale: resta il colore che lo identifica, l'etichetta
                        passa nel tooltip */}
                    <TableCell align="center">
                      <Tooltip title={`Ruolo portale: ${portalRoleLabel}`}>
                        <Box
                          sx={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 26,
                            height: 26,
                            borderRadius: "50%",
                            bgcolor: portalRoleVisualStyles[effectivePortalRole]?.bg ?? "rgba(21,101,192,0.10)",
                            color: portalRoleVisualStyles[effectivePortalRole]?.color ?? "#1565c0",
                          }}
                        >
                          <PortalRoleIcon role={effectivePortalRole} size={14} />
                        </Box>
                      </Tooltip>
                    </TableCell>

                    {/* Area */}
                    <TableCell>
                      {area ? (
                        <Box
                          sx={{
                            display: "inline-block",
                            px: 0.75,
                            py: 0.2,
                            borderRadius: 1,
                            bgcolor: "rgba(0,112,64,0.1)",
                            color: "primary.main",
                            fontFamily: "monospace",
                            fontWeight: 700,
                            fontSize: "0.72rem",
                            letterSpacing: "0.04em",
                          }}
                        >
                          {area.area_code}
                        </Box>
                      ) : (
                        <Typography variant="caption" color="text.disabled">—</Typography>
                      )}
                    </TableCell>

                    <TableCell sx={ellipsisCellSx} title={employee.datore_lavoro || ""}>
                      {employee.datore_lavoro || "—"}
                    </TableCell>
                    <TableCell sx={ellipsisCellSx} title={employee.manager_employee_name || ""}>
                      {employee.manager_employee_name || "—"}
                    </TableCell>

                    {/* Stato */}
                    <TableCell>
                      <Chip
                        size="small"
                        label={employee.is_active ? "Attivo" : "Inattivo"}
                        sx={{
                          bgcolor: employee.is_active ? "rgba(34,197,94,0.1)" : "rgba(150,150,150,0.1)",
                          color: employee.is_active ? "#16a34a" : "text.disabled",
                          fontWeight: 600,
                        }}
                      />
                    </TableCell>

                    {onImpersonate && (
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Tooltip title={`Visualizza come ${employee.full_name} · Scadenze: ${
                          employee.config_expirations_scope === "reports"
                            ? "solo riporti"
                            : employee.config_expirations_scope === "none"
                              ? "nessuna"
                              : "tutte"
                        }`}>
                          <IconButton
                            size="small"
                            onClick={() => onImpersonate(employee.id)}
                            sx={{ color: "text.secondary", "&:hover": { color: "warning.main" } }}
                          >
                            <svg
                              width={18}
                              height={18}
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={1.9}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
              {!employeesQuery.isLoading && filteredEmployees.length === 0 && (
                <TableRow>
                  <TableCell colSpan={columns.length} sx={{ textAlign: "center", py: 4, color: "text.disabled" }}>
                    Nessun dipendente trovato.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      </Paper>

      {/* ── Detail dialog ── */}
      <EmployeeProfileDialog
        employee={selectedEmployee}
        isAdmin={effectiveUser?.effective_role === "admin"}
        employeeOptions={employeeOptionsQuery.data ?? []}
        areas={areasQuery.data ?? []}
        orgFunctions={orgFunctionsQuery.data ?? []}
        orgDepartments={orgDepartmentsQuery.data ?? []}
        open={Boolean(selectedEmployee)}
        onClose={() => setSelectedEmployeeId(null)}
        onSavePhone={(employeeId, phone) =>
          phoneMutation.mutateAsync({ employeeId, phone })
        }
        onSaveArea={(employeeId, areaId, immobile) =>
          defaultAreaMutation.mutateAsync({
            employeeId,
            defaultOperationalAreaId: areaId,
            defaultImmobile: immobile,
          })
        }
        onSaveAbsencePermissions={(employeeId, payload) =>
          absencePermissionsMutation.mutateAsync({ employeeId, payload })
        }
        onSaveConfigurationPermissions={(employeeId, payload) =>
          configurationPermissionsMutation.mutateAsync({ employeeId, payload })
        }
        onSaveAppRole={(employeeId, payload) =>
          appRoleMutation.mutateAsync({ employeeId, payload })
        }
        onSaveLocalUser={(employeeId, payload) =>
          localUserMutation.mutateAsync({ employeeId, payload })
        }
        onSaveSchedule={(employeeId, payload) =>
          scheduleMutation.mutateAsync({ employeeId, payload })
        }
        onSaveOrganization={async (employeeId, payload) => {
          await employeeOrganizationMutation.mutateAsync({
            employeeId,
            payload: {
              organization_role: payload.organization_role,
              organization_department: payload.organization_department,
              is_direttivo: payload.is_direttivo,
            },
          });
          await managerMutation.mutateAsync({
            employeeId,
            payload: { manager_employee_id: payload.manager_employee_id },
          });
        }}
      />

      <Snackbar
        open={!!syncSnackbar}
        autoHideDuration={3000}
        onClose={() => setSyncSnackbar(null)}
        message={syncSnackbar}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Stack>
  );
}
