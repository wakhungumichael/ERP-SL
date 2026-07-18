from django.contrib.auth.models import Group, Permission, User
from django.contrib.auth import logout
from django.conf import settings
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework import generics
from rest_framework.decorators import api_view
from rest_framework.authentication import BasicAuthentication, TokenAuthentication
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.views import APIView
from rest_framework.authtoken.models import Token

from Platform_Core.integrations import build_integration_health_snapshot, indicator_source_registry
from Platform_Core.platform import (
    activate_license,
    build_workspace_navigation,
    get_tenant_module_access,
    sync_subscription_modules,
    validate_license,
)
from Platform_Core.models import (
    BackupPolicy,
    DocumentTemplate,
    IntegrationEndpoint,
    LicenseKey,
    ModuleDefinition,
    SubscriptionPlan,
    Tenant,
    TenantModuleActivation,
    TenantSubscription,
    WorkspaceMenuItem,
    WorkspaceMenuSection,
    WorkspaceRoleMenuItem,
)

from .serializers import (
    BackupPolicySerializer,
    DocumentTemplateSerializer,
    GroupDetailSerializer,
    IntegrationEndpointSerializer,
    LicenseActivationSerializer,
    LicenseKeySerializer,
    LicenseValidationSerializer,
    ModuleDefinitionSerializer,
    PermissionSummarySerializer,
    SubscriptionModuleSyncSerializer,
    SubscriptionPlanSerializer,
    TokenLoginSerializer,
    TenantModuleActivationSerializer,
    TenantSerializer,
    TenantSubscriptionSerializer,
    UserRoleAssignmentSerializer,
    UserProfileSerializer,
    WorkspaceMenuItemSerializer,
    WorkspaceMenuSectionSerializer,
    WorkspaceRoleMenuItemSerializer,
)
from Platform_API.modules.api import error_response, request_scope, success_response
from Platform_API.modules.mixins import ModuleAPIViewMixin, TenantScopedQuerysetMixin


@api_view(["GET"])
def platform_overview(request):
    return success_response(
        "Platform overview loaded successfully.",
        data={
            "scope": request_scope(request),
            "platform": {
                "name": settings.PLATFORM_NAME,
                "code": settings.PLATFORM_CODE,
                "default_tenant_code": settings.DEFAULT_TENANT_CODE,
            },
            "catalog": {
                "tenants": Tenant.objects.count(),
                "plans": SubscriptionPlan.objects.count(),
                "modules": ModuleDefinition.objects.count(),
                "subscriptions": TenantSubscription.objects.count(),
                "licenses": LicenseKey.objects.count(),
                "integrations": IntegrationEndpoint.objects.count(),
            },
            "module_routes": {
                "platform": request.build_absolute_uri("/api/platform/"),
                "payments": request.build_absolute_uri("/api/payments/"),
                "accounting": request.build_absolute_uri("/api/accounting/"),
                "commercial_weighbridge": request.build_absolute_uri("/api/commercial-weighbridge/"),
            },
            "auth_routes": {
                "status": request.build_absolute_uri("/api/platform/auth/status/"),
                "login": request.build_absolute_uri("/api/platform/auth/token/"),
                "me": request.build_absolute_uri("/api/platform/auth/me/"),
                "logout": request.build_absolute_uri("/api/platform/auth/logout/"),
            },
            "operations": {
                "module_access": request.build_absolute_uri("/api/platform/module-access/"),
                "workspace_navigation": request.build_absolute_uri("/api/platform/workspace/navigation/"),
                "workspace_menu_sections": request.build_absolute_uri("/api/platform/workspace/menu-sections/"),
                "workspace_menu_items": request.build_absolute_uri("/api/platform/workspace/menu-items/"),
                "workspace_menu_access": request.build_absolute_uri("/api/platform/workspace/menu-access/"),
                "users": request.build_absolute_uri("/api/platform/users/"),
                "roles": request.build_absolute_uri("/api/platform/roles/"),
                "permissions": request.build_absolute_uri("/api/platform/permissions/"),
                "subscription_sync_example": request.build_absolute_uri("/api/platform/subscriptions/{id}/sync-modules/"),
                "license_activate_example": request.build_absolute_uri("/api/platform/licenses/{id}/activate/"),
                "license_validate_example": request.build_absolute_uri("/api/platform/licenses/{id}/validate/"),
                "integration_health": request.build_absolute_uri("/api/platform/integrations/health/"),
                "indicator_registry": request.build_absolute_uri("/api/platform/indicators/source-registry/"),
            },
        },
    )


