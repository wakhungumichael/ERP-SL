from datetime import timedelta

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from Platform_Core.models import OrganizationMembership, Tenant, TenantUserProfile
from SL_Ticketing.models import (
    Ticket,
    TicketEvent,
    TicketFormSchema,
    TicketMessage,
    TicketRoutingRule,
    TicketingApiKey,
    TicketingInboxConfig,
    TicketingWebhookEndpoint,
)


DEMO_TENANT_CODES = [
    "default",
    "demo",
    "demo-metrix",
    "demo-savannah",
    "siakora-labs",
]


def demo_token(tenant_code: str, key_type: str) -> str:
    safe_code = tenant_code.replace("-", "_")
    prefix = "stp" if key_type == "public" else "sts"
    return f"{prefix}_demo_{safe_code}_{key_type}"


FORM_SCHEMAS = [
    {
        "name": "Default Support Form",
        "description": "Standard website support intake for general issues, billing, and technical cases.",
        "is_default": True,
        "is_public": True,
        "allowed_mime_types": ["image/png", "image/jpeg", "application/pdf"],
        "max_file_size_mb": 10,
        "schema": {
            "fields": [
                {"key": "requester_name", "type": "text", "label": "Full Name", "required": True},
                {"key": "requester_email", "type": "email", "label": "Email Address", "required": True},
                {"key": "subject", "type": "text", "label": "Subject", "required": True},
                {
                    "key": "category",
                    "type": "select",
                    "label": "Category",
                    "required": True,
                    "options": ["billing", "technical", "account", "general"],
                },
                {"key": "description", "type": "textarea", "label": "Tell us what happened", "required": True},
            ]
        },
    },
    {
        "name": "Partner Escalation Form",
        "description": "Escalation path for channel partners and B2B customers.",
        "is_default": False,
        "is_public": True,
        "allowed_mime_types": ["application/pdf", "text/plain"],
        "max_file_size_mb": 15,
        "schema": {
            "fields": [
                {"key": "requester_name", "type": "text", "label": "Contact Name", "required": True},
                {"key": "requester_email", "type": "email", "label": "Work Email", "required": True},
                {"key": "company_name", "type": "text", "label": "Company", "required": True},
                {"key": "subject", "type": "text", "label": "Escalation Subject", "required": True},
                {
                    "key": "priority",
                    "type": "select",
                    "label": "Priority",
                    "required": True,
                    "options": ["normal", "high", "urgent"],
                },
                {"key": "description", "type": "textarea", "label": "Context", "required": True},
            ]
        },
    },
]


ROUTING_RULES = [
    {
        "name": "Urgent Billing Queue",
        "priority": 10,
        "conditions": {"category": "billing", "priority": "urgent"},
        "target_status": "open",
    },
    {
        "name": "Technical Incidents",
        "priority": 20,
        "conditions": {"category": "technical"},
        "target_status": "pending",
    },
]


WEBHOOKS = [
    {
        "name": "Support Automation Bridge",
        "target_url": "https://example.com/hooks/ticketing-support",
        "subscribed_events": ["ticket.created", "ticket.status_changed"],
    },
    {
        "name": "BI Sync Endpoint",
        "target_url": "https://example.com/hooks/ticketing-bi",
        "subscribed_events": ["ticket.created"],
    },
]


