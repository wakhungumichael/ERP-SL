import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  ArrowRight,
  Building2,
  CalendarClock,
  Globe,
  Mail,
  Phone,
  Plus,
  Search,
  ShoppingCart,
  Target,
  TrendingUp,
  UserRound,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { ListingColumnPicker } from '@/components/erp/listing/column-picker';
import { ListingPagination } from '@/components/erp/listing/pagination';
import { ERPFilterBar } from '@/components/erp/listing/filter-bar';
import { ERPDataTable, type ERPTableColumn } from '@/components/erp/listing/data-table';
import { ERPFormDialog } from '@/components/erp/forms/form-dialog';
import { ERPWorkspacePage } from '@/components/erp/workspace/workspace-page';

const STORAGE_COL_KEY = 'sl-erp-crm-company-columns';
const DEFAULT_VISIBLE_KEYS = ['name', 'type', 'industry', 'contact', 'contact_count', 'open_leads'] as string[];

const API = (path: string, opts: RequestInit = {}) => {
  const token = localStorage.getItem('sl-erp-token');
  return fetch(`/api/crm${path}`, {
    ...opts,
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers as Record<string, string> | undefined),
    },
  });
};

const TYPE_BADGE: Record<string, string> = {
  customer: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  prospect: 'bg-blue-100 text-blue-800 border-blue-300',
  partner: 'bg-purple-100 text-purple-800 border-purple-300',
  other: 'bg-gray-100 text-gray-700 border-gray-300',
};

const STAGE_BADGE: Record<string, string> = {
  new: 'bg-slate-100 text-slate-700 border-slate-300',
  contacted: 'bg-blue-100 text-blue-800 border-blue-300',
  proposal: 'bg-purple-100 text-purple-800 border-purple-300',
  negotiation: 'bg-orange-100 text-orange-800 border-orange-300',
  won: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  lost: 'bg-red-100 text-red-800 border-red-300',
};

type Company = {
  id: number;
  name: string;
  type: 'customer' | 'prospect' | 'partner' | 'other';
  industry?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  contact_count: number;
  open_leads: number;
  created_at?: string;
  updated_at?: string;
};

type CompanyResponse = {
  count: number;
  next: string | null;
  previous: string | null;
  results: Company[];
};

type CompanyFormState = {
  name: string;
  type: Company['type'];
  industry: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  notes: string;
};

const EMPTY_FORM: CompanyFormState = {
  name: '',
  type: 'customer',
  industry: '',
  email: '',
  phone: '',
  website: '',
  address: '',
  notes: '',
};

const ALL_COLUMNS = [
  { key: 'name', label: 'Company' },
  { key: 'type', label: 'Type' },
  { key: 'industry', label: 'Industry' },
  { key: 'contact', label: 'Contact' },
  { key: 'website', label: 'Website' },
  { key: 'contact_count', label: 'People' },
  { key: 'open_leads', label: 'Open Deals' },
] as const;

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

function formatMoney(value: string | number | null | undefined, currency = 'KES') {
  const amount = value == null ? 0 : Number(value);
  return `${currency} ${amount.toLocaleString()}`;
}

function formatDate(value?: string | null) {
  if (!value) return 'No date';
  return new Date(value).toLocaleDateString();
}

function nextActionHref(openLeads: number) {
  return openLeads > 0 ? '/crm/opportunities' : '/crm/follow-ups';
}

