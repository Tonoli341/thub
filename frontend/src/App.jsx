import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Alert, Box, Button, CircularProgress, Container, InputBase, Stack, Tooltip, Typography } from "@mui/material";

import { useAuth } from "./auth";
import { useAppTheme } from "./ThemeContext";
import ErrorBoundary from "./ErrorBoundary";
import LoginPage from "./pages/LoginPage";
import NotificationsBell from "./NotificationsBell";

// Code-splitting per route: le pagine (alcune molto grandi, con dipendenze come
// pdf-lib o @xyflow/react) vengono scaricate solo quando servono.
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const EmployeesPage = lazy(() => import("./pages/EmployeesPage"));
const FunctionsDepartmentsPage = lazy(() => import("./pages/FunctionsDepartmentsPage"));
const LdapEmployeesPage = lazy(() => import("./pages/LdapEmployeesPage"));
const OrgChartPage = lazy(() => import("./pages/OrgChartPage"));
const OperationalAreasPage = lazy(() => import("./pages/OperationalAreasPage"));
const TrainingConfigPage = lazy(() => import("./pages/TrainingConfigPage"));
const PlannerPage = lazy(() => import("./pages/PlannerPage"));
const ProjectsPage = lazy(() => import("./pages/ProjectsPage"));
const SquadrePage = lazy(() => import("./pages/SquadrePage"));
const ActivityDashboardPage = lazy(() => import("./pages/TimesheetDashboardPage"));
const ActivityListPage = lazy(() => import("./pages/TimesheetListPage"));
const ActiveActivitiesPage = lazy(() => import("./pages/ActiveActivitiesPage"));
const DailyRecordsPage = lazy(() => import("./pages/DailyRecordsPage"));
const loadOperationalReportingPage = () => import("./pages/OperationalReportingPage");
const OperationalReportingPage = lazy(loadOperationalReportingPage);
const OperationalReportingDashboardPage = lazy(() => import("./pages/OperationalReportingDashboardPage"));
const ToolChangesPage = lazy(() => import("./pages/ToolChangesPage"));
const WorkloadPage = lazy(() => import("./pages/WorkloadPage"));
const EndpointsPage = lazy(() => import("./pages/EndpointsPage"));
const AuditLogPage = lazy(() => import("./pages/AuditLogPage"));
const SystemStatusPage = lazy(() => import("./pages/SystemStatusPage"));
const IntegrationsPage = lazy(() => import("./pages/IntegrationsPage"));
const ConsegnePage = lazy(() => import("./pages/ConsegnePage"));
const DeliverySignaturePage = lazy(() => import("./pages/DeliverySignaturePage"));
const MaintenancePage = lazy(() => import("./pages/MaintenancePage"));

function PageLoader() {
  return (
    <Box sx={{ minHeight: "40vh", display: "grid", placeItems: "center" }}>
      <CircularProgress sx={{ color: "#007040" }} />
    </Box>
  );
}

