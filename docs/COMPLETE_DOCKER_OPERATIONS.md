# SL-ERP Complete Docker Operations Guide

This document covers first deployment on Ubuntu, updates, migrations, database
backup and restore, moving to another server, Windows development, and recovery
of the `slabs` platform-superuser login.

## Current Repository

```text
Repository: https://github.com/wakhungumichael/ERP-SL.git
Branch: main
Production domain: erp.siakoralabs.co.ke
```

Keep these outside Git:

- `.env.production`
- PostgreSQL `.dump` files
- uploaded media
- TLS private keys
- user passwords

## 1. Prepare Ubuntu

Run as `root` or prefix privileged commands with `sudo`:

```bash
apt update
apt upgrade -y
apt install -y git curl ca-certificates gnupg
```

If DNS resolution fails, first test connectivity:

```bash
ping -c 4 8.8.8.8
ping -c 4 github.com
cat /etc/resolv.conf
```

If the IP works but hostnames do not, configure persistent DNS:

```bash
mkdir -p /etc/systemd/resolved.conf.d
cat >/etc/systemd/resolved.conf.d/dns.conf <<'EOF'
[Resolve]
DNS=8.8.8.8 1.1.1.1
FallbackDNS=9.9.9.9
EOF
systemctl restart systemd-resolved
ln -sf /run/systemd/resolve/resolv.conf /etc/resolv.conf
```

## 2. Install Docker on Ubuntu 22.04

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

cat >/etc/apt/sources.list.d/docker.list <<'EOF'
deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu jammy stable
EOF

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker --version
docker compose version
```

If `apt` reports a lock held by another process, do not delete lock files while
that process is active. Check it first:

```bash
ps -fp APT_PROCESS_ID
jobs -l
```

Resume a deliberately suspended `apt` job with `fg`, or stop that exact process
before running `dpkg --configure -a` and `apt update` again.

## 3. Clone SL-ERP

```bash
mkdir -p /srv/sl-erp
cd /srv/sl-erp
git clone https://github.com/wakhungumichael/ERP-SL.git .
git switch main
git log -1 --oneline
```

HTTPS avoids requiring a GitHub SSH key on a deployment server. Use the SSH URL
only after that server has a registered GitHub key.

## 4. Configure the Environment

```bash
cd /srv/sl-erp
cp .env.production.docker.example .env.production
nano .env.production
```

Set at least:

```env
POSTGRES_DB=sl_erp
POSTGRES_USER=sl_erp_user
POSTGRES_PASSWORD=GENERATE_A_PRIVATE_URL_SAFE_PASSWORD

SECRET_KEY=GENERATE_A_PRIVATE_LONG_DJANGO_SECRET
DEBUG=False
ERP_FRONTEND_URL=https://erp.siakoralabs.co.ke
ALLOWED_HOSTS=erp.siakoralabs.co.ke,10.10.254.5,localhost,127.0.0.1
CSRF_TRUSTED_ORIGINS=https://erp.siakoralabs.co.ke,http://10.10.254.5
CORS_ALLOWED_ORIGINS=https://erp.siakoralabs.co.ke,http://10.10.254.5
CORS_ALLOW_ALL_ORIGINS=False
SESSION_COOKIE_SECURE=True
CSRF_COOKIE_SECURE=True
USE_X_FORWARDED_HOST=True

HTTP_PORT=80
BASE_PATH=/
VITE_API_BASE_URL=/
```

Keep both cookie flags `True` for the HTTPS domain. If the server is being
tested only through `http://10.10.254.5`, temporarily set both flags to
`False`; switch them back to `True` when HTTPS is enabled.

Use letters, numbers, `_`, and `-` in `POSTGRES_PASSWORD`. URL-reserved
characters such as `#`, `@`, `/`, and `:` can break the generated database URL.

Generate secrets on the server:

```bash
openssl rand -base64 36 | tr -d '/+=' | head -c 40; echo
openssl rand -base64 64 | tr -d '\n'; echo
```

Store the first output as the database password and the second as `SECRET_KEY`.
Never put either value into the tracked example file.

## 5. First Docker Deployment

```bash
cd /srv/sl-erp
bash scripts/deploy-docker.sh
```

The script performs these actions:

1. Backs up an existing Docker PostgreSQL database, if one is running.
2. Pulls base images and builds application images.
3. Starts PostgreSQL, Redis, Django/Gunicorn, Celery, and Nginx.
4. Applies all committed Django migrations.
5. Seeds platform modules, plans, industries, and permissions.
6. Ensures the default SaaS owner and `slabs` superuser exist.

On a first deployment there is no database to back up, so that step is skipped.

## 6. Verify the Deployment

```bash
docker compose --env-file .env.production -f docker-compose.production.yml ps
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=100 backend
curl -I http://127.0.0.1
curl -I http://10.10.254.5
```

The backend is healthy when its log shows Gunicorn listening on
`0.0.0.0:8080`. The browser URL on the private network is:

```text
http://10.10.254.5
```

The public URL requires working DNS, routing, and TLS:

```text
https://erp.siakoralabs.co.ke
```

## 7. Set or Reset the `slabs` Superuser Password

Django stores password hashes, so an existing password cannot be displayed.
Reset only the `slabs` account interactively:

```bash
cd /srv/sl-erp
docker compose --env-file .env.production -f docker-compose.production.yml \
  exec backend sh -c "cd /app/backend && python manage.py changepassword slabs"
```

Enter a new private password twice when prompted. The input is hidden. Do not
put this password in Git, this document, chat messages, or `.env.production`.

