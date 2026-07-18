#Author : Michael Wakhungu
#Company: Siakora Labs Limited

# SL_Weighbridge/management/commands/monitor_indicator.py

from datetime import datetime
from SL_ERP.SL_Weighbridge.models import IndicatorConfig, Transaction
from SL_ERP.SL_Weighbridge.utils import capture_weight_from_indicator
from django.core.management.base import BaseCommand

class Command(BaseCommand):
    help = 'Continuously monitor the indicator and store weight data.'

    def handle(self, *args, **kwargs):
        indicator_config = IndicatorConfig.objects.first()
        if indicator_config:
            self.stdout.write(self.style.SUCCESS(f"Monitoring indicator: {indicator_config.indicator_name}"))
            while True:
                weight = capture_weight_from_indicator(indicator_config)
                if weight is not None:
                    transaction = Transaction.objects.create(
                        branch=indicator_config.branch,
                        gross_weight=weight,
                        capture_time=datetime.now()
                    )
                    self.stdout.write(self.style.SUCCESS(f"Captured weight: {weight} kg at {transaction.capture_time}"))
                else:
                    self.stdout.write(self.style.ERROR("Failed to capture weight"))
