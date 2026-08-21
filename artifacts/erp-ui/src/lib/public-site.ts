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

export interface PublicModule {
  id: number;
  slug: string;
  name: string;
  category: string;
  scope: string;
  description?: string;
  is_core?: boolean;
  is_active?: boolean;
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
  support_page: {
    eyebrow?: string;
    headline?: string;
    subheadline?: string;
    description?: string;
    primary_cta_label?: string;
    secondary_cta_label?: string;
    form_title?: string;
    form_description?: string;
    tracking_title?: string;
    tracking_description?: string;
    status_title?: string;
    success_title?: string;
    success_description?: string;
    highlights?: string[];
    form_fields?: Array<{
      key?: string;
      label?: string;
      type?: 'text' | 'email' | 'tel' | 'textarea' | 'select';
      placeholder?: string;
      required?: boolean;
      enabled?: boolean;
      options?: string[];
    }>;
  };
  footer_menu: PublicNavLink[];
  plans: PublicPlan[];
  modules: PublicModule[];
}

export const DEFAULT_PUBLIC_SITE: PublicSiteConfig = {
  tenant: { name: 'SL ERP' },
  branding: {
    primary_color: '#E85D26',
    footer_text: 'Built for small businesses, growing companies, and large enterprises that need one reliable business system.',
    support_email: '',
  },
  login_page: {
    eyebrow: 'SL ERP',
    title: 'SL ERP',
    subtitle: 'SL ERP for small businesses, growing companies, and large enterprises.',
    description: 'A scalable business system built to support everyday operations, finance, billing, and control at every stage of growth.',
  },
  landing_page: {
    eyebrow: 'SL ERP',
    headline: 'SL ERP for small businesses, growing companies, and large enterprises.',
    subheadline: 'Manage finance, operations, inventory, HR, CRM, support, and approvals in one connected business system.',
    description: 'Replace scattered tools with one scalable ERP built for visibility, speed, control, and better decisions across every department.',
    primary_cta_label: 'Start Now',
    primary_cta_url: '/login',
    secondary_cta_label: 'See Pricing',
    secondary_cta_url: '#plans',
    highlights: [
      'Order to cash with billing and collections',
      'Procurement, approvals, and supplier control',
      'Inventory, operations, and live reporting',
    ],
  },
  support_page: {
    eyebrow: 'Customer Support',
    headline: 'How can we help today?',
    subheadline: 'Contact our team for support, billing, account, or service questions.',
    description: 'Share the details below and our team will guide your request to the right people.',
    primary_cta_label: 'Send Request',
    secondary_cta_label: 'Check Request Status',
    form_title: 'Send us a request',
    form_description: 'Tell us what you need and we will route it to the best team to help you.',
    tracking_title: 'Check your request status',
    tracking_description: 'Enter your request number and email address to see the latest progress.',
    status_title: 'Current update',
    success_title: 'Request received',
    success_description: 'Please keep your request number for future follow-up.',
    highlights: [
      'Reach the right team faster',
      'Receive clear status updates',
      'Stay within your branded support experience',
    ],
    form_fields: [
      { key: 'requester_name', label: 'Full name', type: 'text', placeholder: 'Your full name', required: false, enabled: true },
      { key: 'requester_email', label: 'Email address', type: 'email', placeholder: 'you@example.com', required: true, enabled: true },
      { key: 'requester_phone', label: 'Phone', type: 'tel', placeholder: '+254700000000', required: false, enabled: true },
      { key: 'category', label: 'Category', type: 'select', required: false, enabled: true, options: ['General help', 'Technical issue', 'Billing or invoice', 'Account access'] },
      { key: 'priority', label: 'Priority', type: 'select', required: false, enabled: true, options: ['Standard', 'High', 'Urgent', 'Low'] },
      { key: 'subject', label: 'Subject', type: 'text', placeholder: 'A short summary of your request', required: true, enabled: true },
      { key: 'description', label: 'Issue details', type: 'textarea', placeholder: 'Tell us what happened and what help you need.', required: true, enabled: true },
    ],
  },
  footer_menu: [
    { label: 'Plans', href: '#plans' },
    { label: 'Sign In', href: '/login' },
  ],
  plans: [],
  modules: [],
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
    support_page: {
      ...DEFAULT_PUBLIC_SITE.support_page,
      ...(json?.data?.support_page ?? {}),
    },
    footer_menu: Array.isArray(json?.data?.footer_menu) ? json.data.footer_menu : DEFAULT_PUBLIC_SITE.footer_menu,
    plans: Array.isArray(json?.data?.plans) ? json.data.plans : [],
    modules: Array.isArray(json?.data?.modules) ? json.data.modules : [],
  };
}

export function buildMarketingPath(tenantCode?: string, page?: string) {
  const base = tenantCode ? `/landing/${tenantCode}` : '/landing';
  return page ? `${base}/${page}` : base;
}
