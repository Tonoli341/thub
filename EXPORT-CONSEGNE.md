# Export sezione "Consegna DPI e vestiario" (/dotazioni)

Codice completo, verbatim, per replicare la sezione in un altro tool.
Stack: **React + MUI + react-i18next** (frontend) · **FastAPI + SQLAlchemy + Pydantic** (backend).

Dipendenze Python specifiche di questa sezione: `fastapi`, `sqlalchemy`, `pydantic`, `openpyxl` (export Excel), `python-docx` (scheda DPI Word).
Dipendenze npm: `@mui/material`, `@mui/icons-material`, `react-i18next`, `i18next`, `react-router-dom`.

## Architettura

- La pagina web `/dotazioni` ha 3 tab: **Storico consegne** (lista, segna restituito, export Excel, export scheda DPI Word per dipendente), **Dipendenti** (aggiungi/disattiva), **Materiale** (articoli con categorie `vestiario|dpi|altro` e taglie).
- **La creazione della consegna (POST `/api/deliveries` con firma base64) NON avviene da questa pagina web**: è fatta via API da un client esterno (app mobile). Il backend qui incluso la supporta completamente.
- Endpoint API:
  - `POST /api/deliveries` — crea consegne (multi-articolo, firma obbligatoria)
  - `GET /api/deliveries?status=open|returned|all&employee_id=&search=` — lista paginata
  - `GET /api/deliveries/history` — lista leggera senza firma (mobile)
  - `GET /api/deliveries/export?status=` — Excel
  - `GET /api/deliveries/export/employee/{id}` — scheda DPI Word
  - `GET /api/deliveries/{id}` / `PATCH /api/deliveries/{id}` / `POST /api/deliveries/{id}/return`
  - `GET|POST /api/employees`, `GET|PATCH /api/employees/{id}`
  - `GET|POST /api/equipment-items`, `GET|PATCH /api/equipment-items/{id}`, `GET /api/equipment-items/size-groups`

> Nota: `backend/app/services/sizes.py` esiste nel repo ma **non è importato da nessuno** (codice morto): le taglie reali vengono dai gruppi taglie a DB, seedati in `main.py`.

---

## 1. FRONTEND

### 1.1 `frontend/src/pages/Deliveries.tsx`

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  FormGroup,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { alpha, createTheme, ThemeProvider } from '@mui/material/styles';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import SearchIcon from '@mui/icons-material/Search';
import DownloadIcon from '@mui/icons-material/Download';
import DescriptionIcon from '@mui/icons-material/Description';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import AddBoxIcon from '@mui/icons-material/AddBox';
import BlockIcon from '@mui/icons-material/Block';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../lib/api';

