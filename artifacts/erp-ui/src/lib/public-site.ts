export interface PublicNavLink {
  label: string;
  href: string;
}

export interface PublicPlan {
  id: number;
  code: string;
  name: string;
  billing_period: string;
  price: string | number;
  currency: string;
  trial_days: number;
  max_users: number;
  max_branches: number;
  max_devices: number;
  max_monthly_transactions: number;
  features?: Record<string, unknown> | string[];
  modules?: Array<{ id: number; module?: { name?: string } }>;
}

export interface PublicSiteConfig {
  tenant?: {
    id?: number;
    name?: string;
    code?: string;
  } | null;
  site_scope?: 'owner' | 'tenant';
  branding: {
    logo_url?: string;
    primary_color?: string;
    footer_text?: string;
    support_email?: string;
  };
  login_page: {
    eyebrow?: string;
    title?: string;
    subtitle?: string;
    description?: string;
  };
  landing_page: {
    eyebrow?: string;
    headline?: string;
    subheadline?: string;
    description?: string;
    primary_cta_label?: string;
    primary_cta_url?: string;
    secondary_cta_label?: string;
    secondary_cta_url?: string;
    highlights?: string[];
  };
  footer_menu: PublicNavLink[];
  plans: PublicPlan[];
}

export const DEFAULT_PUBLIC_SITE: PublicSiteConfig = {
  tenant: { name: 'Siakora Labs' },
  branding: {
    primary_color: '#E85D26',
    footer_text: 'Minimal ERP and subscription billing for growing SaaS operators.',
    support_email: '',
  },
  login_page: {
    eyebrow: 'Siakora Labs Platform',
    title: 'Welcome back to Siakora Labs',
    subtitle: 'Manage subscriptions, operations, finance, and customer workflows from one workspace.',
    description: 'A calm operating system for SaaS teams that want fewer tools, cleaner billing, and better control.',
  },
  landing_page: {
    eyebrow: 'Minimal ERP For SaaS Operators',
    headline: 'All your business workflows on one calm platform.',
    subheadline: 'Simple, connected, and ready for subscription growth.',
    description: 'Run billing, finance, customer operations, and internal workflows from one minimal system designed by Siakora Labs.',
    primary_cta_label: 'Start Now',
    primary_cta_url: '/login',
    secondary_cta_label: 'See Pricing',
    secondary_cta_url: '#plans',
    highlights: [
      'Tenant onboarding and workspace provisioning',
      'Plan-based SaaS subscriptions and billing operations',
      'Operations, finance, CRM, and workflow management',
    ],
  },
  footer_menu: [
    { label: 'Plans', href: '#plans' },
    { label: 'Sign In', href: '/login' },
  ],
  plans: [],
};

export async function fetchPublicSiteConfig(tenantCode?: string): Promise<PublicSiteConfig> {
  const query = tenantCode ? `?tenant_code=${encodeURIComponent(tenantCode)}` : '';
  const response = await fetch(`/api/platform/public/site/${query}`);
  if (!response.ok) {
    throw new Error(`Failed to load site config (${response.status})`);
  }
  const json = await response.json();
  return {
    ...DEFAULT_PUBLIC_SITE,
    ...(json?.data ?? {}),
    branding: {
      ...DEFAULT_PUBLIC_SITE.branding,
      ...(json?.data?.branding ?? {}),
    },
    login_page: {
      ...DEFAULT_PUBLIC_SITE.login_page,
      ...(json?.data?.login_page ?? {}),
    },
    landing_page: {
      ...DEFAULT_PUBLIC_SITE.landing_page,
      ...(json?.data?.landing_page ?? {}),
    },
    footer_menu: Array.isArray(json?.data?.footer_menu) ? json.data.footer_menu : DEFAULT_PUBLIC_SITE.footer_menu,
    plans: Array.isArray(json?.data?.plans) ? json.data.plans : [],
  };
}

export function buildMarketingPath(tenantCode?: string, page?: string) {
  const base = tenantCode ? `/landing/${tenantCode}` : '/landing';
  return page ? `${base}/${page}` : base;
}
