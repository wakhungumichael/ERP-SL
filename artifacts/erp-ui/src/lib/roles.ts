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
  requiredPermission?: string;
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
const TENANT_ADMIN_UP: AppRole[] = ['tenant_admin', 'finance', 'operator'];
const FINANCE_UP: AppRole[]    = ['tenant_admin', 'finance'];
const OPS: AppRole[]           = ['tenant_admin', 'operator'];
const ERP_USERS: AppRole[]     = ['tenant_admin', 'finance', 'operator'];
export const CAN_VIEW_OPERATIONS_REPORTS: AppRole[] = OPS;
export const CAN_VIEW_FINANCIAL_REPORTS: AppRole[] = FINANCE_UP;
export const CAN_VIEW_REPORTS_WORKSPACE: AppRole[] = ['tenant_admin', 'finance', 'operator'];

// ── Weighbridge action permissions ────────────────────────────────────────────
/** Roles that may approve pending transactions (manual capture approval). */
export const CAN_APPROVE: AppRole[] = ['tenant_admin'];
/** Roles that may recall a completed transaction back to Pending. */
export const CAN_RECALL: AppRole[]  = ['tenant_admin'];
/** Roles that may export transaction data (CSV / PDF). */
export const CAN_EXPORT: AppRole[]  = ['tenant_admin', 'finance'];
/** Roles that may receive / record payment on a completed transaction. */
export const CAN_RECEIVE_PAYMENT: AppRole[] = ['tenant_admin', 'finance', 'operator'];

// ── Static navigation tree ────────────────────────────────────────────────────