TICKETS = [
    {
        "subject": "Invoice generated with the wrong company address",
        "requester_name": "Agnes Wanjiku",
        "requester_email": "agnes.wanjiku@example.com",
        "requester_phone": "+254711000111",
        "category": "billing",
        "priority": "urgent",
        "status": "open",
        "description": "The August invoice is showing the retired branch address and needs a corrected reissue.",
        "source_page": "/billing/invoices",
        "source_channel": "widget",
        "external_reference": "BILL-2026-0819-14",
        "custom_fields": {"account_code": "CUST-0042", "region": "Nairobi"},
        "timeline": [
            ("requester", "We spotted the address issue during approval and need the invoice corrected today."),
            ("agent", "We have queued the correction and finance is validating the tenant billing profile."),
        ],
    },
    {
        "subject": "Support portal users cannot download weighbridge receipts",
        "requester_name": "James Kiptoo",
        "requester_email": "j.kiptoo@example.com",
        "requester_phone": "+254722000222",
        "category": "technical",
        "priority": "high",
        "status": "pending",
        "description": "Receipt downloads fail after login for external customers using the support portal.",
        "source_page": "/portal/receipts",
        "source_channel": "api",
        "external_reference": "TECH-2026-0818-03",
        "custom_fields": {"browser": "Chrome", "environment": "production"},
        "timeline": [
            ("requester", "Customers can see the receipt list but the PDF button loops forever."),
            ("agent", "Engineering has reproduced the issue and linked it to a missing document renderer permission."),
            ("system", "Status changed to pending while awaiting deployment window."),
        ],
    },
    {
        "subject": "Need onboarding help for new branch agents",
        "requester_name": "Mercy Atieno",
        "requester_email": "mercy.atieno@example.com",
        "requester_phone": "+254733000333",
        "category": "account",
        "priority": "normal",
        "status": "resolved",
        "description": "Please share the quickest path to onboard three operators for the Kisumu branch this week.",
        "source_page": "/platform/users",
        "source_channel": "widget",
        "external_reference": "ACC-2026-0817-09",
        "custom_fields": {"branch": "Kisumu", "requested_seats": 3},
        "timeline": [
            ("requester", "We need the staff provisioned before Thursday and would like a simple checklist."),
            ("agent", "Shared the onboarding checklist and tenant admin steps for inviting the new operators."),
            ("system", "Ticket marked resolved after the requester confirmed the instructions worked."),
        ],
    },
    {
        "subject": "How do we add our branded colors to the public widget?",
        "requester_name": "Peter Mworia",
        "requester_email": "peter.mworia@example.com",
        "requester_phone": "+254744000444",
        "category": "general",
        "priority": "low",
        "status": "closed",
        "description": "The team wants the embedded ticket form to match our website colors and support email branding.",
        "source_page": "/ticketing/settings",
        "source_channel": "api",
        "external_reference": "GEN-2026-0815-21",
        "custom_fields": {"theme_request": True},
        "timeline": [
            ("requester", "Can we control the colors and button text for the embedded widget?"),
            ("agent", "Yes, we pointed you to the tenant branding and widget settings area inside the ERP."),
            ("system", "Requester closed the ticket after applying the branding settings."),
        ],
    },
]


