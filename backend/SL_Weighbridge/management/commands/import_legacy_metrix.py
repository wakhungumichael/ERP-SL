import json
from datetime import datetime
from decimal import Decimal
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from Platform_Core.models import Tenant, TenantBranch
from SL_Weighbridge.models import (
    Branch, Company, Currency, Customer, CustomerVehicleTypeDiscount, Item,
    Transaction, Vehicle, VehicleType, WeighingOperationType,
)


def rows(payload, table):
    return payload.get("tables", {}).get(table, [])


def as_datetime(value):
    return datetime.fromisoformat(value) if value else None


class Command(BaseCommand):
    help = "Import a portable export from the legacy Metrix weighbridge database."

    def add_arguments(self, parser):
        parser.add_argument("payload", type=Path)
        parser.add_argument("--tenant-code", required=True)
        parser.add_argument("--replace", action="store_true", help="Delete existing weighbridge data for this tenant first.")
        parser.add_argument("--apply", action="store_true", help="Execute the import. Without this flag, only validate and report.")

    def handle(self, *args, **options):
        payload_path = options["payload"]
        if not payload_path.is_file():
            raise CommandError(f"Payload not found: {payload_path}")
        payload = json.loads(payload_path.read_text(encoding="utf-8"))
        if payload.get("format") != "sl-erp-legacy-metrix-v1":
            raise CommandError("This is not a supported Metrix legacy export.")

        tenant = Tenant.objects.filter(code=options["tenant_code"]).first()
        if tenant is None:
            raise CommandError(f"Tenant code '{options['tenant_code']}' was not found.")

        summary = {
            "customers": len(rows(payload, "SL_Weighbridge_customer")),
            "vehicles": len(rows(payload, "SL_Weighbridge_vehicle")),
            "items": len(rows(payload, "SL_Weighbridge_item")),
            "discounts": len(rows(payload, "SL_Weighbridge_customervehicletypediscount")),
            "transactions": len(rows(payload, "SL_Weighbridge_transaction")),
        }
        self.stdout.write(self.style.WARNING(f"Metrix import for tenant '{tenant.code}': {summary}"))
        existing = {
            "transactions": Transaction.objects.filter(tenant=tenant).count(),
            "customers": Customer.objects.filter(tenant=tenant).count(),
            "vehicles": Vehicle.objects.filter(tenant=tenant).count(),
            "items": Item.objects.filter(tenant=tenant).count(),
        }
        if any(existing.values()) and not options["replace"]:
            raise CommandError(
                "Target tenant already has weighbridge data. Re-run with --replace only after confirming its backup. "
                f"Current counts: {existing}"
            )
        self._check_cross_tenant_conflicts(tenant, payload)
        if not options["apply"]:
            self.stdout.write(self.style.SUCCESS("Dry run passed. Re-run with --apply to import."))
            return

        with transaction.atomic():
            if options["replace"]:
                self._clear_tenant(tenant)
            self._import(tenant, payload)
        self.stdout.write(self.style.SUCCESS("Legacy Metrix data imported successfully."))

    def _check_cross_tenant_conflicts(self, tenant, payload):
        phones = [row["phone_number"] for row in rows(payload, "SL_Weighbridge_customer") if row.get("phone_number")]
        emails = [row["email"] for row in rows(payload, "SL_Weighbridge_customer") if row.get("email")]
        plates = [row["number_plate"] for row in rows(payload, "SL_Weighbridge_vehicle") if row.get("number_plate")]

        customer_conflicts = Customer.objects.exclude(tenant=tenant).filter(
            Q(phone_number__in=phones) | Q(email__in=emails)
        ).count()
        vehicle_conflicts = Vehicle.objects.exclude(tenant=tenant).filter(number_plate__in=plates).count()
        if customer_conflicts or vehicle_conflicts:
            raise CommandError(
                "Import stopped to prevent cross-tenant duplicates: "
                f"{customer_conflicts} customer conflict(s), {vehicle_conflicts} vehicle conflict(s)."
            )

    def _clear_tenant(self, tenant):
        Transaction.objects.filter(tenant=tenant).delete()
        CustomerVehicleTypeDiscount.objects.filter(customer__tenant=tenant).delete()
        Vehicle.objects.filter(tenant=tenant).delete()
        Customer.objects.filter(tenant=tenant).delete()
        Item.objects.filter(tenant=tenant).delete()
        VehicleType.objects.filter(tenant=tenant).delete()
        Currency.objects.filter(tenant=tenant).delete()
        Branch.objects.filter(tenant=tenant).delete()
        Company.objects.filter(tenant=tenant).delete()

    def _import(self, tenant, payload):
        currencies = {}
        companies = {}
        branches = {}
        customers = {}
        vehicle_types = {}
        vehicles = {}
        items = {}
        for source in rows(payload, "SL_Weighbridge_currency"):
            obj = Currency.objects.create(tenant=tenant, name=source["name"], code=source["code"], symbol=source["symbol"])
            currencies[source["id"]] = obj
        for source in rows(payload, "SL_Weighbridge_company"):
            obj = Company.objects.create(tenant=tenant, name=source["name"], address=source["address"], email=source["email"], phone=source["phone"])
            companies[source["id"]] = obj
        for source in rows(payload, "SL_Weighbridge_branch"):
            obj = Branch.objects.create(tenant=tenant, company=companies[source["company_id"]], name=source["name"], address=source["address"], email=source["email"], phone=source["phone"])
            TenantBranch.objects.update_or_create(
                tenant=tenant,
                name=obj.name,
                defaults={"address": obj.address, "email": obj.email, "phone": obj.phone, "is_active": True},
            )
            branches[source["id"]] = obj
        for source in rows(payload, "SL_Weighbridge_customer"):
            obj = Customer.objects.create(tenant=tenant, name=source["name"], address=source.get("address"), phone_number=source["phone_number"], email=source.get("email"), charge=Decimal(source["charge"]), discounted=source["discounted"], is_active=True, is_deleted=False)
            customers[source["id"]] = obj
        for source in rows(payload, "SL_Weighbridge_vehicletype"):
            obj = VehicleType.objects.create(tenant=tenant, name=source["name"], description=source.get("description"), charge=Decimal(source["charge"]), currency=currencies.get(source.get("currency_id")), max_gross_weight=source.get("max_gross_weight"), max_tare_weight=source.get("max_tare_weight"))
            vehicle_types[source["id"]] = obj
        for source in rows(payload, "SL_Weighbridge_vehicle"):
            obj = Vehicle.objects.create(tenant=tenant, customer=customers[source["customer_id"]], vehicle_type=vehicle_types[source["vehicle_type_id"]], number_plate=source["number_plate"], is_active=True)
            vehicles[source["id"]] = obj
        for source in rows(payload, "SL_Weighbridge_item"):
            obj = Item.objects.create(tenant=tenant, name=source["name"], description=source.get("description"), currency=currencies.get(source.get("currency_id")))
            items[source["id"]] = obj
        for source in rows(payload, "SL_Weighbridge_customervehicletypediscount"):
            CustomerVehicleTypeDiscount.objects.create(customer=customers[source["customer_id"]], vehicle_type=vehicle_types[source["vehicle_type_id"]], discounted_charge=Decimal(source["discounted_charge"]))

        first, _ = WeighingOperationType.objects.get_or_create(tenant=tenant, code="first-weight", defaults={"name": "First Weight", "flow_kind": "first", "is_default": True})
        second, _ = WeighingOperationType.objects.get_or_create(tenant=tenant, code="second-weight", defaults={"name": "Second Weight", "flow_kind": "second"})
        transactions = {}
        for source in rows(payload, "SL_Weighbridge_transaction"):
            operation_type = first if source["weight_type"] == "First Weight" else second
            captured_at = as_datetime(source.get("weight_date")) or timezone.now()
            obj = Transaction(
                tenant=tenant, branch=branches[source["branch_id"]], customer=customers[source["customer_id"]],
                vehicle=vehicles[source["vehicle_id"]], vehicle_type=vehicle_types[source["vehicle_type_id"]],
                item=items[source["item_id"]], operation_type=operation_type, operator=source["operator"],
                weight_type=source["weight_type"], gross_weight=source.get("gross_weight"), tare_weight=source.get("tare_weight"),
                net_weight=source.get("net_weight"), manual_weight_capture=source["manual_weight_capture"],
                discounted=source["discounted"], charge=Decimal(source["charge"]), destination=source["destination"],
                payment_mode=source["payment_mode"], payment_status=source["payment_status"],
                status="Draft" if source["status"] == "Pending" else source["status"], approval_status=source["approval_status"],
                weight_reason=source.get("weight_reason"), gross_weight_date=as_datetime(source.get("gross_weight_date")),
                tare_weight_date=as_datetime(source.get("tare_weight_date")), weight_date=captured_at,
                created_at=as_datetime(source.get("created_at")) or captured_at,
                updated_at=as_datetime(source.get("updated_at")) or captured_at,
            )
            # Historical values must not be recalculated using current pricing or weight limits.
            obj.save_base(using="default", force_insert=True, raw=True)
            transactions[source["id"]] = obj
        for source in rows(payload, "SL_Weighbridge_transaction"):
            if source.get("paired_first_transaction_id") in transactions:
                Transaction.objects.filter(pk=transactions[source["id"]].pk).update(paired_first_transaction=transactions[source["paired_first_transaction_id"]])