class AuthStatusAPIView(APIView):
    permission_classes = (AllowAny,)

    def get(self, request):
        user = request.user if request.user.is_authenticated else None
        return success_response(
            "Authentication status loaded successfully.",
            data={
                "authenticated": bool(user),
                "authentication_classes": [
                    "session",
                    "basic",
                    "token",
                ],
                "write_access_requires_authentication": True,
                "user": UserProfileSerializer(user).data if user else None,
            },
        )


@method_decorator(csrf_exempt, name="dispatch")
class TokenLoginAPIView(APIView):
    authentication_classes = ()
    permission_classes = (AllowAny,)

    def post(self, request):
        serializer = TokenLoginSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        token, created = Token.objects.get_or_create(user=user)
        return success_response(
            "Authentication token issued successfully.",
            data={
                "token": token.key,
                "token_created": created,
                "user": UserProfileSerializer(user).data,
            },
        )


class CurrentUserAPIView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        return success_response(
            "Current user loaded successfully.",
            data=UserProfileSerializer(request.user).data,
        )


class WorkspaceNavigationAPIView(APIView):
    permission_classes = (IsAuthenticated,)

    def get(self, request):
        tenant_id = request.GET.get("tenant_id")
        tenant_code = request.GET.get("tenant_code")
        tenant = None
        if tenant_id:
            tenant = Tenant.objects.filter(pk=tenant_id).first()
        elif tenant_code:
            tenant = Tenant.objects.filter(code=tenant_code).first()

        workspace = build_workspace_navigation(user=request.user, tenant=tenant)
        return success_response(
            "Workspace navigation loaded successfully.",
            data={
                "scope": request_scope(request),
                "tenant": TenantSerializer(tenant).data if tenant else None,
                "user": UserProfileSerializer(request.user).data,
                "workspace": workspace,
            },
        )


@method_decorator(csrf_exempt, name="dispatch")
class TokenLogoutAPIView(APIView):
    authentication_classes = (TokenAuthentication, BasicAuthentication)
    permission_classes = (IsAuthenticated,)

    def post(self, request):
        token_key = None
        if hasattr(request, "auth") and request.auth:
            token_key = getattr(request.auth, "key", None)
            if token_key:
                Token.objects.filter(key=token_key).delete()
        logout(request)
        return success_response(
            "Authentication session cleared successfully.",
            data={
                "token_revoked": bool(token_key),
            },
        )


class PlatformUserListAPIView(ModuleAPIViewMixin, generics.ListAPIView):
    queryset = User.objects.prefetch_related("groups", "user_permissions").all()
    serializer_class = UserProfileSerializer
    search_fields = ("username", "first_name", "last_name", "email")
    ordering_fields = ("username", "date_joined", "last_login", "is_active", "is_staff")


class PlatformUserDetailAPIView(generics.RetrieveAPIView):
    queryset = User.objects.prefetch_related("groups", "user_permissions").all()
    serializer_class = UserProfileSerializer


class PlatformUserRoleAssignmentAPIView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, pk):
        serializer = UserRoleAssignmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = User.objects.prefetch_related("groups").get(pk=pk)
        groups = serializer.validated_data["group_ids"]
        replace_existing = serializer.validated_data.get("replace_existing", True)

        if replace_existing:
            user.groups.set(groups)
        else:
            user.groups.add(*groups)

        return success_response(
            "User roles assigned successfully.",
            data=UserProfileSerializer(user).data,
        )


class PlatformRoleListAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    queryset = Group.objects.prefetch_related("permissions__content_type").all()
    serializer_class = GroupDetailSerializer
    search_fields = ("name",)
    ordering_fields = ("name",)


class PlatformRoleDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Group.objects.prefetch_related("permissions__content_type").all()
    serializer_class = GroupDetailSerializer


class PlatformPermissionListAPIView(ModuleAPIViewMixin, generics.ListAPIView):
    queryset = Permission.objects.select_related("content_type").all()
    serializer_class = PermissionSummarySerializer
    search_fields = ("name", "codename", "content_type__app_label", "content_type__model")
    ordering_fields = ("content_type__app_label", "content_type__model", "codename", "name")


class WorkspaceMenuSectionListCreateAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    queryset = WorkspaceMenuSection.objects.select_related("module").prefetch_related("items").all()
    serializer_class = WorkspaceMenuSectionSerializer
    filterset_fields = ("module", "is_active", "is_system")
    search_fields = ("key", "title", "description")
    ordering_fields = ("sort_order", "title", "created_at", "updated_at")


class WorkspaceMenuSectionDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    queryset = WorkspaceMenuSection.objects.select_related("module").prefetch_related("items").all()
    serializer_class = WorkspaceMenuSectionSerializer


class WorkspaceMenuItemListCreateAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    queryset = WorkspaceMenuItem.objects.select_related("section", "required_module").all()
    serializer_class = WorkspaceMenuItemSerializer
    filterset_fields = ("section", "required_module", "is_active", "is_external")
    search_fields = ("key", "title", "description", "route_path", "api_path", "required_permission")
    ordering_fields = ("sort_order", "title", "created_at", "updated_at")


class WorkspaceMenuItemDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    queryset = WorkspaceMenuItem.objects.select_related("section", "required_module").all()
    serializer_class = WorkspaceMenuItemSerializer


class WorkspaceRoleMenuAccessListCreateAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    queryset = WorkspaceRoleMenuItem.objects.select_related("group", "menu_item", "menu_item__section").all()
    serializer_class = WorkspaceRoleMenuItemSerializer
    filterset_fields = ("group", "menu_item", "can_view")
    search_fields = ("group__name", "menu_item__title", "menu_item__key", "menu_item__section__title")
    ordering_fields = ("group__name", "menu_item__sort_order", "created_at", "updated_at")


class WorkspaceRoleMenuAccessDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    queryset = WorkspaceRoleMenuItem.objects.select_related("group", "menu_item", "menu_item__section").all()
    serializer_class = WorkspaceRoleMenuItemSerializer


class TenantListCreateAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    queryset = Tenant.objects.all()
    serializer_class = TenantSerializer
    filterset_fields = ("status", "is_active", "default_currency", "timezone")
    search_fields = ("name", "code", "legal_name", "subdomain", "primary_domain", "contact_email")
    ordering_fields = ("name", "code", "created_at", "updated_at")


class TenantDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Tenant.objects.all()
    serializer_class = TenantSerializer


class ModuleDefinitionListAPIView(ModuleAPIViewMixin, generics.ListAPIView):
    queryset = ModuleDefinition.objects.all()
    serializer_class = ModuleDefinitionSerializer
    filterset_fields = ("category", "is_core", "is_active")
    search_fields = ("slug", "name", "description")
    ordering_fields = ("category", "name", "created_at", "updated_at")


class ModuleDefinitionDetailAPIView(generics.RetrieveAPIView):
    queryset = ModuleDefinition.objects.all()
    serializer_class = ModuleDefinitionSerializer


class SubscriptionPlanListCreateAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    queryset = SubscriptionPlan.objects.prefetch_related("modules__module").all()
    serializer_class = SubscriptionPlanSerializer
    filterset_fields = ("billing_period", "currency", "is_active")
    search_fields = ("code", "name")
    ordering_fields = ("name", "price", "trial_days", "created_at", "updated_at")


class SubscriptionPlanDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    queryset = SubscriptionPlan.objects.prefetch_related("modules__module").all()
    serializer_class = SubscriptionPlanSerializer


class TenantSubscriptionListCreateAPIView(ModuleAPIViewMixin, TenantScopedQuerysetMixin, generics.ListCreateAPIView):
    queryset = TenantSubscription.objects.select_related("tenant", "plan").all()
    serializer_class = TenantSubscriptionSerializer
    filterset_fields = ("tenant", "plan", "status", "auto_renew", "start_date", "end_date")
    search_fields = ("tenant__name", "tenant__code", "plan__name", "plan__code")
    ordering_fields = ("start_date", "end_date", "amount", "created_at", "updated_at")


