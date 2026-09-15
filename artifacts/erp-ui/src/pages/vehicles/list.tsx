import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useAuth } from '@/context/use-auth';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Plus, Search, Truck, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  X, SlidersHorizontal, GripVertical,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

async function fetchList(url: string, token: string | null) {
  const res = await fetch(url, { headers: { Authorization: `Token ${token}` } });
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  return res.json();
}

interface VehicleColumn {
  key: string;
  label: string;
  width?: string;
  render: (vehicle: any) => React.ReactNode;
}

const ALL_COLUMNS: VehicleColumn[] = [
  {
    key: 'id',
    label: 'ID',
    width: '72px',
    render: (vehicle: any) => <span className="font-mono text-xs font-bold">{String(vehicle.id).padStart(4, '0')}</span>,
  },
  {
    key: 'number_plate',
    label: 'Plate Reg.',
    render: (vehicle: any) => (
      <div className="inline-block rounded border-2 border-zinc-400 bg-zinc-200 px-3 py-1 font-mono text-sm font-black uppercase tracking-wider text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100">
        {vehicle.number_plate}
      </div>
    ),
  },
  {
    key: 'customer_name',
    label: 'Customer',
    render: (vehicle: any) => <span className="text-sm font-semibold">{vehicle.customer_name || '—'}</span>,
  },
  {
    key: 'vehicle_type_name',
    label: 'Class Type',
    render: (vehicle: any) => (
      <span className="inline-flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        <Truck className="h-4 w-4" />
        {vehicle.vehicle_type_name || 'Unclassified'}
      </span>
    ),
  },
  {
    key: 'is_active',
    label: 'Status',
    width: '110px',
    render: (vehicle: any) => (
      <span className={`inline-flex rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
        vehicle.is_active
          ? 'border-emerald-200 bg-emerald-100 text-emerald-800'
          : 'border-slate-200 bg-slate-100 text-slate-700'
      }`}>
        {vehicle.is_active ? 'Active' : 'Inactive'}
      </span>
    ),
  },
  {
    key: 'customer',
    label: 'Customer ID',
    width: '96px',
    render: (vehicle: any) => <span className="font-mono text-xs text-muted-foreground">{vehicle.customer ?? '—'}</span>,
  },
  {
    key: 'vehicle_type',
    label: 'Type ID',
    width: '88px',
    render: (vehicle: any) => <span className="font-mono text-xs text-muted-foreground">{vehicle.vehicle_type ?? '—'}</span>,
  },
] as const;

const DEFAULT_COL_KEYS = ['id', 'number_plate', 'customer_name', 'vehicle_type_name', 'is_active'];
const STORAGE_COL_KEY = 'sl-erp-vehicle-columns';
const BULK_ACTIONS = [
  { value: 'activate', label: 'Activate Selected' },
  { value: 'deactivate', label: 'Deactivate Selected' },
] as const;

type BulkAction = (typeof BULK_ACTIONS)[number]['value'];

function loadColumns(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_COL_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}
  return DEFAULT_COL_KEYS;
}

function saveColumns(keys: string[]) {
  try {
    localStorage.setItem(STORAGE_COL_KEY, JSON.stringify(keys));
  } catch {}
}