const SIDEBAR_SECTIONS = [
  {
    key: "quick",
    title: null,
    items: [
      { to: "/", label: "Home", icon: "home" },
      { to: "/planner", label: "Planner", icon: "briefcase", requires: "planning" },
      { to: "/carichi", label: "Carichi", icon: "document", requires: "workloads" },
      { to: "/calendario", label: "Assenze", icon: "sun", requires: "calendar" },
      { to: "/consegne", label: "Consegne", icon: "box", requires: "deliveries" },
      { to: "/manutenzioni", label: "Manutenzioni", icon: "tools", requires: "maintenance" },
    ],
  },
  {
    key: "rendicontazioni",
    title: "Rendicontazioni",
    items: [
      { to: "/rendicontazioni/operativa/dashboard", label: "Dashboard operativa", icon: "panel", requires: "operationalReporting" },
      { to: "/rendicontazioni/operativa", label: "Operativa", icon: "clock", requires: "operationalReporting", exact: true },
    ],
  },
  {
    key: "strumenti",
    title: "Strumenti",
    items: [
      { to: "/modifiche-tool", label: "Modifiche tool", icon: "checklist", requires: "organization" },
    ],
  },
  {
    key: "impresa",
    title: "Impresa",
    items: [
      { to: "/dipendenti", label: "Dipendenti", icon: "user", requires: "organization" },
      { to: "/squadre", label: "Squadre", icon: "team", requires: "organization" },
      { to: "/organigramma", label: "Organigramma", icon: "orgchart", requires: "organization" },
      { to: "/funzioni-dipartimenti", label: "Funzione / Dipartimento", icon: "structure", requires: "organization" },
    ],
  },
  {
    key: "configurazione",
    title: "Configurazione",
    items: [
      { to: "/dipendenti-ldap", label: "Mapping LDAP", icon: "folder", requires: "organization" },
      { to: "/commesse", label: "Jupiter", icon: "planet", requires: "organization" },
      { to: "/aree-operative", label: "Aree operative", icon: "document", requires: "organization" },
      { to: "/formazione", label: "Formazione", icon: "graduation", requires: "hr" },
      { to: "/integrazioni", label: "Integrazioni", icon: "plug", requires: "admin" },
      { to: "/endpoints", label: "Endpoint API", icon: "code", requires: "admin" },
      { to: "/audit", label: "Audit", icon: "checklist", requires: "admin" },
      { to: "/stato-sistema", label: "Stato sistema", icon: "pulse", requires: "admin" },
    ],
  },
];

function THubLogo({ size = 28 }) {
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: "0.38em", lineHeight: 1 }}>
      <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" style={{ flexShrink: 0, display: "block" }}>
        <defs><clipPath id="thub-cl"><circle cx="100" cy="100" r="62" /></clipPath></defs>
        <rect width="200" height="200" rx="44" fill="#F0ECE0" />
        <g clipPath="url(#thub-cl)">
          <rect x="38" y="38" width="124" height="124" fill="#007040" />
          <rect x="38" y="71.5" width="124" height="29.8" fill="#F0ECE0" />
          <rect x="84.5" y="71.5" width="31" height="90.5" fill="#F0ECE0" />
        </g>
      </svg>
      <Box
        component="span"
        sx={{
          fontFamily: '"Lexend", "Segoe UI", sans-serif',
          fontWeight: 600,
          fontSize: size * 0.6,
          letterSpacing: "-0.02em",
          lineHeight: 1,
          color: "var(--color-sidebar-text)",
        }}
      >
        T<Box component="span" sx={{ color: "var(--color-accent)" }}>-</Box>Hub
      </Box>
    </Box>
  );
}

