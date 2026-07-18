import csv
import os

from celery import shared_task
from django.conf import settings
from django.core.files import File
from SL_Weighbridge.management.commands.monitor_vehicle_presence import Command
from .models import VehiclePresence, Transaction, DiscrepancyReport


@shared_task
def generate_discrepancy_report():
    transactions = Transaction.objects.all()
    vehicle_presences = VehiclePresence.objects.all()

    # Logic to compare transactions and vehicle presences
    report_data = []

    for transaction in transactions:
        presence = vehicle_presences.filter(plate_number=transaction.vehicle.number_plate).first()
        if presence and transaction.net_weight != presence.detected_weight:
            report_data.append({
                'transaction_id': transaction.id,
                'plate_number': transaction.vehicle.number_plate,
                'net_weight': transaction.net_weight,
                'detected_weight': presence.detected_weight,
                'discrepancy': transaction.net_weight - presence.detected_weight
            })

    # Define the path and filename for the report
    report_filename = 'discrepancy_report.csv'
    report_path = os.path.join(settings.MEDIA_ROOT, report_filename)

    # Write the report data to a CSV file
    with open(report_path, 'w', newline='') as csvfile:
        fieldnames = ['transaction_id', 'plate_number', 'net_weight', 'detected_weight', 'discrepancy']
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        for row in report_data:
            writer.writerow(row)

    # Save the report file to the DiscrepancyReport model
    with open(report_path, 'rb') as report_file:
        report_instance = DiscrepancyReport.objects.create(task_id=generate_discrepancy_report.request.id)
        report_instance.report_file.save(report_filename, File(report_file))

    return "Report generated and saved."







@shared_task
def monitor_vehicle_presence_task():
    command = Command()
    command.handle()
