# Shared organization structure and procurement configuration

## Organization Settings

Open **Organization Settings → Departments**. This is the shared catalog; the
duplicate department-only sidebar section has been removed. Procurement links back
to this tab. The search toolbar contains **Add department**; additional unit types
remain available in the Type field.

An organization is the tenant data boundary in this ERP. Every grouping belongs to
the selected organization. Cross-organization work requires an explicit membership
in each organization and switching to that organization.

Create departments, divisions, teams, business units, cost centers, or other groupings.
Choose a parent grouping, head, optional deputy, and members. Department codes can
continue to match procurement budget cost centers. HR employees and requisitions
reference these shared departments; the previous procurement records retain their IDs.

- **All organization branches** makes the grouping available across organization
  branches, subject to each user's branch memberships.
- **Selected branches only** restricts it to the chosen branches. Selected heads,
  deputies, and members must have access to at least one allowed branch.
- **Organization members** or **Head, deputy, and members only** controls who can
  use the grouping. Parent restrictions apply to children.
- Deactivate a grouping to retain its history. Existing employee and procurement
  links remain available under the applicable access permissions.

Use the organization's user settings to grant allowed branches and branch roles.
Selecting a branch on a department does not grant staff access to that branch.
The shared branch link preserves operational references if a branch is renamed.

## Procurement → Configuration

Procurement consumes the organization catalog and does not maintain a separate
set of organizations, branches, or departments. The previous department URL redirects
to the shared organization structure screen.

Configure enabled branches, enabled departments, and whether all new requisitions
require a department. Individual requests always require their department and its
head review. New requests default to the active organization branch, using its
existing operational branch reference. Saves and submissions validate shared scope;
registers and the global workflow inbox enforce branch and department restrictions.

Choose an approval source:

- **Workflow Center:** select a published procurement requisition workflow, or use
  automatic organization routing. Automatic routing retains the existing legacy
  workflow/rule fallback. A specifically selected workflow must remain published,
  active, and contain a matching approval route.
- **Procurement approval rules:** use the shared organization approver roles and
  amount/cost-center rules. Editing a rule retains the configured routing source;
  change the source explicitly in Configuration.

Workflow conditions and inbox metadata include `organization_id`, `tenant_id`,
`branch_id`, `branch_name`, `department_id`, `department_code`, and `department_name`,
as well as the existing amount, currency, and cost-center context. Branch IDs in this
context are the Organization Settings branch IDs. Review details and approval actions
use the same branch restrictions as the procurement register.

Approval routing changes apply to future submissions. Access restrictions apply to
current views and actions. Existing approval steps, committee
assignments, decisions, and history retain their recorded route. An approver still
needs the assigned role/user and access to the relevant organization branch. Individual
submission requires a department head or deputy who can review work in that branch.

## Permissions and compatibility

Shared structure uses `Platform_Core.view_department`, `add_department`, and
`change_department`. Existing department grants migrate with their group and direct
user assignments. Department management no longer depends on procurement activation.

Procurement configuration uses `SL_Procurement.view_procurementpolicy` and
`change_procurementpolicy`; existing `change_approvalmatrix` managers retain configuration
access. Workflow design and user/role administration retain their own permissions.

The canonical APIs are `/api/platform/organization-units/`, its `options/` endpoint,
and `/api/procurement/configuration/`. The old procurement department API remains a
compatibility entry point to the same shared records and permissions.

Migrations Platform_Core 0071–0074, SL_Procurement 0014, and SL_HR 0004 move the model
state without dropping department/member tables, update references and permission
ownership, add shared scopes, and preserve stable branch links. Production should
receive these through the normal reviewed deployment flow.