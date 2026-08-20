import { useEffect, useState } from 'react';
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
import { Users as UsersIcon, Plus, Search, RefreshCw, ShieldCheck, UserX, UserCheck, Pencil, Copy, Eye, EyeOff } from 'lucide-react';
import { detectRole, ROLE_LABELS, ROLE_COLORS, type AppRole } from '@/lib/roles';

const BASE = '/api/platform';

function extractApiErrorMessage(payload: any): string {
  if (!payload) return 'Request failed.';
  if (typeof payload === 'string') return payload;
  if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message;
  if (typeof payload?.detail === 'string' && payload.detail.trim()) return payload.detail;
  if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error;

  const errors = payload?.errors;
  if (errors && typeof errors === 'object') {
    const firstError = Object.values(errors).flat().find(Boolean);
    if (typeof firstError === 'string' && firstError.trim()) return firstError;
  }

  return 'Request failed.';
}

function api(token: string, path: string, method = 'GET', body?: object) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async r => {
    const j = await r.json();
    if (!r.ok) throw new Error(extractApiErrorMessage(j));
    return j;
  });
}

const ROLE_GROUPS = [
  { value: 'Tenant Admin', label: 'Organization Admin' },
  { value: 'Finance', label: 'Finance' },
  { value: 'Operator', label: 'Operator' },
];

const MEMBERSHIP_ROLE_OPTIONS = [
  { value: 'owner', label: 'Owner' },
  { value: 'system_admin', label: 'System Admin' },
  { value: 'finance', label: 'Finance' },
  { value: 'operator', label: 'Operator' },
  { value: 'member', label: 'Member' },
];

interface PasswordResult {
  username: string;
  email: string;
  temp_password: string;
  title: string;
}

