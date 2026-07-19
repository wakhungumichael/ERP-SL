"""
Shared DRF mixins for Platform_API module views.
"""
from rest_framework.permissions import IsAuthenticated


class ModuleAPIViewMixin:
    """Base mixin for all Platform API module views."""
    permission_classes = [IsAuthenticated]


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
        """Return the tenant code from the requesting user's profile, or None."""
        user = self.request.user
        try:
            profile = user.tenant_profile
            if profile and profile.tenant:
                return profile.tenant.code
        except Exception:
            pass
        return None

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
