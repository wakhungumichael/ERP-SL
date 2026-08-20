from django.core.management.base import BaseCommand

from ...presence_monitor import run_presence_loop


class Command(BaseCommand):
    help = "Monitor vehicle presence on the weighbridge and capture configured surveillance events."

    def handle(self, *args, **kwargs):
        self.stdout.write(self.style.SUCCESS("Starting vehicle presence monitor loop..."))
        run_presence_loop()
