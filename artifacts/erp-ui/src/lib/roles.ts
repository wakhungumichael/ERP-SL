// ── Role definitions ──────────────────────────────────────────────────────────

export type AppRole =
  | 'superadmin'
  | 'tenant_admin'
  | 'finance'
  | 'operator'
  | 'guest';

export interface NavItem {
  key: string;
  title: string;
  path: string;
  roles: AppRole[];
}

export interface NavSection {
  key: string;
  title: string;
  items: NavItem[];
  roles: AppRole[]; // section is visible when user has any of these roles
}

// ── Role sets ─────────────────────────────────────────────────────────────────

export const ALL_ROLES: AppRole[] = [
  'superadmin',
  'tenant_admin',
  'finance',
  'operator',
];

const SUPERADMIN_UP: AppRole[] = ['superadmin'];
const ADMIN_UP: AppRole[]      = ['superadmin', 'tenant_admin'];
const FINANCE_UP: AppRole[]    = ['superadmin', 'tenant_admin', 'finance'];
const OPS: AppRole[]           = ['superadmin', 'tenant_admin', 'operator'];

// ── Weighbridge action permissions ────────────────────────────────────────────
/** Roles that may approve pending transactions (manual capture approval). */
export const CAN_APPROVE: AppRole[] = ['superadmin', 'tenant_admin'];
/** Roles that may recall a completed transaction back to Pending. */
export const CAN_RECALL: AppRole[]  = ['superadmin', 'tenant_admin'];
/** Roles that may export transaction data (CSV / PDF). */
export const CAN_EXPORT: AppRole[]  = ['superadmin', 'tenant_admin', 'finance'];
/** Roles that may receive / record payment on a completed transaction. */
export const CAN_RECEIVE_PAYMENT: AppRole[] = ['superadmin', 'tenant_admin', 'finance', 'operator'];

// ── Static navigation tree ────────────────────────────────────────────────────

