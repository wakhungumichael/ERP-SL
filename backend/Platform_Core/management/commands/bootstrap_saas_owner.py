import secrets
import string

from django.contrib.auth.models import Group, User
from django.core.management.base import BaseCommand
from django.db import transaction

from Platform_Core.management.commands.seed_platform import Command as SeedPlatformCommand
from Platform_Core.models import IntegrationEndpoint, Tenant, TenantBranch, TenantSettings, TenantUserProfile


def _generate_password(length=16):
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def ensure_tenant_settings(*, tenant, support_email, platform_name="Siakora Labs Platform"):
    settings_obj, _ = TenantSettings.objects.get_or_create(tenant=tenant)
    defaults = {
        "support_email": support_email,
        "primary_color": "#E85D26",
        "invoice_prefix": "INV",
        "footer_text": "Minimal ERP and subscription billing for growing SaaS operators.",
        "default_tax_name": "VAT",
        "default_payment_terms_days": 30,
        "login_page_config": {
            "eyebrow": "SaaS Billing Platform",
            "title": f"Welcome back to {tenant.name}",
            "subtitle": "Sign in to manage tenants, billing, subscriptions, and ERP operations.",
            "description": (
                "One workspace for product packaging, subscription billing, "
                "operations, finance, and customer lifecycle management."
            ),
        },
        "landing_page_config": {
            "headline": tenant.name,
            "subheadline": "A modern ERP and billing control center for subscriptions, collections, and operations.",
            "description": "Publish plans, manage subscriptions, and run the back office from one shared workspace.",
        },
        "footer_menu": [
            {"label": "Plans", "href": "/pricing"},
            {"label": "Sign In", "href": "/login"},
        ],
    }
    changed_fields = []
    for field, value in defaults.items():
        current_value = getattr(settings_obj, field)
        if current_value != value:
            setattr(settings_obj, field, value)
            changed_fields.append(field)
    if changed_fields:
        settings_obj.save(update_fields=changed_fields + ["updated_at"])
    return settings_obj


def ensure_saas_billing_gateway(*, tenant):
    gateway, _ = IntegrationEndpoint.objects.get_or_create(
        tenant=tenant,
        provider="mpesa",
        connection_settings__payment_scope="saas_billing",
        defaults={
            "name": "M-Pesa SaaS Billing",
            "integration_type": "payment",
            "transport": "http",
            "base_url": "https://sandbox.safaricom.co.ke",
            "auth_type": "api_key",
            "is_active": True,
            "is_primary": True,
            "timeout_seconds": 30,
            "credentials": {
                "consumer_key": "sandbox-consumer-key",
                "consumer_secret": "sandbox-consumer-secret",
                "passkey": "sandbox-passkey",
                "shortcode": "174379",
            },
            "connection_settings": {
                "payment_scope": "saas_billing",
                "environment": "sandbox",
                "sandbox": True,
                "enabled_rails": ["mobile_money"],
                "checkout_mode": "direct",
                "callback_mode": "simulated",
                "paybill_number": "174379",
                "account_reference_prefix": "SLERP",
                "notes": "Seeded M-Pesa sandbox gateway for SaaS subscription billing.",
            },
            "healthcheck_path": "/oauth/v1/generate?grant_type=client_credentials",
        },
    )
    defaults = {
        "name": "M-Pesa SaaS Billing",
        "integration_type": "payment",
        "transport": "http",
        "provider": "mpesa",
        "base_url": "https://sandbox.safaricom.co.ke",
        "auth_type": "api_key",
        "is_active": True,
        "is_primary": True,
        "timeout_seconds": 30,
        "credentials": {
            "consumer_key": "sandbox-consumer-key",
            "consumer_secret": "sandbox-consumer-secret",
            "passkey": "sandbox-passkey",
            "shortcode": "174379",
        },
        "connection_settings": {
            "payment_scope": "saas_billing",
            "environment": "sandbox",
            "sandbox": True,
            "enabled_rails": ["mobile_money"],
            "checkout_mode": "direct",
            "callback_mode": "simulated",
            "paybill_number": "174379",
            "account_reference_prefix": "SLERP",
            "notes": "Seeded M-Pesa sandbox gateway for SaaS subscription billing.",
        },
        "healthcheck_path": "/oauth/v1/generate?grant_type=client_credentials",
    }
    changed_fields = []
    for field, value in defaults.items():
        current_value = getattr(gateway, field)
        if current_value != value:
            setattr(gateway, field, value)
            changed_fields.append(field)
    if changed_fields:
        gateway.save(update_fields=changed_fields + ["updated_at"])
    return gateway


