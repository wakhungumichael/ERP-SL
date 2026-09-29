#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${APP_DIR:-$ROOT_DIR}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
BACKUP_FILE="${1:-}"

if [[ -z "$BACKUP_FILE" ]]; then
  echo "Usage: CONFIRM_RESTORE=YES $0 path/to/backup.dump" >&2
  exit 1
fi

if [[ "${CONFIRM_RESTORE:-}" != "YES" ]]; then
  echo "Restore replaces current database objects. Re-run with CONFIRM_RESTORE=YES." >&2
  exit 1
fi

cd "$APP_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE." >&2
  exit 1
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

DB_CONTAINER="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q db)"
if [[ -z "$DB_CONTAINER" ]] || [[ "$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null || true)" != "true" ]]; then
  echo "The Docker PostgreSQL service must be running before restore." >&2
  exit 1
fi

echo "Stopping application services for a consistent restore"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" stop backend celery-worker celery-beat
trap 'docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" start backend celery-worker celery-beat' EXIT

echo "Restoring $BACKUP_FILE into Docker PostgreSQL"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db \
  sh -c 'pg_restore --clean --if-exists --exit-on-error --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < "$BACKUP_FILE"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" start backend celery-worker celery-beat
trap - EXIT
echo "Restore complete"
