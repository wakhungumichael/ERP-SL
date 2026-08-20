#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/backend/.env}"
DB_URL="${DATABASE_URL:-}"
BACKUP_FILE="${1:-}"

if [[ -z "$BACKUP_FILE" ]]; then
  echo "Usage: $0 path/to/backup.dump" >&2
  exit 1
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

if [[ -z "$DB_URL" && -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$ENV_FILE"
  set +a
  DB_URL="${DATABASE_URL:-}"
fi

if [[ -z "$DB_URL" ]]; then
  echo "DATABASE_URL is not set. Point ENV_FILE at a valid backend .env or export DATABASE_URL." >&2
  exit 1
fi

if [[ "$DB_URL" == sqlite:* ]]; then
  echo "This restore helper only supports PostgreSQL. Current DATABASE_URL points to SQLite." >&2
  exit 1
fi

echo "Restoring $BACKUP_FILE to PostgreSQL target from DATABASE_URL"
pg_restore --clean --if-exists --no-owner --no-acl --dbname="$DB_URL" "$BACKUP_FILE"
echo "Restore complete"
