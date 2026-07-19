from django.contrib.auth.models import Group, User
from django.db import models
from django.utils import timezone
from django.utils.text import slugify


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Tenant(TimeStampedModel):
    STATUS_CHOICES = [
        ("draft", "Draft"),
        ("active", "Active"),
        ("suspended", "Suspended"),
        ("archived", "Archived"),
    ]

    name = models.CharField(max_length=255)
    code = models.SlugField(max_length=80, unique=True, blank=True)
    legal_name = models.CharField(max_length=255, blank=True)
    subdomain = models.SlugField(max_length=80, unique=True, blank=True, null=True)
    primary_domain = models.CharField(max_length=255, blank=True)
    public_ip_address = models.GenericIPAddressField(blank=True, null=True)
    contact_email = models.EmailField(blank=True)
    contact_phone = models.CharField(max_length=50, blank=True)
    default_currency = models.CharField(max_length=10, default="KES")
    timezone = models.CharField(max_length=64, default="Africa/Nairobi")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="draft")
    is_active = models.BooleanField(default=True)
    metadata = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["name"]

    def save(self, *args, **kwargs):
        if not self.code:
            base_code = slugify(self.name)[:70] or "tenant"
            code = base_code
            counter = 1
            while Tenant.objects.exclude(pk=self.pk).filter(code=code).exists():
                code = f"{base_code}-{counter}"
                counter += 1
            self.code = code
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class ModuleDefinition(TimeStampedModel):
    CATEGORY_CHOICES = [
        ("core", "Core"),
        ("shared", "Shared"),
        ("vertical", "Vertical"),
        ("integration", "Integration"),
    ]

    slug = models.SlugField(max_length=100, unique=True)
    name = models.CharField(max_length=150)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default="shared")
    description = models.TextField(blank=True)
    is_core = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    config_schema = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["category", "name"]

    def __str__(self):
        return self.name


class WorkspaceMenuSection(TimeStampedModel):
    key = models.SlugField(max_length=100, unique=True)
    title = models.CharField(max_length=150)
    icon = models.CharField(max_length=80, blank=True)
    description = models.TextField(blank=True)
    module = models.ForeignKey(
        ModuleDefinition,
        on_delete=models.SET_NULL,
        related_name="workspace_sections",
        blank=True,
        null=True,
    )
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    is_system = models.BooleanField(default=False)
    metadata = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["sort_order", "title"]

    def __str__(self):
        return self.title


class WorkspaceMenuItem(TimeStampedModel):
    section = models.ForeignKey(WorkspaceMenuSection, on_delete=models.CASCADE, related_name="items")
    key = models.SlugField(max_length=120)
    title = models.CharField(max_length=150)
    icon = models.CharField(max_length=80, blank=True)
    description = models.TextField(blank=True)
    route_path = models.CharField(max_length=255, blank=True)
    api_path = models.CharField(max_length=255, blank=True)
    badge_text = models.CharField(max_length=80, blank=True)
    required_permission = models.CharField(max_length=150, blank=True)
    required_module = models.ForeignKey(
        ModuleDefinition,
        on_delete=models.SET_NULL,
        related_name="workspace_items",
        blank=True,
        null=True,
    )
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    is_external = models.BooleanField(default=False)
    metadata = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["section__sort_order", "sort_order", "title"]
        unique_together = ("section", "key")

    def __str__(self):
        return f"{self.section.title} - {self.title}"


class WorkspaceRoleMenuItem(TimeStampedModel):
    group = models.ForeignKey(Group, on_delete=models.CASCADE, related_name="workspace_menu_access")
    menu_item = models.ForeignKey(WorkspaceMenuItem, on_delete=models.CASCADE, related_name="role_access")
    can_view = models.BooleanField(default=True)

    class Meta:
        unique_together = ("group", "menu_item")
        ordering = ["group__name", "menu_item__section__sort_order", "menu_item__sort_order"]

    def __str__(self):
        return f"{self.group.name} -> {self.menu_item.title}"


