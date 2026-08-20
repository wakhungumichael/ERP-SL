from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("Platform_Core", "0028_organization_membership"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="SubscriptionBillingRequest",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("checkout_reference", models.CharField(blank=True, max_length=120, unique=True)),
                ("payment_provider", models.CharField(blank=True, max_length=100)),
                ("amount", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("currency", models.CharField(default="KES", max_length=10)),
                ("phone_number", models.CharField(blank=True, max_length=40)),
                ("status", models.CharField(choices=[("draft", "Draft"), ("initiated", "Initiated"), ("pending", "Pending Confirmation"), ("succeeded", "Succeeded"), ("failed", "Failed"), ("cancelled", "Cancelled")], default="draft", max_length=20)),
                ("external_reference", models.CharField(blank=True, max_length=150)),
                ("request_payload", models.JSONField(blank=True, default=dict)),
                ("response_payload", models.JSONField(blank=True, default=dict)),
                ("processed_at", models.DateTimeField(blank=True, null=True)),
                ("notes", models.TextField(blank=True)),
                ("gateway", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="subscription_billing_requests", to="Platform_Core.integrationendpoint")),
                ("requested_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="subscription_billing_requests", to=settings.AUTH_USER_MODEL)),
                ("subscription", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="billing_requests", to="Platform_Core.tenantsubscription")),
                ("tenant", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="billing_requests", to="Platform_Core.tenant")),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
    ]
