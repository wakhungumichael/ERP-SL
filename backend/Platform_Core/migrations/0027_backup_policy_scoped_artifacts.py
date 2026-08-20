from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("Platform_Core", "0026_rename_weight_capture_menu"),
    ]

    operations = [
        migrations.AlterField(
            model_name="backuppolicy",
            name="tenant",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="backup_policies",
                to="Platform_Core.tenant",
            ),
        ),
        migrations.AddField(
            model_name="backuppolicy",
            name="last_backup_file",
            field=models.CharField(blank=True, max_length=500),
        ),
        migrations.AddField(
            model_name="backuppolicy",
            name="last_backup_size_bytes",
            field=models.PositiveBigIntegerField(default=0),
        ),
    ]
