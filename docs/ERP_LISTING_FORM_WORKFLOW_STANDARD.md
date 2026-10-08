# ERP Listing, Form, And Workflow Standard

Date: 2026-08-05
Purpose: Use the Weighbridge transaction log as the reference implementation for how SL-ERP listing pages, forms, and workflow-connected workspaces should behave across the platform.

## 1. Benchmark Screen

Reference screen:

- `/weighbridge/transactions`
- Source: [artifacts/erp-ui/src/pages/transactions/list.tsx](/home/mike/DEVELOPMENT/SIAKORA%20LABS/SL-ERP/artifacts/erp-ui/src/pages/transactions/list.tsx)

Why it is the best current benchmark:

1. It is not just a table.
2. It behaves like an operational workspace.
3. It combines search, filtering, permissions, pagination, bulk actions, exports, drill-down, and downstream workflow actions.
4. It already reflects real ERP user behavior better than most pages.

## 2. What The Benchmark Already Does Well

### 2.1 Listing features

Current Weighbridge transaction listing includes:

- searchable listing
- multiple filter dimensions
- date range filtering
- pagination
- page-size control
- configurable visible columns
- column reordering
- export
- row selection
- bulk actions
- drill-down to detail page
- role-based action visibility
- live operational status badges
- financial status badges
- record counts

### 2.2 Workflow connection

The screen is also workflow-aware:

- can approve transactions
- can recall transactions
- can receive payment
- can export for downstream processing
- links to weighment entry
- links to transaction details
- aligns transaction state with what the user is allowed to do next

### 2.3 Form and interaction quality

It supports strong ERP interaction patterns:

- contextual actions, not generic CRUD only
- permission-aware buttons
- operational batch processing
- state-driven availability of next actions
- workflow-specific dialogs and receipt handling

## 3. Standard SL-ERP Listing Requirements

Every major ERP listing should be reviewed against this model.

### Tier 1: Mandatory listing features

Every operational listing should have:

1. search
2. at least one business filter
3. pagination
4. row count or summary count
5. status visibility through badges or states
6. row drill-down or row workspace action
7. create action if the module supports record creation
8. empty state
9. loading state

### Tier 2: Recommended ERP-grade features

Every serious operational listing should also aim to have:

1. export
2. date range filter
3. configurable columns
4. page-size selection
5. bulk actions
6. role-aware action visibility
7. KPI summary cards or top metrics
8. workflow next-step visibility

### Tier 3: Advanced workspace features

High-volume operational pages should eventually support:

1. saved views
2. filter chips
3. sticky workflow actions
4. inline state changes
5. drawer or sheet drill-in
6. report rendering or print actions
7. branch / warehouse / cost center contextual filters

## 4. Standard SL-ERP Form Requirements

### Mandatory form expectations

Each business form should have:

1. clear title and purpose
2. grouped fields
3. required field indicators
4. validation feedback
5. disabled state while saving
6. success and error feedback
7. sensible defaults
8. support for edit as well as create where applicable

### ERP-grade form expectations

Each core form should also aim to have:

1. workflow state awareness
2. contextual linked entities
3. line items where needed
4. draft versus submit behavior where relevant
5. approval-aware actions
6. finance-aware fields where relevant
7. audit-sensitive restrictions once a document is finalized

### Shared inline validation pattern

New and updated forms must render validation messages inside the form, next to the field that needs attention. Toasts are reserved for request-wide failures and success messages; they must not be the only place a field validation error appears.

Use these shared building blocks:

- `useFormErrors()` from `@/hooks/use-form-errors` to validate required values, preserve API field mappings, clear corrected fields, and hold form-level errors.
- `InlineFormError` from `@/components/erp/forms/form-errors` directly below each input.
- `FormErrorSummary` for errors that do not belong to one field.
- `apiErrorFromResponse()` for failed `fetch` responses. It returns an `ApiFormError` without losing backend field names.

Each input with an error must set `aria-invalid` and connect its message using `aria-describedby`. Clear only that field's error in its change handler so unrelated errors remain visible.

```tsx
const formErrors = useFormErrors();

<form noValidate onSubmit={(event) => {
  event.preventDefault();
  if (!formErrors.validateRequired({
    name: { value: form.name, label: 'Name' },
  })) return;
  saveRecord().catch(formErrors.apply);
}}>
  <FormErrorSummary errors={formErrors.errors} />
  <Input
    name="name"
    aria-invalid={!!formErrors.errors.fields.name}
    aria-describedby={formErrors.errors.fields.name ? 'name-error' : undefined}
    value={form.name}
    onChange={(event) => {
      setForm({ ...form, name: event.target.value });
      formErrors.clearField('name');
    }}
  />
  <InlineFormError id="name-error" messages={formErrors.errors.fields.name} />
</form>
```

Backend validation keys and frontend field `name` values should match. This lets the same pattern work consistently in all feature modules without page-specific error parsing.

## 5. Standard Workflow Connection Requirements

A listing or form is not complete if it is isolated.

Every module screen should show:

1. what created this record
2. what the current status means
3. what the next allowed action is
4. where the record goes next in the ERP
5. what related document or module it connects to

Examples:

- CRM opportunity -> estimate -> sales order -> fulfillment -> invoice
- requisition -> approval -> purchase order -> goods receipt -> supplier bill -> payment
- stock item -> receipt -> reservation -> dispatch -> valuation -> invoicing
- weighbridge transaction -> approval -> payment or debt -> invoice -> reporting