function Icon({ name, size = 20, stroke = 1.9 }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    stroke: "currentColor",
    strokeWidth: stroke,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };

  switch (name) {
    case "home":
      return (
        <svg {...common}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5.5 9.5V20h13V9.5" />
        </svg>
      );
    case "briefcase":
      return (
        <svg {...common}>
          <rect x="3" y="7" width="18" height="12" rx="2.5" />
          <path d="M9 7V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7" />
          <path d="M3 11.5h18" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          <rect x="4" y="5" width="16" height="15" rx="2.5" />
          <path d="M8 3v4" />
          <path d="M16 3v4" />
          <path d="M4 9.5h16" />
        </svg>
      );
    case "user":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20a7 7 0 0 1 14 0" />
        </svg>
      );
    case "users":
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="3" />
          <path d="M4.5 18a4.5 4.5 0 0 1 9 0" />
          <path d="M16.5 6.8a2.5 2.5 0 1 1 0 5" />
          <path d="M18.8 18a4 4 0 0 0-2.8-3.8" />
        </svg>
      );
    case "team":
      return (
        <svg {...common}>
          <circle cx="8" cy="9" r="2.5" />
          <circle cx="16" cy="9" r="2.5" />
          <path d="M3.8 18a4.2 4.2 0 0 1 8.4 0" />
          <path d="M11.8 18a4.2 4.2 0 0 1 8.4 0" />
        </svg>
      );
    case "orgchart":
      return (
        <svg {...common}>
          <rect x="9" y="4" width="6" height="4" rx="1" />
          <rect x="4" y="16" width="6" height="4" rx="1" />
          <rect x="14" y="16" width="6" height="4" rx="1" />
          <path d="M12 8v4" />
          <path d="M7 16v-2h10v2" />
        </svg>
      );
    case "folder":
      return (
        <svg {...common}>
          <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3l1.8 2H18a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19H6A2.5 2.5 0 0 1 3.5 16.5z" />
        </svg>
      );
    case "document":
      return (
        <svg {...common}>
          <rect x="6" y="3.5" width="12" height="17" rx="2" />
          <path d="M9 8.5h6" />
          <path d="M9 12h6" />
          <path d="M9 15.5h4" />
        </svg>
      );
    case "checklist":
      return (
        <svg {...common}>
          <path d="M9 6h11" />
          <path d="M9 12h11" />
          <path d="M9 18h11" />
          <path d="m4 6 1.5 1.5L8 4" />
          <path d="m4 12 1.5 1.5L8 10" />
          <path d="m4 18 1.5 1.5L8 16" />
        </svg>
      );
    case "box":
      return (
        <svg {...common}>
          <path d="M12 3 20 7v10l-8 4-8-4V7z" />
          <path d="M4 7l8 4 8-4" />
          <path d="M12 11v9" />
        </svg>
      );
    case "receipt":
      return (
        <svg {...common}>
          <path d="M7 4h10v16l-2.5-1.4L12 20l-2.5-1.4L7 20z" />
          <path d="M9.5 8.5h5" />
          <path d="M9.5 12h5" />
          <path d="M9.5 15.5h3.5" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
        </svg>
      );
    case "panel":
      return (
        <svg {...common}>
          <rect x="4" y="5" width="16" height="14" rx="2.5" />
          <path d="M10 5v14" />
        </svg>
      );
    case "chevron-down":
      return (
        <svg {...common}>
          <path d="m7 10 5 5 5-5" />
        </svg>
      );
    case "tree-palm":
      return (
        <svg {...common}>
          <path d="M12 22 C11.5 17 11.5 13 13 9" />
          <path d="M13 9 C10 7 6 8 5 5 C8 3 12 6 13 9" />
          <path d="M13 9 C16 7 20 8 21 5 C18 3 14 6 13 9" />
          <path d="M13 9 C13 6 15 3 18 2 C17 5 15 7 13 9" />
          <path d="M13 9 C13 6 11 3 8 2 C9 5 11 7 13 9" />
        </svg>
      );
    case "beach-umbrella":
      return (
        <svg {...common}>
          <path d="M2 13C2 7.5 6.5 3 12 3s10 4.5 10 10" />
          <path d="M12 3v10" />
          <path d="M6.5 5.5 11 13" />
          <path d="M17.5 5.5 13 13" />
          <path d="M12 13l3.5 8.5" />
        </svg>
      );
    case "sun":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      );
    case "plane":
      return (
        <svg {...common}>
          <path d="M22 16.5 12.5 21 10 17l-7-2.5 2-3 5 1 2.5-5-7-4 1.5-2 9 2 4-4c1-1 2.5-.5 3 .5s0 2.5-1 3l-4 4 2 9-3 1.5z" />
        </svg>
      );
    case "structure":
      return (
        <svg {...common}>
          <rect x="8.5" y="3" width="7" height="4.5" rx="1" />
          <rect x="3" y="16.5" width="6" height="4.5" rx="1" />
          <rect x="15" y="16.5" width="6" height="4.5" rx="1" />
          <path d="M12 7.5v3.5" />
          <path d="M6 16.5v-2.5h12v2.5" />
          <path d="M12 11v3" />
        </svg>
      );
    case "graduation":
      return (
        <svg {...common}>
          <path d="M12 4 2.5 9 12 14l9.5-5L12 4Z" />
          <path d="M6.5 11.2v4.3c0 1 2.5 2.5 5.5 2.5s5.5-1.5 5.5-2.5v-4.3" />
          <path d="M21.5 9v5" />
        </svg>
      );
    case "code":
      return (
        <svg {...common}>
          <path d="m8 9-3 3 3 3" />
          <path d="m16 9 3 3-3 3" />
          <path d="m14 4-4 16" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </svg>
      );
    case "pulse":
      return (
        <svg {...common}>
          <path d="M3 12h4l2.5-6 4.5 12 2.5-6H21" />
        </svg>
      );
    case "planet":
      return (
        <svg {...common}>
          <circle cx="11" cy="12" r="6.5" />
          <ellipse cx="11" cy="12" rx="10.5" ry="3" transform="rotate(-18 11 12)" />
        </svg>
      );
    case "plug":
      return (
        <svg {...common}>
          <path d="M9 3v5" />
          <path d="M15 3v5" />
          <path d="M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0V8Z" />
          <path d="M12 17v4" />
        </svg>
      );
    case "tools":
      return (
        <svg {...common}>
          <path d="M14.7 6.3a4 4 0 0 0-5-5L12 3.6 9.6 6 7.3 3.7a4 4 0 0 0 5 5L20 16.4a2.1 2.1 0 0 1-3 3z" />
          <path d="m5 13-2.7 2.7a2.1 2.1 0 0 0 3 3L8 16" />
        </svg>
      );
    default:
      return null;
  }
}

