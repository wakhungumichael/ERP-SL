# Docker Deployment on an Alternate Port

This guide installs SL-ERP on a server where another application already uses
ports 80 and 443. The ERP Docker frontend is published on host port `8088`, so
the existing application is not changed.

The ERP will initially be available at:

```text
http://ws.metrixws.co.ke:8088
```

## 1. Confirm the Existing Services

Run these commands before installation:

```bash
sudo ss -ltnp | grep -E ':(80|443|8088)\b' || true
curl -I http://ws.metrixws.co.ke/
```

Port `8088` must be free. Do not stop or reconfigure the application currently
using port 80.

## 2. Install Git and Docker

```bash
sudo apt update
sudo apt install -y ca-certificates curl git gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
docker --version
docker compose version
```

If DNS resolution fails, fix the server DNS before continuing. Do not remove
APT lock files. If an interrupted APT process is still running, resume it with
`fg` or wait for it to finish.

## 3. Clone the Repository

For a public repository:

```bash
sudo mkdir -p /srv/sl-erp
sudo chown "$USER":"$USER" /srv/sl-erp
git clone https://github.com/wakhungumichael/ERP-SL.git /srv/sl-erp
cd /srv/sl-erp
git branch --show-current
git log -1 --oneline
```

For a private repository, configure a GitHub deploy key and use the SSH clone
URL instead.

## 4. Configure the Environment

```bash
cd /srv/sl-erp
cp .env.production.docker.example .env.production
chmod 600 .env.production
openssl rand -base64 48
openssl rand -base64 36 | tr -d '/+=' | head -c 32; echo
nano .env.production
```

Use the generated values for `SECRET_KEY` and `POSTGRES_PASSWORD`. Keep the
database password URL-safe because it is included in `DATABASE_URL`.

Set or replace these values in `.env.production`:

```dotenv
HTTP_PORT=8088
ERP_FRONTEND_URL=http://ws.metrixws.co.ke:8088

POSTGRES_DB=sl_erp
POSTGRES_USER=sl_erp
POSTGRES_PASSWORD=REPLACE_WITH_URL_SAFE_DATABASE_PASSWORD
DATABASE_URL=postgresql://sl_erp:REPLACE_WITH_URL_SAFE_DATABASE_PASSWORD@db:5432/sl_erp

SECRET_KEY=REPLACE_WITH_GENERATED_DJANGO_SECRET
DEBUG=False
ALLOWED_HOSTS=ws.metrixws.co.ke,localhost,127.0.0.1
CSRF_TRUSTED_ORIGINS=http://ws.metrixws.co.ke:8088
CORS_ALLOWED_ORIGINS=http://ws.metrixws.co.ke:8088
SESSION_COOKIE_SECURE=False
CSRF_COOKIE_SECURE=False
```

The value after `POSTGRES_PASSWORD=` must exactly match the password embedded
in `DATABASE_URL`.

Keep `.env.production` only on the server. It is intentionally excluded from
Git and must never be committed.

## 5. Open Port 8088

If UFW is enabled:

```bash
sudo ufw allow 8088/tcp
sudo ufw status
```

Also allow inbound TCP port `8088` in the provider firewall, router, or NAT
configuration. Restrict the source networks if this is only a staging server.

## 6. Deploy

```bash
cd /srv/sl-erp
bash scripts/deploy-docker.sh
```

The deployment script builds the images, starts PostgreSQL and Redis, applies
Django migrations, collects static files, seeds platform data, and bootstraps
the SaaS owner. On later deployments it creates a database backup before
rebuilding.

## 7. Verify the Deployment

```bash
cd /srv/sl-erp
docker compose --env-file .env.production -f docker-compose.production.yml ps
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=100 backend
curl -I http://127.0.0.1:8088
curl -I http://ws.metrixws.co.ke:8088
```

The frontend should show a port mapping similar to:

```text
0.0.0.0:8088->80/tcp
```

All application containers should be `Up`, and the database should be
`healthy`.

## 8. Set or Reset the SaaS Superuser Password

Passwords are not stored in Git or in this document. Set a new password
interactively on the server:

```bash
cd /srv/sl-erp
docker compose --env-file .env.production -f docker-compose.production.yml exec backend \
  python manage.py changepassword slabs
```

If `slabs` does not exist, create it:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml exec backend \
  python manage.py createsuperuser --username slabs
```

Verify the account flags:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml exec backend \
  python manage.py shell -c "from django.contrib.auth import get_user_model; u=get_user_model().objects.get(username='slabs'); print(u.username, u.is_active, u.is_staff, u.is_superuser)"
```

## 9. Create a Database Backup

```bash
cd /srv/sl-erp
bash scripts/backup-docker.sh
ls -lh backups/docker/
```

Copy backups to encrypted off-server storage. A backup kept only on this server
does not protect against disk or server loss.

## 10. Deploy Future Updates

```bash
cd /srv/sl-erp
git status --short
git pull --ff-only origin main
bash scripts/deploy-docker.sh
docker compose --env-file .env.production -f docker-compose.production.yml ps
```

Do not edit tracked source files directly on the server. Develop and test on a
workstation, push to `main`, then pull and redeploy on the server.

## 11. Stop or Remove the ERP Stack

Stop containers while preserving the database and uploaded media:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml down
```

Do not add `--volumes` unless you intentionally want to delete the PostgreSQL,
Redis, static, and media volumes.

## Recommended Production URL

Port `8088` is suitable for staged testing. For public production use, create a
dedicated hostname such as `erp-ws.metrixws.co.ke`, keep Docker bound to
`127.0.0.1:8088`, and configure the host Nginx service to reverse proxy that
hostname to Docker with a trusted TLS certificate. After HTTPS is enabled, use
the HTTPS URL in the origin settings and set both secure-cookie values to
`True`.
