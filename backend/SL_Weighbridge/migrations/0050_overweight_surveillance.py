"""
Migration: Overweight Surveillance sub-module
  - Extend CameraConfig with branch FK, camera_type, hikvision_channel,
    capture_on_overweight, name, is_active
  - Add OverweightConfig (per-branch threshold + grace window)
  - Add OverweightEvent (logged when weight >= threshold)
  - Add WeighbridgeDiscrepancy (event with no matching transaction after grace)
"""
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("SL_Weighbridge", "0049_add_tenant_fk_to_transaction_invoice"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("Platform_Core", "0001_initial"),
    ]

    operations = [
        # ── 1. Extend CameraConfig ────────────────────────────────────────────
        migrations.AddField(
            model_name="cameraconfig",
            name="branch",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="camera_configs",
                to="SL_Weighbridge.branch",
            ),
        ),
        migrations.AddField(
            model_name="cameraconfig",
            name="name",
            field=models.CharField(blank=True, default="", max_length=100),
        ),
        migrations.AddField(
            model_name="cameraconfig",
            name="camera_type",
            field=models.CharField(
                choices=[("hikvision", "HikVision (ISAPI)"), ("generic_http", "Generic HTTP Snapshot")],
                default="hikvision",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="cameraconfig",
            name="hikvision_channel",
            field=models.IntegerField(default=1),
        ),
        migrations.AddField(
            model_name="cameraconfig",
            name="capture_on_overweight",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="cameraconfig",
            name="is_active",
            field=models.BooleanField(default=True),
        ),
        migrations.AlterField(
            model_name="cameraconfig",
            name="port",
            field=models.IntegerField(blank=True, default=80, null=True),
        ),
        migrations.AlterField(
            model_name="cameraconfig",
            name="ip_address",
            field=models.CharField(blank=True, max_length=64, null=True),
        ),

        # ── 2. OverweightConfig ───────────────────────────────────────────────
        migrations.CreateModel(
            name="OverweightConfig",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("threshold_kg", models.DecimalField(decimal_places=2, default=1000, max_digits=10)),
                ("grace_window_minutes", models.IntegerField(default=30)),
                ("surveillance_enabled", models.BooleanField(default=True)),
                (
                    "branch",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="overweight_config",
                        to="SL_Weighbridge.branch",
                    ),
                ),
            ],
        ),

        # ── 3. OverweightEvent ────────────────────────────────────────────────
        migrations.CreateModel(
            name="OverweightEvent",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("vehicle_plate", models.CharField(blank=True, default="", max_length=20)),
                ("gross_weight", models.IntegerField(blank=True, null=True)),
                ("tare_weight", models.IntegerField(blank=True, null=True)),
                ("net_weight", models.IntegerField()),
                ("threshold_at_capture", models.IntegerField()),
                ("recorded_at", models.DateTimeField(auto_now_add=True)),
                ("camera_image", models.ImageField(blank=True, null=True, upload_to="overweight_images/")),
                ("discrepancy_raised", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "branch",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="overweight_events",
                        to="SL_Weighbridge.branch",
                    ),
                ),
                (
                    "linked_transaction",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="overweight_events",
                        to="SL_Weighbridge.transaction",
                    ),
                ),
                (
                    "operator",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="overweight_events_triggered",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "tenant",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="overweight_events",
                        to="Platform_Core.tenant",
                    ),
                ),
            ],
            options={"ordering": ["-recorded_at"]},
        ),

        # ── 4. WeighbridgeDiscrepancy ─────────────────────────────────────────
        migrations.CreateModel(
            name="WeighbridgeDiscrepancy",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "resolution_status",
                    models.CharField(
                        choices=[("unresolved", "Unresolved"), ("reviewed", "Reviewed"), ("resolved", "Resolved")],
                        default="unresolved",
                        max_length=20,
                    ),
                ),
                ("resolution_note", models.TextField(blank=True, default="")),
                ("resolved_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "branch",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="weighbridge_discrepancies",
                        to="SL_Weighbridge.branch",
                    ),
                ),
                (
                    "overweight_event",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="discrepancy",
                        to="SL_Weighbridge.overweightevent",
                    ),
                ),
                (
                    "resolved_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="resolved_discrepancies",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "tenant",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="weighbridge_discrepancies",
                        to="Platform_Core.tenant",
                    ),
                ),
            ],
            options={"ordering": ["-created_at"], "verbose_name_plural": "Weighbridge discrepancies"},
        ),
    ]
