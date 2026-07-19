import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useAuth } from '@/context/use-auth';
import { useToast } from '@/hooks/use-toast';

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

type MutArgs = { url: string; method: string; body?: unknown };
function useApiMutation(
  token: string | null,
  onSuccess: (data: any) => void,
  onError: (msg: string) => void,
) {
  return useMutation<any, Error, MutArgs>({
    mutationFn: async ({ url, method, body }) => {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Token ${token}`,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const data = res.status !== 204 ? await res.json() : null;
      if (!res.ok) throw new Error(JSON.stringify(data));
      return data;
    },
    onSuccess,
    onError: (e) => onError(e.message),
  });
}
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AlertCircle, Camera, CheckCircle2, RefreshCw, Search } from 'lucide-react';
import { format } from 'date-fns';

// ── Types ─────────────────────────────────────────────────────────────────────

type Discrepancy = {
  id: number;
  overweight_event: number;
  branch: number | null;
  branch_name: string | null;
  vehicle_plate: string | null;
  net_weight: number | null;
  recorded_at: string | null;
  camera_image: string | null;
  linked_transaction: number | null;
  resolution_status: 'unresolved' | 'reviewed' | 'resolved';
  resolution_note: string;
  resolved_by: number | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  created_at: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusBadge(status: Discrepancy['resolution_status']) {
  if (status === 'resolved')   return <Badge className="text-[10px] bg-green-100 text-green-800 border-green-200 hover:bg-green-100">Resolved</Badge>;
  if (status === 'reviewed')   return <Badge variant="outline" className="text-[10px] text-blue-700 border-blue-300">Reviewed</Badge>;
  return <Badge variant="destructive" className="text-[10px]">Unresolved</Badge>;
}

function buildUrl(params: Record<string, string>) {
  const base = '/api/commercial-weighbridge/surveillance-discrepancies/';
  const qs = Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return qs ? `${base}?${qs}` : base;
}

// ── Resolve dialog ────────────────────────────────────────────────────────────

function ResolveDialog({
  disc,
  open,
  onClose,
  onSuccess,
}: {
  disc: Discrepancy | null;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { token } = useAuth();
  const { toast } = useToast();
  const [status, setStatus]   = useState<string>('');
  const [note,   setNote]     = useState('');

  const mut = useApiMutation(
    token,
    () => { toast({ title: 'Discrepancy updated' }); onSuccess(); onClose(); },
    (msg) => toast({ title: 'Error', description: msg, variant: 'destructive' }),
  );

  if (!disc) return null;

  function save() {
    if (!status) { toast({ title: 'Choose a status', variant: 'destructive' }); return; }
    mut.mutate({
      url: `/api/commercial-weighbridge/surveillance-discrepancies/${disc!.id}/`,
      method: 'PATCH',
      body: { resolution_status: status, resolution_note: note },
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Update Discrepancy #{disc.id}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="text-sm text-muted-foreground space-y-1">
            <p>Vehicle: <span className="font-medium text-foreground">{disc.vehicle_plate || '—'}</span></p>
            <p>Net weight: <span className="font-medium text-foreground">{disc.net_weight != null ? `${disc.net_weight} kg` : '—'}</span></p>
            <p>Recorded: <span className="font-medium text-foreground">{disc.recorded_at ? format(new Date(disc.recorded_at), 'dd MMM yyyy HH:mm') : '—'}</span></p>
          </div>
          <div className="space-y-1.5">
            <Label>New status *</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Select status…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unresolved">Unresolved</SelectItem>
                <SelectItem value="reviewed">Reviewed</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Note</Label>
            <Textarea
              rows={3}
              placeholder="Optional explanation or finding…"
              value={note}
              onChange={e => setNote(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={mut.isPending}>
            {mut.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Detail drawer ─────────────────────────────────────────────────────────────

function DetailDrawer({
  disc,
  open,
  onClose,
  onResolve,
}: {
  disc: Discrepancy | null;
  open: boolean;
  onClose: () => void;
  onResolve: (d: Discrepancy) => void;
}) {
  if (!disc) return null;
  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-[420px] sm:w-[480px] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-500" />
            Discrepancy #{disc.id}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-5">
          {disc.camera_image ? (
            <div className="rounded-lg overflow-hidden border">
              <img src={disc.camera_image} alt="Camera capture" className="w-full object-cover max-h-52" />
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground border rounded-lg px-4 py-3">
              <Camera className="h-4 w-4" />
              No camera image captured
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Vehicle plate"   value={disc.vehicle_plate || '—'} />
            <Field label="Net weight"      value={disc.net_weight != null ? `${disc.net_weight} kg` : '—'} />
            <Field label="Branch"          value={disc.branch_name || '—'} />
            <Field label="Overweight at"   value={disc.recorded_at ? format(new Date(disc.recorded_at), 'dd MMM yyyy HH:mm') : '—'} />
            <Field label="Transaction"     value={disc.linked_transaction ? `TX-${String(disc.linked_transaction).padStart(5, '0')}` : 'None'} />
            <Field label="Raised at"       value={format(new Date(disc.created_at), 'dd MMM yyyy HH:mm')} />
          </div>

          <div className="rounded-lg border px-4 py-3 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Resolution</p>
            <div className="flex items-center gap-2">{statusBadge(disc.resolution_status)}</div>
            {disc.resolution_note && <p className="text-sm mt-1">{disc.resolution_note}</p>}
            {disc.resolved_by_name && (
              <p className="text-xs text-muted-foreground">
                By {disc.resolved_by_name}{disc.resolved_at ? ` on ${format(new Date(disc.resolved_at), 'dd MMM yyyy HH:mm')}` : ''}
              </p>
            )}
          </div>

          {disc.resolution_status !== 'resolved' && (
            <Button className="w-full" onClick={() => onResolve(disc)}>
              <CheckCircle2 className="h-4 w-4 mr-2" /> Update status
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Discrepancies() {
  const { token } = useAuth();
  const { toast }  = useToast();
  const qc         = useQueryClient();

  const [filters, setFilters] = useState({ resolution_status: '', date_from: '', date_to: '' });
  const [applied, setApplied] = useState({ resolution_status: '', date_from: '', date_to: '' });
  const [detail,  setDetail]  = useState<Discrepancy | null>(null);
  const [resolve, setResolve] = useState<Discrepancy | null>(null);

  const url = buildUrl(applied);
  const { data: raw, isLoading, error } = useFetch<any>(url, token);
  const items: Discrepancy[] = Array.isArray(raw?.results) ? raw.results : Array.isArray(raw) ? raw : [];

  function applyFilters() { setApplied({ ...filters }); }
  function clearFilters()  {
    const blank = { resolution_status: '', date_from: '', date_to: '' };
    setFilters(blank); setApplied(blank);
  }

  function refresh() { qc.invalidateQueries({ queryKey: [url] }); }

  const checkMut = useApiMutation(
    token,
    (res: any) => {
      toast({ title: `Sweep complete — ${res?.discrepancies_raised ?? 0} new discrepancy(ies) raised` });
      refresh();
    },
    (msg) => toast({ title: 'Sweep failed', description: msg, variant: 'destructive' }),
  );

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="border-b pb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-red-500" />
            Surveillance Discrepancies
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Overweight events that exceeded the grace window without a linked transaction.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline" size="sm"
            onClick={() => checkMut.mutate({
              url: '/api/commercial-weighbridge/surveillance-discrepancies/check/',
              method: 'POST', body: {},
            })}
            disabled={checkMut.isPending}
          >
            <Search className="h-3.5 w-3.5 mr-1.5" />
            {checkMut.isPending ? 'Sweeping…' : 'Run sweep'}
          </Button>
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <Select value={filters.resolution_status || '_all'} onValueChange={v => setFilters(f => ({ ...f, resolution_status: v === '_all' ? '' : v }))}>
            <SelectTrigger className="h-8 text-sm w-36">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All</SelectItem>
              <SelectItem value="unresolved">Unresolved</SelectItem>
              <SelectItem value="reviewed">Reviewed</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
        </div>
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
        {(applied.resolution_status || applied.date_from || applied.date_to) && (
          <Button size="sm" variant="ghost" onClick={clearFilters}>Clear</Button>
        )}
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total', value: items.length },
          { label: 'Unresolved', value: items.filter(d => d.resolution_status === 'unresolved').length },
          { label: 'Resolved', value: items.filter(d => d.resolution_status === 'resolved').length },
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
              <TableHead className="text-[10px] font-bold uppercase tracking-widest">Raised</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-widest">Plate</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-widest">Branch</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-widest text-right">Net (kg)</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-widest">Image</TableHead>
              <TableHead className="text-[10px] font-bold uppercase tracking-widest">Status</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-10">Loading…</TableCell></TableRow>
            ) : error ? (
              <TableRow><TableCell colSpan={8} className="text-center text-sm text-red-500 py-10">Failed to load discrepancies.</TableCell></TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-10">No discrepancies found.</TableCell></TableRow>
            ) : items.map(d => (
              <TableRow key={d.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setDetail(d)}>
                <TableCell className="font-mono text-xs text-muted-foreground">#{d.id}</TableCell>
                <TableCell className="text-sm">{format(new Date(d.created_at), 'dd MMM yyyy HH:mm')}</TableCell>
                <TableCell className="font-medium">{d.vehicle_plate || '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{d.branch_name || '—'}</TableCell>
                <TableCell className="text-right font-semibold text-amber-700">{d.net_weight != null ? d.net_weight.toLocaleString() : '—'}</TableCell>
                <TableCell>
                  {d.camera_image
                    ? <Camera className="h-3.5 w-3.5 text-green-600" />
                    : <span className="text-muted-foreground text-xs">—</span>}
                </TableCell>
                <TableCell>{statusBadge(d.resolution_status)}</TableCell>
                <TableCell>
                  {d.resolution_status !== 'resolved' && (
                    <Button
                      size="sm" variant="outline"
                      className="h-7 text-xs px-2"
                      onClick={e => { e.stopPropagation(); setResolve(d); }}
                    >
                      Update
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <DetailDrawer
        disc={detail}
        open={!!detail}
        onClose={() => setDetail(null)}
        onResolve={(d) => { setDetail(null); setResolve(d); }}
      />
      <ResolveDialog
        disc={resolve}
        open={!!resolve}
        onClose={() => setResolve(null)}
        onSuccess={refresh}
      />
    </div>
  );
}
