import { detectRole } from '@/lib/roles';
import { hasMenuPathPermission } from '@/lib/permission-access';
import { evaluateWorkspaceRouteAccess } from '@/lib/workspace-access';

/** Return an area the newly selected workspace actually permits. */
export function organizationLandingPath(user: Record<string, any>, navigation: any) {
  const role = detectRole(user);
  if (role === 'tenant_admin' || role === 'superadmin') return '/dashboard';
  const data = navigation?.data ?? navigation;
  const workspace = data?.workspace ?? data ?? {};
  const permissions: string[] = Array.isArray(user.permissions) ? user.permissions : [];
  const activeModuleSlugs: string[] = workspace.active_module_slugs ?? [];
  const paths = (workspace.sections ?? []).flatMap((section: any) => (section.items ?? []).map((item: any) => item.route_path ?? item.path));
  const candidates = ['/dashboard', ...paths, '/projects/overview', '/projects/my-tasks', '/hr/employees', '/hr/leave', '/procurement/requisitions', '/weighbridge/weighment-entry', '/weighbridge/transactions', '/sales/estimates', '/crm/companies', '/inventory/stock', '/workflows/approvals'];
  return candidates.find(path => typeof path === 'string' && path.startsWith('/') && hasMenuPathPermission(path, permissions) && evaluateWorkspaceRouteAccess({ path, role, permissions, activeModuleSlugs, isPermissionDrivenRole: true }).allowed) ?? '/dashboard';
}
