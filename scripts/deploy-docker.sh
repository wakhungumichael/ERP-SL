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

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull || true
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T backend python manage.py migrate
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T backend python manage.py seed_platform
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T backend python manage.py bootstrap_saas_owner

echo "Docker deployment completed."
