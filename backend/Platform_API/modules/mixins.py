"""
Shared DRF mixins for Platform_API module views.
"""
from rest_framework.permissions import IsAuthenticated


class ModuleAPIViewMixin:
    """Base mixin for all Platform API module views."""
    permission_classes = [IsAuthenticated]


class TenantScopedQuerysetMixin:
    """
    Mixin that automatically scopes querysets by tenant_code or branch_id
    when those query params are present on the request.
    """

    tenant_filter_field: str = "tenant__code"
    branch_filter_field: str = "branch_id"

    def get_queryset(self):
        qs = super().get_queryset()
        tenant_code = self.request.query_params.get("tenant_code")
        branch_id = self.request.query_params.get("branch_id")

        if tenant_code:
            try:
                qs = qs.filter(**{self.tenant_filter_field: tenant_code})
            except Exception:
                pass

        if branch_id:
            try:
                qs = qs.filter(**{self.branch_filter_field: branch_id})
            except Exception:
                pass

        return qs
