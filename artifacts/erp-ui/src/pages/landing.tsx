import {
  ArrowRight,
  Blocks,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  CreditCard,
  Gauge,
  Globe2,
  Landmark,
  LayoutGrid,
  ShieldCheck,
  Truck,
  Users2,
} from 'lucide-react';
import { Link } from 'wouter';
import { MarketingSiteShell } from '@/components/marketing/site-shell';
import { useMarketingSite } from '@/components/marketing/site-data';
import { buildMarketingPath } from '@/lib/public-site';

const APP_SHOWCASE = [
  { label: 'Billing', icon: CreditCard },
  { label: 'Finance', icon: Landmark },
  { label: 'CRM', icon: Users2 },
  { label: 'Procurement', icon: ClipboardList },
  { label: 'Inventory', icon: LayoutGrid },
  { label: 'Operations', icon: BriefcaseBusiness },
  { label: 'Weighbridge', icon: Truck },
  { label: 'Portals', icon: Globe2 },
  { label: 'Reports', icon: Gauge },
  { label: 'Invoicing', icon: CreditCard },
  { label: 'Modules', icon: Blocks },
  { label: 'Workspace', icon: Building2 },
];

function CurvedSurface({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[56px] bg-[#f5f2ed] ${className}`}>{children}</div>;
}

function HighlightStroke({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span className="relative inline-block">
      <span className="absolute inset-x-0 bottom-1 h-3 rounded-full opacity-60" style={{ backgroundColor: color }} />
      <span className="relative">{children}</span>
    </span>
  );
}

export default function LandingPage({ tenantCode }: { tenantCode?: string }) {
  const site = useMarketingSite(tenantCode);
  const brand = site.branding.primary_color ?? '#E85D26';
  const highlights = site.landing_page.highlights ?? [];
  const isTenantSite = site.site_scope === 'tenant';
  const primaryHref = tenantCode ? `/login/${tenantCode}` : (site.landing_page.primary_cta_url ?? '/login');

  return (
    <MarketingSiteShell site={site} tenantCode={tenantCode} currentPage="home">
      <section className="mx-auto max-w-7xl px-6 pb-16 pt-12 sm:px-8 lg:px-10 lg:pb-24 lg:pt-18">
        <div className="grid gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
          <div className="space-y-8">
            <div className="space-y-5">
              <p className="inline-flex rounded-full border border-black/5 bg-white px-4 py-2 text-[11px] font-bold uppercase tracking-[0.28em] text-[#6b7280]">
                {isTenantSite ? 'Tenant public site' : 'SaaS owner public site'}
              </p>
              <h1 className="max-w-5xl text-[3.25rem] font-semibold leading-[0.96] tracking-[-0.05em] text-[#111827] sm:text-[4.8rem] lg:text-[5.45rem]">
                {site.landing_page.headline}
              </h1>
              <div className="max-w-3xl space-y-4">
                <p className="text-[2rem] italic leading-tight tracking-[-0.03em] sm:text-[2.5rem]" style={{ color: '#172033' }}>
                  {site.landing_page.subheadline}
                </p>
                <p className="max-w-2xl text-lg leading-8 text-[#4b5563]">
                  <HighlightStroke color={`${brand}55`}>{site.landing_page.description}</HighlightStroke>
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <Link
                href={primaryHref}
                className="inline-flex items-center justify-center gap-2 rounded-full px-6 py-3.5 text-sm font-semibold text-white transition hover:opacity-90"
                style={{ backgroundColor: brand }}
              >
                {site.landing_page.primary_cta_label ?? 'Start now'}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href={buildMarketingPath(tenantCode, 'pricing')}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-black/10 bg-white px-6 py-3.5 text-sm font-semibold text-[#1f2937] transition hover:border-black/20"
              >
                See pricing
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-[30px] border border-black/5 bg-white p-5 shadow-[0_14px_40px_rgba(17,24,39,0.05)]">
                <p className="text-3xl font-semibold tracking-tight">{APP_SHOWCASE.length}+</p>
                <p className="mt-2 text-sm leading-6 text-[#6b7280]">Connected ERP and billing capabilities in one calm workspace.</p>
              </div>
              <div className="rounded-[30px] border border-black/5 bg-white p-5 shadow-[0_14px_40px_rgba(17,24,39,0.05)]">
                <p className="text-3xl font-semibold tracking-tight">1 stack</p>
                <p className="mt-2 text-sm leading-6 text-[#6b7280]">Subscriptions, finance, CRM, procurement, and operations without tool sprawl.</p>
              </div>
              <div className="rounded-[30px] border border-black/5 bg-white p-5 shadow-[0_14px_40px_rgba(17,24,39,0.05)]">
                <p className="text-3xl font-semibold tracking-tight">Minimal</p>
                <p className="mt-2 text-sm leading-6 text-[#6b7280]">Built to feel simple first, then grow into a full business operating system.</p>
              </div>
            </div>
          </div>

          <div className="relative">
            <CurvedSurface className="relative overflow-hidden border border-black/5 px-6 pb-6 pt-14 shadow-[0_26px_80px_rgba(17,24,39,0.08)]">
              <div className="absolute left-1/2 top-[4.8rem] z-10 -translate-x-1/2">
                <div className="rounded-full border border-black/5 bg-white px-4 py-2 shadow-[0_10px_30px_rgba(17,24,39,0.08)]">
                  <div className="flex items-center gap-3 text-[11px] font-semibold text-[#4b5563]">
                    <span className="rounded-full bg-[#172033] px-2 py-1 text-[10px] uppercase tracking-[0.22em] text-white">Live</span>
                    <span>Workspace provisioning</span>
                    <span className="text-[#9ca3af]">July 27, 2026</span>
                    <span className="font-bold" style={{ color: brand }}>Start onboarding</span>
                  </div>
                </div>
              </div>
              <div className="absolute inset-x-6 top-6 flex items-center justify-between rounded-full border border-black/5 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-[#6b7280]">
                <span>All your business on one platform</span>
                <span>{site.tenant?.name ?? 'Siakora Labs'}</span>
              </div>

              <div className="rounded-[34px] bg-white p-5 shadow-[0_18px_50px_rgba(17,24,39,0.06)]">
                <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
                  {APP_SHOWCASE.map((app) => {
                    const Icon = app.icon;
                    return (
                      <div key={app.label} className="group rounded-[24px] border border-black/5 bg-[#fcfaf6] p-3 text-center transition hover:-translate-y-0.5 hover:border-black/10 hover:bg-white">
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm">
                          <Icon className="h-5 w-5" style={{ color: brand }} />
                        </div>
                        <p className="mt-2 text-[11px] font-medium leading-4 text-[#374151]">{app.label}</p>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-5 rounded-[28px] bg-[#172033] p-5 text-white">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.26em] text-white/45">Workflow</p>
                      <p className="mt-3 text-2xl font-semibold tracking-tight">Billing, approvals, and operations move together.</p>
                    </div>
                    <ShieldCheck className="h-6 w-6 text-[#7dd3c7]" />
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    {highlights.slice(0, 3).map((highlight) => (
                      <div key={highlight} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <CheckCircle2 className="h-4 w-4 text-[#7dd3c7]" />
                        <p className="mt-2 text-sm leading-6 text-white/76">{highlight}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CurvedSurface>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-16 sm:px-8 lg:px-10">
        <div className="grid gap-5 lg:grid-cols-3">
          {[
            {
              title: 'Explore the app ecosystem',
              desc: 'See how billing, CRM, procurement, inventory, and reporting fit together in one modular stack.',
              href: buildMarketingPath(tenantCode, 'apps'),
              icon: LayoutGrid,
            },
            {
              title: 'Review pricing and plans',
              desc: 'Understand how subscriptions are packaged for growing SaaS operators and larger multi-entity teams.',
              href: buildMarketingPath(tenantCode, 'pricing'),
              icon: CreditCard,
            },
            {
              title: 'Read stories and outcomes',
              desc: 'See how cleaner workflows, calmer operations, and better financial visibility show up in real teams.',
              href: buildMarketingPath(tenantCode, 'stories'),
              icon: Users2,
            },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.title} href={item.href} className="rounded-[34px] border border-black/5 bg-white p-6 shadow-[0_16px_46px_rgba(17,24,39,0.05)] transition hover:-translate-y-0.5">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f5f2ed]">
                  <Icon className="h-5 w-5" style={{ color: brand }} />
                </div>
                <p className="mt-5 text-2xl font-semibold tracking-tight text-[#111827]">{item.title}</p>
                <p className="mt-3 text-sm leading-7 text-[#4b5563]">{item.desc}</p>
                <div className="mt-6 inline-flex items-center gap-2 text-sm font-semibold" style={{ color: brand }}>
                  Open page
                  <ArrowRight className="h-4 w-4" />
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </MarketingSiteShell>
  );
}
