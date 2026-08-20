# Local Development Setup (VS Code / Linux)

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Python | 3.11+ | Use `pyenv` or the system Python |
| `uv` | latest | Fast Python package manager — `pip install uv` |
| Node.js | 20+ | Use `nvm` or install from nodejs.org |
| pnpm | 9+ | `npm install -g pnpm` |
| PostgreSQL | 14+ | Or use SQLite for quick local dev (see below) |
| Redis | 7+ | Optional — only needed for Celery background tasks |

---

## 1. Clone and install

```bash
git clone <repo-url>
cd sl-erp

# Create and activate the repo-root virtualenv first
python3 -m venv .venv
source .venv/bin/activate
pip install uv
uv sync

# JavaScript dependencies
pnpm install
```

---

## 2. Configure the backend

```bash
cd backend
cp .env.example .env
```

Edit `.env`. The minimum you need:

```env
SECRET_KEY=any-random-string-here
DEBUG=True
DATABASE_URL=postgresql://sl_erp_user:change-me@localhost:5432/sl_erp
```

**Quick start with SQLite** (no Postgres needed):
```env
DATABASE_URL=sqlite:///db.sqlite3
```

**PostgreSQL setup** (if you prefer):
```bash
createuser -P sl_erp_user
createdb -O sl_erp_user sl_erp
```

---

## 3. Run migrations and seed platform data

```bash
cd backend
source ../.venv/bin/activate
export DJANGO_SETTINGS_MODULE=SL_ERP.settings

python manage.py migrate
python manage.py seed_platform
```

If you want the default SaaS owner workspace for **Siakora Labs Limited**, run:

```bash
python manage.py bootstrap_saas_owner --default-password 'ChangeMeNow!123'
```

This creates:
- platform seed data: modules and plans
- owner tenant: `Siakora Labs Limited`
- branch: `Head Office`
- default groups: `Tenant Admin`, `Finance`, `Operator`
- owner accounts for platform superadmin and tenant staff

If you prefer to create a superuser manually instead:

```bash
python manage.py createsuperuser
```

---

## 4. Start the backend

```bash
cd backend
source ../.venv/bin/activate
python manage.py runserver 0.0.0.0:8080
```

Django is now at `http://localhost:8080`.
Django admin is at `http://localhost:8080/admin/`.

If you are already inside `backend/`, do not use `source .venv/bin/activate` because the virtualenv lives at the repository root. Use:

```bash
source ../.venv/bin/activate
```

If port `8080` is already in use on your machine, start Django on another port instead:

```bash
python manage.py runserver 127.0.0.1:8000
```

If you do that, also update the frontend proxy target in `artifacts/erp-ui/.env`:

```env
VITE_API_BASE_URL=http://localhost:8000
```

---

## 5. Back up and restore PostgreSQL

From the repo root:

```bash
./scripts/backup-postgres.sh
```

That writes a timestamped dump into `backups/` using the `DATABASE_URL` from `backend/.env`.

To restore a backup:

```bash
./scripts/restore-postgres.sh backups/sl_erp_YYYY-MM-DD_HHMMSS.dump
```

If you want to target a different `.env` file, set `ENV_FILE` first:

```bash
ENV_FILE=/path/to/custom.env ./scripts/backup-postgres.sh
```

---

## 5. Configure the frontend

```bash
cd artifacts/erp-ui
cp .env.example .env
```

The defaults work out of the box for local dev (`PORT=5173`, `BASE_PATH=/`). Vite automatically proxies `/api/*` requests to `http://localhost:8080` (Django).

---

## 6. Start the frontend

```bash
cd artifacts/erp-ui
pnpm dev
```

The app is now at `http://localhost:5173`.

---

## 7. (Optional) Mobile app

```bash
cd artifacts/mobile
pnpm dev
# Follow Expo instructions to open on a device or emulator
```

---

## Useful backend commands

```bash
cd backend

python manage.py migrate                          # apply all migrations
python manage.py makemigrations <AppName>         # generate new migration
python manage.py seed_platform                    # seed plans and modules
python manage.py bootstrap_saas_owner             # bootstrap Siakora Labs owner accounts
python manage.py createsuperuser                  # create an admin login
python manage.py shell                            # Django interactive shell
python manage.py test                             # run test suite
python manage.py collectstatic                    # gather static files
python manage.py sync_all_subscription_modules    # backfill module activations
```

---

## Running tests

```bash
# Django tests
cd backend
source ../.venv/bin/activate
python manage.py test

# Frontend typecheck
pnpm run typecheck

# Regenerate API client from OpenAPI spec
pnpm --filter @workspace/api-spec run codegen
```

---

## Environment variables reference

### Backend (`backend/.env`)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `SECRET_KEY` | Yes | *(insecure default)* | Any long random string |
| `DEBUG` | No | `True` | Set `False` in production |
| `DATABASE_URL` | No* | — | Full DB URL; takes priority over individual fields |
| `DB_ENGINE` | No* | `postgresql` | Used when `DATABASE_URL` not set |
| `DB_NAME` | No* | `sl_erp` | Used when `DATABASE_URL` not set |
| `DB_USER` | No* | `sl_erp_user` | Used when `DATABASE_URL` not set |
| `DB_PASSWORD` | No* | `change-me` | Used when `DATABASE_URL` not set |
| `DB_HOST` | No* | `localhost` | Used when `DATABASE_URL` not set |
| `DB_PORT` | No* | `5432` | Used when `DATABASE_URL` not set |
| `CELERY_BROKER_URL` | No | `redis://localhost:6379/0` | Celery won't run without Redis |
| `CSRF_TRUSTED_ORIGINS` | No | localhost + replit.dev | Comma-separated list |

### Frontend (`artifacts/erp-ui/.env`)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `PORT` | No | `5173` | Vite dev server port |
| `BASE_PATH` | No | `/` | Only change if serving at a sub-path |
| `VITE_API_BASE_URL` | No | `http://localhost:8080` | Django backend URL for proxy target |

---

## Known limitations (any environment)

| Feature | Status | Notes |
|---|---|---|
| PDF generation (WeasyPrint) | ❌ | Requires Cairo/Pango system libs |
| Serial port (weighbridge indicator) | ❌ | Requires physical serial hardware |
| Celery background tasks | ❌ (without Redis) | Start Redis first, then `celery -A SL_ERP.celery_app worker` |
| Email sending | ❌ (dev) | Prints to console by default |

---

## Staging Safety Notes

- Do not upload local `.env` files directly to staging or production.
- Do not deploy `db.sqlite3` from development.
- Prefer `backend/.env.production.example` and `artifacts/erp-ui/.env.production.example` when preparing an Ubuntu server.

---

## Project structure reminder

```
sl-erp/
├── .venv/                ← local Python environment
├── backend/              ← Django (run from here)
│   ├── .env.example      ← copy to .env
│   └── manage.py
├── artifacts/
│   ├── erp-ui/           ← React web app (run from here)
│   │   └── .env.example  ← copy to .env
│   └── mobile/           ← Expo mobile app
└── docs/
    ├── ARCHITECTURE.md   ← full structure + module guide
    ├── PRODUCTION_RUNBOOK.md ← backend/frontend production startup
    ├── SAAS_BOOTSTRAP.md ← owner-account and new-environment bootstrap
    └── LOCAL_SETUP.md    ← this file
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full module map, [SAAS_BOOTSTRAP.md](SAAS_BOOTSTRAP.md) for owner-account setup, and [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md) for production startup.
