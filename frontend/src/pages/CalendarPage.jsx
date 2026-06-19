import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid2,
  MenuItem,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { DayPicker } from "react-day-picker";
import { it as dayPickerLocale } from "react-day-picker/locale";
import "react-day-picker/style.css";

import {
  createJustification,
  deleteJustification,
  getAssignments,
  getEmployeeOptions,
  getJustifications,
  updateJustificationApproval,
  updateJustification,
} from "../api";
import { useAuth } from "../auth";
import "./CalendarPage.css";

const justificationTypes = ["FERIE", "PERMESSO", "ALTRO"];
const weekdayLabels = ["LUN", "MAR", "MER", "GIO", "VEN", "SAB", "DOM"];
const defaultDayStartTime = "08:00";
const defaultDayEndTime = "17:00";
const absenceModes = {
  halfDay: "half_day",
  days: "days",
};
const shortMonthLabels = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const allFilterValue = "all";

function createEmptyForm(date, defaultEmployeeId = "") {
  return {
    employee_id: defaultEmployeeId,
    justification_type: "FERIE",
    description: "",
    start_date: date,
    end_date: date,
    start_time: defaultDayStartTime,
    end_time: defaultDayEndTime,
  };
}

function normalizeTimeValue(value) {
  if (!value) {
    return "";
  }
  return String(value).slice(0, 5);
}

function inferAbsenceMode(item) {
  const startTime = normalizeTimeValue(item.start_time);
  const endTime = normalizeTimeValue(item.end_time);

  if (item.start_date !== item.end_date) {
    return absenceModes.days;
  }
  if (startTime === defaultDayStartTime && endTime === defaultDayEndTime) {
    return absenceModes.days;
  }
  return absenceModes.halfDay;
}

function formatShortDateLabel(value) {
  const parsed = dayjs(value);
  if (!parsed.isValid()) {
    return value;
  }
  return `${parsed.date()} ${shortMonthLabels[parsed.month()]} ${parsed.year()}`;
}

function formatDateRangeLabel(startDate, endDate) {
  if (startDate === endDate) {
    return formatShortDateLabel(startDate);
  }
  return `${formatShortDateLabel(startDate)} - ${formatShortDateLabel(endDate)}`;
}

function toPickerDate(value) {
  const parsed = dayjs(value);
  if (!parsed.isValid()) {
    return undefined;
  }
  return parsed.toDate();
}

function toIsoDate(value) {
  return dayjs(value).format("YYYY-MM-DD");
}

function getWeekStart(date) {
  const weekday = date.day();
  const diff = weekday === 0 ? -6 : 1 - weekday;
  return date.add(diff, "day").startOf("day");
}

function getRange(view, currentDate) {
  if (view === "day") {
    return {
      start: currentDate.startOf("day"),
      end: currentDate.endOf("day"),
    };
  }
  if (view === "week") {
    const start = getWeekStart(currentDate);
    return {
      start,
      end: start.add(6, "day").endOf("day"),
    };
  }
  return {
    start: currentDate.startOf("month"),
    end: currentDate.endOf("month"),
  };
}

function getDaysForMonth(currentDate) {
  const monthStart = currentDate.startOf("month");
  const monthEnd = currentDate.endOf("month");
  const gridStart = getWeekStart(monthStart);
  const weekday = monthEnd.day();
  const diff = weekday === 0 ? 0 : 7 - weekday;
  const gridEnd = monthEnd.add(diff, "day");
  const days = [];
  let cursor = gridStart;
  while (cursor.isBefore(gridEnd) || cursor.isSame(gridEnd, "day")) {
    days.push(cursor);
    cursor = cursor.add(1, "day");
  }
  return days;
}

function splitWeeks(days) {
  const weeks = [];
  for (let index = 0; index < days.length; index += 7) {
    weeks.push(days.slice(index, index + 7));
  }
  return weeks;
}

function overlapsDay(item, date) {
  return (
    dayjs(item.start_date).isSame(date, "day") ||
    dayjs(item.end_date).isSame(date, "day") ||
    (dayjs(item.start_date).isBefore(date, "day") && dayjs(item.end_date).isAfter(date, "day"))
  );
}

