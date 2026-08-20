/**
 * Weighbridge Settings — tenant-admin configuration surface.
 *
 * Tabs:
 *   1. Indicator Config      — per-branch indicator settings
 *   2. Vehicle Types         — charge, weight limits
 *   3. Items                 — weighed commodities
 *   4. Customer Discounts    — per-customer per-vehicle-type override charges
 *   5. Surveillance          — vehicle presence threshold + HikVision camera config
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
import { Switch } from '@/components/ui/switch';
import { ERP_BRANCHES_ENDPOINT, ERP_BRANCHES_QUERY_KEY, normalizeBranchList } from '@/lib/branches';
import {
  Plus, Pencil, Trash2, Settings2, Truck, Package, Tag, ShieldAlert, Camera, PlugZap,
} from 'lucide-react';
import { ERPDataTable, type ERPTableColumn } from '@/components/erp/listing/data-table';

// ── helpers ────────────────────────────────────────────────────────────────────

function useFetch<T>(url: string, token: string | null) {
  return useQuery<T>({
    queryKey: url === ERP_BRANCHES_ENDPOINT ? ERP_BRANCHES_QUERY_KEY : [url],
    queryFn: async () => {
      const res = await fetch(url, { headers: { Authorization: `Token ${token}` } });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      // Handle paginated or direct list
      if (url === ERP_BRANCHES_ENDPOINT) return normalizeBranchList(json) as T;
      return (json?.results ?? json) as T;
    },
    enabled: !!token,
    staleTime: 30_000,
    refetchOnMount: 'always',
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
type IndicatorCfgRow = IndicatorCfg & { id: number };

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
  const { data: _branchesRaw } = useFetch<any>(ERP_BRANCHES_ENDPOINT, token);
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
  const [testingId, setTestingId] = useState<number | null>(null);

  const configRows: IndicatorCfgRow[] = configs.filter((cfg): cfg is IndicatorCfgRow => typeof cfg.id === 'number');
  const columns: ERPTableColumn<IndicatorCfgRow>[] = [
    {
      key: 'branch',
      label: 'Branch',
      headerClassName: 'text-[10px] font-bold uppercase tracking-widest',
      cellClassName: 'font-medium',
      render: (cfg) => cfg.branch_name ?? String(cfg.branch),
    },
    {
      key: 'indicator_name',
      label: 'Indicator',
      headerClassName: 'text-[10px] font-bold uppercase tracking-widest',
      render: (cfg) => cfg.indicator_name,
    },
    {
      key: 'connection_type',
      label: 'Connection',
      headerClassName: 'text-[10px] font-bold uppercase tracking-widest',
      render: (cfg) => <Badge variant="outline" className="text-[10px]">{cfg.connection_type}</Badge>,
    },
    {
      key: 'live_weight_url',
      label: 'Live URL',
      headerClassName: 'text-[10px] font-bold uppercase tracking-widest',
      cellClassName: 'max-w-[200px] truncate text-xs text-muted-foreground font-mono',
      render: (cfg) => cfg.live_weight_url || '—',
    },
    {
      key: 'max_first_weight_age_days',
      label: 'Max Age (days)',
      headerClassName: 'text-center text-[10px] font-bold uppercase tracking-widest',
      cellClassName: 'text-center font-mono font-bold',
      render: (cfg) => cfg.max_first_weight_age_days,
    },
  ];

  function openNew() { setForm(emptyIndicator()); setOpen(true); }
  function openEdit(cfg: IndicatorCfg) { setForm({ ...cfg }); setOpen(true); }

  async function testConnection(cfg: IndicatorCfg) {
    if (!cfg.id || !token) return;
    setTestingId(cfg.id);
    try {
      const res = await fetch(`/api/commercial-weighbridge/indicator-configs/${cfg.id}/test/`, {
        method: 'POST',
        headers: {
          Authorization: `Token ${token}`,
          'Content-Type': 'application/json',
        },
      });
      const payload = await res.json().catch(() => ({}));
      const results = Array.isArray(payload?.results) ? payload.results : [];
      const summary = results.length
        ? results.map((row: any) => (
            row?.reachable
              ? `${row.label}: OK${row.weight != null ? ` (${row.weight})` : ''}`
              : `${row.label}: ${row?.error || row?.technical_error || 'Failed'}`
          )).join(' | ')
        : 'Indicator responded successfully.';

      if (!res.ok) {
        throw new Error(
          [payload?.message, summary]
            .filter(Boolean)
            .join(' | ')
          || payload?.error
          || parseErrors(JSON.stringify(payload))
          || 'Connection test failed.',
        );
      }

      toast({
        title: payload?.ok ? 'Indicator connection ok' : 'Indicator test completed',
        description: summary,
        variant: payload?.ok ? 'default' : 'destructive',
      });
    } catch (error: any) {
      toast({
        title: 'Connection test failed',
        description: error?.message || 'Could not reach the configured indicator.',
        variant: 'destructive',
      });
    } finally {
      setTestingId(null);
    }
  }

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

      <div className="rounded-lg border overflow-hidden bg-card">
        <ERPDataTable<IndicatorCfgRow>
          columns={columns}
          rows={configRows}
          loading={isLoading}
          emptyState="No indicator configs yet."
          onRowClick={openEdit}
          rowActions={(cfg) => (
            <div className="flex items-center gap-1 justify-end">
              <button
                onClick={() => testConnection(cfg)}
                disabled={testingId === cfg.id}
                title="Test connection"
                className="h-7 px-2 inline-flex items-center gap-1 justify-center rounded border hover:bg-muted transition-colors disabled:opacity-60 text-xs"
              >
                <PlugZap className="h-3.5 w-3.5" />
                <span>{testingId === cfg.id ? 'Testing…' : 'Test'}</span>
              </button>
              <button onClick={() => openEdit(cfg)} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted transition-colors">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setDelId(cfg.id)} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-red-50 text-destructive transition-colors">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        />
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
  linked_product_id?: number | null;
  linked_product_name?: string;
  linked_product_code?: string;
};
type VehicleTypeRow = VehicleType & { id: number };

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

  const vehicleTypeRows: VehicleTypeRow[] = types.filter((vt): vt is VehicleTypeRow => typeof vt.id === 'number');
  const columns: ERPTableColumn<VehicleTypeRow>[] = [
    {
      key: 'name',
      label: 'Name',
      headerClassName: 'text-[10px] font-bold uppercase tracking-widest',
      cellClassName: 'font-medium',
      render: (vt) => vt.name,
    },
    {
      key: 'description',
      label: 'Description',
      headerClassName: 'text-[10px] font-bold uppercase tracking-widest',
      cellClassName: 'text-muted-foreground text-sm',
      render: (vt) => vt.description || '—',
    },
    {
      key: 'charge',
      label: 'Charge',
      headerClassName: 'text-right text-[10px] font-bold uppercase tracking-widest',
      cellClassName: 'text-right font-mono',
      render: (vt) => vt.charge,
    },
    {
      key: 'linked_product',
      label: 'ERP Service',
      headerClassName: 'text-[10px] font-bold uppercase tracking-widest',
      render: (vt) => vt.linked_product_name ? (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{vt.linked_product_name}</span>
          <Badge variant="secondary" className="w-fit">{vt.linked_product_code || 'Service linked'}</Badge>
        </div>
      ) : (
        <Badge variant="outline">Will sync on save</Badge>
      ),
    },
    {
      key: 'max_gross_weight',
      label: 'Max Gross (kg)',
      headerClassName: 'text-right text-[10px] font-bold uppercase tracking-widest',
      cellClassName: 'text-right font-mono',
      render: (vt) => vt.max_gross_weight ?? '—',
    },
    {
      key: 'max_tare_weight',
      label: 'Max Tare (kg)',
      headerClassName: 'text-right text-[10px] font-bold uppercase tracking-widest',
      cellClassName: 'text-right font-mono',
      render: (vt) => vt.max_tare_weight ?? '—',
    },
  ];

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
          Vehicle types are managed per organization. They determine the default weighing charge and weight limits per vehicle class, and each saved vehicle type also syncs to the active organization&apos;s Products &amp; Services catalog as a service item.
        </p>
        <Button size="sm" className="gap-1.5 shrink-0" onClick={openNew}>
          <Plus className="h-3.5 w-3.5" /> Add Vehicle Type
        </Button>
      </div>

      <div className="rounded-lg border overflow-hidden bg-card">
        <ERPDataTable<VehicleTypeRow>
          columns={columns}
          rows={vehicleTypeRows}
          loading={isLoading}
          emptyState="No vehicle types defined."
          onRowClick={openEdit}
          rowActions={(vt) => (
            <div className="flex items-center gap-1 justify-end">
              <button onClick={() => openEdit(vt)} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted transition-colors">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setDelId(vt.id)} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-red-50 text-destructive transition-colors">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        />
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
              <p className="text-xs text-muted-foreground">Standard weighing fee for this vehicle class. This amount also becomes the linked ERP service price and can still be overridden per customer via Discounts.</p>
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
            <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
              Saving this vehicle type creates or updates a matching service in <span className="font-medium text-foreground">Sales &amp; Payments → Products &amp; Services</span> for the active tenant.
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
type ItemRow = Item & { id: number };
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

  const itemRows: ItemRow[] = items.filter((item): item is ItemRow => typeof item.id === 'number');
  const columns: ERPTableColumn<ItemRow>[] = [
    {
      key: 'name',
      label: 'Name',
      headerClassName: 'text-[10px] font-bold uppercase tracking-widest',
      cellClassName: 'font-medium',
      render: (item) => item.name,
    },
    {
      key: 'description',
      label: 'Description',
      headerClassName: 'text-[10px] font-bold uppercase tracking-widest',
      cellClassName: 'text-muted-foreground text-sm',
      render: (item) => item.description || '—',
    },
  ];

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

      <div className="rounded-lg border overflow-hidden bg-card">
        <ERPDataTable<ItemRow>
          columns={columns}
          rows={itemRows}
          loading={isLoading}
          emptyState="No items defined."
          onRowClick={openEdit}
          rowActions={(item) => (
            <div className="flex items-center gap-1 justify-end">
              <button onClick={() => openEdit(item)} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted transition-colors">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setDelId(item.id)} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-red-50 text-destructive transition-colors">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        />
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

type OperationType = {
  id?: number;
  code: string;
  name: string;
  description?: string;
  flow_kind: 'first' | 'second' | 'single' | 'axle';
  is_active: boolean;
  display_order: number | string;
  is_default: boolean;
};
type OperationTypeRow = OperationType & { id: number };

const emptyOperationType = (): OperationType => ({
  code: '',
  name: '',
  description: '',
  flow_kind: 'first',
  is_active: true,
  display_order: 10,
  is_default: false,
});

function OperationTypesTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const invalidate = useCallback(() => qc.invalidateQueries({ queryKey: ['/api/commercial-weighbridge/weighing-operation-types/'] }), [qc]);
  const { data: _rowsRaw, isLoading } = useFetch<any>('/api/commercial-weighbridge/weighing-operation-types/', token);
  const rows: OperationType[] = Array.isArray(_rowsRaw?.results) ? _rowsRaw.results : Array.isArray(_rowsRaw) ? _rowsRaw : [];
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<OperationType>(emptyOperationType());
  const [delId, setDelId] = useState<number | null>(null);

  const mut = useApiMutation(
    token,
    () => { invalidate(); setOpen(false); toast({ title: form.id ? 'Operation type updated' : 'Operation type added' }); },
    (msg) => toast({ title: 'Error', description: parseErrors(msg), variant: 'destructive' }),
  );
  const delMut = useApiMutation(
    token,
    () => { invalidate(); setDelId(null); toast({ title: 'Operation type deleted' }); },
    (msg) => toast({ title: 'Error', description: parseErrors(msg), variant: 'destructive' }),
  );

  const operationTypeRows: OperationTypeRow[] = rows.filter((row): row is OperationTypeRow => typeof row.id === 'number');
  const columns: ERPTableColumn<OperationTypeRow>[] = [
    {
      key: 'name',
      label: 'Type',
      cellClassName: 'align-top',
      render: (row) => (
        <div>
          <div className="font-medium">{row.name}</div>
          <div className="text-xs text-muted-foreground">{row.description || '—'}</div>
        </div>
      ),
    },
    {
      key: 'flow_kind',
      label: 'Flow',
      cellClassName: 'uppercase text-xs',
      render: (row) => row.flow_kind,
    },
    {
      key: 'code',
      label: 'Code',
      cellClassName: 'font-mono text-xs',
      render: (row) => row.code,
    },
    {
      key: 'is_active',
      label: 'Active',
      render: (row) => <Badge variant={row.is_active ? 'secondary' : 'outline'}>{row.is_active ? 'Active' : 'Inactive'}</Badge>,
    },
    {
      key: 'display_order',
      label: 'Order',
      headerClassName: 'text-right',
      cellClassName: 'text-right font-mono',
      render: (row) => row.display_order,
    },
  ];

  const save = () => {
    const body = { ...form, display_order: Number(form.display_order) || 10 };
    if (form.id) mut.mutate({ url: `/api/commercial-weighbridge/weighing-operation-types/${form.id}/`, method: 'PATCH', body });
    else mut.mutate({ url: '/api/commercial-weighbridge/weighing-operation-types/', method: 'POST', body });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Control which weighing workflows this organization can use. Default system types can be activated, deactivated, or reordered, while organization-specific custom types can still be fully edited.</p>
        <Button size="sm" className="gap-1.5 shrink-0" onClick={() => { setForm(emptyOperationType()); setOpen(true); }}>
          <Plus className="h-3.5 w-3.5" /> Add Operation Type
        </Button>
      </div>

      <div className="rounded-lg border overflow-hidden bg-card">
        <ERPDataTable<OperationTypeRow>
          columns={columns}
          rows={operationTypeRows}
          loading={isLoading}
          emptyState="No operation types configured."
          onRowClick={(row) => { setForm({ ...row }); setOpen(true); }}
          rowActions={(row) => (
            <div className="flex items-center gap-1 justify-end">
              <button onClick={() => { setForm({ ...row }); setOpen(true); }} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted transition-colors">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              {!row.is_default ? (
                <button onClick={() => setDelId(row.id)} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-red-50 text-destructive transition-colors">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          )}
        />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{form.id ? 'Edit Operation Type' : 'Add Operation Type'}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} disabled={Boolean(form.is_default)} />
            </div>
            <div className="space-y-1.5">
              <Label>Code *</Label>
              <Input value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value.toUpperCase().replace(/\s+/g, '_') }))} disabled={Boolean(form.is_default)} />
            </div>
            <div className="space-y-1.5">
              <Label>Flow Kind</Label>
              <Select value={form.flow_kind} onValueChange={(v: any) => setForm(p => ({ ...p, flow_kind: v }))} disabled={Boolean(form.is_default)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="first">First Weight</SelectItem>
                  <SelectItem value="second">Second Weight</SelectItem>
                  <SelectItem value="single">Single Weight</SelectItem>
                  <SelectItem value="axle">Axle Weight</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea value={form.description ?? ''} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} disabled={Boolean(form.is_default)} />
            </div>
            <div className="space-y-1.5">
              <Label>Display Order</Label>
              <Input type="number" min="1" value={form.display_order} onChange={e => setForm(p => ({ ...p, display_order: e.target.value }))} />
            </div>
            {form.is_default ? (
              <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                This is a default system operation type. Your organization can switch it on or off and change its display order, but the core definition stays shared.
              </div>
            ) : null}
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <div className="text-sm font-medium">Active</div>
                <div className="text-xs text-muted-foreground">Inactive types are hidden from operators.</div>
              </div>
              <Switch checked={form.is_active} onCheckedChange={v => setForm(p => ({ ...p, is_active: v }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={mut.isPending}>{mut.isPending ? 'Saving…' : 'Save type'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDelete
        open={delId !== null}
        label="operation type"
        onConfirm={() => delMut.mutate({ url: `/api/commercial-weighbridge/weighing-operation-types/${delId}/`, method: 'DELETE' })}
        onCancel={() => setDelId(null)}
      />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 4 — Customer Discounts
// ══════════════════════════════════════════════════════════════════════════════

type PricingRule = {
  id?: number;
  name: string;
  priority: number | string;
  rule_type?: { id: number; name: string; slug: string };
  module?: { id: number; slug: string };
  rule_type_id: string;
  adjustment_mode: 'override' | 'fixed_discount' | 'percentage_discount';
  amount: number | string;
  conditions: Record<string, any>;
  is_active: boolean;
};
type PricingRuleRow = PricingRule & { id: number };

const emptyPricingRule = (): PricingRule => ({
  name: '',
  priority: 100,
  rule_type_id: '',
  adjustment_mode: 'override',
  amount: '',
  conditions: {},
  is_active: true,
});

function DiscountsTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const invalidate = useCallback(() => qc.invalidateQueries({ queryKey: ['/api/platform/pricing-rules/?module_slug=weighbridge'] }), [qc]);

  const { data: _rulesRaw, isLoading } = useFetch<any>('/api/platform/pricing-rules/?module_slug=weighbridge', token);
  const { data: _ruleTypesRaw } = useFetch<any>('/api/platform/pricing-rule-types/?module_slug=weighbridge', token);
  const { data: _customersRaw } = useFetch<any>('/api/commercial-weighbridge/customers/', token);
  const { data: _vtRaw } = useFetch<any>('/api/commercial-weighbridge/vehicle-types/', token);
  const rules: PricingRule[] = Array.isArray(_rulesRaw?.results) ? _rulesRaw.results : Array.isArray(_rulesRaw) ? _rulesRaw : [];
  const ruleTypes: any[] = Array.isArray(_ruleTypesRaw?.results) ? _ruleTypesRaw.results : Array.isArray(_ruleTypesRaw) ? _ruleTypesRaw : [];
  const customerList: any[] = Array.isArray(_customersRaw?.results) ? _customersRaw.results : Array.isArray(_customersRaw) ? _customersRaw : [];
  const vtList: any[] = Array.isArray(_vtRaw?.results) ? _vtRaw.results : Array.isArray(_vtRaw) ? _vtRaw : [];

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({
    ...emptyPricingRule(),
    customer_id: '',
    vehicle_type_id: '',
    min_weight_kg: '',
    max_weight_kg: '',
  });
  const [delId, setDelId] = useState<number | null>(null);
  const moduleId =
    ruleTypes.find((rt: any) => rt.module?.slug === 'weighbridge' || rt.module?.slug === 'commercial-weighbridge')?.module?.id
    ?? rules.find((r: any) => r.module?.slug === 'weighbridge' || r.module?.slug === 'commercial-weighbridge')?.module?.id
    ?? 2;

  const mut = useApiMutation(
    token,
    () => { invalidate(); setOpen(false); toast({ title: form.id ? 'Pricing rule updated' : 'Pricing rule added' }); },
    (msg) => toast({ title: 'Error', description: parseErrors(msg), variant: 'destructive' }),
  );

  const delMut = useApiMutation(
    token,
    () => { invalidate(); setDelId(null); toast({ title: 'Pricing rule removed' }); },
    (msg) => toast({ title: 'Error', description: parseErrors(msg), variant: 'destructive' }),
  );

  function openNew() {
    setForm({
      ...emptyPricingRule(),
      customer_id: '',
      vehicle_type_id: '',
      min_weight_kg: '',
      max_weight_kg: '',
    });
    setOpen(true);
  }

  function openEdit(rule: PricingRule) {
    const conditions = rule.conditions ?? {};
    setForm({
      id: rule.id,
      name: rule.name,
      priority: rule.priority,
      rule_type_id: String(rule.rule_type?.id ?? ''),
      adjustment_mode: rule.adjustment_mode,
      amount: rule.amount,
      is_active: rule.is_active,
      customer_id: conditions.customer_id ? String(conditions.customer_id) : '',
      vehicle_type_id: conditions.vehicle_type_id ? String(conditions.vehicle_type_id) : '',
      min_weight_kg: conditions.min_weight_kg ?? '',
      max_weight_kg: conditions.max_weight_kg ?? '',
    });
    setOpen(true);
  }

  function save() {
    const conditions: Record<string, any> = { weight_type: 'First Weight' };
    if (form.customer_id) conditions.customer_id = Number(form.customer_id);
    if (form.vehicle_type_id) conditions.vehicle_type_id = Number(form.vehicle_type_id);
    if (form.min_weight_kg !== '') conditions.min_weight_kg = Number(form.min_weight_kg);
    if (form.max_weight_kg !== '') conditions.max_weight_kg = Number(form.max_weight_kg);

    const body = {
      name: form.name,
      rule_type_id: Number(form.rule_type_id),
      module_id: moduleId,
      priority: Number(form.priority || 100),
      adjustment_mode: form.adjustment_mode,
      amount: Number(form.amount),
      conditions,
      is_active: Boolean(form.is_active),
    };
    if (form.id) {
      mut.mutate({ url: `/api/platform/pricing-rules/${form.id}/`, method: 'PATCH', body });
    } else {
      mut.mutate({ url: '/api/platform/pricing-rules/', method: 'POST', body });
    }
  }

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  function describeRule(rule: PricingRule) {
    const conditions = rule.conditions ?? {};
    const customer = customerList.find((c: any) => c.id === conditions.customer_id);
    const vehicleType = vtList.find((vt: any) => vt.id === conditions.vehicle_type_id);
    const bits = [];
    if (customer) bits.push(customer.name);
    if (vehicleType) bits.push(vehicleType.name);
    if (conditions.min_weight_kg !== undefined || conditions.max_weight_kg !== undefined) {
      bits.push(`weight ${conditions.min_weight_kg ?? 0} - ${conditions.max_weight_kg ?? 'any'} kg`);
    }
    return bits.length ? bits.join(' · ') : 'General rule';
  }

  function describeAmount(rule: PricingRule) {
    if (rule.adjustment_mode === 'override') return `Charge = ${rule.amount}`;
    if (rule.adjustment_mode === 'fixed_discount') return `Less ${rule.amount}`;
    return `${rule.amount}% off`;
  }

  const pricingRuleRows: PricingRuleRow[] = rules.filter((rule): rule is PricingRuleRow => typeof rule.id === 'number');
  const columns: ERPTableColumn<PricingRuleRow>[] = [
    {
      key: 'rule',
      label: 'Rule',
      headerClassName: 'text-[10px] font-bold uppercase tracking-widest',
      cellClassName: 'font-medium',
      render: (rule) => (
        <div>
          <div>{rule.name}</div>
          <div className="text-[11px] text-muted-foreground">Priority {rule.priority}</div>
        </div>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      headerClassName: 'text-[10px] font-bold uppercase tracking-widest',
      render: (rule) => <Badge variant="outline" className="text-[10px]">{rule.rule_type?.name ?? 'Rule'}</Badge>,
    },
    {
      key: 'conditions',
      label: 'Conditions',
      headerClassName: 'text-[10px] font-bold uppercase tracking-widest',
      cellClassName: 'text-sm text-muted-foreground',
      render: (rule) => describeRule(rule),
    },
    {
      key: 'adjustment',
      label: 'Adjustment',
      headerClassName: 'text-right text-[10px] font-bold uppercase tracking-widest',
      cellClassName: 'text-right font-mono font-bold',
      render: (rule) => describeAmount(rule),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Configure reusable pricing rules for weighbridge charges. You can target customer-only, customer plus vehicle type, or weight-band rules from one central pricing engine.
        </p>
        <Button size="sm" className="gap-1.5 shrink-0" onClick={openNew}>
          <Plus className="h-3.5 w-3.5" /> Add Rule
        </Button>
      </div>

      <div className="rounded-lg border overflow-hidden bg-card">
        <ERPDataTable<PricingRuleRow>
          columns={columns}
          rows={pricingRuleRows}
          loading={isLoading}
          emptyState="No pricing rules configured."
          onRowClick={openEdit}
          rowActions={(rule) => (
            <div className="flex items-center gap-1 justify-end">
              <button onClick={() => openEdit(rule)} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted transition-colors">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setDelId(rule.id)} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-red-50 text-destructive transition-colors">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Edit Pricing Rule' : 'Add Pricing Rule'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5">
              <Label>Rule name *</Label>
              <Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="VIP 10 wheeler override" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Rule type *</Label>
                <Select value={String(form.rule_type_id)} onValueChange={v => set('rule_type_id', v)}>
                  <SelectTrigger><SelectValue placeholder="Select rule type" /></SelectTrigger>
                  <SelectContent>
                    {ruleTypes.map((rt: any) => (
                      <SelectItem key={rt.id} value={String(rt.id)}>{rt.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Input type="number" value={form.priority} onChange={e => set('priority', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Customer</Label>
                <Select value={String(form.customer_id || 'all')} onValueChange={v => set('customer_id', v === 'all' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Any customer" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any customer</SelectItem>
                    {customerList.map((c: any) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Vehicle type</Label>
                <Select value={String(form.vehicle_type_id || 'all')} onValueChange={v => set('vehicle_type_id', v === 'all' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Any vehicle type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any vehicle type</SelectItem>
                    {vtList.map((vt: any) => (
                      <SelectItem key={vt.id} value={String(vt.id)}>{vt.name} (standard: {vt.charge})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Minimum weight (kg)</Label>
                <Input type="number" min="0" value={form.min_weight_kg} onChange={e => set('min_weight_kg', e.target.value)} placeholder="Optional" />
              </div>
              <div className="space-y-1.5">
                <Label>Maximum weight (kg)</Label>
                <Input type="number" min="0" value={form.max_weight_kg} onChange={e => set('max_weight_kg', e.target.value)} placeholder="Optional" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Adjustment mode *</Label>
                <Select value={form.adjustment_mode} onValueChange={v => set('adjustment_mode', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="override">Override charge</SelectItem>
                    <SelectItem value="fixed_discount">Fixed discount</SelectItem>
                    <SelectItem value="percentage_discount">Percentage discount</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Amount *</Label>
                <Input type="number" step="0.01" min="0" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Overrides set the final charge directly. Fixed and percentage discounts are applied against the selected vehicle type's standard charge.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={mut.isPending || !form.name || !form.rule_type_id || form.amount === ''}>
              {mut.isPending ? 'Saving…' : form.id ? 'Save changes' : 'Add rule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDelete
        open={delId !== null}
        label="pricing rule"
        onConfirm={() => delMut.mutate({ url: `/api/platform/pricing-rules/${delId}/`, method: 'DELETE' })}
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
  capture_interval_seconds: number | string;
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
type CameraConfigRow = CameraConfig & { id: number };

type SurveillanceMonitor = {
  service_name: string;
  running: boolean;
  branch?: {
    id: number;
    name: string;
    company_name?: string | null;
  } | null;
  owner_id?: string | null;
  heartbeat_at?: string | null;
  lease_until?: string | null;
  lease_seconds: number;
  presence_interval_seconds: number;
  sweep_interval_seconds: number;
  last_presence_run_at?: string | null;
  last_presence_captured: number;
  last_presence_results: Array<{
    branch_id?: number;
    branch_name?: string | null;
    company_name?: string | null;
    tenant_id?: number | null;
    tenant_name?: string | null;
    captured?: boolean;
    reason?: string;
    error?: string;
    technical_error?: string;
    weight?: number;
    threshold?: number;
    capture_interval_seconds?: number;
    source?: string;
  }>;
  last_sweep_run_at?: string | null;
  last_sweep_created: number;
  last_sweep_skipped: number;
  last_error_at?: string | null;
  last_error?: string | null;
  tenant?: { id: number; name: string; code: string } | null;
  tenant_has_weighbridge: boolean;
  active_module_slugs: string[];
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

  const { data: _branchesRaw } = useFetch<any>(ERP_BRANCHES_ENDPOINT, token);
  const branches: any[] = Array.isArray(_branchesRaw?.results)
    ? _branchesRaw.results
    : Array.isArray(_branchesRaw) ? _branchesRaw : [];

  const [selectedBranch, setSelectedBranch] = useState<number | null>(null);
  const branchId = selectedBranch ?? (branches[0]?.id ?? null);
  const branchLabel = branches.find((b: any) => b.id === branchId)?.name ?? 'Selected branch';
  const monitorUrl = branchId
    ? `/api/commercial-weighbridge/surveillance-monitor/?branch_id=${branchId}`
    : '/api/commercial-weighbridge/surveillance-monitor/';
  const { data: monitor, isLoading: monitorLoading } = useFetch<SurveillanceMonitor>(monitorUrl, token);

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
  const [testingMonitor, setTestingMonitor] = useState(false);

  const cameraRows: CameraConfigRow[] = cameras.filter((cam): cam is CameraConfigRow => typeof cam.id === 'number');
  const cameraColumns: ERPTableColumn<CameraConfigRow>[] = [
    {
      key: 'name',
      label: 'Name',
      headerClassName: 'text-[10px] font-bold uppercase tracking-widest',
      cellClassName: 'font-medium',
      render: (cam) => cam.name || '—',
    },
    {
      key: 'camera_type',
      label: 'Type',
      headerClassName: 'text-[10px] font-bold uppercase tracking-widest',
      render: (cam) => (
        <Badge variant="outline" className="text-[10px]">
          {cam.camera_type === 'hikvision' ? 'HikVision' : 'Generic HTTP'}
        </Badge>
      ),
    },
    {
      key: 'ip_port',
      label: 'IP : Port',
      headerClassName: 'text-[10px] font-bold uppercase tracking-widest',
      cellClassName: 'text-sm text-muted-foreground font-mono',
      render: (cam) => `${cam.ip_address}:${cam.port}`,
    },
    {
      key: 'capture_on_overweight',
      label: 'Threshold Capture',
      headerClassName: 'text-[10px] font-bold uppercase tracking-widest',
      render: (cam) => cam.capture_on_overweight
        ? <Badge className="text-[10px] bg-green-100 text-green-800 border-green-200 hover:bg-green-100">Yes</Badge>
        : <span className="text-muted-foreground text-xs">No</span>,
    },
    {
      key: 'is_active',
      label: 'Active',
      headerClassName: 'text-[10px] font-bold uppercase tracking-widest',
      render: (cam) => cam.is_active
        ? <Badge variant="secondary" className="text-[10px]">Active</Badge>
        : <span className="text-muted-foreground text-xs">Inactive</span>,
    },
  ];

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
    capture_interval_seconds: cfgForm.capture_interval_seconds ?? cfg?.capture_interval_seconds ?? 45,
    surveillance_enabled: cfgForm.surveillance_enabled ?? cfg?.surveillance_enabled ?? true,
  };
  const scopedPresenceResults = (monitor?.last_presence_results ?? []).filter(
    (row) => row?.branch_id == null || Number(row.branch_id) === Number(branchId),
  );

  if (!branchId) return (
    <p className="text-sm text-muted-foreground py-8 text-center">No branches configured.</p>
  );

  async function testSelectedBranch() {
    if (!token || !branchId) return;
    setTestingMonitor(true);
    try {
      const res = await fetch('/api/commercial-weighbridge/surveillance-monitor/test/', {
        method: 'POST',
        headers: {
          Authorization: `Token ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ branch_id: branchId }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || payload?.message || `HTTP ${res.status}`);
      }
      const reason = payload?.reason
        ? (payload.captured
            ? `Captured ${payload.weight ?? '—'} kg`
            : `${payload.reason}${payload.error ? `: ${payload.error}` : ''}`)
        : 'Test completed';
      toast({
        title: payload.captured ? 'Test capture succeeded' : 'Test completed',
        description: `${branchLabel}: ${reason}`,
        variant: payload.captured ? 'default' : 'destructive',
      });
      qc.invalidateQueries({ queryKey: [monitorUrl] });
    } catch (error: any) {
      toast({
        title: 'Branch test failed',
        description: error?.message || 'Could not run the branch test.',
        variant: 'destructive',
      });
    } finally {
      setTestingMonitor(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-sm">Surveillance Monitor</h3>
            <p className="text-xs text-muted-foreground">Shows whether the main background runner is active for vehicle presence and discrepancy checks.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={testSelectedBranch} disabled={testingMonitor || !branchId}>
              {testingMonitor ? 'Testing…' : 'Test branch'}
            </Button>
            {monitorLoading ? (
              <Badge variant="outline">Loading…</Badge>
            ) : monitor?.running ? (
              <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">Running</Badge>
            ) : (
              <Badge variant="destructive">Not running</Badge>
            )}
          </div>
        </div>
        {monitor && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="space-y-1">
              <div><span className="text-muted-foreground">Branch:</span> {monitor.branch?.name || branchLabel}</div>
              <div><span className="text-muted-foreground">Company:</span> {monitor.branch?.company_name || '—'}</div>
              <div><span className="text-muted-foreground">Tenant:</span> {monitor.tenant?.name || 'Global'}</div>
              <div><span className="text-muted-foreground">Subscription:</span> {monitor.tenant_has_weighbridge ? 'Weighbridge active' : 'Weighbridge not active'}</div>
              <div><span className="text-muted-foreground">Runner:</span> {monitor.owner_id || '—'}</div>
              <div><span className="text-muted-foreground">Heartbeat:</span> {monitor.heartbeat_at ? new Date(monitor.heartbeat_at).toLocaleString() : '—'}</div>
            </div>
            <div className="space-y-1">
              <div><span className="text-muted-foreground">Presence interval:</span> {monitor.presence_interval_seconds}s</div>
              <div><span className="text-muted-foreground">Sweep interval:</span> {monitor.sweep_interval_seconds}s</div>
              <div><span className="text-muted-foreground">Last presence run:</span> {monitor.last_presence_run_at ? new Date(monitor.last_presence_run_at).toLocaleString() : '—'}</div>
              <div><span className="text-muted-foreground">Last sweep run:</span> {monitor.last_sweep_run_at ? new Date(monitor.last_sweep_run_at).toLocaleString() : '—'}</div>
            </div>
            <div className="col-span-2 grid grid-cols-3 gap-3">
              <div className="rounded-md border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground">Presence Captured</div>
                <div className="text-lg font-semibold">{monitor.last_presence_captured ?? 0}</div>
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground">Discrepancies Raised</div>
                <div className="text-lg font-semibold">{monitor.last_sweep_created ?? 0}</div>
              </div>
              <div className="rounded-md border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground">Sweep Skipped</div>
                <div className="text-lg font-semibold">{monitor.last_sweep_skipped ?? 0}</div>
              </div>
            </div>
            {!!monitor.last_error && (
              <div className="col-span-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <div className="font-medium">Last runner error</div>
                <div>{monitor.last_error}</div>
                <div className="text-xs mt-1">{monitor.last_error_at ? new Date(monitor.last_error_at).toLocaleString() : ''}</div>
              </div>
            )}
            {!!scopedPresenceResults.length && (
              <div className="col-span-2 rounded-md border p-3 space-y-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Recent result for selected branch</div>
                <div className="space-y-1">
                  {scopedPresenceResults.slice(0, 5).map((row, idx) => (
                    <div key={idx} className="text-sm">
                      <span className="font-medium">{row.branch_name || branchLabel}:</span>{' '}
                      {row.captured
                        ? `Captured ${row.weight ?? '—'} kg`
                        : `${row.reason || 'No capture'}${row.reason === 'tenant_not_resolved' && row.company_name ? ` (company ${row.company_name})` : ''}${row.weight != null ? ` (${row.weight} / ${row.threshold ?? '—'} kg)` : ''}${row.capture_interval_seconds ? `, interval ${row.capture_interval_seconds}s` : ''}${row.source ? ` via ${row.source}` : ''}`}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

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
          <h3 className="font-semibold text-sm">Vehicle Presence Threshold</h3>
        </div>
        {cfgLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Threshold (kg)</Label>
              <Input
                type="number" min="-1" step="1"
                value={String(cfgMerged.threshold_kg)}
                onChange={e => setCfgForm(f => ({ ...f, threshold_kg: e.target.value }))}
                placeholder="1000"
              />
              <p className="text-xs text-muted-foreground">Vehicle presence events are created when the scale reading meets or exceeds this value.</p>
            </div>
              <div className="space-y-1.5">
                <Label>Grace window (minutes)</Label>
                <Input
                type="number" min="0" step="1"
                value={String(cfgMerged.grace_window_minutes)}
                onChange={e => setCfgForm(f => ({ ...f, grace_window_minutes: e.target.value }))}
                placeholder="30"
              />
              <p className="text-xs text-muted-foreground">A captured presence event becomes a discrepancy if no matching transaction is found after this window.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Capture interval (seconds)</Label>
                <Input
                  type="number" min="1" step="1"
                  value={String(cfgMerged.capture_interval_seconds)}
                  onChange={e => setCfgForm(f => ({ ...f, capture_interval_seconds: e.target.value }))}
                  placeholder="45"
                />
                <p className="text-xs text-muted-foreground">Minimum time before the same branch can record another repeated vehicle-presence reading. Example: `5` for every 5 seconds, `300` for every 5 minutes.</p>
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
                {cfgMut.isPending ? 'Saving…' : 'Save surveillance settings'}
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

        <div className="rounded-lg border overflow-hidden bg-card">
          <ERPDataTable<CameraConfigRow>
            columns={cameraColumns}
            rows={cameraRows}
            loading={camsLoading}
            emptyState="No cameras configured for this branch."
            onRowClick={openEditCam}
            rowActions={(cam) => (
              <div className="flex items-center gap-1 justify-end">
                <button onClick={() => openEditCam(cam)} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted transition-colors">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => setCamDelId(cam.id)} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-red-50 text-destructive transition-colors">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          />
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
                { key: 'capture_on_overweight', label: 'Capture snapshot on threshold event' },
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
          <TabsTrigger value="operation-types" className="gap-1.5">
            <Tag className="h-3.5 w-3.5" /> Operation Types
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
        <TabsContent value="operation-types"><OperationTypesTab /></TabsContent>
        <TabsContent value="vehicle-types"><VehicleTypesTab /></TabsContent>
        <TabsContent value="items"><ItemsTab /></TabsContent>
        <TabsContent value="discounts"><DiscountsTab /></TabsContent>
        <TabsContent value="surveillance"><SurveillanceTab /></TabsContent>
      </Tabs>
    </div>
  );
}