export const STATIC_NAV: NavSection[] = [
  // ── Weighbridge ─────────────────────────────────────────────────────────────
  {
    key: 'weighbridge',
    title: 'Weighbridge',
    roles: ALL_ROLES,
    items: [
      { key: 'dashboard',      title: 'Dashboard',        path: '/dashboard',                     roles: ALL_ROLES },
      { key: 'transactions',   title: 'Transactions',     path: '/weighbridge/transactions',       roles: ALL_ROLES },
      { key: 'first-weight',   title: 'First Weight',     path: '/weighbridge/first-weight',       roles: OPS },
      { key: 'second-weight',  title: 'Second Weight',    path: '/weighbridge/second-weight',      roles: OPS },
      { key: 'customers',      title: 'Customers',        path: '/weighbridge/customers',          roles: OPS },
      { key: 'vehicles',       title: 'Vehicles',         path: '/weighbridge/vehicles',           roles: OPS },
      { key: 'live',           title: 'Live Weight',      path: '/weighbridge/live',               roles: OPS },
      { key: 'settings',        title: 'Settings',          path: '/weighbridge/settings',           roles: ADMIN_UP },
      { key: 'overweight-log',  title: 'Overweight Log',    path: '/weighbridge/overweight-log',     roles: ADMIN_UP },
      { key: 'discrepancies',   title: 'Discrepancies',     path: '/weighbridge/discrepancies',      roles: FINANCE_UP },
    ],
  },

  // ── Sales & Payments ─────────────────────────────────────────────────────────
  {
    key: 'sales',
    title: 'Sales & Payments',
    roles: FINANCE_UP,
    items: [
      { key: 'sales-estimates',  title: 'Estimates',          path: '/sales/estimates',         roles: FINANCE_UP },
      { key: 'sales-invoices',   title: 'Invoices',           path: '/sales/invoices',          roles: FINANCE_UP },
      { key: 'sales-recurring',  title: 'Recurring Invoices', path: '/sales/recurring',         roles: FINANCE_UP },
      { key: 'sales-statements', title: 'Customer Statements',path: '/sales/statements',        roles: FINANCE_UP },
      { key: 'sales-customers',  title: 'Customers',          path: '/sales/customers',         roles: FINANCE_UP },
      { key: 'sales-products',   title: 'Products & Services',path: '/sales/products',          roles: ADMIN_UP },
    ],
  },

  // ── Purchases ────────────────────────────────────────────────────────────────
  {
    key: 'purchases',
    title: 'Purchases',
    roles: FINANCE_UP,
    items: [
      { key: 'purchases-bills',    title: 'Bills',               path: '/purchases/bills',    roles: FINANCE_UP },
      { key: 'purchases-vendors',  title: 'Vendors',             path: '/purchases/vendors',  roles: FINANCE_UP },
      { key: 'purchases-products', title: 'Products & Services', path: '/purchases/products', roles: FINANCE_UP },
    ],
  },

  // ── Accounting ───────────────────────────────────────────────────────────────
  {
    key: 'accounting',
    title: 'Accounting',
    roles: FINANCE_UP,
    items: [
      { key: 'accounting-dashboard',  title: 'Overview',          path: '/accounting/dashboard',        roles: FINANCE_UP },
      { key: 'accounting-coa',        title: 'Chart of Accounts', path: '/accounting/chart-of-accounts',roles: ADMIN_UP },
      { key: 'accounting-ledger',     title: 'Transactions',      path: '/accounting/transactions',     roles: FINANCE_UP },
    ],
  },

  // ── CRM ──────────────────────────────────────────────────────────────────────
  {
    key: 'crm',
    title: 'CRM',
    roles: ALL_ROLES,
    items: [
      { key: 'crm-home',     title: 'Overview',       path: '/crm/dashboard',      roles: ALL_ROLES },
      { key: 'companies',    title: 'Companies',      path: '/crm/companies',      roles: ALL_ROLES },
      { key: 'people',       title: 'People',         path: '/crm/people',         roles: ALL_ROLES },
      { key: 'suppliers',    title: 'Suppliers',      path: '/crm/suppliers',      roles: OPS },
      { key: 'opportunities',title: 'Opportunities',  path: '/crm/opportunities',  roles: ALL_ROLES },
      { key: 'follow-ups',   title: 'Follow-ups',     path: '/crm/follow-ups',     roles: ALL_ROLES },
    ],
  },

  // ── Reports ──────────────────────────────────────────────────────────────────
  {
    key: 'reports',
    title: 'Reports',
    roles: FINANCE_UP,
    items: [
      { key: 'reports-dashboard', title: 'Analytics Dashboard', path: '/reports/dashboard', roles: FINANCE_UP },
    ],
  },

  // ── HR ───────────────────────────────────────────────────────────────────────
  {
    key: 'hr',
    title: 'HR & Staff',
    roles: ADMIN_UP,
    items: [
      { key: 'hr-staff', title: 'Staff Directory', path: '/hr/staff', roles: ADMIN_UP },
    ],
  },

  // ── Procurement ──────────────────────────────────────────────────────────────
  {
    key: 'procurement',
    title: 'Procurement',
    roles: FINANCE_UP,
    items: [
      { key: 'procurement-po', title: 'Purchase Orders', path: '/procurement/purchase-orders', roles: FINANCE_UP },
    ],
  },

  // ── Platform Admin ───────────────────────────────────────────────────────────
  {
    key: 'platform',
    title: 'Platform Admin',
    roles: ADMIN_UP,
    items: [
      { key: 'tenants',          title: 'Tenants',           path: '/platform/tenants',           roles: SUPERADMIN_UP },
      { key: 'users',            title: 'Users',             path: '/platform/users',             roles: ADMIN_UP },
      { key: 'roles',            title: 'Roles',             path: '/platform/roles',             roles: SUPERADMIN_UP },
      { key: 'workspace',        title: 'Menu Builder',      path: '/platform/workspace',         roles: SUPERADMIN_UP },
      { key: 'modules',          title: 'Modules',           path: '/platform/modules',           roles: SUPERADMIN_UP },
      { key: 'plans',            title: 'Plans',             path: '/platform/plans',             roles: SUPERADMIN_UP },
      { key: 'subscriptions',    title: 'Subscriptions',     path: '/platform/subscriptions',     roles: SUPERADMIN_UP },
      { key: 'licenses',         title: 'Licenses',          path: '/platform/licenses',          roles: SUPERADMIN_UP },
      { key: 'integrations',     title: 'Integrations',      path: '/platform/integrations',      roles: SUPERADMIN_UP },
      { key: 'company-settings', title: 'Company Settings',  path: '/platform/company-settings',  roles: ['tenant_admin'] as AppRole[] },
    ],
  },
];

// ── Role detection from Django User object ────────────────────────────────────

/**
 * Maps Django group names → AppRole.
 * Priority: superadmin > tenant_admin > finance > operator
 */
export function detectRole(user: {
  is_superuser?: boolean;
  is_staff?: boolean;
  groups?: Array<{ name: string } | string>;
} | null | undefined): AppRole {
  if (!user) return 'guest';
  if (user.is_superuser) return 'superadmin';

  const groupNames = (user.groups || []).map(g =>
    (typeof g === 'string' ? g : g.name).toLowerCase().replace(/[^a-z0-9]/g, '_')
  );

  if (groupNames.some(n => /super.?admin|platform.?admin/.test(n))) return 'superadmin';
  if (groupNames.some(n => /tenant.?admin|admin/.test(n))) return 'tenant_admin';
  if (groupNames.some(n => /finance|accountant|billing/.test(n))) return 'finance';
  if (groupNames.some(n => /operator|ops/.test(n))) return 'operator';

  if (user.is_staff) return 'tenant_admin';
  return 'operator';
}

export const ROLE_LABELS: Record<AppRole, string> = {
  superadmin:   'Super Admin',
  tenant_admin: 'Tenant Admin',
  finance:      'Finance',
  operator:     'Operator',
  guest:        'Guest',
};

export const ROLE_COLORS: Record<AppRole, string> = {
  superadmin:   'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  tenant_admin: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  finance:      'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  operator:     'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  guest:        'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
};
