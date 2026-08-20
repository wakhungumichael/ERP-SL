import { CheckCircle2 } from 'lucide-react';
import { Link } from 'wouter';
import { MarketingSiteShell } from '@/components/marketing/site-shell';
import { useMarketingSite } from '@/components/marketing/site-data';

function formatPrice(value: string | number, currency: string, billingPeriod: string) {
  const amount = Number(value ?? 0);
  return `${currency} ${Number.isFinite(amount) ? amount.toLocaleString() : value}/${billingPeriod}`;
}

export default function MarketingPricingPage({ tenantCode }: { tenantCode?: string }) {
  const site = useMarketingSite(tenantCode);
  const brand = site.branding.primary_color ?? '#E85D26';
  const loginHref = tenantCode ? `/login/${tenantCode}` : '/login';
  const highlights = site.landing_page.highlights ?? [];

  return (
    <MarketingSiteShell site={site} tenantCode={tenantCode} currentPage="pricing">
      <section className="mx-auto max-w-7xl px-6 pb-14 pt-12 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#6b7280]">Pricing</p>
          <h1 className="mt-4 text-[3rem] font-semibold leading-[0.98] tracking-[-0.05em] text-[#111827] sm:text-[4.3rem]">
            Subscription plans built
            <span className="block italic" style={{ color: brand }}>for disciplined SaaS growth.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-3xl text-base leading-8 text-[#4b5563]">
            Choose a package that fits the stage of your business, then grow into more modules,
            more users, and more operational depth without changing systems.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-16 sm:px-8 lg:px-10">
        <div className="grid gap-5 lg:grid-cols-3">
          {site.plans.length > 0 ? site.plans.map((plan, index) => {
            const featureValues = Array.isArray(plan.features)
              ? plan.features
              : Object.values(plan.features ?? {}).filter((value) => typeof value === 'string');
            return (
              <article
                key={plan.id}
                className={`flex h-full flex-col rounded-[34px] border p-6 shadow-[0_16px_46px_rgba(17,24,39,0.05)] ${
                  index === 1 ? 'border-transparent bg-[#172033] text-white' : 'border-black/5 bg-white text-[#111827]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className={`text-xs font-bold uppercase tracking-[0.24em] ${index === 1 ? 'text-white/45' : 'text-[#6b7280]'}`}>
                      {plan.code}
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-tight">{plan.name}</h2>
                  </div>
                  {plan.trial_days > 0 && (
                    <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] ${index === 1 ? 'bg-white/10 text-white' : 'bg-[#fff4e8] text-[#c76812]'}`}>
                      {plan.trial_days} day trial
                    </span>
                  )}
                </div>

                <p className="mt-6 text-4xl font-semibold tracking-tight">{formatPrice(plan.price, plan.currency, plan.billing_period)}</p>
                <p className={`mt-2 text-sm leading-6 ${index === 1 ? 'text-white/70' : 'text-[#6b7280]'}`}>
                  Up to {plan.max_users} users, {plan.max_branches} branches, {plan.max_devices} devices, and {plan.max_monthly_transactions.toLocaleString()} monthly transactions.
                </p>

                <div className="mt-6 space-y-3">
                  {(featureValues.length ? featureValues : highlights).slice(0, 5).map((feature) => (
                    <div key={String(feature)} className="flex items-start gap-3 text-sm">
                      <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${index === 1 ? 'text-[#7dd3c7]' : ''}`} style={index === 1 ? undefined : { color: brand }} />
                      <span className={index === 1 ? 'text-white/82' : 'text-[#374151]'}>{String(feature)}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-auto pt-8">
                  <Link
                    href={loginHref}
                    className={`inline-flex w-full items-center justify-center rounded-full px-4 py-3.5 text-sm font-semibold transition ${index === 1 ? 'bg-white text-[#111827] hover:bg-white/92' : 'text-white hover:opacity-90'}`}
                    style={index === 1 ? undefined : { backgroundColor: brand }}
                  >
                    Choose {plan.name}
                  </Link>
                </div>
              </article>
            );
          }) : (
            <div className="rounded-[34px] border border-dashed border-black/10 bg-white p-8 text-sm leading-7 text-[#4b5563] lg:col-span-3">
              No active products are published yet. Once plans are added in the platform catalog, they will appear here automatically.
            </div>
          )}
        </div>
      </section>
    </MarketingSiteShell>
  );
}
