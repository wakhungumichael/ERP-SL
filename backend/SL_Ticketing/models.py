import hashlib
import secrets
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone
from django.utils.text import slugify

from Platform_Core.models import TimeStampedModel


class TicketingInboxConfig(TimeStampedModel):
    PORTAL_ACCESS_CHOICES = [
        ("email_match", "Email + Ticket ID"),
        ("secure_token", "Secure Token Link"),
        ("account_only", "Account Only"),
    ]

    tenant = models.OneToOneField(
        "Platform_Core.Tenant",
        on_delete=models.CASCADE,
        related_name="ticketing_config",
    )
    allowed_domains = models.JSONField(blank=True, default=list)
    portal_access_policy = models.CharField(
        max_length=30,
        choices=PORTAL_ACCESS_CHOICES,
        default="email_match",
    )
    brand_settings = models.JSONField(blank=True, default=dict)
    widget_settings = models.JSONField(blank=True, default=dict)
    email_settings = models.JSONField(blank=True, default=dict)
    webhook_settings = models.JSONField(blank=True, default=dict)
    channel_settings = models.JSONField(blank=True, default=dict)
    require_cors_origin = models.BooleanField(default=True)
    allow_anonymous_tracking = models.BooleanField(default=True)
    allow_requester_close = models.BooleanField(default=True)

    class Meta:
        ordering = ["tenant__name"]

    def __str__(self):
        return f"{self.tenant.name} Ticketing"


class TicketingApiKey(TimeStampedModel):
    KEY_TYPE_CHOICES = [
        ("public", "Public"),
        ("secret", "Secret"),
    ]

    tenant = models.ForeignKey(
        "Platform_Core.Tenant",
        on_delete=models.CASCADE,
        related_name="ticketing_api_keys",
    )
    name = models.CharField(max_length=120)
    key_type = models.CharField(max_length=20, choices=KEY_TYPE_CHOICES)
    token_prefix = models.CharField(max_length=24, db_index=True)
    token_hash = models.CharField(max_length=64, unique=True)
    is_active = models.BooleanField(default=True)
    last_used_at = models.DateTimeField(blank=True, null=True)
    revoked_at = models.DateTimeField(blank=True, null=True)
    metadata = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["tenant__name", "name"]
        unique_together = ("tenant", "name", "key_type")

    def __str__(self):
        return f"{self.tenant.name} {self.name} ({self.key_type})"

    @staticmethod
    def build_raw_token(key_type: str) -> str:
        prefix = "stp" if key_type == "public" else "sts"
        return f"{prefix}_{secrets.token_urlsafe(24)}"

    @staticmethod
    def hash_token(raw_token: str) -> str:
        return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()

    @classmethod
    def issue_token(cls, *, tenant, name: str, key_type: str, metadata=None):
        raw_token = cls.build_raw_token(key_type)
        return (
            cls.objects.create(
                tenant=tenant,
                name=name,
                key_type=key_type,
                token_prefix=raw_token[:18],
                token_hash=cls.hash_token(raw_token),
                metadata=metadata or {},
            ),
            raw_token,
        )

    def mark_used(self):
        self.last_used_at = timezone.now()
        self.save(update_fields=["last_used_at", "updated_at"])

    def revoke(self):
        self.is_active = False
        self.revoked_at = timezone.now()
        self.save(update_fields=["is_active", "revoked_at", "updated_at"])


class TicketingWebhookEndpoint(TimeStampedModel):
    tenant = models.ForeignKey(
        "Platform_Core.Tenant",
        on_delete=models.CASCADE,
        related_name="ticketing_webhook_endpoints",
    )
    name = models.CharField(max_length=120)
    target_url = models.URLField()
    signing_secret = models.CharField(max_length=120, default="", blank=True)
    subscribed_events = models.JSONField(blank=True, default=list)
    is_active = models.BooleanField(default=True)
    last_delivered_at = models.DateTimeField(blank=True, null=True)
    last_status_code = models.PositiveIntegerField(blank=True, null=True)
    last_error = models.TextField(blank=True)

    class Meta:
        ordering = ["tenant__name", "name"]
        unique_together = ("tenant", "name")

    def __str__(self):
        return f"{self.tenant.name} webhook {self.name}"

    def save(self, *args, **kwargs):
        if not self.signing_secret:
            self.signing_secret = secrets.token_urlsafe(32)
        super().save(*args, **kwargs)


class TicketFormSchema(TimeStampedModel):
    tenant = models.ForeignKey(
        "Platform_Core.Tenant",
        on_delete=models.CASCADE,
        related_name="ticketing_form_schemas",
    )
    name = models.CharField(max_length=150)
    slug = models.SlugField(max_length=80, blank=True)
    description = models.TextField(blank=True)
    schema = models.JSONField(blank=True, default=dict)
    is_default = models.BooleanField(default=False)
    is_public = models.BooleanField(default=True)
    allowed_mime_types = models.JSONField(blank=True, default=list)
    max_file_size_mb = models.PositiveIntegerField(default=10)

    class Meta:
        ordering = ["tenant__name", "name"]
        unique_together = ("tenant", "slug")

    def __str__(self):
        return f"{self.tenant.name} {self.name}"

    def save(self, *args, **kwargs):
        if not self.slug:
            base_slug = slugify(self.name)[:70] or "form"
            slug = base_slug
            counter = 1
            while TicketFormSchema.objects.exclude(pk=self.pk).filter(
                tenant=self.tenant,
                slug=slug,
            ).exists():
                slug = f"{base_slug}-{counter}"
                counter += 1
            self.slug = slug
        super().save(*args, **kwargs)


