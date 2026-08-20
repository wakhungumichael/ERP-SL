import { useMemo, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useAuth } from '@/context/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AlertCircle, Camera, CheckCircle2, RefreshCw, Search } from 'lucide-react';
import { format } from 'date-fns';
import { ERPFilterBar } from '@/components/erp/listing/filter-bar';
import { ERPDataTable, type ERPTableColumn } from '@/components/erp/listing/data-table';
import { ListingPagination } from '@/components/erp/listing/pagination';
import { ERPWorkspacePage } from '@/components/erp/workspace/workspace-page';

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
    onError: (error) => onError(error.message),
  });
}

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

type BranchOption = {
  id: number;
  name: string;
};

type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

type Filters = {
  search: string;
  branch_id: string;
  resolution_status: string;
  date_from: string;
  date_to: string;
};

const PAGE_SIZE_OPTIONS = ['10', '25', '50'];
type DiscrepancyDisplayRow = Discrepancy;

function statusBadge(status: Discrepancy['resolution_status']) {
  if (status === 'resolved') return <Badge className="border-green-200 bg-green-100 text-[10px] text-green-800 hover:bg-green-100">Resolved</Badge>;
  if (status === 'reviewed') return <Badge variant="outline" className="border-blue-300 text-[10px] text-blue-700">Reviewed</Badge>;
  return <Badge variant="destructive" className="text-[10px]">Unresolved</Badge>;
}

