from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import Group, User
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from Platform_Core.management.commands.bootstrap_saas_owner import (
    Command as BootstrapOwnerCommand,
    ensure_tenant_settings,
)
from Platform_Core.management.commands.seed_platform import Command as SeedPlatformCommand
from Platform_Core.models import Industry, Tenant, TenantBranch, TenantSubscription, TenantUserProfile, SubscriptionPlan
from Platform_Core.platform import sync_subscription_modules


DEMO_TENANTS = [
    {
        "code": "demo-metrix",
        "name": "Metrix Weighbridge Demo",
        "legal_name": "Metrix Weighbridge Demo Limited",
        "contact_email": "admin@metrix-demo.co.ke",
        "subdomain": "metrix-demo",
        "industry_slug": "logistics-transport",
        "plan_code": "enterprise",
        "demo_days": 30,
        "branch_name": "Main Yard",
        "admin": {
            "username": "metrix.admin",
            "email": "admin@metrix-demo.co.ke",
            "first_name": "Metrix",
            "last_name": "Admin",
        },
        "finance": {
            "username": "metrix.finance",
            "email": "finance@metrix-demo.co.ke",
            "first_name": "Metrix",
            "last_name": "Finance",
        },
        "operator": {
            "username": "metrix.ops",
            "email": "ops@metrix-demo.co.ke",
            "first_name": "Metrix",
            "last_name": "Operator",
        },
    },
    {
        "code": "demo-savannah",
        "name": "Savannah Logistics Demo",
        "legal_name": "Savannah Logistics Demo Limited",
        "contact_email": "admin@savannah-demo.co.ke",
        "subdomain": "savannah-demo",
        "industry_slug": "logistics-transport",
        "plan_code": "professional",
        "demo_days": 21,
        "branch_name": "Operations Hub",
        "admin": {
            "username": "savannah.admin",
            "email": "admin@savannah-demo.co.ke",
            "first_name": "Savannah",
            "last_name": "Admin",
        },
        "finance": {
            "username": "savannah.finance",
            "email": "finance@savannah-demo.co.ke",
            "first_name": "Savannah",
            "last_name": "Finance",
        },
        "operator": {
            "username": "savannah.ops",
            "email": "ops@savannah-demo.co.ke",
            "first_name": "Savannah",
            "last_name": "Operator",
        },
    },
]


