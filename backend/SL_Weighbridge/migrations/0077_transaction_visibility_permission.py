from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("SL_Weighbridge", "0076_teller_receipt_reprint_permission")]

    operations = [
        migrations.AlterModelOptions(
            name="transaction",
            options={
                "permissions": [
                    ("can_export_transaction", "Can export transactions to CSV"),
                    ("can_reprint_recent_weighbridge_receipts", "Can reprint recent weighbridge receipts"),
                    ("can_approve_pending_transactions", "Can approve pending transactions"),
                    ("can_recall_completed_transactions", "Can recall completed transactions"),
                    ("can_access_weighment_entry", "Can access Weighment Entry"),
                    ("can_capture_first_weight", "Can capture first weight"),
                    ("can_capture_second_weight", "Can capture second weight"),
                    ("can_view_live_weight", "Can view live weight"),
                    ("can_view_all_weighbridge_transactions", "Can view all weighbridge transactions"),
                    ("can_manage_weighbridge_reports", "Can manage weighbridge reports"),
                    ("can_manage_weighbridge_settings", "Can manage weighbridge settings"),
                    ("can_manage_vehicle_presence", "Can manage vehicle presence"),
                    ("can_review_weighbridge_discrepancies", "Can review weighbridge discrepancies"),
                ],
            },
        ),
    ]
