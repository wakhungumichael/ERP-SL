/**
 * Second Weight — tare capture that auto-populates from the matching First Weight.
 *
 * Flow:
 *   1. Type / search by number plate (no customer required)
 *   2. System fetches workflow context → auto-populates all First Weight details
 *   3. Live indicator shows current reading → press Capture for tare weight
 *   4. Net weight is calculated and shown before submit
 *   5. Submit → creates Second Weight transaction, marks pair as Completed
 *
 * The backend enforces a configurable age window (default 333 days) when
 * looking for the matching First Weight transaction.
 */
import { useState, useRef } from 'react';
import { useLocation } from 'wouter';
import { useCreateTransaction, getListTransactionsQueryKey } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/use-auth';
import { AlertTriangle, CheckCircle2, Scale, WifiOff, Search } from 'lucide-react';
import LiveIndicator from '@/components/weighbridge/live-indicator';

const token = () => localStorage.getItem('sl-erp-token');

function useVehicleSearch(plate: string) {
  return useQuery({
    queryKey: ['vehicle-plate-search', plate],
    queryFn: async () => {
      const res = await fetch(`/api/commercial-weighbridge/vehicles/?search=${encodeURIComponent(plate)}`, {
        headers: { Authorization: `Token ${token()}` },
      });
      return res.json();
    },
    enabled: plate.length >= 2,
    staleTime: 30_000,
  });
}

