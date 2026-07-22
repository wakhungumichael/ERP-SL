# Local Development Setup (VS Code)

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

# Python dependencies (installs into .pythonlibs/ or a local venv)
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
DATABASE_URL=postgresql://slabs:slabs321@localhost:5432/sl_erp
```

**Quick start with SQLite** (no Postgres needed):
```env
DATABASE_URL=sqlite:///db.sqlite3
```

**PostgreSQL setup** (if you prefer):
```bash
createuser -P slabs          # password: slabs321
createdb -O slabs sl_erp
```

---

## 3. Run migrations and create a superuser

```bash
cd backend
export DJANGO_SETTINGS_MODULE=SL_ERP.settings

python manage.py migrate
python manage.py createsuperuser
```

---

## 4. Start the backend

```bash
cd backend
export DJANGO_SETTINGS_MODULE=SL_ERP.settings
python manage.py runserver 0.0.0.0:8080
```

Django is now at `http://localhost:8080`.
Django admin is at `http://localhost:8080/admin/`.

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
cd backend && export DJANGO_SETTINGS_MODULE=SL_ERP.settings

python manage.py migrate                          # apply all migrations
python manage.py makemigrations <AppName>         # generate new migration
python manage.py createsuperuser                  # create an admin login
python manage.py shell                            # Django interactive shell
python manage.py test                             # run test suite
python manage.py collectstatic                    # gather static files
```

---

## Running tests

```bash
# Django tests
cd backend
export DJANGO_SETTINGS_MODULE=SL_ERP.settings
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
| `DB_USER` | No* | `slabs` | Used when `DATABASE_URL` not set |
| `DB_PASSWORD` | No* | `slabs321` | Used when `DATABASE_URL` not set |
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

## Project structure reminder

```
sl-erp/
├── backend/              ← Django (run from here)
│   ├── .env.example      ← copy to .env
│   └── manage.py
├── artifacts/
│   ├── erp-ui/           ← React web app (run from here)
│   │   └── .env.example  ← copy to .env
│   └── mobile/           ← Expo mobile app
└── docs/
    ├── ARCHITECTURE.md   ← full structure + module guide
    └── LOCAL_SETUP.md    ← this file
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full module map and how to add new features.
