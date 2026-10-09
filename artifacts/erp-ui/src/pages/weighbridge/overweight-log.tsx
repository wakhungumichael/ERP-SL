import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { AlertTriangle, Camera, Download, Link2, RefreshCw, Search } from 'lucide-react';
import { useAuth } from '@/context/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ERPFilterBar } from '@/components/erp/listing/filter-bar';
import { ERPDataTable, type ERPTableColumn } from '@/components/erp/listing/data-table';
import { ListingPagination } from '@/components/erp/listing/pagination';
import { ERPWorkspacePage } from '@/components/erp/workspace/workspace-page';
import { apiErrorFromResponse } from '@/lib/api-errors';

function useFetch<T>(url: string, token: string | null) {
  return useQuery<T>({
    queryKey: [url],
    enabled: !!token,
    queryFn: async () => {
      const res = await fetch(url, { headers: { Authorization: `Token ${token}` } });
      if (!res.ok) throw await apiErrorFromResponse(res, 'Overweight events could not be loaded.');
      return res.json() as Promise<T>;
    },
  });
}

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
  capture_source: 'transaction' | 'vehicle_presence';
  camera_image: string | null;
  discrepancy_raised: boolean;
  has_discrepancy: boolean;
  discrepancy_id: number | null;
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
  discrepancy_raised: string;
  date_from: string;
  date_to: string;
};

type OverweightDisplayRow = OverweightEvent;

function buildUrl(params: Record<string, string>) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) qs.set(key, value);
  });
  const query = qs.toString();
  return query ? `/api/commercial-weighbridge/overweight-events/?${query}` : '/api/commercial-weighbridge/overweight-events/';
}

function buildExportUrl(params: Record<string, string>) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) qs.set(key, value);
  });
  const query = qs.toString();
  return query ? `/api/commercial-weighbridge/overweight-events/export/csv/?${query}` : '/api/commercial-weighbridge/overweight-events/export/csv/';
}

function excess(event: OverweightEvent) {
  return event.net_weight - event.threshold_at_capture;
}

function statusBadge(event: OverweightEvent) {
  if (event.linked_transaction) {
    return <Badge variant="outline" className="border-green-300 text-[10px] text-green-700">Transaction linked</Badge>;
  }
  if (event.discrepancy_raised) {
    return <Badge variant="destructive" className="text-[10px]">Needs review</Badge>;
  }
  return <Badge variant="secondary" className="text-[10px]">Awaiting transaction</Badge>;
}

