from django.contrib.auth.models import Group, User
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone
from django.utils.text import slugify
import uuid


class AuditMetadataMixin(models.Model):
    class Meta:
        abstract = True

    def _audit_queryset(self):
        from django.apps import apps

        if self.pk is None:
            return None
        AuditEventLog = apps.get_model("Platform_Core", "AuditEventLog")
        return AuditEventLog.objects.select_related("actor").filter(
            model_label=self._meta.label,
            object_pk=str(self.pk),
        ).order_by("created_at", "id")

    def _first_event(self, *event_types):
        qs = self._audit_queryset()
        if qs is None:
            return None
        return qs.filter(event_type__in=event_types).first()

    def _last_event(self, *event_types):
        qs = self._audit_queryset()
        if qs is None:
            return None
        return qs.filter(event_type__in=event_types).order_by("-created_at", "-id").first()

    @property
    def created_by_user(self):
        event = self._first_event("create")
        return getattr(event, "actor", None)

    @property
    def updated_by_user(self):
        event = self._last_event("update", "create")
        return getattr(event, "actor", None)

    @property
    def deleted_by_user(self):
        event = self._last_event("delete")
        return getattr(event, "actor", None)

    @property
    def deleted_on(self):
        event = self._last_event("delete")
        return getattr(event, "created_at", None)

    @property
    def audit_metadata(self):
        created_by = self.created_by_user
        updated_by = self.updated_by_user
        deleted_by = self.deleted_by_user
        return {
            "created_by_id": getattr(created_by, "id", None),
            "created_by_name": (created_by.get_full_name() or created_by.username) if created_by else None,
            "created_on": getattr(self, "created_at", None),
            "updated_by_id": getattr(updated_by, "id", None),
            "updated_by_name": (updated_by.get_full_name() or updated_by.username) if updated_by else None,
            "updated_on": getattr(self, "updated_at", None),
            "deleted_by_id": getattr(deleted_by, "id", None),
            "deleted_by_name": (deleted_by.get_full_name() or deleted_by.username) if deleted_by else None,
            "deleted_on": self.deleted_on,
        }


class TimeStampedModel(AuditMetadataMixin, models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class BackgroundServiceLease(TimeStampedModel):
    service_name = models.CharField(max_length=120, unique=True)
    owner_id = models.CharField(max_length=255, blank=True)
    heartbeat_at = models.DateTimeField(blank=True, null=True)
    lease_until = models.DateTimeField(blank=True, null=True)
    metadata = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["service_name"]

    def __str__(self):
        return self.service_name


class Industry(TimeStampedModel):
    slug = models.SlugField(max_length=100, unique=True)
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    metadata = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


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
    industry = models.ForeignKey(
        Industry,
        on_delete=models.SET_NULL,
        related_name="tenants",
        blank=True,
        null=True,
    )
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
    SCOPE_CHOICES = [
        ("organization", "Organization"),
        ("hybrid", "Hybrid"),
        ("platform_admin", "Platform Admin"),
    ]

    slug = models.SlugField(max_length=100, unique=True)
    name = models.CharField(max_length=150)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default="shared")
    scope = models.CharField(max_length=20, choices=SCOPE_CHOICES, default="organization")
    description = models.TextField(blank=True)
    is_core = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    industries = models.ManyToManyField(
        Industry,
        related_name="modules",
        blank=True,
    )
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


class WorkflowDefinition(TimeStampedModel):
    SCOPE_CHOICES = [
        ("document", "Document"),
        ("transaction", "Transaction"),
        ("master_data", "Master Data"),
        ("custom", "Custom"),
    ]

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="workflow_definitions")
    module = models.ForeignKey(
        ModuleDefinition,
        on_delete=models.SET_NULL,
        related_name="workflow_definitions",
        blank=True,
        null=True,
    )
    code = models.SlugField(max_length=100)
    name = models.CharField(max_length=180)
    entity_type = models.CharField(max_length=100)
    scope = models.CharField(max_length=20, choices=SCOPE_CHOICES, default="document")
    trigger_event = models.CharField(max_length=80, default="submit")
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    allow_dashboard_quick_actions = models.BooleanField(default=True)
    metadata = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["tenant__name", "name"]
        unique_together = ("tenant", "code")

    def __str__(self):
        return f"{self.tenant.name} - {self.name}"


