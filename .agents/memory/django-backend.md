---
name: Django backend setup
description: How the Django API server is configured and started in this Replit workspace
---

## Artifact run command
The `artifacts/api-server` workflow CWD is `artifacts/api-server/` (NOT the workspace root).
The run command must use `cd ../../backend` to reach the Django project:

```
bash -c 'cd ../../backend && export DJANGO_SETTINGS_MODULE=SL_ERP.settings && python manage.py migrate --no-input 2>&1 || true && exec python manage.py runserver 0.0.0.0:8080'
```

Port is hardcoded to 8080 (matching `localPort = 8080` in artifact.toml). `${PORT}` inside single-quoted bash string would NOT expand.

**Why:** Replit artifact service workflows run from the artifact directory, not the workspace root. Previous attempts using `bash backend/start.sh` all failed with "No such file or directory" because it looked for `artifacts/api-server/backend/start.sh`.

## Django settings
- `backend/SL_ERP/settings.py` — uses `dj_database_url` to parse `DATABASE_URL` env var from Replit Postgres
- `ALLOWED_HOSTS = ['*']`, `CORS_ALLOW_ALL_ORIGINS = True` in dev
- `DJANGO_SETTINGS_MODULE=SL_ERP.settings` must be exported before any manage.py call

## Migrations
All migrations applied as of 2026-07-16. Platform_Core migrations live in `backend/Platform_Core/migrations/`. SL_Weighbridge has migrations up through 0041.

Run manually: `cd backend && DJANGO_SETTINGS_MODULE=SL_ERP.settings python manage.py migrate --no-input`
