import { useState } from 'react';
import { useAuth } from '@/context/use-auth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Building2, Plus, Search, Users, GitBranch, Settings,
  CheckCircle2, AlertCircle, Clock, XCircle, RefreshCw, Copy, Eye, EyeOff,
} from 'lucide-react';

const BASE = '/api/platform';

const STATUS_STYLE: Record<string, string> = {
  active:    'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400',
  trial:     'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400',
  draft:     'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400',
  suspended: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/30 dark:text-red-400',
  archived:  'bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-900/30 dark:text-gray-400',
};
const STATUS_ICON: Record<string, React.ReactNode> = {
  active:    <CheckCircle2 className="h-3 w-3" />,
  trial:     <Clock className="h-3 w-3" />,
  draft:     <Clock className="h-3 w-3" />,
  suspended: <AlertCircle className="h-3 w-3" />,
  archived:  <XCircle className="h-3 w-3" />,
};

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

function TenantPasswordBanner({
  result, onDismiss,
}: {
  result: { admin_username: string; admin_email: string; admin_temp_password: string; tenant_name: string };
  onDismiss: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(result.admin_temp_password).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Card className="border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
              {result.tenant_name} tenant created
            </p>
            <p className="mt-0.5 text-xs text-emerald-700 dark:text-emerald-400">
              Admin username: <span className="font-mono font-semibold">{result.admin_username}</span>
              {' '}· Email: <span className="font-mono">{result.admin_email}</span>
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 truncate rounded border border-emerald-200 bg-emerald-100 px-2 py-1 text-sm font-mono text-emerald-900 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
                {visible ? result.admin_temp_password : '••••••••••••'}
              </code>
              <button onClick={() => setVisible(v => !v)} className="p-1 text-emerald-700 dark:text-emerald-400" title={visible ? 'Hide' : 'Show'}>
                {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              <button onClick={copy} className="p-1 text-emerald-700 dark:text-emerald-400" title="Copy password">
                <Copy className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">This temporary password is only returned at creation time.</p>
            {copied && <p className="mt-1 text-xs text-emerald-600">Copied to clipboard.</p>}
          </div>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onDismiss}>✕</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── New Tenant Dialog ─────────────────────────────────────────────────────────
function NewTenantDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [createdAdmin, setCreatedAdmin] = useState<any | null>(null);
  const [form, setForm] = useState({
    name: '', legal_name: '', subdomain: '', contact_email: '',
    admin_first_name: '', admin_last_name: '', admin_email: '',
    plan_id: '', demo_days: '', industry_id: '',
  });
  const { data: plansData } = useQuery({
    queryKey: ['plans-list'],
    queryFn: () => api(token!, '/plans/?page_size=100'),
    enabled: open,
  });
  const { data: industriesData } = useQuery({
    queryKey: ['industries-list'],
    queryFn: () => api(token!, '/industries/?page_size=100'),
    enabled: open,
  });
  const { data: suggestedModulesData } = useQuery({
    queryKey: ['industry-modules', form.industry_id],
    queryFn: () => api(token!, `/modules/?page_size=100${form.industry_id ? `&industry_id=${form.industry_id}` : ''}`),
    enabled: open && !!form.industry_id,
  });
  const plans = plansData?.results ?? [];
  const industries = industriesData?.results ?? [];
  const suggestedModules = suggestedModulesData?.results ?? [];

  const mutation = useMutation({
    mutationFn: () => api(token!, '/tenants/provision/', 'POST', form),
    onSuccess: (data) => {
      const payload = data.data ?? data;
      setCreatedAdmin({
        admin_username: payload.admin_username,
        admin_email: payload.admin_email,
        admin_temp_password: payload.admin_temp_password,
        tenant_name: payload.tenant?.name ?? form.name,
      });
      toast({
        title: 'Tenant created',
        description: `Admin login created for ${payload.admin_username}`,
      });
      qc.invalidateQueries({ queryKey: ['tenants'] });
      onClose();
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <>
      {createdAdmin && (
        <div className="mb-4">
          <TenantPasswordBanner result={createdAdmin} onDismiss={() => setCreatedAdmin(null)} />
        </div>
      )}
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Building2 className="h-5 w-5" /> New Tenant</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label>Company Name *</Label>
                <Input value={form.name} onChange={f('name')} placeholder="Acme Logistics Ltd" />
              </div>
              <div className="space-y-1.5">
                <Label>Legal Name</Label>
                <Input value={form.legal_name} onChange={f('legal_name')} placeholder="Acme Logistics Limited" />
              </div>
              <div className="space-y-1.5">
                <Label>Subdomain *</Label>
                <Input value={form.subdomain} onChange={f('subdomain')} placeholder="acme" />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Contact Email *</Label>
                <Input value={form.contact_email} onChange={f('contact_email')} placeholder="admin@acme.com" type="email" />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Industry</Label>
                <Select value={form.industry_id} onValueChange={v => setForm(p => ({ ...p, industry_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select industry…" /></SelectTrigger>
                  <SelectContent>
                    {industries.map((industry: any) => (
                      <SelectItem key={industry.id} value={String(industry.id)}>{industry.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">This helps tailor which ERP modules appear during onboarding.</p>
              </div>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Suggested Modules</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {form.industry_id ? 'Preview of modules aligned to the selected industry.' : 'Select an industry to preview recommended modules.'}
                  </p>
                </div>
                <Badge variant="secondary">{suggestedModules.length}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {suggestedModules.length > 0 ? suggestedModules.map((mod: any) => (
                  <Badge key={mod.id} variant="outline">{mod.name}</Badge>
                )) : (
                  <span className="text-xs text-muted-foreground">No industry-specific module preview yet.</span>
                )}
              </div>
            </div>
            <div className="border-t pt-4">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Tenant Admin Account</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>First Name *</Label>
                  <Input value={form.admin_first_name} onChange={f('admin_first_name')} />
                </div>
                <div className="space-y-1.5">
                  <Label>Last Name *</Label>
                  <Input value={form.admin_last_name} onChange={f('admin_last_name')} />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label>Admin Email *</Label>
                  <Input value={form.admin_email} onChange={f('admin_email')} type="email" />
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Subscription Plan</Label>
              <Select value={form.plan_id} onValueChange={v => setForm(p => ({ ...p, plan_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select plan…" /></SelectTrigger>
                <SelectContent>
                  {plans.map((p: any) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name} — KES {Number(p.price).toLocaleString()}/{p.billing_period}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Demo Days</Label>
              <Input
                value={form.demo_days}
                onChange={f('demo_days')}
                type="number"
                min="0"
                placeholder="Use plan default trial"
              />
              <p className="text-xs text-muted-foreground">Leave blank to use the selected plan's trial period.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.name || !form.admin_email}>
              {mutation.isPending ? 'Creating…' : 'Create Tenant'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Tenant Detail Sheet ────────────────────────────────────────────────────────
function TenantSheet({ tenant, onClose }: { tenant: any; onClose: () => void }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: branchData } = useQuery({
    queryKey: ['tenant-branches', tenant?.id],
    queryFn: () => api(token!, `/tenants/${tenant.id}/branches/`),
    enabled: !!tenant,
  });
  const { data: userData } = useQuery({
    queryKey: ['tenant-users', tenant?.id],
    queryFn: () => api(token!, `/tenants/${tenant.id}/users/`),
    enabled: !!tenant,
  });
  const { data: settingsData } = useQuery({
    queryKey: ['tenant-settings', tenant?.id],
    queryFn: () => api(token!, `/tenants/${tenant.id}/settings/`),
    enabled: !!tenant,
  });
  const { data: industriesData } = useQuery({
    queryKey: ['tenant-industries'],
    queryFn: () => api(token!, '/industries/?page_size=100'),
    enabled: !!tenant,
  });

  const branches = branchData?.data?.branches ?? branchData?.results ?? [];
  const users = userData?.data?.users ?? userData?.results ?? [];
  const settings = settingsData?.data ?? settingsData ?? {};
  const industries = industriesData?.results ?? [];

  const [tenantForm, setTenantForm] = useState<any>(() => ({
    name: tenant.name ?? '',
    legal_name: tenant.legal_name ?? '',
    contact_email: tenant.contact_email ?? '',
    default_currency: tenant.default_currency ?? 'KES',
    timezone: tenant.timezone ?? 'Africa/Nairobi',
    industry_id: tenant.industry?.id ? String(tenant.industry.id) : '',
  }));
  const [settingsForm, setSettingsForm] = useState<any>(null);
  const sf = settingsForm ?? settings;

  const saveTenantMutation = useMutation({
    mutationFn: () => api(token!, `/tenants/${tenant.id}/`, 'PATCH', {
      ...tenantForm,
      industry_id: tenantForm.industry_id ? Number(tenantForm.industry_id) : null,
    }),
    onSuccess: () => {
      toast({ title: 'Tenant profile saved' });
      qc.invalidateQueries({ queryKey: ['tenants'] });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const saveMutation = useMutation({
    mutationFn: () => api(token!, `/tenants/${tenant.id}/settings/`, 'PUT', settingsForm ?? settings),
    onSuccess: () => {
      toast({ title: 'Settings saved' });
      qc.invalidateQueries({ queryKey: ['tenant-settings', tenant.id] });
      setSettingsForm(null);
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const suspendMutation = useMutation({
    mutationFn: (action: 'suspend' | 'activate') => api(token!, `/tenants/${tenant.id}/${action}/`, 'POST'),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tenants'] }); onClose(); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  if (!tenant) return null;

  return (
    <Sheet open={!!tenant} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="pb-4 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            {tenant.name}
            <span className={`ml-2 px-2 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase border flex items-center gap-1 ${STATUS_STYLE[tenant.status] ?? ''}`}>
              {STATUS_ICON[tenant.status]} {tenant.status}
            </span>
          </SheetTitle>
        </SheetHeader>
        <Tabs defaultValue="overview" className="mt-4">
          <TabsList className="w-full">
            <TabsTrigger value="overview" className="flex-1">Overview</TabsTrigger>
            <TabsTrigger value="branches" className="flex-1">Branches</TabsTrigger>
            <TabsTrigger value="users" className="flex-1">Users</TabsTrigger>
            <TabsTrigger value="settings" className="flex-1">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Code', tenant.code],
                ['Subdomain', tenant.subdomain || '—'],
                ['Contact Email', tenant.contact_email || '—'],
                ['Industry', tenant.industry?.name || '—'],
                ['Currency', tenant.default_currency],
                ['Timezone', tenant.timezone],
                ['Created', tenant.created_at ? new Date(tenant.created_at).toLocaleDateString('en-KE') : '—'],
              ].map(([l, v]) => (
                <div key={l} className="p-3 bg-muted/20 rounded-lg">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{l}</p>
                  <p className="text-sm font-medium mt-0.5">{v}</p>
                </div>
              ))}
            </div>
            <div className="space-y-4 rounded-xl border bg-muted/10 p-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Organization Name</Label>
                  <Input value={tenantForm.name} onChange={(e) => setTenantForm((current: any) => ({ ...current, name: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Legal Name</Label>
                  <Input value={tenantForm.legal_name} onChange={(e) => setTenantForm((current: any) => ({ ...current, legal_name: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Contact Email</Label>
                  <Input type="email" value={tenantForm.contact_email} onChange={(e) => setTenantForm((current: any) => ({ ...current, contact_email: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Industry</Label>
                  <Select value={tenantForm.industry_id} onValueChange={(value) => setTenantForm((current: any) => ({ ...current, industry_id: value }))}>
                    <SelectTrigger><SelectValue placeholder="Select industry…" /></SelectTrigger>
                    <SelectContent>
                      {industries.map((industry: any) => (
                        <SelectItem key={industry.id} value={String(industry.id)}>{industry.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button onClick={() => saveTenantMutation.mutate()} disabled={saveTenantMutation.isPending}>
                {saveTenantMutation.isPending ? 'Saving…' : 'Save Tenant Profile'}
              </Button>
            </div>
            <div className="flex gap-2 pt-2">
              {tenant.status !== 'suspended' ? (
                <Button size="sm" variant="destructive" onClick={() => suspendMutation.mutate('suspend')} disabled={suspendMutation.isPending}>
                  Suspend Tenant
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => suspendMutation.mutate('activate')} disabled={suspendMutation.isPending}>
                  Reinstate Tenant
                </Button>
              )}
            </div>
          </TabsContent>

          <TabsContent value="branches" className="mt-4 space-y-3">
            {branches.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No branches configured.</p>
            ) : branches.map((b: any) => (
              <div key={b.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <p className="font-medium text-sm">{b.name}</p>
                  <p className="text-xs text-muted-foreground">{b.email || b.address || '—'}</p>
                </div>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${b.is_active ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-gray-100 text-gray-500 border-gray-300'}`}>
                  {b.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="users" className="mt-4 space-y-3">
            {users.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No users in this tenant.</p>
            ) : users.map((u: any) => (
              <div key={u.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <p className="font-medium text-sm">{u.first_name} {u.last_name} <span className="text-muted-foreground font-normal">({u.username})</span></p>
                  <p className="text-xs text-muted-foreground">{u.email}</p>
                </div>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${u.is_active ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-gray-100 text-gray-500 border-gray-300'}`}>
                  {u.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="settings" className="mt-4 space-y-4">
            {[
              { label: 'Invoice Prefix', key: 'invoice_prefix', type: 'text' },
              { label: 'Support Email', key: 'support_email', type: 'email' },
              { label: 'Footer Text', key: 'footer_text', type: 'text' },
              { label: 'SMTP Host', key: 'smtp_host', type: 'text' },
              { label: 'SMTP Port', key: 'smtp_port', type: 'number' },
              { label: 'SMTP User', key: 'smtp_user', type: 'email' },
            ].map(({ label, key, type }) => (
              <div key={key} className="space-y-1.5">
                <Label>{label}</Label>
                <Input
                  type={type}
                  value={sf?.[key] ?? ''}
                  onChange={e => setSettingsForm((p: any) => ({ ...(p ?? settings), [key]: e.target.value }))}
                />
              </div>
            ))}
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !settingsForm}>
              {saveMutation.isPending ? 'Saving…' : 'Save Settings'}
            </Button>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Tenants() {
  const { token } = useAuth();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState<any>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['tenants', search, statusFilter],
    queryFn: () => {
      const p = new URLSearchParams({ page_size: '100' });
      if (search) p.set('search', search);
      if (statusFilter !== 'all') p.set('status', statusFilter);
      return api(token!, `/tenants/?${p}`);
    },
    enabled: !!token,
  });

  const tenants: any[] = data?.results ?? [];

  const stats = [
    { label: 'Total', value: tenants.length, color: 'text-foreground' },
    { label: 'Active', value: tenants.filter(t => t.status === 'active').length, color: 'text-emerald-600' },
    { label: 'Trial', value: tenants.filter(t => t.status === 'trial').length, color: 'text-amber-600' },
    { label: 'Suspended', value: tenants.filter(t => t.status === 'suspended').length, color: 'text-red-600' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tenants</h1>
          <p className="text-xs text-muted-foreground mt-0.5">All organisations on the platform</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw className="h-3.5 w-3.5" /></Button>
          <Button size="sm" onClick={() => setShowNew(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> New Tenant
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {stats.map(s => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{s.label}</p>
              <p className={`text-3xl font-black mt-1 ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search tenants…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="trial">Trial</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="bg-muted/20 border-b py-3 px-4">
          <CardTitle className="text-xs font-bold uppercase tracking-widest">Tenant Registry</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-8 text-center text-muted-foreground text-sm font-mono animate-pulse">Loading…</p>
          ) : tenants.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground text-sm">No tenants found.</p>
          ) : (
            <div className="divide-y">
              {tenants.map(t => (
                <button
                  key={t.id}
                  onClick={() => setSelected(t)}
                  className="w-full flex flex-wrap items-center justify-between gap-4 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Building2 className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{t.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{t.code}{t.subdomain ? ` · ${t.subdomain}` : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-muted-foreground hidden sm:block">{t.contact_email}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase border flex items-center gap-1 ${STATUS_STYLE[t.status] ?? ''}`}>
                      {STATUS_ICON[t.status]} {t.status}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <NewTenantDialog open={showNew} onClose={() => setShowNew(false)} />
      {selected && <TenantSheet tenant={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
