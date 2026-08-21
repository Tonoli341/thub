import dayjs from "dayjs";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import { useNavigate } from "react-router-dom";

import { getActivityRecordStats } from "../api";
import ReportingPeriodFilter from "../components/ReportingPeriodFilter";
import PageHeader, { HeaderButton } from "../components/PageHeader";

function fmtHoursHm(hours) {
  const totalMinutes = Math.round((Number(hours) || 0) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function KpiCard({ icon, label, value, sub, accent }) {
  return (
    <Paper sx={{ p: 2.5, borderRadius: 3, border: `1px solid ${accent}28` }}>
      <Stack direction="row" spacing={0.75} alignItems="center">
        {icon && <Box component="span" aria-hidden="true" sx={{ fontSize: 14, lineHeight: 1 }}>{icon}</Box>}
        <Typography sx={{ color: accent, fontWeight: 800, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</Typography>
      </Stack>
      <Typography variant="h4" sx={{ mt: 0.75, fontWeight: 800 }}>{value ?? 0}</Typography>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </Paper>
  );
}

function HoursBar({ hours, maxHours }) {
  const pct = maxHours > 0 ? Math.min((hours / maxHours) * 100, 100) : 0;
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, minWidth: 160 }}>
      <Box sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: "rgba(0,112,64,0.1)", overflow: "hidden" }}>
        <Box sx={{ width: `${pct}%`, height: "100%", borderRadius: 3, bgcolor: "#007040", transition: "width 0.4s ease" }} />
      </Box>
      <Typography sx={{ fontSize: 13, fontWeight: 700, minWidth: 52, textAlign: "right" }}>{fmtHoursHm(hours)}</Typography>
    </Box>
  );
}

function aggregateBy(rows, keyOf, labelOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row) ?? "";
    const current = groups.get(key) ?? { key, label: labelOf(row), seconds: 0, activities: 0 };
    current.seconds += row.total_seconds ?? 0;
    current.activities += row.activity_count ?? 0;
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => b.seconds - a.seconds);
}

function DrillBar({ item, maxSeconds, onClick, hint }) {
  const pct = maxSeconds > 0 ? Math.min((item.seconds / maxSeconds) * 100, 100) : 0;
  const clickable = Boolean(onClick);
  return (
    <Tooltip
      arrow
      title={`${item.label} · ${item.activities} attività · ${fmtHoursHm(item.seconds / 3600)}${hint ? ` · ${hint}` : ""}`}
    >
      <Box
        onClick={onClick}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          px: 1,
          py: 0.85,
          borderRadius: 2,
          cursor: clickable ? "pointer" : "default",
          transition: "background-color 0.15s",
          "&:hover": clickable ? { bgcolor: "rgba(0,112,64,0.06)" } : {},
        }}
      >
        <Box sx={{ width: { xs: 130, sm: 220 }, flexShrink: 0 }}>
          <Typography noWrap sx={{ fontWeight: 600, fontSize: 13 }}>{item.label}</Typography>
        </Box>
        <Box sx={{ flex: 1, height: 10, borderRadius: 5, bgcolor: "rgba(0,112,64,0.1)", overflow: "hidden", minWidth: 60 }}>
          <Box sx={{ width: `${pct}%`, height: "100%", borderRadius: 5, bgcolor: "#007040", transition: "width 0.4s ease" }} />
        </Box>
        <Typography sx={{ width: 60, textAlign: "right", fontWeight: 700, fontSize: 13 }}>
          {fmtHoursHm(item.seconds / 3600)}
        </Typography>
      </Box>
    </Tooltip>
  );
}

