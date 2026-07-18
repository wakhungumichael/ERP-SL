---
name: CRM Module
description: Architecture decisions and patterns for the SL_CRM Django app and frontend CRM module
---

## Django App: SL_CRM

- Installed as `SL_CRM` in `INSTALLED_APPS` (settings.py)
- Models: `Organisation`, `Contact`, `Supplier`, `Lead`, `Activity`
- All models carry a `tenant` FK to `Platform_Core.Tenant` (nullable, for future tenant isolation)
- `Organisation` has an optional OneToOne link to `SL_Weighbridge.Customer` via `weighbridge_customer` for backward compat
- API namespace: `/api/crm/`
- Module path: `Platform_API/modules/crm/`
- Migrations: `SL_CRM/migrations/0001_initial.py`

## API Endpoints (plain-English URL names)
- `/api/crm/companies/`     → Organisation CRUD
- `/api/crm/people/`        → Contact CRUD
- `/api/crm/suppliers/`     → Supplier CRUD
- `/api/crm/opportunities/` → Lead CRUD + `pipeline-summary/` action
- `/api/crm/follow-ups/`    → Activity CRUD (auto-sets `created_by=request.user`)
- `/api/crm/dashboard/`     → Aggregated summary view

## UI Language Convention (plain English, no jargon)
- "Companies" not "Organisations/Accounts"
- "People" not "Contacts"
- "Opportunities" not "Leads/Pipeline"
- "Suppliers" stays "Suppliers"
- "Follow-ups" not "Activities"
- "Deal Stage" not "Pipeline Stage"
- Payment terms: "Pay on Receipt", "Net 30 Days" etc. (not codes)

## Frontend
- Web pages: `src/pages/crm/{dashboard,companies,people,suppliers,opportunities,follow-ups}.tsx`
- Nav section: "Relationships" (key: `crm`) in `lib/roles.ts`, visible to ALL_ROLES
- Mobile screen: `artifacts/mobile/app/crm/index.tsx` — tabbed (Companies/People/Suppliers/Deals)
- Routes added to `App.tsx` under `/crm/*`

**Why:** User specified plain English labels for non-technical users and strong mobile parity.
**How to apply:** Every future module should follow this naming discipline — use business language in URLs, labels, and error messages. Never expose Django model names, field names, or technical terms directly in UI.
