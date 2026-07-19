import { useState } from 'react';
import { useAuth } from '@/context/use-auth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
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
import {
  RefreshCw, Plus, Key, CheckCircle2, XCircle, Clock, ShieldOff,
  Copy, Zap, ShieldCheck, AlertTriangle,
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
  pending:  'bg-amber-100 text-amber-800 border-amber-300',
  active:   'bg-emerald-100 text-emerald-800 border-emerald-300',
  expired:  'bg-gray-100 text-gray-600 border-gray-300',
  revoked:  'bg-red-100 text-red-800 border-red-300',
};
const STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <Clock className="h-3 w-3" />,
  active:  <CheckCircle2 className="h-3 w-3" />,
  expired: <XCircle className="h-3 w-3" />,
  revoked: <ShieldOff className="h-3 w-3" />,
};

function fmt(dt: string | null) {
  if (!dt) return '—';
  return new Date(dt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/* ─── Generate dialog ─────────────────────────────────────────────── */
function GenerateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    tenant_id: '', subscription_id: '', seats: '1', device_limit: '1',
    offline_grace_days: '3', notes: '',
  });

  const { data: tenantsData } = useQuery({
    queryKey: ['tenants-lic'], queryFn: () => api(token!, '/tenants/?page_size=100'), enabled: open,
  });
  const { data: subsData } = useQuery({
    queryKey: ['subscriptions-lic'],
    queryFn: () => api(token!, '/subscriptions/?page_size=200'),
    enabled: open && !!token,
  });

  const tenantSubs = (subsData?.results ?? []).filter(
    (s: any) => !form.tenant_id || String(s.tenant?.id ?? s.tenant) === form.tenant_id
  );

  const mutation = useMutation({
    mutationFn: () => api(token!, '/licenses/generate/', 'POST', {
      tenant_id: Number(form.tenant_id),
      ...(form.subscription_id ? { subscription_id: Number(form.subscription_id) } : {}),
      seats: Number(form.seats),
      device_limit: Number(form.device_limit),
      offline_grace_days: Number(form.offline_grace_days),
      notes: form.notes,
    }),
    onSuccess: (data) => {
      toast({ title: 'License key generated', description: data?.data?.license_key ?? '' });
      qc.invalidateQueries({ queryKey: ['licenses'] });
      onClose();
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Key className="h-4 w-4" /> Generate License Key</DialogTitle>
          <p className="text-xs text-muted-foreground">A unique license key will be auto-generated and assigned to the selected tenant.</p>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Tenant *</Label>
            <Select
              value={form.tenant_id}
              onValueChange={v => setForm(p => ({ ...p, tenant_id: v, subscription_id: '' }))}
            >
              <SelectTrigger><SelectValue placeholder="Select tenant…" /></SelectTrigger>
              <SelectContent>
                {(tenantsData?.results ?? []).map((t: any) => (
                  <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {form.tenant_id && (
            <div className="space-y-1.5">
              <Label>Link to Subscription <span className="text-muted-foreground">(optional)</span></Label>
              <Select value={form.subscription_id} onValueChange={v => setForm(p => ({ ...p, subscription_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select subscription…" /></SelectTrigger>
                <SelectContent>
                  {tenantSubs.map((s: any) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.plan?.name ?? `Plan #${s.plan}`} · {s.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Seats</Label>
              <Input value={form.seats} onChange={f('seats')} type="number" min="1" />
            </div>
            <div className="space-y-1.5">
              <Label>Devices</Label>
              <Input value={form.device_limit} onChange={f('device_limit')} type="number" min="1" />
            </div>
            <div className="space-y-1.5">
              <Label>Offline Days</Label>
              <Input value={form.offline_grace_days} onChange={f('offline_grace_days')} type="number" min="0" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notes <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea value={form.notes} onChange={f('notes')} rows={2} placeholder="e.g. Initial key for production deployment" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.tenant_id}>
            {mutation.isPending ? 'Generating…' : 'Generate Key'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Activate dialog ─────────────────────────────────────────────── */
function ActivateDialog({ lic, onClose }: { lic: any; onClose: () => void }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    subscription_id: lic.subscription ? String(lic.subscription) : '',
    expiry_date: '',
    seats: String(lic.seats),
    device_limit: String(lic.device_limit),
    notes: '',
  });

  const { data: subsData } = useQuery({
    queryKey: ['subscriptions-act'],
    queryFn: () => api(token!, `/subscriptions/?page_size=200`),
    enabled: !!token,
  });
  const tenantSubs = (subsData?.results ?? []).filter(
    (s: any) => String(s.tenant?.id ?? s.tenant) === String(lic.tenant?.id ?? lic.tenant)
  );

  const mutation = useMutation({
    mutationFn: () => api(token!, `/licenses/${lic.id}/activate/`, 'POST', {
      ...(form.subscription_id ? { subscription_id: Number(form.subscription_id) } : {}),
      ...(form.expiry_date ? { expiry_date: `${form.expiry_date}T23:59:59Z` } : {}),
      seats: Number(form.seats),
      device_limit: Number(form.device_limit),
      ...(form.notes ? { notes: form.notes } : {}),
    }),
    onSuccess: () => {
      toast({ title: 'License activated' });
      qc.invalidateQueries({ queryKey: ['licenses'] });
      onClose();
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <Dialog open={!!lic} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Zap className="h-4 w-4 text-amber-500" /> Activate License</DialogTitle>
          <p className="text-xs text-muted-foreground font-mono">{lic.license_key}</p>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Subscription <span className="text-muted-foreground">(optional)</span></Label>
            <Select value={form.subscription_id} onValueChange={v => setForm(p => ({ ...p, subscription_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Link to a subscription…" /></SelectTrigger>
              <SelectContent>
                {tenantSubs.map((s: any) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.plan?.name ?? `Plan #${s.plan}`} · {s.status}
                    {s.end_date ? ` · ends ${new Date(s.end_date).toLocaleDateString()}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">If linked, the subscription's end date sets the expiry automatically.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Expiry Date <span className="text-muted-foreground">(override, optional)</span></Label>
            <Input type="date" value={form.expiry_date} onChange={f('expiry_date')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Seats</Label>
              <Input value={form.seats} onChange={f('seats')} type="number" min="1" />
            </div>
            <div className="space-y-1.5">
              <Label>Device Limit</Label>
              <Input value={form.device_limit} onChange={f('device_limit')} type="number" min="1" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Activation Notes <span className="text-muted-foreground">(optional)</span></Label>
            <Input value={form.notes} onChange={f('notes')} placeholder="e.g. Activated for go-live 2026-07-20" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? 'Activating…' : 'Activate License'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Validate result dialog ──────────────────────────────────────── */
function ValidateResultDialog({ result, onClose }: { result: any; onClose: () => void }) {
  const ok = result?.validation?.valid;
  return (
    <Dialog open={!!result} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {ok
              ? <ShieldCheck className="h-5 w-5 text-emerald-600" />
              : <AlertTriangle className="h-5 w-5 text-red-600" />
            }
            {ok ? 'License Valid' : 'License Invalid'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2 text-sm">
          <p className="font-mono text-xs text-muted-foreground">{result?.license?.license_key}</p>
          {ok ? (
            <p className="text-emerald-700">This license passed all validation checks.</p>
          ) : (
            <div>
              <p className="text-red-700 mb-2">Validation failed for the following reasons:</p>
              <ul className="space-y-1">
                {(result?.validation?.reasons ?? []).map((r: string, i: number) => (
                  <li key={i} className="flex items-center gap-2 text-xs text-red-600">
                    <XCircle className="h-3.5 w-3.5 shrink-0" /> {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Validated at {new Date(result?.validation?.validated_at).toLocaleString()}
          </p>
        </div>
        <DialogFooter><Button onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Main page ───────────────────────────────────────────────────── */
export default function Licenses() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showGenerate, setShowGenerate] = useState(false);
  const [activating, setActivating] = useState<any>(null);
  const [validateResult, setValidateResult] = useState<any>(null);
  const [revoking, setRevoking] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState('all');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['licenses'],
    queryFn: () => api(token!, '/licenses/?page_size=200'),
    enabled: !!token,
  });

  const validateMutation = useMutation({
    mutationFn: (lic: any) => api(token!, `/licenses/${lic.id}/validate/`, 'POST', { mark_validated: true }),
    onSuccess: (data) => setValidateResult(data?.data ?? data),
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const revokeMutation = useMutation({
    mutationFn: (lic: any) => api(token!, `/licenses/${lic.id}/revoke/`, 'POST', {}),
    onSuccess: () => {
      toast({ title: 'License revoked' });
      qc.invalidateQueries({ queryKey: ['licenses'] });
      setRevoking(null);
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const copyKey = (key: string) => {
    navigator.clipboard.writeText(key).then(() => toast({ title: 'Copied to clipboard' }));
  };

  const allLicenses: any[] = data?.results ?? [];
  const licenses = statusFilter === 'all' ? allLicenses : allLicenses.filter(l => l.status === statusFilter);
  const counts = allLicenses.reduce((acc: Record<string, number>, l) => {
    acc[l.status] = (acc[l.status] ?? 0) + 1; return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">License Keys</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {allLicenses.length} key{allLicenses.length !== 1 ? 's' : ''} issued across all tenants
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw className="h-3.5 w-3.5" /></Button>
          <Button size="sm" onClick={() => setShowGenerate(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Generate Key
          </Button>
        </div>
      </div>

      {/* Status filter strip */}
      <div className="flex flex-wrap gap-2">
        {[['all', 'All'], ['pending', 'Pending'], ['active', 'Active'], ['expired', 'Expired'], ['revoked', 'Revoked']].map(([k, label]) => (
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
            <span className="ml-1.5 opacity-70">{k === 'all' ? allLicenses.length : (counts[k] ?? 0)}</span>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="bg-muted/20 border-b py-3 px-4">
          <CardTitle className="text-xs font-bold uppercase tracking-widest flex justify-between">
            <span>License Registry</span>
            <span className="font-normal normal-case text-muted-foreground">{licenses.length} shown</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-8 text-center text-muted-foreground text-sm animate-pulse">Loading…</p>
          ) : licenses.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground text-sm space-y-3">
              <Key className="h-10 w-10 mx-auto opacity-20" />
              <p>{statusFilter === 'all' ? 'No license keys yet. Generate one to get started.' : `No ${statusFilter} keys.`}</p>
              {statusFilter === 'all' && (
                <Button size="sm" variant="outline" onClick={() => setShowGenerate(true)} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" /> Generate first key
                </Button>
              )}
            </div>
          ) : (
            <div className="divide-y">
              {licenses.map(lic => (
                <div key={lic.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="font-mono text-sm font-semibold tracking-widest cursor-pointer hover:text-primary transition-colors"
                        onClick={() => copyKey(lic.license_key)}
                        title="Click to copy"
                      >
                        {lic.license_key}
                      </span>
                      <button
                        onClick={() => copyKey(lic.license_key)}
                        className="text-muted-foreground hover:text-primary transition-colors"
                        title="Copy"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{lic.tenant?.name ?? `Tenant #${lic.tenant}`}</span>
                      <span>{lic.seats} seat{lic.seats !== 1 ? 's' : ''}</span>
                      <span>{lic.device_limit} device{lic.device_limit !== 1 ? 's' : ''}</span>
                      {lic.activation_date && (
                        <span>Activated {fmt(lic.activation_date)}</span>
                      )}
                      {lic.expiry_date && (
                        <span className={new Date(lic.expiry_date) < new Date() ? 'text-red-500 font-medium' : ''}>
                          Expires {fmt(lic.expiry_date)}
                        </span>
                      )}
                      {lic.last_validated_at && (
                        <span>Validated {fmt(lic.last_validated_at)}</span>
                      )}
                    </div>
                    {lic.notes && (
                      <p className="text-xs text-muted-foreground mt-0.5 italic truncate max-w-md">{lic.notes}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase border flex items-center gap-1 ${STATUS_STYLE[lic.status] ?? ''}`}>
                      {STATUS_ICON[lic.status]} {lic.status}
                    </span>
                    {lic.status === 'pending' && (
                      <Button
                        size="sm" variant="outline" className="h-7 text-xs gap-1 text-amber-600 border-amber-300 hover:bg-amber-50"
                        onClick={() => setActivating(lic)}
                      >
                        <Zap className="h-3 w-3" /> Activate
                      </Button>
                    )}
                    {lic.status === 'active' && (
                      <Button
                        size="sm" variant="outline" className="h-7 text-xs gap-1"
                        onClick={() => validateMutation.mutate(lic)}
                        disabled={validateMutation.isPending}
                      >
                        <ShieldCheck className="h-3 w-3" />
                        {validateMutation.isPending ? 'Checking…' : 'Validate'}
                      </Button>
                    )}
                    {(lic.status === 'pending' || lic.status === 'active') && (
                      <Button
                        size="sm" variant="outline"
                        className="h-7 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/5"
                        onClick={() => setRevoking(lic)}
                      >
                        <ShieldOff className="h-3 w-3" /> Revoke
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <GenerateDialog open={showGenerate} onClose={() => setShowGenerate(false)} />
      {activating && <ActivateDialog lic={activating} onClose={() => setActivating(null)} />}
      {validateResult && <ValidateResultDialog result={validateResult} onClose={() => setValidateResult(null)} />}

      <AlertDialog open={!!revoking} onOpenChange={open => !open && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this license?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-mono">{revoking?.license_key}</span>
              <br /><br />
              Revoking a license immediately blocks it from passing validation checks.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => revoking && revokeMutation.mutate(revoking)}
              disabled={revokeMutation.isPending}
            >
              {revokeMutation.isPending ? 'Revoking…' : 'Revoke License'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
