/* Copyright (c) 2026 Siakora Labs Limited. */
import type { AppRole } from '@/lib/roles';
/** Every signed-in role starts with its own permission-scoped activities. */
export function getWorkspaceHomePath(_role: AppRole, _user: Record<string, unknown> | null) {
  return '/home';
}
