import type { AppRole } from '@/lib/roles';

const DASHBOARD_PERMISSION = 'Platform_Core.can_view_workspace_dashboard';
const WEIGHMENT_ENTRY_PERMISSION = 'SL_Weighbridge.can_access_weighment_entry';

/** Choose the least-privileged useful landing page after authentication. */
export function getWorkspaceHomePath(role: AppRole, user: Record<string, unknown> | null) {
  if (role === 'superadmin') return '/dashboard';

  const permissions = new Set(
    Array.isArray(user?.permissions) ? user.permissions.map(String) : [],
  );
  const canViewDashboard = role === 'tenant_admin'
    || role === 'finance'
    || permissions.has(DASHBOARD_PERMISSION);
  const canUseWeighmentEntry = role === 'operator'
    || permissions.has(WEIGHMENT_ENTRY_PERMISSION);

  if (!canViewDashboard && canUseWeighmentEntry) {
    return '/weighbridge/weighment-entry';
  }
  return '/dashboard';
}
