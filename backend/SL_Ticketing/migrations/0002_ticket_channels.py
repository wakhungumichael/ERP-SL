from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("SL_Ticketing", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="ticketinginboxconfig",
            name="channel_settings",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="ticketmessage",
            name="channel",
            field=models.CharField(
                choices=[
                    ("portal", "Portal"),
                    ("email", "Email"),
                    ("whatsapp", "WhatsApp"),
                    ("erp", "ERP"),
                    ("api", "API"),
                    ("system", "System"),
                ],
                default="portal",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="ticketmessage",
            name="delivery_status",
            field=models.CharField(
                choices=[
                    ("received", "Received"),
                    ("queued", "Queued"),
                    ("sent", "Sent"),
                    ("failed", "Failed"),
                    ("internal", "Internal"),
                ],
                default="received",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="ticketmessage",
            name="direction",
            field=models.CharField(
                choices=[
                    ("inbound", "Inbound"),
                    ("outbound", "Outbound"),
                    ("internal", "Internal"),
                ],
                default="inbound",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="ticketmessage",
            name="external_message_id",
            field=models.CharField(blank=True, max_length=160),
        ),
        migrations.AddField(
            model_name="ticketmessage",
            name="metadata",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
