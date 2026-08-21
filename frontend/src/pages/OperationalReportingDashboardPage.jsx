import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";

import FilterSelect from "../components/FilterSelect";
import PageHeader, { HeaderButton } from "../components/PageHeader";
import "dayjs/locale/it";
import { useNavigate } from "react-router-dom";

import { getOperationalReportingDashboard } from "../operationalReportingApi";
import "./OperationalReportingDashboardPage.css";

dayjs.locale("it");

const PERIODS = [
  { value: "today", label: "Oggi" },
  { value: "week", label: "Questa settimana" },
  { value: "month", label: "Questo mese" },
  { value: "custom", label: "Date selezionabili" },
];

function periodFor(mode) {
  const today = dayjs();
  if (mode === "today") return { start: today.format("YYYY-MM-DD"), end: today.format("YYYY-MM-DD") };
  if (mode === "week") return { start: today.subtract((today.day() + 6) % 7, "day").format("YYYY-MM-DD"), end: today.format("YYYY-MM-DD") };
  return { start: today.startOf("month").format("YYYY-MM-DD"), end: today.format("YYYY-MM-DD") };
}

function minutesLabel(value = 0) {
  const minutes = Math.max(0, Math.round(Number(value) || 0));
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function signedMinutes(value = 0) {
  if (!value) return "in linea";
  return `${value > 0 ? "+" : "−"}${minutesLabel(Math.abs(value))}`;
}

function periodLabel(start, end) {
  if (start === end) return dayjs(start).format("D MMMM YYYY");
  return `${dayjs(start).format("D MMM YYYY")} – ${dayjs(end).format("D MMM YYYY")}`;
}

function KpiCard({ icon, title, value, detail, tone = "default" }) {
  return (
    <Paper className={`opr-dashboard-kpi is-${tone}`}>
      <Box className="opr-dashboard-kpi-icon">{icon}</Box>
      <Box>
        <Typography className="opr-dashboard-kpi-title">{title}</Typography>
        <Typography className="opr-dashboard-kpi-value">{value}</Typography>
        <Typography className="opr-dashboard-kpi-detail">{detail}</Typography>
      </Box>
    </Paper>
  );
}

function TrendChart({ rows, onSelectDate, isScoped }) {
  const visibleRows = rows.filter((row) => row.planned_days || row.reports || row.work_minutes);
  const maxMinutes = Math.max(1, ...visibleRows.map((row) => row.work_minutes));
  if (!visibleRows.length) return <Typography className="opr-dashboard-empty">Nessuna giornata pianificata nel periodo.</Typography>;
  return (
    <Box className="opr-dashboard-trend-scroll">
      <Box className="opr-dashboard-trend" style={{ minWidth: `${Math.max(620, visibleRows.length * 42)}px` }}>
        {visibleRows.map((row) => {
          const allocatedHeight = (row.allocated_minutes / maxMinutes) * 100;
          const uncoveredHeight = (row.uncovered_minutes / maxMinutes) * 100;
          return (
            <Tooltip
              key={row.work_date}
              arrow
              title={`${dayjs(row.work_date).format("DD/MM/YYYY")} · ${minutesLabel(row.allocated_minutes)} ${isScoped ? "nel filtro" : "attribuite"} · ${minutesLabel(row.uncovered_minutes)} ${isScoped ? "altre ore" : "scoperte"} · ${row.confirmed}/${row.planned_days} confermate`}
            >
              <Box component="button" type="button" className="opr-dashboard-trend-day" onClick={() => onSelectDate(row.work_date)}>
                <Box className="opr-dashboard-trend-bars">
                  <span className="is-uncovered" style={{ height: `${uncoveredHeight}%` }} />
                  <span className="is-allocated" style={{ height: `${allocatedHeight}%` }} />
                </Box>
                <span className="opr-dashboard-trend-dow">{dayjs(row.work_date).format("dd").slice(0, 1)}</span>
                <span className="opr-dashboard-trend-date">{dayjs(row.work_date).format("D")}</span>
              </Box>
            </Tooltip>
          );
        })}
      </Box>
    </Box>
  );
}

function WorkflowRows({ rows }) {
  if (!rows.length) return <Typography className="opr-dashboard-empty">Nessuna risorsa in questo stato.</Typography>;
  return (
    <Box className="opr-dashboard-workflow-table-wrap">
      <Box className="opr-dashboard-workflow-table">
        <Box className="opr-dashboard-workflow-row is-head">
          <span>Risorsa</span><span>Data</span><span>Stato</span><span>Planner</span><span>Effettive</span><span>Attribuite</span><span>Scoperte</span>
        </Box>
        {rows.map((row) => (
          <Box className="opr-dashboard-workflow-row" key={`${row.employee_id}:${row.work_date}`}>
            <span><strong>{row.employee_name}</strong><small>{row.team_name}</small></span>
            <span>{dayjs(row.work_date).format("DD/MM/YYYY")}</span>
            <span><i className={`is-${row.status === "NOT_STARTED" ? "missing" : row.status === "CONFIRMED" ? "confirmed" : "draft"}`}>{row.status === "NOT_STARTED" ? "Non iniziata" : row.status === "CONFIRMED" ? "Confermata" : "Bozza"}</i></span>
            <span>{minutesLabel(row.planned_minutes)}</span>
            <span>{row.status === "NOT_STARTED" ? "—" : minutesLabel(row.work_minutes)}</span>
            <span>{row.status === "NOT_STARTED" ? "—" : minutesLabel(row.allocated_minutes)}</span>
            <span>{row.status === "NOT_STARTED" ? "—" : minutesLabel(row.uncovered_minutes)}</span>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function WorkflowDrilldown({ workflow }) {
  const [stage, setStage] = useState("overview");
  const [coverageFilter, setCoverageFilter] = useState("all");
  const totalExpected = Math.max(1, workflow.expected_minutes);
  const savedWork = Math.max(1, workflow.saved_work_minutes);
  const notStartedRows = workflow.rows.filter((row) => row.status === "NOT_STARTED");
  const savedRows = workflow.rows.filter((row) => row.status !== "NOT_STARTED");
  const detailRows = stage === "not-started"
    ? notStartedRows
    : savedRows.filter((row) => (
        coverageFilter === "allocated" ? row.allocated_minutes > 0
          : coverageFilter === "uncovered" ? row.uncovered_minutes > 0
            : true
      ));
  const openStage = (nextStage) => {
    setStage(nextStage);
    setCoverageFilter("all");
  };

  return (
    <Paper className="opr-dashboard-card opr-dashboard-workflow">
      <Box className="opr-dashboard-card-header">
        <Box>
          <Typography className="opr-dashboard-section-title">
            {stage === "overview" ? "Percorso delle ore" : stage === "not-started" ? "Ore solo pianificate" : "Copertura delle rendicontazioni salvate"}
          </Typography>
          <Typography className="opr-dashboard-section-subtitle">
            {stage === "overview" ? "Dalle ore attese nel Planner alle ore rendicontate" : stage === "not-started" ? "Risorse con pianificazione ma senza una rendicontazione salvata" : "Ore effettive suddivise tra attribuite e ancora scoperte"}
          </Typography>
        </Box>
        {stage !== "overview" && <Button size="small" onClick={() => openStage("overview")}>‹ Torna al primo livello</Button>}
      </Box>

      {stage === "overview" ? (
        <Box className="opr-dashboard-workflow-body">
          <Box className="opr-dashboard-workflow-total">
            <span>Ore attese da Planner</span><strong>{minutesLabel(workflow.expected_minutes)}</strong>
          </Box>
          <Box className="opr-dashboard-workflow-bar" aria-label="Suddivisione delle ore attese da Planner">
            <Tooltip title={`${minutesLabel(workflow.not_started_planned_minutes)} senza rendicontazione salvata`} arrow>
              <button
                type="button"
                className="is-not-started"
                style={{ width: `${(workflow.not_started_planned_minutes / totalExpected) * 100}%` }}
                onClick={() => openStage("not-started")}
              >{workflow.not_started_planned_minutes > 0 && <span>{minutesLabel(workflow.not_started_planned_minutes)}</span>}</button>
            </Tooltip>
            <Tooltip title={`${minutesLabel(workflow.saved_planned_minutes)} con rendicontazione salvata`} arrow>
              <button
                type="button"
                className="is-saved"
                style={{ width: `${(workflow.saved_planned_minutes / totalExpected) * 100}%` }}
                onClick={() => openStage("saved")}
              >{workflow.saved_planned_minutes > 0 && <span>{minutesLabel(workflow.saved_planned_minutes)}</span>}</button>
            </Tooltip>
          </Box>
          <Box className="opr-dashboard-workflow-choices">
            <button type="button" onClick={() => openStage("not-started")}>
              <i className="is-not-started" /><span>Solo pianificate<small>{minutesLabel(workflow.not_started_planned_minutes)} · {notStartedRows.length} giornate</small></span><b>›</b>
            </button>
            <button type="button" onClick={() => openStage("saved")}>
              <i className="is-saved" /><span>Rendicontazioni salvate<small>{minutesLabel(workflow.saved_planned_minutes)} attese · {savedRows.length} giornate ({savedRows.filter((row) => row.status === "CONFIRMED").length} confermate)</small></span><b>›</b>
            </button>
          </Box>
        </Box>
      ) : (
        <Box className="opr-dashboard-workflow-detail">
          {stage === "saved" && (
            <>
              <Box className="opr-dashboard-workflow-metrics">
                <span><small>Attese Planner</small><strong>{minutesLabel(workflow.saved_planned_minutes)}</strong></span>
                <span><small>Ore effettive</small><strong>{minutesLabel(workflow.saved_work_minutes)}</strong></span>
                <span><small>Scostamento</small><strong>{signedMinutes(workflow.variance_minutes)}</strong></span>
              </Box>
              <Box className="opr-dashboard-workflow-bar is-coverage" aria-label="Copertura delle ore effettive">
                <Tooltip title={`${minutesLabel(workflow.allocated_minutes)} attribuite`} arrow>
                  <button type="button" className="is-allocated" style={{ width: `${(workflow.allocated_minutes / savedWork) * 100}%` }} onClick={() => setCoverageFilter("allocated")}>
                    {workflow.allocated_minutes > 0 && <span>{minutesLabel(workflow.allocated_minutes)}</span>}
                  </button>
                </Tooltip>
                <Tooltip title={`${minutesLabel(workflow.uncovered_minutes)} scoperte`} arrow>
                  <button type="button" className="is-uncovered" style={{ width: `${(workflow.uncovered_minutes / savedWork) * 100}%` }} onClick={() => setCoverageFilter("uncovered")}>
                    {workflow.uncovered_minutes > 0 && <span>{minutesLabel(workflow.uncovered_minutes)}</span>}
                  </button>
                </Tooltip>
              </Box>
              <Box className="opr-dashboard-workflow-detail-actions">
                <button type="button" className={coverageFilter === "all" ? "active" : ""} onClick={() => setCoverageFilter("all")}>Tutte</button>
                <button type="button" className={coverageFilter === "allocated" ? "active" : ""} onClick={() => setCoverageFilter("allocated")}>Con ore attribuite</button>
                <button type="button" className={coverageFilter === "uncovered" ? "active" : ""} onClick={() => setCoverageFilter("uncovered")}>Con ore scoperte</button>
              </Box>
            </>
          )}
          <WorkflowRows rows={detailRows} />
        </Box>
      )}
    </Paper>
  );
}

function groupRows(rows, keyOf, labelOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    const current = groups.get(key) ?? { key, label: labelOf(row), minutes: 0, allocations: 0, employees: 0 };
    current.minutes += row.minutes;
    current.allocations += row.allocations;
    current.employees = Math.max(current.employees, row.employees);
    groups.set(key, current);
  }
  return [...groups.values()].sort((left, right) => right.minutes - left.minutes);
}

function BreakdownCard({ title, subtitle, rows, mode, activeParent, activeParentLabel, activeDetail, onSelectParent, onSelectDetail, onClear }) {
  const topLevel = mode === "customer"
    ? groupRows(rows, (row) => row.customer_code, (row) => row.customer_description || row.customer_code)
    : groupRows(rows, (row) => row.area_id || "__missing__", (row) => row.area_name);
  const detailRows = activeParent == null ? [] : mode === "customer"
    ? groupRows(
        rows.filter((row) => row.customer_code === activeParent),
        (row) => row.jupiter_description || "__missing__",
        (row) => row.jupiter_description || "Senza descrizione Jupiter",
      )
    : groupRows(
        rows.filter((row) => (row.area_id || row.area_name) === activeParent),
        (row) => row.building || "__missing__",
        (row) => row.building || "Immobile non specificato",
      );
  const items = activeParent == null ? topLevel : detailRows;
  const max = items[0]?.minutes ?? 1;
  const selectedLabel = activeParentLabel || topLevel.find((item) => item.key === activeParent)?.label;
  return (
    <Paper className="opr-dashboard-card opr-dashboard-breakdown-card">
      <Box className="opr-dashboard-card-header">
        <Box>
          <Typography className="opr-dashboard-section-title">{selectedLabel || title}</Typography>
          <Typography className="opr-dashboard-section-subtitle">
            {selectedLabel ? (mode === "customer" ? "Dettaglio descrizioni Jupiter" : "Dettaglio immobili") : subtitle}
          </Typography>
        </Box>
        {activeParent != null && <Button size="small" onClick={onClear}>‹ Indietro</Button>}
      </Box>
      <Box className="opr-dashboard-ranking">
        {items.slice(0, 10).map((item) => (
          <Box
            component="button"
            type="button"
            key={item.key}
            className={`opr-dashboard-ranking-row${item.key !== "__missing__" ? " is-clickable" : ""}${activeDetail === item.key ? " is-selected" : ""}`}
            disabled={item.key === "__missing__"}
            onClick={() => (activeParent == null ? onSelectParent(item) : onSelectDetail(item))}
          >
            <Box className="opr-dashboard-ranking-copy">
              <span title={item.label}>{item.label}</span>
              <small>{item.allocations} box rendicontati</small>
            </Box>
            <Box className="opr-dashboard-ranking-track"><span style={{ width: `${(item.minutes / max) * 100}%` }} /></Box>
            <strong>{minutesLabel(item.minutes)}</strong>
          </Box>
        ))}
        {!items.length && <Typography className="opr-dashboard-empty">Nessuna ora attribuita.</Typography>}
      </Box>
    </Paper>
  );
}

function TeamProgress({ teams, activeEmployeeId, onSelectEmployee, isScoped }) {
  const [expandedTeamId, setExpandedTeamId] = useState(null);
  return (
    <Paper className="opr-dashboard-card">
      <Box className="opr-dashboard-card-header">
        <Box>
          <Typography className="opr-dashboard-section-title">Avanzamento squadre</Typography>
          <Typography className="opr-dashboard-section-subtitle">Conferme e copertura nel periodo selezionato</Typography>
        </Box>
      </Box>
      <Box className="opr-dashboard-team-grid">
        {teams.map((team) => {
          const completion = team.planned_days ? (team.confirmed / team.planned_days) * 100 : 0;
          const expanded = expandedTeamId === team.team_id;
          return (
            <Box className={`opr-dashboard-team${expanded ? " is-expanded" : ""}`} key={team.team_id} style={{ "--team-color": team.team_color }}>
              <Box
                component="button"
                type="button"
                className="opr-dashboard-team-toggle"
                aria-expanded={expanded}
                onClick={() => setExpandedTeamId(expanded ? null : team.team_id)}
              >
                <Box className="opr-dashboard-team-heading">
                  <span>{team.team_icon} {team.team_name}</span>
                  <Box className="opr-dashboard-team-score"><strong>{Math.round(completion)}%</strong><i>{expanded ? "−" : "+"}</i></Box>
                </Box>
                <Box className="opr-dashboard-team-track"><span style={{ width: `${completion}%` }} /></Box>
                <Box className="opr-dashboard-team-meta">
                  <span>{team.confirmed} confermate</span>
                  <span>{team.draft} bozze</span>
                  <span>{team.not_started} non iniziate</span>
                  <span>{isScoped ? "Incidenza" : "Copertura"} {team.coverage_percent}%</span>
                  <span>{team.members.length} membri</span>
                </Box>
              </Box>
              {expanded && (
                <Box className="opr-dashboard-members">
                  <Box className="opr-dashboard-member opr-dashboard-member-head">
                    <span>Dipendente</span><span>Stato giornate</span><span>Ore</span><span>{isScoped ? "Incidenza" : "Copertura"}</span>
                  </Box>
                  {team.members.map((member) => {
                    const memberCompletion = member.planned_days ? (member.confirmed / member.planned_days) * 100 : 0;
                    return (
                      <Box
                        component="button"
                        type="button"
                        className={`opr-dashboard-member${activeEmployeeId === member.employee_id ? " is-selected" : ""}`}
                        key={member.employee_id}
                        onClick={() => onSelectEmployee(member)}
                        title={`Filtra tutta la dashboard per ${member.employee_name}`}
                      >
                        <Box className="opr-dashboard-member-name"><strong>{member.employee_name}</strong><small>{member.reports} su {member.planned_days} giornate compilate</small></Box>
                        <Box className="opr-dashboard-member-status">
                          <span className="is-confirmed">{member.confirmed} confermate</span>
                          {member.draft > 0 && <span className="is-draft">{member.draft} bozze</span>}
                          {member.not_started > 0 && <span className="is-missing">{member.not_started} non iniziate</span>}
                        </Box>
                        <Box className="opr-dashboard-member-hours"><strong>{minutesLabel(member.allocated_minutes)}</strong><small>su {minutesLabel(member.work_minutes)}</small></Box>
                        <Box className="opr-dashboard-member-coverage">
                          <Box><span style={{ width: `${Math.min(100, member.coverage_percent)}%` }} /></Box>
                          <strong>{member.coverage_percent}%</strong>
                          <small>{isScoped ? "sul totale lavorato" : `${Math.round(memberCompletion)}% confermato`}</small>
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              )}
            </Box>
          );
        })}
        {!teams.length && <Typography className="opr-dashboard-empty">Nessuna squadra con attività nel periodo.</Typography>}
      </Box>
    </Paper>
  );
}

export default function OperationalReportingDashboardPage() {
  const navigate = useNavigate();
  const initialPeriod = periodFor("month");
  const [periodMode, setPeriodMode] = useState("month");
  const [range, setRange] = useState(initialPeriod);
  const [teamId, setTeamId] = useState("");
  const [crossFilters, setCrossFilters] = useState({
    employee_id: "",
    customer_code: "",
    jupiter_description: "",
    area_id: "",
    building: "",
  });
  const [filterLabels, setFilterLabels] = useState({});
  const requestFilters = { team_id: teamId, ...crossFilters };
  const query = useQuery({
    queryKey: ["operational-reporting-dashboard", range.start, range.end, requestFilters],
    queryFn: () => getOperationalReportingDashboard(range.start, range.end, requestFilters),
    enabled: Boolean(range.start && range.end && range.start <= range.end),
    staleTime: 30 * 1000,
    placeholderData: (previousData) => previousData,
  });
  const data = query.data;
  const summary = data?.summary;
  const headerLabel = useMemo(() => periodLabel(range.start, range.end), [range]);
  const hasAllocationFilters = Boolean(
    crossFilters.customer_code || crossFilters.jupiter_description || crossFilters.area_id || crossFilters.building,
  );

  const applyCrossFilter = (key, value, label) => {
    setCrossFilters((current) => {
      const next = { ...current, [key]: value };
      if (key === "customer_code") next.jupiter_description = "";
      if (key === "area_id") next.building = "";
      return next;
    });
    setFilterLabels((current) => {
      const next = { ...current, [key]: label };
      if (key === "customer_code") delete next.jupiter_description;
      if (key === "area_id") delete next.building;
      return next;
    });
  };
  const clearCrossFilter = (key) => {
    setCrossFilters((current) => {
      const next = { ...current, [key]: "" };
      if (key === "customer_code") next.jupiter_description = "";
      if (key === "area_id") next.building = "";
      return next;
    });
    setFilterLabels((current) => {
      const next = { ...current };
      delete next[key];
      if (key === "customer_code") delete next.jupiter_description;
      if (key === "area_id") delete next.building;
      return next;
    });
  };
  const resetCrossFilters = () => {
    setTeamId("");
    setCrossFilters({ employee_id: "", customer_code: "", jupiter_description: "", area_id: "", building: "" });
    setFilterLabels({});
  };
  const activeTeam = data?.available_teams?.find((team) => team.team_id === teamId);
  const activeChips = [
    teamId && { key: "team_id", label: `Squadra: ${activeTeam?.team_name || "selezionata"}` },
    crossFilters.employee_id && { key: "employee_id", label: `Dipendente: ${filterLabels.employee_id || "selezionato"}` },
    crossFilters.customer_code && { key: "customer_code", label: `Cliente: ${filterLabels.customer_code || crossFilters.customer_code}` },
    crossFilters.jupiter_description && { key: "jupiter_description", label: `Jupiter: ${filterLabels.jupiter_description || crossFilters.jupiter_description}` },
    crossFilters.area_id && { key: "area_id", label: `Area: ${filterLabels.area_id || "selezionata"}` },
    crossFilters.building && { key: "building", label: `Immobile: ${filterLabels.building || crossFilters.building}` },
  ].filter(Boolean);

  const choosePeriod = (mode) => {
    setPeriodMode(mode);
    if (mode !== "custom") setRange(periodFor(mode));
  };
  return (
    <Box className="opr-dashboard-page">
      <PageHeader
        section="Rendicontazioni"
        title="Dashboard rendicontazione operativa"
        actions={<HeaderButton onClick={() => navigate("/rendicontazioni/operativa")}>Vai alla compilazione</HeaderButton>}
      />

      <Paper className="opr-dashboard-period-filter">
        <Box className="opr-dashboard-period-header">
          <Box>
            <Typography className="opr-dashboard-period-title">Periodo di riferimento</Typography>
            <Typography className="opr-dashboard-period-current">{headerLabel}</Typography>
          </Box>
          <Box className="opr-dashboard-period-options">
            {PERIODS.map((period) => (
              <button key={period.value} type="button" className={periodMode === period.value ? "active" : ""} onClick={() => choosePeriod(period.value)}>{period.label}</button>
            ))}
          </Box>
        </Box>
        <Box className="opr-dashboard-filter-row">
          {periodMode === "custom" && (
            <>
              <TextField type="date" label="Dal" size="small" value={range.start} InputLabelProps={{ shrink: true }} inputProps={{ max: range.end }} onChange={(event) => setRange((current) => ({ ...current, start: event.target.value }))} />
              <TextField type="date" label="Al" size="small" value={range.end} InputLabelProps={{ shrink: true }} inputProps={{ min: range.start }} onChange={(event) => setRange((current) => ({ ...current, end: event.target.value }))} />
            </>
          )}
          <FilterSelect
            label="Squadra"
            value={teamId}
            onChange={(value) => {
              setTeamId(value);
              clearCrossFilter("employee_id");
            }}
            options={(data?.available_teams ?? []).map((team) => ({
              value: team.team_id,
              label: `${team.team_icon} ${team.team_name}`,
            }))}
            placeholder="Tutte le squadre"
          />
        </Box>
        {activeChips.length > 0 && (
          <Box className="opr-dashboard-active-filters">
            <Typography>Filtri attivi</Typography>
            {activeChips.map((chip) => (
              <Chip
                key={chip.key}
                size="small"
                label={chip.label}
                onDelete={() => (chip.key === "team_id" ? setTeamId("") : clearCrossFilter(chip.key))}
              />
            ))}
            <Button size="small" onClick={resetCrossFilters}>Azzera filtri</Button>
          </Box>
        )}
      </Paper>

      {query.error && <Alert severity="error">{query.error.message}</Alert>}
      {query.isLoading && <Box className="opr-dashboard-kpi-grid">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} variant="rounded" height={116} />)}</Box>}

      {summary && (
        <>
          <Box className="opr-dashboard-kpi-grid">
            <KpiCard icon="⏱" title="Ore lavorate" value={minutesLabel(summary.work_minutes)} detail={`Pianificate ${minutesLabel(summary.planned_minutes)} · Δ ${signedMinutes(summary.variance_minutes)}`} />
            <KpiCard icon="✓" title={hasAllocationFilters ? "Ore nel filtro" : "Ore attribuite"} value={minutesLabel(summary.allocated_minutes)} detail={`${summary.coverage_percent}% ${hasAllocationFilters ? "di incidenza" : "di copertura"}`} tone={summary.coverage_percent >= 100 ? "success" : "default"} />
            <KpiCard icon="◌" title={hasAllocationFilters ? "Altre ore" : "Ore scoperte"} value={minutesLabel(summary.uncovered_minutes)} detail={hasAllocationFilters ? "Fuori dal filtro operativo" : "Solo sulle rendicontazioni avviate"} tone={summary.uncovered_minutes ? "warning" : "success"} />
            <KpiCard icon="●" title="Confermate" value={`${summary.confirmed} / ${summary.planned_days}`} detail={`${summary.confirmation_percent}% delle giornate ${hasAllocationFilters ? "coinvolte" : "attese"}`} tone={summary.confirmation_percent >= 100 ? "success" : "default"} />
            <KpiCard icon="✎" title="In lavorazione" value={summary.draft + summary.not_started} detail={`${summary.draft} bozze · ${summary.not_started} non iniziate`} tone={summary.draft + summary.not_started ? "warning" : "success"} />
            <KpiCard icon="↗" title="Straordinario" value={minutesLabel(summary.overtime_minutes)} detail="Oltre 8 ore nette al giorno" tone={summary.overtime_minutes ? "warning" : "default"} />
          </Box>

          {!hasAllocationFilters && data.workflow && <WorkflowDrilldown key={`${range.start}:${range.end}:${teamId}:${crossFilters.employee_id}`} workflow={data.workflow} />}

          <Paper className="opr-dashboard-card">
            <Box className="opr-dashboard-card-header">
              <Box>
                <Typography className="opr-dashboard-section-title">Andamento {hasAllocationFilters ? "dell’incidenza" : "della copertura"}</Typography>
                <Typography className="opr-dashboard-section-subtitle">{hasAllocationFilters ? "Ore corrispondenti ai filtri rispetto al totale lavorato" : "Ore attribuite e ancora scoperte per giornata"}</Typography>
              </Box>
              <Box className="opr-dashboard-legend"><span className="is-allocated" />{hasAllocationFilters ? "Nel filtro" : "Attribuite"} <span className="is-uncovered" />{hasAllocationFilters ? "Altre ore" : "Scoperte"}</Box>
            </Box>
            <TrendChart rows={data.trend} isScoped={hasAllocationFilters} onSelectDate={(workDate) => { setPeriodMode("custom"); setRange({ start: workDate, end: workDate }); }} />
          </Paper>

          <Box className="opr-dashboard-two-columns">
            <BreakdownCard
              title="Ore per cliente"
              subtitle="Clicca un cliente per filtrare tutti i pannelli"
              rows={data.customers}
              mode="customer"
              activeParent={crossFilters.customer_code || null}
              activeParentLabel={filterLabels.customer_code}
              activeDetail={crossFilters.jupiter_description}
              onSelectParent={(item) => applyCrossFilter("customer_code", item.key, item.label)}
              onSelectDetail={(item) => applyCrossFilter("jupiter_description", item.key, item.label)}
              onClear={() => (crossFilters.jupiter_description ? clearCrossFilter("jupiter_description") : clearCrossFilter("customer_code"))}
            />
            <BreakdownCard
              title="Ore per area"
              subtitle="Clicca un’area per filtrare tutti i pannelli"
              rows={data.locations}
              mode="location"
              activeParent={crossFilters.area_id || null}
              activeParentLabel={filterLabels.area_id}
              activeDetail={crossFilters.building}
              onSelectParent={(item) => applyCrossFilter("area_id", item.key, item.label)}
              onSelectDetail={(item) => applyCrossFilter("building", item.key, item.label)}
              onClear={() => (crossFilters.building ? clearCrossFilter("building") : clearCrossFilter("area_id"))}
            />
          </Box>

          <TeamProgress
            teams={data.teams}
            isScoped={hasAllocationFilters}
            activeEmployeeId={crossFilters.employee_id}
            onSelectEmployee={(member) => (
              crossFilters.employee_id === member.employee_id
                ? clearCrossFilter("employee_id")
                : applyCrossFilter("employee_id", member.employee_id, member.employee_name)
            )}
          />
        </>
      )}
    </Box>
  );
}
