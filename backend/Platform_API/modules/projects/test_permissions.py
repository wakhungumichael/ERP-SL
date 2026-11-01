from unittest.mock import patch
from django.contrib.auth.models import Group, Permission, User
from django.test import TestCase
from rest_framework.test import APIClient
from Platform_Core.models import OrganizationMembership, Tenant, TenantBranch
from SL_Projects.models import Project, ProjectMember, ProjectMilestone, ProjectTask


class ProjectActionPermissionTests(TestCase):
    def setUp(self):
        self.tenant=Tenant.objects.create(name='Rights',code='project-rights',is_active=True)
        self.branch=TenantBranch.objects.create(tenant=self.tenant,name='Main')
        self.worker=User.objects.create_user('project-rights-user')
        self.other=User.objects.create_user('project-rights-other')
        self.role=Group.objects.create(name=f'tenant:{self.tenant.pk}:Project viewer')
        self.worker.groups.add(self.role)
        self.membership=OrganizationMembership.objects.create(tenant=self.tenant,user=self.worker,branch=self.branch,is_default=True,active_role_group_name=self.role.name)
        OrganizationMembership.objects.create(tenant=self.tenant,user=self.other,branch=self.branch)
        self.project=Project.objects.create(tenant=self.tenant,branch=self.branch,name='Work',code='RIGHTS',manager=self.other)
        ProjectMember.objects.create(project=self.project,user=self.worker,branch=self.branch,responsibility='viewer')
        self.task=ProjectTask.objects.create(tenant=self.tenant,branch=self.branch,project=self.project,number='RIGHTS-1',title='Work')
        self.grant('view_project','view_projecttask')
        self.client=APIClient();self.client.force_authenticate(self.worker)
        activation=patch('Platform_API.modules.projects.views.get_active_tenant_module_slugs',return_value={'projects-tasks'})
        activation.start();self.addCleanup(activation.stop)
    def grant(self,*codes):
        self.role.permissions.add(*Permission.objects.filter(content_type__app_label='SL_Projects',codename__in=codes))
    def test_viewer_sees_no_mutation_rights_and_cannot_change_records(self):
        task=self.client.get(f'/api/projects/tasks/{self.task.pk}/')
        self.assertEqual(task.status_code,200,task.data)
        self.assertFalse(any(task.data['access'].values()))
        project=self.client.get(f'/api/projects/projects/{self.project.pk}/')
        self.assertFalse(any(project.data['access'].values()))
        for path in [f'/api/projects/tasks/{self.task.pk}/',f'/api/projects/projects/{self.project.pk}/']:
            self.assertEqual(self.client.patch(path,{'title':'Changed','name':'Changed'},format='json').status_code,403)
        self.assertEqual(self.client.post(f'/api/projects/tasks/{self.task.pk}/activation/',{'is_active':False},format='json').status_code,403)
    def test_change_permission_does_not_grant_assignment_or_subtask_creation(self):
        self.grant('change_projecttask','change_project')
        self.assertEqual(self.client.patch(f'/api/projects/tasks/{self.task.pk}/',{'primary_assignee':self.other.pk},format='json').status_code,403)
        self.assertEqual(self.client.patch(f'/api/projects/projects/{self.project.pk}/',{'manager':self.worker.pk},format='json').status_code,403)
        self.assertEqual(self.client.post(f'/api/projects/tasks/{self.task.pk}/structure/',{'action':'subtask','title':'Hidden create'},format='json').status_code,403)
        response=self.client.patch(f'/api/projects/tasks/{self.task.pk}/',{'title':'Allowed edit','progress_percentage':90,'actual_hours':99,'assigned_role':self.role.pk},format='json')
        self.assertEqual(response.status_code,200,response.data)
        self.task.refresh_from_db();self.assertEqual(self.task.title,'Allowed edit');self.assertEqual(self.task.progress_percentage,0);self.assertIsNone(self.task.assigned_role_id)
    def test_create_task_with_assignee_requires_assignment_permission(self):
        self.grant('add_projecttask')
        result=self.client.post('/api/projects/tasks/',{'project':self.project.pk,'title':'Assigned','primary_assignee':self.worker.pk},format='json')
        self.assertEqual(result.status_code,403,result.data)
        self.grant('assign_projecttask')
        result=self.client.post('/api/projects/tasks/',{'project':self.project.pk,'title':'Assigned','primary_assignee':self.worker.pk},format='json')
        self.assertEqual(result.status_code,201,result.data)
    def test_milestone_permissions_are_independent_of_project_edit(self):
        self.grant('change_project')
        path=f'/api/projects/projects/{self.project.pk}/milestones/'
        self.assertEqual(self.client.post(path,{'name':'Draft'},format='json').status_code,403)
        self.grant('add_projectmilestone')
        created=self.client.post(path,{'name':'Draft'},format='json')
        self.assertEqual(created.status_code,201,created.data)
        complete=path+str(created.data['id'])+'/complete/'
        self.assertEqual(self.client.post(complete,{},format='json').status_code,403)
        self.grant('change_projectmilestone')
        self.assertEqual(self.client.post(complete,{},format='json').status_code,200)
    def test_team_permission_does_not_grant_owner_or_manager_assignment(self):
        self.grant('manage_project_members')
        path=f'/api/projects/projects/{self.project.pk}/members/'
        response=self.client.post(path,{'user':self.worker.pk,'branch':self.branch.pk,'responsibility':'owner'},format='json')
        self.assertEqual(response.status_code,403,response.data)
        member=ProjectMember.objects.create(project=self.project,user=self.other,branch=self.branch,responsibility='manager')
        self.assertEqual(self.client.delete(path+str(member.pk)+'/').status_code,403)
    def test_delete_permission_does_not_allow_task_deactivation_or_hard_delete(self):
        self.grant('delete_projecttask')
        self.assertEqual(self.client.delete(f'/api/projects/tasks/{self.task.pk}/').status_code,405)
        self.assertEqual(self.client.post(f'/api/projects/tasks/{self.task.pk}/activation/',{'is_active':False},format='json').status_code,403)
        self.grant('deactivate_projecttask')
        result=self.client.post(f'/api/projects/tasks/{self.task.pk}/activation/',{'is_active':False},format='json')
        self.assertEqual(result.status_code,200,result.data)
        self.task.refresh_from_db();self.assertFalse(self.task.is_active)
        self.assertTrue(ProjectTask.objects.filter(pk=self.task.pk).exists())
    def test_project_with_history_is_retained(self):
        self.grant('delete_project')
        result=self.client.delete(f'/api/projects/projects/{self.project.pk}/')
        self.assertEqual(result.status_code,400,result.data)
        self.assertTrue(Project.objects.filter(pk=self.project.pk).exists())
