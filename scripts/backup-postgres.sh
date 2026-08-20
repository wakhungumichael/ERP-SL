#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/backend/.env}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
DB_URL="${DATABASE_URL:-}"

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
  echo "This backup helper only supports PostgreSQL. Current DATABASE_URL points to SQLite." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%F_%H%M%S)"
OUT_FILE="$BACKUP_DIR/sl_erp_${STAMP}.dump"

echo "Writing backup to $OUT_FILE"
pg_dump "$DB_URL" -Fc -f "$OUT_FILE"
echo "Backup complete"
