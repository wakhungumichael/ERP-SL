# Ubuntu Deployment Guide

This guide is for deploying SL-ERP to an Ubuntu server as a staging or near-production environment.

## Assumptions

- Ubuntu 24.04 LTS
- PostgreSQL on the same host
- Nginx as reverse proxy
- Gunicorn serving Django
- repository deployed under `/srv/sl-erp`

## 1. Install System Packages

```bash
sudo apt update
sudo apt install -y \
  git \
  curl \
  build-essential \
  python3 \
  python3-venv \
  python3-pip \
  pkg-config \
  libpq-dev \
  postgresql \
  postgresql-contrib \
  nginx \
  redis-server \
  libpango-1.0-0 \
  libpangoft2-1.0-0 \
  libcairo2 \
  libffi-dev \
  shared-mime-info
```

The PDF stack is optional but recommended because some document features depend on WeasyPrint system libraries.

You can automate this step with:

```bash
sudo bash scripts/bootstrap-ubuntu.sh
```

## 2. Install Node.js and pnpm

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable
corepack prepare pnpm@10.34.5 --activate
```

## 3. Prepare PostgreSQL

```bash
sudo -u postgres psql
```

```sql
CREATE USER sl_erp_user WITH PASSWORD 'change-this-password';
CREATE DATABASE sl_erp OWNER sl_erp_user;
\q
```

## 4. Upload the Application

```bash
sudo mkdir -p /srv/sl-erp
sudo chown "$USER":"$USER" /srv/sl-erp
git clone <your-repository-url> /srv/sl-erp
cd /srv/sl-erp
```

If you upload an archive instead of cloning, do not include local-only files such as:

- `backend/.env`
- `artifacts/erp-ui/.env`
- `db.sqlite3`
- `backend/db.sqlite3`
- `backups/`
- `backend/backups/`

## 5. Create the Python Environment

```bash
cd /srv/sl-erp
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install uv
uv sync
```

## 6. Install JavaScript Dependencies

Use a full workspace install so shared packages resolve correctly:

```bash
cd /srv/sl-erp
pnpm install --frozen-lockfile
```

## 7. Configure the Backend Environment

```bash
cd /srv/sl-erp/backend
cp .env.production.example .env
```

Example staging values:

```env
SECRET_KEY=replace-with-a-long-random-secret
DEBUG=False
DATABASE_URL=postgresql://sl_erp_user:change-this-password@127.0.0.1:5432/sl_erp
ALLOWED_HOSTS=staging.example.com,server-ip-or-dns
CSRF_TRUSTED_ORIGINS=https://staging.example.com
```

## 8. Configure the Frontend Environment

```bash
cd /srv/sl-erp/artifacts/erp-ui
cp .env.production.example .env.production
```

Recommended value:

```env
BASE_PATH=/
VITE_API_BASE_URL=https://staging.example.com
```

## 9. Initialize the Database

```bash
cd /srv/sl-erp
source .venv/bin/activate
cd backend
python manage.py migrate
python manage.py seed_platform
python manage.py bootstrap_saas_owner
python manage.py collectstatic --noinput
```

If you do not want the default owner bootstrap, create a superuser manually:

```bash
python manage.py createsuperuser
```

If the `slabs` SaaS admin can sign in but the Modules screen is empty or unavailable, verify the environment was initialized with both `python manage.py seed_platform` and `python manage.py bootstrap_saas_owner`. The Modules API only allows platform superadmins, and the bootstrap command is what creates `slabs` with `is_superuser=True`.

## 10. Build the Frontend

```bash
cd /srv/sl-erp/artifacts/erp-ui
pnpm build
```

The frontend output should be in `artifacts/erp-ui/dist/public`.

## 11. Create the Gunicorn Service

Use the template at [deployment/systemd/sl-erp.service](/home/mike/DEVELOPMENT/SIAKORA%20LABS/SL-ERP/deployment/systemd/sl-erp.service:1) or create `/etc/systemd/system/sl-erp.service`:

```ini
[Unit]
Description=SL-ERP Django application
After=network.target postgresql.service

[Service]
User=www-data
Group=www-data
WorkingDirectory=/srv/sl-erp/backend
Environment=DJANGO_SETTINGS_MODULE=SL_ERP.settings
ExecStart=/srv/sl-erp/.venv/bin/gunicorn SL_ERP.wsgi:application --bind 127.0.0.1:8080 --workers 3 --timeout 120
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable sl-erp
sudo systemctl start sl-erp
sudo systemctl status sl-erp --no-pager
```

## 12. Configure Nginx

Use the template at [deployment/nginx/sl-erp.conf](/home/mike/DEVELOPMENT/SIAKORA%20LABS/SL-ERP/deployment/nginx/sl-erp.conf:1) or create `/etc/nginx/sites-available/sl-erp`:

```nginx
server {
    listen 80;
    server_name staging.example.com;

    client_max_body_size 20M;

    location /static/ {
        alias /srv/sl-erp/backend/staticfiles/;
    }

    location /media/ {
        alias /srv/sl-erp/backend/media/;
    }

    location / {
        root /srv/sl-erp/artifacts/erp-ui/dist/public;
        try_files $uri /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /admin/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/sl-erp /etc/nginx/sites-enabled/sl-erp
sudo nginx -t
sudo systemctl reload nginx
```

## 13. Optional HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d staging.example.com
```

## 14. Validation Checklist

Run:

```bash
curl -I http://127.0.0.1:8080/api/healthz
curl -I http://staging.example.com/api/healthz
curl http://staging.example.com/api/platform/auth/status/
```

Then test in the browser:

- admin login
- frontend load
- platform dashboard
- tenant creation
- tenant-scoped access
- PDF/document rendering if enabled

## 15. Release Gate

Do not promote a build to this server if these commands are failing locally or in CI:

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

## 16. Automated Bare-Metal Deploy

Once the server has the repo and environment files in place, deploy updates with:

```bash
bash scripts/deploy-baremetal.sh
```

By default it uses:

- app directory: `/srv/sl-erp`
- branch: `main`

You can override those:

```bash
APP_DIR=/srv/sl-erp BRANCH=main bash scripts/deploy-baremetal.sh
```

## 17. GitHub Actions Secrets

If you want deploys to happen from GitHub Actions, add these repository secrets:

- `PROD_HOST`
- `PROD_PORT`
- `PROD_USER`
- `PROD_SSH_KEY`
- `PROD_APP_DIR`

The workflow file is [deploy-baremetal.yml](/home/mike/DEVELOPMENT/SIAKORA%20LABS/SL-ERP/.github/workflows/deploy-baremetal.yml:1).
