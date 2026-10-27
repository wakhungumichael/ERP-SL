from django.contrib.auth.models import Group, User
from django.test import TestCase
from rest_framework.test import APIClient
from Platform_Core.models import Account, JournalEntry, OrganizationMembership, OrganizationSetupImport, Tenant
from SL_CRM.models import Supplier
from SL_Procurement.models import Requisition, RequisitionLine
from SL_Sales.models import Product
from SL_Weighbridge.models import Customer


class OrganizationSetupImportTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name='New tenant', code='setup-import', is_active=True, status='active')
        self.other = Tenant.objects.create(name='Other tenant', code='setup-other', is_active=True, status='active')
        self.admin = User.objects.create_user('setup-owner')
        self.member = User.objects.create_user('setup-member')
        OrganizationMembership.objects.create(user=self.admin, tenant=self.tenant, is_default=True, is_org_admin=True)
        OrganizationMembership.objects.create(user=self.member, tenant=self.tenant, is_default=True)
        group, _ = Group.objects.get_or_create(name='Tenant Admin')
        self.admin.groups.add(group)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.url = f'/api/platform/tenants/{self.tenant.pk}/setup-import/'

    def run_import(self, **kwargs):
        return self.client.post(self.url, {'selections': ['workflows', 'approval_rules', 'finance_masters', 'hr_defaults', 'demo_masters', 'project_samples']} | kwargs, format='json')

    def test_new_organization_can_import_selected_setup_idempotently(self):
        first = self.run_import()
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(self.tenant.workflow_definitions.count(), 16)
        self.assertEqual(Product.objects.filter(tenant=self.tenant).count(), 2)
        self.assertEqual(Customer.objects.filter(tenant=self.tenant).count(), 2)
        self.assertEqual(Supplier.objects.filter(tenant=self.tenant).count(), 2)
        self.assertEqual(self.tenant.project_tasks.count(), 6)
        second = self.run_import()
        self.assertEqual(second.status_code, 200, second.data)
        self.assertEqual(Product.objects.filter(tenant=self.tenant).count(), 2)
        self.assertEqual(second.data['report']['workflows']['created'], 0)
        self.assertFalse(Account.objects.filter(tenant=self.other).exists())
        self.assertFalse(JournalEntry.objects.exists())
        self.assertEqual(User.objects.count(), 2)

    def test_preview_saves_nothing_and_custom_account_is_preserved(self):
        custom = Account.objects.create(tenant=self.tenant, code='1000', name='Custom cash name', account_type='asset')
        response = self.run_import(dry_run=True)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data['dry_run'])
        self.assertFalse(Product.objects.exists())
        self.assertFalse(OrganizationSetupImport.objects.exists())
        self.assertFalse(self.tenant.workflow_definitions.exists())
        custom.refresh_from_db()
        self.assertEqual(custom.name, 'Custom cash name')

    def test_non_admin_and_foreign_organization_imports_are_denied(self):
        self.assertEqual(self.client.post(f'/api/platform/tenants/{self.other.pk}/setup-import/', {'selections':['demo_masters']}, format='json').status_code, 403)
        self.client.force_authenticate(self.member)
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.assertEqual(self.run_import().status_code, 403)

    def test_untouched_optional_examples_can_be_removed_but_standard_setup_remains(self):
        self.assertEqual(self.run_import().status_code, 200)
        response = self.client.delete(self.url)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(Product.objects.exists())
        self.assertFalse(Customer.objects.exists())
        self.assertFalse(self.tenant.project_tasks.exists())
        self.assertTrue(Account.objects.filter(tenant=self.tenant).exists())
        self.assertEqual(self.tenant.workflow_definitions.count(), 16)

    def test_used_or_edited_master_examples_block_cleanup_atomically(self):
        self.assertEqual(self.run_import(selections=['demo_masters']).status_code, 200)
        product = Product.objects.first()
        requisition = Requisition.objects.create(tenant=self.tenant, requested_by=self.admin, title='Real request', cost_center='OPS')
        RequisitionLine.objects.create(requisition=requisition, product=product, description='Real requirement', quantity=1, unit_price=100)
        response = self.client.delete(self.url)
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(Product.objects.count(), 2)
        self.assertEqual(Customer.objects.count(), 2)
        self.assertTrue(Requisition.objects.filter(pk=requisition.pk).exists())

    def test_import_can_keep_new_workflows_as_drafts(self):
        response = self.run_import(selections=['workflows'], publish=False)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(self.tenant.workflow_definitions.exclude(status='draft',is_active=False).exists())

    def test_new_owner_can_seed_approvals_without_a_global_admin_role(self):
        self.admin.groups.clear()
        response = self.run_import(selections=['workflows', 'approval_rules'])
        self.assertEqual(response.status_code, 200, response.data)
        scoped = Group.objects.get(name=f'tenant:{self.tenant.pk}:Organization Approvers')
        self.assertTrue(scoped.user_set.filter(pk=self.admin.pk).exists())
        self.assertFalse(self.admin.groups.filter(name='Tenant Admin').exists())
        self.assertFalse(scoped.permissions.exists())
        admin_role = Group.objects.get(name='Tenant Admin')
        response = self.client.post('/api/platform/auth/active-role/', {'role_id': admin_role.pk})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data['data']['is_org_admin'])
