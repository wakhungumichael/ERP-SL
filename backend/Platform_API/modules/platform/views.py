import secrets
import string

from django.contrib.auth.models import Group, Permission, User
from django.contrib.auth import logout
from django.conf import settings
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework import generics
from rest_framework.decorators import api_view, permission_classes
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
    PlanModuleSerializer,
    SubscriptionModuleSyncSerializer,
    SubscriptionPlanSerializer,
    TenantBranchSerializer,
    TenantSettingsSerializer,
    TenantUserProfileSerializer,
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
from rest_framework.permissions import BasePermission

from Platform_API.modules.api import error_response, request_scope, success_response
from Platform_API.modules.mixins import ModuleAPIViewMixin, TenantScopedQuerysetMixin


def _gen_password(length=12):
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))


# ── Permission helpers ─────────────────────────────────────────────────────────

def _is_superadmin(user):
    """True only for platform superusers (is_superuser=True).
    Tenant admins have is_staff=True but is_superuser=False — they are NOT superadmins."""
    return user.is_authenticated and user.is_superuser


class IsSuperAdminPermission(BasePermission):
    """DRF permission class: only platform superusers (is_superuser=True) may access."""
    message = "You must be a platform administrator to perform this action."

    def has_permission(self, request, view):
        return _is_superadmin(request.user)


def _require_superadmin(request):
    """Return an error Response if the caller is not a superadmin, else None."""
    if not _is_superadmin(request.user):
        return error_response(
            "You must be a platform administrator to perform this action.",
            status_code=status.HTTP_403_FORBIDDEN,
        )
    return None


def _require_tenant_access(request, tenant):
    """
    Return an error Response if the caller is neither a superadmin nor a
    tenant-admin whose profile is scoped to *this* tenant.  Else None.
    """
    if _is_superadmin(request.user):
        return None
    profile = getattr(request.user, "tenant_profile", None)
    if profile and profile.is_tenant_admin and profile.tenant_id == tenant.pk:
        return None
    return error_response(
        "You do not have permission to access this tenant's resources.",
        status_code=status.HTTP_403_FORBIDDEN,
    )


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


