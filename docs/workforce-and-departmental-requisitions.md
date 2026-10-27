# Workforce and departmental requisitions

Organization boundaries and the selected role apply to project lists, dashboards, task details, calendars, follow-ups, and exports. The new `SL_Projects.view_own_projecttask` permission grants personal/collaborator/selected-role assignments; `view_all_projecttask` grants all tasks within the active organization and branch. My Tasks always filters to personal and selected-role assignments, even for managers. Existing task activity roles gain own-task access; they do not automatically gain all-task access.

## HR setup

1. Enable the licensed HR module for the organization. Open **HR → HR Settings** to set annual and sick leave entitlements, working weekdays, additional public holidays, document requirements, carry-forward, and the leave approval group.
2. Open **Employees & Onboarding**, create an employee, and optionally link an existing organization user for self service. Attach the required documents. HR verifies them and completes onboarding. Document contents are stored privately in the database and downloaded through authenticated employee access; they have no public media URL.
3. Assign the appropriate permissions through Roles. The release adds an **Employee Self Service** role to each active organization without assigning users or changing existing roles. It supports own leave, own documents and HR service requests, and individual procurement requests. HR managers need employee management, document verification, leave review, and any payroll permissions they use.
4. Employees draft and submit leave. Submitted requests reserve the balance; rejection, cancellation or HR revocation releases it. Employees cannot approve their own leave. Reviewers need `approve_leaverequest`; `view_all_leaverequest` grants organization-wide review visibility. Without it, managers see their direct reports and department heads see their department. A configured leave approval group can review organization-wide requests.

Leave balances use calendar years and grant the configured annual entitlement. Opening/contract adjustments are recorded through **Adjust balance** with a reason. Carry-forward is limited by HR policy and uses the previous year's unused annual entitlement. Working-day leave excludes configured weekends, fixed national holidays and Sunday substitutions; HR must enter movable and newly gazetted holidays. Maternity and pre-adoptive leave use calendar months; paternity uses calendar days. Sick leave needs medical evidence, and pre-adoptive leave needs placement documentation. Sectoral wage orders, contracts and collective agreements may require more generous terms than the Employment Act baseline.

Legal references: [Employment Act, sections 28–30](https://new.kenyalaw.org/akn/ke/act/2007/11/eng@2023-07-01), [Employment (Amendment) Act, 2021](https://www.kenyalaw.org/kl/fileadmin/pdfdownloads/AmendmentActs/2021/No.2of2021.pdf).

Payroll records calculate net pay from entered basic pay, allowances and deductions. Statutory deduction amounts remain entered by payroll staff; this release does not introduce an automatic PAYE/NSSF/SHA calculator. Completed payroll records are locked. Employees see only their own completed pay records in **My Payslips**.

## Budget-backed procurement

1. Create a department with a head, optional deputy and members. Its code or name must match the budget line's cost center. Create and activate its budget with the correct account, year/month, project and currency.
2. Employees create **Individual** requisitions and select the budget line and optional customer sales order. They submit to the named head. The head or deputy approves or rejects each request, then selects approved requests to consolidate. Consolidate requests sharing a department, branch, budget line, project, currency and sales order together.
3. The departmental request is a draft retaining links to every original request. The head or deputy submits it for configured higher approval. The system checks budget availability and reserves it once. Individual children do not create duplicate reservations. Missing routes and hard budget overruns block submission. Rejection/cancellation releases the reservation.
4. Approved departmental requests convert once to a purchase order. Budget moves from committed to obligated. Continue through the existing receipt, three-way supplier bill matching, accounting and payment queue. Partial supplier bills move only their billed amounts to actual spending and are idempotent.

Heads can use the standard route for their own requests to avoid approving their own individual request. Other employees cannot bypass head review by choosing Standard. Organization administrators and users with `view_all_requisition` can use standard requisitions.

**Approval Rules** supports edit, activation/deactivation and deletion. Changing a rule selects Approval Rules as the routing source for future submissions. Existing pending approvals retain their recorded group and step, including when the originating rule is deleted. If all matching rules are inactive/deleted, new submissions are blocked. The procurement setup API can explicitly select Workflow Center again; existing workflow definitions are preserved.

## Removable project samples

`python manage.py seed_project_samples --all-active-tenants` adds clearly marked `[SAMPLE]` projects, tasks, milestones and follow-ups using existing members. It creates a `[SAMPLE] Demo workspace` branch only for organizations with no active branch. It does not enable licensed modules or change users' roles. Reruns do not duplicate data.

Administrators can use **Projects → Overview → Remove sample data** to clean the current organization. For command-line cleanup, preview with `python manage.py seed_project_samples --all-active-tenants --clear --dry-run`, then remove `--dry-run` to delete untouched examples. Cleanup refuses to cascade through real work or edited samples; review those records individually. Existing organization data is retained. The **Task Board** paginates all accessible statuses; project reports export filtered tables as CSV or tenant-branded PDF.


## Organization membership and profile switching

Administrators can link an existing user to each organization they manage in **Users → Edit → Organization memberships**. Choose the organization's own default role and branch-specific roles. Organization-wide role replacement preserves roles held in other organizations. Users open **My profile & organizations** to switch their active organization; its selector appears before account/password fields. Switching clears workspace caches and refreshes branding, menus and permissions. Organization Settings is shown to organization administrators. Departments and head/deputy status appear in the user's own profile.

In **Departments & Heads**, link users by checking Member and select the Head or Deputy checkbox. Both leadership positions can review and consolidate that department's requisitions. Self-approval remains blocked. Linking an HR employee to a department also links their ERP user to that department.

## Optional setup importer

Creating an organization can open the setup importer, and the same tool is available later in **Organization Settings → Setup & Demo**. Select standard workflows, approval rules, chart of accounts/journals, HR defaults and optional example masters/projects. Preview runs inside a rolled-back transaction. Imports add missing setup; they do not replace customized or disabled workflows, rules, accounts or HR policies. Newly imported workflows may be published or saved as drafts. An existing organization owner without a global administrator group receives a tenant-scoped approver group with no global permissions.

Optional master examples use `[DEMO]` names and reserved `.invalid` email domains. No invoices, payments, opening balances or journal entries are created. Import history stores fingerprints for the created master examples; cleanup stops if examples have edits or related records. Standard setup remains after optional examples are removed.
