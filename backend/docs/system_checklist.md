# System Checklist

This checklist is the working guide for finishing backend wiring, UI integration, and full-system testing without missing major pieces.

Current phase on July 16, 2026: `API and workspace alignment`

## Progress Snapshot

- [x] Platform foundation and module-based API boundary established
- [x] Commercial weighbridge, payments, and accounting starter APIs aligned
- [x] Django workspace and system console exposed for tenant-aware inspection
- [x] Vite frontend scaffold created for the next UI phase
- [x] Vite console supports transaction creation, workflow guidance, and finance actions
- [ ] Frontend build validated under Node 18+ or 20+
- [ ] End-to-end tenant, weighbridge, invoice, payment, and accounting flow verified

## Backend API Checklist

- [x] Platform core models created
- [x] Tenant ownership added to company and branch
- [x] Tenant ownership added to customer, vehicle, transaction, invoice, payment method, and payment
- [x] Indicator integration bootstrap command added
- [x] Primary API moved to `/api/...`
- [x] Legacy API compatibility package retired
- [x] Modular API namespaces created:
  - `platform`
  - `payments`
  - `accounting`
  - `commercial-weighbridge`
- [x] Tenant-aware query filtering added with `tenant_id` and `tenant_code`
- [x] Platform CRUD/list endpoints exposed
- [x] Payment list/detail endpoints exposed
- [x] Commercial weighbridge list/detail endpoints exposed
- [x] Commercial item and vehicle-type lookup endpoints exposed
- [x] Commercial live-weight endpoint exposed
- [x] Commercial capture-weight action exposed
- [x] Invoice issue action exposed
- [x] Invoice receive-payment action exposed
- [x] Payment confirm action exposed
- [x] Gateway payment initiation and callback simulation endpoints exposed
- [x] Commercial weighbridge dashboard summary API
- [x] Report APIs for transactions, invoices, vehicle presence, and discrepancies
- [x] Authentication and permission layer for module APIs
- [x] Role-aware workspace navigation API and user/role catalog endpoints
- [x] Tenant-aware payment gateway integration through `IntegrationEndpoint`
- [x] Tenant-aware accounting posting rules
- [x] Validation cleanup for transaction creation and action endpoints
- [x] API error response standardization
- [x] Pagination, filtering, and ordering standardization across module endpoints

## Remaining Backend Wiring

- [ ] Add explicit health/test actions for indicator endpoints beyond snapshot reads
- [ ] Add invoice PDF/document endpoints into the module API surface
- [ ] Expand payment provider execution flow beyond initiation/callback simulation
- [ ] Add quotation and broader accounting domain expansion
- [ ] Add audit/event trail endpoints for platform and transactional actions
- [ ] Add tenant-scoped export workflow for customer-owned data
- [ ] Add tenant offboarding state machine with retention window and approval flow
- [ ] Add coordinated tenant purge service for row data and stored files


## UI Checklist

- [x] Choose the first frontend surface:
  - Django admin enhancement
  - separate TypeScript app
- [x] Build first tenant context selector in Django workspace
- [~] Finalize frontend login and tenant context selector
- [~] Build workflow-aware transaction creation surface
- [ ] Build platform settings screens:
  - tenants
  - modules
  - plans
  - subscriptions
  - integrations
- [ ] Build commercial weighbridge screens:
  - branches
  - customers
  - vehicles
  - transactions
  - live weight view
  - capture weight action
- [ ] Build payments screens:
  - payment methods
  - invoices
  - receive payment
  - confirm payment
- [~] Build action-driven Vite operations console for weighbridge and finance
- [x] Build accounting starter dashboard
- [~] Connect Vite workspace cards to tested frontend build/runtime
- [~] Move Vite UI from developer console toward a role-based workspace shell

## End-to-End Test Checklist

- [ ] Create or verify a tenant
- [ ] Verify indicator integration exists for that tenant
- [ ] Verify branch belongs to the tenant
- [ ] Create or verify customer and vehicle under the tenant
- [ ] Create first-weight transaction from API/UI
- [ ] Create second-weight transaction from API/UI using workflow context
- [ ] Verify live-weight endpoint returns data
- [ ] Capture stable weight onto a transaction
- [ ] Create or verify invoice from transaction data
- [ ] Issue invoice
- [ ] Receive payment
- [ ] Initiate gateway payment
- [ ] Simulate gateway callback
- [ ] Confirm payment
- [ ] Verify invoice status changes correctly
- [ ] Verify tenant-scoped filtering works for:
  - transactions
  - invoices
  - payments
  - integrations
- [ ] Verify admin workflow still works alongside new APIs
- [ ] Verify system workspace and Vite workspace show the same tenant-scoped truth

## Deployment Checklist

- [ ] Run `python manage.py check`
- [ ] Run migrations
- [ ] Bootstrap indicator integrations if needed
- [ ] Collect static files
- [ ] Restart app services
- [ ] Smoke-test `/api/`, `/api/platform/`, `/api/payments/`, `/api/commercial-weighbridge/`
- [ ] Smoke-test live weight and admin add-transaction flow
- [ ] Smoke-test `/api/system/checklist/` and `/api/system/workspace/`
