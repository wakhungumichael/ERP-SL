# Docker Deployment Guide

This guide runs SL-ERP as containers using Docker Compose.

## What the Stack Includes

- `db`: PostgreSQL 16
- `redis`: Redis 7
- `backend`: Django + Gunicorn
- `celery-worker`: Celery worker
- `celery-beat`: Celery scheduler
- `frontend`: Nginx serving the built frontend and proxying `/api` and `/admin`

The stack definition is in [docker-compose.production.yml](/home/mike/DEVELOPMENT/SIAKORA%20LABS/SL-ERP/docker-compose.production.yml:1).

## 1. Install Docker

On Ubuntu:

```bash
sudo bash scripts/bootstrap-ubuntu.sh
```

## 2. Prepare the Server Directory

```bash
sudo mkdir -p /srv/sl-erp
sudo chown "$USER":"$USER" /srv/sl-erp
git clone <your-repository-url> /srv/sl-erp
cd /srv/sl-erp
```

## 3. Create the Docker Environment File

```bash
cp .env.production.docker.example .env.production
```

Edit at least:

```env
POSTGRES_PASSWORD=change-this-password
SECRET_KEY=replace-with-a-long-random-secret
ALLOWED_HOSTS=staging.example.com,localhost,127.0.0.1
CSRF_TRUSTED_ORIGINS=https://staging.example.com
CORS_ALLOWED_ORIGINS=https://staging.example.com
HTTP_PORT=80
```

## 4. Build and Start

```bash
bash scripts/deploy-docker.sh
```

That script will:

- create a timestamped PostgreSQL backup before an existing deployment is changed
- build the backend and frontend images
- start Postgres and Redis
- run Django behind Gunicorn
- start Celery worker and beat
- expose the frontend through Nginx
- run `migrate`
- seed module, plan, and industry data
- bootstrap the default `slabs` platform superadmin

For a second Ubuntu server, repeat sections 1-4. A fresh database starts from
the committed migrations. To copy existing business data as well, create a
dump on the old server with `bash scripts/backup-docker.sh`, transfer the dump
outside Git, and restore it on the new server using the command in section 6.

## 5. First Login

After the script completes:

- open `http://your-server/`
- sign in with the `slabs` account created by `bootstrap_saas_owner`
- verify the Modules page loads records instead of showing an empty state

If `slabs` can sign in but Modules is empty or unavailable, rerun:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml exec backend python manage.py seed_platform
docker compose --env-file .env.production -f docker-compose.production.yml exec backend python manage.py bootstrap_saas_owner
```

## 6. Ongoing Updates During Development

When you push new code and want the Ubuntu server updated:

```bash
cd /srv/sl-erp
git pull
bash scripts/deploy-docker.sh
```

That is the main Docker advantage here: you do not reinstall dependencies manually on the server. The images are rebuilt with the app and dependency changes, then the containers are restarted with the new version.

Every update writes a PostgreSQL custom-format dump and SHA-256 checksum under
`backups/docker/` before rebuilding. If no database container exists, the
script treats the run as a first deployment. Use `SKIP_DB_BACKUP=1` only when
you have deliberately chosen to deploy without a backup.

Manual backup and restore:

```bash
bash scripts/backup-docker.sh
CONFIRM_RESTORE=YES bash scripts/restore-docker.sh backups/docker/sl_erp_DATE_TIME.dump
```

## 7. Useful Docker Commands

```bash
docker compose --env-file .env.production -f docker-compose.production.yml ps
docker compose --env-file .env.production -f docker-compose.production.yml logs -f backend
docker compose --env-file .env.production -f docker-compose.production.yml logs -f frontend
docker compose --env-file .env.production -f docker-compose.production.yml restart backend
docker compose --env-file .env.production -f docker-compose.production.yml down
docker compose --env-file .env.production -f docker-compose.production.yml exec backend python manage.py createsuperuser
```

## 8. Validation

After startup, verify:

```bash
curl -I http://127.0.0.1:${HTTP_PORT:-80}
curl -I http://127.0.0.1:${HTTP_PORT:-80}/api/healthz
```

Then test:

- frontend page load
- admin login
- platform auth status
- tenant creation
- module access

## 9. Troubleshooting

- If Compose says `POSTGRES_PASSWORD` is missing, rerun with `--env-file .env.production` or use `bash scripts/deploy-docker.sh`.
- If backend images fail on Python package builds, make sure you are using the committed `backend/requirements.txt` and `deployment/docker/backend.Dockerfile` from this branch.
- If the Modules page shows an error instead of data, the `slabs` account is likely not a platform superuser or the seed commands did not run yet.
- If frontend builds but is slow to load, that is currently a bundle-size optimization issue, not a deployment failure.

## 10. GitHub Actions Secrets

For remote Docker deploy automation, configure:

- `PROD_HOST`
- `PROD_PORT`
- `PROD_USER`
- `PROD_SSH_KEY`
- `PROD_APP_DIR`

The workflow file is [deploy-docker.yml](/home/mike/DEVELOPMENT/SIAKORA%20LABS/SL-ERP/.github/workflows/deploy-docker.yml:1).

## Notes

- The deployment script also runs `migrate`, `seed_platform`, and `bootstrap_saas_owner` after containers start.
- Persistent data is stored in Docker volumes for Postgres, Redis, static files, and media files.
- Database dumps are ignored by Git. Copy them to encrypted off-server storage for disaster recovery.
- For internet-facing deployments, put a TLS terminator in front of the stack or change the Nginx container setup accordingly.
