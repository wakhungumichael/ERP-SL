import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Mail, Phone, Plus, Search, Trash2, UserCheck, UserX } from 'lucide-react';
import { useAuth } from '@/context/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ListingColumnPicker } from '@/components/erp/listing/column-picker';
import { ListingPagination } from '@/components/erp/listing/pagination';
import { ERPFilterBar } from '@/components/erp/listing/filter-bar';
import { ERPBulkActions } from '@/components/erp/listing/bulk-actions';
import { ERPDataTable, type ERPTableColumn } from '@/components/erp/listing/data-table';
import { ERPFormDialog } from '@/components/erp/forms/form-dialog';
import { ERPWorkspacePage } from '@/components/erp/workspace/workspace-page';

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';
const STORAGE_COL_KEY = 'sl-erp-customer-columns';

type Customer = {
  id: number;
  name: string;
  address?: string | null;
  phone_number?: string | null;
  email?: string | null;
  discounted: boolean;
  charge: string | number;
  is_active: boolean;
  is_deleted: boolean;
};

type CustomerResponse = {
  count: number;
  next: string | null;
  previous: string | null;
  results: Customer[];
};

type CustomerFormState = {
  name: string;
  address: string;
  phone_number: string;
  email: string;
  discounted: boolean;
  charge: string;
  is_active: boolean;
};

const EMPTY_FORM: CustomerFormState = {
  name: '',
  address: '',
  phone_number: '',
  email: '',
  discounted: false,
  charge: '0',
  is_active: true,
};

const ALL_COLUMNS = [
  { key: 'id', label: 'Code' },
  { key: 'name', label: 'Customer' },
  { key: 'phone_number', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'address', label: 'Address' },
  { key: 'charge', label: 'Charge' },
  { key: 'discounted', label: 'Discount' },
  { key: 'status', label: 'Status' },
] as const;

const DEFAULT_VISIBLE_KEYS = ['id', 'name', 'phone_number', 'email', 'discounted', 'status'] as string[];

