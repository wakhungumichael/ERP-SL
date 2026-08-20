from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("Platform_Core", "0007_tenant_branding_templates"),
    ]

    operations = [
        migrations.AddField(
            model_name="tenantsettings",
            name="purchase_order_template",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="purchase_order_template_settings",
                to="Platform_Core.documenttemplate",
            ),
        ),
        migrations.AlterField(
            model_name="documenttemplate",
            name="document_type",
            field=models.CharField(
                choices=[
                    ("invoice", "Invoice"),
                    ("quotation", "Quotation"),
                    ("receipt", "Receipt"),
                    ("purchase_order", "Purchase Order"),
                    ("weighbridge_ticket", "Weighbridge Ticket"),
                    ("statement", "Statement"),
                    ("report", "Report"),
                ],
                max_length=30,
            ),
        ),
    ]
