import { useState } from 'react';
import { useAuth } from '@/context/use-auth';
// role comes from AuthContext (detectRole-derived); never use is_staff directly
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Smartphone, Landmark, Mail, MessageSquare,
  Cpu, Globe, RefreshCw, CheckCircle2, XCircle, AlertTriangle, CreditCard,
} from 'lucide-react';

const BASE = '/api/platform';

function api(token: string, path: string, method = 'GET', body?: object) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async r => {
    const j = await r.json();
    if (!r.ok) throw new Error(j?.detail || j?.error || JSON.stringify(j));
    return j;
  });
}

const CATALOG = [
  {
    id: 'mpesa', name: 'M-Pesa', description: 'Safaricom Daraja API for mobile money payments and STK Push.', icon: <Smartphone className="h-6 w-6 text-emerald-600" />, type: 'payment', configured: false,
    fields: [{ key: 'base_url', label: 'Daraja Base URL', placeholder: 'https://sandbox.safaricom.co.ke', target: 'root' }, { key: 'consumer_key', label: 'Consumer Key' }, { key: 'consumer_secret', label: 'Consumer Secret', secret: true }, { key: 'payment_scope', label: 'Use For', input: 'select', options: [{ value: 'tenant_operations', label: 'Tenant Collections' }, { value: 'saas_billing', label: 'SaaS Billing' }] }],
  },
  {
    id: 'bank', name: 'Bank API', description: 'Bank integration for automated payment reconciliation.', icon: <Landmark className="h-6 w-6 text-blue-600" />, type: 'payment', configured: false,
    fields: [{ key: 'base_url', label: 'API Base URL', target: 'root' }, { key: 'api_key', label: 'API Key', secret: true }, { key: 'payment_scope', label: 'Use For', input: 'select', options: [{ value: 'tenant_operations', label: 'Tenant Collections' }, { value: 'saas_billing', label: 'SaaS Billing' }] }],
  },
  {
    id: 'stripe', name: 'Stripe', description: 'Card checkout, subscription billing, and webhook-driven reconciliation.', icon: <CreditCard className="h-6 w-6 text-sky-600" />, type: 'payment', configured: false,
    fields: [{ key: 'base_url', label: 'API Base URL', placeholder: 'https://api.stripe.com', target: 'root' }, { key: 'secret_key', label: 'Secret Key', secret: true }, { key: 'webhook_secret', label: 'Webhook Secret', secret: true }, { key: 'payment_scope', label: 'Use For', input: 'select', options: [{ value: 'saas_billing', label: 'SaaS Billing' }, { value: 'tenant_operations', label: 'Tenant Collections' }] }],
  },
  {
    id: 'flutterwave', name: 'Flutterwave', description: 'Cards, bank transfers, and mobile money across multiple African markets.', icon: <CreditCard className="h-6 w-6 text-fuchsia-600" />, type: 'payment', configured: false,
    fields: [{ key: 'base_url', label: 'API Base URL', placeholder: 'https://api.flutterwave.com', target: 'root' }, { key: 'secret_key', label: 'Secret Key', secret: true }, { key: 'public_key', label: 'Public Key', secret: true }, { key: 'payment_scope', label: 'Use For', input: 'select', options: [{ value: 'saas_billing', label: 'SaaS Billing' }, { value: 'tenant_operations', label: 'Tenant Collections' }] }],
  },
  {
    id: 'pesapal', name: 'Pesapal', description: 'East Africa checkout for cards, mobile money, and bank-backed payment flows.', icon: <CreditCard className="h-6 w-6 text-rose-600" />, type: 'payment', configured: false,
    fields: [{ key: 'base_url', label: 'API Base URL', placeholder: 'https://pay.pesapal.com', target: 'root' }, { key: 'consumer_key', label: 'Consumer Key' }, { key: 'consumer_secret', label: 'Consumer Secret', secret: true }, { key: 'payment_scope', label: 'Use For', input: 'select', options: [{ value: 'saas_billing', label: 'SaaS Billing' }, { value: 'tenant_operations', label: 'Tenant Collections' }] }],
  },
  {
    id: 'smtp', name: 'Email (SMTP)', description: 'Custom SMTP server for transactional emails. Configure per organization in Organization Settings.', icon: <Mail className="h-6 w-6 text-amber-600" />, type: 'messaging', configured: true,
    fields: [],
  },
  {
    id: 'sms', name: 'SMS Gateway', description: 'Bulk SMS for transaction notifications and alerts.', icon: <MessageSquare className="h-6 w-6 text-purple-600" />, type: 'messaging', configured: false,
    fields: [{ key: 'provider', label: 'Provider', placeholder: "Africa's Talking, Twilio…" }, { key: 'api_key', label: 'API Key', secret: true }, { key: 'sender_id', label: 'Sender ID' }],
  },
  {
    id: 'weighbridge-indicator', name: 'Weighbridge Indicator', description: 'Hardware scale indicator API for live weight capture.', icon: <Cpu className="h-6 w-6 text-orange-600" />, type: 'indicator', configured: true,
    fields: [{ key: 'base_url', label: 'Indicator API URL' }, { key: 'api_id', label: 'API ID' }],
  },
  {
    id: 'webhook', name: 'Webhooks', description: 'Outbound webhooks for transaction and payment events.', icon: <Globe className="h-6 w-6 text-indigo-600" />, type: 'other', configured: false,
    fields: [{ key: 'base_url', label: 'Endpoint URL' }],
  },
];

