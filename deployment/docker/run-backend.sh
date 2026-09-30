#!/usr/bin/env sh
set -eu

cd /app/backend

exec gunicorn SL_ERP.wsgi:application \
  --bind 0.0.0.0:8080 \
  --workers "${GUNICORN_WORKERS:-3}" \
  --timeout "${GUNICORN_TIMEOUT:-120}"
