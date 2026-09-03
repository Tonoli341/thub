import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  InputAdornment,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import dayjs from "dayjs";
import { alpha } from "@mui/material/styles";

import PageHeader from "../components/PageHeader";
import { HEADER_GRADIENT } from "../components/pageTokens";
import { bodyRowSx, headRowSx, tableSx } from "../components/tableStyles";
import { getMaintenanceAssetClasses, getMaintenanceAssets, getMaintenanceDeadlines } from "../maintenanceAssetsApi";
import { MAINTENANCE_ASSET_STATUS_COLORS, MAINTENANCE_ASSET_STATUS_LABELS } from "./maintenanceAssetsColumns";

const URGENCY_LABELS = { in_scadenza: "In scadenza", urgente: "Urgente", scaduta: "Scaduta" };
const URGENCY_COLORS = { in_scadenza: "warning", urgente: "warning", scaduta: "error" };
const URGENCY_ORDER = { scaduta: 0, urgente: 1, in_scadenza: 2, regolare: 3 };

/**
 * Schermata di ingresso del modulo (§14 del documento requisiti): pochi
 * indicatori — non un cruscotto completo — più la ricerca libera sull'intero
 * parco, trasversale alle categorie, che il §1.2 del questionario chiede
 * esplicitamente ("trovare un asset in pochi secondi").
 */
function DashboardIcon({ type, size = 20 }) {
  const paths = {
    assets: <><rect x="4" y="4" width="16" height="16" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M8 9h8M8 13h8M8 17h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></>,
    unavailable: <><path d="M12 3 2.5 20h19L12 3Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M12 9v4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="12" cy="17" r="1" fill="currentColor" /></>,
    overdue: <><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M12 7v5l3.5 2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></>,
    upcoming: <><rect x="3.5" y="5" width="17" height="16" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="12" cy="15" r="2" fill="currentColor" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="m15.5 15.5 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
    close: <path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />,
  };
  return (
    <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{ width: size, height: size, display: "block" }}>
      {paths[type]}
    </Box>
  );
}

const KPI_TONES = { green: "primary", slate: "text", red: "error", amber: "warning" };

function kpiToneColor(theme, tone) {
  return tone === "slate" ? theme.palette.text.secondary : theme.palette[KPI_TONES[tone]].main;
}

function KpiCard({ label, value, helper, icon, tone = "green", accent = "primary.main", valueColor = "text.primary", onClick }) {
  return (
    <Paper
      variant="outlined"
      component={onClick ? "button" : "div"}
      type={onClick ? "button" : undefined}
      onClick={onClick}
      sx={{
        p: 2,
        width: "100%",
        borderRadius: 3,
        textAlign: "left",
        font: "inherit",
        color: "text.primary",
        background: (theme) => {
          const color = kpiToneColor(theme, tone);
          return `linear-gradient(135deg, ${alpha(color, theme.palette.mode === "dark" ? 0.2 : 0.11)} 0%, ${alpha(color, theme.palette.mode === "dark" ? 0.06 : 0.025)} 100%)`;
        },
        borderColor: (theme) => alpha(kpiToneColor(theme, tone), 0.24),
        cursor: onClick ? "pointer" : "default",
        transition: "border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease",
        "&:hover": onClick ? { borderColor: accent, boxShadow: (theme) => `0 8px 22px ${alpha(kpiToneColor(theme, tone), 0.12)}`, transform: "translateY(-1px)" } : undefined,
        "&:focus-visible": onClick ? { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 } : undefined,
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1.5}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 650, color: "text.secondary" }}>{label}</Typography>
          <Typography sx={{ fontSize: 30, fontWeight: 750, color: valueColor, lineHeight: 1.15, mt: 0.5, letterSpacing: "-0.03em" }}>{value}</Typography>
        </Box>
        <Box sx={{ width: 36, height: 36, flexShrink: 0, display: "grid", placeItems: "center", borderRadius: "50%", color: accent, bgcolor: (theme) => alpha(kpiToneColor(theme, tone), 0.13) }}>
          <DashboardIcon type={icon} size={18} />
        </Box>
      </Stack>
      <Typography sx={{ fontSize: 11.5, color: "text.secondary", mt: 1 }}>{helper}</Typography>
    </Paper>
  );
}