export const STATIC_NAV: NavSection[] = [
  {
    key: 'dashboard',
    title: 'Dashboard',
    roles: ALL_ROLES,
    items: [
      { key: 'dashboard', title: 'Dashboard', path: '/dashboard', roles: ALL_ROLES },
    ],
  },

  // ── Weighbridge ─────────────────────────────────────────────────────────────
  {
    key: 'weighbridge',
    title: 'Weighbridge',
    roles: ERP_USERS,
    items: [
      { key: 'overview',       title: 'Overview',         path: '/weighbridge/overview',         roles: ERP_USERS },
      { key: 'transactions',   title: 'Transactions',     path: '/weighbridge/transactions',       roles: ERP_USERS },
      { key: 'weight-capture', title: 'Weighment Entry',  path: '/weighbridge/weighment-entry',    roles: OPS },
      { key: 'customers',      title: 'Customers',        path: '/weighbridge/customers',          roles: OPS },
      { key: 'vehicles',       title: 'Vehicles',         path: '/weighbridge/vehicles',           roles: OPS },
      { key: 'live',           title: 'Live Weight',      path: '/weighbridge/live',               roles: OPS },
      { key: 'reports',        title: 'Reports',          path: '/weighbridge/reports',            roles: CAN_VIEW_REPORTS_WORKSPACE },
      { key: 'settings',        title: 'Settings',          path: '/weighbridge/settings',           roles: ['tenant_admin'] },
      { key: 'overweight-log',  title: 'Scale Surveillance', path: '/weighbridge/overweight-log',     roles: ['tenant_admin'] },
      { key: 'discrepancies',   title: 'Unrecorded Readings', path: '/weighbridge/discrepancies',     roles: FINANCE_UP },
    ],
  },

  // ── Sales ───────────────────────────────────────────────────────────────────
  {
    key: 'sales',
    title: 'Sales',
    roles: FINANCE_UP,
    items: [
      { key: 'sales-estimates',  title: 'Estimates',          path: '/sales/estimates',         roles: FINANCE_UP },
      { key: 'sales-orders',     title: 'Sales Orders',       path: '/sales/orders',            roles: FINANCE_UP },
      { key: 'sales-recurring',  title: 'Recurring Invoices', path: '/sales/recurring',         roles: FINANCE_UP },
      { key: 'sales-statements', title: 'Customer Statements',path: '/sales/statements',        roles: FINANCE_UP },
      { key: 'sales-customers',  title: 'Customers',          path: '/sales/customers',         roles: FINANCE_UP },
      { key: 'sales-products',   title: 'Products & Services',path: '/sales/products',          roles: ADMIN_UP },
    ],
  },

  // ── Inventory ───────────────────────────────────────────────────────────────
  {
    key: 'inventory',
    title: 'Inventory',
    roles: ERP_USERS,
    items: [
      { key: 'inventory-overview',   title: 'Overview',        path: '/inventory/overview',   roles: ERP_USERS },
      { key: 'inventory-stock',      title: 'Stock Catalog',   path: '/inventory/stock',      roles: ERP_USERS },
      { key: 'inventory-warehouses', title: 'Warehouses',      path: '/inventory/warehouses', roles: ERP_USERS },
      { key: 'inventory-movements',  title: 'Movements',       path: '/inventory/movements',  roles: ERP_USERS },
    ],
  },

  // ── Finance ─────────────────────────────────────────────────────────────────
  {
    key: 'finance',
    title: 'Finance',
    roles: FINANCE_UP,
    items: [
      { key: 'finance-overview',       title: 'Overview',           path: '/finance/overview',           roles: FINANCE_UP },
      { key: 'finance-journal-entries',title: 'Journal Entries',    path: '/finance/transactions',       roles: FINANCE_UP },
      { key: 'finance-coa',            title: 'Chart of Accounts',  path: '/finance/chart-of-accounts',  roles: ADMIN_UP },
      { key: 'finance-ar',             title: 'Accounts Receivable',path: '/finance/receivables',        roles: FINANCE_UP },
      { key: 'finance-ap',             title: 'Accounts Payable',   path: '/finance/payables',           roles: FINANCE_UP },
      { key: 'finance-cash',           title: 'Cash & Payments',    path: '/finance/payment-methods',    roles: FINANCE_UP },
      { key: 'finance-budgets',        title: 'Budgets',            path: '/finance/budgets',            roles: FINANCE_UP },
      { key: 'finance-reports',        title: 'Financial Reports',  path: '/finance/reports',            roles: FINANCE_UP },
      { key: 'finance-posting-rules',  title: 'Posting Rules',      path: '/finance/posting-rules',      roles: ADMIN_UP },
    ],
  },

  // ── CRM ──────────────────────────────────────────────────────────────────────
  {
    key: 'crm',
    title: 'CRM',
    roles: ERP_USERS,
    items: [
      { key: 'crm-home',     title: 'Overview',       path: '/crm/dashboard',      roles: ERP_USERS },
      { key: 'companies',    title: 'Companies',      path: '/crm/companies',      roles: ERP_USERS },
      { key: 'people',       title: 'People',         path: '/crm/people',         roles: ERP_USERS },
      { key: 'suppliers',    title: 'Suppliers',      path: '/crm/suppliers',      roles: OPS },
      { key: 'opportunities',title: 'Opportunities',  path: '/crm/opportunities',  roles: ERP_USERS },
      { key: 'follow-ups',   title: 'Follow-ups',     path: '/crm/follow-ups',     roles: ERP_USERS },
      { key: 'performance',  title: 'Sales Performance', path: '/crm/performance', roles: ERP_USERS },
    ],
  },

  {
    key: 'ticketing',
    title: 'Ticketing',
    roles: ERP_USERS,
    items: [
      { key: 'ticketing-overview', title: 'Overview', path: '/ticketing/overview', roles: ERP_USERS },
      { key: 'ticketing-queue', title: 'Agent Queue', path: '/ticketing/queue', roles: ERP_USERS },
      { key: 'ticketing-forms', title: 'Forms & Schema', path: '/ticketing/forms', roles: ADMIN_UP },
      { key: 'ticketing-automation', title: 'Automation', path: '/ticketing/automation', roles: ADMIN_UP },
      { key: 'ticketing-settings', title: 'Settings', path: '/ticketing/settings', roles: ADMIN_UP },
    ],
  },

  // ── Reports ──────────────────────────────────────────────────────────────────
  {
    key: 'reports',
    title: 'Reports',
    roles: CAN_VIEW_REPORTS_WORKSPACE,
    items: [
      { key: 'reports-dashboard', title: 'ERP Reports', path: '/reports/dashboard', roles: CAN_VIEW_REPORTS_WORKSPACE },
    ],
  },

  // ── HR ───────────────────────────────────────────────────────────────────────
  {
    key: 'hr',
    title: 'HR',
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
      { key: 'procurement-requisitions', title: 'Requisitions', path: '/procurement/requisitions', roles: FINANCE_UP },
      { key: 'procurement-vendors', title: 'Vendors', path: '/procurement/vendors', roles: FINANCE_UP },
      { key: 'procurement-po', title: 'Purchase Orders', path: '/procurement/purchase-orders', roles: FINANCE_UP },
      { key: 'procurement-receipts', title: 'Goods Receipts', path: '/procurement/receipts', roles: FINANCE_UP },
      { key: 'procurement-bills', title: 'Supplier Bills', path: '/procurement/bills', roles: FINANCE_UP },
      { key: 'procurement-payment-queue', title: 'Payment Queue', path: '/procurement/payment-queue', roles: FINANCE_UP },
      { key: 'procurement-approvals', title: 'Approval Rules', path: '/procurement/approval-rules', roles: ADMIN_UP },
    ],
  },

  // ── Industry Packs ──────────────────────────────────────────────────────────
  {
    key: 'manufacturing',
    title: 'Manufacturing',
    roles: ERP_USERS,
    items: [
      { key: 'manufacturing-overview', title: 'Overview', path: '/manufacturing/overview', roles: ERP_USERS },
    ],
  },
  {
    key: 'retail',
    title: 'Retail & Commerce',
    roles: ERP_USERS,
    items: [
      { key: 'retail-overview', title: 'Overview', path: '/retail/overview', roles: ERP_USERS },
    ],
  },
  {
    key: 'services',
    title: 'Projects & Services',
    roles: ERP_USERS,
    items: [
      { key: 'services-overview', title: 'Overview', path: '/services/overview', roles: ERP_USERS },
    ],
  },

  // ── Platform Admin ───────────────────────────────────────────────────────────
  {
    key: 'platform',
    title: 'Platform Admin',
    roles: ADMIN_UP,
    items: [
      { key: 'billing-center',   title: 'Billing Center',    path: '/platform/billing',           roles: SUPERADMIN_UP },
      { key: 'tenants',          title: 'Tenants',           path: '/platform/tenants',           roles: SUPERADMIN_UP },
      { key: 'industries',       title: 'Industries',        path: '/platform/industries',        roles: SUPERADMIN_UP },
      { key: 'roles',            title: 'Roles',             path: '/platform/roles',             roles: ADMIN_UP },
      { key: 'workspace',        title: 'Menu Builder',      path: '/platform/workspace',         roles: SUPERADMIN_UP },
      { key: 'workflows',        title: 'Workflow Center',   path: '/platform/workflows',         roles: ADMIN_UP },
      { key: 'backups',          title: 'Backups',           path: '/platform/backups',           roles: ADMIN_UP },
      { key: 'modules',          title: 'Modules',           path: '/platform/modules',           roles: SUPERADMIN_UP },
      { key: 'plans',            title: 'Subscription Plans',path: '/platform/plans',             roles: SUPERADMIN_UP },
      { key: 'subscriptions',    title: 'Billing Subscriptions', path: '/platform/subscriptions', roles: SUPERADMIN_UP },
      { key: 'licenses',         title: 'Licenses',          path: '/platform/licenses',          roles: SUPERADMIN_UP },
      { key: 'integrations',     title: 'Billing Gateways',  path: '/platform/integrations',      roles: SUPERADMIN_UP },
      { key: 'organization-settings', title: 'Organization Settings',  path: '/platform/organization-settings',  roles: ADMIN_UP },
      { key: 'audit-logs',       title: 'Audit Logs',        path: '/platform/audit',             roles: ADMIN_UP },
    ],
  },
];