function SidebarLink({ item, active, collapsed }) {
  const inner = (
    <Box
      component={NavLink}
      to={item.to}
      aria-current={active ? "page" : undefined}
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: collapsed ? "center" : undefined,
        gap: collapsed ? 0 : 1,
        minHeight: 32,
        px: collapsed ? 0 : "6px",
        pr: collapsed ? 0 : 1,
        py: "6px",
        borderRadius: "10px",
        textDecoration: "none",
        whiteSpace: "nowrap",
        overflow: "hidden",
        color: active ? "var(--color-sidebar-active-text)" : "var(--color-sidebar-text)",
        background: active ? "var(--color-sidebar-active-bg)" : "transparent",
        transition: "background 0.15s, color 0.15s",
        "&:hover": {
          background: "var(--color-sidebar-hover-bg)",
          color: "var(--color-sidebar-active-text)",
        },
      }}
    >
      <Box sx={{ width: 20, height: 20, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name={item.icon} />
      </Box>
      {!collapsed && (
        <Box component="span" sx={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14, fontWeight: active ? 700 : 600 }}>
          {item.label}
        </Box>
      )}
    </Box>
  );

  return collapsed ? (
    <Tooltip title={item.label} placement="right" arrow>
      {inner}
    </Tooltip>
  ) : inner;
}