export default function CompaniesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [visibleKeys, setVisibleKeys] = useState<string[]>(loadColumns);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Company | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [form, setForm] = useState<CompanyFormState>(EMPTY_FORM);

  const query = useQuery({
    queryKey: ['crm-companies', search, typeFilter, page, pageSize],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      if (search.trim()) params.set('search', search.trim());
      if (typeFilter !== 'all') params.set('type', typeFilter);
      const res = await API(`/companies/?${params.toString()}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Failed to load companies');
      return body as CompanyResponse | Company[];
    },
  });

  const companiesData = query.data;
  const companies = Array.isArray(companiesData) ? companiesData : companiesData?.results ?? [];
  const totalCount = Array.isArray(companiesData) ? companiesData.length : companiesData?.count ?? 0;

  useEffect(() => {
    if (!selectedCompany) return;
    const fresh = companies.find((company) => company.id === selectedCompany.id);
    if (fresh) setSelectedCompany(fresh);
  }, [companies, selectedCompany]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        type: form.type,
        industry: form.industry || null,
        email: form.email || null,
        phone: form.phone || null,
        website: form.website || null,
        address: form.address || null,
        notes: form.notes || null,
      };
      const res = await API(editTarget ? `/companies/${editTarget.id}/` : '/companies/', {
        method: editTarget ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || body?.name?.[0] || 'Could not save company');
      return body;
    },
    onSuccess: (savedCompany) => {
      toast({ title: editTarget ? 'Company updated' : 'Company added' });
      qc.invalidateQueries({ queryKey: ['crm-companies'] });
      qc.invalidateQueries({ queryKey: ['crm-dashboard'] });
      qc.invalidateQueries({ queryKey: ['crm-people'] });
      qc.invalidateQueries({ queryKey: ['crm-opps'] });
      qc.invalidateQueries({ queryKey: ['crm-followups'] });
      setDialogOpen(false);
      setEditTarget(null);
      setForm(EMPTY_FORM);
      if (selectedCompany?.id === savedCompany.id) setSelectedCompany(savedCompany);
    },
    onError: (error: Error) => toast({ title: 'Could not save company', description: error.message, variant: 'destructive' }),
  });

  const summary = useMemo(() => ({
    total: totalCount,
    customersOnPage: companies.filter((company) => company.type === 'customer').length,
    prospectsOnPage: companies.filter((company) => company.type === 'prospect').length,
    openDealsOnPage: companies.reduce((sum, company) => sum + Number(company.open_leads ?? 0), 0),
  }), [companies, totalCount]);

  const openCreate = () => {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (company: Company) => {
    setEditTarget(company);
    setForm({
      name: company.name ?? '',
      type: company.type ?? 'customer',
      industry: company.industry ?? '',
      email: company.email ?? '',
      phone: company.phone ?? '',
      website: company.website ?? '',
      address: company.address ?? '',
      notes: company.notes ?? '',
    });
    setDialogOpen(true);
  };

  const columns = useMemo<ERPTableColumn<Company>[]>(() => {
    const renderers: Record<string, ERPTableColumn<Company>> = {
      name: {
        key: 'name',
        label: 'Company',
        render: (company) => (
          <button className="text-left" onClick={() => setSelectedCompany(company)}>
            <div className="flex items-center gap-2 font-medium text-primary hover:underline">
              <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {company.name}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">View company details</div>
          </button>
        ),
      },
      type: {
        key: 'type',
        label: 'Type',
        render: (company) => (
          <span className={`inline-flex rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${TYPE_BADGE[company.type] ?? TYPE_BADGE.other}`}>
            {company.type}
          </span>
        ),
      },
      industry: {
        key: 'industry',
        label: 'Industry',
        render: (company) => <span className="text-sm text-muted-foreground">{company.industry || '—'}</span>,
      },
      contact: {
        key: 'contact',
        label: 'Contact',
        render: (company) => (
          <div className="space-y-0.5">
            {company.email ? <div className="flex items-center gap-1 text-xs text-muted-foreground"><Mail className="h-3 w-3" />{company.email}</div> : null}
            {company.phone ? <div className="flex items-center gap-1 font-mono text-xs text-muted-foreground"><Phone className="h-3 w-3" />{company.phone}</div> : null}
            {!company.email && !company.phone ? <span className="text-xs text-muted-foreground">—</span> : null}
          </div>
        ),
      },
      website: {
        key: 'website',
        label: 'Website',
        render: (company) => company.website ? (
          <a
            href={company.website}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            <Globe className="h-3 w-3" />
            {company.website.replace(/^https?:\/\//, '')}
          </a>
        ) : '—',
      },
      contact_count: {
        key: 'contact_count',
        label: 'People',
        render: (company) => <span className="font-mono font-bold">{company.contact_count}</span>,
      },
      open_leads: {
        key: 'open_leads',
        label: 'Open Deals',
        render: (company) => company.open_leads > 0
          ? <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">{company.open_leads}</span>
          : <span className="text-xs text-muted-foreground">—</span>,
      },
    };

    return visibleKeys.map((key) => renderers[key]).filter(Boolean);
  }, [visibleKeys]);

  return (
    <ERPWorkspacePage
      title="Companies"
      description="Manage company records, key contacts, active deals, and follow-ups from one clear account view."
      actions={<Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" /> Add Company</Button>}
    >
      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Filtered Total</div><div className="mt-2 text-2xl font-semibold">{summary.total}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Customers On Page</div><div className="mt-2 text-2xl font-semibold text-emerald-600">{summary.customersOnPage}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Prospects On Page</div><div className="mt-2 text-2xl font-semibold text-blue-600">{summary.prospectsOnPage}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Open Deals On Page</div><div className="mt-2 text-2xl font-semibold text-amber-600">{summary.openDealsOnPage}</div></CardContent></Card>
      </div>

      <ERPFilterBar
        searchSlot={(
          <>
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input
              placeholder="Search companies, email, phone, or industry…"
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              className="h-8 border-0 shadow-none focus-visible:ring-0"
            />
          </>
        )}
        filterSlot={(
          <Select value={typeFilter} onValueChange={(value) => { setTypeFilter(value); setPage(1); }}>
            <SelectTrigger className="h-8 w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="customer">Customer</SelectItem>
              <SelectItem value="prospect">Prospect</SelectItem>
              <SelectItem value="partner">Partner</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        )}
        toolsSlot={<ListingColumnPicker columns={ALL_COLUMNS.map((column) => ({ key: column.key, label: column.label }))} visibleKeys={visibleKeys} onChange={(keys) => { setVisibleKeys(keys); saveColumns(keys); }} />}
      />

      <Card>
        <CardContent className="p-0">
          <ERPDataTable
            columns={columns}
            rows={companies}
            onRowClick={setSelectedCompany}
            rowActions={(company) => <Button size="sm" variant="outline" onClick={() => setSelectedCompany(company)}>View Details</Button>}
            loading={query.isLoading}
            loadingLabel="Loading companies…"
            emptyState="No companies found for the selected filters."
          />
        </CardContent>
        <ListingPagination page={page} pageSize={pageSize} totalCount={totalCount} onPage={setPage} onPageSize={setPageSize} />
      </Card>

      <ERPFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editTarget ? 'Company Workspace' : 'New Company'}
        footer={(
          <>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={!form.name || save.isPending}>
              {save.isPending ? 'Saving…' : editTarget ? 'Save Changes' : 'Create Company'}
            </Button>
          </>
        )}
      >
        <div className="grid gap-4 py-2 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label>Company Name *</Label>
            <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Relationship Type</Label>
            <Select value={form.type} onValueChange={(value: Company['type']) => setForm((current) => ({ ...current, type: value }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="customer">Customer</SelectItem>
                <SelectItem value="prospect">Prospect</SelectItem>
                <SelectItem value="partner">Partner</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Industry</Label>
            <Input value={form.industry} onChange={(event) => setForm((current) => ({ ...current, industry: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Phone</Label>
            <Input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Website</Label>
            <Input value={form.website} onChange={(event) => setForm((current) => ({ ...current, website: event.target.value }))} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Address</Label>
            <Input value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Notes</Label>
            <Textarea rows={4} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
          </div>
        </div>
      </ERPFormDialog>

      <CompanyWorkspaceSheet
        company={selectedCompany}
        open={!!selectedCompany}
        onOpenChange={(open) => { if (!open) setSelectedCompany(null); }}
        onEdit={openEdit}
      />
    </ERPWorkspacePage>
  );
}

function CompanyWorkspaceSheet({
  company,
  open,
  onOpenChange,
  onEdit,
}: {
  company: Company | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (company: Company) => void;
}) {
  const { data: peopleData, isLoading: loadingPeople } = useQuery({
    queryKey: ['crm-company-people', company?.id],
    queryFn: async () => {
      const res = await API(`/people/?organisation=${company?.id}&page_size=50`);
      return res.json();
    },
    enabled: open && !!company,
  });

  const { data: opportunitiesData, isLoading: loadingOpportunities } = useQuery({
    queryKey: ['crm-company-opportunities', company?.id],
    queryFn: async () => {
      const res = await API(`/opportunities/?organisation=${company?.id}&page_size=50`);
      return res.json();
    },
    enabled: open && !!company,
  });

  const { data: activitiesData, isLoading: loadingActivities } = useQuery({
    queryKey: ['crm-company-followups', company?.id],
    queryFn: async () => {
      const res = await API(`/follow-ups/?organisation=${company?.id}&page_size=50`);
      return res.json();
    },
    enabled: open && !!company,
  });

  if (!company) return null;

  const people = Array.isArray(peopleData) ? peopleData : peopleData?.results ?? [];
  const opportunities = Array.isArray(opportunitiesData) ? opportunitiesData : opportunitiesData?.results ?? [];
  const activities = Array.isArray(activitiesData) ? activitiesData : activitiesData?.results ?? [];
  const openOpportunities = opportunities.filter((item: any) => !['won', 'lost'].includes(item.stage));
  const pipelineValue = openOpportunities.reduce((sum: number, item: any) => sum + Number(item.value ?? 0), 0);
  const overdueActivities = activities.filter((item: any) => new Date(item.date).getTime() < Date.now());

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-4xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            Company Details
          </SheetTitle>
          <SheetDescription>
            Review the company, see the latest relationship activity, and take the next action quickly.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <section className="rounded-3xl border bg-gradient-to-br from-slate-950 via-slate-900 to-sky-950 p-6 text-white">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] ${TYPE_BADGE[company.type] ?? TYPE_BADGE.other}`}>
                  {company.type}
                </div>
                <h2 className="mt-3 text-3xl font-black tracking-tight">{company.name}</h2>
                <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-200">
                  <span>{company.industry || 'Industry not set'}</span>
                  <span>{company.email || 'No email'}</span>
                  <span>{company.phone || 'No phone'}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => onEdit(company)}>Edit Company</Button>
                <Link href={nextActionHref(company.open_leads)}>
                  <Button className="gap-2">
                    <ArrowRight className="h-4 w-4" />
                    {company.open_leads > 0 ? 'Work Open Deals' : 'Plan Follow-up'}
                  </Button>
                </Link>
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300">People</div>
                <div className="mt-2 text-2xl font-black">{people.length}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300">Open Deals</div>
                <div className="mt-2 text-2xl font-black">{openOpportunities.length}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300">Pipeline Value</div>
                <div className="mt-2 text-2xl font-black">{formatMoney(pipelineValue)}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300">Overdue Follow-ups</div>
                <div className="mt-2 text-2xl font-black">{overdueActivities.length}</div>
              </div>
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <Card className="shadow-sm">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Account Snapshot</div>
                    <div className="mt-1 text-lg font-semibold">Quick company summary</div>
                  </div>
                  {company.website ? (
                    <a href={company.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                      <Globe className="h-4 w-4" />
                      Visit site
                    </a>
                  ) : null}
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border p-4">
                    <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Contact Details</div>
                    <div className="mt-3 space-y-2 text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground"><Mail className="h-4 w-4" /> {company.email || 'No email recorded'}</div>
                      <div className="flex items-center gap-2 text-muted-foreground"><Phone className="h-4 w-4" /> {company.phone || 'No phone recorded'}</div>
                      <div className="flex items-start gap-2 text-muted-foreground"><Building2 className="mt-0.5 h-4 w-4" /> <span>{company.address || 'No address recorded'}</span></div>
                    </div>
                  </div>
                  <div className="rounded-2xl border p-4">
                    <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Notes</div>
                    <p className="mt-3 text-sm text-muted-foreground">{company.notes || 'No account notes added yet.'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardContent className="p-5">
                <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Recommended Actions</div>
                <div className="mt-4 grid gap-3">
                  <Link href="/sales/customers" className="rounded-2xl border p-4 transition-colors hover:bg-muted/30">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">Review customer record</div>
                        <div className="mt-1 text-sm text-muted-foreground">Make sure this CRM account matches the billing and operations record.</div>
                      </div>
                      <Building2 className="h-4 w-4 shrink-0 text-sky-600" />
                    </div>
                  </Link>
                  <Link href="/sales/estimates" className="rounded-2xl border p-4 transition-colors hover:bg-muted/30">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">Turn deals into quotes</div>
                        <div className="mt-1 text-sm text-muted-foreground">Move proposal and negotiation work into formal quotes that the team can track.</div>
                      </div>
                      <TrendingUp className="h-4 w-4 shrink-0 text-violet-600" />
                    </div>
                  </Link>
                  <Link href="/sales/orders" className="rounded-2xl border p-4 transition-colors hover:bg-muted/30">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">Start order processing</div>
                        <div className="mt-1 text-sm text-muted-foreground">Send won business into order handling and fulfillment without re-entering details.</div>
                      </div>
                      <ShoppingCart className="h-4 w-4 shrink-0 text-emerald-600" />
                    </div>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <Card className="shadow-sm">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">People</div>
                    <div className="mt-1 text-lg font-semibold">Contacts for this company</div>
                  </div>
                  <Link href="/crm/people" className="text-sm text-primary hover:underline">View all contacts</Link>
                </div>
                <div className="mt-4 space-y-3">
                  {loadingPeople ? <div className="text-sm text-muted-foreground">Loading people…</div> : people.length ? people.slice(0, 6).map((person: any) => (
                    <div key={person.id} className="rounded-2xl border p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-semibold">
                            <UserRound className="h-4 w-4 text-primary" />
                            {person.full_name}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">{person.job_title || 'No job title recorded'}</div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                        {person.email ? <span>{person.email}</span> : null}
                        {person.phone ? <span>{person.phone}</span> : null}
                      </div>
                    </div>
                  )) : <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">No people linked to this company yet.</div>}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Opportunities</div>
                    <div className="mt-1 text-lg font-semibold">Active deals and sales progress</div>
                  </div>
                  <Link href="/crm/opportunities" className="text-sm text-primary hover:underline">View all deals</Link>
                </div>
                <div className="mt-4 space-y-3">
                  {loadingOpportunities ? <div className="text-sm text-muted-foreground">Loading opportunities…</div> : opportunities.length ? opportunities.slice(0, 6).map((opportunity: any) => (
                    <div key={opportunity.id} className="rounded-2xl border p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">{opportunity.title}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{opportunity.contact_name || 'No contact linked'} • {formatDate(opportunity.expected_close_date)}</div>
                        </div>
                        <span className={`inline-flex rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STAGE_BADGE[opportunity.stage] ?? 'bg-secondary border-border'}`}>
                          {opportunity.stage_display || opportunity.stage}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="text-sm font-mono text-muted-foreground">{formatMoney(opportunity.value, opportunity.currency || 'KES')}</div>
                        <Link href={['proposal', 'negotiation'].includes(opportunity.stage) ? '/sales/estimates' : opportunity.stage === 'won' ? '/sales/orders' : '/crm/opportunities'}>
                          <Button size="sm" variant="outline" className="gap-2">
                            <Target className="h-3.5 w-3.5" />
                            Next Step
                          </Button>
                        </Link>
                      </div>
                    </div>
                  )) : <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">No opportunities linked to this company yet.</div>}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Follow-up Timeline</div>
                  <div className="mt-1 text-lg font-semibold">Recent activity and next follow-ups</div>
                </div>
                <Link href="/crm/follow-ups" className="text-sm text-primary hover:underline">View all follow-ups</Link>
              </div>
              <div className="mt-4 space-y-3">
                {loadingActivities ? <div className="text-sm text-muted-foreground">Loading follow-ups…</div> : activities.length ? activities.slice(0, 8).map((activity: any) => (
                  <div key={activity.id} className="rounded-2xl border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{activity.summary}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {activity.contact_name || 'No contact'} • {activity.lead_title || 'No linked opportunity'} • {activity.created_by_name || 'Unknown owner'}
                        </div>
                      </div>
                      <div className="inline-flex items-center gap-1 text-xs font-mono text-muted-foreground">
                        <CalendarClock className="h-3.5 w-3.5" />
                        {formatDate(activity.date)}
                      </div>
                    </div>
                  </div>
                )) : <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">No follow-ups logged for this company yet.</div>}
              </div>
            </CardContent>
          </Card>
        </div>
      </SheetContent>
    </Sheet>
  );
}
