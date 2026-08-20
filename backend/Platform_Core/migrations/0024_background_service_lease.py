from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Platform_Core", "0023_vehicle_presence_menu_label"),
    ]

    operations = [
        migrations.CreateModel(
            name="BackgroundServiceLease",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("service_name", models.CharField(max_length=120, unique=True)),
                ("owner_id", models.CharField(blank=True, max_length=255)),
                ("heartbeat_at", models.DateTimeField(blank=True, null=True)),
                ("lease_until", models.DateTimeField(blank=True, null=True)),
                ("metadata", models.JSONField(blank=True, default=dict)),
            ],
            options={
                "ordering": ["service_name"],
            },
        ),
    ]