class Command(BaseCommand):
    help = (
        "Seed SaaS demo data: bootstrap Siakora Labs owner accounts, create demo tenants, "
        "provision subscriptions with synced module activations, and optionally seed tenant business data."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--default-password",
            default="",
            help="Apply one shared password to all created demo users. If omitted, existing passwords are preserved.",
        )
        parser.add_argument(
            "--skip-sales-seed",
            action="store_true",
            help="Create tenants, users, and subscriptions only; skip tenant business data seeding.",
        )
        parser.add_argument(
            "--clear-subscriptions",
            action="store_true",
            help="Delete existing subscriptions for the demo tenant codes before re-seeding them.",
        )

    def handle(self, *args, **options):
        SeedPlatformCommand().handle()
        BootstrapOwnerCommand().handle(
            company_name="Siakora Labs Limited",
            tenant_code="siakora-labs",
            contact_email="info@siakoralabs.co.ke",
            branch_name="Head Office",
            default_password=options.get("default_password") or "",
            platform_admin_username="slabs",
            platform_admin_email="info@siakoralabs.co.ke",
            tenant_admin_username="siakora.admin",
            tenant_admin_email="admin@siakoralabs.co.ke",
            finance_username="siakora.finance",
            finance_email="finance@siakoralabs.co.ke",
            operator_username="siakora.ops",
            operator_email="ops@siakoralabs.co.ke",
        )

        tenant_admin_group, _ = Group.objects.get_or_create(name="Tenant Admin")
        finance_group, _ = Group.objects.get_or_create(name="Finance")
        operator_group, _ = Group.objects.get_or_create(name="Operator")

        sales_seed_command = None
        if not options["skip_sales_seed"]:
            from SL_Sales.management.commands.seed_sales import Command as SeedSalesCommand
            sales_seed_command = SeedSalesCommand()

        with transaction.atomic():
            for spec in DEMO_TENANTS:
                industry = Industry.objects.filter(slug=spec.get("industry_slug")).first()
                tenant, _ = Tenant.objects.get_or_create(
                    code=spec["code"],
                    defaults={
                        "name": spec["name"],
                        "legal_name": spec["legal_name"],
                        "subdomain": spec["subdomain"],
                        "contact_email": spec["contact_email"],
                        "industry": industry,
                        "default_currency": "KES",
                        "timezone": "Africa/Nairobi",
                        "status": "active",
                        "is_active": True,
                    },
                )

                changed = False
                for field, value in (
                    ("name", spec["name"]),
                    ("legal_name", spec["legal_name"]),
                    ("contact_email", spec["contact_email"]),
                    ("industry", industry),
                    ("default_currency", "KES"),
                    ("timezone", "Africa/Nairobi"),
                    ("status", "active"),
                    ("is_active", True),
                    ("subdomain", spec["subdomain"]),
                ):
                    if getattr(tenant, field) != value:
                        setattr(tenant, field, value)
                        changed = True
                if changed:
                    tenant.save()

                branch, _ = TenantBranch.objects.get_or_create(
                    tenant=tenant,
                    name=spec["branch_name"],
                    defaults={
                        "email": spec["contact_email"],
                        "phone": "",
                        "address": "",
                        "is_active": True,
                    },
                )
                ensure_tenant_settings(
                    tenant=tenant,
                    support_email=spec["contact_email"],
                    platform_name=spec["name"],
                )

                self._ensure_user(
                    tenant=tenant,
                    branch=branch,
                    group=tenant_admin_group,
                    is_tenant_admin=True,
                    default_password=options.get("default_password") or "",
                    **spec["admin"],
                )
                self._ensure_user(
                    tenant=tenant,
                    branch=branch,
                    group=finance_group,
                    is_tenant_admin=False,
                    default_password=options.get("default_password") or "",
                    **spec["finance"],
                )
                self._ensure_user(
                    tenant=tenant,
                    branch=branch,
                    group=operator_group,
                    is_tenant_admin=False,
                    default_password=options.get("default_password") or "",
                    **spec["operator"],
                )

                plan = SubscriptionPlan.objects.get(code=spec["plan_code"])

                if options["clear_subscriptions"]:
                    TenantSubscription.objects.filter(tenant=tenant).delete()

                start_date = timezone.localdate()
                demo_days = int(spec["demo_days"])
                end_date = start_date + timedelta(days=demo_days) if demo_days > 0 else None
                defaults = {
                    "status": "trial" if demo_days > 0 else "active",
                    "start_date": start_date,
                    "end_date": end_date,
                    "amount": Decimal(plan.price),
                    "currency": plan.currency,
                    "metadata": {"demo_days": demo_days, "seeded_by": "seed_saas_demo"},
                }

                subscription, created = TenantSubscription.objects.get_or_create(
                    tenant=tenant,
                    plan=plan,
                    defaults=defaults,
                )
                if not created:
                    updated = False
                    for field, value in defaults.items():
                        if getattr(subscription, field) != value:
                            setattr(subscription, field, value)
                            updated = True
                    if updated:
                        subscription.save()

                sync_result = sync_subscription_modules(subscription)
                self.stdout.write(
                    f"Tenant {tenant.code}: subscription={subscription.id} plan={plan.code} "
                    f"status={subscription.status} demo_days={demo_days} "
                    f"modules_created={sync_result['created']} modules_updated={sync_result['updated']}"
                )

        if sales_seed_command:
            for spec in DEMO_TENANTS:
                tenant = Tenant.objects.get(code=spec["code"])
                sales_seed_command.handle(tenant_id=tenant.id, clear=False)

        self.stdout.write(self.style.SUCCESS("SaaS demo data seeded successfully."))

    def _ensure_user(
        self,
        *,
        tenant,
        branch,
        group,
        is_tenant_admin,
        username,
        email,
        first_name,
        last_name,
        default_password,
    ):
        user, created = User.objects.get_or_create(
            username=username,
            defaults={
                "email": email,
                "first_name": first_name,
                "last_name": last_name,
                "is_active": True,
                "is_staff": False,
                "is_superuser": False,
            },
        )

        changed = False
        for field, value in (
            ("email", email),
            ("first_name", first_name),
            ("last_name", last_name),
            ("is_active", True),
        ):
            if getattr(user, field) != value:
                setattr(user, field, value)
                changed = True

        if created and default_password:
            user.set_password(default_password)
            changed = True
        elif created and not default_password:
            user.set_password("Demo@12345")
            changed = True

        if changed:
            user.save()

        user.groups.add(group)
        profile, _ = TenantUserProfile.objects.get_or_create(
            user=user,
            defaults={
                "tenant": tenant,
                "branch": branch,
                "is_tenant_admin": is_tenant_admin,
                "job_title": group.name,
            },
        )

        profile_changed = False
        if profile.tenant_id != tenant.id:
            profile.tenant = tenant
            profile_changed = True
        if profile.branch_id != branch.id:
            profile.branch = branch
            profile_changed = True
        if profile.is_tenant_admin != is_tenant_admin:
            profile.is_tenant_admin = is_tenant_admin
            profile_changed = True
        if profile.job_title != group.name:
            profile.job_title = group.name
            profile_changed = True
        if profile_changed:
            profile.save()
