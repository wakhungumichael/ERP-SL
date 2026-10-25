# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
"""Regression coverage for the branch-aware Projects & Tasks domain."""
from datetime import date, timedelta

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.exceptions import ValidationError
from django.test import TestCase

from Platform_Core.models import Tenant, TenantBranch
from SL_Projects.models import Project, ProjectDocument, ProjectTask, TaskDependency, TaskFollowUp


class ProjectDomainTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name="Projects Tenant", code="projects-tests", is_active=True, status="active")
        self.other_tenant = Tenant.objects.create(name="Other Tenant", code="projects-other", is_active=True, status="active")
        self.branch = TenantBranch.objects.create(tenant=self.tenant, name="Main branch")
        self.other_branch = TenantBranch.objects.create(tenant=self.other_tenant, name="Other branch")
        self.user = User.objects.create_user("project-user", password="pass")
        self.project = Project.objects.create(tenant=self.tenant, branch=self.branch, code="PRJ-TEST-0001", name="Implementation", created_by=self.user)

    def make_task(self, number, **kwargs):
        values = {"tenant": self.tenant, "branch": self.branch, "number": number, "title": number, "project": self.project, "created_by": self.user}
        values.update(kwargs)
        return ProjectTask.objects.create(**values)

    def test_task_rejects_project_from_another_tenant(self):
        foreign_project = Project.objects.create(tenant=self.other_tenant, branch=self.other_branch, code="PRJ-OTHER-0001", name="Other")
        task = ProjectTask(tenant=self.tenant, branch=self.branch, number="TSK-TEST-0001", title="Wrong project", project=foreign_project)
        with self.assertRaises(ValidationError):
            task.full_clean()

    def test_dependency_rejects_cross_tenant_tasks(self):
        local_task = self.make_task("TSK-TEST-0001")
        foreign_task = ProjectTask.objects.create(tenant=self.other_tenant, branch=self.other_branch, number="TSK-OTHER-0001", title="Foreign")
        dependency = TaskDependency(task=local_task, depends_on=foreign_task)
        with self.assertRaises(ValidationError):
            dependency.full_clean()

    def test_dependency_rejects_task_depending_on_itself(self):
        task = self.make_task("TSK-TEST-0001")
        dependency = TaskDependency(task=task, depends_on=task)
        with self.assertRaises(ValidationError):
            dependency.full_clean()

    def test_follow_up_completion_sets_status_and_timestamp(self):
        follow_up = TaskFollowUp.objects.create(task=self.make_task("TSK-TEST-0001"), owner=self.user, follow_up_date=date.today(), notes="Check implementation")
        follow_up.mark_completed()
        follow_up.refresh_from_db()
        self.assertEqual(follow_up.status, "completed")
        self.assertIsNotNone(follow_up.completed_at)

    def test_project_rejects_out_of_range_progress(self):
        project = Project(tenant=self.tenant, branch=self.branch, code="PRJ-TEST-0002", name="Bad progress", progress_percentage=101)
        with self.assertRaises(ValidationError):
            project.full_clean()

    def test_project_rejects_target_date_before_start_date(self):
        project = Project(tenant=self.tenant, branch=self.branch, code="PRJ-TEST-0003", name="Invalid dates", start_date=date.today(), target_end_date=date.today() - timedelta(days=1))
        with self.assertRaises(ValidationError):
            project.full_clean()

    def test_task_rejects_due_date_before_start_date(self):
        task = ProjectTask(tenant=self.tenant, branch=self.branch, number="TSK-TEST-0002", title="Invalid dates", start_date=date.today(), due_date=date.today() - timedelta(days=1))
        with self.assertRaises(ValidationError):
            task.full_clean()

    def test_project_document_belongs_to_the_project_and_retains_metadata(self):
        document = ProjectDocument.objects.create(
            project=self.project,
            uploaded_by=self.user,
            file=SimpleUploadedFile("plan.txt", b"delivery plan", content_type="text/plain"),
            original_name="plan.txt",
            content_type="text/plain",
            size_bytes=13,
            is_evidence=True,
        )
        self.assertEqual(document.project_id, self.project.id)
        self.assertEqual(document.original_name, "plan.txt")
        self.assertTrue(document.is_evidence)