export default function MaintenanceDashboardPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const assetClassesQuery = useQuery({ queryKey: ["maintenance-asset-classes"], queryFn: getMaintenanceAssetClasses });
  const assetsQuery = useQuery({ queryKey: ["maintenance-assets", null, "", ""], queryFn: () => getMaintenanceAssets() });
  const deadlinesQuery = useQuery({ queryKey: ["maintenance-deadlines"], queryFn: getMaintenanceDeadlines });

  const searchQuery = useQuery({
    queryKey: ["maintenance-assets-search", search],
    queryFn: () => getMaintenanceAssets({ search }),
    enabled: search.trim().length >= 2,
  });

  const assetClasses = assetClassesQuery.data ?? [];
  const assets = assetsQuery.data ?? [];
  const deadlines = deadlinesQuery.data ?? [];

  const outOfServiceCount = useMemo(
    () => assets.filter((asset) => asset.status === "fuori_servizio").length,
    [assets],
  );
  const overdueDeadlines = useMemo(() => deadlines.filter((d) => d.urgency === "scaduta"), [deadlines]);
  const upcomingDeadlines = useMemo(
    () => deadlines.filter((d) => d.urgency === "urgente" || d.urgency === "in_scadenza"),
    [deadlines],
  );

  const urgentList = useMemo(() => {
    return [...deadlines]
      .filter((d) => d.urgency !== "regolare")
      .sort((a, b) => {
        const diff = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
        if (diff !== 0) return diff;
        return dayjs(a.due_date).diff(dayjs(b.due_date));
      })
      .slice(0, 8);
  }, [deadlines]);

  const searchResults = search.trim().length >= 2 ? searchQuery.data ?? [] : [];

  return (
    <Box sx={{ minHeight: "100%" }}>
      <Stack spacing={2}>
        <PageHeader section="Manutenzioni" title="Dashboard" meta={assetsQuery.isLoading ? "Caricamento asset..." : `${assets.length} asset censiti`} />

        {(assetsQuery.error || deadlinesQuery.error || assetClassesQuery.error) && (
          <Alert severity="error">{(assetsQuery.error || deadlinesQuery.error || assetClassesQuery.error).message}</Alert>
        )}

        <Paper
          sx={{
            p: { xs: 2, sm: 2.5 }, borderRadius: 3, overflow: "hidden", color: "#fff",
            background: HEADER_GRADIENT,
            boxShadow: (theme) => `0 10px 28px ${alpha(theme.palette.primary.dark, 0.16)}`,
          }}
        >
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ xs: "stretch", sm: "center" }}>
            <Box sx={{ minWidth: { sm: 210 } }}>
              <Typography sx={{ fontSize: 15, fontWeight: 800 }}>Trova un asset</Typography>
              <Typography sx={{ fontSize: 12, color: "rgba(255,255,255,0.72)", mt: 0.25 }}>Cerca in tutto il parco mezzi.</Typography>
            </Box>
            <TextField
              size="small"
              fullWidth
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Codice, produttore, modello, matricola, sito o attributo tecnico..."
              InputProps={{
                startAdornment: <InputAdornment position="start" sx={{ color: (theme) => theme.palette.primary.dark }}><DashboardIcon type="search" size={19} /></InputAdornment>,
                endAdornment: search && (
                  <InputAdornment position="end">
                    <IconButton size="small" aria-label="Azzera ricerca" onClick={() => setSearch("")}>
                      <DashboardIcon type="close" size={17} />
                    </IconButton>
                  </InputAdornment>
                ),
              }}
              sx={{
                "& .MuiOutlinedInput-root": { bgcolor: "rgba(255,255,255,0.96)", color: "#27302c", borderRadius: 2 },
                "& .MuiOutlinedInput-notchedOutline": { borderColor: "rgba(255,255,255,0.34)" },
                "& .Mui-focused .MuiOutlinedInput-notchedOutline": { borderWidth: 1.5 },
                "& input::placeholder": { color: "rgba(39,48,44,0.58)", opacity: 1 },
                "& .MuiIconButton-root": { color: "rgba(39,48,44,0.58)" },
              }}
            />
          </Stack>

          {search.trim().length === 1 && (
            <Typography sx={{ fontSize: 11.5, color: "rgba(255,255,255,0.72)", mt: 1.25, ml: { sm: "230px" } }}>Inserisci almeno 2 caratteri.</Typography>
          )}

          {search.trim().length >= 2 && (
            <Paper variant="outlined" sx={{ mt: 2, borderRadius: 2.5, overflow: "hidden", bgcolor: "background.paper", color: "text.primary", borderColor: "rgba(255,255,255,0.30)" }}>
              <Box sx={{ px: 2, py: 1, borderBottom: "1px solid", borderColor: "divider", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>Risultati</Typography>
                {!searchQuery.isFetching && !searchQuery.error && (
                  <Typography sx={{ fontSize: 11.5, color: "text.secondary" }}>{searchResults.length === 1 ? "1 trovato" : `${searchResults.length} trovati`}</Typography>
                )}
              </Box>
              {searchQuery.error ? (
                <Alert severity="error" sx={{ borderRadius: 0 }}>{searchQuery.error.message}</Alert>
              ) : searchQuery.isFetching ? (
                <Stack spacing={0.5} sx={{ p: 1.5 }}>
                  <Skeleton height={30} /><Skeleton height={30} />
                </Stack>
              ) : (
                <TableContainer sx={{ maxHeight: 300 }}>
                  <Table size="small" stickyHeader sx={tableSx({ minWidth: 680 })}>
                    <TableHead>
                      <TableRow sx={headRowSx}>
                        <TableCell sx={{ width: "14%" }}>Codice</TableCell>
                        <TableCell sx={{ width: "25%" }}>Categoria</TableCell>
                        <TableCell sx={{ width: "25%" }}>Produttore / modello</TableCell>
                        <TableCell sx={{ width: "18%" }}>Sito</TableCell>
                        <TableCell sx={{ width: "18%" }} align="center">Stato</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {searchResults.map((asset) => (
                        <TableRow
                          key={asset.id}
                          hover
                          tabIndex={0}
                          role="link"
                          onClick={() => navigate(`/manutenzioni/asset/dettaglio/${asset.id}`)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") navigate(`/manutenzioni/asset/dettaglio/${asset.id}`);
                          }}
                          sx={{ ...bodyRowSx({ clickable: true }), "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 } }}
                        >
                          <TableCell><Typography sx={{ fontSize: 13, fontWeight: 750 }}>{asset.internal_code}</Typography></TableCell>
                          <TableCell><Typography sx={{ fontSize: 13 }} noWrap title={`${asset.asset_class_label} · ${asset.asset_type_label}`}>{asset.asset_class_label} · {asset.asset_type_label}</Typography></TableCell>
                          <TableCell><Typography sx={{ fontSize: 13 }} noWrap title={[asset.custom_fields?.brand, asset.custom_fields?.model].filter(Boolean).join(" ")}>{[asset.custom_fields?.brand, asset.custom_fields?.model].filter(Boolean).join(" ") || "—"}</Typography></TableCell>
                          <TableCell><Typography sx={{ fontSize: 13 }} noWrap title={asset.custom_fields?.site}>{asset.custom_fields?.site || "—"}</Typography></TableCell>
                          <TableCell align="center">
                            <Chip label={MAINTENANCE_ASSET_STATUS_LABELS[asset.status]} color={MAINTENANCE_ASSET_STATUS_COLORS[asset.status]} size="small" sx={{ fontSize: 11, fontWeight: 700 }} />
                          </TableCell>
                        </TableRow>
                      ))}
                      {searchResults.length === 0 && (
                        <TableRow><TableCell colSpan={5} sx={{ py: 4, textAlign: "center", color: "text.secondary" }}>Nessun asset trovato.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Paper>
          )}
        </Paper>

        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", lg: "repeat(4, minmax(0, 1fr))" }, gap: 1.5 }}>
          <KpiCard label="Asset censiti" value={assetsQuery.isLoading ? "—" : assets.length} helper="Totale del parco registrato" icon="assets" valueColor="primary.main" />
          <KpiCard label="Fuori servizio" value={assetsQuery.isLoading ? "—" : outOfServiceCount} helper="Asset non disponibili" icon="unavailable" tone="slate" accent="text.secondary" valueColor={outOfServiceCount ? "error.main" : "text.primary"} />
          <KpiCard label="Scadenze scadute" value={deadlinesQuery.isLoading ? "—" : overdueDeadlines.length} helper="Oltre la data prevista" icon="overdue" tone="red" accent="error.main" valueColor={overdueDeadlines.length ? "error.main" : "text.primary"} onClick={() => navigate("/manutenzioni/scadenze")} />
          <KpiCard label="Entro 30 giorni" value={deadlinesQuery.isLoading ? "—" : upcomingDeadlines.length} helper="Scadenze da pianificare" icon="upcoming" tone="amber" accent="warning.main" valueColor={upcomingDeadlines.length ? "warning.main" : "text.primary"} onClick={() => navigate("/manutenzioni/scadenze")} />
        </Box>

        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 7fr) minmax(280px, 3fr)" }, gap: 2, alignItems: "start" }}>
          <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: "hidden", minWidth: 0, borderColor: (theme) => alpha(theme.palette.primary.main, 0.24) }}>
              <Box
                sx={{
                  px: 2, py: 1.4, borderBottom: "1px solid", borderColor: "rgba(255,255,255,0.12)", color: "#fff",
                  background: HEADER_GRADIENT,
                  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 2,
                }}
              >
                <Box>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 750 }}>Scadenze da presidiare</Typography>
                  <Typography sx={{ fontSize: 11.5, color: "rgba(255,255,255,0.68)", mt: 0.15 }}>Ordinate per urgenza e data.</Typography>
                </Box>
                <Button size="small" onClick={() => navigate("/manutenzioni/scadenze")} endIcon={<DashboardIcon type="arrow" size={15} />} sx={{ whiteSpace: "nowrap", color: "#fff", "&:hover": { bgcolor: "rgba(255,255,255,0.10)" } }}>Vedi tutte</Button>
              </Box>
              {deadlinesQuery.isLoading ? (
                <Stack spacing={1} sx={{ p: 2 }}><Skeleton height={48} /><Skeleton height={48} /><Skeleton height={48} /></Stack>
              ) : urgentList.length === 0 ? (
                <Box sx={{ py: 5, px: 2, textAlign: "center", background: (theme) => `linear-gradient(180deg, ${alpha(theme.palette.primary.main, 0.09)}, ${alpha(theme.palette.background.paper, 0.96)})` }}>
                  <Box sx={{ width: 40, height: 40, mx: "auto", mb: 1.25, borderRadius: "50%", display: "grid", placeItems: "center", color: "success.main", bgcolor: (theme) => alpha(theme.palette.success.main, 0.12) }}>
                    <DashboardIcon type="upcoming" size={19} />
                  </Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 700 }}>Tutto sotto controllo</Typography>
                  <Typography sx={{ fontSize: 12, color: "text.secondary", mt: 0.4 }}>Nessuna scadenza richiede attenzione.</Typography>
                </Box>
              ) : (
                <Stack divider={<Box sx={{ borderBottom: "1px solid", borderColor: "divider" }} />}>
                  {urgentList.map((deadline) => {
                    const isOverdue = deadline.urgency === "scaduta";
                    return (
                      <Box
                        component="button"
                        type="button"
                        key={deadline.id}
                        onClick={() => navigate(`/manutenzioni/asset/dettaglio/${deadline.asset_id}`)}
                        sx={{
                          px: 2, py: 1.4, width: "100%", border: 0, font: "inherit", color: "text.primary", bgcolor: "background.paper", textAlign: "left",
                          display: "grid", gridTemplateColumns: "4px minmax(0, 1fr) auto", gap: 1.5, alignItems: "center", cursor: "pointer",
                          transition: "background-color 150ms ease", "&:hover": { bgcolor: "action.hover" },
                          "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 },
                        }}
                      >
                        <Box sx={{ width: 4, height: 34, borderRadius: 2, bgcolor: isOverdue ? "error.main" : "warning.main" }} />
                        <Box sx={{ minWidth: 0 }}>
                          <Typography sx={{ fontSize: 13, fontWeight: 700 }} noWrap title={deadline.deadline_type}>{deadline.deadline_type}</Typography>
                          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.35, minWidth: 0, flexWrap: "wrap" }}>
                            <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: "text.secondary" }}>{deadline.asset_internal_code}</Typography>
                            <Box component="span" sx={{ width: 3, height: 3, borderRadius: "50%", bgcolor: "text.disabled", flexShrink: 0 }} />
                            <Typography sx={{ fontSize: 11.5, color: "text.secondary" }} noWrap>{deadline.asset_class_label} · {deadline.asset_type_label}</Typography>
                            <Box component="span" sx={{ width: 3, height: 3, borderRadius: "50%", bgcolor: "text.disabled", flexShrink: 0 }} />
                            <Typography sx={{ fontSize: 11.5, color: "text.secondary" }}>{dayjs(deadline.due_date).format("DD/MM/YYYY")}</Typography>
                          </Stack>
                        </Box>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Chip
                            label={URGENCY_LABELS[deadline.urgency]}
                            size="small"
                            color={URGENCY_COLORS[deadline.urgency]}
                            variant="outlined"
                            sx={{ fontSize: 10.5, fontWeight: 700, height: 24 }}
                          />
                          <Box sx={{ color: "text.disabled", display: { xs: "none", sm: "block" } }}><DashboardIcon type="arrow" size={15} /></Box>
                        </Stack>
                      </Box>
                    );
                  })}
                </Stack>
              )}
          </Paper>

          <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: "hidden", borderColor: (theme) => alpha(theme.palette.primary.main, 0.24) }}>
              <Box sx={{ px: 2, py: 1.5, borderBottom: "1px solid", borderColor: (theme) => alpha(theme.palette.primary.main, 0.18), bgcolor: "action.selected" }}>
                <Typography sx={{ fontSize: 13.5, fontWeight: 750, color: "primary.main" }}>Parco per classe</Typography>
                <Typography sx={{ fontSize: 11.5, color: "text.secondary", mt: 0.15 }}>Apri rapidamente un elenco.</Typography>
              </Box>
              <Stack divider={<Box sx={{ borderBottom: "1px solid", borderColor: "divider" }} />}>
                {assetClasses.map((assetClass) => {
                  const count = assets.filter((asset) => asset.asset_class_id === assetClass.id).length;
                  return (
                    <Box
                      component="button"
                      type="button"
                      key={assetClass.id}
                      onClick={() => navigate(`/manutenzioni/asset/${assetClass.code}`)}
                      sx={{
                        px: 2, py: 1.35, width: "100%", border: 0, font: "inherit", color: "text.primary", bgcolor: "background.paper", textAlign: "left",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        cursor: "pointer",
                        transition: "background-color 150ms ease",
                        "&:hover": { bgcolor: "action.selected" },
                        "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 },
                      }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontSize: 13, fontWeight: 700 }} noWrap title={assetClass.label}>{assetClass.label}</Typography>
                        <Typography sx={{ fontSize: 11.5, color: "text.secondary", mt: 0.15 }}>
                          {(assetClass.types?.length ?? 0) === 1 ? "1 sottoclasse" : `${assetClass.types?.length ?? 0} sottoclassi`}
                        </Typography>
                      </Box>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, color: "text.secondary" }}>
                        <Box sx={{ minWidth: 28, height: 28, px: 0.75, display: "grid", placeItems: "center", borderRadius: "14px", bgcolor: (theme) => alpha(theme.palette.primary.main, 0.13), color: "primary.main", fontSize: 12, fontWeight: 800 }}>{count}</Box>
                        <DashboardIcon type="arrow" size={15} />
                      </Box>
                    </Box>
                  );
                })}
                {assetClassesQuery.isLoading && <Box sx={{ p: 2 }}><Skeleton height={30} /><Skeleton height={30} /></Box>}
                {assetClasses.length === 0 && !assetClassesQuery.isLoading && (
                  <Box sx={{ px: 2, py: 3, textAlign: "center" }}>
                    <Typography sx={{ fontSize: 13, color: "text.secondary" }}>
                      Nessuna classe configurata. Vai in Manutenzioni · Famiglie, classi e sottoclassi.
                    </Typography>
                  </Box>
                )}
              </Stack>
          </Paper>
        </Box>
      </Stack>
    </Box>
  );
}
