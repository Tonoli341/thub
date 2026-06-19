import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import { addTeamMember, createTeam, deleteTeam, getEmployeeOptions, getTeams, removeTeamMember, updateTeam } from "../api";

const TEAM_ICONS = [
  "🦁", "🐯", "🦊", "🐺", "🦅", "🦉", "🐬", "🦈", "🐘", "🦒",
  "🦋", "🐆", "🦝", "🦌", "🐻", "🦏", "🦬", "🦓", "🐊",
  "🦜", "🦚", "🦩", "🦢", "🦤", "🦭", "🐋", "🦑", "🐙", "🦞",
  "🐉", "🦄", "🦕", "🦖", "🐲",
  "⚡", "🔥", "🌊", "🌪️", "☄️", "🌋", "🏔️", "🧊", "🌙", "⭐",
  "🌟", "💫", "🌈", "🌩️", "❄️", "🌀", "⛰️",
  "💎", "🎯", "🛡️", "⚔️", "🚀", "💥", "🎲", "🎪", "🔱", "⚜️",
  "🏹", "🗡️", "🔰", "♾️", "🧲", "💡", "🔮", "🧿", "🎖️", "🏅",
  "🥇", "🏆", "🎗️", "🎫",
  "🚁", "✈️", "🚂", "⚓", "🛸", "🛰️", "🏎️", "🚒", "⛵",
  "🏗️", "🏰", "🗼", "🗽", "🏯", "⚙️", "🔧", "🔩", "🛠️", "🔑",
  "🍀", "🌵", "🌴", "🌿", "🍃", "🌸", "🌺", "🌻", "🍄", "🌾",
  "🍁", "🎋", "🎍", "🪨", "🪵",
  "🧗", "🏄", "🤿", "🧘", "🏋️", "🤼", "🥊", "⚽", "🏀", "🏈",
  "⚾", "🎾", "🏐", "🏉", "🎱", "🏓", "🥋",
];

const TEAM_NAMES = [
  "Alpha", "Beta", "Red", "Blue", "Cargo", "Jolly", "Digit", "Romeo",
  "Echo", "Foxtrot", "Golf", "Delta", "Kilo", "Lima", "Mike", "Sierra",
  "Tango", "Victor", "Whiskey", "Zulu", "Bravo", "Charlie", "Nova",
  "Storm", "Blaze", "Hawk", "Wolf", "Tiger", "Eagle", "Phoenix",
];

function rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getInitial(name) {
  return (name || "?").trim().charAt(0).toUpperCase() || "?";
}

function lightenColor(hex, amount = 0.16) {
  const safeHex = (hex || "#5f6b7a").replace("#", "");
  if (safeHex.length !== 6) return hex || "#5f6b7a";
  const channels = safeHex.match(/.{1,2}/g)?.map((part) => parseInt(part, 16)) ?? [95, 107, 122];
  const mixed = channels.map((channel) => Math.round(channel + (255 - channel) * amount));
  return `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`;
}

function TeamAvatar({ team, size = 40 }) {
  const bg = lightenColor(team?.color, 0.05);
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: bg,
        color: "#FFFFFF",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: team?.icon ? size * 0.5 : size * 0.4,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {team?.icon || getInitial(team?.name)}
    </Box>
  );
}

function InfoTile({ label, value, icon }) {
  return (
    <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: "action.hover" }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.25 }}>
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={600}>
        {value ? (icon ? `${icon} ${value}` : value) : "—"}
      </Typography>
    </Box>
  );
}

function SearchBar({ value, onChange }) {
  return (
    <Box
      className="search-wrapper"
      sx={{
        width: "100%",
        maxWidth: 790,
        mb: 1.5,
        display: "flex",
        alignItems: "center",
        background: "#FFFFFF",
        border: "1.6px solid rgb(226, 226, 229)",
        borderRadius: "100px",
        position: "relative",
      }}
    >
      <Box
        sx={{
          position: "absolute",
          left: 14,
          top: "50%",
          transform: "translateY(-50%)",
          color: "rgba(1, 22, 58, 0.56)",
          fontSize: 16,
          lineHeight: 1,
          pointerEvents: "none",
        }}
      >
        ⌕
      </Box>
      <Box
        component="input"
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Cerca"
        sx={{
          width: "100%",
          border: 0,
          outline: 0,
          background: "transparent",
          color: "rgb(30, 30, 49)",
          fontSize: 16,
          px: 2,
          py: 1,
          pl: 4.5,
          borderRadius: "100px",
        }}
      />
    </Box>
  );
}

