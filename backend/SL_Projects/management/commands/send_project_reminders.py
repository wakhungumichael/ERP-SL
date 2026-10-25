# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
"""Run the Projects & Tasks reminder sweep manually."""
from django.core.management.base import BaseCommand
from django.utils.dateparse import parse_date

from SL_Projects.reminders import run_project_reminders


class Command(BaseCommand):
    help = "Send outstanding Projects & Tasks overdue and follow-up reminders."

    def add_arguments(self, parser):
        parser.add_argument(
            "--date",
            dest="as_of",
            help="Evaluate reminders for this date (YYYY-MM-DD). Defaults to today.",
        )

    def handle(self, *args, **options):
        raw_date = options.get("as_of")
        as_of = parse_date(raw_date) if raw_date else None
        if raw_date and as_of is None:
            self.stderr.write(self.style.ERROR("Use --date in YYYY-MM-DD format."))
            return
        result = run_project_reminders(as_of=as_of)
        self.stdout.write(
            self.style.SUCCESS(
                "Project reminders complete — "
                f"{result['task_reminders']} task and "
                f"{result['follow_up_reminders']} follow-up reminder(s) created."
            )
        )
