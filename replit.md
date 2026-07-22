# SL-ERP

A full-stack Enterprise Resource Planning (ERP) application covering Weighbridge operations, CRM, HR, Sales, Procurement, and Accounting.

## Run & Operate

### Starting the app
Two workflows in the Workflows panel (both auto-start):
- **`artifacts/api-server: API Server`** — Django dev server on port 8080; runs migrations on start
- **`artifacts/erp-ui: web`** — React + Vite dev server; shows in the preview pane at `/`

### Full documentation
→ **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — two-layer API pattern, what "artifacts" means, all modules, how to add new ones.
→ **[docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md)** — VS Code / local machine setup: Python/Node prereqs, `.env` config, running Django + Vite locally.

### Useful shell commands
- `cd backend && DJANGO_SETTINGS_MODULE=SL_ERP.settings python manage.py migrate` — run migrations manually
- `cd backend && DJANGO_SETTINGS_MODULE=SL_ERP.settings python manage.py createsuperuser` — create an admin user
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec

### Required env (runtime-managed by Replit)
- `DATABASE_URL` — Postgres connection string (auto-provided)

### Optional env
- `REDIS_URL` — needed for Celery background tasks (not required to run the app in dev)

## Stack

- **Backend**: Python 3.11, Django 5.2, Django REST Framework, PostgreSQL, Celery, Redis
- **Frontend**: React 19, Vite, TypeScript 5.9, TanStack Query, Wouter, Radix UI / Shadcn UI, Tailwind CSS
- **Node service**: Express 5, Drizzle ORM (auxiliary API server — `artifacts/api-server/`)
- **Mobile**: Expo / React Native (`artifacts/mobile/`)
- **Monorepo**: pnpm workspaces, `uv` for Python deps

## Where things live

| Area | Path |
|---|---|
| Django project root | `backend/` |
| Django settings | `backend/SL_ERP/settings.py` |
| Django apps | `backend/SL_*/` and `backend/Platform_*/` |
| React frontend | `artifacts/erp-ui/src/` |
| Node API server | `artifacts/api-server/src/` |
| Mobile app | `artifacts/mobile/` |
| Shared DB schema (Drizzle) | `lib/db/` |
| OpenAPI spec | `lib/api-spec/openapi.yaml` |
| Generated API hooks | `lib/api-client-react/` |

## Django apps

| App | URL namespace | Purpose |
|---|---|---|
| `Platform_Core` | — | Tenants, users, workspace navigation |
| `Platform_API` | `/api/` | API framework, mixins, integration health |
| `SL_Weighbridge` | `/api/weighbridge/` | Weighbridge transactions, invoices, cameras |
| `SL_CRM` | `/api/crm/` | CRM contacts, leads, activities |
| `SL_HR` | `/api/hr/` | HR employees, leave, payroll |
| `SL_Sales` | `/api/sales/` | Sales orders, estimates |
| `SL_Procurement` | `/api/procurement/` | Purchase orders, bills |

## Architecture decisions

- Django is the primary API; the Node `api-server` is an auxiliary service.
- `weasyprint` (PDF generation) is wrapped in try/except — Cairo/Pango aren't available on Replit; PDF endpoints will raise RuntimeError if called.
- `pyserial` (weighbridge indicator serial comms) is installed but serial ports don't exist in the Replit environment; those runtime paths fail gracefully.
- Role-based access control lives in `artifacts/erp-ui/src/lib/roles.ts`; roles are detected from Django User groups after login.
- The Vite config requires both `PORT` and `BASE_PATH` env vars at startup.

## Gotchas

- Always export `DJANGO_SETTINGS_MODULE=SL_ERP.settings` before any `manage.py` call.
- The Django workflow CWD is the workspace root — run commands use `cd backend && ...`.
- Do not remove the try/except around `weasyprint` in `SL_Weighbridge/utils.py` — it causes Django admin autodiscovery to crash.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
- See `.agents/memory/` for non-obvious decisions and environment quirks.