class TenantSubscriptionDetailAPIView(TenantScopedQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    queryset = TenantSubscription.objects.select_related("tenant", "plan").all()
    serializer_class = TenantSubscriptionSerializer


class LicenseKeyListCreateAPIView(ModuleAPIViewMixin, TenantScopedQuerysetMixin, generics.ListCreateAPIView):
    queryset = LicenseKey.objects.select_related("tenant", "subscription").all()
    serializer_class = LicenseKeySerializer
    filterset_fields = ("tenant", "subscription", "status")
    search_fields = ("license_key", "tenant__name", "tenant__code", "notes")
    ordering_fields = ("activation_date", "expiry_date", "created_at", "updated_at")


class LicenseKeyDetailAPIView(TenantScopedQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    queryset = LicenseKey.objects.select_related("tenant", "subscription").all()
    serializer_class = LicenseKeySerializer


class TenantModuleActivationListCreateAPIView(ModuleAPIViewMixin, TenantScopedQuerysetMixin, generics.ListCreateAPIView):
    queryset = TenantModuleActivation.objects.select_related("tenant", "module", "subscription").all()
    serializer_class = TenantModuleActivationSerializer
    filterset_fields = ("tenant", "module", "subscription", "status")
    search_fields = ("tenant__name", "tenant__code", "module__name", "module__slug")
    ordering_fields = ("enabled_at", "expires_at", "created_at", "updated_at")


class TenantModuleActivationDetailAPIView(TenantScopedQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    queryset = TenantModuleActivation.objects.select_related("tenant", "module", "subscription").all()
    serializer_class = TenantModuleActivationSerializer


class IntegrationEndpointListCreateAPIView(ModuleAPIViewMixin, TenantScopedQuerysetMixin, generics.ListCreateAPIView):
    queryset = IntegrationEndpoint.objects.select_related("tenant").all()
    serializer_class = IntegrationEndpointSerializer
    filterset_fields = ("tenant", "integration_type", "transport", "is_active", "is_primary")
    search_fields = ("name", "provider", "base_url", "healthcheck_path")
    ordering_fields = ("name", "timeout_seconds", "created_at", "updated_at")


class IntegrationEndpointDetailAPIView(TenantScopedQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    queryset = IntegrationEndpoint.objects.select_related("tenant").all()
    serializer_class = IntegrationEndpointSerializer


class DocumentTemplateListCreateAPIView(ModuleAPIViewMixin, TenantScopedQuerysetMixin, generics.ListCreateAPIView):
    queryset = DocumentTemplate.objects.select_related("tenant").all()
    serializer_class = DocumentTemplateSerializer
    filterset_fields = ("tenant", "document_type", "engine", "is_default", "is_active")
    search_fields = ("name", "subject_template", "version")
    ordering_fields = ("name", "document_type", "created_at", "updated_at")


class DocumentTemplateDetailAPIView(TenantScopedQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    queryset = DocumentTemplate.objects.select_related("tenant").all()
    serializer_class = DocumentTemplateSerializer


class BackupPolicyListCreateAPIView(ModuleAPIViewMixin, TenantScopedQuerysetMixin, generics.ListCreateAPIView):
    queryset = BackupPolicy.objects.select_related("tenant").all()
    serializer_class = BackupPolicySerializer
    filterset_fields = ("tenant", "frequency", "storage_backend", "is_active")
    search_fields = ("name", "target_path")
    ordering_fields = ("name", "retention_days", "created_at", "updated_at")


class BackupPolicyDetailAPIView(TenantScopedQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    queryset = BackupPolicy.objects.select_related("tenant").all()
    serializer_class = BackupPolicySerializer


@api_view(["GET"])
def tenant_module_access_overview(request):
    tenant_id = request.GET.get("tenant_id")
    tenant_code = request.GET.get("tenant_code")

    tenant = None
    if tenant_id:
        tenant = Tenant.objects.prefetch_related(
            "subscriptions__plan__modules__module",
            "module_activations__module",
            "module_activations__subscription",
            "licenses__subscription",
        ).filter(pk=tenant_id).first()
    elif tenant_code:
        tenant = Tenant.objects.prefetch_related(
            "subscriptions__plan__modules__module",
            "module_activations__module",
            "module_activations__subscription",
            "licenses__subscription",
        ).filter(code=tenant_code).first()

    if tenant is None:
        return error_response(
            "Provide a valid tenant_id or tenant_code to inspect module access.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    access = get_tenant_module_access(tenant)
    return success_response(
        "Tenant module access loaded successfully.",
        data={
            "scope": request_scope(request),
            "tenant": TenantSerializer(tenant).data,
            "summary": {
                "subscriptions": access["subscriptions"].count(),
                "licenses": access["licenses"].count(),
                "modules": len(access["modules"]),
                "enabled_modules": sum(1 for row in access["modules"] if row["activation_status"] == "enabled"),
                "trial_modules": sum(1 for row in access["modules"] if row["activation_status"] == "trial"),
                "suspended_modules": sum(1 for row in access["modules"] if row["activation_status"] == "suspended"),
            },
            "modules": access["modules"],
        },
    )


@api_view(["POST"])
def subscription_sync_modules_action(request, pk):
    try:
        subscription = TenantSubscription.objects.select_related("tenant", "plan").prefetch_related(
            "plan__modules__module"
        ).get(pk=pk)
    except TenantSubscription.DoesNotExist:
        return error_response("Subscription not found.", status_code=status.HTTP_404_NOT_FOUND)

    serializer = SubscriptionModuleSyncSerializer(data=request.data or {})
    serializer.is_valid(raise_exception=True)

    sync_result = sync_subscription_modules(subscription)
    return success_response(
        "Subscription modules synchronized successfully.",
        data={
            "subscription_id": subscription.id,
            "tenant_id": subscription.tenant_id,
            "plan_id": subscription.plan_id,
            "status": sync_result["status"],
            "created": sync_result["created"],
            "updated": sync_result["updated"],
            "modules": [
                {
                    "id": activation.id,
                    "module_id": activation.module_id,
                    "module_name": activation.module.name,
                    "module_slug": activation.module.slug,
                    "status": activation.status,
                    "expires_at": activation.expires_at,
                }
                for activation in sync_result["modules"]
            ],
        },
    )


@api_view(["POST"])
def activate_license_action(request, pk):
    try:
        license_key = LicenseKey.objects.select_related("tenant", "subscription").get(pk=pk)
    except LicenseKey.DoesNotExist:
        return error_response("License not found.", status_code=status.HTTP_404_NOT_FOUND)

    serializer = LicenseActivationSerializer(data=request.data or {})
    serializer.is_valid(raise_exception=True)
    validated = serializer.validated_data

    subscription = validated.get("subscription") or license_key.subscription
    if subscription and subscription.tenant_id != license_key.tenant_id:
        return error_response(
            "The selected subscription belongs to a different tenant.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    activate_license(
        license_key,
        subscription=subscription,
        expiry_date=validated.get("expiry_date"),
        seats=validated.get("seats"),
        device_limit=validated.get("device_limit"),
        notes=validated.get("notes"),
    )

    return success_response(
        "License activated successfully.",
        data=LicenseKeySerializer(license_key).data,
    )


@api_view(["POST"])
def validate_license_action(request, pk):
    try:
        license_key = LicenseKey.objects.select_related("tenant", "subscription").get(pk=pk)
    except LicenseKey.DoesNotExist:
        return error_response("License not found.", status_code=status.HTTP_404_NOT_FOUND)

    serializer = LicenseValidationSerializer(data=request.data or {})
    serializer.is_valid(raise_exception=True)
    validation = validate_license(
        license_key,
        mark_validated=serializer.validated_data["mark_validated"],
    )

    return success_response(
        "License validation completed successfully.",
        data={
            "license": LicenseKeySerializer(license_key).data,
            "validation": validation,
        },
    )


@api_view(["GET"])
def integration_health_overview(request):
    tenant_id = request.GET.get("tenant_id")
    tenant_code = request.GET.get("tenant_code")
    include_runtime = request.GET.get("include_runtime", "").lower() in {"1", "true", "yes"}

    queryset = IntegrationEndpoint.objects.select_related("tenant").all()
    if tenant_id:
        queryset = queryset.filter(tenant_id=tenant_id)
    elif tenant_code:
        queryset = queryset.filter(tenant__code=tenant_code)

    snapshots = [
        build_integration_health_snapshot(integration, include_runtime=include_runtime)
        for integration in queryset.order_by("tenant__name", "integration_type", "-is_primary", "name")
    ]

    return success_response(
        "Integration health overview loaded successfully.",
        data={
            "scope": request_scope(request),
            "include_runtime": include_runtime,
            "summary": {
                "integrations": len(snapshots),
                "active_integrations": sum(1 for row in snapshots if row["is_active"]),
                "primary_integrations": sum(1 for row in snapshots if row["is_primary"]),
                "healthy_integrations": sum(
                    1
                    for row in snapshots
                    if row["runtime"].get("checked") and row["runtime"].get("healthy")
                ),
            },
            "results": snapshots,
        },
    )


@api_view(["GET"])
def indicator_source_registry_overview(request):
    tenant_id = request.GET.get("tenant_id")
    tenant_code = request.GET.get("tenant_code")
    branch_id = request.GET.get("branch_id")

    tenant = None
    if tenant_id:
        tenant = Tenant.objects.filter(pk=tenant_id).first()
    elif tenant_code:
        tenant = Tenant.objects.filter(code=tenant_code).first()

    branch = None
    if branch_id:
        from SL_Weighbridge.models import Branch

        branch = Branch.objects.select_related("tenant", "company", "company__tenant").filter(pk=branch_id).first()

    registry = indicator_source_registry(tenant=tenant, branch=branch)
    return success_response(
        "Indicator source registry loaded successfully.",
        data={
            "scope": {
                **request_scope(request),
                "branch_id": branch_id,
            },
            "summary": {
                "sources": len(registry),
                "active_sources": sum(1 for row in registry if row["is_active"]),
                "primary_sources": sum(1 for row in registry if row["is_primary"]),
                "transports": sorted({row["transport"] for row in registry if row["transport"]}),
            },
            "results": registry,
        },
    )
