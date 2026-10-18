# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("Platform_Core", "0044_workflow_lifecycle_and_permissions")]

    operations = [
        migrations.CreateModel(
            name="PlatformBrandingSettings",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("branding_mode", models.CharField(choices=[("saas", "SaaS platform branding"), ("dedicated", "Dedicated tenant branding")], default="saas", max_length=20)),
                ("platform_name", models.CharField(blank=True, default="SL ERP", max_length=120)),
                ("logo_url", models.CharField(blank=True, max_length=500)),
                ("logo_file", models.ImageField(blank=True, null=True, upload_to="platform_logos/")),
                ("primary_color", models.CharField(blank=True, default="#E85D26", max_length=20)),
                ("footer_text", models.TextField(blank=True)),
                ("support_email", models.EmailField(blank=True, max_length=254)),
                ("login_page_config", models.JSONField(blank=True, default=dict)),
                ("footer_menu", models.JSONField(blank=True, default=list)),
                ("landing_page_config", models.JSONField(blank=True, default=dict)),
                ("dedicated_tenant", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="dedicated_platform_branding_profiles", to="Platform_Core.tenant")),
            ],
            options={"verbose_name": "platform branding settings", "verbose_name_plural": "platform branding settings"},
        ),
    ]