class WorkflowEntityBinding(TimeStampedModel):
    workflow = models.ForeignKey(WorkflowDefinition, on_delete=models.CASCADE, related_name="entity_bindings")
    module_slug = models.CharField(max_length=100)
    entity_type = models.CharField(max_length=100)
    entity_label = models.CharField(max_length=180)
    route_path = models.CharField(max_length=255, blank=True)
    api_base_path = models.CharField(max_length=255, blank=True)
    trigger_events = models.JSONField(blank=True, default=list)
    is_primary = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    metadata = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["workflow__name", "-is_primary", "entity_label"]
        unique_together = ("workflow", "module_slug", "entity_type")

    def __str__(self):
        return f"{self.workflow.name} - {self.entity_label}"


class WorkflowStepDefinition(TimeStampedModel):
    ACTION_TYPE_CHOICES = [
        ("approval", "Approval"),
        ("review", "Review"),
        ("notify", "Notify"),
    ]

    workflow = models.ForeignKey(WorkflowDefinition, on_delete=models.CASCADE, related_name="steps")
    name = models.CharField(max_length=180)
    step_order = models.PositiveIntegerField(default=1)
    action_type = models.CharField(max_length=20, choices=ACTION_TYPE_CHOICES, default="approval")
    approval_group = models.ForeignKey(
        Group,
        on_delete=models.PROTECT,
        related_name="workflow_step_definitions",
        blank=True,
        null=True,
    )
    min_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    max_amount = models.DecimalField(max_digits=14, decimal_places=2, blank=True, null=True)
    cost_center = models.CharField(max_length=120, blank=True)
    notify_dashboard = models.BooleanField(default=True)
    allow_quick_action = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)
    metadata = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["workflow__name", "step_order", "id"]

    def __str__(self):
        return f"{self.workflow.name} - Step {self.step_order}"


class WorkflowNodeDefinition(TimeStampedModel):
    NODE_TYPE_CHOICES = [
        ("start", "Start"),
        ("approval", "Approval"),
        ("review", "Review"),
        ("condition", "Condition"),
        ("notification", "Notification"),
        ("task", "Task"),
        ("end", "End"),
    ]
    APPROVAL_MODE_CHOICES = [
        ("single", "Single Approver"),
        ("any_one", "Any One Member"),
        ("all_members", "All Members"),
        ("quorum", "Quorum"),
    ]

    workflow = models.ForeignKey(WorkflowDefinition, on_delete=models.CASCADE, related_name="nodes")
    code = models.SlugField(max_length=100)
    name = models.CharField(max_length=180)
    node_type = models.CharField(max_length=30, choices=NODE_TYPE_CHOICES, default="approval")
    step_order = models.PositiveIntegerField(default=1)
    is_initial = models.BooleanField(default=False)
    approval_group = models.ForeignKey(
        Group,
        on_delete=models.PROTECT,
        related_name="workflow_node_definitions",
        blank=True,
        null=True,
    )
    approval_mode = models.CharField(max_length=20, choices=APPROVAL_MODE_CHOICES, default="single")
    required_approvals = models.PositiveIntegerField(default=1)
    assigned_user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name="workflow_node_definitions",
        blank=True,
        null=True,
    )
    min_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    max_amount = models.DecimalField(max_digits=14, decimal_places=2, blank=True, null=True)
    cost_center = models.CharField(max_length=120, blank=True)
    entry_action = models.CharField(max_length=120, blank=True)
    exit_action = models.CharField(max_length=120, blank=True)
    notify_dashboard = models.BooleanField(default=True)
    allow_quick_action = models.BooleanField(default=True)
    sla_hours = models.PositiveIntegerField(default=0)
    position_x = models.IntegerField(default=0)
    position_y = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    metadata = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["workflow__name", "step_order", "id"]
        unique_together = ("workflow", "code")

    def __str__(self):
        return f"{self.workflow.name} - {self.name}"


