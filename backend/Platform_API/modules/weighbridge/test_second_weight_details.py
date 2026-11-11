import tempfile
from django.test import TestCase, override_settings
from django.utils import timezone
from Platform_Core.models import Tenant, TenantBranch
from Platform_Core.documents import _receipt_context
from SL_Weighbridge.models import Branch, Item, Transaction, WeighingOperationType
from Platform_API.modules.weighbridge import test_customer_vehicle_permissions as fixtures


class SecondWeightDetailsTests(TestCase):
    def setUp(self):
        self.media = tempfile.TemporaryDirectory(); self.addCleanup(self.media.cleanup)
        self.config = override_settings(MEDIA_ROOT=self.media.name); self.config.enable(); self.addCleanup(self.config.disable)
        fixtures.FirstWeightPairingWorkflowTests.setUp(self)
        TenantBranch.objects.create(tenant=self.tenant, name=self.branch.name)
        self.second_operation=WeighingOperationType.objects.create(tenant=self.tenant,code='SECOND_DETAILS',name='Second Weight',flow_kind='second',requires_payment=False,is_active=True)
        self.original_time=timezone.now()-timezone.timedelta(hours=2)
        self.first=fixtures.FirstWeightPairingWorkflowTests.create_pending_first_weight(self)
        Transaction.objects.filter(pk=self.first.pk).update(driver_name='Original Driver',driver_phone='0700000111',gross_weight_date=self.original_time,created_by=self.user)
        self.first.refresh_from_db()
        self.original_charge=self.first.charge
        self.replacement=Item.objects.create(tenant=self.tenant,branch=self.branch,name='Z Return Load',currency=self.currency)

    def post(self, **changes):
        payload={'branch':self.branch.pk,'customer':self.customer.pk,'vehicle':self.vehicle.pk,'vehicle_type':self.vehicle_type.pk,'operation_type':self.second_operation.pk,'weight_type':'Second Weight','tare_weight':8000,'net_weight':4000,'operator':'Cashier','paired_first_transaction':self.first.pk,'payment_mode':self.first.payment_mode,'payment_status':self.first.payment_status,'destination':self.first.destination}
        payload.update(changes)
        return self.client.post('/api/commercial-weighbridge/transactions/',payload,format='json')

    def completed(self, response):
        self.assertEqual(response.status_code,201,response.data)
        second=Transaction.objects.get(pk=response.data.get('data',response.data)['id']);self.first.refresh_from_db()
        self.assertTrue(self.first.paired);self.assertEqual(self.first.gross_weight_date,self.original_time)
        self.assertEqual(self.first.charge,self.original_charge)
        return second

    def test_changed_item_and_driver_are_saved_on_both_paired_tickets(self):
        second=self.completed(self.post(item=self.replacement.pk,driver_name='Return Driver',driver_phone='0711111222'))
        for tx in [self.first,second]:
            self.assertEqual(tx.item_id,self.replacement.pk);self.assertEqual(tx.driver_name,'Return Driver');self.assertEqual(tx.driver_phone,'0711111222')
            self.assertEqual(tx.status,'Completed')
            self.assertEqual(_receipt_context(tx,None)['weighing']['item_name'],'Z Return Load')
        self.assertEqual(second.net_weight,4000)

    def test_empty_return_uses_empty_commodity_and_can_clear_driver(self):
        empty=Item.objects.create(tenant=self.tenant,branch=self.branch,name='EMPTY')
        second=self.completed(self.post(item=empty.pk,driver_name='',driver_phone=''))
        for tx in [self.first,second]:
            self.assertEqual(tx.item_id,empty.pk);self.assertEqual(tx.driver_name,'');self.assertEqual(tx.driver_phone,'')
            self.assertEqual(_receipt_context(tx,None)['weighing']['item_name'],'EMPTY')

    def test_older_clients_omitting_details_preserve_pending_ticket_values(self):
        second=self.completed(self.post())
        for tx in [self.first,second]:
            self.assertEqual(tx.item_id,self.item.pk);self.assertEqual(tx.driver_name,'Original Driver');self.assertEqual(tx.driver_phone,'0700000111')

    def test_item_after_first_fifty_is_selectable_and_saved(self):
        Item.objects.bulk_create([Item(tenant=self.tenant,branch=self.branch,name=f'A catalogue {i:03d}') for i in range(75)])
        response=self.client.get('/api/commercial-weighbridge/items/',{'picker':'1','branch_id':self.branch.pk})
        self.assertEqual(response.status_code,200);self.assertIsInstance(response.data,list)
        self.assertIn(self.replacement.pk,{row['id'] for row in response.data})
        second=self.completed(self.post(item=self.replacement.pk))
        self.assertEqual(second.item_id,self.replacement.pk)

    def test_second_weight_cannot_use_a_different_organization_commodity(self):
        foreign=Tenant.objects.create(name='Foreign Organization',code='foreign-second-item')
        item=Item.objects.create(tenant=foreign,name='Foreign commodity')
        response=self.post(item=item.pk)
        self.assertEqual(response.status_code,400,response.data);self.assertIn('item',response.data)
        self.first.refresh_from_db();self.assertFalse(self.first.paired);self.assertEqual(self.first.item_id,self.item.pk)

    def test_second_weight_cannot_use_a_different_branch_commodity(self):
        other=Branch.objects.create(tenant=self.tenant,company=self.company,name='Other Branch')
        item=Item.objects.create(tenant=self.tenant,branch=other,name='Other branch commodity')
        response=self.post(item=item.pk)
        self.assertEqual(response.status_code,400,response.data);self.assertIn('item',response.data)
        self.first.refresh_from_db();self.assertFalse(self.first.paired)

    def test_manual_approval_retains_edited_details(self):
        second=self.completed(self.post(item=self.replacement.pk,driver_name='Approved Driver',driver_phone='0722222333',manual_weight_capture=True,weight_reason='Indicator verification'))
        self.assertEqual(second.status,'Draft')
        response=self.client.post(f'/api/commercial-weighbridge/transactions/{second.pk}/approve/',{},format='json')
        self.assertEqual(response.status_code,200,response.data)
        for tx in [self.first,second]:
            tx.refresh_from_db();self.assertEqual(tx.status,'Completed');self.assertEqual(tx.item_id,self.replacement.pk);self.assertEqual(tx.driver_name,'Approved Driver')

    def test_cashier_can_change_return_load_and_driver_without_admin_access(self):
        from django.contrib.auth.models import Group, Permission, User
        from Platform_Core.models import TenantUserProfile, OrganizationMembership
        TenantUserProfile.objects.filter(user=self.user).update(is_tenant_admin=False)
        group=Group.objects.create(name=f'tenant:{self.tenant.pk}:Cashier')
        group.permissions.add(*Permission.objects.filter(content_type__app_label='SL_Weighbridge',codename__in=['can_access_weighment_entry','can_capture_second_weight','view_transaction']))
        self.user.groups.add(group)
        location=TenantBranch.objects.get(tenant=self.tenant,name=self.branch.name)
        membership=OrganizationMembership.objects.create(user=self.user,tenant=self.tenant,branch=location,is_default=True,active_role_group_name=group.name)
        membership.branches.add(location)
        self.client.force_authenticate(User.objects.get(pk=self.user.pk))
        second=self.completed(self.post(item=self.replacement.pk,driver_name='Cashier Driver',driver_phone='0733333444'))
        self.assertEqual(second.item_id,self.replacement.pk);self.assertEqual(self.first.driver_name,'Cashier Driver')

    def test_user_without_second_capture_permission_cannot_change_ticket(self):
        from django.contrib.auth.models import Group, Permission, User
        from Platform_Core.models import TenantUserProfile
        TenantUserProfile.objects.filter(user=self.user).update(is_tenant_admin=False)
        group=Group.objects.create(name=f'tenant:{self.tenant.pk}:Read Only')
        group.permissions.add(*Permission.objects.filter(content_type__app_label='SL_Weighbridge',codename__in=['view_transaction','can_access_weighment_entry']))
        self.user.groups.add(group)
        self.client.force_authenticate(User.objects.get(pk=self.user.pk))
        response=self.post(item=self.replacement.pk,driver_name='Denied')
        self.assertEqual(response.status_code,403)
        self.first.refresh_from_db();self.assertFalse(self.first.paired);self.assertEqual(self.first.item_id,self.item.pk);self.assertEqual(self.first.driver_name,'Original Driver')
