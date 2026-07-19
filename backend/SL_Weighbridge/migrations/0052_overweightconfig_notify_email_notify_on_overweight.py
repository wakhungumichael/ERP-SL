from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('SL_Weighbridge', '0051_alter_overweightconfig_grace_window_minutes_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='overweightconfig',
            name='notify_on_overweight',
            field=models.BooleanField(
                default=True,
                help_text=(
                    'Send an email alert when an overweight event is created for this branch. '
                    'Disable to opt out of email notifications.'
                ),
            ),
        ),
        migrations.AddField(
            model_name='overweightconfig',
            name='notify_email',
            field=models.EmailField(
                blank=True,
                null=True,
                help_text=(
                    'Email address to notify when an overweight event is detected. '
                    'Leave blank to fall back to tenant admin users.'
                ),
            ),
        ),
    ]
