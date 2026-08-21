import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, Layers3 } from 'lucide-react';
import { Link } from 'wouter';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MarketingSiteShell } from '@/components/marketing/site-shell';
import { useMarketingSite } from '@/components/marketing/site-data';

const PAGE_SIZE = 3;

function formatPrice(value: string | number, currency: string, billingPeriod: string) {
  const amount = Number(value ?? 0);
  return `${currency} ${Number.isFinite(amount) ? amount.toLocaleString() : value}/${billingPeriod}`;
}

function planFeatureValues(features: unknown) {
  if (Array.isArray(features)) {
    return features.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  }
  if (features && typeof features === 'object') {
    return Object.values(features).filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  }
  return [];
}

export default function MarketingPricingPage({ tenantCode }: { tenantCode?: string }) {
  const site = useMarketingSite(tenantCode);
  const brand = site.branding.primary_color ?? '#E85D26';
  const [page, setPage] = useState(1);
  const [detailsPlanId, setDetailsPlanId] = useState<number | null>(null);

  const totalPages = Math.max(1, Math.ceil(site.plans.length / PAGE_SIZE));
  const planPages = useMemo(
    () => Array.from({ length: totalPages }, (_, index) => site.plans.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE)),
    [site.plans, totalPages],
  );
  const detailsPlan = useMemo(
    () => site.plans.find((plan) => plan.id === detailsPlanId) ?? null,
    [detailsPlanId, site.plans],
  );

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (totalPages <= 1) return undefined;
    const timer = window.setInterval(() => {
      setPage((current) => (current >= totalPages ? 1 : current + 1));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [totalPages]);

  return (
    <MarketingSiteShell site={site} tenantCode={tenantCode} currentPage="pricing">
      <section className="mx-auto max-w-7xl px-6 pb-14 pt-12 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#6b7280]">Pricing</p>
          <h1 className="mt-4 text-[2.7rem] font-semibold leading-[1] tracking-[-0.05em] text-[#111827] sm:text-[4rem]">
            Pricing plans built for
            <span className="block italic" style={{ color: brand }}>business growth at every stage.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-3xl text-base leading-8 text-[#4b5563]">
            Choose the package that fits your business now, then add more users, more modules, and stronger operational control without changing systems.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-16 sm:px-8 lg:px-10">
        <div className="mb-6 flex flex-col gap-4 rounded-[30px] border border-black/5 bg-white/90 p-5 shadow-[0_16px_46px_rgba(232,93,38,0.08)] sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[#6b7280]">Plan Catalog</p>
            <p className="mt-2 text-sm leading-7 text-[#4b5563]">
              Browse pricing in smaller slides instead of a long scroll, with full plan details still one click away.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page === 1}
              className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold text-[#111827] transition hover:border-black/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </button>
            <span className="min-w-[100px] text-center text-sm font-semibold text-[#4b5563]">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page === totalPages}
              className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: brand }}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {site.plans.length > 0 ? (
          <>
            <div className="overflow-hidden rounded-[38px]">
              <div
                className="flex transition-transform duration-700 ease-out"
                style={{ transform: `translateX(-${(page - 1) * 100}%)` }}
              >
                {planPages.map((plans, pageIndex) => (
                  <div key={`plan-page-${pageIndex + 1}`} className="w-full shrink-0">
                    <div className="grid gap-5 lg:grid-cols-3">
                      {plans.map((plan, index) => {
                        const featureValues = planFeatureValues(plan.features);
                        const moduleNames = Array.isArray(plan.modules)
                          ? plan.modules
                            .map((entry) => entry.module?.name)
                            .filter((name): name is string => Boolean(name))
                          : [];
                        const createWorkspaceHref = tenantCode
                          ? `/login/${tenantCode}?intent=register&plan=${plan.id}`
                          : `/login?intent=register&plan=${plan.id}`;
                        const subscribeHref = tenantCode
                          ? `/login/${tenantCode}?intent=subscribe&plan=${plan.id}`
                          : `/login?intent=subscribe&plan=${plan.id}`;
                        const featured = index === 1 || (plans.length === 1 && index === 0);

                        return (
                          <article
                            key={plan.id}
                            className={`flex h-full flex-col rounded-[34px] border p-6 shadow-[0_16px_46px_rgba(17,24,39,0.05)] ${
                              featured ? 'border-transparent bg-[#172033] text-white' : 'border-black/5 bg-white text-[#111827]'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className={`text-xs font-bold uppercase tracking-[0.24em] ${featured ? 'text-white/45' : 'text-[#6b7280]'}`}>
                                  {plan.code}
                                </p>
                                <h2 className="mt-2 text-2xl font-semibold tracking-tight">{plan.name}</h2>
                              </div>
                              {plan.trial_days > 0 ? (
                                <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] ${featured ? 'bg-white/10 text-white' : 'bg-[#fff4e8] text-[#c76812]'}`}>
                                  {plan.trial_days} day trial
                                </span>
                              ) : null}
                            </div>

                            <p className="mt-6 text-4xl font-semibold tracking-tight">{formatPrice(plan.price, plan.currency, plan.billing_period)}</p>
                            <p className={`mt-2 text-sm leading-6 ${featured ? 'text-white/70' : 'text-[#6b7280]'}`}>
                              Up to {plan.max_users} users, {plan.max_branches} branches, {plan.max_devices} devices, and {plan.max_monthly_transactions.toLocaleString()} monthly transactions.
                            </p>

                            <div className="mt-6 space-y-3">
                              {featureValues.slice(0, 5).map((feature) => (
                                <div key={String(feature)} className="flex items-start gap-3 text-sm">
                                  <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${featured ? 'text-[#7dd3c7]' : ''}`} style={featured ? undefined : { color: brand }} />
                                  <span className={featured ? 'text-white/82' : 'text-[#374151]'}>{String(feature)}</span>
                                </div>
                              ))}
                              {featureValues.length === 0 ? (
                                <div className={`text-sm leading-7 ${featured ? 'text-white/70' : 'text-[#6b7280]'}`}>
                                  Plan benefits will appear here once this package is fully configured in Platform Admin.
                                </div>
                              ) : null}
                            </div>

                            <div className="mt-5 rounded-[24px] border border-black/5 p-4 text-sm">
                              <div className={`flex items-center gap-2 ${featured ? 'text-white/82' : 'text-[#374151]'}`}>
                                <Layers3 className="h-4 w-4" style={featured ? undefined : { color: brand }} />
                                <span>{moduleNames.length} included modules</span>
                              </div>
                              <div className={`mt-2 text-xs leading-6 ${featured ? 'text-white/60' : 'text-[#6b7280]'}`}>
                                {moduleNames.slice(0, 3).join(', ') || 'Plan modules and ERP capabilities are included here.'}
                                {moduleNames.length > 3 ? ' and more.' : ''}
                              </div>
                            </div>

                            <div className="mt-auto space-y-3 pt-8">
                              <Link
                                href={createWorkspaceHref}
                                className={`inline-flex w-full items-center justify-center rounded-full px-4 py-3.5 text-sm font-semibold transition ${featured ? 'bg-white text-[#111827] hover:bg-white/92' : 'text-white hover:opacity-90'}`}
                                style={featured ? undefined : { backgroundColor: brand }}
                              >
                                Create workspace
                              </Link>
                              <Link
                                href={subscribeHref}
                                className={`inline-flex w-full items-center justify-center rounded-full border px-4 py-3.5 text-sm font-semibold transition ${
                                  featured
                                    ? 'border-white/14 bg-white/6 text-white hover:bg-white/10'
                                    : 'border-black/10 bg-white text-[#111827] hover:border-black/20'
                                }`}
                              >
                                Sign in & subscribe
                              </Link>
                              <button
                                type="button"
                                onClick={() => setDetailsPlanId(plan.id)}
                                className={`inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold transition ${
                                  featured ? 'text-white/90 hover:text-white' : 'text-[#111827] hover:text-black'
                                }`}
                              >
                                See plan details
                                <ChevronRight className="h-4 w-4" />
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {totalPages > 1 ? (
              <div className="mt-5 flex items-center justify-center gap-2">
                {planPages.map((_, index) => (
                  <button
                    key={`dot-${index + 1}`}
                    type="button"
                    aria-label={`Go to pricing page ${index + 1}`}
                    onClick={() => setPage(index + 1)}
                    className={`h-2.5 rounded-full transition-all ${page === index + 1 ? 'w-8' : 'w-2.5 bg-black/15'}`}
                    style={page === index + 1 ? { backgroundColor: brand } : undefined}
                  />
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <div className="rounded-[34px] border border-dashed border-black/10 bg-white p-8 text-sm leading-7 text-[#4b5563]">
            No active products are published yet. Once plans are added in the platform catalog, they will appear here automatically.
          </div>
        )}
      </section>

      <Dialog open={!!detailsPlan} onOpenChange={(open) => { if (!open) setDetailsPlanId(null); }}>
        <DialogContent className="max-w-3xl overflow-hidden rounded-[28px] border-0 p-0">
          {detailsPlan ? (
            <div className="bg-white">
              <div className="p-8" style={{ background: `linear-gradient(135deg, ${brand}12 0%, rgba(255,249,244,0.96) 100%)` }}>
                <DialogHeader>
                  <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#6b7280]">{detailsPlan.code}</p>
                  <DialogTitle className="mt-2 text-3xl text-[#111827]">{detailsPlan.name}</DialogTitle>
                  <DialogDescription className="mt-3 text-sm leading-7 text-[#4b5563]">
                    {formatPrice(detailsPlan.price, detailsPlan.currency, detailsPlan.billing_period)} with support for up to {detailsPlan.max_users} users, {detailsPlan.max_branches} branches, {detailsPlan.max_devices} devices, and {detailsPlan.max_monthly_transactions.toLocaleString()} monthly transactions.
                  </DialogDescription>
                </DialogHeader>
              </div>

              <div className="grid gap-0 border-t border-black/5 lg:grid-cols-[0.95fr_1.05fr]">
                <div className="p-8">
                  <h3 className="text-lg font-semibold text-[#111827]">What this plan includes</h3>
                  <div className="mt-5 space-y-3">
                    {planFeatureValues(detailsPlan.features).slice(0, 8).map((feature) => (
                      <div key={String(feature)} className="flex items-start gap-3 text-sm text-[#374151]">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: brand }} />
                        <span>{String(feature)}</span>
                      </div>
                    ))}
                    {planFeatureValues(detailsPlan.features).length === 0 ? (
                      <p className="text-sm leading-7 text-[#4b5563]">
                        Plan benefits will appear here once this package is fully configured in Platform Admin.
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="border-t border-black/5 bg-[#fff8f1] p-8 lg:border-l lg:border-t-0">
                  <h3 className="text-lg font-semibold text-[#111827]">Included modules</h3>
                  <div className="mt-5 flex flex-wrap gap-3">
                    {detailsPlan.modules?.map((entry, idx) => {
                      const name = entry.module?.name;
                      if (!name) return null;
                      return (
                        <span key={`${detailsPlan.id}-${name}-${idx}`} className="rounded-full border border-black/5 bg-white px-4 py-2 text-sm text-[#374151]">
                          {name}
                        </span>
                      );
                    })}
                    {!detailsPlan.modules?.some((entry) => entry.module?.name) ? (
                      <p className="text-sm leading-7 text-[#4b5563]">
                        Included modules will appear here once this plan is fully packaged in the platform catalog.
                      </p>
                    ) : null}
                  </div>
                  <div className="mt-8 grid gap-3 sm:grid-cols-2">
                    <Link
                      href={tenantCode ? `/login/${tenantCode}?intent=register&plan=${detailsPlan.id}` : `/login?intent=register&plan=${detailsPlan.id}`}
                      className="inline-flex items-center justify-center rounded-full px-4 py-3.5 text-sm font-semibold text-white transition hover:opacity-90"
                      style={{ backgroundColor: brand }}
                    >
                      Create workspace
                    </Link>
                    <Link
                      href={tenantCode ? `/login/${tenantCode}?intent=subscribe&plan=${detailsPlan.id}` : `/login?intent=subscribe&plan=${detailsPlan.id}`}
                      className="inline-flex items-center justify-center rounded-full border border-black/10 bg-white px-4 py-3.5 text-sm font-semibold text-[#111827] transition hover:border-black/20"
                    >
                      Sign in & subscribe
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </MarketingSiteShell>
  );
}