class SubscriptionPlan(TimeStampedModel):
    BILLING_PERIOD_CHOICES = [
        ("monthly", "Monthly"),
        ("quarterly", "Quarterly"),
        ("annual", "Annual"),
        ("custom", "Custom"),
    ]

    code = models.SlugField(max_length=80, unique=True)
    name = models.CharField(max_length=150)
    billing_period = models.CharField(max_length=20, choices=BILLING_PERIOD_CHOICES, default="monthly")
    price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    currency = models.CharField(max_length=10, default="KES")
    trial_days = models.PositiveIntegerField(default=0)
    max_users = models.PositiveIntegerField(default=5)
    max_branches = models.PositiveIntegerField(default=1)
    max_devices = models.PositiveIntegerField(default=1)
    max_monthly_transactions = models.PositiveIntegerField(default=1000)
    is_active = models.BooleanField(default=True)
    features = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class PlanModule(TimeStampedModel):
    plan = models.ForeignKey(SubscriptionPlan, on_delete=models.CASCADE, related_name="modules")
    module = models.ForeignKey(ModuleDefinition, on_delete=models.CASCADE, related_name="plan_assignments")
    is_enabled = models.BooleanField(default=True)
    usage_limit = models.PositiveIntegerField(blank=True, null=True)
    config = models.JSONField(blank=True, default=dict)

    class Meta:
        unique_together = ("plan", "module")
        ordering = ["plan__name", "module__name"]

    def __str__(self):
        return f"{self.plan.name} -> {self.module.name}"


class TenantSubscription(TimeStampedModel):
    STATUS_CHOICES = [
        ("trial", "Trial"),
        ("active", "Active"),
        ("grace", "Grace Period"),
        ("suspended", "Suspended"),
        ("expired", "Expired"),
        ("cancelled", "Cancelled"),
    ]

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="subscriptions")
    plan = models.ForeignKey(SubscriptionPlan, on_delete=models.PROTECT, related_name="subscriptions")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="trial")
    start_date = models.DateField(default=timezone.now)
    end_date = models.DateField(blank=True, null=True)
    grace_until = models.DateField(blank=True, null=True)
    auto_renew = models.BooleanField(default=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    currency = models.CharField(max_length=10, default="KES")
    metadata = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.tenant.name} - {self.plan.name}"


class LicenseKey(TimeStampedModel):
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("active", "Active"),
        ("expired", "Expired"),
        ("revoked", "Revoked"),
    ]

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="licenses")
    subscription = models.ForeignKey(
        TenantSubscription,
        on_delete=models.SET_NULL,
        related_name="licenses",
        blank=True,
        null=True,
    )
    license_key = models.CharField(max_length=120, unique=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    activation_date = models.DateTimeField(blank=True, null=True)
    expiry_date = models.DateTimeField(blank=True, null=True)
    seats = models.PositiveIntegerField(default=1)
    device_limit = models.PositiveIntegerField(default=1)
    offline_grace_days = models.PositiveIntegerField(default=3)
    last_validated_at = models.DateTimeField(blank=True, null=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["tenant__name", "license_key"]

    def __str__(self):
        return f"{self.tenant.name} - {self.license_key}"


class TenantModuleActivation(TimeStampedModel):
    STATUS_CHOICES = [
        ("enabled", "Enabled"),
        ("disabled", "Disabled"),
        ("trial", "Trial"),
        ("suspended", "Suspended"),
    ]

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="module_activations")
    module = models.ForeignKey(ModuleDefinition, on_delete=models.CASCADE, related_name="tenant_activations")
    subscription = models.ForeignKey(
        TenantSubscription,
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="module_activations",
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="enabled")
    enabled_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField(blank=True, null=True)
    config = models.JSONField(blank=True, default=dict)

    class Meta:
        unique_together = ("tenant", "module")
        ordering = ["tenant__name", "module__name"]

    def __str__(self):
        return f"{self.tenant.name} - {self.module.name}"


class TenantBranch(TimeStampedModel):
    """Platform-level branch / office belonging to a tenant."""
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="branches")
    name = models.CharField(max_length=150)
    address = models.TextField(blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["tenant__name", "name"]
        unique_together = ("tenant", "name")

    def __str__(self):
        return f"{self.tenant.name} — {self.name}"


class TenantUserProfile(TimeStampedModel):
    """Binds a Django User to a Tenant and optionally a Branch."""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="tenant_profile")
    tenant = models.ForeignKey(
        Tenant, on_delete=models.CASCADE, related_name="user_profiles",
        blank=True, null=True,
    )
    branch = models.ForeignKey(
        TenantBranch, on_delete=models.SET_NULL, related_name="user_profiles",
        blank=True, null=True,
    )
    is_tenant_admin = models.BooleanField(default=False)
    job_title = models.CharField(max_length=150, blank=True)
    avatar_url = models.CharField(max_length=500, blank=True)

    class Meta:
        ordering = ["user__username"]

    def __str__(self):
        return f"{self.user.username} @ {self.tenant.name if self.tenant else 'platform'}"