// ── Role detection from Django User object ────────────────────────────────────

/**
 * Maps authenticated organization context → the legacy UI persona.
 * Authorization itself remains permission-driven. Never infer administrator
 * access from is_staff or a custom role name containing the word "admin".
 */
export function detectRole(user: {
  is_superuser?: boolean;
  is_staff?: boolean;
  is_tenant_admin?: boolean;
  is_org_admin?: boolean;
  active_role?: string | null;
  groups?: Array<{ name: string } | string>;
} | null | undefined): AppRole {
  if (!user) return 'guest';
  if (user.is_superuser) return 'superadmin';
  if (
    user.is_tenant_admin
    || user.is_org_admin
    || ['owner', 'system_admin'].includes(String(user.active_role ?? '').toLowerCase())
  ) return 'tenant_admin';
  if (String(user.active_role ?? '').toLowerCase() === 'finance') return 'finance';
  if (String(user.active_role ?? '').toLowerCase() === 'operator') return 'operator';

  const groupNames = (user.groups || []).map(g =>
    (typeof g === 'string' ? g : g.name).toLowerCase().replace(/[^a-z0-9]/g, '_')
  );

  if (groupNames.some(n => ['superadmin', 'super_admin', 'platform_admin'].includes(n))) return 'superadmin';
  if (groupNames.some(n => ['tenant_admin', 'organization_admin'].includes(n))) return 'tenant_admin';
  if (groupNames.some(n => ['finance', 'accountant', 'billing'].includes(n))) return 'finance';
  if (groupNames.some(n => ['operator', 'operations', 'ops'].includes(n))) return 'operator';

  return 'operator';
}

export const ROLE_LABELS: Record<AppRole, string> = {
  superadmin:   'Super Admin',
  tenant_admin: 'System Administrator',
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
