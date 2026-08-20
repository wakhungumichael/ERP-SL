from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def backfill_organization_memberships(apps, schema_editor):
    TenantUserProfile = apps.get_model("Platform_Core", "TenantUserProfile")
    OrganizationMembership = apps.get_model("Platform_Core", "OrganizationMembership")

    for profile in TenantUserProfile.objects.select_related("user", "tenant", "branch").all():
        if not profile.user_id or not profile.tenant_id:
            continue
        defaults = {
            "branch_id": profile.branch_id,
            "role": "system_admin" if profile.is_tenant_admin else "member",
            "role_group_name": "Tenant Admin" if profile.is_tenant_admin else "",
            "is_org_admin": bool(profile.is_tenant_admin),
            "is_default": True,
            "is_active": True,
            "job_title": profile.job_title or "",
        }
        OrganizationMembership.objects.update_or_create(
            user_id=profile.user_id,
            tenant_id=profile.tenant_id,
            defaults=defaults,
        )


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("Platform_Core", "0027_backup_policy_scoped_artifacts"),
    ]

    operations = [
        migrations.CreateModel(
            name="OrganizationMembership",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("role", models.CharField(choices=[("owner", "Owner"), ("system_admin", "System Admin"), ("finance", "Finance"), ("operator", "Operator"), ("member", "Member")], default="member", max_length=32)),
                ("role_group_name", models.CharField(blank=True, max_length=150)),
                ("is_org_admin", models.BooleanField(default=False)),
                ("is_default", models.BooleanField(default=False)),
                ("is_active", models.BooleanField(default=True)),
                ("job_title", models.CharField(blank=True, max_length=150)),
                ("branch", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="organization_memberships", to="Platform_Core.tenantbranch")),
                ("tenant", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="organization_memberships", to="Platform_Core.tenant")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="organization_memberships", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "ordering": ["user__username", "-is_default", "tenant__name"],
                "unique_together": {("user", "tenant")},
            },
        ),
        migrations.RunPython(backfill_organization_memberships, migrations.RunPython.noop),
    ]