function IntegrationSheet({
  item, existing, tenantId, tenantCode, onClose,
}: { item: typeof CATALOG[0]; existing?: any; tenantId: number | null; tenantCode?: string | null; onClose: () => void }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>(() => ({
    ...(existing?.connection_settings ?? {}),
    base_url: existing?.base_url ?? '',
    payment_scope: existing?.connection_settings?.payment_scope ?? 'tenant_operations',
  }));
  const [active, setActive] = useState(existing?.is_active ?? false);
  const isOwnerTenant = tenantCode === 'siakora-labs';

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        base_url: form.base_url ?? '',
        connection_settings: Object.fromEntries(
          Object.entries(form).filter(([key]) => key !== 'base_url')
        ),
        is_active: active,
      };
      if (existing) {
        return api(token!, `/integrations/${existing.id}/`, 'PATCH', payload);
      }
      if (!tenantId) throw new Error('Select a tenant before saving an integration.');
      return api(token!, '/integrations/', 'POST', {
        name: item.name,
        integration_type: item.type,
        transport: 'http',
        provider: item.id,
        ...payload,
        tenant_id: tenantId,
      });
    },
    onSuccess: () => {
      toast({ title: 'Integration saved' });
      qc.invalidateQueries({ queryKey: ['integrations'] });
      onClose();
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const isConfiguredViaTenantSettings = item.id === 'smtp';

  return (
    <Sheet open onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-3">{item.icon} {item.name}</SheetTitle>
        </SheetHeader>
        <div className="mt-6 space-y-4">
          <p className="text-sm text-muted-foreground">{item.description}</p>

          {!existing && !tenantId && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 flex gap-2 items-start">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-700 dark:text-amber-400">Select a tenant above before configuring this integration.</p>
            </div>
          )}

          {isConfiguredViaTenantSettings ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-4">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-400">Configured per tenant</p>
              <p className="text-xs text-amber-700 dark:text-amber-500 mt-1">
                Each organization configures its own SMTP settings in Platform Admin → Organization Settings → Email tab.
              </p>
            </div>
          ) : item.fields.length === 0 ? (
            <div className="rounded-lg border p-4 text-sm text-muted-foreground">
              Contact support to enable this integration for your platform.
            </div>
          ) : (
            <>
              {item.fields.map(f => (
                <div key={f.key} className="space-y-1.5">
                  <Label>{f.label}</Label>
                  {(f as any).input === 'select' ? (
                    <Select
                      value={form[f.key] ?? ''}
                      onValueChange={value => setForm(p => ({ ...p, [f.key]: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select an option" />
                      </SelectTrigger>
                      <SelectContent>
                        {(((f as any).options ?? []).filter((option: any) =>
                          f.key !== 'payment_scope' || isOwnerTenant || option.value === 'tenant_operations'
                        )).map((option: any) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      type={(f as any).secret ? 'password' : 'text'}
                      placeholder={(f as any).placeholder}
                      value={form[f.key] ?? ''}
                      onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
              <div className="flex items-center gap-3">
                <Switch checked={active} onCheckedChange={setActive} />
                <Label>Active</Label>
              </div>
              {item.type === 'payment' && (
                <p className="text-xs text-muted-foreground">
                  {isOwnerTenant
                    ? 'Owner tenant can configure either SaaS billing or tenant collections.'
                    : 'This tenant can only configure payment providers for tenant collections.'}
                </p>
              )}
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || (!existing && !tenantId)}
                className="w-full"
              >
                {saveMutation.isPending ? 'Saving…' : 'Save Integration'}
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function Integrations() {
  const { token, user, role } = useAuth();
  const [selected, setSelected] = useState<typeof CATALOG[0] | null>(null);
  const [paymentsOpen, setPaymentsOpen] = useState(false);

  // Use canonical role from AuthContext (detectRole) — never rely on is_staff directly
  const isSuperAdmin = role === 'superadmin';
  const myTenantId: number | null = (user as any)?.tenant_id ?? null;
  const [selectedTenantId, setSelectedTenantId] = useState<string>(
    myTenantId ? String(myTenantId) : ''
  );

  // Only superadmins need the tenant picker; fetch tenant list only for them
  const { data: tenantsData } = useQuery({
    queryKey: ['tenants-for-integrations'],
    queryFn: () => api(token!, '/tenants/?page_size=200&ordering=name'),
    enabled: !!token && isSuperAdmin,
  });
  const tenants: any[] = tenantsData?.results ?? [];

  const activeTenantId: number | null = selectedTenantId ? Number(selectedTenantId) : null;
  const activeTenantCode: string | null = isSuperAdmin
    ? (tenants.find((t: any) => String(t.id) === selectedTenantId)?.code ?? null)
    : ((user as any)?.tenant_code as string | null) ?? null;

  const { data, refetch } = useQuery({
    queryKey: ['integrations', activeTenantId],
    queryFn: () => {
      const params = activeTenantId ? `?page_size=100&tenant_id=${activeTenantId}` : '?page_size=100';
      return api(token!, `/integrations/${params}`);
    },
    enabled: !!token,
  });

  const existingMap: Record<string, any> = {};
  for (const e of (data?.results ?? [])) {
    existingMap[e.provider ?? e.name?.toLowerCase()] = e;
  }

  const TYPE_LABEL: Record<string, string> = {
    payment: 'Payments', messaging: 'Messaging', indicator: 'Hardware', other: 'Webhooks & API',
  };
  const grouped: Record<string, typeof CATALOG> = {};
  for (const c of CATALOG) {
    (grouped[c.type] ??= []).push(c);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Integrations</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Third-party services and hardware connections</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()}><RefreshCw className="h-3.5 w-3.5" /></Button>
      </div>

      {/* Tenant selector — shown only to superadmins */}
      {isSuperAdmin && (
        <div className="flex items-center gap-3">
          <Label className="text-xs font-medium shrink-0">Viewing tenant:</Label>
          <Select value={selectedTenantId} onValueChange={setSelectedTenantId}>
            <SelectTrigger className="h-8 w-64 text-xs">
              <SelectValue placeholder="Select a tenant to view integrations…" />
            </SelectTrigger>
            <SelectContent>
              {tenants.map((t: any) => (
                <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!selectedTenantId && (
            <span className="text-xs text-amber-600 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" /> Select a tenant to configure integrations
            </span>
          )}
        </div>
      )}

      {Object.entries(grouped).map(([type, items]) => (
        <div key={type} className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{TYPE_LABEL[type]}</h2>
          {type === 'payment' ? (
            <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setPaymentsOpen(true)}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="p-2 rounded-lg bg-muted/30">
                    <CreditCard className="h-6 w-6 text-sky-600" />
                  </div>
                  <span className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${
                    items.some(item => existingMap[item.id]?.is_active)
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400'
                      : 'bg-gray-100 text-gray-500 border-gray-300'
                  }`}>
                    {items.some(item => existingMap[item.id]?.is_active)
                      ? <CheckCircle2 className="h-2.5 w-2.5" />
                      : <XCircle className="h-2.5 w-2.5" />}
                    {items.some(item => existingMap[item.id]?.is_active) ? 'Configured' : 'Not set up'}
                  </span>
                </div>
                <CardTitle className="text-sm mt-2">Payments Hub</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Manage all payment providers in one place. Configure your SaaS billing gateway separately from each tenant&apos;s own collection gateway.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {items.map(item => {
                    const existing = existingMap[item.id];
                    const scope = existing?.connection_settings?.payment_scope;
                    return (
                      <span key={item.id} className="rounded border px-2 py-1 text-[11px] text-muted-foreground">
                        {item.name}
                        {scope ? ` · ${scope === 'saas_billing' ? 'SaaS' : 'Tenant'}` : ''}
                      </span>
                    );
                  })}
                </div>
                <Button size="sm" variant="outline" className="w-full mt-3 text-xs">Open Payments</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map(item => {
                const existing = existingMap[item.id];
                const isLive = existing?.is_active || item.configured;
                return (
                  <Card key={item.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelected(item)}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div className="p-2 rounded-lg bg-muted/30">{item.icon}</div>
                        <span className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${
                          isLive
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : 'bg-gray-100 text-gray-500 border-gray-300'
                        }`}>
                          {isLive ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
                          {isLive ? 'Configured' : 'Not set up'}
                        </span>
                      </div>
                      <CardTitle className="text-sm mt-2">{item.name}</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <p className="text-xs text-muted-foreground leading-relaxed">{item.description}</p>
                      <Button size="sm" variant="outline" className="w-full mt-3 text-xs">Configure</Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      ))}

      {paymentsOpen && (
        <Sheet open onOpenChange={setPaymentsOpen}>
          <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Payments Hub</SheetTitle>
            </SheetHeader>
            <div className="mt-6 space-y-4">
              <div className="rounded-lg border p-4 bg-muted/20">
                <p className="text-sm font-medium">Segregation model</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Use <strong>SaaS Billing</strong> for Siakora Labs subscription collection. Use <strong>Tenant Collections</strong> for a tenant&apos;s own customer payments.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4">
                {CATALOG.filter(item => item.type === 'payment').map(item => {
                  const existing = existingMap[item.id];
                  const scope = existing?.connection_settings?.payment_scope;
                  return (
                    <Card key={item.id}>
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-muted/30">{item.icon}</div>
                            <div>
                              <CardTitle className="text-sm">{item.name}</CardTitle>
                              <p className="text-xs text-muted-foreground mt-1">{item.description}</p>
                            </div>
                          </div>
                          <span className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${
                            existing?.is_active
                              ? 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400'
                              : 'bg-gray-100 text-gray-500 border-gray-300'
                          }`}>
                            {existing?.is_active ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
                            {existing?.is_active ? 'Configured' : 'Not set up'}
                          </span>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0">
                        {scope && (
                          <p className="text-[11px] font-medium text-muted-foreground mb-3">
                            {scope === 'saas_billing' ? 'Dedicated to SaaS billing' : 'Dedicated to tenant collections'}
                          </p>
                        )}
                        <Button size="sm" variant="outline" onClick={() => { setSelected(item); setPaymentsOpen(false); }}>
                          Configure {item.name}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      )}

      {selected && (
        <IntegrationSheet
          item={selected}
          existing={existingMap[selected.id]}
          tenantId={activeTenantId}
          tenantCode={activeTenantCode}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
