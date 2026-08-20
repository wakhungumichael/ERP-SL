#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/sl-erp}"
BRANCH="${BRANCH:-main}"

cd "$APP_DIR"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi

source .venv/bin/activate

python -m pip install --upgrade pip
python -m pip install uv

git fetch --all --prune
git checkout "$BRANCH"
git pull origin "$BRANCH"

uv sync
pnpm install --frozen-lockfile

cd backend
python manage.py migrate --noinput
python manage.py collectstatic --noinput
python manage.py sync_all_subscription_modules

cd ../artifacts/erp-ui
pnpm build

if command -v systemctl >/dev/null 2>&1; then
  systemctl restart sl-erp || true
  systemctl reload nginx || true
fi

echo "Bare-metal deployment completed."
