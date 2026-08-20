import random
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from Platform_Core.models import Tenant, TenantUserProfile


CUSTOMERS = [
    {"name": "Nairobi Aggregates Ltd", "phone_number": "+254700100001", "email": "ops@nairobiag.co.ke", "address": "Industrial Area, Nairobi"},
    {"name": "Mombasa Logistics Co.", "phone_number": "+254700100002", "email": "fleet@mombasalog.co.ke", "address": "Kilindini Rd, Mombasa"},
    {"name": "Rift Valley Hauliers", "phone_number": "+254700100003", "email": "admin@rvhauliers.co.ke", "address": "Nakuru Town"},
    {"name": "East Africa Quarries Ltd", "phone_number": "+254700100004", "email": "accounts@eaquarries.co.ke", "address": "Athi River"},
    {"name": "Kisumu Stone Merchants", "phone_number": "+254700100005", "email": "ops@kisumustone.co.ke", "address": "Kisumu Port"},
    {"name": "Thika Road Builders", "phone_number": "+254700100006", "email": "site@thikabuilders.co.ke", "address": "Thika Town"},
]

ITEMS = [
    "Ballast (20mm)", "Gravel (14mm)", "Sand (River)", "Murram", "Hardcore",
    "Stone Aggregate", "Quarry Dust", "Cement Clinker",
]

VEHICLE_SPECS = [
    ("KAA 001A", "8 Wheeler"),
    ("KAB 234B", "10 Wheeler"),
    ("KBC 567C", "6 Wheeler"),
    ("KBD 890D", "4 Wheeler"),
    ("KBE 111E", "12 Wheeler"),
    ("KBF 222F", "22 Wheeler"),
    ("KBG 333G", "8 Wheeler"),
    ("KBH 444H", "10 Wheeler"),
]

DESTINATIONS = [
    "Nairobi CBD", "Industrial Area", "Athi River", "Thika", "Mombasa Port",
    "Kisumu", "Nakuru", "Eldoret",
]


def _tenant_demo_email(email, tenant):
    local, _, domain = (email or "").partition("@")
    if not local:
        local = f"tenant{tenant.id}"
    domain = domain or "example.test"
    return f"{local}+t{tenant.id}@{domain}"


def _tenant_demo_phone(phone_number, tenant, index):
    digits = "".join(ch for ch in str(phone_number or "") if ch.isdigit())
    if not digits:
        digits = "254700000000"
    tenant_suffix = f"{tenant.id:02d}{index:02d}"
    max_base_len = max(1, 20 - len(tenant_suffix))
    return f"{digits[:max_base_len]}{tenant_suffix}"


def _tenant_demo_plate(number_plate, tenant, index):
    cleaned = "".join(ch for ch in str(number_plate or "").upper() if ch.isalnum())
    if not cleaned:
        cleaned = "KXX000X"
    tenant_suffix = f"T{tenant.id}{index}"
    max_base_len = max(1, 20 - len(tenant_suffix))
    return f"{cleaned[:max_base_len]}{tenant_suffix}"


