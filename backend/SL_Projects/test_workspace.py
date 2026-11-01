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
from SL_Projects.models import Project, ProjectMember, ProjectMilestone, ProjectTask, TaskChecklistItem, TaskCollaborator, TaskFollowUp


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
        for group, names in [(self.role, ['view_own_projecttask', 'view_project_dashboard', 'add_taskfollowup', 'export_projecttask']), (self.manager, ['view_all_projecttask', 'export_projecttask'])]:
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

    def test_project_team_shows_new_drafts_without_legacy_role_assignment(self):
        self.membership.active_role_group_name = self.manager.name
        self.membership.save(update_fields=['active_role_group_name'])
        self.manager.permissions.add(Permission.objects.get(
            content_type__app_label='SL_Projects', codename='add_projecttask',
        ))
        created = self.client.post('/api/projects/tasks/', {
            'title': 'New project team work', 'project': self.own.project_id,
            'primary_assignee': None,
        }, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        saved = ProjectTask.objects.get(pk=created.data['id'])
        self.assertIsNone(saved.assigned_role_id)
        self.assertIsNone(saved.primary_assignee_id)
        team = self.client.get('/api/projects/tasks/?scope=team&ordering=-created_at&page_size=100')
        self.assertEqual(team.status_code, 200, team.data)
        self.assertEqual(team.data['results'][0]['id'], saved.pk)
        self.assertEqual({row['id'] for row in team.data['results']}, {
            saved.pk, self.own.pk, self.team.pk, self.collab.pk, self.hidden.pk,
        })
        filtered = self.client.get('/api/projects/tasks/?scope=team&status=draft&search=New%20project%20team')
        self.assertEqual([row['id'] for row in filtered.data['results']], [saved.pk])

    def test_project_team_uses_project_membership_without_expanding_access(self):
        self.use_project_view_role()
        project = self.joined_project()
        unrelated = Project.objects.create(tenant=self.tenant, branch=self.branch, code='TEAM-OTHER', name='Other team')
        outsider = self.task('other-project-team', project=unrelated, primary_assignee=self.other)
        self.task('project-team-other-branch', project=project, branch=self.other_branch)
        response = self.client.get('/api/projects/tasks/?scope=team&page_size=100')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data['access']['view_all_tasks'])
        self.assertEqual({row['id'] for row in response.data['results']}, {
            self.own.pk, self.collab.pk, self.hidden.pk,
        })
        self.assertNotIn(outsider.pk, {row['id'] for row in response.data['results']})

    def use_project_view_role(self):
        standard = Group.objects.create(name=f'tenant:{self.tenant.pk}:Standard task viewer')
        standard.permissions.set(Permission.objects.filter(
            content_type__app_label='SL_Projects',
            codename__in=['view_projecttask', 'add_project'],
        ))
        self.user.groups.add(standard)
        self.membership.active_role_group_name = standard.name
        self.membership.save(update_fields=['active_role_group_name'])

    def joined_project(self):
        project = Project.objects.create(tenant=self.tenant, branch=self.branch, code='JOINED', name='Joined project')
        ProjectMember.objects.create(project=project, user=self.user, branch=self.branch)
        self.hidden.project = project
        self.hidden.save(update_fields=['project'])
        return project

    def test_standard_view_sees_joined_projects_and_assigned_work(self):
        self.use_project_view_role()
        project = self.joined_project()
        unrelated = Project.objects.create(tenant=self.tenant, branch=self.branch, code='OTHER', name='Unrelated project')
        outsider = self.task('outsider', project=unrelated, primary_assignee=self.other)
        # Membership in a project never removes active branch or tenant boundaries.
        self.task('joined-other-branch', project=project, branch=self.other_branch, primary_assignee=self.other)

        tasks = self.client.get('/api/projects/tasks/?page_size=100')
        self.assertEqual(tasks.status_code, 200, tasks.data)
        self.assertFalse(tasks.data['access']['view_all_tasks'])
        self.assertEqual({row['id'] for row in tasks.data['results']}, {
            self.own.pk, self.collab.pk, self.hidden.pk,
        })
        self.assertEqual(self.client.get(f'/api/projects/tasks/{self.hidden.pk}/').status_code, 200)
        self.assertEqual(self.client.get(f'/api/projects/tasks/{outsider.pk}/').status_code, 404)
        mine = self.client.get('/api/projects/tasks/?scope=mine').data
        self.assertEqual({row['id'] for row in mine['results']}, {self.own.pk, self.collab.pk})
        self.assertEqual(self.client.get('/api/projects/projects/').status_code, 403)
        self.assertEqual(self.client.get(f'/api/projects/projects/{project.pk}/').status_code, 403)
        standard = self.user.groups.get(name=self.membership.active_role_group_name)
        standard.permissions.add(Permission.objects.get(content_type__app_label='SL_Projects', codename='view_project'))
        projects = self.client.get('/api/projects/projects/')
        self.assertEqual(projects.status_code, 200, projects.data)
        self.assertTrue(projects.data['access']['can_create'])
        self.assertNotIn(unrelated.pk, {row['id'] for row in projects.data['results']})

        ProjectMember.objects.filter(project=project, user=self.user).delete()
        self.assertEqual(self.client.get(f'/api/projects/tasks/{self.hidden.pk}/').status_code, 404)

    def test_project_owner_and_manager_can_view_project_tasks_with_standard_view(self):
        self.use_project_view_role()
        for relation in ['owner', 'manager']:
            with self.subTest(relation=relation):
                project = Project.objects.create(tenant=self.tenant, branch=self.branch, code=relation, name=relation, **{relation: self.user})
                task = self.task(relation, project=project, primary_assignee=self.other)
                self.assertEqual(self.client.get(f'/api/projects/tasks/{task.pk}/').status_code, 200)
                mine = self.client.get('/api/projects/tasks/?scope=mine').data
                self.assertNotIn(task.pk, {row['id'] for row in mine['results']})

    def test_assigned_only_permission_does_not_grant_project_teammate_tasks(self):
        self.joined_project()
        tasks = self.client.get('/api/projects/tasks/').data
        self.assertEqual({row['id'] for row in tasks['results']}, {self.own.pk, self.team.pk, self.collab.pk})
        self.assertEqual(self.client.get(f'/api/projects/tasks/{self.hidden.pk}/').status_code, 404)

    def test_task_permissions_do_not_grant_project_pages_or_dashboard(self):
        self.use_project_view_role()
        project = self.joined_project()
        from SL_Projects.models import ProjectMilestone
        milestone = ProjectMilestone.objects.create(project=project, name="Select this", description="Private project information")
        for path in ['/api/projects/projects/', f'/api/projects/projects/{project.pk}/', '/api/projects/dashboard/', f'/api/projects/projects/{project.pk}/milestones/', f'/api/projects/projects/{project.pk}/members/', f'/api/projects/projects/{project.pk}/documents/']:
            self.assertEqual(self.client.get(path).status_code, 403, path)
        self.assertEqual(self.client.get('/api/projects/tasks/').status_code, 200)
        options = self.client.get('/api/projects/project-options/').data['results']
        self.assertIn(project.pk, {row['id'] for row in options})
        self.assertNotIn('estimated_budget', options[0])
        options = self.client.get(f'/api/projects/project-options/{project.pk}/milestones/')
        self.assertEqual(options.status_code, 200)
        self.assertEqual(options.data, [{'id': milestone.pk, 'name': milestone.name, 'status': milestone.status}])
        inaccessible = Project.objects.create(tenant=self.tenant, branch=self.branch, code='NOACCESS', name='Other')
        self.assertEqual(self.client.get(f'/api/projects/project-options/{inaccessible.pk}/milestones/').status_code, 404)

    def test_project_and_dashboard_permissions_are_independent_of_tasks(self):
        self.use_project_view_role()
        project = self.joined_project()
        group = self.user.groups.get(name=self.membership.active_role_group_name)
        group.permissions.set(Permission.objects.filter(content_type__app_label='SL_Projects', codename='view_project'))
        self.assertEqual(self.client.get('/api/projects/projects/').status_code, 200)
        self.assertEqual(self.client.get(f'/api/projects/projects/{project.pk}/').status_code, 200)
        self.assertEqual(self.client.get('/api/projects/tasks/').status_code, 403)
        self.assertEqual(self.client.get('/api/projects/dashboard/').status_code, 403)
        group.permissions.add(Permission.objects.get(content_type__app_label='SL_Projects', codename='view_project_dashboard'))
        self.assertEqual(self.client.get('/api/projects/dashboard/').status_code, 200)

    def test_calendar_project_events_require_project_view_and_stay_scoped(self):
        self.use_project_view_role()
        joined = self.joined_project()
        today = timezone.localdate()
        included = ProjectMilestone.objects.create(project=joined, name='Allowed project event', due_date=today, owner=self.user)
        unrelated = Project.objects.create(tenant=self.tenant, branch=self.branch, code='CAL-OTHER', name='Unrelated')
        excluded = ProjectMilestone.objects.create(project=unrelated, name='Unrelated project event', due_date=today)
        other_branch = Project.objects.create(tenant=self.tenant, branch=self.other_branch, code='CAL-BRANCH', name='Other branch')
        ProjectMember.objects.create(project=other_branch, user=self.user, branch=self.other_branch)
        ProjectMilestone.objects.create(project=other_branch, name='Other branch event', due_date=today)
        foreign = Project.objects.create(tenant=self.foreign_tenant, branch=self.foreign_branch, code='CAL-FOREIGN', name='Other organization')
        ProjectMilestone.objects.create(project=foreign, name='Foreign event', due_date=today)
        followup = TaskFollowUp.objects.create(task=self.own, owner=self.user, follow_up_date=today, notes='Assigned follow-up')
        path = '/api/projects/calendar/'
        params = {'start': str(today - timedelta(days=7)), 'end': str(today + timedelta(days=7))}
        response = self.client.get(path, params)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(any(event['kind'] == 'milestone' for event in response.data))
        self.assertEqual({event['id'] for event in response.data if event['kind'] == 'task'}, {self.own.pk, self.collab.pk, self.hidden.pk})
        self.assertIn(followup.pk, {event['id'] for event in response.data if event['kind'] == 'follow_up'})
        self.assertFalse(any(event['url'] == f'/projects/{joined.pk}' for event in response.data))
        standard = self.user.groups.get(name=self.membership.active_role_group_name)
        view = Permission.objects.get(content_type__app_label='SL_Projects', codename='view_project')
        # A second assigned role cannot lend Project View to the selected role.
        self.manager.permissions.add(view)
        response = self.client.get(path, params)
        self.assertFalse(any(event['kind'] == 'milestone' for event in response.data))
        standard.permissions.add(view)
        response = self.client.get(path, params)
        self.assertEqual({event['id'] for event in response.data if event['kind'] == 'milestone'}, {included.pk})
        filtered = self.client.get(path, {**params, 'project': joined.pk, 'assignee': 'mine'})
        self.assertEqual({event['id'] for event in filtered.data if event['kind'] == 'milestone'}, {included.pk})
        self.assertEqual({event['id'] for event in filtered.data if event['kind'] == 'task'}, set())
        self.assertEqual(self.client.get(path, {**params, 'project': unrelated.pk}).status_code, 400)
        self.membership.active_role_group_name = self.manager.name
        self.membership.save(update_fields=['active_role_group_name'])
        response = self.client.get(path, params)
        self.assertEqual({event['id'] for event in response.data if event['kind'] == 'milestone'}, {included.pk, excluded.pk})
        self.manager.permissions.remove(view)
        response = self.client.get(path, params)
        self.assertFalse(any(event['kind'] == 'milestone' for event in response.data))

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
        self.assertEqual(ProjectTask.objects.filter(tenant=self.tenant).count(), 3)
        self.assertFalse(ProjectTask.objects.filter(tenant=self.tenant, is_active=True).exists())