class TicketRoutingRule(TimeStampedModel):
    tenant = models.ForeignKey(
        "Platform_Core.Tenant",
        on_delete=models.CASCADE,
        related_name="ticketing_routing_rules",
    )
    name = models.CharField(max_length=150)
    priority = models.PositiveIntegerField(default=100)
    conditions = models.JSONField(blank=True, default=dict)
    assign_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="ticketing_rules_assigned",
    )
    target_status = models.CharField(max_length=30, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["tenant__name", "priority", "name"]
        unique_together = ("tenant", "name")

    def __str__(self):
        return f"{self.tenant.name} {self.name}"


class Ticket(TimeStampedModel):
    STATUS_CHOICES = [
        ("new", "New"),
        ("open", "Open"),
        ("pending", "Pending"),
        ("resolved", "Resolved"),
        ("closed", "Closed"),
    ]
    PRIORITY_CHOICES = [
        ("low", "Low"),
        ("normal", "Normal"),
        ("high", "High"),
        ("urgent", "Urgent"),
    ]

    tenant = models.ForeignKey(
        "Platform_Core.Tenant",
        on_delete=models.CASCADE,
        related_name="tickets",
    )
    form_schema = models.ForeignKey(
        TicketFormSchema,
        on_delete=models.SET_NULL,
        related_name="tickets",
        blank=True,
        null=True,
    )
    public_id = models.CharField(max_length=24, unique=True, editable=False)
    public_token = models.CharField(max_length=40, default="", editable=False)
    requester_name = models.CharField(max_length=150, blank=True)
    requester_email = models.EmailField()
    requester_phone = models.CharField(max_length=50, blank=True)
    subject = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    category = models.CharField(max_length=120, blank=True)
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default="normal")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="new")
    source_page = models.CharField(max_length=255, blank=True)
    source_channel = models.CharField(max_length=50, default="api")
    external_reference = models.CharField(max_length=120, blank=True)
    custom_fields = models.JSONField(blank=True, default=dict)
    attachments = models.JSONField(blank=True, default=list)
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="assigned_tickets",
    )
    first_response_at = models.DateTimeField(blank=True, null=True)
    resolved_at = models.DateTimeField(blank=True, null=True)
    closed_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "status"]),
            models.Index(fields=["tenant", "requester_email"]),
            models.Index(fields=["tenant", "created_at"]),
        ]

    def __str__(self):
        return f"{self.public_id} {self.subject}"

    def save(self, *args, **kwargs):
        if not self.public_id:
            self.public_id = f"TKT-{uuid.uuid4().hex[:10].upper()}"
        if not self.public_token:
            self.public_token = uuid.uuid4().hex
        if self.status == "resolved" and not self.resolved_at:
            self.resolved_at = timezone.now()
        if self.status == "closed" and not self.closed_at:
            self.closed_at = timezone.now()
        super().save(*args, **kwargs)


class TicketMessage(TimeStampedModel):
    AUTHOR_TYPE_CHOICES = [
        ("requester", "Requester"),
        ("agent", "Agent"),
        ("system", "System"),
    ]
    DIRECTION_CHOICES = [
        ("inbound", "Inbound"),
        ("outbound", "Outbound"),
        ("internal", "Internal"),
    ]
    CHANNEL_CHOICES = [
        ("portal", "Portal"),
        ("email", "Email"),
        ("whatsapp", "WhatsApp"),
        ("erp", "ERP"),
        ("api", "API"),
        ("system", "System"),
    ]
    DELIVERY_STATUS_CHOICES = [
        ("received", "Received"),
        ("queued", "Queued"),
        ("sent", "Sent"),
        ("failed", "Failed"),
        ("internal", "Internal"),
    ]

    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="messages")
    author_type = models.CharField(max_length=20, choices=AUTHOR_TYPE_CHOICES, default="requester")
    author_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="ticket_messages",
    )
    author_name = models.CharField(max_length=150, blank=True)
    message = models.TextField()
    attachments = models.JSONField(blank=True, default=list)
    direction = models.CharField(max_length=20, choices=DIRECTION_CHOICES, default="inbound")
    channel = models.CharField(max_length=20, choices=CHANNEL_CHOICES, default="portal")
    delivery_status = models.CharField(max_length=20, choices=DELIVERY_STATUS_CHOICES, default="received")
    external_message_id = models.CharField(max_length=160, blank=True)
    metadata = models.JSONField(blank=True, default=dict)
    is_public = models.BooleanField(default=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self):
        return f"{self.ticket.public_id} message"


class TicketEvent(TimeStampedModel):
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="events")
    event_type = models.CharField(max_length=50)
    summary = models.CharField(max_length=255)
    payload = models.JSONField(blank=True, default=dict)
    is_public = models.BooleanField(default=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self):
        return f"{self.ticket.public_id} {self.event_type}"


class TicketWebhookDelivery(TimeStampedModel):
    endpoint = models.ForeignKey(
        TicketingWebhookEndpoint,
        on_delete=models.CASCADE,
        related_name="deliveries",
    )
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="webhook_deliveries")
    event_type = models.CharField(max_length=50)
    request_payload = models.JSONField(blank=True, default=dict)
    response_excerpt = models.TextField(blank=True)
    status_code = models.PositiveIntegerField(blank=True, null=True)
    was_successful = models.BooleanField(default=False)
    attempted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-attempted_at"]

    def __str__(self):
        return f"{self.endpoint.name} {self.event_type}"
