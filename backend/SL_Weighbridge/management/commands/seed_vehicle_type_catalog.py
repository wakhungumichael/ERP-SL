from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError

from Platform_Core.models import Tenant
from SL_Sales.models import Product
from SL_Weighbridge.models import Currency, VehicleType


VEHICLE_TYPES_DATA = [
    {
        "name": "12 Wheeler",
        "description": "",
        "charge": Decimal("800.00"),
        "currency": "KES",
        "max_gross_weight": 434000,
        "max_tare_weight": 415000,
    },
    {
        "name": "8 Wheeler",
        "description": "Vehicle with 2 axles, 8 wheels (dual tyres)",
        "charge": Decimal("800.00"),
        "currency": "KES",
        "max_gross_weight": 24000,
        "max_tare_weight": 12000,
    },
    {
        "name": "4 Wheeler",
        "description": "Vehicle with 1 axle, 4 wheels (dual tyres)",
        "charge": Decimal("500.00"),
        "currency": "KES",
        "max_gross_weight": 6000,
        "max_tare_weight": 3500,
    },
    {
        "name": "6 Wheeler",
        "description": "Vehicle with 2 axles, 6 wheels (dual tyres)",
        "charge": Decimal("500.00"),
        "currency": "KES",
        "max_gross_weight": 22000,
        "max_tare_weight": 19000,
    },
    {
        "name": "10 Wheeler",
        "description": "Vehicle with 3 axles, 10 wheels",
        "charge": Decimal("800.00"),
        "currency": "KES",
        "max_gross_weight": 432000,
        "max_tare_weight": 427000,
    },
    {
        "name": "22 Wheeler",
        "description": "Vehicle with 6 axles, 22 wheels",
        "charge": Decimal("1000.00"),
        "currency": "KES",
        "max_gross_weight": 56000,
        "max_tare_weight": 52000,
    },
]


def _product_code_for_vehicle_type(name: str) -> str:
    return f"WB-{name.upper().replace(' ', '-').replace('/', '-')}"[:50]


class Command(BaseCommand):
    help = "Seed standard weighbridge vehicle pricing and sync tenant ERP service catalog entries."

    def add_arguments(self, parser):
        parser.add_argument("--tenant-id", type=int, help="Tenant ID to sync Products & Services records for")
        parser.add_argument("--tenant-code", type=str, help="Tenant code to sync Products & Services records for")
        parser.add_argument(
            "--all-tenants",
            action="store_true",
            help="Sync Products & Services records for every tenant after seeding vehicle types",
        )

    def handle(self, *args, **options):
        if options["tenant_id"] and options["tenant_code"]:
            raise CommandError("Use either --tenant-id or --tenant-code, not both.")

        currency, _ = Currency.objects.get_or_create(
            code="KES",
            defaults={"name": "Kenyan Shilling", "symbol": "KES"},
        )

        created_vehicle_types = 0
        updated_vehicle_types = 0

        for row in VEHICLE_TYPES_DATA:
            vehicle_type, created = VehicleType.objects.get_or_create(
                name=row["name"],
                defaults={
                    "description": row["description"],
                    "charge": row["charge"],
                    "currency": currency,
                    "max_gross_weight": row["max_gross_weight"],
                    "max_tare_weight": row["max_tare_weight"],
                },
            )
            if created:
                created_vehicle_types += 1
            else:
                changed_fields = []
                for field in ("description", "charge", "max_gross_weight", "max_tare_weight"):
                    value = row[field]
                    if getattr(vehicle_type, field) != value:
                        setattr(vehicle_type, field, value)
                        changed_fields.append(field)
                if vehicle_type.currency_id != currency.id:
                    vehicle_type.currency = currency
                    changed_fields.append("currency")
                if changed_fields:
                    vehicle_type.save(update_fields=changed_fields)
                    updated_vehicle_types += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Vehicle types seeded: {created_vehicle_types} created, {updated_vehicle_types} updated."
            )
        )

        tenants = self._resolve_tenants(options)
        if not tenants:
            self.stdout.write("No tenant sync requested. Vehicle types were seeded without tenant product links.")
            return

        synced_products = 0
        for tenant in tenants:
            self.stdout.write(f"Syncing ERP services for tenant {tenant.id} ({tenant.code})...")
            for row in VEHICLE_TYPES_DATA:
                vehicle_type = VehicleType.objects.get(name=row["name"])
                Product.objects.update_or_create(
                    tenant=tenant,
                    code=_product_code_for_vehicle_type(vehicle_type.name),
                    defaults={
                        "name": f"Weighbridge Service - {vehicle_type.name}",
                        "description": vehicle_type.description or f"Weighbridge service for {vehicle_type.name}",
                        "product_type": "service",
                        "unit": "weighing",
                        "unit_price": vehicle_type.charge,
                        "tax_rate": Decimal("0.00"),
                        "is_active": True,
                    },
                )
                synced_products += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Tenant product sync complete: {synced_products} service records aligned across {len(tenants)} tenant(s)."
            )
        )

    def _resolve_tenants(self, options):
        if options["all_tenants"]:
            return list(Tenant.objects.order_by("id"))
        if options["tenant_id"]:
            return [Tenant.objects.get(id=options["tenant_id"])]
        if options["tenant_code"]:
            return [Tenant.objects.get(code=options["tenant_code"])]
        return []