function overlapsRange(item, start, end) {
  return (
    dayjs(item.start_date).isSame(start, "day") ||
    dayjs(item.end_date).isSame(end, "day") ||
    (dayjs(item.start_date).isBefore(end, "day") && dayjs(item.end_date).isAfter(start, "day")) ||
    (dayjs(item.start_date).isAfter(start, "day") && dayjs(item.start_date).isBefore(end, "day")) ||
    (dayjs(item.end_date).isAfter(start, "day") && dayjs(item.end_date).isBefore(end, "day"))
  );
}

function buildWeekSegments(week, items) {
  const weekStart = week[0].startOf("day");
  const weekEnd = week[6].endOf("day");
  const relevant = items
    .filter((item) => overlapsRange(item, weekStart, weekEnd))
    .map((item) => {
      const itemStart = dayjs(item.start_date).startOf("day");
      const itemEnd = dayjs(item.end_date).startOf("day");
      const visibleStart = itemStart.isBefore(weekStart, "day") ? weekStart : itemStart;
      const visibleEnd = itemEnd.isAfter(weekEnd, "day") ? weekEnd.startOf("day") : itemEnd;
      return {
        ...item,
        visibleStart,
        visibleEnd,
        colStart: visibleStart.diff(weekStart, "day") + 1,
        colSpan: visibleEnd.diff(visibleStart, "day") + 1,
        startsBeforeWeek: itemStart.isBefore(weekStart, "day"),
        endsAfterWeek: itemEnd.isAfter(weekEnd, "day"),
      };
    })
    .sort((left, right) => {
      const byStart = left.visibleStart.diff(right.visibleStart, "day");
      if (byStart !== 0) {
        return byStart;
      }
      return right.colSpan - left.colSpan;
    });

  const laneEnds = [];
  const segments = relevant.map((segment) => {
    let lane = laneEnds.findIndex((laneEnd) => laneEnd.isBefore(segment.visibleStart, "day"));
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(segment.visibleEnd);
    } else {
      laneEnds[lane] = segment.visibleEnd;
    }
    return {
      ...segment,
      lane,
    };
  });

  return {
    lanes: Math.max(laneEnds.length, 1),
    segments,
  };
}

function eventToneClass(type) {
  if (type === "FERIE") {
    return "ferie";
  }
  if (type === "PERMESSO") {
    return "permesso";
  }
  return "altro";
}

function approvalToneClass(item) {
  if (item.approval_status === "rejected") {
    return " rejected";
  }
  if (item.requires_my_approval && item.approval_status === "pending") {
    return " approval-pending";
  }
  if (item.approval_status === "pending") {
    return " pending";
  }
  return "";
}

function approvalStatusLabel(status) {
  if (status === "approved") return "Approvato";
  if (status === "pending") return "In attesa";
  if (status === "rejected") return "Rifiutato";
  return status;
}

function eventBadgeIcon(type) {
  if (type === "FERIE") {
    return "🌴";
  }
  if (type === "PERMESSO") {
    return "🏆";
  }
  return "✳";
}

const dayNames = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];

