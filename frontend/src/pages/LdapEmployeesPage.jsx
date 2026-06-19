import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";

import { getEmployeeOptions, getLdapEmployees, updateLdapEmployeeTmsLink } from "../api";

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
    return "🚜";
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

function LinkableRow({ employee, employeeOptions, onSave, isSaving }) {
  const [selectedTmsEmployeeId, setSelectedTmsEmployeeId] = useState(employee.tms_employee_id || "");

  return (
    <TableRow>
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
      <TableCell sx={{ minWidth: 360 }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ xs: "stretch", md: "center" }}>
          <Select
            size="small"
            fullWidth
            value={selectedTmsEmployeeId}
            onChange={(event) => setSelectedTmsEmployeeId(event.target.value)}
          >
            <MenuItem value="">Nessun collegamento</MenuItem>
            {employeeOptions.map((option) => (
              <MenuItem key={option.id} value={option.id}>
                {roleIcon(option.tms_role_description)} {option.full_name} ({option.tms_id})
              </MenuItem>
            ))}
          </Select>
          <Button
            variant="outlined"
            onClick={() => onSave(employee.id, selectedTmsEmployeeId)}
            disabled={isSaving}
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
      <TableCell>{employee.is_active ? "Attivo" : "Inattivo"}</TableCell>
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

  return (
    <Stack spacing={3}>
      <Paper sx={{ p: 3.5, borderRadius: 4, background: "linear-gradient(135deg, rgba(0,112,64,0.96), rgba(0,80,46,0.92))", color: "#fff" }}>
        <Typography variant="overline" sx={{ opacity: 0.8 }}>Configurazione</Typography>
        <Typography variant="h4">Mapping LDAP</Typography>
        <Typography sx={{ mt: 1, maxWidth: 680, opacity: 0.9 }}>
          Collega ogni utente LDAP al rispettivo dipendente TMS tramite matricola.
        </Typography>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Stack spacing={2}>
          <TextField
            label="Cerca per username, nome o email"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            fullWidth
          />

          {ldapEmployeesQuery.error && <Alert severity="error">{ldapEmployeesQuery.error.message}</Alert>}
          {employeeOptionsQuery.error && <Alert severity="error">{employeeOptionsQuery.error.message}</Alert>}
          {linkMutation.error && <Alert severity="error">{linkMutation.error.message}</Alert>}

          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Username</TableCell>
                <TableCell>Nome visualizzato</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Primo login</TableCell>
                <TableCell>Ultimo login</TableCell>
                <TableCell>Dipendente TMS</TableCell>
                <TableCell>Stato</TableCell>
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
                />
              ))}
              {!ldapEmployeesQuery.isLoading && !ldapEmployeesQuery.data?.length && (
                <TableRow>
                  <TableCell colSpan={7}>Nessun dipendente LDAP disponibile.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Stack>
      </Paper>
    </Stack>
  );
}