function RendicontazioneDrillChart({ rows }) {
  const [commessa, setCommessa] = useState(null);

  const byCommessa = aggregateBy(
    rows,
    (r) => r.mapping_description || "—",
    (r) => r.mapping_description || "Senza commessa",
  );

  const byJupiter = commessa == null
    ? []
    : aggregateBy(
        rows.filter((r) => (r.mapping_description || "—") === commessa),
        (r) => r.jupiter_description || "—",
        (r) => r.jupiter_description || "Senza Jupiter",
      );

  const items = commessa == null ? byCommessa : byJupiter;
  const maxSeconds = items[0]?.seconds ?? 0;

  return (
    <Paper sx={{ borderRadius: 3, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2, bgcolor: "#faf7f2", borderBottom: "1px solid rgba(226,226,229,0.9)" }}>
        {commessa == null ? (
          <>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>Ore per commessa</Typography>
            <Typography color="text.secondary">{byCommessa.length} commesse · clicca una barra per il dettaglio Jupiter</Typography>
          </>
        ) : (
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <Button size="small" variant="text" onClick={() => setCommessa(null)} sx={{ minWidth: 0, px: 1 }}>
              ‹ Commesse
            </Button>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>{commessa === "—" ? "Senza commessa" : commessa}</Typography>
              <Typography color="text.secondary">Ripartizione per Jupiter</Typography>
            </Box>
          </Stack>
        )}
      </Box>
      <Box sx={{ p: 2, maxHeight: 420, overflowY: "auto" }}>
        {items.length === 0 ? (
          <Typography variant="body2" color="text.disabled" sx={{ p: 2 }}>Nessun dato disponibile.</Typography>
        ) : (
          items.map((item) => (
            <DrillBar
              key={item.key}
              item={item}
              maxSeconds={maxSeconds}
              onClick={commessa == null ? () => setCommessa(item.key) : undefined}
              hint={commessa == null ? "clicca per il dettaglio Jupiter" : undefined}
            />
          ))
        )}
      </Box>
    </Paper>
  );
}

function LocationDrillChart({ rows }) {
  const [areaKey, setAreaKey] = useState(null);
  const [buildingKey, setBuildingKey] = useState(null);

  const areaRowKey = (row) => row.operational_area_id ? `area:${row.operational_area_id}` : "area:__missing__";
  const buildingRowKey = (row) => row.building ? `building:${row.building}` : "building:__missing__";

  const byArea = aggregateBy(
    rows,
    areaRowKey,
    (row) => row.operational_area_name || "Area non specificata",
  );
  const areaRows = areaKey == null ? [] : rows.filter((row) => areaRowKey(row) === areaKey);
  const byBuilding = aggregateBy(
    areaRows,
    buildingRowKey,
    (row) => row.building || "Immobile non specificato",
  );
  const buildingRows = buildingKey == null ? [] : areaRows.filter((row) => buildingRowKey(row) === buildingKey);
  const byCustomer = aggregateBy(
    buildingRows,
    (row) => row.customer_code ? `customer:${row.customer_code}` : `mapping:${row.mapping_id}`,
    (row) => row.customer_name || row.customer_code || "Cliente non specificato",
  );

  const level = areaKey == null ? "area" : buildingKey == null ? "building" : "customer";
  const items = level === "area" ? byArea : level === "building" ? byBuilding : byCustomer;
  const maxSeconds = items[0]?.seconds ?? 0;
  const areaLabel = byArea.find((item) => item.key === areaKey)?.label;
  const buildingLabel = byBuilding.find((item) => item.key === buildingKey)?.label;

  function goBack() {
    if (level === "customer") {
      setBuildingKey(null);
    } else {
      setAreaKey(null);
      setBuildingKey(null);
    }
  }

  function selectItem(item) {
    if (level === "area") setAreaKey(item.key);
    if (level === "building") setBuildingKey(item.key);
  }

  const title = level === "area" ? "Ore per area" : level === "building" ? areaLabel : buildingLabel;
  const subtitle = level === "area"
    ? `${byArea.length} aree · clicca una barra per il dettaglio immobili`
    : level === "building"
      ? `${byBuilding.length} immobili · clicca una barra per il dettaglio clienti`
      : `${byCustomer.length} clienti · ${areaLabel}`;

  return (
    <Paper sx={{ borderRadius: 3, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2, bgcolor: "#faf7f2", borderBottom: "1px solid rgba(226,226,229,0.9)" }}>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          {level !== "area" && (
            <Button size="small" variant="text" onClick={goBack} sx={{ minWidth: 0, px: 1 }}>
              ‹ {level === "customer" ? "Immobili" : "Aree"}
            </Button>
          )}
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>{title}</Typography>
            <Typography color="text.secondary">{subtitle}</Typography>
          </Box>
        </Stack>
      </Box>
      <Box sx={{ p: 2, maxHeight: 420, overflowY: "auto" }}>
        {items.length === 0 ? (
          <Typography variant="body2" color="text.disabled" sx={{ p: 2 }}>Nessun dato disponibile.</Typography>
        ) : (
          items.map((item) => (
            <DrillBar
              key={item.key}
              item={item}
              maxSeconds={maxSeconds}
              onClick={level === "customer" ? undefined : () => selectItem(item)}
              hint={level === "area" ? "clicca per gli immobili" : level === "building" ? "clicca per i clienti" : undefined}
            />
          ))
        )}
      </Box>
    </Paper>
  );
}

