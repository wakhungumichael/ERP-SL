from django.contrib.auth.models import Group, Permission, User
from django.test import TestCase
from rest_framework.test import APIClient
from Platform_Core.models import OrganizationMembership, Tenant, TenantBranch, TenantUserProfile
from Platform_API.modules.mixins import has_active_permission
from Platform_API.modules.shared_serializers import UserProfileSerializer


class MultipleOrganizationTests(TestCase):
    def setUp(self):
        self.a = Tenant.objects.create(name='Organization A', code='multi-a', is_active=True, status='active')
        self.b = Tenant.objects.create(name='Organization B', code='multi-b', is_active=True, status='active')
        self.user = User.objects.create_user('multi-user', password='pass')
        self.admin = User.objects.create_user('multi-admin', password='pass')
        OrganizationMembership.objects.create(user=self.admin, tenant=self.a, is_default=True, is_org_admin=True)
        OrganizationMembership.objects.create(user=self.admin, tenant=self.b, is_org_admin=True)
        TenantUserProfile.objects.create(user=self.admin, tenant=self.a, is_tenant_admin=True)
        self.role_a = Group.objects.create(name=f'tenant:{self.a.pk}:Manager')
        self.role_b = Group.objects.create(name=f'tenant:{self.b.pk}:Employee')
        self.role_a.permissions.add(Permission.objects.get(content_type__app_label='SL_Projects', codename='view_all_projecttask'))
        self.role_b.permissions.add(Permission.objects.get(content_type__app_label='SL_Projects', codename='view_own_projecttask'))
        self.user.groups.add(self.role_a, self.role_b)
        self.ma = OrganizationMembership.objects.create(user=self.user, tenant=self.a, is_default=True, active_role_group_name=self.role_a.name)
        self.mb = OrganizationMembership.objects.create(user=self.user, tenant=self.b, active_role_group_name=self.role_b.name)
        TenantUserProfile.objects.create(user=self.user, tenant=self.a)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_non_admin_switches_only_between_their_organizations(self):
        response = self.client.post('/api/platform/auth/switch-organization/', {'membership_id': self.mb.pk})
        self.assertEqual(response.status_code, 200, response.data)
        payload = response.data['data']
        self.assertEqual(payload['organization_id'], self.b.pk)
        self.assertFalse(payload['is_org_admin'])
        self.assertEqual(payload['active_membership_id'], self.mb.pk)
        self.assertIn('SL_Projects.view_own_projecttask', payload['permissions'])
        self.assertNotIn('SL_Projects.view_all_projecttask', payload['permissions'])
        self.assertTrue(has_active_permission(self.user, 'SL_Projects.view_own_projecttask'))
        self.assertFalse(has_active_permission(self.user, 'SL_Projects.view_all_projecttask'))
        self.assertEqual(OrganizationMembership.objects.filter(user=self.user, is_default=True).count(), 1)
        own_profile = self.user.tenant_profile
        own_profile.refresh_from_db()
        self.assertEqual(own_profile.tenant_id, self.b.pk)
        stranger = OrganizationMembership.objects.filter(user=self.admin, tenant=self.a).first()
        self.assertEqual(self.client.post('/api/platform/auth/switch-organization/', {'membership_id': stranger.pk}).status_code, 404)
        self.assertEqual(self.client.patch(f'/api/platform/tenants/{self.b.pk}/settings/', {'primary_color': '#000000'}).status_code, 403)

    def test_foreign_organization_roles_are_not_switchable_or_listed(self):
        self.client.post('/api/platform/auth/switch-organization/', {'membership_id': self.mb.pk})
        response = self.client.post('/api/platform/auth/active-role/', {'role_id': self.role_a.pk})
        self.assertEqual(response.status_code, 403)
        payload = UserProfileSerializer(self.user).data
        self.assertEqual({row['id'] for row in payload['available_roles']}, {self.role_b.pk})

    def test_membership_role_assignment_can_target_a_second_organization(self):
        branch = TenantBranch.objects.create(tenant=self.b, name='Branch B')
        self.mb.delete()
        self.client.force_authenticate(self.admin)
        response = self.client.post(f'/api/platform/users/{self.user.pk}/memberships/', {'tenant_id': self.b.pk, 'branch_id': branch.pk, 'role_group_name': self.role_b.name, 'is_default': False}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        membership = OrganizationMembership.objects.get(user=self.user, tenant=self.b)
        self.assertEqual(membership.branch_id, branch.pk)
        self.assertEqual(membership.active_role_group_name, self.role_b.name)
        self.assertEqual(OrganizationMembership.objects.filter(user=self.user).count(), 2)
        self.assertTrue(self.user.groups.filter(pk=self.role_a.pk).exists())
        roles = self.client.get(f'/api/platform/roles/?tenant_id={self.b.pk}&page_size=100')
        self.assertEqual(roles.status_code, 200, roles.data)
        names = {row['name'] for row in roles.data['results']}
        self.assertIn(self.role_b.name, names)
        self.assertNotIn(self.role_a.name, names)

    def test_replacing_one_organizations_roles_retains_other_organization_roles(self):
        self.client.force_authenticate(self.admin)
        replacement = Group.objects.create(name=f'tenant:{self.a.pk}:Updated role')
        response = self.client.post(f'/api/platform/users/{self.user.pk}/assign-roles/', {'group_ids': [replacement.pk], 'replace_existing': True}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(self.user.groups.filter(pk=self.role_b.pk).exists())
        self.assertTrue(self.user.groups.filter(pk=replacement.pk).exists())
        self.assertFalse(self.user.groups.filter(pk=self.role_a.pk).exists())

    def test_organization_admin_cannot_manage_an_organization_they_only_belong_to(self):
        membership = OrganizationMembership.objects.get(user=self.admin, tenant=self.b)
        membership.is_org_admin=False
        membership.save()
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get(f'/api/platform/roles/?tenant_id={self.b.pk}').status_code, 403)
        response = self.client.patch(f'/api/platform/memberships/{self.mb.pk}/', {'is_org_admin': True})
        self.assertEqual(response.status_code, 403)
        memberships = self.client.get(f'/api/platform/users/{self.user.pk}/memberships/').data['data']['memberships']
        self.assertEqual({row['tenant'] for row in memberships}, {self.a.pk})

    def test_inactive_organization_cannot_be_selected(self):
        self.b.is_active=False
        self.b.save()
        self.assertEqual(self.client.post('/api/platform/auth/switch-organization/', {'membership_id': self.mb.pk}).status_code, 404)

    def test_invalid_switch_identifier_returns_validation_error(self):
        self.assertEqual(self.client.post('/api/platform/auth/switch-organization/', {'membership_id': 'invalid'}).status_code, 400)
