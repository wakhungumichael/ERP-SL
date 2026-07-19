from django.contrib.auth import authenticate
from django.contrib.auth.models import Group, Permission, User
from rest_framework import serializers

from Platform_Core.models import (
    BackupPolicy,
    DocumentTemplate,
    IntegrationEndpoint,
    LicenseKey,
    ModuleDefinition,
    PlanModule,
    SubscriptionPlan,
    Tenant,
    TenantBranch,
    TenantModuleActivation,
    TenantSettings,
    TenantSubscription,
    TenantUserProfile,
    WorkspaceMenuItem,
    WorkspaceMenuSection,
    WorkspaceRoleMenuItem,
)


class ModuleDefinitionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ModuleDefinition
        fields = (
            "id",
            "slug",
            "name",
            "category",
            "description",
            "is_core",
            "is_active",
            "config_schema",
            "created_at",
            "updated_at",
        )


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
    class Meta:
        model = Tenant
        fields = ("id", "name", "code", "status", "primary_domain", "default_currency")


class TenantSerializer(serializers.ModelSerializer):
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
            "default_currency",
            "timezone",
            "status",
            "is_active",
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
    tenant_id = serializers.PrimaryKeyRelatedField(source="tenant", queryset=Tenant.objects.all(), write_only=True)

    class Meta:
        model = BackupPolicy
        fields = (
            "id",
            "tenant",
            "tenant_id",
            "name",
            "frequency",
            "retention_days",
            "storage_backend",
            "target_path",
            "last_successful_backup",
            "is_active",
            "options",
            "created_at",
            "updated_at",
        )


class GroupSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = Group
        fields = ("id", "name")


class PermissionSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ("id", "name", "codename", "content_type")


class GroupDetailSerializer(serializers.ModelSerializer):
    permissions = PermissionSummarySerializer(many=True, read_only=True)
    permission_ids = serializers.PrimaryKeyRelatedField(
        source="permissions",
        queryset=Permission.objects.all(),
        many=True,
        write_only=True,
        required=False,
    )

    class Meta:
        model = Group
        fields = ("id", "name", "permissions", "permission_ids")


class TenantBranchSerializer(serializers.ModelSerializer):
    class Meta:
        model = TenantBranch
        fields = ("id", "tenant", "name", "address", "email", "phone", "is_active", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")


class TenantSettingsSerializer(serializers.ModelSerializer):
    smtp_password = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = TenantSettings
        fields = (
            "id", "tenant", "logo_url", "primary_color", "support_email",
            "invoice_prefix", "footer_text",
            "smtp_host", "smtp_port", "smtp_user", "smtp_password", "smtp_use_tls",
            "default_payment_terms_days", "created_at", "updated_at",
        )
        read_only_fields = ("id", "tenant", "created_at", "updated_at")

    def update(self, instance, validated_data):
        password = validated_data.pop("smtp_password", None)
        instance = super().update(instance, validated_data)
        if password:
            instance.smtp_password = password
            instance.save(update_fields=["smtp_password"])
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
    tenant_id = serializers.SerializerMethodField()
    tenant_name = serializers.SerializerMethodField()
    branch_id = serializers.SerializerMethodField()
    branch_name = serializers.SerializerMethodField()
    job_title = serializers.SerializerMethodField()
    is_tenant_admin = serializers.SerializerMethodField()

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
            "tenant_id",
            "tenant_name",
            "branch_id",
            "branch_name",
            "job_title",
            "is_tenant_admin",
        )

    def get_permissions(self, obj):
        return sorted(obj.get_all_permissions())

    def _profile(self, obj):
        return getattr(obj, "tenant_profile", None)

    def get_tenant_id(self, obj):
        p = self._profile(obj)
        return p.tenant_id if p else None

    def get_tenant_name(self, obj):
        p = self._profile(obj)
        return p.tenant.name if p and p.tenant_id else None

    def get_branch_id(self, obj):
        p = self._profile(obj)
        return p.branch_id if p else None

    def get_branch_name(self, obj):
        p = self._profile(obj)
        return p.branch.name if p and p.branch_id else None

    def get_job_title(self, obj):
        p = self._profile(obj)
        return p.job_title if p else ""

    def get_is_tenant_admin(self, obj):
        p = self._profile(obj)
        return p.is_tenant_admin if p else False


class TokenLoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate(self, attrs):
        request = self.context.get("request")
        username = attrs.get("username")
        password = attrs.get("password")
        user = authenticate(request=request, username=username, password=password)
        if not user:
            raise serializers.ValidationError("Invalid username or password.")
        if not user.is_active:
            raise serializers.ValidationError("This user account is inactive.")
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