class WorkflowTransitionDefinition(TimeStampedModel):
    OPERATOR_CHOICES = [
        ("always", "Always"),
        ("eq", "Equals"),
        ("neq", "Not Equals"),
        ("gt", "Greater Than"),
        ("gte", "Greater Than or Equal"),
        ("lt", "Less Than"),
        ("lte", "Less Than or Equal"),
        ("contains", "Contains"),
        ("in", "In"),
        ("is_true", "Is True"),
        ("is_false", "Is False"),
    ]

    workflow = models.ForeignKey(WorkflowDefinition, on_delete=models.CASCADE, related_name="transitions")
    from_node = models.ForeignKey(
        WorkflowNodeDefinition,
        on_delete=models.CASCADE,
        related_name="outgoing_transitions",
    )
    to_node = models.ForeignKey(
        WorkflowNodeDefinition,
        on_delete=models.CASCADE,
        related_name="incoming_transitions",
    )
    name = models.CharField(max_length=180)
    transition_key = models.SlugField(max_length=100, default="next")
    decision = models.CharField(max_length=50, blank=True)
    priority = models.PositiveIntegerField(default=1)
    is_default = models.BooleanField(default=False)
    condition_field = models.CharField(max_length=120, blank=True)
    condition_operator = models.CharField(max_length=20, choices=OPERATOR_CHOICES, default="always")
    condition_value = models.CharField(max_length=255, blank=True)
    is_active = models.BooleanField(default=True)
    metadata = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["workflow__name", "priority", "id"]

    def clean(self):
        if self.from_node_id and self.workflow_id and self.from_node.workflow_id != self.workflow_id:
            raise ValidationError("Source node must belong to the same workflow.")
        if self.to_node_id and self.workflow_id and self.to_node.workflow_id != self.workflow_id:
            raise ValidationError("Target node must belong to the same workflow.")

    def __str__(self):
        return f"{self.workflow.name} - {self.name}"


class WorkflowInboxItem(TimeStampedModel):
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("approved", "Approved"),
        ("rejected", "Rejected"),
        ("cancelled", "Cancelled"),
        ("completed", "Completed"),
    ]

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="workflow_inbox_items")
    workflow = models.ForeignKey(
        WorkflowDefinition,
        on_delete=models.SET_NULL,
        related_name="inbox_items",
        blank=True,
        null=True,
    )
    step_definition = models.ForeignKey(
        WorkflowStepDefinition,
        on_delete=models.SET_NULL,
        related_name="inbox_items",
        blank=True,
        null=True,
    )
    node_definition = models.ForeignKey(
        WorkflowNodeDefinition,
        on_delete=models.SET_NULL,
        related_name="inbox_items",
        blank=True,
        null=True,
    )
    module_slug = models.CharField(max_length=100, blank=True)
    entity_type = models.CharField(max_length=100)
    entity_id = models.PositiveIntegerField()
    reference = models.CharField(max_length=80, blank=True)
    title = models.CharField(max_length=200)
    detail = models.TextField(blank=True)
    route_path = models.CharField(max_length=255, blank=True)
    action_url = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    assigned_group = models.ForeignKey(
        Group,
        on_delete=models.SET_NULL,
        related_name="workflow_inbox_items",
        blank=True,
        null=True,
    )
    assigned_user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name="workflow_inbox_assigned",
        blank=True,
        null=True,
    )
    acted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name="workflow_inbox_acted",
        blank=True,
        null=True,
    )
    acted_at = models.DateTimeField(blank=True, null=True)
    quick_actions = models.JSONField(blank=True, default=list)
    metadata = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["status", "-created_at"]

    def __str__(self):
        return f"{self.title} [{self.status}]"


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


class SubscriptionBillingRequest(TimeStampedModel):
    STATUS_CHOICES = [
        ("draft", "Draft"),
        ("initiated", "Initiated"),
        ("pending", "Pending Confirmation"),
        ("succeeded", "Succeeded"),
        ("failed", "Failed"),
        ("cancelled", "Cancelled"),
    ]

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="billing_requests")
    subscription = models.ForeignKey(
        TenantSubscription,
        on_delete=models.SET_NULL,
        related_name="billing_requests",
        null=True,
        blank=True,
    )
    gateway = models.ForeignKey(
        "IntegrationEndpoint",
        on_delete=models.SET_NULL,
        related_name="subscription_billing_requests",
        null=True,
        blank=True,
    )
    requested_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name="subscription_billing_requests",
        null=True,
        blank=True,
    )
    checkout_reference = models.CharField(max_length=120, unique=True, blank=True)
    payment_provider = models.CharField(max_length=100, blank=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    currency = models.CharField(max_length=10, default="KES")
    phone_number = models.CharField(max_length=40, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="draft")
    external_reference = models.CharField(max_length=150, blank=True)
    request_payload = models.JSONField(blank=True, default=dict)
    response_payload = models.JSONField(blank=True, default=dict)
    processed_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        if not self.checkout_reference:
            self.checkout_reference = f"BILL-{uuid.uuid4().hex[:12].upper()}"
        if self.gateway_id and not self.payment_provider:
            self.payment_provider = self.gateway.provider or ""
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.tenant.name} - {self.checkout_reference}"


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


