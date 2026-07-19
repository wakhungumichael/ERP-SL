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
import { Switch } from '@/components/ui/switch';
import { CreditCard, Plus, Pencil, RefreshCw, Users, GitBranch, Cpu, Activity } from 'lucide-react';

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

const EMPTY_PLAN = {
  code: '', name: '', billing_period: 'monthly', price: '0',
  currency: 'KES', trial_days: '14',
  max_users: '10', max_branches: '2', max_devices: '2', max_monthly_transactions: '5000',
  is_active: true, features: {},
};

function PlanDialog({
  open, onClose, plan,
}: { open: boolean; onClose: () => void; plan?: any }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isEdit = !!plan;
  const [form, setForm] = useState(() => plan ? {
    code: plan.code, name: plan.name, billing_period: plan.billing_period,
    price: String(plan.price), currency: plan.currency, trial_days: String(plan.trial_days),
    max_users: String(plan.max_users), max_branches: String(plan.max_branches),
    max_devices: String(plan.max_devices), max_monthly_transactions: String(plan.max_monthly_transactions),
    is_active: plan.is_active, features: plan.features ?? {},
  } : { ...EMPTY_PLAN });

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        price: Number(form.price),
        trial_days: Number(form.trial_days),
        max_users: Number(form.max_users),
        max_branches: Number(form.max_branches),
        max_devices: Number(form.max_devices),
        max_monthly_transactions: Number(form.max_monthly_transactions),
      };
      return isEdit
        ? api(token!, `/plans/${plan.id}/`, 'PUT', payload)
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
          <DialogTitle>{isEdit ? 'Edit Plan' : 'New Subscription Plan'}</DialogTitle>
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
                <Input value={form.code} onChange={f('code')} placeholder="starter" />
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
              <Label>Price (KES)</Label>
              <Input value={form.price} onChange={f('price')} type="number" min="0" />
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
          <div className="flex items-center gap-3">
            <Switch checked={form.is_active} onCheckedChange={v => setForm(p => ({ ...p, is_active: v }))} />
            <Label>Active (visible to new tenant signups)</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.name}>
            {mutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Plan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Plans() {
  const { token } = useAuth();
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['plans'],
    queryFn: () => api(token!, '/plans/?page_size=50'),
    enabled: !!token,
  });

  const plans: any[] = data?.results ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Subscription Plans</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Define pricing tiers and feature limits</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw className="h-3.5 w-3.5" /></Button>
          <Button size="sm" onClick={() => setShowNew(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> New Plan
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-center text-muted-foreground text-sm py-12 font-mono animate-pulse">Loading…</p>
      ) : plans.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground text-sm">
            No plans defined yet. Create your first plan.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map(p => (
            <Card key={p.id} className={`relative ${!p.is_active ? 'opacity-60' : ''}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">{p.name}</CardTitle>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">{p.code}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {!p.is_active && (
                      <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest border rounded bg-gray-100 text-gray-500 border-gray-300">
                        Inactive
                      </span>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditing(p)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
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
                {p.modules?.length > 0 && (
                  <p className="text-xs text-muted-foreground">{p.modules.length} module{p.modules.length !== 1 ? 's' : ''} included</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <PlanDialog open={showNew} onClose={() => setShowNew(false)} />
      {editing && <PlanDialog open plan={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
