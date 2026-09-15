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
const USERS_API = () => fetch('/api/platform/users/?page_size=200', { headers: { Authorization: `Token ${localStorage.getItem('sl-erp-token')}` } });

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
  assigned_to_name?: string;
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
  { key: 'owner', label: 'Sales Owner' },
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
  const [industryFilter, setIndustryFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [visibleKeys, setVisibleKeys] = useState<string[]>(loadColumns);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Company | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [form, setForm] = useState<CompanyFormState>(EMPTY_FORM);

  const query = useQuery({
    queryKey: ['crm-companies', search, typeFilter, industryFilter, ownerFilter, page, pageSize],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      if (search.trim()) params.set('search', search.trim());
      if (typeFilter !== 'all') params.set('type', typeFilter);
      if (industryFilter.trim()) params.set('industry', industryFilter.trim());
      if (ownerFilter.trim()) params.set('assigned_to', ownerFilter.trim());
      const res = await API(`/companies/?${params.toString()}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Failed to load companies');
      return body as CompanyResponse | Company[];
    },
  });
  const { data: usersData } = useQuery({ queryKey: ['crm-owner-picker'], queryFn: () => USERS_API().then((response) => response.json()) });

  const companiesData = query.data;
  const users = usersData?.results ?? [];
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
      owner: {
        key: 'owner',
        label: 'Sales Owner',
        render: (company) => <span className="text-sm text-muted-foreground">{company.assigned_to_name || 'Unassigned'}</span>,
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
            <Input className="h-8 w-[150px]" placeholder="Industry" value={industryFilter} onChange={(event) => { setIndustryFilter(event.target.value); setPage(1); }} />
            <Select value={ownerFilter || 'all'} onValueChange={(value) => { setOwnerFilter(value === 'all' ? '' : value); setPage(1); }}><SelectTrigger className="h-8 w-[150px]"><SelectValue placeholder="Owner" /></SelectTrigger><SelectContent><SelectItem value="all">All owners</SelectItem>{users.map((user: any) => <SelectItem key={user.id} value={String(user.id)}>{user.full_name || user.username || user.email}</SelectItem>)}</SelectContent></Select>
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
  const [activeTab, setActiveTab] = useState('overview');
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
  const { data: workspaceData } = useQuery({
    queryKey: ['crm-company-workspace', company?.id],
    queryFn: async () => (await API(`/companies/${company?.id}/workspace/`)).json(),
    enabled: open && !!company,
  });

  if (!company) return null;

  const people = Array.isArray(peopleData) ? peopleData : peopleData?.results ?? [];
  const opportunities = Array.isArray(opportunitiesData) ? opportunitiesData : opportunitiesData?.results ?? [];
  const activities = Array.isArray(activitiesData) ? activitiesData : activitiesData?.results ?? [];
  const quotes = workspaceData?.quotes ?? [];
  const orders = workspaceData?.orders ?? [];
  const openOpportunities = opportunities.filter((item: any) => !['won', 'lost'].includes(item.stage));
  const pipelineValue = openOpportunities.reduce((sum: number, item: any) => sum + Number(item.value ?? 0), 0);
  const overdueActivities = activities.filter((item: any) => item.status !== 'completed' && item.status !== 'cancelled' && new Date(item.date).getTime() < Date.now());

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
          <section id="company-overview" className="rounded-xl border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className={`inline-flex rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${TYPE_BADGE[company.type] ?? TYPE_BADGE.other}`}>
                  {company.type}
                </div>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{company.name}</h2>
                <div className="mt-2 flex flex-wrap gap-4 text-sm text-muted-foreground">
                  <span>{company.industry || 'Industry not set'}</span>
                  <span>{company.email || 'No email'}</span>
                  <span>{company.phone || 'No phone'}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => onEdit(company)}>Edit Company</Button>
                <Link href={nextActionHref(company.open_leads)}>
                  <Button className="gap-2">
                    <ArrowRight className="h-4 w-4" />
                    {company.open_leads > 0 ? 'Work Open Deals' : 'Plan Follow-up'}
                  </Button>
                </Link>
              </div>
            </div>

            <div className="mt-5 grid gap-3 border-t pt-4 md:grid-cols-4">
              <div className="border-l pl-3"><div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">People</div><div className="mt-1 text-xl font-semibold">{people.length}</div>
              </div>
              <div className="border-l pl-3"><div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Open Deals</div><div className="mt-1 text-xl font-semibold">{openOpportunities.length}</div>
              </div>
              <div className="border-l pl-3"><div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Pipeline Value</div><div className="mt-1 text-xl font-semibold">{formatMoney(pipelineValue)}</div>
              </div>
              <div className="border-l pl-3"><div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Overdue Follow-ups</div><div className="mt-1 text-xl font-semibold">{overdueActivities.length}</div>
              </div>
            </div>
          </section>
          <nav className="sticky top-0 z-10 flex gap-1 overflow-x-auto border-b bg-background py-2">
            {[['overview', 'Overview'], ['contacts', 'Contacts'], ['opportunities', 'Opportunities'], ['activities', 'Activities'], ['quotes', 'Quotes'], ['orders', 'Orders']].map(([value, label]) => <button key={value} type="button" onClick={() => { setActiveTab(value); document.getElementById(`company-${value}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${activeTab === value ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted-foreground'}`}>{label}</button>)}
          </nav>

          <div id="company-overview-content" className={`${activeTab === 'overview' ? '' : 'hidden'}`}>
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
          </div>

          <div id="company-contacts" className={`${activeTab === 'contacts' ? '' : 'hidden'} grid gap-4 xl:grid-cols-[0.95fr_1.05fr]`}>
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

          <Card id="company-opportunities" className={`${activeTab === 'opportunities' ? '' : 'hidden'} shadow-sm`}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between border-b pb-3"><div className="text-sm font-semibold">Opportunities</div><Link href="/crm/opportunities" className="text-xs text-primary hover:underline">View all deals</Link></div>
              <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-4">Opportunity</th><th className="py-2 pr-4">Stage</th><th className="py-2 pr-4">Value</th><th className="py-2">Expected Close</th></tr></thead><tbody>{opportunities.length ? opportunities.map((opportunity: any) => <tr key={opportunity.id} className="border-b last:border-0"><td className="py-2 pr-4 font-medium">{opportunity.title}</td><td className="py-2 pr-4"><span className={`inline-flex rounded border px-2 py-0.5 text-[10px] font-semibold ${STAGE_BADGE[opportunity.stage] ?? 'bg-secondary border-border'}`}>{opportunity.stage_display || opportunity.stage}</span></td><td className="py-2 pr-4 whitespace-nowrap">{formatMoney(opportunity.value, opportunity.currency || 'KES')}</td><td className="py-2 whitespace-nowrap text-muted-foreground">{formatDate(opportunity.expected_close_date)}</td></tr>) : <tr><td colSpan={4} className="py-8 text-center text-sm text-muted-foreground">No opportunities linked yet.</td></tr>}</tbody></table></div>
            </CardContent>
          </Card>

          <Card id="company-activities" className={`${activeTab === 'activities' ? '' : 'hidden'} shadow-sm`}>
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
          <div className={`${activeTab === 'quotes' || activeTab === 'orders' ? '' : 'hidden'} grid gap-4 xl:grid-cols-1`}>
            <Card id="company-quotes" className={`${activeTab === 'quotes' ? '' : 'hidden'} shadow-sm`}><CardContent className="p-4"><div className="flex items-center justify-between border-b pb-3"><div className="text-sm font-semibold">Quotes</div><Link href="/sales/estimates" className="text-xs text-primary hover:underline">Open quotes</Link></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2">Reference</th><th className="py-2">Status</th><th className="py-2">Amount</th><th className="py-2">Date</th></tr></thead><tbody>{quotes.length ? quotes.slice(0, 10).map((quote: any) => <tr key={quote.id} className="border-b last:border-0"><td className="py-2 font-medium">{quote.estimate_number}</td><td className="py-2 capitalize text-muted-foreground">{quote.status}</td><td className="py-2 whitespace-nowrap">{formatMoney(quote.total)}</td><td className="py-2 whitespace-nowrap text-muted-foreground">{formatDate(quote.issue_date)}</td></tr>) : <tr><td colSpan={4} className="py-8 text-center text-sm text-muted-foreground">No quotations linked yet.</td></tr>}</tbody></table></div></CardContent></Card>
            <Card id="company-orders" className={`${activeTab === 'orders' ? '' : 'hidden'} shadow-sm`}><CardContent className="p-4"><div className="flex items-center justify-between border-b pb-3"><div className="text-sm font-semibold">Orders</div><Link href="/sales/orders" className="text-xs text-primary hover:underline">Open orders</Link></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2">Reference</th><th className="py-2">Status</th><th className="py-2">Amount</th><th className="py-2">Fulfilment</th><th className="py-2">Date</th></tr></thead><tbody>{orders.length ? orders.slice(0, 10).map((order: any) => <tr key={order.id} className="border-b last:border-0"><td className="py-2 font-medium">{order.order_number}</td><td className="py-2 capitalize text-muted-foreground">{order.status}</td><td className="py-2 whitespace-nowrap">{formatMoney(order.total)}</td><td className="py-2 text-muted-foreground">{order.status === 'fulfilled' ? 'Fulfilled' : 'Pending'}</td><td className="py-2 whitespace-nowrap text-muted-foreground">{formatDate(order.order_date)}</td></tr>) : <tr><td colSpan={5} className="py-8 text-center text-sm text-muted-foreground">No sales orders linked yet.</td></tr>}</tbody></table></div></CardContent></Card>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