class OrganizationMembership(TimeStampedModel):
    ROLE_CHOICES = [
        ("owner", "Owner"),
        ("system_admin", "System Admin"),
        ("finance", "Finance"),
        ("operator", "Operator"),
        ("member", "Member"),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="organization_memberships")
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="organization_memberships")
    branch = models.ForeignKey(
        TenantBranch,
        on_delete=models.SET_NULL,
        related_name="organization_memberships",
        blank=True,
        null=True,
    )
    role = models.CharField(max_length=32, choices=ROLE_CHOICES, default="member")
    role_group_name = models.CharField(max_length=150, blank=True)
    is_org_admin = models.BooleanField(default=False)
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    job_title = models.CharField(max_length=150, blank=True)

    class Meta:
        ordering = ["user__username", "-is_default", "tenant__name"]
        unique_together = ("user", "tenant")

    def clean(self):
        if self.branch_id and self.tenant_id and self.branch.tenant_id != self.tenant_id:
            raise ValidationError({"branch": "Selected branch must belong to the same organization."})

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.user.username} -> {self.tenant.name} ({self.role})"


class TenantSettings(TimeStampedModel):
    """Per-tenant company configuration and SMTP settings."""
    tenant = models.OneToOneField(Tenant, on_delete=models.CASCADE, related_name="settings")
    logo_url = models.CharField(max_length=500, blank=True)
    logo_file = models.ImageField(upload_to="tenant_logos/", blank=True, null=True)
    primary_color = models.CharField(max_length=20, blank=True, default="#E85D26")
    login_page_config = models.JSONField(blank=True, default=dict)
    footer_menu = models.JSONField(blank=True, default=list)
    landing_page_config = models.JSONField(blank=True, default=dict)
    support_email = models.EmailField(blank=True)
    invoice_prefix = models.CharField(max_length=20, blank=True, default="INV")
    footer_text = models.TextField(blank=True)
    default_tax_name = models.CharField(max_length=100, blank=True, default="VAT")
    default_tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    invoice_template = models.ForeignKey(
        "DocumentTemplate",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="invoice_template_settings",
    )
    estimate_template = models.ForeignKey(
        "DocumentTemplate",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="estimate_template_settings",
    )
    receipt_template = models.ForeignKey(
        "DocumentTemplate",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="receipt_template_settings",
    )
    statement_template = models.ForeignKey(
        "DocumentTemplate",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="statement_template_settings",
    )
    purchase_order_template = models.ForeignKey(
        "DocumentTemplate",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="purchase_order_template_settings",
    )
    # SMTP
    smtp_host = models.CharField(max_length=255, blank=True)
    smtp_port = models.PositiveIntegerField(default=587)
    smtp_user = models.CharField(max_length=255, blank=True)
    smtp_password = models.CharField(max_length=255, blank=True)
    smtp_use_tls = models.BooleanField(default=True)
    smtp_use_ssl = models.BooleanField(default=False)
    smtp_allow_insecure_ssl = models.BooleanField(default=False)
    # Invoicing
    default_payment_terms_days = models.PositiveIntegerField(default=30)
    # Weighbridge tellers can be limited to a small, recent receipt window.
    # A value of zero leaves the respective limit disabled.
    teller_receipt_latest_records = models.PositiveIntegerField(default=0)
    teller_receipt_max_age_hours = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["tenant__name"]
        permissions = [
            ("can_view_workspace_dashboard", "Can view the Workspace dashboard"),
            ("can_access_finance_workspace", "Can access the Finance workspace"),
            ("can_view_erp_reports", "Can view ERP reports"),
            ("can_view_weighbridge_overview", "Can view the Weighbridge overview"),
            ("can_view_sales_overview", "Can view the Sales overview"),
            ("can_view_inventory_overview", "Can view the Inventory overview"),
            ("can_view_finance_overview", "Can view the Finance overview"),
            ("can_view_crm_overview", "Can view the CRM overview"),
            ("can_view_ticketing_overview", "Can view the Ticketing overview"),
            ("can_view_manufacturing_overview", "Can view the Manufacturing overview"),
            ("can_view_retail_overview", "Can view the Retail overview"),
            ("can_view_services_overview", "Can view the Services overview"),
            ("can_view_procurement_overview", "Can view the Procurement overview"),
            ("can_view_budgeting_overview", "Can view the Budgeting overview"),
            ("can_view_hr_overview", "Can view the HR overview"),
        ]

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


