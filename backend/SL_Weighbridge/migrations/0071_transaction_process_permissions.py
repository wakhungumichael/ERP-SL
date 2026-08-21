from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("SL_Weighbridge", "0070_vehiclepresence_match_status"),
    ]

    operations = [
        migrations.AlterModelOptions(
            name="transaction",
            options={
                "permissions": [
                    ("can_export_transaction", "Can export transactions to CSV"),
                    ("can_approve_pending_transactions", "Can approve pending transactions"),
                    ("can_recall_completed_transactions", "Can recall completed transactions"),
                    ("can_access_weighment_entry", "Can access Weighment Entry"),
                    ("can_capture_first_weight", "Can capture first weight"),
                    ("can_capture_second_weight", "Can capture second weight"),
                    ("can_view_live_weight", "Can view live weight"),
                    ("can_manage_weighbridge_reports", "Can manage weighbridge reports"),
                    ("can_manage_weighbridge_settings", "Can manage weighbridge settings"),
                    ("can_manage_vehicle_presence", "Can manage vehicle presence"),
                    ("can_review_weighbridge_discrepancies", "Can review weighbridge discrepancies"),
                ],
            },
        ),
    ]
