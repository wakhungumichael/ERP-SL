# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def seed_existing_branch_roles(apps, schema_editor):
    Membership = apps.get_model("Platform_Core", "OrganizationMembership")
    Assignment = apps.get_model("Platform_Core", "OrganizationBranchRoleAssignment")
    Group = apps.get_model("auth", "Group")

    for membership in Membership.objects.exclude(role_group_name="").iterator():
        group = Group.objects.filter(name=membership.role_group_name).first()
        if group is None:
            continue
        membership.user.groups.add(group)
        branch_ids = list(membership.branches.values_list("id", flat=True))
        if membership.branch_id and membership.branch_id not in branch_ids:
            branch_ids.append(membership.branch_id)
        for branch_id in branch_ids:
            Assignment.objects.get_or_create(
                membership_id=membership.id,
                branch_id=branch_id,
                role_group_id=group.id,
                defaults={"is_active": True},
            )


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("Platform_Core", "0050_rename_system_notification_indexes"),
    ]

    operations = [
        migrations.CreateModel(
            name="OrganizationBranchRoleAssignment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("is_active", models.BooleanField(default=True)),
                ("branch", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="member_role_assignments", to="Platform_Core.tenantbranch")),
                ("membership", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="branch_role_assignments", to="Platform_Core.organizationmembership")),
                ("role_group", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="organization_branch_role_assignments", to="auth.group")),
            ],
            options={"ordering": ["branch__name", "role_group__name"]},
        ),
        migrations.AddConstraint(
            model_name="organizationbranchroleassignment",
            constraint=models.UniqueConstraint(fields=("membership", "branch", "role_group"), name="unique_organization_branch_role_assignment"),
        ),
        migrations.RunPython(seed_existing_branch_roles, migrations.RunPython.noop),
    ]