function SidebarNav({ user, collapsed, search }) {
  const location = useLocation();
  const [openGroups, setOpenGroups] = useState({ rendicontazioni: true, impresa: true });

  const visibleSections = useMemo(
    () => SIDEBAR_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (item.requires === "admin") return user?.effective_role === "admin";
        if (item.requires === "hr") return user?.effective_role === "admin" || user?.effective_role === "hr";
        if (item.requires === "planning") return Boolean(user?.can_access_planning);
        if (item.requires === "calendar") return Boolean(user?.can_access_calendar);
        if (item.requires === "organization") return Boolean(user?.can_access_organization);
        if (item.requires === "timesheets") return Boolean(user?.can_access_timesheets);
        if (item.requires === "operationalReporting") return Boolean(
          user?.effective_role === "admin" || (user?.effective_role === "manager" && user?.can_access_timesheets)
        );
        if (item.requires === "workloads") return Boolean(user?.can_access_workloads);
        if (item.requires === "deliveries") return Boolean(user?.can_access_deliveries);
        if (item.requires === "maintenance") return Boolean(user?.can_access_maintenance);
        return true;
      }),
    })).filter((section) => section.items.length > 0),
    [user?.effective_role, user?.can_access_organization, user?.can_access_planning, user?.can_access_calendar, user?.can_access_timesheets, user?.can_access_workloads, user?.can_access_deliveries, user?.can_access_maintenance],
  );

  const displayedSections = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return visibleSections;
    return visibleSections
      .map((section) => ({ ...section, items: section.items.filter((item) => item.label.toLowerCase().includes(q)) }))
      .filter((section) => section.items.length > 0);
  }, [visibleSections, search]);

  const isSearching = search.trim().length > 0;

  return (
    <Box sx={{ flexGrow: 1, overflowY: "auto", overflowX: "hidden", scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } }}>
      {displayedSections.map((section) => {
        const isOpen = isSearching || (section.title ? openGroups[section.key] !== false : true);
        return (
          <Box component="ul" key={section.key} sx={{ listStyle: "none", m: 0, px: collapsed ? 0.75 : 1.5, py: 0 }}>
            {section.title && !collapsed && (
              <Box component="li" sx={{ mt: 2.5, mb: 0.75 }}>
                <Button
                  onClick={() => setOpenGroups((current) => ({ ...current, [section.key]: !current[section.key] }))}
                  sx={{
                    width: "100%",
                    minWidth: 0,
                    px: 0.5,
                    py: 0.25,
                    justifyContent: "flex-start",
                    gap: 0.5,
                    borderRadius: "6px",
                    color: "var(--color-sidebar-text-muted)",
                    fontSize: 12,
                    fontWeight: 500,
                    textTransform: "none",
                    "&:hover": { background: "var(--color-sidebar-hover-bg)" },
                  }}
                >
                  <Box component="span">{section.title}</Box>
                  <Box sx={{ width: 12, height: 12, color: "var(--color-sidebar-text-muted)", display: "inline-flex", alignItems: "center", justifyContent: "center", transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s" }}>
                    <Icon name="chevron-down" size={12} stroke={2.1} />
                  </Box>
                </Button>
              </Box>
            )}
            {collapsed && section.title && <Box sx={{ my: 0.75, mx: 0.5, height: 1, bgcolor: "var(--color-sidebar-separator)" }} />}

            {isOpen && section.items.map((item) => {
              const active = item.to === "/" || item.exact
                ? location.pathname === item.to
                : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
              return (
                <Box component="li" key={item.to} sx={{ mt: 0.25 }}>
                  <SidebarLink item={item} active={active} collapsed={collapsed} />
                </Box>
              );
            })}
          </Box>
        );
      })}
    </Box>
  );
}

