#!/usr/bin/env sh
set -eu

cd /app/backend

exec celery -A SL_ERP.celery_app worker --loglevel="${CELERY_LOG_LEVEL:-info}"
