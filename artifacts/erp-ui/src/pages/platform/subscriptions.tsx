import { useState } from 'react';
import { useAuth } from '@/context/use-auth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  RefreshCw, Plus, CalendarDays, CheckCircle2, AlertCircle,
  Clock, XCircle, Pause, RotateCw,
} from 'lucide-react';

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

const STATUS_STYLE: Record<string, string> = {
  active:    'bg-emerald-100 text-emerald-800 border-emerald-300',
  trial:     'bg-amber-100 text-amber-800 border-amber-300',
  suspended: 'bg-red-100 text-red-800 border-red-300',
  expired:   'bg-gray-100 text-gray-600 border-gray-300',
  grace:     'bg-orange-100 text-orange-800 border-orange-300',
  cancelled: 'bg-gray-100 text-gray-500 border-gray-300',
};
const STATUS_ICON: Record<string, React.ReactNode> = {
  active:    <CheckCircle2 className="h-3 w-3" />,
  trial:     <Clock className="h-3 w-3" />,
  suspended: <Pause className="h-3 w-3" />,
  expired:   <XCircle className="h-3 w-3" />,
  grace:     <AlertCircle className="h-3 w-3" />,
  cancelled: <XCircle className="h-3 w-3" />,
};

function daysRemaining(endDate: string | null) {
  if (!endDate) return null;
  return Math.ceil((new Date(endDate).getTime() - Date.now()) / 86_400_000);
}

function NewSubscriptionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    tenant_id: '', plan_id: '', status: 'trial',
    start_date: new Date().toISOString().slice(0, 10),
    end_date: '',
  });

  const { data: tenantsData } = useQuery({
    queryKey: ['tenants-sub'], queryFn: () => api(token!, '/tenants/?page_size=100'), enabled: open,
  });
  const { data: plansData } = useQuery({
    queryKey: ['plans-sub'], queryFn: () => api(token!, '/plans/?page_size=100'), enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () => api(token!, '/subscriptions/', 'POST', {
      tenant_id: Number(form.tenant_id),
      plan_id: Number(form.plan_id),
      status: form.status,
      start_date: form.start_date,
      ...(form.end_date ? { end_date: form.end_date } : {}),
    }),
    onSuccess: () => {
      toast({ title: 'Subscription created' });
      qc.invalidateQueries({ queryKey: ['subscriptions'] });
      onClose();
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>New Subscription</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Tenant *</Label>
            <Select value={form.tenant_id} onValueChange={v => setForm(p => ({ ...p, tenant_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select tenant…" /></SelectTrigger>
              <SelectContent>
                {(tenantsData?.results ?? []).map((t: any) => (
                  <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Plan *</Label>
            <Select value={form.plan_id} onValueChange={v => setForm(p => ({ ...p, plan_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select plan…" /></SelectTrigger>
              <SelectContent>
                {(plansData?.results ?? []).map((p: any) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Initial Status</Label>
            <Select value={form.status} onValueChange={v => setForm(p => ({ ...p, status: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="trial">Trial</SelectItem>
                <SelectItem value="active">Active</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Start Date</Label>
              <Input type="date" value={form.start_date} onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>End Date <span className="text-muted-foreground">(optional)</span></Label>
              <Input type="date" value={form.end_date} onChange={e => setForm(p => ({ ...p, end_date: e.target.value }))} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!form.tenant_id || !form.plan_id || mutation.isPending}
          >
            {mutation.isPending ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManageDialog({ sub, onClose }: { sub: any; onClose: () => void }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [extendDays, setExtendDays] = useState('30');
  const [newPlanId, setNewPlanId] = useState('');
  const [syncResult, setSyncResult] = useState<any>(null);

  const { data: plansData } = useQuery({
    queryKey: ['plans-manage'],
    queryFn: () => api(token!, '/plans/?page_size=100'),
    enabled: !!token,
  });

  const changePlan = useMutation({
    mutationFn: () => api(token!, `/subscriptions/${sub.id}/`, 'PATCH', { plan_id: Number(newPlanId) }),
    onSuccess: () => { toast({ title: 'Plan changed' }); qc.invalidateQueries({ queryKey: ['subscriptions'] }); onClose(); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const extendTrial = useMutation({
    mutationFn: () => {
      const base = sub.end_date ? new Date(sub.end_date) : new Date();
      base.setDate(base.getDate() + Number(extendDays));
      return api(token!, `/subscriptions/${sub.id}/`, 'PATCH', { end_date: base.toISOString().slice(0, 10) });
    },
    onSuccess: () => { toast({ title: 'Trial extended' }); qc.invalidateQueries({ queryKey: ['subscriptions'] }); onClose(); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const setStatus = useMutation({
    mutationFn: (s: string) => api(token!, `/subscriptions/${sub.id}/`, 'PATCH', { status: s }),
    onSuccess: () => { toast({ title: 'Status updated' }); qc.invalidateQueries({ queryKey: ['subscriptions'] }); onClose(); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const syncModules = useMutation({
    mutationFn: () => api(token!, `/subscriptions/${sub.id}/sync-modules/`, 'POST', {}),
    onSuccess: (data) => {
      setSyncResult(data?.data ?? data);
      toast({ title: 'Modules synced', description: `${data?.data?.created ?? 0} created, ${data?.data?.updated ?? 0} updated` });
      qc.invalidateQueries({ queryKey: ['subscriptions'] });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  return (
    <Dialog open={!!sub} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Subscription</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {sub?.tenant?.name} — <span className="font-medium">{sub?.plan?.name}</span>
          </p>
        </DialogHeader>
        <div className="space-y-5 py-2">

          {/* Status controls */}
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Status</p>
            <div className="flex flex-wrap gap-2">
              {['trial','active','grace','suspended','cancelled'].map(s => (
                <Button
                  key={s}
                  size="sm" variant="outline"
                  className={sub?.status === s ? 'ring-2 ring-primary' : ''}
                  onClick={() => sub?.status !== s && setStatus.mutate(s)}
                  disabled={sub?.status === s || setStatus.isPending}
                >
                  {STATUS_ICON[s]}
                  <span className="ml-1 capitalize">{s}</span>
                </Button>
              ))}
            </div>
          </div>

          {/* Change plan */}
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Change Plan</p>
            <div className="flex gap-2">
              <Select value={newPlanId} onValueChange={setNewPlanId}>
                <SelectTrigger className="flex-1"><SelectValue placeholder="Select new plan…" /></SelectTrigger>
                <SelectContent>
                  {(plansData?.results ?? []).map((p: any) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={() => changePlan.mutate()} disabled={!newPlanId || changePlan.isPending}>
                Apply
              </Button>
            </div>
          </div>

          {/* Extend period */}
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Extend Period</p>
            <div className="flex items-center gap-2">
              <Input
                type="number" value={extendDays}
                onChange={e => setExtendDays(e.target.value)}
                className="w-20" min="1"
              />
              <span className="text-sm text-muted-foreground flex-1">
                days from {sub?.end_date ? `${sub.end_date} (current end)` : 'today'}
              </span>
              <Button size="sm" onClick={() => extendTrial.mutate()} disabled={extendTrial.isPending}>
                Extend
              </Button>
            </div>
          </div>

          {/* Sync modules */}
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Module Sync</p>
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">
                  Provisions or updates tenant module activations from this plan's module list.
                </p>
                {syncResult && (
                  <p className="text-xs text-emerald-600 mt-1 font-medium">
                    ✓ {syncResult.created} provisioned · {syncResult.updated} updated · {syncResult.disabled ?? 0} disabled · status: {syncResult.status}
                  </p>
                )}
              </div>
              <Button
                size="sm" variant="outline" className="gap-1.5 shrink-0"
                onClick={() => syncModules.mutate()}
                disabled={syncModules.isPending}
              >
                <RotateCw className={`h-3.5 w-3.5 ${syncModules.isPending ? 'animate-spin' : ''}`} />
                {syncModules.isPending ? 'Syncing…' : 'Sync Modules'}
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Subscriptions() {
  const { token } = useAuth();
  const [showNew, setShowNew] = useState(false);
  const [managing, setManaging] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState('all');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['subscriptions'],
    queryFn: () => api(token!, '/subscriptions/?page_size=200'),
    enabled: !!token,
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });
  const allSubs: any[] = data?.results ?? [];
  const subs = statusFilter === 'all' ? allSubs : allSubs.filter(s => s.status === statusFilter);

  const counts = allSubs.reduce((acc: Record<string, number>, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1; return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Subscriptions</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Tenant plan enrollments · {allSubs.length} total</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw className="h-3.5 w-3.5" /></Button>
          <Button size="sm" onClick={() => setShowNew(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> New
          </Button>
        </div>
      </div>

      {/* Status filter strip */}
      <div className="flex flex-wrap gap-2">
        {[['all', 'All'], ['trial', 'Trial'], ['active', 'Active'], ['grace', 'Grace'], ['suspended', 'Suspended'], ['expired', 'Expired'], ['cancelled', 'Cancelled']].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setStatusFilter(k)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              statusFilter === k
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-muted-foreground/30 text-muted-foreground hover:border-primary/50'
            }`}
          >
            {label}
            {k !== 'all' && counts[k] ? (
              <span className="ml-1.5 opacity-70">{counts[k]}</span>
            ) : k === 'all' ? (
              <span className="ml-1.5 opacity-70">{allSubs.length}</span>
            ) : null}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="bg-muted/20 border-b py-3 px-4">
          <CardTitle className="text-xs font-bold uppercase tracking-widest flex justify-between">
            <span>
              {statusFilter === 'all' ? 'All Subscriptions' : `${statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)} Subscriptions`}
            </span>
            <span className="font-normal normal-case text-muted-foreground">{subs.length} shown</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-8 text-center text-muted-foreground font-mono text-sm animate-pulse">Loading…</p>
          ) : subs.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground text-sm">
              {statusFilter === 'all' ? 'No subscriptions yet.' : `No ${statusFilter} subscriptions.`}
            </p>
          ) : (
            <div className="divide-y">
              {subs.map(s => {
                const days = daysRemaining(s.end_date);
                return (
                  <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="font-semibold text-sm">{s.tenant?.name ?? `Tenant #${s.tenant}`}</p>
                      <p className="text-xs text-muted-foreground">{s.plan?.name ?? `Plan #${s.plan}`}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 flex-wrap">
                      {s.start_date && (
                        <span className="text-xs text-muted-foreground hidden sm:flex items-center gap-1">
                          <CalendarDays className="h-3 w-3" />
                          {new Date(s.start_date).toLocaleDateString()}
                          {s.end_date ? ` → ${new Date(s.end_date).toLocaleDateString()}` : ''}
                        </span>
                      )}
                      {days !== null && (
                        <span className={`text-xs font-medium ${days < 7 ? 'text-red-600' : days < 30 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                          {days > 0 ? `${days}d left` : `${Math.abs(days)}d overdue`}
                        </span>
                      )}
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase border flex items-center gap-1 ${STATUS_STYLE[s.status] ?? ''}`}>
                        {STATUS_ICON[s.status]} {s.status}
                      </span>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setManaging(s)}>
                        Manage
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <NewSubscriptionDialog open={showNew} onClose={() => setShowNew(false)} />
      {managing && <ManageDialog sub={managing} onClose={() => setManaging(null)} />}
    </div>
  );
}
