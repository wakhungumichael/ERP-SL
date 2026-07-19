/**
 * Weighbridge Settings — tenant-admin configuration surface.
 *
 * Tabs:
 *   1. Indicator Config      — per-branch indicator settings
 *   2. Vehicle Types         — charge, weight limits
 *   3. Items                 — weighed commodities
 *   4. Customer Discounts    — per-customer per-vehicle-type override charges
 *   5. Surveillance          — overweight threshold + HikVision camera config
 */
import { useState, useCallback } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useAuth } from '@/context/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import {
  Plus, Pencil, Trash2, Settings2, Truck, Package, Tag, ShieldAlert, Camera,
} from 'lucide-react';

// ── helpers ────────────────────────────────────────────────────────────────────

function useFetch<T>(url: string, token: string | null) {
  return useQuery<T>({
    queryKey: [url],
    queryFn: async () => {
      const res = await fetch(url, { headers: { Authorization: `Token ${token}` } });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      // Handle paginated or direct list
      return (json?.results ?? json) as T;
    },
    enabled: !!token,
    staleTime: 30_000,
  });
}

function useApiMutation(
  token: string | null,
  onSuccess: () => void,
  onError: (msg: string) => void,
) {
  return useMutation({
    mutationFn: async ({ url, method, body }: { url: string; method: string; body?: any }) => {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Token ${token}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(JSON.stringify(err));
      }
      if (res.status !== 204) return res.json();
    },
    onSuccess,
    onError: (e: any) => onError(e?.message ?? 'Request failed'),
  });
}

function parseErrors(raw: string): string {
  try {
    const obj = JSON.parse(raw);
    return Object.entries(obj)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      .join('\n');
  } catch {
    return raw;
  }
}

// ── ConfirmDelete ──────────────────────────────────────────────────────────────

function ConfirmDelete({
  open, label, onConfirm, onCancel,
}: { open: boolean; label: string; onConfirm(): void; onCancel(): void }) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {label}?</AlertDialogTitle>
          <AlertDialogDescription>
            This cannot be undone. Existing transactions will not be affected.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 1 — Indicator Config
// ══════════════════════════════════════════════════════════════════════════════

const CONNECTION_TYPES = ['USB', 'Ethernet', 'Serial', 'HTTP'] as const;
const MODE_CHOICES = [
  { value: '0', label: '0 — No Transmission' },
  { value: '1', label: '1 — Continuous' },
  { value: '2', label: '2 — No-Motion' },
  { value: '3', label: '3 — On Demand' },
];

type IndicatorCfg = {
  id?: number;
  branch: number | string;
  branch_name?: string;
  indicator_name: string;
  connection_type: string;
  port?: string;
  baud_rate?: number | '';
  data_bits?: number;
  parity?: string;
  stop_bits?: number;
  live_weight_url?: string;
  stable_weight_url?: string;
  max_first_weight_age_days: number | '';
  mode?: number | string;
  node_number?: number | '';
};

const emptyIndicator = (): IndicatorCfg => ({
  branch: '',
  indicator_name: '',
  connection_type: 'HTTP',
  port: '',
  baud_rate: '',
  data_bits: 8,
  parity: 'None',
  stop_bits: 1,
  live_weight_url: '',
  stable_weight_url: '',
  max_first_weight_age_days: 3,
  mode: 1,
  node_number: '',
});

function IndicatorConfigTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const invalidate = useCallback(() => qc.invalidateQueries({ queryKey: ['/api/commercial-weighbridge/indicator-configs/'] }), [qc]);

  const { data: _configsRaw, isLoading } = useFetch<any>('/api/commercial-weighbridge/indicator-configs/', token);
  const { data: _branchesRaw } = useFetch<any>('/api/commercial-weighbridge/branches/', token);
  const configs: IndicatorCfg[] = Array.isArray(_configsRaw?.results) ? _configsRaw.results : Array.isArray(_configsRaw) ? _configsRaw : [];
  const branches: any[] = Array.isArray(_branchesRaw?.results) ? _branchesRaw.results : Array.isArray(_branchesRaw) ? _branchesRaw : [];

  const [open, setOpen]   = useState(false);
  const [form, setForm]   = useState<IndicatorCfg>(emptyIndicator());
  const [delId, setDelId] = useState<number | null>(null);

  const mut = useApiMutation(
    token,
    () => { invalidate(); setOpen(false); toast({ title: form.id ? 'Indicator updated' : 'Indicator added' }); },
    (msg) => toast({ title: 'Error', description: parseErrors(msg), variant: 'destructive' }),
  );

  const delMut = useApiMutation(
    token,
    () => { invalidate(); setDelId(null); toast({ title: 'Indicator deleted' }); },
    (msg) => toast({ title: 'Error', description: parseErrors(msg), variant: 'destructive' }),
  );

  function openNew() { setForm(emptyIndicator()); setOpen(true); }
  function openEdit(cfg: IndicatorCfg) { setForm({ ...cfg }); setOpen(true); }

  function save() {
    const body = {
      ...form,
      branch: form.branch,
      baud_rate: form.baud_rate === '' ? null : Number(form.baud_rate),
      max_first_weight_age_days: Number(form.max_first_weight_age_days) || 3,
      node_number: form.node_number === '' ? null : Number(form.node_number),
      mode: Number(form.mode),
    };
    if (form.id) {
      mut.mutate({ url: `/api/commercial-weighbridge/indicator-configs/${form.id}/`, method: 'PATCH', body });
    } else {
      mut.mutate({ url: '/api/commercial-weighbridge/indicator-configs/', method: 'POST', body });
    }
  }

  const set = (k: keyof IndicatorCfg, v: any) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          One config per branch. The <span className="font-mono text-foreground">Max First Weight Age</span> window is especially important — it controls how many days back the second-weight flow searches for a matching pending first weight.
        </p>
        <Button size="sm" className="gap-1.5 shrink-0" onClick={openNew}>
          <Plus className="h-3.5 w-3.5" /> Add Indicator
        </Button>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-[10px] font-bold uppercase tracking-widest">Branch</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-widest">Indicator</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-widest">Connection</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-widest">Live URL</TableHead>
              <TableHead className="text-center text-[10px] font-bold uppercase tracking-widest">Max Age (days)</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">Loading…</TableCell></TableRow>
            ) : configs.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No indicator configs yet.</TableCell></TableRow>
            ) : configs.map((cfg) => (
              <TableRow key={cfg.id}>
                <TableCell className="font-medium">{cfg.branch_name ?? cfg.branch}</TableCell>
                <TableCell>{cfg.indicator_name}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[10px]">{cfg.connection_type}</Badge>
                </TableCell>
                <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground font-mono">
                  {cfg.live_weight_url || '—'}
                </TableCell>
                <TableCell className="text-center font-mono font-bold">
                  {cfg.max_first_weight_age_days}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1 justify-end">
                    <button onClick={() => openEdit(cfg)} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted transition-colors">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => setDelId(cfg.id!)} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-red-50 text-destructive transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Edit Indicator Config' : 'Add Indicator Config'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Branch *</Label>
                <Select value={String(form.branch)} onValueChange={v => set('branch', v)}>
                  <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                  <SelectContent>
                    {(branches as any[]).map((b: any) => (
                      <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Indicator name *</Label>
                <Input value={form.indicator_name} onChange={e => set('indicator_name', e.target.value)} placeholder="e.g. Metrix WS1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Connection type *</Label>
                <Select value={form.connection_type} onValueChange={v => set('connection_type', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CONNECTION_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Port / address</Label>
                <Input value={form.port ?? ''} onChange={e => set('port', e.target.value)} placeholder="e.g. COM3 or 192.168.1.10" />
              </div>
            </div>
            {form.connection_type === 'HTTP' && (
              <>
                <div className="space-y-1.5">
                  <Label>Live weight URL</Label>
                  <Input value={form.live_weight_url ?? ''} onChange={e => set('live_weight_url', e.target.value)} placeholder="https://ws.metrixws.co.ke/live_weight" />
                </div>
                <div className="space-y-1.5">
                  <Label>Stable weight URL <span className="text-muted-foreground text-xs">(optional — falls back to live URL)</span></Label>
                  <Input value={form.stable_weight_url ?? ''} onChange={e => set('stable_weight_url', e.target.value)} placeholder="https://ws.metrixws.co.ke/stable_weight" />
                </div>
              </>
            )}
            {form.connection_type !== 'HTTP' && (
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Baud rate</Label>
                  <Input type="number" value={form.baud_rate ?? ''} onChange={e => set('baud_rate', e.target.value)} placeholder="9600" />
                </div>
                <div className="space-y-1.5">
                  <Label>Data bits</Label>
                  <Input type="number" value={form.data_bits ?? 8} onChange={e => set('data_bits', Number(e.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Stop bits</Label>
                  <Input type="number" value={form.stop_bits ?? 1} onChange={e => set('stop_bits', Number(e.target.value))} />
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Mode</Label>
                <Select value={String(form.mode ?? 1)} onValueChange={v => set('mode', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MODE_CHOICES.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Node number <span className="text-muted-foreground text-xs">(0–250)</span></Label>
                <Input type="number" value={form.node_number ?? ''} onChange={e => set('node_number', e.target.value)} placeholder="49" min={0} max={250} />
              </div>
            </div>
            {/* ─── THE KEY SETTING ─── */}
            <div className="space-y-1.5 rounded-md border bg-amber-50 dark:bg-amber-900/10 p-3">
              <Label className="text-amber-800 dark:text-amber-400 font-semibold">
                Max first-weight age (days)
              </Label>
              <Input
                type="number"
                min={1}
                max={365}
                value={form.max_first_weight_age_days}
                onChange={e => set('max_first_weight_age_days', e.target.value)}
                className="max-w-[120px]"
              />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                When capturing a Second Weight, the system searches for a matching pending First Weight within this many days. Default is <strong>3</strong>.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={mut.isPending}>
              {mut.isPending ? 'Saving…' : form.id ? 'Save changes' : 'Add indicator'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDelete
        open={delId !== null}
        label="indicator config"
        onConfirm={() => delMut.mutate({ url: `/api/commercial-weighbridge/indicator-configs/${delId}/`, method: 'DELETE' })}
        onCancel={() => setDelId(null)}
      />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 2 — Vehicle Types
// ══════════════════════════════════════════════════════════════════════════════

type VehicleType = {
  id?: number;
  name: string;
  description?: string;
  charge: number | '';
  max_gross_weight?: number | '';
  max_tare_weight?: number | '';
};

const emptyVehicleType = (): VehicleType => ({
  name: '', description: '', charge: '', max_gross_weight: '', max_tare_weight: '',
});

function VehicleTypesTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const invalidate = useCallback(() => qc.invalidateQueries({ queryKey: ['/api/commercial-weighbridge/vehicle-types/'] }), [qc]);

  const { data: _typesRaw, isLoading } = useFetch<any>('/api/commercial-weighbridge/vehicle-types/', token);
  const types: VehicleType[] = Array.isArray(_typesRaw?.results) ? _typesRaw.results : Array.isArray(_typesRaw) ? _typesRaw : [];

  const [open, setOpen]   = useState(false);
  const [form, setForm]   = useState<VehicleType>(emptyVehicleType());
  const [delId, setDelId] = useState<number | null>(null);

  const mut = useApiMutation(
    token,
    () => { invalidate(); setOpen(false); toast({ title: form.id ? 'Vehicle type updated' : 'Vehicle type added' }); },
    (msg) => toast({ title: 'Error', description: parseErrors(msg), variant: 'destructive' }),
  );

  const delMut = useApiMutation(
    token,
    () => { invalidate(); setDelId(null); toast({ title: 'Vehicle type deleted' }); },
    (msg) => toast({ title: 'Error', description: parseErrors(msg), variant: 'destructive' }),
  );

  function openNew() { setForm(emptyVehicleType()); setOpen(true); }
  function openEdit(vt: VehicleType) { setForm({ ...vt }); setOpen(true); }

  function save() {
    const body = {
      ...form,
      charge: Number(form.charge) || 0,
      max_gross_weight: form.max_gross_weight === '' ? null : Number(form.max_gross_weight),
      max_tare_weight: form.max_tare_weight === '' ? null : Number(form.max_tare_weight),
    };
    if (form.id) {
      mut.mutate({ url: `/api/commercial-weighbridge/vehicle-types/${form.id}/`, method: 'PATCH', body });
    } else {
      mut.mutate({ url: '/api/commercial-weighbridge/vehicle-types/', method: 'POST', body });
    }
  }

  const set = (k: keyof VehicleType, v: any) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Vehicle types determine the default weighing charge and weight limits per vehicle class.
        </p>
        <Button size="sm" className="gap-1.5 shrink-0" onClick={openNew}>
          <Plus className="h-3.5 w-3.5" /> Add Vehicle Type
        </Button>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-[10px] font-bold uppercase tracking-widest">Name</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-widest">Description</TableHead>
              <TableHead className="text-right text-[10px] font-bold uppercase tracking-widest">Charge</TableHead>
              <TableHead className="text-right text-[10px] font-bold uppercase tracking-widest">Max Gross (kg)</TableHead>
              <TableHead className="text-right text-[10px] font-bold uppercase tracking-widest">Max Tare (kg)</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">Loading…</TableCell></TableRow>
            ) : (types as VehicleType[]).length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No vehicle types defined.</TableCell></TableRow>
            ) : (types as VehicleType[]).map((vt) => (
              <TableRow key={vt.id}>
                <TableCell className="font-medium">{vt.name}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{vt.description || '—'}</TableCell>
                <TableCell className="text-right font-mono">{vt.charge}</TableCell>
                <TableCell className="text-right font-mono">{vt.max_gross_weight ?? '—'}</TableCell>
                <TableCell className="text-right font-mono">{vt.max_tare_weight ?? '—'}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1 justify-end">
                    <button onClick={() => openEdit(vt)} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted transition-colors">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => setDelId(vt.id!)} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-red-50 text-destructive transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Edit Vehicle Type' : 'Add Vehicle Type'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. 10-Tonne Truck" />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea value={form.description ?? ''} onChange={e => set('description', e.target.value)} rows={2} placeholder="Optional description" />
            </div>
            <div className="space-y-1.5">
              <Label>Default charge *</Label>
              <Input type="number" step="0.01" min="0" value={form.charge} onChange={e => set('charge', e.target.value)} placeholder="0.00" />
              <p className="text-xs text-muted-foreground">Standard weighing fee for this vehicle class. Can be overridden per customer via Discounts tab.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Max gross weight (kg)</Label>
                <Input type="number" min="0" value={form.max_gross_weight ?? ''} onChange={e => set('max_gross_weight', e.target.value)} placeholder="e.g. 30000" />
              </div>
              <div className="space-y-1.5">
                <Label>Max tare weight (kg)</Label>
                <Input type="number" min="0" value={form.max_tare_weight ?? ''} onChange={e => set('max_tare_weight', e.target.value)} placeholder="e.g. 8000" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={mut.isPending}>
              {mut.isPending ? 'Saving…' : form.id ? 'Save changes' : 'Add vehicle type'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDelete
        open={delId !== null}
        label="vehicle type"
        onConfirm={() => delMut.mutate({ url: `/api/commercial-weighbridge/vehicle-types/${delId}/`, method: 'DELETE' })}
        onCancel={() => setDelId(null)}
      />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 3 — Items
// ══════════════════════════════════════════════════════════════════════════════

type Item = { id?: number; name: string; description?: string };
const emptyItem = (): Item => ({ name: '', description: '' });

function ItemsTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const invalidate = useCallback(() => qc.invalidateQueries({ queryKey: ['/api/commercial-weighbridge/items/'] }), [qc]);

  const { data: _itemsRaw, isLoading } = useFetch<any>('/api/commercial-weighbridge/items/', token);
  const items: Item[] = Array.isArray(_itemsRaw?.results) ? _itemsRaw.results : Array.isArray(_itemsRaw) ? _itemsRaw : [];

  const [open, setOpen]   = useState(false);
  const [form, setForm]   = useState<Item>(emptyItem());
  const [delId, setDelId] = useState<number | null>(null);

  const mut = useApiMutation(
    token,
    () => { invalidate(); setOpen(false); toast({ title: form.id ? 'Item updated' : 'Item added' }); },
    (msg) => toast({ title: 'Error', description: parseErrors(msg), variant: 'destructive' }),
  );

  const delMut = useApiMutation(
    token,
    () => { invalidate(); setDelId(null); toast({ title: 'Item deleted' }); },
    (msg) => toast({ title: 'Error', description: parseErrors(msg), variant: 'destructive' }),
  );

  function openNew() { setForm(emptyItem()); setOpen(true); }
  function openEdit(item: Item) { setForm({ ...item }); setOpen(true); }

  function save() {
    if (form.id) {
      mut.mutate({ url: `/api/commercial-weighbridge/items/${form.id}/`, method: 'PATCH', body: form });
    } else {
      mut.mutate({ url: '/api/commercial-weighbridge/items/', method: 'POST', body: form });
    }
  }

  const set = (k: keyof Item, v: any) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Items are the commodities being weighed and transported (e.g. Maize, Gravel, Steel).
        </p>
        <Button size="sm" className="gap-1.5 shrink-0" onClick={openNew}>
          <Plus className="h-3.5 w-3.5" /> Add Item
        </Button>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-[10px] font-bold uppercase tracking-widest">Name</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-widest">Description</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-8">Loading…</TableCell></TableRow>
            ) : (items as Item[]).length === 0 ? (
              <TableRow><TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-8">No items defined.</TableCell></TableRow>
            ) : (items as Item[]).map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.name}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{item.description || '—'}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1 justify-end">
                    <button onClick={() => openEdit(item)} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted transition-colors">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => setDelId(item.id!)} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-red-50 text-destructive transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Edit Item' : 'Add Item'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Maize" />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea value={form.description ?? ''} onChange={e => set('description', e.target.value)} rows={2} placeholder="Optional" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={mut.isPending}>
              {mut.isPending ? 'Saving…' : form.id ? 'Save changes' : 'Add item'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDelete
        open={delId !== null}
        label="item"
        onConfirm={() => delMut.mutate({ url: `/api/commercial-weighbridge/items/${delId}/`, method: 'DELETE' })}
        onCancel={() => setDelId(null)}
      />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 4 — Customer Discounts
// ══════════════════════════════════════════════════════════════════════════════

type Discount = {
  id?: number;
  customer: number | '';
  customer_name?: string;
  vehicle_type: number | '';
  vehicle_type_name?: string;
  discounted_charge: number | '';
};

const emptyDiscount = (): Discount => ({
  customer: '', vehicle_type: '', discounted_charge: '',
});

function DiscountsTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const invalidate = useCallback(() => qc.invalidateQueries({ queryKey: ['/api/commercial-weighbridge/discounts/'] }), [qc]);

  const { data: _discountsRaw, isLoading } = useFetch<any>('/api/commercial-weighbridge/discounts/', token);
  const { data: _customersRaw } = useFetch<any>('/api/commercial-weighbridge/customers/', token);
  const { data: _vtRaw } = useFetch<any>('/api/commercial-weighbridge/vehicle-types/', token);
  const discounts: Discount[]  = Array.isArray(_discountsRaw?.results) ? _discountsRaw.results : Array.isArray(_discountsRaw) ? _discountsRaw : [];
  const customerList: any[]    = Array.isArray(_customersRaw?.results) ? _customersRaw.results : Array.isArray(_customersRaw) ? _customersRaw : [];
  const vtList: any[]          = Array.isArray(_vtRaw?.results) ? _vtRaw.results : Array.isArray(_vtRaw) ? _vtRaw : [];

  const [open, setOpen]   = useState(false);
  const [form, setForm]   = useState<Discount>(emptyDiscount());
  const [delId, setDelId] = useState<number | null>(null);

  const mut = useApiMutation(
    token,
    () => { invalidate(); setOpen(false); toast({ title: form.id ? 'Discount updated' : 'Discount added' }); },
    (msg) => toast({ title: 'Error', description: parseErrors(msg), variant: 'destructive' }),
  );

  const delMut = useApiMutation(
    token,
    () => { invalidate(); setDelId(null); toast({ title: 'Discount removed' }); },
    (msg) => toast({ title: 'Error', description: parseErrors(msg), variant: 'destructive' }),
  );

  function openNew() { setForm(emptyDiscount()); setOpen(true); }
  function openEdit(d: Discount) { setForm({ ...d }); setOpen(true); }

  function save() {
    const body = {
      customer: Number(form.customer),
      vehicle_type: Number(form.vehicle_type),
      discounted_charge: Number(form.discounted_charge),
    };
    if (form.id) {
      mut.mutate({ url: `/api/commercial-weighbridge/discounts/${form.id}/`, method: 'PATCH', body });
    } else {
      mut.mutate({ url: '/api/commercial-weighbridge/discounts/', method: 'POST', body });
    }
  }

  const set = (k: keyof Discount, v: any) => setForm(f => ({ ...f, [k]: v }));

  // Group by customer for a cleaner table
  const byCustomer: Record<string, Discount[]> = {};
  (discounts as Discount[]).forEach(d => {
    const key = d.customer_name ?? String(d.customer);
    if (!byCustomer[key]) byCustomer[key] = [];
    byCustomer[key].push(d);
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Override the standard vehicle-type charge for a specific customer. The discounted charge is used when that customer's vehicle arrives at the weighbridge.
        </p>
        <Button size="sm" className="gap-1.5 shrink-0" onClick={openNew}>
          <Plus className="h-3.5 w-3.5" /> Add Discount
        </Button>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-[10px] font-bold uppercase tracking-widest">Customer</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-widest">Vehicle Type</TableHead>
              <TableHead className="text-right text-[10px] font-bold uppercase tracking-widest">Discounted Charge</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">Loading…</TableCell></TableRow>
            ) : (discounts as Discount[]).length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">No customer discounts configured.</TableCell></TableRow>
            ) : (discounts as Discount[]).map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{d.customer_name ?? d.customer}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[10px]">{d.vehicle_type_name ?? d.vehicle_type}</Badge>
                </TableCell>
                <TableCell className="text-right font-mono font-bold">{d.discounted_charge}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1 justify-end">
                    <button onClick={() => openEdit(d)} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted transition-colors">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => setDelId(d.id!)} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-red-50 text-destructive transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Edit Discount' : 'Add Customer Discount'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5">
              <Label>Customer *</Label>
              <Select value={String(form.customer)} onValueChange={v => set('customer', v)}>
                <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>
                  {customerList.map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Vehicle type *</Label>
              <Select value={String(form.vehicle_type)} onValueChange={v => set('vehicle_type', v)}>
                <SelectTrigger><SelectValue placeholder="Select vehicle type" /></SelectTrigger>
                <SelectContent>
                  {vtList.map((vt: any) => (
                    <SelectItem key={vt.id} value={String(vt.id)}>{vt.name} (standard: {vt.charge})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Discounted charge *</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.discounted_charge}
                onChange={e => set('discounted_charge', e.target.value)}
                placeholder="0.00"
              />
              <p className="text-xs text-muted-foreground">This replaces the vehicle type's standard charge for this customer only.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={mut.isPending}>
              {mut.isPending ? 'Saving…' : form.id ? 'Save changes' : 'Add discount'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDelete
        open={delId !== null}
        label="discount"
        onConfirm={() => delMut.mutate({ url: `/api/commercial-weighbridge/discounts/${delId}/`, method: 'DELETE' })}
        onCancel={() => setDelId(null)}
      />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 5 — Overweight Surveillance
// ══════════════════════════════════════════════════════════════════════════════

type OverweightConfig = {
  id?: number;
  branch: number;
  threshold_kg: number | string;
  grace_window_minutes: number | string;
  surveillance_enabled: boolean;
};

type CameraConfig = {
  id?: number;
  branch: number | '';
  name: string;
  connection_type: string;
  camera_type: string;
  ip_address: string;
  port: number | string;
  hikvision_channel: number | string;
  username: string;
  other_parameters: string;
  capture_on_overweight: boolean;
  is_active: boolean;
};

const emptyCam = (branchId: number): CameraConfig => ({
  branch: branchId,
  name: '',
  connection_type: 'IP',
  camera_type: 'hikvision',
  ip_address: '',
  port: 80,
  hikvision_channel: 1,
  username: '',
  other_parameters: '',
  capture_on_overweight: false,
  is_active: true,
});

function SurveillanceTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: _branchesRaw } = useFetch<any>('/api/commercial-weighbridge/branches/', token);
  const branches: any[] = Array.isArray(_branchesRaw?.results)
    ? _branchesRaw.results
    : Array.isArray(_branchesRaw) ? _branchesRaw : [];

  const [selectedBranch, setSelectedBranch] = useState<number | null>(null);
  const branchId = selectedBranch ?? (branches[0]?.id ?? null);

  // Overweight config
  const configUrl = branchId ? `/api/commercial-weighbridge/overweight-config/${branchId}/` : null;
  const { data: cfg, isLoading: cfgLoading } = useFetch<OverweightConfig>(
    configUrl ?? '__disabled__',
    configUrl ? token : null,
  );
  const [cfgForm, setCfgForm] = useState<Partial<OverweightConfig>>({});
  const cfgMut = useApiMutation(
    token,
    () => { qc.invalidateQueries({ queryKey: [configUrl!] }); toast({ title: 'Surveillance settings saved' }); },
    (msg) => toast({ title: 'Error', description: parseErrors(msg), variant: 'destructive' }),
  );
  function saveCfg() {
    if (!branchId) return;
    cfgMut.mutate({
      url: `/api/commercial-weighbridge/overweight-config/${branchId}/`,
      method: 'PUT',
      body: { ...cfg, ...cfgForm, branch: branchId },
    });
  }

  // Camera configs
  const camUrl = branchId ? `/api/commercial-weighbridge/camera-configs/?branch_id=${branchId}` : null;
  const { data: _camsRaw, isLoading: camsLoading } = useFetch<any>(
    camUrl ?? '__disabled__',
    camUrl ? token : null,
  );
  const cameras: CameraConfig[] = Array.isArray(_camsRaw?.results)
    ? _camsRaw.results
    : Array.isArray(_camsRaw) ? _camsRaw : [];

  const [camOpen, setCamOpen] = useState(false);
  const [camForm, setCamForm] = useState<CameraConfig>(emptyCam(branchId ?? 0));
  const [camDelId, setCamDelId] = useState<number | null>(null);

  const camMut = useApiMutation(
    token,
    () => {
      qc.invalidateQueries({ queryKey: [camUrl!] });
      setCamOpen(false);
      toast({ title: camForm.id ? 'Camera updated' : 'Camera added' });
    },
    (msg) => toast({ title: 'Error', description: parseErrors(msg), variant: 'destructive' }),
  );
  const camDelMut = useApiMutation(
    token,
    () => { qc.invalidateQueries({ queryKey: [camUrl!] }); setCamDelId(null); toast({ title: 'Camera removed' }); },
    (msg) => toast({ title: 'Error', description: parseErrors(msg), variant: 'destructive' }),
  );

  function openNewCam() { setCamForm(emptyCam(branchId ?? 0)); setCamOpen(true); }
  function openEditCam(c: CameraConfig) { setCamForm({ ...c }); setCamOpen(true); }
  function setC(k: keyof CameraConfig, v: any) { setCamForm(f => ({ ...f, [k]: v })); }

  function saveCam() {
    const { id, ...body } = camForm as any;
    camMut.mutate({
      url: id
        ? `/api/commercial-weighbridge/camera-configs/${id}/`
        : '/api/commercial-weighbridge/camera-configs/',
      method: id ? 'PATCH' : 'POST',
      body: { ...body, branch: branchId },
    });
  }

  const cfgMerged: OverweightConfig = {
    branch: branchId ?? 0,
    threshold_kg: cfgForm.threshold_kg ?? cfg?.threshold_kg ?? 1000,
    grace_window_minutes: cfgForm.grace_window_minutes ?? cfg?.grace_window_minutes ?? 30,
    surveillance_enabled: cfgForm.surveillance_enabled ?? cfg?.surveillance_enabled ?? true,
  };

  if (!branchId) return (
    <p className="text-sm text-muted-foreground py-8 text-center">No branches configured.</p>
  );

  return (
    <div className="space-y-6">
      {branches.length > 1 && (
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium shrink-0">Branch</label>
          <Select
            value={String(branchId)}
            onValueChange={v => { setSelectedBranch(Number(v)); setCfgForm({}); }}
          >
            <SelectTrigger className="h-8 text-sm w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              {branches.map((b: any) => (
                <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Threshold config */}
      <div className="rounded-lg border p-5 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-500" />
          <h3 className="font-semibold text-sm">Overweight Threshold</h3>
        </div>
        {cfgLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Threshold (kg)</Label>
              <Input
                type="number" min="0" step="1"
                value={String(cfgMerged.threshold_kg)}
                onChange={e => setCfgForm(f => ({ ...f, threshold_kg: e.target.value }))}
                placeholder="1000"
              />
              <p className="text-xs text-muted-foreground">Events are created when net weight ≥ this value.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Grace window (minutes)</Label>
              <Input
                type="number" min="0" step="1"
                value={String(cfgMerged.grace_window_minutes)}
                onChange={e => setCfgForm(f => ({ ...f, grace_window_minutes: e.target.value }))}
                placeholder="30"
              />
              <p className="text-xs text-muted-foreground">Events without a linked transaction after this window become discrepancies.</p>
            </div>
            <div className="col-span-2 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setCfgForm(f => ({ ...f, surveillance_enabled: !cfgMerged.surveillance_enabled }))}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0
                  ${cfgMerged.surveillance_enabled ? 'bg-primary' : 'bg-muted-foreground/30'}`}
              >
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform
                  ${cfgMerged.surveillance_enabled ? 'translate-x-4' : 'translate-x-1'}`} />
              </button>
              <span className="text-sm">
                Surveillance {cfgMerged.surveillance_enabled ? 'enabled' : 'disabled'}
              </span>
            </div>
            <div className="col-span-2">
              <Button size="sm" onClick={saveCfg} disabled={cfgMut.isPending}>
                {cfgMut.isPending ? 'Saving…' : 'Save threshold settings'}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Cameras */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">HikVision / Camera Configs</h3>
          </div>
          <Button size="sm" className="gap-1.5" onClick={openNewCam}>
            <Plus className="h-3.5 w-3.5" /> Add Camera
          </Button>
        </div>

        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-[10px] font-bold uppercase tracking-widest">Name</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest">Type</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest">IP : Port</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest">OW Capture</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest">Active</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {camsLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">Loading…</TableCell></TableRow>
              ) : cameras.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">No cameras configured for this branch.</TableCell></TableRow>
              ) : cameras.map(cam => (
                <TableRow key={cam.id}>
                  <TableCell className="font-medium">{cam.name || '—'}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {cam.camera_type === 'hikvision' ? 'HikVision' : 'Generic HTTP'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground font-mono">{cam.ip_address}:{cam.port}</TableCell>
                  <TableCell>
                    {cam.capture_on_overweight
                      ? <Badge className="text-[10px] bg-green-100 text-green-800 border-green-200 hover:bg-green-100">Yes</Badge>
                      : <span className="text-muted-foreground text-xs">No</span>}
                  </TableCell>
                  <TableCell>
                    {cam.is_active
                      ? <Badge variant="secondary" className="text-[10px]">Active</Badge>
                      : <span className="text-muted-foreground text-xs">Inactive</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => openEditCam(cam)} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted transition-colors">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => setCamDelId(cam.id!)} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-red-50 text-destructive transition-colors">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Camera dialog */}
      <Dialog open={camOpen} onOpenChange={setCamOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{camForm.id ? 'Edit Camera' : 'Add Camera'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={camForm.name} onChange={e => setC('name', e.target.value)} placeholder="e.g. Entry Gate" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Camera type</Label>
                <Select value={camForm.camera_type} onValueChange={v => setC('camera_type', v)}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hikvision">HikVision (ISAPI)</SelectItem>
                    <SelectItem value="generic_http">Generic HTTP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Connection</Label>
                <Select value={camForm.connection_type} onValueChange={v => setC('connection_type', v)}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="IP">IP</SelectItem>
                    <SelectItem value="Cable">Cable</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>IP address</Label>
                <Input value={camForm.ip_address} onChange={e => setC('ip_address', e.target.value)} placeholder="192.168.1.100" />
              </div>
              <div className="space-y-1.5">
                <Label>Port</Label>
                <Input type="number" value={String(camForm.port)} onChange={e => setC('port', e.target.value)} placeholder="80" />
              </div>
            </div>
            {camForm.camera_type === 'hikvision' && (
              <div className="space-y-1.5">
                <Label>Channel number</Label>
                <Input type="number" min="1" value={String(camForm.hikvision_channel)} onChange={e => setC('hikvision_channel', e.target.value)} placeholder="1" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input value={camForm.username} onChange={e => setC('username', e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              {[
                { key: 'capture_on_overweight', label: 'Capture snapshot on overweight event' },
                { key: 'is_active', label: 'Camera active' },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean((camForm as any)[key])}
                    onChange={e => setC(key as keyof CameraConfig, e.target.checked)}
                    className="h-3.5 w-3.5"
                  />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCamOpen(false)}>Cancel</Button>
            <Button onClick={saveCam} disabled={camMut.isPending}>
              {camMut.isPending ? 'Saving…' : camForm.id ? 'Save changes' : 'Add camera'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDelete
        open={camDelId !== null}
        label="camera"
        onConfirm={() => camDelMut.mutate({ url: `/api/commercial-weighbridge/camera-configs/${camDelId}/`, method: 'DELETE' })}
        onCancel={() => setCamDelId(null)}
      />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Root page
// ══════════════════════════════════════════════════════════════════════════════

export default function WeighbridgeSettings() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div className="border-b pb-4">
        <h1 className="text-2xl font-bold tracking-tight">Weighbridge Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage indicator hardware, vehicle types, commodities, and customer discount rates.
        </p>
      </div>

      <Tabs defaultValue="indicator">
        <TabsList className="mb-4">
          <TabsTrigger value="indicator" className="gap-1.5">
            <Settings2 className="h-3.5 w-3.5" /> Indicator Config
          </TabsTrigger>
          <TabsTrigger value="vehicle-types" className="gap-1.5">
            <Truck className="h-3.5 w-3.5" /> Vehicle Types
          </TabsTrigger>
          <TabsTrigger value="items" className="gap-1.5">
            <Package className="h-3.5 w-3.5" /> Items
          </TabsTrigger>
          <TabsTrigger value="discounts" className="gap-1.5">
            <Tag className="h-3.5 w-3.5" /> Customer Discounts
          </TabsTrigger>
          <TabsTrigger value="surveillance" className="gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5" /> Surveillance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="indicator"><IndicatorConfigTab /></TabsContent>
        <TabsContent value="vehicle-types"><VehicleTypesTab /></TabsContent>
        <TabsContent value="items"><ItemsTab /></TabsContent>
        <TabsContent value="discounts"><DiscountsTab /></TabsContent>
        <TabsContent value="surveillance"><SurveillanceTab /></TabsContent>
      </Tabs>
    </div>
  );
}
