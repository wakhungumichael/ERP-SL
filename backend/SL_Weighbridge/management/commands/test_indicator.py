# management/commands/test_indicator.py
from SL_Weighbridge.models import IndicatorConfig
from SL_Weighbridge.utils import capture_weight_from_indicator
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Test the indicator communication'

    def handle(self, *args, **kwargs):
        indicator_config = IndicatorConfig.objects.first()  # Use the first indicator config for now
        weight = capture_weight_from_indicator(indicator_config)
        if weight is not None:
            self.stdout.write(self.style.SUCCESS(f"Captured weight: {weight} kg"))
        else:
            self.stdout.write(self.style.ERROR("Failed to capture weight from the indicator"))