function buildUrl(params: Record<string, string>) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) qs.set(key, value);
  });
  const query = qs.toString();
  return query ? `/api/commercial-weighbridge/surveillance-discrepancies/?${query}` : '/api/commercial-weighbridge/surveillance-discrepancies/';
}

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
  const [status, setStatus] = useState<string>('');
  const [note, setNote] = useState('');

  const mut = useApiMutation(
    token,
    () => {
      toast({ title: 'Discrepancy updated' });
      onSuccess();
      onClose();
    },
    (msg) => toast({ title: 'Error', description: msg, variant: 'destructive' }),
  );

  if (!disc) return null;
  const discrepancy = disc;

  function save() {
    if (!status) {
      toast({ title: 'Choose a status', variant: 'destructive' });
      return;
    }
    mut.mutate({
      url: `/api/commercial-weighbridge/surveillance-discrepancies/${discrepancy.id}/`,
      method: 'PATCH',
      body: { resolution_status: status, resolution_note: note },
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          setStatus('');
          setNote('');
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Update Discrepancy #{disc.id}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1 text-sm text-muted-foreground">
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
              onChange={(event) => setNote(event.target.value)}
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

function DetailDrawer({
  disc,
  open,
  onClose,
  onResolve,
}: {
  disc: Discrepancy | null;
  open: boolean;
  onClose: () => void;
  onResolve: (disc: Discrepancy) => void;
}) {
  if (!disc) return null;
  return (
    <Sheet open={open} onOpenChange={(value) => !value && onClose()}>
      <SheetContent className="w-[420px] overflow-y-auto sm:w-[480px]">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-500" />
            Discrepancy #{disc.id}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-5">
          {disc.camera_image ? (
            <div className="overflow-hidden rounded-lg border">
              <img src={disc.camera_image} alt="Camera capture" className="max-h-52 w-full object-cover" />
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border px-4 py-3 text-sm text-muted-foreground">
              <Camera className="h-4 w-4" />
              No camera image captured
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Vehicle plate" value={disc.vehicle_plate || '—'} />
            <Field label="Net weight" value={disc.net_weight != null ? `${disc.net_weight} kg` : '—'} />
            <Field label="Branch" value={disc.branch_name || '—'} />
            <Field label="Recorded at" value={disc.recorded_at ? format(new Date(disc.recorded_at), 'dd MMM yyyy HH:mm') : '—'} />
            <Field label="Transaction" value={disc.linked_transaction ? `TX-${String(disc.linked_transaction).padStart(5, '0')}` : 'None'} />
            <Field label="Raised at" value={format(new Date(disc.created_at), 'dd MMM yyyy HH:mm')} />
          </div>

          <div className="space-y-1 rounded-lg border px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Resolution</p>
            <div className="flex items-center gap-2">{statusBadge(disc.resolution_status)}</div>
            {disc.resolution_note && <p className="mt-1 text-sm">{disc.resolution_note}</p>}
            {disc.resolved_by_name && (
              <p className="text-xs text-muted-foreground">
                By {disc.resolved_by_name}{disc.resolved_at ? ` on ${format(new Date(disc.resolved_at), 'dd MMM yyyy HH:mm')}` : ''}
              </p>
            )}
          </div>

          {disc.resolution_status !== 'resolved' && (
            <Button className="w-full" onClick={() => onResolve(disc)}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Update status
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

export default function Discrepancies() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [filters, setFilters] = useState<Filters>({
    search: '',
    branch_id: '',
    resolution_status: '',
    date_from: '',
    date_to: '',
  });
  const [applied, setApplied] = useState<Filters>({
    search: '',
    branch_id: '',
    resolution_status: '',
    date_from: '',
    date_to: '',
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState('25');
  const [detail, setDetail] = useState<Discrepancy | null>(null);
  const [resolve, setResolve] = useState<Discrepancy | null>(null);

  const queryParams = useMemo(
    () => ({
      ...applied,
      page: String(page),
      page_size: pageSize,
    }),
    [applied, page, pageSize],
  );

  const url = buildUrl(queryParams);
  const { data: raw, isLoading, isFetching, error } = useFetch<PaginatedResponse<Discrepancy>>(url, token);
  const { data: branchRaw } = useFetch<PaginatedResponse<BranchOption> | BranchOption[]>('/api/commercial-weighbridge/branches/?page_size=200', token);

  const items = raw?.results ?? [];
  const branches = Array.isArray(branchRaw) ? branchRaw : branchRaw?.results ?? [];
  const totalCount = raw?.count ?? items.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / Number(pageSize || '25')));

  const counts = useMemo(() => ({
    total: totalCount,
    unresolved: items.filter((item) => item.resolution_status === 'unresolved').length,
    resolved: items.filter((item) => item.resolution_status === 'resolved').length,
  }), [items, totalCount]);

  function applyFilters() {
    setApplied({ ...filters, search: filters.search.trim() });
    setPage(1);
  }

  function clearFilters() {
    const blank = {
      search: '',
      branch_id: '',
      resolution_status: '',
      date_from: '',
      date_to: '',
    };
    setFilters(blank);
    setApplied(blank);
    setPage(1);
  }

  function refresh() {
    qc.invalidateQueries({ queryKey: [url] });
  }

  const hasFilters = Boolean(
    applied.search || applied.branch_id || applied.resolution_status || applied.date_from || applied.date_to,
  );

  const columns: ERPTableColumn<DiscrepancyDisplayRow>[] = [
    {
      key: 'id',
      label: 'ID',
      headerClassName: 'text-[10px] font-bold uppercase tracking-widest',
      cellClassName: 'font-mono text-xs text-muted-foreground',
      render: (disc) => `#${disc.id}`,
    },
    {
      key: 'created_at',
      label: 'Raised',
      headerClassName: 'text-[10px] font-bold uppercase tracking-widest',
      cellClassName: 'text-sm',
      render: (disc) => format(new Date(disc.created_at), 'dd MMM yyyy HH:mm'),
    },
    {
      key: 'vehicle_plate',
      label: 'Plate',
      headerClassName: 'text-[10px] font-bold uppercase tracking-widest',
      cellClassName: 'font-medium',
      render: (disc) => disc.vehicle_plate || '—',
    },
    {
      key: 'branch_name',
      label: 'Branch',
      headerClassName: 'text-[10px] font-bold uppercase tracking-widest',
      cellClassName: 'text-sm text-muted-foreground',
      render: (disc) => disc.branch_name || '—',
    },
    {
      key: 'net_weight',
      label: 'Net (kg)',
      headerClassName: 'text-right text-[10px] font-bold uppercase tracking-widest',
      cellClassName: 'text-right font-semibold text-amber-700',
      render: (disc) => disc.net_weight != null ? disc.net_weight.toLocaleString() : '—',
    },
    {
      key: 'camera_image',
      label: 'Image',
      headerClassName: 'text-[10px] font-bold uppercase tracking-widest',
      render: (disc) => disc.camera_image ? <Camera className="h-3.5 w-3.5 text-green-600" /> : <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      key: 'resolution_status',
      label: 'Status',
      headerClassName: 'text-[10px] font-bold uppercase tracking-widest',
      render: (disc) => statusBadge(disc.resolution_status),
    },
  ];

  const checkMut = useApiMutation(
    token,
    (res: any) => {
      toast({ title: `Sweep complete - ${res?.discrepancies_raised ?? 0} new discrepancy(ies) raised` });
      refresh();
    },
    (msg) => toast({ title: 'Sweep failed', description: msg, variant: 'destructive' }),
  );

  return (
    <ERPWorkspacePage
      title={(
        <span className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-red-500" />
          Surveillance Discrepancies
        </span>
      )}
      description="Vehicle presence events that passed the grace window without a linked transaction."
      actions={(
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => checkMut.mutate({
              url: '/api/commercial-weighbridge/surveillance-discrepancies/check/',
              method: 'POST',
              body: {},
            })}
            disabled={checkMut.isPending}
          >
            <Search className="mr-1.5 h-3.5 w-3.5" />
            {checkMut.isPending ? 'Sweeping…' : 'Run sweep'}
          </Button>
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
        </>
      )}
    >
      <ERPFilterBar
        searchSlot={(
          <>
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input
              className="h-8 border-0 shadow-none focus-visible:ring-0"
              value={filters.search}
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applyFilters();
              }}
              placeholder="Search plate, branch, notes, or users…"
            />
          </>
        )}
        filterSlot={(
          <>
            <Select value={filters.branch_id || '__all__'} onValueChange={(value) => setFilters((current) => ({ ...current, branch_id: value === '__all__' ? '' : value }))}>
              <SelectTrigger className="h-8 w-[170px] text-sm">
                <SelectValue placeholder="All branches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All branches</SelectItem>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={String(branch.id)}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.resolution_status || '__all__'}
              onValueChange={(value) => setFilters((current) => ({ ...current, resolution_status: value === '__all__' ? '' : value }))}
            >
              <SelectTrigger className="h-8 w-[150px] text-sm">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All statuses</SelectItem>
                <SelectItem value="unresolved">Unresolved</SelectItem>
                <SelectItem value="reviewed">Reviewed</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>

            <Input
              type="date"
              className="h-8 w-[160px] text-sm"
              value={filters.date_from}
              onChange={(event) => setFilters((current) => ({ ...current, date_from: event.target.value }))}
            />

            <Input
              type="date"
              className="h-8 w-[160px] text-sm"
              value={filters.date_to}
              onChange={(event) => setFilters((current) => ({ ...current, date_to: event.target.value }))}
            />
          </>
        )}
        toolsSlot={(
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={applyFilters}>Apply</Button>
            {hasFilters ? (
              <Button size="sm" variant="ghost" onClick={clearFilters}>Clear</Button>
            ) : null}
          </div>
        )}
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {[
          { label: 'Total discrepancies', value: counts.total },
          { label: 'Unresolved on this page', value: counts.unresolved },
          { label: 'Resolved on this page', value: counts.resolved },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border px-4 py-3">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className="text-2xl font-bold">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border">
        <ERPDataTable
          columns={columns}
          rows={items}
          loading={isLoading}
          loadingLabel="Loading discrepancies…"
          emptyState={error ? 'Failed to load discrepancies.' : 'No discrepancies found.'}
          rowActions={(disc) => (
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setDetail(disc)}>
                Open
              </Button>
              {disc.resolution_status !== 'resolved' ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={() => setResolve(disc)}
                >
                  Update
                </Button>
              ) : null}
            </div>
          )}
        />
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <div className="text-sm text-muted-foreground">
          Showing page {page} of {totalPages} with {totalCount} total discrepancies
          {isFetching && !isLoading ? ' • refreshing…' : ''}
        </div>
        <ListingPagination
          page={page}
          pageSize={Number(pageSize || '25')}
          totalCount={totalCount}
          onPage={setPage}
          onPageSize={(value) => { if (PAGE_SIZE_OPTIONS.includes(String(value))) { setPageSize(String(value)); setPage(1); } }}
        />
      </div>

      <DetailDrawer
        disc={detail}
        open={!!detail}
        onClose={() => setDetail(null)}
        onResolve={(disc) => {
          setDetail(null);
          setResolve(disc);
        }}
      />
      <ResolveDialog
        disc={resolve}
        open={!!resolve}
        onClose={() => setResolve(null)}
        onSuccess={refresh}
      />
    </ERPWorkspacePage>
  );
}
