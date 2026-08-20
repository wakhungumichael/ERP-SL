# ERP Canonical Module Alignment

Date: 2026-08-05
Purpose: Realign SL-ERP as one integrated ERP platform with shared master data, shared workflows, and a clear path to add Inventory without fragmenting customers, products, suppliers, or financial controls.

## 1. Executive Summary

SL-ERP already has strong foundations:

- multi-tenant platform core
- workflow engine
- sales, CRM, procurement, budgeting, accounting, and invoicing building blocks
- tenant-scoped APIs

The main architectural issue is not missing screens. It is **master-data fragmentation**.

Today, the same business concepts are represented in multiple places:

- customers exist in CRM and Weighbridge
- suppliers exist in CRM and Procurement as denormalized fields
- products live in `SL_Sales.Product`, while Weighbridge still has a separate `Item`
- procurement requisition lines are text-based instead of catalog-based
- invoices and receivables live in Weighbridge, but are used as broader ERP billing objects

If Inventory is added without correcting this, the ERP will become harder to scale and reconcile.

## 2. Current Module Reality

### Existing modules and what they already do well

| Domain | Current app / layer | Current strength |
| --- | --- | --- |
| Platform core | `Platform_Core` | tenancy, workflow, accounting, integration endpoints, pricing rules |
| CRM | `SL_CRM` | organisation, contact, lead, supplier relationship capture |
| Sales | `SL_Sales` | product catalog, estimates, sales orders, recurring invoices |
| Procurement | `SL_Procurement` | requisitions, approvals, purchase orders, bills |
| Budgeting | `SL_Budgeting` | budgets, budget lines, commitments, checks |
| Billing / receivables | `SL_Weighbridge.Invoice` | invoice and payment-linked receivable records |
| Operational vertical | `SL_Weighbridge` | branch operations, transactions, vehicle and weighing workflows |

### Current duplication and misalignment

| Concept | Current locations | Problem |
| --- | --- | --- |
| Customer master | `SL_CRM.Organisation`, `SL_Weighbridge.Customer` | duplicate identity and lifecycle logic |
| Supplier master | `SL_CRM.Supplier`, `SL_Procurement.PurchaseOrder.supplier_name` | supplier used both as master data and free text |
| Product / item master | `SL_Sales.Product`, `SL_Weighbridge.Item`, `VehicleType.linked_product` | item catalog is split |
| Quote / opportunity bridge | `SL_CRM.Lead`, `SL_Sales.Estimate` | CRM and commercial quote objects are not yet joined |
| Billing engine | `SL_Weighbridge.Invoice` used beyond weighbridge | invoice domain is broader than app name implies |
| Inventory | not yet modeled as a shared module | no stock ledger, reservation, warehouse, or fulfillment layer |

## 3. Recommended Canonical ERP Structure

The ERP should be governed by shared masters and document flows.

### Canonical shared masters

1. Party master
   Covers customer, prospect, supplier, partner, employee-related external parties.

2. Product master
   Covers sellable items, purchasable items, stock items, services, spare parts, weighbridge services.

3. Inventory master
   Covers warehouse, bin, stock balance, lot/serial, reorder rules, stock movement, reservation.

4. Financial master
   Covers chart of accounts, journals, tax codes, payment terms, cost centers, projects, currencies.

### Transaction modules

1. CRM
   Prospecting, contacts, opportunities, activities, account history.

2. Sales
   Quotations, sales orders, fulfillment requests, customer pricing.

3. Inventory
   Receipts, issues, transfers, adjustments, reservations, fulfillment, stock valuation.

4. Procurement
   Requisitions, approvals, supplier sourcing, purchase orders, goods receipts, supplier bills.

5. Billing / Receivables
   Customer invoices, receipts, credit notes, aging, collections.

6. Accounting
   Journals, postings, periods, reconciliation, financial statements.

7. Vertical packs
   Weighbridge, healthcare, manufacturing, retail, services-specific workflows.

## 4. Master Data Ownership Model

### 4.1 Party / account ownership

Recommended target:

| Party type | System of record | Notes |
| --- | --- | --- |
| Prospect | CRM | pre-sale relationship lives here |
| Customer account | Shared party master, maintained from CRM then operationalized in ERP | once converted, same party is reused by sales, billing, inventory, and service |
| Supplier / vendor | Shared party master, maintained by Procurement / Finance | CRM supplier can become just one view of party |
| Contact person | CRM-primary, shared to party/contact layer | not module-local |

Recommendation:

- Treat `SL_CRM.Organisation` as the future seed of a shared `Party` model.
- Replace module-local customer/supplier duplication with role-based party records:
  - `is_customer`
  - `is_supplier`
  - `is_prospect`
  - `is_partner`

### 4.2 Product ownership

Recommended target:

| Product type | System of record | Notes |
| --- | --- | --- |
| stock item | shared product + inventory | purchasable and sellable |
| non-stock item | shared product | for services or charges |
| service | shared product | consulting, weighbridge service, recurring charge |
| vertical charge code | shared product with module metadata | not a separate item table |

Recommendation:

