import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Download, FolderOpen, Plus, RefreshCw, Search } from 'lucide-react';
import { useAuth } from '@/context/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { ERPWorkspacePage } from '@/components/erp/workspace/workspace-page';
import { ERPFilterBar } from '@/components/erp/listing/filter-bar';
import { ERPDataTable, type ERPTableColumn } from '@/components/erp/listing/data-table';
import { ListingPagination } from '@/components/erp/listing/pagination';
import { ERPFormDialog } from '@/components/erp/forms/form-dialog';

const BASE = '/api/platform';

async function readErrorMessage(response: Response) {
  const raw = await response.text().catch(() => '');
  if (!raw) {
    return `Request failed with status ${response.status}`;
  }

  try {
    const payload = JSON.parse(raw);
    if (typeof payload === 'string') return payload;
    if (payload?.message) return String(payload.message);
    if (payload?.detail) return String(payload.detail);
    if (payload?.error) return String(payload.error);
    if (payload?.errors?.detail) {
      const details = payload.errors.detail;
      return Array.isArray(details) ? details.filter(Boolean).join(' ') : String(details);
    }
    return typeof payload === 'object' ? JSON.stringify(payload) : raw;
  } catch {
    const text = raw
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text || `Request failed with status ${response.status}`;
  }
}

async function api(token: string, path: string, method = 'GET', body?: object) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  if (response.status === 204) return null;
  const raw = await response.text().catch(() => '');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

type TenantOption = { id: number; name: string; code: string };

type BackupPolicy = {
  id: number;
  tenant: { id: number; name: string; code: string } | null;
  tenant_name: string;
  is_global: boolean;
  name: string;
  frequency: 'hourly' | 'daily' | 'weekly' | 'monthly';
  retention_days: number;
  storage_backend: string;
  target_path: string;
  last_successful_backup: string | null;
  last_backup_file: string;
  last_backup_size_bytes: number;
  is_active: boolean;
};

type BackupResponse = {
  count: number;
  next: string | null;
  previous: string | null;
  results: BackupPolicy[];
};

type FormState = {
  tenant_id: string;
  name: string;
  frequency: BackupPolicy['frequency'];
  retention_days: string;
  storage_backend: string;
  target_path: string;
  is_active: boolean;
};

const EMPTY_FORM: FormState = {
  tenant_id: '',
  name: '',
  frequency: 'daily',
  retention_days: '30',
  storage_backend: 'local',
  target_path: '',
  is_active: true,
};

