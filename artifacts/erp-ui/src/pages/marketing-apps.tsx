import {
  Blocks,
  BriefcaseBusiness,
  Building2,
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
import { MarketingSiteShell } from '@/components/marketing/site-shell';
import { useMarketingSite } from '@/components/marketing/site-data';

const APP_GROUPS = [
  { label: 'Billing', icon: CreditCard, text: 'Subscription plans, recurring billing, collections, and invoicing in one place.' },
  { label: 'Finance', icon: Landmark, text: 'Financial visibility, transaction control, and cleaner posting workflows.' },
  { label: 'CRM', icon: Users2, text: 'Customer lifecycle management from onboarding through support and renewal.' },
  { label: 'Procurement', icon: ClipboardList, text: 'Approval-driven purchasing with operational and finance alignment.' },
  { label: 'Inventory', icon: LayoutGrid, text: 'Stock visibility, product structure, and service-linked operations.' },
  { label: 'Operations', icon: BriefcaseBusiness, text: 'Daily workspaces for service teams, admins, and operators.' },
  { label: 'Weighbridge', icon: Truck, text: 'Commercial weighbridge workflows with auditability and live operations.' },
  { label: 'Portals', icon: Globe2, text: 'External-facing tenant and customer experiences with controlled access.' },
  { label: 'Reports', icon: Gauge, text: 'Practical reporting that reduces guesswork across the business.' },
  { label: 'Invoicing', icon: ReceiptText, text: 'Structured document flows for billing, approvals, and customer communication.' },
  { label: 'Modules', icon: Blocks, text: 'Grow the platform gradually by activating only what the business needs.' },
  { label: 'Workspace', icon: Building2, text: 'A unified operational shell that keeps everything connected and calm.' },
];

export default function MarketingAppsPage({ tenantCode }: { tenantCode?: string }) {
  const site = useMarketingSite(tenantCode);
  const brand = site.branding.primary_color ?? '#E85D26';

  return (
    <MarketingSiteShell site={site} tenantCode={tenantCode} currentPage="apps">
      <section className="mx-auto max-w-7xl px-6 pb-14 pt-12 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#6b7280]">Apps and capabilities</p>
          <h1 className="mt-4 text-[3rem] font-semibold leading-[0.98] tracking-[-0.05em] text-[#111827] sm:text-[4.5rem]">
            Every critical workflow.
            <span className="block italic" style={{ color: brand }}>One shared operating system.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-3xl text-base leading-8 text-[#4b5563]">
            Explore the business apps that make the platform feel complete without becoming noisy.
            Each module is designed to stand on its own, while still connecting naturally to the rest.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-16 sm:px-8 lg:px-10">
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {APP_GROUPS.map((app, index) => {
            const Icon = app.icon;
            return (
              <article
                key={app.label}
                className={`rounded-[34px] border p-6 shadow-[0_16px_46px_rgba(17,24,39,0.05)] ${
                  index === 0 ? 'bg-[#172033] text-white border-transparent' : 'bg-white border-black/5 text-[#111827]'
                }`}
              >
                <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${index === 0 ? 'bg-white/8' : 'bg-[#f5f2ed]'}`}>
                  <Icon className="h-6 w-6" style={{ color: index === 0 ? '#7dd3c7' : brand }} />
                </div>
                <h2 className="mt-5 text-2xl font-semibold tracking-tight">{app.label}</h2>
                <p className={`mt-3 text-sm leading-7 ${index === 0 ? 'text-white/74' : 'text-[#4b5563]'}`}>{app.text}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-16 sm:px-8 lg:px-10">
        <div className="grid gap-5 lg:grid-cols-[0.92fr_1.08fr]">
          <div className="rounded-[36px] border border-black/5 bg-white p-7 shadow-[0_16px_46px_rgba(17,24,39,0.05)]">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#6b7280]">Designed for clarity</p>
            <h3 className="mt-4 text-3xl font-semibold tracking-tight text-[#111827]">Use fewer systems without losing depth.</h3>
            <p className="mt-4 text-sm leading-7 text-[#4b5563]">
              The app model is intentionally modular. Teams can begin with billing and finance, then add operations,
              procurement, CRM, or industry-specific workflows without rebuilding the whole system later.
            </p>
          </div>

          <div className="rounded-[36px] border border-black/5 bg-[#f5f2ed] p-7 shadow-[0_16px_46px_rgba(17,24,39,0.05)]">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5" style={{ color: brand }} />
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#6b7280]">Connected by default</p>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                'Subscriptions inform finance automatically.',
                'Customer actions can trigger workflow routes.',
                'Procurement and billing stay visible to admins.',
                'Tenant growth can unlock more modules cleanly.',
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