const ROW_COLUMNS = { xs: "minmax(160px, 2fr) minmax(120px, 1fr) 100px", lg: "minmax(220px, 2fr) minmax(180px, 1fr) 110px" };

function TeamRow({ team, onManage }) {
  return (
    <Box
      role="row"
      onClick={() => onManage(team.id)}
      sx={{
        display: "grid",
        gridTemplateColumns: ROW_COLUMNS,
        alignItems: "center",
        minHeight: 56,
        borderBottom: "1px solid rgb(226, 226, 229)",
        cursor: "pointer",
        "&:hover": { bgcolor: "rgba(5, 31, 81, 0.03)" },
      }}
    >
      <Box role="cell" sx={{ px: 2, py: 1.5 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" minWidth={0}>
          <TeamAvatar team={team} size={36} />
          <Typography sx={{ fontSize: 14, fontWeight: 600, color: "rgb(13, 22, 38)", lineHeight: 1.3 }} noWrap>
            {team.name}
          </Typography>
        </Stack>
      </Box>

      <Box role="cell" sx={{ px: 2, py: 1.5 }}>
        {team.team_leader_employee_name ? (
          <Typography sx={{ fontSize: 13, color: "rgb(13, 22, 38)" }} noWrap>
            {team.team_leader_employee_name}
          </Typography>
        ) : (
          <Typography sx={{ fontSize: 13, color: "rgba(1, 22, 58, 0.38)", fontStyle: "italic" }}>
            Non definito
          </Typography>
        )}
      </Box>

      <Box role="cell" sx={{ px: 2, py: 1.5 }}>
        <Chip
          label={`${team.members.length} ${team.members.length === 1 ? "membro" : "membri"}`}
          size="small"
          sx={{ fontWeight: 600, fontSize: 12, bgcolor: "action.hover" }}
        />
      </Box>
    </Box>
  );
}

function IconPicker({ icon, color, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Button
          size="small"
          onClick={() => setOpen((v) => !v)}
          sx={{ textTransform: "none", fontWeight: 600, color: "text.secondary", px: 0.5, minWidth: 0 }}
        >
          Icona {icon} {open ? "▲" : "▼"}
        </Button>
        <Tooltip title="Icona casuale">
          <Button variant="text" size="small" onClick={() => onChange(rand(TEAM_ICONS))} sx={{ minWidth: 32, px: 0.5, fontSize: 16 }}>
            🎲
          </Button>
        </Tooltip>
      </Stack>
      <Collapse in={open}>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 1, maxHeight: 180, overflowY: "auto", p: 0.5 }}>
          {TEAM_ICONS.map((teamIcon) => (
            <Box
              key={teamIcon}
              onClick={() => { onChange(teamIcon); setOpen(false); }}
              sx={{
                width: 36,
                height: 36,
                display: "grid",
                placeItems: "center",
                fontSize: 20,
                cursor: "pointer",
                borderRadius: 1.5,
                border: "2px solid",
                borderColor: icon === teamIcon ? color : "transparent",
                background: icon === teamIcon ? `${color}18` : "transparent",
                "&:hover": { background: "#f5f5f5" },
              }}
            >
              {teamIcon}
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}

function ColorPicker({ color, onChange }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1.5}>
      <Typography variant="body2" fontWeight={600} color="text.secondary" sx={{ flexShrink: 0 }}>
        Colore
      </Typography>
      <Box
        component="input"
        type="color"
        value={color}
        onChange={(e) => onChange(e.target.value)}
        sx={{
          width: 36,
          height: 32,
          border: "1px solid rgba(0,0,0,0.23)",
          borderRadius: 1,
          cursor: "pointer",
          padding: "2px",
          background: "none",
          "&::-webkit-color-swatch-wrapper": { padding: 0 },
          "&::-webkit-color-swatch": { borderRadius: "4px", border: "none" },
        }}
      />
      <TextField
        size="small"
        value={color}
        onChange={(e) => {
          const v = e.target.value;
          if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(v);
        }}
        inputProps={{ maxLength: 7, style: { fontFamily: "monospace", fontSize: 13 } }}
        sx={{ width: 100 }}
      />
    </Stack>
  );
}

function TeamDialog({ open, teamId, onClose, onRequestDelete }) {
  const queryClient = useQueryClient();

  const teamsQuery = useQuery({ queryKey: ["teams"], queryFn: getTeams });
  const employeesQuery = useQuery({
    queryKey: ["employee-options"],
    queryFn: getEmployeeOptions,
    staleTime: 60000,
  });

  const team = (teamsQuery.data ?? []).find((t) => t.id === teamId) ?? null;

  const [activeTab, setActiveTab] = useState(0);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [color, setColor] = useState("#3b82f6");
  const [teamLeaderId, setTeamLeaderId] = useState(null);
  const [teamLeader2Id, setTeamLeader2Id] = useState(null);
  const [addEmployee, setAddEmployee] = useState(null);
  const [snackbar, setSnackbar] = useState(null);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    if (!open || !team) return;
    setName(team.name);
    setIcon(team.icon ?? "🦁");
    setColor(team.color ?? "#3b82f6");
    setTeamLeaderId(team.team_leader_employee_id ?? null);
    setTeamLeader2Id(team.team_leader_2_employee_id ?? null);
    setAddEmployee(null);
    setSaveError(null);
    setActiveTab(0);
  }, [open, teamId, team]);

  const memberIds = new Set(team?.members.map((m) => m.employee_id) ?? []);
  const available = (employeesQuery.data ?? []).filter((e) => !memberIds.has(e.id));
  const leaderOptions = team?.members ?? [];

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => updateTeam(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      setSnackbar("Squadra aggiornata");
      setSaveError(null);
    },
    onError: (e) => setSaveError(e?.message || "Errore durante il salvataggio"),
  });

  const addMemberMutation = useMutation({
    mutationFn: ({ tid, eid }) => addTeamMember(tid, eid),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      setAddEmployee(null);
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: ({ tid, eid }) => removeTeamMember(tid, eid),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["teams"] }),
  });

  function handleSave() {
    if (!name.trim() || !teamId) return;
    updateMutation.mutate({
      id: teamId,
      payload: {
        name: name.trim(),
        icon,
        color,
        team_leader_employee_id: teamLeaderId,
        team_leader_2_employee_id: teamLeader2Id,
      },
    });
  }

  if (!team) return null;

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        {/* Header */}
        <Box sx={{ px: 3, pt: 2, pb: 2, borderBottom: "1px solid", borderColor: "divider" }}>
          <Stack direction="row" spacing={2} alignItems="center">
            <TeamAvatar team={{ ...team, icon, color }} size={48} />
            <Box flex={1} minWidth={0}>
              <Typography variant="h6" fontWeight={800} noWrap>
                {name || team.name}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {team.members.length} {team.members.length === 1 ? "membro" : "membri"}
              </Typography>
            </Box>
            <IconButton onClick={onClose} size="small" sx={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>
              ✕
            </IconButton>
          </Stack>
        </Box>

        {/* Tabs */}
        <Box sx={{ borderBottom: "1px solid", borderColor: "divider", px: 3 }}>
          <Tabs
            value={activeTab}
            onChange={(_, v) => { setActiveTab(v); setSaveError(null); }}
            variant="scrollable"
            scrollButtons="auto"
          >
            <Tab label="Dettaglio" />
            <Tab label={`Membri (${team.members.length})`} />
          </Tabs>
        </Box>

        <DialogContent sx={{ px: 3, py: 0 }}>
          {/* Tab 0: Dettaglio */}
          {activeTab === 0 && (
            <Box sx={{ pt: 2.5, pb: 3 }}>
              {/* Info tile read-only */}
              <Box sx={{ mb: 2.5, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
                <InfoTile label="Team leader 1" value={team.team_leader_employee_name} icon="⭐" />
                <InfoTile label="Team leader 2" value={team.team_leader_2_employee_name} icon="⭐" />
              </Box>

              <Stack spacing={2}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <TextField
                    label="Nome team"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    fullWidth
                    size="small"
                  />
                  <Tooltip title="Nome casuale">
                    <Button variant="outlined" size="small" onClick={() => setName(rand(TEAM_NAMES))} sx={{ minWidth: 40, px: 1, fontSize: 18, flexShrink: 0 }}>
                      🎲
                    </Button>
                  </Tooltip>
                </Stack>

                <IconPicker icon={icon} color={color} onChange={setIcon} />
                <ColorPicker color={color} onChange={setColor} />

                <Autocomplete
                  options={leaderOptions}
                  getOptionLabel={(o) => o.employee_name}
                  value={leaderOptions.find((m) => m.employee_id === teamLeaderId) ?? null}
                  onChange={(_, v) => setTeamLeaderId(v?.employee_id ?? null)}
                  size="small"
                  clearOnEscape
                  disabled={leaderOptions.length === 0}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Team leader 1"
                      placeholder={leaderOptions.length === 0 ? "Aggiungi prima un membro" : "Seleziona il leader 1"}
                    />
                  )}
                />

                <Autocomplete
                  options={leaderOptions}
                  getOptionLabel={(o) => o.employee_name}
                  value={leaderOptions.find((m) => m.employee_id === teamLeader2Id) ?? null}
                  onChange={(_, v) => setTeamLeader2Id(v?.employee_id ?? null)}
                  size="small"
                  clearOnEscape
                  disabled={leaderOptions.length === 0}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Team leader 2"
                      placeholder={leaderOptions.length === 0 ? "Aggiungi prima un membro" : "Seleziona il leader 2"}
                    />
                  )}
                />

                {saveError && <Alert severity="error">{saveError}</Alert>}
              </Stack>
            </Box>
          )}

          {/* Tab 1: Membri */}
          {activeTab === 1 && (
            <Box sx={{ pt: 2.5, pb: 3 }}>
              <Stack spacing={0.25} sx={{ mb: 2.5 }}>
                {team.members.length === 0 && (
                  <Typography color="text.secondary" fontSize={13} sx={{ py: 1 }}>
                    Nessun membro.
                  </Typography>
                )}
                {team.members.map((member) => {
                  const isLeader = member.employee_id === team.team_leader_employee_id;
                  const isLeader2 = member.employee_id === team.team_leader_2_employee_id;
                  const isResponsabile = !isLeader && !isLeader2 && member.employee_id === team.team_leader_manager_employee_id;
                  return (
                  <Stack
                    key={member.employee_id}
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                    sx={{ px: 1.5, py: 0.9, borderRadius: 2, "&:hover": { bgcolor: "action.hover" } }}
                  >
                    <Stack direction="row" spacing={1} alignItems="center" minWidth={0} flex={1}>
                      <Typography fontSize={14} noWrap>{member.employee_name}</Typography>
                      {isLeader && (
                        <Chip
                          label="Team leader 1"
                          size="small"
                          variant="outlined"
                          sx={{ fontSize: 11, height: 20, fontWeight: 700, color: team.color, borderColor: team.color, bgcolor: `${team.color}14`, flexShrink: 0 }}
                        />
                      )}
                      {isLeader2 && (
                        <Chip
                          label="Team leader 2"
                          size="small"
                          variant="outlined"
                          sx={{ fontSize: 11, height: 20, fontWeight: 700, color: team.color, borderColor: team.color, bgcolor: `${team.color}14`, flexShrink: 0 }}
                        />
                      )}
                      {isResponsabile && (
                        <Chip
                          label="Responsabile"
                          size="small"
                          variant="outlined"
                          sx={{ fontSize: 11, height: 20, fontWeight: 700, color: "#5c3d6e", borderColor: "#5c3d6e", bgcolor: "rgba(92,61,110,0.10)", flexShrink: 0 }}
                        />
                      )}
                      {!isLeader && !isLeader2 && !isResponsabile && (
                        <Chip
                          label="Collaboratore"
                          size="small"
                          sx={{ fontSize: 11, height: 20, fontWeight: 600, color: "#4b5563", bgcolor: "rgba(107,114,128,0.10)", flexShrink: 0 }}
                        />
                      )}
                    </Stack>
                    <Button
                      size="small"
                      color="error"
                      onClick={() => removeMemberMutation.mutate({ tid: teamId, eid: member.employee_id })}
                      disabled={removeMemberMutation.isPending}
                      sx={{ minWidth: 0, px: 1, py: 0.25, borderRadius: 2, fontSize: 12, flexShrink: 0 }}
                    >
                      Rimuovi
                    </Button>
                  </Stack>
                  );
                })}
              </Stack>

              <Stack direction="row" spacing={1}>
                <Autocomplete
                  options={available}
                  getOptionLabel={(o) => o.full_name}
                  value={addEmployee}
                  onChange={(_, v) => setAddEmployee(v)}
                  size="small"
                  fullWidth
                  renderInput={(params) => <TextField {...params} label="Aggiungi membro" placeholder="Cerca dipendente..." />}
                />
                <Button
                  variant="contained"
                  disabled={!addEmployee || addMemberMutation.isPending}
                  onClick={() => addEmployee && addMemberMutation.mutate({ tid: teamId, eid: addEmployee.id })}
                  sx={{ whiteSpace: "nowrap", flexShrink: 0, textTransform: "none", bgcolor: "#007040", "&:hover": { bgcolor: "#005a32" } }}
                >
                  Aggiungi
                </Button>
              </Stack>
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2.5, justifyContent: "space-between" }}>
          <Button color="error" onClick={() => onRequestDelete(team)} sx={{ textTransform: "none" }}>
            Elimina squadra
          </Button>
          {activeTab === 0 && (
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={!name.trim() || updateMutation.isPending}
              sx={{ textTransform: "none", bgcolor: "#007040", "&:hover": { bgcolor: "#005a32" } }}
            >
              {updateMutation.isPending ? "Salvataggio..." : "Salva modifiche"}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!snackbar}
        autoHideDuration={3000}
        onClose={() => setSnackbar(null)}
        message={snackbar}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </>
  );
}

