# management/commands/generate_discrepancy_report.py
from django.core.management.base import BaseCommand
from django.utils import timezone
from SL_Weighbridge.models import VehiclePresence, Transaction, DiscrepancyReport
from django.core.mail import send_mail
from django.conf import settings

class Command(BaseCommand):
    help = 'Generate a discrepancy report based on vehicle presence and transactions'

    def handle(self, *args, **kwargs):
        # Fetch records from VehiclePresence and Transaction
        vehicle_records = VehiclePresence.objects.filter(locked=False)  # Only consider unlocked records
        transaction_records = Transaction.objects.all()

        discrepancies = []

        for vehicle in vehicle_records:
            detected_weight = vehicle.detected_weight
            vehicle_timestamp = vehicle.timestamp  # Timestamp from VehiclePresence

            # Check for matching transactions based on weight and timestamp
            matching_transactions = transaction_records.filter(
                gross_weight=detected_weight,
                weight_date__range=(vehicle_timestamp - timezone.timedelta(seconds=1), vehicle_timestamp + timezone.timedelta(seconds=1))
            ) | transaction_records.filter(
                tare_weight=detected_weight,
                weight_date__range=(vehicle_timestamp - timezone.timedelta(seconds=1), vehicle_timestamp + timezone.timedelta(seconds=1))
            )

            if not matching_transactions.exists():
                # If no matching transactions found, create a discrepancy
                discrepancies.append({
                    'detected_weight': detected_weight,
                    'timestamp': vehicle_timestamp,
                    'image': vehicle.image,  # Assuming the VehiclePresence model has an image field
                    'task_id': str(timezone.now().timestamp())
                })

                # Lock the current vehicle presence record
                vehicle.locked = True
                vehicle.save()

        # Save discrepancies to the DiscrepancyReport model
        for discrepancy in discrepancies:
            report = DiscrepancyReport.objects.create(
                detected_weight=discrepancy['detected_weight'],
                timestamp=discrepancy['timestamp'],
                image=discrepancy['image'],
                task_id=discrepancy['task_id']
            )

            # Send notifications
            self.send_email_notification(report)
            self.send_sms_notification(report)

        if discrepancies:
            self.stdout.write(self.style.SUCCESS(f'Found {len(discrepancies)} discrepancies.'))
        else:
            self.stdout.write(self.style.SUCCESS('No discrepancies found.'))

    def send_email_notification(self, report):
        subject = 'Discrepancy Report Generated'
        message = f'Discrepancy detected:\nWeight: {report.detected_weight}\nTimestamp: {report.timestamp}'
        send_mail(subject, message, settings.DEFAULT_FROM_EMAIL, ['recipient@example.com'])

    def send_sms_notification(self, report):
        # Implement SMS sending logic here using an SMS gateway
        sms_message = f'Discrepancy detected:\nWeight: {report.detected_weight}\nTimestamp: {report.timestamp}'
        # Example: Twilio or other SMS service
        # twilio_client.messages.create(to=recipient_phone_number, from_="your_twilio_number", body=sms_message)