class _SuperAdminRequired:
    """
    Mixin that enforces is_superuser=True on ALL DRF action methods.
    Applies to list, retrieve, create, update, partial_update, and destroy.
    """

    def _deny_if_not_superadmin(self, request):
        if not _is_superadmin(request.user):
            from rest_framework.response import Response
            return Response(
                {"message": "You must be a platform administrator to perform this action.", "status_code": 403},
                status=status.HTTP_403_FORBIDDEN,
            )
        return None

    def list(self, request, *args, **kwargs):
        resp = self._deny_if_not_superadmin(request)
        return resp or super().list(request, *args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        resp = self._deny_if_not_superadmin(request)
        return resp or super().retrieve(request, *args, **kwargs)

    def create(self, request, *args, **kwargs):
        resp = self._deny_if_not_superadmin(request)
        return resp or super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        resp = self._deny_if_not_superadmin(request)
        return resp or super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        resp = self._deny_if_not_superadmin(request)
        return resp or super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        resp = self._deny_if_not_superadmin(request)
        return resp or super().destroy(request, *args, **kwargs)


class PlatformUserListAPIView(ModuleAPIViewMixin, generics.ListAPIView):
    """
    Superadmins see all users.
    Tenant admins see only users belonging to their own tenant.
    All others are denied.
    """
    queryset = User.objects.prefetch_related("groups", "user_permissions", "tenant_profile__tenant").all()
    serializer_class = UserProfileSerializer
    search_fields = ("username", "first_name", "last_name", "email")
    ordering_fields = ("username", "date_joined", "last_login", "is_active", "is_staff")

    def list(self, request, *args, **kwargs):
        if not _is_superadmin(request.user):
            profile = TenantUserProfile.objects.filter(user=request.user, is_tenant_admin=True).first()
            if not profile:
                return error_response(
                    "You must be a platform or tenant administrator to view users.",
                    status_code=status.HTTP_403_FORBIDDEN,
                )
        return super().list(request, *args, **kwargs)

    def get_queryset(self):
        qs = super().get_queryset()
        if _is_superadmin(self.request.user):
            return qs
        # Tenant admins see only users in their own tenant
        profile = TenantUserProfile.objects.filter(user=self.request.user, is_tenant_admin=True).first()
        if profile:
            return qs.filter(tenant_profile__tenant=profile.tenant)
        return qs.none()


class PlatformUserDetailAPIView(generics.RetrieveAPIView):
    queryset = User.objects.prefetch_related("groups", "user_permissions", "tenant_profile__tenant").all()
    serializer_class = UserProfileSerializer

    def get_object(self):
        obj = super().get_object()
        user = self.request.user
        if _is_superadmin(user):
            return obj
        # Own profile is always accessible
        if obj.pk == user.pk:
            return obj
        # Tenant admins may only see users in their own tenant
        profile = getattr(user, "tenant_profile", None)
        target_profile = getattr(obj, "tenant_profile", None)
        if (
            profile and profile.is_tenant_admin
            and target_profile
            and target_profile.tenant_id == profile.tenant_id
        ):
            return obj
        from rest_framework.exceptions import PermissionDenied
        raise PermissionDenied("You do not have permission to view this user.")


class PlatformUserRoleAssignmentAPIView(APIView):
    permission_classes = (IsAuthenticated,)

    # Privileged groups that only a superadmin may assign
    _PRIVILEGED_GROUP_NAMES = {"Superadmin", "Platform Admin", "Tenant Admin"}

    def post(self, request, pk):
        # Superadmin: full access.
        # Tenant admin: may only assign non-privileged groups to users in own tenant.
        # Others: forbidden.
        caller_is_superadmin = _is_superadmin(request.user)
        caller_profile = getattr(request.user, "tenant_profile", None)
        caller_is_tenant_admin = caller_profile and caller_profile.is_tenant_admin

        if not caller_is_superadmin and not caller_is_tenant_admin:
            return error_response(
                "You must be a platform or tenant administrator to assign roles.",
                status_code=status.HTTP_403_FORBIDDEN,
            )

        try:
            target_user = User.objects.prefetch_related("groups").get(pk=pk)
        except User.DoesNotExist:
            return error_response("User not found.", status_code=status.HTTP_404_NOT_FOUND)

        if not caller_is_superadmin:
            # Tenant admin must only act on users in their own tenant —
            # use an explicit DB query to avoid OneToOneField getattr edge cases.
            target_profile = TenantUserProfile.objects.filter(user=target_user).first()
            if not target_profile or target_profile.tenant_id != caller_profile.tenant_id:
                return error_response(
                    "You may only manage users within your own tenant.",
                    status_code=status.HTTP_403_FORBIDDEN,
                )

        serializer = UserRoleAssignmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        groups = serializer.validated_data["group_ids"]
        replace_existing = serializer.validated_data.get("replace_existing", True)

        if not caller_is_superadmin:
            # Prevent escalation: tenant admins may not grant privileged groups
            for g in groups:
                if g.name in self._PRIVILEGED_GROUP_NAMES:
                    return error_response(
                        f"You do not have permission to assign the '{g.name}' role.",
                        status_code=status.HTTP_403_FORBIDDEN,
                    )

        if replace_existing:
            target_user.groups.set(groups)
        else:
            target_user.groups.add(*groups)

        return success_response(
            "User roles assigned successfully.",
            data=UserProfileSerializer(target_user).data,
        )


class PlatformRoleListAPIView(_SuperAdminRequired, ModuleAPIViewMixin, generics.ListCreateAPIView):
    queryset = Group.objects.prefetch_related("permissions__content_type").all()
    serializer_class = GroupDetailSerializer
    search_fields = ("name",)
    ordering_fields = ("name",)


class PlatformRoleDetailAPIView(_SuperAdminRequired, generics.RetrieveUpdateDestroyAPIView):
    queryset = Group.objects.prefetch_related("permissions__content_type").all()
    serializer_class = GroupDetailSerializer


class PlatformPermissionListAPIView(ModuleAPIViewMixin, generics.ListAPIView):
    permission_classes = [IsSuperAdminPermission]
    # Return all ~200 permissions unpaginated — the Roles UI needs the full list at once
    pagination_class = None
    queryset = Permission.objects.select_related("content_type").order_by(
        "content_type__app_label", "content_type__model", "codename"
    )
    serializer_class = PermissionSummarySerializer
    filterset_fields = {
        "content_type__app_label": ["exact", "in"],
        "content_type__model": ["exact", "in"],
    }
    search_fields = ("name", "codename", "content_type__app_label", "content_type__model")
    ordering_fields = ("content_type__app_label", "content_type__model", "codename", "name")


class WorkspaceMenuSectionListCreateAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = WorkspaceMenuSection.objects.select_related("module").prefetch_related("items").all()
    serializer_class = WorkspaceMenuSectionSerializer
    filterset_fields = ("module", "is_active", "is_system")
    search_fields = ("key", "title", "description")
    ordering_fields = ("sort_order", "title", "created_at", "updated_at")


class WorkspaceMenuSectionDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = WorkspaceMenuSection.objects.select_related("module").prefetch_related("items").all()
    serializer_class = WorkspaceMenuSectionSerializer


class WorkspaceMenuItemListCreateAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = WorkspaceMenuItem.objects.select_related("section", "required_module").all()
    serializer_class = WorkspaceMenuItemSerializer
    filterset_fields = ("section", "required_module", "is_active", "is_external")
    search_fields = ("key", "title", "description", "route_path", "api_path", "required_permission")
    ordering_fields = ("sort_order", "title", "created_at", "updated_at")


class WorkspaceMenuItemDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = WorkspaceMenuItem.objects.select_related("section", "required_module").all()
    serializer_class = WorkspaceMenuItemSerializer


class WorkspaceRoleMenuAccessListCreateAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = WorkspaceRoleMenuItem.objects.select_related("group", "menu_item", "menu_item__section").all()
    serializer_class = WorkspaceRoleMenuItemSerializer
    filterset_fields = ("group", "menu_item", "can_view")
    search_fields = ("group__name", "menu_item__title", "menu_item__key", "menu_item__section__title")
    ordering_fields = ("group__name", "menu_item__sort_order", "created_at", "updated_at")


class WorkspaceRoleMenuAccessDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = WorkspaceRoleMenuItem.objects.select_related("group", "menu_item", "menu_item__section").all()
    serializer_class = WorkspaceRoleMenuItemSerializer


class TenantSelfAPIView(APIView):
    """
    GET/PATCH the tenant that the authenticated user belongs to.
    Superadmins may use this if they have a TenantUserProfile (unusual but valid).
    Plain users without a tenant profile receive 403.
    This endpoint is intentionally separate from TenantDetailAPIView (superadmin-only)
    so that tenant admins can manage their own company info without platform-admin access.
    """
    permission_classes = [IsAuthenticated]

    def _get_tenant(self, request):
        if _is_superadmin(request.user):
            # Superadmin must supply ?tenant_id= to scope to a specific tenant.
            # Without it, this endpoint has no "self" meaning for a platform superuser.
            tid = request.query_params.get("tenant_id")
            if not tid:
                return None, error_response(
                    "Platform superadmins must supply ?tenant_id= to use this endpoint.",
                    status_code=status.HTTP_400_BAD_REQUEST,
                )
            try:
                return Tenant.objects.get(pk=tid), None
            except Tenant.DoesNotExist:
                return None, error_response("Tenant not found.", status_code=status.HTTP_404_NOT_FOUND)
        profile = TenantUserProfile.objects.filter(user=request.user).first()
        if not profile:
            return None, error_response(
                "Your account is not linked to a tenant.",
                status_code=status.HTTP_403_FORBIDDEN,
            )
        return profile.tenant, None

    def get(self, request):
        tenant, err = self._get_tenant(request)
        if err:
            return err
        return success_response("Tenant loaded.", data=TenantSerializer(tenant).data)

    def patch(self, request):
        tenant, err = self._get_tenant(request)
        if err:
            return err
        # Only tenant admins (or superadmins) may update
        if not _is_superadmin(request.user):
            profile = TenantUserProfile.objects.filter(user=request.user, is_tenant_admin=True).first()
            if not profile:
                return error_response(
                    "You must be a tenant administrator to update company information.",
                    status_code=status.HTTP_403_FORBIDDEN,
                )
        serializer = TenantSerializer(tenant, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return success_response("Tenant updated.", data=serializer.data)


class TenantListCreateAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = Tenant.objects.all()
    serializer_class = TenantSerializer
    filterset_fields = ("status", "is_active", "default_currency", "timezone")
    search_fields = ("name", "code", "legal_name", "subdomain", "primary_domain", "contact_email")
    ordering_fields = ("name", "code", "created_at", "updated_at")


class TenantDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = Tenant.objects.all()
    serializer_class = TenantSerializer


# ── Tenant Provisioning ────────────────────────────────────────────────────────

@api_view(["POST"])
def provision_tenant(request):
    """
    Super-admin endpoint: create a Tenant + its first Tenant Admin user in one shot.
    Returns the temporary password so the super admin can hand it off.
    """
    denied = _require_superadmin(request)
    if denied:
        return denied
    data = request.data
    required = ["name", "contact_email", "admin_first_name", "admin_last_name", "admin_email"]
    for field in required:
        if not data.get(field):
            return error_response(f"'{field}' is required.", status_code=status.HTTP_400_BAD_REQUEST)

    # Create tenant
    subdomain = data.get("subdomain") or None  # never pass "" — unique constraint is on non-null values
    tenant_serializer = TenantSerializer(data={
        "name": data["name"],
        "legal_name": data.get("legal_name", ""),
        "subdomain": subdomain,
        "contact_email": data["contact_email"],
        "contact_phone": data.get("contact_phone", ""),
        "status": "active",
        "is_active": True,
    })
    tenant_serializer.is_valid(raise_exception=True)
    tenant = tenant_serializer.save()

    # Create admin user
    base_username = data["admin_email"].split("@")[0].lower().replace(".", "_")
    username = base_username
    counter = 1
    while User.objects.filter(username=username).exists():
        username = f"{base_username}{counter}"
        counter += 1

    temp_password = _gen_password(12)
    admin_user = User.objects.create_user(
        username=username,
        email=data["admin_email"],
        first_name=data["admin_first_name"],
        last_name=data["admin_last_name"],
        password=temp_password,
        is_active=True,
        is_staff=False,   # Tenant admins are NOT platform/django-admin staff
        is_superuser=False,
    )

    # Assign to Tenant Admin group
    group, _ = Group.objects.get_or_create(name="Tenant Admin")
    admin_user.groups.add(group)

    # Create profile
    TenantUserProfile.objects.create(
        user=admin_user,
        tenant=tenant,
        is_tenant_admin=True,
        job_title="Tenant Administrator",
    )

    # Create default TenantSettings
    TenantSettings.objects.get_or_create(tenant=tenant, defaults={"invoice_prefix": "INV"})

    # Subscribe to plan if provided
    plan_id = data.get("plan_id")
    subscription = None
    if plan_id:
        try:
            plan = SubscriptionPlan.objects.get(pk=plan_id)
            subscription = TenantSubscription.objects.create(
                tenant=tenant,
                plan=plan,
                status="active",
            )
        except SubscriptionPlan.DoesNotExist:
            pass

    return success_response(
        "Tenant provisioned successfully.",
        data={
            "tenant": TenantSerializer(tenant).data,
            "admin_username": admin_user.username,
            "admin_email": admin_user.email,
            "admin_temp_password": temp_password,
            "subscription_id": subscription.id if subscription else None,
        },
    )


@api_view(["POST"])
def suspend_tenant(request, pk):
    denied = _require_superadmin(request)
    if denied:
        return denied
    try:
        tenant = Tenant.objects.get(pk=pk)
    except Tenant.DoesNotExist:
        return error_response("Tenant not found.", status_code=status.HTTP_404_NOT_FOUND)
    tenant.status = "suspended"
    tenant.is_active = False
    tenant.save(update_fields=["status", "is_active"])
    return success_response("Tenant suspended.", data=TenantSerializer(tenant).data)


@api_view(["POST"])
def activate_tenant(request, pk):
    denied = _require_superadmin(request)
    if denied:
        return denied
    try:
        tenant = Tenant.objects.get(pk=pk)
    except Tenant.DoesNotExist:
        return error_response("Tenant not found.", status_code=status.HTTP_404_NOT_FOUND)
    tenant.status = "active"
    tenant.is_active = True
    tenant.save(update_fields=["status", "is_active"])
    return success_response("Tenant activated.", data=TenantSerializer(tenant).data)


# ── Tenant Branches ────────────────────────────────────────────────────────────

class TenantBranchListCreateAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def _resolve_tenant(self, pk):
        try:
            return Tenant.objects.get(pk=pk)
        except Tenant.DoesNotExist:
            return None

    def get(self, request, pk):
        tenant = self._resolve_tenant(pk)
        if not tenant:
            return error_response("Tenant not found.", status_code=status.HTTP_404_NOT_FOUND)
        denied = _require_tenant_access(request, tenant)
        if denied:
            return denied
        branches = TenantBranch.objects.filter(tenant=tenant)
        return success_response("Branches loaded.", data={
            "tenant_id": tenant.id,
            "branches": TenantBranchSerializer(branches, many=True).data,
        })

    def post(self, request, pk):
        tenant = self._resolve_tenant(pk)
        if not tenant:
            return error_response("Tenant not found.", status_code=status.HTTP_404_NOT_FOUND)
        denied = _require_tenant_access(request, tenant)
        if denied:
            return denied
        serializer = TenantBranchSerializer(data={**request.data, "tenant": tenant.id})
        serializer.is_valid(raise_exception=True)
        branch = serializer.save(tenant=tenant)
        return success_response("Branch created.", data=TenantBranchSerializer(branch).data)


class TenantBranchDetailAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def _get_branch(self, pk):
        try:
            return TenantBranch.objects.select_related("tenant").get(pk=pk)
        except TenantBranch.DoesNotExist:
            return None

    def get(self, request, pk):
        b = self._get_branch(pk)
        if not b:
            return error_response("Branch not found.", status_code=status.HTTP_404_NOT_FOUND)
        denied = _require_tenant_access(request, b.tenant)
        if denied:
            return denied
        return success_response("Branch loaded.", data=TenantBranchSerializer(b).data)

    def patch(self, request, pk):
        b = self._get_branch(pk)
        if not b:
            return error_response("Branch not found.", status_code=status.HTTP_404_NOT_FOUND)
        denied = _require_tenant_access(request, b.tenant)
        if denied:
            return denied
        s = TenantBranchSerializer(b, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return success_response("Branch updated.", data=s.data)

    def put(self, request, pk):
        return self.patch(request, pk)


# ── Tenant Users & Invite ──────────────────────────────────────────────────────

class TenantUserListAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            tenant = Tenant.objects.get(pk=pk)
        except Tenant.DoesNotExist:
            return error_response("Tenant not found.", status_code=status.HTTP_404_NOT_FOUND)
        denied = _require_tenant_access(request, tenant)
        if denied:
            return denied
        profiles = TenantUserProfile.objects.filter(tenant=tenant).select_related("user", "user__tenant_profile", "branch")
        users = [p.user for p in profiles]
        return success_response("Users loaded.", data={
            "tenant_id": tenant.id,
            "users": UserProfileSerializer(users, many=True).data,
        })


class TenantUserInviteAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            tenant = Tenant.objects.get(pk=pk)
        except Tenant.DoesNotExist:
            return error_response("Tenant not found.", status_code=status.HTTP_404_NOT_FOUND)
        denied = _require_tenant_access(request, tenant)
        if denied:
            return denied

        data = request.data
        if not data.get("email") or not data.get("first_name"):
            return error_response("'email' and 'first_name' are required.", status_code=status.HTTP_400_BAD_REQUEST)

        # Build unique username
        base_un = (data.get("username") or data["email"].split("@")[0]).lower().replace(".", "_")
        username = base_un
        counter = 1
        while User.objects.filter(username=username).exists():
            username = f"{base_un}{counter}"
            counter += 1

        temp_password = _gen_password(12)
        new_user = User.objects.create_user(
            username=username,
            email=data["email"],
            first_name=data.get("first_name", ""),
            last_name=data.get("last_name", ""),
            password=temp_password,
            is_active=True,
        )

        # Assign group / role
        role_group_name = data.get("role_group")
        if role_group_name:
            group, _ = Group.objects.get_or_create(name=role_group_name)
            new_user.groups.add(group)

        # Resolve branch
        branch = None
        branch_id = data.get("branch_id")
        if branch_id:
            branch = TenantBranch.objects.filter(pk=branch_id, tenant=tenant).first()

        TenantUserProfile.objects.create(
            user=new_user,
            tenant=tenant,
            branch=branch,
            is_tenant_admin=role_group_name == "Tenant Admin",
            job_title=data.get("job_title", ""),
        )

        return success_response(
            "User invited successfully.",
            data={
                "user": UserProfileSerializer(new_user).data,
                "temp_password": temp_password,
            },
        )


# ── Tenant Settings ────────────────────────────────────────────────────────────

class TenantSettingsAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def _get_settings(self, pk):
        try:
            tenant = Tenant.objects.get(pk=pk)
        except Tenant.DoesNotExist:
            return None, None
        settings_obj, _ = TenantSettings.objects.get_or_create(tenant=tenant)
        return tenant, settings_obj

    def get(self, request, pk):
        tenant, settings_obj = self._get_settings(pk)
        if settings_obj is None:
            return error_response("Tenant not found.", status_code=status.HTTP_404_NOT_FOUND)
        denied = _require_tenant_access(request, tenant)
        if denied:
            return denied
        return success_response("Settings loaded.", data=TenantSettingsSerializer(settings_obj).data)

    def put(self, request, pk):
        tenant, settings_obj = self._get_settings(pk)
        if settings_obj is None:
            return error_response("Tenant not found.", status_code=status.HTTP_404_NOT_FOUND)
        denied = _require_tenant_access(request, tenant)
        if denied:
            return denied
        s = TenantSettingsSerializer(settings_obj, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return success_response("Settings saved.", data=s.data)

    def patch(self, request, pk):
        return self.put(request, pk)


@api_view(["POST"])
def test_tenant_smtp(request, pk):
    try:
        tenant = Tenant.objects.get(pk=pk)
        ts = TenantSettings.objects.get(tenant=tenant)
    except (Tenant.DoesNotExist, TenantSettings.DoesNotExist):
        return error_response("Tenant or settings not found.", status_code=status.HTTP_404_NOT_FOUND)
    denied = _require_tenant_access(request, tenant)
    if denied:
        return denied

    try:
        from django.core.mail import get_connection, EmailMessage
        conn = get_connection(
            backend="django.core.mail.backends.smtp.EmailBackend",
            host=ts.smtp_host,
            port=ts.smtp_port,
            username=ts.smtp_user,
            password=ts.smtp_password,
            use_tls=ts.smtp_use_tls,
            fail_silently=False,
        )
        email = EmailMessage(
            subject=f"SL-ERP SMTP test — {tenant.name}",
            body="This is a test email from your SL-ERP configuration.",
            from_email=ts.support_email or ts.smtp_user,
            to=[ts.support_email or ts.smtp_user],
            connection=conn,
        )
        email.send()
        return success_response("Test email sent successfully.", data={"message": f"Test email sent to {ts.support_email or ts.smtp_user}"})
    except Exception as exc:
        return error_response(f"SMTP test failed: {exc}", status_code=status.HTTP_502_BAD_GATEWAY)


# ── User update (deactivate/reactivate) ───────────────────────────────────────

class PlatformUserUpdateAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        try:
            user = User.objects.get(pk=pk)
        except User.DoesNotExist:
            return error_response("User not found.", status_code=status.HTTP_404_NOT_FOUND)

        # Superadmin can update anyone. Tenant-admin can only update users within
        # their own tenant. A user can always update themselves.
        if request.user.pk != user.pk:
            if _is_superadmin(request.user):
                pass  # allowed
            else:
                # Tenant-admin scope check: target user must belong to same tenant
                requesting_profile = getattr(request.user, "tenant_profile", None)
                target_profile = getattr(user, "tenant_profile", None)
                if not (
                    requesting_profile
                    and requesting_profile.is_tenant_admin
                    and target_profile
                    and target_profile.tenant_id == requesting_profile.tenant_id
                ):
                    return error_response(
                        "You do not have permission to update this user.",
                        status_code=status.HTTP_403_FORBIDDEN,
                    )

        if "is_active" in request.data:
            user.is_active = bool(request.data["is_active"])
            user.save(update_fields=["is_active"])
        if "first_name" in request.data:
            user.first_name = request.data["first_name"]
            user.last_name = request.data.get("last_name", user.last_name)
            user.save(update_fields=["first_name", "last_name"])
        return success_response("User updated.", data=UserProfileSerializer(user).data)


# ── Module toggle (super admin) ───────────────────────────────────────────────

class ModuleDefinitionListCreateAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = ModuleDefinition.objects.all()
    serializer_class = ModuleDefinitionSerializer
    filterset_fields = ("category", "is_core", "is_active")
    search_fields = ("slug", "name", "description")
    ordering_fields = ("category", "name", "created_at", "updated_at")


ModuleDefinitionListAPIView = ModuleDefinitionListCreateAPIView


class ModuleDefinitionDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = ModuleDefinition.objects.all()
    serializer_class = ModuleDefinitionSerializer


class PlanModuleListCreateAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    """List/add modules included in a specific subscription plan."""
    permission_classes = [IsSuperAdminPermission]
    serializer_class = PlanModuleSerializer

    def get_queryset(self):
        return PlanModule.objects.filter(
            plan_id=self.kwargs["plan_pk"]
        ).select_related("module")

    def perform_create(self, serializer):
        from django.shortcuts import get_object_or_404
        plan = get_object_or_404(SubscriptionPlan, pk=self.kwargs["plan_pk"])
        serializer.save(plan=plan)


class PlanModuleDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    """Retrieve/update/remove a single PlanModule assignment."""
    permission_classes = [IsSuperAdminPermission]
    serializer_class = PlanModuleSerializer

    def get_queryset(self):
        return PlanModule.objects.filter(
            plan_id=self.kwargs["plan_pk"]
        ).select_related("module")


class SubscriptionPlanListCreateAPIView(ModuleAPIViewMixin, generics.ListCreateAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = SubscriptionPlan.objects.prefetch_related("modules__module").all()
    serializer_class = SubscriptionPlanSerializer
    filterset_fields = ("billing_period", "currency", "is_active")
    search_fields = ("code", "name")
    ordering_fields = ("name", "price", "trial_days", "created_at", "updated_at")


class SubscriptionPlanDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = SubscriptionPlan.objects.prefetch_related("modules__module").all()
    serializer_class = SubscriptionPlanSerializer


class TenantSubscriptionListCreateAPIView(ModuleAPIViewMixin, TenantScopedQuerysetMixin, generics.ListCreateAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = TenantSubscription.objects.select_related("tenant", "plan").all()
    serializer_class = TenantSubscriptionSerializer
    filterset_fields = ("tenant", "plan", "status", "auto_renew", "start_date", "end_date")
    search_fields = ("tenant__name", "tenant__code", "plan__name", "plan__code")
    ordering_fields = ("start_date", "end_date", "amount", "created_at", "updated_at")


class TenantSubscriptionDetailAPIView(TenantScopedQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = TenantSubscription.objects.select_related("tenant", "plan").all()
    serializer_class = TenantSubscriptionSerializer


class LicenseKeyListCreateAPIView(ModuleAPIViewMixin, TenantScopedQuerysetMixin, generics.ListCreateAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = LicenseKey.objects.select_related("tenant", "subscription").all()
    serializer_class = LicenseKeySerializer
    filterset_fields = ("tenant", "subscription", "status")
    search_fields = ("license_key", "tenant__name", "tenant__code", "notes")
    ordering_fields = ("activation_date", "expiry_date", "created_at", "updated_at")


class LicenseKeyDetailAPIView(TenantScopedQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = LicenseKey.objects.select_related("tenant", "subscription").all()
    serializer_class = LicenseKeySerializer


class TenantModuleActivationListCreateAPIView(ModuleAPIViewMixin, TenantScopedQuerysetMixin, generics.ListCreateAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = TenantModuleActivation.objects.select_related("tenant", "module", "subscription").all()
    serializer_class = TenantModuleActivationSerializer
    filterset_fields = ("tenant", "module", "subscription", "status")
    search_fields = ("tenant__name", "tenant__code", "module__name", "module__slug")
    ordering_fields = ("enabled_at", "expires_at", "created_at", "updated_at")


class TenantModuleActivationDetailAPIView(TenantScopedQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = TenantModuleActivation.objects.select_related("tenant", "module", "subscription").all()
    serializer_class = TenantModuleActivationSerializer


class IntegrationEndpointListCreateAPIView(ModuleAPIViewMixin, TenantScopedQuerysetMixin, generics.ListCreateAPIView):
    """
    Superadmins can list/create across all tenants.
    Tenant admins can list their own tenant's integrations and create for their own tenant only.
    """
    queryset = IntegrationEndpoint.objects.select_related("tenant").all()
    serializer_class = IntegrationEndpointSerializer
    filterset_fields = ("tenant", "integration_type", "transport", "is_active", "is_primary")
    search_fields = ("name", "provider", "base_url", "healthcheck_path")
    ordering_fields = ("name", "timeout_seconds", "created_at", "updated_at")

    def _check_caller(self, request):
        """Return (is_super, profile) or raise a 403 Response for plain users."""
        if _is_superadmin(request.user):
            return True, None
        profile = TenantUserProfile.objects.filter(user=request.user, is_tenant_admin=True).first()
        if not profile:
            return None, error_response(
                "You must be a platform or tenant administrator to manage integrations.",
                status_code=status.HTTP_403_FORBIDDEN,
            )
        return False, profile

    def get_queryset(self):
        qs = super().get_queryset()
        if _is_superadmin(self.request.user):
            return qs
        profile = TenantUserProfile.objects.filter(user=self.request.user, is_tenant_admin=True).first()
        if profile:
            return qs.filter(tenant=profile.tenant)
        return qs.none()

    def list(self, request, *args, **kwargs):
        is_super, profile_or_response = self._check_caller(request)
        if is_super is None:
            return profile_or_response  # 403
        return super().list(request, *args, **kwargs)

    def create(self, request, *args, **kwargs):
        is_super, profile_or_response = self._check_caller(request)
        if is_super is None:
            return profile_or_response  # 403
        if not is_super:
            profile = profile_or_response
            # Tenant admin: enforce tenant ownership
            requested_tenant_id = request.data.get("tenant_id") or request.data.get("tenant")
            if requested_tenant_id and str(profile.tenant_id) != str(requested_tenant_id):
                return error_response(
                    "You may only create integrations for your own tenant.",
                    status_code=status.HTTP_403_FORBIDDEN,
                )
            if not requested_tenant_id:
                request.data["tenant"] = profile.tenant_id  # type: ignore[index]
        return super().create(request, *args, **kwargs)


class IntegrationEndpointDetailAPIView(TenantScopedQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    """
    Superadmins can manage any integration.
    Tenant admins can only manage integrations belonging to their own tenant.
    Plain users are denied.
    """
    queryset = IntegrationEndpoint.objects.select_related("tenant").all()
    serializer_class = IntegrationEndpointSerializer

    def _check_permission(self, request):
        if _is_superadmin(request.user):
            return None
        profile = TenantUserProfile.objects.filter(user=request.user, is_tenant_admin=True).first()
        if not profile:
            return error_response(
                "You must be a platform or tenant administrator to manage integrations.",
                status_code=status.HTTP_403_FORBIDDEN,
            )
        return None

    def get_queryset(self):
        qs = super().get_queryset()
        if _is_superadmin(self.request.user):
            return qs
        profile = TenantUserProfile.objects.filter(user=self.request.user, is_tenant_admin=True).first()
        if profile:
            return qs.filter(tenant=profile.tenant)
        return qs.none()

    def retrieve(self, request, *args, **kwargs):
        denied = self._check_permission(request)
        return denied or super().retrieve(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        denied = self._check_permission(request)
        return denied or super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        denied = self._check_permission(request)
        return denied or super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        denied = self._check_permission(request)
        return denied or super().destroy(request, *args, **kwargs)


class DocumentTemplateListCreateAPIView(ModuleAPIViewMixin, TenantScopedQuerysetMixin, generics.ListCreateAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = DocumentTemplate.objects.select_related("tenant").all()
    serializer_class = DocumentTemplateSerializer
    filterset_fields = ("tenant", "document_type", "engine", "is_default", "is_active")
    search_fields = ("name", "subject_template", "version")
    ordering_fields = ("name", "document_type", "created_at", "updated_at")


class DocumentTemplateDetailAPIView(TenantScopedQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = DocumentTemplate.objects.select_related("tenant").all()
    serializer_class = DocumentTemplateSerializer


class BackupPolicyListCreateAPIView(ModuleAPIViewMixin, TenantScopedQuerysetMixin, generics.ListCreateAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = BackupPolicy.objects.select_related("tenant").all()
    serializer_class = BackupPolicySerializer
    filterset_fields = ("tenant", "frequency", "storage_backend", "is_active")
    search_fields = ("name", "target_path")
    ordering_fields = ("name", "retention_days", "created_at", "updated_at")


class BackupPolicyDetailAPIView(TenantScopedQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsSuperAdminPermission]
    queryset = BackupPolicy.objects.select_related("tenant").all()
    serializer_class = BackupPolicySerializer


@api_view(["GET"])
@permission_classes([IsSuperAdminPermission])
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
@permission_classes([IsSuperAdminPermission])
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
@permission_classes([IsSuperAdminPermission])
def generate_license_action(request):
    """POST /licenses/generate/ — auto-generate a new license key for a tenant."""
    tenant_id = request.data.get("tenant_id")
    if not tenant_id:
        return error_response("tenant_id is required.", status_code=status.HTTP_400_BAD_REQUEST)
    try:
        tenant = Tenant.objects.get(pk=tenant_id)
    except Tenant.DoesNotExist:
        return error_response("Tenant not found.", status_code=status.HTTP_404_NOT_FOUND)

    subscription_id = request.data.get("subscription_id")
    subscription = None
    if subscription_id:
        try:
            subscription = TenantSubscription.objects.get(pk=subscription_id, tenant=tenant)
        except TenantSubscription.DoesNotExist:
            return error_response(
                "Subscription not found for this tenant.", status_code=status.HTTP_400_BAD_REQUEST
            )

    key = f"SL-{secrets.token_hex(4).upper()}-{secrets.token_hex(4).upper()}-{secrets.token_hex(4).upper()}"
    while LicenseKey.objects.filter(license_key=key).exists():
        key = f"SL-{secrets.token_hex(4).upper()}-{secrets.token_hex(4).upper()}-{secrets.token_hex(4).upper()}"

    license_key = LicenseKey.objects.create(
        tenant=tenant,
        subscription=subscription,
        license_key=key,
        seats=int(request.data.get("seats", 1)),
        device_limit=int(request.data.get("device_limit", 1)),
        offline_grace_days=int(request.data.get("offline_grace_days", 3)),
        notes=request.data.get("notes", ""),
        status="pending",
    )
    return success_response(
        "License key generated.",
        data=LicenseKeySerializer(license_key).data,
    )


@api_view(["POST"])
@permission_classes([IsSuperAdminPermission])
def revoke_license_action(request, pk):
    """POST /licenses/<pk>/revoke/ — immediately revoke an active or pending license."""
    try:
        license_key = LicenseKey.objects.select_related("tenant", "subscription").get(pk=pk)
    except LicenseKey.DoesNotExist:
        return error_response("License not found.", status_code=status.HTTP_404_NOT_FOUND)
    license_key.status = "revoked"
    license_key.save(update_fields=["status", "updated_at"])
    return success_response("License revoked.", data=LicenseKeySerializer(license_key).data)


@api_view(["POST"])
@permission_classes([IsSuperAdminPermission])
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
@permission_classes([IsSuperAdminPermission])
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
@permission_classes([IsSuperAdminPermission])
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
@permission_classes([IsSuperAdminPermission])
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