class PricingRuleType(TimeStampedModel):
    slug = models.SlugField(max_length=100, unique=True)
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    module = models.ForeignKey(
        ModuleDefinition,
        on_delete=models.SET_NULL,
        related_name="pricing_rule_types",
        blank=True,
        null=True,
    )
    config_schema = models.JSONField(blank=True, default=dict)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class PricingRule(TimeStampedModel):
    ADJUSTMENT_MODE_CHOICES = [
        ("override", "Override Charge"),
        ("fixed_discount", "Fixed Discount"),
        ("percentage_discount", "Percentage Discount"),
    ]

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="pricing_rules")
    module = models.ForeignKey(
        ModuleDefinition,
        on_delete=models.CASCADE,
        related_name="pricing_rules",
    )
    rule_type = models.ForeignKey(
        PricingRuleType,
        on_delete=models.PROTECT,
        related_name="rules",
    )
    name = models.CharField(max_length=180)
    priority = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)
    adjustment_mode = models.CharField(
        max_length=30,
        choices=ADJUSTMENT_MODE_CHOICES,
        default="override",
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    conditions = models.JSONField(blank=True, default=dict)
    metadata = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["tenant__name", "-priority", "name"]

    def __str__(self):
        return f"{self.tenant.name} - {self.name}"


class DocumentTemplate(TimeStampedModel):
    DOCUMENT_TYPE_CHOICES = [
        ("invoice", "Invoice"),
        ("quotation", "Quotation"),
        ("receipt", "Receipt"),
        ("purchase_order", "Purchase Order"),
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

    tenant = models.ForeignKey(
        Tenant,
        on_delete=models.CASCADE,
        related_name="backup_policies",
        blank=True,
        null=True,
    )
    name = models.CharField(max_length=150)
    frequency = models.CharField(max_length=20, choices=FREQUENCY_CHOICES, default="daily")
    retention_days = models.PositiveIntegerField(default=30)
    storage_backend = models.CharField(max_length=50, default="local")
    target_path = models.CharField(max_length=255, blank=True)
    last_successful_backup = models.DateTimeField(blank=True, null=True)
    last_backup_file = models.CharField(max_length=500, blank=True)
    last_backup_size_bytes = models.PositiveBigIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    options = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["tenant__name", "name"]

    def __str__(self):
        owner = self.tenant.name if self.tenant else "General"
        return f"{owner} - {self.name}"


class TenantOffboardingRequest(TimeStampedModel):
    STATUS_CHOICES = [
        ("draft", "Draft"),
        ("deletion_requested", "Deletion Requested"),
        ("approved", "Approved"),
        ("cancelled", "Cancelled"),
        ("completed", "Completed"),
        ("failed", "Failed"),
    ]

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="offboarding_requests")
    requested_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name="tenant_offboarding_requests",
        null=True,
        blank=True,
    )
    approved_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name="approved_tenant_offboarding_requests",
        null=True,
        blank=True,
    )
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default="draft")
    requested_at = models.DateTimeField(default=timezone.now)
    approved_at = models.DateTimeField(null=True, blank=True)
    retention_until = models.DateTimeField(null=True, blank=True)
    export_requested = models.BooleanField(default=True)
    notes = models.TextField(blank=True)
    metadata = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.tenant.name} - {self.status}"


class TenantExportJob(TimeStampedModel):
    STATUS_CHOICES = [
        ("queued", "Queued"),
        ("running", "Running"),
        ("succeeded", "Succeeded"),
        ("failed", "Failed"),
        ("cancelled", "Cancelled"),
    ]

    EXPORT_FORMAT_CHOICES = [
        ("json_bundle", "JSON Bundle"),
        ("csv_bundle", "CSV Bundle"),
    ]

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="export_jobs")
    offboarding_request = models.ForeignKey(
        TenantOffboardingRequest,
        on_delete=models.SET_NULL,
        related_name="export_jobs",
        null=True,
        blank=True,
    )
    requested_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name="tenant_export_jobs",
        null=True,
        blank=True,
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="queued")
    export_format = models.CharField(max_length=20, choices=EXPORT_FORMAT_CHOICES, default="json_bundle")
    storage_backend = models.CharField(max_length=50, default="local")
    artifact_path = models.CharField(max_length=500, blank=True)
    artifact_checksum = models.CharField(max_length=128, blank=True)
    artifact_size_bytes = models.PositiveBigIntegerField(default=0)
    row_counts = models.JSONField(blank=True, default=dict)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    failure_reason = models.TextField(blank=True)
    metadata = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.tenant.name} export - {self.status}"


