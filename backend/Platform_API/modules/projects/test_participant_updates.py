from datetime import date
from tempfile import TemporaryDirectory
from unittest.mock import patch
from django.contrib.auth.models import Group, Permission, User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from Platform_Core.models import OrganizationMembership, Tenant, TenantBranch, WorkflowDefinition, WorkflowEntityBinding, WorkflowNodeDefinition
from SL_Projects.models import Project, ProjectMember, ProjectTask, TaskCollaborator, TaskChecklistItem


class TaskParticipantUpdateTests(TestCase):
    def setUp(self):
        self.tenant=Tenant.objects.create(name='Participant rights',code='participant-rights',is_active=True)
        self.branch=TenantBranch.objects.create(tenant=self.tenant,name='Main')
        self.admin=User.objects.create_user('participant-admin')
        OrganizationMembership.objects.create(user=self.admin,tenant=self.tenant,branch=self.branch,is_default=True,is_org_admin=True)
        self.role=Group.objects.create(name=f'tenant:{self.tenant.pk}:Task reader')
        self.role.permissions.add(Permission.objects.get(content_type__app_label='SL_Projects',codename='view_own_projecttask'))
        self.users={}
        for name in ['lead','accountable','supporting','unassigned']:
            user=User.objects.create_user('participant-'+name)
            user.groups.add(self.role)
            OrganizationMembership.objects.create(user=user,tenant=self.tenant,branch=self.branch,is_default=True,active_role_group_name=self.role.name)
            self.users[name]=user
        self.project=Project.objects.create(tenant=self.tenant,branch=self.branch,name='Delivery',code='PARTICIPANTS',created_by=self.admin)
        self.other_project=Project.objects.create(tenant=self.tenant,branch=self.branch,name='Other',code='OTHER',created_by=self.admin)
        for user in self.users.values():ProjectMember.objects.create(project=self.project,user=user,branch=self.branch,responsibility='contributor')
        self.task=ProjectTask.objects.create(tenant=self.tenant,branch=self.branch,project=self.project,title='Assigned work',number='PART-1',created_by=self.admin,primary_assignee=self.users['lead'])
        TaskCollaborator.objects.create(task=self.task,user=self.users['accountable'],participation_role='accountable')
        TaskCollaborator.objects.create(task=self.task,user=self.users['supporting'],participation_role='supporting')
        self.path=f'/api/projects/tasks/{self.task.pk}/'
        self.client=APIClient()
        activation=patch('Platform_API.modules.projects.views.get_active_tenant_module_slugs',return_value={'projects-tasks'})
        activation.start();self.addCleanup(activation.stop)
        media=TemporaryDirectory();self.addCleanup(media.cleanup)
        setting=override_settings(MEDIA_ROOT=media.name);setting.enable();self.addCleanup(setting.disable)
    def login(self,name):
        self.client.force_authenticate(self.users[name])
    def test_all_named_participants_get_work_rights_and_can_change_status(self):
        for name in ['lead','accountable','supporting']:
            with self.subTest(person=name):
                self.login(name)
                response=self.client.get(self.path)
                self.assertEqual(response.status_code,200,response.data)
                access=response.data['access']
                for key in ['can_edit','can_update_progress','can_add_followup','can_complete_followup','can_comment','can_attach']:self.assertTrue(access[key],key)
                for key in ['can_assign','can_deactivate','can_create_subtask','can_move_project','can_remove_attachment']:self.assertFalse(access[key],key)
                statuses={row['value']:row for row in response.data['status_options']}
                self.assertFalse(statuses['in_progress']['disabled'])
                self.assertFalse(statuses['completed']['disabled'])
                for status in ['in_progress','blocked','completed','reopened']:
                    result=self.client.patch(self.path,{'status':status},format='json')
                    self.assertEqual(result.status_code,200,result.data)
                    self.assertEqual(result.data['status'],status)
                self.assertFalse(self.users[name].groups.filter(permissions__codename='change_projecttask').exists())
    def test_all_named_participants_can_edit_work_details_and_post_activity(self):
        for index,name in enumerate(['lead','accountable','supporting']):
            with self.subTest(person=name):
                self.login(name)
                edited=self.client.patch(self.path,{'title':'Updated by '+name,'description':'Work details','project':self.project.pk,'priority':'high','estimated_hours':'2'},format='json')
                self.assertEqual(edited.status_code,200,edited.data)
                item=self.client.post(self.path+'checklist/',{'title':'Deliver '+name},format='json')
                self.assertEqual(item.status_code,201,item.data)
                checked=self.client.patch(self.path+f'checklist/{item.data["id"]}/',{'is_completed':True},format='json')
                self.assertEqual(checked.status_code,200,checked.data)
                update=self.client.post(self.path+'updates/',{'update_description':'Completed work','time_spent_hours':'1.5'},format='json')
                self.assertEqual(update.status_code,201,update.data)
                comment=self.client.post(self.path+'comments/',{'body':'Latest progress'},format='json')
                self.assertEqual(comment.status_code,201,comment.data)
                follow=self.client.post(self.path+'follow-ups/',{'follow_up_date':'2026-11-04','notes':'Review progress'},format='json')
                self.assertEqual(follow.status_code,201,follow.data)
                completed=self.client.post(self.path+f'follow-ups/{follow.data["id"]}/complete/',{},format='json')
                self.assertEqual(completed.status_code,200,completed.data)
                upload=self.client.post(self.path+'attachments/',{'file':SimpleUploadedFile('work.txt',b'work evidence',content_type='text/plain')},format='multipart')
                self.assertEqual(upload.status_code,201,upload.data)
                self.assertEqual(self.client.delete(self.path+f'attachments/{upload.data["id"]}/').status_code,403)
                self.assertEqual(self.client.delete(self.path+f'checklist/{item.data["id"]}/').status_code,403)
        self.task.refresh_from_db();self.assertEqual(float(self.task.actual_hours),4.5)
    def test_participants_cannot_move_reassign_deactivate_or_override_derived_fields(self):
        for name in ['lead','accountable','supporting']:
            with self.subTest(person=name):
                self.login(name)
                for payload in [{'project':self.other_project.pk},{'primary_assignee':self.users['unassigned'].pk},{'assigned_role':self.role.pk},{'progress_percentage':100},{'actual_hours':50},{'workflow_status':'approved'},{'metadata':{'override':True}}]:
                    response=self.client.patch(self.path,payload,format='json')
                    self.assertEqual(response.status_code,403,(payload,response.data))
                self.assertEqual(self.client.post(self.path+'assign/',{'primary_assignee':self.users['unassigned'].pk},format='json').status_code,403)
                self.assertEqual(self.client.post(self.path+'activation/',{'is_active':False},format='json').status_code,403)
                self.assertEqual(self.client.post(self.path+'structure/',{'action':'subtask','title':'Not authorized'},format='json').status_code,403)
                self.assertEqual(self.client.delete(self.path).status_code,405)
        self.task.refresh_from_db();self.assertEqual(self.task.project_id,self.project.pk);self.assertEqual(self.task.primary_assignee_id,self.users['lead'].pk);self.assertTrue(self.task.is_active)
    def test_unassigned_readers_and_role_only_assignees_cannot_update(self):
        self.role.permissions.add(Permission.objects.get(content_type__app_label='SL_Projects',codename='view_projecttask'))
        self.login('unassigned')
        response=self.client.get(self.path);self.assertEqual(response.status_code,200,response.data)
        self.assertFalse(response.data['access']['can_edit'])
        self.assertEqual(self.client.patch(self.path,{'status':'in_progress'},format='json').status_code,403)
        self.task.assigned_role=self.role;self.task.save()
        self.assertEqual(self.client.patch(self.path,{'status':'in_progress'},format='json').status_code,403)
        self.assertEqual(self.client.post(self.path+'updates/',{'update_description':'Not mine'},format='json').status_code,403)
    def test_removing_assignment_or_participation_revokes_work_rights(self):
        self.login('supporting')
        self.assertEqual(self.client.patch(self.path,{'status':'in_progress'},format='json').status_code,200)
        self.task.collaborators.filter(user=self.users['supporting']).delete()
        self.assertEqual(self.client.patch(self.path,{'status':'blocked'},format='json').status_code,404)
        self.client.force_authenticate(self.admin)
        result=self.client.post(self.path+'assign/',{'primary_assignee':self.users['unassigned'].pk},format='json')
        self.assertEqual(result.status_code,200,result.data)
        self.login('lead');self.assertEqual(self.client.patch(self.path,{'status':'blocked'},format='json').status_code,404)
    def test_assignment_does_not_override_branch_or_organization_access(self):
        self.login('lead')
        membership=OrganizationMembership.objects.get(user=self.users['lead'],tenant=self.tenant)
        membership.branch=None;membership.save()
        self.assertEqual(self.client.patch(self.path,{'status':'in_progress'},format='json').status_code,403)
        foreign=Tenant.objects.create(name='Foreign',code='participant-foreign',is_active=True)
        other=OrganizationMembership.objects.create(user=self.users['lead'],tenant=foreign,is_default=True)
        membership.is_default=False;membership.save()
        self.assertEqual(self.client.patch(self.path,{'status':'in_progress'},format='json').status_code,404)
    def test_inactive_tasks_remain_read_only(self):
        self.task.is_active=False;self.task.save()
        self.login('lead')
        response=self.client.get(self.path);self.assertFalse(response.data['access']['can_edit']);self.assertFalse(response.data['access']['can_update_progress'])
        self.assertEqual(self.client.patch(self.path,{'status':'in_progress'},format='json').status_code,400)
        self.assertEqual(self.client.post(self.path+'updates/',{'update_description':'Inactive'},format='json').status_code,400)
    def test_participants_can_submit_for_approval_but_cannot_bypass_it(self):
        workflow=WorkflowDefinition.objects.create(tenant=self.tenant,name='Task review',code='participant-review',entity_type='project_task',status='published',is_active=True,trigger_event='submit')
        WorkflowEntityBinding.objects.create(workflow=workflow,module_slug='projects-tasks',entity_type='project_task',entity_label='Task',route_path='/projects/tasks')
        WorkflowNodeDefinition.objects.create(workflow=workflow,code='review',name='Review',node_type='approval',is_initial=True,assigned_user=self.admin)
        for name in ['lead','accountable','supporting']:
            self.login(name)
            required=self.client.get('/api/platform/workflows/requirement/',{'module_slug':'projects-tasks','entity_type':'project_task','entity_id':self.task.pk})
            self.assertTrue(required.data['data']['can_forward'])
            response=self.client.patch(self.path,{'status':'completed'},format='json')
            self.assertEqual(response.status_code,400,response.data)
        self.login('supporting')
        submitted=self.client.post('/api/platform/workflows/forward/',{'module_slug':'projects-tasks','entity_type':'project_task','entity_id':self.task.pk},format='json')
        self.assertEqual(submitted.status_code,201,submitted.data)
        inbox_id=submitted.data['data']['id']
        self.assertEqual(self.client.patch(self.path,{'status':'todo'},format='json').status_code,400)
        self.assertEqual(self.client.post(f'/api/platform/workflows/inbox/{inbox_id}/action/',{'decision':'approve'},format='json').status_code,403)
        self.login('unassigned')
        blocked=self.client.post('/api/platform/workflows/forward/',{'module_slug':'projects-tasks','entity_type':'project_task','entity_id':self.task.pk},format='json')
        self.assertEqual(blocked.status_code,403,blocked.data)

    def test_revoked_membership_cannot_fall_back_to_legacy_profile_for_updates(self):
        from Platform_Core.models import TenantUserProfile
        user=self.users['lead']
        TenantUserProfile.objects.create(user=user,tenant=self.tenant,branch=self.branch,is_tenant_admin=False)
        OrganizationMembership.objects.filter(user=user,tenant=self.tenant).update(is_active=False)
        self.login('lead')
        response=self.client.patch(self.path,{'status':'in_progress'},format='json')
        self.assertIn(response.status_code,[403,404],response.data)
        self.task.refresh_from_db();self.assertEqual(self.task.status,'draft')