function TeamCreateDialog({ open, onClose }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState(() => rand(TEAM_ICONS));
  const [color, setColor] = useState("#3b82f6");

  useEffect(() => {
    if (!open) return;
    setName("");
    setIcon(rand(TEAM_ICONS));
    setColor("#3b82f6");
  }, [open]);

  const createMutation = useMutation({
    mutationFn: createTeam,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      onClose();
    },
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ fontWeight: 700 }}>Nuova squadra</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              label="Nome team"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              size="small"
            />
            <Tooltip title="Nome casuale">
              <Button variant="outlined" size="small" onClick={() => setName(rand(TEAM_NAMES))} sx={{ minWidth: 42, px: 1.5, fontSize: 18 }}>
                🎲
              </Button>
            </Tooltip>
          </Stack>

          <IconPicker icon={icon} color={color} onChange={setIcon} />
          <ColorPicker color={color} onChange={setColor} />

          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ p: 1.5, borderRadius: 2, bgcolor: "action.hover" }}>
            <TeamAvatar team={{ name, icon, color }} size={36} />
            <Typography fontWeight={700} fontSize={15}>{name || "Nome team"}</Typography>
          </Stack>

          {createMutation.error && <Alert severity="error">{createMutation.error.message}</Alert>}

          <Alert severity="info">Potrai definire il team leader dopo aver creato il team e aggiunto almeno un membro.</Alert>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>Annulla</Button>
        <Button
          variant="contained"
          onClick={() => createMutation.mutate({ name: name.trim(), icon, color })}
          disabled={!name.trim() || createMutation.isPending}
          sx={{ textTransform: "none", bgcolor: "#007040", "&:hover": { bgcolor: "#005a32" } }}
        >
          {createMutation.isPending ? "Creazione..." : "Crea squadra"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function SquadrePage() {
  const queryClient = useQueryClient();
  const [drawerTeamId, setDrawerTeamId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [search, setSearch] = useState("");

  const teamsQuery = useQuery({ queryKey: ["teams"], queryFn: getTeams });

  const deleteMutation = useMutation({
    mutationFn: deleteTeam,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      setDeleteConfirm(null);
      setDrawerTeamId(null);
    },
  });

  const teams = teamsQuery.data ?? [];
  const searchTerm = search.trim().toLowerCase();

  const filteredTeams = useMemo(() => {
    if (!searchTerm) return teams;
    return teams.filter((team) => {
      const haystack = [
        team.name,
        team.team_leader_employee_name,
        team.team_leader_2_employee_name,
        ...team.members.map((m) => m.employee_name),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(searchTerm);
    });
  }, [searchTerm, teams]);

  return (
    <Box sx={{ minHeight: "100%", borderRadius: 3 }}>
      <Stack spacing={3}>
        <Paper sx={{ p: 3.5, borderRadius: 4, background: "linear-gradient(135deg, rgba(0,112,64,0.96), rgba(0,80,46,0.92))", color: "#fff" }}>
          <Stack direction={{ xs: "column", md: "row" }} spacing={2} justifyContent="space-between" alignItems={{ md: "center" }}>
            <Box>
              <Typography variant="overline" sx={{ opacity: 0.8 }}>Impresa</Typography>
              <Typography variant="h4">Squadre</Typography>
              <Typography sx={{ mt: 1, maxWidth: 680, opacity: 0.9 }}>
                Gestisci le squadre operative, i membri e i team leader.
              </Typography>
            </Box>
            <Button
              onClick={() => setCreateOpen(true)}
              sx={{
                height: 36,
                px: 2.5,
                borderRadius: "18px",
                background: "rgba(255,255,255,0.15)",
                color: "#fff",
                border: "1.5px solid rgba(255,255,255,0.4)",
                fontSize: 14,
                fontWeight: 600,
                textTransform: "none",
                backdropFilter: "blur(4px)",
                "&:hover": { background: "rgba(255,255,255,0.25)" },
              }}
            >
              + Nuova squadra
            </Button>
          </Stack>
        </Paper>

        {teamsQuery.error && <Alert severity="error">{teamsQuery.error.message}</Alert>}

        <Box
          className="table-wrapper"
          sx={{
            width: "100%",
            background: "#FFFFFF",
            border: "1.6px solid rgb(226, 226, 229)",
            borderRadius: "12px",
            overflow: "hidden",
          }}
        >
          <Box sx={{ p: 2 }}>
            <SearchBar value={search} onChange={setSearch} />
          </Box>

          <Box sx={{ overflowX: "auto" }}>
            <Box role="table" sx={{ minWidth: 700 }}>
              <Box role="rowgroup">
                <Box
                  role="row"
                  sx={{
                    display: "grid",
                    gridTemplateColumns: ROW_COLUMNS,
                    alignItems: "center",
                    background: "rgba(5, 31, 81, 0.02)",
                    borderBottom: "1px solid rgb(226, 226, 229)",
                  }}
                >
                  {["Nome squadra", "Team leader", "Membri"].map((label) => (
                    <Box
                      key={label}
                      role="columnheader"
                      sx={{ px: 2, py: 1, fontSize: 12, fontWeight: 500, color: "rgba(1, 22, 58, 0.56)" }}
                    >
                      {label}
                    </Box>
                  ))}
                </Box>
              </Box>

              <Box role="rowgroup">
                {filteredTeams.map((team) => (
                  <TeamRow key={team.id} team={team} onManage={(id) => setDrawerTeamId(id)} />
                ))}

                {filteredTeams.length === 0 && !teamsQuery.isLoading && (
                  <Box sx={{ px: 3, py: 5, textAlign: "center" }}>
                    <Typography sx={{ fontSize: 15, fontWeight: 600, color: "rgb(13, 22, 38)" }}>
                      Nessuna squadra trovata
                    </Typography>
                    <Typography sx={{ mt: 0.5, fontSize: 13, color: "rgba(1, 22, 58, 0.56)" }}>
                      Modifica la ricerca oppure crea una nuova squadra.
                    </Typography>
                  </Box>
                )}
              </Box>
            </Box>
          </Box>
        </Box>
      </Stack>

      <TeamDialog
        open={!!drawerTeamId}
        teamId={drawerTeamId}
        onClose={() => setDrawerTeamId(null)}
        onRequestDelete={(team) => setDeleteConfirm(team)}
      />

      <TeamCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />

      <Dialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ fontWeight: 700 }}>Elimina squadra</DialogTitle>
        <DialogContent>
          <Typography>
            Stai per eliminare la squadra <strong>{deleteConfirm?.name}</strong>. I dipendenti non verranno eliminati.
          </Typography>
          {deleteMutation.error && <Alert severity="error" sx={{ mt: 2 }}>{deleteMutation.error.message}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)} sx={{ textTransform: "none" }}>Annulla</Button>
          <Button
            color="error"
            variant="contained"
            disabled={deleteMutation.isPending}
            onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm.id)}
            sx={{ textTransform: "none" }}
          >
            {deleteMutation.isPending ? "Eliminazione..." : "Elimina"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