class TenantSettings(TimeStampedModel):
    """Per-tenant company configuration and SMTP settings."""
    tenant = models.OneToOneField(Tenant, on_delete=models.CASCADE, related_name="settings")
    logo_url = models.CharField(max_length=500, blank=True)
    primary_color = models.CharField(max_length=20, blank=True, default="#E85D26")
    support_email = models.EmailField(blank=True)
    invoice_prefix = models.CharField(max_length=20, blank=True, default="INV")
    footer_text = models.TextField(blank=True)
    # SMTP
    smtp_host = models.CharField(max_length=255, blank=True)
    smtp_port = models.PositiveIntegerField(default=587)
    smtp_user = models.CharField(max_length=255, blank=True)
    smtp_password = models.CharField(max_length=255, blank=True)
    smtp_use_tls = models.BooleanField(default=True)
    # Invoicing
    default_payment_terms_days = models.PositiveIntegerField(default=30)

    class Meta:
        ordering = ["tenant__name"]

    def __str__(self):
        return f"Settings for {self.tenant.name}"


class IntegrationEndpoint(TimeStampedModel):
    INTEGRATION_TYPE_CHOICES = [
        ("indicator", "Indicator"),
        ("payment", "Payment"),
        ("messaging", "Messaging"),
        ("document", "Document"),
        ("storage", "Storage"),
        ("erp", "ERP"),
        ("other", "Other"),
    ]
    TRANSPORT_CHOICES = [
        ("serial", "Serial"),
        ("usb", "USB"),
        ("bluetooth", "Bluetooth"),
        ("tcp", "TCP/IP"),
        ("udp", "UDP"),
        ("http", "HTTP API"),
        ("websocket", "WebSocket"),
        ("agent", "Local Agent"),
        ("other", "Other"),
    ]

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="integrations")
    name = models.CharField(max_length=150)
    integration_type = models.CharField(max_length=20, choices=INTEGRATION_TYPE_CHOICES, default="indicator")
    transport = models.CharField(max_length=20, choices=TRANSPORT_CHOICES, default="http")
    provider = models.CharField(max_length=100, blank=True)
    base_url = models.CharField(max_length=500, blank=True)
    auth_type = models.CharField(max_length=50, blank=True)
    is_active = models.BooleanField(default=True)
    is_primary = models.BooleanField(default=False)
    timeout_seconds = models.PositiveIntegerField(default=5)
    credentials = models.JSONField(blank=True, default=dict)
    connection_settings = models.JSONField(blank=True, default=dict)
    healthcheck_path = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["tenant__name", "integration_type", "name"]

    def __str__(self):
        return f"{self.tenant.name} - {self.name}"


class DocumentTemplate(TimeStampedModel):
    DOCUMENT_TYPE_CHOICES = [
        ("invoice", "Invoice"),
        ("quotation", "Quotation"),
        ("receipt", "Receipt"),
        ("weighbridge_ticket", "Weighbridge Ticket"),
        ("statement", "Statement"),
        ("report", "Report"),
    ]
    ENGINE_CHOICES = [
        ("django", "Django Template"),
        ("html", "Raw HTML"),
        ("text", "Plain Text"),
    ]

    tenant = models.ForeignKey(
        Tenant,
        on_delete=models.CASCADE,
        related_name="document_templates",
        blank=True,
        null=True,
    )
    name = models.CharField(max_length=150)
    document_type = models.CharField(max_length=30, choices=DOCUMENT_TYPE_CHOICES)
    engine = models.CharField(max_length=20, choices=ENGINE_CHOICES, default="django")
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    subject_template = models.CharField(max_length=255, blank=True)
    body_template = models.TextField(blank=True)
    stylesheet = models.TextField(blank=True)
    version = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ["document_type", "name"]

    def __str__(self):
        return self.name


class BackupPolicy(TimeStampedModel):
    FREQUENCY_CHOICES = [
        ("hourly", "Hourly"),
        ("daily", "Daily"),
        ("weekly", "Weekly"),
        ("monthly", "Monthly"),
    ]

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="backup_policies")
    name = models.CharField(max_length=150)
    frequency = models.CharField(max_length=20, choices=FREQUENCY_CHOICES, default="daily")
    retention_days = models.PositiveIntegerField(default=30)
    storage_backend = models.CharField(max_length=50, default="local")
    target_path = models.CharField(max_length=255, blank=True)
    last_successful_backup = models.DateTimeField(blank=True, null=True)
    is_active = models.BooleanField(default=True)
    options = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["tenant__name", "name"]

    def __str__(self):
        return f"{self.tenant.name} - {self.name}"


