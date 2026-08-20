from django.db import migrations, models


def backfill_module_scope(apps, schema_editor):
    ModuleDefinition = apps.get_model("Platform_Core", "ModuleDefinition")

    hybrid_slugs = {"platform-core", "integrations"}

    for module in ModuleDefinition.objects.all():
        module.scope = "hybrid" if module.slug in hybrid_slugs else "organization"
        module.save(update_fields=["scope"])


class Migration(migrations.Migration):

    dependencies = [
        ("Platform_Core", "0030_tenant_offboarding_foundation"),
    ]

    operations = [
        migrations.AddField(
            model_name="moduledefinition",
            name="scope",
            field=models.CharField(
                choices=[
                    ("organization", "Organization"),
                    ("hybrid", "Hybrid"),
                    ("platform_admin", "Platform Admin"),
                ],
                default="organization",
                max_length=20,
            ),
        ),
        migrations.RunPython(backfill_module_scope, migrations.RunPython.noop),
    ]