class TenantPurgeJob(TimeStampedModel):
    STATUS_CHOICES = [
        ("queued", "Queued"),
        ("running", "Running"),
        ("succeeded", "Succeeded"),
        ("failed", "Failed"),
        ("cancelled", "Cancelled"),
    ]

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="purge_jobs")
    offboarding_request = models.ForeignKey(
        TenantOffboardingRequest,
        on_delete=models.SET_NULL,
        related_name="purge_jobs",
        null=True,
        blank=True,
    )
    requested_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name="tenant_purge_jobs",
        null=True,
        blank=True,
    )
    approved_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name="approved_tenant_purge_jobs",
        null=True,
        blank=True,
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="queued")
    scheduled_for = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    failure_reason = models.TextField(blank=True)
    summary = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.tenant.name} purge - {self.status}"


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
        ("bill", "Bill"),
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
        ("bill", "Bill"),
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


class FinancialYear(TimeStampedModel):
    STATUS_CHOICES = [
        ("draft", "Draft"),
        ("open", "Open"),
        ("closed", "Closed"),
    ]

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="financial_years")
    name = models.CharField(max_length=120)
    code = models.CharField(max_length=40)
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="draft")
    is_active = models.BooleanField(default=True)
    metadata = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["tenant__name", "-start_date", "-id"]
        unique_together = ("tenant", "code")

    def clean(self):
        if self.end_date and self.start_date and self.end_date < self.start_date:
            raise ValidationError({"end_date": "End date must be on or after start date."})
        if not self.tenant_id or not self.start_date or not self.end_date:
            return
        qs = FinancialYear.objects.filter(tenant=self.tenant)
        if self.pk:
            qs = qs.exclude(pk=self.pk)
        for year in qs.only("id", "name", "start_date", "end_date"):
            if self.start_date <= year.end_date and year.start_date <= self.end_date:
                raise ValidationError(
                    f"Financial year dates overlap with {year.name} "
                    f"({year.start_date.isoformat()} to {year.end_date.isoformat()})."
                )

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.tenant.name} - {self.name}"


class AccountingPeriod(TimeStampedModel):
    PERIOD_TYPE_CHOICES = [
        ("month", "Month"),
        ("quarter", "Quarter"),
        ("year", "Year"),
        ("adjustment", "Adjustment"),
        ("custom", "Custom"),
    ]
    STATUS_CHOICES = [
        ("draft", "Draft"),
        ("open", "Open"),
        ("closed", "Closed"),
        ("locked", "Locked"),
    ]

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="accounting_periods")
    financial_year = models.ForeignKey(FinancialYear, on_delete=models.CASCADE, related_name="periods")
    name = models.CharField(max_length=120)
    code = models.CharField(max_length=40)
    start_date = models.DateField()
    end_date = models.DateField()
    period_type = models.CharField(max_length=20, choices=PERIOD_TYPE_CHOICES, default="month")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="draft")
    sequence_number = models.PositiveIntegerField(default=1)
    is_adjustment = models.BooleanField(default=False)
    metadata = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["tenant__name", "financial_year__start_date", "sequence_number", "start_date", "id"]
        unique_together = ("tenant", "code")

    def clean(self):
        if self.end_date and self.start_date and self.end_date < self.start_date:
            raise ValidationError({"end_date": "End date must be on or after start date."})
        if not self.tenant_id or not self.financial_year_id or not self.start_date or not self.end_date:
            return
        if self.financial_year.tenant_id != self.tenant_id:
            raise ValidationError({"financial_year": "Financial year belongs to a different tenant."})
        if self.start_date < self.financial_year.start_date or self.end_date > self.financial_year.end_date:
            raise ValidationError(
                "Accounting period must remain within its financial year date range."
            )
        qs = AccountingPeriod.objects.filter(tenant=self.tenant, financial_year=self.financial_year)
        if self.pk:
            qs = qs.exclude(pk=self.pk)
        for period in qs.only("id", "name", "start_date", "end_date"):
            if self.start_date <= period.end_date and period.start_date <= self.end_date:
                raise ValidationError(
                    f"Accounting period dates overlap with {period.name} "
                    f"({period.start_date.isoformat()} to {period.end_date.isoformat()})."
                )

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.financial_year.name} - {self.name}"


