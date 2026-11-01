"""The branch's shared project for general work."""
from django.core.exceptions import ValidationError
from django.db import transaction


@transaction.atomic
def get_general_project(tenant_id, branch_id):
    from Platform_Core.models import TenantBranch
    from .models import Project
    if not TenantBranch.objects.filter(pk=branch_id, tenant_id=tenant_id).exists():
        raise ValidationError("Choose a branch belonging to the task organization.")
    existing = Project.objects.filter(tenant_id=tenant_id, branch_id=branch_id, is_general=True).first()
    if existing:
        return existing
    code = f"GENERAL-{branch_id}"
    suffix = 1
    while Project.objects.filter(tenant_id=tenant_id, code=code).exists():
        code = f"GENERAL-{branch_id}-{suffix}"
        suffix += 1
    project, _ = Project.objects.get_or_create(
        tenant_id=tenant_id, branch_id=branch_id, is_general=True,
        defaults={"name": "General", "code": code, "status": "active",
                  "description": "General tasks and work without a dedicated project."},
    )
    return project
