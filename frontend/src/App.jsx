import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Alert, Box, Button, CircularProgress, Container, InputBase, Stack, Tooltip, Typography } from "@mui/material";

import { useAuth } from "./auth";
import { useAppTheme } from "./ThemeContext";
import ErrorBoundary from "./ErrorBoundary";
import LoginPage from "./pages/LoginPage";
import NotificationsBell from "./NotificationsBell";
import { Icon } from "./components/Icon";
import { getMaintenanceAssetFamilies } from "./maintenanceAssetsApi";

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
const MaintenanceDashboardPage = lazy(() => import("./pages/MaintenanceDashboardPage"));
const MaintenanceAssetsPage = lazy(() => import("./pages/MaintenanceAssetsPage"));
const MaintenanceAssetDetailPage = lazy(() => import("./pages/MaintenanceAssetDetailPage"));
const MaintenanceDeadlinesPage = lazy(() => import("./pages/MaintenanceDeadlinesPage"));
const MaintenanceAssetTypesAdminPage = lazy(() => import("./pages/MaintenanceAssetTypesAdminPage"));
const MaintenanceNotificationRulesPage = lazy(() => import("./pages/MaintenanceNotificationRulesPage"));
const MaintenanceAssetPublicPage = lazy(() => import("./pages/MaintenanceAssetPublicPage"));

function PageLoader() {
  return (
    <Box sx={{ minHeight: "40vh", display: "grid", placeItems: "center" }}>
      <CircularProgress sx={{ color: "#007040" }} />
    </Box>
  );
}

// Ogni sezione appartiene a uno dei due macro-moduli scelti in ModuleChooserPage
// (vedi ProtectedLayout): "thub" per l'operatività quotidiana, "maintenance" per
// il modulo Manutenzioni. SidebarNav filtra anche per questo campo, oltre che per
// i permessi già esistenti in `requires:`.
const SIDEBAR_SECTIONS = [
  {
    key: "quick",
    title: null,
    module: "thub",
    items: [
      { to: "/", label: "Home", icon: "home" },
      { to: "/planner", label: "Planner", icon: "briefcase", requires: "planning" },
      { to: "/carichi", label: "Carichi", icon: "document", requires: "workloads" },
      { to: "/calendario", label: "Assenze", icon: "sun", requires: "calendar" },
    ],
  },
  {
    key: "consegne",
    title: "Dotazioni",
    module: "deliveries",
    items: [
      { to: "/dotazioni", label: "Dotazioni", icon: "box", requires: "deliveries" },
    ],
  },
  {
    // I sottogruppi famiglia sono iniettati dinamicamente da SidebarNav, una
    // cartella per famiglia configurata in Manutenzioni · Famiglie/classi
    // (vedi MaintenanceAssetTypesAdminPage), ciascuna con le sue classi come
    // voci. Vuoto qui = nessuna famiglia ancora configurata: la sezione
    // mostra comunque Dashboard, Scadenze e Questionario.
    key: "manutenzioni",
    title: "Manutenzioni",
    module: "maintenance",
    // items compare prima dei sottogruppi famiglia (iniettati da SidebarNav),
    // trailingItems dopo: l'ordine richiesto è Dashboard, [famiglie], Scadenze,
    // Questionario.
    items: [
      { to: "/manutenzioni", label: "Dashboard", icon: "panel", requires: "maintenance", exact: true },
    ],
    trailingItems: [
      { to: "/manutenzioni/scadenze", label: "Scadenze", icon: "checklist", requires: "maintenance" },
      { to: "/manutenzioni/questionario", label: "Questionario", icon: "document", requires: "maintenance" },
      { to: "/manutenzioni/categorie", label: "Manutenzioni classificazione", icon: "tools", requires: "admin" },
      { to: "/manutenzioni/notifiche", label: "Manutenzioni · Notifiche", icon: "receipt", requires: "admin" },
    ],
  },
  {
    key: "rendicontazioni",
    title: "Rendicontazioni",
    module: "reporting",
    items: [
      { to: "/commesse", label: "Jupiter", icon: "planet", requires: "organization" },
      { to: "/rendicontazioni/operativa/dashboard", label: "Dashboard operativa", icon: "panel", requires: "operationalReporting" },
      { to: "/rendicontazioni/operativa", label: "Operativa", icon: "clock", requires: "operationalReporting", exact: true },
    ],
  },
  {
    key: "strumenti",
    title: "Strumenti",
    module: "thub",
    items: [
      { to: "/modifiche-tool", label: "Modifiche tool", icon: "checklist", requires: "organization" },
    ],
  },
  {
    key: "impresa",
    title: "Impresa",
    module: "thub",
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
    module: "thub",
    items: [
      { to: "/dipendenti-ldap", label: "Mapping LDAP", icon: "folder", requires: "organization" },
      { to: "/aree-operative", label: "Aree operative", icon: "document", requires: "organization" },
      { to: "/formazione", label: "Formazione", icon: "graduation", requires: "hr" },
      { to: "/integrazioni", label: "Integrazioni", icon: "plug", requires: "admin" },
      { to: "/endpoints", label: "Endpoint API", icon: "code", requires: "admin" },
      { to: "/audit", label: "Audit", icon: "checklist", requires: "admin" },
      { to: "/stato-sistema", label: "Stato sistema", icon: "pulse", requires: "admin" },
    ],
  },
];

