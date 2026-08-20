from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("SL_Weighbridge", "0056_transaction_payment_reference_and_received_at"),
    ]

    operations = [
        migrations.AlterField(
            model_name="transaction",
            name="status",
            field=models.CharField(
                choices=[
                    ("Draft", "Draft"),
                    ("Recalled", "Recalled"),
                    ("Rejected", "Rejected"),
                    ("Completed", "Completed"),
                ],
                default="Draft",
                max_length=20,
            ),
        ),
    ]
