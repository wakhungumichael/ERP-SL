import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, FilePlus2, ShoppingCart, Wallet, PackageCheck,
  Search, CalendarRange, ArrowRight, ClipboardList, ShieldAlert, Clock3,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/context/use-auth';
import { ProcessFlow } from '@/components/workflow/process-flow';
import { useToast } from '@/hooks/use-toast';

type RequisitionLine = {
  id?: number;
  description: string;
  quantity: number | string;
  unit_price: number | string;
  unit?: string;
  item_type?: string;
  line_total?: string | number;
  notes?: string;
};

type RequisitionApproval = {
  id: number;
  step_order: number;
  group_name: string;
  status: string;
  assigned_user_name?: string | null;
  acted_by_name?: string | null;
  decision_notes?: string | null;
  acted_at?: string | null;
};

type Requisition = {
  id: number;
  request_number: string;
  title: string;
  description?: string;
  cost_center: string;
  project_code?: string;
  needed_by?: string | null;
  status: string;
  budget_status: string;
  budget_message: string;
  estimated_total: string;
  currency: string;
  vendor_option?: string;
  requested_by_name?: string | null;
  submitted_at?: string | null;
  approved_at?: string | null;
  created_at?: string;
  updated_at?: string;
  lines?: RequisitionLine[];
  approvals?: RequisitionApproval[];
};

type RequisitionResponse = {
  count: number;
  page: number;
  page_size: number;
  total_pages: number;
  next: number | null;
  previous: number | null;
  results: Requisition[];
};

const statusTone: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  submitted: 'bg-amber-100 text-amber-700',
  pending_approval: 'bg-blue-100 text-blue-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-rose-100 text-rose-700',
  cancelled: 'bg-slate-200 text-slate-700',
  po_created: 'bg-violet-100 text-violet-700',
};

const budgetTone: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-700',
  passed: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  blocked: 'bg-rose-100 text-rose-700',
};

