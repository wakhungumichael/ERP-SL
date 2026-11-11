from datetime import datetime, timezone as dt_timezone
from io import BytesIO
from types import SimpleNamespace
from django.contrib.auth.models import Group, Permission, User
from django.test import TestCase, SimpleTestCase, override_settings
from rest_framework.test import APIClient
from pypdf import PdfReader
from Platform_Core.models import Tenant, TenantBranch, TenantSettings, TenantUserProfile, OrganizationMembership
from Platform_Core.branch_sync import sync_tenant_branch_to_operational
from Platform_Core.receipt_time import format_receipt_datetime, receipt_timezone
from Platform_Core.documents import _receipt_context, render_transaction_receipt
from Platform_Core.document_pdf import document_pdf_bytes
from Platform_API.modules.weighbridge.views import TransactionSerializer
from SL_Weighbridge.models import Item, Transaction


class CommodityPickerTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name='Picker Company', code='picker-company', status='active')
        self.location = TenantBranch.objects.create(tenant=self.tenant, name='Main Branch')
        self.other_location = TenantBranch.objects.create(tenant=self.tenant, name='Other Branch')
        self.branch = sync_tenant_branch_to_operational(self.location)
        self.other_branch = sync_tenant_branch_to_operational(self.other_location)
        self.user = User.objects.create_user('picker-cashier')
        TenantUserProfile.objects.create(user=self.user, tenant=self.tenant)
        self.group = Group.objects.create(name=f'tenant:{self.tenant.pk}:Cashier')
        self.group.permissions.add(*Permission.objects.filter(content_type__app_label='SL_Weighbridge', codename__in=['add_item','view_item']))
        self.user.groups.add(self.group)
        self.membership = OrganizationMembership.objects.create(user=self.user, tenant=self.tenant, branch=self.location, active_role_group_name=self.group.name, is_default=True)
        self.membership.branches.add(self.location)
        Item.objects.bulk_create([Item(tenant=self.tenant, branch=self.branch, name=f'A commodity {i:03d}') for i in range(75)])
        self.shared = Item.objects.create(tenant=self.tenant, name='Shared commodity')
        self.hidden = Item.objects.create(tenant=self.tenant, branch=self.other_branch, name='Other branch commodity')
        foreign = Tenant.objects.create(name='Other Tenant', code='other-picker')
        self.foreign = Item.objects.create(tenant=foreign, name='Other tenant commodity')
        self.client = APIClient(); self.client.force_authenticate(self.user)
        self.url = '/api/commercial-weighbridge/items/'

    def test_cashier_can_create_and_reselect_late_alphabet_item_after_reload(self):
        response = self.client.post(self.url, {'name':'Z newest commodity', 'branch_id':self.branch.pk}, format='json')
        self.assertEqual(response.status_code,201,response.data)
        item = response.data.get('data',response.data)
        self.assertEqual(Item.objects.get(pk=item['id']).tenant_id,self.tenant.pk)
        self.assertEqual(Item.objects.get(pk=item['id']).branch_id,self.branch.pk)
        for _ in range(2):
            response = self.client.get(self.url, {'branch_id':self.branch.pk,'picker':'1'})
            self.assertIsInstance(response.data,list)
            ids = {row['id'] for row in response.data}
            self.assertEqual(len(ids),77)
            self.assertIn(item['id'],ids);self.assertIn(self.shared.pk,ids)
            self.assertNotIn(self.hidden.pk,ids);self.assertNotIn(self.foreign.pk,ids)

    def test_settings_list_remains_paginated(self):
        response=self.client.get(self.url, {'branch_id':self.branch.pk})
        self.assertIn('results',response.data);self.assertEqual(response.data['count'],76)
        self.assertLess(len(response.data['results']),76)

    def test_cashier_cannot_add_or_read_an_unassigned_branch(self):
        response=self.client.post(self.url, {'name':'Denied','branch_id':self.other_branch.pk},format='json')
        self.assertEqual(response.status_code,400)
        self.assertFalse(Item.objects.filter(name='Denied').exists())
        response=self.client.get(self.url,{'branch_id':self.other_branch.pk,'picker':'1'})
        self.assertEqual(response.data,[])

    def test_viewer_cannot_add_items(self):
        self.group.permissions.remove(Permission.objects.get(content_type__app_label='SL_Weighbridge',codename='add_item'))
        response=self.client.post(self.url, {'name':'Denied','branch_id':self.branch.pk},format='json')
        self.assertEqual(response.status_code,403)


