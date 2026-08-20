from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("Platform_Core", "0006_tenant_user_profile_branch_settings"),
    ]

    operations = [
        migrations.AddField(
            model_name="tenantsettings",
            name="estimate_template",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="estimate_template_settings", to="Platform_Core.documenttemplate"),
        ),
        migrations.AddField(
            model_name="tenantsettings",
            name="invoice_template",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="invoice_template_settings", to="Platform_Core.documenttemplate"),
        ),
        migrations.AddField(
            model_name="tenantsettings",
            name="logo_file",
            field=models.ImageField(blank=True, null=True, upload_to="tenant_logos/"),
        ),
        migrations.AddField(
            model_name="tenantsettings",
            name="receipt_template",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="receipt_template_settings", to="Platform_Core.documenttemplate"),
        ),
        migrations.AddField(
            model_name="tenantsettings",
            name="statement_template",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="statement_template_settings", to="Platform_Core.documenttemplate"),
        ),
    ]
