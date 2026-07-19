import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/use-auth';

function useFetch<T>(url: string, token: string | null) {
  return useQuery<T>({
    queryKey: [url],
    enabled: !!token,
    queryFn: async () => {
      const res = await fetch(url, { headers: { Authorization: `Token ${token}` } });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<T>;
    },
  });
}
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AlertTriangle, Camera, Link2, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';

// ── Types ─────────────────────────────────────────────────────────────────────

type OverweightEvent = {
  id: number;
  branch: number | null;
  branch_name: string | null;
  vehicle_plate: string;
  gross_weight: number | null;
  tare_weight: number | null;
  net_weight: number;
  threshold_at_capture: number;
  recorded_at: string;
  operator_name: string | null;
  linked_transaction: number | null;
  camera_image: string | null;
  discrepancy_raised: boolean;
  has_discrepancy: boolean;
  discrepancy_id: number | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildUrl(params: Record<string, string>) {
  const base = '/api/commercial-weighbridge/overweight-events/';
  const qs = Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return qs ? `${base}?${qs}` : base;
}

function excess(event: OverweightEvent) {
  return event.net_weight - event.threshold_at_capture;
}

// ── Detail drawer ─────────────────────────────────────────────────────────────

function EventDrawer({ event, open, onClose }: { event: OverweightEvent | null; open: boolean; onClose: () => void }) {
  if (!event) return null;
  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-[420px] sm:w-[480px] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Overweight Event #{event.id}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-5">
          {/* Camera image */}
          {event.camera_image ? (
            <div className="rounded-lg overflow-hidden border">
              <img
                src={event.camera_image}
                alt="Camera capture"
                className="w-full object-cover max-h-52"
              />
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground border rounded-lg px-4 py-3">
              <Camera className="h-4 w-4" />
              No camera image captured
            </div>
          )}

          {/* Weights */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Gross', value: event.gross_weight },
              { label: 'Tare', value: event.tare_weight },
              { label: 'Net', value: event.net_weight, highlight: true },
            ].map(({ label, value, highlight }) => (
              <div key={label} className={`rounded-lg border px-3 py-2 text-center ${highlight ? 'border-amber-300 bg-amber-50' : ''}`}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
                <p className={`text-lg font-bold ${highlight ? 'text-amber-700' : ''}`}>
                  {value != null ? `${value} kg` : '—'}
                </p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Threshold" value={`${event.threshold_at_capture} kg`} />
            <Field label="Excess" value={`+${excess(event)} kg`} className="text-red-600 font-semibold" />
            <Field label="Vehicle plate" value={event.vehicle_plate || '—'} />
            <Field label="Branch" value={event.branch_name || '—'} />
            <Field label="Operator" value={event.operator_name || '—'} />
            <Field label="Recorded" value={format(new Date(event.recorded_at), 'dd MMM yyyy HH:mm')} />
          </div>

          {/* Transaction link */}
          <div className="rounded-lg border px-4 py-3 flex items-start gap-3">
            <Link2 className={`h-4 w-4 mt-0.5 ${event.linked_transaction ? 'text-green-600' : 'text-muted-foreground'}`} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Transaction</p>
              {event.linked_transaction ? (
                <p className="text-sm">TX-{String(event.linked_transaction).padStart(5, '0')} linked</p>
              ) : (
                <p className="text-sm text-muted-foreground">No transaction linked</p>
              )}
            </div>
          </div>

          {event.discrepancy_raised && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm font-medium text-red-700">Discrepancy raised</p>
              {event.discrepancy_id && (
                <p className="text-xs text-red-500 mt-0.5">Discrepancy #{event.discrepancy_id}</p>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-sm ${className}`}>{value}</p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OverweightLog() {
  const { token } = useAuth();
  const qc = useQueryClient();

  const [filters, setFilters] = useState({ date_from: '', date_to: '' });
  const [applied, setApplied] = useState({ date_from: '', date_to: '' });
  const [selected, setSelected] = useState<OverweightEvent | null>(null);

  const url = buildUrl(applied);
  const { data: raw, isLoading, error } = useFetch<any>(url, token);
  const events: OverweightEvent[] = Array.isArray(raw?.results) ? raw.results : Array.isArray(raw) ? raw : [];

  function applyFilters() { setApplied({ ...filters }); }
  function clearFilters()  { setFilters({ date_from: '', date_to: '' }); setApplied({ date_from: '', date_to: '' }); }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="border-b pb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Overweight Log
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            All weighbridge events where the recorded weight met or exceeded the branch threshold.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: [url] })}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <Input type="date" className="h-8 text-sm w-36"
            value={filters.date_from}
            onChange={e => setFilters(f => ({ ...f, date_from: e.target.value }))}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Input type="date" className="h-8 text-sm w-36"
            value={filters.date_to}
            onChange={e => setFilters(f => ({ ...f, date_to: e.target.value }))}
          />
        </div>
        <Button size="sm" onClick={applyFilters}>Apply</Button>
        {(applied.date_from || applied.date_to) && (
          <Button size="sm" variant="ghost" onClick={clearFilters}>Clear</Button>
        )}
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total events', value: events.length },
          { label: 'With discrepancy', value: events.filter(e => e.discrepancy_raised).length },
          { label: 'With image', value: events.filter(e => e.camera_image).length },
        ].map(s => (
          <div key={s.label} className="rounded-lg border px-4 py-3">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="text-2xl font-bold">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-[10px] font-bold uppercase tracking-widest">ID</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-widest">Recorded</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-widest">Plate</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-widest">Branch</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-widest text-right">Net (kg)</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-widest text-right">Threshold</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-widest text-right">Excess</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-widest">Image</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-widest">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-10">Loading…</TableCell></TableRow>
            ) : error ? (
              <TableRow><TableCell colSpan={9} className="text-center text-sm text-red-500 py-10">Failed to load events.</TableCell></TableRow>
            ) : events.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-10">No overweight events found.</TableCell></TableRow>
            ) : events.map(ev => (
              <TableRow key={ev.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setSelected(ev)}>
                <TableCell className="font-mono text-xs text-muted-foreground">#{ev.id}</TableCell>
                <TableCell className="text-sm">{format(new Date(ev.recorded_at), 'dd MMM yyyy HH:mm')}</TableCell>
                <TableCell className="font-medium">{ev.vehicle_plate || '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{ev.branch_name || '—'}</TableCell>
                <TableCell className="text-right font-semibold text-amber-700">{ev.net_weight.toLocaleString()}</TableCell>
                <TableCell className="text-right text-sm text-muted-foreground">{ev.threshold_at_capture.toLocaleString()}</TableCell>
                <TableCell className="text-right font-semibold text-red-600">+{excess(ev).toLocaleString()}</TableCell>
                <TableCell>
                  {ev.camera_image
                    ? <Camera className="h-3.5 w-3.5 text-green-600" />
                    : <span className="text-muted-foreground text-xs">—</span>}
                </TableCell>
                <TableCell>
                  {ev.discrepancy_raised
                    ? <Badge variant="destructive" className="text-[10px]">Discrepancy</Badge>
                    : ev.linked_transaction
                      ? <Badge variant="outline" className="text-[10px] text-green-700 border-green-300">Linked</Badge>
                      : <Badge variant="secondary" className="text-[10px]">Unlinked</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <EventDrawer event={selected} open={!!selected} onClose={() => setSelected(null)} />
    </div>
  );
}
