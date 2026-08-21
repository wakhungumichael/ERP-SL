import type { AppRole } from '@/lib/roles';

type AccessReason = 'module' | 'role';

type RouteAccessRule = {
  pathPrefix: string;
  modules?: string[];
  roles?: AppRole[];
};

type RouteAccessResult =
  | { allowed: true; rule: RouteAccessRule | null }
  | { allowed: false; reason: AccessReason; rule: RouteAccessRule };

const ADMIN_UP: AppRole[] = ['superadmin', 'tenant_admin'];
const FINANCE_UP: AppRole[] = ['superadmin', 'tenant_admin', 'finance'];
const OPS: AppRole[] = ['superadmin', 'tenant_admin', 'operator'];
const ERP_USERS: AppRole[] = ['superadmin', 'tenant_admin', 'finance', 'operator'];
const REPORT_USERS: AppRole[] = ['tenant_admin', 'finance', 'operator'];
const SUPERADMIN_ONLY: AppRole[] = ['superadmin'];
const TENANT_ADMIN_ONLY: AppRole[] = ['tenant_admin'];

const ROUTE_ACCESS_RULES: RouteAccessRule[] = [
  { pathPrefix: '/workspace/operations/dashboard', roles: ERP_USERS },
  { pathPrefix: '/dashboard', roles: ERP_USERS },

  { pathPrefix: '/weighbridge/settings', modules: ['weighbridge', 'commercial-weighbridge'], roles: TENANT_ADMIN_ONLY },
  { pathPrefix: '/weighbridge/overweight-log', modules: ['weighbridge', 'commercial-weighbridge'], roles: TENANT_ADMIN_ONLY },
  { pathPrefix: '/weighbridge/discrepancies', modules: ['weighbridge', 'commercial-weighbridge'], roles: FINANCE_UP },
  { pathPrefix: '/weighbridge/reports', modules: ['reporting'], roles: REPORT_USERS },
  { pathPrefix: '/weighbridge/first-weight', modules: ['weighbridge', 'commercial-weighbridge'], roles: OPS },
  { pathPrefix: '/weighbridge/second-weight', modules: ['weighbridge', 'commercial-weighbridge'], roles: OPS },
  { pathPrefix: '/weighbridge/weighment-entry', modules: ['weighbridge', 'commercial-weighbridge'], roles: OPS },
  { pathPrefix: '/weighbridge/weight-capture', modules: ['weighbridge', 'commercial-weighbridge'], roles: OPS },
  { pathPrefix: '/weighbridge/customers', modules: ['weighbridge', 'commercial-weighbridge'], roles: OPS },
  { pathPrefix: '/weighbridge/vehicles', modules: ['weighbridge', 'commercial-weighbridge'], roles: OPS },
  { pathPrefix: '/weighbridge/live', modules: ['weighbridge', 'commercial-weighbridge'], roles: OPS },
  { pathPrefix: '/weighbridge/transactions', modules: ['weighbridge', 'commercial-weighbridge'], roles: ERP_USERS },
  { pathPrefix: '/weighbridge/overview', modules: ['weighbridge', 'commercial-weighbridge'], roles: ERP_USERS },

  { pathPrefix: '/sales/products', modules: ['sales', 'invoicing', 'billing'], roles: ADMIN_UP },
  { pathPrefix: '/sales', modules: ['sales', 'invoicing', 'billing'], roles: FINANCE_UP },

  { pathPrefix: '/inventory', modules: ['inventory', 'stock-control', 'warehouse-management'], roles: ERP_USERS },

  { pathPrefix: '/finance/budgets', modules: ['budgeting'], roles: FINANCE_UP },
  { pathPrefix: '/finance/chart-of-accounts', modules: ['finance', 'accounting'], roles: ADMIN_UP },
  { pathPrefix: '/finance/posting-rules', modules: ['finance', 'accounting'], roles: ADMIN_UP },
  { pathPrefix: '/finance', modules: ['finance', 'accounting', 'billing', 'invoicing'], roles: FINANCE_UP },

  { pathPrefix: '/payments/invoices', modules: ['billing', 'invoicing'], roles: FINANCE_UP },
  { pathPrefix: '/payments/methods', modules: ['finance', 'accounting', 'billing'], roles: FINANCE_UP },

  { pathPrefix: '/accounting/chart-of-accounts', modules: ['finance', 'accounting'], roles: ADMIN_UP },
  { pathPrefix: '/accounting/posting-rules', modules: ['finance', 'accounting'], roles: ADMIN_UP },
  { pathPrefix: '/accounting', modules: ['finance', 'accounting'], roles: FINANCE_UP },

  { pathPrefix: '/crm/suppliers', modules: ['crm'], roles: OPS },
  { pathPrefix: '/crm', modules: ['crm'], roles: ERP_USERS },

  { pathPrefix: '/ticketing/forms', modules: ['ticketing'], roles: ADMIN_UP },
  { pathPrefix: '/ticketing/automation', modules: ['ticketing'], roles: ADMIN_UP },
  { pathPrefix: '/ticketing/settings', modules: ['ticketing'], roles: ADMIN_UP },
  { pathPrefix: '/ticketing', modules: ['ticketing'], roles: ERP_USERS },

  { pathPrefix: '/reports/dashboard', modules: ['reporting'], roles: REPORT_USERS },

  { pathPrefix: '/hr/staff', modules: ['hr', 'hr-payroll', 'hcm'], roles: ADMIN_UP },

  { pathPrefix: '/procurement/approval-rules', modules: ['procurement'], roles: ADMIN_UP },
  { pathPrefix: '/procurement', modules: ['procurement'], roles: FINANCE_UP },
  { pathPrefix: '/purchases', modules: ['procurement'], roles: FINANCE_UP },

  { pathPrefix: '/budgeting/overview', modules: ['budgeting'], roles: FINANCE_UP },

  { pathPrefix: '/manufacturing', modules: ['manufacturing', 'manufacturing-pack'], roles: ERP_USERS },
  { pathPrefix: '/retail', modules: ['retail', 'retail-pack', 'commerce'], roles: ERP_USERS },
  { pathPrefix: '/services', modules: ['services', 'services-pack', 'projects'], roles: ERP_USERS },

  { pathPrefix: '/platform/company-settings', roles: ADMIN_UP },
  { pathPrefix: '/platform/organization-settings', roles: ADMIN_UP },
  { pathPrefix: '/platform/users', roles: ADMIN_UP },
  { pathPrefix: '/platform/roles', roles: ADMIN_UP },
  { pathPrefix: '/platform/workflows', roles: ADMIN_UP },
  { pathPrefix: '/platform/backups', roles: ADMIN_UP },
  { pathPrefix: '/platform/audit', roles: ADMIN_UP },
  { pathPrefix: '/platform/workspace', roles: SUPERADMIN_ONLY },
  { pathPrefix: '/platform/billing', roles: SUPERADMIN_ONLY },
  { pathPrefix: '/platform/tenants', roles: SUPERADMIN_ONLY },
  { pathPrefix: '/platform/industries', roles: SUPERADMIN_ONLY },
  { pathPrefix: '/platform/modules', roles: SUPERADMIN_ONLY },
  { pathPrefix: '/platform/plans', roles: SUPERADMIN_ONLY },
  { pathPrefix: '/platform/subscriptions', roles: SUPERADMIN_ONLY },
  { pathPrefix: '/platform/licenses', roles: SUPERADMIN_ONLY },
  { pathPrefix: '/platform/integrations', roles: SUPERADMIN_ONLY },
].sort((a, b) => b.pathPrefix.length - a.pathPrefix.length);

