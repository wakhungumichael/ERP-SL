---
name: Role-based auth system
description: How the ERP UI implements role-based access control using Django groups
---

## Architecture
- `artifacts/erp-ui/src/lib/roles.ts` — AppRole type, STATIC_NAV tree, `detectRole()`, ROLE_LABELS, ROLE_COLORS
- `artifacts/erp-ui/src/context/auth-context.tsx` — AuthProvider + useAuth() hook; fetches user via useAuthMe after token is stored
- `artifacts/erp-ui/src/components/shell.tsx` — reads role from useAuth(), filters STATIC_NAV sections/items by role

## Role mapping (from Django User/Groups)
| AppRole | Condition |
|---|---|
| superadmin | is_superuser OR group name matches /super.?admin/ |
| tenant_admin | group name matches /tenant.?admin/ OR group named "admin" OR is_staff |
| finance | group name matches /finance|accountant|billing/ |
| operator | group name matches /operator|ops/ (default for authenticated users) |

## Test users (created 2026-07-16)
| Username | Password | Role |
|---|---|---|
| admin | admin123 | superadmin (is_superuser=True) |
| tenant_admin | admin123 | tenant_admin (group: tenant_admin) |
| finance01 | fin123 | finance (group: finance) |
| operator01 | op123 | operator (group: operator) |

## Nav sections visible per role
- operator: Weighbridge (Dashboard, Transactions, Customers, Vehicles, Live Weight)
- finance: Weighbridge (Dashboard, Transactions), Payments (Invoices)
- tenant_admin: all Weighbridge + Payments + Platform (Users, Roles, Menu Builder)
- superadmin: everything including Tenants, Modules, Plans, Subscriptions, Integrations

## Token auth
- Token stored in localStorage key `sl-erp-token`
- Authorization header format: `Token <token>` (DRF format, set in lib/api-client-react/src/custom-fetch.ts)
- `setAuthTokenGetter()` called in main.tsx at startup
