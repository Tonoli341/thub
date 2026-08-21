import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";

import { getAuditLogFilters, getAuditLogs } from "../api";
import FilterBar from "../components/FilterBar";
import FilterSelect from "../components/FilterSelect";
import PageHeader from "../components/PageHeader";
import { bodyRowSx, headRowSx, tableSx } from "../components/tableStyles";
import { AUDIT_COLUMNS } from "./auditColumns";

const ACTION_COLORS = {
  create: "success",
  update: "info",
  upsert: "info",
  delete: "error",
  login: "default",
  approve: "success",
  request_correction: "warning",
};

function formatTimestamp(value) {
  if (!value) return "—";
  const d = new Date(value);
  return `${d.toLocaleDateString("it-IT")} ${d.toLocaleTimeString("it-IT")}`;
}

function AuditRow({ item }) {
  const [open, setOpen] = useState(false);
  const hasDetail = item.detail && Object.keys(item.detail).length > 0;
  const color = ACTION_COLORS[item.action] ?? "default";

  return (
    <>
      <TableRow hover sx={{ ...bodyRowSx(), "& td": { borderBottom: open ? "none" : undefined } }}>
        <TableCell sx={{ fontSize: 12.5 }}>{formatTimestamp(item.created_at)}</TableCell>
        <TableCell sx={{ fontSize: 13, fontWeight: 600 }} title={item.actor_name || ""}>
          <Box sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.actor_name || "—"}</Box>
        </TableCell>
        <TableCell>
          <Chip size="small" label={item.action} color={color} variant="outlined" />
        </TableCell>
        <TableCell sx={{ fontSize: 13 }} title={item.entity}>
          <Box sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.entity}</Box>
        </TableCell>
        <TableCell align="right">
          {hasDetail && (
            <IconButton size="small" onClick={() => setOpen((v) => !v)} aria-label="Dettaglio">
              <Box component="span" sx={{ fontSize: 12, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s", display: "inline-block" }}>
                ▶
              </Box>
            </IconButton>
          )}
        </TableCell>
      </TableRow>
      {hasDetail && (
        <TableRow>
          <TableCell colSpan={AUDIT_COLUMNS.length} sx={{ py: 0, borderBottom: open ? undefined : "none" }}>
            <Collapse in={open} unmountOnExit>
              <Box
                component="pre"
                sx={{
                  m: 0,
                  my: 1,
                  p: 1.5,
                  borderRadius: 2,
                  bgcolor: "action.hover",
                  fontSize: 12,
                  overflowX: "auto",
                  maxHeight: 300,
                }}
              >
                {JSON.stringify(item.detail, null, 2)}
              </Box>
            </Collapse>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export default function AuditLogPage() {
  const [entity, setEntity] = useState("");
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [search, setSearch] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);

  const filtersQuery = useQuery({
    queryKey: ["audit-log-filters"],
    queryFn: getAuditLogFilters,
    staleTime: 60000,
  });

  const logsQuery = useQuery({
    queryKey: ["audit-logs", { entity, action, actor, search, start, end, page, rowsPerPage }],
    queryFn: () =>
      getAuditLogs({
        entity,
        action,
        actor,
        search,
        start,
        end,
        limit: rowsPerPage,
        offset: page * rowsPerPage,
      }),
    placeholderData: keepPreviousData,
    staleTime: 15000,
  });

  const resetPage = (setter) => (value) => {
    setter(value);
    setPage(0);
  };

  const items = logsQuery.data?.items ?? [];
  const total = logsQuery.data?.total ?? 0;
  const hasFilters = Boolean(entity || action || actor || search || start || end);

  function resetFilters() {
    setEntity("");
    setAction("");
    setActor("");
    setSearch("");
    setStart("");
    setEnd("");
    setPage(0);
  }

  return (
    <Box>
      <PageHeader
        section="Sistema"
        title="Audit"
        meta={total ? `${total.toLocaleString("it-IT")} voci` : undefined}
      />

      <Box sx={{ mt: 2, mb: 2 }}>
        <FilterBar onReset={resetFilters} resetDisabled={!hasFilters}>
          <FilterSelect
            label="Entità"
            value={entity}
            onChange={resetPage(setEntity)}
            options={filtersQuery.data?.entities ?? []}
            placeholder="Tutte"
          />
          <FilterSelect
            label="Azione"
            value={action}
            onChange={resetPage(setAction)}
            options={filtersQuery.data?.actions ?? []}
            placeholder="Tutte"
          />
          <TextField
            size="small"
            label="Utente"
            value={actor}
            onChange={(e) => resetPage(setActor)(e.target.value)}
          />
          <TextField
            size="small"
            label="Cerca nel dettaglio"
            value={search}
            onChange={(e) => resetPage(setSearch)(e.target.value)}
          />
          <TextField
            size="small"
            type="date"
            label="Dal"
            value={start}
            onChange={(e) => resetPage(setStart)(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            size="small"
            type="date"
            label="Al"
            value={end}
            onChange={(e) => resetPage(setEnd)(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
        </FilterBar>
      </Box>

      {logsQuery.isError && <Alert severity="error">{String(logsQuery.error?.message || "Errore di caricamento")}</Alert>}

      <Paper sx={{ borderRadius: 3, overflow: "hidden" }}>
        {logsQuery.isLoading ? (
          <Box sx={{ py: 6, display: "grid", placeItems: "center" }}>
            <CircularProgress size={28} />
          </Box>
        ) : (
          <>
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small" sx={tableSx({ minWidth: 680 })}>
                <TableHead>
                  <TableRow sx={headRowSx}>
                    {AUDIT_COLUMNS.map((column) => (
                      <TableCell key={column.key} align={column.align} sx={{ width: `${column.width}%` }}>
                        {column.label}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={AUDIT_COLUMNS.length} align="center" sx={{ py: 4, color: "text.secondary" }}>
                        Nessuna voce di audit per i filtri selezionati
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((item) => <AuditRow key={item.id} item={item} />)
                  )}
                </TableBody>
              </Table>
            </Box>
            <TablePagination
              component="div"
              count={total}
              page={page}
              onPageChange={(_, newPage) => setPage(newPage)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => {
                setRowsPerPage(parseInt(e.target.value, 10));
                setPage(0);
              }}
              rowsPerPageOptions={[25, 50, 100, 200]}
              labelRowsPerPage="Righe per pagina"
              labelDisplayedRows={({ from, to, count }) => `${from}–${to} di ${count}`}
            />
          </>
        )}
      </Paper>
    </Box>
  );
}
