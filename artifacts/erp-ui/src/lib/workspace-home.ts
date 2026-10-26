/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import type { AppRole } from '@/lib/roles';

/**
 * Every signed-in workspace opens on the common dashboard. Dashboard widgets
 * are independently permission-scoped, so this remains useful even where a
 * role cannot use a vertical module such as Weighbridge.
 *
 * This is the safe fallback until a tenant-specific landing-page setting is
 * introduced and validated against the active role's module permissions.
 */
export function getWorkspaceHomePath(_role: AppRole, _user: Record<string, unknown> | null) {
  return '/dashboard';
}