function formatBytes(value: number) {
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function isPaginated<T>(value: BackupResponse | T[] | undefined): value is BackupResponse {
  return !!value && !Array.isArray(value);
}

function errorDescription(message: string, onCopy: () => void) {
  const preview = message.length > 180 ? `${message.slice(0, 180)}…` : message;
  return (
    <div className="space-y-2">
      <div className="max-h-24 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-white/90">
        {preview}
      </div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="h-8 bg-white/95 text-red-700 hover:bg-white"
        onClick={onCopy}
      >
        Copy error
      </Button>
    </div>
  );
}

export default function PlatformBackupsPage() {
  const { token, role, user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const tenantId = (user as any)?.tenant_id ? String((user as any).tenant_id) : '';
  const isSuperAdmin = role === 'superadmin';

  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'general' | 'tenant'>('all');
  const [tenantFilter, setTenantFilter] = useState(isSuperAdmin ? 'all' : tenantId);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<BackupPolicy | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const copyErrorMessage = async (message: string) => {
    try {
      await navigator.clipboard.writeText(message);
      toast({ title: 'Error copied to clipboard' });
    } catch {
      window.prompt('Copy error', message);
      toast({ title: 'Copy helper opened', description: 'Please copy the error from the prompt.', variant: 'destructive' });
    }
  };

  const { data: tenantRaw } = useQuery({
    queryKey: ['platform-backup-tenants'],
    enabled: !!token && isSuperAdmin,
    queryFn: () => api(token!, '/tenants/?page_size=200'),
  });

  const tenants: TenantOption[] = Array.isArray(tenantRaw)
    ? tenantRaw
    : tenantRaw?.results ?? tenantRaw?.data?.results ?? [];

  const query = useQuery({
    queryKey: ['platform-backups', search, scopeFilter, tenantFilter, page, pageSize],
    enabled: !!token,
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      if (search.trim()) params.set('search', search.trim());
      if (scopeFilter === 'general') params.set('is_global', 'true');
      if (scopeFilter === 'tenant') params.set('is_global', 'false');
      if (isSuperAdmin && tenantFilter === 'general') {
        params.set('is_global', 'true');
      } else if (isSuperAdmin && tenantFilter !== 'all' && tenantFilter) {
        params.set('tenant', tenantFilter);
      }
      if (!isSuperAdmin && tenantId) params.set('tenant', tenantId);
      const response = await api(token!, `/backups/policies/?${params.toString()}`);
      return response as BackupResponse | BackupPolicy[];
    },
  });

  const data = query.data;
  const policies = isPaginated(data) ? data.results : Array.isArray(data) ? data : [];
  const totalCount = isPaginated(data) ? data.count : policies.length;

  const summary = useMemo(() => ({
    total: totalCount,
    active: policies.filter((policy) => policy.is_active).length,
    general: policies.filter((policy) => policy.is_global).length,
    tenant: policies.filter((policy) => !policy.is_global).length,
  }), [policies, totalCount]);

  const openCreate = () => {
    setEditTarget(null);
    setForm({
      ...EMPTY_FORM,
      tenant_id: isSuperAdmin
        ? (scopeFilter === 'general' || tenantFilter === 'general' ? '' : tenantFilter !== 'all' ? tenantFilter : '')
        : tenantId,
    });
    setDialogOpen(true);
  };

  const openEdit = (policy: BackupPolicy) => {
    setEditTarget(policy);
    setForm({
      tenant_id: policy.tenant ? String(policy.tenant.id) : '',
      name: policy.name,
      frequency: policy.frequency,
      retention_days: String(policy.retention_days),
      storage_backend: policy.storage_backend,
      target_path: policy.target_path || '',
      is_active: policy.is_active,
    });
    setDialogOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        name: form.name,
        frequency: form.frequency,
        retention_days: Number(form.retention_days || 30),
        storage_backend: form.storage_backend,
        target_path: form.target_path || '',
        is_active: form.is_active,
      };
      if (isSuperAdmin) {
        payload.tenant_id = form.tenant_id ? Number(form.tenant_id) : null;
      } else {
        payload.tenant_id = Number(tenantId);
      }
      const path = editTarget ? `/backups/policies/${editTarget.id}/` : '/backups/policies/';
      const method = editTarget ? 'PATCH' : 'POST';
      return api(token!, path, method, payload);
    },
    onSuccess: () => {
      toast({ title: editTarget ? 'Backup policy updated' : 'Backup policy created' });
      qc.invalidateQueries({ queryKey: ['platform-backups'] });
      setDialogOpen(false);
      setEditTarget(null);
      setForm(EMPTY_FORM);
    },
    onError: (error: Error) => toast({
      title: 'Could not save policy',
      description: errorDescription(error.message, () => copyErrorMessage(error.message)),
      variant: 'destructive',
    }),
  });

  const runBackup = useMutation({
    mutationFn: async (policy: BackupPolicy) => api(token!, `/backups/policies/${policy.id}/run/`, 'POST'),
    onSuccess: () => {
      toast({ title: 'Backup generated' });
      qc.invalidateQueries({ queryKey: ['platform-backups'] });
    },
    onError: (error: Error) => toast({
      title: 'Backup failed',
      description: errorDescription(error.message, () => copyErrorMessage(error.message)),
      variant: 'destructive',
    }),
  });

  const deletePolicy = useMutation({
    mutationFn: async (policy: BackupPolicy) => api(token!, `/backups/policies/${policy.id}/`, 'DELETE'),
    onSuccess: () => {
      toast({ title: 'Backup policy removed' });
      qc.invalidateQueries({ queryKey: ['platform-backups'] });
    },
    onError: (error: Error) => toast({
      title: 'Delete failed',
      description: errorDescription(error.message, () => copyErrorMessage(error.message)),
      variant: 'destructive',
    }),
  });

  const downloadPolicy = async (policy: BackupPolicy) => {
    try {
      const response = await fetch(`${BASE}/backups/policies/${policy.id}/download/`, {
        headers: { Authorization: `Token ${token}` },
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = policy.last_backup_file?.split('/').pop() || `${policy.name}.dump`;
      link.click();
      URL.revokeObjectURL(href);
    } catch (error: any) {
      toast({
        title: 'Download failed',
        description: errorDescription(error.message, () => copyErrorMessage(error.message)),
        variant: 'destructive',
      });
    }
  };

  const columns: ERPTableColumn<BackupPolicy>[] = [
    {
      key: 'name',
      label: 'Policy',
      render: (policy) => (
        <div>
          <div className="font-medium">{policy.name}</div>
          <div className="text-xs text-muted-foreground">
            {policy.is_global ? 'General backup' : policy.tenant_name}
          </div>
        </div>
      ),
    },
    {
      key: 'frequency',
      label: 'Frequency',
      render: (policy) => policy.frequency,
    },
    {
      key: 'retention_days',
      label: 'Retention',
      render: (policy) => `${policy.retention_days} days`,
    },
    {
      key: 'target_path',
      label: 'Folder',
      render: (policy) => (
        <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
          <FolderOpen className="h-3.5 w-3.5" />
          {policy.target_path || 'Default backup folder'}
        </span>
      ),
    },
    {
      key: 'last_successful_backup',
      label: 'Last Backup',
      render: (policy) => policy.last_successful_backup
        ? new Date(policy.last_successful_backup).toLocaleString()
        : '—',
    },
    {
      key: 'size',
      label: 'Size',
      render: (policy) => policy.last_backup_size_bytes ? formatBytes(policy.last_backup_size_bytes) : '—',
    },
    {
      key: 'status',
      label: 'Status',
      render: (policy) => (
        <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${policy.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
          {policy.is_active ? 'Active' : 'Inactive'}
        </span>
      ),
    },
  ];

  return (
    <ERPWorkspacePage
      title="Backups"
      description="Configure PostgreSQL backup policies, run tenant-scoped exports, and manage archive settings."
      actions={(
        <>
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ['platform-backups'] })}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Policy
          </Button>
        </>
      )}
    >
      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Total</div><div className="mt-2 text-2xl font-semibold">{summary.total}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Active</div><div className="mt-2 text-2xl font-semibold text-emerald-600">{summary.active}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">General</div><div className="mt-2 text-2xl font-semibold text-blue-600">{summary.general}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Tenant Scoped</div><div className="mt-2 text-2xl font-semibold text-amber-600">{summary.tenant}</div></CardContent></Card>
      </div>

      <ERPFilterBar
        searchSlot={(
          <>
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              placeholder="Search policy name or folder…"
              className="h-8 border-0 shadow-none focus-visible:ring-0"
            />
          </>
        )}
        filterSlot={(
          <>
            <Select value={scopeFilter} onValueChange={(value: 'all' | 'general' | 'tenant') => { setScopeFilter(value); setPage(1); }}>
              <SelectTrigger className="h-8 w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All scopes</SelectItem>
                <SelectItem value="general">General</SelectItem>
                <SelectItem value="tenant">Tenant scoped</SelectItem>
              </SelectContent>
            </Select>

            {isSuperAdmin ? (
              <Select value={tenantFilter} onValueChange={(value) => { setTenantFilter(value); setPage(1); }}>
                <SelectTrigger className="h-8 w-[180px]">
                  <SelectValue placeholder="All tenants" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tenants</SelectItem>
                  <SelectItem value="general">General only</SelectItem>
                  {tenants.map((tenant) => (
                    <SelectItem key={tenant.id} value={String(tenant.id)}>{tenant.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </>
        )}
      />

      <Card>
        <CardContent className="p-0">
          <ERPDataTable
            columns={columns}
            rows={policies}
            loading={query.isLoading}
            loadingLabel="Loading backup policies…"
            emptyState="No backup policies found."
            onRowClick={openEdit}
            rowActions={(policy) => (
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => runBackup.mutate(policy)}
                  disabled={runBackup.isPending}
                >
                  <Archive className="mr-1.5 h-3.5 w-3.5" />
                  Run
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => downloadPolicy(policy)}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Download
                </Button>
                <Button size="sm" variant="outline" onClick={() => openEdit(policy)}>Open</Button>
                <Button size="sm" variant="outline" onClick={() => deletePolicy.mutate(policy)}>Delete</Button>
              </div>
            )}
          />
        </CardContent>
        <ListingPagination page={page} pageSize={pageSize} totalCount={totalCount} onPage={setPage} onPageSize={setPageSize} />
      </Card>

      <ERPFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editTarget ? 'Backup Policy' : 'New Backup Policy'}
        footer={(
          <>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={!form.name || save.isPending}>
              {save.isPending ? 'Saving…' : editTarget ? 'Save Changes' : 'Create Policy'}
            </Button>
          </>
        )}
      >
        <div className="grid gap-4 py-2 md:grid-cols-2">
          {isSuperAdmin ? (
            <div className="space-y-2 md:col-span-2">
              <Label>Tenant</Label>
              <Select value={form.tenant_id || 'general'} onValueChange={(value) => setForm((current) => ({ ...current, tenant_id: value === 'general' ? '' : value }))}>
                <SelectTrigger><SelectValue placeholder="General / tenant" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General</SelectItem>
                  {tenants.map((tenant) => (
                    <SelectItem key={tenant.id} value={String(tenant.id)}>{tenant.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-2 md:col-span-2">
            <Label>Policy Name *</Label>
            <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Frequency</Label>
            <Select value={form.frequency} onValueChange={(value: FormState['frequency']) => setForm((current) => ({ ...current, frequency: value }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hourly">Hourly</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Retention (days)</Label>
            <Input
              type="number"
              min="1"
              value={form.retention_days}
              onChange={(event) => setForm((current) => ({ ...current, retention_days: event.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>Storage Backend</Label>
            <Select value={form.storage_backend} onValueChange={(value) => setForm((current) => ({ ...current, storage_backend: value }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="local">Local Folder</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Target Folder</Label>
            <Input
              value={form.target_path}
              onChange={(event) => setForm((current) => ({ ...current, target_path: event.target.value }))}
              placeholder="Leave blank to use the default backups folder"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Status</Label>
            <Select value={form.is_active ? 'active' : 'inactive'} onValueChange={(value) => setForm((current) => ({ ...current, is_active: value === 'active' }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </ERPFormDialog>
    </ERPWorkspacePage>
  );
}