function PasswordBanner({ result, onDismiss }: { result: PasswordResult; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(result.temp_password).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Card className="border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">{result.title}</p>
            <p className="mt-0.5 text-xs text-emerald-700 dark:text-emerald-400">
              Username: <span className="font-mono font-semibold">{result.username}</span>
              {' '}· Email: <span className="font-mono">{result.email}</span>
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 truncate rounded border border-emerald-200 bg-emerald-100 px-2 py-1 text-sm font-mono text-emerald-900 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
                {visible ? result.temp_password : '••••••••••••'}
              </code>
              <button onClick={() => setVisible(v => !v)} className="p-1 text-emerald-700 dark:text-emerald-400" title={visible ? 'Hide' : 'Show'}>
                {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              <button onClick={copy} className="p-1 text-emerald-700 dark:text-emerald-400" title="Copy password">
                <Copy className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">This password is shown only once. Share it securely.</p>
            {copied && <p className="mt-1 text-xs text-emerald-600">Copied to clipboard.</p>}
          </div>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onDismiss}>✕</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function InviteUserDialog({
  open, onClose, tenantId,
}: { open: boolean; onClose: () => void; tenantId?: string }) {
  const { token, role, user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const authTenantId = ((user as any)?.organization_id ?? (user as any)?.tenant_id)
    ? String((user as any)?.organization_id ?? (user as any)?.tenant_id)
    : '';
  const effectiveTenantId = tenantId ?? (role === 'tenant_admin' ? authTenantId : '');

  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', username: '',
    role_group: '', branch_id: '', job_title: '', password: '',
  });
  const [showPassword, setShowPassword] = useState(false);

  const { data: tenantsData } = useQuery({
    queryKey: ['tenants-mini'],
    queryFn: () => api(token!, '/tenants/?page_size=100'),
    enabled: open && role === 'superadmin',
  });
  const [selectedTenantId, setSelectedTenantId] = useState(effectiveTenantId);

  useEffect(() => {
    if (!open) return;
    setSelectedTenantId(effectiveTenantId);
    setForm({
      first_name: '', last_name: '', email: '', username: '',
      role_group: '', branch_id: '', job_title: '', password: '',
    });
  }, [open, effectiveTenantId]);

  useEffect(() => {
    setForm(p => ({ ...p, branch_id: '' }));
  }, [selectedTenantId]);

  const { data: branchData } = useQuery({
    queryKey: ['branches-for-invite', selectedTenantId],
    queryFn: () => api(token!, `/tenants/${selectedTenantId}/branches/`),
    enabled: open && !!selectedTenantId,
  });
  const branches = branchData?.data?.branches ?? branchData?.results ?? [];

  const mutation = useMutation({
    mutationFn: () => {
      const tid = effectiveTenantId || selectedTenantId;
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
              <Label>Organization *</Label>
              <Select value={selectedTenantId} onValueChange={setSelectedTenantId}>
                <SelectTrigger><SelectValue placeholder="Select organization…" /></SelectTrigger>
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
          <div className="space-y-1.5">
            <Label>Password</Label>
            <div className="flex items-center gap-2">
              <Input
                value={form.password}
                onChange={f('password')}
                type={showPassword ? 'text' : 'password'}
                placeholder="Leave blank to auto-generate"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="p-1 text-muted-foreground"
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">Leave blank to generate a temporary password automatically.</p>
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
            disabled={mutation.isPending || !form.first_name || !form.email || !form.role_group || (!!form.password && form.password.length < 8)}
          >
            {mutation.isPending ? 'Inviting…' : 'Send Invite'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({
  open, onClose, user, branches, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  user: any;
  branches: any[];
  onSaved: (updatedUser: any, generatedPassword?: string) => void;
}) {
  const { token, role } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    username: '',
    password: '',
    job_title: '',
    branch_id: '',
    is_active: true,
    is_tenant_admin: false,
  });

  useEffect(() => {
    if (!user) return;
    setForm({
      first_name: user.first_name ?? '',
      last_name: user.last_name ?? '',
      email: user.email ?? '',
      username: user.username ?? '',
      password: '',
      job_title: user.job_title ?? '',
      branch_id: user.branch_id ? String(user.branch_id) : '',
      is_active: Boolean(user.is_active),
      is_tenant_admin: Boolean((user as any).is_org_admin ?? user.is_tenant_admin),
    });
  }, [user]);

  const [membershipForm, setMembershipForm] = useState({
    tenant_id: '',
    role: 'member',
    is_default: false,
  });

  useEffect(() => {
    setMembershipForm({ tenant_id: '', role: 'member', is_default: false });
  }, [user?.id]);

  const { data: accessibleTenantsData } = useQuery({
    queryKey: ['membership-tenants', user?.id],
    queryFn: () => api(token!, '/tenants/?page_size=100'),
    enabled: open && !!token && !!user,
  });
  const accessibleTenants = accessibleTenantsData?.results ?? [];

  const { data: membershipsData } = useQuery({
    queryKey: ['user-memberships', user?.id],
    queryFn: () => api(token!, `/users/${user.id}/memberships/`),
    enabled: open && !!token && !!user?.id,
  });
  const memberships = membershipsData?.data?.memberships ?? membershipsData?.memberships ?? [];

  const selectedMembership = memberships.find((entry: any) => String(entry.tenant) === membershipForm.tenant_id);

  useEffect(() => {
    if (!selectedMembership) return;
    setMembershipForm({
      tenant_id: String(selectedMembership.tenant),
      role: selectedMembership.role || 'member',
      is_default: Boolean(selectedMembership.is_default),
    });
  }, [selectedMembership?.id]);

  const { data: membershipBranchesData } = useQuery({
    queryKey: ['membership-branches', membershipForm.tenant_id],
    queryFn: () => api(token!, `/tenants/${membershipForm.tenant_id}/branches/`),
    enabled: open && !!token && !!membershipForm.tenant_id,
  });
  const membershipBranches = membershipBranchesData?.data?.branches ?? membershipBranchesData?.results ?? [];

  const membershipMutation = useMutation({
    mutationFn: async () => {
      const roleValue = membershipForm.role;
      const roleGroupName = roleValue === 'system_admin' || roleValue === 'owner'
        ? 'Tenant Admin'
        : roleValue === 'finance'
          ? 'Finance'
          : roleValue === 'operator'
            ? 'Operator'
            : '';
      const payload: any = {
        tenant_id: Number(membershipForm.tenant_id),
        role: roleValue,
        role_group_name: roleGroupName,
        is_org_admin: roleValue === 'owner' || roleValue === 'system_admin',
        is_default: membershipForm.is_default,
        branch_id: form.branch_id || null,
        job_title: form.job_title,
      };
      if (selectedMembership) {
        return api(token!, `/memberships/${selectedMembership.id}/`, 'PATCH', payload);
      }
      return api(token!, `/users/${user.id}/memberships/`, 'POST', payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-memberships', user?.id] });
      qc.invalidateQueries({ queryKey: ['platform-users'] });
      qc.invalidateQueries({ queryKey: ['platform-auth-me'] });
      toast({ title: selectedMembership ? 'Organization membership updated' : 'Organization membership added' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const removeMembershipMutation = useMutation({
    mutationFn: (membershipId: number) => api(token!, `/memberships/${membershipId}/`, 'DELETE'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-memberships', user?.id] });
      qc.invalidateQueries({ queryKey: ['platform-users'] });
      qc.invalidateQueries({ queryKey: ['platform-auth-me'] });
      toast({ title: 'Organization membership removed' });
      setMembershipForm({ tenant_id: '', role: 'member', is_default: false });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const makeDefaultMembershipMutation = useMutation({
    mutationFn: (membershipId: number) => api(token!, `/memberships/${membershipId}/`, 'PATCH', { is_default: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-memberships', user?.id] });
      qc.invalidateQueries({ queryKey: ['platform-users'] });
      qc.invalidateQueries({ queryKey: ['platform-auth-me'] });
      toast({ title: 'Default organization updated' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
        username: form.username,
        job_title: form.job_title,
        is_active: form.is_active,
      };
      if (form.password.trim()) payload.password = form.password;
      const activeOrganizationId = (user as any)?.organization_id ?? user?.tenant_id;
      if (activeOrganizationId) payload.branch_id = form.branch_id || null;
      if (role === 'superadmin' && activeOrganizationId) payload.is_tenant_admin = form.is_tenant_admin;
      return api(token!, `/users/${user.id}/update/`, 'PATCH', payload);
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['platform-users'] });
      qc.invalidateQueries({ queryKey: ['tenant-users'] });
      toast({ title: 'User updated' });
      onSaved(res?.data ?? res, form.password.trim() || undefined);
      onClose();
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm(p => ({ ...p, [k]: value }));
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>First Name</Label>
              <Input value={form.first_name} onChange={f('first_name')} />
            </div>
            <div className="space-y-1.5">
              <Label>Last Name</Label>
              <Input value={form.last_name} onChange={f('last_name')} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={form.email} onChange={f('email')} type="email" />
            </div>
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input value={form.username} onChange={f('username')} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>New Password</Label>
            <Input value={form.password} onChange={f('password')} type="password" placeholder="Leave blank to keep current password" />
          </div>
          {((user as any)?.organization_id ?? user?.tenant_id) && (
            <>
              <div className="space-y-1.5">
                <Label>Job Title</Label>
                <Input value={form.job_title} onChange={f('job_title')} />
              </div>
              {branches.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Branch</Label>
                  <Select value={form.branch_id || '__none__'} onValueChange={v => setForm(p => ({ ...p, branch_id: v === '__none__' ? '' : v }))}>
                    <SelectTrigger><SelectValue placeholder="No branch" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No branch</SelectItem>
                      {branches.map((branch: any) => (
                        <SelectItem key={branch.id} value={String(branch.id)}>{branch.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}
          <div className="flex items-center justify-between rounded border px-3 py-2 text-sm">
            <span>Active user</span>
            <input type="checkbox" checked={form.is_active} onChange={f('is_active')} />
          </div>
          {role === 'superadmin' && ((user as any)?.organization_id ?? user?.tenant_id) && (
            <div className="flex items-center justify-between rounded border px-3 py-2 text-sm">
              <span>Organization admin</span>
              <input type="checkbox" checked={form.is_tenant_admin} onChange={f('is_tenant_admin')} />
            </div>
          )}
          <div className="space-y-3 rounded border p-3">
            <div>
              <p className="text-sm font-medium">Organizations</p>
              <p className="text-xs text-muted-foreground">Link this user to one or more organizations and choose the default active one.</p>
            </div>
            <div className="space-y-2">
              {memberships.length === 0 ? (
                <p className="text-xs text-muted-foreground">No organization memberships yet.</p>
              ) : memberships.map((membership: any) => (
                <div key={membership.id} className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium">{membership.organization_name ?? membership.tenant_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {membership.role}{membership.branch_name ? ` · ${membership.branch_name}` : ''}{membership.is_default ? ' · Default' : ''}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {!membership.is_default && (
                      <Button type="button" variant="outline" size="sm" onClick={() => makeDefaultMembershipMutation.mutate(membership.id)}>
                        Make Default
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setMembershipForm({
                        tenant_id: String(membership.tenant),
                        role: membership.role || 'member',
                        is_default: Boolean(membership.is_default),
                      })}
                    >
                      Edit
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeMembershipMutation.mutate(membership.id)}>
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Organization</Label>
                <Select value={membershipForm.tenant_id} onValueChange={value => setMembershipForm(p => ({ ...p, tenant_id: value }))}>
                  <SelectTrigger><SelectValue placeholder="Select organization" /></SelectTrigger>
                  <SelectContent>
                    {accessibleTenants.map((tenant: any) => (
                      <SelectItem key={tenant.id} value={String(tenant.id)}>{tenant.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Org Role</Label>
                <Select value={membershipForm.role} onValueChange={value => setMembershipForm(p => ({ ...p, role: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MEMBERSHIP_ROLE_OPTIONS.map(option => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {membershipForm.tenant_id && membershipBranches.length > 0 && (
              <div className="space-y-1.5">
                <Label>Organization Branch</Label>
                <Select value={form.branch_id || '__none__'} onValueChange={v => setForm(p => ({ ...p, branch_id: v === '__none__' ? '' : v }))}>
                  <SelectTrigger><SelectValue placeholder="No branch" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No branch</SelectItem>
                    {membershipBranches.map((branch: any) => (
                      <SelectItem key={branch.id} value={String(branch.id)}>{branch.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex items-center justify-between rounded border px-3 py-2 text-sm">
              <span>Default organization</span>
              <input
                type="checkbox"
                checked={membershipForm.is_default}
                onChange={(e) => setMembershipForm(p => ({ ...p, is_default: e.target.checked }))}
              />
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => membershipMutation.mutate()}
                disabled={membershipMutation.isPending || !membershipForm.tenant_id}
              >
                {membershipMutation.isPending ? 'Saving org link…' : selectedMembership ? 'Update Org Link' : 'Add Org Link'}
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.username.trim()}>
            {mutation.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Users() {
  const { token, role, user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [tenantFilter, setTenantFilter] = useState('all');
  const [showInvite, setShowInvite] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [passwordResult, setPasswordResult] = useState<PasswordResult | null>(null);
  const activeInviteTenantId = role === 'tenant_admin'
    ? (((user as any)?.organization_id ?? (user as any)?.tenant_id) ? String((user as any)?.organization_id ?? (user as any)?.tenant_id) : undefined)
    : (tenantFilter !== 'all' ? tenantFilter : undefined);

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

  const { data: branchesData } = useQuery({
    queryKey: ['user-edit-branches', editingUser?.organization_id ?? editingUser?.tenant_id],
    queryFn: () => api(token!, `/tenants/${editingUser.organization_id ?? editingUser.tenant_id}/branches/`),
    enabled: !!token && !!(editingUser?.organization_id ?? editingUser?.tenant_id),
  });
  const branches = branchesData?.data?.branches ?? branchesData?.results ?? [];

  const toggleMutation = useMutation({
    mutationFn: (u: any) => api(token!, `/users/${u.id}/update/`, 'PATCH', { is_active: !u.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-users'] }),
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  let users: any[] = data?.results ?? [];
  if (tenantFilter !== 'all') {
    users = users.filter((u: any) => (u.organization_id ?? u.tenant_id) === Number(tenantFilter));
  }

  return (
    <div className="space-y-6">
      {passwordResult && (
        <PasswordBanner result={passwordResult} onDismiss={() => setPasswordResult(null)} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Users</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Manage platform users and organization access</p>
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
            <SelectTrigger className="w-48"><SelectValue placeholder="All Organizations" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Organizations</SelectItem>
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
                      {(u.organization_name ?? u.tenant_name) && (
                        <span className="text-xs text-muted-foreground hidden sm:block">{u.organization_name ?? u.tenant_name}</span>
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
                          title="Edit user"
                          onClick={() => setEditingUser(u)}
                        >
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      )}
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

      <InviteUserDialog open={showInvite} onClose={() => setShowInvite(false)} tenantId={activeInviteTenantId} />
      {editingUser && (
        <EditUserDialog
          open={!!editingUser}
          onClose={() => setEditingUser(null)}
          user={editingUser}
          branches={branches}
          onSaved={(updatedUser, generatedPassword) => {
            if (generatedPassword) {
              setPasswordResult({
                title: 'User password updated',
                username: updatedUser.username,
                email: updatedUser.email,
                temp_password: generatedPassword,
              });
            }
          }}
        />
      )}
    </div>
  );
}
