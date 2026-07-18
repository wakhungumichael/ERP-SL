import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Link } from 'wouter';
import { useAuth } from '@/context/use-auth';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Plus, Search, Scale, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight, Printer, SlidersHorizontal, CalendarRange, X,
  GripVertical, Download, CheckCircle2, RotateCcw, DollarSign,
} from 'lucide-react';
import { CAN_APPROVE, CAN_RECALL, CAN_EXPORT, CAN_RECEIVE_PAYMENT } from '@/lib/roles';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { ReceiptDialog, type ReceiptTransaction } from '@/components/weighbridge/receipt';

// ── Types & constants ─────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  Pending:   'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400',
  Completed: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400',
  Paid:      'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400',
};

interface ColDef {
  key: string;
  label: string;
  render: (t: any) => React.ReactNode;
  width?: string;
  align?: 'left' | 'right' | 'center';
}

const ALL_COLUMNS: ColDef[] = [
  {
    key: 'id', label: 'TxID',
    render: t => (
      <Link href={`/weighbridge/transactions/${t.id}`}
        className="text-primary hover:underline font-mono font-bold text-xs">
        {String(t.id).padStart(5, '0')}
      </Link>
    ),
    width: '70px',
  },
  { key: 'vehicle_plate',     label: 'Vehicle',       render: t => <span className="font-mono font-bold text-xs">{t.vehicle_plate}</span> },
  { key: 'customer_name',     label: 'Customer',      render: t => <span className="font-medium text-sm">{t.customer_name}</span> },
  { key: 'branch_name',       label: 'Branch',        render: t => <span className="text-xs text-muted-foreground">{t.branch_name ?? '—'}</span> },
  { key: 'item_name',         label: 'Item',          render: t => <span className="text-xs uppercase tracking-wide text-muted-foreground">{t.item_name || '—'}</span> },
  { key: 'vehicle_type_name', label: 'Veh. Type',     render: t => <span className="text-xs text-muted-foreground">{t.vehicle_type_name || '—'}</span> },
  {
    key: 'weight_type', label: 'Type',
    render: t => (
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase border ${
        t.weight_type === 'First Weight'
          ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400'
          : 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-400'
      }`}>
        {t.weight_type === 'First Weight' ? '1ST' : t.weight_type === 'Second Weight' ? '2ND' : t.weight_type}
      </span>
    ),
    align: 'center', width: '60px',
  },
  { key: 'gross_weight', label: 'Gross (kg)', render: t => <span className="font-mono text-xs text-right block">{t.gross_weight ? Number(t.gross_weight).toLocaleString() : '—'}</span>, align: 'right' },
  { key: 'tare_weight',  label: 'Tare (kg)',  render: t => <span className="font-mono text-xs text-right block">{t.tare_weight  ? Number(t.tare_weight).toLocaleString()  : '—'}</span>, align: 'right' },
  { key: 'net_weight',   label: 'Net (kg)',   render: t => <span className={`font-mono font-bold text-xs text-right block ${t.net_weight ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>{t.net_weight ? Number(t.net_weight).toLocaleString() : '—'}</span>, align: 'right' },
  { key: 'charge',       label: 'Charge',     render: t => <span className="font-mono text-xs text-right block">{t.charge ? `KES ${Number(t.charge).toLocaleString()}` : '—'}</span>, align: 'right' },
  { key: 'destination',  label: 'Destination', render: t => <span className="text-xs text-muted-foreground">{t.destination || '—'}</span> },
  { key: 'payment_mode', label: 'Pay. Mode',  render: t => <span className="text-xs">{t.payment_mode || '—'}</span> },
  {
    key: 'status', label: 'Status',
    render: t => (
      <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase border ${STATUS_COLORS[t.status] ?? 'bg-secondary border-border'}`}>
        {t.status}
      </span>
    ),
    align: 'center',
  },
  {
    key: 'payment_status', label: 'Payment',
    render: t => (
      <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase border ${STATUS_COLORS[t.payment_status] ?? 'bg-orange-100 text-orange-800 border-orange-200'}`}>
        {t.payment_status || 'Pending'}
      </span>
    ),
    align: 'center',
  },
  { key: 'operator', label: 'Operator', render: t => <span className="text-xs text-muted-foreground">{t.operator || '—'}</span> },
  { key: 'gross_weight_date', label: 'First Wt. Date', render: t => <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">{t.gross_weight_date ? new Date(t.gross_weight_date).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}</span> },
  { key: 'tare_weight_date',  label: 'Second Wt. Date', render: t => <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">{t.tare_weight_date  ? new Date(t.tare_weight_date).toLocaleString('en-KE',  { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}</span> },
  { key: 'created_at', label: 'Created', render: t => <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">{t.created_at ? new Date(t.created_at).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}</span> },
  { key: 'updated_at', label: 'Updated', render: t => <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">{t.updated_at ? new Date(t.updated_at).toLocaleString('en-KE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}</span> },
];

const DEFAULT_COL_KEYS = ['id','vehicle_plate','customer_name','item_name','weight_type','net_weight','charge','status','payment_status'];
const STORAGE_COL_KEY = 'sl-erp-tx-columns';

function loadColumns(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_COL_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}
  return DEFAULT_COL_KEYS;
}

function saveColumns(keys: string[]) {
  try { localStorage.setItem(STORAGE_COL_KEY, JSON.stringify(keys)); } catch {}
}

// ── Column picker popover ─────────────────────────────────────────────────────

function ColumnPicker({ visibleKeys, onChange }: { visibleKeys: string[]; onChange: (keys: string[]) => void }) {
  const dragIndex = useRef<number | null>(null);

  const toggle = (key: string) => {
    if (visibleKeys.includes(key)) {
      if (visibleKeys.length <= 2) return; // always keep at least 2
      onChange(visibleKeys.filter(k => k !== key));
    } else {
      onChange([...visibleKeys, key]);
    }
  };

  const handleDragStart = (i: number) => { dragIndex.current = i; };
  const handleDragOver  = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    if (dragIndex.current === null || dragIndex.current === i) return;
    const next = [...visibleKeys];
    const [moved] = next.splice(dragIndex.current, 1);
    next.splice(i, 0, moved);
    dragIndex.current = i;
    onChange(next);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 text-xs font-medium h-8">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Columns
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-bold">{visibleKeys.length}</Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="end">
        <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">
          Columns — drag to reorder
        </div>
        {/* Visible columns (draggable) */}
        <div className="space-y-0.5 mb-3">
          {visibleKeys.map((key, i) => {
            const col = ALL_COLUMNS.find(c => c.key === key);
            if (!col) return null;
            return (
              <div
                key={key}
                draggable
                onDragStart={() => handleDragStart(i)}
                onDragOver={e => handleDragOver(e, i)}
                className="flex items-center gap-2 px-2 py-1.5 rounded bg-muted/40 cursor-grab active:cursor-grabbing hover:bg-muted/60 transition-colors"
              >
                <GripVertical className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                <span className="flex-1 text-xs font-medium">{col.label}</span>
                <button
                  onClick={() => toggle(key)}
                  className="h-4 w-4 flex items-center justify-center rounded-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
        {/* Hidden columns */}
        <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground/60 mb-1.5">Add columns</div>
        <div className="space-y-0.5 max-h-48 overflow-y-auto">
          {ALL_COLUMNS.filter(c => !visibleKeys.includes(c.key)).map(col => (
            <button
              key={col.key}
              onClick={() => toggle(col.key)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <Plus className="h-3 w-3 shrink-0" />
              {col.label}
            </button>
          ))}
        </div>
        <div className="mt-3 pt-2 border-t flex justify-between">
          <button onClick={() => onChange(DEFAULT_COL_KEYS)} className="text-[10px] text-muted-foreground hover:text-foreground">Reset</button>
          <button onClick={() => onChange(ALL_COLUMNS.map(c => c.key))} className="text-[10px] text-muted-foreground hover:text-foreground">Show all</button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Date/time filter popover ──────────────────────────────────────────────────

const DATE_FIELDS = [
  { value: 'created_at',        label: 'Created (First Weight)' },
  { value: 'gross_weight_date', label: 'Gross Weight Date' },
  { value: 'tare_weight_date',  label: 'Tare Weight Date (2nd)' },
  { value: 'updated_at',        label: 'Last Updated' },
];

interface DateFilter {
  dateField: string;
  dateFrom: string;
  dateTo: string;
  timeFrom: string;
  timeTo: string;
}

function DateRangeFilter({ value, onChange }: { value: DateFilter; onChange: (v: DateFilter) => void }) {
  const hasFilter = value.dateFrom || value.dateTo;

  const set = (patch: Partial<DateFilter>) => onChange({ ...value, ...patch });

  const clear = () => onChange({ dateField: 'created_at', dateFrom: '', dateTo: '', timeFrom: '', timeTo: '' });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant={hasFilter ? 'default' : 'outline'} size="sm" className="gap-2 text-xs h-8 font-medium">
          <CalendarRange className="h-3.5 w-3.5" />
          Date Range
          {hasFilter && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-bold bg-white/20 text-white">active</Badge>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4" align="start">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Date Range Filter</div>
            {hasFilter && (
              <button onClick={clear} className="text-[10px] text-muted-foreground hover:text-destructive flex items-center gap-1">
                <X className="h-3 w-3" /> Clear
              </button>
            )}
          </div>

          {/* Date field selector */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Filter by</label>
            <Select value={value.dateField} onValueChange={v => set({ dateField: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DATE_FIELDS.map(f => <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Date range */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">From date</label>
              <Input type="date" value={value.dateFrom} onChange={e => set({ dateFrom: e.target.value })} className="h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">To date</label>
              <Input type="date" value={value.dateTo} onChange={e => set({ dateTo: e.target.value })} className="h-8 text-xs" />
            </div>
          </div>

          {/* Time range */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">From time</label>
              <Input type="time" value={value.timeFrom} onChange={e => set({ timeFrom: e.target.value })} className="h-8 text-xs font-mono" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">To time</label>
              <Input type="time" value={value.timeTo} onChange={e => set({ timeTo: e.target.value })} className="h-8 text-xs font-mono" />
            </div>
          </div>

          {/* Quick presets */}
          <div className="flex flex-wrap gap-1.5 pt-1 border-t">
            {[
              { label: 'Today', fn: () => { const d = new Date().toISOString().slice(0,10); set({ dateFrom: d, dateTo: d, timeFrom: '', timeTo: '' }); } },
              { label: 'This week', fn: () => {
                const now = new Date();
                const mon = new Date(now); mon.setDate(now.getDate() - now.getDay() + 1);
                set({ dateFrom: mon.toISOString().slice(0,10), dateTo: now.toISOString().slice(0,10), timeFrom: '', timeTo: '' });
              }},
              { label: 'This month', fn: () => {
                const now = new Date();
                const first = new Date(now.getFullYear(), now.getMonth(), 1);
                set({ dateFrom: first.toISOString().slice(0,10), dateTo: now.toISOString().slice(0,10), timeFrom: '', timeTo: '' });
              }},
            ].map(p => (
              <button key={p.label} onClick={p.fn}
                className="text-[10px] px-2 py-1 rounded border border-border hover:bg-muted transition-colors font-medium">
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Pagination control ────────────────────────────────────────────────────────

function Pagination({
  page, pageSize, totalCount, onPage, onPageSize,
}: {
  page: number; pageSize: number; totalCount: number;
  onPage: (p: number) => void; onPageSize: (n: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to   = Math.min(page * pageSize, totalCount);

  // page window
  const pages: (number | '…')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push('…');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push('…');
    pages.push(totalPages);
  }

  return (
    <div className="flex items-center justify-between gap-4 px-1 py-2 border-t bg-card rounded-b-lg">
      {/* Record info + page size */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="hidden sm:inline font-mono">
          {totalCount === 0 ? 'No records' : `${from}–${to} of ${totalCount.toLocaleString()}`}
        </span>
        <Select value={String(pageSize)} onValueChange={v => { onPageSize(Number(v)); onPage(1); }}>
          <SelectTrigger className="h-7 w-28 text-xs border-muted">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[10, 25, 50, 100].map(n => (
              <SelectItem key={n} value={String(n)} className="text-xs">{n} per page</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Page buttons */}
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === 1} onClick={() => onPage(1)} title="First page">
          <ChevronsLeft className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === 1} onClick={() => onPage(page - 1)} title="Previous">
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>

        {pages.map((p, i) =>
          p === '…' ? (
            <span key={`ellipsis-${i}`} className="px-1.5 text-xs text-muted-foreground">…</span>
          ) : (
            <Button
              key={p}
              variant={p === page ? 'default' : 'outline'}
              size="icon"
              className="h-7 w-7 text-xs font-mono"
              onClick={() => onPage(p as number)}
            >
              {p}
            </Button>
          )
        )}

        <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === totalPages} onClick={() => onPage(page + 1)} title="Next">
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === totalPages} onClick={() => onPage(totalPages)} title="Last page">
          <ChevronsRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ── Quick Pay Popover ─────────────────────────────────────────────────────────

const PAYMENT_METHODS = ['Cash', 'Mpesa', 'Bank Deposit', 'Debt'];

function QuickPayPopover({
  tx, token, onPaid,
}: {
  tx: any;
  token: string | null;
  onPaid: () => void;
}) {
  const [open, setOpen]         = useState(false);
  const [method, setMethod]     = useState('Cash');
  const [reference, setReference] = useState('');
  const [loading, setLoading]   = useState(false);
  const { toast }               = useToast();

  const canPay = tx.status === 'Completed' && tx.payment_status !== 'Paid';
  if (!canPay) return null;

  const handleConfirm = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/commercial-weighbridge/transactions/${tx.id}/receive-payment/`,
        {
          method: 'POST',
          headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ method, reference }),
        },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? res.statusText);
      toast({ title: 'Payment recorded', description: `TX-${String(tx.id).padStart(5, '0')} marked as Paid.` });
      setOpen(false);
      setReference('');
      setMethod('Cash');
      onPaid();
    } catch (err: any) {
      toast({ title: 'Payment failed', description: err?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          title="Receive payment"
          className="inline-flex items-center justify-center h-6 w-6 rounded hover:bg-emerald-50 text-emerald-600 hover:text-emerald-700 dark:hover:bg-emerald-900/20 transition-colors"
        >
          <DollarSign className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-4" align="end" side="left">
        <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
          Receive Payment — TX-{String(tx.id).padStart(5, '0')}
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map(m => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Reference</Label>
            <Input
              placeholder="e.g. MPE-12345"
              value={reference}
              onChange={e => setReference(e.target.value)}
              className="h-8 text-xs font-mono"
              onKeyDown={e => { if (e.key === 'Enter') handleConfirm(); }}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs h-8"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="flex-1 text-xs h-8 bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
              disabled={loading}
              onClick={handleConfirm}
            >
              {loading
                ? <span className="h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
                : <CheckCircle2 className="h-3 w-3" />}
              {loading ? 'Saving…' : 'Confirm'}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TransactionsList() {
  const { token, role } = useAuth();

  // Filters
  const [search, setSearch]               = useState('');
  const [status, setStatus]               = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [weightType, setWeightType]       = useState('');
  const [dateFilter, setDateFilter]       = useState<DateFilter>({
    dateField: 'created_at', dateFrom: '', dateTo: '', timeFrom: '', timeTo: '',
  });

  // Pagination
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Column picker
  const [visibleKeys, setVisibleKeys] = useState<string[]>(loadColumns);
  const handleColumnsChange = useCallback((keys: string[]) => {
    setVisibleKeys(keys);
    saveColumns(keys);
  }, []);

  // Receipt
  const [receiptTx, setReceiptTx]     = useState<ReceiptTransaction | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  // Row-level workflow actions (approve / recall)
  const [actingOn, setActingOn] = useState<Record<number, 'approve' | 'recall' | null>>({});
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Search debounce
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 380);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  // Reset page on filter change
  useEffect(() => { setPage(1); }, [status, paymentStatus, weightType, dateFilter]);

  // Build query params
  const params = useMemo(() => {
    const p: Record<string, string> = {
      page: String(page),
      page_size: String(pageSize),
    };
    if (status)             p.status         = status;
    if (paymentStatus)      p.payment_status  = paymentStatus;
    if (weightType)         p.weight_type     = weightType;
    if (debouncedSearch)    p.search          = debouncedSearch;
    if (dateFilter.dateFrom) {
      p.date_field = dateFilter.dateField;
      p.date_from  = dateFilter.dateFrom;
      if (dateFilter.timeFrom) p.time_from = dateFilter.timeFrom;
    }
    if (dateFilter.dateTo) {
      p.date_field = dateFilter.dateField;
      p.date_to    = dateFilter.dateTo;
      if (dateFilter.timeTo)  p.time_to   = dateFilter.timeTo;
    }
    return p;
  }, [page, pageSize, status, paymentStatus, weightType, debouncedSearch, dateFilter]);

  const qk = ['transactions', params];
  const { data, isLoading } = useQuery({
    queryKey: qk,
    queryFn: async () => {
      const qs = new URLSearchParams(params).toString();
      const res = await fetch(`/api/commercial-weighbridge/transactions/?${qs}`, {
        headers: { Authorization: `Token ${token}` },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: !!token,
    staleTime: 30_000,
    placeholderData: (prev: any) => prev,
  });

  const rows: any[]  = data?.results ?? [];
  const totalCount   = data?.count ?? 0;
  const visibleCols  = ALL_COLUMNS.filter(c => visibleKeys.includes(c.key)).sort((a, b) => visibleKeys.indexOf(a.key) - visibleKeys.indexOf(b.key));

  const hasDateFilter = dateFilter.dateFrom || dateFilter.dateTo;
  const activeFilterCount = [status, paymentStatus, weightType, hasDateFilter ? '1' : ''].filter(Boolean).length;

  // ── Workflow actions (defined after params so closure is safe) ────────────────

  const runAction = useCallback(async (txId: number, action: 'approve' | 'recall') => {
    setActingOn(prev => ({ ...prev, [txId]: action }));
    try {
      const res = await fetch(`/api/commercial-weighbridge/transactions/${txId}/${action}/`, {
        method: 'POST',
        headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? res.statusText);
      toast({
        title: action === 'approve' ? 'Transaction approved' : 'Transaction recalled',
        description: action === 'approve' ? 'Record marked approved.' : 'Transaction set back to Pending.',
      });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    } catch (err: any) {
      toast({ title: 'Action failed', description: err?.message, variant: 'destructive' });
    } finally {
      setActingOn(prev => { const n = { ...prev }; delete n[txId]; return n; });
    }
  }, [token, toast, queryClient]);

  const handleExportCSV = useCallback(() => {
    const qs = new URLSearchParams(params);
    qs.delete('page');
    qs.delete('page_size');
    const url = `/api/commercial-weighbridge/transactions/export/csv/?${qs.toString()}`;
    fetch(url, { headers: { Authorization: `Token ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.setAttribute('download', 'transactions.csv');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      })
      .catch(() => toast({ title: 'Export failed', variant: 'destructive' }));
  }, [params, token, toast]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Transaction Log</h1>
          {totalCount > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5 font-mono">
              {totalCount.toLocaleString()} total records
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Link href="/weighbridge/first-weight">
            <Button variant="outline" size="sm" className="gap-1.5 font-bold uppercase tracking-wide text-xs">
              <Scale className="h-3.5 w-3.5" /> First Weight
            </Button>
          </Link>
          <Link href="/weighbridge/second-weight">
            <Button variant="outline" size="sm" className="gap-1.5 font-bold uppercase tracking-wide text-xs">
              <Scale className="h-3.5 w-3.5" /> Second Weight
            </Button>
          </Link>
          {CAN_EXPORT.includes(role) && (
            <Button variant="outline" size="sm" className="gap-1.5 font-bold uppercase tracking-wide text-xs" onClick={handleExportCSV}>
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
          )}
          <CreateTransactionDialog onCreated={() => setPage(1)} />
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-card border rounded-lg shadow-sm">
        {/* Primary filters row */}
        <div className="flex flex-wrap items-center gap-0 divide-x divide-border">
          {/* Status */}
          <div className="flex items-center px-3 py-2 min-w-[140px]">
            <Select value={status} onValueChange={v => setStatus(v === '__all__' ? '' : v)}>
              <SelectTrigger className="h-8 border-0 shadow-none focus:ring-0 text-xs font-medium">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__" className="text-xs">All Statuses</SelectItem>
                <SelectItem value="Pending" className="text-xs">Pending</SelectItem>
                <SelectItem value="Completed" className="text-xs">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Payment */}
          <div className="flex items-center px-3 py-2 min-w-[140px]">
            <Select value={paymentStatus} onValueChange={v => setPaymentStatus(v === '__all__' ? '' : v)}>
              <SelectTrigger className="h-8 border-0 shadow-none focus:ring-0 text-xs font-medium">
                <SelectValue placeholder="All Payments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__" className="text-xs">All Payments</SelectItem>
                <SelectItem value="Pending" className="text-xs">Pending</SelectItem>
                <SelectItem value="Paid" className="text-xs">Paid</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Weight type */}
          <div className="flex items-center px-3 py-2 min-w-[130px]">
            <Select value={weightType} onValueChange={v => setWeightType(v === '__all__' ? '' : v)}>
              <SelectTrigger className="h-8 border-0 shadow-none focus:ring-0 text-xs font-medium">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__" className="text-xs">All Types</SelectItem>
                <SelectItem value="First Weight" className="text-xs">First Weight</SelectItem>
                <SelectItem value="Second Weight" className="text-xs">Second Weight</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-2 flex-1 min-w-[200px]">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              placeholder="Search plate, customer, operator…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 font-mono"
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Toolbar buttons */}
          <div className="flex items-center gap-2 px-3 py-2">
            <DateRangeFilter value={dateFilter} onChange={setDateFilter} />
            <ColumnPicker visibleKeys={visibleKeys} onChange={handleColumnsChange} />
            {activeFilterCount > 0 && (
              <Button
                variant="ghost" size="sm"
                className="h-8 text-xs text-muted-foreground hover:text-destructive gap-1"
                onClick={() => { setStatus(''); setPaymentStatus(''); setWeightType(''); setDateFilter({ dateField: 'created_at', dateFrom: '', dateTo: '', timeFrom: '', timeTo: '' }); setSearch(''); }}
              >
                <X className="h-3 w-3" /> Clear filters
                <Badge variant="secondary" className="text-[10px] px-1 py-0">{activeFilterCount}</Badge>
              </Button>
            )}
          </div>
        </div>

        {/* Active filter pills */}
        {(hasDateFilter || status || paymentStatus || weightType) && (
          <div className="flex flex-wrap gap-1.5 px-3 pb-2 pt-0 border-t">
            {status && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide bg-muted px-2 py-0.5 rounded-full border">
                Status: {status}
                <button onClick={() => setStatus('')}><X className="h-2.5 w-2.5" /></button>
              </span>
            )}
            {paymentStatus && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide bg-muted px-2 py-0.5 rounded-full border">
                Payment: {paymentStatus}
                <button onClick={() => setPaymentStatus('')}><X className="h-2.5 w-2.5" /></button>
              </span>
            )}
            {weightType && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide bg-muted px-2 py-0.5 rounded-full border">
                Type: {weightType === 'First Weight' ? '1st' : '2nd'}
                <button onClick={() => setWeightType('')}><X className="h-2.5 w-2.5" /></button>
              </span>
            )}
            {hasDateFilter && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide bg-muted px-2 py-0.5 rounded-full border">
                {DATE_FIELDS.find(f => f.value === dateFilter.dateField)?.label}: {dateFilter.dateFrom}{dateFilter.dateFrom && dateFilter.dateTo ? ' → ' : ''}{dateFilter.dateTo}
                {dateFilter.timeFrom || dateFilter.timeTo ? ` (${dateFilter.timeFrom || '00:00'}–${dateFilter.timeTo || '23:59'})` : ''}
                <button onClick={() => setDateFilter(prev => ({ ...prev, dateFrom: '', dateTo: '', timeFrom: '', timeTo: '' }))}>
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                {visibleCols.map(col => (
                  <TableHead
                    key={col.key}
                    style={{ width: col.width }}
                    className={`text-[10px] font-bold uppercase tracking-widest whitespace-nowrap ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}`}
                  >
                    {col.label}
                  </TableHead>
                ))}
                {/* Action columns always visible */}
                <TableHead className="w-8 text-center text-[10px] font-bold uppercase tracking-widest">Rcpt</TableHead>
                {(CAN_APPROVE.includes(role) || CAN_RECALL.includes(role) || CAN_RECEIVE_PAYMENT.includes(role)) && (
                  <TableHead className="text-center text-[10px] font-bold uppercase tracking-widest whitespace-nowrap">Actions</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: pageSize > 10 ? 8 : 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {visibleCols.map(c => (
                      <TableCell key={c.key}>
                        <div className="h-4 bg-muted/60 rounded animate-pulse" style={{ width: c.width ? parseInt(c.width) - 8 : 80 }} />
                      </TableCell>
                    ))}
                    <TableCell />
                  </TableRow>
                ))
              ) : rows.length ? (
                rows.map(t => (
                  <TableRow key={t.id} className="hover:bg-muted/30 transition-colors">
                    {visibleCols.map(col => (
                      <TableCell
                        key={col.key}
                        className={`py-2 ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}`}
                      >
                        {col.render(t)}
                      </TableCell>
                    ))}
                    {/* Receipt */}
                    <TableCell className="text-center py-2">
                      <button
                        onClick={() => { setReceiptTx(t); setReceiptOpen(true); }}
                        title="Print receipt"
                        className="inline-flex items-center justify-center h-6 w-6 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Printer className="h-3.5 w-3.5" />
                      </button>
                    </TableCell>
                    {/* Workflow + payment actions */}
                    {(CAN_APPROVE.includes(role) || CAN_RECALL.includes(role) || CAN_RECEIVE_PAYMENT.includes(role)) && (
                      <TableCell className="text-center py-2">
                        <div className="flex items-center justify-center gap-1">
                          {CAN_APPROVE.includes(role) && !t.approval_status && t.status === 'Pending' && (
                            <button
                              onClick={() => runAction(t.id, 'approve')}
                              disabled={!!actingOn[t.id]}
                              title="Approve manual weight"
                              className="inline-flex items-center justify-center h-6 w-6 rounded hover:bg-emerald-50 text-emerald-600 hover:text-emerald-700 dark:hover:bg-emerald-900/20 transition-colors disabled:opacity-40"
                            >
                              {actingOn[t.id] === 'approve'
                                ? <span className="h-3 w-3 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin inline-block" />
                                : <CheckCircle2 className="h-3.5 w-3.5" />}
                            </button>
                          )}
                          {CAN_RECALL.includes(role) && t.status === 'Completed' && (
                            <button
                              onClick={() => runAction(t.id, 'recall')}
                              disabled={!!actingOn[t.id]}
                              title="Recall transaction"
                              className="inline-flex items-center justify-center h-6 w-6 rounded hover:bg-amber-50 text-amber-600 hover:text-amber-700 dark:hover:bg-amber-900/20 transition-colors disabled:opacity-40"
                            >
                              {actingOn[t.id] === 'recall'
                                ? <span className="h-3 w-3 rounded-full border-2 border-amber-500 border-t-transparent animate-spin inline-block" />
                                : <RotateCcw className="h-3.5 w-3.5" />}
                            </button>
                          )}
                          {CAN_RECEIVE_PAYMENT.includes(role) && (
                            <QuickPayPopover
                              tx={t}
                              token={token}
                              onPaid={() => queryClient.invalidateQueries({ queryKey: ['transactions'] })}
                            />
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={visibleCols.length + 1} className="text-center py-16 font-mono text-sm text-muted-foreground">
                    No matching transaction records.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        <Pagination
          page={page}
          pageSize={pageSize}
          totalCount={totalCount}
          onPage={setPage}
          onPageSize={setPageSize}
        />
      </div>

      {/* Receipt dialog */}
      <ReceiptDialog
        transaction={receiptTx}
        open={receiptOpen}
        onOpenChange={setReceiptOpen}
        token={token}
      />
    </div>
  );
}

// ── Create Transaction Dialog ─────────────────────────────────────────────────

function CreateTransactionDialog({ onCreated }: { onCreated?: () => void }) {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [branchId, setBranchId]         = useState('');
  const [customerId, setCustomerId]     = useState('');
  const [vehicleId, setVehicleId]       = useState('');
  const [itemId, setItemId]             = useState('');
  const [vehicleTypeId, setVehicleTypeId] = useState('');
  const [weightType, setWeightType]     = useState<'First Weight' | 'Second Weight'>('First Weight');
  const [grossWeight, setGrossWeight]   = useState('');
  const [destination, setDestination]   = useState('');
  const [paymentMode, setPaymentMode]   = useState('Cash');
  const [paymentStatus, setPaymentStatus] = useState('Pending');
  const [manualCapture, setManualCapture] = useState(false);
  const [weightReason, setWeightReason] = useState('');
  const [submitting, setSubmitting]     = useState(false);

  const fetchList = async (url: string) => {
    const res = await fetch(url, { headers: { Authorization: `Token ${token}` } });
    const json = await res.json();
    return Array.isArray(json) ? json : json?.results ?? [];
  };

  const { data: branches = [] }  = useQuery({ queryKey: ['dlg-branches'], queryFn: () => fetchList('/api/commercial-weighbridge/branches/'), enabled: open });
  const { data: customers = [] } = useQuery({ queryKey: ['dlg-customers'], queryFn: () => fetchList('/api/commercial-weighbridge/customers/?search='), enabled: open });
  const { data: vehicles = [] }  = useQuery({ queryKey: ['dlg-vehicles', customerId], queryFn: () => fetchList(`/api/commercial-weighbridge/vehicles/${customerId ? `?customer_id=${customerId}` : ''}`), enabled: open && !!customerId });
  const { data: itemsRaw }       = useQuery({ queryKey: ['dlg-items'], queryFn: () => fetchList('/api/commercial-weighbridge/items/'), enabled: open });
  const items = Array.isArray(itemsRaw) ? itemsRaw : (itemsRaw as any)?.results ?? [];

  const reset = () => {
    setBranchId(''); setCustomerId(''); setVehicleId(''); setItemId('');
    setVehicleTypeId(''); setWeightType('First Weight'); setGrossWeight('');
    setDestination(''); setPaymentMode('Cash'); setPaymentStatus('Pending');
    setManualCapture(false); setWeightReason('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchId || !customerId || !vehicleId) {
      toast({ title: 'Missing fields', description: 'Branch, customer and vehicle are required.', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    const payload: Record<string, unknown> = {
      branch: +branchId, customer: +customerId, vehicle: +vehicleId,
      weight_type: weightType, payment_mode: paymentMode, payment_status: paymentStatus,
      destination, manual_weight_capture: manualCapture,
    };
    if (itemId)          payload.item         = +itemId;
    if (vehicleTypeId)   payload.vehicle_type = +vehicleTypeId;
    if (grossWeight)     payload.gross_weight = +grossWeight;
    if (manualCapture && weightReason) payload.weight_reason = weightReason;

    try {
      const res = await fetch('/api/commercial-weighbridge/transactions/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Token ${token}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: 'Transaction logged successfully' });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      onCreated?.();
      setOpen(false);
      reset();
    } catch (err: any) {
      toast({ title: 'Could not log transaction', description: err?.message ?? 'Check required fields.', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5 font-bold uppercase tracking-wide text-xs">
          <Plus className="h-3.5 w-3.5" /> New Transaction
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[540px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-bold uppercase tracking-widest text-sm">Log Transaction</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">

          {/* Weight type toggle */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Weight Type</label>
            <div className="flex rounded-md overflow-hidden border border-border">
              {(['First Weight', 'Second Weight'] as const).map(wt => (
                <button key={wt} type="button" onClick={() => setWeightType(wt)}
                  className={`flex-1 py-2 text-xs font-bold uppercase tracking-wide transition-colors ${weightType === wt ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}>
                  {wt}
                </button>
              ))}
            </div>
          </div>

          {/* Branch */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Branch *</label>
            <Select value={branchId} onValueChange={setBranchId} required>
              <SelectTrigger><SelectValue placeholder="Select branch…" /></SelectTrigger>
              <SelectContent>
                {(branches as any[]).map((b: any) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Customer */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Customer *</label>
            <Select value={customerId} onValueChange={v => { setCustomerId(v); setVehicleId(''); }}>
              <SelectTrigger><SelectValue placeholder="Select customer…" /></SelectTrigger>
              <SelectContent>
                {(customers as any[]).map((c: any) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Vehicle */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Vehicle *</label>
            <Select value={vehicleId} onValueChange={v => {
              setVehicleId(v);
              const veh = (vehicles as any[]).find((x: any) => String(x.id) === v);
              if (veh?.vehicle_type) setVehicleTypeId(String(veh.vehicle_type));
            }} disabled={!customerId}>
              <SelectTrigger><SelectValue placeholder={customerId ? 'Select vehicle…' : 'Select customer first'} /></SelectTrigger>
              <SelectContent>
                {(vehicles as any[]).map((v: any) => (
                  <SelectItem key={v.id} value={String(v.id)}>
                    {v.number_plate}{v.vehicle_type_name ? ` — ${v.vehicle_type_name}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Item */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Item / Commodity</label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger><SelectValue placeholder="Select item (optional)" /></SelectTrigger>
              <SelectContent>
                {(items as any[]).map((i: any) => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Weight + destination */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                {weightType === 'First Weight' ? 'Gross Weight (kg)' : 'Tare Weight (kg)'}
              </label>
              <Input type="number" min={0} placeholder="e.g. 12500" value={grossWeight}
                onChange={e => setGrossWeight(e.target.value)} className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Destination</label>
              <Input placeholder="e.g. Nairobi CBD" value={destination} onChange={e => setDestination(e.target.value)} />
            </div>
          </div>

          {/* Payment */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Payment Mode</label>
              <Select value={paymentMode} onValueChange={setPaymentMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['Cash', 'Mpesa', 'Bank Deposit', 'Debt'].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Payment Status</label>
              <Select value={paymentStatus} onValueChange={setPaymentStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Pending">Pending</SelectItem>
                  <SelectItem value="Paid">Paid</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Manual capture */}
          <div className="flex items-center gap-3 p-3 rounded-md bg-muted/40 border border-border">
            <input type="checkbox" id="manual_capture" checked={manualCapture}
              onChange={e => setManualCapture(e.target.checked)} className="h-4 w-4 accent-primary" />
            <label htmlFor="manual_capture" className="text-sm font-medium cursor-pointer">
              Manual weight capture (indicator offline)
            </label>
          </div>

          {manualCapture && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Weight Reason *</label>
              <Input placeholder="Reason for manual capture…" value={weightReason}
                onChange={e => setWeightReason(e.target.value)} required={manualCapture} />
            </div>
          )}

          <Button type="submit" className="w-full font-bold uppercase tracking-widest" disabled={submitting}>
            {submitting ? 'Logging…' : 'Log Transaction'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
