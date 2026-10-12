from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("Platform_Core", "0040_tenant_settings_workspace_name"),
    ]

    operations = [
        migrations.AddField(
            model_name="organizationmembership",
            name="branches",
            field=models.ManyToManyField(blank=True, related_name="organization_member_assignments", to="Platform_Core.tenantbranch"),
        ),
    ]
