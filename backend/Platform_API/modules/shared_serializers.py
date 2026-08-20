from datetime import timedelta

from django.contrib.auth import authenticate
from django.contrib.auth.models import Group, Permission, User
from django.contrib.contenttypes.models import ContentType
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from Platform_Core.audit import log_business_event

from Platform_Core.platform import sync_subscription_modules
from Platform_Core.models import (
    AuditAccessLog,
    AuditEventLog,
    BackupPolicy,
    DocumentTemplate,
    Industry,
    IntegrationEndpoint,
    LicenseKey,
    ModuleDefinition,
    OrganizationMembership,
    PlanModule,
    PricingRule,
    PricingRuleType,
    SubscriptionPlan,
    SubscriptionBillingRequest,
    Tenant,
    TenantBranch,
    TenantExportJob,
    TenantModuleActivation,
    TenantOffboardingRequest,
    TenantPurgeJob,
    TenantSettings,
    TenantSubscription,
    TenantUserProfile,
    WorkspaceMenuItem,
    WorkspaceMenuSection,
    WorkspaceRoleMenuItem,
    WorkflowDefinition,
    WorkflowEntityBinding,
    WorkflowInboxItem,
    WorkflowNodeDefinition,
    WorkflowStepDefinition,
    WorkflowTransitionDefinition,
)


PROTECTED_SHARED_ROLE_NAMES = {"Superadmin", "Platform Admin", "Tenant Admin"}
TENANT_ASSIGNABLE_SHARED_ROLE_NAMES = {"Finance", "Operator"}


def tenant_role_prefix(tenant_id):
    return f"tenant:{tenant_id}:"


def role_scope_for_name(name, tenant_id=None):
    if tenant_id and name.startswith(tenant_role_prefix(tenant_id)):
        return "tenant"
    if name.startswith("tenant:"):
        return "tenant"
    return "system"


def display_role_name(name, tenant_id=None):
    if tenant_id and name.startswith(tenant_role_prefix(tenant_id)):
        return name[len(tenant_role_prefix(tenant_id)) :]
    if name.startswith("tenant:"):
        parts = name.split(":", 2)
        if len(parts) == 3 and parts[2]:
            return parts[2]
    return name


def role_is_assignable(name, tenant_id=None):
    if name in PROTECTED_SHARED_ROLE_NAMES:
        return False
    if name in TENANT_ASSIGNABLE_SHARED_ROLE_NAMES:
        return True
    return role_scope_for_name(name, tenant_id) == "tenant"


def role_is_editable(name, tenant_id=None, is_superadmin=False):
    if is_superadmin:
        return True
    return role_scope_for_name(name, tenant_id) == "tenant"


class IndustrySerializer(serializers.ModelSerializer):
    class Meta:
        model = Industry
        fields = (
            "id",
            "slug",
            "name",
            "description",
            "is_active",
            "metadata",
            "created_at",
            "updated_at",
        )


class ModuleDefinitionSerializer(serializers.ModelSerializer):
    industries = IndustrySerializer(many=True, read_only=True)
    plan_count = serializers.SerializerMethodField()
    active_tenant_count = serializers.SerializerMethodField()
    active_subscription_count = serializers.SerializerMethodField()
    industry_ids = serializers.PrimaryKeyRelatedField(
        source="industries",
        queryset=Industry.objects.all(),
        many=True,
        write_only=True,
        required=False,
    )

    class Meta:
        model = ModuleDefinition
        fields = (
            "id",
            "slug",
            "name",
            "category",
            "scope",
            "description",
            "is_core",
            "is_active",
            "industries",
            "plan_count",
            "active_tenant_count",
            "active_subscription_count",
            "industry_ids",
            "config_schema",
            "created_at",
            "updated_at",
        )

    def get_plan_count(self, obj):
        return obj.plan_assignments.count()

    def get_active_tenant_count(self, obj):
        return obj.tenant_activations.filter(status__in=("enabled", "trial")).values("tenant_id").distinct().count()

    def get_active_subscription_count(self, obj):
        return obj.tenant_activations.filter(status__in=("enabled", "trial"), subscription__isnull=False).values("subscription_id").distinct().count()


class PlanModuleSerializer(serializers.ModelSerializer):
    module = ModuleDefinitionSerializer(read_only=True)
    module_id = serializers.PrimaryKeyRelatedField(
        source="module",
        queryset=ModuleDefinition.objects.all(),
        write_only=True,
    )

    class Meta:
        model = PlanModule
        fields = (
            "id",
            "module",
            "module_id",
            "is_enabled",
            "usage_limit",
            "config",
            "created_at",
            "updated_at",
        )

    def validate(self, attrs):
        attrs = super().validate(attrs)
        module = attrs.get("module") or getattr(self.instance, "module", None)
        if module is not None and module.scope == "platform_admin":
            raise serializers.ValidationError(
                {"module_id": "Platform admin modules cannot be assigned to organization subscription plans."}
            )
        return attrs


class SubscriptionPlanSerializer(serializers.ModelSerializer):
    modules = PlanModuleSerializer(many=True, read_only=True)

    class Meta:
        model = SubscriptionPlan
        fields = (
            "id",
            "code",
            "name",
            "billing_period",
            "price",
            "currency",
            "trial_days",
            "max_users",
            "max_branches",
            "max_devices",
            "max_monthly_transactions",
            "is_active",
            "features",
            "modules",
            "created_at",
            "updated_at",
        )


