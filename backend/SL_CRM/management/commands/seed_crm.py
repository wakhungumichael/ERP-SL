from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from Platform_Core.models import Tenant, TenantUserProfile
from SL_CRM.models import Activity, Contact, Lead, Organisation, Supplier


CRM_ACCOUNTS = [
    {
        "name": "Nairobi Aggregates Ltd",
        "type": "customer",
        "industry": "Construction Materials",
        "website": "https://nairobiaggregates.example",
        "email": "ops@nairobiag.co.ke",
        "phone": "+254700100001",
        "address": "Industrial Area, Nairobi",
        "notes": "High-volume aggregates customer with monthly dispatch planning needs.",
        "contacts": [
            {"first_name": "Peter", "last_name": "Mwangi", "job_title": "Procurement Lead", "email": "peter.mwangi@nairobiag.co.ke", "phone": "+254722110001"},
            {"first_name": "Alice", "last_name": "Wanjiru", "job_title": "Finance Officer", "email": "alice.wanjiru@nairobiag.co.ke", "phone": "+254722110002"},
        ],
        "lead": {
            "title": "2026 Q3 bulk ballast supply program",
            "stage": "won",
            "value": Decimal("4200000.00"),
            "currency": "KES",
            "expected_close_in_days": -10,
            "notes": "Closed-won deal should feed straight into estimate, sales order, and fulfillment planning.",
        },
        "activities": [
            {"type": "meeting", "summary": "Commercial handoff meeting completed with dispatch and finance teams.", "days_offset": -12},
            {"type": "note", "summary": "Customer requested weekly release schedule tied to site consumption.", "days_offset": -9},
        ],
    },
    {
        "name": "Mombasa Logistics Co.",
        "type": "customer",
        "industry": "Transport & Logistics",
        "website": "https://mombasalogistics.example",
        "email": "fleet@mombasalog.co.ke",
        "phone": "+254700100002",
        "address": "Kilindini Rd, Mombasa",
        "notes": "Uses weighbridge and transport services with strong reconciliation requirements.",
        "contacts": [
            {"first_name": "Hassan", "last_name": "Ali", "job_title": "Fleet Manager", "email": "hassan.ali@mombasalog.co.ke", "phone": "+254722110003"},
        ],
        "lead": {
            "title": "Port transfer retainer renewal",
            "stage": "negotiation",
            "value": Decimal("1850000.00"),
            "currency": "KES",
            "expected_close_in_days": 8,
            "notes": "Pending credit review and route-based pricing confirmation.",
        },
        "activities": [
            {"type": "call", "summary": "Reviewed revised pricing after diesel adjustment.", "days_offset": -3},
            {"type": "task", "summary": "Send final negotiated rate card for director approval.", "days_offset": 1},
        ],
    },
    {
        "name": "East Africa Quarries Ltd",
        "type": "prospect",
        "industry": "Mining & Quarrying",
        "website": "https://eaquarries.example",
        "email": "accounts@eaquarries.co.ke",
        "phone": "+254700100004",
        "address": "Athi River",
        "notes": "Prospect evaluating shared stock visibility and dispatch billing controls.",
        "contacts": [
            {"first_name": "Grace", "last_name": "Mutua", "job_title": "Commercial Manager", "email": "grace.mutua@eaquarries.co.ke", "phone": "+254722110004"},
        ],
        "lead": {
            "title": "Integrated stock and dispatch rollout",
            "stage": "proposal",
            "value": Decimal("2950000.00"),
            "currency": "KES",
            "expected_close_in_days": 14,
            "notes": "Proposal is aligned to CRM-to-ERP workflow demonstration.",
        },
        "activities": [
            {"type": "email", "summary": "Shared proposal with shared item master and stock visibility scope.", "days_offset": -2},
        ],
    },
    {
        "name": "Metro Build Holdings",
        "type": "prospect",
        "industry": "Infrastructure",
        "website": "https://metrobuild.example",
        "email": "projects@metrobuild.example",
        "phone": "+254700200010",
        "address": "Upper Hill, Nairobi",
        "notes": "New account sourced from infrastructure tender network.",
        "contacts": [
            {"first_name": "Diana", "last_name": "Njeri", "job_title": "Project Buyer", "email": "diana.njeri@metrobuild.example", "phone": "+254722110005"},
        ],
        "lead": {
            "title": "Concrete materials onboarding",
            "stage": "contacted",
            "value": Decimal("980000.00"),
            "currency": "KES",
            "expected_close_in_days": 21,
            "notes": "Still qualifying branch, pricing, and credit policy requirements.",
        },
        "activities": [
            {"type": "call", "summary": "Initial discovery call captured branch setup and monthly demand estimate.", "days_offset": -5},
        ],
    },
]

