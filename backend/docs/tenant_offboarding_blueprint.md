# Tenant Offboarding Blueprint

Current audit date: August 13, 2026

## Current State

The platform is now strongly tenant-isolated across the audited API surfaces, but it does not yet provide a complete SaaS offboarding workflow for:

- tenant-scoped self-service export
- tenant deletion approval / waiting period
- coordinated purge of tenant-owned rows and stored files
- final audit trail for export and purge actions

Today the platform supports:

- tenant suspension via `POST /api/platform/tenants/<id>/suspend/`
- tenant reactivation via `POST /api/platform/tenants/<id>/activate/`
- tenant-scoped document rendering and configuration
- blocked raw API deletion of tenants through `TenantDetailAPIView.destroy()`

Today the platform does not safely support:

- customer-initiated full data export
- customer-initiated full data deletion
- superadmin-assisted purge with a controlled dependency order
- file-system cleanup for generated artifacts and uploaded media tied to a tenant

## Key Safety Decision

Direct tenant deletion is intentionally blocked at the API layer until a real offboarding workflow exists.

Reason:

- a raw model delete is not an offboarding workflow
- many records are tenant-owned, but some related resources need ordered cleanup
- a proper export window and operator confirmation step are required for SaaS data ownership

## Tenant-Owned Data Map

### Platform Core

Primary tenant-owned records:

- `Tenant`
- `TenantSubscription`
- `SubscriptionBillingRequest`
- `LicenseKey`
- `TenantModuleActivation`
- `TenantBranch`
- `TenantUserProfile`
- `OrganizationMembership`
- `TenantSettings`
- `IntegrationEndpoint`
- `PricingRule`
- `DocumentTemplate`
- `BackupPolicy`
- `Account`
- `Journal`
- `JournalEntry`
- `AccountingPostingRule`
- `FinancialYear`
- `AccountingPeriod`
- `AccountingPeriodAuditLog`
- `WorkflowDefinition`
- `WorkflowNodeDefinition`
- `WorkflowTransitionDefinition`
- `WorkflowStepDefinition`
- `WorkflowEntityBinding`
- `WorkflowInboxItem`
- `BankReconciliationSession`
- `BankStatementLine`
- `AuditEventLog`
- `AuditAccessLog`

### Weighbridge / Operations

Primary tenant-owned records:

- `Company`
- `Branch`
- `Customer`
- `VehicleType`
- `Vehicle`
- `Currency`
- `Item`
- `Transaction`
- `Invoice`
- `Payment`
- `PaymentMethod`
- `IndicatorConfig` through tenant-owned branch
- `VehiclePresence`
- `OverweightConfig`
- `OverweightEvent`
- `WeighingOperationType`

Notes:

- `Customer` uses soft-delete fields (`is_active`, `is_deleted`) in some flows
- uploaded surveillance and vehicle images need explicit media cleanup handling

### CRM

- `Organisation`
- `Contact`
- `Supplier`
- `Lead`
- `Activity`

### Sales

- `Product`
- `Estimate`
- `EstimateLineItem`
- `SalesOrder`
- `SalesOrderLineItem`
- `RecurringInvoice`

### Procurement

- `Requisition`
- `RequisitionLine`
- `ApprovalMatrix`
- `RequisitionApproval` through tenant-owned requisition / matrix
- `PurchaseOrder`
- `PurchaseOrderItem`
- `GoodsReceiptNote`
- `GoodsReceiptLine`
- `Bill`
- `BillLineItem`
- `MatchException`
- `PaymentQueueItem`

### Budgeting

- `Budget`
- `BudgetLine`
- `BudgetCommitment`
- `BudgetCheckLog`

### HR

- `PayPeriod`
- `PayRecord` through tenant-owned pay period

### Inventory

- `Warehouse`
- `InventoryBalance`
- `InventoryMovement`
- `InventoryReservation`

## Data Export Scope

A proper tenant export should include:

- tenant profile and settings
- subscriptions, plans, billing requests, licenses, modules
- users and organization memberships for that tenant
- branches and workflow definitions
- customers, vehicles, items, invoices, payments, transactions
- CRM records
- accounting records and periods
- procurement, budgeting, inventory, HR records
- document templates and integration configuration
- tenant audit trail

Recommended export format:

- a manifest JSON with export metadata
- one JSON or CSV file per major domain
- optional relational SQL dump only if it is tenant-scoped, not full-database
- a `files/` section for tenant media and generated documents

Export manifest should include:

- tenant id
- tenant code
- export generated at
- export requested by
- row counts per domain
- file list and checksums
- schema version

## Purge Order

Deletion should run in dependency order, inside a controlled offboarding job rather than a direct API delete.

Recommended high-level order:

1. Lock tenant access
2. Revoke active sessions / tokens
3. Suspend background activity and new writes
4. Generate and store export package
5. Mark tenant offboarding state as `pending_purge`
6. After retention window, purge child domains
7. Purge tenant root record last

Recommended domain purge order:

1. Workflow inbox and transient queues
2. Audit and access logs
3. HR records
4. Budget checks and commitments
5. Inventory movements and reservations
6. Procurement documents and match/payment queues
7. Sales documents
8. CRM entities
9. Weighbridge invoices, payments, transactions, surveillance records, masters
10. Accounting journal lines, entries, posting rules, periods, years, reconciliation data
11. Integrations, templates, pricing rules, module activations, licenses, billing requests
12. Memberships, tenant profiles, tenant settings, branches
13. Subscriptions
14. Tenant

The actual implementation should use model-aware service code instead of relying on broad cascading deletes alone.

## Required Safeguards Before Purge

- export must finish successfully first
- offboarding should require explicit superadmin confirmation
- optional retention window should be configurable
- purge action should be idempotent
- every phase should emit audit events
- job status should be visible to operators
- restore is out of scope unless a true tenant-scoped backup format is introduced

## File and Artifact Cleanup Gaps

The current audit indicates the purge workflow must also handle non-row data such as:

- `vehicle_images/`
- overweight or surveillance captures
- generated reports under media/output folders
- stored backup artifacts if tenant-specific
- rendered document artifacts if persisted

This is not yet implemented centrally.

## API / Service Gaps To Build

Recommended new building blocks:

- `TenantOffboardingRequest` model
- `TenantExportJob` model
- `TenantPurgeJob` model
- `tenant_export_service.py`
- `tenant_offboarding_service.py`
- `tenant_file_cleanup_service.py`

Recommended endpoints:

- `POST /api/platform/tenants/<id>/offboarding/export/`
- `POST /api/platform/tenants/<id>/offboarding/request-delete/`
- `POST /api/platform/tenants/<id>/offboarding/approve-delete/`
- `GET /api/platform/tenants/<id>/offboarding/status/`
- `GET /api/platform/tenants/<id>/offboarding/export-download/`

## Practical Recommendation

Phase 1:

- keep raw tenant delete blocked
- add export job model and API
- add offboarding status model and API

Phase 2:

- implement deterministic tenant purge service
- add media cleanup handlers
- add audit events for export, approve, purge, fail

Phase 3:

- add tenant self-service request flow with confirmation and retention window

## Bottom Line

The platform is now close to SaaS-safe for cross-tenant isolation, but it is not yet feature-complete for customer-owned export and delete lifecycle.

The next safe implementation step is:

- build export first
- add offboarding state machine second
- add irreversible purge last
