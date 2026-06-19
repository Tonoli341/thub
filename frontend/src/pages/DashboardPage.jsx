import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Button,
  Chip,
  Divider,
  Grid2,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";

import { useAuth } from "../auth";
import { getDashboard, getDashboardApprover, getDashboardMe, getJustifications, updateJustificationApproval } from "../api";

dayjs.extend(isoWeek);

// ─── constants ────────────────────────────────────────────────────────────────

const TYPE_LABEL  = { FERIE: "Ferie", PERMESSO: "Permesso", ALTRO: "Altro" };
const TYPE_COLOR  = { FERIE: "#007040", PERMESSO: "#d97706", ALTRO: "#6c757d" };
const STATUS_COLOR = { approved: "#4f772d", pending: "#d97706", rejected: "#bc4749" };
const STATUS_LABEL = { approved: "Approvata", pending: "In attesa", rejected: "Rifiutata" };
const WEEKDAYS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
const MONTHS_IT = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno",
                   "Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];

const ORG_CARDS = [
  { key: "present", title: "In Planner oggi",   dataKey: "present_count",           accent: "#4f772d", detailKey: "present_detail",          detailTitle: "In Planner oggi" },
  { key: "absent",  title: "Assenti oggi",       dataKey: "absent_count",            accent: "#bc4749", detailKey: "absent_today_detail",      detailTitle: "Assenti oggi" },
  { key: "pending", title: "Assenze in attesa",  dataKey: "pending_approvals_count", accent: "#d97706", detailKey: "pending_approvals_detail", detailTitle: "In attesa di approvazione" },
];

// ─── generic helpers ──────────────────────────────────────────────────────────

function AbsenceTypeChip({ type, size = "sm" }) {
  const color = TYPE_COLOR[type] ?? "#6c757d";
  const fs = size === "xs" ? 9 : 10;
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", px: 0.6, py: 0.1, borderRadius: 1, bgcolor: `${color}18`, color, fontSize: fs, fontWeight: 700, flexShrink: 0 }}>
      {TYPE_LABEL[type] ?? type}
    </Box>
  );
}

