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

- build the backend and frontend images
- start Postgres and Redis
- run Django behind Gunicorn
- start Celery worker and beat
- expose the frontend through Nginx

## 5. Useful Docker Commands

```bash
docker compose --env-file .env.production -f docker-compose.production.yml ps
docker compose --env-file .env.production -f docker-compose.production.yml logs -f backend
docker compose --env-file .env.production -f docker-compose.production.yml logs -f frontend
docker compose --env-file .env.production -f docker-compose.production.yml restart backend
docker compose --env-file .env.production -f docker-compose.production.yml down
```

## 6. Validation

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

## 7. GitHub Actions Secrets

For remote Docker deploy automation, configure:

- `PROD_HOST`
- `PROD_PORT`
- `PROD_USER`
- `PROD_SSH_KEY`
- `PROD_APP_DIR`

The workflow file is [deploy-docker.yml](/home/mike/DEVELOPMENT/SIAKORA%20LABS/SL-ERP/.github/workflows/deploy-docker.yml:1).

## Notes

- The backend container runs migrations and collectstatic automatically on start.
- Persistent data is stored in Docker volumes for Postgres, Redis, static files, and media files.
- For internet-facing deployments, put a TLS terminator in front of the stack or change the Nginx container setup accordingly.
