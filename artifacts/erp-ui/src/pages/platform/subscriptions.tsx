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
import { RefreshCw, Plus, CalendarDays, CheckCircle2, AlertCircle, Clock, XCircle, Pause } from 'lucide-react';

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
  active:    'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400',
  trial:     'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400',
  suspended: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/30 dark:text-red-400',
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
  const diff = Math.ceil((new Date(endDate).getTime() - Date.now()) / 86_400_000);
  return diff;
}

function NewSubscriptionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ tenant_id: '', plan_id: '', status: 'trial', start_date: new Date().toISOString().slice(0, 10) });

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
    }),
    onSuccess: () => { toast({ title: 'Subscription created' }); qc.invalidateQueries({ queryKey: ['subscriptions'] }); onClose(); },
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
                {(tenantsData?.results ?? []).map((t: any) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Plan *</Label>
            <Select value={form.plan_id} onValueChange={v => setForm(p => ({ ...p, plan_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select plan…" /></SelectTrigger>
              <SelectContent>
                {(plansData?.results ?? []).map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
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
          <div className="space-y-1.5">
            <Label>Start Date</Label>
            <Input type="date" value={form.start_date} onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!form.tenant_id || !form.plan_id || mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionSheet({ sub, onClose }: { sub: any; onClose: () => void }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [extendDays, setExtendDays] = useState('14');
  const [newPlanId, setNewPlanId] = useState('');
  const { data: plansData } = useQuery({ queryKey: ['plans-action'], queryFn: () => api(token!, '/plans/?page_size=100') });

  const changePlan = useMutation({
    mutationFn: () => api(token!, `/subscriptions/${sub.id}/`, 'PATCH', { plan_id: Number(newPlanId) }),
    onSuccess: () => { toast({ title: 'Plan changed' }); qc.invalidateQueries({ queryKey: ['subscriptions'] }); onClose(); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });
  const extendTrial = useMutation({
    mutationFn: () => {
      const d = new Date(); d.setDate(d.getDate() + Number(extendDays));
      return api(token!, `/subscriptions/${sub.id}/`, 'PATCH', { end_date: d.toISOString().slice(0, 10) });
    },
    onSuccess: () => { toast({ title: 'Trial extended' }); qc.invalidateQueries({ queryKey: ['subscriptions'] }); onClose(); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });
  const setStatus = useMutation({
    mutationFn: (s: string) => api(token!, `/subscriptions/${sub.id}/`, 'PATCH', { status: s }),
    onSuccess: () => { toast({ title: 'Status updated' }); qc.invalidateQueries({ queryKey: ['subscriptions'] }); onClose(); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  return (
    <Dialog open={!!sub} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Manage Subscription</DialogTitle>
          <p className="text-sm text-muted-foreground">{sub?.tenant?.name} — {sub?.plan?.name}</p>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Change Plan</p>
            <div className="flex gap-2">
              <Select value={newPlanId} onValueChange={setNewPlanId}>
                <SelectTrigger className="flex-1"><SelectValue placeholder="Select new plan…" /></SelectTrigger>
                <SelectContent>
                  {(plansData?.results ?? []).map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={() => changePlan.mutate()} disabled={!newPlanId || changePlan.isPending}>Apply</Button>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Extend Trial</p>
            <div className="flex gap-2">
              <Input type="number" value={extendDays} onChange={e => setExtendDays(e.target.value)} className="w-24" min="1" />
              <span className="text-sm text-muted-foreground self-center">days from today</span>
              <Button size="sm" onClick={() => extendTrial.mutate()} disabled={extendTrial.isPending}>Extend</Button>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Status</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setStatus.mutate('active')} disabled={sub?.status === 'active' || setStatus.isPending}>Activate</Button>
              <Button size="sm" variant="outline" onClick={() => setStatus.mutate('suspended')} disabled={sub?.status === 'suspended' || setStatus.isPending} className="text-red-600 border-red-300 hover:bg-red-50">Suspend</Button>
              <Button size="sm" variant="outline" onClick={() => setStatus.mutate('cancelled')} disabled={sub?.status === 'cancelled' || setStatus.isPending}>Cancel</Button>
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

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['subscriptions'],
    queryFn: () => api(token!, '/subscriptions/?page_size=100'),
    enabled: !!token,
  });
  const subs: any[] = data?.results ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Subscriptions</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Tenant plan enrollments</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw className="h-3.5 w-3.5" /></Button>
          <Button size="sm" onClick={() => setShowNew(true)} className="gap-1.5"><Plus className="h-3.5 w-3.5" /> New</Button>
        </div>
      </div>

      <Card>
        <CardHeader className="bg-muted/20 border-b py-3 px-4">
          <CardTitle className="text-xs font-bold uppercase tracking-widest flex justify-between">
            <span>Active Subscriptions</span>
            <span className="font-normal normal-case text-muted-foreground">{subs.length} total</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-8 text-center text-muted-foreground font-mono text-sm animate-pulse">Loading…</p>
          ) : subs.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground text-sm">No subscriptions yet.</p>
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
                          {new Date(s.start_date).toLocaleDateString('en-KE')}
                          {s.end_date ? ` → ${new Date(s.end_date).toLocaleDateString('en-KE')}` : ''}
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
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setManaging(s)}>Manage</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <NewSubscriptionDialog open={showNew} onClose={() => setShowNew(false)} />
      {managing && <ActionSheet sub={managing} onClose={() => setManaging(null)} />}
    </div>
  );
}