class TenantSummarySerializer(serializers.ModelSerializer):
    industry = IndustrySerializer(read_only=True)

    class Meta:
        model = Tenant
        fields = ("id", "name", "code", "industry", "status", "primary_domain", "default_currency")


class TenantSerializer(serializers.ModelSerializer):
    industry = IndustrySerializer(read_only=True)
    industry_id = serializers.PrimaryKeyRelatedField(
        source="industry",
        queryset=Industry.objects.filter(is_active=True),
        write_only=True,
        required=False,
        allow_null=True,
    )

    class Meta:
        model = Tenant
        fields = (
            "id",
            "name",
            "code",
            "legal_name",
            "subdomain",
            "primary_domain",
            "public_ip_address",
            "contact_email",
            "contact_phone",
            "industry",
            "industry_id",
            "default_currency",
            "timezone",
            "status",
            "is_active",
            "metadata",
            "created_at",
            "updated_at",
        )


class PricingRuleTypeSerializer(serializers.ModelSerializer):
    module = ModuleDefinitionSerializer(read_only=True)
    module_id = serializers.PrimaryKeyRelatedField(
        source="module",
        queryset=ModuleDefinition.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
    )

    class Meta:
        model = PricingRuleType
        fields = (
            "id",
            "slug",
            "name",
            "description",
            "module",
            "module_id",
            "config_schema",
            "is_active",
            "created_at",
            "updated_at",
        )


class PricingRuleSerializer(serializers.ModelSerializer):
    tenant = TenantSummarySerializer(read_only=True)
    tenant_id = serializers.PrimaryKeyRelatedField(
        source="tenant",
        queryset=Tenant.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
    )
    module = ModuleDefinitionSerializer(read_only=True)
    module_id = serializers.PrimaryKeyRelatedField(source="module", queryset=ModuleDefinition.objects.all(), write_only=True)
    rule_type = PricingRuleTypeSerializer(read_only=True)
    rule_type_id = serializers.PrimaryKeyRelatedField(
        source="rule_type",
        queryset=PricingRuleType.objects.filter(is_active=True),
        write_only=True,
    )

    class Meta:
        model = PricingRule
        fields = (
            "id",
            "tenant",
            "tenant_id",
            "module",
            "module_id",
            "rule_type",
            "rule_type_id",
            "name",
            "priority",
            "is_active",
            "adjustment_mode",
            "amount",
            "conditions",
            "metadata",
            "created_at",
            "updated_at",
        )


class TenantSubscriptionSerializer(serializers.ModelSerializer):
    tenant = TenantSummarySerializer(read_only=True)
    tenant_id = serializers.PrimaryKeyRelatedField(source="tenant", queryset=Tenant.objects.all(), write_only=True)
    plan = SubscriptionPlanSerializer(read_only=True)
    plan_id = serializers.PrimaryKeyRelatedField(
        source="plan", queryset=SubscriptionPlan.objects.all(), write_only=True
    )

    class Meta:
        model = TenantSubscription
        fields = (
            "id",
            "tenant",
            "tenant_id",
            "plan",
            "plan_id",
            "status",
            "start_date",
            "end_date",
            "grace_until",
            "auto_renew",
            "amount",
            "currency",
            "metadata",
            "created_at",
            "updated_at",
        )

    def _resolve_demo_period(self, plan, validated_data):
        demo_days = validated_data.get("metadata", {}).get("demo_days")
        if demo_days in (None, ""):
            demo_days = plan.trial_days
        try:
            demo_days = int(demo_days or 0)
        except (TypeError, ValueError):
            raise serializers.ValidationError({"metadata": "demo_days must be a whole number."})
        if demo_days < 0:
            raise serializers.ValidationError({"metadata": "demo_days cannot be negative."})
        return demo_days

    def create(self, validated_data):
        plan = validated_data["plan"]
        status_value = validated_data.get("status") or "trial"
        demo_days = self._resolve_demo_period(plan, validated_data)
        if status_value == "trial" and not validated_data.get("end_date") and demo_days > 0:
            start_date = validated_data.get("start_date") or timezone.localdate()
            validated_data["end_date"] = start_date + timedelta(days=demo_days)
        subscription = super().create(validated_data)
        sync_subscription_modules(subscription)
        return subscription

    def update(self, instance, validated_data):
        plan = validated_data.get("plan", instance.plan)
        next_status = validated_data.get("status", instance.status)
        if next_status == "trial" and "end_date" not in validated_data:
            demo_days = self._resolve_demo_period(plan, validated_data if validated_data else {"metadata": instance.metadata})
            if demo_days > 0:
                start_date = validated_data.get("start_date", instance.start_date) or timezone.localdate()
                validated_data["end_date"] = start_date + timedelta(days=demo_days)
        subscription = super().update(instance, validated_data)
        sync_subscription_modules(subscription)
        return subscription