const appTheme = createTheme({
  palette: {
    primary: { main: '#006f3d' },
    background: { default: '#f9f9f9' },
  },
  shape: { borderRadius: 12 },
  typography: { fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif' },
  components: {
    MuiButton: {
      styleOverrides: { root: { borderRadius: 8, textTransform: 'none', fontWeight: 600 } },
    },
    MuiPaper: {
      styleOverrides: { root: { borderRadius: 16, boxShadow: '0 12px 36px rgba(15,23,42,0.12)' } },
    },
  },
});

type StatusFilter = 'open' | 'returned' | 'all';

type DeliveryItem = {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_role: string | null;
  item_id: string;
  item_name: string;
  item_category: string;
  item_size: string | null;
  quantity: number;
  delivered_by: string | null;
  delivered_at: string;
  returned_at: string | null;
  notes: string | null;
  signature_b64: string;
};

type EmployeeDetail = {
  id: string;
  full_name: string;
  department: string | null;
  role: string | null;
  is_active: boolean;
  created_at: string;
};

type SizeOption = {
  id: string;
  value: string;
  sort_order: number;
};

type SizeGroup = {
  id: string;
  name: string;
  sort_order: number;
  options: SizeOption[];
};

type EquipmentItem = {
  id: string;
  name: string;
  category: string;
  is_active: boolean;
  available_sizes: string[];
  available_size_ids: string[];
};

const CATEGORIES = ['vestiario', 'dpi', 'altro'] as const;

const formatDateTime = (value: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  const adjusted = new Date(date.getTime() + 2 * 60 * 60 * 1000);
  return adjusted.toLocaleString();
};

// ─── STORICO TAB ──────────────────────────────────────────────────────────────

function StoricoTab() {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [deliveries, setDeliveries] = useState<DeliveryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [signaturePreview, setSignaturePreview] = useState<string | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportSearch, setExportSearch] = useState('');
  const [exportResults, setExportResults] = useState<EmployeeDetail[]>([]);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportSearched, setExportSearched] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const fetchDeliveries = useCallback(async (status: StatusFilter = statusFilter) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ items: DeliveryItem[] }>(`/api/deliveries?status=${status}`);
      setDeliveries(data.items);
    } catch (err: any) {
      setError(err?.message || t('formError'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, t]);

  useEffect(() => { fetchDeliveries(statusFilter); }, [statusFilter]);

  const markReturned = async (delivery: DeliveryItem) => {
    setError(null);
    setSuccess(null);
    try {
      await apiFetch(`/api/deliveries/${delivery.id}/return`, { method: 'POST', body: JSON.stringify({}) });
      setSuccess(t('deliveriesReturned'));
      fetchDeliveries(statusFilter);
    } catch (err: any) {
      setError(err?.message || t('formError'));
    }
  };

  const downloadDeliveries = () => {
    window.open(`/api/deliveries/export?status=${statusFilter}`, '_blank');
  };

  const openExportDialog = () => {
    setExportDialogOpen(true);
    setExportSearch('');
    setExportResults([]);
    setExportError(null);
    setExportSearched(false);
  };

  const closeExportDialog = () => {
    setExportDialogOpen(false);
  };

  const searchExportEmployees = async () => {
    if (!exportSearch.trim()) return;
    setExportLoading(true);
    setExportError(null);
    setExportSearched(true);
    try {
      const data = await apiFetch<{ items: EmployeeDetail[] }>(`/api/employees?size=10&search=${encodeURIComponent(exportSearch.trim())}`);
      setExportResults(data.items);
    } catch (err: any) {
      setExportError(err?.message || t('formError'));
    } finally {
      setExportLoading(false);
    }
  };

  const handleExportEmployee = (emp: EmployeeDetail) => {
    window.open(`/api/deliveries/export/employee/${emp.id}`, '_blank', 'noopener,noreferrer');
    closeExportDialog();
  };

  return (
    <Stack spacing={3}>
      {error && <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ borderRadius: 2 }}>{success}</Alert>}

      <Card sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'center' }}>
            <Typography variant="h6" sx={{ flexGrow: 1 }}>{t('deliveriesListTitle')}</Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'stretch', md: 'center' }}>
              <ToggleButtonGroup
                value={statusFilter}
                exclusive
                onChange={(_, value: StatusFilter | null) => { if (value) setStatusFilter(value); }}
                size="small"
              >
                <ToggleButton value="open">{t('deliveriesStatusOpen')}</ToggleButton>
                <ToggleButton value="returned">{t('deliveriesStatusReturned')}</ToggleButton>
                <ToggleButton value="all">{t('deliveriesStatusAll')}</ToggleButton>
              </ToggleButtonGroup>
              <Button variant="contained" startIcon={<DescriptionIcon />} onClick={openExportDialog}>
                {t('deliveriesExportWord')}
              </Button>
              <Button variant="outlined" startIcon={<DownloadIcon />} onClick={downloadDeliveries}>
                {t('downloadXlsx')}
              </Button>
              <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => fetchDeliveries(statusFilter)}>
                {t('refresh')}
              </Button>
            </Stack>
          </Stack>

          <Divider />

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress color="primary" />
            </Box>
          ) : deliveries.length === 0 ? (
            <Typography variant="body2" color="text.secondary">{t('deliveriesEmpty')}</Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('fullName')}</TableCell>
                    <TableCell>{t('deliveriesEmployeeRole')}</TableCell>
                    <TableCell>{t('deliveriesCategory')}</TableCell>
                    <TableCell>{t('deliveriesItemName')}</TableCell>
                    <TableCell>{t('deliveriesSize')}</TableCell>
                    <TableCell>{t('deliveriesQuantity')}</TableCell>
                    <TableCell>{t('deliveriesDeliveredBy')}</TableCell>
                    <TableCell>{t('deliveriesDeliveredAt')}</TableCell>
                    <TableCell>{t('deliveriesReturnedAt')}</TableCell>
                    <TableCell>{t('deliveriesSignatureColumn')}</TableCell>
                    <TableCell>{t('deliveriesNotes')}</TableCell>
                    <TableCell align="right">{t('deliveriesActions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {deliveries.map(item => (
                    <TableRow key={item.id} hover>
                      <TableCell>{item.employee_name}</TableCell>
                      <TableCell>{item.employee_role || '—'}</TableCell>
                      <TableCell>{t(`deliveriesCategory_${item.item_category}` as any)}</TableCell>
                      <TableCell>{item.item_name}</TableCell>
                      <TableCell>{item.item_size || '—'}</TableCell>
                      <TableCell>{item.quantity}</TableCell>
                      <TableCell>{item.delivered_by || '—'}</TableCell>
                      <TableCell>{formatDateTime(item.delivered_at)}</TableCell>
                      <TableCell>{formatDateTime(item.returned_at)}</TableCell>
                      <TableCell>
                        {item.signature_b64 ? (
                          <Button size="small" variant="text" onClick={() => setSignaturePreview(item.signature_b64)}>
                            {t('deliveriesViewSignature')}
                          </Button>
                        ) : '—'}
                      </TableCell>
                      <TableCell sx={{ maxWidth: 200 }}>{item.notes || '—'}</TableCell>
                      <TableCell align="right">
                        {item.returned_at ? (
                          <CheckCircleIcon color="success" fontSize="small" />
                        ) : (
                          <Button size="small" variant="outlined" startIcon={<CheckCircleIcon fontSize="small" />} onClick={() => markReturned(item)}>
                            {t('deliveriesMarkReturned')}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Stack>
      </Card>

      {/* Export Word dialog */}
      <Dialog open={exportDialogOpen} onClose={closeExportDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{t('deliveriesExportDialogTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">{t('deliveriesExportDialogDescription')}</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField
                label={t('deliveriesSearchPlaceholder')}
                value={exportSearch}
                onChange={e => setExportSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') searchExportEmployees(); }}
                fullWidth
              />
              <Button
                variant="contained"
                startIcon={exportLoading ? undefined : <SearchIcon />}
                onClick={searchExportEmployees}
                disabled={exportLoading || !exportSearch.trim()}
                sx={{ minWidth: 160 }}
              >
                {exportLoading ? <CircularProgress size={22} color="inherit" /> : t('deliveriesExportSearchButton')}
              </Button>
            </Stack>
            {exportError && <Alert severity="error">{exportError}</Alert>}
            {exportResults.length > 0 && (
              <Card variant="outlined" sx={{ borderRadius: 2 }}>
                <List dense sx={{ maxHeight: 300, overflowY: 'auto' }}>
                  {exportResults.map(emp => (
                    <ListItemButton key={emp.id} onClick={() => handleExportEmployee(emp)} sx={{ borderRadius: 1.5, mb: 0.5, mx: 0.5 }}>
                      <ListItemText primary={emp.full_name} secondary={emp.role || emp.department || ''} />
                    </ListItemButton>
                  ))}
                </List>
              </Card>
            )}
            {exportSearched && !exportLoading && !exportError && exportResults.length === 0 && (
              <Typography variant="body2" color="text.secondary">{t('deliveriesExportNoResults')}</Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeExportDialog}>{t('close')}</Button>
        </DialogActions>
      </Dialog>

      {/* Signature preview dialog */}
      <Dialog open={Boolean(signaturePreview)} onClose={() => setSignaturePreview(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('deliveriesSignaturePreviewTitle')}</DialogTitle>
        <DialogContent>
          {signaturePreview && (
            <Box component="img" src={signaturePreview} alt="firma" sx={{ width: '100%', maxHeight: 400, objectFit: 'contain' }} />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSignaturePreview(null)}>{t('close')}</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

// ─── DIPENDENTI TAB ───────────────────────────────────────────────────────────

function DipendentiTab() {
  const { t } = useTranslation();
  const [employees, setEmployees] = useState<EmployeeDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ size: '200' });
      if (search.trim()) params.set('search', search.trim());
      const data = await apiFetch<{ items: EmployeeDetail[] }>(`/api/employees?${params.toString()}`);
      setEmployees(data.items);
    } catch (err: any) {
      setError(err?.message || t('formError'));
    } finally {
      setLoading(false);
    }
  }, [search, t]);

  useEffect(() => { fetchEmployees(); }, []);

  const addEmployee = async () => {
    if (!newName.trim() || !newRole.trim()) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await apiFetch('/api/employees', {
        method: 'POST',
        body: JSON.stringify({ full_name: newName.trim(), role: newRole.trim() }),
      });
      setSuccess(t('mgmtEmployeeAdded'));
      setNewName('');
      setNewRole('');
      fetchEmployees();
    } catch (err: any) {
      setError(err?.message || t('formError'));
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (emp: EmployeeDetail) => {
    setError(null);
    try {
      await apiFetch(`/api/employees/${emp.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: false }),
      });
      fetchEmployees();
    } catch (err: any) {
      setError(err?.message || t('formError'));
    }
  };

  return (
    <Stack spacing={3}>
      {error && <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ borderRadius: 2 }}>{success}</Alert>}

      {/* Add form */}
      <Card sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} alignItems="center">
            <PersonAddIcon color="primary" />
            <Typography variant="h6">{t('mgmtEmployeeTitle')}</Typography>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label={t('mgmtEmployeeFullName')}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              fullWidth
              required
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
            />
            <TextField
              label={t('mgmtEmployeeRole')}
              value={newRole}
              onChange={e => setNewRole(e.target.value)}
              fullWidth
              required
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
            />
            <Button
              variant="contained"
              onClick={addEmployee}
              disabled={saving || !newName.trim() || !newRole.trim()}
              sx={{ minWidth: 140, alignSelf: { xs: 'stretch', sm: 'center' } }}
            >
              {saving ? <CircularProgress size={22} color="inherit" /> : t('mgmtAdd')}
            </Button>
          </Stack>
        </Stack>
      </Card>

      {/* List */}
      <Card sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'stretch', sm: 'center' }}>
            <Typography variant="h6" sx={{ flexGrow: 1 }}>{t('mgmtEmployeeListTitle')}</Typography>
            <Stack direction="row" spacing={1}>
              <TextField
                label={t('mgmtSearch')}
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') fetchEmployees(); }}
                size="small"
                sx={{ minWidth: 200 }}
              />
              <Button variant="outlined" startIcon={<SearchIcon />} onClick={fetchEmployees} size="small">
                {t('mgmtSearch')}
              </Button>
              <IconButton onClick={fetchEmployees} color="primary" size="small">
                <RefreshIcon />
              </IconButton>
            </Stack>
          </Stack>
          <Divider />
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress color="primary" />
            </Box>
          ) : employees.length === 0 ? (
            <Typography variant="body2" color="text.secondary">{t('mgmtEmployeeEmpty')}</Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('fullName')}</TableCell>
                    <TableCell>{t('deliveriesEmployeeRole')}</TableCell>
                    <TableCell>{t('mgmtCreatedAt')}</TableCell>
                    <TableCell align="right">{t('deliveriesActions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {employees.map(emp => (
                    <TableRow key={emp.id} hover>
                      <TableCell>{emp.full_name}</TableCell>
                      <TableCell>{emp.role || '—'}</TableCell>
                      <TableCell>{formatDateTime(emp.created_at)}</TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          startIcon={<BlockIcon fontSize="small" />}
                          onClick={() => deactivate(emp)}
                        >
                          {t('mgmtDeactivate')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}

// ─── MATERIALE TAB ────────────────────────────────────────────────────────────

function MaterialeTab() {
  const { t } = useTranslation();
  const [items, setItems] = useState<EquipmentItem[]>([]);
  const [sizeGroups, setSizeGroups] = useState<SizeGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<string>('vestiario');
  const [selectedSizeIds, setSelectedSizeIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<EquipmentItem[]>('/api/equipment-items?include_inactive=true');
      setItems(data);
    } catch (err: any) {
      setError(err?.message || t('formError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchItems();
    apiFetch<SizeGroup[]>('/api/equipment-items/size-groups')
      .then(setSizeGroups)
      .catch(() => {});
  }, []);

  const toggleSizeId = (id: string) => {
    setSelectedSizeIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleGroup = (group: SizeGroup) => {
    const groupIds = group.options.map(o => o.id);
    const allSelected = groupIds.every(id => selectedSizeIds.includes(id));
    if (allSelected) {
      setSelectedSizeIds(prev => prev.filter(id => !groupIds.includes(id)));
    } else {
      setSelectedSizeIds(prev => [...prev, ...groupIds.filter(id => !prev.includes(id))]);
    }
  };

  const addItem = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await apiFetch('/api/equipment-items', {
        method: 'POST',
        body: JSON.stringify({
          name: newName.trim(),
          category: newCategory,
          available_size_ids: selectedSizeIds,
        }),
      });
      setSuccess(t('mgmtItemAdded'));
      setNewName('');
      setSelectedSizeIds([]);
      fetchItems();
    } catch (err: any) {
      setError(err?.message || t('formError'));
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (item: EquipmentItem) => {
    setError(null);
    try {
      await apiFetch(`/api/equipment-items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: false }),
      });
      fetchItems();
    } catch (err: any) {
      setError(err?.message || t('formError'));
    }
  };

  const reactivate = async (item: EquipmentItem) => {
    setError(null);
    try {
      await apiFetch(`/api/equipment-items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: true }),
      });
      fetchItems();
    } catch (err: any) {
      setError(err?.message || t('formError'));
    }
  };

  const categoryLabel = (cat: string) => t(`deliveriesCategory_${cat}` as any);

  const categoryColor = (cat: string): 'success' | 'warning' | 'default' => {
    if (cat === 'dpi') return 'warning';
    if (cat === 'vestiario') return 'success';
    return 'default';
  };

  return (
    <Stack spacing={3}>
      {error && <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ borderRadius: 2 }}>{success}</Alert>}

      {/* Add form */}
      <Card sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} alignItems="center">
            <AddBoxIcon color="primary" />
            <Typography variant="h6">{t('mgmtItemTitle')}</Typography>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} flexWrap="wrap">
            <TextField
              label={t('mgmtItemName')}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              required
              sx={{ flexGrow: 1, minWidth: 200, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
            />
            <TextField
              select
              label={t('deliveriesCategory')}
              value={newCategory}
              onChange={e => setNewCategory(e.target.value)}
              sx={{ minWidth: 160, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
            >
              {CATEGORIES.map(cat => (
                <MenuItem key={cat} value={cat}>{categoryLabel(cat)}</MenuItem>
              ))}
            </TextField>
          </Stack>

          {/* Size picker */}
          {sizeGroups.length > 0 && (
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2 }}>
              <Typography variant="subtitle2" gutterBottom color="text.secondary">
                {t('mgmtItemSizes')}
              </Typography>
              <Stack spacing={1.5}>
                {sizeGroups.map(group => {
                  const groupIds = group.options.map(o => o.id);
                  const allSelected = groupIds.every(id => selectedSizeIds.includes(id));
                  const someSelected = groupIds.some(id => selectedSizeIds.includes(id));
                  return (
                    <Box key={group.id}>
                      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 0.5 }}>
                        <Checkbox
                          size="small"
                          checked={allSelected}
                          indeterminate={someSelected && !allSelected}
                          onChange={() => toggleGroup(group)}
                          sx={{ p: 0.5 }}
                        />
                        <Typography variant="caption" fontWeight={600} color="text.primary">
                          {group.name}
                        </Typography>
                      </Stack>
                      <FormGroup row sx={{ pl: 1, gap: 0 }}>
                        {group.options.map(opt => (
                          <FormControlLabel
                            key={opt.id}
                            control={
                              <Checkbox
                                size="small"
                                checked={selectedSizeIds.includes(opt.id)}
                                onChange={() => toggleSizeId(opt.id)}
                                sx={{ py: 0.25 }}
                              />
                            }
                            label={<Typography variant="body2">{opt.value}</Typography>}
                            sx={{ mr: 1 }}
                          />
                        ))}
                      </FormGroup>
                    </Box>
                  );
                })}
              </Stack>
            </Box>
          )}

          <Button
            variant="contained"
            onClick={addItem}
            disabled={saving || !newName.trim()}
            sx={{ alignSelf: 'flex-start', minWidth: 140 }}
          >
            {saving ? <CircularProgress size={22} color="inherit" /> : t('mgmtAdd')}
          </Button>
        </Stack>
      </Card>

      {/* List */}
      <Card sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
            <Typography variant="h6">{t('mgmtItemListTitle')}</Typography>
            <IconButton onClick={fetchItems} color="primary" size="small">
              <RefreshIcon />
            </IconButton>
          </Stack>
          <Divider />
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress color="primary" />
            </Box>
          ) : items.length === 0 ? (
            <Typography variant="body2" color="text.secondary">{t('mgmtItemEmpty')}</Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('mgmtItemName')}</TableCell>
                    <TableCell>{t('deliveriesCategory')}</TableCell>
                    <TableCell>{t('mgmtItemSizes')}</TableCell>
                    <TableCell>{t('mgmtStatus')}</TableCell>
                    <TableCell align="right">{t('deliveriesActions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.map(item => (
                    <TableRow key={item.id} hover sx={{ opacity: item.is_active ? 1 : 0.5 }}>
                      <TableCell>{item.name}</TableCell>
                      <TableCell>
                        <Chip label={categoryLabel(item.category)} color={categoryColor(item.category)} size="small" />
                      </TableCell>
                      <TableCell>
                        {item.available_sizes?.length
                          ? item.available_sizes.join(', ')
                          : <Typography component="span" variant="body2" color="text.disabled">—</Typography>}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={item.is_active ? t('mgmtActive') : t('mgmtInactive')}
                          color={item.is_active ? 'success' : 'default'}
                          size="small"
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell align="right">
                        {item.is_active ? (
                          <Button size="small" variant="outlined" color="error" startIcon={<BlockIcon fontSize="small" />} onClick={() => deactivate(item)}>
                            {t('mgmtDeactivate')}
                          </Button>
                        ) : (
                          <Button size="small" variant="outlined" color="success" onClick={() => reactivate(item)}>
                            {t('mgmtReactivate')}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function DeliveriesPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState(0);

  return (
    <ThemeProvider theme={appTheme}>
      <Box sx={{ backgroundColor: 'background.default', minHeight: '100%', py: { xs: 2, md: 4 } }}>
        <Stack spacing={3} sx={{ px: { xs: 2, md: 5 }, maxWidth: 1440, mx: 'auto', width: '100%' }}>
          <Stack spacing={0.5}>
            <Typography variant="h4" sx={{ fontWeight: 700, color: 'primary.main' }}>
              {t('deliveriesTitle')}
            </Typography>
            <Typography variant="body1" color="text.secondary">
              {t('deliveriesSubtitle')}
            </Typography>
          </Stack>

          <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tabs value={tab} onChange={(_, v) => setTab(v)}>
              <Tab label={t('deliveriesTabHistory')} />
              <Tab label={t('deliveriesTabEmployees')} />
              <Tab label={t('deliveriesTabItems')} />
            </Tabs>
          </Box>

          {tab === 0 && <StoricoTab />}
          {tab === 1 && <DipendentiTab />}
          {tab === 2 && <MaterialeTab />}
        </Stack>
      </Box>
    </ThemeProvider>
  );
}
```

### 1.2 `frontend/src/lib/api.ts`

```ts
export async function apiFetch<T = any>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (!headers.has('Accept-Language') && typeof navigator !== 'undefined') {
    headers.set('Accept-Language', navigator.language || 'it');
  }
  const response = await fetch(input, { ...init, headers });
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  if (response.ok) {
    return (isJson ? response.json() : (response.text() as any)) as Promise<T>;
  }

  let payload: any = null;
  try {
    payload = isJson ? await response.json() : await response.text();
  } catch (_) {
    // ignore
  }
  const message = typeof payload === 'string' ? payload : (payload?.detail || payload?.message || response.statusText);
  const error = new Error(message || 'Request failed');
  (error as any).status = response.status;
  (error as any).payload = payload;
  throw error;
}
```

### 1.3 Route in `frontend/src/App.tsx` (estratto)

```tsx
import DeliveriesPage from './pages/Deliveries';
// ...
<Route path="/dotazioni" element={<DeliveriesPage />} />
```

### 1.4 Chiavi i18n (`frontend/src/i18n.ts`, estratto — sezione consegne)

Italiano (`it`):

```ts
downloadXlsx: 'Esporta Excel',
refresh: 'Aggiorna',
close: 'Chiudi',
formError: 'Errore durante la registrazione',
fullName: 'Nome e Cognome',
deliveriesTitle: 'Consegna DPI e vestiario',
deliveriesSubtitle: 'Registra consegne e restituzioni del materiale consegnato ai dipendenti.',
deliveriesFindEmployee: 'Seleziona dipendente',
deliveriesEmployeeBadge: 'Badge dipendente',
deliveriesEmployeeBadgeShort: 'Badge',
deliveriesEmployeeNoDetails: 'Nessuna informazione aggiuntiva',
deliveriesSearchBadge: 'Cerca badge',
deliveriesSearchPlaceholder: 'Cerca per nome o ruolo',
deliveriesSearchButton: 'Cerca dipendente',
deliveriesSearchResults: 'Risultati',
deliveriesSearchEmpty: 'Nessun dipendente trovato',
deliveriesEmployeeLoaded: 'Dipendente selezionato',
deliveriesFormTitle: 'Dettagli consegna',
deliveriesCategory: 'Categoria',
deliveriesCategory_vestiario: 'Vestiario',
deliveriesCategory_dpi: 'DPI',
deliveriesCategory_altro: 'Altro',
deliveriesItemName: 'Articolo',
deliveriesSize: 'Taglia',
deliveriesQuantity: 'Quantità',
deliveriesDeliveredBy: 'Consegnato da',
deliveriesNotes: 'Note',
deliveriesSubmit: 'Registra consegna',
deliveriesCreated: 'Consegna registrata',
deliveriesReturned: 'Restituzione registrata',
deliveriesListTitle: 'Storico consegne',
deliveriesStatusOpen: 'Aperte',
deliveriesStatusReturned: 'Restituite',
deliveriesStatusAll: 'Tutte',
deliveriesLoading: 'Caricamento consegne…',
deliveriesEmpty: 'Nessuna consegna trovata',
deliveriesDeliveredAt: 'Consegnato il',
deliveriesReturnedAt: 'Restituito il',
deliveriesActions: 'Azioni',
deliveriesMarkReturned: 'Segna restituito',
deliveriesEmployeeBadgeColumn: 'Badge',
deliveriesEmployeeRole: 'Ruolo',
deliveriesSignatureColumn: 'Firma',
deliveriesViewSignature: 'Mostra',
deliveriesSignaturePreviewTitle: 'Firma del dipendente',
deliveriesItemsTitle: 'Seleziona indumenti',
deliveriesItemsSubtitle: 'Spunta i vestiari che il dipendente riceve.',
deliveriesNoItems: 'Nessun vestiario configurato. Inserisci gli articoli nel database.',
deliveriesSignatureTitle: 'Firma del dipendente',
deliveriesSignatureInstructions: 'Apponi la tua firma nello spazio sottostante.',
deliveriesSignatureHint: 'La firma è obbligatoria per confermare la consegna.',
deliveriesExportWord: 'Esporta scheda DPI',
deliveriesExportDialogTitle: 'Esporta scheda DPI',
deliveriesExportDialogDescription: 'Cerca il dipendente per scaricare la scheda in formato Word.',
deliveriesExportSearchButton: 'Cerca e scarica',
deliveriesExportNoResults: 'Nessun dipendente trovato',
deliveriesTabHistory: 'Storico consegne',
deliveriesTabEmployees: 'Dipendenti',
deliveriesTabItems: 'Materiale',
mgmtEmployeeTitle: 'Aggiungi dipendente',
mgmtEmployeeFullName: 'Nome e cognome',
mgmtEmployeeRole: 'Ruolo',
mgmtEmployeeAdded: 'Dipendente aggiunto con successo',
mgmtEmployeeListTitle: 'Dipendenti registrati',
mgmtEmployeeEmpty: 'Nessun dipendente trovato',
mgmtItemTitle: 'Aggiungi articolo',
mgmtItemName: 'Nome articolo',
mgmtItemSizes: 'Taglie disponibili',
mgmtItemAdded: 'Articolo aggiunto con successo',
mgmtItemListTitle: 'Articoli registrati',
mgmtItemEmpty: 'Nessun articolo trovato',
mgmtAdd: 'Aggiungi',
mgmtSearch: 'Cerca',
mgmtDeactivate: 'Disattiva',
mgmtReactivate: 'Riattiva',
mgmtActive: 'Attivo',
mgmtInactive: 'Disattivo',
mgmtStatus: 'Stato',
mgmtCreatedAt: 'Inserito il',
```

Inglese (`en`):

```ts
downloadXlsx: 'Export Excel',
refresh: 'Refresh',
close: 'Close',
formError: 'Registration failed',
fullName: 'Full name',
deliveriesTitle: 'PPE and clothing deliveries',
deliveriesSubtitle: 'Track equipment handovers and returns for employees.',
deliveriesFindEmployee: 'Select employee',
deliveriesEmployeeBadge: 'Employee badge',
deliveriesEmployeeBadgeShort: 'Badge',
deliveriesEmployeeNoDetails: 'No additional details',
deliveriesSearchBadge: 'Find badge',
deliveriesSearchPlaceholder: 'Search by name or role',
deliveriesSearchButton: 'Search employee',
deliveriesSearchResults: 'Results',
deliveriesSearchEmpty: 'No employees found',
deliveriesEmployeeLoaded: 'Employee selected',
deliveriesFormTitle: 'Delivery details',
deliveriesCategory: 'Category',
deliveriesCategory_vestiario: 'Clothing',
deliveriesCategory_dpi: 'PPE',
deliveriesCategory_altro: 'Other',
deliveriesItemName: 'Item',
deliveriesSize: 'Size',
deliveriesQuantity: 'Quantity',
deliveriesDeliveredBy: 'Delivered by',
deliveriesNotes: 'Notes',
deliveriesSubmit: 'Save delivery',
deliveriesCreated: 'Delivery saved',
deliveriesReturned: 'Return saved',
deliveriesListTitle: 'Delivery history',
deliveriesStatusOpen: 'Open',
deliveriesStatusReturned: 'Returned',
deliveriesStatusAll: 'All',
deliveriesLoading: 'Loading deliveries…',
deliveriesEmpty: 'No deliveries recorded',
deliveriesDeliveredAt: 'Delivered on',
deliveriesReturnedAt: 'Returned on',
deliveriesActions: 'Actions',
deliveriesMarkReturned: 'Mark returned',
deliveriesEmployeeBadgeColumn: 'Badge',
deliveriesEmployeeRole: 'Role',
deliveriesSignatureColumn: 'Signature',
deliveriesViewSignature: 'View',
deliveriesSignaturePreviewTitle: 'Employee signature',
deliveriesItemsTitle: 'Select garments',
deliveriesItemsSubtitle: 'Tick the clothing/PPE handed to the employee.',
deliveriesNoItems: 'No garments configured. Insert them in the database.',
deliveriesSignatureTitle: 'Employee signature',
deliveriesSignatureInstructions: 'Sign inside the area below.',
deliveriesSignatureHint: 'Signature is mandatory to confirm the delivery.',
deliveriesExportWord: 'Export PPE sheet',
deliveriesExportDialogTitle: 'Export PPE sheet',
deliveriesExportDialogDescription: 'Search the employee to download the Word form.',
deliveriesExportSearchButton: 'Search and download',
deliveriesExportNoResults: 'No employees found',
deliveriesTabHistory: 'Delivery history',
deliveriesTabEmployees: 'Employees',
deliveriesTabItems: 'Equipment',
mgmtEmployeeTitle: 'Add employee',
mgmtEmployeeFullName: 'Full name',
mgmtEmployeeRole: 'Role',
mgmtEmployeeAdded: 'Employee added successfully',
mgmtEmployeeListTitle: 'Registered employees',
mgmtEmployeeEmpty: 'No employees found',
mgmtItemTitle: 'Add item',
mgmtItemName: 'Item name',
mgmtItemSizes: 'Available sizes',
mgmtItemAdded: 'Item added successfully',
mgmtItemListTitle: 'Registered items',
mgmtItemEmpty: 'No items found',
mgmtAdd: 'Add',
mgmtSearch: 'Search',
mgmtDeactivate: 'Deactivate',
mgmtReactivate: 'Reactivate',
mgmtActive: 'Active',
mgmtInactive: 'Inactive',
mgmtStatus: 'Status',
mgmtCreatedAt: 'Added on',
```

---

## 2. BACKEND

### 2.1 Modelli SQLAlchemy (`backend/app/models.py`, estratto — solo classi della sezione consegne)

```python
import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Table, Text, Index
from sqlalchemy.orm import relationship, Mapped, mapped_column

from .db import Base


class SizeGroup(Base):
    __tablename__ = "size_groups"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    options: Mapped[list["SizeOption"]] = relationship(
        "SizeOption", back_populates="group", order_by="SizeOption.sort_order", cascade="all,delete-orphan"
    )


class SizeOption(Base):
    __tablename__ = "size_options"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    group_id: Mapped[str] = mapped_column(String(36), ForeignKey("size_groups.id"), nullable=False, index=True)
    value: Mapped[str] = mapped_column(String(40), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    group: Mapped["SizeGroup"] = relationship("SizeGroup", back_populates="options")


equipment_item_sizes = Table(
    "equipment_item_sizes",
    Base.metadata,
    Column("item_id", String(36), ForeignKey("equipment_items.id"), primary_key=True),
    Column("size_option_id", String(36), ForeignKey("size_options.id"), primary_key=True),
)


class Employee(Base):
    __tablename__ = "employees"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    department: Mapped[str | None] = mapped_column(String(120), nullable=True)
    role: Mapped[str | None] = mapped_column(String(120), nullable=True)
    email: Mapped[str | None] = mapped_column(String(200), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    deliveries: Mapped[list["EquipmentDelivery"]] = relationship(
        "EquipmentDelivery",
        back_populates="employee",
        cascade="all,delete-orphan",
    )

    __table_args__ = (
        Index("ix_employees_full_name", "full_name"),
    )


class EquipmentItem(Base):
    __tablename__ = "equipment_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    category: Mapped[str] = mapped_column(String(30), nullable=False)
    size: Mapped[str | None] = mapped_column(String(40), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    deliveries: Mapped[list["EquipmentDelivery"]] = relationship("EquipmentDelivery", back_populates="item")
    available_size_options: Mapped[list["SizeOption"]] = relationship(
        "SizeOption", secondary="equipment_item_sizes"
    )

    __table_args__ = (
        Index("ix_equipment_items_name", "name"),
    )


class EquipmentDelivery(Base):
    __tablename__ = "equipment_deliveries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False, index=True)
    item_id: Mapped[str] = mapped_column(String(36), ForeignKey("equipment_items.id"), nullable=False, index=True)
    item_name: Mapped[str] = mapped_column(String(120), nullable=False)
    item_category: Mapped[str] = mapped_column(String(30), nullable=False)
    item_size: Mapped[str | None] = mapped_column(String(40), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    delivered_by: Mapped[str] = mapped_column(String(120), nullable=False, default="Raffaella Cafasso")
    delivered_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    returned_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    signature_b64: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    employee: Mapped[Employee] = relationship("Employee", back_populates="deliveries")
    item: Mapped[EquipmentItem] = relationship("EquipmentItem", back_populates="deliveries")

    __table_args__ = (
        Index("ix_equipment_deliveries_category", "item_category"),
        Index("ix_equipment_deliveries_returned", "returned_at"),
    )
```

### 2.2 Schemi Pydantic (`backend/app/schemas.py`, estratto)

```python
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field


class SignaturePayload(BaseModel):
    image_b64: str = Field(..., description="Base64 PNG data URL or raw base64 string")


EquipmentCategory = Literal['vestiario', 'dpi', 'altro']


class EmployeeBase(BaseModel):
    full_name: str
    department: str | None = Field(None, max_length=120)
    role: str | None = Field(None, max_length=120)
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(None, max_length=40)
    notes: Optional[str] = None


class EmployeeCreate(EmployeeBase):
    full_name: str = Field(..., min_length=2, max_length=200)


class EmployeeUpdate(BaseModel):
    full_name: Optional[str] = Field(None, min_length=2, max_length=200)
    department: Optional[str] = Field(None, max_length=120)
    role: Optional[str] = Field(None, max_length=120)
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(None, max_length=40)
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class EmployeeOut(EmployeeBase):
    id: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class PaginatedEmployees(BaseModel):
    items: list[EmployeeOut]
    total: int
    page: int
    size: int


class EquipmentDeliveryItem(BaseModel):
    item_id: str
    size: Optional[str] = Field(None, max_length=40)
    quantity: int = Field(1, ge=1, description="Numero di pezzi consegnati")


class EquipmentDeliveryCreate(BaseModel):
    employee_id: str
    items: list[EquipmentDeliveryItem] = Field(..., min_items=1)
    delivered_by: Optional[str] = Field(None, max_length=120)
    delivered_at: Optional[datetime] = None
    notes: Optional[str] = None
    signature: SignaturePayload


class EquipmentDeliveryUpdate(BaseModel):
    delivered_by: Optional[str] = Field(None, max_length=120)
    delivered_at: Optional[datetime] = None
    notes: Optional[str] = None
    returned_at: Optional[datetime] = None


class EquipmentDeliveryReturn(BaseModel):
    returned_at: Optional[datetime] = None


class EquipmentDeliveryOut(BaseModel):
    id: str
    employee_id: str
    employee_name: str
    employee_role: Optional[str]
    item_id: str
    item_name: str
    item_category: EquipmentCategory
    item_size: Optional[str]
    quantity: int
    delivered_by: Optional[str]
    delivered_at: datetime
    returned_at: Optional[datetime]
    notes: Optional[str]
    signature_b64: str
    created_at: datetime
    updated_at: datetime


class PaginatedDeliveries(BaseModel):
    items: list[EquipmentDeliveryOut]
    total: int
    page: int
    size: int


class SizeOptionOut(BaseModel):
    id: str
    value: str
    sort_order: int


class SizeGroupOut(BaseModel):
    id: str
    name: str
    sort_order: int
    options: list[SizeOptionOut]


class EquipmentItemCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    category: EquipmentCategory
    notes: Optional[str] = None
    available_size_ids: list[str] = []


class EquipmentItemUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=120)
    category: Optional[EquipmentCategory] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None
    available_size_ids: Optional[list[str]] = None


class EquipmentItemOut(BaseModel):
    id: str
    name: str
    category: EquipmentCategory
    notes: Optional[str]
    is_active: bool
    available_sizes: list[str] = []
    available_size_ids: list[str] = []

    class Config:
        from_attributes = True


class EquipmentDeliveryListOut(BaseModel):
    """Versione leggera per liste/storico: senza signature_b64."""
    id: str
    employee_id: str
    employee_name: str
    employee_role: Optional[str]
    item_id: str
    item_name: str
    item_category: EquipmentCategory
    item_size: Optional[str]
    quantity: int
    delivered_by: Optional[str]
    delivered_at: datetime
    returned_at: Optional[datetime]
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime


class PaginatedDeliveriesList(BaseModel):
    items: list[EquipmentDeliveryListOut]
    total: int
    page: int
    size: int
```

### 2.3 Serializer (`backend/app/serializers.py`, estratto)

```python
def employee_out(employee: Employee) -> EmployeeOut:
    return EmployeeOut(
        id=employee.id,
        full_name=employee.full_name,
        department=employee.department,
        role=employee.role,
        email=employee.email,
        phone=employee.phone,
        notes=employee.notes,
        is_active=employee.is_active,
        created_at=employee.created_at,
        updated_at=employee.updated_at,
    )


def delivery_out(delivery: EquipmentDelivery) -> EquipmentDeliveryOut:
    employee = delivery.employee
    item = delivery.item
    return EquipmentDeliveryOut(
        id=delivery.id,
        employee_id=employee.id if employee else delivery.employee_id,
        employee_name=employee.full_name if employee else "",
        employee_role=employee.role if employee else None,
        item_id=item.id if item else delivery.item_id,
        item_category=delivery.item_category,
        item_name=delivery.item_name,
        item_size=delivery.item_size,
        quantity=delivery.quantity,
        delivered_by=delivery.delivered_by,
        delivered_at=delivery.delivered_at,
        returned_at=delivery.returned_at,
        notes=delivery.notes,
        signature_b64=delivery.signature_b64,
        created_at=delivery.created_at,
        updated_at=delivery.updated_at,
    )


def equipment_item_out(item: EquipmentItem) -> EquipmentItemOut:
    opts = sorted(item.available_size_options, key=lambda o: (o.group_id, o.sort_order))
    return EquipmentItemOut(
        id=item.id,
        name=item.name,
        category=item.category,
        notes=item.notes,
        is_active=item.is_active,
        available_sizes=[o.value for o in opts],
        available_size_ids=[o.id for o in opts],
    )


def delivery_list_out(delivery: EquipmentDelivery) -> EquipmentDeliveryListOut:
    employee = delivery.employee
    item = delivery.item
    return EquipmentDeliveryListOut(
        id=delivery.id,
        employee_id=employee.id if employee else delivery.employee_id,
        employee_name=employee.full_name if employee else "",
        employee_role=employee.role if employee else None,
        item_id=item.id if item else delivery.item_id,
        item_category=delivery.item_category,
        item_name=delivery.item_name,
        item_size=delivery.item_size,
        quantity=delivery.quantity,
        delivered_by=delivery.delivered_by,
        delivered_at=delivery.delivered_at,
        returned_at=delivery.returned_at,
        notes=delivery.notes,
        created_at=delivery.created_at,
        updated_at=delivery.updated_at,
    )
```

### 2.4 `backend/app/routes/deliveries.py`

```python
from __future__ import annotations

from datetime import datetime
import re
import unicodedata
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..logging import logger
from ..models import Employee, EquipmentDelivery, EquipmentItem
from ..schemas import (
    EquipmentDeliveryCreate,
    EquipmentDeliveryListOut,
    EquipmentDeliveryOut,
    EquipmentDeliveryReturn,
    EquipmentDeliveryUpdate,
    PaginatedDeliveries,
    PaginatedDeliveriesList,
)
from ..serializers import delivery_list_out, delivery_out
from ..services.audit import log_action
from ..services.deliveries_export import export_deliveries_xlsx
from ..services.deliveries_ppe_docx import export_employee_deliveries_docx

router = APIRouter(prefix="/deliveries", tags=["deliveries"])


def _apply_filters(stmt, status: str, employee_id: Optional[str], search: Optional[str]):
    if employee_id:
        stmt = stmt.where(EquipmentDelivery.employee_id == employee_id)

    status_value = status.lower()
    if status_value == "open":
        stmt = stmt.where(EquipmentDelivery.returned_at.is_(None))
    elif status_value == "returned":
        stmt = stmt.where(EquipmentDelivery.returned_at.is_not(None))
    elif status_value != "all":
        raise HTTPException(status_code=400, detail="invalid_status")

    if search:
        pattern = f"%{search.lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(EquipmentDelivery.item_name).like(pattern),
                func.lower(func.coalesce(EquipmentDelivery.item_category, "")).like(pattern),
                func.lower(Employee.full_name).like(pattern),
                func.lower(func.coalesce(Employee.role, "")).like(pattern),
            )
        )

    return stmt


@router.post("", response_model=list[EquipmentDeliveryOut], status_code=201)
def create_delivery(
    payload: EquipmentDeliveryCreate,
    db: Session = Depends(get_db),
) -> list[EquipmentDeliveryOut]:
    employee = db.get(Employee, payload.employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="employee_not_found")

    if not payload.signature.image_b64.strip():
        raise HTTPException(status_code=400, detail="signature_required")

    item_ids = [entry.item_id for entry in payload.items]
    stmt = select(EquipmentItem).where(EquipmentItem.id.in_(item_ids))
    items = {item.id: item for item in db.scalars(stmt).all()}
    missing = [item_id for item_id in item_ids if item_id not in items]
    if missing:
        raise HTTPException(status_code=404, detail="items_not_found")

    delivered_at = payload.delivered_at or datetime.utcnow()
    delivered_by = (payload.delivered_by or "Raffaella Cafasso").strip()
    notes = payload.notes.strip() if payload.notes else None
    signature_b64 = payload.signature.image_b64.strip()

    created: list[EquipmentDelivery] = []
    for entry in payload.items:
        item = items[entry.item_id]
        size_value = (entry.size or "").strip()
        if not size_value:
            raise HTTPException(status_code=400, detail="size_required")
        delivery = EquipmentDelivery(
            employee_id=employee.id,
            item_id=item.id,
            item_name=item.name,
            item_category=item.category,
            item_size=size_value,
            quantity=entry.quantity,
            delivered_by=delivered_by,
            delivered_at=delivered_at,
            notes=notes,
            signature_b64=signature_b64,
        )
        db.add(delivery)
        created.append(delivery)

    db.commit()

    result: list[EquipmentDeliveryOut] = []
    for delivery in created:
        db.refresh(delivery)
        metadata = {
            "employee": employee.full_name,
            "category": delivery.item_category,
            "item": delivery.item_name,
        }
        log_action(db, action="delivery.created", actor=delivery.delivered_by, target_id=delivery.id, metadata=metadata)
        logger.info(
            "delivery.created",
            delivery_id=delivery.id,
            employee_id=employee.id,
            category=delivery.item_category,
        )
        result.append(delivery_out(delivery))

    return result


@router.get("", response_model=PaginatedDeliveries)
def list_deliveries(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    status: str = Query("open"),
    employee_id: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
) -> PaginatedDeliveries:
    stmt = select(EquipmentDelivery).join(Employee)
    stmt = _apply_filters(stmt, status=status, employee_id=employee_id, search=search)
    stmt = stmt.order_by(EquipmentDelivery.delivered_at.desc()).offset((page - 1) * size).limit(size)
    deliveries = db.scalars(stmt).all()

    count_stmt = select(func.count()).select_from(EquipmentDelivery).join(Employee)
    count_stmt = _apply_filters(count_stmt, status=status, employee_id=employee_id, search=search)
    total = db.scalar(count_stmt) or 0

    return PaginatedDeliveries(
        items=[delivery_out(item) for item in deliveries],
        total=total,
        page=page,
        size=size,
    )


@router.get("/export")
def export_deliveries(
    status: str = Query("open"),
    employee_id: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
) -> Response:
    stmt = select(EquipmentDelivery).join(Employee)
    stmt = _apply_filters(stmt, status=status, employee_id=employee_id, search=search)
    stmt = stmt.order_by(EquipmentDelivery.delivered_at.desc())
    deliveries = db.scalars(stmt).all()
    serialized = [delivery_out(item) for item in deliveries]
    content = export_deliveries_xlsx(serialized)
    filename = f"consegne-{status}.xlsx" if status != "all" else "consegne.xlsx"
    return Response(
        content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


def _slugify_filename(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^A-Za-z0-9]+", "-", ascii_value).strip("-")
    return slug.lower() or "scheda"


@router.get("/export/employee/{employee_id}")
def export_employee_deliveries(
    employee_id: str,
    include_returned: bool = Query(False),
    db: Session = Depends(get_db),
) -> Response:
    employee = db.get(Employee, employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="employee_not_found")

    stmt = select(EquipmentDelivery).where(EquipmentDelivery.employee_id == employee_id)
    if not include_returned:
        stmt = stmt.where(EquipmentDelivery.returned_at.is_(None))
    stmt = stmt.order_by(EquipmentDelivery.delivered_at.asc())

    deliveries = db.scalars(stmt).all()
    content = export_employee_deliveries_docx(employee=employee, deliveries=deliveries)
    safe_name = _slugify_filename(employee.full_name)
    filename = f"scheda-consegna-{safe_name}.docx"
    return Response(
        content,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/history", response_model=PaginatedDeliveriesList)
def list_deliveries_history(
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    status: str = Query("all"),
    employee_id: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
) -> PaginatedDeliveriesList:
    """Lista leggera per l'app mobile: senza signature_b64."""
    stmt = select(EquipmentDelivery).join(Employee)
    stmt = _apply_filters(stmt, status=status, employee_id=employee_id, search=search)
    stmt = stmt.order_by(EquipmentDelivery.delivered_at.desc()).offset((page - 1) * size).limit(size)
    deliveries = db.scalars(stmt).all()

    count_stmt = select(func.count()).select_from(EquipmentDelivery).join(Employee)
    count_stmt = _apply_filters(count_stmt, status=status, employee_id=employee_id, search=search)
    total = db.scalar(count_stmt) or 0

    return PaginatedDeliveriesList(
        items=[delivery_list_out(item) for item in deliveries],
        total=total,
        page=page,
        size=size,
    )


@router.get("/{delivery_id}", response_model=EquipmentDeliveryOut)
def get_delivery(delivery_id: str, db: Session = Depends(get_db)) -> EquipmentDeliveryOut:
    delivery = db.get(EquipmentDelivery, delivery_id)
    if not delivery:
        raise HTTPException(status_code=404, detail="delivery_not_found")
    return delivery_out(delivery)


@router.patch("/{delivery_id}", response_model=EquipmentDeliveryOut)
def update_delivery(
    delivery_id: str,
    payload: EquipmentDeliveryUpdate,
    db: Session = Depends(get_db),
) -> EquipmentDeliveryOut:
    delivery = db.get(EquipmentDelivery, delivery_id)
    if not delivery:
        raise HTTPException(status_code=404, detail="delivery_not_found")

    updatable = payload.dict(exclude_unset=True)
    if "delivered_by" in updatable:
        value = updatable["delivered_by"]
        delivery.delivered_by = value.strip() if value else "Raffaella Cafasso"
    if "delivered_at" in updatable and updatable["delivered_at"] is not None:
        delivery.delivered_at = updatable["delivered_at"]
    if "notes" in updatable:
        value = updatable["notes"]
        delivery.notes = value.strip() if value else None
    if "returned_at" in updatable:
        delivery.returned_at = updatable["returned_at"]

    db.add(delivery)
    db.commit()
    db.refresh(delivery)

    log_action(
        db,
        action="delivery.updated",
        actor=delivery.delivered_by,
        target_id=delivery.id,
        metadata={
            "item": delivery.item_name,
            "category": delivery.item_category,
            "employee": delivery.employee.full_name if delivery.employee else delivery.employee_id,
        },
    )
    logger.info("delivery.updated", delivery_id=delivery.id)
    return delivery_out(delivery)


@router.post("/{delivery_id}/return", response_model=EquipmentDeliveryOut)
def mark_returned(
    delivery_id: str,
    payload: EquipmentDeliveryReturn,
    db: Session = Depends(get_db),
) -> EquipmentDeliveryOut:
    delivery = db.get(EquipmentDelivery, delivery_id)
    if not delivery:
        raise HTTPException(status_code=404, detail="delivery_not_found")

    delivery.returned_at = payload.returned_at or datetime.utcnow()
    db.add(delivery)
    db.commit()
    db.refresh(delivery)

    log_action(
        db,
        action="delivery.returned",
        actor=delivery.delivered_by,
        target_id=delivery.id,
        metadata={
            "item": delivery.item_name,
            "category": delivery.item_category,
            "employee": delivery.employee.full_name if delivery.employee else delivery.employee_id,
        },
    )
    logger.info("delivery.returned", delivery_id=delivery.id)
    return delivery_out(delivery)
```

### 2.5 `backend/app/routes/equipment_items.py`

```python
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import EquipmentItem, SizeGroup, SizeOption
from ..schemas import EquipmentItemCreate, EquipmentItemOut, EquipmentItemUpdate, SizeGroupOut, SizeOptionOut
from ..serializers import equipment_item_out

router = APIRouter(prefix="/equipment-items", tags=["equipment"], include_in_schema=False)


@router.get("/size-groups", response_model=list[SizeGroupOut])
def list_size_groups(db: Session = Depends(get_db)) -> list[SizeGroupOut]:
    groups = db.scalars(select(SizeGroup).order_by(SizeGroup.sort_order)).all()
    return [
        SizeGroupOut(
            id=g.id,
            name=g.name,
            sort_order=g.sort_order,
            options=[SizeOptionOut(id=o.id, value=o.value, sort_order=o.sort_order) for o in g.options],
        )
        for g in groups
    ]


@router.get("", response_model=list[EquipmentItemOut])
def list_items(
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db),
) -> list[EquipmentItemOut]:
    stmt = select(EquipmentItem)
    if not include_inactive:
        stmt = stmt.where(EquipmentItem.is_active.is_(True))
    stmt = stmt.order_by(EquipmentItem.category.asc(), EquipmentItem.name.asc())
    items = db.scalars(stmt).all()
    return [equipment_item_out(item) for item in items]


@router.post("", response_model=EquipmentItemOut, status_code=201)
def create_item(payload: EquipmentItemCreate, db: Session = Depends(get_db)) -> EquipmentItemOut:
    item = EquipmentItem(
        name=payload.name.strip(),
        category=payload.category,
        notes=payload.notes.strip() if payload.notes else None,
    )
    if payload.available_size_ids:
        opts = db.scalars(select(SizeOption).where(SizeOption.id.in_(payload.available_size_ids))).all()
        item.available_size_options = list(opts)
    db.add(item)
    db.commit()
    db.refresh(item)
    return equipment_item_out(item)


@router.patch("/{item_id}", response_model=EquipmentItemOut)
def update_item(item_id: str, payload: EquipmentItemUpdate, db: Session = Depends(get_db)) -> EquipmentItemOut:
    item = db.get(EquipmentItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="item_not_found")
    updates = payload.dict(exclude_unset=True)
    if "name" in updates and updates["name"]:
        item.name = updates["name"].strip()
    if "category" in updates and updates["category"]:
        item.category = updates["category"]
    if "notes" in updates:
        item.notes = updates["notes"].strip() if updates["notes"] else None
    if "is_active" in updates and updates["is_active"] is not None:
        item.is_active = bool(updates["is_active"])
    if "available_size_ids" in updates:
        ids = updates["available_size_ids"] or []
        opts = db.scalars(select(SizeOption).where(SizeOption.id.in_(ids))).all() if ids else []
        item.available_size_options = list(opts)
    db.add(item)
    db.commit()
    db.refresh(item)
    return equipment_item_out(item)


@router.get("/{item_id}", response_model=EquipmentItemOut)
def get_item(item_id: str, db: Session = Depends(get_db)) -> EquipmentItemOut:
    item = db.get(EquipmentItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="item_not_found")
    return equipment_item_out(item)
```

### 2.6 `backend/app/routes/employees.py`

```python
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..logging import logger
from ..models import Employee
from ..schemas import EmployeeCreate, EmployeeOut, EmployeeUpdate, PaginatedEmployees
from ..serializers import employee_out
from ..services.audit import log_action

router = APIRouter(prefix="/employees", tags=["employees"])


def _normalize(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def _normalize_email(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    return value.strip().lower()


@router.post("", response_model=EmployeeOut, status_code=201)
def create_employee(payload: EmployeeCreate, db: Session = Depends(get_db)) -> EmployeeOut:
    full_name = payload.full_name.strip()
    department = _normalize(payload.department)
    role = _normalize(payload.role)
    phone = _normalize(payload.phone)
    notes = _normalize(payload.notes)
    email = _normalize_email(payload.email)

    employee = Employee(
        full_name=full_name,
        department=department,
        role=role,
        email=email,
        phone=phone,
        notes=notes,
    )
    db.add(employee)
    db.commit()
    db.refresh(employee)

    log_action(db, action="employee.created", actor=None, target_id=employee.id, metadata={"full_name": employee.full_name})
    logger.info("employee.created", employee_id=employee.id)
    return employee_out(employee)


@router.get("", response_model=PaginatedEmployees)
def list_employees(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=500),
    search: Optional[str] = None,
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db),
) -> PaginatedEmployees:
    stmt = select(Employee)
    count_stmt = select(func.count()).select_from(Employee)

    if not include_inactive:
        stmt = stmt.where(Employee.is_active.is_(True))
        count_stmt = count_stmt.where(Employee.is_active.is_(True))

    if search:
        pattern = f"%{search.lower()}%"
        predicate = or_(
            func.lower(Employee.full_name).like(pattern),
            func.lower(func.coalesce(Employee.department, "")).like(pattern),
        )
        stmt = stmt.where(predicate)
        count_stmt = count_stmt.where(predicate)

    stmt = stmt.order_by(Employee.full_name.asc()).offset((page - 1) * size).limit(size)
    employees = db.scalars(stmt).all()
    total = db.scalar(count_stmt) or 0

    return PaginatedEmployees(
        items=[employee_out(item) for item in employees],
        total=total,
        page=page,
        size=size,
    )


@router.get("/{employee_id}", response_model=EmployeeOut)
def get_employee(employee_id: str, db: Session = Depends(get_db)) -> EmployeeOut:
    employee = db.get(Employee, employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="employee_not_found")
    return employee_out(employee)


@router.patch("/{employee_id}", response_model=EmployeeOut)
def update_employee(employee_id: str, payload: EmployeeUpdate, db: Session = Depends(get_db)) -> EmployeeOut:
    employee = db.get(Employee, employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="employee_not_found")

    updates = payload.dict(exclude_unset=True)
    if "full_name" in updates and updates["full_name"] is not None:
        employee.full_name = updates["full_name"].strip()
    if "department" in updates:
        employee.department = _normalize(updates["department"])
    if "role" in updates:
        employee.role = _normalize(updates["role"])
    if "email" in updates:
        employee.email = _normalize_email(updates["email"])
    if "phone" in updates:
        employee.phone = _normalize(updates["phone"])
    if "notes" in updates:
        employee.notes = _normalize(updates["notes"])
    if "is_active" in updates and updates["is_active"] is not None:
        employee.is_active = bool(updates["is_active"])

    db.add(employee)
    db.commit()
    db.refresh(employee)

    log_action(db, action="employee.updated", actor=None, target_id=employee.id, metadata={"full_name": employee.full_name})
    logger.info("employee.updated", employee_id=employee.id)
    return employee_out(employee)
```

### 2.7 `backend/app/services/deliveries_export.py` (export Excel)

```python
from __future__ import annotations

import io
from typing import Iterable

from openpyxl import Workbook
from openpyxl.utils import get_column_letter

from ..schemas import EquipmentDeliveryOut


HEADERS = [
    "ID",
    "Dipendente",
    "Ruolo",
    "Categoria",
    "Articolo",
    "Taglia",
    "Quantità",
    "Consegnato da",
    "Consegnato il",
    "Restituito il",
    "Note",
]


def _row(delivery: EquipmentDeliveryOut) -> list[str | None]:
    return [
        delivery.id,
        delivery.employee_name,
        delivery.employee_role,
        delivery.item_category,
        delivery.item_name,
        delivery.item_size,
        str(delivery.quantity),
        delivery.delivered_by,
        delivery.delivered_at.isoformat(timespec="seconds"),
        delivery.returned_at.isoformat(timespec="seconds") if delivery.returned_at else "",
        delivery.notes,
    ]


def export_deliveries_xlsx(deliveries: Iterable[EquipmentDeliveryOut]) -> bytes:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "Consegne"
    worksheet.append(HEADERS)
    for delivery in deliveries:
        worksheet.append([value or "" for value in _row(delivery)])

    for index in range(1, len(HEADERS) + 1):
        worksheet.column_dimensions[get_column_letter(index)].width = 25
    worksheet.freeze_panes = "A2"

    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()
```

### 2.8 `backend/app/services/deliveries_ppe_docx.py` (scheda DPI Word)

```python
from __future__ import annotations

import io
import os
import base64
import binascii
from collections.abc import Iterable
from datetime import datetime
from pathlib import Path
from typing import Optional

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches

from ..models import Employee, EquipmentDelivery


LOGO_FILENAME = "logo.png"


def _maybe_get_logo_path() -> Path | None:
    """Return the Tonoli logo path if it exists."""

    candidates = []

    upload_dir = os.getenv("UPLOAD_DIR")
    if upload_dir:
        candidates.append(Path(upload_dir) / LOGO_FILENAME)

    app_root = Path(__file__).resolve().parents[2]
    candidates.append(app_root / "upload" / LOGO_FILENAME)

    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def _format_date(value: datetime) -> str:
    return value.strftime("%d/%m/%Y")


def _decode_signature(signature_b64: str | None) -> Optional[io.BytesIO]:
    if not signature_b64:
        return None
    data = signature_b64.strip()
    if not data:
        return None
    if "," in data:
        data = data.split(",", 1)[1]
    try:
        binary = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        return None
    stream = io.BytesIO(binary)
    stream.seek(0)
    return stream


def export_employee_deliveries_docx(
    *,
    employee: Employee,
    deliveries: Iterable[EquipmentDelivery],
) -> bytes:
    """Build the PPE delivery sheet for a specific employee."""

    document = Document()

    logo_path = _maybe_get_logo_path()
    if logo_path:
        document.add_picture(str(logo_path), width=Inches(1.8))
        document.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER

    heading = document.add_paragraph("SCHEDA CONSEGNA DISPOSITIVI DI PROTEZIONE INDIVIDUALI (D.P.I.) E ABBIGLIAMENTO")
    heading.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for run in heading.runs:
        run.bold = True

    year_paragraph = document.add_paragraph(f"ANNO {datetime.now().year}")
    year_paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER

    document.add_paragraph("")
    document.add_paragraph(f"Il sottoscritto: {employee.full_name}")
    role_display = employee.role or "AUTISTA"
    document.add_paragraph(f"Mansione: {role_display}")

    document.add_paragraph("")
    document.add_paragraph("DICHIARA di ricevere le seguenti dotazioni:")
    document.add_paragraph(
        "DPI per la prevenzione e protezione dagli infortuni e dalle malattie professionali",
        style="List Bullet",
    )
    document.add_paragraph("Capi di abbigliamento", style="List Bullet")

    document.add_paragraph("")

    table = document.add_table(rows=1, cols=4)
    table.style = "Table Grid"

    headers = ["DESCRIZIONE", "Taglia/ Numero", "Quantità", "Data ritiro"]
    for cell, text in zip(table.rows[0].cells, headers):
        cell.text = text

    for delivery in deliveries:
        row = table.add_row().cells
        row[0].text = delivery.item_name
        row[1].text = delivery.item_size or ""
        quantity = getattr(delivery, "quantity", 1)
        row[2].text = str(quantity)
        row[3].text = _format_date(delivery.delivered_at)

    if len(table.rows) == 1:
        empty_row = table.add_row().cells
        empty_row[0].text = ""
        empty_row[1].text = ""
        empty_row[2].text = ""
        empty_row[3].text = ""

    document.add_paragraph("")
    document.add_paragraph("FIRMA")

    signature_stream = None
    for delivery in deliveries:
        signature_stream = _decode_signature(getattr(delivery, "signature_b64", None))
        if signature_stream:
            break

    if signature_stream:
        document.add_paragraph("")
        document.add_picture(signature_stream, width=Inches(3.0))
        document.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.LEFT
        document.add_paragraph("")
    else:
        document.add_paragraph("")

    footer_lines = [
        "Chi riceve i D.P.I. in applicazione della vigente normativa dichiara:",
        "Che i D.P.I. sono integri e di nuova fornitura.",
        "Di essere stato adeguatamente formato/informato sul loro utilizzo e sulle modalità di manutenzione e conservazione degli stessi.",
        "Di avere cura dei D.P.I. messi a Sua disposizione e di non apportarvi modifiche di propria iniziativa.",
        "Di segnalare immediatamente al preposto qualsiasi difetto e inconveniente rilevato nei D.P.I. consegnati.",
        "Di richiedere nuovi D.P.I. al preposto, qualora quelli forniti risultino usurati, danneggiati o inutilizzabili.",
        "Di utilizzare i D.P.I. messi a Sua disposizione, ogni volta che accede agli impianti di produzione aziendali, di terzi, e ovunque si renda necessario durante la propria attività lavorativa.",
        "Il ricevente è a conoscenza che le disposizioni sono sancite dal D.Lgs. 81/08 e che non attenersi a quanto disposto può comportare le sanzioni previste dalle norme sopra citate.  Si precisa inoltre che la normativa vigente prevede per la manomissione, la scarsa cura ed il mancato utilizzo in caso di obbligo, sanzioni per i lavoratori pari all'arresto fino a un mese o all'ammenda da 200 a 600 euro",
    ]

    document.add_paragraph(footer_lines[0])
    for line in footer_lines[1:]:
        document.add_paragraph(line, style="List Bullet")

    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()
```

### 2.9 `backend/app/services/audit.py` (dipendenza delle route)

```python
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from ..models import AuditLog


def log_action(db: Session, action: str, actor: str | None = None, target_id: str | None = None, metadata: dict[str, Any] | None = None) -> None:
    entry = AuditLog(
        actor=actor,
        action=action,
        target_id=target_id,
        meta=json.dumps(metadata or {}),
        created_at=datetime.utcnow(),
    )
    db.add(entry)
    db.flush()
```

Modello `AuditLog` (da `models.py`):

```python
class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    actor: Mapped[str | None] = mapped_column(String(120), nullable=True)
    action: Mapped[str] = mapped_column(String(120), nullable=False)
    target_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    meta: Mapped[str | None] = mapped_column("metadata", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
```

### 2.10 Registrazione router e seed taglie (`backend/app/main.py`, estratto)

```python
from .routes import deliveries, employees, equipment_items

_SEED_SIZE_GROUPS = [
    ("Abbigliamento",   1, ["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "S/M", "L/XL", "XXL/XXXL"]),
    ("Calzature",       2, ["36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46", "47", "48"]),
    ("Guanti",          3, ["6", "7", "8", "9", "10", "11"]),
    ("Pantalone corto", 4, ["XS", "S", "M", "L", "XL", "XXL", "3XL"]),
    ("Pantalone lungo", 5, ["XS", "S", "M", "L", "XL", "XXL", "3XL"]),
    ("Taglia unica",    6, ["Taglia unica"]),
]


def _seed_size_groups() -> None:
    from sqlalchemy import select as sa_select
    from .db import session_scope
    from .models import SizeGroup, SizeOption
    with session_scope() as db:
        if db.scalars(sa_select(SizeGroup).limit(1)).first():
            return
        for name, sort_order, values in _SEED_SIZE_GROUPS:
            group = SizeGroup(name=name, sort_order=sort_order)
            db.add(group)
            db.flush()
            for i, value in enumerate(values):
                db.add(SizeOption(group_id=group.id, value=value, sort_order=i))


def _migrate_pants_sizes() -> None:
    """Sostituisce il vecchio gruppo 'Pantaloni' (taglie numeriche) con
    'Pantalone corto' e 'Pantalone lungo' (XS–3XL).
    """
    from sqlalchemy import select as sa_select
    from .db import session_scope
    from .models import SizeGroup, SizeOption
    _PANTS_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "3XL"]
    with session_scope() as db:
        old = db.scalars(sa_select(SizeGroup).where(SizeGroup.name == "Pantaloni")).first()
        if old:
            db.delete(old)
            db.flush()
        for name, sort_order in [("Pantalone corto", 4), ("Pantalone lungo", 5)]:
            exists = db.scalars(sa_select(SizeGroup).where(SizeGroup.name == name)).first()
            if exists:
                continue
            group = SizeGroup(name=name, sort_order=sort_order)
            db.add(group)
            db.flush()
            for i, value in enumerate(_PANTS_SIZES):
                db.add(SizeOption(group_id=group.id, value=value, sort_order=i))
        # riordina i gruppi successivi
        for name, order in [("Taglia unica", 6)]:
            g = db.scalars(sa_select(SizeGroup).where(SizeGroup.name == name)).first()
            if g:
                g.sort_order = order


# keyword → nomi dei gruppi taglie (ordine: più specifico prima)
_ITEM_KEYWORDS: list[tuple[list[str], list[str]]] = [
    (["scarpe", "stivali", "calzature"],               ["Calzature"]),
    (["guanti"],                                        ["Guanti"]),
    (["pantalone corto", "pantaloni corti"],            ["Pantalone corto"]),
    (["pantalone lungo", "pantaloni lunghi"],           ["Pantalone lungo"]),
    (["pantalone", "pantaloni"],                        ["Pantalone corto", "Pantalone lungo"]),
    (["polo", "maglietta", "felpa", "gilet",
      "giubbotto", "tuta", "pile", "giacca",
      "camicia", "canotta", "maglia"],                  ["Abbigliamento"]),
]


def _migrate_item_sizes() -> None:
    """Collega le taglie agli articoli esistenti che non ne hanno ancora."""
    from sqlalchemy import select as sa_select
    from .db import session_scope
    from .models import EquipmentItem, SizeGroup, SizeOption
    with session_scope() as db:
        groups: dict[str, SizeGroup] = {
            g.name: g for g in db.scalars(sa_select(SizeGroup)).all()
        }
        if not groups:
            return
        items = db.scalars(sa_select(EquipmentItem)).all()
        for item in items:
            if item.available_size_options:
                continue
            lower = item.name.lower()
            matched_groups: list[str] = []
            for keywords, group_names in _ITEM_KEYWORDS:
                if any(kw in lower for kw in keywords):
                    matched_groups = group_names
                    break
            if not matched_groups:
                matched_groups = ["Taglia unica"]
            opts: list[SizeOption] = []
            for gname in matched_groups:
                g = groups.get(gname)
                if g:
                    opts.extend(g.options)
            item.available_size_options = opts


# Registrazione router (settings.api_prefix = "/api"):
app.include_router(employees.router, prefix=settings.api_prefix)
app.include_router(deliveries.router, prefix=settings.api_prefix)
app.include_router(equipment_items.router, prefix=settings.api_prefix)
# ...e anche senza prefisso per retrocompatibilità:
app.include_router(employees.router)
app.include_router(deliveries.router)
app.include_router(equipment_items.router)


@app.on_event("startup")
async def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    _seed_size_groups()
    _migrate_pants_sizes()
    _migrate_item_sizes()
```

### 2.11 Migrazioni Alembic

`backend/migrations/versions/20251017_0006_create_equipment_deliveries.py`:

```python
"""create employees and equipment deliveries tables

Revision ID: 20251017_0006
Revises: 20250923_0005
Create Date: 2025-10-17 07:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20251017_0006"
down_revision = "20250923_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = {name.lower() for name in inspector.get_table_names()}

    if "employees" not in tables:
        op.create_table(
            "employees",
            sa.Column("id", sa.String(length=36), primary_key=True, nullable=False),
            sa.Column("full_name", sa.String(length=200), nullable=False),
            sa.Column("department", sa.String(length=120), nullable=True),
            sa.Column("role", sa.String(length=120), nullable=True),
            sa.Column("email", sa.String(length=200), nullable=True),
            sa.Column("phone", sa.String(length=40), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        )
        op.create_index("ix_employees_full_name", "employees", ["full_name"])

    if "equipment_items" in tables:
        op.drop_table("equipment_items")

    op.create_table(
        "equipment_items",
        sa.Column("id", sa.String(length=36), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("category", sa.String(length=30), nullable=False),
        sa.Column("size", sa.String(length=40), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_equipment_items_name", "equipment_items", ["name"])

    if "equipment_deliveries" in tables:
        op.drop_table("equipment_deliveries")

    op.create_table(
        "equipment_deliveries",
        sa.Column("id", sa.String(length=36), primary_key=True, nullable=False),
        sa.Column("employee_id", sa.String(length=36), nullable=False),
        sa.Column("item_id", sa.String(length=36), nullable=False),
        sa.Column("item_name", sa.String(length=120), nullable=False),
        sa.Column("item_category", sa.String(length=30), nullable=False),
        sa.Column("item_size", sa.String(length=40), nullable=True),
        sa.Column("delivered_by", sa.String(length=120), nullable=False, server_default=sa.text("'Raffaella Cafasso'")),
        sa.Column("delivered_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("returned_at", sa.DateTime(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("signature_b64", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], name="fk_equipment_deliveries_employee", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["item_id"], ["equipment_items.id"], name="fk_equipment_deliveries_item", ondelete="RESTRICT"),
    )

    op.create_index("ix_equipment_deliveries_category", "equipment_deliveries", ["item_category"])
    op.create_index("ix_equipment_deliveries_returned", "equipment_deliveries", ["returned_at"])
    op.create_index(
        "ix_equipment_deliveries_employee",
        "equipment_deliveries",
        ["employee_id"],
    )
    op.create_index(
        "ix_equipment_deliveries_item",
        "equipment_deliveries",
        ["item_id"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = {name.lower() for name in inspector.get_table_names()}

    if "equipment_deliveries" in tables:
        op.drop_index("ix_equipment_deliveries_item", table_name="equipment_deliveries")
        op.drop_index("ix_equipment_deliveries_employee", table_name="equipment_deliveries")
        op.drop_index("ix_equipment_deliveries_returned", table_name="equipment_deliveries")
        op.drop_index("ix_equipment_deliveries_category", table_name="equipment_deliveries")
        op.drop_table("equipment_deliveries")

    if "equipment_items" in tables:
        op.drop_index("ix_equipment_items_name", table_name="equipment_items")
        op.drop_table("equipment_items")

    if "employees" in tables:
        op.drop_index("ix_employees_full_name", table_name="employees")
        op.drop_table("employees")
```

`backend/migrations/versions/20251018_0007_add_delivery_quantity.py`:

```python
"""add quantity column to equipment deliveries

Revision ID: 20251018_0007
Revises: 20251017_0006
Create Date: 2025-10-18 08:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "20251018_0007"
down_revision = "20251017_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "equipment_deliveries",
        sa.Column("quantity", sa.Integer(), nullable=False, server_default=sa.text("1")),
    )
    op.execute("UPDATE equipment_deliveries SET quantity = 1 WHERE quantity IS NULL")


def downgrade() -> None:
    op.drop_column("equipment_deliveries", "quantity")
```

> Nota: le tabelle `size_groups`, `size_options`, `equipment_item_sizes` non hanno migrazione Alembic — vengono create da `Base.metadata.create_all()` allo startup.

---

## 3. Cose da adattare nell'altro tool

- `apiFetch` usa URL relativi (`/api/...`): serve un proxy o base URL verso il backend.
- Il nome di default `"Raffaella Cafasso"` per `delivered_by` è hardcoded in modello, migrazione e route.
- `formatDateTime` nel frontend aggiunge **+2 ore fisse** (workaround timezone: il backend salva in UTC naive).
- Il logo della scheda Word viene cercato in `$UPLOAD_DIR/logo.png` o `backend/upload/logo.png`.
- `db.py` (con `get_db`, `session_scope`, `Base`) e `logging.py` (`logger` structlog) sono infrastruttura condivisa del progetto: nel nuovo tool servono equivalenti.
