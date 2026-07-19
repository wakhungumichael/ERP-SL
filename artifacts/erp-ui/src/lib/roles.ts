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
      { key: 'settings',       title: 'Settings',         path: '/weighbridge/settings',           roles: ADMIN_UP },
    ],
  },
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
  {
    key: 'payments',
    title: 'Payments & Finance',
    roles: FINANCE_UP,
    items: [
      { key: 'invoices',       title: 'Invoices',         path: '/payments/invoices',              roles: FINANCE_UP },
      { key: 'pay-methods',    title: 'Payment Methods',  path: '/payments/methods',               roles: FINANCE_UP },
      { key: 'accounting',     title: 'Accounting',       path: '/accounting/dashboard',           roles: FINANCE_UP },
    ],
  },
  {
    key: 'reports',
    title: 'Reports',
    roles: FINANCE_UP,
    items: [
      { key: 'reports-dashboard', title: 'Analytics Dashboard', path: '/reports/dashboard', roles: FINANCE_UP },
    ],
  },
  {
    key: 'hr',
    title: 'HR & Staff',
    roles: ADMIN_UP,
    items: [
      { key: 'hr-staff', title: 'Staff Directory', path: '/hr/staff', roles: ADMIN_UP },
    ],
  },
  {
    key: 'procurement',
    title: 'Procurement',
    roles: FINANCE_UP,
    items: [
      { key: 'procurement-po', title: 'Purchase Orders', path: '/procurement/purchase-orders', roles: FINANCE_UP },
    ],
  },
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
