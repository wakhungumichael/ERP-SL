/**
 * First Weight — captures gross weight from the live indicator.
 *
 * Flow:
 *   1. Select branch (activates indicator polling)
 *   2. Indicator shows live reading + stable status
 *   3. Press "Capture" when stable → gross weight is set (no typing)
 *   4. Select customer → vehicle (vehicle type auto-fills)
 *   5. Optionally select item / set destination / payment
 *   6. Submit → creates First Weight transaction
 *
 * Manual override: toggle "Manual entry" if indicator is offline.
 */
import { useState } from 'react';
import { useLocation } from 'wouter';
import {
  useCreateTransaction,
  getListTransactionsQueryKey,
  useListBranches,
  useListCustomers,
  useListVehicles,
} from '@workspace/api-client-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/use-auth';
import { Scale, WifiOff } from 'lucide-react';
import LiveIndicator from '@/components/weighbridge/live-indicator';

export default function FirstWeightPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const create = useCreateTransaction();

  const [branchId, setBranchId]         = useState('');
  const [customerId, setCustomerId]     = useState('');
  const [vehicleId, setVehicleId]       = useState('');
  const [vehicleTypeId, setVehicleTypeId] = useState('');
  const [itemId, setItemId]             = useState('');
  const [destination, setDestination]   = useState('');
  const [paymentMode, setPaymentMode]   = useState('Cash');
  const [paymentStatus, setPaymentStatus] = useState('Pending');
  const [manualMode, setManualMode]     = useState(false);
  const [grossWeight, setGrossWeight]   = useState<number | null>(null);
  const [manualWeight, setManualWeight] = useState('');
  const [weightReason, setWeightReason] = useState('');

  const { data: branches }  = useListBranches({});
  const { data: customers } = useListCustomers({ search: '' });
  const { data: vehicles }  = useListVehicles(customerId ? { customer_id: parseInt(customerId, 10) } : {});
  const { data: items }     = useQuery({
    queryKey: ['items-picker'],
    queryFn: async () => {
      const token = localStorage.getItem('sl-erp-token');
      return fetch('/api/commercial-weighbridge/items/', { headers: { Authorization: `Token ${token}` } }).then(r => r.json());
    },
  });

  const branchList   = Array.isArray(branches)  ? branches  : (branches  as any)?.results ?? [];
  const customerList = Array.isArray(customers) ? customers : (customers as any)?.results ?? [];
  const vehicleList  = Array.isArray(vehicles)  ? vehicles  : (vehicles  as any)?.results ?? [];
  const itemList     = Array.isArray(items)     ? items     : (items     as any)?.results ?? [];
  const operator     = (user as any)?.username ?? '';

  const effectiveWeight = manualMode ? parseInt(manualWeight, 10) || null : grossWeight;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchId || !customerId || !vehicleId) {
      toast({ title: 'Missing fields', description: 'Branch, customer and vehicle are required.', variant: 'destructive' });
      return;
    }
    if (!effectiveWeight || effectiveWeight <= 0) {
      toast({ title: 'No weight captured', description: manualMode ? 'Enter a weight manually.' : 'Press Capture on the indicator panel.', variant: 'destructive' });
      return;
    }
    if (manualMode && !weightReason.trim()) {
      toast({ title: 'Reason required', description: 'Enter a reason for manual weight entry.', variant: 'destructive' });
      return;
    }

    const payload: Record<string, unknown> = {
      branch: parseInt(branchId, 10),
      customer: parseInt(customerId, 10),
      vehicle: parseInt(vehicleId, 10),
      weight_type: 'First Weight',
      gross_weight: effectiveWeight,
      destination,
      operator,
      payment_mode: paymentMode,
      payment_status: paymentStatus,
      manual_weight_capture: manualMode,
    };
    if (itemId) payload.item = parseInt(itemId, 10);
    if (vehicleTypeId) payload.vehicle_type = parseInt(vehicleTypeId, 10);
    if (manualMode && weightReason) payload.weight_reason = weightReason;

    create.mutate({ data: payload as any }, {
      onSuccess: (tx: any) => {
        toast({ title: `✓ First weight logged — TX-${String(tx?.id ?? '').padStart(5, '0')}` });
        queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
        setLocation('/weighbridge/transactions');
      },
      onError: (err: any) => toast({ title: 'Could not log transaction', description: err?.message, variant: 'destructive' }),
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4 border-b pb-4">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Scale className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">First Weight</h1>
          <p className="text-sm text-muted-foreground">Capture gross weight and open a new transaction</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* ── Step 1: Branch ─────────────────────────────────────── */}
        <Card className="shadow-sm">
          <CardHeader className="bg-muted/20 border-b py-3">
            <CardTitle className="text-sm font-bold uppercase tracking-widest">1 · Select Branch</CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <Select value={branchId} onValueChange={setBranchId} required>
              <SelectTrigger><SelectValue placeholder="Select branch to activate indicator…" /></SelectTrigger>
              <SelectContent>{branchList.map((b: any) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* ── Step 2: Live indicator ─────────────────────────────── */}
        <Card className="shadow-sm overflow-hidden">
          <CardHeader className="bg-muted/20 border-b py-3 flex-row items-center justify-between">
            <CardTitle className="text-sm font-bold uppercase tracking-widest">2 · Capture Gross Weight</CardTitle>
            <button
              type="button"
              onClick={() => { setManualMode(m => !m); setGrossWeight(null); setManualWeight(''); }}
              className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full border transition-colors ${
                manualMode ? 'bg-orange-100 border-orange-300 text-orange-700' : 'bg-card border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              <WifiOff className="h-3 w-3" />
              {manualMode ? 'Manual mode ON' : 'Switch to manual'}
            </button>
          </CardHeader>
          <CardContent className="p-5">
            {manualMode ? (
              <div className="space-y-4">
                <div className="flex items-end gap-3">
                  <Input
                    type="number" min={1}
                    value={manualWeight} onChange={e => setManualWeight(e.target.value)}
                    placeholder="0"
                    className="font-mono text-4xl h-16 text-center border-orange-300 focus:border-orange-400"
                    autoFocus
                  />
                  <span className="text-2xl font-medium text-muted-foreground mb-2">kg</span>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Reason for manual entry *</label>
                  <Input value={weightReason} onChange={e => setWeightReason(e.target.value)} placeholder="e.g. Indicator offline — manually read scale display" />
                </div>
              </div>
            ) : (
              <LiveIndicator
                branchId={branchId}
                label="Gross Weight"
                onCapture={w => setGrossWeight(w)}
                capturedWeight={grossWeight}
                disabled={!branchId}
              />
            )}
          </CardContent>
        </Card>

        {/* ── Step 3: Entity details ─────────────────────────────── */}
        <Card className="shadow-sm">
          <CardHeader className="bg-muted/20 border-b py-3">
            <CardTitle className="text-sm font-bold uppercase tracking-widest">3 · Vehicle & Commodity</CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Customer *</label>
              <Select value={customerId} onValueChange={v => { setCustomerId(v); setVehicleId(''); setVehicleTypeId(''); }}>
                <SelectTrigger><SelectValue placeholder="Select customer…" /></SelectTrigger>
                <SelectContent>{customerList.map((c: any) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Vehicle *</label>
              <Select value={vehicleId} onValueChange={v => {
                setVehicleId(v);
                const veh = vehicleList.find((x: any) => String(x.id) === v);
                if (veh?.vehicle_type) setVehicleTypeId(String(veh.vehicle_type));
              }} disabled={!customerId}>
                <SelectTrigger><SelectValue placeholder={customerId ? 'Select vehicle…' : 'Select customer first'} /></SelectTrigger>
                <SelectContent>
                  {vehicleList.map((v: any) => (
                    <SelectItem key={v.id} value={String(v.id)}>
                      {v.number_plate}{v.vehicle_type_name ? ` — ${v.vehicle_type_name}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Item / Commodity</label>
              <Select value={itemId} onValueChange={setItemId}>
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>{itemList.map((i: any) => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Destination</label>
              <Input placeholder="e.g. Nairobi CBD" value={destination} onChange={e => setDestination(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        {/* ── Step 4: Payment ────────────────────────────────────── */}
        <Card className="shadow-sm">
          <CardHeader className="bg-muted/20 border-b py-3">
            <CardTitle className="text-sm font-bold uppercase tracking-widest">4 · Payment</CardTitle>
          </CardHeader>
          <CardContent className="p-5 grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Mode</label>
              <Select value={paymentMode} onValueChange={setPaymentMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['Cash', 'Mpesa', 'Bank Deposit', 'Debt'].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Status</label>
              <Select value={paymentStatus} onValueChange={setPaymentStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Pending">Pending</SelectItem>
                  <SelectItem value="Paid">Paid</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Weight summary before submit */}
        {effectiveWeight && effectiveWeight > 0 && (
          <div className="p-4 rounded-xl bg-primary/5 border border-primary/20 flex items-center justify-between">
            <span className="text-sm font-bold uppercase tracking-wide text-primary">Gross Weight to Submit</span>
            <span className="font-black text-2xl font-mono text-primary">{effectiveWeight.toLocaleString()} kg</span>
          </div>
        )}

        <Button
          type="submit" size="lg"
          className="w-full font-bold uppercase tracking-widest"
          disabled={create.isPending || !effectiveWeight || !branchId || !customerId || !vehicleId}
        >
          {create.isPending ? 'Logging…' : 'Log First Weight'}
        </Button>
      </form>
    </div>
  );
}