function ColumnPicker({ visibleKeys, onChange }: { visibleKeys: string[]; onChange: (keys: string[]) => void }) {
  const dragIndex = useRef<number | null>(null);

  const toggle = (key: string) => {
    if (visibleKeys.includes(key)) {
      if (visibleKeys.length <= 2) return;
      onChange(visibleKeys.filter((entry) => entry !== key));
    } else {
      onChange([...visibleKeys, key]);
    }
  };

  const handleDragStart = (index: number) => {
    dragIndex.current = index;
  };

  const handleDragOver = (event: React.DragEvent, index: number) => {
    event.preventDefault();
    if (dragIndex.current === null || dragIndex.current === index) return;
    const next = [...visibleKeys];
    const [moved] = next.splice(dragIndex.current, 1);
    next.splice(index, 0, moved);
    dragIndex.current = index;
    onChange(next);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-2 text-xs font-medium">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Columns
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-bold">{visibleKeys.length}</Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="end">
        <div className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Columns — drag to reorder
        </div>
        <div className="mb-3 space-y-0.5">
          {visibleKeys.map((key, index) => {
            const column = ALL_COLUMNS.find((entry) => entry.key === key);
            if (!column) return null;
            return (
              <div
                key={key}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(event) => handleDragOver(event, index)}
                className="flex cursor-grab items-center gap-2 rounded bg-muted/40 px-2 py-1.5 transition-colors hover:bg-muted/60 active:cursor-grabbing"
              >
                <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                <span className="flex-1 text-xs font-medium">{column.label}</span>
                <button
                  type="button"
                  onClick={() => toggle(key)}
                  className="flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
        <div className="mb-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground/60">Add columns</div>
        <div className="max-h-48 space-y-0.5 overflow-y-auto">
          {ALL_COLUMNS.filter((column) => !visibleKeys.includes(column.key)).map((column) => (
            <button
              key={column.key}
              type="button"
              onClick={() => toggle(column.key)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Plus className="h-3 w-3 shrink-0" />
              {column.label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex justify-between border-t pt-2">
          <button type="button" onClick={() => onChange(DEFAULT_COL_KEYS)} className="text-[10px] text-muted-foreground hover:text-foreground">Reset</button>
          <button type="button" onClick={() => onChange(ALL_COLUMNS.map((column) => column.key))} className="text-[10px] text-muted-foreground hover:text-foreground">Show all</button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Pagination({
  page,
  pageSize,
  totalCount,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  totalCount: number;
  onPage: (page: number) => void;
  onPageSize: (pageSize: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);
  const pages: (number | '…')[] = [];

  if (totalPages <= 7) {
    for (let index = 1; index <= totalPages; index += 1) pages.push(index);
  } else {
    pages.push(1);
    if (page > 3) pages.push('…');
    for (let index = Math.max(2, page - 1); index <= Math.min(totalPages - 1, page + 1); index += 1) pages.push(index);
    if (page < totalPages - 2) pages.push('…');
    pages.push(totalPages);
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-b-lg border-t bg-card px-1 py-2">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="hidden font-mono sm:inline">
          {totalCount === 0 ? 'No records' : `${from}–${to} of ${totalCount.toLocaleString()}`}
        </span>
        <Select
          value={String(pageSize)}
          onValueChange={(value) => {
            onPageSize(Number(value));
            onPage(1);
          }}
        >
          <SelectTrigger className="h-7 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[10, 25, 50, 100].map((option) => (
              <SelectItem key={option} value={String(option)} className="text-xs">{option} per page</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === 1} onClick={() => onPage(1)}>
          <ChevronsLeft className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        {pages.map((entry, index) => (
          entry === '…' ? (
            <span key={`ellipsis-${index}`} className="px-1.5 text-xs text-muted-foreground">…</span>
          ) : (
            <Button
              key={entry}
              variant={entry === page ? 'default' : 'outline'}
              size="icon"
              className="h-7 w-7 text-xs font-mono"
              onClick={() => onPage(entry)}
            >
              {entry}
            </Button>
          )
        ))}
        <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === totalPages} onClick={() => onPage(page + 1)}>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === totalPages} onClick={() => onPage(totalPages)}>
          <ChevronsRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export default function VehiclesList() {
  const { token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [customerId, setCustomerId] = useState('');
  const [vehicleTypeId, setVehicleTypeId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [visibleKeys, setVisibleKeys] = useState<string[]>(loadColumns);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkAction, setBulkAction] = useState<BulkAction | ''>('');
  const [bulkRunning, setBulkRunning] = useState(false);

  const handleColumnsChange = useCallback((keys: string[]) => {
    setVisibleKeys(keys);
    saveColumns(keys);
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 380);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [customerId, statusFilter, vehicleTypeId]);

  const params = useMemo(() => {
    const query = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    });
    if (debouncedSearch) query.set('search', debouncedSearch);
    if (customerId) query.set('customer_id', customerId);
    if (vehicleTypeId) query.set('vehicle_type_id', vehicleTypeId);
    if (statusFilter) query.set('is_active', statusFilter);
    return query;
  }, [customerId, debouncedSearch, page, pageSize, statusFilter, vehicleTypeId]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['vehicles-page', token, params.toString()],
    enabled: !!token,
    queryFn: () => fetchList(`/api/commercial-weighbridge/vehicles/?${params.toString()}`, token),
    staleTime: 30_000,
    placeholderData: (prev: any) => prev,
  });

  const { data: customersRaw = [] } = useQuery({
    queryKey: ['vehicle-filter-customers', token],
    enabled: !!token,
    queryFn: async () => {
      const json = await fetchList('/api/commercial-weighbridge/customers/?page_size=200', token);
      return Array.isArray(json) ? json : json?.results ?? [];
    },
    staleTime: 300_000,
  });

  const { data: vehicleTypesRaw = [] } = useQuery({
    queryKey: ['vehicle-filter-types', token],
    enabled: !!token,
    queryFn: async () => {
      const json = await fetchList('/api/commercial-weighbridge/vehicle-types/?page_size=200', token);
      return Array.isArray(json) ? json : json?.results ?? [];
    },
    staleTime: 300_000,
  });

  const rows: any[] = Array.isArray(data) ? data : data?.results ?? [];
  const totalCount = Array.isArray(data) ? data.length : data?.count ?? 0;
  const visibleColumns = ALL_COLUMNS.filter((column) => visibleKeys.includes(column.key)).sort((a, b) => visibleKeys.indexOf(a.key) - visibleKeys.indexOf(b.key));
  const selectedRowSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedRows = useMemo(() => rows.filter((row) => selectedRowSet.has(row.id)), [rows, selectedRowSet]);
  const allPageIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const allPageSelected = allPageIds.length > 0 && allPageIds.every((id) => selectedRowSet.has(id));
  const somePageSelected = allPageIds.some((id) => selectedRowSet.has(id));

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => allPageIds.includes(id)));
  }, [allPageIds]);

  const toggleSelected = useCallback((vehicleId: number, checked: boolean) => {
    setSelectedIds((current) => (
      checked ? Array.from(new Set([...current, vehicleId])) : current.filter((id) => id !== vehicleId)
    ));
  }, []);

  const toggleSelectAllPage = useCallback((checked: boolean) => {
    setSelectedIds(checked ? allPageIds : []);
  }, [allPageIds]);

  const activeFilterCount = [customerId, vehicleTypeId, statusFilter, debouncedSearch].filter(Boolean).length;
  const eligibleRowsByAction = useMemo(() => ({
    activate: selectedRows.filter((row) => !row.is_active),
    deactivate: selectedRows.filter((row) => !!row.is_active),
  }), [selectedRows]);
  const canBulkRun = bulkAction === 'activate'
    ? eligibleRowsByAction.activate.length > 0 && !bulkRunning
    : bulkAction === 'deactivate'
      ? eligibleRowsByAction.deactivate.length > 0 && !bulkRunning
      : false;

  const updateVehicleStatus = useCallback(async (vehicleId: number, isActive: boolean) => {
    const init: RequestInit = {
      method: 'PATCH',
      headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: isActive }),
    };
    const patchResponse = await fetch(`/api/commercial-weighbridge/vehicles/${vehicleId}/`, init);
    if (!patchResponse.ok) {
      const body = await patchResponse.json().catch(() => ({}));
      throw new Error(body?.error ?? body?.detail ?? patchResponse.statusText);
    }
  }, [token]);

  useEffect(() => {
    if (!bulkAction) return;
    if (!canBulkRun) setBulkAction('');
  }, [bulkAction, canBulkRun]);

  const runBulkAction = useCallback(async () => {
    if (!bulkAction || selectedRows.length === 0) return;

    const eligibleRows = bulkAction === 'activate' ? eligibleRowsByAction.activate : eligibleRowsByAction.deactivate;
    if (eligibleRows.length === 0) {
      toast({ title: 'No eligible records', description: 'The selected vehicles do not match the chosen action.', variant: 'destructive' });
      return;
    }

    setBulkRunning(true);
    let successCount = 0;
    let failedCount = 0;

    for (const row of eligibleRows) {
      try {
        await updateVehicleStatus(row.id, bulkAction === 'activate');
        successCount += 1;
      } catch {
        failedCount += 1;
      }
    }

    setBulkRunning(false);
    setSelectedIds([]);
    setBulkAction('');
    queryClient.invalidateQueries({ queryKey: ['vehicles-page'] });

    if (failedCount === 0) {
      toast({
        title: bulkAction === 'activate' ? 'Bulk activation completed' : 'Bulk deactivation completed',
        description: `${successCount} vehicle${successCount === 1 ? '' : 's'} updated successfully.`,
      });
      return;
    }

    toast({
      title: 'Bulk action completed with exceptions',
      description: `${successCount} succeeded, ${failedCount} failed.`,
      variant: failedCount === eligibleRows.length ? 'destructive' : undefined,
    });
  }, [bulkAction, eligibleRowsByAction, queryClient, selectedRows.length, toast, updateVehicleStatus]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 border-b pb-5">
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Weighbridge</p>
          <h1 className="text-2xl font-bold tracking-tight">Fleet Registry</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage registered vehicles, customer ownership, and fleet classification.</p>
        </div>
        <CreateVehicleDialog />
      </div>

      <div className="rounded-xl border-2 border-primary/40 bg-card p-1 shadow-sm">
        <div className="flex flex-wrap items-center gap-0 divide-y divide-border sm:divide-x sm:divide-y-0">
          <div className="flex min-w-[180px] items-center px-3 py-2">
            <Select value={customerId} onValueChange={(value) => setCustomerId(value === '__all__' ? '' : value)}>
              <SelectTrigger className="h-8 border-0 text-xs font-medium shadow-none focus:ring-0">
                <SelectValue placeholder="Client company" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__" className="text-xs">All Customers</SelectItem>
                {(customersRaw as any[]).map((customer: any) => (
                  <SelectItem key={customer.id} value={String(customer.id)} className="text-xs">{customer.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex min-w-[180px] items-center px-3 py-2">
            <Select value={vehicleTypeId} onValueChange={(value) => setVehicleTypeId(value === '__all__' ? '' : value)}>
              <SelectTrigger className="h-8 border-0 text-xs font-medium shadow-none focus:ring-0">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__" className="text-xs">All Types</SelectItem>
                {(vehicleTypesRaw as any[]).map((vehicleType: any) => (
                  <SelectItem key={vehicleType.id} value={String(vehicleType.id)} className="text-xs">{vehicleType.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex min-w-[150px] items-center px-3 py-2">
            <Select value={statusFilter || '__all__'} onValueChange={(value) => setStatusFilter(value === '__all__' ? '' : value)}>
              <SelectTrigger className="h-8 border-0 text-xs font-medium shadow-none focus:ring-0">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__" className="text-xs">All Statuses</SelectItem>
                <SelectItem value="true" className="text-xs">Active</SelectItem>
                <SelectItem value="false" className="text-xs">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex min-w-[220px] flex-1 items-center gap-2 px-3 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              placeholder="Search plate, customer, or type..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-muted-foreground/60"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 px-3 py-2">
            <ColumnPicker visibleKeys={visibleKeys} onChange={handleColumnsChange} />
            {activeFilterCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => {
                  setCustomerId('');
                  setVehicleTypeId('');
                  setStatusFilter('');
                  setSearch('');
                  setDebouncedSearch('');
                  setPage(1);
                }}
              >
                <X className="h-3 w-3" />
                Clear filters
                <Badge variant="secondary" className="px-1 py-0 text-[10px]">{activeFilterCount}</Badge>
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-primary/40 bg-card px-3 py-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          {search && <Badge variant="secondary" className="gap-1.5 rounded-md px-2 py-1 text-xs">Search: {search}<button type="button" onClick={() => setSearch('')} aria-label="Clear search"><X className="h-3 w-3" /></button></Badge>}
          {customerId && <Badge variant="secondary" className="gap-1.5 rounded-md px-2 py-1 text-xs">Client: {(customersRaw as any[]).find((customer) => String(customer.id) === customerId)?.name ?? customerId}<button type="button" onClick={() => setCustomerId('')} aria-label="Clear client filter"><X className="h-3 w-3" /></button></Badge>}
          {vehicleTypeId && <Badge variant="secondary" className="gap-1.5 rounded-md px-2 py-1 text-xs">Type: {(vehicleTypesRaw as any[]).find((vehicleType) => String(vehicleType.id) === vehicleTypeId)?.name ?? vehicleTypeId}<button type="button" onClick={() => setVehicleTypeId('')} aria-label="Clear vehicle type filter"><X className="h-3 w-3" /></button></Badge>}
          {statusFilter && <Badge variant="secondary" className="gap-1.5 rounded-md px-2 py-1 text-xs">Status: {statusFilter === 'true' ? 'Active' : 'Inactive'}<button type="button" onClick={() => setStatusFilter('')} aria-label="Clear status filter"><X className="h-3 w-3" /></button></Badge>}
          <div className="text-xs font-medium text-muted-foreground">
            {selectedIds.length > 0 ? `${selectedIds.length} selected on this page` : 'Select rows to run bulk actions'}
          </div>
          {selectedIds.length > 0 && (
            <div className="text-xs text-muted-foreground">
              {eligibleRowsByAction.activate.length > 0 ? `${eligibleRowsByAction.activate.length} activatable` : null}
              {eligibleRowsByAction.activate.length > 0 && eligibleRowsByAction.deactivate.length > 0 ? ' · ' : null}
              {eligibleRowsByAction.deactivate.length > 0 ? `${eligibleRowsByAction.deactivate.length} deactivatable` : null}
              {eligibleRowsByAction.activate.length === 0 && eligibleRowsByAction.deactivate.length === 0 ? 'No valid actions for the current selection' : null}
            </div>
          )}
          {selectedIds.length > 0 && (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setSelectedIds([])}>
              Clear Selection
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={bulkAction || '__none__'} onValueChange={(value) => setBulkAction(value === '__none__' ? '' : (value as BulkAction))}>
            <SelectTrigger className="h-8 w-[190px] text-xs">
              <SelectValue placeholder="Choose bulk action" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__" className="text-xs">Choose bulk action</SelectItem>
              {BULK_ACTIONS.map((action) => (
                <SelectItem
                  key={action.value}
                  value={action.value}
                  className="text-xs"
                  disabled={action.value === 'activate' ? eligibleRowsByAction.activate.length === 0 : eligibleRowsByAction.deactivate.length === 0}
                >
                  {action.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-8 text-xs font-bold uppercase tracking-wide" disabled={!canBulkRun} onClick={runBulkAction}>
            {bulkRunning ? 'Running…' : 'Run'}
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <Table className="min-w-max">
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="h-11 w-12 px-3 text-center align-middle">
                  <Checkbox
                    checked={allPageSelected ? true : somePageSelected ? 'indeterminate' : false}
                    onCheckedChange={(checked) => toggleSelectAllPage(checked === true)}
                    aria-label="Select all rows on this page"
                  />
                </TableHead>
                {visibleColumns.map((column) => (
                  <TableHead key={column.key} style={{ width: column.width }} className="h-11 whitespace-nowrap px-3 text-left align-middle text-[10px] font-bold uppercase tracking-widest">
                    {column.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {error ? (
                <TableRow>
                  <TableCell colSpan={visibleColumns.length + 1} className="py-12 text-center text-sm text-destructive">
                    Could not load fleet records. If activation was just added, run the latest backend migration and reload this page.
                  </TableCell>
                </TableRow>
              ) : isLoading ? (
                <TableRow>
                  <TableCell colSpan={visibleColumns.length + 1} className="py-12 text-center font-mono text-sm text-muted-foreground animate-pulse">
                    Scanning registry...
                  </TableCell>
                </TableRow>
              ) : rows.length ? (
                rows.map((vehicle: any) => (
                  <TableRow key={vehicle.id} className="transition-colors hover:bg-muted/30">
                    <TableCell className="px-3 text-center">
                      <Checkbox
                        checked={selectedRowSet.has(vehicle.id)}
                        onCheckedChange={(checked) => toggleSelected(vehicle.id, checked === true)}
                        aria-label={`Select vehicle ${vehicle.number_plate}`}
                      />
                    </TableCell>
                    {visibleColumns.map((column) => (
                      <TableCell key={column.key} className="px-3 py-3 align-middle">
                        {column.render(vehicle)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={visibleColumns.length + 1} className="py-16 text-center font-mono text-sm text-muted-foreground">
                    No fleet records found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <Pagination page={page} pageSize={pageSize} totalCount={totalCount} onPage={setPage} onPageSize={setPageSize} />
      </div>
    </div>
  );
}

function CreateVehicleDialog() {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({ number_plate: '', customer: '', vehicle_type: '' });

  const { data: customers = [] } = useQuery({
    queryKey: ['vehicle-dialog-customers', token],
    enabled: open && !!token,
    queryFn: async () => {
      const json = await fetchList('/api/commercial-weighbridge/customers/?page_size=200', token);
      return Array.isArray(json) ? json : json?.results ?? [];
    },
  });

  const { data: vehicleTypes = [] } = useQuery({
    queryKey: ['vehicle-dialog-types', token],
    enabled: open && !!token,
    queryFn: async () => {
      const json = await fetchList('/api/commercial-weighbridge/vehicle-types/?page_size=200', token);
      return Array.isArray(json) ? json : json?.results ?? [];
    },
  });

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const res = await fetch('/api/commercial-weighbridge/vehicles/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Token ${token}` },
        body: JSON.stringify({
          number_plate: formData.number_plate.toUpperCase(),
          customer: Number(formData.customer),
          vehicle_type: Number(formData.vehicle_type),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body === 'string' ? body : JSON.stringify(body));
      toast({ title: 'Vehicle registered' });
      queryClient.invalidateQueries({ queryKey: ['vehicles-page'] });
      setOpen(false);
      setFormData({ number_plate: '', customer: '', vehicle_type: '' });
    } catch (err: any) {
      toast({ title: 'Registration failed', description: err?.message, variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 font-bold uppercase tracking-wide"><Plus className="h-4 w-4" /> Register Asset</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] rounded-xl border-2 border-primary/30 p-5 sm:max-w-[440px] sm:p-6">
        <DialogHeader className="border-b pb-4">
          <DialogTitle className="text-base font-bold uppercase tracking-[0.14em]">New Fleet Asset</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5 pt-1">
          <div className="grid gap-5">
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Registration Plate</label>
              <Input
                value={formData.number_plate}
                onChange={(event) => setFormData({ ...formData, number_plate: event.target.value.toUpperCase() })}
                required
                className="h-11 border-2 text-base font-black uppercase tracking-widest font-mono focus-visible:ring-primary"
                placeholder="ABC-1234"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Customer</label>
              <Select value={formData.customer} onValueChange={(value) => setFormData({ ...formData, customer: value })}>
                <SelectTrigger className="h-11"><SelectValue placeholder="Select customer..." /></SelectTrigger>
                <SelectContent>
                  {(customers as any[]).map((customer: any) => (
                    <SelectItem key={customer.id} value={String(customer.id)}>{customer.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Vehicle Type</label>
              <Select value={formData.vehicle_type} onValueChange={(value) => setFormData({ ...formData, vehicle_type: value })}>
                <SelectTrigger className="h-11"><SelectValue placeholder="Select vehicle type..." /></SelectTrigger>
                <SelectContent>
                  {(vehicleTypes as any[]).map((vehicleType: any) => (
                    <SelectItem key={vehicleType.id} value={String(vehicleType.id)}>{vehicleType.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button type="submit" className="h-11 w-full font-bold uppercase tracking-[0.12em]" disabled={!formData.customer || !formData.vehicle_type}>
            Commit Registration
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