class Command(BaseCommand):
    help = "Seed demo ticketing data for demo tenants or a specific tenant."

    def add_arguments(self, parser):
        parser.add_argument(
            "--tenant-code",
            dest="tenant_code",
            help="Seed a specific tenant code instead of the default demo tenant set.",
        )
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete existing ticketing demo data for the selected tenants before reseeding.",
        )

    def handle(self, *args, **options):
        tenant_code = options.get("tenant_code")
        reset = options.get("reset", False)

        if tenant_code:
            tenants = list(Tenant.objects.filter(code=tenant_code, is_active=True))
            if not tenants:
                raise CommandError(f"No active tenant found for code '{tenant_code}'.")
        else:
            tenants = list(Tenant.objects.filter(code__in=DEMO_TENANT_CODES, is_active=True).order_by("name"))
            if not tenants:
                raise CommandError("No active demo tenants found for ticketing seed.")

        seeded_summary = []
        for tenant in tenants:
            summary = self._seed_tenant(tenant, reset=reset)
            seeded_summary.append(summary)

        total_tickets = sum(item["tickets"] for item in seeded_summary)
        total_forms = sum(item["forms"] for item in seeded_summary)
        self.stdout.write(
            self.style.SUCCESS(
                f"Ticketing demo seed complete for {len(seeded_summary)} tenant(s): "
                f"{total_forms} forms, {total_tickets} tickets, "
                f"{sum(item['rules'] for item in seeded_summary)} routing rules, "
                f"{sum(item['webhooks'] for item in seeded_summary)} webhooks."
            )
        )
        for item in seeded_summary:
            self.stdout.write(
                f" - {item['tenant_code']}: {item['forms']} forms, {item['tickets']} tickets, {item['keys']} keys"
            )

    def _seed_tenant(self, tenant, reset=False):
        if reset:
            TicketWebhookDelivery = TicketingWebhookEndpoint.deliveries.rel.related_model
            TicketWebhookDelivery.objects.filter(ticket__tenant=tenant).delete()
            TicketMessage.objects.filter(ticket__tenant=tenant).delete()
            TicketEvent.objects.filter(ticket__tenant=tenant).delete()
            Ticket.objects.filter(tenant=tenant).delete()
            TicketRoutingRule.objects.filter(tenant=tenant).delete()
            TicketingWebhookEndpoint.objects.filter(tenant=tenant).delete()
            TicketFormSchema.objects.filter(tenant=tenant).delete()
            TicketingApiKey.objects.filter(tenant=tenant).delete()
            TicketingInboxConfig.objects.filter(tenant=tenant).delete()

        config, _ = TicketingInboxConfig.objects.get_or_create(
            tenant=tenant,
            defaults={
                "allowed_domains": [
                    f"https://support.{tenant.code}.example.com",
                    "https://portal.siakora.com",
                    "http://localhost:5173",
                    "http://127.0.0.1:5173",
                ],
                "portal_access_policy": "email_match",
                "brand_settings": {
                    "brand_color": "#E85D26",
                    "support_email": f"support@{tenant.code}.example.com",
                },
                "widget_settings": {
                    "headline": f"{tenant.name} Support Desk",
                    "intro_text": "Tell us what happened and our support team will follow up with the right next step.",
                    "submit_label": "Create Support Ticket",
                },
                "require_cors_origin": False,
                "allow_anonymous_tracking": True,
                "allow_requester_close": True,
            },
        )
        config.allowed_domains = list(
            dict.fromkeys(
                [
                    *list(config.allowed_domains or []),
                    "http://localhost:5173",
                    "http://127.0.0.1:5173",
                ]
            )
        )
        config.brand_settings = {
            **(config.brand_settings or {}),
            "brand_color": "#E85D26" if str((config.brand_settings or {}).get("brand_color", "")).strip() == "" else (config.brand_settings or {}).get("brand_color"),
            "support_email": (config.brand_settings or {}).get("support_email") or f"support@{tenant.code}.example.com",
        }
        config.widget_settings = {
            **(config.widget_settings or {}),
            "headline": (config.widget_settings or {}).get("headline") or f"{tenant.name} Support Desk",
            "intro_text": (config.widget_settings or {}).get("intro_text") or "Tell us what happened and our support team will follow up with the right next step.",
            "submit_label": (config.widget_settings or {}).get("submit_label") or "Create Support Ticket",
        }
        config.require_cors_origin = False
        config.allow_anonymous_tracking = True
        config.allow_requester_close = True
        config.save()

        users = self._candidate_users(tenant)
        assignee = users[0] if users else None

        form_count = 0
        form_lookup = {}
        for payload in FORM_SCHEMAS:
            form, _ = TicketFormSchema.objects.update_or_create(
                tenant=tenant,
                name=payload["name"],
                defaults=payload,
            )
            form_lookup[form.name] = form
            form_count += 1

        rule_count = 0
        for payload in ROUTING_RULES:
            defaults = dict(payload)
            defaults["assign_to"] = assignee
            TicketRoutingRule.objects.update_or_create(
                tenant=tenant,
                name=payload["name"],
                defaults=defaults,
            )
            rule_count += 1

        webhook_count = 0
        for payload in WEBHOOKS:
            TicketingWebhookEndpoint.objects.update_or_create(
                tenant=tenant,
                name=payload["name"],
                defaults=payload,
            )
            webhook_count += 1

        key_count = 0
        for key_type, name in (
            ("public", "Public Demo Widget Key"),
            ("secret", "Secret Demo Export Key"),
        ):
            raw_token = demo_token(tenant.code, key_type)
            TicketingApiKey.objects.update_or_create(
                tenant=tenant,
                name=name,
                key_type=key_type,
                defaults={
                    "token_prefix": raw_token[:18],
                    "token_hash": TicketingApiKey.hash_token(raw_token),
                    "metadata": {
                        "seeded_demo": True,
                        "raw_token": raw_token,
                    },
                    "is_active": True,
                    "revoked_at": None,
                },
            )
            key_count += 1

        ticket_count = 0
        now = timezone.now()
        default_form = form_lookup.get("Default Support Form")
        for index, payload in enumerate(TICKETS):
            ticket, created = Ticket.objects.get_or_create(
                tenant=tenant,
                subject=payload["subject"],
                requester_email=payload["requester_email"],
                defaults={
                    "form_schema": default_form,
                    "requester_name": payload["requester_name"],
                    "requester_phone": payload["requester_phone"],
                    "category": payload["category"],
                    "priority": payload["priority"],
                    "status": payload["status"],
                    "description": payload["description"],
                    "source_page": payload["source_page"],
                    "source_channel": payload["source_channel"],
                    "external_reference": payload["external_reference"],
                    "custom_fields": payload["custom_fields"],
                    "assigned_to": assignee,
                },
            )
            if created:
                created_at = now - timedelta(days=4 - index, hours=index + 1)
                Ticket.objects.filter(pk=ticket.pk).update(created_at=created_at, updated_at=created_at + timedelta(hours=2))
                ticket.refresh_from_db()
                self._seed_ticket_timeline(ticket, payload["timeline"], assignee)
            ticket_count += 1

        return {
            "tenant_code": tenant.code,
            "forms": form_count,
            "rules": rule_count,
            "webhooks": webhook_count,
            "keys": key_count,
            "tickets": ticket_count,
            "config_id": config.id,
            "public_key": demo_token(tenant.code, "public"),
        }

    def _candidate_users(self, tenant):
        memberships = list(
            OrganizationMembership.objects.select_related("user")
            .filter(tenant=tenant, is_active=True)
            .order_by("-is_default", "user__username")
        )
        if memberships:
            return [item.user for item in memberships if item.user]

        profiles = list(
            TenantUserProfile.objects.select_related("user")
            .filter(tenant=tenant)
            .order_by("-is_tenant_admin", "user__username")
        )
        return [item.user for item in profiles if item.user]

    def _seed_ticket_timeline(self, ticket, timeline_entries, assignee):
        event_payload = {
            "ticket_id": ticket.public_id,
            "status": ticket.status,
            "priority": ticket.priority,
            "category": ticket.category,
        }
        TicketEvent.objects.create(
            ticket=ticket,
            event_type="ticket.created",
            summary="Ticket created from demo seed data.",
            payload=event_payload,
            is_public=True,
        )

        first_public_reply = True
        for actor_type, text in timeline_entries:
            if actor_type == "requester":
                TicketMessage.objects.create(
                    ticket=ticket,
                    author_type="requester",
                    author_name=ticket.requester_name or ticket.requester_email,
                    message=text,
                    is_public=True,
                )
            elif actor_type == "agent":
                TicketMessage.objects.create(
                    ticket=ticket,
                    author_type="agent",
                    author_user=assignee,
                    author_name=(assignee.get_full_name() or assignee.username) if assignee else "Support Agent",
                    message=text,
                    is_public=True,
                )
                if first_public_reply and not ticket.first_response_at:
                    ticket.first_response_at = timezone.now() - timedelta(days=1)
                    ticket.save(update_fields=["first_response_at", "updated_at"])
                    first_public_reply = False
            else:
                TicketEvent.objects.create(
                    ticket=ticket,
                    event_type="ticket.status_changed",
                    summary=text,
                    payload={"status": ticket.status},
                    is_public=True,
                )
