# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
"""Celery entry points for Projects & Tasks background work."""
from celery import shared_task

from SL_Projects.reminders import run_project_reminders


@shared_task(name="SL_Projects.tasks.send_project_reminders", bind=True, max_retries=3, default_retry_delay=60)
def send_project_reminders(self):
    """Daily idempotent project task and follow-up reminder sweep."""
    try:
        return run_project_reminders()
    except Exception as exc:
        raise self.retry(exc=exc)