function Field({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-sm ${className}`}>{value}</p>
    </div>
  );
}

function EventDrawer({
  event,
  open,
  onClose,
}: {
  event: OverweightEvent | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!event) return null;

  return (
    <Sheet open={open} onOpenChange={(value) => !value && onClose()}>
      <SheetContent className="w-[420px] overflow-y-auto sm:w-[480px]">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Scale Reading #{event.id}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-5">
          {event.camera_image ? (
            <div className="overflow-hidden rounded-lg border">
              <img src={event.camera_image} alt="Camera capture" className="max-h-52 w-full object-cover" />
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border px-4 py-3 text-sm text-muted-foreground">
              <Camera className="h-4 w-4" />
              No surveillance image captured
            </div>
          )}

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
            <Field label="Excess" value={`+${excess(event)} kg`} className="font-semibold text-red-600" />
            <Field label="Vehicle plate" value={event.vehicle_plate || '—'} />
            <Field label="Branch" value={event.branch_name || '—'} />
            <Field label="Operator" value={event.operator_name || '—'} />
            <Field label="Recorded" value={format(new Date(event.recorded_at), 'dd MMM yyyy HH:mm')} />
          </div>

          <div className="flex items-start gap-3 rounded-lg border px-4 py-3">
            <Link2 className={`mt-0.5 h-4 w-4 ${event.linked_transaction ? 'text-green-600' : 'text-muted-foreground'}`} />
            <div>
              <p className="mb-0.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Transaction record</p>
              {event.linked_transaction ? (
                <p className="text-sm">TX-{String(event.linked_transaction).padStart(5, '0')} linked</p>
              ) : (
                <p className="text-sm text-muted-foreground">No transaction has been linked yet</p>
              )}
            </div>
          </div>

          {event.discrepancy_raised ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm font-medium text-red-700">Discrepancy raised</p>
              {event.discrepancy_id ? <p className="mt-0.5 text-xs text-red-500">Discrepancy #{event.discrepancy_id}</p> : null}
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function OverweightLog() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [filters, setFilters] = useState<Filters>({
    search: '',
    branch_id: '',
    discrepancy_raised: '',
    date_from: '',
    date_to: '',
  });
  const [applied, setApplied] = useState<Filters>({
    search: '',
    branch_id: '',
    discrepancy_raised: '',
    date_from: '',
    date_to: '',
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<OverweightEvent | null>(null);
  const [exporting, setExporting] = useState(false);

  const queryParams = useMemo(
    () => ({
      ...applied,
      page: String(page),
      page_size: String(pageSize),
    }),
    [applied, page, pageSize],
  );

  const url = buildUrl(queryParams);
  const { data: raw, isLoading, isFetching, error } = useFetch<PaginatedResponse<OverweightEvent>>(url, token);
  const { data: branchRaw } = useFetch<PaginatedResponse<BranchOption> | BranchOption[]>('/api/commercial-weighbridge/branches/?page_size=200', token);

  const events = raw?.results ?? [];
  const branches = Array.isArray(branchRaw) ? branchRaw : branchRaw?.results ?? [];
  const totalCount = raw?.count ?? events.length;

  const counts = useMemo(() => ({
    total: totalCount,
    discrepancy: events.filter((event) => event.discrepancy_raised && !event.linked_transaction).length,
    withImage: events.filter((event) => event.camera_image).length,
  }), [events, totalCount]);

  async function handleExportCsv() {
    if (!token) return;
    setExporting(true);
    try {
      const exportUrl = buildExportUrl(applied);
      const res = await fetch(exportUrl, { headers: { Authorization: `Token ${token}` } });
      if (!res.ok) throw await apiErrorFromResponse(res, 'The overweight event could not be updated.');
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = 'overweight_events.csv';
      link.click();
      URL.revokeObjectURL(href);
    } catch (err) {
      console.error('CSV export failed', err);
      toast({
        title: 'Export failed',
        description: 'Unable to export overweight events right now.',
        variant: 'destructive',
      });
    } finally {
      setExporting(false);
    }
  }

  function applyFilters() {
    setApplied({ ...filters, search: filters.search.trim() });
    setPage(1);
  }

  function clearFilters() {
    const empty = {
      search: '',
      branch_id: '',
      discrepancy_raised: '',
      date_from: '',
      date_to: '',
    };
    setFilters(empty);
    setApplied(empty);
    setPage(1);
  }

  function refresh() {
    qc.invalidateQueries({ queryKey: [url] });
  }

  const hasFilters = Boolean(
    applied.search || applied.branch_id || applied.discrepancy_raised || applied.date_from || applied.date_to,
  );

  const columns: ERPTableColumn<OverweightDisplayRow>[] = [
    {
      key: 'id',
      label: 'ID',
      headerClassName: 'text-[10px] font-bold uppercase tracking-widest',
      cellClassName: 'font-mono text-xs text-muted-foreground',
      render: (event) => `#${event.id}`,
    },
    {
      key: 'recorded_at',
      label: 'Recorded',
      headerClassName: 'text-[10px] font-bold uppercase tracking-widest',
      cellClassName: 'text-sm',
      render: (event) => format(new Date(event.recorded_at), 'dd MMM yyyy HH:mm'),
    },
    {
      key: 'vehicle_plate',
      label: 'Plate',
      headerClassName: 'text-[10px] font-bold uppercase tracking-widest',
      cellClassName: 'font-medium',
      render: (event) => event.vehicle_plate || '—',
    },
    {
      key: 'branch_name',
      label: 'Branch',
      headerClassName: 'text-[10px] font-bold uppercase tracking-widest',
      cellClassName: 'text-sm text-muted-foreground',
      render: (event) => event.branch_name || '—',
    },
    {
      key: 'net_weight',
      label: 'Net (kg)',
      headerClassName: 'text-right text-[10px] font-bold uppercase tracking-widest',
      cellClassName: 'text-right font-semibold text-amber-700',
      render: (event) => event.net_weight.toLocaleString(),
    },
    {
      key: 'threshold_at_capture',
      label: 'Threshold',
      headerClassName: 'text-right text-[10px] font-bold uppercase tracking-widest',
      cellClassName: 'text-right text-sm text-muted-foreground',
      render: (event) => event.threshold_at_capture.toLocaleString(),
    },
    {
      key: 'excess',
      label: 'Excess',
      headerClassName: 'text-right text-[10px] font-bold uppercase tracking-widest',
      cellClassName: 'text-right font-semibold text-red-600',
      render: (event) => `+${excess(event).toLocaleString()}`,
    },
    {
      key: 'camera_image',
      label: 'Image',
      headerClassName: 'text-[10px] font-bold uppercase tracking-widest',
      render: (event) => event.camera_image ? <Camera className="h-3.5 w-3.5 text-green-600" /> : <span className="text-xs text-muted-foreground">—</span>,
    },
    {
      key: 'status',
      label: 'Status',
      headerClassName: 'text-[10px] font-bold uppercase tracking-widest',
      render: (event) => statusBadge(event),
    },
  ];

  return (
    <ERPWorkspacePage
      title={(
        <span className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          Scale Surveillance Log
        </span>
      )}
      description="Audit scale readings at or above each branch threshold. A reading only needs review when no weighbridge transaction is linked after the configured grace window."
      actions={(
        <>
          <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={exporting}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            {exporting ? 'Exporting…' : 'Export CSV'}
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
              placeholder="Search plate, branch, or operator…"
            />
          </>
        )}
        filterSlot={(
          <>
            <Select
              value={filters.branch_id || '__all__'}
              onValueChange={(value) => setFilters((current) => ({ ...current, branch_id: value === '__all__' ? '' : value }))}
            >
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
              value={filters.discrepancy_raised || '__all__'}
              onValueChange={(value) => setFilters((current) => ({ ...current, discrepancy_raised: value === '__all__' ? '' : value }))}
            >
              <SelectTrigger className="h-8 w-[170px] text-sm">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All statuses</SelectItem>
                <SelectItem value="true">Discrepancy raised</SelectItem>
                <SelectItem value="false">No discrepancy</SelectItem>
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
          { label: 'Scale readings', value: counts.total },
          { label: 'Needs review on this page', value: counts.discrepancy },
          { label: 'Readings with images', value: counts.withImage },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border px-4 py-3">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className="text-2xl font-bold">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <ERPDataTable
          columns={columns}
          rows={events}
          loading={isLoading}
          loadingLabel="Loading scale readings…"
          emptyState={error ? 'Failed to load scale readings.' : 'No scale readings found.'}
          onRowClick={(event) => setSelected(event)}
          rowActions={(event) => (
            <Button
              variant="outline"
              size="sm"
              onClick={(uiEvent) => {
                uiEvent.stopPropagation();
                setSelected(event);
              }}
            >
              Open
            </Button>
          )}
        />
        <ListingPagination
          page={page}
          pageSize={pageSize}
          totalCount={totalCount}
          onPage={setPage}
          onPageSize={setPageSize}
        />
      </div>

      {isFetching && !isLoading ? (
        <p className="text-xs text-muted-foreground">Refreshing scale readings…</p>
      ) : null}

      <EventDrawer event={selected} open={!!selected} onClose={() => setSelected(null)} />
    </ERPWorkspacePage>
  );
}
