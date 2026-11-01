from django.db import migrations


def backfill_general_projects(apps, schema_editor):
    Branch = apps.get_model("Platform_Core", "TenantBranch")
    Project = apps.get_model("SL_Projects", "Project")
    Task = apps.get_model("SL_Projects", "ProjectTask")
    alias = schema_editor.connection.alias
    for branch in Branch.objects.using(alias).iterator():
        general = Project.objects.using(alias).filter(tenant_id=branch.tenant_id, branch_id=branch.pk, name__iexact="General").order_by("pk").first()
        if general:
            general.name = "General"
            general.status = "active"
            general.is_general = True
            general.save(using=alias, update_fields=["name", "status", "is_general"])
        else:
            code, suffix = f"GENERAL-{branch.pk}", 1
            while Project.objects.using(alias).filter(tenant_id=branch.tenant_id, code=code).exists():
                code = f"GENERAL-{branch.pk}-{suffix}"
                suffix += 1
            general = Project.objects.using(alias).create(
                tenant_id=branch.tenant_id, branch_id=branch.pk, name="General",
                code=code, is_general=True, status="active",
                description="General tasks and work without a dedicated project.",
            )
        Task.objects.using(alias).filter(tenant_id=branch.tenant_id, branch_id=branch.pk, project__isnull=True).update(project_id=general.pk)


class Migration(migrations.Migration):
    dependencies = [("SL_Projects", "0006_general_projects")]
    operations = [migrations.RunPython(backfill_general_projects, migrations.RunPython.noop)]