function StatusBadge({ status }) {
  const color = STATUS_COLOR[status] ?? "#6c757d";
  return (
    <Box sx={{ px: 0.6, py: 0.1, borderRadius: 1, bgcolor: `${color}18`, color, fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
      {STATUS_LABEL[status] ?? status}
    </Box>
  );
}

function SectionTitle({ children, accent = "#007040" }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
      <Box sx={{ width: 3, height: 18, borderRadius: 2, bgcolor: accent, flexShrink: 0 }} />
      <Typography sx={{ fontSize: 12, fontWeight: 800, color: accent, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {children}
      </Typography>
    </Box>
  );
}

function EmptyState({ label }) {
  return (
    <Typography sx={{ fontSize: 13, color: "text.disabled", fontStyle: "italic" }}>{label}</Typography>
  );
}

function overlapsDay(item, date) {
  return item.start_date <= date && item.end_date >= date;
}

// ─── personal section ─────────────────────────────────────────────────────────

function TodayPlanner({ assignments }) {
  if (!assignments?.length) {
    return <EmptyState label="Non inserito nel planner oggi" />;
  }
  return (
    <Stack spacing={0.75}>
      {assignments.map((a, i) => (
        <Box
          key={i}
          sx={{
            display: "flex", alignItems: "stretch", borderRadius: 2,
            border: "1px solid rgba(0,112,64,0.18)", overflow: "hidden",
          }}
        >
          <Box sx={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            minWidth: 80, px: 1.25, py: 1, bgcolor: "rgba(0,112,64,0.06)",
            borderRight: "1px solid rgba(0,112,64,0.12)", flexShrink: 0,
          }}>
            <Typography sx={{ fontSize: 12, fontWeight: 800, color: "#007040", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
              {a.start_time ?? "—"}
            </Typography>
            <Typography sx={{ fontSize: 10, color: "#007040", opacity: 0.6, lineHeight: 1.2 }}>│</Typography>
            <Typography sx={{ fontSize: 12, fontWeight: 800, color: "#007040", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
              {a.end_time ?? "—"}
            </Typography>
          </Box>
          <Box sx={{ px: 1.5, py: 1, flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: "text.primary", lineHeight: 1.3 }}>
              {a.area ?? "Area non specificata"}
            </Typography>
            {a.site && (
              <Typography sx={{ fontSize: 11, color: "text.secondary", mt: 0.25 }} noWrap>
                {a.site}
              </Typography>
            )}
          </Box>
        </Box>
      ))}
    </Stack>
  );
}

function UpcomingAbsences({ absences }) {
  const todayIso = dayjs().format("YYYY-MM-DD");

  if (!absences?.length) {
    return <EmptyState label="Nessuna assenza programmata" />;
  }

  return (
    <Stack spacing={0.5}>
      {absences.map((a) => {
        const isActive = a.start_date <= todayIso && a.end_date >= todayIso;
        const isPast = a.end_date < todayIso;
        return (
          <Box
            key={a.id}
            sx={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: 1, px: 1, py: 0.625, borderRadius: 1.5,
              bgcolor: isActive ? "rgba(0,112,64,0.05)" : "transparent",
              opacity: isPast ? 0.45 : 1,
            }}
          >
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
              <AbsenceTypeChip type={a.justification_type} />
              {isActive && (
                <Box sx={{ px: 0.6, borderRadius: 1, bgcolor: "rgba(0,112,64,0.12)", color: "#007040", fontSize: 9, fontWeight: 800 }}>IN CORSO</Box>
              )}
            </Stack>
            <Stack direction="row" spacing={0.75} alignItems="center">
              <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
                {a.start_date === a.end_date
                  ? dayjs(a.start_date).format("DD/MM")
                  : `${dayjs(a.start_date).format("DD/MM")} – ${dayjs(a.end_date).format("DD/MM")}`}
              </Typography>
              {!isPast && <StatusBadge status={a.approval_status} />}
            </Stack>
          </Box>
        );
      })}
    </Stack>
  );
}

function PersonalSection({ meData, isLoading }) {
  if (isLoading) return <Typography fontSize={13} color="text.secondary">Caricamento...</Typography>;

  return (
    <Stack spacing={2}>
      <Box>
        <SectionTitle accent="#007040">Pianificazione oggi</SectionTitle>
        <TodayPlanner assignments={meData?.today_assignments} />
      </Box>

      <Divider />

      <Box>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <SectionTitle accent="#007040">Le mie assenze</SectionTitle>
          {meData?.pending_count > 0 && (
            <Box sx={{ px: 1, py: 0.25, borderRadius: 2, bgcolor: "#d9770618", color: "#d97706", fontSize: 11, fontWeight: 700 }}>
              {meData.pending_count} in attesa
            </Box>
          )}
        </Stack>
        <UpcomingAbsences absences={meData?.upcoming_absences} />
      </Box>
    </Stack>
  );
}

// ─── team section ─────────────────────────────────────────────────────────────

function TeamAbsences({ items }) {
  if (!items?.length) return <EmptyState label="Nessun membro del team assente oggi" />;
  return (
    <Stack spacing={0.4}>
      {items.map((item) => (
        <Box key={item.employee_id} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, px: 1, py: 0.5, borderRadius: 1.5, "&:hover": { bgcolor: "#f8f8fa" } }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{item.employee_name}</Typography>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <AbsenceTypeChip type={item.justification_type} />
            <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
              {item.start_date === item.end_date
                ? dayjs(item.start_date).format("DD/MM")
                : `${dayjs(item.start_date).format("DD/MM")} – ${dayjs(item.end_date).format("DD/MM")}`}
            </Typography>
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}

function TeamAllocations({ areas }) {
  if (!areas?.length) return <EmptyState label="Nessuna pianificazione per oggi" />;
  return (
    <Stack spacing={0.75}>
      {areas.map((a) => (
        <Box key={a.area} sx={{ display: "flex", gap: 1.5, px: 1, py: 0.5, borderRadius: 1.5, "&:hover": { bgcolor: "#f8f8fa" }, alignItems: "flex-start" }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontSize: 11, fontWeight: 800, color: "#007040", textTransform: "uppercase", letterSpacing: "0.04em", mb: 0.25 }}>
              {a.area}
            </Typography>
            <Typography sx={{ fontSize: 12, color: "text.secondary", lineHeight: 1.4 }}>
              {a.employee_names.join(", ")}
            </Typography>
          </Box>
          <Box sx={{ px: 0.75, py: 0.1, borderRadius: 1, bgcolor: "rgba(0,112,64,0.1)", color: "#007040", fontSize: 11, fontWeight: 800, flexShrink: 0, mt: 0.25 }}>
            {a.count}
          </Box>
        </Box>
      ))}
    </Stack>
  );
}

function TeamSection({ meData, isLoading }) {
  if (isLoading) return <Typography fontSize={13} color="text.secondary">Caricamento...</Typography>;

  const hasTeam = meData?.team_size > 0;
  const hasAllocations = meData?.team_allocations?.length > 0;

  return (
    <Stack spacing={2}>
      <Box>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <SectionTitle accent="#007040">Assenti oggi</SectionTitle>
          {hasTeam && (
            <Typography sx={{ fontSize: 11, color: "text.disabled" }}>
              {meData.team_absent_today.length} / {meData.team_size}
            </Typography>
          )}
        </Stack>
        {!hasTeam
          ? <EmptyState label="Nessun riporto diretto trovato" />
          : <TeamAbsences items={meData?.team_absent_today} />
        }
      </Box>

      {hasTeam && (
        <>
          <Divider />
          <Box>
            <SectionTitle accent="#007040">Allocazioni oggi</SectionTitle>
            {hasAllocations
              ? <TeamAllocations areas={meData.team_allocations} />
              : <EmptyState label="Nessuna risorsa pianificata oggi" />
            }
          </Box>
        </>
      )}
    </Stack>
  );
}

// ─── org section ──────────────────────────────────────────────────────────────

function OrgMetricCard({ title, value, accent, onClick, active }) {
  return (
    <Paper
      elevation={0}
      onClick={onClick}
      sx={{
        px: 2, py: 1.5, border: "1.5px solid", borderColor: active ? accent : `${accent}33`,
        bgcolor: active ? `${accent}0d` : "#fff", cursor: "pointer",
        transition: "border-color 0.15s, background 0.15s",
        "&:hover": { borderColor: accent }, userSelect: "none",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1,
      }}
    >
      <Typography sx={{ fontSize: 13, fontWeight: 600, color: active ? accent : "text.secondary", lineHeight: 1.3 }}>{title}</Typography>
      <Typography sx={{ fontSize: 22, fontWeight: 800, color: active ? accent : "text.primary", lineHeight: 1 }}>{value ?? 0}</Typography>
    </Paper>
  );
}

function OrgDetailPanel({ title, accent, items, altItems, altTitle }) {
  const [view, setView] = useState("user");
  const hasAlt = Boolean(altItems);
  const displayed = hasAlt && view === "area" ? altItems : items;

  return (
    <Paper elevation={0} sx={{ border: `1.5px solid ${accent}33`, borderTop: `3px solid ${accent}`, overflow: "hidden" }}>
      <Box sx={{ px: 2, py: 1.25, borderBottom: "1px solid rgba(226,226,229,0.8)", bgcolor: `${accent}08`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
        <Box>
          <Typography fontWeight={700} fontSize={14} sx={{ color: accent }}>{hasAlt && view === "area" ? altTitle : title}</Typography>
          <Typography fontSize={12} color="text.secondary">{displayed.length} element{displayed.length === 1 ? "o" : "i"}</Typography>
        </Box>
        {hasAlt && (
          <ToggleButtonGroup value={view} exclusive size="small" onChange={(_, val) => { if (val) setView(val); }}
            sx={{ "& .MuiToggleButton-root": { fontSize: 11, py: 0.4, px: 1.25, fontWeight: 600, textTransform: "none", borderColor: `${accent}44`, color: "text.secondary", "&.Mui-selected": { bgcolor: `${accent}14`, color: accent, borderColor: `${accent}66` } } }}
          >
            <ToggleButton value="user">Per utente</ToggleButton>
            <ToggleButton value="area">Per area</ToggleButton>
          </ToggleButtonGroup>
        )}
      </Box>
      {displayed.length === 0
        ? <Box sx={{ px: 2, py: 1.5 }}><Typography color="text.secondary" fontSize={13}>Nessun elemento.</Typography></Box>
        : (
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(3, 1fr)" }, px: 0.75, py: 0.5 }}>
            {displayed.map((item, i) => (
              <Box key={`${item.employee_id}-${i}`} sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", px: 1.25, py: 0.625, borderRadius: 2, gap: 1, "&:hover": { bgcolor: "#f8f8fa" } }}>
                <Typography fontSize={13} fontWeight={500}>{item.employee_name}</Typography>
                <Typography fontSize={11} color="text.secondary" sx={{ textAlign: "right", lineHeight: 1.4 }}>{item.info}</Typography>
              </Box>
            ))}
          </Box>
        )
      }
    </Paper>
  );
}

function WeekAbsences({ justifications }) {
  const today = dayjs();
  const todayIso = today.format("YYYY-MM-DD");
  const weekStart = today.startOf("isoWeek");
  const days = Array.from({ length: 7 }, (_, i) => weekStart.add(i, "day"));

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 0.75, height: "100%" }}>
      {days.map((day, i) => {
        const iso = day.format("YYYY-MM-DD");
        const isToday = day.isSame(today, "day");
        const isPast = iso < todayIso;
        const isWeekend = i >= 5;
        const items = justifications.filter((j) => overlapsDay(j, iso));
        return (
          <Box key={iso} sx={{
            borderRadius: 1.5, border: "1px solid",
            borderColor: isToday ? "#007040" : "rgba(226,226,229,0.9)",
            bgcolor: isPast ? "#f7f7f7" : isWeekend ? "#fafafa" : isToday ? "rgba(0,112,64,0.04)" : "#fff",
            p: 0.75, opacity: isPast ? 0.5 : 1, minHeight: 72,
          }}>
            <Typography sx={{ fontSize: 10, fontWeight: isToday ? 800 : 600, mb: 0.5, lineHeight: 1, color: isToday ? "#007040" : "text.secondary", textDecoration: isPast ? "line-through" : "none" }}>
              {WEEKDAYS[i]}<br />
              <span style={{ fontSize: 13, fontWeight: isToday ? 800 : 700 }}>{day.format("DD")}</span>
            </Typography>
            <Stack spacing={0.3}>
              {items.map((j) => (
                <Box key={j.id}>
                  <Typography sx={{ fontSize: 10, fontWeight: 600, lineHeight: 1.3, color: isPast ? "text.secondary" : "text.primary", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {j.employee_name}
                  </Typography>
                  {!isPast && (
                    <Box sx={{ display: "inline-flex", px: 0.5, borderRadius: 0.75, bgcolor: `${TYPE_COLOR[j.justification_type] ?? "#6c757d"}18`, color: TYPE_COLOR[j.justification_type] ?? "#6c757d", fontSize: 9, fontWeight: 700 }}>
                      {TYPE_LABEL[j.justification_type] ?? j.justification_type}
                    </Box>
                  )}
                </Box>
              ))}
              {items.length === 0 && <Typography sx={{ fontSize: 9, color: "text.disabled" }}>—</Typography>}
            </Stack>
          </Box>
        );
      })}
    </Box>
  );
}

function MonthAbsences({ justifications }) {
  const todayIso = dayjs().format("YYYY-MM-DD");
  if (!justifications?.length) return <Typography color="text.secondary" fontSize={13} sx={{ px: 1.5, py: 1 }}>Nessuna assenza programmata per questo mese.</Typography>;

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, 1fr)" } }}>
      {justifications.map((j) => {
        const isPast = j.end_date < todayIso;
        const isActive = j.start_date <= todayIso && j.end_date >= todayIso;
        return (
          <Box key={j.id} sx={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            px: 1.25, py: 0.5, gap: 1, borderRadius: 1.5,
            opacity: isPast ? 0.4 : 1,
            bgcolor: isActive ? "rgba(0,112,64,0.04)" : "transparent",
            "&:hover": { bgcolor: isPast ? "transparent" : "#f8f8fa" },
          }}>
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
              {!isPast && <AbsenceTypeChip type={j.justification_type} size="xs" />}
              <Typography fontSize={12} fontWeight={isPast ? 400 : 600} noWrap sx={{ color: isPast ? "text.secondary" : "text.primary", textDecoration: isPast ? "line-through" : "none" }}>
                {j.employee_name}
              </Typography>
              {isActive && <Box sx={{ px: 0.6, borderRadius: 1, bgcolor: "rgba(0,112,64,0.12)", color: "#007040", fontSize: 9, fontWeight: 800, flexShrink: 0 }}>IN CORSO</Box>}
            </Stack>
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
              <Typography fontSize={11} color="text.secondary" sx={{ textDecoration: isPast ? "line-through" : "none" }}>
                {j.start_date === j.end_date ? dayjs(j.start_date).format("DD/MM") : `${dayjs(j.start_date).format("DD/MM")} – ${dayjs(j.end_date).format("DD/MM")}`}
              </Typography>
              {!isPast && <StatusBadge status={j.approval_status} />}
            </Stack>
          </Box>
        );
      })}
    </Box>
  );
}

// ─── approver section ────────────────────────────────────────────────────────

function ApproverRequestRow({ item, onApprove, onReject, isPending, isLoading }) {
  const todayIso = dayjs().format("YYYY-MM-DD");
  const isPast = item.end_date < todayIso;
  return (
    <Box sx={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 1.5, px: 1.25, py: 0.75, borderRadius: 1.5,
      bgcolor: isPast ? "transparent" : "rgba(217,119,6,0.04)",
      "&:hover": { bgcolor: isPast ? "transparent" : "rgba(217,119,6,0.07)" },
      opacity: isPast ? 0.55 : 1,
    }}>
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
        <AbsenceTypeChip type={item.justification_type} />
        <Typography sx={{ fontSize: 13, fontWeight: 600 }} noWrap>{item.employee_name}</Typography>
      </Stack>
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexShrink: 0 }}>
        <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
          {item.start_date === item.end_date
            ? dayjs(item.start_date).format("DD/MM")
            : `${dayjs(item.start_date).format("DD/MM")} – ${dayjs(item.end_date).format("DD/MM")}`}
        </Typography>
        {isPending && (
          <>
            <Tooltip title="Approva">
              <Button
                size="small"
                disabled={isLoading}
                onClick={() => onApprove(item.justification_id)}
                sx={{ minWidth: 0, px: 1, py: 0.25, fontSize: 11, fontWeight: 700, color: "#4f772d", bgcolor: "rgba(79,119,45,0.1)", "&:hover": { bgcolor: "rgba(79,119,45,0.2)" }, borderRadius: 1 }}
              >
                Approva
              </Button>
            </Tooltip>
            <Tooltip title="Rifiuta">
              <Button
                size="small"
                disabled={isLoading}
                onClick={() => onReject(item.justification_id)}
                sx={{ minWidth: 0, px: 1, py: 0.25, fontSize: 11, fontWeight: 700, color: "#bc4749", bgcolor: "rgba(188,71,73,0.08)", "&:hover": { bgcolor: "rgba(188,71,73,0.16)" }, borderRadius: 1 }}
              >
                Rifiuta
              </Button>
            </Tooltip>
          </>
        )}
        {!isPending && <StatusBadge status={item.approval_status} />}
      </Stack>
    </Box>
  );
}

function ApprovatoreSection({ employeeId }) {
  const queryClient = useQueryClient();

  const approverQuery = useQuery({
    queryKey: ["dashboard-approver", employeeId],
    queryFn: () => getDashboardApprover(employeeId),
    enabled: Boolean(employeeId),
  });

  const mutation = useMutation({
    mutationFn: ({ justificationId, status }) =>
      updateJustificationApproval(justificationId, { approval_status: status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard-approver", employeeId] });
    },
  });

  const data = approverQuery.data;
  const hasPending = (data?.pending_requests?.length ?? 0) > 0;
  const hasRecent = (data?.recent_processed?.length ?? 0) > 0;

  if (approverQuery.isLoading || (!hasPending && !hasRecent)) return null;

  return (
    <Paper elevation={0} sx={{ border: "1.5px solid rgba(217,119,6,0.25)", borderTop: "3px solid #d97706", borderRadius: 2, overflow: "hidden" }}>
      <Box sx={{ px: 2.5, py: 1.75, borderBottom: "1px solid rgba(217,119,6,0.15)", bgcolor: "rgba(217,119,6,0.04)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Typography sx={{ fontSize: 14, fontWeight: 800, color: "#d97706" }}>Richieste da approvare</Typography>
        {hasPending && (
          <Box sx={{ px: 1.25, py: 0.25, borderRadius: 2, bgcolor: "#d97706", color: "#fff", fontSize: 12, fontWeight: 800 }}>
            {data.pending_requests.length} in attesa
          </Box>
        )}
      </Box>

      <Stack spacing={0} sx={{ p: 1.5 }}>
        {hasPending && (
          <Box>
            <SectionTitle accent="#d97706">Da gestire</SectionTitle>
            <Stack spacing={0.25}>
              {data.pending_requests.map((item) => (
                <ApproverRequestRow
                  key={item.justification_id}
                  item={item}
                  isPending
                  isLoading={mutation.isPending}
                  onApprove={(id) => mutation.mutate({ justificationId: id, status: "approved" })}
                  onReject={(id) => mutation.mutate({ justificationId: id, status: "rejected" })}
                />
              ))}
            </Stack>
          </Box>
        )}

        {hasPending && hasRecent && <Divider sx={{ my: 1.5 }} />}

        {hasRecent && (
          <Box>
            <SectionTitle accent="#6c757d">Recenti (ultimi 14 giorni)</SectionTitle>
            <Stack spacing={0.25}>
              {data.recent_processed.map((item) => (
                <ApproverRequestRow
                  key={item.justification_id}
                  item={item}
                  isPending={false}
                  isLoading={false}
                  onApprove={() => {}}
                  onReject={() => {}}
                />
              ))}
            </Stack>
          </Box>
        )}
      </Stack>
    </Paper>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { effectiveUser: user } = useAuth();
  const today = dayjs();
  const todayStr = today.format("YYYY-MM-DD");
  const weekStart = today.startOf("isoWeek").format("YYYY-MM-DD");
  const weekEnd = today.endOf("isoWeek").format("YYYY-MM-DD");
  const monthStart = today.startOf("month").format("YYYY-MM-DD");
  const monthEnd = today.endOf("month").format("YYYY-MM-DD");
  const [activeOrgCard, setActiveOrgCard] = useState(null);

  const isAdminOrHr = user?.effective_role === "admin" || user?.effective_role === "hr";
  const isManagerOrAbove = isAdminOrHr || user?.effective_role === "manager";

  const orgQuery = useQuery({
    queryKey: ["dashboard", todayStr],
    queryFn: () => getDashboard(todayStr),
    enabled: isAdminOrHr,
  });

  const meQuery = useQuery({
    queryKey: ["dashboard-me", user?.linked_employee_id, todayStr],
    queryFn: () => getDashboardMe(user.linked_employee_id, todayStr),
    enabled: Boolean(user?.linked_employee_id),
  });

  const weekQuery = useQuery({
    queryKey: ["justifications-week", weekStart, weekEnd],
    queryFn: () => getJustifications(weekStart, weekEnd),
    enabled: isAdminOrHr,
  });

  const monthQuery = useQuery({
    queryKey: ["justifications-month", monthStart, monthEnd],
    queryFn: () => getJustifications(monthStart, monthEnd),
    enabled: isAdminOrHr,
  });

  function toggleOrg(key) {
    setActiveOrgCard((prev) => (prev === key ? null : key));
  }

  const activeOrgConfig = ORG_CARDS.find((c) => c.key === activeOrgCard);
  const orgData = orgQuery.data;
  const firstName = user?.linked_employee_name ?? user?.username ?? "";
  const navigate = useNavigate();

  return (
    <Stack spacing={2.5}>

      {/* ── header ── */}
      <Paper elevation={0} sx={{ px: 3.5, py: 2.5, background: "linear-gradient(135deg, rgba(0,112,64,0.96), rgba(0,80,46,0.92))", color: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}>
        <Box>
          <Typography sx={{ fontSize: 13, opacity: 0.75, lineHeight: 1 }}>Home</Typography>
          <Typography variant="h5" sx={{ fontWeight: 800, mt: 0.25 }}>
            {firstName ? `Ciao, ${firstName}` : "Panoramica operativa"}
          </Typography>
        </Box>
        <Box sx={{ textAlign: { xs: "left", sm: "right" } }}>
          <Typography sx={{ fontSize: 20, fontWeight: 800 }}>{today.format("DD/MM/YYYY")}</Typography>
          <Typography sx={{ fontSize: 12, opacity: 0.7, mt: 0.25 }}>
            {orgData?.total_active_employees != null ? `${orgData.total_active_employees} dipendenti attivi` : "—"}
          </Typography>
        </Box>
      </Paper>

      {/* ── personale + team ── */}
      <Grid2 container spacing={2} sx={{ alignItems: "stretch" }}>

        {/* personale */}
        <Grid2 size={{ xs: 12, md: 5 }}>
          <Paper elevation={0} sx={{ border: "1.5px solid rgba(226,226,229,0.9)", borderTop: "3px solid #007040", borderRadius: 2, p: 2.5, height: "100%", boxSizing: "border-box" }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
              <Typography sx={{ fontSize: 14, fontWeight: 800, color: "#007040" }}>Le mie info</Typography>
              {user?.linked_employee_name && (
                <Typography sx={{ fontSize: 11, color: "text.disabled" }}>{user.linked_employee_name}</Typography>
              )}
            </Box>
            {!user?.linked_employee_id
              ? <EmptyState label="Profilo non collegato a un dipendente" />
              : <PersonalSection meData={meQuery.data} isLoading={meQuery.isLoading} />
            }
          </Paper>
        </Grid2>

        {/* team — visibile solo per manager e superiori */}
        {isManagerOrAbove && (
          <Grid2 size={{ xs: 12, md: 7 }}>
            <Paper elevation={0} sx={{ border: "1.5px solid rgba(226,226,229,0.9)", borderTop: "3px solid #007040", borderRadius: 2, p: 2.5, height: "100%", boxSizing: "border-box" }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
                <Typography sx={{ fontSize: 14, fontWeight: 800, color: "#007040" }}>Il mio team</Typography>
                {meQuery.data?.team_size > 0 && (
                  <Typography sx={{ fontSize: 11, color: "text.disabled" }}>{meQuery.data.team_size} riporti diretti</Typography>
                )}
              </Box>
              {!user?.linked_employee_id
                ? <EmptyState label="Profilo non collegato a un dipendente" />
                : <TeamSection meData={meQuery.data} isLoading={meQuery.isLoading} />
              }
            </Paper>
          </Grid2>
        )}
      </Grid2>

      {/* ── approvatore — visibile se è configurato come approvatore ── */}
      {user?.linked_employee_id && (
        <ApprovatoreSection employeeId={user.linked_employee_id} />
      )}

      {/* ── organizzazione — visibile solo per admin e hr ── */}
      {isAdminOrHr && (
      <Paper elevation={0} sx={{ border: "1.5px solid rgba(226,226,229,0.9)", borderTop: "3px solid #2B2B2B", borderRadius: 2, overflow: "hidden" }}>
        <Box sx={{ px: 2.5, py: 1.75, borderBottom: "1px solid rgba(226,226,229,0.9)", bgcolor: "#fafafa" }}>
          <Typography sx={{ fontSize: 14, fontWeight: 800, color: "#2B2B2B" }}>Organizzazione</Typography>
        </Box>

        <Stack spacing={2.5} sx={{ p: 2 }}>
          {/* metric cards + dipendenti attivi */}
          <Grid2 container spacing={1.5} sx={{ alignItems: "stretch" }}>
            <Grid2 size={{ xs: 12, sm: 6, md: 3 }}>
              <Paper elevation={0} sx={{ px: 2, py: 1.5, border: "1.5px solid #00704033", bgcolor: "#fff", height: "100%", boxSizing: "border-box" }}>
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                  <Typography sx={{ fontSize: 13, fontWeight: 600, color: "text.secondary" }}>Dipendenti attivi</Typography>
                  <Typography sx={{ fontSize: 22, fontWeight: 800, lineHeight: 1 }}>{orgData?.total_active_employees ?? "—"}</Typography>
                </Stack>
                {orgData?.active_by_company && Object.keys(orgData.active_by_company).length > 0 && (
                  <Stack spacing={0.35} sx={{ mt: 1, pt: 1, borderTop: "1px solid rgba(226,226,229,0.8)" }}>
                    {Object.entries(orgData.active_by_company).map(([company, count]) => (
                      <Box key={company} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
                        <Typography sx={{ fontSize: 11, color: "text.secondary", flexShrink: 1, minWidth: 0 }} noWrap title={company}>{company}</Typography>
                        <Chip
                          label={count}
                          size="small"
                          clickable
                          onClick={() => navigate(`/dipendenti?company=${encodeURIComponent(company)}`)}
                          sx={{ fontSize: 10, height: 18, fontWeight: 700, background: "#00704014", color: "#007040", flexShrink: 0, cursor: "pointer" }}
                        />
                      </Box>
                    ))}
                  </Stack>
                )}
              </Paper>
            </Grid2>
            {ORG_CARDS.map((card) => (
              <Grid2 key={card.key} size={{ xs: 12, sm: 6, md: 3 }}>
                <OrgMetricCard
                  title={card.title}
                  value={orgData?.[card.dataKey] ?? 0}
                  accent={card.accent}
                  onClick={() => toggleOrg(card.key)}
                  active={activeOrgCard === card.key}
                />
              </Grid2>
            ))}
          </Grid2>

          {/* detail panel */}
          {activeOrgConfig && orgData && (
            <OrgDetailPanel
              title={activeOrgConfig.detailTitle}
              accent={activeOrgConfig.accent}
              items={orgData[activeOrgConfig.detailKey] ?? []}
              altItems={activeOrgConfig.key === "present" ? (orgData.present_by_area ?? []) : undefined}
              altTitle="In Planner oggi · per area operativa"
            />
          )}

          {/* settimana */}
          <Box>
            <Box sx={{ display: "flex", alignItems: "baseline", gap: 1.5, mb: 1 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 700 }}>Assenze questa settimana</Typography>
              <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
                {dayjs().startOf("isoWeek").format("DD/MM")} – {dayjs().endOf("isoWeek").format("DD/MM")}
              </Typography>
            </Box>
            {weekQuery.isLoading
              ? <Typography color="text.secondary" fontSize={13}>Caricamento...</Typography>
              : <WeekAbsences justifications={weekQuery.data ?? []} />
            }
          </Box>

          <Divider />

          {/* mese */}
          <Box>
            <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", mb: 1, gap: 1, flexWrap: "wrap" }}>
              <Stack direction="row" spacing={1.5} alignItems="baseline">
                <Typography sx={{ fontSize: 13, fontWeight: 700 }}>Assenze del mese</Typography>
                <Typography sx={{ fontSize: 11, color: "text.secondary" }}>{MONTHS_IT[today.month()]} {today.year()}</Typography>
              </Stack>
              {!monthQuery.isLoading && (
                <Typography fontSize={12} color="text.secondary">
                  {(monthQuery.data ?? []).length} assenz{(monthQuery.data ?? []).length === 1 ? "a" : "e"}
                </Typography>
              )}
            </Box>
            {monthQuery.isLoading
              ? <Typography color="text.secondary" fontSize={13}>Caricamento...</Typography>
              : <MonthAbsences justifications={monthQuery.data ?? []} />
            }
          </Box>
        </Stack>
      </Paper>
      )}

    </Stack>
  );
}
