# Department budgets and annual procurement plans

Use **Budgeting → Budgets** (`/finance/budgets`) and **Procurement → Procurement plans** (`/procurement/plans`). Both registers have search, status filters, page navigation and rows-per-page controls. Forms use labelled, scrollable dialogs on mobile and desktop.

## Setup and approval routing

Departments and permitted branches come from **Organization Settings → Departments**. Accounts and financial years come from Finance. Organization membership is required; cross-organization access requires switching organizations.

In **Organization Settings → Setup & Demo Import**, import **Standard workflows** to add the three missing planning templates: Department Budget, Annual Budget, and Procurement Plan. Existing customized, disabled, or published workflows are preserved. Leave activation unchecked to review templates as drafts in **Workflow Center**. Select staffed approver roles/users and grant the planning approval permissions to them. A submitter cannot approve their own planning submission, even when the workflow routes back to them.

Setup imports now show actual creation counts. Repeated imports report that no new records were added. Demo customers/products and sample projects are separate optional selections; standard workflows do not create demo business records.

## Budget sequence

1. Create a department budget with a code, annual dates or financial year, currency and account allocations. Department cost centers use the department code. Only assigned departments and allowed branches are available to ordinary budget preparers.
2. Submit it for approval. The record becomes read-only until rejected or approved. Review the amount and department through the global approval inbox. A rejected submission can be corrected and resubmitted.
3. Finance selects approved department submissions and chooses **Consolidate selected**. Use matching dates, financial year and currency, with one submission per department/branch. Each submission can be consolidated once.
4. Submit the resulting annual budget for separate approval. Final approval activates it for budget control. Source budgets and allocation references remain available; they are excluded from organization allocation totals to avoid counting the same funds twice. Approved source amounts and a consolidated annual budget cannot be changed through draft editing.

Departments remain draft operational budgets while their approval status changes. Only the approved organization budget becomes active for financial control. Existing active budgets are marked approved by the migration so current budget operations continue.

## Procurement plans

Create one procurement plan per approved active annual budget. Saving the initial draft copies its positive allocations as proposed procurement items. Refine or remove items that are not procurement requirements. Split allocations by adding items against the same budget line where needed.

Enter the item/service, category, quantity, unit, total estimate, procurement method and planned date. Submission requires a date within the annual budget period and positive quantity/amount. Combined estimates against an allocation cannot exceed its approved amount. Categories and methods initially remain Other/To be determined for staff to select.

Submit through the configured global workflow. Submitted and approved plans are read-only; rejected plans can be revised. Export the plan as CSV. This plan is a forecast and approval record; it does not create requisitions, purchase orders or financial commitments automatically, and it does not impose a new requirement to select a plan line on existing requisitions.

## Permissions and migration

Budget permissions: `view_budget`, `add_budget`, `change_budget`, `view_all_budget`, `submit_budget`, `approve_budget`, `consolidate_budget` in `SL_Budgeting`.

Procurement plan permissions: `view_procurementplan`, `add_procurementplan`, `change_procurementplan`, `submit_procurementplan`, `approve_procurementplan` in `SL_Procurement`. Configure grants in Roles & permissions. Module menu entries require the relevant module and view permission. Planning APIs enforce the selected organization and branch scope independently of menu visibility.

Schema/navigation migrations: Platform_Core 0074, SL_Budgeting 0002, SL_Procurement 0015–0016. Back up the database before applying them through the reviewed production deployment flow. No production deployment is performed by local setup.
