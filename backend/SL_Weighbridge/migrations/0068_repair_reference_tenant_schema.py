from collections import defaultdict

from django.db import migrations


def repair_reference_tenant_columns(apps, schema_editor):
    connection = schema_editor.connection

    if connection.vendor == "postgresql":
        statements = [
            """
            ALTER TABLE "SL_Weighbridge_currency"
            ADD COLUMN IF NOT EXISTS "tenant_id" bigint NULL
            """,
            """
            ALTER TABLE "SL_Weighbridge_item"
            ADD COLUMN IF NOT EXISTS "tenant_id" bigint NULL
            """,
            """
            ALTER TABLE "SL_Weighbridge_vehicletype"
            ADD COLUMN IF NOT EXISTS "tenant_id" bigint NULL
            """,
            """
            CREATE INDEX IF NOT EXISTS "SL_Weighbridge_currency_tenant_id_idx"
            ON "SL_Weighbridge_currency" ("tenant_id")
            """,
            """
            CREATE INDEX IF NOT EXISTS "SL_Weighbridge_item_tenant_id_idx"
            ON "SL_Weighbridge_item" ("tenant_id")
            """,
            """
            CREATE INDEX IF NOT EXISTS "SL_Weighbridge_vehicletype_tenant_id_idx"
            ON "SL_Weighbridge_vehicletype" ("tenant_id")
            """,
            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'SL_Weighbridge_currency_tenant_id_fk'
                ) THEN
                    ALTER TABLE "SL_Weighbridge_currency"
                    ADD CONSTRAINT "SL_Weighbridge_currency_tenant_id_fk"
                    FOREIGN KEY ("tenant_id") REFERENCES "Platform_Core_tenant" ("id")
                    DEFERRABLE INITIALLY DEFERRED;
                END IF;
            END $$;
            """,
            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'SL_Weighbridge_item_tenant_id_fk'
                ) THEN
                    ALTER TABLE "SL_Weighbridge_item"
                    ADD CONSTRAINT "SL_Weighbridge_item_tenant_id_fk"
                    FOREIGN KEY ("tenant_id") REFERENCES "Platform_Core_tenant" ("id")
                    DEFERRABLE INITIALLY DEFERRED;
                END IF;
            END $$;
            """,
            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'SL_Weighbridge_vehicletype_tenant_id_fk'
                ) THEN
                    ALTER TABLE "SL_Weighbridge_vehicletype"
                    ADD CONSTRAINT "SL_Weighbridge_vehicletype_tenant_id_fk"
                    FOREIGN KEY ("tenant_id") REFERENCES "Platform_Core_tenant" ("id")
                    DEFERRABLE INITIALLY DEFERRED;
                END IF;
            END $$;
            """,
        ]

        with connection.cursor() as cursor:
            for statement in statements:
                cursor.execute(statement)

    VehicleType = apps.get_model("SL_Weighbridge", "VehicleType")
    Item = apps.get_model("SL_Weighbridge", "Item")
    Currency = apps.get_model("SL_Weighbridge", "Currency")
    Transaction = apps.get_model("SL_Weighbridge", "Transaction")
    Vehicle = apps.get_model("SL_Weighbridge", "Vehicle")
    CustomerVehicleTypeDiscount = apps.get_model("SL_Weighbridge", "CustomerVehicleTypeDiscount")

    vehicle_type_tenants = defaultdict(set)
    item_tenants = defaultdict(set)
    currency_tenants = defaultdict(set)

    for row in Transaction.objects.exclude(tenant=None).values("tenant_id", "vehicle_type_id", "item_id"):
        tenant_id = row["tenant_id"]
        if tenant_id and row["vehicle_type_id"]:
            vehicle_type_tenants[row["vehicle_type_id"]].add(tenant_id)
        if tenant_id and row["item_id"]:
            item_tenants[row["item_id"]].add(tenant_id)

    for row in Vehicle.objects.exclude(tenant=None).values("tenant_id", "vehicle_type_id"):
        tenant_id = row["tenant_id"]
        if tenant_id and row["vehicle_type_id"]:
            vehicle_type_tenants[row["vehicle_type_id"]].add(tenant_id)

    for row in CustomerVehicleTypeDiscount.objects.select_related("customer").exclude(
        customer__tenant=None
    ).values("customer__tenant_id", "vehicle_type_id"):
        tenant_id = row["customer__tenant_id"]
        if tenant_id and row["vehicle_type_id"]:
            vehicle_type_tenants[row["vehicle_type_id"]].add(tenant_id)

    for vehicle_type in VehicleType.objects.filter(tenant__isnull=True).order_by("id"):
        tenant_ids = vehicle_type_tenants.get(vehicle_type.id, set())
        if len(tenant_ids) == 1:
            vehicle_type.tenant_id = next(iter(tenant_ids))
            vehicle_type.save(update_fields=["tenant"])
            if vehicle_type.currency_id:
                currency_tenants[vehicle_type.currency_id].add(vehicle_type.tenant_id)

    for item in Item.objects.filter(tenant__isnull=True).order_by("id"):
        tenant_ids = item_tenants.get(item.id, set())
        if len(tenant_ids) == 1:
            item.tenant_id = next(iter(tenant_ids))
            item.save(update_fields=["tenant"])
            if item.currency_id:
                currency_tenants[item.currency_id].add(item.tenant_id)

    for currency in Currency.objects.filter(tenant__isnull=True).order_by("id"):
        tenant_ids = set(currency_tenants.get(currency.id, set()))
        if not tenant_ids:
            tenant_ids.update(
                VehicleType.objects.filter(currency_id=currency.id, tenant__isnull=False).values_list("tenant_id", flat=True)
            )
            tenant_ids.update(
                Item.objects.filter(currency_id=currency.id, tenant__isnull=False).values_list("tenant_id", flat=True)
            )
        tenant_ids = {tenant_id for tenant_id in tenant_ids if tenant_id}
        if len(tenant_ids) == 1:
            currency.tenant_id = next(iter(tenant_ids))
            currency.save(update_fields=["tenant"])


class Migration(migrations.Migration):

    dependencies = [
        ("SL_Weighbridge", "0067_vehicletype_item_currency_tenant"),
    ]

    operations = [
        migrations.RunPython(repair_reference_tenant_columns, migrations.RunPython.noop),
    ]
