from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('SL_Weighbridge', '0073_alter_customer_options'),
    ]

    operations = [
        migrations.AddField(
            model_name='transaction',
            name='image',
            field=models.ImageField(blank=True, null=True, upload_to='transaction_images/'),
        ),
    ]