class Command(BaseCommand):
    help = "Seed a tenant workspace with weighbridge, invoicing, sales, purchases, and accounting demo data."

    def add_arguments(self, parser):
        parser.add_argument("--tenant-id", type=int, default=None)
        parser.add_argument("--tenant-code", type=str, default="")
        parser.add_argument("--clear", action="store_true", help="Clear tenant-specific workspace demo data before seeding.")
        parser.add_argument("--transactions", type=int, default=36)

    def handle(self, *args, **options):
        tenant = self._resolve_tenant(options)
        from Platform_Core.management.commands.seed_saas_demo import Command as SeedSaaSDemoCommand
        from SL_CRM.management.commands.seed_crm import Command as SeedCRMCommand
        from SL_Sales.management.commands.seed_sales import Command as SeedSalesCommand
        from Platform_API.modules.payments.views import create_draft_invoice_for_transaction
        from Platform_API.modules.weighbridge.views import _ensure_default_weighing_operation_types
        from SL_Weighbridge.sync import sync_vehicle_type_products_for_tenant
        from SL_Weighbridge.models import (
            Branch, Company, Currency, Customer, Invoice, Item,
            Transaction, Vehicle, VehicleType, WeighingOperationType,
        )
        from SL_Sales.models import Estimate, Product, RecurringInvoice, SalesOrder, SalesOrderLineItem

        # Ensure platform-level demo structures exist.
        SeedSaaSDemoCommand().handle(skip_sales_seed=True, clear_subscriptions=False)

        with transaction.atomic():
            currency, _ = Currency.objects.get_or_create(
                code="KES",
                defaults={"name": "Kenyan Shilling", "symbol": "KES"},
            )
            company, _ = Company.objects.get_or_create(
                name=tenant.name,
                defaults={
                    "address": tenant.legal_name or tenant.name,
                    "email": tenant.contact_email or f"admin@{tenant.code}.test",
                    "phone": "+254700000000",
                },
            )
            branch, _ = Branch.objects.get_or_create(
                name=f"{tenant.name} Main Yard",
                defaults={
                    "company": company,
                    "address": "Operations Yard",
                    "email": tenant.contact_email or f"yard@{tenant.code}.test",
                    "phone": "+254700000010",
                },
            )

            if options["clear"]:
                Invoice.objects.filter(tenant=tenant).delete()
                Transaction.objects.filter(tenant=tenant).delete()
                Vehicle.objects.filter(tenant=tenant).delete()
                Customer.objects.filter(tenant=tenant).delete()
                Item.objects.filter(id__in=Item.objects.filter(transaction__tenant=tenant).values_list("id", flat=True)).delete()

            _ensure_default_weighing_operation_types(tenant)
            op_types = {
                row.flow_kind: row
                for row in WeighingOperationType.objects.filter(tenant=tenant, is_active=True)
            }

            item_objs = []
            for name in ITEMS:
                item, _ = Item.objects.get_or_create(name=name, defaults={"currency": currency})
                item_objs.append(item)

            customer_objs = []
            for index, spec in enumerate(CUSTOMERS, start=1):
                tenant_phone = _tenant_demo_phone(spec["phone_number"], tenant, index)
                customer, _ = Customer.objects.get_or_create(
                    tenant=tenant,
                    phone_number=tenant_phone,
                    defaults={
                        "name": spec["name"],
                        "email": _tenant_demo_email(spec["email"], tenant),
                        "address": spec["address"],
                    },
                )
                customer_objs.append(customer)

            vehicle_type_map = {row.name: row for row in VehicleType.objects.all()}
            vehicle_objs = []
            for idx, (plate, vt_name) in enumerate(VEHICLE_SPECS):
                customer = customer_objs[idx % len(customer_objs)]
                tenant_plate = _tenant_demo_plate(plate, tenant, idx + 1)
                vehicle, _ = Vehicle.objects.get_or_create(
                    tenant=tenant,
                    number_plate=tenant_plate,
                    defaults={
                        "customer": customer,
                        "vehicle_type": vehicle_type_map[vt_name],
                    },
                )
                if vehicle.customer_id != customer.id or vehicle.vehicle_type_id != vehicle_type_map[vt_name].id:
                    vehicle.customer = customer
                    vehicle.vehicle_type = vehicle_type_map[vt_name]
                    vehicle.save(update_fields=["customer", "vehicle_type"])
                vehicle_objs.append(vehicle)

            operator_user = (
                TenantUserProfile.objects.filter(tenant=tenant, is_tenant_admin=False).select_related("user").first()
                or TenantUserProfile.objects.filter(tenant=tenant).select_related("user").first()
            )
            operator_name = operator_user.user.username if operator_user else "system"
            created_transactions = 0

            for i in range(options["transactions"]):
                vehicle = vehicle_objs[i % len(vehicle_objs)]
                customer = vehicle.customer
                vt = vehicle.vehicle_type
                item = item_objs[i % len(item_objs)]
                gross = min((vt.max_gross_weight or 24000), (vt.max_tare_weight or 7000) + random.randint(4000, 9000))
                tare = min((vt.max_tare_weight or 7000), max(1000, gross - random.randint(3500, 8000)))
                first_created = timezone.now() - timedelta(days=random.randint(0, 25), hours=random.randint(0, 12))

                first_tx = Transaction.objects.create(
                    tenant=tenant,
                    branch=branch,
                    customer=customer,
                    vehicle=vehicle,
                    operator=operator_name,
                    item=item,
                    vehicle_type=vt,
                    operation_type=op_types.get("first"),
                    gross_weight=gross,
                    tare_weight=0,
                    net_weight=0,
                    gross_weight_date=first_created,
                    status="Pending",
                    weight_type="First Weight",
                    payment_mode=random.choice(["Cash", "Mpesa", "Bank Deposit", "Debt"]),
                    payment_status="Pending",
                    destination=random.choice(DESTINATIONS),
                    manual_weight_capture=False,
                    created_by=operator_user.user if operator_user else None,
                )
                second_created = first_created + timedelta(minutes=random.randint(15, 120))
                second_tx = Transaction.objects.create(
                    tenant=tenant,
                    branch=branch,
                    customer=customer,
                    vehicle=vehicle,
                    operator=operator_name,
                    item=item,
                    vehicle_type=vt,
                    operation_type=op_types.get("second"),
                    gross_weight=gross,
                    tare_weight=tare,
                    net_weight=abs(gross - tare),
                    gross_weight_date=first_created,
                    tare_weight_date=second_created,
                    status="Completed",
                    weight_type="Second Weight",
                    payment_mode=first_tx.payment_mode,
                    payment_status="Pending",
                    destination=first_tx.destination,
                    paired=True,
                    paired_first_transaction=first_tx,
                    manual_weight_capture=False,
                    created_by=operator_user.user if operator_user else None,
                )

                first_tx.tare_weight = tare
                first_tx.net_weight = abs(gross - tare)
                first_tx.status = "Completed"
                first_tx.paired = True
                first_tx.tare_weight_date = second_created
                first_tx.save(update_fields=["tare_weight", "net_weight", "status", "paired", "tare_weight_date", "updated_at"])
                create_draft_invoice_for_transaction(first_tx)
                created_transactions += 2

            # Create a couple of single-weight / axle transactions for testing alt flows.
            single_customer = customer_objs[0]
            single_vehicle = vehicle_objs[0]
            single_item = item_objs[0]
            single_tx = Transaction.objects.create(
                tenant=tenant,
                branch=branch,
                customer=single_customer,
                vehicle=single_vehicle,
                operator=operator_name,
                item=single_item,
                vehicle_type=single_vehicle.vehicle_type,
                operation_type=op_types.get("single"),
                gross_weight=12000,
                tare_weight=4500,
                net_weight=7500,
                gross_weight_date=timezone.now() - timedelta(days=1),
                tare_weight_date=timezone.now() - timedelta(days=1),
                status="Completed",
                weight_type="First Weight",
                payment_mode="Cash",
                payment_status="Paid",
                destination="Single Weight Demo",
                paired=False,
            )
            create_draft_invoice_for_transaction(single_tx)
            axle_tx = Transaction.objects.create(
                tenant=tenant,
                branch=branch,
                customer=single_customer,
                vehicle=single_vehicle,
                operator=operator_name,
                item=single_item,
                vehicle_type=single_vehicle.vehicle_type,
                operation_type=op_types.get("axle"),
                gross_weight=18000,
                tare_weight=6000,
                net_weight=12000,
                gross_weight_date=timezone.now() - timedelta(hours=8),
                tare_weight_date=timezone.now() - timedelta(hours=8),
                status="Completed",
                weight_type="First Weight",
                payment_mode="Mpesa",
                payment_status="Pending",
                destination="Axle Demo",
                paired=False,
            )
            create_draft_invoice_for_transaction(axle_tx)

        # Sales / Procurement / Accounting demo
        SeedSalesCommand().handle(tenant_id=tenant.id, clear=options["clear"])
        SeedCRMCommand().handle(tenant_id=tenant.id, tenant_code="", clear=False)
        sync_vehicle_type_products_for_tenant(tenant)

        # Create sales orders from a subset of estimates if missing
        from SL_Sales.models import SalesOrder
        estimates = list(Estimate.objects.filter(tenant=tenant).order_by("-created_at")[:4])
        created_orders = 0
        existing_order_count = SalesOrder.objects.filter(tenant=tenant).count()
        for seq, est in enumerate(estimates, start=1):
            if est.converted_to_sales_order_id:
                continue
            order = SalesOrder.objects.create(
                tenant=tenant,
                branch=branch,
                customer=est.customer,
                customer_name=est.customer_name,
                estimate=est,
                order_number=f"SO-SEED-{tenant.id}-{existing_order_count + seq:04d}",
                order_date=timezone.now().date(),
                expected_delivery_date=timezone.now().date() + timedelta(days=7),
                status="confirmed",
                notes=f"Seeded from estimate {est.estimate_number}",
                terms=est.terms,
                created_by=User.objects.filter(username=operator_name).first(),
            )
            for idx, line in enumerate(est.line_items.all()):
                SalesOrderLineItem.objects.create(
                    sales_order=order,
                    product=line.product,
                    description=line.description or getattr(line.product, "name", ""),
                    quantity=line.quantity,
                    unit_price=line.unit_price,
                    tax_rate=line.tax_rate,
                    discount_amount=line.discount_amount,
                    sort_order=idx,
                )
            order.recalculate()
            est.converted_to_sales_order = order
            est.save(update_fields=["converted_to_sales_order", "updated_at"])
            created_orders += 1

        summary = {
            "tenant": tenant.code,
            "transactions": __import__("SL_Weighbridge.models", fromlist=["Transaction"]).Transaction.objects.filter(tenant=tenant).count(),
            "customers": __import__("SL_Weighbridge.models", fromlist=["Customer"]).Customer.objects.filter(tenant=tenant).count(),
            "vehicles": __import__("SL_Weighbridge.models", fromlist=["Vehicle"]).Vehicle.objects.filter(tenant=tenant).count(),
            "invoices": __import__("SL_Weighbridge.models", fromlist=["Invoice"]).Invoice.objects.filter(tenant=tenant).count(),
            "products": Product.objects.filter(tenant=tenant).count(),
            "estimates": Estimate.objects.filter(tenant=tenant).count(),
            "sales_orders": SalesOrder.objects.filter(tenant=tenant).count(),
            "recurring_invoices": RecurringInvoice.objects.filter(tenant=tenant).count(),
        }
        self.stdout.write(self.style.SUCCESS(f"Workspace seed complete: {summary}"))

    def _resolve_tenant(self, options):
        tenant_id = options.get("tenant_id")
        tenant_code = (options.get("tenant_code") or "").strip()
        if tenant_id and tenant_code:
            raise CommandError("Use either --tenant-id or --tenant-code, not both.")
        if tenant_id:
            return Tenant.objects.get(pk=tenant_id)
        if tenant_code:
            return Tenant.objects.get(code=tenant_code)
        tenant = Tenant.objects.filter(code="metrix-weighbridge-solutions-ltd").first()
        if tenant:
            return tenant
        tenant = Tenant.objects.order_by("id").first()
        if tenant:
            return tenant
        raise CommandError("No tenant found.")
