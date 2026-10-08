"""
Shared DRF mixins for Platform_API module views.
"""
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import PermissionDenied
from Platform_Core.models import OrganizationMembership


class ModuleAPIViewMixin:
    """Base mixin for all Platform API module views."""
    permission_classes = [IsAuthenticated]


class _NoTenantAccess:
    """Sentinel for authenticated users with no active organization access."""


NO_TENANT_ACCESS = _NoTenantAccess()


def resolve_user_tenant(user):
    """
    Resolve the user's active tenant from organization membership first,
    falling back to the legacy tenant profile during migration.

    Returns:
      None               -> superuser/global access
      Tenant instance    -> scoped tenant
      NO_TENANT_ACCESS   -> authenticated but not linked to an active tenant
    """
    if not getattr(user, "is_authenticated", False):
        return NO_TENANT_ACCESS
    try:
        membership = (
            OrganizationMembership.objects.select_related("tenant")
            .filter(user=user, is_active=True)
            .order_by("-is_default", "tenant__name")
            .first()
        )
        if membership and membership.tenant:
            return membership.tenant
    except Exception:
        pass

    try:
        profile = user.tenant_profile
        if profile and profile.tenant:
            return profile.tenant
    except Exception:
        pass

    if getattr(user, "is_superuser", False):
        return None

    return NO_TENANT_ACCESS


def apply_tenant_filter(qs, user, filter_field="tenant"):
    resolved = resolve_user_tenant(user)
    if resolved is None:
        return qs
    if resolved is NO_TENANT_ACCESS:
        return qs.none()
    return qs.filter(**{filter_field: resolved})


def tenant_or_403(user, message="No organization linked to this account."):
    resolved = resolve_user_tenant(user)
    if resolved is NO_TENANT_ACCESS:
        raise PermissionDenied(message)
    return resolved


def require_workspace_permission(user, codename):
    """Require a dashboard/overview permission while retaining administrator access."""
    if getattr(user, "is_superuser", False) or getattr(user, "is_staff", False):
        return
    if OrganizationMembership.objects.filter(user=user, is_active=True, is_org_admin=True).exists():
        return
    try:
        profile = user.tenant_profile
        if profile and profile.is_tenant_admin:
            return
    except Exception:
        pass
    if user.has_perm(f"Platform_Core.{codename}"):
        return
    raise PermissionDenied("You do not have permission to view this dashboard.")


def user_belongs_to_tenant(user, tenant):
    if tenant is None:
        return False
    if getattr(user, "is_superuser", False):
        return True

    try:
        if OrganizationMembership.objects.filter(
            user=user,
            tenant=tenant,
            is_active=True,
        ).exists():
            return True
    except Exception:
        pass

    try:
        profile = user.tenant_profile
        return bool(profile and profile.tenant_id == tenant.id)
    except Exception:
        return False


class TenantScopedQuerysetMixin:
    """
    Mixin that automatically scopes querysets to the requesting user's tenant.

    For non-superusers who have a TenantUserProfile, the effective tenant is
    always derived from their profile — any tenant_code query param that does
    not match the user's own tenant results in an empty queryset, preventing
    cross-tenant data leakage.

    Superusers retain the ability to filter by an arbitrary tenant_code param.
    """

    tenant_filter_field: str = "tenant__code"
    branch_filter_field: str = "branch_id"

    def _get_user_tenant_code(self):
        """Return the tenant code from the requesting user's active access path."""
        tenant = resolve_user_tenant(self.request.user)
        if tenant in (None, NO_TENANT_ACCESS):
            return None
        return tenant.code

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        tenant_code_param = self.request.query_params.get("tenant_code")
        branch_id = self.request.query_params.get("branch_id")

        profile_tenant_code = self._get_user_tenant_code()

        if profile_tenant_code and not user.is_superuser:
            # Non-superusers are strictly locked to their own tenant.
            # If the caller explicitly requested a different tenant, return nothing —
            # do not leak any cross-tenant records.
            if tenant_code_param and tenant_code_param != profile_tenant_code:
                return qs.none()

            # Always scope to the user's own tenant regardless of any param.
            try:
                qs = qs.filter(**{self.tenant_filter_field: profile_tenant_code})
            except Exception:
                pass

        elif tenant_code_param:
            # Superuser (or user without a tenant profile): honour the explicit param.
            try:
                qs = qs.filter(**{self.tenant_filter_field: tenant_code_param})
            except Exception:
                pass

        if branch_id:
            try:
                qs = qs.filter(**{self.branch_filter_field: branch_id})
            except Exception:
                pass

        return qs
