import { useState, useEffect } from 'react';
import { useAuth } from '@/context/use-auth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Building2, Mail, FileText, GitBranch, Plus, Pencil, RefreshCw, Users, Copy, Eye, EyeOff, UserCheck, UserX } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

const BASE = '/api/platform';
const CURRENCIES = ['KES', 'USD', 'EUR', 'GBP', 'UGX', 'TZS'];
const TIMEZONES = ['Africa/Nairobi', 'Africa/Kampala', 'Africa/Dar_es_Salaam', 'Africa/Kigali', 'UTC'];

// Roles a tenant admin may assign (excludes privileged platform roles)
const ASSIGNABLE_ROLES = [
  { value: 'Tenant Admin', label: 'Tenant Admin' },
  { value: 'Finance', label: 'Finance' },
  { value: 'Operator', label: 'Operator' },
];

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

function BranchDialog({ tenantId, branch, open, onClose }: { tenantId: number; branch?: any; open: boolean; onClose: () => void }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isEdit = !!branch;
  const [form, setForm] = useState(branch ? {
    name: branch.name, address: branch.address, email: branch.email, phone: branch.phone, is_active: branch.is_active,
  } : { name: '', address: '', email: '', phone: '', is_active: true });

  const mutation = useMutation({
    mutationFn: () => isEdit
      ? api(token!, `/branches/${branch.id}/`, 'PATCH', form)
      : api(token!, `/tenants/${tenantId}/branches/`, 'POST', form),
    onSuccess: () => {
      toast({ title: isEdit ? 'Branch updated' : 'Branch added' });
      qc.invalidateQueries({ queryKey: ['my-branches'] });
      onClose();
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{isEdit ? 'Edit Branch' : 'Add Branch'}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5"><Label>Name *</Label><Input value={form.name} onChange={f('name')} /></div>
          <div className="space-y-1.5"><Label>Address</Label><Input value={form.address} onChange={f('address')} /></div>
          <div className="space-y-1.5"><Label>Email</Label><Input value={form.email} onChange={f('email')} type="email" /></div>
          <div className="space-y-1.5"><Label>Phone</Label><Input value={form.phone} onChange={f('phone')} /></div>
          <div className="flex items-center gap-3"><Switch checked={form.is_active} onCheckedChange={v => setForm(p => ({ ...p, is_active: v }))} /><Label>Active</Label></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!form.name || mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Invite Dialog ──────────────────────────────────────────────────────────────

interface InviteResult {
  user: any;
  temp_password: string;
}

function InviteDialog({ tenantId, branches, open, onClose, onInvited }: {
  tenantId: number;
  branches: any[];
  open: boolean;
  onClose: () => void;
  onInvited: (result: InviteResult) => void;
}) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    role_group: '',
    job_title: '',
    branch_id: '',
  });

  const mutation = useMutation({
    mutationFn: () => {
      const payload: any = {
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
      };
      if (form.role_group) payload.role_group = form.role_group;
      if (form.job_title) payload.job_title = form.job_title;
      if (form.branch_id) payload.branch_id = parseInt(form.branch_id);
      return api(token!, `/tenants/${tenantId}/users/invite/`, 'POST', payload);
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['my-team', tenantId] });
      const data = r?.data ?? r;
      onInvited({ user: data.user, temp_password: data.temp_password });
      onClose();
    },
    onError: (e: any) => toast({ title: 'Invite failed', description: e.message, variant: 'destructive' }),
  });

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }));
  const valid = form.first_name.trim() && form.email.trim();

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Invite Team Member</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>First Name *</Label>
              <Input value={form.first_name} onChange={f('first_name')} placeholder="Jane" />
            </div>
            <div className="space-y-1.5">
              <Label>Last Name</Label>
              <Input value={form.last_name} onChange={f('last_name')} placeholder="Doe" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Email *</Label>
            <Input value={form.email} onChange={f('email')} type="email" placeholder="jane@company.com" />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={form.role_group} onValueChange={v => setForm(p => ({ ...p, role_group: v }))}>
              <SelectTrigger><SelectValue placeholder="Select a role…" /></SelectTrigger>
              <SelectContent>
                {ASSIGNABLE_ROLES.map(r => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Job Title</Label>
            <Input value={form.job_title} onChange={f('job_title')} placeholder="e.g. Weighbridge Operator" />
          </div>
          {branches.length > 0 && (
            <div className="space-y-1.5">
              <Label>Branch</Label>
              <Select value={form.branch_id} onValueChange={v => setForm(p => ({ ...p, branch_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Any branch" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any branch</SelectItem>
                  {branches.map((b: any) => (
                    <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!valid || mutation.isPending}>
            {mutation.isPending ? 'Inviting…' : 'Send Invite'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Temp Password Banner ───────────────────────────────────────────────────────

function TempPasswordBanner({ result, onDismiss }: { result: InviteResult; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const copy = () => {
    navigator.clipboard.writeText(result.temp_password).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const name = [result.user?.first_name, result.user?.last_name].filter(Boolean).join(' ') || result.user?.username || 'User';

  return (
    <Card className="border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
              {name} invited — share their temporary password
            </p>
            <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
              Username: <span className="font-mono font-semibold">{result.user?.username}</span>
            </p>
            <div className="flex items-center gap-2 mt-2">
              <code className="flex-1 truncate rounded bg-emerald-100 dark:bg-emerald-900/40 px-2 py-1 text-sm font-mono text-emerald-900 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-700">
                {visible ? result.temp_password : '••••••••••••'}
              </code>
              <button
                onClick={() => setVisible(v => !v)}
                className="text-emerald-700 dark:text-emerald-400 hover:text-emerald-900 dark:hover:text-emerald-200 p-1"
                title={visible ? 'Hide' : 'Show'}
              >
                {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              <button
                onClick={copy}
                className="text-emerald-700 dark:text-emerald-400 hover:text-emerald-900 dark:hover:text-emerald-200 p-1"
                title="Copy password"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
            {copied && <p className="text-xs text-emerald-600 mt-1">Copied to clipboard!</p>}
            <p className="text-xs text-muted-foreground mt-1.5">
              This password is shown only once. Ask {name} to change it immediately after first login.
            </p>
          </div>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0 text-emerald-700" onClick={onDismiss}>✕</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Team Tab ───────────────────────────────────────────────────────────────────

function TeamTab({ tenantId, branches }: { tenantId: number; branches: any[] }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [lastInvite, setLastInvite] = useState<InviteResult | null>(null);

  const { data: teamData, isLoading } = useQuery({
    queryKey: ['my-team', tenantId],
    queryFn: () => api(token!, `/tenants/${tenantId}/users/`),
    enabled: !!tenantId,
  });

  const users: any[] = teamData?.data?.users ?? teamData?.users ?? [];

  const toggleActive = useMutation({
    mutationFn: ({ userId, isActive }: { userId: number; isActive: boolean }) =>
      api(token!, `/users/${userId}/update/`, 'PATCH', { is_active: isActive }),
    onSuccess: (_, vars) => {
      toast({ title: vars.isActive ? 'User reactivated' : 'User deactivated' });
      qc.invalidateQueries({ queryKey: ['my-team', tenantId] });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const getRoleLabel = (user: any) => {
    const groups: any[] = user.groups ?? [];
    if (!groups.length) return null;
    return groups.map((g: any) => (typeof g === 'string' ? g : g.name)).join(', ');
  };

  return (
    <div className="space-y-4">
      {lastInvite && (
        <TempPasswordBanner result={lastInvite} onDismiss={() => setLastInvite(null)} />
      )}

      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          {isLoading ? 'Loading…' : `${users.length} team member${users.length !== 1 ? 's' : ''}`}
        </p>
        <Button size="sm" onClick={() => setInviteOpen(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Invite Member
        </Button>
      </div>

      {isLoading ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">Loading team…</CardContent></Card>
      ) : users.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">No team members yet. Invite your first member.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {users.map((u: any) => {
            const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username;
            const roleLabel = getRoleLabel(u);
            const isActive = u.is_active ?? true;
            const isSelf = u.id === (token ? undefined : undefined); // we don't block self in UI, backend handles it
            return (
              <Card key={u.id}>
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{fullName}</p>
                      {roleLabel && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                          {roleLabel}
                        </Badge>
                      )}
                      {!isActive && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground">
                          Inactive
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {[u.email, u.username !== u.email ? `@${u.username}` : null, u.tenant_profile?.job_title].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={`gap-1.5 text-xs shrink-0 ${isActive ? 'text-destructive hover:text-destructive' : 'text-emerald-600 hover:text-emerald-700'}`}
                    disabled={toggleActive.isPending}
                    onClick={() => toggleActive.mutate({ userId: u.id, isActive: !isActive })}
                    title={isActive ? 'Deactivate user' : 'Reactivate user'}
                  >
                    {isActive
                      ? <><UserX className="h-3.5 w-3.5" /> Deactivate</>
                      : <><UserCheck className="h-3.5 w-3.5" /> Reactivate</>
                    }
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {inviteOpen && (
        <InviteDialog
          tenantId={tenantId}
          branches={branches}
          open={inviteOpen}
          onClose={() => setInviteOpen(false)}
          onInvited={(result) => {
            setLastInvite(result);
            setInviteOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function CompanySettings() {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  // Determine tenant id from user profile
  const tenantId = (user as any)?.tenant_id;

  const { data: tenantData, isLoading: tenantLoading } = useQuery({
    queryKey: ['my-tenant', tenantId],
    queryFn: () => api(token!, `/tenants/self/`),
    enabled: !!token,
  });
  const { data: settingsData } = useQuery({
    queryKey: ['my-tenant-settings', tenantId],
    queryFn: () => api(token!, `/tenants/${tenantId}/settings/`),
    enabled: !!tenantId,
  });
  const { data: branchData, refetch: refetchBranches } = useQuery({
    queryKey: ['my-branches', tenantId],
    queryFn: () => api(token!, `/tenants/${tenantId}/branches/`),
    enabled: !!tenantId,
  });

  const tenant = tenantData?.data ?? tenantData ?? {};
  const settings = settingsData?.data ?? settingsData ?? {};
  const branches: any[] = branchData?.data?.branches ?? branchData?.results ?? [];

  const [tenantForm, setTenantForm] = useState<any>(null);
  const [settingsForm, setSettingsForm] = useState<any>(null);
  const [branchDialog, setBranchDialog] = useState<{ open: boolean; branch?: any }>({ open: false });

  useEffect(() => {
    if (tenant?.id && !tenantForm) setTenantForm({ name: tenant.name, legal_name: tenant.legal_name, contact_email: tenant.contact_email, contact_phone: tenant.contact_phone, default_currency: tenant.default_currency, timezone: tenant.timezone });
  }, [tenant]);
  useEffect(() => {
    if (settings?.tenant && !settingsForm) setSettingsForm({ ...settings, smtp_password: '' });
  }, [settings]);

  const saveTenant = useMutation({
    mutationFn: () => api(token!, `/tenants/self/`, 'PATCH', tenantForm),
    onSuccess: () => { toast({ title: 'Company info saved' }); qc.invalidateQueries({ queryKey: ['my-tenant'] }); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });
  const saveSettings = useMutation({
    mutationFn: () => {
      const payload = { ...settingsForm };
      if (!payload.smtp_password) delete payload.smtp_password;
      return api(token!, `/tenants/${tenantId}/settings/`, 'PUT', payload);
    },
    onSuccess: () => { toast({ title: 'Settings saved' }); qc.invalidateQueries({ queryKey: ['my-tenant-settings'] }); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });
  const testSmtp = useMutation({
    mutationFn: () => api(token!, `/tenants/${tenantId}/settings/test-smtp/`, 'POST'),
    onSuccess: (r) => toast({ title: 'Test email sent', description: r.data?.message }),
    onError: (e: any) => toast({ title: 'Test failed', description: e.message, variant: 'destructive' }),
  });

  const tf = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setTenantForm((p: any) => ({ ...p, [k]: e.target.value }));
  const sf = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setSettingsForm((p: any) => ({ ...p, [k]: e.target.value }));

  if (!tenantId) return (
    <div className="p-12 text-center text-muted-foreground text-sm">
      No tenant assigned to your account. Contact your platform administrator.
    </div>
  );

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="border-b pb-4">
        <h1 className="text-2xl font-bold tracking-tight">Company Settings</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Configure your organisation's information, branding, and integrations</p>
      </div>

      <Tabs defaultValue="company">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="company" className="gap-1.5"><Building2 className="h-3.5 w-3.5" /> Company</TabsTrigger>
          <TabsTrigger value="email" className="gap-1.5"><Mail className="h-3.5 w-3.5" /> Email</TabsTrigger>
          <TabsTrigger value="invoicing" className="gap-1.5"><FileText className="h-3.5 w-3.5" /> Invoicing</TabsTrigger>
          <TabsTrigger value="branches" className="gap-1.5"><GitBranch className="h-3.5 w-3.5" /> Branches</TabsTrigger>
          <TabsTrigger value="team" className="gap-1.5"><Users className="h-3.5 w-3.5" /> Team</TabsTrigger>
        </TabsList>

        {/* ── Company Tab ────────────────────────────────────────────────── */}
        <TabsContent value="company" className="mt-6">
          <Card>
            <CardHeader className="bg-muted/20 border-b py-3 px-4">
              <CardTitle className="text-xs font-bold uppercase tracking-widest">Company Information</CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              {tenantForm && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Company Name *</Label>
                      <Input value={tenantForm.name ?? ''} onChange={tf('name')} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Legal Name</Label>
                      <Input value={tenantForm.legal_name ?? ''} onChange={tf('legal_name')} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Contact Email</Label>
                      <Input value={tenantForm.contact_email ?? ''} onChange={tf('contact_email')} type="email" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Phone</Label>
                      <Input value={tenantForm.contact_phone ?? ''} onChange={tf('contact_phone')} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Default Currency</Label>
                      <Select value={tenantForm.default_currency ?? 'KES'} onValueChange={v => setTenantForm((p: any) => ({ ...p, default_currency: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Timezone</Label>
                      <Select value={tenantForm.timezone ?? 'Africa/Nairobi'} onValueChange={v => setTenantForm((p: any) => ({ ...p, timezone: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{TIMEZONES.map(tz => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button onClick={() => saveTenant.mutate()} disabled={saveTenant.isPending}>
                    {saveTenant.isPending ? 'Saving…' : 'Save Company Info'}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Email Tab ──────────────────────────────────────────────────── */}
        <TabsContent value="email" className="mt-6">
          <Card>
            <CardHeader className="bg-muted/20 border-b py-3 px-4">
              <CardTitle className="text-xs font-bold uppercase tracking-widest">SMTP Configuration</CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              {settingsForm && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>Support Email (From address)</Label>
                      <Input value={settingsForm.support_email ?? ''} onChange={sf('support_email')} type="email" placeholder="support@yourdomain.com" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>SMTP Host</Label>
                      <Input value={settingsForm.smtp_host ?? ''} onChange={sf('smtp_host')} placeholder="smtp.gmail.com" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>SMTP Port</Label>
                      <Input value={settingsForm.smtp_port ?? '587'} onChange={sf('smtp_port')} type="number" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>SMTP Username</Label>
                      <Input value={settingsForm.smtp_user ?? ''} onChange={sf('smtp_user')} type="email" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>SMTP Password</Label>
                      <Input value={settingsForm.smtp_password ?? ''} onChange={sf('smtp_password')} type="password" placeholder="Leave blank to keep existing" />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch checked={settingsForm.smtp_use_tls ?? true} onCheckedChange={v => setSettingsForm((p: any) => ({ ...p, smtp_use_tls: v }))} />
                    <Label>Use TLS</Label>
                  </div>
                  <div className="flex gap-3">
                    <Button onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending}>
                      {saveSettings.isPending ? 'Saving…' : 'Save Email Config'}
                    </Button>
                    <Button variant="outline" onClick={() => testSmtp.mutate()} disabled={testSmtp.isPending}>
                      {testSmtp.isPending ? 'Sending…' : 'Send Test Email'}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Invoicing Tab ─────────────────────────────────────────────── */}
        <TabsContent value="invoicing" className="mt-6">
          <Card>
            <CardHeader className="bg-muted/20 border-b py-3 px-4">
              <CardTitle className="text-xs font-bold uppercase tracking-widest">Invoice Settings</CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              {settingsForm && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Invoice Number Prefix</Label>
                      <Input value={settingsForm.invoice_prefix ?? 'INV'} onChange={sf('invoice_prefix')} placeholder="INV" maxLength={10} />
                      <p className="text-xs text-muted-foreground">e.g. INV-2024-0001</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Default Payment Terms (days)</Label>
                      <Input value={settingsForm.default_payment_terms_days ?? '30'} onChange={sf('default_payment_terms_days')} type="number" min="0" />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>Invoice Footer Text</Label>
                      <Input value={settingsForm.footer_text ?? ''} onChange={sf('footer_text')} placeholder="Thank you for your business." />
                    </div>
                  </div>
                  <Button onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending}>
                    {saveSettings.isPending ? 'Saving…' : 'Save Invoice Settings'}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Branches Tab ──────────────────────────────────────────────── */}
        <TabsContent value="branches" className="mt-6 space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">{branches.length} branch{branches.length !== 1 ? 'es' : ''}</p>
            <Button size="sm" onClick={() => setBranchDialog({ open: true })} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Add Branch
            </Button>
          </div>
          {branches.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">No branches yet. Add your first branch.</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {branches.map((b: any) => (
                <Card key={b.id}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-sm">{b.name}</p>
                      <p className="text-xs text-muted-foreground">{[b.email, b.phone, b.address].filter(Boolean).join(' · ')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${b.is_active ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-gray-100 text-gray-500 border-gray-300'}`}>
                        {b.is_active ? 'Active' : 'Inactive'}
                      </span>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setBranchDialog({ open: true, branch: b })}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Team Tab ──────────────────────────────────────────────────── */}
        <TabsContent value="team" className="mt-6">
          <TeamTab tenantId={tenantId} branches={branches} />
        </TabsContent>
      </Tabs>

      {branchDialog.open && tenantId && (
        <BranchDialog
          tenantId={tenantId}
          branch={branchDialog.branch}
          open={branchDialog.open}
          onClose={() => { setBranchDialog({ open: false }); refetchBranches(); }}
        />
      )}
    </div>
  );
}
