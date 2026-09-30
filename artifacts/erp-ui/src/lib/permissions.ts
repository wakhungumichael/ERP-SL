type PermissionUser = {
  is_superuser?: boolean;
  is_tenant_admin?: boolean;
  is_org_admin?: boolean;
  active_role?: string | null;
  permissions?: string[];
};

export function hasPermission(user: PermissionUser | null | undefined, permission: string) {
  if (!user) return false;
  if (
    user.is_superuser
    || user.is_tenant_admin
    || user.is_org_admin
    || ['owner', 'system_admin'].includes(String(user.active_role ?? '').toLowerCase())
  ) {
    return true;
  }
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
}
