import { useState } from 'react';
import { useAuth } from '@/context/use-auth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  CreditCard, Plus, Pencil, RefreshCw, Users, GitBranch,
  Cpu, Activity, Trash2, Package,
} from 'lucide-react';

const MODULE_SCOPE_LABEL: Record<string, string> = {
  organization: 'Organization',
  hybrid: 'Hybrid',
  platform_admin: 'Platform Admin',
};

const BASE = '/api/platform';
function api(token: string, path: string, method = 'GET', body?: object) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async r => {
    if (method === 'DELETE' && r.status === 204) return null;
    const j = await r.json();
    if (!r.ok) throw new Error(j?.detail || j?.error || JSON.stringify(j));
    return j;
  });
}

const EMPTY_PLAN = {
  code: '', name: '', billing_period: 'monthly', price: '0',
  currency: 'KES', trial_days: '14',
  max_users: '10', max_branches: '2', max_devices: '2', max_monthly_transactions: '5000',
  is_active: true,
  features_text: '',
};

function planFeaturesToLines(features: unknown) {
  if (Array.isArray(features)) {
    return features.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join('\n');
  }
  if (features && typeof features === 'object') {
    return Object.values(features).filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join('\n');
  }
  return '';
}

function parseFeatureLines(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function PlanDialog({ open, onClose, plan }: { open: boolean; onClose: () => void; plan?: any }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isEdit = !!plan;
  const [form, setForm] = useState(() => plan ? {
    code: plan.code, name: plan.name, billing_period: plan.billing_period,
    price: String(plan.price), currency: plan.currency, trial_days: String(plan.trial_days),
    max_users: String(plan.max_users), max_branches: String(plan.max_branches),
    max_devices: String(plan.max_devices), max_monthly_transactions: String(plan.max_monthly_transactions),
    is_active: plan.is_active,
    features_text: planFeaturesToLines(plan.features),
  } : { ...EMPTY_PLAN });

  const mutation = useMutation({
    mutationFn: () => {
      const featureLines = parseFeatureLines(form.features_text);
      const payload = {
        ...form,
        price: Number(form.price),
        trial_days: Number(form.trial_days),
        max_users: Number(form.max_users),
        max_branches: Number(form.max_branches),
        max_devices: Number(form.max_devices),
        max_monthly_transactions: Number(form.max_monthly_transactions),
        features: featureLines,
      };
      delete (payload as any).features_text;
      return isEdit
        ? api(token!, `/plans/${plan.id}/`, 'PATCH', payload)
        : api(token!, '/plans/', 'POST', payload);
    },
    onSuccess: () => {
      toast({ title: isEdit ? 'Plan updated' : 'Plan created' });
      qc.invalidateQueries({ queryKey: ['plans'] });
      onClose();
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit — ${plan.name}` : 'New Subscription Plan'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2">
              <Label>Plan Name *</Label>
              <Input value={form.name} onChange={f('name')} placeholder="Starter, Professional…" />
            </div>
            {!isEdit && (
              <div className="space-y-1.5">
                <Label>Code *</Label>
                <Input value={form.code} onChange={f('code')} placeholder="starter" className="font-mono" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Billing Period</Label>
              <Select value={form.billing_period} onValueChange={v => setForm(p => ({ ...p, billing_period: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Price</Label>
              <div className="flex gap-1.5">
                <Select value={form.currency} onValueChange={v => setForm(p => ({ ...p, currency: v }))}>
                  <SelectTrigger className="w-20 shrink-0"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['KES','USD','GBP','EUR','UGX','TZS','ZAR'].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input value={form.price} onChange={f('price')} type="number" min="0" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Trial Days</Label>
              <Input value={form.trial_days} onChange={f('trial_days')} type="number" min="0" />
            </div>
          </div>
          <div className="border-t pt-3">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Limits</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> Max Users</Label>
                <Input value={form.max_users} onChange={f('max_users')} type="number" min="1" />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1"><GitBranch className="h-3.5 w-3.5" /> Max Branches</Label>
                <Input value={form.max_branches} onChange={f('max_branches')} type="number" min="1" />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1"><Cpu className="h-3.5 w-3.5" /> Max Devices</Label>
                <Input value={form.max_devices} onChange={f('max_devices')} type="number" min="1" />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1"><Activity className="h-3.5 w-3.5" /> Max Txn/Month</Label>
                <Input value={form.max_monthly_transactions} onChange={f('max_monthly_transactions')} type="number" min="1" />
              </div>
            </div>
          </div>
          <div className="border-t pt-3 space-y-1.5">
            <Label>Plan Benefits</Label>
            <Textarea
              value={form.features_text}
              onChange={(e) => setForm(p => ({ ...p, features_text: e.target.value }))}
              rows={6}
              placeholder={'One benefit per line\nOrder-to-cash workflows in one system\nRole-based approvals and controls\nLive reporting across departments'}
            />
            <p className="text-xs text-muted-foreground">
              These lines appear in the public pricing cards and plan details modal.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={form.is_active} onCheckedChange={v => setForm(p => ({ ...p, is_active: v }))} />
            <Label>Active (visible to new tenant signups)</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.name || (!isEdit && !form.code)}>
            {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Plan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlanModulesDialog({ open, onClose, plan }: { open: boolean; onClose: () => void; plan: any }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: allModulesData } = useQuery({
    queryKey: ['modules'],
    queryFn: () => api(token!, '/modules/?page_size=100'),
    enabled: open && !!token,
    refetchInterval: 15000,
  });
  const { data: planModulesData, refetch: refetchPlanModules } = useQuery({
    queryKey: ['plan-modules', plan.id],
    queryFn: () => api(token!, `/plans/${plan.id}/modules/?page_size=100`),
    enabled: open && !!token,
    refetchInterval: 15000,
  });

  const allModules: any[] = allModulesData?.results ?? [];
  const eligibleModules = allModules.filter((mod) => mod.scope !== 'platform_admin');
  const planModules: any[] = planModulesData?.results ?? [];
  const enabledIds = new Set(planModules.filter(pm => pm.is_enabled).map(pm => pm.module?.id ?? pm.module));

  const addMutation = useMutation({
    mutationFn: (module_id: number) =>
      api(token!, `/plans/${plan.id}/modules/`, 'POST', { module_id, is_enabled: true }),
    onSuccess: () => {
      toast({ title: 'Plan modules updated', description: 'Tenant access will resync automatically.' });
      qc.invalidateQueries({ queryKey: ['plan-modules', plan.id] });
      qc.invalidateQueries({ queryKey: ['subscriptions'] });
      refetchPlanModules();
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const removeMutation = useMutation({
    mutationFn: (pmId: number) => api(token!, `/plans/${plan.id}/modules/${pmId}/`, 'DELETE'),
    onSuccess: () => {
      toast({ title: 'Plan modules updated', description: 'Tenant access will resync automatically.' });
      qc.invalidateQueries({ queryKey: ['plan-modules', plan.id] });
      qc.invalidateQueries({ queryKey: ['subscriptions'] });
      refetchPlanModules();
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const toggle = (mod: any) => {
    const pm = planModules.find(p => (p.module?.id ?? p.module) === mod.id);
    if (pm) {
      removeMutation.mutate(pm.id);
    } else {
      addMutation.mutate(mod.id);
    }
  };

  const grouped: Record<string, any[]> = {};
  for (const m of eligibleModules) (grouped[m.category] ??= []).push(m);
  const catOrder = ['core', 'shared', 'vertical', 'integration'];
  const catLabel: Record<string, string> = {
    core: 'Core', shared: 'Shared Services', vertical: 'Industry Vertical', integration: 'Integration',
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            Modules — {plan.name}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Select which modules are included in this plan. Tenants on this plan can have these modules activated.
          </p>
          <p className="text-xs text-muted-foreground">
            Platform Admin modules are excluded here because organization subscriptions should only carry organization or hybrid capabilities.
          </p>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {catOrder.filter(c => grouped[c]?.length).map(cat => (
            <div key={cat}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">{catLabel[cat]}</p>
              <div className="space-y-1">
                {grouped[cat].map(mod => {
                  const included = enabledIds.has(mod.id);
                  const busy = addMutation.isPending || removeMutation.isPending;
                  return (
                    <label key={mod.id} className="flex items-start gap-3 p-2 rounded hover:bg-muted/50 cursor-pointer">
                      <Checkbox
                        checked={included}
                        onCheckedChange={() => !busy && toggle(mod)}
                        disabled={busy}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-tight">{mod.name}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{MODULE_SCOPE_LABEL[mod.scope] ?? mod.scope}</p>
                        {mod.description && (
                          <p className="text-xs text-muted-foreground leading-snug mt-0.5">{mod.description}</p>
                        )}
                      </div>
                      {mod.is_core && (
                        <Badge variant="secondary" className="text-[9px] shrink-0">Core</Badge>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Plans() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [managingModules, setManagingModules] = useState<any>(null);
  const [deleting, setDeleting] = useState<any>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['plans'],
    queryFn: () => api(token!, '/plans/?page_size=50'),
    enabled: !!token,
  });

  const deleteMutation = useMutation({
    mutationFn: (p: any) => api(token!, `/plans/${p.id}/`, 'DELETE'),
    onSuccess: () => {
      toast({ title: 'Plan deleted' });
      qc.invalidateQueries({ queryKey: ['plans'] });
      setDeleting(null);
    },
    onError: (e: any) => toast({ title: 'Cannot delete', description: e.message, variant: 'destructive' }),
  });

  const plans: any[] = data?.results ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Subscription Plans</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Define pricing tiers, limits, and included modules</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw className="h-3.5 w-3.5" /></Button>
          <Button size="sm" onClick={() => setShowNew(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> New Plan
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-center text-muted-foreground text-sm py-12 animate-pulse">Loading…</p>
      ) : plans.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground text-sm">
            <CreditCard className="h-10 w-10 mx-auto mb-3 opacity-20" />
            No plans defined yet. Create your first plan.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map(p => (
            <Card key={p.id} className={`relative flex flex-col ${!p.is_active ? 'opacity-60' : ''}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">{p.name}</CardTitle>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">{p.code}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {!p.is_active && (
                      <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest border rounded bg-gray-100 text-gray-500 border-gray-300">
                        Inactive
                      </span>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditing(p)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setDeleting(p)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 flex-1">
                {(() => {
                  const featureLines = parseFeatureLines(planFeaturesToLines(p.features));
                  return featureLines.length > 0 ? (
                    <div className="rounded-lg bg-muted/30 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Plan Benefits</p>
                      <div className="mt-2 space-y-1.5">
                        {featureLines.slice(0, 3).map((line) => (
                          <p key={line} className="text-xs text-muted-foreground">{line}</p>
                        ))}
                        {featureLines.length > 3 ? (
                          <p className="text-[10px] font-medium text-muted-foreground">+{featureLines.length - 3} more</p>
                        ) : null}
                      </div>
                    </div>
                  ) : null;
                })()}
                <div>
                  <p className="text-2xl font-black">
                    {p.currency} {Number(p.price).toLocaleString()}
                    <span className="text-sm font-normal text-muted-foreground">/{p.billing_period}</span>
                  </p>
                  {p.trial_days > 0 && (
                    <p className="text-xs text-amber-600 font-medium">{p.trial_days}-day free trial</p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    [<Users className="h-3 w-3" />, `${p.max_users} users`],
                    [<GitBranch className="h-3 w-3" />, `${p.max_branches} branches`],
                    [<Cpu className="h-3 w-3" />, `${p.max_devices} devices`],
                    [<Activity className="h-3 w-3" />, `${Number(p.max_monthly_transactions).toLocaleString()} txn/mo`],
                  ].map(([icon, label], i) => (
                    <div key={i} className="flex items-center gap-1.5 text-muted-foreground">
                      {icon} {label}
                    </div>
                  ))}
                </div>
                <div className="pt-1">
                  <Button
                    size="sm" variant="outline" className="w-full gap-1.5 text-xs h-7"
                    onClick={() => setManagingModules(p)}
                  >
                    <Package className="h-3 w-3" />
                    {p.modules?.length > 0
                      ? `${p.modules.length} module${p.modules.length !== 1 ? 's' : ''} included`
                      : 'Assign modules'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <PlanDialog open={showNew} onClose={() => setShowNew(false)} />
      {editing && <PlanDialog open plan={editing} onClose={() => setEditing(null)} />}
      {managingModules && (
        <PlanModulesDialog
          open
          plan={managingModules}
          onClose={() => { setManagingModules(null); qc.invalidateQueries({ queryKey: ['plans'] }); }}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={open => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleting?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This plan will be permanently removed. Existing subscriptions using this plan will be retained but you won't be able to create new ones.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => deleting && deleteMutation.mutate(deleting)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete Plan'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
