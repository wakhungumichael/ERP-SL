from django.core.management.base import BaseCommand

from Platform_Core.models import TenantSubscription
from Platform_Core.platform import sync_subscription_modules


class Command(BaseCommand):
    help = "Synchronize tenant module activations for all existing subscriptions."

    def add_arguments(self, parser):
        parser.add_argument(
            "--tenant-id",
            type=int,
            dest="tenant_id",
            help="Only sync subscriptions for a specific tenant ID.",
        )

    def handle(self, *args, **options):
        tenant_id = options.get("tenant_id")

        queryset = TenantSubscription.objects.select_related("tenant", "plan").prefetch_related(
            "plan__modules__module"
        ).order_by("tenant__name", "id")

        if tenant_id:
            queryset = queryset.filter(tenant_id=tenant_id)

        total = queryset.count()
        if total == 0:
            self.stdout.write(self.style.WARNING("No subscriptions found to synchronize."))
            return

        created_total = 0
        updated_total = 0

        for subscription in queryset:
            result = sync_subscription_modules(subscription)
            created_total += result["created"]
            updated_total += result["updated"]
            self.stdout.write(
                f"tenant={subscription.tenant.name} "
                f"subscription={subscription.id} "
                f"plan={subscription.plan.code} "
                f"status={result['status']} "
                f"created={result['created']} "
                f"updated={result['updated']}"
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Synchronized {total} subscription(s). "
                f"Created {created_total} activation(s), updated {updated_total} activation(s)."
            )
        )