function money(value: string | number, currency = 'KES') {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function parseErrorMessage(body: any, fallback: string) {
  if (!body) return fallback;
  if (typeof body === 'string') return body;
  if (body.error) return body.error;
  if (body.detail) return body.detail;
  const first = Object.values(body)[0];
  if (Array.isArray(first) && first.length) return String(first[0]);
  return fallback;
}

function requisitionNextStep(req: Requisition) {
  if (req.budget_status === 'blocked') {
    return { href: '/finance/budgets', label: 'Resolve budget block', helper: 'Budget control needs a decision before procurement can continue.' };
  }
  if (req.status === 'draft') {
    return { href: '/procurement/requisitions', label: 'Submit for review', helper: 'Complete and submit the request into the controlled workflow.' };
  }
  if (req.status === 'submitted' || req.status === 'pending_approval') {
    return { href: '/platform/workflows', label: 'Approval workflow', helper: 'Track approval routing and unblock pending decisions.' };
  }
  if (req.status === 'approved') {
    return { href: '/procurement/purchase-orders', label: 'Create purchase order', helper: 'Turn approved demand into a supplier commitment.' };
  }
  if (req.status === 'po_created') {
    return { href: '/procurement/receipts', label: 'Receive delivery', helper: 'Complete goods receipt before supplier billing and payment.' };
  }
  return { href: '/procurement/purchase-orders', label: 'Track downstream docs', helper: 'Follow connected PO, receipt, and payables activity.' };
}

function Pagination({
  page, totalPages, totalCount, pageSize, onPage, onPageSize,
}: {
  page: number;
  totalPages: number;
  totalCount: number;
  pageSize: string;
  onPage: (next: number) => void;
  onPageSize: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm text-muted-foreground">
        Showing page {page} of {Math.max(totalPages, 1)} with {totalCount} total requisitions
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">Rows</span>
        <Select value={pageSize} onValueChange={onPageSize}>
          <SelectTrigger className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="10">10</SelectItem>
            <SelectItem value="25">25</SelectItem>
            <SelectItem value="50">50</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

export default function ProcurementRequisitions() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Requisition | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [budgetFilter, setBudgetFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState('10');
  const [form, setForm] = useState({
    title: '',
    description: '',
    cost_center: '',
    vendor_option: '',
    status: 'submitted',
    currency: 'KES',
    project_code: '',
    needed_by: '',
    lines: [{ description: '', quantity: '1', unit_price: '0', unit: 'pcs', item_type: 'goods', notes: '' }],
  });

  const params = new URLSearchParams();
  if (statusFilter !== 'all') params.set('status', statusFilter);
  if (budgetFilter !== 'all') params.set('budget_status', budgetFilter);
  if (search.trim()) params.set('search', search.trim());
  if (createdFrom) params.set('created_from', createdFrom);
  if (createdTo) params.set('created_to', createdTo);
  params.set('page', String(page));
  params.set('page_size', pageSize);

  const query = useQuery({
    queryKey: ['procurement-requisitions', statusFilter, budgetFilter, search, createdFrom, createdTo, page, pageSize],
    enabled: !!token,
    queryFn: async () => {
      const res = await fetch(`/api/procurement/requisitions/?${params.toString()}`, {
        headers: { Authorization: `Token ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load requisitions');
      return res.json() as Promise<RequisitionResponse>;
    },
  });

  const requisitions = query.data?.results ?? [];
  const totalCount = query.data?.count ?? 0;
  const totalPages = query.data?.total_pages ?? 1;

  useEffect(() => {
    if (!selected) return;
    const fresh = requisitions.find((item) => item.id === selected.id);
    if (fresh) setSelected(fresh);
  }, [requisitions, selected]);

  const totals = useMemo(() => ({
    total: totalCount,
    approved: requisitions.filter((item) => item.status === 'approved' || item.status === 'po_created').length,
    blocked: requisitions.filter((item) => item.budget_status === 'blocked').length,
    pending: requisitions.filter((item) => item.status === 'pending_approval').length,
  }), [requisitions, totalCount]);

  const resetCreateForm = () => {
    setForm({
      title: '',
      description: '',
      cost_center: '',
      vendor_option: '',
      status: 'submitted',
      currency: 'KES',
      project_code: '',
      needed_by: '',
      lines: [{ description: '', quantity: '1', unit_price: '0', unit: 'pcs', item_type: 'goods', notes: '' }],
    });
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        needed_by: form.needed_by || null,
        lines: form.lines.map((line) => ({
          ...line,
          quantity: Number(line.quantity),
          unit_price: Number(line.unit_price),
        })),
      };
      const res = await fetch('/api/procurement/requisitions/', {
        method: 'POST',
        headers: {
          Authorization: `Token ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseErrorMessage(body, 'Failed to create requisition'));
      return body as Requisition;
    },
    onSuccess: () => {
      toast({ title: 'Requisition created' });
      qc.invalidateQueries({ queryKey: ['procurement-requisitions'] });
      qc.invalidateQueries({ queryKey: ['procurement-dashboard'] });
      setOpen(false);
      resetCreateForm();
      setPage(1);
    },
    onError: (error: any) => {
      toast({ title: 'Could not create requisition', description: error.message, variant: 'destructive' });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/procurement/requisitions/${id}/approval-action/`, {
        method: 'POST',
        headers: {
          Authorization: `Token ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ decision: 'approve' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseErrorMessage(body, 'Failed to approve requisition'));
      return body;
    },
    onSuccess: () => {
      toast({ title: 'Requisition approved' });
      qc.invalidateQueries({ queryKey: ['procurement-requisitions'] });
      qc.invalidateQueries({ queryKey: ['procurement-dashboard'] });
    },
    onError: (error: any) => toast({ title: 'Approval failed', description: error.message, variant: 'destructive' }),
  });

  const convertMutation = useMutation({
    mutationFn: async (req: Requisition) => {
      const res = await fetch(`/api/procurement/requisitions/${req.id}/convert-to-order/`, {
        method: 'POST',
        headers: {
          Authorization: `Token ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ supplier_name: req.vendor_option || 'Pending Supplier' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseErrorMessage(body, 'Failed to convert requisition'));
      return body;
    },
    onSuccess: () => {
      toast({ title: 'Purchase order created' });
      qc.invalidateQueries({ queryKey: ['procurement-requisitions'] });
      qc.invalidateQueries({ queryKey: ['procurement-orders'] });
      qc.invalidateQueries({ queryKey: ['procurement-dashboard'] });
    },
    onError: (error: any) => toast({ title: 'PO conversion failed', description: error.message, variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch(`/api/procurement/requisitions/${selected?.id}/`, {
        method: 'PATCH',
        headers: {
          Authorization: `Token ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseErrorMessage(body, 'Failed to update requisition'));
      return body as Requisition;
    },
    onSuccess: (updated) => {
      toast({ title: 'Requisition updated' });
      setSelected(updated);
      qc.invalidateQueries({ queryKey: ['procurement-requisitions'] });
      qc.invalidateQueries({ queryKey: ['procurement-dashboard'] });
    },
    onError: (error: any) => toast({ title: 'Update failed', description: error.message, variant: 'destructive' }),
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Purchase requests</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Capture staff requests, run budget checks, and move approved requests into purchase orders.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><FilePlus2 className="mr-2 h-4 w-4" />New request</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create purchase request</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Request title</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Cost center</Label>
                <Input value={form.cost_center} onChange={(e) => setForm({ ...form, cost_center: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Project code</Label>
                <Input value={form.project_code} onChange={(e) => setForm({ ...form, project_code: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Needed by</Label>
                <Input type="date" value={form.needed_by} onChange={(e) => setForm({ ...form, needed_by: e.target.value })} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Description</Label>
                <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Preferred supplier</Label>
                <Input value={form.vendor_option} onChange={(e) => setForm({ ...form, vendor_option: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Save as</Label>
                <Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="submitted">Submitted</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 md:col-span-2 rounded-lg border p-4">
                <Label className="mb-3 block">Main item</Label>
                <div className="grid gap-3 md:grid-cols-4">
                  <Input
                    placeholder="Description"
                    value={form.lines[0].description}
                    onChange={(e) => setForm({ ...form, lines: [{ ...form.lines[0], description: e.target.value }] })}
                  />
                  <Input
                    placeholder="Qty"
                    value={form.lines[0].quantity}
                    onChange={(e) => setForm({ ...form, lines: [{ ...form.lines[0], quantity: e.target.value }] })}
                  />
                  <Input
                    placeholder="Unit Price"
                    value={form.lines[0].unit_price}
                    onChange={(e) => setForm({ ...form, lines: [{ ...form.lines[0], unit_price: e.target.value }] })}
                  />
                  <Input
                    placeholder="Unit"
                    value={form.lines[0].unit}
                    onChange={(e) => setForm({ ...form, lines: [{ ...form.lines[0], unit: e.target.value }] })}
                  />
                </div>
              </div>
              <div className="md:col-span-2 flex justify-end">
                <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.title || !form.cost_center}>
                  {createMutation.isPending ? 'Creating…' : 'Create request'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardHeader><CardTitle className="text-base">Total Requests</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{totals.total}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Approved</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{totals.approved}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Budget Blocked</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{totals.blocked}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Pending Approval</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{totals.pending}</CardContent></Card>
      </div>

      <ProcessFlow
        title="Requisition To Pay Workflow"
        description="A requisition should move through budget control, approval, purchasing, receiving, billing, and financial posting as one continuous process."
        stages={[
          { label: 'Request', active: true },
          { label: 'Budget Check', active: true },
          { label: 'Approval', active: requisitions.some((item) => item.status === 'pending_approval' || item.status === 'approved' || item.status === 'po_created') },
          { label: 'Purchase Order', active: requisitions.some((item) => item.status === 'po_created') },
          { label: 'Receipt' },
          { label: 'Vendor Bill' },
          { label: 'Payment' },
        ]}
        actions={[
          {
            label: 'Budget Control',
            href: '/finance/budgets',
            icon: <Wallet className="h-4 w-4 text-emerald-600" />,
            helper: 'Review blocked or warned demand before procurement commits spend.',
            tone: 'warning',
          },
          {
            label: 'Purchase Orders',
            href: '/procurement/purchase-orders',
            icon: <ShoppingCart className="h-4 w-4 text-sky-600" />,
            helper: 'Turn approved requisitions into supplier commitments.',
            tone: 'default',
          },
          {
            label: 'Goods Receipts',
            href: '/procurement/receipts',
            icon: <PackageCheck className="h-4 w-4 text-violet-600" />,
            helper: 'Receive ordered goods before billing and payment.',
            tone: 'success',
          },
        ]}
      />

      <div className="rounded-lg border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-3 p-3">
          <div className="flex min-w-[220px] flex-1 items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              placeholder="Search reference, title, cost center, project…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="h-8 border-0 shadow-none focus-visible:ring-0"
            />
          </div>
          <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); setPage(1); }}>
            <SelectTrigger className="h-8 w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="pending_approval">Pending Approval</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="po_created">PO Created</SelectItem>
            </SelectContent>
          </Select>
          <Select value={budgetFilter} onValueChange={(value) => { setBudgetFilter(value); setPage(1); }}>
            <SelectTrigger className="h-8 w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All budgets</SelectItem>
              <SelectItem value="passed">Passed</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="blocked">Blocked</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-muted-foreground" />
            <Input type="date" value={createdFrom} onChange={(e) => { setCreatedFrom(e.target.value); setPage(1); }} className="h-8 w-[150px]" />
            <Input type="date" value={createdTo} onChange={(e) => { setCreatedTo(e.target.value); setPage(1); }} className="h-8 w-[150px]" />
          </div>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Request list</CardTitle>
          <div className="text-sm text-muted-foreground">{totalCount} requests</div>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading requisitions…</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Cost Center</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Budget</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Next Step</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requisitions.map((req) => {
                  const nextStep = requisitionNextStep(req);
                  return (
                    <TableRow key={req.id}>
                      <TableCell className="font-medium">
                        <button onClick={() => setSelected(req)} className="text-left text-primary hover:underline">
                          {req.request_number}
                        </button>
                      </TableCell>
                      <TableCell>
                        <div>{req.title}</div>
                        {req.budget_message ? (
                          <div className="text-xs text-muted-foreground">{req.budget_message}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>{req.cost_center}</TableCell>
                      <TableCell><Badge className={statusTone[req.status] ?? ''}>{req.status}</Badge></TableCell>
                      <TableCell><Badge className={budgetTone[req.budget_status] ?? ''}>{req.budget_status}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">{req.created_at ? new Date(req.created_at).toLocaleDateString() : '—'}</TableCell>
                      <TableCell>{money(req.estimated_total, req.currency)}</TableCell>
                      <TableCell>
                        <Link href={nextStep.href} className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">
                          {nextStep.label}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => setSelected(req)}>Open</Button>
                          {req.status === 'pending_approval' ? (
                            <Button size="sm" variant="outline" onClick={() => approveMutation.mutate(req.id)} disabled={approveMutation.isPending}>
                              <CheckCircle2 className="mr-2 h-4 w-4" />Approve
                            </Button>
                          ) : null}
                          {req.status === 'approved' ? (
                            <Button size="sm" onClick={() => convertMutation.mutate(req)} disabled={convertMutation.isPending}>
                              <ShoppingCart className="mr-2 h-4 w-4" />Create PO
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {requisitions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                      No requisitions found for the selected filters.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Pagination
        page={query.data?.page ?? 1}
        totalPages={totalPages}
        totalCount={totalCount}
        pageSize={pageSize}
        onPage={setPage}
        onPageSize={(value) => { setPageSize(value); setPage(1); }}
      />

      <RequisitionWorkspace
        requisition={selected}
        open={!!selected}
        onOpenChange={(value) => { if (!value) setSelected(null); }}
        onSave={(payload) => updateMutation.mutate(payload)}
        onApprove={(id) => approveMutation.mutate(id)}
        onConvert={(req) => convertMutation.mutate(req)}
        saving={updateMutation.isPending}
      />
    </div>
  );
}

function RequisitionWorkspace({
  requisition,
  open,
  onOpenChange,
  onSave,
  onApprove,
  onConvert,
  saving,
}: {
  requisition: Requisition | null;
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onSave: (payload: any) => void;
  onApprove: (id: number) => void;
  onConvert: (requisition: Requisition) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    cost_center: '',
    vendor_option: '',
    status: 'draft',
    currency: 'KES',
    project_code: '',
    needed_by: '',
  });

  useEffect(() => {
    if (!requisition) return;
    setForm({
      title: requisition.title || '',
      description: requisition.description || '',
      cost_center: requisition.cost_center || '',
      vendor_option: requisition.vendor_option || '',
      status: requisition.status || 'draft',
      currency: requisition.currency || 'KES',
      project_code: requisition.project_code || '',
      needed_by: requisition.needed_by || '',
    });
  }, [requisition]);

  if (!requisition) return null;

  const nextStep = requisitionNextStep({ ...requisition, ...form });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Requisition Workspace</SheetTitle>
          <SheetDescription>
            Keep the procurement request, budget context, approval state, and downstream purchasing actions in one place.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <div className="rounded-2xl border bg-muted/20 p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Reference</p>
                <h2 className="mt-1 text-xl font-black">{requisition.request_number}</h2>
                <div className="mt-2 flex flex-wrap gap-3 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><ClipboardList className="h-3.5 w-3.5" /> {requisition.requested_by_name || 'Unknown requester'}</span>
                  <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {requisition.created_at ? new Date(requisition.created_at).toLocaleString() : 'No created date'}</span>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Badge className={statusTone[requisition.status] ?? ''}>{requisition.status}</Badge>
                <Badge className={budgetTone[requisition.budget_status] ?? ''}>{requisition.budget_status}</Badge>
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.35fr_0.95fr]">
            <div className="space-y-4 rounded-2xl border p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Title</Label>
                  <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Cost Center</Label>
                  <Input value={form.cost_center} onChange={(e) => setForm({ ...form, cost_center: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Project Code</Label>
                  <Input value={form.project_code} onChange={(e) => setForm({ ...form, project_code: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Needed By</Label>
                  <Input type="date" value={form.needed_by} onChange={(e) => setForm({ ...form, needed_by: e.target.value })} />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Preferred Vendor</Label>
                  <Input value={form.vendor_option} onChange={(e) => setForm({ ...form, vendor_option: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="submitted">Submitted</SelectItem>
                      <SelectItem value="pending_approval">Pending Approval</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="po_created">PO Created</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="min-h-[120px]" />
              </div>

              <div className="rounded-xl border p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="font-semibold">Line Items</p>
                  <p className="text-sm text-muted-foreground">{requisition.lines?.length ?? 0} line(s)</p>
                </div>
                <div className="space-y-3">
                  {(requisition.lines ?? []).map((line, index) => (
                    <div key={`${line.id ?? index}`} className="rounded-lg bg-muted/30 p-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium">{line.description || `Line ${index + 1}`}</div>
                        <div className="font-mono">{money(line.line_total ?? 0, requisition.currency)}</div>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Qty {line.quantity} {line.unit || 'unit'} @ {money(line.unit_price || 0, requisition.currency)}
                      </div>
                    </div>
                  ))}
                  {(!requisition.lines || requisition.lines.length === 0) && (
                    <div className="rounded-lg bg-muted/20 p-3 text-sm text-muted-foreground">No line items captured yet.</div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button onClick={() => onSave({
                  title: form.title,
                  description: form.description,
                  cost_center: form.cost_center,
                  vendor_option: form.vendor_option,
                  status: form.status,
                  currency: form.currency,
                  project_code: form.project_code,
                  needed_by: form.needed_by || null,
                })} disabled={saving || !form.title || !form.cost_center}>
                  {saving ? 'Saving…' : 'Save Requisition'}
                </Button>
                <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Budget Control</p>
                <div className="mt-3 rounded-xl border bg-muted/20 p-4">
                  <div className="flex items-center gap-2 font-semibold">
                    <ShieldAlert className={`h-4 w-4 ${requisition.budget_status === 'blocked' ? 'text-rose-600' : requisition.budget_status === 'warning' ? 'text-amber-600' : 'text-emerald-600'}`} />
                    {requisition.budget_status}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{requisition.budget_message || 'No budget exception message recorded.'}</p>
                </div>
              </div>

              <div className="rounded-2xl border p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">ERP Next Step</p>
                <div className="mt-3 rounded-xl border bg-muted/20 p-4">
                  <div className="font-semibold">{nextStep.label}</div>
                  <p className="mt-2 text-sm text-muted-foreground">{nextStep.helper}</p>
                  <div className="mt-4 flex flex-col gap-2">
                    <Link href={nextStep.href}>
                      <Button className="w-full justify-center gap-2">
                        <ArrowRight className="h-4 w-4" />
                        Open Workspace
                      </Button>
                    </Link>
                    {requisition.status === 'pending_approval' ? (
                      <Button variant="outline" onClick={() => onApprove(requisition.id)}>
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        Approve Request
                      </Button>
                    ) : null}
                    {requisition.status === 'approved' ? (
                      <Button variant="outline" onClick={() => onConvert(requisition)}>
                        <ShoppingCart className="mr-2 h-4 w-4" />
                        Create Purchase Order
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Approval Trail</p>
                <div className="mt-3 space-y-3">
                  {(requisition.approvals ?? []).map((approval) => (
                    <div key={approval.id} className="rounded-xl bg-muted/20 p-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-semibold">Step {approval.step_order}: {approval.group_name}</div>
                        <Badge className={statusTone[approval.status] ?? ''}>{approval.status}</Badge>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        {approval.assigned_user_name ? `Assigned to ${approval.assigned_user_name}` : 'No assignee'}
                        {approval.acted_by_name ? ` · acted by ${approval.acted_by_name}` : ''}
                      </div>
                      {approval.decision_notes ? <div className="mt-1 text-xs text-muted-foreground">{approval.decision_notes}</div> : null}
                    </div>
                  ))}
                  {(!requisition.approvals || requisition.approvals.length === 0) && (
                    <div className="rounded-xl bg-muted/20 p-3 text-sm text-muted-foreground">No approval steps created yet.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
