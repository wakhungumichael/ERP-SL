#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
export DJANGO_SETTINGS_MODULE=SL_ERP.settings

# Run migrations on startup (safe to run repeatedly). Do not mask failures:
# running new code against an old schema can corrupt workflow behaviour.
python manage.py migrate --run-syncdb --no-input

# Start Django development server
exec python manage.py runserver "0.0.0.0:${PORT:-8080}"
