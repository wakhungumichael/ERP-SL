import { ArrowRight, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'wouter';
import type { PublicSiteConfig } from '@/lib/public-site';
import { buildMarketingPath } from '@/lib/public-site';

type MarketingPage = 'home' | 'apps' | 'pricing' | 'stories' | 'about' | 'support';

const NAV_ITEMS: Array<{ key: MarketingPage; label: string }> = [
  { key: 'home', label: 'Home' },
  { key: 'support', label: 'Support' },
  { key: 'apps', label: 'Apps' },
  { key: 'pricing', label: 'Pricing' },
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
  const startNowHref = tenantCode ? `/login/${tenantCode}?intent=register` : '/login?intent=register';
  const allowPublicRegistration = site.login_page.show_public_registration !== false;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (site.landing_page.enabled === false) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
        <div className="max-w-md text-center">
          {site.branding.logo_url ? <img src={site.branding.logo_url} alt={`${site.tenant?.name ?? 'Organization'} logo`} className="mx-auto mb-8 h-24 w-64 object-contain" /> : null}
          <h1 className="text-3xl font-semibold">Public site unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-white/65">This organization has chosen to make its workspace available by sign-in only.</p>
          <Link href={loginHref} className="mt-7 inline-flex rounded-full px-5 py-3 text-sm font-semibold text-white" style={{ backgroundColor: brand }}>Sign in</Link>
        </div>
      </main>
    );
  }

  return (
    <div
      className="min-h-screen text-[#111827]"
      style={{
        background: `radial-gradient(circle at top left, ${brand}30 0%, ${brand}14 18%, transparent 38%),
          linear-gradient(115deg, #fff9f4 0%, #fff8f2 34%, #fff4eb 68%, #fff1e7 100%)`,
      }}
    >
      <div
        className="pointer-events-none fixed inset-x-0 top-0 h-[520px] opacity-90"
        style={{
          background: `radial-gradient(circle at 16% 18%, ${brand}22 0%, transparent 30%),
            radial-gradient(circle at 74% 12%, rgba(255,255,255,0.55) 0%, transparent 28%),
            linear-gradient(180deg, rgba(255,255,255,0.5) 0%, rgba(255,248,242,0.18) 72%, rgba(255,244,234,0.08) 100%)`,
        }}
      />

      <div className="relative">
        <header className="mx-auto max-w-7xl px-6 pt-6 sm:px-8 lg:px-10">
          <div className="rounded-[28px] border border-black/5 bg-white/90 px-5 py-3 shadow-[0_18px_60px_rgba(232,93,38,0.12)] backdrop-blur">
            <div className="flex items-center justify-between gap-4">
              <Link href={buildMarketingPath(tenantCode)} className="flex items-center gap-3" onClick={() => setMobileMenuOpen(false)}>
                <div className="flex h-16 w-44 items-center justify-start overflow-hidden">
                  {site.branding.logo_url ? (
                    <img src={site.branding.logo_url} alt={`${site.tenant?.name ?? 'Organization'} logo`} className="h-full w-full object-contain object-left" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center rounded-xl text-sm font-black tracking-[0.2em] text-white" style={{ backgroundColor: brand }}>
                      SL
                    </div>
                  )}
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

              <div className="hidden items-center gap-3 lg:flex">
                <Link href={loginHref} className="text-sm font-semibold text-[#4b5563] transition hover:text-[#111827]">
                  Sign in
                </Link>
                {allowPublicRegistration ? <Link
                  href={startNowHref}
                  className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
                  style={{ backgroundColor: brand }}
                >
                  Start now
                  <ArrowRight className="h-4 w-4" />
                </Link> : null}
              </div>

              <button
                type="button"
                aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={mobileMenuOpen}
                onClick={() => setMobileMenuOpen((open) => !open)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-black/10 bg-white text-[#111827] transition hover:border-black/20 lg:hidden"
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>

            {mobileMenuOpen ? (
              <div className="mt-4 border-t border-black/5 pt-4 lg:hidden">
                <nav className="grid gap-2">
                  {NAV_ITEMS.map((item) => (
                    <Link
                      key={item.key}
                      href={buildMarketingPath(tenantCode, item.key === 'home' ? undefined : item.key)}
                      className={`rounded-2xl px-4 py-3 text-sm font-medium transition ${
                        currentPage === item.key
                          ? 'bg-[#fff4ea] text-[#111827]'
                          : 'text-[#4b5563] hover:bg-[#fff8f1] hover:text-[#111827]'
                      }`}
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {allowPublicRegistration ? <Link
                    href={loginHref}
                    className="inline-flex items-center justify-center rounded-full border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-[#111827] transition hover:border-black/20"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Sign in
                  </Link> : null}
                  <Link
                    href={startNowHref}
                    className="inline-flex items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90"
                    style={{ backgroundColor: brand }}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Start now
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            ) : null}
          </div>
        </header>

        {children}

        <footer className="mt-10 text-white" style={{ background: 'linear-gradient(180deg, #2a1f1a 0%, #181412 100%)' }}>
          <div className="mx-auto max-w-7xl px-6 pt-12 sm:px-8 lg:px-10">
            <div className="mb-10 flex flex-col items-start justify-between gap-6 border-b border-white/10 pb-8 lg:flex-row lg:items-end">
              <div>
                <p className="max-w-3xl text-4xl font-semibold tracking-tight">
                  A quieter way to run subscriptions, teams, and operations.
                </p>
              </div>
              {allowPublicRegistration ? <Link
                href={startNowHref}
                className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
                style={{ backgroundColor: brand }}
              >
                Start now
                <ArrowRight className="h-4 w-4" />
              </Link> : null}
            </div>

            <div className="grid gap-10 py-4 lg:grid-cols-[1.2fr_0.8fr_0.8fr_1fr]">
              <div>
                {site.branding.logo_url ? <img src={site.branding.logo_url} alt={`${site.tenant?.name ?? 'Organization'} logo`} className="h-16 w-48 object-contain object-left" /> : <p className="text-2xl font-semibold tracking-tight">SL ERP</p>}
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
