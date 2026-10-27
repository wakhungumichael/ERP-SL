from datetime import timedelta
from io import StringIO
from unittest.mock import patch

from django.contrib.auth.models import Group, Permission, User
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from Platform_Core.models import OrganizationMembership, Tenant, TenantBranch, TenantSettings
from SL_Projects.models import ProjectTask, TaskChecklistItem, TaskCollaborator, TaskFollowUp


class ProjectWorkspaceTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name='Workspace One', code='project-access', is_active=True)
        self.branch = TenantBranch.objects.create(tenant=self.tenant, name='Main')
        self.other_branch = TenantBranch.objects.create(tenant=self.tenant, name='Restricted')
        self.foreign_tenant = Tenant.objects.create(name='Other', code='project-foreign')
        self.foreign_branch = TenantBranch.objects.create(tenant=self.foreign_tenant, name='Other')
        self.user = User.objects.create_user('task-worker')
        self.other = User.objects.create_user('task-other')
        self.role = Group.objects.create(name=f'tenant:{self.tenant.pk}:Task team')
        self.manager = Group.objects.create(name=f'tenant:{self.tenant.pk}:Project manager')
        for group, names in [(self.role, ['view_own_projecttask', 'add_taskfollowup', 'export_projecttask']), (self.manager, ['view_all_projecttask', 'export_projecttask'])]:
            group.permissions.set(Permission.objects.filter(content_type__app_label='SL_Projects', codename__in=names))
        self.user.groups.add(self.role, self.manager)
        self.membership = OrganizationMembership.objects.create(user=self.user, tenant=self.tenant, branch=self.branch, is_default=True, active_role_group_name=self.role.name)
        OrganizationMembership.objects.create(user=self.other, tenant=self.tenant, branch=self.branch)
        self.own = self.task('own', primary_assignee=self.user)
        self.team = self.task('team', assigned_role=self.role)
        self.collab = self.task('collab')
        TaskCollaborator.objects.create(task=self.collab, user=self.user)
        TaskCollaborator.objects.create(task=self.collab, user=self.other)
        self.hidden = self.task('hidden', primary_assignee=self.other)
        self.task('other-branch', branch=self.other_branch, primary_assignee=self.user)
        self.task('other-tenant', tenant=self.foreign_tenant, branch=self.foreign_branch, primary_assignee=self.user)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.activation = patch('Platform_API.modules.projects.views.get_active_tenant_module_slugs', return_value={'projects-tasks'})
        self.activation.start()
        self.addCleanup(self.activation.stop)

    def task(self, number, **kwargs):
        return ProjectTask.objects.create(**dict(tenant=self.tenant, branch=self.branch, number=number, title=number, status='todo', due_date=timezone.localdate()-timedelta(days=1)) | kwargs)

    def test_own_role_scopes_lists_dashboard_reports_calendar_and_details(self):
        for scope in ['', '?scope=mine']:
            response = self.client.get('/api/projects/tasks/' + scope)
            self.assertEqual(response.status_code, 200)
            self.assertEqual({r['id'] for r in response.data['results']}, {self.own.pk, self.team.pk, self.collab.pk})
        self.assertEqual(self.client.get(f'/api/projects/tasks/{self.hidden.pk}/').status_code, 404)
        dashboard = self.client.get('/api/projects/dashboard/').data
        self.assertEqual(dashboard['counts']['my_tasks'], 3)
        self.assertEqual(sum(r['count'] for r in dashboard['tasks_by_status']), 3)
        reports = self.client.get('/api/projects/reports/').data
        self.assertEqual(reports['count'], 3)
        self.assertEqual(reports['summary']['open_tasks'], 3)
        calendar = self.client.get('/api/projects/calendar/?start=2026-01-01&end=2027-12-31')
        self.assertEqual(calendar.status_code, 200)
        self.assertNotIn('hidden', str(calendar.data))
        alerts = self.client.get('/api/projects/task-alerts/').data
        self.assertEqual(alerts['count'], 3)

    def test_selected_view_all_role_sees_branch_tasks_and_mine_stays_personal(self):
        self.membership.active_role_group_name = self.manager.name
        self.membership.save()
        response = self.client.get('/api/projects/tasks/?page_size=2')
        self.assertEqual(response.data['count'], 4)
        self.assertEqual(len(response.data['results']), 2)
        self.assertTrue(response.data['access']['view_all_tasks'])
        mine = self.client.get('/api/projects/tasks/?scope=mine').data
        self.assertEqual({r['id'] for r in mine['results']}, {self.own.pk, self.collab.pk})

    def test_followups_can_be_created_only_for_visible_tasks(self):
        payload = dict(task=self.own.pk, follow_up_date=str(timezone.localdate()), notes='Call customer')
        self.assertEqual(self.client.post('/api/projects/follow-ups/', payload).status_code, 201)
        payload['task'] = self.hidden.pk
        self.assertEqual(self.client.post('/api/projects/follow-ups/', payload).status_code, 404)
        self.assertEqual(TaskFollowUp.objects.count(), 1)

    def test_exports_use_same_scope_filters_and_tenant_branding(self):
        TenantSettings.objects.create(tenant=self.tenant, primary_color='#121212')
        csv = self.client.get('/api/projects/reports/?download=csv&search=own')
        self.assertEqual(csv.status_code, 200)
        self.assertIn(b'own', csv.content)
        self.assertNotIn(b'hidden', csv.content)
        pdf = self.client.get('/api/projects/reports/?download=pdf&search=own')
        self.assertEqual(pdf.status_code, 200)
        self.assertTrue(pdf.content.startswith(b'%PDF'))
        from SL_Projects.reporting import report_document
        from rest_framework.request import Request
        from rest_framework.test import APIRequestFactory
        html = report_document(self.tenant, 'tasks', ['Task'], [['own']], Request(APIRequestFactory().get('/'))).html
        self.assertIn('#121212', html)
        self.assertIn('Workspace One', html)

    def test_export_requires_permission_even_with_own_access(self):
        self.role.permissions.remove(Permission.objects.get(content_type__app_label='SL_Projects', codename='export_projecttask'))
        self.assertEqual(self.client.get('/api/projects/reports/?download=csv').status_code, 403)

    def test_multiple_accountable_and_supporting_participants_are_scoped(self):
        self.role.permissions.add(Permission.objects.get(content_type__app_label='SL_Projects', codename='assign_projecttask'))
        third = User.objects.create_user('task-third')
        OrganizationMembership.objects.create(user=third, tenant=self.tenant, branch=self.branch)
        response = self.client.post(
            f'/api/projects/tasks/{self.own.pk}/collaborators/',
            {'user_ids': [self.other.pk, third.pk], 'participation_role': 'accountable'},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            set(self.own.collaborators.filter(participation_role='accountable').values_list('user_id', flat=True)),
            {self.other.pk, third.pk},
        )

    def test_checklist_completion_derives_progress_and_updates_do_not_accept_percent(self):
        self.role.permissions.add(Permission.objects.get(content_type__app_label='SL_Projects', codename='update_projecttask_progress'))
        created = self.client.post(f'/api/projects/tasks/{self.own.pk}/checklist/', {'title': 'Signed acceptance'}, format='json')
        second = self.client.post(f'/api/projects/tasks/{self.own.pk}/checklist/', {'title': 'Delivery evidence'}, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        completed = self.client.patch(
            f'/api/projects/tasks/{self.own.pk}/checklist/{created.data["id"]}/',
            {'is_completed': True}, format='json',
        )
        self.assertEqual(completed.status_code, 200, completed.data)
        self.own.refresh_from_db()
        self.assertEqual(self.own.progress_percentage, 50)
        update = self.client.post(
            f'/api/projects/tasks/{self.own.pk}/updates/',
            {'progress_percentage': 99, 'update_description': 'Work evidence recorded', 'time_spent_hours': 1},
            format='json',
        )
        self.assertEqual(update.status_code, 201, update.data)
        self.assertEqual(update.data['progress_percentage'], 50)
        self.assertTrue(TaskChecklistItem.objects.filter(pk=second.data['id']).exists())


class SampleProjectTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name='Sample org', code='sample-org', is_active=True)
        self.branch = TenantBranch.objects.create(tenant=self.tenant, name='Main')
        self.user = User.objects.create_user('sample-member')
        OrganizationMembership.objects.create(tenant=self.tenant, user=self.user, branch=self.branch, is_default=True)

    def seed(self, **kwargs):
        call_command('seed_project_samples', all_active_tenants=True, stdout=StringIO(), **kwargs)

    def test_samples_are_repeatable_and_can_be_removed_without_real_work(self):
        real = ProjectTask.objects.create(tenant=self.tenant, branch=self.branch, number='REAL-1', title='Real work')
        self.seed()
        self.seed()
        self.assertEqual(ProjectTask.objects.count(), 4)
        self.seed(clear=True)
        self.assertEqual(list(ProjectTask.objects.values_list('pk', flat=True)), [real.pk])

    def test_cleanup_refuses_real_activity_attached_to_samples(self):
        self.seed()
        task = ProjectTask.objects.first()
        TaskFollowUp.objects.create(task=task, owner=self.user, follow_up_date=timezone.localdate(), notes='Real follow up')
        with self.assertRaises(CommandError):
            self.seed(clear=True)
        self.assertEqual(ProjectTask.objects.count(), 3)

    def test_unscoped_members_and_organizations_without_branches_receive_samples(self):
        other = Tenant.objects.create(name='New org', code='new-sample-org', is_active=True)
        OrganizationMembership.objects.create(tenant=other, user=self.user)
        self.seed()
        self.assertEqual(ProjectTask.objects.filter(tenant=other, primary_assignee=self.user).count(), 3)
        self.assertTrue(other.branches.filter(name='[SAMPLE] Demo workspace').exists())
        self.seed(clear=True)
        self.assertFalse(other.branches.exists())

    def test_sample_cleanup_endpoint_requires_admin_and_is_tenant_scoped(self):
        self.seed()
        client = APIClient()
        client.force_authenticate(self.user)
        with patch('Platform_API.modules.projects.views.get_active_tenant_module_slugs', return_value={'projects-tasks'}):
            self.assertEqual(client.delete('/api/projects/sample-data/').status_code, 403)
            membership = OrganizationMembership.objects.get(tenant=self.tenant, user=self.user)
            membership.is_org_admin = True
            membership.save()
            self.assertEqual(client.delete('/api/projects/sample-data/').status_code, 200)
        self.assertFalse(ProjectTask.objects.filter(tenant=self.tenant).exists())
