from datetime import date
from io import BytesIO
from tempfile import TemporaryDirectory
from unittest.mock import patch
from zipfile import ZipFile

from django.contrib.auth.models import Group, Permission, User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from Platform_Core.models import OrganizationMembership, OrganizationBranchRoleAssignment, Tenant, TenantBranch
from SL_Projects.general import get_general_project
from SL_Projects.models import Project, ProjectMember, ProjectMilestone, ProjectTask, ProjectDocument, TaskAttachment, TaskCollaborator, TaskDependency


class ProjectRegisterImprovementTests(TestCase):
    def setUp(self):
        self.tenant=Tenant.objects.create(name="Register tenant",code="register-improvements",is_active=True)
        self.branch=TenantBranch.objects.create(tenant=self.tenant,name="Main")
        self.other_branch=TenantBranch.objects.create(tenant=self.tenant,name="Other branch")
        self.foreign=Tenant.objects.create(name="Foreign",code="register-foreign")
        self.foreign_branch=TenantBranch.objects.create(tenant=self.foreign,name="Foreign")
        self.admin=User.objects.create_user("register-admin")
        self.a=User.objects.create_user("participant-a")
        self.b=User.objects.create_user("participant-b")
        self.role_user=User.objects.create_user("role-assignee")
        self.foreign_user=User.objects.create_user("foreign-assignee")
        OrganizationMembership.objects.create(user=self.admin,tenant=self.tenant,branch=self.branch,is_org_admin=True,is_default=True)
        for user in (self.a,self.b):
            OrganizationMembership.objects.create(user=user,tenant=self.tenant,branch=self.branch,is_default=True)
        membership=OrganizationMembership.objects.create(user=self.role_user,tenant=self.tenant,is_default=True)
        group=Group.objects.create(name=f"tenant:{self.tenant.pk}:Field team")
        OrganizationBranchRoleAssignment.objects.create(membership=membership,branch=self.branch,role_group=group,is_active=True)
        OrganizationMembership.objects.create(user=self.foreign_user,tenant=self.foreign,branch=self.foreign_branch)
        self.project=Project.objects.create(tenant=self.tenant,branch=self.branch,code="REG-A",name="Alpha")
        self.destination=Project.objects.create(tenant=self.tenant,branch=self.branch,code="REG-B",name="Beta")
        self.milestone=ProjectMilestone.objects.create(project=self.project,name="Alpha milestone")
        self.other_milestone=ProjectMilestone.objects.create(project=self.destination,name="Beta milestone")
        self.client=APIClient();self.client.force_authenticate(self.admin)
        activation=patch("Platform_API.modules.projects.views.get_active_tenant_module_slugs",return_value={"projects-tasks"})
        activation.start();self.addCleanup(activation.stop)
        media=TemporaryDirectory();self.addCleanup(media.cleanup)
        setting=override_settings(MEDIA_ROOT=media.name);setting.enable();self.addCleanup(setting.disable)

    def task(self,number="REG-TASK",**kwargs):
        return ProjectTask.objects.create(**({"tenant":self.tenant,"branch":self.branch,"project":self.project,"number":number,"title":number,"created_by":self.admin}|kwargs))

    def test_general_project_is_available_and_unique_in_each_branch(self):
        first=self.client.get("/api/projects/project-options/")
        second=self.client.get("/api/projects/project-options/")
        self.assertEqual(first.status_code,200)
        rows=[row for row in second.data["results"] if row["is_general"]]
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["name"],"General")
        self.assertEqual(get_general_project(self.tenant.pk,self.branch.pk).pk,rows[0]["id"])
        self.assertNotEqual(get_general_project(self.tenant.pk,self.other_branch.pk).pk,rows[0]["id"])

    def test_general_project_cannot_be_renamed_deleted_or_closed(self):
        general=get_general_project(self.tenant.pk,self.branch.pk)
        self.assertEqual(self.client.patch(f"/api/projects/projects/{general.pk}/",{"name":"Not general"},format="json").status_code,400)
        self.assertEqual(self.client.delete(f"/api/projects/projects/{general.pk}/").status_code,400)
        self.assertEqual(self.client.post(f"/api/projects/projects/{general.pk}/close/",{"status":"archived"},format="json").status_code,400)

    def test_new_api_task_requires_project_and_internal_tasks_default_to_general(self):
        for payload in ({"title":"Missing"},{"title":"Null","project":None}):
            self.assertEqual(self.client.post("/api/projects/tasks/",payload,format="json").status_code,400)
        task=self.task(project=None)
        self.assertTrue(task.project.is_general)
        good=self.client.post("/api/projects/tasks/",{"title":"General work","project":task.project_id,"task_type":"general"},format="json")
        self.assertEqual(good.status_code,201,good.data)

    def test_milestone_must_match_project(self):
        bad=self.client.post("/api/projects/tasks/",{"title":"Wrong milestone","project":self.project.pk,"milestone":self.other_milestone.pk},format="json")
        self.assertEqual(bad.status_code,400)
        good=self.client.post("/api/projects/tasks/",{"title":"Milestone work","project":self.project.pk,"milestone":self.milestone.pk},format="json")
        self.assertEqual(good.status_code,201,good.data)

    def test_project_transfer_clears_old_milestone_and_updates_both_progress_totals(self):
        task=self.task(milestone=self.milestone,progress_percentage=100)
        self.project.progress_percentage=100;self.project.save()
        response=self.client.patch(f"/api/projects/tasks/{task.pk}/",{"project":self.destination.pk,"primary_assignee":self.role_user.pk},format="json")
        self.assertEqual(response.status_code,200,response.data)
        task.refresh_from_db();self.project.refresh_from_db();self.destination.refresh_from_db()
        self.assertEqual(task.project_id,self.destination.pk);self.assertIsNone(task.milestone_id)
        self.assertEqual(task.primary_assignee_id,self.role_user.pk)
        self.assertEqual(self.project.progress_percentage,0);self.assertEqual(self.destination.progress_percentage,100)

    def test_linked_tasks_cannot_be_silently_moved_across_projects(self):
        task=self.task();dependency=self.task("DEPENDENCY")
        TaskDependency.objects.create(task=task,depends_on=dependency)
        response=self.client.patch(f"/api/projects/tasks/{task.pk}/",{"project":self.destination.pk},format="json")
        self.assertEqual(response.status_code,400)
        task.refresh_from_db();self.assertEqual(task.project_id,self.project.pk)

    def test_role_based_team_members_remain_eligible_for_multiple_participant_additions(self):
        task=self.task()
        path=f"/api/projects/tasks/{task.pk}/"
        choices=self.client.get(path+"assignees/")
        ids={row["id"] for row in choices.data}
        self.assertIn(self.role_user.pk,ids);self.assertNotIn(self.foreign_user.pk,ids)
        for user in (self.a,self.b):
            response=self.client.post(path+"collaborators/",{"user_ids":[user.pk],"participation_role":"accountable"},format="json")
            self.assertEqual(response.status_code,200,response.data)
        self.assertEqual(task.collaborators.filter(participation_role="accountable").count(),2)
        self.assertIn(self.role_user.pk,{row["id"] for row in self.client.get(path+"assignees/").data})
        assigned=self.client.post(path+"assign/",{"primary_assignee":self.role_user.pk},format="json")
        self.assertEqual(assigned.status_code,200,assigned.data)

    def test_participant_can_switch_roles_without_duplicate_rows(self):
        task=self.task();path=f"/api/projects/tasks/{task.pk}/collaborators/"
        for role in ("supporting","accountable"):
            self.assertEqual(self.client.post(path,{"user_ids":[self.a.pk],"participation_role":role},format="json").status_code,200)
        self.assertEqual(task.collaborators.count(),1)
        self.assertEqual(task.collaborators.get().participation_role,"accountable")

    def test_reassignment_requires_assignment_permission(self):
        editor=User.objects.create_user("planning-editor")
        role=Group.objects.create(name=f"tenant:{self.tenant.pk}:Planning editor")
        role.permissions.set(Permission.objects.filter(content_type__app_label="SL_Projects",codename__in=["view_all_projecttask","change_projecttask"]))
        editor.groups.add(role)
        OrganizationMembership.objects.create(user=editor,tenant=self.tenant,branch=self.branch,is_default=True,active_role_group_name=role.name)
        task=self.task();self.client.force_authenticate(editor)
        response=self.client.patch(f"/api/projects/tasks/{task.pk}/",{"primary_assignee":self.a.pk},format="json")
        self.assertEqual(response.status_code,403)
        task.refresh_from_db();self.assertIsNone(task.primary_assignee_id)

    def test_register_filters_cover_columns_and_validate_progress(self):
        match=self.task("FILTER-101",title="Safety inspection",priority="high",status="in_progress",progress_percentage=45,due_date=date(2026,11,10),primary_assignee=self.a,task_type="inspection")
        self.task("FILTER-OTHER",title="Unrelated",priority="low")
        response=self.client.get("/api/projects/tasks/",{"number":"101","title":"Safety","project":self.project.pk,"assignee":self.a.pk,"priority":"high","status":"in_progress","task_type":"inspection","progress_min":40,"progress_max":50,"date_from":"2026-11-01","date_to":"2026-11-30"})
        self.assertEqual(response.status_code,200,response.data)
        self.assertEqual([row["id"] for row in response.data["results"]],[match.pk])
        for params in ({"progress_min":101},{"progress_min":90,"progress_max":20},{"assignee":"invalid"}):
            self.assertEqual(self.client.get("/api/projects/tasks/",params).status_code,400)

    def test_milestone_paging_has_complete_counts_and_preserves_unpaged_options(self):
        for index in range(12):ProjectMilestone.objects.create(project=self.project,name=f"Milestone {index:02}")
        path=f"/api/projects/projects/{self.project.pk}/milestones/"
        paged=self.client.get(path,{"page_size":10,"page":2})
        self.assertEqual(paged.data["count"],13);self.assertEqual(len(paged.data["results"]),3)
        self.assertEqual(len(self.client.get(path).data),13)

    def test_document_paging_search_and_preview_without_download(self):
        for index in range(12):
            ProjectDocument.objects.create(project=self.project,uploaded_by=self.admin,file=SimpleUploadedFile(f"notes-{index:02}.txt",b"Project notes"),original_name=f"notes-{index:02}.txt",size_bytes=13)
        path=f"/api/projects/projects/{self.project.pk}/documents/"
        response=self.client.get(path,{"page":2,"page_size":10})
        self.assertEqual(response.data["count"],12);self.assertEqual(len(response.data["results"]),2)
        selected=response.data["results"][0]
        preview=self.client.get(f"/api/projects/projects/{self.project.pk}/document-preview/project/{selected['id']}/")
        self.assertEqual(preview.status_code,200);self.assertEqual(preview.json()["text"],"Project notes")
        self.assertNotIn("Content-Disposition",preview)
        self.assertIn("no-store",preview["Cache-Control"])

    def test_pdf_and_office_previews_remain_private_and_do_not_force_download(self):
        pdf=ProjectDocument.objects.create(project=self.project,file=SimpleUploadedFile("brief.pdf",b"%PDF-1.4\npreview"),original_name="brief.pdf")
        path=f"/api/projects/projects/{self.project.pk}/document-preview/project/{pdf.pk}/"
        response=self.client.get(path)
        self.assertEqual(response["Content-Type"],"application/pdf")
        self.assertTrue(response["Content-Disposition"].startswith("inline"))
        response.close()
        download=self.client.get(path+"?download=1");self.assertTrue(download["Content-Disposition"].startswith("attachment"));download.close()
        output=BytesIO()
        with ZipFile(output,"w") as archive:archive.writestr("word/document.xml",'<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>Planning content</w:t></w:r></w:p></w:body></w:document>')
        word=ProjectDocument.objects.create(project=self.project,file=SimpleUploadedFile("brief.docx",output.getvalue()),original_name="brief.docx")
        response=self.client.get(f"/api/projects/projects/{self.project.pk}/document-preview/project/{word.pk}/")
        self.assertIn("Planning content",response.json()["text"])

    def test_foreign_documents_and_unassigned_task_attachments_do_not_leak(self):
        own=self.task("VISIBLE",primary_assignee=self.a)
        hidden=self.task("HIDDEN",primary_assignee=self.b)
        attachment=TaskAttachment.objects.create(task=hidden,file=SimpleUploadedFile("private.txt",b"private"),original_name="private.txt")
        role=Group.objects.create(name=f"tenant:{self.tenant.pk}:Own tasks")
        role.permissions.set(Permission.objects.filter(content_type__app_label="SL_Projects",codename__in=["view_own_projecttask", "view_project"]))
        self.a.groups.add(role)
        membership=OrganizationMembership.objects.get(user=self.a);membership.active_role_group_name=role.name;membership.save()
        self.client.force_authenticate(self.a)
        response=self.client.get(f"/api/projects/projects/{self.project.pk}/documents/",{"page_size":10})
        self.assertEqual(response.status_code,200,response.data)
        self.assertEqual(response.data["count"],0)
        response=self.client.get(f"/api/projects/projects/{self.project.pk}/document-preview/task/{attachment.pk}/")
        self.assertEqual(response.status_code,404)
        self.client.force_authenticate(self.foreign_user)
        self.assertEqual(self.client.get(f"/api/projects/projects/{self.project.pk}/document-preview/task/{attachment.pk}/").status_code,403)

    def test_html_files_are_download_only_and_task_catalog_covers_multiple_industries(self):
        document=ProjectDocument.objects.create(project=self.project,file=SimpleUploadedFile("unsafe.html",b"<script>alert(1)</script>"),original_name="unsafe.html")
        response=self.client.get(f"/api/projects/projects/{self.project.pk}/document-preview/project/{document.pk}/")
        self.assertEqual(response.status_code,400)
        choices=self.client.get("/api/projects/task-types/")
        self.assertEqual(choices.status_code,200)
        values={row["value"] for row in choices.data}
        self.assertTrue({"general","construction","healthcare","agriculture","development","inspection","other"}<=values)

    def test_missing_stored_file_has_actionable_preview_and_download_errors(self):
        document=ProjectDocument.objects.create(project=self.project,file="projects/missing-file.pdf",original_name="missing.pdf")
        path=f"/api/projects/projects/{self.project.pk}/document-preview/project/{document.pk}/"
        for suffix in ("","?download=1"):
            response=self.client.get(path+suffix)
            self.assertEqual(response.status_code,400)
            self.assertIn("unavailable",str(response.data))

    def test_simple_task_lifecycle_includes_completion_reopening_and_history(self):
        from django.utils import timezone
        task = self.task()
        path = f"/api/projects/tasks/{task.pk}/"
        states = ["todo", "in_progress", "blocked", "in_progress", "in_review", "completed", "reopened", "in_progress", "completed"]
        for state in states:
            response = self.client.patch(path, {"status": state}, format="json")
            self.assertEqual(response.status_code, 200, response.data)
            task.refresh_from_db()
            self.assertEqual(task.status, state)
            if state == "completed":
                self.assertEqual(task.progress_percentage, 100)
                self.assertEqual(task.completion_date, timezone.localdate())
            elif state == "reopened":
                self.assertEqual(task.progress_percentage, 0)
                self.assertIsNone(task.completion_date)
        self.assertEqual(task.updates.count(), len(states))
        self.assertIn("In progress to Completed", task.updates.first().update_description)
        before = task.completion_date
        response = self.client.patch(path, {"title": "Completed task detail edit", "status": "completed"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(task.updates.count(), len(states))
        task.refresh_from_db(); self.assertEqual(task.completion_date, before)

    def test_status_menu_exposes_all_choices_and_explains_unavailable_reopen(self):
        task = self.task()
        response = self.client.get(f"/api/projects/tasks/{task.pk}/")
        options = {option["value"]: option for option in response.data["status_options"]}
        self.assertEqual(set(options), {"draft", "todo", "in_progress", "blocked", "reopened", "in_review", "completed", "cancelled"})
        self.assertFalse(options["completed"]["disabled"])
        self.assertTrue(options["reopened"]["disabled"])
        self.assertIn("completed or cancelled", options["reopened"]["reason"])
        response = self.client.patch(f"/api/projects/tasks/{task.pk}/", {"status": "reopened"}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_reopen_permission_applies_to_all_transitions_out_of_closed_tasks(self):
        task = self.task(status="completed", progress_percentage=100, completion_date=date.today(), primary_assignee=self.b)
        # A nonparticipant editor still needs explicit lifecycle permissions.
        ProjectMember.objects.create(project=self.project, user=self.a, branch=self.branch, responsibility='viewer')
        role = Group.objects.create(name=f"tenant:{self.tenant.pk}:Lifecycle editor")
        role.permissions.set(Permission.objects.filter(content_type__app_label="SL_Projects", codename__in=["view_projecttask", "change_projecttask", "complete_projecttask"]))
        self.a.groups.add(role)
        membership = OrganizationMembership.objects.get(user=self.a)
        membership.active_role_group_name = role.name; membership.save()
        self.client.force_authenticate(self.a)
        for state in ["todo", "in_progress", "reopened", "draft", "blocked", "cancelled"]:
            response = self.client.patch(f"/api/projects/tasks/{task.pk}/", {"status": state}, format="json")
            self.assertEqual(response.status_code, 400, response.data)
        role.permissions.add(Permission.objects.get(content_type__app_label="SL_Projects", codename="reopen_projecttask"))
        response = self.client.patch(f"/api/projects/tasks/{task.pk}/", {"status": "reopened"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        task.refresh_from_db(); self.assertIsNone(task.completion_date)

    def test_completion_permission_is_required_and_unavailable_choice_is_explained(self):
        task = self.task(primary_assignee=self.b)
        # A nonparticipant editor still needs explicit lifecycle permissions.
        ProjectMember.objects.create(project=self.project, user=self.a, branch=self.branch, responsibility='viewer')
        role = Group.objects.create(name=f"tenant:{self.tenant.pk}:Task editor")
        role.permissions.set(Permission.objects.filter(content_type__app_label="SL_Projects", codename__in=["view_projecttask", "change_projecttask"]))
        self.a.groups.add(role)
        membership = OrganizationMembership.objects.get(user=self.a)
        membership.active_role_group_name = role.name; membership.save()
        self.client.force_authenticate(self.a)
        response = self.client.get(f"/api/projects/tasks/{task.pk}/")
        completed = next(item for item in response.data["status_options"] if item["value"] == "completed")
        self.assertTrue(completed["disabled"])
        response = self.client.patch(f"/api/projects/tasks/{task.pk}/", {"status": "completed"}, format="json")
        self.assertEqual(response.status_code, 400)

    def task_workflow(self, events=None):
        from Platform_Core.models import WorkflowDefinition, WorkflowEntityBinding
        workflow = WorkflowDefinition.objects.create(tenant=self.tenant, code="task-approval", name="Task approval", entity_type="project_task", status="published")
        binding = WorkflowEntityBinding.objects.create(workflow=workflow, module_slug="projects-tasks", entity_type="project_task", entity_label="Task", trigger_events=events or ["submit"])
        return workflow, binding

    def test_approval_guard_matches_submit_event_and_allows_ordinary_statuses(self):
        task = self.task()
        workflow, binding = self.task_workflow(["archive"])
        response = self.client.patch(f"/api/projects/tasks/{task.pk}/", {"status": "completed"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.client.patch(f"/api/projects/tasks/{task.pk}/", {"status": "reopened"}, format="json")
        binding.trigger_events = ["submit"]; binding.save()
        response = self.client.patch(f"/api/projects/tasks/{task.pk}/", {"status": "in_progress"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        for state in ["in_review", "completed", "cancelled"]:
            response = self.client.patch(f"/api/projects/tasks/{task.pk}/", {"status": state}, format="json")
            self.assertEqual(response.status_code, 400)
            self.assertIn("Send for approval", str(response.data))

    def test_pending_approval_blocks_status_changes_but_allows_planning_edits(self):
        from Platform_Core.models import WorkflowInboxItem
        task = self.task(status="in_review")
        workflow, _ = self.task_workflow()
        WorkflowInboxItem.objects.create(tenant=self.tenant, workflow=workflow, module_slug="projects-tasks", entity_type="project_task", entity_id=task.pk, title="Approve task", status="deferred")
        response = self.client.patch(f"/api/projects/tasks/{task.pk}/", {"status": "todo"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("pending", str(response.data))
        response = self.client.patch(f"/api/projects/tasks/{task.pk}/", {"title": "Clarified details", "status": "in_review"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)

    def test_completed_task_reopen_clears_completion_and_preserves_checklist_progress(self):
        from SL_Projects.models import TaskChecklistItem
        task = self.task(status="completed", progress_percentage=100, completion_date=date.today(), workflow_status="approved", workflow_stage="Approved")
        TaskChecklistItem.objects.create(task=task, title="Delivered", is_completed=True)
        TaskChecklistItem.objects.create(task=task, title="Acceptance", is_completed=False)
        response = self.client.patch(f"/api/projects/tasks/{task.pk}/", {"status": "reopened"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        task.refresh_from_db()
        self.assertEqual(task.progress_percentage, 50)
        self.assertEqual(task.workflow_status, "")
        self.assertEqual(task.workflow_stage, "")
        self.assertIsNone(task.completion_date)
        rows = self.client.get("/api/projects/tasks/", {"status": "reopened"}).data["results"]
        self.assertEqual([row["id"] for row in rows], [task.pk])

    def test_follow_up_is_task_linked_and_completion_does_not_complete_task(self):
        task = self.task(status="in_progress")
        path = f"/api/projects/tasks/{task.pk}/follow-ups/"
        created = self.client.post(path, {"follow_up_date": "2026-11-01", "notes": "Check supplier response"}, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        response = self.client.post(path + f"{created.data['id']}/complete/")
        self.assertEqual(response.status_code, 200)
        task.refresh_from_db(); self.assertEqual(task.status, "in_progress")
        self.assertEqual(task.follow_ups.get().status, "completed")

    def test_workflow_submission_moves_active_task_to_review(self):
        from Platform_Core.models import WorkflowInboxItem
        from Platform_API.modules.platform.views import _sync_workflow_entity_state
        task = self.task(status="in_progress")
        workflow, _ = self.task_workflow()
        item = WorkflowInboxItem.objects.create(tenant=self.tenant, workflow=workflow, module_slug="projects-tasks", entity_type="project_task", entity_id=task.pk, title="Task approval")
        _sync_workflow_entity_state(item, "in_progress", self.admin)
        task.refresh_from_db(); self.assertEqual(task.status, "in_review")

    def test_new_task_cannot_bypass_completion_approval_or_claim_reopened(self):
        self.task_workflow()
        for state in ["completed", "reopened"]:
            response = self.client.post("/api/projects/tasks/", {"title": "Invalid new status", "project": self.project.pk, "status": state}, format="json")
            self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(ProjectTask.objects.filter(title="Invalid new status").exists())

    def test_project_settings_are_isolated_by_organization_and_defaults_are_applied(self):
        from django.utils import timezone
        from datetime import timedelta
        from SL_Projects.models import ProjectModuleSettings
        path = "/api/projects/settings/"
        original = self.client.get(path)
        self.assertEqual(original.status_code, 200, original.data)
        self.assertTrue(original.data["can_manage"])
        self.assertEqual(ProjectModuleSettings.objects.count(), 0)
        updated = self.client.patch(path, {"default_task_type": "inspection", "default_priority": "high", "default_task_status": "todo", "default_due_days": 4, "default_follow_up_days": 3, "default_page_size": 10}, format="json")
        self.assertEqual(updated.status_code, 200, updated.data)
        task = self.client.post("/api/projects/tasks/", {"title": "Configured defaults", "project": self.project.pk}, format="json")
        self.assertEqual(task.status_code, 201, task.data)
        self.assertEqual(task.data["task_type"], "inspection")
        self.assertEqual(task.data["priority"], "high")
        self.assertEqual(task.data["status"], "todo")
        self.assertEqual(task.data["due_date"], (timezone.localdate()+timedelta(days=4)).isoformat())
        OrganizationMembership.objects.filter(user=self.foreign_user).update(is_org_admin=True)
        self.client.force_authenticate(self.foreign_user)
        foreign = self.client.get(path)
        self.assertEqual(foreign.status_code, 200, foreign.data)
        self.assertEqual(foreign.data["default_priority"], "medium")

    def test_project_settings_require_management_permission(self):
        role = Group.objects.create(name=f"tenant:{self.tenant.pk}:Settings reader")
        role.permissions.set(Permission.objects.filter(content_type__app_label="SL_Projects", codename="view_own_projecttask"))
        self.a.groups.add(role)
        membership=OrganizationMembership.objects.get(user=self.a); membership.active_role_group_name=role.name; membership.save()
        self.client.force_authenticate(self.a)
        response=self.client.get("/api/projects/settings/")
        self.assertEqual(response.status_code,200,response.data);self.assertFalse(response.data["can_manage"])
        response=self.client.patch("/api/projects/settings/",{"default_priority":"high"},format="json")
        self.assertEqual(response.status_code,403)
        role.permissions.add(Permission.objects.get(content_type__app_label="SL_Projects",codename="change_projectmodulesettings"))
        response=self.client.patch("/api/projects/settings/",{"default_priority":"high"},format="json")
        self.assertEqual(response.status_code,200,response.data)
        sync=self.client.put("/api/projects/settings/ticket-task-sync/",{"is_enabled":True,"target_ticket_status":"resolved"},format="json")
        self.assertEqual(sync.status_code,200,sync.data)

    def test_task_types_can_be_configured_and_other_requires_a_name(self):
        path="/api/projects/settings/"
        response=self.client.patch(path,{"task_types":[{"value":"veterinary_visit","label":"Veterinary visit","category":"Animal care","is_active":True}],"default_task_type":"veterinary_visit"},format="json")
        self.assertEqual(response.status_code,200,response.data)
        types=self.client.get("/api/projects/task-types/").data
        self.assertEqual({row["value"] for row in types},{"veterinary_visit","other"})
        response=self.client.post("/api/projects/tasks/",{"title":"Custom industry work","project":self.project.pk,"task_type":"Boat maintenance"},format="json")
        self.assertEqual(response.status_code,201,response.data);self.assertEqual(response.data["task_type"],"Boat maintenance")
        for value in ("other", ""):
            response=self.client.post("/api/projects/tasks/",{"title":"Unnamed other","project":self.project.pk,"task_type":value},format="json")
            self.assertEqual(response.status_code,400,response.data)

    def test_disabled_and_custom_type_policies_preserve_existing_tasks(self):
        task=self.task(task_type="inspection")
        cfg=self.client.get("/api/projects/settings/").data
        cfg["allow_custom_task_types"]=False
        for row in cfg["task_types"]:
            if row["value"]=="inspection":row["is_active"]=False
        response=self.client.patch("/api/projects/settings/",cfg,format="json")
        self.assertEqual(response.status_code,200,response.data)
        for value in ("inspection","Unconfigured custom"):
            response=self.client.post("/api/projects/tasks/",{"title":"Invalid type","project":self.project.pk,"task_type":value},format="json")
            self.assertEqual(response.status_code,400,response.data)
        response=self.client.patch(f"/api/projects/tasks/{task.pk}/",{"title":"Keep historical type","task_type":"inspection"},format="json")
        self.assertEqual(response.status_code,200,response.data)
        self.assertNotIn("other",{row["value"] for row in self.client.get("/api/projects/task-types/").data})

    def test_settings_reject_invalid_catalog_defaults_and_statuses(self):
        for payload in [{"default_page_size":7},{"default_follow_up_days":-1},{"default_due_days":4000},{"default_task_type":"missing"},{"enabled_task_statuses":["todo"]},{"enabled_task_statuses":["todo","in_progress","completed","completed"]},{"default_task_status":"completed"},{"task_types":[]},{"task_types":[{"value":"Bad Code","label":"A","category":"B"}]}]:
            response=self.client.patch("/api/projects/settings/",payload,format="json")
            self.assertEqual(response.status_code,400,(payload,response.data))

    def test_settings_version_uses_api_timestamp_and_detects_stale_updates(self):
        first=self.client.patch("/api/projects/settings/",{"default_priority":"high"},format="json")
        version=first.data["updated_at"]
        second=self.client.patch("/api/projects/settings/",{"default_priority":"low","version":version},format="json")
        self.assertEqual(second.status_code,200,second.data)
        stale=self.client.patch("/api/projects/settings/",{"default_priority":"critical","version":version},format="json")
        self.assertEqual(stale.status_code,409,stale.data)

    def test_optional_status_configuration_is_enforced_and_current_status_is_retained(self):
        task=self.task(status="blocked")
        response=self.client.patch("/api/projects/settings/",{"enabled_task_statuses":["draft","todo","in_progress","completed"]},format="json")
        self.assertEqual(response.status_code,200,response.data)
        saved=self.client.patch(f"/api/projects/tasks/{task.pk}/",{"title":"Still blocked"},format="json")
        self.assertEqual(saved.status_code,200,saved.data)
        moved=self.client.patch(f"/api/projects/tasks/{task.pk}/",{"status":"todo"},format="json")
        self.assertEqual(moved.status_code,200,moved.data)
        rejected=self.client.patch(f"/api/projects/tasks/{task.pk}/",{"status":"blocked"},format="json")
        self.assertEqual(rejected.status_code,400)

    def test_task_related_records_paginate_search_and_retain_plain_arrays(self):
        from SL_Projects.models import TaskUpdate,TaskFollowUp,TaskComment
        task=self.task()
        for index in range(13):
            TaskUpdate.objects.create(task=task,updated_by=self.admin,progress_percentage=index,update_description=f"Activity {index:02}")
            TaskFollowUp.objects.create(task=task,owner=self.admin,follow_up_date=date(2026,11,1),notes=f"Reminder {index:02}")
            TaskComment.objects.create(task=task,author=self.admin,body=f"Discussion {index:02}")
            TaskAttachment.objects.create(task=task,uploaded_by=self.admin,file=f"attachments/file{index:02}.txt",original_name=f"File {index:02}.txt")
        for suffix,field,prefix in [("updates","update_description","Activity"),("follow-ups","notes","Reminder"),("comments","body","Discussion"),("attachments","original_name","File")]:
            path=f"/api/projects/tasks/{task.pk}/{suffix}/"
            plain=self.client.get(path);self.assertEqual(len(plain.data),13)
            response=self.client.get(path,{"page":2,"page_size":10})
            self.assertEqual(response.status_code,200,response.data);self.assertEqual(response.data["count"],13);self.assertEqual(len(response.data["results"]),3)
            searched=self.client.get(path,{"page_size":10,"search":f"{prefix} 05"})
            self.assertEqual(searched.data["count"],1);self.assertIn("05",searched.data["results"][0][field])

    def test_project_team_paginates_and_metadata_does_not_load_all_members(self):
        from SL_Projects.models import ProjectMember
        for index in range(13):
            user=User.objects.create_user(f"team-member-{index:02}")
            ProjectMember.objects.create(project=self.project,user=user,branch=self.branch)
        path=f"/api/projects/projects/{self.project.pk}/members/"
        response=self.client.get(path,{"page":2,"page_size":10})
        self.assertEqual(response.status_code,200,response.data);self.assertEqual(response.data["count"],13);self.assertEqual(len(response.data["results"]),3)
        self.assertEqual(self.client.get(path,{"page_size":10,"search":"team-member-05"}).data["count"],1)
        self.assertEqual(len(self.client.get(path).data["members"]),13)
        self.assertEqual(self.client.get(path,{"include_options":1}).data["members"],[])

    def test_subtasks_and_dependencies_have_independent_pagination(self):
        task=self.task()
        for index in range(13):
            self.task(f"CHILD-{index:02}",parent_task=task)
            dependency=self.task(f"DEP-{index:02}")
            TaskDependency.objects.create(task=task,depends_on=dependency)
        path=f"/api/projects/tasks/{task.pk}/structure/"
        for kind in ("subtasks","dependencies"):
            response=self.client.get(path,{"kind":kind,"page":2,"page_size":10})
            self.assertEqual(response.status_code,200,response.data);self.assertEqual(response.data["count"],13);self.assertEqual(len(response.data["results"]),3)
        options=self.client.get(path,{"kind":"options"})
        self.assertEqual(options.data["candidates"],[])
        self.assertEqual(len(self.client.get(path).data["subtasks"]),13)

    def test_related_pages_do_not_expose_foreign_or_unassigned_tasks(self):
        from SL_Projects.models import TaskComment
        task=self.task(primary_assignee=self.b)
        TaskComment.objects.create(task=task,body="Private discussion",author=self.b)
        role=Group.objects.create(name=f"tenant:{self.tenant.pk}:Own related rows")
        role.permissions.set(Permission.objects.filter(content_type__app_label="SL_Projects",codename="view_own_projecttask"))
        self.a.groups.add(role)
        membership=OrganizationMembership.objects.get(user=self.a);membership.active_role_group_name=role.name;membership.save()
        self.client.force_authenticate(self.a)
        for suffix in ("updates","follow-ups","comments","attachments","structure"):
            response=self.client.get(f"/api/projects/tasks/{task.pk}/{suffix}/",{"page_size":10,"kind":"subtasks"})
            self.assertEqual(response.status_code,404)
        self.client.force_authenticate(self.foreign_user)
        self.assertIn(self.client.get(f"/api/projects/projects/{self.project.pk}/members/",{"page_size":10}).status_code,(403,404))

    def test_deliverable_pages_keep_completion_actions_and_progress_calculation(self):
        from SL_Projects.models import TaskChecklistItem
        task=self.task()
        for index in range(12):
            TaskChecklistItem.objects.create(task=task,title=f"Deliverable {index:02}",created_by=self.admin)
        path=f"/api/projects/tasks/{task.pk}/checklist/"
        response=self.client.get(path,{"page":2,"page_size":10})
        self.assertEqual(response.status_code,200,response.data)
        self.assertEqual(response.data["count"],12);self.assertEqual(len(response.data["results"]),2)
        item=response.data["results"][0]
        changed=self.client.patch(path+str(item["id"])+"/",{"is_completed":True},format="json")
        self.assertEqual(changed.status_code,200,changed.data)
        task.refresh_from_db();self.assertEqual(task.progress_percentage,8)
        self.assertEqual(len(self.client.get(path).data),12)

    def test_tasks_cannot_be_deleted_in_any_status(self):
        for index,state in enumerate(["draft","todo","completed"]):
            task=self.task(f"RETAIN-{index}",status=state)
            response=self.client.delete(f"/api/projects/tasks/{task.pk}/")
            self.assertEqual(response.status_code,405,response.data)
            self.assertTrue(ProjectTask.objects.filter(pk=task.pk).exists())

    def test_deactivation_and_reactivation_preserve_assignment_links_and_history(self):
        from SL_Projects.models import TaskComment,TaskFollowUp
        task=self.task(primary_assignee=self.a,progress_percentage=100,status="completed",completion_date=date.today())
        child=self.task("RETAIN-CHILD",parent_task=task,progress_percentage=20)
        dependency=self.task("RETAIN-DEP",progress_percentage=60)
        TaskDependency.objects.create(task=task,depends_on=dependency)
        TaskComment.objects.create(task=task,author=self.a,body="Keep discussion")
        TaskAttachment.objects.create(task=task,file=SimpleUploadedFile("retained.txt",b"keep"),original_name="retained.txt")
        TaskFollowUp.objects.create(task=task,owner=self.a,follow_up_date=date.today(),notes="Keep reminder")
        TaskCollaborator.objects.create(task=task,user=self.b)
        path=f"/api/projects/tasks/{task.pk}/activation/"
        response=self.client.post(path,{"is_active":False},format="json")
        self.assertEqual(response.status_code,200,response.data)
        task.refresh_from_db();self.project.refresh_from_db()
        self.assertFalse(task.is_active);self.assertIsNotNone(task.deactivated_at);self.assertEqual(task.deactivated_by_id,self.admin.pk)
        self.assertEqual(task.primary_assignee_id,self.a.pk);self.assertEqual(task.status,"completed")
        self.assertEqual(task.comments.count(),1);self.assertEqual(task.attachments.count(),1);self.assertEqual(task.follow_ups.count(),1);self.assertEqual(task.collaborators.count(),1)
        self.assertEqual(task.subtasks.get().pk,child.pk);self.assertEqual(task.dependencies.count(),1)
        self.assertEqual(self.project.progress_percentage,40)
        response=self.client.post(path,{"is_active":False},format="json")
        self.assertEqual(task.updates.count(),1)
        response=self.client.post(path,{"is_active":True},format="json")
        self.assertEqual(response.status_code,200,response.data)
        task.refresh_from_db();self.assertTrue(task.is_active);self.assertIsNone(task.deactivated_at);self.assertIsNone(task.deactivated_by_id)
        self.assertEqual(task.primary_assignee_id,self.a.pk);self.assertEqual(task.updates.count(),2)

    def test_active_inactive_and_all_task_filters(self):
        active=self.task("ACTIVE")
        inactive=self.task("INACTIVE",is_active=False)
        for params,expected in [({},[active.pk]),({"activity":"inactive"},[inactive.pk]),({"activity":"all"},[active.pk,inactive.pk])]:
            response=self.client.get("/api/projects/tasks/",params)
            self.assertEqual(response.status_code,200,response.data)
            self.assertEqual({row["id"] for row in response.data["results"]},set(expected))
        self.assertEqual(self.client.get("/api/projects/tasks/",{"activity":"invalid"}).status_code,400)

    def test_inactive_tasks_remain_readable_and_mutations_are_blocked(self):
        task=self.task(is_active=False,primary_assignee=self.a)
        path=f"/api/projects/tasks/{task.pk}/"
        self.assertEqual(self.client.get(path).status_code,200)
        for suffix in ["updates/","follow-ups/","comments/","attachments/","checklist/","structure/"]:
            response=self.client.get(path+suffix,{"page_size":10,"kind":"subtasks"})
            self.assertEqual(response.status_code,200,(suffix,response.data))
        for suffix,payload in [("assign/",{"primary_assignee":self.b.pk}),("comments/",{"body":"No change"}),("updates/",{"update_description":"No change"}),("checklist/",{"title":"No change"}),("follow-ups/",{"follow_up_date":"2026-11-01"}),("structure/",{"action":"subtask","title":"No change"}),("collaborators/",{"user_ids":[self.b.pk]})]:
            response=self.client.post(path+suffix,payload,format="json")
            self.assertEqual(response.status_code,400,(suffix,response.data))
        response=self.client.patch(path,{"title":"No change","is_active":True},format="json")
        self.assertEqual(response.status_code,400)
        task.refresh_from_db();self.assertFalse(task.is_active);self.assertEqual(task.primary_assignee_id,self.a.pk)
        other=self.task("ACTIVE-LINK")
        response=self.client.post(f"/api/projects/tasks/{other.pk}/structure/",{"action":"dependency","depends_on_id":task.pk},format="json")
        self.assertEqual(response.status_code,400,response.data)
        response=self.client.patch(f"/api/projects/tasks/{other.pk}/",{"parent_task":task.pk},format="json")
        self.assertEqual(response.status_code,400,response.data)

    def test_deactivation_permission_and_tenant_scope_are_enforced(self):
        task=self.task(primary_assignee=self.a)
        role=Group.objects.create(name=f"tenant:{self.tenant.pk}:Task activation editor")
        role.permissions.set(Permission.objects.filter(content_type__app_label="SL_Projects",codename__in=["view_own_projecttask","change_projecttask"]))
        self.a.groups.add(role)
        membership=OrganizationMembership.objects.get(user=self.a);membership.active_role_group_name=role.name;membership.save()
        self.client.force_authenticate(self.a)
        path=f"/api/projects/tasks/{task.pk}/activation/"
        self.assertEqual(self.client.post(path,{"is_active":False},format="json").status_code,403)
        role.permissions.add(Permission.objects.get(content_type__app_label="SL_Projects",codename="deactivate_projecttask"))
        self.assertEqual(self.client.post(path,{"is_active":False},format="json").status_code,200)
        OrganizationMembership.objects.filter(user=self.foreign_user).update(is_org_admin=True)
        self.client.force_authenticate(self.foreign_user)
        self.assertEqual(self.client.post(path,{"is_active":True},format="json").status_code,404)

    def test_pending_approval_must_finish_before_task_deactivation(self):
        from Platform_Core.models import WorkflowInboxItem
        task=self.task(status="in_review")
        workflow,_=self.task_workflow()
        WorkflowInboxItem.objects.create(tenant=self.tenant,workflow=workflow,module_slug="projects-tasks",entity_type="project_task",entity_id=task.pk,title="Pending approval")
        response=self.client.post(f"/api/projects/tasks/{task.pk}/activation/",{"is_active":False},format="json")
        self.assertEqual(response.status_code,400,response.data)
        task.refresh_from_db();self.assertTrue(task.is_active)

    def test_deactivated_tasks_are_excluded_from_reminders_dashboard_and_alerts(self):
        from SL_Projects.models import TaskFollowUp
        from SL_Projects.reminders import run_project_reminders
        from Platform_Core.models import SystemNotification
        active=self.task("ACTIVE-DUE",due_date=date(2026,1,1),primary_assignee=self.a)
        inactive=self.task("INACTIVE-DUE",due_date=date(2026,1,1),primary_assignee=self.a,is_active=False)
        reminder=TaskFollowUp.objects.create(task=inactive,owner=self.a,follow_up_date=date(2026,1,1))
        run_project_reminders(as_of=date(2026,11,1))
        self.assertTrue(SystemNotification.objects.filter(source_type="project_task_overdue",source_id=active.pk).exists())
        self.assertFalse(SystemNotification.objects.filter(source_type="project_task_overdue",source_id=inactive.pk).exists())
        self.assertFalse(SystemNotification.objects.filter(source_type="project_task_follow_up_due",source_id=reminder.pk).exists())
        response=self.client.get("/api/projects/dashboard/")
        self.assertEqual(response.status_code,200,response.data)
        self.assertEqual(response.data["counts"]["open_tasks"],1)

    def test_saved_assignment_survives_get_and_unrelated_edits(self):
        task=self.task(primary_assignee=self.a)
        path=f"/api/projects/tasks/{task.pk}/"
        response=self.client.post(path+"assign/",{"primary_assignee":self.b.pk},format="json")
        self.assertEqual(response.status_code,200,response.data);self.assertEqual(response.data["primary_assignee"],self.b.pk)
        for attempt in range(2):
            response=self.client.get(path)
            self.assertEqual(response.data["primary_assignee"],self.b.pk)
            self.assertEqual(response.data["assignee_name"],self.b.username)
        response=self.client.patch(path,{"title":"Planning edit","primary_assignee":self.b.pk},format="json")
        self.assertEqual(response.status_code,200,response.data)
        task.refresh_from_db();self.assertEqual(task.primary_assignee_id,self.b.pk)

    def test_empty_assignment_is_rejected_and_explicit_unassigned_is_supported(self):
        task=self.task(primary_assignee=self.a)
        path=f"/api/projects/tasks/{task.pk}/assign/"
        for payload in [{},{"primary_assignee":""}]:
            response=self.client.post(path,payload,format="json")
            self.assertEqual(response.status_code,400,response.data)
            task.refresh_from_db();self.assertEqual(task.primary_assignee_id,self.a.pk)
        response=self.client.post(path,{"primary_assignee":None},format="json")
        self.assertEqual(response.status_code,200,response.data)
        task.refresh_from_db();self.assertIsNone(task.primary_assignee_id)

    def test_existing_assignee_remains_visible_if_their_membership_is_deactivated(self):
        task=self.task(primary_assignee=self.a)
        OrganizationMembership.objects.filter(user=self.a).update(is_active=False)
        path=f"/api/projects/tasks/{task.pk}/"
        self.assertNotIn(self.a.pk,{row["id"] for row in self.client.get(path+"assignees/").data})
        self.assertEqual(self.client.get(path).data["assignee_name"],self.a.username)
        response=self.client.patch(path,{"title":"Keep saved assignee","primary_assignee":self.a.pk},format="json")
        self.assertEqual(response.status_code,200,response.data)
        task.refresh_from_db();self.assertEqual(task.primary_assignee_id,self.a.pk)

    def test_deactivation_permission_migration_preserves_previous_delete_capability(self):
        import importlib
        from types import SimpleNamespace
        from django.apps import apps
        from django.db import connection
        role=Group.objects.create(name="Old task deletion role")
        old=Permission.objects.get(content_type__app_label="SL_Projects",codename="delete_projecttask")
        role.permissions.add(old)
        self.a.user_permissions.add(old)
        migration=importlib.import_module("SL_Projects.migrations.0013_grant_task_deactivation")
        migration.grant_deactivation(apps,SimpleNamespace(connection=connection))
        migration.grant_deactivation(apps,SimpleNamespace(connection=connection))
        self.assertTrue(role.permissions.filter(codename="deactivate_projecttask").exists())
        self.assertTrue(self.a.user_permissions.filter(codename="deactivate_projecttask").exists())