- `SL_Sales.Product` should become the canonical product/item master.
- `SL_Weighbridge.Item` should be retired or converted into a thin compatibility layer pointing to `Product`.
- `RequisitionLine` and future PO / GRN lines should reference `Product`, not only free-text description.

### 4.3 Inventory ownership

Recommended target:

| Inventory concept | Owner |
| --- | --- |
| warehouse and bins | Inventory module |
| on-hand, reserved, available quantities | Inventory module |
| valuation and stock ledger | Inventory + Accounting |
| reorder points and replenishment rules | Inventory + Procurement |
| fulfillment issue / dispatch status | Inventory, exposed to Sales and CRM |

## 5. Recommended Target Data Model

### 5.1 Shared Party layer

Recommended new module: `SL_MasterData` or `SL_Parties`

Core entities:

- `Party`
- `PartyRole`
- `PartyContact`
- `PartyAddress`
- `PartyTaxProfile`
- `PartyCreditProfile`
- `PartyExternalReference`

Key fields for `Party`:

```json
{
  "id": "internal pk",
  "tenant_id": "required",
  "party_code": "unique per tenant",
  "legal_name": "required",
  "display_name": "required",
  "party_type": "organization|individual",
  "email": "optional",
  "phone": "optional",
  "tax_id": "optional but strongly recommended",
  "status": "active|inactive|blocked",
  "is_customer": true,
  "is_supplier": false,
  "is_prospect": true,
  "credit_limit": 0,
  "payment_terms_code": "NET30",
  "metadata": {}
}
```

### 5.2 Shared Product layer

Core entities:

- `Product`
- `ProductCategory`
- `ProductPriceList`
- `ProductPrice`
- `ProductTaxProfile`
- `UnitOfMeasure`
- `ProductSupplier`

Required product flags:

- `is_sales_item`
- `is_purchase_item`
- `is_stock_item`
- `is_service`

### 5.3 New Inventory module

Recommended new app: `SL_Inventory`

Core entities:

- `Warehouse`
- `WarehouseBin`
- `InventoryItemBalance`
- `InventoryMovement`
- `InventoryReservation`
- `StockTransfer`
- `StockAdjustment`
- `GoodsReceipt`
- `GoodsIssue`
- `LotSerial`
- `ReorderRule`

Minimum data structure:

```json
{
  "warehouse": "physical or virtual location",
  "product": "FK to shared product",
  "lot_serial": "optional",
  "on_hand_qty": 0,
  "reserved_qty": 0,
  "available_qty": 0,
  "average_cost": 0,
  "valuation_amount": 0
}
```

## 6. Required Module Realignment

### 6.1 CRM

Keep:

- prospecting
- contact management
- lead/opportunity pipeline
- activities and follow-ups

Change:

- `Organisation` should stop being a separate long-term customer master
- add direct link to canonical `Party`
- once a lead is won, CRM should reference shared party and ERP documents

### 6.2 Sales

Keep:

- `Product`
- `Estimate`
- `SalesOrder`
- recurring billing documents

Change:

- sales customer should reference shared party/customer record
- estimate and sales order lines should be valid for both stock and service products
- fulfillment should flow through Inventory for stock items

### 6.3 Procurement

Keep:

- requisitions
- approval matrix
- purchase orders
- bills

Change:

- `PurchaseOrder.supplier_name`, `supplier_email`, and `supplier_phone` should be replaced by supplier FK to shared party/vendor
- requisition and PO lines should reference `Product`
- procurement should create inventory receipts for stock items
- procurement should create AP / accounting postings through controlled states

### 6.4 Weighbridge

Keep:

- branch operations
- transactions
- vehicle and weight workflows
- operational alerts and discrepancy controls

Change:

- treat Weighbridge as a vertical operational pack, not as the owner of global customer, item, or invoice concepts
- `Customer` should become a compatibility link to shared party or be migrated away
- `Item` should map to shared product
- invoices should eventually move to a broader billing domain module, even if compatibility stays in place initially

### 6.5 Budgeting

Keep:

- budget
- budget line
- commitments
- checks

Change:

- budget consumption should be triggered by requisition, PO, GRN, bill, and stock issue events
- cost-center and project controls should apply across Procurement, Inventory, and Sales where appropriate

### 6.6 Accounting

Keep:

- accounts
- journals
- journal entries
- posting rules
- financial years and periods

Change:

- Inventory must post stock valuation movements into accounting
- billing, purchasing, inventory, and payments should all converge into posting rules consistently

## 7. Canonical Cross-Module Workflows

### 7.1 Lead to cash

```text
CRM Lead
-> Sales Quote / Estimate
-> Credit Check
-> Sales Order
-> Inventory Reservation / Fulfillment
-> Customer Invoice
-> Payment Receipt
-> Accounting Posting
-> CRM timeline update
```

### 7.2 Requisition to pay

```text
Requisition
-> Budget Check
-> Approval Workflow
-> Purchase Order
-> Goods Receipt
-> Supplier Bill
-> Payment
-> Accounting Posting
-> Budget actualization
```

### 7.3 Procure to stock to sell

```text
Purchase Order
-> Goods Receipt into Warehouse
-> Inventory On-Hand Updated
-> Stock becomes available to Sales
-> Sales Order reserves stock
-> Dispatch / Goods Issue
-> Invoice
```

