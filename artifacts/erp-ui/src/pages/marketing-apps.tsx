import { useEffect, useMemo, useState } from 'react';
import type { ComponentType, CSSProperties } from 'react';
import {
  Blocks,
  BriefcaseBusiness,
  Building2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  CreditCard,
  Gauge,
  Globe2,
  Landmark,
  LayoutGrid,
  ReceiptText,
  ShieldCheck,
  Truck,
  Users2,
} from 'lucide-react';
import { Link } from 'wouter';
import { MarketingSiteShell } from '@/components/marketing/site-shell';
import { useMarketingSite } from '@/components/marketing/site-data';
import { buildMarketingPath } from '@/lib/public-site';

const PAGE_SIZE = 9;
const PUBLIC_EXCLUDED_SLUGS = new Set(['platform-core', 'users-access', 'workspace-admin', 'tenant-admin']);

const CATEGORY_ICON = {
  core: Building2,
  shared: Blocks,
  vertical: BriefcaseBusiness,
  integration: Globe2,
} as const;

const MODULE_ICON_BY_SLUG: Record<string, ComponentType<{ className?: string; style?: CSSProperties }>> = {
  accounting: Landmark,
  budgeting: Gauge,
  crm: Users2,
  hr: Users2,
  'hr-payroll': Users2,
  integrations: Globe2,
  inventory: LayoutGrid,
  invoicing: ReceiptText,
  payments: CreditCard,
  'platform-core': Building2,
  procurement: ClipboardList,
  purchases: ClipboardList,
  reporting: Gauge,
  sales: BriefcaseBusiness,
  ticketing: ShieldCheck,
  weighbridge: Truck,
};

function fallbackDescription(slug: string) {
  const descriptions: Record<string, string> = {
    accounting: 'Financial controls, journals, and reporting for the SaaS operating backbone.',
    budgeting: 'Budget governance and spend visibility for growing teams and managed operations.',
    crm: 'Customer lifecycle management from onboarding through support and renewal.',
    'hr-payroll': 'People operations, staff records, and internal administration workflows.',
    integrations: 'External gateway, messaging, and partner connectivity for a connected SaaS stack.',
    inventory: 'Structured catalog, stock visibility, and service-linked fulfillment workflows.',
    invoicing: 'Documented billing, recurring invoicing, and customer-facing commercial flows.',
    payments: 'Collections, settlement tracking, and receipt operations for customer payment workflows.',
    'platform-core': 'The shared operational shell for access, governance, subscriptions, and workspace control.',
    procurement: 'Approval-driven purchasing with operational and finance alignment.',
    purchases: 'Supplier bills, payable execution, and downstream purchasing finance workflows.',
    reporting: 'Practical reporting that reduces guesswork across the business.',
    sales: 'Commercial workflows for selling, quoting, and revenue operations.',
    ticketing: 'Support workflows, public intake, agent queues, and automation.',
    weighbridge: 'Commercial weighbridge workflows with auditability and live operations.',
  };
  return descriptions[slug] ?? 'A focused SaaS capability that can be activated as the platform grows.';
}