class AccountingPeriodAuditLog(TimeStampedModel):
    ACTION_CHOICES = [
        ("created", "Created"),
        ("opened", "Opened"),
        ("closed", "Closed"),
        ("locked", "Locked"),
        ("reopened", "Reopened"),
        ("financial-year-updated", "Financial Year Updated"),
    ]

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="accounting_period_audit_logs")
    financial_year = models.ForeignKey(
        FinancialYear,
        on_delete=models.SET_NULL,
        related_name="audit_logs",
        blank=True,
        null=True,
    )
    period = models.ForeignKey(
        AccountingPeriod,
        on_delete=models.SET_NULL,
        related_name="audit_logs",
        blank=True,
        null=True,
    )
    action = models.CharField(max_length=40, choices=ACTION_CHOICES)
    performed_by = models.ForeignKey(User, on_delete=models.SET_NULL, related_name="accounting_period_actions", blank=True, null=True)
    note = models.TextField(blank=True)
    metadata = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        target = self.period.name if self.period_id else (self.financial_year.name if self.financial_year_id else "Accounting")
        return f"{target} - {self.action}"


class AuditEventLog(TimeStampedModel):
    EVENT_GROUP_CHOICES = [
        ("data_lifecycle", "Data Lifecycle"),
        ("workflow", "Workflow"),
        ("security", "Security"),
        ("access", "Access"),
        ("integration", "Integration"),
        ("system", "System"),
    ]
    STATUS_CHOICES = [
        ("success", "Success"),
        ("failed", "Failed"),
        ("warning", "Warning"),
    ]

    tenant = models.ForeignKey(
        Tenant,
        on_delete=models.CASCADE,
        related_name="audit_event_logs",
        blank=True,
        null=True,
    )
    branch = models.ForeignKey(
        TenantBranch,
        on_delete=models.SET_NULL,
        related_name="audit_event_logs",
        blank=True,
        null=True,
    )
    actor = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name="audit_event_logs",
        blank=True,
        null=True,
    )
    event_group = models.CharField(max_length=40, choices=EVENT_GROUP_CHOICES, default="data_lifecycle")
    event_type = models.CharField(max_length=60, default="request")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="success")
    content_type = models.ForeignKey(
        ContentType,
        on_delete=models.SET_NULL,
        related_name="audit_event_logs",
        blank=True,
        null=True,
    )
    object_id = models.CharField(max_length=64, blank=True)
    content_object = GenericForeignKey("content_type", "object_id")
    model_label = models.CharField(max_length=120, blank=True)
    object_pk = models.CharField(max_length=64, blank=True)
    object_repr = models.CharField(max_length=255, blank=True)
    changes = models.JSONField(blank=True, default=dict)
    previous_values = models.JSONField(blank=True, default=dict)
    current_values = models.JSONField(blank=True, default=dict)
    note = models.TextField(blank=True)
    metadata = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["-created_at", "-id"]
        permissions = [
            ("view_tenant_audit_logs", "Can view tenant-scoped audit logs"),
            ("view_global_audit_logs", "Can view global audit logs across tenants"),
        ]

    def __str__(self):
        target = self.object_repr or self.model_label or "Audit Event"
        return f"{self.event_group}:{self.event_type} -> {target}"


class AuditAccessLog(TimeStampedModel):
    EVENT_GROUP_CHOICES = [
        ("access", "Access"),
        ("security", "Security"),
    ]
    tenant = models.ForeignKey(
        Tenant,
        on_delete=models.CASCADE,
        related_name="audit_access_logs",
        blank=True,
        null=True,
    )
    branch = models.ForeignKey(
        TenantBranch,
        on_delete=models.SET_NULL,
        related_name="audit_access_logs",
        blank=True,
        null=True,
    )
    actor = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name="audit_access_logs",
        blank=True,
        null=True,
    )
    event_group = models.CharField(max_length=20, choices=EVENT_GROUP_CHOICES, default="access")
    event_type = models.CharField(max_length=20, default="view")
    request_method = models.CharField(max_length=10, blank=True)
    request_path = models.CharField(max_length=500)
    query_params = models.JSONField(blank=True, default=dict)
    status_code = models.PositiveIntegerField(blank=True, null=True)
    remote_addr = models.CharField(max_length=64, blank=True)
    user_agent = models.CharField(max_length=500, blank=True)
    metadata = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["-created_at", "-id"]
        permissions = [
            ("view_tenant_access_logs", "Can view tenant-scoped access logs"),
            ("view_global_access_logs", "Can view global access logs across tenants"),
        ]

    def __str__(self):
        return f"{self.request_method} {self.request_path} [{self.status_code or '-'}]"