### 7.4 Weighbridge commercial service flow

```text
Vehicle / customer operational transaction
-> Service charge calculation
-> Invoice
-> Payment / receivable
-> Accounting posting
-> CRM account activity history
```

## 8. Inventory Module Blueprint

Inventory should not be added as a standalone afterthought. It should sit between Procurement, Sales, and Accounting.

### Functional scope

Phase 1:

- warehouses
- stock items
- stock ledger
- goods receipt
- goods issue
- stock adjustment
- stock transfer
- available vs reserved quantities

Phase 2:

- reorder planning
- supplier lead times
- lot / serial tracking
- min-max replenishment
- cycle counts
- valuation methods

Phase 3:

- manufacturing consumption
- kit / assembly handling
- demand planning
- inter-branch replenishment

### Inventory event ownership

| Event | Source module | Inventory action |
| --- | --- | --- |
| PO received | Procurement | increase on-hand |
| SO confirmed | Sales | reserve stock |
| SO dispatched | Sales / Inventory | reduce on-hand and reservation |
| stock adjustment | Inventory | raise/lower stock |
| branch transfer | Inventory | move stock warehouse to warehouse |
| return from customer | Sales / Inventory | put stock back or scrap |
| return to supplier | Procurement / Inventory | reduce stock |

## 9. Current Schema Gaps That Must Be Fixed

These are the highest-priority structural gaps visible today:

1. Shared customer identity does not exist yet.
2. Shared supplier identity does not exist yet.
3. Shared product identity is incomplete because `SL_Weighbridge.Item` still exists separately.
4. Procurement documents are not fully catalog-driven.
5. Inventory module does not yet exist.
6. Credit policy is not fully implemented, even though statement APIs expose placeholders.
7. Billing objects live in Weighbridge naming, but function as ERP-wide invoices.

## 10. Recommended Implementation Phases

### Phase 1: Canonical masters

1. Introduce shared `Party` model.
2. Introduce shared party roles for customer, supplier, prospect.
3. Add cross-reference fields from:
   - CRM organisation
   - Weighbridge customer
   - CRM supplier
   - procurement supplier references
4. Standardize `Product` as the canonical item master.
5. Begin migrating `SL_Weighbridge.Item` to `Product`.

### Phase 2: Transaction alignment

1. Refactor Sales, Procurement, and CRM to use shared party links.
2. Refactor requisition and PO lines to reference product master.
3. Add credit profile and payment terms to shared party/customer profile.
4. Add document cross-reference table for traceability.

### Phase 3: Inventory foundation

1. Create `SL_Inventory`.
2. Add warehouse, stock balances, stock movement, and reservation models.
3. Connect procurement receipts to stock increases.
4. Connect sales fulfillment to stock reservations and issues.
5. Add inventory-to-accounting posting rules.

### Phase 4: Workflow consolidation

1. Use `Platform_Core.WorkflowDefinition` and node-based workflow as the primary approval engine.
2. Align requisition approvals, inventory approvals, returns, and credit holds to the same engine.
3. Add SLA, escalation, and dashboard work inbox across modules.

### Phase 5: Billing and finance cleanup

1. Generalize invoice domain naming so non-weighbridge billing is first-class.
2. Add AR/AP extensions where needed.
3. Add stock valuation, COGS, and landed cost logic.

## 11. Immediate Recommendations for This Codebase

If we want the next implementation steps to be safe, the order should be:

1. Freeze creation of any new customer- or supplier-like models in module-local apps.
2. Define the canonical shared party schema first.
3. Define the inventory schema before extending sales fulfillment.
4. Replace free-text procurement supplier usage with FK-based master references.
5. Replace free-text or module-local item references with shared product references.

## 12. Practical Alignment Rules

These should guide every future module:

- One concept, one master table.
- Vertical modules may extend shared masters, but should not replace them.
- Every commercial document must trace back to party, product, branch, tenant, and accounting impact.
- Every stock movement must be auditable and financially reconcilable.
- Every workflow must use the shared workflow engine unless there is a hard reason not to.

## 13. Proposed Target System Ownership

| Domain | Canonical owner |
| --- | --- |
| party / account master | shared master-data module |
| contacts and prospecting | CRM |
| customer credit profile | shared master-data + Finance |
| supplier profile | shared master-data + Procurement |
| product / item master | Sales / shared product layer |
| inventory / stock | Inventory |
| customer pricing | Sales |
| procurement sourcing | Procurement |
| operational weighbridge transactions | Weighbridge vertical |
| invoices and receivables | Billing / AR |
| budgets and commitments | Budgeting |
| journals and financial close | Accounting |

## 14. What This Means for the CRM Integration Work

The CRM integration should now be treated as one slice of a broader ERP alignment program:

- CRM should not own the long-term customer account by itself.
- won opportunities should convert into shared customer/party plus sales documents
- product sync should originate from shared product master
- fulfillment updates should come from Inventory / Sales execution
- credit checks should read shared AR exposure and credit profile

That keeps CRM aligned with the ERP rather than competing with it.

