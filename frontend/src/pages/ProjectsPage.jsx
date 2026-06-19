import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Paper,
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

import { createLocalProject, deleteLocalProject, getLocalProjects, updateLocalProject } from "../api";

export default function ProjectsPage() {
  const queryClient = useQueryClient();
  const [newProject, setNewProject] = useState({ project_code: "", name: "", description: "", is_active: true });

  const projectsQuery = useQuery({
    queryKey: ["local-projects", "all"],
    queryFn: () => getLocalProjects({ activeOnly: false }),
  });

  const createMutation = useMutation({
    mutationFn: createLocalProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["local-projects"] });
      setNewProject({ project_code: "", name: "", description: "", is_active: true });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ projectId, payload }) => updateLocalProject(projectId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["local-projects"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteLocalProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["local-projects"] });
    },
  });

  function handleCreate() {
    createMutation.mutate(newProject);
  }

  return (
    <Stack spacing={3}>
      <Paper sx={{ p: 3.5, borderRadius: 4, background: "linear-gradient(135deg, rgba(0,112,64,0.96), rgba(0,80,46,0.92))", color: "#fff" }}>
        <Typography variant="overline" sx={{ opacity: 0.8 }}>Configurazione</Typography>
        <Typography variant="h4">Commesse</Typography>
        <Typography sx={{ mt: 1, maxWidth: 680, opacity: 0.9 }}>
          Definisci le commesse locali che verranno collegate alle commesse AWS nelle rendicontazioni.
        </Typography>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Typography variant="h6">Nuova commessa</Typography>
          <TextField label="Codice commessa" value={newProject.project_code} onChange={(event) => setNewProject((current) => ({ ...current, project_code: event.target.value }))} />
          <TextField label="Nome commessa" value={newProject.name} onChange={(event) => setNewProject((current) => ({ ...current, name: event.target.value }))} />
          <TextField label="Descrizione" value={newProject.description} onChange={(event) => setNewProject((current) => ({ ...current, description: event.target.value }))} multiline minRows={3} />
          {createMutation.error && <Alert severity="error">{createMutation.error.message}</Alert>}
          <Button variant="contained" onClick={handleCreate} disabled={!newProject.project_code || !newProject.name || createMutation.isPending}>
            {createMutation.isPending ? "Salvataggio..." : "Crea commessa"}
          </Button>
        </Stack>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Typography variant="h6">Commesse locali</Typography>
          {projectsQuery.error && <Alert severity="error">{projectsQuery.error.message}</Alert>}
          {updateMutation.error && <Alert severity="error">{updateMutation.error.message}</Alert>}
          {deleteMutation.error && <Alert severity="error">{deleteMutation.error.message}</Alert>}
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Codice</TableCell>
                <TableCell>Nome</TableCell>
                <TableCell>Descrizione</TableCell>
                <TableCell>Stato</TableCell>
                <TableCell>Ultima modifica</TableCell>
                <TableCell align="right">Azioni</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(projectsQuery.data ?? []).map((project) => (
                <EditableProjectRow
                  key={project.id}
                  project={project}
                  onSave={(payload) => updateMutation.mutate({ projectId: project.id, payload })}
                  onDelete={() => deleteMutation.mutate(project.id)}
                />
              ))}
            </TableBody>
          </Table>
        </Stack>
      </Paper>
    </Stack>
  );
}

function EditableProjectRow({ project, onSave, onDelete }) {
  const [form, setForm] = useState({
    project_code: project.project_code,
    name: project.name,
    description: project.description || "",
    is_active: project.is_active,
  });

  return (
    <TableRow>
      <TableCell>
        <TextField size="small" value={form.project_code} onChange={(event) => setForm((current) => ({ ...current, project_code: event.target.value }))} />
      </TableCell>
      <TableCell>
        <TextField size="small" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
      </TableCell>
      <TableCell>
        <TextField size="small" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
      </TableCell>
      <TableCell>{form.is_active ? "Attiva" : "Inattiva"}</TableCell>
      <TableCell>{new Date(project.updated_at).toLocaleString("it-IT")}</TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button variant="outlined" size="small" onClick={() => onSave(form)}>
            Salva
          </Button>
          <Button
            variant="text"
            size="small"
            color={form.is_active ? "warning" : "success"}
            onClick={() => {
              const next = { ...form, is_active: !form.is_active };
              setForm(next);
              onSave(next);
            }}
          >
            {form.is_active ? "Disattiva" : "Riattiva"}
          </Button>
          <Button variant="text" size="small" color="error" onClick={onDelete}>
            Elimina
          </Button>
        </Stack>
      </TableCell>
    </TableRow>
  );
}
