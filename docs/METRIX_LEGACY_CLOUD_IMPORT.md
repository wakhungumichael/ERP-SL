# Metrix Legacy Cloud Import

This imports the legacy Metrix weighbridge records into one existing SL-ERP tenant. It includes companies, branches, currencies, customers, vehicle types and charges, vehicles, items, customer discounts, and transactions.

The importer does not import legacy user accounts, passwords, sessions, camera credentials, or raw vehicle-presence captures. Existing SL-ERP users and tenant access controls remain intact.

## Before Importing

1. Deploy the branch containing the importer to the Metrix server.
2. Copy the JSON package from the development machine to `/srv/sl-erp/backups/migrations/` on the cloud server, then copy it into the running backend container:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml exec -T backend \
  sh -c 'cat > /tmp/metrix_legacy.json' \
  < backups/migrations/metrix_legacy_20261009_093659.json
```
3. Confirm the cloud tenant code from the Organizations screen or with the command below.
4. The `--replace` command deletes only weighbridge business records assigned to that tenant. It does not remove tenant users, roles, subscriptions, or platform settings.

```bash
cd /srv/sl-erp
docker compose --env-file .env.production -f docker-compose.production.yml exec -T backend \
  sh -c 'cd /app/backend && python manage.py shell -c "from Platform_Core.models import Tenant; print(list(Tenant.objects.values_list(\"code\", flat=True)))"'
```

## Cloud Backup

```bash
cd /srv/sl-erp
mkdir -p backups/migrations
docker compose --env-file .env.production -f docker-compose.production.yml exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' \
  > "backups/migrations/metrix_cloud_before_legacy_import_$(date +%Y%m%d_%H%M%S).dump"
```

## Dry Run

Replace `metrix-weighbridge-solutions` with the actual cloud tenant code.

```bash
docker compose --env-file .env.production -f docker-compose.production.yml exec -T backend \
  sh -c 'cd /app/backend && python manage.py import_legacy_metrix /tmp/metrix_legacy.json --tenant-code metrix-weighbridge-solutions'
```

## Import

Run this only after the dry run reports the expected 698 customers, 1,547 vehicles, 188 items, 102 discounts, and 6,714 transactions.

```bash
docker compose --env-file .env.production -f docker-compose.production.yml exec -T backend \
  sh -c 'cd /app/backend && python manage.py import_legacy_metrix /tmp/metrix_legacy.json --tenant-code metrix-weighbridge-solutions --replace --apply'
```
