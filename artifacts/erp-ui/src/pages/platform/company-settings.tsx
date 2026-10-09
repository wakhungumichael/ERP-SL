import { useState, useEffect } from 'react';
import { useAuth } from '@/context/use-auth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Building2, Mail, FileText, GitBranch, Plus, Pencil, RefreshCw, Users, Copy, Eye, EyeOff, UserCheck, UserX, Palette, Image as ImageIcon, LayoutTemplate, Globe2, Trash2, Search, X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, CreditCard, Smartphone } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { invalidateErpBranchQueries } from '@/lib/branches';

const BASE = '/api/platform';
const CURRENCIES = ['KES', 'USD', 'EUR', 'GBP', 'UGX', 'TZS'];
const TIMEZONES = ['Africa/Nairobi', 'Africa/Kampala', 'Africa/Dar_es_Salaam', 'Africa/Kigali', 'UTC'];

interface TenantRoleOption {
  id: number;
  name: string;
  display_name?: string;
  scope?: 'system' | 'tenant';
  is_assignable?: boolean;
}

const DOCUMENT_TYPES = [
  { value: 'invoice', label: 'Invoice' },
  { value: 'quotation', label: 'Estimate / Quote' },
  { value: 'receipt', label: 'Receipt' },
  { value: 'purchase_order', label: 'Purchase Order' },
  { value: 'statement', label: 'Statement' },
  { value: 'report', label: 'Report' },
];

const TEMPLATE_GROUPS = [
  {
    key: 'sales',
    title: 'Sales',
    description: 'Customer-facing billing and commercial documents.',
    documentTypes: ['invoice', 'quotation', 'receipt'],
  },
  {
    key: 'finance',
    title: 'Finance',
    description: 'Internal and account follow-up financial documents.',
    documentTypes: ['statement', 'purchase_order'],
  },
  {
    key: 'reports',
    title: 'Reports',
    description: 'Centralized report layouts used by ERP reporting workspaces.',
    documentTypes: ['report'],
  },
] as const;

const DEFAULT_LOGIN_PAGE_CONFIG = {
  eyebrow: 'SL ERP',
  title: 'SL ERP',
  subtitle: 'SL ERP for small businesses, growing companies, and large enterprises.',
  description: 'A scalable business system built to support everyday operations, finance, billing, and control at every stage of growth.',
  show_landing_page_link: true,
  show_public_registration: true,
  show_pricing_card: true,
};

const DEFAULT_LANDING_PAGE_CONFIG = {
  eyebrow: 'SL ERP',
  headline: 'SL ERP for small businesses, growing companies, and large enterprises.',
  subheadline: 'Manage finance, operations, inventory, HR, CRM, support, and approvals in one connected business system.',
  description: 'Replace scattered tools with one scalable ERP built for visibility, speed, control, and better decisions across every department.',
  primary_cta_label: 'Start Subscription',
  primary_cta_url: '/login',
  secondary_cta_label: 'View Plans',
  secondary_cta_url: '#plans',
  highlights: [
    'Order to cash with billing and collections',
    'Procurement, approvals, and supplier control',
    'Inventory, operations, and live reporting',
  ],
  enabled: true,
};

const DEFAULT_SUPPORT_FORM_FIELDS = [
  { key: 'requester_name', label: 'Full name', type: 'text', placeholder: 'Your full name', required: false, enabled: true, options: [] },
  { key: 'requester_email', label: 'Email address', type: 'email', placeholder: 'you@example.com', required: true, enabled: true, options: [] },
  { key: 'requester_phone', label: 'Phone', type: 'tel', placeholder: '+254700000000', required: false, enabled: true, options: [] },
  { key: 'category', label: 'Category', type: 'select', placeholder: '', required: false, enabled: true, options: ['General help', 'Technical issue', 'Billing or invoice', 'Account access'] },
  { key: 'priority', label: 'Priority', type: 'select', placeholder: '', required: false, enabled: true, options: ['Standard', 'High', 'Urgent', 'Low'] },
  { key: 'subject', label: 'Subject', type: 'text', placeholder: 'A short summary of your request', required: true, enabled: true, options: [] },
  { key: 'description', label: 'Issue details', type: 'textarea', placeholder: 'Tell us what happened and what help you need.', required: true, enabled: true, options: [] },
] as const;

const DEFAULT_SUPPORT_PAGE_CONFIG = {
  eyebrow: 'Customer Support',
  headline: 'How can we help today?',
  subheadline: 'Contact our team for support, billing, account, or service questions.',
  description: 'Share the details below and our team will guide your request to the right people.',
  primary_cta_label: 'Send Request',
  secondary_cta_label: 'Check Request Status',
  form_title: 'Send us a request',
  form_description: 'Tell us what you need and we will route it to the best team to help you.',
  tracking_title: 'Check your request status',
  tracking_description: 'Enter your request number and email address to see the latest progress.',
  status_title: 'Current update',
  success_title: 'Request received',
  success_description: 'Please keep your request number for future follow-up.',
  highlights: [
    'Reach the right team faster',
    'Receive clear status updates',
    'Stay within your branded support experience',
  ],
  form_fields: DEFAULT_SUPPORT_FORM_FIELDS,
};

const ORGANIZATION_CURRENCIES = ['KES', 'USD', 'EUR', 'GBP', 'UGX', 'TZS'];
const PAGINATION_PAGE_SIZES = [5, 10, 25, 50];

const BRANDING_SETTINGS_FIELDS = ['primary_color', 'workspace_name'] as const;
const PUBLIC_SITE_SETTINGS_FIELDS = ['login_page_config', 'landing_page_config', 'footer_menu'] as const;
const EMAIL_SETTINGS_FIELDS = [
  'support_email', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_password',
  'smtp_use_tls', 'smtp_use_ssl', 'smtp_allow_insecure_ssl',
] as const;
const INVOICE_SETTINGS_FIELDS = [
  'invoice_prefix', 'default_payment_terms_days', 'footer_text', 'default_tax_name',
  'default_tax_rate', 'invoice_template_id', 'estimate_template_id', 'receipt_template_id',
  'statement_template_id', 'purchase_order_template_id',
] as const;

function buildSettingsPayload(source: any, fields: readonly string[]) {
  const payload = Object.fromEntries(fields.map((field) => [field, source?.[field]]));
  if (!payload.smtp_password) delete payload.smtp_password;
  return payload;
}

function api(token: string, path: string, method = 'GET', body?: object) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async r => {
    const responseText = await r.text();
    let j: any;
    try {
      j = responseText ? JSON.parse(responseText) : {};
    } catch {
      const contentType = r.headers.get('content-type') ?? '';
      const hint = contentType.includes('text/html')
        ? 'The API server returned an HTML page. Restart the Django API server and try again.'
        : `The API returned an unreadable response (HTTP ${r.status}).`;
      throw new Error(hint);
    }
    if (!r.ok) throw new Error(j?.detail || j?.error || j?.message || JSON.stringify(j));
    return j;
  });
}

function paymentApi(token: string, path: string) {
  return fetch(`/api/payments${path}`, {
    headers: { Authorization: `Token ${token}` },
  }).then(async (r) => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.detail || j?.error || JSON.stringify(j));
    return j;
  });
}

function generateTempPassword(length = 12) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

