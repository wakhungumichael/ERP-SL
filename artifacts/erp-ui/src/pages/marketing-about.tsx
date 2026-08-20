import { Link } from 'wouter';
import { MarketingSiteShell } from '@/components/marketing/site-shell';
import { useMarketingSite } from '@/components/marketing/site-data';

export default function MarketingAboutPage({ tenantCode }: { tenantCode?: string }) {
  const site = useMarketingSite(tenantCode);
  const brand = site.branding.primary_color ?? '#E85D26';
  const loginHref = tenantCode ? `/login/${tenantCode}` : '/login';

  return (
    <MarketingSiteShell site={site} tenantCode={tenantCode} currentPage="about">
      <section className="mx-auto max-w-7xl px-6 pb-14 pt-12 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#6b7280]">About Siakora Labs</p>
          <h1 className="mt-4 text-[3rem] font-semibold leading-[0.98] tracking-[-0.05em] text-[#111827] sm:text-[4.3rem]">
            We build systems that make work
            <span className="block italic" style={{ color: brand }}>feel clearer, calmer, and more connected.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-3xl text-base leading-8 text-[#4b5563]">
            Siakora Labs focuses on practical business software for teams that need operational discipline
            without the noise and complexity that usually comes with enterprise systems.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-16 sm:px-8 lg:px-10">
        <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-[36px] border border-black/5 bg-white p-7 shadow-[0_16px_46px_rgba(17,24,39,0.05)]">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#6b7280]">What we believe</p>
            <p className="mt-4 text-3xl font-semibold tracking-tight text-[#111827]">Minimal software can still be powerful.</p>
            <p className="mt-4 text-sm leading-7 text-[#4b5563]">
              We prefer quiet interfaces, connected workflows, and systems that reduce fragmentation across billing,
              operations, approvals, customer management, and finance.
            </p>
          </div>
          <div className="rounded-[36px] border border-black/5 bg-[#f5f2ed] p-7 shadow-[0_16px_46px_rgba(17,24,39,0.05)]">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#6b7280]">What we design for</p>
            <p className="mt-4 text-3xl font-semibold tracking-tight text-[#111827]">Growing operators who need clarity before complexity.</p>
            <p className="mt-4 text-sm leading-7 text-[#4b5563]">
              The platform is meant for disciplined teams that want one place to package products, manage subscriptions,
              onboard tenants, and operate the business with less friction.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-16 sm:px-8 lg:px-10">
        <div className="rounded-[40px] bg-[#172033] px-8 py-14 text-center text-white shadow-[0_16px_46px_rgba(17,24,39,0.08)]">
          <p className="text-[2.2rem] font-semibold italic leading-tight tracking-[-0.03em] sm:text-[2.8rem]">
            Build on a calmer foundation.
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-white/70">
            Start with a cleaner operational core, then expand into the workflows your business actually needs.
          </p>
          <div className="mt-7">
            <Link
              href={loginHref}
              className="inline-flex items-center rounded-full px-6 py-3.5 text-sm font-semibold text-white transition hover:opacity-90"
              style={{ backgroundColor: brand }}
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>
    </MarketingSiteShell>
  );
}
