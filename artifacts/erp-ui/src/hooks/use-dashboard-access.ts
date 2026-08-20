import { useMemo } from 'react';
import { useAuth } from '@/context/use-auth';
import type { DashboardPermission } from '@/components/dashboard/types';

const ADMIN_ROLES = new Set(['superadmin', 'tenant_admin']);
const FINANCE_ROLES = new Set(['superadmin', 'tenant_admin', 'finance']);
const OPS_ROLES = new Set(['superadmin', 'tenant_admin', 'operator']);

const PERMISSION_ALIASES: Record<DashboardPermission, string[]> = {
  view_dashboard: [],
  customize_dashboard: [],
  view_financials: [
    'Platform_Core.view_journalentry',
    'Platform_Core.view_account',
    'SL_Sales.view_invoice',
    'SL_Procurement.view_bill',
  ],
  view_financials_sensitive: [
    'Platform_Core.change_journalentry',
    'Platform_Core.view_accountingpostingrule',
    'SL_Procurement.change_bill',
  ],
  view_supply_chain: [
    'SL_Procurement.view_purchaseorder',
    'SL_Procurement.view_requisition',
  ],
  view_audit_trail: [
    'Platform_Core.view_tenant_audit_logs',
    'Platform_Core.view_global_audit_logs',
  ],
  view_workflow_inbox: [],
  view_shortcuts: [],
  view_company_health: [],
  view_operational_alerts: [],
  view_department_activity: [],
};

export function useDashboardAccess() {
  const { role, user } = useAuth();

  const granted = useMemo(() => {
    const perms = Array.isArray((user as any)?.permissions) ? ((user as any).permissions as string[]) : [];
    return new Set(perms);
  }, [user]);

  const hasPermission = (permission: DashboardPermission) => {
    const aliases = PERMISSION_ALIASES[permission] as string[];

    if (permission === 'view_dashboard' || permission === 'customize_dashboard' || permission === 'view_workflow_inbox' || permission === 'view_shortcuts' || permission === 'view_company_health' || permission === 'view_operational_alerts' || permission === 'view_department_activity') {
      return role !== 'guest';
    }

    if (permission === 'view_financials') {
      return FINANCE_ROLES.has(role) || aliases.some((entry) => granted.has(entry));
    }

    if (permission === 'view_financials_sensitive') {
      return ADMIN_ROLES.has(role) || role === 'finance' || aliases.some((entry) => granted.has(entry));
    }

    if (permission === 'view_supply_chain') {
      return FINANCE_ROLES.has(role) || OPS_ROLES.has(role) || aliases.some((entry) => granted.has(entry));
    }

    if (permission === 'view_audit_trail') {
      return ADMIN_ROLES.has(role) || aliases.some((entry) => granted.has(entry));
    }

    return aliases.some((entry) => granted.has(entry));
  };

  const canViewSensitive = hasPermission('view_financials_sensitive');

  return {
    role,
    grantedPermissions: [...granted],
    hasPermission,
    canViewSensitive,
  };
}