Confirm that the account remains a platform superuser:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml \
  exec -T backend sh -c "cd /app/backend && python manage.py shell -c \"from django.contrib.auth import get_user_model; u=get_user_model().objects.get(username='slabs'); print(u.username, u.is_active, u.is_staff, u.is_superuser)\""
```

Expected output:

```text
slabs True True True
```

## 8. Update an Existing Docker Server

Check for local server edits first:

```bash
cd /srv/sl-erp
git status --short
```

If it is clean, update and deploy:

```bash
git pull --ff-only origin main
bash scripts/deploy-docker.sh
```

The deployment aborts if the automatic database backup fails. Bypass it only
when deliberately approved and another verified backup exists:

```bash
SKIP_DB_BACKUP=1 bash scripts/deploy-docker.sh
```

Verify the deployed commit and containers:

```bash
git log -1 --oneline
docker compose --env-file .env.production -f docker-compose.production.yml ps
```

## 9. Back Up Docker PostgreSQL

Create a manual backup:

```bash
cd /srv/sl-erp
bash scripts/backup-docker.sh
ls -lh backups/docker/
```

The script creates:

```text
backups/docker/sl_erp_YYYY-MM-DD_HHMMSS.dump
backups/docker/sl_erp_YYYY-MM-DD_HHMMSS.dump.sha256
```

Verify a copied backup:

```bash
sha256sum -c backups/docker/sl_erp_YYYY-MM-DD_HHMMSS.dump.sha256
```

Copy backups to encrypted storage outside the server. Git intentionally ignores
all dumps.

## 10. Restore Docker PostgreSQL

Restoring replaces current database objects. Make another backup first, then:

```bash
cd /srv/sl-erp
CONFIRM_RESTORE=YES bash scripts/restore-docker.sh \
  backups/docker/sl_erp_YYYY-MM-DD_HHMMSS.dump
```

The restore script stops backend and Celery services, restores PostgreSQL, and
starts the services again. Verify logs and login after restoration.

## 11. Deploy to Another Ubuntu Server

On the original server:

```bash
cd /srv/sl-erp
bash scripts/backup-docker.sh
ls -lt backups/docker/ | head
```

Copy the chosen dump and checksum to secure storage or directly to the new
server. Do not use Git for this transfer.

On the new server:

1. Complete sections 1-4.
2. Run `bash scripts/deploy-docker.sh` once to create the stack.
3. Copy the dump into `/srv/sl-erp/backups/docker/`.
4. Verify its checksum.
5. Run the restore command from section 10.
6. Run `bash scripts/deploy-docker.sh` again to apply any newer migrations.

A new server without an old dump can simply run the first deployment. Django
will construct the full schema from committed migrations.

## 12. Windows Development

Use Windows 11 with WSL 2, Ubuntu, Git, and Docker Desktop. Open PowerShell as
Administrator:

```powershell
wsl --install -d Ubuntu
```

Enable Docker Desktop's WSL 2 engine and Ubuntu integration. Then open Ubuntu:

```bash
sudo apt update
sudo apt install -y git curl build-essential python3 python3-venv python3-pip
git clone https://github.com/wakhungumichael/ERP-SL.git ~/sl-erp
cd ~/sl-erp
cp .env.production.docker.example .env.production
```

Edit `.env.production` for localhost as described in
`docs/WINDOWS_SETUP.md`, then run:

```bash
bash scripts/deploy-docker.sh
```

Open `http://localhost`. Keep the repository inside the WSL filesystem rather
than `/mnt/c/` for better Node and Docker performance.

## 13. Migration Commands

Apply migrations manually:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml \
  exec backend sh -c "cd /app/backend && python manage.py migrate"
```

Check for model changes missing migrations:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml \
  exec backend sh -c "cd /app/backend && python manage.py makemigrations --check --dry-run"
```

Create migrations only during development, review them, run tests, and commit
them with the code that changed the models. Production servers should apply
committed migrations, not generate new ones.

## 14. Routine Commands

```bash
# Status
docker compose --env-file .env.production -f docker-compose.production.yml ps

# Backend logs
docker compose --env-file .env.production -f docker-compose.production.yml logs -f backend

# Frontend logs
docker compose --env-file .env.production -f docker-compose.production.yml logs -f frontend

# Restart application services
docker compose --env-file .env.production -f docker-compose.production.yml restart backend celery-worker celery-beat frontend

# Stop the stack without deleting database volumes
docker compose --env-file .env.production -f docker-compose.production.yml down
```

Never add `-v` to `docker compose down` during normal operations. That option
deletes named volumes, including the PostgreSQL database.

## 15. Troubleshooting

### Git cannot resolve GitHub

Fix DNS using section 1, then test `ping github.com` before cloning again.

### Docker build uses old Python dependencies

```bash
git pull --ff-only origin main
docker compose --env-file .env.production -f docker-compose.production.yml build --no-cache backend
docker compose --env-file .env.production -f docker-compose.production.yml up -d --force-recreate
```

### Frontend works but API fails

```bash
docker compose --env-file .env.production -f docker-compose.production.yml ps
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=200 backend
```

### Modules are empty for `slabs`

```bash
docker compose --env-file .env.production -f docker-compose.production.yml \
  exec -T backend sh -c "cd /app/backend && python manage.py seed_platform"
docker compose --env-file .env.production -f docker-compose.production.yml \
  exec -T backend sh -c "cd /app/backend && python manage.py bootstrap_saas_owner"
```

Then verify `slabs` is a superuser using section 7 and sign in again.

### Host and Docker Nginx both use port 80

```bash
ss -ltnp | grep ':80'
systemctl status nginx --no-pager
```

Only one service can bind the same host address and port. If host Nginx
terminates TLS, bind the Docker frontend to a different local port and proxy to
it. Do not expose two competing web servers on port 80.