export default function ActivityDashboardPage() {
  const navigate = useNavigate();
  const today = dayjs().format("YYYY-MM-DD");
  const [range, setRange] = useState({
    start: today,
    end: today,
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["activity-stats", range.start, range.end],
    queryFn: () => getActivityRecordStats({ startDate: range.start, endDate: range.end }),
  });

  const maxMappingHours = data?.by_mapping?.[0]?.total_hours ?? 0;
  const maxEmployeeHours = data?.by_employee?.[0]?.total_hours ?? 0;

  return (
    <Stack spacing={3}>
      {/* Header */}
      <PageHeader
        section="Rendicontazioni"
        title="Dashboard attività"
        meta={data ? `${fmtHoursHm(data.total_hours)} nel periodo` : undefined}
      />

      {/* Filters */}
      <ReportingPeriodFilter start={range.start} end={range.end} onChange={setRange} />

      {error && <Alert severity="error">{error.message}</Alert>}

      {/* KPIs */}
      {isLoading ? (
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(4, 1fr)" } }}>
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} variant="rounded" height={96} sx={{ borderRadius: 3 }} />)}
        </Box>
      ) : data && (
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(4, 1fr)" } }}>
          <KpiCard icon="⏱️" label="Ore totali" value={fmtHoursHm(data.total_hours)} accent="#007040" />
          <KpiCard icon="📋" label="Attività" value={data.total_count} sub="sessioni registrate" accent="#335c67" />
          <KpiCard icon="👥" label="Dipendenti" value={data.employee_count} sub="attivi nel periodo" accent="#6c757d" />
          <KpiCard icon="🗂️" label="Commesse" value={data.mapping_count} sub="combinazioni usate" accent="#d97706" />
        </Box>
      )}

      {/* Empty state */}
      {!isLoading && data?.total_count === 0 && (
        <Paper sx={{ p: 5, borderRadius: 3, textAlign: "center" }}>
          <Typography variant="h6" color="text.secondary" gutterBottom>Nessuna attività registrata</Typography>
          <Typography variant="body2" color="text.disabled">
            Non ci sono attività nel periodo selezionato. Prova a cambiare l&apos;intervallo di date.
          </Typography>
        </Paper>
      )}

      {/* Drill-down chart: Commessa → Jupiter */}
      {!isLoading && (data?.by_mapping?.length ?? 0) > 0 && (
        <RendicontazioneDrillChart rows={data.by_mapping} />
      )}

      {/* Drill-down chart: Area → Immobile → Cliente */}
      {!isLoading && (data?.by_location?.length ?? 0) > 0 && (
        <LocationDrillChart key={`${range.start}:${range.end}`} rows={data.by_location} />
      )}

      {/* By mapping */}
      {!isLoading && (data?.by_mapping?.length ?? 0) > 0 && (
        <Paper sx={{ borderRadius: 3, overflow: "hidden" }}>
          <Box sx={{ px: 3, py: 2, bgcolor: "#faf7f2", borderBottom: "1px solid rgba(226,226,229,0.9)" }}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={1} justifyContent="space-between" alignItems={{ md: "center" }}>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>Matrice rendicontazione</Typography>
                <Typography color="text.secondary">{data.by_mapping.length} commesse · {fmtHoursHm(data.total_hours)} totali</Typography>
              </Box>
              <Button variant="outlined" size="small" onClick={() => navigate("/rendicontazioni/elenco")}>
                Vai alle giornate
              </Button>
            </Stack>
          </Box>
          <Box sx={{ overflowX: "auto" }}>
            <Table sx={{ minWidth: 640 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 36 }}>#</TableCell>
                  <TableCell>Commessa</TableCell>
                  <TableCell>Voce Infinity</TableCell>
                  <TableCell>Jupiter</TableCell>
                  <TableCell align="right">Dipendenti</TableCell>
                  <TableCell align="right">Attività</TableCell>
                  <TableCell sx={{ minWidth: 200 }}>Ore</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.by_mapping.map((row, idx) => (
                  <TableRow
                    key={row.mapping_id}
                    hover
                    sx={{ cursor: "pointer" }}
                    onClick={() => navigate(`/rendicontazioni/elenco?mappingId=${row.mapping_id}`)}
                  >
                    <TableCell sx={{ color: "text.secondary", fontWeight: 600 }}>{idx + 1}</TableCell>
                    <TableCell>
                      <Typography sx={{ fontWeight: 700 }}>{row.mapping_description || "—"}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">{row.infinity_item_name || "—"}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">{row.jupiter_description || "—"}</Typography>
                    </TableCell>
                    <TableCell align="right">{row.employee_count}</TableCell>
                    <TableCell align="right">{row.activity_count}</TableCell>
                    <TableCell><HoursBar hours={row.total_hours} maxHours={maxMappingHours} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Paper>
      )}

      {/* By employee */}
      {!isLoading && (data?.by_employee?.length ?? 0) > 0 && (
        <Paper sx={{ borderRadius: 3, overflow: "hidden" }}>
          <Box sx={{ px: 3, py: 2, bgcolor: "#faf7f2", borderBottom: "1px solid rgba(226,226,229,0.9)" }}>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>Ore per dipendente</Typography>
            <Typography color="text.secondary">{data.by_employee.length} dipendenti nel periodo</Typography>
          </Box>
          <Box sx={{ overflowX: "auto" }}>
            <Table sx={{ minWidth: 560 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Dipendente</TableCell>
                  <TableCell align="right">Commesse</TableCell>
                  <TableCell align="right">Attività</TableCell>
                  <TableCell sx={{ minWidth: 200 }}>Ore</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.by_employee.map((row) => (
                  <TableRow
                    key={row.employee_id}
                    hover
                    sx={{ cursor: "pointer" }}
                    onClick={() => navigate(`/rendicontazioni/elenco?employeeId=${row.employee_id}`)}
                  >
                    <TableCell>
                      <Typography sx={{ fontWeight: 700 }}>{row.employee_name || row.employee_id}</Typography>
                    </TableCell>
                    <TableCell align="right">{row.mapping_count}</TableCell>
                    <TableCell align="right">{row.activity_count}</TableCell>
                    <TableCell><HoursBar hours={row.total_hours} maxHours={maxEmployeeHours} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Paper>
      )}

      {isLoading && (
        <Stack spacing={2}>
          <Skeleton variant="rounded" height={280} sx={{ borderRadius: 3 }} />
          <Skeleton variant="rounded" height={220} sx={{ borderRadius: 3 }} />
        </Stack>
      )}
    </Stack>
  );
}