function ListPagination({
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
    for (let i = 1; i <= totalPages; i += 1) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push('…');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i += 1) pages.push(i);
    if (page < totalPages - 2) pages.push('…');
    pages.push(totalPages);
  }

  return (
    <div className="flex items-center justify-between gap-4 border-t bg-card px-1 py-2">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="hidden font-mono sm:inline">
          {totalCount === 0 ? 'No records' : `${from}-${to} of ${totalCount.toLocaleString()}`}
        </span>
        <Select value={String(pageSize)} onValueChange={(value) => { onPageSize(Number(value)); onPage(1); }}>
          <SelectTrigger className="h-7 w-28 text-xs border-muted">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGINATION_PAGE_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)} className="text-xs">{size} per page</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === 1} onClick={() => onPage(1)} title="First page">
          <ChevronsLeft className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === 1} onClick={() => onPage(page - 1)} title="Previous page">
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

        <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === totalPages} onClick={() => onPage(page + 1)} title="Next page">
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === totalPages} onClick={() => onPage(totalPages)} title="Last page">
          <ChevronsRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function DocumentTemplateDialog({
  open,
  onClose,
  token,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  token: string;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    document_type: 'invoice',
    engine: 'html',
    is_default: false,
    subject_template: '',
    body_template: '<div class="doc-shell"><h1>{{ title }}</h1><p>{{ customer_name }}</p><p>{{ total_amount }}</p></div>',
    stylesheet: '.doc-shell{font-family:Georgia,serif;padding:32px;color:#1f2937}.doc-shell h1{font-size:28px;margin-bottom:12px}',
  });

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch(`${BASE}/documents/templates/`, {
        method: 'POST',
        headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.detail || j?.error || JSON.stringify(j));
      toast({ title: 'Template created' });
      onSaved();
      onClose();
    } catch (e: any) {
      toast({ title: 'Template save failed', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Create Document Template</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
          <div className="space-y-1.5">
            <Label>Template Name</Label>
            <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Modern Invoice" />
          </div>
          <div className="space-y-1.5">
            <Label>Document Type</Label>
            <Select value={form.document_type} onValueChange={v => setForm(p => ({ ...p, document_type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOCUMENT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>Email Subject</Label>
            <Input value={form.subject_template} onChange={e => setForm(p => ({ ...p, subject_template: e.target.value }))} placeholder="Invoice {{ invoice_number }}" />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>Body Template</Label>
            <textarea
              className="w-full min-h-[220px] rounded-md border bg-background px-3 py-2 text-sm font-mono"
              value={form.body_template}
              onChange={e => setForm(p => ({ ...p, body_template: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>Stylesheet</Label>
            <textarea
              className="w-full min-h-[160px] rounded-md border bg-background px-3 py-2 text-sm font-mono"
              value={form.stylesheet}
              onChange={e => setForm(p => ({ ...p, stylesheet: e.target.value }))}
            />
          </div>
          <div className="flex items-center gap-3 md:col-span-2">
            <Switch checked={form.is_default} onCheckedChange={v => setForm(p => ({ ...p, is_default: v }))} />
            <Label>Mark as default for this document type</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !form.name}>{saving ? 'Saving…' : 'Save Template'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function openPreviewWindow(html: string) {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (!win) throw new Error('Popup blocked');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function BranchDialog({ tenantId, branch, open, onClose }: { tenantId: number; branch?: any; open: boolean; onClose: () => void }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isEdit = !!branch;
  const [form, setForm] = useState(branch ? {
    name: branch.name, address: branch.address, email: branch.email, phone: branch.phone, is_active: branch.is_active,
  } : { name: '', address: '', email: '', phone: '', is_active: true });

  const mutation = useMutation({
    mutationFn: () => isEdit
      ? api(token!, `/branches/${branch.id}/`, 'PATCH', form)
      : api(token!, `/tenants/${tenantId}/branches/`, 'POST', form),
    onSuccess: () => {
      toast({ title: isEdit ? 'Branch updated' : 'Branch added' });
      qc.invalidateQueries({ queryKey: ['my-branches'] });
      invalidateErpBranchQueries(qc);
      onClose();
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{isEdit ? 'Edit Branch' : 'Add Branch'}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5"><Label>Name *</Label><Input value={form.name} onChange={f('name')} /></div>
          <div className="space-y-1.5"><Label>Address</Label><Input value={form.address} onChange={f('address')} /></div>
          <div className="space-y-1.5"><Label>Email</Label><Input value={form.email} onChange={f('email')} type="email" /></div>
          <div className="space-y-1.5"><Label>Phone</Label><Input value={form.phone} onChange={f('phone')} /></div>
          <div className="flex items-center gap-3"><Switch checked={form.is_active} onCheckedChange={v => setForm(p => ({ ...p, is_active: v }))} /><Label>Active</Label></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!form.name || mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrganizationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { token, refreshUser } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    legal_name: '',
    contact_email: '',
    contact_phone: '',
    industry_id: '',
    default_currency: 'KES',
    timezone: 'Africa/Nairobi',
  });
  const { data: industriesData } = useQuery({
    queryKey: ['industry-master-data-dialog'],
    queryFn: () => api(token!, '/industries/?page_size=100'),
    enabled: open && !!token,
  });
  const industries: any[] = industriesData?.results ?? [];

  useEffect(() => {
    if (!open) return;
    setForm({
      name: '',
      legal_name: '',
      contact_email: '',
      contact_phone: '',
      industry_id: '',
      default_currency: 'KES',
      timezone: 'Africa/Nairobi',
    });
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => api(token!, '/tenants/', 'POST', {
      ...form,
      industry_id: form.industry_id ? Number(form.industry_id) : undefined,
    }),
    onSuccess: async () => {
      toast({ title: 'Organization created' });
      qc.invalidateQueries({ queryKey: ['my-organizations'] });
      qc.invalidateQueries({ queryKey: ['my-tenant'] });
      await refreshUser();
      onClose();
    },
    onError: (e: any) => toast({ title: 'Create failed', description: e.message, variant: 'destructive' }),
  });

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Create Organization</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Organization Name *</Label>
            <Input value={form.name} onChange={f('name')} placeholder="Acme Logistics" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Legal Name</Label>
              <Input value={form.legal_name} onChange={f('legal_name')} placeholder="Acme Logistics Ltd" />
            </div>
            <div className="space-y-1.5">
              <Label>Contact Email</Label>
              <Input value={form.contact_email} onChange={f('contact_email')} type="email" placeholder="ops@acme.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={form.contact_phone} onChange={f('contact_phone')} placeholder="+254..." />
            </div>
            <div className="space-y-1.5">
              <Label>Industry</Label>
              <Select value={form.industry_id} onValueChange={value => setForm(p => ({ ...p, industry_id: value }))}>
                <SelectTrigger><SelectValue placeholder="Select an industry" /></SelectTrigger>
                <SelectContent>
                  {industries.map((industry: any) => (
                    <SelectItem key={industry.id} value={String(industry.id)}>{industry.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Default Currency</Label>
              <Select value={form.default_currency} onValueChange={value => setForm(p => ({ ...p, default_currency: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ORGANIZATION_CURRENCIES.map(currency => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Timezone</Label>
              <Select value={form.timezone} onValueChange={value => setForm(p => ({ ...p, timezone: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TIMEZONES.map(tz => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.name.trim()}>
            {mutation.isPending ? 'Creating…' : 'Create Organization'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function recommendPlanForIndustry(plans: any[], industryId?: number | null) {
  const activePlans = plans.filter((plan) => plan.is_active);
  if (!activePlans.length) return null;
  if (!industryId) return [...activePlans].sort((a, b) => Number(a.price) - Number(b.price))[0];

  const scored = activePlans.map((plan) => {
    const modules = Array.isArray(plan.modules) ? plan.modules : [];
    const recommendedCount = modules.filter((entry: any) => {
      const module = entry.module;
      const industries = Array.isArray(module?.industries) ? module.industries : [];
      return module?.is_core || industries.some((industry: any) => industry.id === industryId);
    }).length;
    return {
      plan,
      recommendedCount,
      totalModules: modules.length,
      price: Number(plan.price ?? 0),
    };
  });

  scored.sort((a, b) => {
    if (b.recommendedCount !== a.recommendedCount) return b.recommendedCount - a.recommendedCount;
    if (a.price !== b.price) return a.price - b.price;
    return a.totalModules - b.totalModules;
  });
  return scored[0]?.plan ?? null;
}

function OrganizationSubscriptionTab({
  tenantId,
  industryId,
  contactPhone,
}: {
  tenantId: number;
  industryId?: number | null;
  contactPhone?: string | null;
}) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [latestBillingMessage, setLatestBillingMessage] = useState('');
  const { data: plansData, isLoading: plansLoading } = useQuery({
    queryKey: ['organization-plans'],
    queryFn: () => api(token!, '/plans/?page_size=100'),
    enabled: !!token,
  });
  const { data: subscriptionsData, isLoading: subscriptionsLoading } = useQuery({
    queryKey: ['organization-subscriptions', tenantId],
    queryFn: () => api(token!, '/subscriptions/?page_size=50'),
    enabled: !!token && !!tenantId,
  });

  const plans: any[] = plansData?.results ?? [];
  const subscriptions: any[] = subscriptionsData?.results ?? [];
  const currentSubscription = subscriptions[0] ?? null;
  const recommendedPlan = recommendPlanForIndustry(plans, industryId ?? null);
  const availableBillingPeriods = Array.from(new Set(plans.map((plan: any) => plan.billing_period).filter(Boolean)));
  const [selectedBillingPeriod, setSelectedBillingPeriod] = useState('monthly');
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [startWithDemo, setStartWithDemo] = useState(true);
  const [autoStartBillingRequest, setAutoStartBillingRequest] = useState(false);

  useEffect(() => {
    const nextBillingPeriod = currentSubscription?.plan?.billing_period
      ?? recommendedPlan?.billing_period
      ?? availableBillingPeriods[0]
      ?? 'monthly';
    const nextPlanId = currentSubscription?.plan?.id
      ? String(currentSubscription.plan.id)
      : recommendedPlan?.id
        ? String(recommendedPlan.id)
        : '';
    setSelectedBillingPeriod(nextBillingPeriod);
    setSelectedPlanId(nextPlanId);
    setStartWithDemo(Boolean((currentSubscription?.metadata?.demo_days ?? recommendedPlan?.trial_days ?? 0) > 0));
    setAutoStartBillingRequest(Boolean(currentSubscription?.metadata?.auto_start_billing_request));
  }, [currentSubscription?.id, currentSubscription?.plan?.id, currentSubscription?.plan?.billing_period, currentSubscription?.metadata?.demo_days, currentSubscription?.metadata?.auto_start_billing_request, recommendedPlan?.id, recommendedPlan?.billing_period, recommendedPlan?.trial_days, availableBillingPeriods]);

  const filteredPlans = plans.filter((plan: any) => (selectedBillingPeriod ? plan.billing_period === selectedBillingPeriod : true));
  const selectedPlan = filteredPlans.find((plan: any) => String(plan.id) === selectedPlanId)
    ?? plans.find((plan: any) => String(plan.id) === selectedPlanId)
    ?? recommendedPlan
    ?? null;
  const selectedModules = (selectedPlan?.modules ?? [])
    .map((entry: any) => entry.module)
    .filter((module: any) => {
      const industries = Array.isArray(module?.industries) ? module.industries : [];
      return !industryId || module?.is_core || industries.some((industry: any) => industry.id === industryId);
    });
  const normalizedContactPhone = String(contactPhone ?? '').trim();
  const needsBillingPhone = !startWithDemo && !normalizedContactPhone;

  useEffect(() => {
    if (!filteredPlans.length) return;
    if (filteredPlans.some((plan: any) => String(plan.id) === selectedPlanId)) return;
    const nextPlan = filteredPlans.find((plan: any) => plan.id === recommendedPlan?.id) ?? filteredPlans[0];
    setSelectedPlanId(String(nextPlan.id));
  }, [filteredPlans, selectedPlanId, recommendedPlan?.id]);

  const saveSubscription = useMutation({
    mutationFn: () => {
      if (!selectedPlanId) throw new Error('Select a plan first.');
      const payload = {
        plan_id: Number(selectedPlanId),
        status: startWithDemo ? 'trial' : 'active',
        auto_renew: true,
        metadata: {
          demo_days: startWithDemo ? Number(selectedPlan?.trial_days ?? 0) : 0,
          started_from_organization_settings: true,
          auto_start_billing_request: autoStartBillingRequest,
        },
      };
      if (currentSubscription) {
        return api(token!, `/subscriptions/${currentSubscription.id}/`, 'PATCH', payload);
      }
      return api(token!, '/subscriptions/', 'POST', payload);
    },
    onSuccess: (response) => {
      const data = response?.data ?? {};
      const billingMessage = data.billing_request_message ?? '';
      setLatestBillingMessage(billingMessage);
      toast({
        title: currentSubscription ? 'Subscription updated' : 'Subscription started',
        description: billingMessage || undefined,
      });
      qc.invalidateQueries({ queryKey: ['organization-subscriptions', tenantId] });
      qc.invalidateQueries({ queryKey: ['organization-billing-summary', tenantId] });
      qc.invalidateQueries({ queryKey: ['organization-billing-requests', tenantId] });
    },
    onError: (e: any) => toast({ title: 'Subscription update failed', description: e.message, variant: 'destructive' }),
  });

  const statusTone = currentSubscription?.status === 'active'
    ? 'text-emerald-700'
    : currentSubscription?.status === 'trial'
      ? 'text-amber-700'
      : 'text-slate-600';

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="bg-muted/20 border-b py-3 px-4">
          <CardTitle className="text-xs font-bold uppercase tracking-widest">Current Subscription</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          {plansLoading || subscriptionsLoading ? (
            <p className="text-sm text-muted-foreground">Loading subscription setup…</p>
          ) : currentSubscription ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-lg font-semibold">{currentSubscription.plan?.name ?? 'Subscription'}</p>
                <Badge variant="outline" className={statusTone}>{currentSubscription.status}</Badge>
                <Badge variant="secondary">{currentSubscription.currency} {Number(currentSubscription.amount ?? currentSubscription.plan?.price ?? 0).toLocaleString()}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {currentSubscription.status === 'trial'
                  ? `Trial ends ${currentSubscription.end_date ?? 'soon'}.`
                  : `Billing period: ${currentSubscription.plan?.billing_period ?? 'custom'}.`}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No subscription has been started for this organization yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="bg-muted/20 border-b py-3 px-4">
          <CardTitle className="text-xs font-bold uppercase tracking-widest">Plan & Modules</CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-5">
          <div className={`rounded-2xl border px-4 py-3 text-sm ${normalizedContactPhone ? 'bg-muted/20' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
            <p className="font-medium">{normalizedContactPhone ? 'Billing contact phone is ready' : 'Contact phone needed for automatic billing'}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {normalizedContactPhone
                ? `Automatic M-Pesa billing requests will use ${normalizedContactPhone}.`
                : 'Add the organization contact phone in the Profile tab before starting a paid subscription so M-Pesa billing can auto-start cleanly.'}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Billing Period</Label>
            <Select value={selectedBillingPeriod} onValueChange={setSelectedBillingPeriod}>
              <SelectTrigger><SelectValue placeholder="Select billing period" /></SelectTrigger>
              <SelectContent>
                {availableBillingPeriods.map((period) => (
                  <SelectItem key={period} value={period}>
                    {period.charAt(0).toUpperCase() + period.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              SaaS admin controls which billing periods are available by creating plans in Platform Admin.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Plan</Label>
            <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
              <SelectTrigger><SelectValue placeholder="Select a plan" /></SelectTrigger>
              <SelectContent>
                {filteredPlans.map((plan: any) => (
                  <SelectItem key={plan.id} value={String(plan.id)}>
                    {plan.name} - {plan.currency} {Number(plan.price).toLocaleString()}/{plan.billing_period}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {recommendedPlan && (
              <p className="text-xs text-muted-foreground">
                Suggested for this industry: <span className="font-semibold text-foreground">{recommendedPlan.name}</span>
              </p>
            )}
          </div>

          <div className="flex items-center justify-between rounded-2xl border bg-muted/20 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Start with demo workspace</p>
              <p className="text-xs text-muted-foreground">
                Use the plan trial period first, then upgrade or continue billing later.
              </p>
            </div>
            <Switch checked={startWithDemo} onCheckedChange={setStartWithDemo} />
          </div>

          <div className="flex items-center justify-between rounded-2xl border bg-muted/20 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Auto-start M-Pesa payment prompt</p>
              <p className="text-xs text-muted-foreground">
                Optional. If turned on for a paid subscription, the platform will create the Siakora Labs billing request right after save.
              </p>
            </div>
            <Switch checked={autoStartBillingRequest} onCheckedChange={setAutoStartBillingRequest} />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Recommended Modules</p>
            {selectedModules.length === 0 ? (
              <p className="text-sm text-muted-foreground">Choose an industry and plan to see the aligned module set.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {selectedModules.map((module: any) => (
                  <Badge key={module.id} variant={module.is_core ? 'secondary' : 'outline'}>
                    {module.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <Button onClick={() => saveSubscription.mutate()} disabled={!selectedPlanId || saveSubscription.isPending}>
            {saveSubscription.isPending
              ? 'Saving…'
              : currentSubscription
                ? 'Update Subscription'
                : 'Start Subscription'}
          </Button>
          {selectedPlan && (
            <p className="text-xs text-muted-foreground">
              Subscription will be saved as <span className="font-medium text-foreground">{selectedPlan.name}</span> at {selectedPlan.currency} {Number(selectedPlan.price ?? 0).toLocaleString()}/{selectedPlan.billing_period}.
            </p>
          )}
          {needsBillingPhone && (
            <p className="text-xs text-amber-700">
              This will save the subscription, but the automatic billing request will wait until the organization contact phone is added.
            </p>
          )}
          {latestBillingMessage && (
            <p className="text-xs text-muted-foreground">{latestBillingMessage}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function OrganizationBillingTab({ tenantId, contactPhone }: { tenantId: number; contactPhone?: string | null }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [paymentPhone, setPaymentPhone] = useState(String(contactPhone ?? '').trim());
  const [paymentNotes, setPaymentNotes] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['organization-billing-providers', tenantId],
    queryFn: () => paymentApi(token!, '/provider-capabilities/?payment_scope=saas_billing'),
    enabled: !!token && !!tenantId,
  });
  const { data: subscriptionsData } = useQuery({
    queryKey: ['organization-billing-subscriptions', tenantId],
    queryFn: () => api(token!, '/subscriptions/?page_size=20'),
    enabled: !!token && !!tenantId,
  });
  const { data: billingSummaryData, isLoading: billingSummaryLoading } = useQuery({
    queryKey: ['organization-billing-summary', tenantId],
    queryFn: () => api(token!, '/billing/summary/').then((payload) => payload.data ?? {}),
    enabled: !!token && !!tenantId,
  });
  const { data: billingRequestsData, isLoading: billingRequestsLoading } = useQuery({
    queryKey: ['organization-billing-requests', tenantId],
    queryFn: () => api(token!, '/billing/requests/?page_size=20'),
    enabled: !!token && !!tenantId,
  });

  const providers: any[] = data?.capabilities ?? [];
  const currentSubscription = (subscriptionsData?.results ?? [])[0] ?? null;
  const billingSummary = billingSummaryData ?? {
    total_requested: 0,
    total_received: 0,
    outstanding: 0,
    pending_count: 0,
    by_status: [],
  };
  const billingRequests: any[] = billingRequestsData?.results ?? [];
  const normalizedContactPhone = String(contactPhone ?? '').trim();
  const openBillingRequest = billingRequests.find((request: any) => ['draft', 'initiated', 'pending'].includes(String(request.status)));

  useEffect(() => {
    setPaymentPhone(String(contactPhone ?? '').trim());
  }, [contactPhone]);

  const createBillingRequest = useMutation({
    mutationFn: () => {
      if (!currentSubscription) throw new Error('No active subscription was found for this organization.');
      return api(token!, '/billing/requests/', 'POST', {
        subscription_id: currentSubscription.id,
        phone_number: paymentPhone.trim(),
        notes: paymentNotes.trim(),
      });
    },
    onSuccess: (response) => {
      const message = response?.message ?? 'M-Pesa payment prompt sent';
      toast({ title: 'Payment request ready', description: message });
      qc.invalidateQueries({ queryKey: ['organization-billing-summary', tenantId] });
      qc.invalidateQueries({ queryKey: ['organization-billing-requests', tenantId] });
      qc.invalidateQueries({ queryKey: ['organization-billing-subscriptions', tenantId] });
    },
    onError: (e: any) => toast({ title: 'Payment request failed', description: e.message, variant: 'destructive' }),
  });

  const confirmBillingRequest = useMutation({
    mutationFn: (requestId: number) => api(token!, `/billing/requests/${requestId}/simulate-complete/`, 'POST', {}),
    onSuccess: () => {
      toast({ title: 'Sandbox payment confirmed' });
      qc.invalidateQueries({ queryKey: ['organization-billing-summary', tenantId] });
      qc.invalidateQueries({ queryKey: ['organization-billing-requests', tenantId] });
      qc.invalidateQueries({ queryKey: ['organization-billing-subscriptions', tenantId] });
    },
    onError: (e: any) => toast({ title: 'Confirmation failed', description: e.message, variant: 'destructive' }),
  });
  const failBillingRequest = useMutation({
    mutationFn: (requestId: number) => api(token!, `/billing/requests/${requestId}/simulate-fail/`, 'POST', {}),
    onSuccess: () => {
      toast({ title: 'Sandbox payment marked failed' });
      qc.invalidateQueries({ queryKey: ['organization-billing-summary', tenantId] });
      qc.invalidateQueries({ queryKey: ['organization-billing-requests', tenantId] });
      qc.invalidateQueries({ queryKey: ['organization-billing-subscriptions', tenantId] });
    },
    onError: (e: any) => toast({ title: 'Mark failed failed', description: e.message, variant: 'destructive' }),
  });
  const cancelBillingRequest = useMutation({
    mutationFn: (requestId: number) => api(token!, `/billing/requests/${requestId}/simulate-cancel/`, 'POST', {}),
    onSuccess: () => {
      toast({ title: 'Sandbox payment cancelled' });
      qc.invalidateQueries({ queryKey: ['organization-billing-summary', tenantId] });
      qc.invalidateQueries({ queryKey: ['organization-billing-requests', tenantId] });
      qc.invalidateQueries({ queryKey: ['organization-billing-subscriptions', tenantId] });
    },
    onError: (e: any) => toast({ title: 'Cancel failed', description: e.message, variant: 'destructive' }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="bg-muted/20 border-b py-3 px-4">
          <CardTitle className="text-xs font-bold uppercase tracking-widest">M-Pesa Payment</CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Plan</p>
              <p className="mt-2 text-base font-semibold">{currentSubscription?.plan?.name ?? 'Not started'}</p>
            </div>
            <div className="rounded-2xl border p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Requested</p>
              <p className="mt-2 text-base font-semibold">KES {Number(billingSummary.total_requested ?? 0).toLocaleString()}</p>
            </div>
            <div className="rounded-2xl border p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Received</p>
              <p className="mt-2 text-base font-semibold">KES {Number(billingSummary.total_received ?? 0).toLocaleString()}</p>
            </div>
            <div className="rounded-2xl border p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Pending</p>
              <p className="mt-2 text-base font-semibold">{Number(billingSummary.pending_count ?? 0).toLocaleString()}</p>
            </div>
          </div>
          <div className="rounded-2xl border bg-muted/20 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Siakora Labs M-Pesa collection</p>
              <p className="text-xs text-muted-foreground">
                Use this payment screen to send the M-Pesa STK push for the current subscription. Siakora Labs receives the subscription payment through the owner billing gateway.
              </p>
            </div>
          </div>
          <div className={`rounded-2xl border px-4 py-3 text-sm ${normalizedContactPhone ? 'bg-muted/20' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
            <p className="font-medium">{normalizedContactPhone ? 'Billing contact phone' : 'Billing is waiting for a contact phone'}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {normalizedContactPhone
                ? `${normalizedContactPhone} will be used for automatic M-Pesa subscription billing requests.`
                : 'Update the organization contact phone in the Profile tab so automatic M-Pesa billing requests can be created for paid subscriptions.'}
            </p>
          </div>
          <div className="rounded-2xl border p-4 space-y-4">
            <div className="space-y-1.5">
              <Label>Subscription</Label>
              <div className="rounded-xl border bg-muted/20 px-3 py-2 text-sm">
                {currentSubscription
                  ? `${currentSubscription.plan?.name ?? 'Plan'} · ${currentSubscription.currency ?? 'KES'} ${Number(currentSubscription.amount ?? currentSubscription.plan?.price ?? 0).toLocaleString()}/${currentSubscription.plan?.billing_period ?? 'term'}`
                  : 'No active subscription selected'}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>M-Pesa Phone Number</Label>
              <Input value={paymentPhone} onChange={(event) => setPaymentPhone(event.target.value)} placeholder="+2547..." />
            </div>
            <div className="space-y-1.5">
              <Label>Payment Note</Label>
              <Textarea value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} rows={3} placeholder="Optional note for this subscription payment" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-muted-foreground">
                {openBillingRequest
                  ? `Open request: ${openBillingRequest.checkout_reference} · ${openBillingRequest.status}`
                  : 'No open billing request yet.'}
              </div>
              <Button
                onClick={() => createBillingRequest.mutate()}
                disabled={!currentSubscription || !paymentPhone.trim() || createBillingRequest.isPending}
              >
                {createBillingRequest.isPending ? 'Sending…' : openBillingRequest ? 'Reuse Open STK Push' : 'Send M-Pesa STK Push'}
              </Button>
            </div>
          </div>
          {(billingSummaryLoading || billingRequestsLoading) ? (
            <p className="text-sm text-muted-foreground">Loading billing activity…</p>
          ) : billingRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No subscription billing requests have been started yet.</p>
          ) : (
            <div className="space-y-2">
              {billingRequests.slice(0, 5).map((request: any) => (
                <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{request.checkout_reference}</p>
                    <p className="text-xs text-muted-foreground">
                      {request.payment_provider?.toUpperCase() || 'Gateway'} · {request.currency} {Number(request.amount ?? 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {request.phone_number && <span className="text-xs text-muted-foreground">{request.phone_number}</span>}
                    {['pending', 'initiated'].includes(String(request.status)) && request.response_payload?.environment === 'sandbox' && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs"
                          onClick={() => confirmBillingRequest.mutate(request.id)}
                          disabled={confirmBillingRequest.isPending || failBillingRequest.isPending || cancelBillingRequest.isPending}
                        >
                          Confirm
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs"
                          onClick={() => failBillingRequest.mutate(request.id)}
                          disabled={confirmBillingRequest.isPending || failBillingRequest.isPending || cancelBillingRequest.isPending}
                        >
                          Fail
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs"
                          onClick={() => cancelBillingRequest.mutate(request.id)}
                          disabled={confirmBillingRequest.isPending || failBillingRequest.isPending || cancelBillingRequest.isPending}
                        >
                          Cancel
                        </Button>
                      </>
                    )}
                    <Badge variant={request.status === 'succeeded' ? 'secondary' : 'outline'}>{request.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="bg-muted/20 border-b py-3 px-4">
          <CardTitle className="text-xs font-bold uppercase tracking-widest">Billing Providers</CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            Subscription billing methods are maintained by the SaaS administrator. The owner billing setup is used here for upgrades, downgrades, and future checkout flows.
          </p>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading billing providers…</p>
          ) : providers.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">
              No SaaS billing provider is active yet. Start by configuring the M-Pesa sandbox account in Platform Admin → Integrations.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {providers.map((provider: any) => (
                <div key={provider.id} className="rounded-2xl border p-4">
                  <div className="flex items-center gap-2">
                    {provider.provider === 'mpesa' ? <Smartphone className="h-4 w-4 text-emerald-600" /> : <CreditCard className="h-4 w-4 text-sky-600" />}
                    <p className="font-semibold">{provider.name}</p>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {provider.provider?.toUpperCase()} · {provider.payment_scope === 'saas_billing' ? 'SaaS billing' : 'Tenant collections'}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Rails: {(provider.enabled_rails ?? []).join(', ') || 'Configured'}
                  </p>
                  {provider.base_url && (
                    <p className="mt-1 text-xs text-muted-foreground break-all">{provider.base_url}</p>
                  )}
                </div>
              ))}
            </div>
          )}
          {data?.resolved_via_owner && (
            <p className="text-xs text-muted-foreground">
              These providers are coming from the SaaS owner billing setup so your organization can subscribe without maintaining its own billing gateway.
            </p>
          )}
          {(billingSummary.by_status ?? []).length > 0 && (
            <div className="space-y-2 pt-2">
              {(billingSummary.by_status ?? []).map((row: any) => (
                <div key={row.status} className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm">
                  <span className="capitalize">{row.status}</span>
                  <span className="text-muted-foreground">{row.count} · KES {Number(row.total ?? 0).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}

// ── Invite Dialog ──────────────────────────────────────────────────────────────

interface InviteResult {
  user: any;
  temp_password: string;
  email_sent?: boolean;
  email_error?: string;
}

function InviteDialog({ tenantId, branches, open, onClose, onInvited }: {
  tenantId: number;
  branches: any[];
  open: boolean;
  onClose: () => void;
  onInvited: (result: InviteResult) => void;
}) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    role_group: '',
    job_title: '',
    branch_id: '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const { data: rolesData, isLoading: rolesLoading } = useQuery({
    queryKey: ['tenant-custom-roles', tenantId],
    queryFn: () => api(token!, '/roles/?page_size=200'),
    enabled: open && !!token,
  });
  const tenantRoles: TenantRoleOption[] = (rolesData?.results ?? []).filter(
    (candidate: TenantRoleOption) => candidate.scope === 'tenant' && candidate.is_assignable !== false,
  );

  const mutation = useMutation({
    mutationFn: () => {
      const payload: any = {
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
      };
      if (form.role_group) payload.role_group = form.role_group;
      if (form.job_title) payload.job_title = form.job_title;
      if (form.branch_id) payload.branch_id = parseInt(form.branch_id);
      if (form.password) payload.password = form.password;
      return api(token!, `/tenants/${tenantId}/users/invite/`, 'POST', payload);
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['my-team', tenantId] });
      const data = r?.data ?? r;
      onInvited({
        user: data.user,
        temp_password: data.temp_password,
        email_sent: data.email_sent,
        email_error: data.email_error,
      });
      toast({
        title: data.email_sent ? 'User invited and email sent' : 'User created; email not sent',
        description: data.email_sent ? `Invitation delivered to ${data.user?.email}.` : data.email_error,
        variant: data.email_sent ? 'default' : 'destructive',
      });
      onClose();
    },
    onError: (e: any) => toast({ title: 'Invite failed', description: e.message, variant: 'destructive' }),
  });

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }));
  const valid = form.first_name.trim() && form.email.trim() && form.role_group;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Invite Team Member</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>First Name *</Label>
              <Input value={form.first_name} onChange={f('first_name')} placeholder="Jane" />
            </div>
            <div className="space-y-1.5">
              <Label>Last Name</Label>
              <Input value={form.last_name} onChange={f('last_name')} placeholder="Doe" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Email *</Label>
            <Input value={form.email} onChange={f('email')} type="email" placeholder="jane@company.com" />
          </div>
          <div className="space-y-1.5">
            <Label>Organization Role *</Label>
            <Select value={form.role_group} onValueChange={v => setForm(p => ({ ...p, role_group: v }))}>
              <SelectTrigger><SelectValue placeholder="Select a role…" /></SelectTrigger>
              <SelectContent>
                {tenantRoles.map(candidate => (
                  <SelectItem key={candidate.id} value={candidate.name}>
                    {candidate.display_name || candidate.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {rolesLoading
                ? 'Loading organization roles…'
                : tenantRoles.length
                  ? 'Roles are managed in Roles & Permissions.'
                  : 'Create an organization role in Roles & Permissions first.'}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Job Title</Label>
            <Input value={form.job_title} onChange={f('job_title')} placeholder="e.g. Weighbridge Operator" />
          </div>
          <div className="space-y-1.5">
            <Label>Password</Label>
            <div className="flex items-center gap-2">
              <Input
                value={form.password}
                onChange={f('password')}
                type={showPassword ? 'text' : 'password'}
                placeholder="Leave blank to auto-generate"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="p-1 text-muted-foreground"
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">Leave blank to generate a temporary password automatically.</p>
          </div>
          {branches.length > 0 && (
            <div className="space-y-1.5">
              <Label>Branch</Label>
              <Select value={form.branch_id} onValueChange={v => setForm(p => ({ ...p, branch_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Any branch" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any branch</SelectItem>
                  {branches.map((b: any) => (
                    <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!valid || mutation.isPending || (!!form.password && form.password.length < 8)}>
            {mutation.isPending ? 'Inviting…' : 'Send Invite'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Temp Password Banner ───────────────────────────────────────────────────────

function TempPasswordBanner({
  result,
  onDismiss,
  title,
  description,
}: {
  result: InviteResult;
  onDismiss: () => void;
  title?: string;
  description?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const copy = () => {
    navigator.clipboard.writeText(result.temp_password).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const name = [result.user?.first_name, result.user?.last_name].filter(Boolean).join(' ') || result.user?.username || 'User';
  const emailWasSent = result.email_sent === true;

  return (
    <Card className="border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
              {title ?? (emailWasSent ? `${name} invited — email sent` : `${name} created — share their temporary password`)}
            </p>
            <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
              Username: <span className="font-mono font-semibold">{result.user?.username}</span>
            </p>
            <div className="flex items-center gap-2 mt-2">
              <code className="flex-1 truncate rounded bg-emerald-100 dark:bg-emerald-900/40 px-2 py-1 text-sm font-mono text-emerald-900 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-700">
                {visible ? result.temp_password : '••••••••••••'}
              </code>
              <button
                onClick={() => setVisible(v => !v)}
                className="text-emerald-700 dark:text-emerald-400 hover:text-emerald-900 dark:hover:text-emerald-200 p-1"
                title={visible ? 'Hide' : 'Show'}
              >
                {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              <button
                onClick={copy}
                className="text-emerald-700 dark:text-emerald-400 hover:text-emerald-900 dark:hover:text-emerald-200 p-1"
                title="Copy password"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
            {copied && <p className="text-xs text-emerald-600 mt-1">Copied to clipboard!</p>}
            <p className="text-xs text-muted-foreground mt-1.5">
              {description ?? (emailWasSent
                ? `Credentials were sent to ${result.user?.email}. This password is shown only once as a backup.`
                : `${result.email_error ? `${result.email_error} ` : ''}This password is shown only once. Ask ${name} to change it immediately after first login.`)}
            </p>
          </div>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0 text-emerald-700" onClick={onDismiss}>✕</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Team Tab ───────────────────────────────────────────────────────────────────

function TeamEditUserDialog({
  open,
  onClose,
  user,
  tenantId,
  branches,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  user: any;
  tenantId: number;
  branches: any[];
  onSaved: (updatedUser: any, password?: string) => void;
}) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showPassword, setShowPassword] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    username: '',
    job_title: '',
    branch_id: '',
    password: '',
    is_active: true,
  });

  useEffect(() => {
    if (!user) return;
    setForm({
      first_name: user.first_name ?? '',
      last_name: user.last_name ?? '',
      email: user.email ?? '',
      username: user.username ?? '',
      job_title: user.tenant_profile?.job_title ?? user.job_title ?? '',
      branch_id: user.tenant_profile?.branch?.id ? String(user.tenant_profile.branch.id) : (user.branch_id ? String(user.branch_id) : ''),
      password: '',
      is_active: user.is_active ?? true,
    });
    const tenantRole = (user.groups ?? []).find((group: any) =>
      String(typeof group === 'string' ? group : group?.name ?? '').startsWith(`tenant:${tenantId}:`),
    );
    setSelectedRoleId(tenantRole && typeof tenantRole !== 'string' ? String(tenantRole.id) : '');
  }, [user]);

  const { data: rolesData } = useQuery({
    queryKey: ['tenant-custom-roles', tenantId],
    queryFn: () => api(token!, '/roles/?page_size=200'),
    enabled: open && !!token,
  });
  const tenantRoles: TenantRoleOption[] = (rolesData?.results ?? []).filter(
    (candidate: TenantRoleOption) => candidate.scope === 'tenant' && candidate.is_assignable !== false,
  );
  const userIsOrganizationAdmin = Boolean(user?.is_org_admin ?? user?.is_tenant_admin);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
        username: form.username,
        job_title: form.job_title,
        branch_id: form.branch_id || null,
        is_active: form.is_active,
      };
      if (form.password.trim()) payload.password = form.password.trim();
      const updated = await api(token!, `/users/${user.id}/update/`, 'PATCH', payload);
      if (!userIsOrganizationAdmin && selectedRoleId) {
        await api(token!, `/users/${user.id}/assign-roles/`, 'POST', {
          group_ids: [Number(selectedRoleId)],
          replace_existing: true,
        });
      }
      return updated;
    },
    onSuccess: (response) => {
      qc.invalidateQueries({ queryKey: ['my-team'] });
      qc.invalidateQueries({ queryKey: ['platform-users'] });
      toast({ title: 'User updated' });
      onSaved(response?.data ?? response, form.password.trim() || undefined);
      onClose();
    },
    onError: (e: any) => toast({ title: 'Update failed', description: e.message, variant: 'destructive' }),
  });

  const field = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((current) => ({ ...current, [key]: value }));
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Edit User</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>First Name</Label>
              <Input value={form.first_name} onChange={field('first_name')} />
            </div>
            <div className="space-y-1.5">
              <Label>Last Name</Label>
              <Input value={form.last_name} onChange={field('last_name')} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={form.email} onChange={field('email')} type="email" />
            </div>
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input value={form.username} onChange={field('username')} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Job Title</Label>
            <Input value={form.job_title} onChange={field('job_title')} />
          </div>
          {!userIsOrganizationAdmin && (
            <div className="space-y-1.5">
              <Label>Organization Role *</Label>
              <Select value={selectedRoleId} onValueChange={setSelectedRoleId}>
                <SelectTrigger><SelectValue placeholder="Select a role…" /></SelectTrigger>
                <SelectContent>
                  {tenantRoles.map(candidate => (
                    <SelectItem key={candidate.id} value={String(candidate.id)}>
                      {candidate.display_name || candidate.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Only roles created for this organization are shown.</p>
            </div>
          )}
          {branches.length > 0 && (
            <div className="space-y-1.5">
              <Label>Branch</Label>
              <Select value={form.branch_id || '__none__'} onValueChange={(value) => setForm((current) => ({ ...current, branch_id: value === '__none__' ? '' : value }))}>
                <SelectTrigger><SelectValue placeholder="No branch" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No branch</SelectItem>
                  {branches.map((branch: any) => (
                    <SelectItem key={branch.id} value={String(branch.id)}>{branch.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>New Password</Label>
            <div className="flex items-center gap-2">
              <Input
                value={form.password}
                onChange={field('password')}
                type={showPassword ? 'text' : 'password'}
                placeholder="Leave blank to keep current password"
              />
              <button type="button" onClick={() => setShowPassword((current) => !current)} className="p-1 text-muted-foreground" title={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">Use this to set a specific password directly.</p>
          </div>
          <div className="flex items-center justify-between rounded border px-3 py-2 text-sm">
            <span>Active user</span>
            <input type="checkbox" checked={form.is_active} onChange={field('is_active')} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.username.trim() || (!userIsOrganizationAdmin && !selectedRoleId) || (!!form.password && form.password.length < 8)}>
            {mutation.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TeamTab({ tenantId, branches }: { tenantId: number; branches: any[] }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [lastInvite, setLastInvite] = useState<InviteResult | null>(null);
  const [passwordNotice, setPasswordNotice] = useState<InviteResult | null>(null);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [usersPage, setUsersPage] = useState(1);
  const [usersPageSize, setUsersPageSize] = useState(10);

  const { data: teamData, isLoading } = useQuery({
    queryKey: ['my-team', tenantId],
    queryFn: () => api(token!, `/tenants/${tenantId}/users/`),
    enabled: !!tenantId,
  });

  const users: any[] = teamData?.data?.users ?? teamData?.users ?? [];
  const filteredUsers = users.filter((user) => {
    const query = userSearch.trim().toLowerCase();
    if (!query) return true;
    return [
      user.first_name,
      user.last_name,
      user.username,
      user.email,
      user.tenant_profile?.job_title,
      ...(user.groups ?? []).map((group: any) => typeof group === 'string' ? group : group.name),
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
  const usersPageCount = Math.max(1, Math.ceil(filteredUsers.length / usersPageSize));
  const paginatedUsers = filteredUsers.slice((usersPage - 1) * usersPageSize, usersPage * usersPageSize);

  useEffect(() => {
    setUsersPage((current) => Math.min(current, usersPageCount));
  }, [usersPageCount]);

  useEffect(() => {
    setUsersPage(1);
  }, [userSearch, usersPageSize]);

  const toggleActive = useMutation({
    mutationFn: ({ userId, isActive }: { userId: number; isActive: boolean }) =>
      api(token!, `/users/${userId}/update/`, 'PATCH', { is_active: isActive }),
    onSuccess: (_, vars) => {
      toast({ title: vars.isActive ? 'User reactivated' : 'User deactivated' });
      qc.invalidateQueries({ queryKey: ['my-team', tenantId] });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const resetPassword = useMutation({
    mutationFn: async (userRecord: any) => {
      const tempPassword = generateTempPassword(12);
      const response = await api(token!, `/users/${userRecord.id}/update/`, 'PATCH', { password: tempPassword });
      return {
        response,
        tempPassword,
        user: userRecord,
      };
    },
    onSuccess: ({ response, tempPassword, user: userRecord }) => {
      qc.invalidateQueries({ queryKey: ['my-team', tenantId] });
      setPasswordNotice({
        user: response?.data ?? userRecord,
        temp_password: tempPassword,
      });
      toast({ title: 'Password reset' });
    },
    onError: (e: any) => toast({ title: 'Reset failed', description: e.message, variant: 'destructive' }),
  });

  const getRoleLabel = (user: any) => {
    const groups: any[] = user.groups ?? [];
    if (!groups.length) return null;
    return groups
      .map((g: any) => (typeof g === 'string' ? g : g.name))
      .map((name: string) => name.startsWith('tenant:') ? (name.split(':', 3)[2] || name) : name)
      .map((name: string) => (name === 'Tenant Admin' ? 'System Administrator' : name))
      .join(', ');
  };

  return (
    <div className="space-y-4">
      {lastInvite && (
        <TempPasswordBanner result={lastInvite} onDismiss={() => setLastInvite(null)} />
      )}
      {passwordNotice && (
        <TempPasswordBanner
          result={passwordNotice}
          onDismiss={() => setPasswordNotice(null)}
          title="Password reset complete — share the temporary password"
          description="This password is shown only once. Share it securely and ask the user to change it after login."
        />
      )}

      <div className="flex flex-col gap-3 rounded-lg border bg-card">
        <div className="flex flex-col gap-3 border-b px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 items-center gap-2 rounded-md border px-3 py-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              placeholder="Search users by name, email, role, or title..."
              value={userSearch}
              onChange={(event) => setUserSearch(event.target.value)}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            />
            {userSearch && (
              <button type="button" onClick={() => setUserSearch('')} className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {isLoading ? 'Loading…' : `${filteredUsers.length} user${filteredUsers.length !== 1 ? 's' : ''}`}
            </p>
            <Button size="sm" onClick={() => setInviteOpen(true)} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Invite Member
            </Button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">Loading team…</CardContent></Card>
      ) : filteredUsers.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">{userSearch ? 'No users match your search.' : 'No team members yet. Invite your first member.'}</CardContent></Card>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="space-y-2 p-4">
            {paginatedUsers.map((u: any) => {
              const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username;
              const roleLabel = getRoleLabel(u);
              const isActive = u.is_active ?? true;
              const isSelf = u.id === (token ? undefined : undefined); // we don't block self in UI, backend handles it
              return (
                <Card key={u.id}>
                  <CardContent className="p-4 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm">{fullName}</p>
                        {roleLabel && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                            {roleLabel}
                          </Badge>
                        )}
                        {!isActive && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground">
                            Inactive
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {[u.email, u.username !== u.email ? `@${u.username}` : null, u.tenant_profile?.job_title].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1.5 text-xs shrink-0"
                      onClick={() => setEditingUser(u)}
                      title="Edit user"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1.5 text-xs shrink-0"
                      disabled={resetPassword.isPending}
                      onClick={() => resetPassword.mutate(u)}
                      title="Reset password"
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Reset Password
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className={`gap-1.5 text-xs shrink-0 ${isActive ? 'text-destructive hover:text-destructive' : 'text-emerald-600 hover:text-emerald-700'}`}
                      disabled={toggleActive.isPending}
                      onClick={() => toggleActive.mutate({ userId: u.id, isActive: !isActive })}
                      title={isActive ? 'Deactivate user' : 'Reactivate user'}
                    >
                      {isActive
                        ? <><UserX className="h-3.5 w-3.5" /> Deactivate</>
                        : <><UserCheck className="h-3.5 w-3.5" /> Reactivate</>
                      }
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <ListPagination
            page={usersPage}
            pageSize={usersPageSize}
            totalCount={filteredUsers.length}
            onPage={setUsersPage}
            onPageSize={setUsersPageSize}
          />
        </div>
      )}

      {inviteOpen && (
        <InviteDialog
          tenantId={tenantId}
          branches={branches}
          open={inviteOpen}
          onClose={() => setInviteOpen(false)}
          onInvited={(result) => {
            setLastInvite(result);
            setInviteOpen(false);
          }}
        />
      )}
      {editingUser && (
        <TeamEditUserDialog
          open={!!editingUser}
          onClose={() => setEditingUser(null)}
          user={editingUser}
          tenantId={tenantId}
          branches={branches}
          onSaved={(updatedUser, password) => {
            if (!password) return;
            setPasswordNotice({
              user: updatedUser,
              temp_password: password,
            });
          }}
        />
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function OrganizationSettings() {
  const { token, user, role, refreshUser } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const organizationId = (user as any)?.organization_id ?? (user as any)?.tenant_id;

  const { data: tenantData, isLoading: tenantLoading } = useQuery({
    queryKey: ['my-tenant', organizationId],
    queryFn: () => api(token!, `/tenants/self/`),
    enabled: !!token,
  });
  const { data: settingsData, isLoading: settingsLoading, dataUpdatedAt: settingsDataUpdatedAt } = useQuery({
    queryKey: ['my-tenant-settings', organizationId],
    queryFn: () => api(token!, `/tenants/${organizationId}/settings/`),
    enabled: !!organizationId,
  });
  const { data: branchData, refetch: refetchBranches } = useQuery({
    queryKey: ['my-branches', organizationId],
    queryFn: () => api(token!, `/tenants/${organizationId}/branches/`),
    enabled: !!organizationId,
  });
  const { data: templateData, refetch: refetchTemplates } = useQuery({
    queryKey: ['tenant-document-templates', organizationId],
    queryFn: () => api(token!, `/documents/templates/?page_size=200`),
    enabled: !!organizationId,
  });

  const tenant = tenantData?.data ?? tenantData ?? {};
  const settings = settingsData?.data ?? settingsData ?? {};
  const branches: any[] = branchData?.data?.branches ?? branchData?.results ?? [];
  const templates: any[] = templateData?.results ?? templateData?.data?.results ?? templateData?.data ?? templateData ?? [];
  const canManagePublicSite = role === 'superadmin' || role === 'tenant_admin';
  const publicSiteTitle = role === 'superadmin' ? 'Platform Public Site' : 'Organization Public Site';
  const publicLandingUrl = role === 'superadmin'
    ? '/landing'
    : (tenant.code ? `/landing/${tenant.code}` : '/landing');
  const publicLoginUrl = role === 'superadmin'
    ? '/login'
    : (tenant.code ? `/login/${tenant.code}` : '/login');
  const publicSupportUrl = role === 'superadmin'
    ? '/landing/support'
    : (tenant.code ? `/landing/${tenant.code}/support` : '/landing/support');

  const [tenantForm, setTenantForm] = useState<any>(null);
  const [settingsForm, setSettingsForm] = useState<any>(null);
  const [branchDialog, setBranchDialog] = useState<{ open: boolean; branch?: any }>({ open: false });
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [organizationDialogOpen, setOrganizationDialogOpen] = useState(false);
  const [organizationSearch, setOrganizationSearch] = useState('');
  const [organizationsPage, setOrganizationsPage] = useState(1);
  const [organizationsPageSize, setOrganizationsPageSize] = useState(10);
  const [newOrganizationForm, setNewOrganizationForm] = useState({
    name: '',
    legal_name: '',
    contact_email: (user as any)?.email ?? '',
    contact_phone: '',
    industry_id: '',
  });
  const organizationBrandColor = settingsForm?.primary_color ?? settings?.primary_color ?? '#E85D26';
  const memberships: any[] = Array.isArray((user as any)?.memberships) ? (user as any).memberships : [];
  const activeMembershipId = (user as any)?.active_membership_id ? String((user as any).active_membership_id) : '';

  const { data: organizationsData } = useQuery({
    queryKey: ['my-organizations'],
    queryFn: () => api(token!, '/tenants/?page_size=100'),
    enabled: !!token,
  });
  const { data: industriesData } = useQuery({
    queryKey: ['industry-master-data'],
    queryFn: () => api(token!, '/industries/?page_size=100'),
    enabled: !!token,
  });
  const organizations: any[] = organizationsData?.results ?? [];
  const industries: any[] = industriesData?.results ?? [];
  const filteredMemberships = memberships.filter((membership: any) => {
    const query = organizationSearch.trim().toLowerCase();
    if (!query) return true;
    const org = organizations.find((entry: any) => entry.id === membership.tenant) ?? {};
    return [
      membership.organization_name,
      membership.tenant_name,
      membership.role,
      membership.branch_name,
      org.contact_email,
      org.contact_phone,
      org.legal_name,
      org.code,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
  const organizationPageCount = Math.max(1, Math.ceil(filteredMemberships.length / organizationsPageSize));
  const paginatedMemberships = filteredMemberships.slice(
    (organizationsPage - 1) * organizationsPageSize,
    organizationsPage * organizationsPageSize,
  );

  useEffect(() => {
    setOrganizationsPage((current) => Math.min(current, organizationPageCount));
  }, [organizationPageCount]);

  useEffect(() => {
    setOrganizationsPage(1);
  }, [organizationSearch, organizationsPageSize]);

  const switchOrganization = useMutation({
    mutationFn: (membershipId: string) => api(token!, '/auth/switch-organization/', 'POST', { membership_id: Number(membershipId) }),
    onSuccess: async () => {
      setTenantForm(null);
      setSettingsForm(null);
      await refreshUser();
      await qc.invalidateQueries({ queryKey: ['my-tenant'] });
      await qc.invalidateQueries({ queryKey: ['my-tenant-settings'] });
      await qc.invalidateQueries({ queryKey: ['my-branches'] });
      await qc.invalidateQueries({ queryKey: ['my-team'] });
      await qc.invalidateQueries({ queryKey: ['tenant-document-templates'] });
      toast({ title: 'Organization switched' });
    },
    onError: (e: any) => toast({ title: 'Switch failed', description: e.message, variant: 'destructive' }),
  });

  const buildSettingsForm = (source: any) => {
    const portUsesImplicitSsl = Number(source?.smtp_port) === 465;
    const normalizeLegacyPort465 = portUsesImplicitSsl && source?.smtp_use_tls !== false;
    return ({
    ...source,
    smtp_use_ssl: Boolean(source?.smtp_use_ssl || normalizeLegacyPort465),
    smtp_use_tls: normalizeLegacyPort465 ? false : (source?.smtp_use_tls ?? true),
    login_page_config: {
      ...DEFAULT_LOGIN_PAGE_CONFIG,
      ...(source?.login_page_config ?? {}),
    },
    footer_menu: Array.isArray(source?.footer_menu) ? source.footer_menu : [],
    landing_page_config: {
      ...DEFAULT_LANDING_PAGE_CONFIG,
      ...(source?.landing_page_config ?? {}),
      support_page: {
        ...DEFAULT_SUPPORT_PAGE_CONFIG,
        subheadline: `Contact ${source?.tenant?.name ?? tenant?.name ?? 'our team'} for support, billing, account, or service questions.`,
        form_fields: Array.isArray(source?.landing_page_config?.support_page?.form_fields)
          ? source.landing_page_config.support_page.form_fields
          : DEFAULT_SUPPORT_PAGE_CONFIG.form_fields,
        ...(source?.landing_page_config?.support_page ?? {}),
      },
      highlights: Array.isArray(source?.landing_page_config?.highlights)
        ? source.landing_page_config.highlights
        : DEFAULT_LANDING_PAGE_CONFIG.highlights,
    },
    smtp_password: '',
    invoice_template_id: source?.invoice_template?.id ?? null,
    estimate_template_id: source?.estimate_template?.id ?? null,
    receipt_template_id: source?.receipt_template?.id ?? null,
    purchase_order_template_id: source?.purchase_order_template?.id ?? null,
    statement_template_id: source?.statement_template?.id ?? null,
  });
  };

  useEffect(() => {
    if (!tenant?.id) {
      setTenantForm(null);
      return;
    }
    setTenantForm({
      name: tenant.name ?? '',
      legal_name: tenant.legal_name ?? '',
      contact_email: tenant.contact_email ?? '',
      contact_phone: tenant.contact_phone ?? '',
      industry_id: tenant.industry?.id ? String(tenant.industry.id) : '',
      default_currency: tenant.default_currency ?? 'KES',
      timezone: tenant.timezone ?? 'Africa/Nairobi',
    });
  }, [activeMembershipId, tenant?.id, tenant?.name, tenant?.legal_name, tenant?.contact_email, tenant?.contact_phone, tenant?.industry?.id, tenant?.default_currency, tenant?.timezone]);

  useEffect(() => {
    if (!organizationId || settingsLoading) {
      setSettingsForm(null);
      return;
    }
    const hasSettingsPayload = settings && typeof settings === 'object';
    if (!hasSettingsPayload) return;
    setSettingsForm(buildSettingsForm(settings));
  }, [activeMembershipId, organizationId, settingsLoading, settingsDataUpdatedAt]);

  const saveTenant = useMutation({
    mutationFn: () => api(token!, `/tenants/self/`, 'PATCH', {
      ...tenantForm,
      industry_id: tenantForm?.industry_id ? Number(tenantForm.industry_id) : null,
    }),
    onSuccess: () => { toast({ title: 'Organization profile saved' }); qc.invalidateQueries({ queryKey: ['my-tenant'] }); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });
  const createOrganization = useMutation({
    mutationFn: () => api(token!, '/tenants/', 'POST', {
      ...newOrganizationForm,
      industry_id: newOrganizationForm.industry_id ? Number(newOrganizationForm.industry_id) : undefined,
    }),
    onSuccess: async () => {
      toast({ title: 'Organization created' });
      await refreshUser();
      await qc.invalidateQueries({ queryKey: ['my-organizations'] });
      await qc.invalidateQueries({ queryKey: ['my-tenant'] });
      await qc.invalidateQueries({ queryKey: ['my-tenant-settings'] });
      await qc.invalidateQueries({ queryKey: ['my-branches'] });
      setNewOrganizationForm({
        name: '',
        legal_name: '',
        contact_email: (user as any)?.email ?? '',
        contact_phone: '',
        industry_id: '',
      });
    },
    onError: (e: any) => toast({ title: 'Create failed', description: e.message, variant: 'destructive' }),
  });
  const saveSettings = useMutation({
    mutationFn: (fields: readonly string[]) => api(
      token!,
      `/tenants/${organizationId}/settings/`,
      'PUT',
      buildSettingsPayload(settingsForm, fields),
    ),
    onSuccess: (response) => {
      const saved = response?.data ?? response;
      setSettingsForm(buildSettingsForm(saved));
      toast({ title: 'Settings saved' });
      qc.setQueryData(['my-tenant-settings', organizationId], response);
      qc.setQueryData(['dashboard-tenant-settings', organizationId, token], saved);
      void qc.invalidateQueries({ queryKey: ['public-site-config'] });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });
  const testSmtp = useMutation({
    mutationFn: async () => {
      const payload = buildSettingsPayload(settingsForm, EMAIL_SETTINGS_FIELDS);
      await api(token!, `/tenants/${organizationId}/settings/`, 'PUT', payload);
      return api(token!, `/tenants/${organizationId}/settings/test-smtp/`, 'POST');
    },
    onSuccess: (r) => toast({ title: 'Test email sent', description: r.data?.message }),
    onError: (e: any) => toast({ title: 'Test failed', description: e.message, variant: 'destructive' }),
  });

  const tf = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setTenantForm((p: any) => ({ ...p, [k]: e.target.value }));
  const sf = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setSettingsForm((p: any) => ({ ...p, [k]: e.target.value }));
  const updateLoginPageField = (key: string, value: unknown) =>
    setSettingsForm((p: any) => ({
      ...p,
      login_page_config: { ...(p?.login_page_config ?? {}), [key]: value },
    }));
  const updateLandingPageField = (key: string, value: unknown) =>
    setSettingsForm((p: any) => ({
      ...p,
      landing_page_config: { ...(p?.landing_page_config ?? {}), [key]: value },
    }));
  const updateLandingHighlight = (index: number, value: string) =>
    setSettingsForm((p: any) => {
      const current = Array.isArray(p?.landing_page_config?.highlights) ? [...p.landing_page_config.highlights] : [];
      current[index] = value;
      return {
        ...p,
        landing_page_config: { ...(p?.landing_page_config ?? {}), highlights: current },
      };
    });
  const addLandingHighlight = () =>
    setSettingsForm((p: any) => ({
      ...p,
      landing_page_config: {
        ...(p?.landing_page_config ?? {}),
        highlights: [...(Array.isArray(p?.landing_page_config?.highlights) ? p.landing_page_config.highlights : []), ''],
      },
    }));
  const updateSupportPageField = (key: string, value: string) =>
    setSettingsForm((p: any) => ({
      ...p,
      landing_page_config: {
        ...(p?.landing_page_config ?? {}),
        support_page: { ...(p?.landing_page_config?.support_page ?? {}), [key]: value },
      },
    }));
  const updateSupportHighlight = (index: number, value: string) =>
    setSettingsForm((p: any) => {
      const current = Array.isArray(p?.landing_page_config?.support_page?.highlights)
        ? [...p.landing_page_config.support_page.highlights]
        : [];
      current[index] = value;
      return {
        ...p,
        landing_page_config: {
          ...(p?.landing_page_config ?? {}),
          support_page: { ...(p?.landing_page_config?.support_page ?? {}), highlights: current },
        },
      };
    });
  const addSupportHighlight = () =>
    setSettingsForm((p: any) => ({
      ...p,
      landing_page_config: {
        ...(p?.landing_page_config ?? {}),
        support_page: {
          ...(p?.landing_page_config?.support_page ?? {}),
          highlights: [...(Array.isArray(p?.landing_page_config?.support_page?.highlights) ? p.landing_page_config.support_page.highlights : []), ''],
        },
      },
    }));
  const removeSupportHighlight = (index: number) =>
    setSettingsForm((p: any) => ({
      ...p,
      landing_page_config: {
        ...(p?.landing_page_config ?? {}),
        support_page: {
          ...(p?.landing_page_config?.support_page ?? {}),
          highlights: (Array.isArray(p?.landing_page_config?.support_page?.highlights) ? p.landing_page_config.support_page.highlights : []).filter((_: string, currentIndex: number) => currentIndex !== index),
        },
      },
    }));
  const updateSupportFormField = (index: number, key: string, value: any) =>
    setSettingsForm((p: any) => {
      const fields = Array.isArray(p?.landing_page_config?.support_page?.form_fields)
        ? [...p.landing_page_config.support_page.form_fields]
        : [...DEFAULT_SUPPORT_FORM_FIELDS];
      fields[index] = { ...(fields[index] ?? {}), [key]: value };
      return {
        ...p,
        landing_page_config: {
          ...(p?.landing_page_config ?? {}),
          support_page: { ...(p?.landing_page_config?.support_page ?? {}), form_fields: fields },
        },
      };
    });
  const addSupportFormField = () =>
    setSettingsForm((p: any) => ({
      ...p,
      landing_page_config: {
        ...(p?.landing_page_config ?? {}),
        support_page: {
          ...(p?.landing_page_config?.support_page ?? {}),
          form_fields: [
            ...(Array.isArray(p?.landing_page_config?.support_page?.form_fields) ? p.landing_page_config.support_page.form_fields : []),
            { key: `custom_field_${Date.now()}`, label: 'Custom question', type: 'text', placeholder: '', required: false, enabled: true, options: [] },
          ],
        },
      },
    }));
  const removeSupportFormField = (index: number) =>
    setSettingsForm((p: any) => ({
      ...p,
      landing_page_config: {
        ...(p?.landing_page_config ?? {}),
        support_page: {
          ...(p?.landing_page_config?.support_page ?? {}),
          form_fields: (Array.isArray(p?.landing_page_config?.support_page?.form_fields) ? p.landing_page_config.support_page.form_fields : []).filter((_: any, currentIndex: number) => currentIndex !== index),
        },
      },
    }));
  const removeLandingHighlight = (index: number) =>
    setSettingsForm((p: any) => ({
      ...p,
      landing_page_config: {
        ...(p?.landing_page_config ?? {}),
        highlights: (Array.isArray(p?.landing_page_config?.highlights) ? p.landing_page_config.highlights : []).filter((_: string, currentIndex: number) => currentIndex !== index),
      },
    }));
  const updateFooterMenuItem = (index: number, key: 'label' | 'href', value: string) =>
    setSettingsForm((p: any) => {
      const items = Array.isArray(p?.footer_menu) ? [...p.footer_menu] : [];
      items[index] = { ...(items[index] ?? { label: '', href: '' }), [key]: value };
      return { ...p, footer_menu: items };
    });
  const addFooterMenuItem = () =>
    setSettingsForm((p: any) => ({
      ...p,
      footer_menu: [...(Array.isArray(p?.footer_menu) ? p.footer_menu : []), { label: '', href: '' }],
    }));
  const removeFooterMenuItem = (index: number) =>
    setSettingsForm((p: any) => ({
      ...p,
      footer_menu: (Array.isArray(p?.footer_menu) ? p.footer_menu : []).filter((_: unknown, currentIndex: number) => currentIndex !== index),
    }));

  const uploadLogo = async (file: File) => {
    setUploadingLogo(true);
    try {
      const fd = new FormData();
      fd.append('logo_file', file);
      const res = await fetch(`${BASE}/tenants/${organizationId}/settings/`, {
        method: 'PUT',
        headers: { Authorization: `Token ${token}` },
        body: fd,
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.detail || j?.error || JSON.stringify(j));
      const saved = j?.data ?? j;
      toast({ title: 'Logo uploaded' });
      qc.setQueryData(['my-tenant-settings', organizationId], j);
      qc.setQueryData(['dashboard-tenant-settings', organizationId, token], saved);
      void qc.invalidateQueries({ queryKey: ['public-site-config'] });
      setSettingsForm(buildSettingsForm(saved));
    } catch (e: any) {
      toast({ title: 'Logo upload failed', description: e.message, variant: 'destructive' });
    } finally {
      setUploadingLogo(false);
    }
  };

  const templatesByType = (documentType: string) =>
    templates.filter((t: any) => t.document_type === documentType && t.is_active !== false);

  const templateTypeMap = new Map(DOCUMENT_TYPES.map((documentType) => [documentType.value, documentType]));

  const previewTemplate = async (templateId: number) => {
    try {
      const res = await fetch(`${BASE}/documents/templates/${templateId}/preview/`, {
        headers: { Authorization: `Token ${token}` },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.detail || j?.error || `Preview failed (${res.status})`);
      }
      const html = await res.text();
      openPreviewWindow(html);
    } catch (e: any) {
      toast({ title: 'Preview failed', description: e.message, variant: 'destructive' });
    }
  };

  if (!organizationId) return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="border-b pb-4">
        <h1 className="text-2xl font-bold tracking-tight">Organization Settings</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Start by creating your first organization, then add teams, modules, and settings from here.</p>
      </div>

      <Card>
        <CardHeader className="bg-muted/20 border-b py-3 px-4">
          <CardTitle className="text-xs font-bold uppercase tracking-widest">Create First Organization</CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5 md:col-span-2">
              <Label>Organization Name</Label>
              <Input value={newOrganizationForm.name} onChange={(e) => setNewOrganizationForm((current) => ({ ...current, name: e.target.value }))} placeholder="Acme Holdings" />
            </div>
            <div className="space-y-1.5">
              <Label>Legal Name</Label>
              <Input value={newOrganizationForm.legal_name} onChange={(e) => setNewOrganizationForm((current) => ({ ...current, legal_name: e.target.value }))} placeholder="Acme Holdings Limited" />
            </div>
            <div className="space-y-1.5">
              <Label>Contact Email</Label>
              <Input type="email" value={newOrganizationForm.contact_email} onChange={(e) => setNewOrganizationForm((current) => ({ ...current, contact_email: e.target.value }))} placeholder="admin@acme.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={newOrganizationForm.contact_phone} onChange={(e) => setNewOrganizationForm((current) => ({ ...current, contact_phone: e.target.value }))} placeholder="+254..." />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>Industry</Label>
              <Select
                value={newOrganizationForm.industry_id}
                onValueChange={(value) => setNewOrganizationForm((current) => ({ ...current, industry_id: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select an industry" />
                </SelectTrigger>
                <SelectContent>
                  {industries.map((industry: any) => (
                    <SelectItem key={industry.id} value={String(industry.id)}>{industry.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Industry master data is maintained by the SaaS administrator and helps drive module, plan, and subscription alignment.
              </p>
            </div>
          </div>
          <div className="rounded-2xl border bg-muted/20 p-4 text-sm text-muted-foreground">
            Create one organization now. You can add more organizations, and the selected industry will help guide module recommendations, plans, and subscription setup later.
          </div>
          <Button onClick={() => createOrganization.mutate()} disabled={createOrganization.isPending || !newOrganizationForm.name.trim()}>
            {createOrganization.isPending ? 'Creating…' : 'Create Organization'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div
      className="w-full max-w-[1600px] grid grid-cols-1 gap-5 rounded-3xl p-1 xl:grid-cols-[330px_minmax(0,1fr)] xl:items-start"
      style={{ backgroundImage: `radial-gradient(circle at 0 0, color-mix(in srgb, ${organizationBrandColor} 14%, transparent), transparent 46%)` }}
    >
      <div className="border-b border-border/70 pb-4 xl:col-span-2">
        <h1 className="text-2xl font-bold tracking-tight">Organizations</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:col-start-1">
        <Card className="overflow-hidden border-border/70 bg-card/95 shadow-sm xl:flex xl:max-h-[calc(100vh-12rem)] xl:flex-col">
          <CardHeader className="border-b border-border/70 py-3 px-4">
            <CardTitle className="text-xs font-bold uppercase tracking-widest flex items-center justify-between">
              <span>Organizations</span>
              <Button size="sm" onClick={() => setOrganizationDialogOpen(true)} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> New Organization
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 p-3 xl:flex-1">
            {organizations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No organizations found.</p>
            ) : (
              <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card xl:h-full">
                <div className="border-b px-3 py-3">
                  <div className="flex items-center gap-2 rounded-md border px-3 py-2">
                    <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <input
                      placeholder="Search organizations..."
                      value={organizationSearch}
                      onChange={(event) => setOrganizationSearch(event.target.value)}
                      className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
                    />
                    {organizationSearch && (
                      <button type="button" onClick={() => setOrganizationSearch('')} className="text-muted-foreground hover:text-foreground">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                  {paginatedMemberships.length === 0 ? (
                    <div className="rounded-xl border px-4 py-10 text-center text-sm text-muted-foreground">
                      No organizations match your search.
                    </div>
                  ) : (
                    paginatedMemberships.map((membership: any) => {
                      const org = organizations.find((entry: any) => entry.id === membership.tenant) ?? {};
                      return (
                        <div key={membership.id} className="rounded-xl border p-3 flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-sm">{membership.organization_name ?? membership.tenant_name}</p>
                            <p className="text-xs text-muted-foreground">{org.code ? `Code ${org.code}` : membership.role}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {membership.is_default && <Badge variant="secondary">Active</Badge>}
                            {!membership.is_default && (
                              <Button size="sm" variant="outline" onClick={() => switchOrganization.mutate(String(membership.id))} disabled={switchOrganization.isPending}>
                                Switch
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                <ListPagination
                  page={organizationsPage}
                  pageSize={organizationsPageSize}
                  totalCount={filteredMemberships.length}
                  onPage={setOrganizationsPage}
                  onPageSize={setOrganizationsPageSize}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="company" className="w-full xl:col-start-2 xl:row-start-2">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 rounded-none border-b border-orange-100 bg-transparent p-0">
          <TabsTrigger value="company" className="gap-1.5"><Building2 className="h-3.5 w-3.5" /> Profile</TabsTrigger>
          <TabsTrigger value="branding" className="gap-1.5"><Palette className="h-3.5 w-3.5" /> Branding</TabsTrigger>
          {canManagePublicSite && (
            <TabsTrigger value="public-site" className="gap-1.5"><Globe2 className="h-3.5 w-3.5" /> Public Site</TabsTrigger>
          )}
          <TabsTrigger value="email" className="gap-1.5"><Mail className="h-3.5 w-3.5" /> Email</TabsTrigger>
          <TabsTrigger value="invoicing" className="gap-1.5"><FileText className="h-3.5 w-3.5" /> Invoicing</TabsTrigger>
          <TabsTrigger value="templates" className="gap-1.5"><LayoutTemplate className="h-3.5 w-3.5" /> Templates</TabsTrigger>
          <TabsTrigger value="users" className="gap-1.5"><Users className="h-3.5 w-3.5" /> Users</TabsTrigger>
          <TabsTrigger value="branches" className="gap-1.5"><GitBranch className="h-3.5 w-3.5" /> Branches</TabsTrigger>
        </TabsList>

        {/* ── Organization Profile Tab ──────────────────────────────────── */}
        <TabsContent value="company" className="mt-6">
          <Tabs defaultValue="profile" className="w-full">
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
              <TabsTrigger value="profile" className="gap-1.5"><Building2 className="h-3.5 w-3.5" /> Profile</TabsTrigger>
              <TabsTrigger value="subscription" className="gap-1.5"><CreditCard className="h-3.5 w-3.5" /> Subscription</TabsTrigger>
              <TabsTrigger value="billing" className="gap-1.5"><Smartphone className="h-3.5 w-3.5" /> Billing</TabsTrigger>
            </TabsList>

            <TabsContent value="profile" className="mt-6">
              {tenantForm && (
                <div className="space-y-5">
                  <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.85fr)]">
                    <Card className="overflow-hidden border-orange-100 shadow-sm">
                      <CardHeader className="border-b border-orange-100 bg-[linear-gradient(135deg,#fff7ed_0%,#ffffff_76%)] py-4 px-5">
                        <CardTitle className="text-base">Company Details</CardTitle>
                      </CardHeader>
                      <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label>Organization Name *</Label>
                          <Input value={tenantForm.name ?? ''} onChange={tf('name')} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Legal Name</Label>
                          <Input value={tenantForm.legal_name ?? ''} onChange={tf('legal_name')} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Contact Email</Label>
                          <Input value={tenantForm.contact_email ?? ''} onChange={tf('contact_email')} type="email" />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Phone</Label>
                          <Input value={tenantForm.contact_phone ?? ''} onChange={tf('contact_phone')} />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label>Industry</Label>
                          <Select value={tenantForm.industry_id ?? '__none__'} onValueChange={v => setTenantForm((p: any) => ({ ...p, industry_id: v === '__none__' ? '' : v }))}>
                            <SelectTrigger><SelectValue placeholder="Select an industry" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">Not set</SelectItem>
                              {industries.map((industry: any) => <SelectItem key={industry.id} value={String(industry.id)}>{industry.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="h-fit overflow-hidden border-orange-100 shadow-sm">
                      <CardHeader className="border-b border-orange-100 bg-[linear-gradient(135deg,#fff7ed_0%,#ffffff_76%)] py-4 px-5">
                        <CardTitle className="text-base">Regional Settings</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4 p-5">
                        <div className="space-y-1.5">
                          <Label>Timezone</Label>
                          <Select value={tenantForm.timezone ?? 'Africa/Nairobi'} onValueChange={v => setTenantForm((p: any) => ({ ...p, timezone: v }))}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>{TIMEZONES.map(tz => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Default Currency</Label>
                          <Select value={tenantForm.default_currency ?? 'KES'} onValueChange={v => setTenantForm((p: any) => ({ ...p, default_currency: v }))}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                  <Button onClick={() => saveTenant.mutate()} disabled={saveTenant.isPending}>
                    {saveTenant.isPending ? 'Saving…' : 'Save Profile'}
                  </Button>
                </div>
              )}
            </TabsContent>

            <TabsContent value="subscription" className="mt-6">
              <OrganizationSubscriptionTab tenantId={organizationId} industryId={tenant?.industry?.id ?? null} contactPhone={tenant?.contact_phone ?? ''} />
            </TabsContent>

            <TabsContent value="billing" className="mt-6">
              <OrganizationBillingTab tenantId={organizationId} contactPhone={tenant?.contact_phone ?? ''} />
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="branding" className="mt-6">
          <Card>
            <CardHeader className="bg-muted/20 border-b py-3 px-4">
              <CardTitle className="text-xs font-bold uppercase tracking-widest">Branding</CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-5">
              {settingsForm && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-6 items-start">
                    <div className="space-y-3">
                      <div className="h-32 w-32 rounded-2xl border bg-muted/20 flex items-center justify-center overflow-hidden">
                        {settingsForm.logo_url ? (
                          <img src={settingsForm.logo_url} alt="Organization logo" className="h-full w-full object-contain" />
                        ) : (
                          <ImageIcon className="h-8 w-8 text-muted-foreground" />
                        )}
                      </div>
                      <Input
                        type="file"
                        accept="image/*"
                        onChange={e => {
                          const file = e.target.files?.[0];
                          if (file) uploadLogo(file);
                        }}
                        disabled={uploadingLogo}
                      />
                      <p className="text-xs text-muted-foreground">
                        {uploadingLogo ? 'Uploading logo…' : 'Upload PNG, JPG, or SVG logo. This logo appears on sign-in and public-facing pages.'}
                      </p>
                    </div>
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <Label>Application Name</Label>
                        <Input value={settingsForm.workspace_name ?? ''} onChange={sf('workspace_name')} placeholder={tenant?.name ?? 'Business Workspace'} />
                        <p className="text-xs text-muted-foreground">Shown in the browser, installed app, and workspace identity. Example: Metrix Weighbridge.</p>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Brand Color</Label>
                        <div className="flex items-center gap-3">
                          <Input
                            type="color"
                            value={settingsForm.primary_color ?? '#E85D26'}
                            onChange={sf('primary_color')}
                            className="h-11 w-16 p-1"
                          />
                          <Input
                            value={settingsForm.primary_color ?? '#E85D26'}
                            onChange={sf('primary_color')}
                            placeholder="#E85D26"
                            className="font-mono"
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Used across sign-in, public pages, invoices, estimates, statements, and customer-facing documents.
                        </p>
                      </div>
                      <div className="rounded-2xl border p-5" style={{ background: `linear-gradient(135deg, ${settingsForm.primary_color ?? '#E85D26'} 0%, #ffffff 85%)` }}>
                        <div className="rounded-xl bg-white/90 border p-4">
                          <p className="text-sm font-semibold">Document Preview</p>
                          <p className="text-xs text-muted-foreground mt-1">This is how the selected brand color will frame your documents.</p>
                          <div className="mt-4 h-2 rounded-full" style={{ backgroundColor: settingsForm.primary_color ?? '#E85D26' }} />
                        </div>
                      </div>
                      <Button onClick={() => saveSettings.mutate(BRANDING_SETTINGS_FIELDS)} disabled={saveSettings.isPending}>
                        {saveSettings.isPending ? 'Saving…' : 'Save Branding'}
                      </Button>
                    </div>
                  </div>
                </>
              )}
              {!settingsForm && (
                <div className="p-4 text-sm text-muted-foreground">
                  {settingsLoading ? 'Loading branding settings…' : 'Branding settings are not ready yet. Refresh the page after migrations complete.'}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {canManagePublicSite && (
          <TabsContent value="public-site" className="mt-6">
            <Card>
              <CardHeader className="bg-muted/20 border-b py-3 px-4">
                <CardTitle className="text-xs font-bold uppercase tracking-widest">{publicSiteTitle}</CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-8">
                {settingsForm && (
                  <>
                    <div className="rounded-2xl border bg-muted/20 p-4">
                      <p className="text-sm font-semibold">
                        {role === 'superadmin'
                          ? 'These settings drive the SaaS owner public site.'
                          : 'These settings drive this organization public site.'}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-3 text-sm">
                        <a href={publicLandingUrl} className="font-medium text-primary hover:underline">Preview landing: {publicLandingUrl}</a>
                        <a href={publicLoginUrl} className="font-medium text-primary hover:underline">Preview login: {publicLoginUrl}</a>
                        <a href={publicSupportUrl} className="font-medium text-primary hover:underline">Preview support: {publicSupportUrl}</a>
                      </div>
                    </div>

                    <div className="space-y-4 rounded-2xl border border-primary/20 bg-primary/[0.04] p-4">
                      <div>
                        <p className="text-sm font-semibold">Public Site Visibility</p>
                        <p className="text-xs text-muted-foreground">Choose which public links and self-service options this organization exposes. These controls are available to platform and tenant administrators.</p>
                      </div>
                      <div className="grid gap-3">
                        <div className="flex items-center justify-between gap-6 rounded-xl border bg-background p-3">
                          <div><Label htmlFor="landing-page-enabled">Enable landing page</Label><p className="text-xs text-muted-foreground">When disabled, public marketing access is removed from this tenant login.</p></div>
                          <Switch id="landing-page-enabled" checked={settingsForm.landing_page_config?.enabled !== false} onCheckedChange={(checked) => updateLandingPageField('enabled', checked)} />
                        </div>
                        <div className="flex items-center justify-between gap-6 rounded-xl border bg-background p-3">
                          <div><Label htmlFor="login-landing-link">Show landing-page link on login</Label><p className="text-xs text-muted-foreground">Lets users navigate from the sign-in page to the public site.</p></div>
                          <Switch id="login-landing-link" checked={settingsForm.login_page_config?.show_landing_page_link !== false} disabled={settingsForm.landing_page_config?.enabled === false} onCheckedChange={(checked) => updateLoginPageField('show_landing_page_link', checked)} />
                        </div>
                        <div className="flex items-center justify-between gap-6 rounded-xl border bg-background p-3">
                          <div><Label htmlFor="public-registration">Allow public workspace registration</Label><p className="text-xs text-muted-foreground">Hide this for client deployments where accounts are created only by an administrator.</p></div>
                          <Switch id="public-registration" checked={settingsForm.login_page_config?.show_public_registration !== false} onCheckedChange={(checked) => updateLoginPageField('show_public_registration', checked)} />
                        </div>
                        <div className="flex items-center justify-between gap-6 rounded-xl border bg-background p-3">
                          <div><Label htmlFor="pricing-card">Show pricing card on login</Label><p className="text-xs text-muted-foreground">Controls the public pricing and subscription prompt below the sign-in form.</p></div>
                          <Switch id="pricing-card" checked={settingsForm.login_page_config?.show_pricing_card !== false} disabled={settingsForm.landing_page_config?.enabled === false || settingsForm.login_page_config?.show_landing_page_link === false} onCheckedChange={(checked) => updateLoginPageField('show_pricing_card', checked)} />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <p className="text-sm font-semibold">Login Page Wording</p>
                        <p className="text-xs text-muted-foreground">Control the hero messaging users see before they sign in.</p>
                      </div>
                      <div className="grid gap-4">
                        <div className="space-y-1.5">
                          <Label>Eyebrow</Label>
                          <Input value={settingsForm.login_page_config?.eyebrow ?? ''} onChange={(e) => updateLoginPageField('eyebrow', e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Title</Label>
                          <Input value={settingsForm.login_page_config?.title ?? ''} onChange={(e) => updateLoginPageField('title', e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Subtitle</Label>
                          <Textarea value={settingsForm.login_page_config?.subtitle ?? ''} onChange={(e) => updateLoginPageField('subtitle', e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Description</Label>
                          <Textarea value={settingsForm.login_page_config?.description ?? ''} onChange={(e) => updateLoginPageField('description', e.target.value)} />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4 border-t pt-6">
                      <div>
                        <p className="text-sm font-semibold">Landing Page</p>
                        <p className="text-xs text-muted-foreground">Shape the public SaaS billing and product page messaging.</p>
                      </div>
                      <div className="grid gap-4">
                        <div className="space-y-1.5">
                          <Label>Eyebrow</Label>
                          <Input value={settingsForm.landing_page_config?.eyebrow ?? ''} onChange={(e) => updateLandingPageField('eyebrow', e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Headline</Label>
                          <Textarea value={settingsForm.landing_page_config?.headline ?? ''} onChange={(e) => updateLandingPageField('headline', e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Subheadline</Label>
                          <Textarea value={settingsForm.landing_page_config?.subheadline ?? ''} onChange={(e) => updateLandingPageField('subheadline', e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Description</Label>
                          <Textarea value={settingsForm.landing_page_config?.description ?? ''} onChange={(e) => updateLandingPageField('description', e.target.value)} />
                        </div>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label>Primary CTA Label</Label>
                            <Input value={settingsForm.landing_page_config?.primary_cta_label ?? ''} onChange={(e) => updateLandingPageField('primary_cta_label', e.target.value)} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Primary CTA URL</Label>
                            <Input value={settingsForm.landing_page_config?.primary_cta_url ?? ''} onChange={(e) => updateLandingPageField('primary_cta_url', e.target.value)} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Secondary CTA Label</Label>
                            <Input value={settingsForm.landing_page_config?.secondary_cta_label ?? ''} onChange={(e) => updateLandingPageField('secondary_cta_label', e.target.value)} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Secondary CTA URL</Label>
                            <Input value={settingsForm.landing_page_config?.secondary_cta_url ?? ''} onChange={(e) => updateLandingPageField('secondary_cta_url', e.target.value)} />
                          </div>
                        </div>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <Label>Landing Highlights</Label>
                            <Button type="button" size="sm" variant="outline" onClick={addLandingHighlight} className="gap-1.5">
                              <Plus className="h-3.5 w-3.5" /> Add Highlight
                            </Button>
                          </div>
                          {(settingsForm.landing_page_config?.highlights ?? []).map((highlight: string, index: number) => (
                            <div key={`highlight-${index}`} className="flex items-start gap-2">
                              <Textarea value={highlight} onChange={(e) => updateLandingHighlight(index, e.target.value)} className="min-h-[72px]" />
                              <Button type="button" size="icon" variant="ghost" onClick={() => removeLandingHighlight(index)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4 border-t pt-6">
                      <div>
                        <p className="text-sm font-semibold">Support Page</p>
                        <p className="text-xs text-muted-foreground">Control the customer-facing support portal wording for this organization.</p>
                      </div>
                      <div className="grid gap-4">
                        <div className="space-y-1.5">
                          <Label>Eyebrow</Label>
                          <Input value={settingsForm.landing_page_config?.support_page?.eyebrow ?? ''} onChange={(e) => updateSupportPageField('eyebrow', e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Headline</Label>
                          <Textarea value={settingsForm.landing_page_config?.support_page?.headline ?? ''} onChange={(e) => updateSupportPageField('headline', e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Subheadline</Label>
                          <Textarea value={settingsForm.landing_page_config?.support_page?.subheadline ?? ''} onChange={(e) => updateSupportPageField('subheadline', e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Description</Label>
                          <Textarea value={settingsForm.landing_page_config?.support_page?.description ?? ''} onChange={(e) => updateSupportPageField('description', e.target.value)} />
                        </div>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label>Primary CTA Label</Label>
                            <Input value={settingsForm.landing_page_config?.support_page?.primary_cta_label ?? ''} onChange={(e) => updateSupportPageField('primary_cta_label', e.target.value)} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Secondary CTA Label</Label>
                            <Input value={settingsForm.landing_page_config?.support_page?.secondary_cta_label ?? ''} onChange={(e) => updateSupportPageField('secondary_cta_label', e.target.value)} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Form Title</Label>
                            <Input value={settingsForm.landing_page_config?.support_page?.form_title ?? ''} onChange={(e) => updateSupportPageField('form_title', e.target.value)} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Tracking Title</Label>
                            <Input value={settingsForm.landing_page_config?.support_page?.tracking_title ?? ''} onChange={(e) => updateSupportPageField('tracking_title', e.target.value)} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Status Card Title</Label>
                            <Input value={settingsForm.landing_page_config?.support_page?.status_title ?? ''} onChange={(e) => updateSupportPageField('status_title', e.target.value)} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Success Card Title</Label>
                            <Input value={settingsForm.landing_page_config?.support_page?.success_title ?? ''} onChange={(e) => updateSupportPageField('success_title', e.target.value)} />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Form Description</Label>
                          <Textarea value={settingsForm.landing_page_config?.support_page?.form_description ?? ''} onChange={(e) => updateSupportPageField('form_description', e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Tracking Description</Label>
                          <Textarea value={settingsForm.landing_page_config?.support_page?.tracking_description ?? ''} onChange={(e) => updateSupportPageField('tracking_description', e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Success Description</Label>
                          <Textarea value={settingsForm.landing_page_config?.support_page?.success_description ?? ''} onChange={(e) => updateSupportPageField('success_description', e.target.value)} />
                        </div>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <Label>Support Highlights</Label>
                            <Button type="button" size="sm" variant="outline" onClick={addSupportHighlight} className="gap-1.5">
                              <Plus className="h-3.5 w-3.5" /> Add Highlight
                            </Button>
                          </div>
                          {(settingsForm.landing_page_config?.support_page?.highlights ?? []).map((highlight: string, index: number) => (
                            <div key={`support-highlight-${index}`} className="flex items-start gap-2">
                              <Textarea value={highlight} onChange={(e) => updateSupportHighlight(index, e.target.value)} className="min-h-[72px]" />
                              <Button type="button" size="icon" variant="ghost" onClick={() => removeSupportHighlight(index)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                        <div className="space-y-3 border-t pt-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <Label>Support Form Fields</Label>
                              <p className="text-xs text-muted-foreground">Choose which customer-facing questions appear on the tenant support page.</p>
                            </div>
                            <Button type="button" size="sm" variant="outline" onClick={addSupportFormField} className="gap-1.5">
                              <Plus className="h-3.5 w-3.5" /> Add Field
                            </Button>
                          </div>
                          {(settingsForm.landing_page_config?.support_page?.form_fields ?? []).map((field: any, index: number) => {
                            const isCoreField = ['requester_name', 'requester_email', 'requester_phone', 'category', 'priority', 'subject', 'description'].includes(field?.key);
                            const isAlwaysRequired = ['requester_email', 'subject', 'description'].includes(field?.key);
                            return (
                              <div key={`support-field-${index}`} className="space-y-4 rounded-xl border p-4">
                                <div className="grid gap-4 sm:grid-cols-2">
                                  <div className="space-y-1.5">
                                    <Label>Label</Label>
                                    <Input value={field?.label ?? ''} onChange={(e) => updateSupportFormField(index, 'label', e.target.value)} />
                                  </div>
                                  <div className="space-y-1.5">
                                    <Label>Field Key</Label>
                                    <Input
                                      value={field?.key ?? ''}
                                      onChange={(e) => updateSupportFormField(index, 'key', e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                                      disabled={isCoreField}
                                    />
                                  </div>
                                  <div className="space-y-1.5">
                                    <Label>Type</Label>
                                    <Select value={field?.type ?? 'text'} onValueChange={(value) => updateSupportFormField(index, 'type', value)} disabled={isCoreField}>
                                      <SelectTrigger><SelectValue /></SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="text">Text</SelectItem>
                                        <SelectItem value="email">Email</SelectItem>
                                        <SelectItem value="tel">Phone</SelectItem>
                                        <SelectItem value="textarea">Long Text</SelectItem>
                                        <SelectItem value="select">Dropdown</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="space-y-1.5">
                                    <Label>Placeholder</Label>
                                    <Input value={field?.placeholder ?? ''} onChange={(e) => updateSupportFormField(index, 'placeholder', e.target.value)} />
                                  </div>
                                </div>
                                {(field?.type ?? 'text') === 'select' ? (
                                  <div className="space-y-1.5">
                                    <Label>Dropdown Options</Label>
                                    <Textarea
                                      value={Array.isArray(field?.options) ? field.options.join('\n') : ''}
                                      onChange={(e) => updateSupportFormField(index, 'options', e.target.value.split('\n').map((item) => item.trim()).filter(Boolean))}
                                      className="min-h-[96px]"
                                      placeholder={'Option one\nOption two'}
                                    />
                                  </div>
                                ) : null}
                                <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-muted/20 p-3">
                                  <div className="flex items-center gap-3">
                                    <Switch
                                      checked={field?.enabled !== false}
                                      onCheckedChange={(value) => updateSupportFormField(index, 'enabled', value)}
                                      disabled={isAlwaysRequired}
                                    />
                                    <Label>Visible to customers</Label>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <Switch
                                      checked={field?.required === true || isAlwaysRequired}
                                      onCheckedChange={(value) => updateSupportFormField(index, 'required', value)}
                                      disabled={isAlwaysRequired}
                                    />
                                    <Label>Required</Label>
                                  </div>
                                  {!isCoreField ? (
                                    <Button type="button" size="icon" variant="ghost" onClick={() => removeSupportFormField(index)}>
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4 border-t pt-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold">Footer Menu</p>
                          <p className="text-xs text-muted-foreground">Manage the links shown in the public footer and login experience.</p>
                        </div>
                        <Button type="button" size="sm" variant="outline" onClick={addFooterMenuItem} className="gap-1.5">
                          <Plus className="h-3.5 w-3.5" /> Add Link
                        </Button>
                      </div>

                      <div className="space-y-3">
                        {(settingsForm.footer_menu ?? []).map((item: any, index: number) => (
                          <div key={`footer-link-${index}`} className="grid gap-3 rounded-xl border p-4 sm:grid-cols-[1fr_1.2fr_auto] sm:items-end">
                            <div className="space-y-1.5">
                              <Label>Label</Label>
                              <Input value={item?.label ?? ''} onChange={(e) => updateFooterMenuItem(index, 'label', e.target.value)} placeholder="Plans" />
                            </div>
                            <div className="space-y-1.5">
                              <Label>URL / Anchor</Label>
                              <Input value={item?.href ?? ''} onChange={(e) => updateFooterMenuItem(index, 'href', e.target.value)} placeholder="/login or #plans" />
                            </div>
                            <Button type="button" size="icon" variant="ghost" onClick={() => removeFooterMenuItem(index)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>

                    <Button onClick={() => saveSettings.mutate(PUBLIC_SITE_SETTINGS_FIELDS)} disabled={saveSettings.isPending}>
                      {saveSettings.isPending ? 'Saving…' : 'Save Public Site Settings'}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* ── Email Tab ──────────────────────────────────────────────────── */}
        <TabsContent value="email" className="mt-6">
          <Card>
            <CardHeader className="bg-muted/20 border-b py-3 px-4">
              <CardTitle className="text-xs font-bold uppercase tracking-widest">SMTP Configuration</CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              {settingsForm && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>Support Email (From address)</Label>
                      <Input value={settingsForm.support_email ?? ''} onChange={sf('support_email')} type="email" placeholder="support@yourdomain.com" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>SMTP Host</Label>
                      <Input value={settingsForm.smtp_host ?? ''} onChange={sf('smtp_host')} placeholder="smtp.gmail.com" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>SMTP Port</Label>
                      <Input value={settingsForm.smtp_port ?? '587'} onChange={sf('smtp_port')} type="number" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>SMTP Username</Label>
                      <Input value={settingsForm.smtp_user ?? ''} onChange={sf('smtp_user')} type="email" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>SMTP Password</Label>
                      <Input value={settingsForm.smtp_password ?? ''} onChange={sf('smtp_password')} type="password" placeholder="Leave blank to keep existing" />
                    </div>
                  </div>
                  <div className="space-y-1.5 max-w-sm">
                    <Label>SMTP Encryption</Label>
                    <Select
                      value={settingsForm.smtp_use_ssl ? 'ssl' : settingsForm.smtp_use_tls ? 'starttls' : 'none'}
                      onValueChange={value => setSettingsForm((p: any) => ({
                        ...p,
                        smtp_use_ssl: value === 'ssl',
                        smtp_use_tls: value === 'starttls',
                      }))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ssl">SSL/TLS (usually port 465)</SelectItem>
                        <SelectItem value="starttls">STARTTLS (usually port 587)</SelectItem>
                        <SelectItem value="none">None (not recommended)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Your cPanel settings use SSL/TLS on port 465.</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <Switch
                      checked={settingsForm.smtp_allow_insecure_ssl ?? false}
                      onCheckedChange={value => setSettingsForm((p: any) => ({ ...p, smtp_allow_insecure_ssl: value }))}
                    />
                    <div>
                      <Label>Allow a self-signed SMTP certificate</Label>
                      <p className="text-xs text-muted-foreground mt-1">
                        Enable only when your mail server uses a private or self-signed certificate. A publicly trusted certificate is safer.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Button onClick={() => saveSettings.mutate(EMAIL_SETTINGS_FIELDS)} disabled={saveSettings.isPending}>
                      {saveSettings.isPending ? 'Saving…' : 'Save Email Config'}
                    </Button>
                    <Button variant="outline" onClick={() => testSmtp.mutate()} disabled={testSmtp.isPending}>
                      {testSmtp.isPending ? 'Sending…' : 'Send Test Email'}
                    </Button>
                  </div>
                </>
              )}
              {!settingsForm && (
                <div className="p-4 text-sm text-muted-foreground">
                  {settingsLoading ? 'Loading settings…' : 'Invoice and template settings are not ready yet.'}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Invoicing Tab ─────────────────────────────────────────────── */}
        <TabsContent value="invoicing" className="mt-6">
          <Card>
            <CardHeader className="bg-muted/20 border-b py-3 px-4">
              <CardTitle className="text-xs font-bold uppercase tracking-widest">Invoice Settings</CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              {settingsForm && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Invoice Number Prefix</Label>
                      <Input value={settingsForm.invoice_prefix ?? 'INV'} onChange={sf('invoice_prefix')} placeholder="INV" maxLength={10} />
                      <p className="text-xs text-muted-foreground">e.g. INV-2024-0001</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Default Payment Terms (days)</Label>
                      <Input value={settingsForm.default_payment_terms_days ?? '30'} onChange={sf('default_payment_terms_days')} type="number" min="0" />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>Invoice Footer Text</Label>
                      <Input value={settingsForm.footer_text ?? ''} onChange={sf('footer_text')} placeholder="Thank you for your business." />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Default Tax Name</Label>
                      <Input value={settingsForm.default_tax_name ?? 'VAT'} onChange={sf('default_tax_name')} placeholder="VAT" />
                      <p className="text-xs text-muted-foreground">Shared tax label used across sales, purchases, and customer documents.</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Default Tax Rate (%)</Label>
                      <Input value={settingsForm.default_tax_rate ?? '0'} onChange={sf('default_tax_rate')} type="number" min="0" step="0.01" />
                      <p className="text-xs text-muted-foreground">Used as the starting tax rate when creating products, services, and billable lines.</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Invoice Template</Label>
                      <Select value={String(settingsForm.invoice_template_id ?? '__none__')} onValueChange={v => setSettingsForm((p: any) => ({ ...p, invoice_template_id: v === '__none__' ? null : Number(v) }))}>
                        <SelectTrigger><SelectValue placeholder="Select invoice template" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">No template</SelectItem>
                          {templatesByType('invoice').map((t: any) => (
                            <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Estimate Template</Label>
                      <Select value={String(settingsForm.estimate_template_id ?? '__none__')} onValueChange={v => setSettingsForm((p: any) => ({ ...p, estimate_template_id: v === '__none__' ? null : Number(v) }))}>
                        <SelectTrigger><SelectValue placeholder="Select estimate template" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">No template</SelectItem>
                          {templatesByType('quotation').map((t: any) => (
                            <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Receipt Template</Label>
                      <Select value={String(settingsForm.receipt_template_id ?? '__none__')} onValueChange={v => setSettingsForm((p: any) => ({ ...p, receipt_template_id: v === '__none__' ? null : Number(v) }))}>
                        <SelectTrigger><SelectValue placeholder="Select receipt template" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">No template</SelectItem>
                          {templatesByType('receipt').map((t: any) => (
                            <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Statement Template</Label>
                      <Select value={String(settingsForm.statement_template_id ?? '__none__')} onValueChange={v => setSettingsForm((p: any) => ({ ...p, statement_template_id: v === '__none__' ? null : Number(v) }))}>
                        <SelectTrigger><SelectValue placeholder="Select statement template" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">No template</SelectItem>
                          {templatesByType('statement').map((t: any) => (
                            <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Purchase Order Template</Label>
                      <Select value={String(settingsForm.purchase_order_template_id ?? '__none__')} onValueChange={v => setSettingsForm((p: any) => ({ ...p, purchase_order_template_id: v === '__none__' ? null : Number(v) }))}>
                        <SelectTrigger><SelectValue placeholder="Select purchase order template" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">No template</SelectItem>
                          {templatesByType('purchase_order').map((t: any) => (
                            <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button onClick={() => saveSettings.mutate(INVOICE_SETTINGS_FIELDS)} disabled={saveSettings.isPending}>
                    {saveSettings.isPending ? 'Saving…' : 'Save Invoice Settings'}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="templates" className="mt-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Document Templates</p>
                <p className="text-xs text-muted-foreground">Create and manage centralized layouts for sales documents, finance documents, and ERP reports.</p>
              </div>
              <Button size="sm" onClick={() => setTemplateDialogOpen(true)} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> New Template
              </Button>
            </div>
            <div className="space-y-5">
              {TEMPLATE_GROUPS.map((group) => {
                const groupTypes = group.documentTypes
                  .map((documentType) => templateTypeMap.get(documentType))
                  .filter(Boolean) as Array<{ value: string; label: string }>;
                const groupTemplateCount = groupTypes.reduce((count, documentType) => count + templatesByType(documentType.value).length, 0);

                return (
                  <Card key={group.key} className="overflow-hidden">
                    <CardHeader className="border-b bg-muted/20 px-4 py-4">
                      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div>
                          <CardTitle className="text-sm font-bold uppercase tracking-[0.14em]">{group.title}</CardTitle>
                          <p className="mt-1 text-xs text-muted-foreground">{group.description}</p>
                        </div>
                        <div className="inline-flex w-fit rounded-full border border-border bg-background px-3 py-1 text-[11px] font-semibold text-muted-foreground">
                          {groupTemplateCount} template{groupTemplateCount === 1 ? '' : 's'}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4 p-4">
                      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                        {groupTypes.map((dt) => (
                          <div key={dt.value} className="rounded-2xl border bg-background">
                            <div className="border-b px-4 py-3">
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-sm font-semibold">{dt.label}</p>
                                <span className="text-xs text-muted-foreground">
                                  {templatesByType(dt.value).length} item{templatesByType(dt.value).length === 1 ? '' : 's'}
                                </span>
                              </div>
                            </div>
                            <div className="space-y-3 p-4">
                              {templatesByType(dt.value).length === 0 ? (
                                <p className="text-sm text-muted-foreground">No templates yet.</p>
                              ) : (
                                templatesByType(dt.value).map((t: any) => (
                                  <div key={t.id} className="rounded-xl border p-3">
                                    <div className="flex items-center justify-between gap-3">
                                      <div>
                                        <p className="text-sm font-semibold">{t.name}</p>
                                        <p className="text-xs text-muted-foreground">
                                          {t.tenant ? 'Organization template' : 'Shared template'} {t.is_default ? '· Default' : ''}
                                        </p>
                                      </div>
                                      <div className="flex items-center gap-1">
                                        <Button size="sm" variant="ghost" onClick={() => previewTemplate(t.id)}>
                                          <Eye className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(t.body_template ?? '')}>
                                          <Copy className="h-3.5 w-3.5" />
                                        </Button>
                                      </div>
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="users" className="mt-6">
          <Card>
            <CardHeader className="bg-muted/20 border-b py-3 px-4">
              <CardTitle className="text-xs font-bold uppercase tracking-widest">Organization Users</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <TeamTab tenantId={Number(organizationId)} branches={branches} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Branches Tab ──────────────────────────────────────────────── */}
        <TabsContent value="branches" className="mt-6 space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">{branches.length} branch{branches.length !== 1 ? 'es' : ''}</p>
            <Button size="sm" onClick={() => setBranchDialog({ open: true })} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Add Branch
            </Button>
          </div>
          {branches.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">No branches yet. Add your first branch.</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {branches.map((b: any) => (
                <Card key={b.id}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-sm">{b.name}</p>
                      <p className="text-xs text-muted-foreground">{[b.email, b.phone, b.address].filter(Boolean).join(' · ')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${b.is_active ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-gray-100 text-gray-500 border-gray-300'}`}>
                        {b.is_active ? 'Active' : 'Inactive'}
                      </span>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setBranchDialog({ open: true, branch: b })}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

      </Tabs>

      {branchDialog.open && organizationId && (
        <BranchDialog
          tenantId={Number(organizationId)}
          branch={branchDialog.branch}
          open={branchDialog.open}
          onClose={() => { setBranchDialog({ open: false }); refetchBranches(); }}
        />
      )}
      {templateDialogOpen && token && (
        <DocumentTemplateDialog
          open={templateDialogOpen}
          onClose={() => setTemplateDialogOpen(false)}
          token={token}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['tenant-document-templates', organizationId] });
            refetchTemplates();
          }}
        />
      )}
      {organizationDialogOpen && (
        <OrganizationDialog open={organizationDialogOpen} onClose={() => setOrganizationDialogOpen(false)} />
      )}
    </div>
  );
}
