# SL-ERP System Implementation Checklist

Date: 2026-08-05
Purpose: Track the end-to-end implementation quality of the entire SL-ERP platform module by module, using one consistent checklist for listings, forms, workflow integration, master-data alignment, finance linkage, and SaaS packaging.

## 1. How To Use This Checklist

For every major page or module, review it against these control areas:

- listing/workspace quality
- form quality
- workflow linkage
- master-data alignment
- finance and audit linkage
- SaaS/module packaging readiness

Use these statuses:

- `done`
- `in_progress`
- `not_started`
- `blocked`

## 2. Cross-System Quality Gates

Every module should be reviewed against the following.

### A. Listing / Workspace

- search
- business filters
- date filters where operationally relevant
- pagination
- row counts / KPIs
- row drill-down or workspace sheet
- export where operationally relevant
- bulk actions where operationally relevant
- role-aware actions
- workflow next-step visibility

### B. Forms

- create form
- edit form
- validation and error feedback
- disabled/pending save state
- grouped fields
- line items where document-based
- draft/submit/finalize behavior
- read-only restrictions after finalization where needed

### C. Workflow

- upstream source visible
- current status visible
- next action visible
- downstream document/module visible
- approval integration where needed
- workflow audit trail or approval context visible

### D. Master Data

- uses shared party/customer logic
- uses shared product/service logic
- avoids duplicate local master ownership
- supports future canonical master linkage

### E. Finance / Audit

- clear posting or billing impact
- receivables/payables linkage where needed
- audit-sensitive restrictions
- role and permission controls

### F. SaaS Packaging

- clearly a core module or industry pack
- tenant scoped
- module activation aware
- standalone-capable if needed

## 3. Module Review Matrix

| Area | Listing | Forms | Workflow | Master Data | Finance/Audit | SaaS Ready | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CRM Companies | partial | partial | partial | partial | partial | yes | in_progress | Needs drill-in account workspace, pagination, export, account-history connections |
| CRM Opportunities | good | good | good | partial | partial | yes | in_progress | Improved with in-page workspace; still needs direct estimate/order creation |
| Sales Products | good | good | partial | good | partial | yes | in_progress | Needs drill-in, export, and stronger cross-module flags |
| Sales Orders | good | partial | good | partial | good | yes | in_progress | Needs benchmark-level listing controls and richer order workspace |
| Finance Receivables | good | good | good | partial | good | yes | in_progress | Needs benchmark-level listing controls and stronger AR workspace standardization |
| Procurement Requisitions | partial | partial | good | partial | good | yes | in_progress | Current priority upgrade |
| Inventory Stock | partial | low | partial | good | partial | yes | in_progress | Still conceptual; must become true stock item workspace |
| Inventory Movements | low | low | partial | partial | partial | yes | not_started | Needs implementation beyond conceptual page |
| Weighbridge Transactions | strong | strong | strong | partial | good | strong | in_progress | Current benchmark screen; still needs long-term master-data convergence |
| HR Staff | low | low | low | partial | partial | yes | not_started | Structural placeholder, needs HCM rollout |
| Manufacturing Pack | low | low | conceptual | partial | partial | yes | not_started | Placeholder pack structure added |
| Retail Pack | low | low | conceptual | partial | partial | yes | not_started | Placeholder pack structure added |
| Projects & Services Pack | low | low | conceptual | partial | partial | yes | not_started | Placeholder pack structure added |

## 4. Upgrade Order

### Current execution order

1. Procurement Requisitions
2. Sales Orders
3. Finance Receivables
4. Inventory Movements
5. Shared reusable listing/workspace components

### After that

6. CRM Companies / Account workspace
7. Sales Products / Shared Item workspace
8. Procurement Vendors
9. Inventory Stock / Item ledger workspace

## 5. Shared Master Data Workstream

These are not optional if the ERP is to scale correctly.

### Party / Account

- unify CRM organisation and operational customer references
- define canonical party ownership and source-of-capture rules
- support customer, prospect, supplier, partner roles on one identity

### Product / Service

- make shared product master canonical
- reduce local item duplication
- add explicit item-role flags:
  - sales
  - purchase
  - stock
  - service

### Inventory

- add warehouse-aware ledger
- add reservations
- add adjustments
- add valuation linkage

## 6. Reusable UI Standards To Build

- standard ERP listing toolbar
- standard ERP pagination footer
- standard export action pattern
- standard status badge system
- standard workflow side-sheet workspace
- standard document summary KPI row
- standard bulk actions bar

## 7. Definition Of “Done” For A Module

A module page is only `done` when:

1. the listing meets its page class standard
2. forms are complete for its lifecycle
3. statuses and next actions are workflow-aware
4. master-data ownership is clear
5. finance/audit implications are handled
6. SaaS packaging role is clear

That is the bar we should now use across the full system.
