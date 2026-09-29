# Production Runbook

This runbook covers the standard update and validation flow for an SL-ERP server that is already provisioned.

For first-time Ubuntu setup, use [UBUNTU_DEPLOYMENT.md](/home/mike/DEVELOPMENT/SIAKORA%20LABS/SL-ERP/docs/UBUNTU_DEPLOYMENT.md).

## Expected Layout

```text
/srv/sl-erp/
├── .venv/
├── backend/
├── artifacts/erp-ui/
└── ...
```

## Standard Update Flow

```bash
cd /srv/sl-erp
git pull origin main
source .venv/bin/activate
uv sync
pnpm install --frozen-lockfile

cd backend
python manage.py migrate
python manage.py collectstatic --noinput
python manage.py sync_all_subscription_modules

cd ../artifacts/erp-ui
pnpm build
```

Or use the automation script:

```bash
bash scripts/deploy-baremetal.sh
```

## Service Restart Flow

```bash
sudo systemctl restart sl-erp
sudo systemctl reload nginx
sudo systemctl status sl-erp --no-pager
```

## Post-Deploy Validation

Check:

- `/api/healthz`
- `/api/platform/auth/status/`
- platform admin login
- tenant admin login
- tenant creation
- plan/module visibility
- procurement, payments, and weighbridge screens for a tenant user

## Backup Before Risky Changes

Bare-metal PostgreSQL:

```bash
cd /srv/sl-erp
./scripts/backup-postgres.sh
```

Docker PostgreSQL:

```bash
cd /srv/sl-erp
bash scripts/backup-docker.sh
```

Keep the dump before schema-heavy or tenant-data-sensitive releases.

## Rollback Guidance

If a deploy fails:

1. Revert to the previous known-good commit.
2. Re-run dependency installation.
3. Restart Gunicorn and reload Nginx.
4. Restore the database backup only if the deploy introduced destructive schema or data changes.

## Release Gate

Do not promote a build if any of these commands fail:

```bash
source .venv/bin/activate
cd /srv/sl-erp/backend
python manage.py check
python manage.py makemigrations --check --dry-run
python manage.py test --settings=SL_ERP.settings_sqlite_tests

cd /srv/sl-erp
pnpm run typecheck
pnpm --filter @workspace/erp-ui run build
```

## Docker Operations

For Docker-based production or staging:

```bash
cp .env.production.docker.example .env.production
bash scripts/deploy-docker.sh
```

Docker deployments automatically create a database dump before rebuilding and
running migrations when an existing database container is active.

The Docker stack is defined in [docker-compose.production.yml](/home/mike/DEVELOPMENT/SIAKORA%20LABS/SL-ERP/docker-compose.production.yml:1).

## GitHub Actions Automation

CI runs from [ci.yml](/home/mike/DEVELOPMENT/SIAKORA%20LABS/SL-ERP/.github/workflows/ci.yml:1).

Remote deploy workflows:

- bare metal: [deploy-baremetal.yml](/home/mike/DEVELOPMENT/SIAKORA%20LABS/SL-ERP/.github/workflows/deploy-baremetal.yml:1)
- docker: [deploy-docker.yml](/home/mike/DEVELOPMENT/SIAKORA%20LABS/SL-ERP/.github/workflows/deploy-docker.yml:1)
