---
name: VS Code / local dev setup
description: What was changed to make the project work outside Replit, and what still requires the Replit environment.
---

## Changes made for VS Code compatibility

**`artifacts/erp-ui/vite.config.ts`**
- `PORT` now defaults to `5173` (was a hard throw if missing)
- `BASE_PATH` now defaults to `/` (was a hard throw if missing)
- All three Replit plugins (runtime-error-modal, cartographer, dev-banner) are now gated on `REPL_ID !== undefined`
- Added `server.proxy` so `/api/*` proxies to `http://localhost:8080` (or `VITE_API_BASE_URL`) — this is a no-op on Replit where platform routing handles it

**`backend/SL_ERP/settings.py`**
- `CSRF_TRUSTED_ORIGINS` extended to include `http://localhost:8080`, `http://127.0.0.1:*` variants

**Deleted**
- `backend/sudo systemctl restart postgresql@14-main` — accidental file
- `backend/testapp/` — empty scaffold
- `backend/frontend/` — old weighbridge-only frontend, superseded by `artifacts/erp-ui`

## New files
- `backend/.env.example` — full env reference for local dev
- `artifacts/erp-ui/.env.example` — frontend env reference
- `.vscode/settings.json` — Python interpreter path, formatters, file exclusions
- `.vscode/extensions.json` — recommended extensions
- `docs/LOCAL_SETUP.md` — step-by-step local dev guide
- `docs/ARCHITECTURE.md` — full structure + module map

## Still Replit-only
- `DATABASE_URL` auto-provided on Replit; locally must be set in `backend/.env`
- `artifacts/*/` routing and port assignment managed by Replit artifact system; locally just run each service directly

**Why:** `PORT` and `BASE_PATH` are injected by Replit's artifact runner at startup; VS Code has no equivalent injection.