class BankReconciliationSession(TimeStampedModel):
    STATUS_CHOICES = [
        ("draft", "Draft"),
        ("in_progress", "In Progress"),
        ("completed", "Completed"),
    ]

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="bank_reconciliation_sessions")
    account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="bank_reconciliation_sessions")
    financial_year = models.ForeignKey(
        FinancialYear,
        on_delete=models.SET_NULL,
        related_name="bank_reconciliation_sessions",
        blank=True,
        null=True,
    )
    period = models.ForeignKey(
        AccountingPeriod,
        on_delete=models.SET_NULL,
        related_name="bank_reconciliation_sessions",
        blank=True,
        null=True,
    )
    name = models.CharField(max_length=150)
    code = models.CharField(max_length=50, blank=True)
    statement_date_from = models.DateField()
    statement_date_to = models.DateField()
    statement_opening_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    statement_closing_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="draft")
    metadata = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["tenant__name", "-statement_date_to", "-id"]
        unique_together = ("tenant", "code")

    def clean(self):
        if self.statement_date_to and self.statement_date_from and self.statement_date_to < self.statement_date_from:
            raise ValidationError({"statement_date_to": "Statement end date must be on or after the start date."})
        if self.account_id and self.tenant_id and self.account.tenant_id != self.tenant_id:
            raise ValidationError({"account": "Account belongs to a different tenant."})
        if self.financial_year_id:
            if self.financial_year.tenant_id != self.tenant_id:
                raise ValidationError({"financial_year": "Financial year belongs to a different tenant."})
            if (
                self.statement_date_from
                and self.statement_date_to
                and (
                    self.statement_date_from < self.financial_year.start_date
                    or self.statement_date_to > self.financial_year.end_date
                )
            ):
                raise ValidationError(
                    "Reconciliation session dates must remain within the selected financial year."
                )
        if self.period_id:
            if self.period.tenant_id != self.tenant_id:
                raise ValidationError({"period": "Accounting period belongs to a different tenant."})
            if self.financial_year_id and self.period.financial_year_id != self.financial_year_id:
                raise ValidationError({"period": "Accounting period does not belong to the selected financial year."})
            if (
                self.statement_date_from
                and self.statement_date_to
                and (
                    self.statement_date_from < self.period.start_date
                    or self.statement_date_to > self.period.end_date
                )
            ):
                raise ValidationError(
                    "Reconciliation session dates must remain within the selected accounting period."
                )

    def save(self, *args, **kwargs):
        if not self.code:
            self.code = f"REC-{timezone.now().strftime('%Y%m%d%H%M%S')}-{self.tenant_id or 'X'}"
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.code} - {self.name}"


class BankStatementLine(TimeStampedModel):
    STATUS_CHOICES = [
        ("open", "Open"),
        ("matched", "Matched"),
        ("ignored", "Ignored"),
    ]

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="bank_statement_lines")
    session = models.ForeignKey(BankReconciliationSession, on_delete=models.CASCADE, related_name="lines")
    line_date = models.DateField()
    reference = models.CharField(max_length=120, blank=True)
    description = models.CharField(max_length=255, blank=True)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="open")
    matched_journal_line = models.OneToOneField(
        JournalEntryLine,
        on_delete=models.SET_NULL,
        related_name="reconciliation_statement_line",
        blank=True,
        null=True,
    )
    matched_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name="bank_statement_line_matches",
        blank=True,
        null=True,
    )
    matched_at = models.DateTimeField(blank=True, null=True)
    notes = models.TextField(blank=True)
    metadata = models.JSONField(blank=True, default=dict)

    class Meta:
        ordering = ["line_date", "id"]

    def clean(self):
        if self.session_id and self.tenant_id and self.session.tenant_id != self.tenant_id:
            raise ValidationError({"session": "Reconciliation session belongs to a different tenant."})
        if self.line_date and self.session_id:
            if self.line_date < self.session.statement_date_from or self.line_date > self.session.statement_date_to:
                raise ValidationError(
                    {"line_date": "Statement line date must remain within the reconciliation session date range."}
                )
        if self.matched_journal_line_id:
            journal_line = self.matched_journal_line
            if journal_line.entry.tenant_id != self.tenant_id:
                raise ValidationError({"matched_journal_line": "Journal line belongs to a different tenant."})
            if journal_line.account_id != self.session.account_id:
                raise ValidationError({"matched_journal_line": "Journal line account does not match the reconciliation account."})
            if journal_line.entry.status != "posted":
                raise ValidationError({"matched_journal_line": "Only posted journal lines can be reconciled."})

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.session.code} - {self.line_date} - {self.amount}"
