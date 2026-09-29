#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/sl-erp}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"

cd "$APP_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Create it first."
  exit 1
fi

# Protect the current database before images are rebuilt and migrations run.
# A first deployment has no running database yet, so there is nothing to back up.
DB_CONTAINER="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q db 2>/dev/null || true)"
if [[ "${SKIP_DB_BACKUP:-0}" == "1" ]]; then
  echo "Skipping pre-deployment database backup because SKIP_DB_BACKUP=1."
elif [[ -n "$DB_CONTAINER" ]] && [[ "$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null || true)" == "true" ]]; then
  APP_DIR="$APP_DIR" COMPOSE_FILE="$COMPOSE_FILE" ENV_FILE="$ENV_FILE" \
    bash scripts/backup-docker.sh
else
  echo "No running Docker database found; treating this as a first deployment."
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull || true
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build
# Images are rebuilt under stable local tags; force replacement so every
# service actually starts from the newly built image.
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --force-recreate

# The Docker image keeps Django's project at /app/backend.
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T backend sh -c "cd /app/backend && python manage.py migrate"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T backend sh -c "cd /app/backend && python manage.py seed_platform"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T backend sh -c "cd /app/backend && python manage.py bootstrap_saas_owner"

echo "Docker deployment completed."
