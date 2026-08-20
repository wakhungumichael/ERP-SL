# SL-ERP

SL-ERP is a multi-module ERP and SaaS platform built with Django, Django REST Framework, React, and Vite.

## Main Components

- `backend/`: Django apps, REST APIs, templates, and migrations
- `artifacts/erp-ui/`: React/Vite frontend
- `lib/`: shared TypeScript libraries and generated API clients
- `docs/`: local setup and deployment documentation
- `scripts/`: operational helpers such as PostgreSQL backup and restore

## Key Documents

- Local development: [docs/LOCAL_SETUP.md](/home/mike/DEVELOPMENT/SIAKORA%20LABS/SL-ERP/docs/LOCAL_SETUP.md)
- Ubuntu deployment: [docs/UBUNTU_DEPLOYMENT.md](/home/mike/DEVELOPMENT/SIAKORA%20LABS/SL-ERP/docs/UBUNTU_DEPLOYMENT.md)
- Production update flow: [docs/PRODUCTION_RUNBOOK.md](/home/mike/DEVELOPMENT/SIAKORA%20LABS/SL-ERP/docs/PRODUCTION_RUNBOOK.md)

## Deployment Modes

- Bare-metal Ubuntu with systemd and Nginx
- Docker Compose with Postgres, Redis, Gunicorn, Celery, and Nginx
- GitHub Actions automation for CI and remote deploy

## Quick Start

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install uv
uv sync
pnpm install
```

Backend:

```bash
cd backend
cp .env.example .env
python manage.py migrate
python manage.py seed_platform
python manage.py runserver 0.0.0.0:8080
```

Frontend:

```bash
cd artifacts/erp-ui
cp .env.example .env
pnpm dev
```

## Staging Checklist

Before uploading or deploying a branch to a staging Ubuntu server, verify:

```bash
source .venv/bin/activate
cd backend
python manage.py check
python manage.py makemigrations --check --dry-run
python manage.py test --settings=SL_ERP.settings_sqlite_tests

cd ..
pnpm run typecheck
pnpm --filter @workspace/erp-ui run build
```

## Deployment Notes

- Use PostgreSQL for staging and production.
- Keep `DEBUG=False` on the server.
- Never upload local `.env`, SQLite databases, backup dumps, or generated media unintentionally.
- Use Gunicorn behind Nginx on Ubuntu.
- Docker deployment is available through `docker-compose.production.yml`.