class Command(BaseCommand):
    help = (
        "Bootstrap the default SaaS owner workspace for Siakora Labs Limited, "
        "including platform seed data, default groups, owner tenant, branch, "
        "and default user accounts."
    )

    def add_arguments(self, parser):
        parser.add_argument("--company-name", default="Siakora Labs Limited")
        parser.add_argument("--tenant-code", default="siakora-labs")
        parser.add_argument("--contact-email", default="info@siakoralabs.co.ke")
        parser.add_argument("--branch-name", default="Head Office")
        parser.add_argument("--default-password", default="")
        parser.add_argument("--platform-admin-username", default="slabs")
        parser.add_argument("--platform-admin-email", default="info@siakoralabs.co.ke")
        parser.add_argument("--tenant-admin-username", default="siakora.admin")
        parser.add_argument("--tenant-admin-email", default="admin@siakoralabs.co.ke")
        parser.add_argument("--finance-username", default="siakora.finance")
        parser.add_argument("--finance-email", default="finance@siakoralabs.co.ke")
        parser.add_argument("--operator-username", default="siakora.ops")
        parser.add_argument("--operator-email", default="ops@siakoralabs.co.ke")

    def handle(self, *args, **options):
        SeedPlatformCommand().handle()

        default_password = (options.get("default_password") or "").strip()
        groups = {}
        for group_name in ("Tenant Admin", "Finance", "Operator"):
            group, _ = Group.objects.get_or_create(name=group_name)
            groups[group_name] = group

        account_passwords = {
            "platform_admin": default_password or _generate_password(),
            "tenant_admin": default_password or _generate_password(),
            "finance": default_password or _generate_password(),
            "operator": default_password or _generate_password(),
        }

        with transaction.atomic():
            tenant, tenant_created = Tenant.objects.get_or_create(
                code=options["tenant_code"],
                defaults={
                    "name": options["company_name"],
                    "legal_name": options["company_name"],
                    "contact_email": options["contact_email"],
                    "default_currency": "KES",
                    "timezone": "Africa/Nairobi",
                    "status": "active",
                    "is_active": True,
                },
            )
            if not tenant_created:
                changed = False
                for field, value in (
                    ("name", options["company_name"]),
                    ("legal_name", options["company_name"]),
                    ("contact_email", options["contact_email"]),
                    ("default_currency", "KES"),
                    ("timezone", "Africa/Nairobi"),
                    ("status", "active"),
                    ("is_active", True),
                ):
                    if getattr(tenant, field) != value:
                        setattr(tenant, field, value)
                        changed = True
                if changed:
                    tenant.save()

            branch, _ = TenantBranch.objects.get_or_create(
                tenant=tenant,
                name=options["branch_name"],
                defaults={
                    "email": options["contact_email"],
                    "phone": "",
                    "address": "",
                    "is_active": True,
                },
            )

            ensure_tenant_settings(
                tenant=tenant,
                support_email=options["contact_email"],
                platform_name=options["company_name"],
            )
            ensure_saas_billing_gateway(tenant=tenant)

            summary = []

            def ensure_user(*, key, username, email, first_name, last_name, is_superuser=False, group_name=None):
                user, created = User.objects.get_or_create(
                    username=username,
                    defaults={
                        "email": email,
                        "first_name": first_name,
                        "last_name": last_name,
                        "is_superuser": is_superuser,
                        "is_staff": is_superuser,
                        "is_active": True,
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

                if is_superuser and not user.is_superuser:
                    user.is_superuser = True
                    user.is_staff = True
                    changed = True

                if created or default_password:
                    user.set_password(account_passwords[key])
                    changed = True

                if changed:
                    user.save()

                if group_name:
                    user.groups.add(groups[group_name])
                    profile, _ = TenantUserProfile.objects.get_or_create(
                        user=user,
                        defaults={
                            "tenant": tenant,
                            "branch": branch,
                            "is_tenant_admin": group_name == "Tenant Admin",
                            "job_title": group_name,
                        },
                    )
                    profile_changed = False
                    if profile.tenant_id != tenant.id:
                        profile.tenant = tenant
                        profile_changed = True
                    if profile.branch_id != branch.id:
                        profile.branch = branch
                        profile_changed = True
                    should_be_admin = group_name == "Tenant Admin"
                    if profile.is_tenant_admin != should_be_admin:
                        profile.is_tenant_admin = should_be_admin
                        profile_changed = True
                    if not profile.job_title:
                        profile.job_title = group_name
                        profile_changed = True
                    if profile_changed:
                        profile.save()

                summary.append(
                    {
                        "username": username,
                        "email": email,
                        "password": account_passwords[key] if (created or default_password) else "(unchanged)",
                        "role": "Platform Superadmin" if is_superuser else group_name,
                    }
                )

            ensure_user(
                key="platform_admin",
                username=options["platform_admin_username"],
                email=options["platform_admin_email"],
                first_name="Siakora",
                last_name="Platform",
                is_superuser=True,
            )
            ensure_user(
                key="tenant_admin",
                username=options["tenant_admin_username"],
                email=options["tenant_admin_email"],
                first_name="Siakora",
                last_name="Admin",
                group_name="Tenant Admin",
            )
            ensure_user(
                key="finance",
                username=options["finance_username"],
                email=options["finance_email"],
                first_name="Siakora",
                last_name="Finance",
                group_name="Finance",
            )
            ensure_user(
                key="operator",
                username=options["operator_username"],
                email=options["operator_email"],
                first_name="Siakora",
                last_name="Operator",
                group_name="Operator",
            )

        self.stdout.write(self.style.SUCCESS("Bootstrap complete."))
        self.stdout.write(f"Owner tenant: {tenant.name} ({tenant.code})")
        self.stdout.write(f"Branch: {branch.name}")
        self.stdout.write("")
        self.stdout.write("Accounts:")
        for item in summary:
            self.stdout.write(
                f"  - {item['username']} | {item['email']} | {item['role']} | password: {item['password']}"
            )