function useWorkflowContext(vehicleId: string | number) {
  return useQuery({
    queryKey: ['workflow-context', vehicleId],
    queryFn: async () => {
      const res = await fetch(
        `/api/commercial-weighbridge/transactions/workflow-context/?vehicle_id=${vehicleId}`,
        { headers: { Authorization: `Token ${token()}` } },
      );
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: !!vehicleId,
    staleTime: 10_000,
  });
}

export default function SecondWeightPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const create = useCreateTransaction();

  // Plate search state
  const [plateInput, setPlateInput]       = useState('');
  const [showDropdown, setShowDropdown]   = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<any>(null);

  // Tare weight state
  const [manualMode, setManualMode]       = useState(false);
  const [tareWeight, setTareWeight]       = useState<number | null>(null);
  const [manualWeight, setManualWeight]   = useState('');
  const [weightReason, setWeightReason]   = useState('');

  const plateInputRef = useRef<HTMLInputElement>(null);

  const { data: searchData, isFetching: searching } = useVehicleSearch(plateInput);
  const vehicles = Array.isArray(searchData) ? searchData : searchData?.results ?? [];

  const vehicleId = selectedVehicle?.id ?? '';
  const { data: ctx, isLoading: ctxLoading } = useWorkflowContext(vehicleId);

  const firstTx   = ctx?.first_weight_transaction;
  const hasPending = ctx?.has_pending_first_weight === true;

  const operator = (user as any)?.username ?? '';
  const branchId = firstTx?.branch ?? '';

  const effectiveTare = manualMode ? parseInt(manualWeight, 10) || null : tareWeight;
  const grossWt  = firstTx?.gross_weight ?? 0;
  const netWt    = effectiveTare && grossWt ? Math.abs(grossWt - effectiveTare) : null;

  const selectVehicle = (v: any) => {
    setSelectedVehicle(v);
    setPlateInput(v.number_plate);
    setShowDropdown(false);
    setTareWeight(null);
    setManualWeight('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVehicle) { toast({ title: 'Select a vehicle plate', variant: 'destructive' }); return; }
    if (!hasPending || !firstTx) { toast({ title: 'No pending first weight for this vehicle', variant: 'destructive' }); return; }
    if (!effectiveTare || effectiveTare <= 0) {
      toast({ title: 'No tare weight captured', description: manualMode ? 'Enter a weight manually.' : 'Press Capture on the indicator.', variant: 'destructive' });
      return;
    }
    if (manualMode && !weightReason.trim()) { toast({ title: 'Reason required', variant: 'destructive' }); return; }

    const payload: Record<string, unknown> = {
      branch: firstTx.branch,
      customer: firstTx.customer,
      vehicle: selectedVehicle.id,
      vehicle_type: firstTx.vehicle_type,
      item: firstTx.item,
      weight_type: 'Second Weight',
      tare_weight: effectiveTare,
      net_weight: netWt ?? 0,
      destination: firstTx.destination ?? '',
      operator,
      payment_mode: firstTx.payment_mode,
      payment_status: firstTx.payment_status,
      paired_first_transaction: firstTx.id,
      manual_weight_capture: manualMode,
    };
    if (manualMode && weightReason) payload.weight_reason = weightReason;

    create.mutate({ data: payload as any }, {
      onSuccess: (tx: any) => {
        toast({ title: `✓ TX-${String(tx?.id ?? '').padStart(5, '0')} complete · Net: ${(netWt ?? 0).toLocaleString()} kg` });
        queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
        setLocation('/weighbridge/transactions');
      },
      onError: (err: any) => toast({ title: 'Could not log second weight', description: err?.message, variant: 'destructive' }),
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4 border-b pb-4">
        <div className="h-10 w-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
          <Scale className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Second Weight</h1>
          <p className="text-sm text-muted-foreground">Search by plate — system matches the pending first weight automatically</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* ── Step 1: Plate search ──────────────────────────────── */}
        <Card className="shadow-sm">
          <CardHeader className="bg-muted/20 border-b py-3">
            <CardTitle className="text-sm font-bold uppercase tracking-widest">1 · Number Plate</CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <div className="relative">
              <div className="flex items-center gap-2 border rounded-lg px-3 py-2 bg-background focus-within:ring-2 focus-within:ring-primary">
                <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                <input
                  ref={plateInputRef}
                  className="flex-1 bg-transparent outline-none font-mono font-bold text-lg uppercase tracking-widest placeholder:font-normal placeholder:lowercase placeholder:text-muted-foreground placeholder:tracking-normal"
                  placeholder="type plate to search…"
                  value={plateInput}
                  onChange={e => { setPlateInput(e.target.value.toUpperCase()); setShowDropdown(true); setSelectedVehicle(null); }}
                  onFocus={() => setShowDropdown(true)}
                  autoComplete="off"
                />
                {searching && <span className="text-xs text-muted-foreground animate-pulse">searching…</span>}
              </div>

              {/* Dropdown results */}
              {showDropdown && plateInput.length >= 2 && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-card border rounded-lg shadow-lg max-h-56 overflow-y-auto">
                  {vehicles.length === 0 ? (
                    <div className="p-4 text-sm text-center text-muted-foreground">No vehicles found for "{plateInput}"</div>
                  ) : vehicles.map((v: any) => (
                    <button
                      key={v.id} type="button"
                      className="w-full text-left px-4 py-3 hover:bg-muted/60 transition-colors flex items-center justify-between border-b last:border-0"
                      onClick={() => selectVehicle(v)}
                    >
                      <span className="font-mono font-bold uppercase tracking-wider">{v.number_plate}</span>
                      <span className="text-xs text-muted-foreground">{v.customer_name}{v.vehicle_type_name ? ` · ${v.vehicle_type_name}` : ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Workflow context banner ──────────────────────────── */}
        {selectedVehicle && (
          <div className={`p-4 rounded-xl border flex items-start gap-3 transition-all ${
            ctxLoading   ? 'bg-muted/30 border-border' :
            hasPending   ? 'bg-emerald-50 border-emerald-300 dark:bg-emerald-900/20 dark:border-emerald-700' :
                           'bg-orange-50 border-orange-300 dark:bg-orange-900/20 dark:border-orange-700'
          }`}>
            {ctxLoading ? (
              <div className="text-xs font-mono text-muted-foreground animate-pulse w-full">Checking for pending first weight…</div>
            ) : hasPending ? (
              <>
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="text-sm font-black text-emerald-800 dark:text-emerald-300">First weight found — ready to complete</div>
                  <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-emerald-700 dark:text-emerald-400">
                    <div><span className="opacity-70">TX</span> <span className="font-mono font-bold">TX-{String(firstTx?.id).padStart(5, '0')}</span></div>
                    <div><span className="opacity-70">Gross</span> <span className="font-mono font-bold">{firstTx?.gross_weight?.toLocaleString()} kg</span></div>
                    <div><span className="opacity-70">Customer</span> <span className="font-bold">{ctx?.customer_name}</span></div>
                    <div><span className="opacity-70">Branch</span> <span className="font-bold">{firstTx?.branch_name}</span></div>
                    {firstTx?.destination && <div className="col-span-2"><span className="opacity-70">Destination</span> <span className="font-bold">{firstTx.destination}</span></div>}
                    {firstTx?.item_name && <div><span className="opacity-70">Item</span> <span className="font-bold">{firstTx.item_name}</span></div>}
                  </div>
                </div>
              </>
            ) : (
              <>
                <AlertTriangle className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-bold text-orange-800 dark:text-orange-300">No pending first weight</div>
                  <div className="text-xs text-orange-700 dark:text-orange-400 mt-0.5">{ctx?.message ?? 'No matching first weight found within the allowed age window.'}</div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Step 2: Tare weight ──────────────────────────────── */}
        {hasPending && (
          <Card className="border-emerald-300/50 shadow-sm overflow-hidden">
            <CardHeader className="bg-emerald-50 dark:bg-emerald-900/20 border-b py-3 flex-row items-center justify-between">
              <CardTitle className="text-sm font-bold uppercase tracking-widest text-emerald-800 dark:text-emerald-300">
                2 · Capture Tare Weight
              </CardTitle>
              <button
                type="button"
                onClick={() => { setManualMode(m => !m); setTareWeight(null); setManualWeight(''); }}
                className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full border transition-colors ${
                  manualMode ? 'bg-orange-100 border-orange-300 text-orange-700' : 'bg-card border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                <WifiOff className="h-3 w-3" />
                {manualMode ? 'Manual mode ON' : 'Switch to manual'}
              </button>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
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
                    <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Reason *</label>
                    <Input value={weightReason} onChange={e => setWeightReason(e.target.value)} placeholder="e.g. Indicator offline" />
                  </div>
                </div>
              ) : (
                <LiveIndicator
                  branchId={branchId}
                  label="Tare Weight"
                  onCapture={w => setTareWeight(w)}
                  capturedWeight={tareWeight}
                />
              )}

              {/* Net weight preview */}
              {effectiveTare && grossWt > 0 && (
                <div className="p-4 rounded-xl bg-emerald-100/60 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700 text-center">
                  <div className="text-xs font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-1">Net Weight</div>
                  <div className="text-4xl font-black text-emerald-700 dark:text-emerald-300 font-mono">
                    {Math.abs(grossWt - effectiveTare).toLocaleString()} <span className="text-2xl font-bold">kg</span>
                  </div>
                  <div className="text-xs text-emerald-600/70 dark:text-emerald-500 mt-1 font-mono">
                    {grossWt.toLocaleString()} kg gross − {effectiveTare.toLocaleString()} kg tare
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {hasPending && (
          <Button
            type="submit" size="lg"
            className="w-full font-bold uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={create.isPending || !effectiveTare || !hasPending}
          >
            {create.isPending ? 'Completing…' : 'Complete Transaction — Log Second Weight'}
          </Button>
        )}
      </form>
    </div>
  );
}