function loadColumns() {
  try {
    const raw = localStorage.getItem(STORAGE_COL_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as string[];
  } catch {}
  return DEFAULT_VISIBLE_KEYS;
}

function saveColumns(keys: string[]) {
  try {
    localStorage.setItem(STORAGE_COL_KEY, JSON.stringify(keys));
  } catch {}
}

export default function CustomersList() {
  const { token } = useAuth();
  const { toast } = useToast();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [discountedFilter, setDiscountedFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkAction, setBulkAction] = useState('');
  const [bulkRunning, setBulkRunning] = useState(false);
  const [visibleKeys, setVisibleKeys] = useState<string[]>(loadColumns);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editTarget, setEditTarget] = useState<Customer | null>(null);
  const [form, setForm] = useState<CustomerFormState>(EMPTY_FORM);

  const query = useQuery({
    queryKey: ['weighbridge-customers', token, search, statusFilter, discountedFilter, page, pageSize],
    enabled: !!token,
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter === 'active') params.set('is_active', 'true');
      if (statusFilter === 'inactive') params.set('is_active', 'false');
      if (statusFilter === 'deleted') {
        params.set('include_deleted', 'true');
        params.set('is_deleted', 'true');
      }
      if (discountedFilter !== 'all') params.set('discounted', discountedFilter);

      const res = await fetch(`${BASE_URL}/api/commercial-weighbridge/customers/?${params.toString()}`, {
        headers: { Authorization: `Token ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Failed to load customers');
      return body as CustomerResponse;
    },
  });

  const customers = query.data?.results ?? [];
  const totalCount = query.data?.count ?? 0;

  const allPageSelected = customers.length > 0 && customers.every((customer) => selectedIds.includes(customer.id));
  const somePageSelected = customers.some((customer) => selectedIds.includes(customer.id));

  const summary = useMemo(() => ({
    total: totalCount,
    activeOnPage: customers.filter((customer) => customer.is_active && !customer.is_deleted).length,
    inactiveOnPage: customers.filter((customer) => !customer.is_active && !customer.is_deleted).length,
    deletedOnPage: customers.filter((customer) => customer.is_deleted).length,
  }), [customers, totalCount]);

  const toggleColumns = (keys: string[]) => {
    setVisibleKeys(keys);
    saveColumns(keys);
  };

  const toggleSelected = (customerId: number, checked: boolean) => {
    setSelectedIds((current) => (
      checked ? Array.from(new Set([...current, customerId])) : current.filter((id) => id !== customerId)
    ));
  };

  const toggleSelectAllPage = (checked: boolean) => {
    if (checked) {
      setSelectedIds((current) => Array.from(new Set([...current, ...customers.map((customer) => customer.id)])));
      return;
    }
    setSelectedIds((current) => current.filter((id) => !customers.some((customer) => customer.id === id)));
  };

  const refetchCustomers = async () => {
    await query.refetch();
  };

  const runBulkAction = async () => {
    if (!bulkAction || selectedIds.length === 0) return;
    setBulkRunning(true);
    try {
      const res = await fetch(`${BASE_URL}/api/commercial-weighbridge/customers/bulk-action/`, {
        method: 'POST',
        headers: {
          Authorization: `Token ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids: selectedIds, action: bulkAction }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Bulk action failed');
      toast({ title: `Customer action complete`, description: `${body.updated ?? selectedIds.length} record(s) updated.` });
      setSelectedIds([]);
      setBulkAction('');
      await refetchCustomers();
    } catch (error: any) {
      toast({ title: 'Bulk action failed', description: error.message, variant: 'destructive' });
    } finally {
      setBulkRunning(false);
    }
  };

  const runSingleAction = async (customer: Customer, action: 'activate' | 'deactivate' | 'soft_delete') => {
    setBulkRunning(true);
    try {
      const res = await fetch(`${BASE_URL}/api/commercial-weighbridge/customers/bulk-action/`, {
        method: 'POST',
        headers: {
          Authorization: `Token ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids: [customer.id], action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Action failed');
      toast({ title: `Customer ${action.replace('_', ' ')}` });
      setSelectedIds((current) => current.filter((id) => id !== customer.id));
      await refetchCustomers();
    } catch (error: any) {
      toast({ title: 'Customer action failed', description: error.message, variant: 'destructive' });
    } finally {
      setBulkRunning(false);
    }
  };

  const openCreate = () => {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (customer: Customer) => {
    setEditTarget(customer);
    setForm({
      name: customer.name ?? '',
      address: customer.address ?? '',
      phone_number: customer.phone_number ?? '',
      email: customer.email ?? '',
      discounted: customer.discounted ?? false,
      charge: String(customer.charge ?? '0'),
      is_active: customer.is_active ?? true,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        address: form.address || null,
        phone_number: form.phone_number,
        email: form.email || null,
        discounted: form.discounted,
        charge: Number(form.charge || 0),
        is_active: form.is_active,
      };
      const url = editTarget
        ? `${BASE_URL}/api/commercial-weighbridge/customers/${editTarget.id}/`
        : `${BASE_URL}/api/commercial-weighbridge/customers/`;
      const method = editTarget ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Token ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = body?.phone_number?.[0] || body?.email?.[0] || body?.name?.[0] || body?.error || 'Failed to save customer';
        throw new Error(message);
      }
      toast({ title: editTarget ? 'Customer updated' : 'Customer created' });
      setDialogOpen(false);
      setEditTarget(null);
      setForm(EMPTY_FORM);
      setPage(1);
      await refetchCustomers();
    } catch (error: any) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const columns = useMemo<ERPTableColumn<Customer>[]>(() => {
    const renderers: Record<string, ERPTableColumn<Customer>> = {
      id: {
        key: 'id',
        label: 'Code',
        render: (customer) => <span className="font-mono text-xs">{String(customer.id).padStart(4, '0')}</span>,
      },
      name: {
        key: 'name',
        label: 'Customer',
        render: (customer) => (
          <button className="text-left" onClick={() => openEdit(customer)}>
            <div className="font-medium text-primary hover:underline">{customer.name}</div>
          </button>
        ),
      },
      phone_number: {
        key: 'phone_number',
        label: 'Phone',
        render: (customer) => customer.phone_number
          ? <span className="inline-flex items-center gap-2 font-mono text-xs text-muted-foreground"><Phone className="h-3 w-3" />{customer.phone_number}</span>
          : '—',
      },
      email: {
        key: 'email',
        label: 'Email',
        render: (customer) => customer.email
          ? <span className="inline-flex items-center gap-2 text-sm text-muted-foreground"><Mail className="h-3 w-3" />{customer.email}</span>
          : '—',
      },
      address: {
        key: 'address',
        label: 'Address',
        render: (customer) => <span className="text-sm text-muted-foreground">{customer.address || '—'}</span>,
      },
      charge: {
        key: 'charge',
        label: 'Charge',
        render: (customer) => <span className="font-mono text-sm">KES {Number(customer.charge ?? 0).toLocaleString()}</span>,
      },
      discounted: {
        key: 'discounted',
        label: 'Discount',
        render: (customer) => customer.discounted
          ? <Badge className="bg-emerald-100 text-emerald-700">Discounted</Badge>
          : <span className="text-xs text-muted-foreground">Standard</span>,
      },
      status: {
        key: 'status',
        label: 'Status',
        render: (customer) => {
          if (customer.is_deleted) return <Badge className="bg-rose-100 text-rose-700">Deleted</Badge>;
          if (customer.is_active) return <Badge className="bg-emerald-100 text-emerald-700">Active</Badge>;
          return <Badge className="bg-amber-100 text-amber-700">Inactive</Badge>;
        },
      },
    };

    return visibleKeys
      .map((key) => renderers[key])
      .filter(Boolean);
  }, [visibleKeys]);

  return (
    <ERPWorkspacePage
      title="Customer Directory"
      actions={<Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" /> Register Customer</Button>}
    >
      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Filtered Total</div><div className="mt-2 text-2xl font-semibold">{summary.total}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Active On Page</div><div className="mt-2 text-2xl font-semibold text-emerald-600">{summary.activeOnPage}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Inactive On Page</div><div className="mt-2 text-2xl font-semibold text-amber-600">{summary.inactiveOnPage}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Deleted On Page</div><div className="mt-2 text-2xl font-semibold text-rose-600">{summary.deletedOnPage}</div></CardContent></Card>
      </div>

      <ERPFilterBar
        searchSlot={(
          <>
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input
              placeholder="Search name, phone, or email…"
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              className="h-8 border-0 shadow-none focus-visible:ring-0"
            />
          </>
        )}
        filterSlot={(
          <>
            <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); setPage(1); setSelectedIds([]); }}>
              <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="deleted">Deleted</SelectItem>
                <SelectItem value="all">All visible</SelectItem>
              </SelectContent>
            </Select>
            <Select value={discountedFilter} onValueChange={(value) => { setDiscountedFilter(value); setPage(1); }}>
              <SelectTrigger className="h-8 w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All pricing</SelectItem>
                <SelectItem value="true">Discounted</SelectItem>
                <SelectItem value="false">Standard</SelectItem>
              </SelectContent>
            </Select>
          </>
        )}
        toolsSlot={<ListingColumnPicker columns={ALL_COLUMNS.map((column) => ({ key: column.key, label: column.label }))} visibleKeys={visibleKeys} onChange={toggleColumns} />}
      />

      <ERPBulkActions
        visible={selectedIds.length > 0}
        summary={`${selectedIds.length} record(s) selected`}
        actionSlot={(
          <Select value={bulkAction} onValueChange={setBulkAction}>
            <SelectTrigger className="h-8 w-[190px]"><SelectValue placeholder="Choose action" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="activate">Activate selected</SelectItem>
              <SelectItem value="deactivate">Deactivate selected</SelectItem>
              <SelectItem value="soft_delete">Soft delete selected</SelectItem>
            </SelectContent>
          </Select>
        )}
        primaryAction={<Button size="sm" onClick={runBulkAction} disabled={!bulkAction || bulkRunning}>{bulkRunning ? 'Running…' : 'Apply Bulk Action'}</Button>}
        secondaryAction={<Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>Clear selection</Button>}
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Customer Listing</CardTitle>
          <div className="text-sm text-muted-foreground">{totalCount} matching records</div>
        </CardHeader>
        <CardContent className="p-0">
          <ERPDataTable
            columns={columns}
            rows={customers}
            selectedIds={selectedIds}
            onToggleSelected={toggleSelected}
            onToggleSelectAllPage={toggleSelectAllPage}
            rowActions={(customer) => (
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => openEdit(customer)}>Open</Button>
                {!customer.is_deleted && customer.is_active ? (
                  <Button size="sm" variant="outline" onClick={() => runSingleAction(customer, 'deactivate')}>
                    <UserX className="mr-1 h-4 w-4" /> Deactivate
                  </Button>
                ) : null}
                {!customer.is_deleted && !customer.is_active ? (
                  <Button size="sm" variant="outline" onClick={() => runSingleAction(customer, 'activate')}>
                    <UserCheck className="mr-1 h-4 w-4" /> Activate
                  </Button>
                ) : null}
                {!customer.is_deleted ? (
                  <Button size="sm" variant="outline" onClick={() => runSingleAction(customer, 'soft_delete')}>
                    <Trash2 className="mr-1 h-4 w-4" /> Soft Delete
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => runSingleAction(customer, 'activate')}>
                    <UserCheck className="mr-1 h-4 w-4" /> Restore
                  </Button>
                )}
              </div>
            )}
            loading={query.isLoading}
            loadingLabel="Loading customers…"
            emptyState="No customer records found for the selected filters."
          />
        </CardContent>
        <ListingPagination page={page} pageSize={pageSize} totalCount={totalCount} onPage={setPage} onPageSize={setPageSize} />
      </Card>

      <CustomerFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        form={form}
        onFormChange={setForm}
        onSave={handleSave}
        saving={saving}
        editTarget={editTarget}
      />
    </ERPWorkspacePage>
  );
}

function CustomerFormDialog({
  open,
  onOpenChange,
  form,
  onFormChange,
  onSave,
  saving,
  editTarget,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  form: CustomerFormState;
  onFormChange: (value: CustomerFormState) => void;
  onSave: () => void;
  saving: boolean;
  editTarget: Customer | null;
}) {
  return (
    <ERPFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editTarget ? 'Customer Workspace' : 'New Customer'}
      footer={(
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onSave} disabled={saving || !form.name || !form.phone_number}>
            {saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Create Customer'}
          </Button>
        </>
      )}
    >
        <div className="grid gap-4 py-2 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Customer Name *</Label>
            <Input value={form.name} onChange={(event) => onFormChange({ ...form, name: event.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Phone Number *</Label>
            <Input value={form.phone_number} onChange={(event) => onFormChange({ ...form, phone_number: event.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Email Address</Label>
            <Input type="email" value={form.email} onChange={(event) => onFormChange({ ...form, email: event.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Charge</Label>
            <Input type="number" min="0" step="0.01" value={form.charge} onChange={(event) => onFormChange({ ...form, charge: event.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={form.is_active ? 'active' : 'inactive'} onValueChange={(value) => onFormChange({ ...form, is_active: value === 'active' })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Pricing Type</Label>
            <Select value={form.discounted ? 'discounted' : 'standard'} onValueChange={(value) => onFormChange({ ...form, discounted: value === 'discounted' })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="discounted">Discounted</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Address</Label>
            <Textarea rows={4} value={form.address} onChange={(event) => onFormChange({ ...form, address: event.target.value })} />
          </div>
        </div>
    </ERPFormDialog>
  );
}