class SubscriptionBillingRequestSerializer(serializers.ModelSerializer):
    tenant = TenantSummarySerializer(read_only=True)
    tenant_id = serializers.PrimaryKeyRelatedField(source="tenant", queryset=Tenant.objects.all(), write_only=True, required=False)
    subscription = TenantSubscriptionSerializer(read_only=True)
    subscription_id = serializers.PrimaryKeyRelatedField(
        source="subscription",
        queryset=TenantSubscription.objects.select_related("tenant", "plan").all(),
        write_only=True,
        required=False,
        allow_null=True,
    )
    gateway = serializers.SerializerMethodField()
    gateway_id = serializers.PrimaryKeyRelatedField(
        source="gateway",
        queryset=IntegrationEndpoint.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
    )

    def get_gateway(self, obj):
        gateway = getattr(obj, "gateway", None)
        if gateway is None:
            return None
        return IntegrationEndpointSerializer(gateway, context=self.context).data

    class Meta:
        model = SubscriptionBillingRequest
        fields = (
            "id",
            "tenant",
            "tenant_id",
            "subscription",
            "subscription_id",
            "gateway",
            "gateway_id",
            "checkout_reference",
            "payment_provider",
            "amount",
            "currency",
            "phone_number",
            "status",
            "external_reference",
            "request_payload",
            "response_payload",
            "processed_at",
            "notes",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "checkout_reference",
            "payment_provider",
            "request_payload",
            "response_payload",
            "processed_at",
        )


