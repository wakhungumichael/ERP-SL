# ERP Expansion Blueprint for Budgeting, Requisition, and SaaS Module Growth

## 1. Executive Direction

SL-ERP already has a strong SaaS foundation:

- Django + PostgreSQL backend
- Multi-tenant platform core
- Subscription plans and tenant module activation
- Existing modules for CRM, HR, sales, accounting, procurement, invoicing, and weighbridge

The next expansion should not be built as one isolated "budgeting feature". It should be structured as a **shared financial control platform** with optional **industry packs** on top of it.

Recommended direction:

- Build a new **Budgeting & Commitments** shared module
- Expand **Procurement** into a full requisition-to-pay workflow
- Keep industry behavior configurable through tenant/module settings
- Package advanced workflows as SaaS-entitled modules by plan and industry

## 2. What the Current Codebase Already Supports

From the current repository:

- Backend language: `Python` with `Django`
- Database engine: `PostgreSQL`
- SaaS model: `Tenant`, `Industry`, `ModuleDefinition`, `SubscriptionPlan`, `PlanModule`, `TenantSubscription`, `TenantModuleActivation`
- Existing procurement baseline: `PurchaseOrder`, `PurchaseOrderItem`, `Bill`, `BillLineItem`
- Existing accounting baseline: platform-level accounts, journals, journal entries, and posting rules

This means the platform is already ready for:

- industry-specific module packaging
- plan-based feature activation
- tenant-specific configuration
- accounting and procurement integration

## 3. Gaps We Need to Close

The current procurement implementation is still basic compared to the ToR requirements. Main gaps:

- No dedicated `Requisition` model yet
- No budget ledger or commitment accounting states
- No approval matrix engine for requisitions
- No goods receipt / GRN workflow
- No 3-way match across requisition, PO, receipt, and bill
- No budget amendment / override process
- No budget-aware GL posting lifecycle
- `PurchaseOrder` is not yet modeled as a tenant-owned, budget-aware document

So the right move is to evolve from simple purchasing records into a **controlled financial operations workflow**.

## 4. Recommended Target Module Structure

Use two layers:

### Shared Core Modules

These should be SaaS modules available across industries.

1. `budgeting`
   - budget versions
   - budget lines
   - control rules
   - commitment accounting
   - amendment workflow

2. `procurement`
   - requisitions
   - approval workflows
   - purchase orders
   - goods receipt notes
   - supplier bills
   - 3-way match

3. `accounts-payable`
   - bill validation
   - payment scheduling
   - accruals
   - vendor aging

4. `costing-projects`
   - cost centers
   - profit centers
   - project / WBS tracking
   - department allocations

### Industry Packs

These should sit on top of the shared modules and reuse the same budgeting engine.

1. `manufacturing-pack`
   - BOM-linked budget consumption
   - work center cost controls
   - maintenance reserve budgets
   - raw material price caps

2. `retail-pack`
   - open-to-buy controls
   - store/location budget buckets
   - seasonal purchase caps
   - freight and shrinkage controls

3. `services-pack`
   - project and milestone budgets
   - billable hour controls
   - subcontractor budget caps

4. `public-healthcare-pack`
   - grant/fund budgets
   - non-transferable pools
   - stronger audit rules
   - compliance-centered approval paths

## 5. Best SaaS Structuring Approach

For your current architecture, the cleanest SaaS strategy is:

### A. Keep the budgeting engine shared

Do not build separate budgeting logic per industry. Build one engine with:

- hierarchical budget dimensions
- rule-driven controls
- configurable validation policies
- tenant-specific schemas in JSON config where needed

### B. Put industry behavior in module config

Use `ModuleDefinition.config_schema`, `PlanModule.config`, and `TenantModuleActivation.config` for:

- enabled budget dimensions
- approval thresholds
- tolerance percentages
- allowed document types
- industry-only fields

### C. Package modules by plan

Recommended commercial packaging:

- `Starter`
  - core platform
  - invoicing
  - basic procurement
  - basic reporting

- `Professional`
  - budgeting
  - requisitions
  - accounting integration
  - approval workflows
  - standard analytics

- `Enterprise`
  - industry packs
  - 3-way match
  - advanced controls
  - API/EDI integrations
  - multi-branch / multi-entity budgeting

### D. Keep tenant ownership on every operational model

Every new operational model should consistently include:

- `tenant`
- optional `branch`
- `created_by`
- `status`
- timestamps
- immutable audit trail references

That protects your SaaS isolation and makes reporting safer.

## 6. New Data Domains to Introduce

Recommended new entities:

### Budgeting

