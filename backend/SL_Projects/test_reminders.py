# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
"""Regression coverage for the idempotent project reminder sweep."""

from datetime import date, timedelta

from django.contrib.auth.models import User

from Platform_Core.models import SystemNotification, Tenant, TenantBranch
from SL_Projects.models import Project, ProjectTask, TaskCollaborator, TaskFollowUp
from SL_Projects.reminders import run_project_reminders

from django.test import TestCase


class ProjectReminderTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(
            name="Reminders Tenant",
            code="reminders-tests",
            is_active=True,
            status="active",
        )
        self.branch = TenantBranch.objects.create(
            tenant=self.tenant, name="Main branch"
        )
        self.manager = User.objects.create_user("reminder-manager", password="pass")
        self.project = Project.objects.create(
            tenant=self.tenant,
            branch=self.branch,
            code="PRJ-REM-0001",
            name="Reminders",
            created_by=self.manager,
        )

    def make_task(self, number, **kwargs):
        values = {
            "tenant": self.tenant,
            "branch": self.branch,
            "number": number,
            "title": number,
            "project": self.project,
            "created_by": self.manager,
        }
        values.update(kwargs)
        return ProjectTask.objects.create(**values)

    def test_overdue_task_notifies_assignee(self):
        assignee = User.objects.create_user("assignee", password="pass")
        self.make_task(
            "TSK-REM-0001",
            primary_assignee=assignee,
            due_date=date.today() - timedelta(days=3),
            status="active",
        )
        result = run_project_reminders()
        self.assertEqual(result["task_reminders"], 1)
        notification = SystemNotification.objects.get(recipient=assignee)
        self.assertEqual(notification.source_type, "project_task_overdue")
        self.assertEqual(notification.category, "reminder")

    def test_completed_overdue_task_is_ignored(self):
        assignee = User.objects.create_user("done-assignee", password="pass")
        self.make_task(
            "TSK-REM-0002",
            primary_assignee=assignee,
            due_date=date.today() - timedelta(days=3),
            status="completed",
        )
        result = run_project_reminders()
        self.assertEqual(result["task_reminders"], 0)
        self.assertEqual(SystemNotification.objects.count(), 0)

    def test_collaborator_receives_overdue_reminder_once(self):
        assignee = User.objects.create_user("owner-user", password="pass")
        collaborator = User.objects.create_user("collab-user", password="pass")
        task = self.make_task(
            "TSK-REM-0003",
            primary_assignee=assignee,
            due_date=date.today() - timedelta(days=1),
            status="active",
        )
        TaskCollaborator.objects.create(task=task, user=collaborator)
        result = run_project_reminders()
        self.assertEqual(result["task_reminders"], 2)
        self.assertEqual(
            set(
                SystemNotification.objects.values_list("recipient__username", flat=True)
            ),
            {assignee.username, collaborator.username},
        )
        # Re-running the sweep must not create duplicates.
        again = run_project_reminders()
        self.assertEqual(again["task_reminders"], 0)
        self.assertEqual(SystemNotification.objects.count(), 2)

    def test_due_today_follow_up_notifies_owner(self):
        owner = User.objects.create_user("followup-owner", password="pass")
        task = self.make_task("TSK-REM-0004", status="active")
        TaskFollowUp.objects.create(
            task=task,
            owner=owner,
            follow_up_date=date.today(),
            status="scheduled",
            notes="Call client",
        )
        result = run_project_reminders()
        self.assertEqual(result["follow_up_reminders"], 1)
        notification = SystemNotification.objects.get(recipient=owner)
        self.assertEqual(notification.source_type, "project_task_follow_up_due")
        self.assertIn("due today", notification.title)

    def test_overdue_follow_up_notifies_owner(self):
        owner = User.objects.create_user("late-owner", password="pass")
        task = self.make_task("TSK-REM-0005", status="active")
        TaskFollowUp.objects.create(
            task=task,
            owner=owner,
            follow_up_date=date.today() - timedelta(days=2),
            status="pending",
            notes="",
        )
        result = run_project_reminders()
        self.assertEqual(result["follow_up_reminders"], 1)
        self.assertIn("overdue", SystemNotification.objects.get(recipient=owner).title)

    def test_done_follow_up_is_ignored(self):
        owner = User.objects.create_user("closed-owner", password="pass")
        task = self.make_task("TSK-REM-0006", status="active")
        TaskFollowUp.objects.create(
            task=task,
            owner=owner,
            follow_up_date=date.today(),
            status="completed",
            notes="",
        )
        result = run_project_reminders()
        self.assertEqual(result["follow_up_reminders"], 0)
        self.assertEqual(SystemNotification.objects.count(), 0)

    def test_rerun_is_idempotent(self):
        owner = User.objects.create_user("idem-owner", password="pass")
        task = self.make_task(
            "TSK-REM-0007",
            primary_assignee=owner,
            due_date=date.today() - timedelta(days=5),
            status="active",
        )
        TaskFollowUp.objects.create(
            task=task,
            owner=owner,
            follow_up_date=date.today() - timedelta(days=1),
            status="pending",
            notes="",
        )
        first = run_project_reminders()
        second = run_project_reminders()
        self.assertEqual(first["task_reminders"] + first["follow_up_reminders"], 2)
        self.assertEqual(second["task_reminders"] + second["follow_up_reminders"], 0)
        self.assertEqual(SystemNotification.objects.count(), 2)

    def test_explicit_as_of_date_is_respected(self):
        assignee = User.objects.create_user("asof-user", password="pass")
        self.make_task(
            "TSK-REM-0008",
            primary_assignee=assignee,
            due_date=date(2026, 1, 10),
            status="active",
        )
        result = run_project_reminders(as_of=date(2026, 1, 12))
        self.assertEqual(result["task_reminders"], 1)
        self.assertEqual(result["date"], "2026-01-12")
        # The same task is not yet overdue relative to an earlier sweep date.
        run_project_reminders(as_of=date(2026, 1, 5))
        self.assertEqual(SystemNotification.objects.count(), 1)