export default function MarketingAppsPage({ tenantCode }: { tenantCode?: string }) {
  const site = useMarketingSite(tenantCode);
  const brand = site.branding.primary_color ?? '#E85D26';
  const [page, setPage] = useState(1);
  const createWorkspaceHref = tenantCode ? `/login/${tenantCode}?intent=register` : '/login?intent=register';
  const modules = [...site.modules]
    .filter((module) => module.is_active !== false)
    .filter((module) => module.category !== 'core')
    .filter((module) => !PUBLIC_EXCLUDED_SLUGS.has(module.slug))
    .sort((a, b) => {
      const categoryCompare = (a.category ?? '').localeCompare(b.category ?? '');
      if (categoryCompare !== 0) return categoryCompare;
      return (a.name ?? '').localeCompare(b.name ?? '');
    });
  const totalPages = Math.max(1, Math.ceil(modules.length / PAGE_SIZE));
  const modulePages = useMemo(
    () => Array.from({ length: totalPages }, (_, index) => modules.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE)),
    [modules, totalPages],
  );
  const pagedModules = useMemo(
    () => modulePages[page - 1] ?? [],
    [modulePages, page],
  );
  const categorySummary = useMemo(() => {
    const counts = modules.reduce<Record<string, number>>((acc, module) => {
      const key = module.category || 'other';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, count]) => `${key} (${count})`);
  }, [modules]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (totalPages <= 1) return undefined;
    const timer = window.setInterval(() => {
      setPage((current) => (current >= totalPages ? 1 : current + 1));
    }, 4500);
    return () => window.clearInterval(timer);
  }, [totalPages]);

  return (
    <MarketingSiteShell site={site} tenantCode={tenantCode} currentPage="apps">
      <section className="mx-auto max-w-7xl px-6 pb-14 pt-12 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#6b7280]">Modules and workflows</p>
          <h1 className="mt-4 text-[2.35rem] font-semibold leading-[1.02] tracking-[-0.04em] text-[#111827] sm:text-[3.5rem]">
            Tools your teams can actually run the business with.
            <span className="block italic" style={{ color: brand }}>One connected ERP for every department.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-3xl text-base leading-8 text-[#4b5563]">
            Explore the SL ERP modules built to help businesses sell, buy, serve customers, manage people, control stock, track money, and stay organized from one system.
          </p>
          {categorySummary.length ? (
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              {categorySummary.map((item) => (
                <span key={item} className="rounded-full border border-black/5 bg-white px-4 py-2 text-sm text-[#4b5563] shadow-[0_10px_30px_rgba(232,93,38,0.06)]">
                  {item}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-16 sm:px-8 lg:px-10">
        <div className="mb-6 flex flex-col gap-4 rounded-[30px] border border-black/5 bg-white/90 p-5 shadow-[0_16px_46px_rgba(232,93,38,0.08)] sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[#6b7280]">Module Catalog</p>
            <p className="mt-2 text-sm leading-7 text-[#4b5563]">
              Browse published modules in smaller batches as the platform catalog grows.
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

        {modules.length > 0 ? (
          <>
            <div className="overflow-hidden rounded-[38px]">
              <div
                className="flex transition-transform duration-700 ease-out"
                style={{ transform: `translateX(-${(page - 1) * 100}%)` }}
              >
                {modulePages.map((items, pageIndex) => (
                  <div key={`page-${pageIndex + 1}`} className="w-full shrink-0">
                    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                      {items.map((module, index) => {
                        const Icon = MODULE_ICON_BY_SLUG[module.slug] ?? CATEGORY_ICON[module.category as keyof typeof CATEGORY_ICON] ?? Blocks;
                        const featured = index === 0 && pageIndex === 0;
                        return (
                          <article
                            key={module.id}
                            className={`rounded-[34px] border p-6 shadow-[0_16px_46px_rgba(17,24,39,0.05)] ${
                              featured ? 'text-white border-transparent' : 'bg-white border-black/5 text-[#111827]'
                            }`}
                            style={featured ? { background: 'linear-gradient(180deg, #2d211b 0%, #1b1614 100%)' } : undefined}
                          >
                            <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${featured ? 'bg-white/8' : 'bg-[#fff4ea]'}`}>
                              <Icon className="h-6 w-6" style={{ color: featured ? '#ffd7c2' : brand }} />
                            </div>
                            <h2 className="mt-5 text-2xl font-semibold tracking-tight">{module.name}</h2>
                            <p className={`mt-3 text-sm leading-7 ${featured ? 'text-white/74' : 'text-[#4b5563]'}`}>
                              {module.description || fallbackDescription(module.slug)}
                            </p>
                            <div className="mt-6 flex flex-wrap gap-3">
                              <Link
                                href={buildMarketingPath(tenantCode, 'pricing')}
                                className={`inline-flex items-center justify-center rounded-full px-4 py-2.5 text-sm font-semibold transition ${
                                  featured
                                    ? 'bg-white text-[#111827] hover:bg-white/92'
                                    : 'text-white hover:opacity-90'
                                }`}
                                style={featured ? undefined : { backgroundColor: brand }}
                              >
                                See plans
                              </Link>
                              <Link
                                href={createWorkspaceHref}
                                className={`inline-flex items-center justify-center rounded-full border px-4 py-2.5 text-sm font-semibold transition ${
                                  featured
                                    ? 'border-white/14 bg-white/6 text-white hover:bg-white/10'
                                    : 'border-black/10 bg-white text-[#111827] hover:border-black/20'
                                }`}
                              >
                                Create workspace
                              </Link>
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
                {modulePages.map((_, index) => (
                  <button
                    key={`dot-${index + 1}`}
                    type="button"
                    aria-label={`Go to module page ${index + 1}`}
                    onClick={() => setPage(index + 1)}
                    className={`h-2.5 rounded-full transition-all ${page === index + 1 ? 'w-8' : 'w-2.5 bg-black/15'}`}
                    style={page === index + 1 ? { backgroundColor: brand } : undefined}
                  />
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <article className="rounded-[34px] border border-dashed border-black/10 bg-white p-8 text-center text-sm text-[#4b5563] shadow-[0_16px_46px_rgba(232,93,38,0.08)]">
            No active SaaS modules are published yet. Activate modules in Platform Admin and they will appear here automatically.
          </article>
        )}
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-16 sm:px-8 lg:px-10">
        <div className="grid gap-5 lg:grid-cols-[0.92fr_1.08fr]">
          <div className="rounded-[36px] border border-black/5 bg-white p-7 shadow-[0_16px_46px_rgba(232,93,38,0.08)]">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#6b7280]">Built For Growth</p>
            <h3 className="mt-4 text-3xl font-semibold tracking-tight text-[#111827]">Start with what you need today and expand as your business grows.</h3>
            <p className="mt-4 text-sm leading-7 text-[#4b5563]">
              SL ERP gives you one connected business platform for finance, operations, customer service, and commercial workflows, so you can add capability without adding confusion.
            </p>
          </div>

          <div className="rounded-[36px] border border-black/5 bg-[#fff4ea] p-7 shadow-[0_16px_46px_rgba(232,93,38,0.08)]">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5" style={{ color: brand }} />
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#6b7280]">Connected by default</p>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                'Turn quotes into invoices and collections without re-entering data.',
                'Keep purchasing, approvals, and supplier activity under one clear process.',
                'Track stock, operations, and performance from one live view of the business.',
                'Give sales, support, and service teams the same customer history in one place.',
              ].map((line) => (
                <div key={line} className="rounded-[24px] bg-white p-4 text-sm leading-6 text-[#374151] shadow-sm">
                  {line}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </MarketingSiteShell>
  );
}
