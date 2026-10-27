# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
"""Idempotent in-app reminders for active Projects & Tasks work."""
from datetime import date

from Platform_Core.models import SystemNotification
from SL_Projects.models import ProjectTask, TaskFollowUp


def _create_once(*, tenant, recipient, title, message, route_path, source_type, source_id):
    """Create an unread reminder only once for a concrete project event."""
    if not recipient:
        return False
    _, created = SystemNotification.objects.get_or_create(
        tenant=tenant,
        recipient=recipient,
        source_type=source_type,
        source_id=source_id,
        defaults={
            "category": "reminder",
            "title": title[:200],
            "message": message,
            "route_path": route_path,
        },
    )
    return created


def run_project_reminders(*, as_of: date | None = None):
    """Notify owners of overdue work and due follow-ups.

    Safe to invoke from Celery beat, cron, or the management command. A
    reminder's source type/id pair is unique in practice, so a repeat run
    cannot create a duplicate notification for the same recipient and record.
    """
    today = as_of or date.today()
    task_reminders = 0
    follow_up_reminders = 0

    overdue_tasks = (
        ProjectTask.objects.filter(due_date__lt=today)
        .exclude(status__in=["completed", "cancelled"])
        .select_related("tenant", "primary_assignee")
        .prefetch_related("collaborators__user")
    )
    for task in overdue_tasks:
        recipients = {task.primary_assignee_id: task.primary_assignee} if task.primary_assignee_id else {}
        recipients.update({entry.user_id: entry.user for entry in task.collaborators.all()})
        for recipient in recipients.values():
            if _create_once(
                tenant=task.tenant,
                recipient=recipient,
                title=f"Overdue task: {task.number}",
                message=f"{task.title} was due on {task.due_date:%d %b %Y}.",
                route_path=f"/projects/tasks/{task.pk}",
                source_type="project_task_overdue",
                source_id=task.pk,
            ):
                task_reminders += 1

    due_follow_ups = (
        TaskFollowUp.objects.filter(follow_up_date__lte=today)
        .filter(status__in=["scheduled", "pending", "overdue"])
        .select_related("task", "task__tenant", "owner")
    )
    for follow_up in due_follow_ups:
        descriptor = "overdue" if follow_up.follow_up_date < today else "due today"
        if _create_once(
            tenant=follow_up.task.tenant,
            recipient=follow_up.owner,
            title=f"Follow-up {descriptor}: {follow_up.task.number}",
            message=f"Follow up on {follow_up.task.title}: {follow_up.notes or 'No notes provided.'}",
            route_path=f"/projects/tasks/{follow_up.task_id}",
            source_type="project_task_follow_up_due",
            source_id=follow_up.pk,
        ):
            follow_up_reminders += 1

    return {
        "date": today.isoformat(),
        "task_reminders": task_reminders,
        "follow_up_reminders": follow_up_reminders,
    }
