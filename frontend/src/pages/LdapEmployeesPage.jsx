import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  MenuItem,
  Paper,
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
import { useState } from "react";

import { getEmployeeOptions, getLdapEmployees, unlockLdapEmployeeLogin, updateLdapEmployeeTmsLink } from "../api";
import FilterBar from "../components/FilterBar";
import PageHeader from "../components/PageHeader";
import { bodyRowSx, headRowSx, tableSx } from "../components/tableStyles";
import { LDAP_COLUMNS } from "./ldapColumns";

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("it-IT");
}

function roleIcon(role) {
  if (role === "IMPIEGATO") {
    return "💻";
  }
  if (role === "MAGAZZINIERE") {
    return "📦";
  }
  if (role === "AUTISTA") {
    return "🚚";
  }
  if (role === "OFFICINA") {
    return "🔧";
  }
  if (role === "PULIZIE") {
    return "🧹";
  }
  return "👤";
}

function LinkableRow({ employee, employeeOptions, onSave, isSaving, onUnlock, isUnlocking }) {
  const [selectedTmsEmployeeId, setSelectedTmsEmployeeId] = useState(employee.tms_employee_id || "");

  const selectedOption =
    employeeOptions.find((option) => option.id === selectedTmsEmployeeId) || null;

  return (
    <TableRow sx={bodyRowSx()}>
      <TableCell>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography>{employee.username}</Typography>
          {employee.is_linked_to_tms && (
            <Typography component="span" sx={{ color: "#1f9d55", fontSize: 20 }} title="Collegato al TMS">
              🔗
            </Typography>
          )}
        </Stack>
      </TableCell>
      <TableCell>{employee.display_name || "-"}</TableCell>
      <TableCell>{employee.email || "-"}</TableCell>
      <TableCell>{formatDateTime(employee.first_login_at)}</TableCell>
      <TableCell>{formatDateTime(employee.last_login_at)}</TableCell>
      <TableCell>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ xs: "stretch", md: "center" }}>
          <Autocomplete
            size="small"
            fullWidth
            options={employeeOptions}
            value={selectedOption}
            onChange={(event, newValue) => setSelectedTmsEmployeeId(newValue ? newValue.id : "")}
            getOptionLabel={(option) => option.full_name || ""}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            noOptionsText="Nessun dipendente trovato"
            renderOption={(props, option) => (
              <MenuItem {...props} key={option.id}>
                {roleIcon(option.tms_role_description)} {option.full_name} ({option.tms_id})
              </MenuItem>
            )}
            renderInput={(params) => (
              <TextField {...params} placeholder="Cerca dipendente..." />
            )}
          />
          <Button
            variant="outlined"
            onClick={() => onSave(employee.id, selectedTmsEmployeeId)}
            disabled={isSaving}
            sx={{ flexShrink: 0 }}
          >
            Salva
          </Button>
        </Stack>
        {employee.tms_employee_name && (
          <Box sx={{ mt: 0.75 }}>
            <Typography variant="caption" color="text.secondary">
              Collegato a: {employee.tms_employee_name}
            </Typography>
          </Box>
        )}
      </TableCell>
      <TableCell align="center" sx={{ whiteSpace: "nowrap" }}>
        <Stack spacing={0.5} alignItems="center">
          {employee.is_login_locked && (
            <Typography variant="caption" sx={{ color: "#d97706", fontWeight: 600 }}>
              🔒 Bloccato
            </Typography>
          )}
          <Button
            size="small"
            variant={employee.is_login_locked ? "contained" : "text"}
            color={employee.is_login_locked ? "warning" : "inherit"}
            onClick={() => onUnlock(employee.id)}
            disabled={isUnlocking}
            title="Azzera i tentativi di login falliti (rate limit) per questo utente"
          >
            Sblocca
          </Button>
        </Stack>
      </TableCell>
      <TableCell align="center">
        <Box
          title={employee.is_active ? "Attivo" : "Inattivo"}
          sx={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            mx: "auto",
            bgcolor: employee.is_active ? "#22c55e" : "#9e9e9e",
            boxShadow: employee.is_active ? "0 0 4px rgba(34,197,94,0.7)" : "none",
          }}
        />
      </TableCell>
    </TableRow>
  );
}

export default function LdapEmployeesPage() {
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();

  const ldapEmployeesQuery = useQuery({
    queryKey: ["ldap-employees", search],
    queryFn: () => getLdapEmployees(search),
  });

  const employeeOptionsQuery = useQuery({
    queryKey: ["employee-options"],
    queryFn: getEmployeeOptions,
  });

  const linkMutation = useMutation({
    mutationFn: ({ ldapEmployeeId, tmsEmployeeId }) =>
      updateLdapEmployeeTmsLink(ldapEmployeeId, { tms_employee_id: tmsEmployeeId || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ldap-employees"] });
    },
  });

  const unlockMutation = useMutation({
    mutationFn: (ldapEmployeeId) => unlockLdapEmployeeLogin(ldapEmployeeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ldap-employees"] });
    },
  });

  return (
    <Stack spacing={3}>
      <PageHeader
        section="Configurazione"
        title="Mapping LDAP"
        meta={`${(ldapEmployeesQuery.data ?? []).length} utenti LDAP`}
      />

      <FilterBar onReset={() => setSearch("")} resetDisabled={!search}>
        <TextField
          size="small"
          label="Cerca per username, nome o email"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </FilterBar>

      <Paper sx={{ p: 2, borderRadius: 2 }}>
        <Stack spacing={2}>

          {ldapEmployeesQuery.error && <Alert severity="error">{ldapEmployeesQuery.error.message}</Alert>}
          {employeeOptionsQuery.error && <Alert severity="error">{employeeOptionsQuery.error.message}</Alert>}
          {linkMutation.error && <Alert severity="error">{linkMutation.error.message}</Alert>}
          {unlockMutation.error && <Alert severity="error">{unlockMutation.error.message}</Alert>}
          {unlockMutation.data && (
            <Alert severity="success" onClose={() => unlockMutation.reset()}>
              Accesso sbloccato per <strong>{unlockMutation.data.username}</strong>
              {unlockMutation.data.cleared_keys === 0 && " (non risultava bloccato)"}.
            </Alert>
          )}

          <TableContainer sx={{ overflowX: "auto" }}>
            <Table size="small" sx={tableSx({ minWidth: 940, dense: true })}>
              <TableHead>
                <TableRow sx={headRowSx}>
                  {LDAP_COLUMNS.map((column) => (
                    <TableCell key={column.key} align={column.align} sx={{ width: `${column.width}%` }}>
                      {column.label}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {(ldapEmployeesQuery.data ?? []).map((employee) => (
                  <LinkableRow
                    key={employee.id}
                    employee={employee}
                    employeeOptions={employeeOptionsQuery.data ?? []}
                    isSaving={linkMutation.isPending}
                    onSave={(ldapEmployeeId, tmsEmployeeId) => linkMutation.mutate({ ldapEmployeeId, tmsEmployeeId })}
                    isUnlocking={unlockMutation.isPending && unlockMutation.variables === employee.id}
                    onUnlock={(ldapEmployeeId) => unlockMutation.mutate(ldapEmployeeId)}
                  />
                ))}
                {!ldapEmployeesQuery.isLoading && !ldapEmployeesQuery.data?.length && (
                  <TableRow>
                    <TableCell colSpan={LDAP_COLUMNS.length}>Nessun dipendente LDAP disponibile.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Stack>
      </Paper>
    </Stack>
  );
}
