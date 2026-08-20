import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, RefreshCw, Smartphone, TrendingUp, Wallet, FileText, ArrowRight, Building2 } from 'lucide-react';
import { useAuth } from '@/context/use-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';

const PLATFORM_BASE = '/api/platform';
function platformApi(token: string, path: string) {
  return fetch(`${PLATFORM_BASE}${path}`, {
    headers: { Authorization: `Token ${token}` },
  }).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.detail || payload?.error || JSON.stringify(payload));
    }
    return payload;
  });
}

function platformMutation(token: string, path: string, method = 'POST', body?: object) {
  return fetch(`${PLATFORM_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.detail || payload?.error || payload?.message || JSON.stringify(payload));
    }
    return payload;
  });
}

function annualizedValue(amount: number, billingPeriod: string) {
  if (billingPeriod === 'annual') return amount;
  if (billingPeriod === 'quarterly') return amount * 4;
  if (billingPeriod === 'monthly') return amount * 12;
  return amount * 12;
}

function monthlyValue(amount: number, billingPeriod: string) {
  if (billingPeriod === 'annual') return amount / 12;
  if (billingPeriod === 'quarterly') return amount / 3;
  return amount;
}

export default function BillingCenter() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const subscriptionsQuery = useQuery({
    queryKey: ['billing-center-subscriptions'],
    queryFn: () => platformApi(token!, '/subscriptions/?page_size=200'),
    enabled: !!token,
    refetchInterval: 15000,
  });
  const plansQuery = useQuery({
    queryKey: ['billing-center-plans'],
    queryFn: () => platformApi(token!, '/plans/?page_size=100'),
    enabled: !!token,
  });
  const integrationsQuery = useQuery({
    queryKey: ['billing-center-integrations'],
    queryFn: () => platformApi(token!, '/integrations/?page_size=200'),
    enabled: !!token,
  });
  const paymentSummaryQuery = useQuery({
    queryKey: ['billing-center-payment-summary'],
    queryFn: () => platformApi(token!, '/billing/summary/').then((payload) => payload.data ?? {}),
    enabled: !!token,
    refetchInterval: 15000,
  });
  const billingRequestsQuery = useQuery({
    queryKey: ['billing-center-requests'],
    queryFn: () => platformApi(token!, '/billing/requests/?page_size=100'),
    enabled: !!token,
    refetchInterval: 15000,
  });

  const subscriptions: any[] = subscriptionsQuery.data?.results ?? [];
  const plans: any[] = plansQuery.data?.results ?? [];
  const integrations: any[] = integrationsQuery.data?.results ?? [];
  const saasBillingGateways = integrations.filter((item: any) => item.connection_settings?.payment_scope === 'saas_billing');
  const activeSubscriptions = subscriptions.filter((item: any) => item.status === 'active');
  const trialSubscriptions = subscriptions.filter((item: any) => item.status === 'trial');
  const attentionSubscriptions = subscriptions.filter((item: any) => ['grace', 'suspended', 'expired', 'cancelled'].includes(item.status));

  const revenueMetrics = useMemo(() => {
    return subscriptions.reduce((acc, subscription) => {
      const status = String(subscription.status || '').toLowerCase();
      if (!['active', 'trial', 'grace'].includes(status)) return acc;
      const plan = subscription.plan ?? {};
      const amount = Number(subscription.amount ?? plan.price ?? 0);
      const billingPeriod = String(plan.billing_period ?? 'monthly');
      acc.mrr += monthlyValue(amount, billingPeriod);
      acc.arr += annualizedValue(amount, billingPeriod);
      return acc;
    }, { mrr: 0, arr: 0 });
  }, [subscriptions]);

  const recentSubscriptions = [...subscriptions].slice(0, 6);
  const summary = paymentSummaryQuery.data ?? {
    total_requested: 0,
    total_received: 0,
    outstanding: 0,
    by_status: [],
  };
  const billingRequests: any[] = billingRequestsQuery.data?.results ?? [];

  const confirmBillingRequest = useMutation({
    mutationFn: (requestId: number) => platformMutation(token!, `/billing/requests/${requestId}/simulate-complete/`, 'POST', {}),
    onSuccess: () => {
      toast({ title: 'Sandbox payment confirmed' });
      qc.invalidateQueries({ queryKey: ['billing-center-requests'] });
      qc.invalidateQueries({ queryKey: ['billing-center-payment-summary'] });
      qc.invalidateQueries({ queryKey: ['billing-center-subscriptions'] });
    },
    onError: (error: any) => toast({ title: 'Confirmation failed', description: error.message, variant: 'destructive' }),
  });
  const failBillingRequest = useMutation({
    mutationFn: (requestId: number) => platformMutation(token!, `/billing/requests/${requestId}/simulate-fail/`, 'POST', {}),
    onSuccess: () => {
      toast({ title: 'Sandbox payment marked failed' });
      qc.invalidateQueries({ queryKey: ['billing-center-requests'] });
      qc.invalidateQueries({ queryKey: ['billing-center-payment-summary'] });
      qc.invalidateQueries({ queryKey: ['billing-center-subscriptions'] });
    },
    onError: (error: any) => toast({ title: 'Mark failed failed', description: error.message, variant: 'destructive' }),
  });
  const cancelBillingRequest = useMutation({
    mutationFn: (requestId: number) => platformMutation(token!, `/billing/requests/${requestId}/simulate-cancel/`, 'POST', {}),
    onSuccess: () => {
      toast({ title: 'Sandbox payment cancelled' });
      qc.invalidateQueries({ queryKey: ['billing-center-requests'] });
      qc.invalidateQueries({ queryKey: ['billing-center-payment-summary'] });
      qc.invalidateQueries({ queryKey: ['billing-center-subscriptions'] });
    },
    onError: (error: any) => toast({ title: 'Cancel failed', description: error.message, variant: 'destructive' }),
  });

  const loading = subscriptionsQuery.isLoading || integrationsQuery.isLoading || paymentSummaryQuery.isLoading;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Billing Center</h1>
          <p className="text-xs text-muted-foreground mt-0.5">SaaS subscriptions, billing gateways, and collection reporting</p>
        </div>
        <div className="flex gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/platform/plans">Plans</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/platform/integrations">Gateways</Link>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              subscriptionsQuery.refetch();
              integrationsQuery.refetch();
              paymentSummaryQuery.refetch();
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Active subscriptions', value: activeSubscriptions.length, icon: <Wallet className="h-4 w-4 text-emerald-600" /> },
          { label: 'Trial subscriptions', value: trialSubscriptions.length, icon: <CreditCard className="h-4 w-4 text-amber-600" /> },
          { label: 'Monthly recurring value', value: `KES ${Math.round(revenueMetrics.mrr).toLocaleString()}`, icon: <TrendingUp className="h-4 w-4 text-sky-600" /> },
          { label: 'Active billing gateways', value: saasBillingGateways.filter((item: any) => item.is_active).length, icon: <Smartphone className="h-4 w-4 text-orange-600" /> },
        ].map((item) => (
          <Card key={item.label}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div className="rounded-xl bg-muted/30 p-2">{item.icon}</div>
                <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">{item.label}</p>
              </div>
              <p className="mt-4 text-2xl font-black tracking-tight">{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader className="bg-muted/20 border-b py-3 px-4">
            <CardTitle className="text-xs font-bold uppercase tracking-widest">Gateway Setup</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              SaaS admins use billing gateways here to receive subscription payments. Tenant ERP payment collection stays separate.
            </p>
            {saasBillingGateways.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">
                No SaaS billing gateway is active yet. Start with the M-Pesa sandbox setup in Billing Gateways.
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {saasBillingGateways.map((gateway: any) => (
                  <div key={gateway.id} className="rounded-2xl border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Smartphone className="h-4 w-4 text-emerald-600" />
                        <p className="font-semibold">{gateway.name}</p>
                      </div>
                      <Badge variant={gateway.is_active ? 'secondary' : 'outline'}>
                        {gateway.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {gateway.provider?.toUpperCase()} · {gateway.tenant?.name ?? 'Owner tenant'}
                    </p>
                    {gateway.base_url && (
                      <p className="mt-1 text-xs text-muted-foreground break-all">{gateway.base_url}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
            <Button asChild size="sm" className="gap-1.5">
              <Link href="/platform/integrations">
                Open Billing Gateways
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="bg-muted/20 border-b py-3 px-4">
            <CardTitle className="text-xs font-bold uppercase tracking-widest">Collection Report</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
              <div className="rounded-2xl border p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Requested</p>
                <p className="mt-2 text-xl font-bold">KES {Number(summary.total_requested ?? 0).toLocaleString()}</p>
              </div>
              <div className="rounded-2xl border p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Received</p>
                <p className="mt-2 text-xl font-bold">KES {Number(summary.total_received ?? 0).toLocaleString()}</p>
              </div>
              <div className="rounded-2xl border p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Outstanding</p>
                <p className="mt-2 text-xl font-bold">KES {Number(summary.outstanding ?? 0).toLocaleString()}</p>
              </div>
            </div>
            <div className="space-y-2">
              {(summary.by_status ?? []).map((row: any) => (
                <div key={row.status} className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm">
                  <span className="capitalize">{row.status}</span>
                  <span className="text-muted-foreground">{row.count} · KES {Number(row.total ?? 0).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader className="bg-muted/20 border-b py-3 px-4">
            <CardTitle className="text-xs font-bold uppercase tracking-widest">Subscription Operations</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <p className="p-8 text-sm text-center text-muted-foreground">Loading billing operations…</p>
            ) : recentSubscriptions.length === 0 ? (
              <p className="p-8 text-sm text-center text-muted-foreground">No subscriptions created yet.</p>
            ) : (
              <div className="divide-y">
              {recentSubscriptions.map((subscription: any) => (
                  <div key={subscription.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm">{subscription.tenant?.name ?? `Tenant #${subscription.tenant}`}</p>
                      <p className="text-xs text-muted-foreground">
                        {subscription.plan?.name ?? 'Plan'} · {subscription.currency} {Number(subscription.amount ?? subscription.plan?.price ?? 0).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={subscription.status === 'active' ? 'secondary' : 'outline'}>
                        {subscription.status}
                      </Badge>
                      <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                        <Link href="/platform/subscriptions">Manage</Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="bg-muted/20 border-b py-3 px-4">
            <CardTitle className="text-xs font-bold uppercase tracking-widest">Billing Control</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="rounded-2xl border p-4">
              <p className="text-sm font-semibold">Products and pricing</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {plans.length} subscription plans are available for SaaS billing.
              </p>
              <Button asChild size="sm" variant="outline" className="mt-3">
                <Link href="/platform/plans">Manage Plans</Link>
              </Button>
            </div>
            <div className="rounded-2xl border p-4">
              <p className="text-sm font-semibold">Tenant portfolio</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Use tenants to control client onboarding, industry fit, and billing ownership.
              </p>
              <Button asChild size="sm" variant="outline" className="mt-3">
                <Link href="/platform/tenants">
                  <Building2 className="mr-1.5 h-3.5 w-3.5" />
                  Open Tenants
                </Link>
              </Button>
            </div>
            <div className="rounded-2xl border p-4">
              <p className="text-sm font-semibold">Billing actions needing attention</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {attentionSubscriptions.length} subscriptions are in grace, suspended, expired, or cancelled states. Organization admins trigger billing automatically from subscription setup.
              </p>
              <Button asChild size="sm" variant="outline" className="mt-3">
                <Link href="/platform/subscriptions">Review Subscriptions</Link>
              </Button>
            </div>
            <div className="rounded-2xl border p-4">
              <p className="text-sm font-semibold">Commercial reporting</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Track annualized subscription value at approximately KES {Math.round(revenueMetrics.arr).toLocaleString()}.
              </p>
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <FileText className="h-3.5 w-3.5" />
                Collections and invoice totals update from the billing summary feed.
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="bg-muted/20 border-b py-3 px-4">
          <CardTitle className="text-xs font-bold uppercase tracking-widest">Billing Requests</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {billingRequests.length === 0 ? (
            <p className="p-8 text-sm text-center text-muted-foreground">No billing requests have been initiated yet.</p>
          ) : (
            <div className="divide-y">
              {billingRequests.slice(0, 8).map((request: any) => (
                <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">{request.tenant?.name ?? 'Tenant'}</p>
                    <p className="text-xs text-muted-foreground">
                      {request.checkout_reference} · {request.payment_provider?.toUpperCase() || 'Gateway'} · {request.currency} {Number(request.amount ?? 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {request.phone_number && (
                      <span className="text-xs text-muted-foreground">{request.phone_number}</span>
                    )}
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
                    <Badge variant={request.status === 'succeeded' ? 'secondary' : 'outline'}>
                      {request.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
