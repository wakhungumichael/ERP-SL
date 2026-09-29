#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${APP_DIR:-$ROOT_DIR}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups/docker}"

cd "$APP_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Create it before backing up PostgreSQL." >&2
  exit 1
fi

DB_CONTAINER="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q db)"
if [[ -z "$DB_CONTAINER" ]] || [[ "$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null || true)" != "true" ]]; then
  echo "The Docker PostgreSQL service is not running; no backup was created." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%F_%H%M%S)"
OUT_FILE="$BACKUP_DIR/sl_erp_${STAMP}.dump"
TEMP_FILE="$(mktemp "$BACKUP_DIR/.sl_erp_${STAMP}.XXXXXX")"
trap 'rm -f "$TEMP_FILE"' EXIT

echo "Writing Docker PostgreSQL backup to $OUT_FILE"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db \
  sh -c 'pg_dump --format=custom --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  > "$TEMP_FILE"

if [[ ! -s "$TEMP_FILE" ]]; then
  echo "Backup failed: pg_dump produced an empty file." >&2
  exit 1
fi

mv "$TEMP_FILE" "$OUT_FILE"
trap - EXIT
sha256sum "$OUT_FILE" > "$OUT_FILE.sha256"
echo "Backup complete: $OUT_FILE"