function normalizePath(path: string) {
  if (!path) return '/';
  const cleaned = path.split('?')[0]?.split('#')[0] ?? '/';
  if (cleaned.length > 1 && cleaned.endsWith('/')) return cleaned.slice(0, -1);
  return cleaned || '/';
}

function pathMatchesPrefix(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function evaluateWorkspaceRouteAccess({
  path,
  role,
  activeModuleSlugs,
}: {
  path: string;
  role: AppRole;
  activeModuleSlugs: string[];
}): RouteAccessResult {
  if (role === 'superadmin') {
    return { allowed: true, rule: null };
  }

  const normalizedPath = normalizePath(path);
  const rule = ROUTE_ACCESS_RULES.find((candidate) => pathMatchesPrefix(normalizedPath, candidate.pathPrefix)) ?? null;
  if (!rule) {
    return { allowed: true, rule: null };
  }

  if (rule.roles?.length && !rule.roles.includes(role)) {
    return { allowed: false, reason: 'role', rule };
  }

  if (rule.modules?.length) {
    const activeModules = new Set(activeModuleSlugs);
    const hasModule = rule.modules.some((moduleSlug) => activeModules.has(moduleSlug));
    if (!hasModule) {
      return { allowed: false, reason: 'module', rule };
    }
  }

  return { allowed: true, rule };
}
