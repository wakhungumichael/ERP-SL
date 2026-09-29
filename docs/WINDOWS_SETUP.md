# Windows Development Setup

The supported Windows path is WSL 2 with Ubuntu. It keeps the same Bash,
Python, pnpm, Docker, migration, and deployment commands used on Linux.

## 1. Install prerequisites

Open PowerShell as Administrator:

```powershell
wsl --install -d Ubuntu
```

Install Git for Windows and Docker Desktop. In Docker Desktop, enable the WSL 2
engine and Ubuntu integration, then restart the terminal.

## 2. Clone inside WSL

Open Ubuntu/WSL and keep the repository in the Linux filesystem for better
Docker and Node performance:

```bash
sudo apt update
sudo apt install -y git curl build-essential python3 python3-venv python3-pip
git clone https://github.com/wakhungumichael/ERP-SL.git ~/sl-erp
cd ~/sl-erp
```

## 3. Start a Docker development instance

```bash
cp .env.production.docker.example .env.production
```

Set local-only values in `.env.production`. Use a URL-safe database password
containing letters, numbers, `_`, or `-`, and set:

```env
DEBUG=True
ERP_FRONTEND_URL=http://localhost
ALLOWED_HOSTS=localhost,127.0.0.1
CSRF_TRUSTED_ORIGINS=http://localhost
CORS_ALLOWED_ORIGINS=http://localhost
SESSION_COOKIE_SECURE=False
CSRF_COOKIE_SECURE=False
HTTP_PORT=80
```

Build, start, and apply migrations:

```bash
bash scripts/deploy-docker.sh
```

Open `http://localhost`. The deployment script runs `migrate`, `seed_platform`,
and `bootstrap_saas_owner` after the containers become ready.

## 4. Run migrations manually

```bash
docker compose --env-file .env.production -f docker-compose.production.yml \
  exec backend sh -c "cd /app/backend && python manage.py migrate"
```

Check that model changes have committed migrations:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml \
  exec backend sh -c "cd /app/backend && python manage.py makemigrations --check --dry-run"
```

## 5. Transfer an existing database

On the source Docker server:

```bash
bash scripts/backup-docker.sh
```

Copy the generated `.dump` and `.sha256` files from `backups/docker/` to the
new machine. Start the new stack once, then restore:

```bash
CONFIRM_RESTORE=YES bash scripts/restore-docker.sh backups/docker/sl_erp_DATE_TIME.dump
```

Database dumps and `.env.production` are ignored by Git and must never be
committed.