function ProtectedLayout() {
  const { logout, user, effectiveUser, isImpersonating, stopImpersonation, startImpersonation } = useAuth();
  const { darkMode, setDarkMode } = useAppTheme();
  const timesheetsOnly = Boolean(effectiveUser?.can_access_timesheets && !effectiveUser?.can_access_planning && !effectiveUser?.can_access_calendar && !effectiveUser?.can_access_organization);
  const canAccessOperationalReporting = Boolean(
    effectiveUser?.effective_role === "admin"
    || (effectiveUser?.effective_role === "manager" && effectiveUser?.can_access_timesheets)
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarSearch, setSidebarSearch] = useState("");

  const sidebarWidth = sidebarCollapsed ? 56 : 240;

  useEffect(() => {
    if (canAccessOperationalReporting) {
      loadOperationalReportingPage();
    }
  }, [canAccessOperationalReporting]);

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      {isImpersonating && (
        <Alert
          severity="warning"
          sx={{ borderRadius: 0, py: 0.5, "& .MuiAlert-message": { display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", flexWrap: "wrap", gap: 1 } }}
          icon={false}
        >
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ width: "100%" }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
              Visualizzazione come: <strong>{effectiveUser?.linked_employee_name}</strong>
              {effectiveUser?.effective_role && (
                <Typography component="span" sx={{ fontSize: 12, ml: 1, fontWeight: 400, opacity: 0.8 }}>
                  ({effectiveUser.effective_role})
                </Typography>
              )}
              <Typography component="span" sx={{ fontSize: 12, ml: 1, fontWeight: 400, opacity: 0.8 }}>
                · Scadenze: {effectiveUser?.expirations_scope === "all"
                  ? "tutte"
                  : effectiveUser?.expirations_scope === "reports"
                    ? "solo riporti"
                    : "nessuna"}
              </Typography>
            </Typography>
            <Button size="small" variant="outlined" color="warning" onClick={stopImpersonation} sx={{ fontWeight: 700, textTransform: "none", fontSize: 12 }}>
              Esci dalla visualizzazione
            </Button>
          </Stack>
        </Alert>
      )}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: `${sidebarWidth}px minmax(0, 1fr)` }, minHeight: "100vh" }}>
        <Box
          component="aside"
          sx={{
            display: { xs: "none", lg: "flex" },
            flexDirection: "column",
            width: sidebarWidth,
            minWidth: sidebarWidth,
            height: "100vh",
            bgcolor: "var(--color-sidebar-bg)",
            color: "var(--color-sidebar-text)",
            borderRight: "1px solid var(--color-sidebar-border)",
            position: "sticky",
            top: 0,
            transition: "width 0.2s, min-width 0.2s",
            overflow: "hidden",
          }}
        >
          {/* Verde Tonoli top accent */}
          <Box sx={{ height: 4, bgcolor: "#007040", flexShrink: 0 }} />

          <Box sx={{ flexShrink: 0 }}>
            <Box sx={{ height: 56, display: "flex", alignItems: "center", justifyContent: sidebarCollapsed ? "center" : "space-between", gap: 1.5, px: sidebarCollapsed ? 0 : 1.5 }}>
              {!sidebarCollapsed && (
                <Button
                  sx={{
                    minWidth: 0,
                    flex: 1,
                    justifyContent: "flex-start",
                    gap: 1,
                    px: 0.75,
                    py: 0.75,
                    borderRadius: "10px",
                    color: "var(--color-sidebar-text)",
                    textTransform: "none",
                    "&:hover": { background: "var(--color-sidebar-hover-bg)" },
                  }}
                >
                  <THubLogo size={28} />
                </Button>
              )}
              <Tooltip title={sidebarCollapsed ? "Espandi menu" : "Comprimi menu"} placement="right">
                <Button
                  onClick={() => { setSidebarCollapsed((v) => !v); setSidebarSearch(""); }}
                  sx={{
                    minWidth: 0,
                    width: 32,
                    height: 32,
                    borderRadius: "10px",
                    color: "var(--color-sidebar-text-muted)",
                    "&:hover": { background: "var(--color-sidebar-hover-bg)" },
                  }}
                >
                  <Icon name="panel" size={18} stroke={1.9} />
                </Button>
              </Tooltip>
            </Box>

            {!sidebarCollapsed && (
              <Box sx={{ height: 43, px: 1.5, display: "flex", alignItems: "center" }}>
                <Box
                  sx={{
                    width: "100%",
                    height: 38,
                    px: 1.25,
                    borderRadius: "14px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    bgcolor: "var(--color-sidebar-search-bg)",
                    boxShadow: "var(--color-sidebar-search-shadow)",
                    "&:focus-within": { boxShadow: "var(--color-sidebar-search-shadow-focus)" },
                  }}
                >
                  <Stack direction="row" alignItems="center" spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ color: "var(--color-sidebar-text-muted)", width: 18, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Icon name="search" size={18} stroke={2} />
                    </Box>
                    <InputBase
                      value={sidebarSearch}
                      onChange={(e) => setSidebarSearch(e.target.value)}
                      placeholder="Cerca..."
                      inputProps={{ "aria-label": "Cerca nel menu" }}
                      sx={{ fontSize: 14, flex: 1, color: "var(--color-sidebar-text)", "& input::placeholder": { color: "var(--color-sidebar-text-muted)", opacity: 1 } }}
                    />
                  </Stack>
                  {sidebarSearch && (
                    <Button
                      onClick={() => setSidebarSearch("")}
                      sx={{ minWidth: 0, width: 20, height: 20, p: 0, borderRadius: "6px", color: "var(--color-sidebar-text-muted)", fontSize: 14, lineHeight: 1 }}
                    >
                      ✕
                    </Button>
                  )}
                </Box>
              </Box>
            )}
          </Box>

          <SidebarNav user={effectiveUser} collapsed={sidebarCollapsed} search={sidebarSearch} />

          <Box sx={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: sidebarCollapsed ? "center" : "space-between", px: sidebarCollapsed ? 0 : 1.5, py: 1, borderTop: "1px solid var(--color-sidebar-border)", bgcolor: "var(--color-sidebar-footer-bg)", gap: 0.5 }}>
            {sidebarCollapsed ? (
              <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.5 }}>
                <Tooltip title={user?.display_name || user?.username} placement="right">
                  <Button
                    onClick={logout}
                    sx={{ minWidth: 0, width: 32, height: 32, p: 0, borderRadius: "10px", "&:hover": { background: "var(--color-sidebar-hover-bg)" } }}
                  >
                    <Box sx={{ width: 24, height: 24, borderRadius: 9999, background: "linear-gradient(135deg, #b8d8c8, #6a9e7f)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>
                      {(user?.display_name || user?.username || "U").trim().charAt(0).toUpperCase()}
                    </Box>
                  </Button>
                </Tooltip>
                <Tooltip title={darkMode ? "Tema chiaro" : "Tema scuro"} placement="right">
                  <Button
                    onClick={() => setDarkMode((d) => !d)}
                    sx={{ minWidth: 0, width: 32, height: 32, borderRadius: "10px", color: darkMode ? "#f5c870" : "var(--color-sidebar-text-muted)", "&:hover": { background: "var(--color-sidebar-hover-bg)" } }}
                  >
                    {darkMode
                      ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
                      : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                    }
                  </Button>
                </Tooltip>
                <NotificationsBell tooltipPlacement="right" />
              </Box>
            ) : (
              <>
                <Button
                  onClick={logout}
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    px: 0.75,
                    py: 0.75,
                    justifyContent: "flex-start",
                    gap: 0.75,
                    borderRadius: "10px",
                    color: "var(--color-sidebar-text)",
                    textTransform: "none",
                    "&:hover": { background: "var(--color-sidebar-hover-bg)" },
                  }}
                >
                  <Box sx={{ width: 24, height: 24, borderRadius: 9999, background: "linear-gradient(135deg, #b8d8c8, #6a9e7f)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                    {(user?.display_name || user?.username || "U").trim().charAt(0).toUpperCase()}
                  </Box>
                  <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14, fontWeight: 500 }}>
                    {user?.display_name || user?.username}
                  </Box>
                </Button>

                <Tooltip title={darkMode ? "Tema chiaro" : "Tema scuro"} placement="top">
                  <Button
                    onClick={() => setDarkMode((d) => !d)}
                    sx={{ minWidth: 0, width: 32, height: 32, borderRadius: "10px", color: darkMode ? "#f5c870" : "var(--color-sidebar-text-muted)", "&:hover": { background: "var(--color-sidebar-hover-bg)" } }}
                  >
                    {darkMode
                      ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
                      : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                    }
                  </Button>
                </Tooltip>

                <NotificationsBell />
              </>
            )}
          </Box>
        </Box>

        <Box sx={{ minWidth: 0, px: { xs: 2, md: 3 }, py: { xs: 2, md: 3 } }}>
          <Container maxWidth={false} disableGutters>
            <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={timesheetsOnly ? <Navigate to="/rendicontazioni/dashboard" replace /> : <DashboardPage />} />
              <Route path="/organigramma" element={effectiveUser?.can_access_organization ? <OrgChartPage /> : <Navigate to="/" replace />} />
              <Route path="/dipendenti" element={effectiveUser?.can_access_organization ? <EmployeesPage onImpersonate={effectiveUser?.effective_role === "admin" ? startImpersonation : undefined} /> : <Navigate to="/" replace />} />
              <Route path="/consegne" element={effectiveUser?.can_access_deliveries ? <ConsegnePage /> : <Navigate to="/" replace />} />
              <Route path="/manutenzioni" element={effectiveUser?.can_access_maintenance ? <MaintenancePage /> : <Navigate to="/" replace />} />
              {/* Firma consegna dispositivo: accessibile a ogni utente autenticato,
                  il backend verifica che la consegna appartenga al dipendente collegato. */}
              <Route path="/le-mie-consegne/:deliveryId/firma" element={<DeliverySignaturePage />} />
              <Route path="/dipendenti-ldap" element={effectiveUser?.can_access_organization ? <LdapEmployeesPage /> : <Navigate to="/" replace />} />
              <Route path="/commesse" element={effectiveUser?.can_access_organization ? <ProjectsPage /> : <Navigate to="/" replace />} />
              <Route path="/aree-operative" element={effectiveUser?.can_access_organization ? <OperationalAreasPage /> : <Navigate to="/" replace />} />
              <Route path="/formazione" element={(effectiveUser?.effective_role === "admin" || effectiveUser?.effective_role === "hr") ? <TrainingConfigPage /> : <Navigate to="/" replace />} />
              <Route path="/funzioni-dipartimenti" element={effectiveUser?.can_access_organization ? <FunctionsDepartmentsPage /> : <Navigate to="/" replace />} />
              <Route path="/planner" element={effectiveUser?.can_access_planning ? <PlannerPage /> : <Navigate to="/" replace />} />
              <Route path="/carichi" element={effectiveUser?.can_access_workloads ? <WorkloadPage /> : <Navigate to="/" replace />} />
              <Route path="/squadre" element={effectiveUser?.can_access_organization ? <SquadrePage /> : <Navigate to="/" replace />} />
              <Route path="/calendario" element={effectiveUser?.can_access_calendar ? <CalendarPage /> : <Navigate to="/" replace />} />
              <Route path="/modifiche-tool" element={effectiveUser?.can_access_organization ? <ToolChangesPage /> : <Navigate to="/" replace />} />
              <Route path="/rendicontazioni/dashboard" element={effectiveUser?.can_access_timesheets ? <ActivityDashboardPage /> : <Navigate to="/" replace />} />
              <Route path="/rendicontazioni/elenco" element={effectiveUser?.can_access_timesheets ? <ActivityListPage /> : <Navigate to="/" replace />} />
              <Route path="/rendicontazioni/presenze" element={effectiveUser?.can_access_timesheets ? <DailyRecordsPage /> : <Navigate to="/" replace />} />
              <Route path="/rendicontazioni/timer-attivi" element={effectiveUser?.can_access_timesheets ? <ActiveActivitiesPage /> : <Navigate to="/" replace />} />
              <Route
                path="/rendicontazioni/operativa"
                element={canAccessOperationalReporting ? <OperationalReportingPage /> : <Navigate to="/" replace />}
              />
              <Route
                path="/rendicontazioni/operativa/dashboard"
                element={canAccessOperationalReporting ? <OperationalReportingDashboardPage /> : <Navigate to="/" replace />}
              />
              <Route path="/endpoints" element={effectiveUser?.effective_role === "admin" ? <EndpointsPage /> : <Navigate to="/" replace />} />
              <Route path="/audit" element={effectiveUser?.effective_role === "admin" ? <AuditLogPage /> : <Navigate to="/" replace />} />
              <Route path="/stato-sistema" element={effectiveUser?.effective_role === "admin" ? <SystemStatusPage /> : <Navigate to="/" replace />} />
              <Route path="/integrazioni" element={effectiveUser?.effective_role === "admin" ? <IntegrationsPage /> : <Navigate to="/" replace />} />
            </Routes>
            </Suspense>
            </ErrorBoundary>
          </Container>
        </Box>
      </Box>
    </Box>
  );
}

export default function App() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <CircularProgress sx={{ color: "#007040" }} />
      </Box>
    );
  }

  // Dopo il login si torna alla pagina richiesta in origine (es. il link di
  // firma consegna ricevuto via email), non alla home.
  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to={location.state?.from || "/"} replace /> : <LoginPage />} />
      <Route
        path="/*"
        element={
          isAuthenticated
            ? <ProtectedLayout />
            : <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
        }
      />
    </Routes>
  );
}
