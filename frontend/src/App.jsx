import { useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Alert, Box, Button, CircularProgress, Container, Divider, InputBase, Popover, Stack, Tooltip, Typography } from "@mui/material";

import { useAuth } from "./auth";
import { useAppTheme } from "./ThemeContext";
import DashboardPage from "./pages/DashboardPage";
import CalendarPage from "./pages/CalendarPage";
import EmployeesPage from "./pages/EmployeesPage";
import FunctionsDepartmentsPage from "./pages/FunctionsDepartmentsPage";
import LdapEmployeesPage from "./pages/LdapEmployeesPage";
import LoginPage from "./pages/LoginPage";
import OrgChartPage from "./pages/OrgChartPage";
import OperationalAreasPage from "./pages/OperationalAreasPage";
import PlannerPage from "./pages/PlannerPage";
import ProjectsPage from "./pages/ProjectsPage";
import SquadrePage from "./pages/SquadrePage";
import TimesheetAdminPage from "./pages/TimesheetAdminPage";
import TimesheetDashboardPage from "./pages/TimesheetDashboardPage";
import TimesheetDetailPage from "./pages/TimesheetDetailPage";
import TimesheetListPage from "./pages/TimesheetListPage";
import ToolChangesPage from "./pages/ToolChangesPage";

const SIDEBAR_SECTIONS = [
  {
    key: "quick",
    title: null,
    items: [
      { to: "/", label: "Home", icon: "home" },
      { to: "/planner", label: "Planner", icon: "briefcase", requires: "planning" },
      { to: "/calendario", label: "Assenze", icon: "sun", requires: "calendar" },
    ],
  },
  {
    key: "rendicontazioni",
    title: "Rendicontazioni",
    items: [
      { to: "/rendicontazioni/dashboard", label: "Dashboard", icon: "receipt", requires: "timesheets" },
      { to: "/rendicontazioni/elenco", label: "Giornate", icon: "document", requires: "timesheets" },
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
      { to: "/organigramma", label: "Organigramma", icon: "orgchart", requires: "planning" },
      { to: "/funzioni-dipartimenti", label: "Funzione / Dipartimento", icon: "structure", requires: "organization" },
    ],
  },
  {
    key: "configurazione",
    title: "Configurazione",
    items: [
      { to: "/dipendenti-ldap", label: "Mapping LDAP", icon: "folder", requires: "admin" },
      { to: "/rendicontazioni/admin", label: "Mapping AWS", icon: "checklist", requires: "admin" },
      { to: "/commesse", label: "Commesse", icon: "briefcase", requires: "admin" },
      { to: "/aree-operative", label: "Aree operative", icon: "document", requires: "admin" },
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
    case "bell":
      return (
        <svg {...common}>
          <path d="M6.5 16.5h11l-1.4-2.2a4.2 4.2 0 0 1-.6-2.2V10a3.5 3.5 0 1 0-7 0v2.1a4.2 4.2 0 0 1-.6 2.2z" />
          <path d="M10 18.5a2.2 2.2 0 0 0 4 0" />
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
        if (item.requires === "planning") return Boolean(user?.can_access_planning);
        if (item.requires === "calendar") return Boolean(user?.can_access_calendar);
        if (item.requires === "organization") return Boolean(user?.can_access_organization);
        if (item.requires === "timesheets") return Boolean(user?.can_access_timesheets);
        return true;
      }),
    })).filter((section) => section.items.length > 0),
    [user?.effective_role, user?.can_access_organization, user?.can_access_planning, user?.can_access_calendar, user?.can_access_timesheets],
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
              const active = item.to === "/"
                ? location.pathname === "/"
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [bellAnchorEl, setBellAnchorEl] = useState(null);

  const sidebarWidth = sidebarCollapsed ? 56 : 240;

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

                <Tooltip title="Notifiche" placement="top">
                  <Button
                    onClick={(e) => setBellAnchorEl(e.currentTarget)}
                    sx={{ minWidth: 0, width: 32, height: 32, borderRadius: "10px", color: "var(--color-sidebar-text-muted)", "&:hover": { background: "var(--color-sidebar-hover-bg)" } }}
                  >
                    <Icon name="bell" size={18} stroke={1.95} />
                  </Button>
                </Tooltip>
                <Popover
                  open={Boolean(bellAnchorEl)}
                  anchorEl={bellAnchorEl}
                  onClose={() => setBellAnchorEl(null)}
                  anchorOrigin={{ vertical: "top", horizontal: "right" }}
                  transformOrigin={{ vertical: "bottom", horizontal: "right" }}
                  slotProps={{ paper: { sx: { borderRadius: "14px", boxShadow: "0 4px 24px rgba(0,0,0,0.10)", width: 280 } } }}
                >
                  <Box sx={{ px: 2, pt: 2, pb: 1.5 }}>
                    <Typography fontWeight={700} fontSize={15}>Notifiche</Typography>
                  </Box>
                  <Divider />
                  <Box sx={{ px: 2, py: 3, textAlign: "center" }}>
                    <Typography fontSize={14} color="text.secondary">Nessuna notifica al momento</Typography>
                  </Box>
                </Popover>
              </>
            )}
          </Box>
        </Box>

        <Box sx={{ minWidth: 0, px: { xs: 2, md: 3 }, py: { xs: 2, md: 3 } }}>
          <Container maxWidth={false} disableGutters>
            <Routes>
              <Route path="/" element={timesheetsOnly ? <Navigate to="/rendicontazioni/dashboard" replace /> : <DashboardPage />} />
              <Route path="/organigramma" element={<OrgChartPage />} />
              <Route path="/dipendenti" element={user?.can_access_organization ? <EmployeesPage onImpersonate={startImpersonation} /> : <Navigate to="/" replace />} />
              <Route path="/dipendenti-ldap" element={effectiveUser?.can_access_organization ? <LdapEmployeesPage /> : <Navigate to="/" replace />} />
              <Route path="/commesse" element={effectiveUser?.can_access_organization ? <ProjectsPage /> : <Navigate to="/" replace />} />
              <Route path="/aree-operative" element={effectiveUser?.can_access_organization ? <OperationalAreasPage /> : <Navigate to="/" replace />} />
              <Route path="/funzioni-dipartimenti" element={effectiveUser?.can_access_organization ? <FunctionsDepartmentsPage /> : <Navigate to="/" replace />} />
              <Route path="/planner" element={effectiveUser?.can_access_planning ? <PlannerPage /> : <Navigate to="/" replace />} />
              <Route path="/squadre" element={effectiveUser?.can_access_organization ? <SquadrePage /> : <Navigate to="/" replace />} />
              <Route path="/calendario" element={effectiveUser?.can_access_calendar ? <CalendarPage /> : <Navigate to="/" replace />} />
              <Route path="/modifiche-tool" element={<ToolChangesPage />} />
              <Route path="/rendicontazioni/dashboard" element={effectiveUser?.can_access_timesheets ? <TimesheetDashboardPage /> : <Navigate to="/" replace />} />
              <Route path="/rendicontazioni/elenco" element={effectiveUser?.can_access_timesheets ? <TimesheetListPage /> : <Navigate to="/" replace />} />
              <Route path="/rendicontazioni/giorni/:dayId" element={effectiveUser?.can_access_timesheets ? <TimesheetDetailPage /> : <Navigate to="/" replace />} />
              <Route path="/rendicontazioni/admin" element={effectiveUser?.can_access_timesheets ? <TimesheetAdminPage /> : <Navigate to="/" replace />} />
            </Routes>
          </Container>
        </Box>
      </Box>
    </Box>
  );
}

export default function App() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <CircularProgress sx={{ color: "#007040" }} />
      </Box>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/*" element={isAuthenticated ? <ProtectedLayout /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}