- `Budget`
- `BudgetVersion`
- `BudgetLine`
- `BudgetControlRule`
- `BudgetCommitment`
- `BudgetAmendment`
- `BudgetTransfer`
- `BudgetCheckLog`

### Requisition-to-Pay

- `Requisition`
- `RequisitionLine`
- `ApprovalWorkflow`
- `ApprovalStep`
- `ApprovalInstance`
- `ApprovalDecision`
- `GoodsReceiptNote`
- `GoodsReceiptLine`
- `MatchException`

### Integration / Accounting Linkage

- `SourceDocumentLink`
- `CommitmentPosting`
- `AccrualPosting`
- `ActualExpensePosting`
- `WorkflowEventLog`

## 7. Financial Control Model to Implement

The control model should be:

- `Allocated`: approved budget uploaded by Finance
- `Committed`: approved requisition reserves funds
- `Obligated`: approved PO creates legal commitment
- `Actual`: bill/GRN/invoice posts the real expense
- `Available`: allocated minus committed, obligated, and actual

This should be updated transactionally so failures roll back reserved amounts.

## 8. Department Ownership Inside the ERP

To avoid confusion and fraud risk, the departments should be separated like this:

### Finance & Accounting

Owns:

- annual/monthly budget setup
- Chart of Accounts alignment
- cost center and budget line rules
- hard vs soft controls
- amendments and overrides
- final accounting reconciliation

### Procurement / Supply Chain

Owns:

- vendor onboarding checks
- sourcing workflow
- RFQ to PO conversion
- goods receipt coordination
- supplier bill intake validation

### Department Heads / Budget Owners

Owns:

- approval of requests inside their spending authority
- project / department budget accountability
- justification for over-budget requests

### Regular Staff / Requestors

Owns:

- creating requisitions
- attaching specifications, quotes, and business reasons
- selecting the correct cost center/project

They should **not** edit budgets or approval rules.

### IT / System Administration

Owns:

- RBAC and workflow configuration
- module activation by tenant
- integration endpoints
- performance, observability, backups, and audit retention

They should not own financial decisions.

### Internal Audit / Compliance

Owns:

- review of approval trails
- exception monitoring
- override monitoring
- compliance reporting

## 9. Recommended User Flow for Normal Staff

For normal users, the ERP should feel simple:

1. Open `Procurement > My Requisitions`
2. Create request
3. Select item/service, quantity, cost center, GL code, project, and vendor option
4. Submit
5. System runs budget check
6. System routes approvals automatically
7. User tracks status: draft, pending, approved, returned, rejected, PO issued, received, billed

This keeps the complexity in the backend while staff see a clean request flow.

## 10. Recommended Build Phases

### Phase 1: Audit and Foundation

- audit current models and APIs
- make procurement entities tenant-consistent
- confirm COA, cost centers, branches, suppliers, and HR approval sources
- add audit/event logging standards

### Phase 2: Budgeting Engine

- create budget master and line models
- implement available/committed/obligated/actual calculations
- add hard and soft control rules
- add budget check API

### Phase 3: Requisition Workflow

- create requisition models
- add approval matrix engine
- reserve commitment on approval
- support return/reject/cancel flows

### Phase 4: PO, GRN, and 3-Way Match

- convert approved requisitions to PO
- create GRN flow
- match PO vs GRN vs bill
- create variance exception handling

### Phase 5: Accounting and Payment Integration

- post commitments and actuals to accounting
- trigger AP workflow
- generate reports for budget utilization, exceptions, and vendor liabilities

### Phase 6: Industry Packs

- manufacturing extensions
- retail controls
- services/project budgeting
- healthcare/public grant controls

## 11. What We Should Build First

Highest-priority first release:

1. Tenant-aware requisitions
2. Budget lines by period, cost center, and account
3. Approval rules by amount and department
4. Commitment accounting
5. PO conversion
6. Bill matching and actual expense posting

This first slice gives you real business value without waiting for every industry extension.

## 12. Practical Recommendation for SL-ERP

For SL-ERP, the most scalable path is:

- keep `Platform_Core` as the SaaS control plane
- add a new Django app such as `SL_Budgeting`
- expand `SL_Procurement` instead of replacing it
- expose new routes through `Platform_API/modules/budgeting/` and enhanced procurement APIs
- add new module seeds for `budgeting`, `accounts-payable`, and selected industry packs

## 13. Final Position

Yes, we should expand the ERP beyond the current modules, but we should do it in a way that matches your existing SaaS structure:

- one shared budgeting engine
- one controlled requisition-to-pay backbone
- optional industry packs
- tenant-safe module activation
- strong separation of duties between Finance, Procurement, IT, approvers, and requestors

That approach will let SL-ERP grow as both a product and a platform, instead of becoming a collection of disconnected custom features.