// Etichetta del modulo mostrata accanto al logo in sidebar quando è attivo
// (vedi ProtectedLayout) e come titolo dei box in ModuleChooserPage.
const MODULE_LABELS = {
  thub: "Risorse",
  maintenance: "Manutenzioni",
  deliveries: "Dotazioni",
  reporting: "Rendicontazioni",
};

function THubLogo({ size = 28, suffix }) {
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: "0.38em", lineHeight: 1, minWidth: 0 }}>
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
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        T<Box component="span" sx={{ color: "var(--color-accent)" }}>-</Box>Hub
        {suffix && <Box component="span" sx={{ fontWeight: 500 }}> {suffix}</Box>}
      </Box>
    </Box>
  );
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

function SidebarNav({ user, collapsed, search, activeModule }) {
  const location = useLocation();
  const [openGroups, setOpenGroups] = useState({ rendicontazioni: true, impresa: true });

  const assetFamiliesQuery = useQuery({
    queryKey: ["maintenance-asset-families"],
    queryFn: getMaintenanceAssetFamilies,
    enabled: Boolean(user?.can_access_maintenance),
    staleTime: 60000,
  });

  const sectionsWithAssetCategories = useMemo(() => {
    // Una sotto-cartella per famiglia, con le sue classi come voci — vera
    // alberatura a tre livelli (Manutenzioni > Famiglia > Classe), non un
    // elenco piatto: con più famiglie serve vederle distinte nel menu.
    const familySubGroups = (assetFamiliesQuery.data ?? []).map((assetFamily) => ({
      key: `manutenzioni-family-${assetFamily.id}`,
      title: assetFamily.label,
      icon: assetFamily.icon || "box",
      items: (assetFamily.classes ?? []).map((assetClass) => ({
        to: `/manutenzioni/asset/${assetClass.code}`,
        label: assetClass.label,
        icon: assetClass.icon || "tools",
        requires: "maintenance",
      })),
    }));
    return SIDEBAR_SECTIONS.map((section) =>
      section.key === "manutenzioni" ? { ...section, items: [...section.items], subGroups: familySubGroups } : section
    );
  }, [assetFamiliesQuery.data]);

  const itemAllowed = (item) => {
    if (item.requires === "admin") return user?.effective_role === "admin";
    if (item.requires === "hr") return user?.effective_role === "admin" || user?.effective_role === "hr";
    if (item.requires === "planning") return Boolean(user?.can_access_planning);
    if (item.requires === "calendar") return Boolean(user?.can_access_calendar);
    if (item.requires === "organization") return Boolean(user?.can_access_organization);
    if (item.requires === "timesheets") return Boolean(user?.can_access_timesheets);
    if (item.requires === "operationalReporting") return Boolean(user?.can_access_operational_reporting);
    if (item.requires === "workloads") return Boolean(user?.can_access_workloads);
    if (item.requires === "deliveries") return Boolean(user?.can_access_deliveries);
    if (item.requires === "maintenance") return Boolean(user?.can_access_maintenance);
    return true;
  };

  const visibleSections = useMemo(
    () => sectionsWithAssetCategories
      .filter((section) => !activeModule || section.module === activeModule)
      .map((section) => ({
        ...section,
        items: section.items.filter(itemAllowed),
        trailingItems: (section.trailingItems ?? []).filter(itemAllowed),
        subGroups: (section.subGroups ?? [])
          .map((subGroup) => ({ ...subGroup, items: subGroup.items.filter(itemAllowed) }))
          .filter((subGroup) => subGroup.items.length > 0),
      })).filter(
        (section) => section.items.length > 0 || section.trailingItems.length > 0 || (section.subGroups ?? []).length > 0,
      ),
    [sectionsWithAssetCategories, activeModule, user?.effective_role, user?.can_access_organization, user?.can_access_planning, user?.can_access_calendar, user?.can_access_timesheets, user?.can_access_operational_reporting, user?.can_access_workloads, user?.can_access_deliveries, user?.can_access_maintenance],
  );

  const displayedSections = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return visibleSections;
    return visibleSections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => item.label.toLowerCase().includes(q)),
        trailingItems: (section.trailingItems ?? []).filter((item) => item.label.toLowerCase().includes(q)),
        subGroups: (section.subGroups ?? [])
          .map((subGroup) => ({ ...subGroup, items: subGroup.items.filter((item) => item.label.toLowerCase().includes(q)) }))
          .filter((subGroup) => subGroup.items.length > 0),
      }))
      .filter(
        (section) => section.items.length > 0 || section.trailingItems.length > 0 || (section.subGroups ?? []).length > 0,
      );
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

            {isOpen && (section.subGroups ?? []).map((subGroup) => {
              const subOpen = isSearching || openGroups[subGroup.key] !== false;
              return (
                <Box component="li" key={subGroup.key} sx={{ mt: 0.5 }}>
                  {!collapsed && (
                    <Button
                      onClick={() => setOpenGroups((current) => ({ ...current, [subGroup.key]: !current[subGroup.key] }))}
                      sx={{
                        width: "100%",
                        minWidth: 0,
                        px: 0.75,
                        py: 0.4,
                        justifyContent: "flex-start",
                        gap: 0.75,
                        borderRadius: "6px",
                        color: "var(--color-sidebar-text)",
                        fontSize: 13,
                        fontWeight: 600,
                        textTransform: "none",
                        "&:hover": { background: "var(--color-sidebar-hover-bg)" },
                      }}
                    >
                      <Box sx={{ width: 18, height: 18, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                        <Icon name={subGroup.icon} size={16} />
                      </Box>
                      <Box component="span" sx={{ flex: 1, textAlign: "left" }}>{subGroup.title}</Box>
                      <Box sx={{ width: 12, height: 12, color: "var(--color-sidebar-text-muted)", display: "inline-flex", alignItems: "center", justifyContent: "center", transform: subOpen ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s" }}>
                        <Icon name="chevron-down" size={12} stroke={2.1} />
                      </Box>
                    </Button>
                  )}
                  {subOpen && (
                    <Box component="ul" sx={{ listStyle: "none", m: 0, pl: collapsed ? 0 : 1.5 }}>
                      {subGroup.items.map((item) => {
                        const active = location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
                        return (
                          <Box component="li" key={item.to} sx={{ mt: 0.25 }}>
                            <SidebarLink item={item} active={active} collapsed={collapsed} />
                          </Box>
                        );
                      })}
                    </Box>
                  )}
                </Box>
              );
            })}

            {isOpen && (section.trailingItems ?? []).map((item) => {
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

// Chiave localStorage per ricordare il modulo scelto tra una sessione e l'altra
// dello stesso browser (vedi ProtectedLayout).
const MODULE_STORAGE_KEY = "thub.activeModule";

function moduleForPath(pathname) {
  if (pathname.startsWith("/manutenzioni")) return "maintenance";
  if (pathname.startsWith("/dotazioni")) return "deliveries";
  if (pathname.startsWith("/commesse") || pathname.startsWith("/rendicontazioni/operativa")) return "reporting";
  return "thub";
}

function ModuleBox({ icon, title, description, onClick, accent }) {
  return (
    <Box
      component="button"
      onClick={onClick}
      sx={{
        width: 280,
        maxWidth: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 1.5,
        p: 3,
        border: "1px solid var(--color-sidebar-border)",
        borderRadius: "18px",
        bgcolor: "background.paper",
        cursor: "pointer",
        textAlign: "left",
        font: "inherit",
        transition: "transform 0.15s, box-shadow 0.15s, border-color 0.15s",
        "&:hover": {
          transform: "translateY(-2px)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
          borderColor: accent,
        },
      }}
    >
      <Box sx={{ width: 48, height: 48, borderRadius: "12px", bgcolor: accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={24} />
      </Box>
      <Typography sx={{ fontSize: 18, fontWeight: 700, color: "text.primary" }}>{title}</Typography>
      <Typography sx={{ fontSize: 13, color: "text.secondary" }}>{description}</Typography>
    </Box>
  );
}

function ModuleChooserPage({ canAccessMaintenance, canAccessDeliveries, canAccessReporting, onSelect, onLogout }) {
  return (
    <Box sx={{ minHeight: "80vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, px: 2 }}>
      <Box sx={{ textAlign: "center" }}>
        <THubLogo size={40} />
        <Typography sx={{ mt: 1.5, fontSize: 14, color: "text.secondary" }}>
          Scegli l'area in cui vuoi entrare
        </Typography>
      </Box>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2.5}>
        <ModuleBox
          icon="home"
          title="T-Hub Risorse"
          description="Planner, carichi, assenze e anagrafica."
          accent="#007040"
          onClick={() => onSelect("thub")}
        />
        {canAccessMaintenance && (
          <ModuleBox
            icon="tools"
            title="T-Hub Manutenzioni"
            description="Asset, scadenze, documenti e questionario di manutenzione."
            accent="#8a5a00"
            onClick={() => onSelect("maintenance")}
          />
        )}
        {canAccessDeliveries && (
          <ModuleBox
            icon="box"
            title="T-Hub Dotazioni"
            description="Dotazioni di dispositivi e DPI ai dipendenti."
            accent="#0a5f8a"
            onClick={() => onSelect("deliveries")}
          />
        )}
        {canAccessReporting && (
          <ModuleBox
            icon="clock"
            title="T-Hub Rendicontazioni"
            description="Commesse Jupiter e rendicontazione operativa."
            accent="#6a3d9a"
            onClick={() => onSelect("reporting")}
          />
        )}
      </Stack>
      <Button onClick={onLogout} sx={{ textTransform: "none", color: "text.secondary", fontSize: 13 }}>
        Esci
      </Button>
    </Box>
  );
}

function ProtectedLayout() {
  const { logout, user, effectiveUser, isImpersonating, stopImpersonation, startImpersonation } = useAuth();
  const { darkMode, setDarkMode } = useAppTheme();
  const timesheetsOnly = Boolean(effectiveUser?.can_access_timesheets && !effectiveUser?.can_access_planning && !effectiveUser?.can_access_calendar && !effectiveUser?.can_access_organization);
  const canAccessOperationalReporting = Boolean(effectiveUser?.can_access_operational_reporting);
  const canAccessMaintenance = Boolean(effectiveUser?.can_access_maintenance);
  const canAccessDeliveries = Boolean(effectiveUser?.can_access_deliveries);
  const canAccessReporting = Boolean(effectiveUser?.can_access_organization || canAccessOperationalReporting);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const location = useLocation();
  const navigate = useNavigate();

  const [activeModule, setActiveModuleState] = useState(() => {
    try {
      // Sulla home nuda non si riapre mai il modulo ricordato dalla sessione
      // precedente: chi arriva su "/" deve sempre vedere la scelta dei moduli.
      // Il ricordo in localStorage resta valido solo per i link diretti a una
      // pagina di un modulo (vedi l'effect sotto, basato su moduleForPath).
      if (window.location.pathname === "/") return null;
      return localStorage.getItem(MODULE_STORAGE_KEY);
    } catch {
      return null;
    }
  });

  const setActiveModule = (nextModule) => {
    setActiveModuleState(nextModule);
    try {
      if (nextModule) localStorage.setItem(MODULE_STORAGE_KEY, nextModule);
      else localStorage.removeItem(MODULE_STORAGE_KEY);
    } catch {
      // storage non disponibile (es. modalità privata): il modulo resta solo in memoria
    }
  };

  // Chi apre un link diretto a una pagina di Manutenzioni (es. da preferiti) entra
  // in quel modulo senza dover passare dal chooser di "/".
  useEffect(() => {
    if (location.pathname === "/") return;
    const pathModule = moduleForPath(location.pathname);
    if (pathModule !== activeModule) setActiveModule(pathModule);
  }, [location.pathname]);

  // Chi non ha accesso a nessun modulo extra (Manutenzioni/Consegne/Rendicontazioni),
  // o è un utente "solo rendicontazioni", non ha nulla da scegliere: entra sempre
  // dritto in T-Hub, senza chooser inutile.
  useEffect(() => {
    if (!activeModule && (!(canAccessMaintenance || canAccessDeliveries || canAccessReporting) || timesheetsOnly)) {
      setActiveModule("thub");
    }
  }, [activeModule, canAccessMaintenance, canAccessDeliveries, canAccessReporting, timesheetsOnly]);

  const showModuleChooser = location.pathname === "/" && !activeModule;

  const sidebarWidth = sidebarCollapsed ? 56 : 240;

  useEffect(() => {
    if (canAccessOperationalReporting) {
      loadOperationalReportingPage();
    }
  }, [canAccessOperationalReporting]);

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      {import.meta.env.DEV && (
        <Box
          sx={{
            bgcolor: "#c62828",
            color: "#fff",
            textAlign: "center",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 0.5,
            py: 0.5,
          }}
        >
          AMBIENTE DI SVILUPPO
        </Box>
      )}
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
      {showModuleChooser ? (
        <ModuleChooserPage
          canAccessMaintenance={canAccessMaintenance}
          canAccessDeliveries={canAccessDeliveries}
          canAccessReporting={canAccessReporting}
          onSelect={(nextModule) => {
            setActiveModule(nextModule);
            const landingPath = nextModule === "maintenance"
              ? "/manutenzioni"
              : nextModule === "deliveries"
                ? "/dotazioni"
                : nextModule === "reporting"
                  ? (canAccessOperationalReporting ? "/rendicontazioni/operativa/dashboard" : "/commesse")
                  : "/";
            navigate(landingPath);
          }}
          onLogout={logout}
        />
      ) : (
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
                <Tooltip title="Cambia modulo" placement="right">
                  <Button
                    onClick={() => { setActiveModule(null); navigate("/"); }}
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
                    <THubLogo size={28} suffix={activeModule ? MODULE_LABELS[activeModule] : undefined} />
                  </Button>
                </Tooltip>
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

          <SidebarNav user={effectiveUser} collapsed={sidebarCollapsed} search={sidebarSearch} activeModule={activeModule} />

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
              <Route path="/dotazioni" element={effectiveUser?.can_access_deliveries ? <ConsegnePage /> : <Navigate to="/" replace />} />
              <Route path="/manutenzioni" element={effectiveUser?.can_access_maintenance ? <MaintenanceDashboardPage /> : <Navigate to="/" replace />} />
              <Route path="/manutenzioni/questionario" element={effectiveUser?.can_access_maintenance ? <MaintenancePage /> : <Navigate to="/" replace />} />
              <Route path="/manutenzioni/asset/dettaglio/:assetId" element={effectiveUser?.can_access_maintenance ? <MaintenanceAssetDetailPage /> : <Navigate to="/" replace />} />
              <Route path="/manutenzioni/asset/:classCode" element={effectiveUser?.can_access_maintenance ? <MaintenanceAssetsPage /> : <Navigate to="/" replace />} />
              <Route path="/manutenzioni/scadenze" element={effectiveUser?.can_access_maintenance ? <MaintenanceDeadlinesPage /> : <Navigate to="/" replace />} />
              <Route path="/manutenzioni/categorie" element={effectiveUser?.effective_role === "admin" ? <MaintenanceAssetTypesAdminPage /> : <Navigate to="/" replace />} />
              <Route path="/manutenzioni/notifiche" element={effectiveUser?.effective_role === "admin" ? <MaintenanceNotificationRulesPage /> : <Navigate to="/" replace />} />
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
      )}
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
      {/* Pagina pubblica del QR fisico sull'asset (§ manutenzioni): nessun
          login, deve restare raggiungibile indipendentemente da isAuthenticated,
          quindi sta fuori dal blocco protetto sotto e non passa da ProtectedLayout. */}
      <Route
        path="/manutenzioni/asset-pubblico/:token"
        element={
          <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>
              <MaintenanceAssetPublicPage />
            </Suspense>
          </ErrorBoundary>
        }
      />
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
