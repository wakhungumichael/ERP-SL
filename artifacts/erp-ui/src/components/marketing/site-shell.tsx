import { ArrowRight, Sparkles } from 'lucide-react';
import { Link } from 'wouter';
import type { PublicSiteConfig } from '@/lib/public-site';
import { buildMarketingPath } from '@/lib/public-site';

type MarketingPage = 'home' | 'apps' | 'pricing' | 'stories' | 'about';

const NAV_ITEMS: Array<{ key: MarketingPage; label: string }> = [
  { key: 'home', label: 'Home' },
  { key: 'apps', label: 'Apps' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'stories', label: 'Stories' },
  { key: 'about', label: 'About' },
];

export function MarketingSiteShell({
  site,
  tenantCode,
  currentPage,
  children,
}: {
  site: PublicSiteConfig;
  tenantCode?: string;
  currentPage: MarketingPage;
  children: React.ReactNode;
}) {
  const brand = site.branding.primary_color ?? '#E85D26';
  const loginHref = tenantCode ? `/login/${tenantCode}` : '/login';

  return (
    <div className="min-h-screen bg-[#fcfaf6] text-[#111827]">
      <div
        className="pointer-events-none fixed inset-x-0 top-0 h-[520px] opacity-90"
        style={{
          background: `radial-gradient(circle at 18% 22%, ${brand}20 0, transparent 22%),
            radial-gradient(circle at 82% 10%, #0f8c9514 0, transparent 20%),
            linear-gradient(180deg, #fffdf8 0%, #fcfaf6 72%)`,
        }}
      />

      <div className="relative">
        <header className="mx-auto max-w-7xl px-6 pt-6 sm:px-8 lg:px-10">
          <div className="flex items-center justify-between rounded-full border border-black/5 bg-white/80 px-5 py-3 shadow-[0_18px_60px_rgba(17,24,39,0.06)] backdrop-blur">
            <Link href={buildMarketingPath(tenantCode)} className="flex items-center gap-3">
              <div
                className="flex h-11 w-11 items-center justify-center rounded-2xl text-white shadow-sm"
                style={{ backgroundColor: brand }}
              >
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-[#6b7280]">
                  Siakora Labs
                </p>
                <p className="text-lg font-semibold tracking-tight">
                  {site.tenant?.name ?? 'SL-ERP'}
                </p>
              </div>
            </Link>

            <nav className="hidden items-center gap-6 text-sm font-medium text-[#4b5563] lg:flex">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.key}
                  href={buildMarketingPath(tenantCode, item.key === 'home' ? undefined : item.key)}
                  className={`transition hover:text-[#111827] ${currentPage === item.key ? 'text-[#111827]' : ''}`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            <div className="flex items-center gap-3">
              <Link href={loginHref} className="hidden text-sm font-semibold text-[#4b5563] transition hover:text-[#111827] sm:inline-flex">
                Sign in
              </Link>
              <Link
                href={loginHref}
                className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
                style={{ backgroundColor: brand }}
              >
                Start now
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </header>

        {children}

        <footer className="mt-10 bg-[#1e2230] text-white">
          <div className="mx-auto max-w-7xl px-6 pt-12 sm:px-8 lg:px-10">
            <div className="mb-10 flex flex-col items-start justify-between gap-6 border-b border-white/10 pb-8 lg:flex-row lg:items-end">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-white/45">Siakora Labs</p>
                <p className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight">
                  A quieter way to run subscriptions, teams, and operations.
                </p>
              </div>
              <Link
                href={loginHref}
                className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
                style={{ backgroundColor: brand }}
              >
                Start now
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="grid gap-10 py-4 lg:grid-cols-[1.2fr_0.8fr_0.8fr_1fr]">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-white/45">Siakora Labs</p>
                <p className="mt-3 text-2xl font-semibold tracking-tight">{site.tenant?.name ?? 'SL-ERP'}</p>
                <p className="mt-4 max-w-md text-sm leading-7 text-white/68">
                  {site.branding.footer_text || 'Subscription billing, ERP operations, and customer workflows in one minimal platform.'}
                </p>
              </div>

              <div>
                <p className="text-sm font-semibold">Site</p>
                <nav className="mt-4 space-y-3 text-sm text-white/68">
                  {NAV_ITEMS.map((item) => (
                    <Link
                      key={item.key}
                      href={buildMarketingPath(tenantCode, item.key === 'home' ? undefined : item.key)}
                      className="block transition hover:text-white"
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>
              </div>

              <div>
                <p className="text-sm font-semibold">Access</p>
                <nav className="mt-4 space-y-3 text-sm text-white/68">
                  <Link href={loginHref} className="block transition hover:text-white">Sign in</Link>
                  <Link href={buildMarketingPath(tenantCode, 'pricing')} className="block transition hover:text-white">See pricing</Link>
                  <Link href={buildMarketingPath(tenantCode, 'stories')} className="block transition hover:text-white">Customer stories</Link>
                </nav>
              </div>

              <div>
                <p className="text-sm font-semibold">Menu</p>
                <nav className="mt-4 space-y-3 text-sm text-white/68">
                  {site.footer_menu.map((item) => (
                    <a key={`${item.label}-${item.href}`} href={item.href} className="block transition hover:text-white">
                      {item.label}
                    </a>
                  ))}
                </nav>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
