# Production Runbook

This runbook covers the standard update and validation flow for an SL-ERP server that is already provisioned.

For first-time Ubuntu setup, use [UBUNTU_DEPLOYMENT.md](UBUNTU_DEPLOYMENT.md).

## Production SSH access

Connect from your terminal:

```bash
ssh erp@erp.siakoralabs.co.ke
```

Confirm the actual application directory and whether the server uses systemd
or Docker Compose before running deployment commands. The layout below is the
standard layout, and must be checked against the existing server.

The bare-metal workflow also runs automatically on pushes to `main`. Run the
release gate on the intended commit before merging or triggering a deployment.

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

### Invoice and document previews

PDF.js loads an `.mjs` worker from the frontend assets. Verify its response
has `Content-Type: application/javascript` (or `text/javascript`), rather than
`application/octet-stream`. A successful HTTP status alone is insufficient:
browsers reject module workers with a non-JavaScript content type.

Both Nginx templates explicitly map frontend `.mjs` assets to JavaScript and
return 404 for a missing worker instead of serving the app's HTML. Preserve this
mapping in custom server configurations. Validate with `nginx -t` before reload,
then check the worker URL shown in the browser error and open an invoice preview.

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

The Docker stack is defined in [docker-compose.production.yml](../docker-compose.production.yml).

## GitHub Actions Automation

CI runs from [ci.yml](../.github/workflows/ci.yml).

Remote deploy workflows:

- bare metal: [deploy-baremetal.yml](../.github/workflows/deploy-baremetal.yml)
- docker: [deploy-docker.yml](../.github/workflows/deploy-docker.yml)
