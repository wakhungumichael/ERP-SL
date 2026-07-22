# SL-ERP Architecture Guide

## How the project is laid out

```
workspace/
├── backend/              ← Django project (Python) — PRIMARY backend
│   ├── SL_ERP/           ← Django settings, root URL routing
│   ├── Platform_Core/    ← Tenants, users, branches, auth models
│   ├── Platform_API/     ← REST API layer (views + URL routes)
│   │   └── modules/
│   │       ├── crm/          /api/crm/
│   │       ├── hr/           /api/hr/
│   │       ├── sales/        /api/sales/
│   │       ├── payments/     /api/payments/
│   │       ├── accounting/   /api/accounting/
│   │       ├── procurement/  /api/procurement/
│   │       ├── purchases/    /api/purchases/
│   │       ├── weighbridge/  /api/commercial-weighbridge/
│   │       └── platform/     /api/platform/
│   ├── SL_CRM/           ← CRM database models + migrations
│   ├── SL_HR/            ← HR database models + migrations
│   ├── SL_Sales/         ← Sales database models + migrations
│   ├── SL_Weighbridge/   ← Weighbridge models, tasks, serial I/O
│   ├── SL_Procurement/   ← Procurement database models + migrations
│   └── manage.py
│
├── artifacts/
│   ├── erp-ui/           ← React + Vite web frontend (what you see in the browser)
│   ├── mobile/           ← Expo / React Native mobile app
│   ├── api-server/       ← Node.js Express auxiliary server (thin wrapper)
│   └── mockup-sandbox/   ← Replit design tooling only — ignore for feature work
│
└── lib/
    ├── api-spec/         ← OpenAPI YAML spec (source of truth for API contract)
    ├── api-client-react/ ← Auto-generated React hooks (from the spec)
    └── api-zod/          ← Auto-generated Zod validation types (from the spec)
```

---

## The two-layer API pattern (SL_* vs Platform_API)

This is the most important thing to understand. Every business domain has **two folders**, not one:

| Layer | Folder | What it does |
|---|---|---|
| **Data layer** | `backend/SL_CRM/` | Defines database tables (`models.py`), tracks schema changes (`migrations/`) |
| **API layer** | `backend/Platform_API/modules/crm/` | Defines HTTP endpoints (`views.py`, `urls.py`) that read/write those tables |

They are not alternatives — they depend on each other:

```python
# Platform_API/modules/crm/views.py imports from SL_CRM
from SL_CRM.models import Organisation, Contact, Lead
```

**When you add a new field:**
1. Add it to the model in `SL_CRM/models.py`
2. Run `manage.py makemigrations SL_CRM`
3. Expose it in `Platform_API/modules/crm/views.py` (serializer + view)

**When you add a new API endpoint:**
- New route only → edit `Platform_API/modules/crm/urls.py` + `views.py`
- New data → also add to `SL_CRM/models.py` + migrate

---

## What "artifacts" means on Replit

Replit uses the word **"artifact"** for each runnable service in the project. It tells the platform what port each service uses and which URL path shows it in the preview pane.

You have four:

| Artifact | What it is | Preview path |
|---|---|---|
| `erp-ui` | React web app (your main UI) | `/` |
| `api-server` | Node.js Express (thin auxiliary) | `/api-server` |
| `mobile` | Expo mobile app | `/mobile` |
| `mockup-sandbox` | Design tooling | (internal) |

**For day-to-day development you only care about two:**
- `erp-ui` — the frontend you develop and the preview shows
- `api-server: API Server` — the Django backend (misleadingly named; it runs `manage.py runserver`)

The "artifact" files live in `artifacts/<name>/.replit-artifact/artifact.toml` — you never need to edit them directly.

---

## How the frontend talks to the backend

The React app (`artifacts/erp-ui/`) calls Django via the `/api/` path:

```
Browser → /api/crm/companies/ → Django (port 8080) → SL_CRM models → PostgreSQL
```

The Vite dev server proxies any request starting with `/api/` to Django at port 8080. This is configured in `artifacts/erp-ui/vite.config.ts`.

**Generated client hooks** live in `lib/api-client-react/` — these are auto-generated from `lib/api-spec/openapi.yaml`. Run `pnpm --filter @workspace/api-spec run codegen` to regenerate them after changing the spec.

---

## Modules at a glance

| Module | Django app | API prefix | What it covers |
|---|---|---|---|
| Platform / Tenants | `Platform_Core` | `/api/platform/` | Tenant provisioning, workspace setup, branches |
| CRM | `SL_CRM` | `/api/crm/` | Companies, contacts, suppliers, leads, follow-ups |
| HR | `SL_HR` | `/api/hr/` | Employees, leave, payroll |
| Sales | `SL_Sales` | `/api/sales/` | Estimates, products/services, recurring invoices |
| Payments | *(in SL_Sales/Weighbridge)* | `/api/payments/` | Payment receipt, debt consolidation, invoicing |
| Accounting | *(in SL_Sales)* | `/api/accounting/` | Accounts, journal entries, trial balance |
| Procurement | `SL_Procurement` | `/api/procurement/` | Purchase orders, vendor management |
| Purchases | *(in SL_Procurement)* | `/api/purchases/` | Bills, vendor invoices |
| Weighbridge | `SL_Weighbridge` | `/api/commercial-weighbridge/` | Weighbridge transactions, vehicle tracking, invoices |

---

## Running the project

### Start everything
1. **Workflows panel** → start `artifacts/api-server: API Server` (Django)
2. **Workflows panel** → start `artifacts/erp-ui: web` (React)
3. The preview pane shows the login screen at `/`

### Useful shell commands

```bash
# Run Django management commands
cd backend && DJANGO_SETTINGS_MODULE=SL_ERP.settings python manage.py <command>

# Common examples
python manage.py migrate                     # apply migrations
python manage.py makemigrations SL_CRM       # create migration for CRM app
python manage.py createsuperuser             # create a login
python manage.py shell                       # Django REPL

# Frontend
pnpm --filter @workspace/erp-ui run dev      # start frontend manually
pnpm --filter @workspace/api-spec run codegen  # regenerate API client from spec
```

### Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Replit auto-provides PostgreSQL |
| `REDIS_URL` | No (dev) | Needed for Celery background tasks |
| `DJANGO_SETTINGS_MODULE` | Yes | Always `SL_ERP.settings` |

---

## Known limitations in the Replit environment

| Feature | Status | Notes |
|---|---|---|
| PDF generation (WeasyPrint) | ❌ | Cairo/Pango not available; wrapped in try/except — won't crash Django |
| Serial port (weighbridge indicator) | ❌ | No physical serial ports; fails gracefully |
| Celery background tasks | ❌ (dev) | Needs `REDIS_URL` — task #4 |
| Email sending | ❌ | Not configured yet |

---

## Adding a new module (step-by-step)

1. **Create Django app**: `cd backend && python manage.py startapp SL_MyModule`
2. **Register it** in `SL_ERP/settings.py` → `INSTALLED_APPS`
3. **Define models** in `SL_MyModule/models.py`
4. **Migrate**: `python manage.py makemigrations SL_MyModule && python manage.py migrate`
5. **Create API folder**: `backend/Platform_API/modules/my_module/` with `__init__.py`, `views.py`, `urls.py`
6. **Wire URL**: add `path("api/my-module/", include("Platform_API.modules.my_module.urls"))` to `SL_ERP/urls.py`
7. **Add to OpenAPI spec**: `lib/api-spec/openapi.yaml` → run codegen
8. **Use in frontend**: import the generated hook from `lib/api-client-react/`
