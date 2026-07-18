---
name: HR and Procurement modules
description: New SL_HR and SL_Procurement Django apps and their Platform_API modules; routing, models, and frontend pages.
---

## Django apps added
- `backend/SL_HR/` — PayPeriod, PayRecord models (migrations in SL_HR/migrations/0001_initial.py)
- `backend/SL_Procurement/` — PurchaseOrder, PurchaseOrderItem models (migrations in SL_Procurement/migrations/0001_initial.py)
- Both registered in INSTALLED_APPS in settings.py

## API modules
- `backend/Platform_API/modules/hr/` — views: HRDashboardView, PayPeriodList/Detail, PayRecordList/Detail
- `backend/Platform_API/modules/procurement/` — views: ProcurementDashboardView, POList/Detail/StatusView
- URLs: /api/hr/ and /api/procurement/ registered in SL_ERP/urls.py

## Frontend pages (fully functional)
- HR: `artifacts/erp-ui/src/pages/hr/staff.tsx` — tabbed: Staff Directory + Payroll (pay period list, drill-down to records, edit pay, mark Processing/Completed)
- Procurement: `artifacts/erp-ui/src/pages/procurement/purchase-orders.tsx` — PO list, create PO with line items, status transitions (Draft→Submitted→Approved→Received)

## Email receipt (backend)
- TransactionEmailReceiptView at /api/commercial-weighbridge/transactions/<pk>/email-receipt/
- Django email configured via env vars (EMAIL_BACKEND, EMAIL_HOST, etc.) — defaults to console backend for dev
- customer_email added to TransactionSerializer so the receipt dialog can pre-fill

**Why:** Payroll and procurement were stub-only pages; now they have real backend models, migrations, and full CRUD APIs.

**How to apply:** When adding new ERP modules, follow the same pattern: SL_<AppName> Django app with models + migrations, Platform_API/modules/<name>/ with views/urls, register in settings.py INSTALLED_APPS and SL_ERP/urls.py.
