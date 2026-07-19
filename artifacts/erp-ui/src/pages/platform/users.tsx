import { useState } from 'react';
import { useAuth } from '@/context/use-auth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Users as UsersIcon, Plus, Search, RefreshCw, ShieldCheck, UserX, UserCheck } from 'lucide-react';
import { detectRole, ROLE_LABELS, ROLE_COLORS, type AppRole } from '@/lib/roles';

const BASE = '/api/platform';

function api(token: string, path: string, method = 'GET', body?: object) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async r => {
    const j = await r.json();
    if (!r.ok) throw new Error(j?.detail || j?.error || JSON.stringify(j));
    return j;
  });
}

const ROLE_GROUPS = [
  { value: 'Tenant Admin', label: 'Tenant Admin' },
  { value: 'Finance', label: 'Finance' },
  { value: 'Operator', label: 'Operator' },
];

function InviteUserDialog({
  open, onClose, tenantId,
}: { open: boolean; onClose: () => void; tenantId?: string }) {
  const { token, role } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', username: '',
    role_group: '', branch_id: '', job_title: '',
  });

  const { data: tenantsData } = useQuery({
    queryKey: ['tenants-mini'],
    queryFn: () => api(token!, '/tenants/?page_size=100'),
    enabled: open && role === 'superadmin',
  });
  const [selectedTenantId, setSelectedTenantId] = useState(tenantId ?? '');

  const { data: branchData } = useQuery({
    queryKey: ['branches-for-invite', selectedTenantId],
    queryFn: () => api(token!, `/tenants/${selectedTenantId}/branches/`),
    enabled: open && !!selectedTenantId,
  });
  const branches = branchData?.data?.branches ?? branchData?.results ?? [];

  const mutation = useMutation({
    mutationFn: () => {
      const tid = tenantId ?? selectedTenantId;
      return api(token!, `/tenants/${tid}/users/invite/`, 'POST', {
        ...form,
        username: form.username || form.email.split('@')[0],
      });
    },
    onSuccess: () => {
      toast({ title: 'User invited', description: `${form.first_name} ${form.last_name} has been added.` });
      qc.invalidateQueries({ queryKey: ['platform-users'] });
      qc.invalidateQueries({ queryKey: ['tenant-users'] });
      onClose();
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UsersIcon className="h-5 w-5" /> Invite User</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {role === 'superadmin' && !tenantId && (
            <div className="space-y-1.5">
              <Label>Tenant *</Label>
              <Select value={selectedTenantId} onValueChange={setSelectedTenantId}>
                <SelectTrigger><SelectValue placeholder="Select tenant…" /></SelectTrigger>
                <SelectContent>
                  {(tenantsData?.results ?? []).map((t: any) => (
                    <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>First Name *</Label>
              <Input value={form.first_name} onChange={f('first_name')} />
            </div>
            <div className="space-y-1.5">
              <Label>Last Name *</Label>
              <Input value={form.last_name} onChange={f('last_name')} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Email *</Label>
            <Input value={form.email} onChange={f('email')} type="email" />
          </div>
          <div className="space-y-1.5">
            <Label>Username</Label>
            <Input value={form.username} onChange={f('username')} placeholder="Auto-generated from email" />
          </div>
          <div className="space-y-1.5">
            <Label>Job Title</Label>
            <Input value={form.job_title} onChange={f('job_title')} placeholder="e.g. Weighbridge Operator" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Role *</Label>
              <Select value={form.role_group} onValueChange={v => setForm(p => ({ ...p, role_group: v }))}>
                <SelectTrigger><SelectValue placeholder="Select role…" /></SelectTrigger>
                <SelectContent>
                  {ROLE_GROUPS.map(r => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Branch</Label>
              <Select value={form.branch_id} onValueChange={v => setForm(p => ({ ...p, branch_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select branch…" /></SelectTrigger>
                <SelectContent>
                  {branches.map((b: any) => (
                    <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !form.first_name || !form.email || !form.role_group}
          >
            {mutation.isPending ? 'Inviting…' : 'Send Invite'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Users() {
  const { token, role } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [tenantFilter, setTenantFilter] = useState('all');
  const [showInvite, setShowInvite] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['platform-users', search, tenantFilter],
    queryFn: () => {
      const p = new URLSearchParams({ page_size: '200' });
      if (search) p.set('search', search);
      return api(token!, `/users/?${p}`);
    },
    enabled: !!token,
  });

  const { data: tenantsData } = useQuery({
    queryKey: ['tenants-filter'],
    queryFn: () => api(token!, '/tenants/?page_size=100'),
    enabled: role === 'superadmin',
  });

  const toggleMutation = useMutation({
    mutationFn: (u: any) => api(token!, `/users/${u.id}/update/`, 'PATCH', { is_active: !u.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-users'] }),
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  let users: any[] = data?.results ?? [];
  if (tenantFilter !== 'all') {
    users = users.filter((u: any) => u.tenant_id === Number(tenantFilter));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Users</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Platform user directory</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw className="h-3.5 w-3.5" /></Button>
          <Button size="sm" onClick={() => setShowInvite(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Invite User
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search users…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {role === 'superadmin' && (
          <Select value={tenantFilter} onValueChange={setTenantFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="All Tenants" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tenants</SelectItem>
              {(tenantsData?.results ?? []).map((t: any) => (
                <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <Card>
        <CardHeader className="bg-muted/20 border-b py-3 px-4">
          <CardTitle className="text-xs font-bold uppercase tracking-widest flex items-center justify-between">
            <span>User Directory</span>
            <span className="text-muted-foreground font-normal normal-case">{users.length} users</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-8 text-center text-muted-foreground text-sm font-mono animate-pulse">Loading…</p>
          ) : users.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground text-sm">No users found.</p>
          ) : (
            <div className="divide-y">
              {users.map((u: any) => {
                const appRole = detectRole(u) as AppRole;
                return (
                  <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                        {(u.first_name?.[0] ?? u.username?.[0] ?? '?').toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-sm">
                          {u.first_name || u.last_name ? `${u.first_name} ${u.last_name}`.trim() : u.username}
                          {u.is_superuser && (
                            <span className="ml-2 inline-flex items-center gap-0.5 text-[10px] text-amber-600">
                              <ShieldCheck className="h-3 w-3" /> Super Admin
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">{u.email || u.username}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {u.tenant_name && (
                        <span className="text-xs text-muted-foreground hidden sm:block">{u.tenant_name}</span>
                      )}
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${ROLE_COLORS[appRole]}`}>
                        {ROLE_LABELS[appRole]}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${u.is_active ? 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-gray-100 text-gray-500 border-gray-300'}`}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                      {!u.is_superuser && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          title={u.is_active ? 'Deactivate' : 'Reactivate'}
                          onClick={() => toggleMutation.mutate(u)}
                        >
                          {u.is_active ? <UserX className="h-3.5 w-3.5 text-muted-foreground" /> : <UserCheck className="h-3.5 w-3.5 text-emerald-600" />}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <InviteUserDialog open={showInvite} onClose={() => setShowInvite(false)} />
    </div>
  );
}
