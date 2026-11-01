# SL-ERP

SL-ERP is a multi-module ERP and SaaS platform built with Django, Django REST Framework, React, and Vite.

## Main Components

- `backend/`: Django apps, REST APIs, templates, and migrations
- `artifacts/erp-ui/`: React/Vite frontend
- `lib/`: shared TypeScript libraries and generated API clients
- `docs/`: local setup and deployment documentation
- `scripts/`: operational helpers such as PostgreSQL backup and restore

## Key Documents

- Local development: [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md)
- Windows/WSL development: [docs/WINDOWS_SETUP.md](docs/WINDOWS_SETUP.md)
- Complete Docker operations: [docs/COMPLETE_DOCKER_OPERATIONS.md](docs/COMPLETE_DOCKER_OPERATIONS.md)
- Ubuntu deployment: [docs/UBUNTU_DEPLOYMENT.md](docs/UBUNTU_DEPLOYMENT.md)
- Production update flow: [docs/PRODUCTION_RUNBOOK.md](docs/PRODUCTION_RUNBOOK.md)

- Installed app branding: [docs/PWA_BRANDING.md](docs/PWA_BRANDING.md)
- Projects and tasks: [docs/PROJECT_TASK_WORKSPACE.md](docs/PROJECT_TASK_WORKSPACE.md)
- Ticket forms and website embeds: [docs/TICKETING_FORMS.md](docs/TICKETING_FORMS.md)
- Shared organization structure: [docs/ORGANIZATION_STRUCTURE.md](docs/ORGANIZATION_STRUCTURE.md)

## Deployment Modes

- Bare-metal Ubuntu with systemd and Nginx
- Docker Compose with Postgres, Redis, Gunicorn, Celery, and Nginx
- GitHub Actions automation for CI and remote deploy

## Start development

After the first-time setup below, start both servers from the project root.

In Windows PowerShell (including a VS Code terminal opened on the WSL folder):

```powershell
.\start
```

In Ubuntu/WSL:

```bash
./start.sh
# Or, with pnpm available:
pnpm start
```

The Windows launcher enters the repository's WSL distribution automatically.
The shared launcher loads nvm when needed, checks the configured database and
applied migrations, and starts Django and Vite in one terminal.

- ERP: http://localhost:5173
- Django admin: http://localhost:8080/admin/
- Health check: http://localhost:8080/api/healthz

Keep the terminal open. Press **Ctrl+C** to stop the servers started by that
command. Servers that are already running are reused and left running. An
unrecognized service occupying either port produces an error instead.

In VS Code, **Tasks: Run Task > SL-ERP: start** uses the same launcher in both
Windows and WSL windows. For Python breakpoints, reopen the folder using
**WSL: Reopen Folder in WSL**, select **Full stack dev**, and press **F5**.
Stop existing development servers before starting the debug configuration.

The local database must already be running. If the launcher reports pending
migrations, apply them from the WSL project root and start again:

```bash
.venv/bin/python backend/manage.py migrate
```

To choose different ports in WSL:

```bash
./start.sh --backend-port 8081 --frontend-port 5174
```

Keep development changes on a feature branch and run the staging checklist
before releasing. The bare-metal GitHub Actions workflow also deploys on pushes
to `main`; confirm the intended production deployment method before merging.
See [the production runbook](docs/PRODUCTION_RUNBOOK.md) for server updates.

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
