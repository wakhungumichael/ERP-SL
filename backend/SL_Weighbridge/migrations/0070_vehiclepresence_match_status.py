from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("SL_Weighbridge", "0069_vehiclepresence_legacy_company_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="vehiclepresence",
            name="match_status",
            field=models.CharField(blank=True, default="pending", max_length=20),
        ),
    ]
