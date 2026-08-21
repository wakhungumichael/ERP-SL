import { Link } from 'wouter';
import { ArrowRight, CheckCircle2, Compass, Network, ShieldCheck } from 'lucide-react';
import { MarketingSiteShell } from '@/components/marketing/site-shell';
import { useMarketingSite } from '@/components/marketing/site-data';
import { buildMarketingPath } from '@/lib/public-site';

export default function MarketingAboutPage({ tenantCode }: { tenantCode?: string }) {
  const site = useMarketingSite(tenantCode);
  const brand = site.branding.primary_color ?? '#E85D26';
  const startNowHref = tenantCode ? `/login/${tenantCode}?intent=register` : '/login?intent=register';

  return (
    <MarketingSiteShell site={site} tenantCode={tenantCode} currentPage="about">
      <section className="mx-auto max-w-7xl px-6 pb-14 pt-12 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#6b7280]">About SL ERP</p>
          <h1 className="mt-4 text-[2.8rem] font-semibold leading-[1] tracking-[-0.05em] text-[#111827] sm:text-[4rem]">
            SL ERP helps businesses run
            <span className="block italic" style={{ color: brand }}>with more clarity, control, and confidence.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-3xl text-base leading-8 text-[#4b5563]">
            We build practical business software for teams that want finance, operations, inventory, people,
            billing, and customer workflows working together in one reliable system.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-16 sm:px-8 lg:px-10">
        <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-[36px] border border-black/5 bg-white p-7 shadow-[0_16px_46px_rgba(232,93,38,0.08)]">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#fff4ea]">
              <Compass className="h-5 w-5" style={{ color: brand }} />
            </div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#6b7280]">What we believe</p>
            <p className="mt-4 text-3xl font-semibold tracking-tight text-[#111827]">Business software should feel usable, not overwhelming.</p>
            <p className="mt-4 text-sm leading-7 text-[#4b5563]">
              We believe growing businesses need clear workflows, connected records, and dependable reporting,
              without being buried under clutter, disconnected tools, or hard-to-manage processes.
            </p>
          </div>
          <div className="rounded-[36px] border border-black/5 bg-[#fff7ef] p-7 shadow-[0_16px_46px_rgba(232,93,38,0.08)]">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm">
              <Network className="h-5 w-5" style={{ color: brand }} />
            </div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#6b7280]">What we design for</p>
            <p className="mt-4 text-3xl font-semibold tracking-tight text-[#111827]">Teams that want one system instead of scattered work.</p>
            <p className="mt-4 text-sm leading-7 text-[#4b5563]">
              SL ERP is built for small businesses, growing companies, and larger organizations that need better
              visibility across departments and smoother day-to-day coordination as they scale.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-16 sm:px-8 lg:px-10">
        <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[40px] bg-[#172033] px-8 py-12 text-white shadow-[0_16px_46px_rgba(17,24,39,0.08)]">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-white/45">Why businesses choose SL ERP</p>
            <p className="mt-4 text-[2.2rem] font-semibold leading-tight tracking-[-0.03em] sm:text-[2.8rem]">
              One calmer foundation for the work your teams do every day.
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {[
                'Connected finance, billing, and operations',
                'Cleaner visibility across teams and branches',
                'Practical workflows that support daily execution',
                'Room to add modules as the business grows',
              ].map((item) => (
                <div key={item} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <CheckCircle2 className="h-4 w-4 text-[#7dd3c7]" />
                  <p className="mt-2 text-sm leading-6 text-white/76">{item}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[40px] border border-black/5 bg-white px-8 py-12 shadow-[0_16px_46px_rgba(232,93,38,0.08)]">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#fff4ea]">
              <ShieldCheck className="h-5 w-5" style={{ color: brand }} />
            </div>
            <p className="mt-5 text-2xl font-semibold tracking-tight text-[#111827]">
              Start with the essentials, then grow into more.
            </p>
            <p className="mt-4 text-sm leading-7 text-[#4b5563]">
              Begin with a cleaner business core, then expand into the modules, teams, and workflows your organization needs next.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link
                href={startNowHref}
                className="inline-flex items-center justify-center gap-2 rounded-full px-6 py-3.5 text-sm font-semibold text-white transition hover:opacity-90"
                style={{ backgroundColor: brand }}
              >
                Start now
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href={buildMarketingPath(tenantCode, 'pricing')}
                className="inline-flex items-center justify-center rounded-full border border-black/10 bg-white px-6 py-3.5 text-sm font-semibold text-[#111827] transition hover:border-black/20"
              >
                See pricing
              </Link>
            </div>
          </div>
        </div>
      </section>
    </MarketingSiteShell>
  );
}