class Account(TimeStampedModel):
    ACCOUNT_TYPE_CHOICES = [
        ("asset", "Asset"),
        ("liability", "Liability"),
        ("equity", "Equity"),
        ("income", "Income"),
        ("expense", "Expense"),
    ]

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="accounts")
    code = models.CharField(max_length=30)
    name = models.CharField(max_length=150)
    account_type = models.CharField(max_length=20, choices=ACCOUNT_TYPE_CHOICES)
    parent = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        related_name="children",
        blank=True,
        null=True,
    )
    is_active = models.BooleanField(default=True)
    allow_posting = models.BooleanField(default=True)
    metadata = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["tenant__name", "code"]
        unique_together = ("tenant", "code")

    def __str__(self):
        return f"{self.code} - {self.name}"


class Journal(TimeStampedModel):
    JOURNAL_TYPE_CHOICES = [
        ("sales", "Sales"),
        ("cash", "Cash"),
        ("bank", "Bank"),
        ("general", "General"),
        ("adjustment", "Adjustment"),
    ]

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="journals")
    code = models.CharField(max_length=30)
    name = models.CharField(max_length=150)
    journal_type = models.CharField(max_length=20, choices=JOURNAL_TYPE_CHOICES, default="general")
    is_active = models.BooleanField(default=True)
    metadata = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["tenant__name", "code"]
        unique_together = ("tenant", "code")

    def __str__(self):
        return f"{self.code} - {self.name}"


class JournalEntry(TimeStampedModel):
    SOURCE_TYPE_CHOICES = [
        ("invoice", "Invoice"),
        ("payment", "Payment"),
        ("transaction", "Transaction"),
        ("manual", "Manual"),
    ]
    STATUS_CHOICES = [
        ("draft", "Draft"),
        ("posted", "Posted"),
        ("reversed", "Reversed"),
    ]

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="journal_entries")
    journal = models.ForeignKey(Journal, on_delete=models.PROTECT, related_name="entries")
    entry_number = models.CharField(max_length=50, blank=True)
    entry_date = models.DateTimeField(default=timezone.now)
    source_type = models.CharField(max_length=20, choices=SOURCE_TYPE_CHOICES, default="manual")
    source_reference = models.CharField(max_length=100, blank=True)
    memo = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="posted")

    class Meta:
        ordering = ["-entry_date", "-id"]
        unique_together = ("tenant", "entry_number")

    def save(self, *args, **kwargs):
        if not self.entry_number:
            prefix = self.journal.code if self.journal_id else "JE"
            self.entry_number = f"{prefix}-{timezone.now().strftime('%Y%m%d%H%M%S')}-{self.tenant_id or 'X'}"
        super().save(*args, **kwargs)

    @property
    def debit_total(self):
        return sum(line.debit_amount for line in self.lines.all())

    @property
    def credit_total(self):
        return sum(line.credit_amount for line in self.lines.all())

    def __str__(self):
        return self.entry_number


class JournalEntryLine(TimeStampedModel):
    entry = models.ForeignKey(JournalEntry, on_delete=models.CASCADE, related_name="lines")
    account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="journal_lines")
    description = models.CharField(max_length=255, blank=True)
    debit_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    credit_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    class Meta:
        ordering = ["entry__entry_date", "id"]

    def __str__(self):
        return f"{self.entry.entry_number} - {self.account.code}"


class AccountingPostingRule(TimeStampedModel):
    SOURCE_TYPE_CHOICES = [
        ("invoice", "Invoice"),
        ("payment", "Payment"),
        ("transaction", "Transaction"),
        ("manual", "Manual"),
    ]

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="posting_rules")
    source_type = models.CharField(max_length=20, choices=SOURCE_TYPE_CHOICES)
    payment_method_code = models.CharField(max_length=50, blank=True)
    journal = models.ForeignKey(Journal, on_delete=models.PROTECT, related_name="posting_rules")
    debit_account = models.ForeignKey(
        Account,
        on_delete=models.PROTECT,
        related_name="posting_rule_debits",
    )
    credit_account = models.ForeignKey(
        Account,
        on_delete=models.PROTECT,
        related_name="posting_rule_credits",
    )
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    is_primary = models.BooleanField(default=False)
    metadata = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["tenant__name", "source_type", "-is_primary", "name"]

    def __str__(self):
        method_part = f" [{self.payment_method_code}]" if self.payment_method_code else ""
        return f"{self.tenant.name} - {self.source_type}{method_part} - {self.name}"
