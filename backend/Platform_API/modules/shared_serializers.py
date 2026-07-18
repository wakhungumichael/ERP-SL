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
    TenantModuleActivation,
    TenantSubscription,
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
        )

    def get_permissions(self, obj):
        return sorted(obj.get_all_permissions())


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