## 6. Gap Review Against Sample Pages

The following comparison was reviewed from the current code.

### 6.1 CRM Companies

Source:

- [artifacts/erp-ui/src/pages/crm/companies.tsx](/home/mike/DEVELOPMENT/SIAKORA%20LABS/SL-ERP/artifacts/erp-ui/src/pages/crm/companies.tsx)

Strengths:

- search
- type filter
- create dialog
- row counts for contacts and open deals
- status-style type badges

Gaps versus benchmark:

- no pagination
- no export
- no date filter
- no bulk actions
- no column control
- no true account drill-down workspace yet
- row link points to a route that is not yet a full managed workspace

Verdict:

- good starter listing
- not yet ERP-grade

### 6.2 Sales Products

Source:

- [artifacts/erp-ui/src/pages/sales/products.tsx](/home/mike/DEVELOPMENT/SIAKORA%20LABS/SL-ERP/artifacts/erp-ui/src/pages/sales/products.tsx)

Strengths:

- search
- type filter
- active/inactive filter
- pagination
- page-size selection
- create/edit/delete
- top summary cards

Gaps versus benchmark:

- no export
- no column control
- no bulk actions
- no workflow next-step cues
- no drill-in workspace
- no shared inventory/procurement/sales dependency indicator per row

Verdict:

- stronger than CRM Companies
- still more CRUD-oriented than workflow-oriented

### 6.3 Procurement Requisitions

Source:

- [artifacts/erp-ui/src/pages/procurement/requisitions.tsx](/home/mike/DEVELOPMENT/SIAKORA%20LABS/SL-ERP/artifacts/erp-ui/src/pages/procurement/requisitions.tsx)

Strengths:

- workflow framing already exists
- KPI cards
- create dialog
- status and budget state awareness
- approval and convert-to-order actions

Gaps versus benchmark:

- no search
- no pagination
- no export
- no date filters
- no bulk actions
- no column controls
- line-item form is still simplified
- no row workspace/drawer for in-place progression

Verdict:

- strong workflow direction
- weaker listing ergonomics than Weighbridge

### 6.4 Inventory Stock

Source:

- [artifacts/erp-ui/src/pages/inventory/stock.tsx](/home/mike/DEVELOPMENT/SIAKORA%20LABS/SL-ERP/artifacts/erp-ui/src/pages/inventory/stock.tsx)

Strengths:

- ties directly to shared product master
- has role explanation and downstream links
- clear conceptual bridge to Inventory module

Gaps versus benchmark:

- no search
- no pagination
- no export
- no create/edit actions in-page
- no drill-in
- no warehouse-aware context
- no stock metrics yet
- no inventory movement actions

Verdict:

- currently a catalog-readiness view, not a finished stock workspace

## 7. The Platform Standard We Should Adopt

### Listing classes

We should classify listings into three categories.

#### Class A: Operational high-volume listings

Examples:

- Weighbridge transactions
- Sales orders
- Invoices
- Requisitions
- Goods receipts
- Inventory movements

Required:

- full benchmark feature set

#### Class B: Master-data listings

Examples:

- customers
- companies
- products
- suppliers
- warehouses

Required:

- search
- filters
- pagination
- create/edit
- drill-in workspace
- export where useful

May omit:

- bulk workflow actions unless operationally justified

#### Class C: Readiness or setup listings

Examples:

- approval rules
- posting rules
- item-readiness views
- module mappings

Required:

- search where volume justifies it
- create/edit
- clear relationship indicators

May omit:

- bulk actions
- workflow batch controls

## 8. Form Standard We Should Adopt

### Form types

#### Document forms

Examples:

- requisition
- estimate
- sales order
- invoice
- goods receipt

Standard:

- header fields
- line items
- draft/submitted status
- approval or posting context
- next-step action panel

#### Master-data forms

Examples:

- company
- customer
- supplier
- product

Standard:

- concise field grouping
- inline related entity linking
- notes/history area
- central workflow references where applicable

## 9. Central Workflow Standard

To avoid isolated screens, each Class A and most Class B pages should include one of these:

1. row-level next-step action
2. workflow panel
3. detail drawer or side sheet
4. related document references
5. status progression indicator

The CRM opportunities page is now moving in this direction with the side workspace pattern.

That pattern should spread to:

- requisitions
- sales orders
- product master
- customer/account master
- inventory items

## 10. Recommended Next Implementation Order

### First priority

Bring these pages up to benchmark level:

1. procurement requisitions
2. sales orders
3. finance receivables / invoices
4. inventory movements

### Second priority

Upgrade these master-data pages:

1. CRM companies
2. sales products
3. procurement vendors
4. inventory stock

### Third priority

Create shared reusable UI standards:

1. standard ERP listing toolbar
2. standard ERP pagination footer
3. standard ERP status badge map
4. standard column picker pattern
5. standard row workspace sheet pattern

## 11. Bottom-Line Rule

The Weighbridge transaction log should be treated as the current benchmark for:

- listing density
- filtering depth
- operational controls
- workflow-aware actions

But not every page needs every feature.

The correct principle is:

- every page must meet the standard for its class
- every page must connect to the central workflow
- every page must avoid becoming isolated CRUD

That is how the platform becomes a real ERP instead of a collection of forms.