function formatNavLabel(view, currentDate) {
  if (view === "day") {
    const dow = dayNames[currentDate.day()];
    return `${dow} ${currentDate.date()} ${shortMonthLabels[currentDate.month()]} ${currentDate.year()}`;
  }
  if (view === "week") {
    const start = getWeekStart(currentDate);
    const end = start.add(6, "day");
    if (start.month() === end.month()) {
      return `${start.date()} – ${end.date()} ${shortMonthLabels[start.month()]} ${start.year()}`;
    }
    const endYear = start.year() !== end.year() ? ` ${end.year()}` : "";
    return `${start.date()} ${shortMonthLabels[start.month()]} – ${end.date()} ${shortMonthLabels[end.month()]}${endYear} ${start.year()}`;
  }
  const formatted = currentDate.format("MMM YYYY");
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

export default function CalendarPage() {
  const queryClient = useQueryClient();
  const { effectiveUser: user } = useAuth();
  const today = dayjs();
  const [view, setView] = useState("month");
  const [currentDate, setCurrentDate] = useState(today);
  const [selectedDate, setSelectedDate] = useState(today.format("YYYY-MM-DD"));
  const [modalOpen, setModalOpen] = useState(false);
  const [editingJustification, setEditingJustification] = useState(null);
  const [form, setForm] = useState(createEmptyForm(today.format("YYYY-MM-DD")));
  const [absenceMode, setAbsenceMode] = useState(absenceModes.days);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({
    employeeId: allFilterValue,
    justificationType: allFilterValue,
  });

  const range = useMemo(() => getRange(view, currentDate), [view, currentDate]);
  const monthWeeks = useMemo(() => splitWeeks(getDaysForMonth(currentDate)), [currentDate]);

  const employeesQuery = useQuery({
    queryKey: ["employee-options", "calendar", "absence"],
    queryFn: () => getEmployeeOptions({ authorizedForAbsence: true }),
  });

  const justificationsQuery = useQuery({
    queryKey: ["justifications", view, range.start.format("YYYY-MM-DD"), range.end.format("YYYY-MM-DD")],
    queryFn: () => getJustifications(range.start.format("YYYY-MM-DD"), range.end.format("YYYY-MM-DD")),
  });

  const assignmentsQuery = useQuery({
    queryKey: ["assignments", range.start.format("YYYY-MM-DD"), range.end.format("YYYY-MM-DD")],
    queryFn: () => getAssignments(range.start.format("YYYY-MM-DD"), range.end.format("YYYY-MM-DD")),
  });

  const createMutation = useMutation({
    mutationFn: createJustification,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["justifications"] });
      closeModal();
      setForm(createEmptyForm(selectedDate));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ justificationId, payload }) => updateJustification(justificationId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["justifications"] });
      closeModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteJustification,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["justifications"] });
      closeModal();
    },
  });

  const approveMutation = useMutation({
    mutationFn: ({ justificationId, approvalStatus }) =>
      updateJustificationApproval(justificationId, { approval_status: approvalStatus }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["justifications"] });
      closeModal();
    },
  });

  function closeModal() {
    createMutation.reset();
    updateMutation.reset();
    deleteMutation.reset();
    approveMutation.reset();
    setModalOpen(false);
    setEditingJustification(null);
  }

  function openCreateModal(date) {
    const isoDate = date.format("YYYY-MM-DD");
    createMutation.reset();
    updateMutation.reset();
    deleteMutation.reset();
    approveMutation.reset();
    setSelectedDate(isoDate);
    setEditingJustification(null);
    setAbsenceMode(absenceModes.days);
    const options = employeesQuery.data ?? [];
    const defaultEmployeeId = options.length === 1 ? options[0].id : "";
    setForm(createEmptyForm(isoDate, defaultEmployeeId));
    setModalOpen(true);
  }

  function openEditModal(item) {
    createMutation.reset();
    updateMutation.reset();
    deleteMutation.reset();
    approveMutation.reset();
    setSelectedDate(item.start_date);
    setEditingJustification(item);
    setAbsenceMode(inferAbsenceMode(item));
    setForm({
      employee_id: item.employee_id,
      justification_type: item.justification_type,
      description: item.description || "",
      start_date: item.start_date,
      end_date: item.end_date,
      start_time: normalizeTimeValue(item.start_time),
      end_time: normalizeTimeValue(item.end_time),
    });
    setModalOpen(true);
  }

  function updateFormValue(field, value) {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "start_date" && absenceMode === absenceModes.halfDay) {
        next.end_date = value;
      }
      return next;
    });
  }

  function handleAbsenceModeChange(mode) {
    if (mode === absenceMode) {
      return;
    }

    setAbsenceMode(mode);
    setForm((current) => {
      if (mode === absenceModes.halfDay) {
        return {
          ...current,
          end_date: current.start_date,
        };
      }
      return {
        ...current,
        start_time: defaultDayStartTime,
        end_time: defaultDayEndTime,
      };
    });
  }

  function handleDateRangeSelect(range) {
    if (!range?.from) {
      return;
    }

    setForm((current) => ({
      ...current,
      start_date: toIsoDate(range.from),
      end_date: toIsoDate(range.to ?? range.from),
    }));
  }

  function handleSave() {
    const payload =
      absenceMode === absenceModes.days
        ? {
            ...form,
            start_time: defaultDayStartTime,
            end_time: defaultDayEndTime,
          }
        : {
            ...form,
            end_date: form.start_date,
          };

    if (editingJustification) {
      updateMutation.mutate({
        justificationId: editingJustification.id,
        payload,
      });
      return;
    }
    createMutation.mutate(payload);
  }

  function move(step) {
    const unit = view === "month" ? "month" : "day";
    const amount = view === "week" ? step * 7 : step;
    setCurrentDate((current) => current.add(amount, unit));
  }

  function updateFilterValue(field, value) {
    setFilters((current) => ({ ...current, [field]: value }));
  }

  function resetFilters() {
    setFilters({
      employeeId: allFilterValue,
      justificationType: allFilterValue,
    });
  }

  const justifications = justificationsQuery.data ?? [];

  // IDs of justifications where the employee also has planner assignments in the same period
  const justificationsWithOverlap = useMemo(() => {
    const assignments = assignmentsQuery.data ?? [];
    const overlap = new Set();
    for (const j of justifications) {
      if (assignments.some((a) => a.employee_id === j.employee_id && a.work_date >= j.start_date && a.work_date <= j.end_date)) {
        overlap.add(j.id);
      }
    }
    return overlap;
  }, [justifications, assignmentsQuery.data]);

  // Whether the currently open modal form overlaps with any planner assignment
  const formHasOverlap = useMemo(() => {
    if (!modalOpen || !form.employee_id) return false;
    return (assignmentsQuery.data ?? []).some(
      (a) => a.employee_id === form.employee_id && a.work_date >= form.start_date && a.work_date <= form.end_date
    );
  }, [modalOpen, form.employee_id, form.start_date, form.end_date, assignmentsQuery.data]);

  const filteredJustifications = justifications.filter((item) => {
    const matchesEmployee = filters.employeeId === allFilterValue || item.employee_id === filters.employeeId;
    const matchesType = filters.justificationType === allFilterValue || item.justification_type === filters.justificationType;
    return matchesEmployee && matchesType;
  });
  const hasActiveFilters = filters.employeeId !== allFilterValue || filters.justificationType !== allFilterValue;
  const weekDays = Array.from({ length: 7 }, (_, index) => getWeekStart(currentDate).add(index, "day"));
  const currentDayItems = filteredJustifications.filter((item) => overlapsDay(item, currentDate));
  const saveInProgress = createMutation.isPending || updateMutation.isPending;
  const modalError = createMutation.error ?? updateMutation.error ?? deleteMutation.error;
  const singleEmployee = (employeesQuery.data ?? []).length === 1;
  const isLocked = Boolean(
    editingJustification &&
    !editingJustification.requires_my_approval &&
    (editingJustification.approval_status === "approved" || editingJustification.approval_status === "rejected")
  );
  const selectedDateRange = {
    from: toPickerDate(form.start_date),
    to: toPickerDate(form.end_date),
  };

  return (
    <Stack spacing={3} className="calendar-page">
      <Paper className="calendar-topbar">
        <Box className="calendar-title-row">
          <Box className="calendar-title-badge">🏖️</Box>
          <Box>
            <Typography variant="h4" className="calendar-title-text">
              Assenze
            </Typography>
          </Box>
        </Box>
        <Stack direction="row" spacing={1} className="calendar-section-tabs">
          <Button className="calendar-section-tab active">Calendario Assenze</Button>
        </Stack>
      </Paper>

      {employeesQuery.error && <Alert severity="error">{employeesQuery.error.message}</Alert>}
      {justificationsQuery.error && <Alert severity="error">{justificationsQuery.error.message}</Alert>}
      {approveMutation.error && <Alert severity="error">{approveMutation.error.message}</Alert>}

      <Paper className="calendar-shell calendar-board-shell">
        <Box className="calendar-controls-row">
          <Stack direction="row" spacing={1} flexWrap="wrap" className="calendar-controls-left">
            <Button className="calendar-filter-button" onClick={() => setFiltersOpen((current) => !current)}>
              Filtri
              <span className={`calendar-filter-arrow${filtersOpen ? " open" : ""}`}>▾</span>
            </Button>
            <ToggleButtonGroup
              value={view}
              exclusive
              onChange={(_, value) => value && setView(value)}
              size="small"
              className="calendar-view-switcher"
            >
              <ToggleButton value="day">Giorno</ToggleButton>
              <ToggleButton value="week">Settimana</ToggleButton>
              <ToggleButton value="month">Mese</ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          <Box className="calendar-controls-center">
            <Button className="calendar-nav-button" onClick={() => move(-1)}>
              ‹
            </Button>
            <Button className="calendar-month-button">{formatNavLabel(view, currentDate)}</Button>
            <Button className="calendar-nav-button" onClick={() => move(1)}>
              ›
            </Button>
          </Box>

          <Stack direction="row" spacing={1} className="calendar-controls-right">
            <Button variant="contained" className="calendar-primary-action" onClick={() => openCreateModal(currentDate)}>
              ⚙ Aggiungi assenza
            </Button>
          </Stack>
        </Box>

        {filtersOpen && (
          <Box className="calendar-filter-panel">
            <TextField
              className="calendar-filter-field"
              select
              label="Dipendente"
              value={filters.employeeId}
              onChange={(event) => updateFilterValue("employeeId", event.target.value)}
              fullWidth
            >
              <MenuItem value={allFilterValue}>Tutti i dipendenti</MenuItem>
              {(employeesQuery.data ?? []).map((employee) => (
                <MenuItem key={employee.id} value={employee.id}>
                  {employee.full_name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              className="calendar-filter-field"
              select
              label="Tipo"
              value={filters.justificationType}
              onChange={(event) => updateFilterValue("justificationType", event.target.value)}
              fullWidth
            >
              <MenuItem value={allFilterValue}>Tutti i tipi</MenuItem>
              {justificationTypes.map((type) => (
                <MenuItem key={type} value={type}>
                  {type}</MenuItem>
              ))}
            </TextField>
            <Button className="calendar-ghost-button" onClick={resetFilters} disabled={!hasActiveFilters}>
              Azzera filtri
            </Button>
          </Box>
        )}

        {view === "month" && (
          <Box className="calendar-month-board">
            <Box className="calendar-weekday-row">
              {weekdayLabels.map((label) => (
                <Box key={label} className="calendar-weekday-cell">
                  {label}
                </Box>
              ))}
            </Box>

            <Stack spacing={0} className="calendar-month-stack">
              {monthWeeks.map((week) => {
                const { lanes, segments } = buildWeekSegments(week, filteredJustifications);
                return (
                  <Box key={week[0].toString()} className="calendar-week-row" style={{ "--calendar-lanes": lanes }}>
                    <Box className="calendar-week-grid-cells">
                      {week.map((date) => {
                        const dayItems = filteredJustifications.filter((item) => overlapsDay(item, date));
                        const dayHasOverlap = dayItems.some((item) => justificationsWithOverlap.has(item.id));
                        const inMonth = date.month() === currentDate.month();
                        const isToday = date.isSame(dayjs(), "day");
                        const isWeekend = date.day() === 0 || date.day() === 6;
                        const dayTone = dayItems[0] ? eventToneClass(dayItems[0].justification_type) : "";
                        return (
                          <Box
                            key={date.toString()}
                            className={`calendar-month-cell${inMonth ? "" : " out-of-range"}${isToday ? " today" : ""}${isWeekend ? " weekend" : ""}`}
                            onClick={() => openCreateModal(date)}
                          >
                            <Box className="calendar-cell-header">
                              <Typography className={`calendar-day-number${date.day() === 0 ? " sunday" : ""}`}>
                                {date.date()}
                              </Typography>
                              {dayItems.length > 0 && (
                                <Box className={`calendar-day-badge ${dayTone}${dayHasOverlap ? " overlap-conflict" : ""}`}>
                                  <span>{dayItems.length}</span>
                                </Box>
                              )}
                            </Box>
                          </Box>
                        );
                      })}
                    </Box>

                    <Box className="calendar-week-events-layer">
                      {segments.map((segment) => (
                        <Box
                          key={`${segment.id}-${segment.lane}`}
                          className={`calendar-span-event ${eventToneClass(segment.justification_type)}${approvalToneClass(segment)}${justificationsWithOverlap.has(segment.id) ? " overlap-conflict" : ""}${segment.startsBeforeWeek ? " continues-left" : ""}${segment.endsAfterWeek ? " continues-right" : ""}`}
                          style={{
                            gridColumn: `${segment.colStart} / span ${segment.colSpan}`,
                            gridRow: String(segment.lane + 1),
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                            openEditModal(segment);
                          }}
                        >
                          <span className="calendar-span-event-icon">{eventBadgeIcon(segment.justification_type)}</span>
                          <span className="calendar-span-event-text">{segment.employee_name}</span>
                          {justificationsWithOverlap.has(segment.id) && (
                            <span className="calendar-overlap-warn" title="Ha attività pianificate nel Planner in questo periodo">Sovrapp.</span>
                          )}
                          <span className={`calendar-span-dot ${segment.approval_status}`} />
                        </Box>
                      ))}
                    </Box>
                  </Box>
                );
              })}
            </Stack>
          </Box>
        )}

        {view === "week" && (
          <Box className="calendar-week-board">
            {weekDays.map((date) => {
              const items = filteredJustifications.filter((item) => overlapsDay(item, date));
              const isToday = date.isSame(dayjs(), "day");
              return (
                <Paper
                  key={date.toString()}
                  onClick={() => openCreateModal(date)}
                  className={`calendar-week-card${isToday ? " today" : ""}${date.day() === 0 || date.day() === 6 ? " weekend" : ""}`}
                >
                  <Typography variant="subtitle2" className="calendar-day-label">
                    {date.format("ddd DD/MM")}
                  </Typography>
                  <Stack spacing={0.75} className="calendar-events-stack">
                    {items.map((item) => (
                      <Box
                        key={item.id}
                        className={`calendar-inline-event ${eventToneClass(item.justification_type)}${approvalToneClass(item)}${justificationsWithOverlap.has(item.id) ? " overlap-conflict" : ""}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          openEditModal(item);
                        }}
                      >
                        <span className="calendar-span-event-icon">{eventBadgeIcon(item.justification_type)}</span>
                        <span className="calendar-inline-event-name">{item.employee_name}</span>
                        {justificationsWithOverlap.has(item.id) && (
                          <span className="calendar-overlap-warn" title="Ha attività pianificate nel Planner">Sovrapp.</span>
                        )}
                        <span className={`calendar-approval-badge ${item.approval_status}`}>{approvalStatusLabel(item.approval_status)}</span>
                      </Box>
                    ))}
                    {!items.length && (
                      <Typography variant="body2" className="calendar-empty-state">
                        Nessun giustificativo
                      </Typography>
                    )}
                  </Stack>
                </Paper>
              );
            })}
          </Box>
        )}

        {view === "day" && (
          <Stack spacing={2} className="calendar-day-view">
            <Button variant="contained" onClick={() => openCreateModal(currentDate)} className="calendar-primary-action">
              ⚙ Inserisci giustificativo
            </Button>
            <Stack spacing={1}>
              {currentDayItems.map((item) => (
                <Paper
                  key={item.id}
                  className={`calendar-day-item ${eventToneClass(item.justification_type)}${approvalToneClass(item)}${justificationsWithOverlap.has(item.id) ? " overlap-conflict" : ""}`}
                  onClick={() => openEditModal(item)}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5, flexWrap: "wrap" }}>
                    <span className="calendar-span-event-icon">{eventBadgeIcon(item.justification_type)}</span>
                    <Typography variant="subtitle1" className="calendar-day-item-title" sx={{ mb: "0 !important" }}>
                      {item.employee_name}
                    </Typography>
                    {justificationsWithOverlap.has(item.id) && (
                      <span className="calendar-overlap-warn" title="Ha attività pianificate nel Planner">Sovrapposizione</span>
                    )}
                    <span className={`calendar-approval-badge ${item.approval_status}`}>{approvalStatusLabel(item.approval_status)}</span>
                  </Box>
                  <Typography variant="body2" className="calendar-day-item-meta">
                    {item.justification_type} · {normalizeTimeValue(item.start_time)} - {normalizeTimeValue(item.end_time)}
                  </Typography>
                  <Typography variant="body2" className="calendar-day-item-description">
                    {item.description || "Nessuna descrizione"}
                  </Typography>
                </Paper>
              ))}
              {!currentDayItems.length && (
                <Typography className="calendar-empty-state">
                  Nessun giustificativo registrato per il giorno selezionato.
                </Typography>
              )}
            </Stack>
          </Stack>
        )}
      </Paper>

      <Dialog open={modalOpen} onClose={closeModal} fullWidth maxWidth="sm" PaperProps={{ className: "calendar-modal-paper" }}>
        <DialogTitle className="calendar-modal-title">
          <Box className="calendar-modal-header">
            <Box>
              <Typography className="calendar-modal-heading">
                {editingJustification ? "Modifica assenza" : "Aggiungi assenza"}
              </Typography>
              <Typography className="calendar-modal-subtitle">
                Richiedi un'assenza e seleziona il tipo di giustificativo.
              </Typography>
              {editingJustification && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1.5, flexWrap: "wrap" }}>
                  <span className={`calendar-approval-badge ${editingJustification.approval_status}`}>
                    {approvalStatusLabel(editingJustification.approval_status)}
                  </span>
                  {editingJustification.requires_my_approval && editingJustification.approval_status === "pending" && (
                    <Typography className="calendar-modal-subtitle" component="span" sx={{ mt: "0 !important" }}>
                      · Richiede la tua approvazione
                    </Typography>
                  )}
                </Box>
              )}
            </Box>
            <Button onClick={closeModal} className="calendar-modal-close" disabled={saveInProgress || deleteMutation.isPending}>
              ×
            </Button>
          </Box>
        </DialogTitle>
        <DialogContent className="calendar-modal-content">
          {modalError && <Alert severity="error" sx={{ mb: 2 }}>{modalError.message}</Alert>}
          {isLocked && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Questa assenza è già stata <strong>{editingJustification.approval_status === "approved" ? "approvata" : "rifiutata"}</strong> e non può più essere modificata o eliminata.
            </Alert>
          )}
          {formHasOverlap && !isLocked && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Questo dipendente ha attività pianificate nel Planner durante questo periodo — potrebbe esserci una sovrapposizione.
            </Alert>
          )}
          <Stack spacing={2.5} className="calendar-modal-form">
            <TextField
              className="calendar-form-field"
              select
              label="Tipo di giustificativo"
              value={form.justification_type}
              onChange={(event) => updateFormValue("justification_type", event.target.value)}
              fullWidth
              disabled={isLocked}
            >
              {justificationTypes.map((type) => (
                <MenuItem key={type} value={type}>
                  {type}
                </MenuItem>
              ))}
            </TextField>
            {singleEmployee ? (
              <TextField
                className="calendar-form-field"
                label="Dipendente"
                value={(employeesQuery.data ?? [])[0]?.full_name ?? ""}
                fullWidth
                disabled
              />
            ) : (
              <TextField
                className="calendar-form-field"
                select
                label="Dipendente"
                value={form.employee_id}
                onChange={(event) => updateFormValue("employee_id", event.target.value)}
                fullWidth
                disabled={isLocked}
              >
                {(employeesQuery.data ?? []).map((employee) => (
                  <MenuItem key={employee.id} value={employee.id}>
                    {employee.full_name}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <TextField
              className="calendar-form-field"
              label="Descrizione"
              value={form.description}
              onChange={(event) => updateFormValue("description", event.target.value)}
              multiline
              minRows={4}
              fullWidth
              disabled={isLocked}
            />

            <Box className="calendar-mode-section" sx={{ pointerEvents: isLocked ? "none" : "auto", opacity: isLocked ? 0.5 : 1 }}>
              <Typography className="calendar-section-label">Durata</Typography>
              <Box className="calendar-mode-switch">
                <Button
                  type="button"
                  className={`calendar-mode-option${absenceMode === absenceModes.halfDay ? " active" : ""}`}
                  onClick={() => handleAbsenceModeChange(absenceModes.halfDay)}
                >
                  Mezza giornata
                </Button>
                <Button
                  type="button"
                  className={`calendar-mode-option${absenceMode === absenceModes.days ? " active" : ""}`}
                  onClick={() => handleAbsenceModeChange(absenceModes.days)}
                >
                  Giorni
                </Button>
              </Box>
            </Box>

            {absenceMode === absenceModes.days ? (
              <Stack spacing={1.5}>
                <Typography className="calendar-section-label">Intervallo di date</Typography>
                <Box className="calendar-range-preview">{formatDateRangeLabel(form.start_date, form.end_date)}</Box>
                <Box className="calendar-picker-shell">
                  <DayPicker
                    mode="range"
                    locale={dayPickerLocale}
                    weekStartsOn={1}
                    showOutsideDays
                    fixedWeeks
                    selected={selectedDateRange}
                    onSelect={handleDateRangeSelect}
                    defaultMonth={toPickerDate(form.start_date)}
                    className="calendar-day-picker"
                  />
                </Box>
              </Stack>
            ) : (
              <Stack spacing={1.5}>
                <Typography className="calendar-section-label">Dettaglio orario</Typography>
                <Grid2 container spacing={2}>
                  <Grid2 size={{ xs: 12 }}>
                    <TextField
                      className="calendar-form-field"
                      type="date"
                      label="Data"
                      value={form.start_date}
                      onChange={(event) => updateFormValue("start_date", event.target.value)}
                      InputLabelProps={{ shrink: true }}
                      fullWidth
                    />
                  </Grid2>
                  <Grid2 size={{ xs: 12, md: 6 }}>
                    <TextField
                      className="calendar-form-field"
                      type="time"
                      label="Dalle"
                      value={form.start_time}
                      onChange={(event) => updateFormValue("start_time", event.target.value)}
                      InputLabelProps={{ shrink: true }}
                      fullWidth
                    />
                  </Grid2>
                  <Grid2 size={{ xs: 12, md: 6 }}>
                    <TextField
                      className="calendar-form-field"
                      type="time"
                      label="Alle"
                      value={form.end_time}
                      onChange={(event) => updateFormValue("end_time", event.target.value)}
                      InputLabelProps={{ shrink: true }}
                      fullWidth
                    />
                  </Grid2>
                </Grid2>
              </Stack>
            )}
          </Stack>
        </DialogContent>
        <DialogActions className="calendar-modal-actions">
          {editingJustification && !isLocked && (
            <Button
              className="calendar-delete-action"
              color="error"
              onClick={() => deleteMutation.mutate(editingJustification.id)}
              disabled={deleteMutation.isPending || saveInProgress}
            >
              {deleteMutation.isPending ? "Eliminazione..." : "Elimina"}
            </Button>
          )}
          {editingJustification?.requires_my_approval && (
            <>
              {editingJustification.approval_status !== "pending" && (
                <Button
                  onClick={() => approveMutation.mutate({ justificationId: editingJustification.id, approvalStatus: "pending" })}
                  disabled={approveMutation.isPending || saveInProgress || deleteMutation.isPending}
                >
                  In attesa
                </Button>
              )}
              {editingJustification.approval_status !== "rejected" && (
                <Button
                  color="error"
                  onClick={() => approveMutation.mutate({ justificationId: editingJustification.id, approvalStatus: "rejected" })}
                  disabled={approveMutation.isPending || saveInProgress || deleteMutation.isPending}
                >
                  Rifiuta
                </Button>
              )}
              {editingJustification.approval_status !== "approved" && (
                <Button
                  variant="contained"
                  onClick={() => approveMutation.mutate({ justificationId: editingJustification.id, approvalStatus: "approved" })}
                  disabled={approveMutation.isPending || saveInProgress || deleteMutation.isPending}
                >
                  Approva
                </Button>
              )}
            </>
          )}
          <Button onClick={closeModal} className="calendar-ghost-button" disabled={saveInProgress || deleteMutation.isPending}>
            {isLocked ? "Chiudi" : "Annulla"}
          </Button>
          {!isLocked && (
            <Button
              variant="contained"
              disabled={!form.employee_id || saveInProgress || deleteMutation.isPending}
              onClick={handleSave}
              className="calendar-primary-action"
            >
              {saveInProgress ? "Salvataggio..." : editingJustification ? "Salva modifiche" : "Salva assenza"}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
