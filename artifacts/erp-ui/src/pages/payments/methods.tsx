import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/context/use-auth';
import { CheckCircle2, XCircle, CreditCard } from 'lucide-react';

function usePaymentMethods() {
  return useQuery({
    queryKey: ['payment-methods'],
    queryFn: async () => {
      const base = (window as any).__ERP_BASE_URL__ ?? '';
      const token = localStorage.getItem('sl-erp-token');
      const res = await fetch(`${base}/api/payments/methods/`, {
        headers: { Authorization: `Token ${token}` },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    staleTime: 120_000,
  });
}

function useProviderCapabilities() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['provider-capabilities', (user as any)?.tenant_id ?? null],
    queryFn: async () => {
      const base = (window as any).__ERP_BASE_URL__ ?? '';
      const token = localStorage.getItem('sl-erp-token');
      const tenantId = (user as any)?.tenant_id;
      const qs = tenantId ? `?tenant_id=${tenantId}` : '';
      const res = await fetch(`${base}/api/payments/provider-capabilities/${qs}`, {
        headers: { Authorization: `Token ${token}` },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    staleTime: 120_000,
  });
}

export default function PaymentMethodsPage() {
  const { data: methods, isLoading: mLoading } = usePaymentMethods();
  const { data: capData, isLoading: cLoading } = useProviderCapabilities();

  const capabilities: any[] = capData?.capabilities ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <h1 className="text-3xl font-bold tracking-tight">Payment Methods</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Accepted modes */}
        <Card className="shadow-sm">
          <CardHeader className="bg-muted/20 border-b py-3">
            <CardTitle className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
              <CreditCard className="h-4 w-4" /> Accepted Modes
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {mLoading ? (
              <div className="p-6 text-center text-sm text-muted-foreground animate-pulse font-mono">Loading…</div>
            ) : (
              <ul className="divide-y divide-border">
                {(Array.isArray(methods) ? methods : []).map((m: any) => (
                  <li key={m.id ?? m.name} className="flex items-center justify-between px-5 py-4">
                    <span className="font-medium">{m.name}</span>
                    {m.is_active
                      ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      : <XCircle className="h-4 w-4 text-destructive" />}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Provider capabilities */}
        <Card className="shadow-sm">
          <CardHeader className="bg-muted/20 border-b py-3">
            <CardTitle className="text-sm font-bold uppercase tracking-widest">Gateway Providers</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {cLoading ? (
              <div className="p-6 text-center text-sm text-muted-foreground animate-pulse font-mono">Loading…</div>
            ) : capabilities.length ? (
              <ul className="divide-y divide-border">
                {capabilities.map((c: any, i: number) => (
                  <li key={c.id ?? i} className="px-5 py-4 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold">{c.name}</span>
                      <span className="text-xs font-mono text-muted-foreground uppercase">{c.transport}</span>
                    </div>
                    <div className="flex gap-3 text-xs text-muted-foreground">
                      <span>Provider: <strong>{c.provider}</strong></span>
                      {c.payment_scope && (
                        <span>
                          Scope: <strong>{c.payment_scope === 'saas_billing' ? 'SaaS Billing' : 'Tenant Collections'}</strong>
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 text-[11px]">
                      {(c.enabled_rails ?? []).map((rail: string) => (
                        <span key={rail} className="rounded border px-2 py-0.5 font-mono uppercase text-muted-foreground">
                          {rail.replace('_', ' ')}
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-3 text-xs text-muted-foreground">
                      {c.supports_initiation && <span className="text-emerald-600">✓ Initiation</span>}
                      {c.supports_callback && <span className="text-emerald-600">✓ Callback</span>}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {capData?.message ?? 'No payment providers configured for this tenant yet.'} Add a payment integration in Platform Admin.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