SUPPLIERS = [
    {
        "name": "Crown Industrial Spares",
        "contact_person": "James Otieno",
        "email": "supply@crownspares.co.ke",
        "phone": "+254733880001",
        "address": "Enterprise Road, Nairobi",
        "payment_terms": "net_30",
        "account_number": "METRIX-CROWN-001",
        "notes": "Preferred maintenance spares supplier for weighbridge and loading equipment.",
    },
    {
        "name": "Total Energies Kenya",
        "contact_person": "Mercy Wambui",
        "email": "commercial@totalenergies.co.ke",
        "phone": "+254733880002",
        "address": "Mombasa Road, Nairobi",
        "payment_terms": "net_15",
        "account_number": "METRIX-TOTAL-002",
        "notes": "Fuel and lubricants supplier tied to transport and equipment operations.",
    },
]


class Command(BaseCommand):
    help = "Seed tenant-scoped CRM demo data and connect won deals to sales estimates and sales orders."

    def add_arguments(self, parser):
        parser.add_argument("--tenant-id", type=int, default=None)
        parser.add_argument("--tenant-code", type=str, default="demo-metrix")
        parser.add_argument("--clear", action="store_true", help="Clear CRM records for the tenant before seeding.")

    def handle(self, *args, **options):
        tenant = self._resolve_tenant(options)

        from Platform_Core.management.commands.seed_saas_demo import Command as SeedSaaSDemoCommand
        from SL_Sales.management.commands.seed_sales import Command as SeedSalesCommand
        from SL_Sales.models import Estimate, EstimateLineItem, Product, SalesOrder, SalesOrderLineItem
        from SL_Weighbridge.models import Branch, Customer

        SeedSaaSDemoCommand().handle(skip_sales_seed=False, clear_subscriptions=False)
        SeedSalesCommand().handle(tenant_id=tenant.id, clear=False)

        with transaction.atomic():
            branch = Branch.objects.filter(company__name=tenant.name).order_by("id").first()
            if branch is None:
                branch = Branch.objects.order_by("id").first()

            assigned_user = (
                TenantUserProfile.objects.filter(tenant=tenant, is_tenant_admin=True).select_related("user").first()
                or TenantUserProfile.objects.filter(tenant=tenant).select_related("user").first()
            )
            assigned_actor = assigned_user.user if assigned_user else User.objects.filter(is_superuser=True).first()

            if options["clear"]:
                Activity.objects.filter(tenant=tenant).delete()
                Lead.objects.filter(tenant=tenant).delete()
                Contact.objects.filter(tenant=tenant).delete()
                Supplier.objects.filter(tenant=tenant).delete()
                Organisation.objects.filter(tenant=tenant).delete()

            product_choices = list(Product.objects.filter(tenant=tenant, is_active=True).order_by("name")[:6])
            if not product_choices:
                raise CommandError("No products found for tenant after sales seed.")

            organisations_created = 0
            contacts_created = 0
            leads_created = 0
            activities_created = 0
            estimates_created = 0
            orders_created = 0

            for supplier_spec in SUPPLIERS:
                Supplier.objects.update_or_create(
                    tenant=tenant,
                    name=supplier_spec["name"],
                    defaults=supplier_spec,
                )

            for account_index, spec in enumerate(CRM_ACCOUNTS, start=1):
                customer = Customer.objects.filter(tenant=tenant, name__iexact=spec["name"]).order_by("id").first()
                if customer is None and spec["type"] == "customer":
                    customer = Customer.objects.create(
                        tenant=tenant,
                        name=spec["name"],
                        email=spec["email"],
                        address=spec["address"],
                        phone_number=spec["phone"],
                    )

                organisation, organisation_created = Organisation.objects.update_or_create(
                    tenant=tenant,
                    name=spec["name"],
                    defaults={
                        "type": spec["type"],
                        "industry": spec["industry"],
                        "website": spec["website"],
                        "email": spec["email"],
                        "phone": spec["phone"],
                        "address": spec["address"],
                        "notes": spec["notes"],
                        "weighbridge_customer": customer,
                    },
                )
                organisations_created += int(organisation_created)

                primary_contact = None
                for contact_index, contact_spec in enumerate(spec["contacts"], start=1):
                    contact, contact_created = Contact.objects.update_or_create(
                        tenant=tenant,
                        email=contact_spec["email"],
                        defaults={
                            **contact_spec,
                            "organisation": organisation,
                            "notes": f"Primary CRM contact for {organisation.name}.",
                        },
                    )
                    contacts_created += int(contact_created)
                    if contact_index == 1:
                        primary_contact = contact

                lead_spec = spec["lead"]
                lead, lead_created = Lead.objects.update_or_create(
                    tenant=tenant,
                    title=lead_spec["title"],
                    defaults={
                        "organisation": organisation,
                        "contact": primary_contact,
                        "stage": lead_spec["stage"],
                        "value": lead_spec["value"],
                        "currency": lead_spec["currency"],
                        "expected_close_date": timezone.localdate() + timedelta(days=lead_spec["expected_close_in_days"]),
                        "assigned_to": assigned_actor,
                        "notes": lead_spec["notes"],
                    },
                )
                leads_created += int(lead_created)

                for activity_spec in spec["activities"]:
                    activity, activity_created = Activity.objects.update_or_create(
                        tenant=tenant,
                        lead=lead,
                        summary=activity_spec["summary"],
                        defaults={
                            "type": activity_spec["type"],
                            "date": timezone.now() + timedelta(days=activity_spec["days_offset"]),
                            "contact": primary_contact,
                            "organisation": organisation,
                            "created_by": assigned_actor,
                        },
                    )
                    activities_created += int(activity_created)

                if lead.stage in {"proposal", "negotiation", "won"}:
                    estimate_number = f"EST-CRM-{tenant.id}-{account_index:03d}"
                    estimate, estimate_created = Estimate.objects.get_or_create(
                        tenant=tenant,
                        estimate_number=estimate_number,
                        defaults={
                            "branch": branch,
                            "customer": customer,
                            "customer_name": organisation.name,
                            "issue_date": timezone.localdate() - timedelta(days=4),
                            "expiry_date": timezone.localdate() + timedelta(days=21),
                            "status": "accepted" if lead.stage == "won" else "sent",
                            "notes": f"CRM-sourced estimate for lead '{lead.title}'.",
                            "terms": "Net 30 days. Subject to credit approval and stock availability.",
                            "created_by": assigned_actor,
                        },
                    )
                    estimates_created += int(estimate_created)
                    if estimate_created:
                        for line_index, product in enumerate(product_choices[:2], start=1):
                            EstimateLineItem.objects.create(
                                estimate=estimate,
                                product=product,
                                description=product.name,
                                quantity=Decimal(str(line_index * 5)),
                                unit_price=product.unit_price,
                                tax_rate=product.tax_rate,
                                sort_order=line_index,
                            )
                        estimate.recalculate()

                    if lead.stage == "won":
                        order_number = f"SO-CRM-{tenant.id}-{account_index:03d}"
                        order, order_created = SalesOrder.objects.get_or_create(
                            tenant=tenant,
                            order_number=order_number,
                            defaults={
                                "branch": branch,
                                "customer": customer,
                                "customer_name": organisation.name,
                                "estimate": estimate,
                                "order_date": timezone.localdate() - timedelta(days=2),
                                "expected_delivery_date": timezone.localdate() + timedelta(days=5),
                                "status": "confirmed",
                                "notes": f"Generated from CRM won opportunity '{lead.title}'.",
                                "terms": estimate.terms,
                                "created_by": assigned_actor,
                            },
                        )
                        orders_created += int(order_created)
                        if order_created:
                            for line_index, line in enumerate(estimate.line_items.all(), start=1):
                                SalesOrderLineItem.objects.create(
                                    sales_order=order,
                                    product=line.product,
                                    description=line.description,
                                    quantity=line.quantity,
                                    unit_price=line.unit_price,
                                    tax_rate=line.tax_rate,
                                    discount_amount=line.discount_amount,
                                    sort_order=line_index,
                                )
                            order.recalculate()
                        if estimate.converted_to_sales_order_id != order.id:
                            estimate.converted_to_sales_order = order
                            estimate.save(update_fields=["converted_to_sales_order", "updated_at"])

            summary = {
                "tenant": tenant.code,
                "organisations": Organisation.objects.filter(tenant=tenant).count(),
                "contacts": Contact.objects.filter(tenant=tenant).count(),
                "leads": Lead.objects.filter(tenant=tenant).count(),
                "activities": Activity.objects.filter(tenant=tenant).count(),
                "suppliers": Supplier.objects.filter(tenant=tenant).count(),
                "estimates": Estimate.objects.filter(tenant=tenant, estimate_number__startswith="EST-CRM-").count(),
                "sales_orders": SalesOrder.objects.filter(tenant=tenant, order_number__startswith="SO-CRM-").count(),
            }
            self.stdout.write(
                self.style.SUCCESS(
                    "CRM seed complete: "
                    f"{summary} "
                    f"(new organisations={organisations_created}, contacts={contacts_created}, "
                    f"leads={leads_created}, activities={activities_created}, "
                    f"estimates={estimates_created}, orders={orders_created})"
                )
            )

    def _resolve_tenant(self, options):
        tenant_id = options.get("tenant_id")
        tenant_code = (options.get("tenant_code") or "").strip()
        if tenant_id and tenant_code:
            raise CommandError("Use either --tenant-id or --tenant-code, not both.")
        if tenant_id:
            return Tenant.objects.get(pk=tenant_id)
        if tenant_code:
            return Tenant.objects.get(code=tenant_code)
        tenant = Tenant.objects.filter(code="demo-metrix").first()
        if tenant:
            return tenant
        tenant = Tenant.objects.order_by("id").first()
        if tenant:
            return tenant
        raise CommandError("No tenant found.")
