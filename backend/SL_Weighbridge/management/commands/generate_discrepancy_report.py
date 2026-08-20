from django.core.management.base import BaseCommand

from SL_Weighbridge.models import VehiclePresence
from SL_Weighbridge.surveillance import maybe_record_overweight_event_from_presence
from SL_Weighbridge.sweep import run_sweep


class Command(BaseCommand):
    help = (
        "Compatibility wrapper for the modern surveillance discrepancy flow. "
        "Promotes qualifying vehicle-presence records into OverweightEvents, "
        "then runs the discrepancy sweep."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--branch",
            type=int,
            default=None,
            help="Limit processing to a specific branch ID.",
        )

    def handle(self, *args, **options):
        qs = VehiclePresence.objects.filter(overweight_event__isnull=True)
        branch_id = options.get("branch")
        if branch_id:
            qs = qs.filter(branch_id=branch_id)

        promoted = 0
        for presence in qs.select_related("branch", "tenant"):
            if maybe_record_overweight_event_from_presence(presence):
                promoted += 1

        result = run_sweep(branch_id=branch_id)
        self.stdout.write(
            self.style.SUCCESS(
                f"Promoted {promoted} vehicle-presence record(s); "
                f"raised {result['created']} discrepancy(ies); "
                f"skipped {result['skipped']} event(s) still within grace window."
            )
        )
