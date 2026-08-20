#!/usr/bin/env sh
set -eu

cd /app/backend

python manage.py migrate --noinput
python manage.py collectstatic --noinput

exec gunicorn SL_ERP.wsgi:application \
  --bind 0.0.0.0:8080 \
  --workers "${GUNICORN_WORKERS:-3}" \
  --timeout "${GUNICORN_TIMEOUT:-120}"
