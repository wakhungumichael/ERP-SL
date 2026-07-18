#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
export DJANGO_SETTINGS_MODULE=SL_ERP.settings

# Run migrations on startup (safe to run repeatedly)
python manage.py migrate --run-syncdb --no-input 2>&1 || true

# Start Django development server
exec python manage.py runserver "0.0.0.0:${PORT:-8080}"