class LicenseKeySerializer(serializers.ModelSerializer):
    tenant = TenantSummarySerializer(read_only=True)
    tenant_id = serializers.PrimaryKeyRelatedField(source="tenant", queryset=Tenant.objects.all(), write_only=True)
    subscription_id = serializers.PrimaryKeyRelatedField(
        source="subscription",
        queryset=TenantSubscription.objects.all(),
        write_only=True,
        allow_null=True,
        required=False,
    )

    class Meta:
        model = LicenseKey
        fields = (
            "id",
            "tenant",
            "tenant_id",
            "subscription",
            "subscription_id",
            "license_key",
            "status",
            "activation_date",
            "expiry_date",
            "seats",
            "device_limit",
            "offline_grace_days",
            "last_validated_at",
            "notes",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("subscription",)


class TenantModuleActivationSerializer(serializers.ModelSerializer):
    tenant = TenantSummarySerializer(read_only=True)
    tenant_id = serializers.PrimaryKeyRelatedField(source="tenant", queryset=Tenant.objects.all(), write_only=True)
    module = ModuleDefinitionSerializer(read_only=True)
    module_id = serializers.PrimaryKeyRelatedField(
        source="module", queryset=ModuleDefinition.objects.all(), write_only=True
    )
    subscription_id = serializers.PrimaryKeyRelatedField(
        source="subscription",
        queryset=TenantSubscription.objects.all(),
        write_only=True,
        allow_null=True,
        required=False,
    )

    class Meta:
        model = TenantModuleActivation
        fields = (
            "id",
            "tenant",
            "tenant_id",
            "module",
            "module_id",
            "subscription",
            "subscription_id",
            "status",
            "enabled_at",
            "expires_at",
            "config",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("subscription",)


class IntegrationEndpointSerializer(serializers.ModelSerializer):
    tenant = TenantSummarySerializer(read_only=True)
    tenant_id = serializers.PrimaryKeyRelatedField(source="tenant", queryset=Tenant.objects.all(), write_only=True)

    class Meta:
        model = IntegrationEndpoint
        fields = (
            "id",
            "tenant",
            "tenant_id",
            "name",
            "integration_type",
            "transport",
            "provider",
            "base_url",
            "auth_type",
            "is_active",
            "is_primary",
            "timeout_seconds",
            "credentials",
            "connection_settings",
            "healthcheck_path",
            "created_at",
            "updated_at",
        )


class DocumentTemplateSerializer(serializers.ModelSerializer):
    tenant = TenantSummarySerializer(read_only=True)
    tenant_id = serializers.PrimaryKeyRelatedField(
        source="tenant", queryset=Tenant.objects.all(), write_only=True, allow_null=True, required=False
    )

    class Meta:
        model = DocumentTemplate
        fields = (
            "id",
            "tenant",
            "tenant_id",
            "name",
            "document_type",
            "engine",
            "is_default",
            "is_active",
            "subject_template",
            "body_template",
            "stylesheet",
            "version",
            "created_at",
            "updated_at",
        )


class BackupPolicySerializer(serializers.ModelSerializer):
    tenant = TenantSummarySerializer(read_only=True)
    tenant_id = serializers.PrimaryKeyRelatedField(
        source="tenant",
        queryset=Tenant.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
    )
    tenant_name = serializers.SerializerMethodField()
    is_global = serializers.SerializerMethodField()

    class Meta:
        model = BackupPolicy
        fields = (
            "id",
            "tenant",
            "tenant_id",
            "tenant_name",
            "is_global",
            "name",
            "frequency",
            "retention_days",
            "storage_backend",
            "target_path",
            "last_successful_backup",
            "last_backup_file",
            "last_backup_size_bytes",
            "is_active",
            "options",
            "created_at",
            "updated_at",
        )

    def get_tenant_name(self, obj):
        return obj.tenant.name if obj.tenant else "General"

    def get_is_global(self, obj):
        return obj.tenant_id is None


class TenantOffboardingRequestSerializer(serializers.ModelSerializer):
    tenant = TenantSummarySerializer(read_only=True)
    requested_by_name = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()

    class Meta:
        model = TenantOffboardingRequest
        fields = (
            "id",
            "tenant",
            "status",
            "requested_at",
            "requested_by",
            "requested_by_name",
            "approved_at",
            "approved_by",
            "approved_by_name",
            "retention_until",
            "export_requested",
            "notes",
            "metadata",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields

    def get_requested_by_name(self, obj):
        if obj.requested_by is None:
            return None
        return obj.requested_by.get_full_name() or obj.requested_by.username

    def get_approved_by_name(self, obj):
        if obj.approved_by is None:
            return None
        return obj.approved_by.get_full_name() or obj.approved_by.username


class TenantExportJobSerializer(serializers.ModelSerializer):
    tenant = TenantSummarySerializer(read_only=True)
    requested_by_name = serializers.SerializerMethodField()

    class Meta:
        model = TenantExportJob
        fields = (
            "id",
            "tenant",
            "offboarding_request",
            "requested_by",
            "requested_by_name",
            "status",
            "export_format",
            "storage_backend",
            "artifact_path",
            "artifact_checksum",
            "artifact_size_bytes",
            "row_counts",
            "started_at",
            "completed_at",
            "failure_reason",
            "metadata",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields

    def get_requested_by_name(self, obj):
        if obj.requested_by is None:
            return None
        return obj.requested_by.get_full_name() or obj.requested_by.username


class TenantPurgeJobSerializer(serializers.ModelSerializer):
    tenant = TenantSummarySerializer(read_only=True)
    requested_by_name = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()

    class Meta:
        model = TenantPurgeJob
        fields = (
            "id",
            "tenant",
            "offboarding_request",
            "requested_by",
            "requested_by_name",
            "approved_by",
            "approved_by_name",
            "status",
            "scheduled_for",
            "started_at",
            "completed_at",
            "failure_reason",
            "summary",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields

    def get_requested_by_name(self, obj):
        if obj.requested_by is None:
            return None
        return obj.requested_by.get_full_name() or obj.requested_by.username

    def get_approved_by_name(self, obj):
        if obj.approved_by is None:
            return None
        return obj.approved_by.get_full_name() or obj.approved_by.username


class GroupSummarySerializer(serializers.ModelSerializer):
    display_name = serializers.SerializerMethodField()
    scope = serializers.SerializerMethodField()
    is_system = serializers.SerializerMethodField()
    is_editable = serializers.SerializerMethodField()
    is_assignable = serializers.SerializerMethodField()

    def _tenant_id(self):
        return self.context.get("tenant_id")

    def _is_superadmin(self):
        return bool(self.context.get("is_superadmin"))

    def get_display_name(self, obj):
        return display_role_name(obj.name, self._tenant_id())

    def get_scope(self, obj):
        return role_scope_for_name(obj.name, self._tenant_id())

    def get_is_system(self, obj):
        return self.get_scope(obj) == "system"

    def get_is_editable(self, obj):
        return role_is_editable(obj.name, self._tenant_id(), self._is_superadmin())

    def get_is_assignable(self, obj):
        return role_is_assignable(obj.name, self._tenant_id())

    class Meta:
        model = Group
        fields = ("id", "name", "display_name", "scope", "is_system", "is_editable", "is_assignable")


class ContentTypeSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = ContentType
        fields = ("id", "app_label", "model")


class PermissionSummarySerializer(serializers.ModelSerializer):
    content_type = ContentTypeSummarySerializer(read_only=True)

    class Meta:
        model = Permission
        fields = ("id", "name", "codename", "content_type")


class GroupDetailSerializer(serializers.ModelSerializer):
    display_name = serializers.SerializerMethodField()
    scope = serializers.SerializerMethodField()
    is_system = serializers.SerializerMethodField()
    is_editable = serializers.SerializerMethodField()
    is_assignable = serializers.SerializerMethodField()
    permissions = PermissionSummarySerializer(many=True, read_only=True)
    permission_ids = serializers.PrimaryKeyRelatedField(
        source="permissions",
        queryset=Permission.objects.all(),
        many=True,
        write_only=True,
        required=False,
    )

    def _tenant_id(self):
        return self.context.get("tenant_id")

    def _is_superadmin(self):
        return bool(self.context.get("is_superadmin"))

    def get_display_name(self, obj):
        return display_role_name(obj.name, self._tenant_id())

    def get_scope(self, obj):
        return role_scope_for_name(obj.name, self._tenant_id())

    def get_is_system(self, obj):
        return self.get_scope(obj) == "system"

    def get_is_editable(self, obj):
        return role_is_editable(obj.name, self._tenant_id(), self._is_superadmin())

    def get_is_assignable(self, obj):
        return role_is_assignable(obj.name, self._tenant_id())

    class Meta:
        model = Group
        fields = (
            "id",
            "name",
            "display_name",
            "scope",
            "is_system",
            "is_editable",
            "is_assignable",
            "permissions",
            "permission_ids",
        )


class TenantBranchSerializer(serializers.ModelSerializer):
    class Meta:
        model = TenantBranch
        fields = ("id", "tenant", "name", "address", "email", "phone", "is_active", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")


class TenantSettingsSerializer(serializers.ModelSerializer):
    smtp_password = serializers.CharField(write_only=True, required=False, allow_blank=True)
    logo_url = serializers.SerializerMethodField()
    logo_file = serializers.ImageField(required=False, allow_null=True)
    login_page_config = serializers.JSONField(required=False)
    footer_menu = serializers.JSONField(required=False)
    landing_page_config = serializers.JSONField(required=False)
    invoice_template_id = serializers.PrimaryKeyRelatedField(
        source="invoice_template",
        queryset=DocumentTemplate.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
    )
    estimate_template_id = serializers.PrimaryKeyRelatedField(
        source="estimate_template",
        queryset=DocumentTemplate.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
    )
    receipt_template_id = serializers.PrimaryKeyRelatedField(
        source="receipt_template",
        queryset=DocumentTemplate.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
    )
    statement_template_id = serializers.PrimaryKeyRelatedField(
        source="statement_template",
        queryset=DocumentTemplate.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
    )
    purchase_order_template_id = serializers.PrimaryKeyRelatedField(
        source="purchase_order_template",
        queryset=DocumentTemplate.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
    )
    invoice_template = DocumentTemplateSerializer(read_only=True)
    estimate_template = DocumentTemplateSerializer(read_only=True)
    receipt_template = DocumentTemplateSerializer(read_only=True)
    statement_template = DocumentTemplateSerializer(read_only=True)
    purchase_order_template = DocumentTemplateSerializer(read_only=True)

    class Meta:
        model = TenantSettings
        fields = (
            "id", "tenant", "logo_url", "logo_file", "primary_color",
            "login_page_config", "footer_menu", "landing_page_config", "support_email",
            "invoice_prefix", "footer_text", "default_tax_name", "default_tax_rate",
            "invoice_template", "invoice_template_id",
            "estimate_template", "estimate_template_id",
            "receipt_template", "receipt_template_id",
            "statement_template", "statement_template_id",
            "purchase_order_template", "purchase_order_template_id",
            "smtp_host", "smtp_port", "smtp_user", "smtp_password", "smtp_use_tls",
            "default_payment_terms_days", "created_at", "updated_at",
        )
        read_only_fields = ("id", "tenant", "created_at", "updated_at")

    def get_logo_url(self, obj):
        if getattr(obj, "logo_file", None):
            try:
                request = self.context.get("request")
                url = obj.logo_file.url
                return request.build_absolute_uri(url) if request else url
            except Exception:
                pass
        return obj.logo_url

    def update(self, instance, validated_data):
        password = validated_data.pop("smtp_password", None)
        instance = super().update(instance, validated_data)
        if password:
            instance.smtp_password = password
            instance.save(update_fields=["smtp_password"])
        if getattr(instance, "logo_file", None):
            try:
                instance.logo_url = instance.logo_file.url
                instance.save(update_fields=["logo_url"])
            except Exception:
                pass
        return instance


class TenantUserProfileSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(source="user.id", read_only=True)
    username = serializers.CharField(source="user.username", read_only=True)
    first_name = serializers.CharField(source="user.first_name", read_only=True)
    last_name = serializers.CharField(source="user.last_name", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    tenant_name = serializers.CharField(source="tenant.name", read_only=True)
    branch_name = serializers.CharField(source="branch.name", read_only=True)

    class Meta:
        model = TenantUserProfile
        fields = (
            "id", "user_id", "username", "first_name", "last_name", "email",
            "tenant", "tenant_name", "branch", "branch_name",
            "is_tenant_admin", "job_title", "avatar_url", "created_at", "updated_at",
        )


class OrganizationMembershipSerializer(serializers.ModelSerializer):
    tenant_name = serializers.CharField(source="tenant.name", read_only=True)
    tenant_code = serializers.CharField(source="tenant.code", read_only=True)
    branch_name = serializers.CharField(source="branch.name", read_only=True)

    class Meta:
        model = OrganizationMembership
        fields = (
            "id",
            "tenant",
            "tenant_name",
            "tenant_code",
            "branch",
            "branch_name",
            "role",
            "role_group_name",
            "is_org_admin",
            "is_default",
            "is_active",
            "job_title",
            "created_at",
            "updated_at",
        )


class UserProfileSerializer(serializers.ModelSerializer):
    groups = GroupSummarySerializer(many=True, read_only=True)
    group_ids = serializers.PrimaryKeyRelatedField(
        source="groups",
        queryset=Group.objects.all(),
        many=True,
        write_only=True,
        required=False,
    )
    permissions = serializers.SerializerMethodField()
    organization_id = serializers.SerializerMethodField()
    organization_name = serializers.SerializerMethodField()
    tenant_id = serializers.SerializerMethodField()
    tenant_name = serializers.SerializerMethodField()
    branch_id = serializers.SerializerMethodField()
    branch_name = serializers.SerializerMethodField()
    job_title = serializers.SerializerMethodField()
    is_org_admin = serializers.SerializerMethodField()
    is_tenant_admin = serializers.SerializerMethodField()
    memberships = serializers.SerializerMethodField()
    active_membership_id = serializers.SerializerMethodField()
    active_role = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "first_name",
            "last_name",
            "email",
            "is_active",
            "is_staff",
            "is_superuser",
            "groups",
            "group_ids",
            "permissions",
            "last_login",
            "date_joined",
            "organization_id",
            "organization_name",
            "tenant_id",
            "tenant_name",
            "branch_id",
            "branch_name",
            "job_title",
            "is_org_admin",
            "is_tenant_admin",
            "memberships",
            "active_membership_id",
            "active_role",
        )

    def get_permissions(self, obj):
        return sorted(obj.get_all_permissions())

    def _profile(self, obj):
        return getattr(obj, "tenant_profile", None)

    def _memberships(self, obj):
        prefetched = getattr(obj, "_prefetched_objects_cache", {})
        if "organization_memberships" in prefetched:
            return list(prefetched["organization_memberships"])
        return list(
            obj.organization_memberships.select_related("tenant", "branch").filter(is_active=True).order_by("-is_default", "tenant__name")
        )

    def _active_membership(self, obj):
        memberships = self._memberships(obj)
        for membership in memberships:
            if membership.is_default:
                return membership
        return memberships[0] if memberships else None

    def get_tenant_id(self, obj):
        membership = self._active_membership(obj)
        if membership:
            return membership.tenant_id
        p = self._profile(obj)
        return p.tenant_id if p else None

    def get_organization_id(self, obj):
        return self.get_tenant_id(obj)

    def get_tenant_name(self, obj):
        membership = self._active_membership(obj)
        if membership:
            return membership.tenant.name
        p = self._profile(obj)
        return p.tenant.name if p and p.tenant_id else None

    def get_organization_name(self, obj):
        return self.get_tenant_name(obj)

    def get_branch_id(self, obj):
        membership = self._active_membership(obj)
        if membership and membership.branch_id:
            return membership.branch_id
        p = self._profile(obj)
        return p.branch_id if p else None

    def get_branch_name(self, obj):
        membership = self._active_membership(obj)
        if membership and membership.branch_id:
            return membership.branch.name
        p = self._profile(obj)
        return p.branch.name if p and p.branch_id else None

    def get_job_title(self, obj):
        membership = self._active_membership(obj)
        if membership and membership.job_title:
            return membership.job_title
        p = self._profile(obj)
        return p.job_title if p else ""

    def get_is_tenant_admin(self, obj):
        membership = self._active_membership(obj)
        if membership:
            return membership.is_org_admin
        p = self._profile(obj)
        return p.is_tenant_admin if p else False

    def get_is_org_admin(self, obj):
        return self.get_is_tenant_admin(obj)

    def get_memberships(self, obj):
        return OrganizationMembershipSerializer(self._memberships(obj), many=True).data

    def get_active_membership_id(self, obj):
        membership = self._active_membership(obj)
        return membership.id if membership else None

    def get_active_role(self, obj):
        membership = self._active_membership(obj)
        if membership:
            return membership.role
        return "system_admin" if self.get_is_tenant_admin(obj) else None


class TokenLoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def _bootstrap_membership_from_legacy_profile(self, user):
        profile = getattr(user, "tenant_profile", None)
        tenant = getattr(profile, "tenant", None)
        if not user or tenant is None:
            return
        if OrganizationMembership.objects.filter(user=user, tenant=tenant).exists():
            return

        with transaction.atomic():
            has_default = OrganizationMembership.objects.filter(user=user, is_active=True, is_default=True).exists()
            OrganizationMembership.objects.create(
                user=user,
                tenant=tenant,
                branch=getattr(profile, "branch", None),
                role="system_admin" if getattr(profile, "is_tenant_admin", False) else "member",
                role_group_name="Tenant Admin" if getattr(profile, "is_tenant_admin", False) else "",
                is_org_admin=bool(getattr(profile, "is_tenant_admin", False)),
                is_default=not has_default,
                is_active=True,
                job_title=getattr(profile, "job_title", "") or "",
            )

    def validate(self, attrs):
        request = self.context.get("request")
        username = (attrs.get("username") or "").strip()
        password = attrs.get("password")
        user = authenticate(request=request, username=username, password=password)
        if not user and "@" in username:
            matched_user = User.objects.filter(email__iexact=username).order_by("id").first()
            if matched_user:
                user = authenticate(request=request, username=matched_user.username, password=password)
        if not user:
            log_business_event(
                event_group="security",
                event_type="request",
                note=f"Failed login attempt for username '{username}'.",
                metadata={"username": username, "path": getattr(request, "path", "")},
                status="failed",
            )
            raise serializers.ValidationError("Invalid username or password.")
        if not user.is_active:
            raise serializers.ValidationError("This user account is inactive.")
        # Reject login if the user's tenant has been suspended.
        # Guard against nullable tenant on the profile (profile.tenant may be None).
        profile = getattr(user, "tenant_profile", None)
        tenant = getattr(profile, "tenant", None)
        if tenant is not None and not tenant.is_active:
            log_business_event(
                event_group="security",
                event_type="request",
                tenant=tenant,
                actor=user,
                note="Blocked login because tenant account is suspended.",
                metadata={"username": username, "path": getattr(request, "path", "")},
                status="failed",
            )
            raise serializers.ValidationError(
                "Your organization's account has been suspended. Please contact your platform administrator."
            )
        self._bootstrap_membership_from_legacy_profile(user)
        attrs["user"] = user
        return attrs


class LicenseActivationSerializer(serializers.Serializer):
    subscription_id = serializers.PrimaryKeyRelatedField(
        source="subscription",
        queryset=TenantSubscription.objects.all(),
        required=False,
        allow_null=True,
    )
    expiry_date = serializers.DateTimeField(required=False, allow_null=True)
    seats = serializers.IntegerField(required=False, min_value=1)
    device_limit = serializers.IntegerField(required=False, min_value=1)
    notes = serializers.CharField(required=False, allow_blank=True)


class LicenseValidationSerializer(serializers.Serializer):
    mark_validated = serializers.BooleanField(required=False, default=True)


class SubscriptionModuleSyncSerializer(serializers.Serializer):
    sync_existing = serializers.BooleanField(required=False, default=True)


class WorkspaceMenuItemSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkspaceMenuItem
        fields = ("id", "key", "title", "route_path", "api_path", "sort_order", "is_active")


class WorkspaceMenuItemSerializer(serializers.ModelSerializer):
    section = serializers.SerializerMethodField(read_only=True)
    section_id = serializers.PrimaryKeyRelatedField(source="section", queryset=WorkspaceMenuSection.objects.all(), write_only=True)
    required_module = ModuleDefinitionSerializer(read_only=True)
    required_module_id = serializers.PrimaryKeyRelatedField(
        source="required_module",
        queryset=ModuleDefinition.objects.all(),
        write_only=True,
        allow_null=True,
        required=False,
    )

    class Meta:
        model = WorkspaceMenuItem
        fields = (
            "id",
            "section",
            "section_id",
            "key",
            "title",
            "icon",
            "description",
            "route_path",
            "api_path",
            "badge_text",
            "required_permission",
            "required_module",
            "required_module_id",
            "sort_order",
            "is_active",
            "is_external",
            "metadata",
            "created_at",
            "updated_at",
        )

    def get_section(self, obj):
        return {
            "id": obj.section_id,
            "key": obj.section.key,
            "title": obj.section.title,
        }


class WorkspaceMenuSectionSerializer(serializers.ModelSerializer):
    module = ModuleDefinitionSerializer(read_only=True)
    module_id = serializers.PrimaryKeyRelatedField(
        source="module",
        queryset=ModuleDefinition.objects.all(),
        write_only=True,
        allow_null=True,
        required=False,
    )
    items = WorkspaceMenuItemSummarySerializer(many=True, read_only=True)

    class Meta:
        model = WorkspaceMenuSection
        fields = (
            "id",
            "key",
            "title",
            "icon",
            "description",
            "module",
            "module_id",
            "sort_order",
            "is_active",
            "is_system",
            "metadata",
            "items",
            "created_at",
            "updated_at",
        )


class WorkspaceRoleMenuItemSerializer(serializers.ModelSerializer):
    group = GroupSummarySerializer(read_only=True)
    group_id = serializers.PrimaryKeyRelatedField(source="group", queryset=Group.objects.all(), write_only=True)
    menu_item = WorkspaceMenuItemSummarySerializer(read_only=True)
    menu_item_id = serializers.PrimaryKeyRelatedField(
        source="menu_item",
        queryset=WorkspaceMenuItem.objects.all(),
        write_only=True,
    )

    class Meta:
        model = WorkspaceRoleMenuItem
        fields = (
            "id",
            "group",
            "group_id",
            "menu_item",
            "menu_item_id",
            "can_view",
            "created_at",
            "updated_at",
        )


class UserRoleAssignmentSerializer(serializers.Serializer):
    group_ids = serializers.PrimaryKeyRelatedField(queryset=Group.objects.all(), many=True)
    replace_existing = serializers.BooleanField(required=False, default=True)


class AuditEventLogSerializer(serializers.ModelSerializer):
    tenant_name = serializers.CharField(source="tenant.name", read_only=True)
    branch_name = serializers.CharField(source="branch.name", read_only=True)
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = AuditEventLog
        fields = (
            "id",
            "tenant",
            "tenant_name",
            "branch",
            "branch_name",
            "actor",
            "actor_name",
            "event_group",
            "event_type",
            "status",
            "model_label",
            "object_pk",
            "object_repr",
            "changes",
            "previous_values",
            "current_values",
            "note",
            "metadata",
            "created_at",
            "updated_at",
        )

    def get_actor_name(self, obj):
        if obj.actor is None:
            return None
        return obj.actor.get_full_name() or obj.actor.username


class AuditAccessLogSerializer(serializers.ModelSerializer):
    tenant_name = serializers.CharField(source="tenant.name", read_only=True)
    branch_name = serializers.CharField(source="branch.name", read_only=True)
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = AuditAccessLog
        fields = (
            "id",
            "tenant",
            "tenant_name",
            "branch",
            "branch_name",
            "actor",
            "actor_name",
            "event_group",
            "event_type",
            "request_method",
            "request_path",
            "query_params",
            "status_code",
            "remote_addr",
            "user_agent",
            "metadata",
            "created_at",
            "updated_at",
        )

    def get_actor_name(self, obj):
        if obj.actor is None:
            return None
        return obj.actor.get_full_name() or obj.actor.username


class WorkflowStepDefinitionSerializer(serializers.ModelSerializer):
    approval_group_name = serializers.CharField(source="approval_group.name", read_only=True)

    class Meta:
        model = WorkflowStepDefinition
        fields = (
            "id",
            "workflow",
            "name",
            "step_order",
            "action_type",
            "approval_group",
            "approval_group_name",
            "min_amount",
            "max_amount",
            "cost_center",
            "notify_dashboard",
            "allow_quick_action",
            "is_active",
            "metadata",
            "created_at",
            "updated_at",
        )


class WorkflowEntityBindingSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkflowEntityBinding
        fields = (
            "id",
            "workflow",
            "module_slug",
            "entity_type",
            "entity_label",
            "route_path",
            "api_base_path",
            "trigger_events",
            "is_primary",
            "is_active",
            "metadata",
            "created_at",
            "updated_at",
        )


class WorkflowNodeDefinitionSerializer(serializers.ModelSerializer):
    approval_group_name = serializers.CharField(source="approval_group.name", read_only=True)
    assigned_user_name = serializers.SerializerMethodField()

    class Meta:
        model = WorkflowNodeDefinition
        fields = (
            "id",
            "workflow",
            "code",
            "name",
            "node_type",
            "step_order",
            "is_initial",
            "approval_group",
            "approval_group_name",
            "approval_mode",
            "required_approvals",
            "assigned_user",
            "assigned_user_name",
            "min_amount",
            "max_amount",
            "cost_center",
            "entry_action",
            "exit_action",
            "notify_dashboard",
            "allow_quick_action",
            "sla_hours",
            "position_x",
            "position_y",
            "is_active",
            "metadata",
            "created_at",
            "updated_at",
        )

    def get_assigned_user_name(self, obj):
        if obj.assigned_user:
            return obj.assigned_user.get_full_name() or obj.assigned_user.username
        return None


class WorkflowTransitionDefinitionSerializer(serializers.ModelSerializer):
    from_node_name = serializers.CharField(source="from_node.name", read_only=True)
    to_node_name = serializers.CharField(source="to_node.name", read_only=True)

    class Meta:
        model = WorkflowTransitionDefinition
        fields = (
            "id",
            "workflow",
            "from_node",
            "from_node_name",
            "to_node",
            "to_node_name",
            "name",
            "transition_key",
            "decision",
            "priority",
            "is_default",
            "condition_field",
            "condition_operator",
            "condition_value",
            "is_active",
            "metadata",
            "created_at",
            "updated_at",
        )


class WorkflowDefinitionSerializer(serializers.ModelSerializer):
    tenant = TenantSummarySerializer(read_only=True)
    tenant_id = serializers.PrimaryKeyRelatedField(source="tenant", queryset=Tenant.objects.all(), write_only=True, required=False)
    module = ModuleDefinitionSerializer(read_only=True)
    module_id = serializers.PrimaryKeyRelatedField(
        source="module",
        queryset=ModuleDefinition.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
    )
    steps = WorkflowStepDefinitionSerializer(many=True, read_only=True)
    entity_bindings = WorkflowEntityBindingSerializer(many=True, read_only=True)
    nodes = WorkflowNodeDefinitionSerializer(many=True, read_only=True)
    transitions = WorkflowTransitionDefinitionSerializer(many=True, read_only=True)

    class Meta:
        model = WorkflowDefinition
        validators = []
        fields = (
            "id",
            "tenant",
            "tenant_id",
            "module",
            "module_id",
            "code",
            "name",
            "entity_type",
            "scope",
            "trigger_event",
            "description",
            "is_active",
            "allow_dashboard_quick_actions",
            "metadata",
            "steps",
            "entity_bindings",
            "nodes",
            "transitions",
            "created_at",
            "updated_at",
        )

    def validate(self, attrs):
        if attrs.get("tenant") is not None:
            return attrs

        request = self.context.get("request")
        user = getattr(request, "user", None) if request else None
        profile = getattr(user, "tenant_profile", None) if user else None
        tenant = getattr(profile, "tenant", None)
        if tenant is not None:
            attrs["tenant"] = tenant
        return attrs


class WorkflowInboxItemSerializer(serializers.ModelSerializer):
    tenant = TenantSummarySerializer(read_only=True)
    workflow_name = serializers.CharField(source="workflow.name", read_only=True)
    assigned_group_name = serializers.CharField(source="assigned_group.name", read_only=True)
    assigned_user_name = serializers.SerializerMethodField()
    acted_by_name = serializers.SerializerMethodField()

    class Meta:
        model = WorkflowInboxItem
        fields = (
            "id",
            "tenant",
            "workflow",
            "workflow_name",
            "step_definition",
            "node_definition",
            "module_slug",
            "entity_type",
            "entity_id",
            "reference",
            "title",
            "detail",
            "route_path",
            "action_url",
            "status",
            "assigned_group",
            "assigned_group_name",
            "assigned_user",
            "assigned_user_name",
            "acted_by",
            "acted_by_name",
            "acted_at",
            "quick_actions",
            "metadata",
            "created_at",
            "updated_at",
        )

    def get_assigned_user_name(self, obj):
        if obj.assigned_user:
            return obj.assigned_user.get_full_name() or obj.assigned_user.username
        return None

    def get_acted_by_name(self, obj):
        if obj.acted_by:
            return obj.acted_by.get_full_name() or obj.acted_by.username
        return None
