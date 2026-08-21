import { MessageSquareQuote } from 'lucide-react';
import { Link } from 'wouter';
import { MarketingSiteShell } from '@/components/marketing/site-shell';
import { useMarketingSite } from '@/components/marketing/site-data';

const TESTIMONIALS = [
  {
    quote: 'We stopped managing subscriptions in one tool and finance in another. The team finally works from a shared source of truth.',
    author: 'Commercial Lead',
    company: 'Regional SaaS Operator',
  },
  {
    quote: 'The platform feels calm. It gives us fewer clicks, cleaner approvals, and much better visibility across tenants.',
    author: 'Operations Director',
    company: 'Multi-entity Services Group',
  },
  {
    quote: 'The system helped us move from reactive billing to structured subscription operations with real accountability.',
    author: 'Finance Manager',
    company: 'B2B Software Team',
  },
];

export default function MarketingStoriesPage({ tenantCode }: { tenantCode?: string }) {
  const site = useMarketingSite(tenantCode);
  const brand = site.branding.primary_color ?? '#E85D26';
  const startNowHref = tenantCode ? `/login/${tenantCode}?intent=register` : '/login?intent=register';

  return (
    <MarketingSiteShell site={site} tenantCode={tenantCode} currentPage="stories">
      <section className="mx-auto max-w-7xl px-6 pb-14 pt-12 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#6b7280]">Stories and outcomes</p>
          <h1 className="mt-4 text-[3rem] font-semibold leading-[0.98] tracking-[-0.05em] text-[#111827] sm:text-[4.3rem]">
            Real operational calm.
            <span className="block italic" style={{ color: brand }}>Not just more software.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-3xl text-base leading-8 text-[#4b5563]">
            Better platforms don’t just add features. They reduce friction, improve visibility,
            and help teams make cleaner decisions every day.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-16 sm:px-8 lg:px-10">
        <div className="rounded-[36px] border border-black/5 bg-white p-7 shadow-[0_16px_46px_rgba(17,24,39,0.05)]">
          <p className="text-3xl font-semibold leading-tight tracking-tight text-[#111827]">
            “The biggest win was not speed alone. It was having billing, finance, workflow,
            and operations finally speak the same language.”
          </p>
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-3">
          {TESTIMONIALS.map((entry, index) => (
            <article key={entry.author} className="rounded-[34px] border border-black/5 bg-white p-6 shadow-[0_16px_46px_rgba(17,24,39,0.05)]">
              <div
                className="flex h-12 w-12 items-center justify-center rounded-full text-white"
                style={{ backgroundColor: index === 1 ? '#0f8c95' : brand }}
              >
                <MessageSquareQuote className="h-5 w-5" />
              </div>
              <p className="mt-5 text-lg leading-8 text-[#1f2937]">“{entry.quote}”</p>
              <div className="mt-6">
                <p className="text-sm font-semibold text-[#111827]">{entry.author}</p>
                <p className="text-xs uppercase tracking-[0.2em] text-[#6b7280]">{entry.company}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-16 sm:px-8 lg:px-10">
        <div className="rounded-[40px] bg-[#172033] px-8 py-14 text-center text-white shadow-[0_16px_46px_rgba(17,24,39,0.08)]">
          <p className="text-[2.4rem] font-semibold italic leading-tight tracking-[-0.03em] sm:text-[3rem]">
            Unleash your growth potential.
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-white/70">
            Build subscription operations that feel more structured, more predictable, and easier for teams to manage.
          </p>
          <div className="mt-7">
            <Link
              href={startNowHref}
              className="inline-flex items-center rounded-full px-6 py-3.5 text-sm font-semibold text-white transition hover:opacity-90"
              style={{ backgroundColor: brand }}
            >
              Start now
            </Link>
          </div>
        </div>
      </section>
    </MarketingSiteShell>
  );
}