class ReceiptTimeTests(SimpleTestCase):
    def test_east_africa_time_and_calendar_date(self):
        stamp=datetime(2026,11,8,22,15,tzinfo=dt_timezone.utc)
        self.assertEqual(format_receipt_datetime(stamp,tenant=SimpleNamespace(timezone='Africa/Nairobi')),'09 Nov 2026 01:15 AM')
        self.assertEqual(stamp.hour,22)

    def test_organization_timezone_overrides_process_timezone(self):
        with override_settings(TIME_ZONE='UTC'):
            stamp=datetime(2026,11,8,22,15,tzinfo=dt_timezone.utc)
            self.assertEqual(format_receipt_datetime(stamp,tenant=SimpleNamespace(timezone='Asia/Kolkata')),'09 Nov 2026 03:45 AM')

    def test_missing_and_invalid_timezone_fall_back_to_server_setting(self):
        with override_settings(TIME_ZONE='Africa/Nairobi'):
            stamp=datetime(2026,11,8,22,15,tzinfo=dt_timezone.utc)
            self.assertEqual(format_receipt_datetime(stamp,tenant=SimpleNamespace(timezone='invalid/zone')),'09 Nov 2026 01:15 AM')
            self.assertEqual(format_receipt_datetime(stamp),'09 Nov 2026 01:15 AM')
            self.assertEqual(format_receipt_datetime(None),'')

    def test_legacy_naive_time_is_not_shifted_twice(self):
        self.assertEqual(format_receipt_datetime(datetime(2026,11,9,9,15),tenant=SimpleNamespace(timezone='Africa/Nairobi')),'09 Nov 2026 09:15 AM')


class ReceiptDocumentTimeTests(TestCase):
    def test_print_and_pdf_use_capture_times_in_organization_timezone(self):
        tenant=Tenant.objects.create(name='Receipt Time Company',code='receipt-time-company',timezone='Africa/Nairobi')
        config=TenantSettings.objects.create(tenant=tenant)
        first=datetime(2026,11,8,22,15,tzinfo=dt_timezone.utc);second=datetime(2026,11,8,23,20,tzinfo=dt_timezone.utc)
        t=Transaction(pk=123,tenant=tenant,operator='Test Cashier',status='Completed',weight_type='First Weight',gross_weight=20000,tare_weight=8000,net_weight=12000,gross_weight_date=first,tare_weight_date=second,created_at=first,charge=500)
        context=_receipt_context(t,config)
        self.assertEqual(context['document']['issue_date'],'09 Nov 2026 01:15 AM')
        self.assertEqual(context['weighing']['gross_weight_date'],'09 Nov 2026 01:15 AM')
        self.assertEqual(context['weighing']['tare_weight_date'],'09 Nov 2026 02:20 AM')
        self.assertEqual(TransactionSerializer().get_receipt_timezone(t),'Africa/Nairobi')
        rendered=render_transaction_receipt(t,pdf_optimized=True)
        self.assertIn('09 Nov 2026 01:15 AM',rendered.html)
        self.assertIn('09 Nov 2026 02:20 AM',rendered.html)
        data=document_pdf_bytes(rendered.html)
        text=' '.join(page.extract_text() for page in PdfReader(BytesIO(data)).pages)
        self.assertIn('01:15 AM',text);self.assertIn('02:20 AM',text)
        self.assertEqual(t.gross_weight_date,first);self.assertEqual(t.tare_weight_date,second)

