from io import BytesIO
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from pypdf import PdfReader
from rest_framework.test import APIClient

from Platform_Core.models import OrganizationMembership, Tenant, TenantSettings
from SL_HR.models import Employee, PayPeriod, PayRecord


class PersonalPayslipTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name='Personal Payroll Company', code='personal-payroll', default_currency='USD')
        self.foreign = Tenant.objects.create(name='Foreign Payroll Company', code='foreign-payroll')
        self.user = User.objects.create_user('pay-employee', first_name='Employee', last_name='One')
        self.other = User.objects.create_user('another-employee', first_name='Another', last_name='Person')
        self.admin = User.objects.create_user('pay-admin')
        self.membership = OrganizationMembership.objects.create(user=self.user, tenant=self.tenant, is_default=True)
        OrganizationMembership.objects.create(user=self.other, tenant=self.tenant)
        OrganizationMembership.objects.create(user=self.admin, tenant=self.tenant, is_org_admin=True)
        self.foreign_membership = OrganizationMembership.objects.create(user=self.user, tenant=self.foreign)
        Employee.objects.create(tenant=self.tenant, user=self.user, employee_number='EMP-001', full_name='Employee One', start_date='2025-01-01')
        self.september = self.period('September 2026', '2026-09-01', '2026-09-30')
        self.october = self.period('October 2026', '2026-10-01', '2026-10-31')
        self.draft = self.period('November draft', '2026-11-01', '2026-11-30', status='Draft')
        self.processing = self.period('December processing', '2026-12-01', '2026-12-31', status='Processing')
        self.foreign_period = self.period('Foreign October', '2026-10-01', '2026-10-31', tenant=self.foreign)
        self.old = self.record(self.september, self.user)
        self.current = self.record(self.october, self.user, basic_pay='35000', allowances='2500', deductions='6000', net_pay='31500')
        self.other_record = self.record(self.october, self.other, net_pay='999999')
        self.draft_record = self.record(self.draft, self.user)
        self.processing_record = self.record(self.processing, self.user)
        self.foreign_record = self.record(self.foreign_period, self.user)
        self.admin_record = self.record(self.october, self.admin)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        module = patch('Platform_Core.platform.get_active_tenant_module_slugs', return_value={'hr-payroll'})
        module.start()
        self.addCleanup(module.stop)

    def period(self, name, start, end, **kwargs):
        return PayPeriod.objects.create(**({'tenant': self.tenant, 'name': name, 'period_start': start, 'period_end': end, 'status': 'Completed'} | kwargs))

    def record(self, period, employee, **kwargs):
        return PayRecord.objects.create(**({'period': period, 'employee': employee, 'basic_pay': '30000', 'allowances': '2000', 'deductions': '5000', 'net_pay': '27000'} | kwargs))

    def test_list_is_personal_per_period_and_has_download_links(self):
        response = self.client.get('/api/hr/my-payslips/', {'employee': self.other.pk, 'tenant': self.foreign.pk})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 2)
        self.assertEqual([row['id'] for row in response.data['results']], [self.current.pk, self.old.pk])
        row = response.data['results'][0]
        self.assertEqual(row['period_name'], 'October 2026')
        self.assertEqual(row['period_start'], '2026-10-01')
        self.assertEqual(row['period_end'], '2026-10-31')
        self.assertEqual(row['gross_pay'], '37500.00')
        self.assertEqual(row['net_pay'], '31500.00')
        self.assertEqual(row['currency'], 'USD')
        self.assertEqual(row['download_url'], f'/api/hr/my-payslips/{self.current.pk}/download/')
        self.assertNotIn('total_net', response.data)
        self.assertEqual(response['Cache-Control'], 'private, no-store')

    def test_search_and_pagination_preserve_ownership(self):
        response = self.client.get('/api/hr/my-payslips/?page_size=1')
        self.assertEqual(response.data['count'], 2)
        self.assertEqual([row['id'] for row in response.data['results']], [self.current.pk])
        response = self.client.get('/api/hr/my-payslips/?page_size=1&page=2')
        self.assertEqual([row['id'] for row in response.data['results']], [self.old.pk])
        response = self.client.get('/api/hr/my-payslips/?search=September')
        self.assertEqual([row['id'] for row in response.data['results']], [self.old.pk])
        self.assertEqual(self.client.get('/api/hr/my-payslips/?search=missing').data['results'], [])

    def test_pdf_contains_one_period_and_only_own_pay(self):
        response = self.client.get(f'/api/hr/my-payslips/{self.current.pk}/download/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/pdf')
        self.assertIn('attachment; filename="payslip-2026-10-01-', response['Content-Disposition'])
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.assertEqual(response['X-Content-Type-Options'], 'nosniff')
        self.assertTrue(response.content.startswith(b'%PDF-'))
        reader = PdfReader(BytesIO(response.content))
        self.assertEqual(len(reader.pages), 1)
        text = reader.pages[0].extract_text()
        for expected in ['Personal Payroll Company', 'October 2026', 'Employee One', 'EMP-001', 'USD 37,500.00', 'USD 31,500.00']:
            self.assertIn(expected, text)
        self.assertNotIn('Another Person', text)
        self.assertNotIn('September 2026', text)
        self.assertNotIn('999,999', text)

    def test_other_users_foreign_and_unfinished_records_cannot_be_downloaded(self):
        for row in [self.other_record, self.foreign_record, self.draft_record, self.processing_record, self.admin_record]:
            with self.subTest(record=row.pk):
                self.assertEqual(self.client.get(f'/api/hr/my-payslips/{row.pk}/download/').status_code, 404)

    def test_personal_page_does_not_expand_for_payroll_administrators(self):
        self.client.force_authenticate(self.admin)
        response = self.client.get('/api/hr/my-payslips/')
        self.assertEqual([row['id'] for row in response.data['results']], [self.admin_record.pk])
        self.assertEqual(self.client.get(f'/api/hr/my-payslips/{self.current.pk}/download/').status_code, 404)
        self.assertEqual(self.client.get(f'/api/hr/my-payslips/{self.admin_record.pk}/download/').status_code, 200)

    def test_switching_organization_only_shows_own_records_in_active_organization(self):
        self.membership.is_default = False
        self.membership.save(update_fields=['is_default'])
        self.foreign_membership.is_default = True
        self.foreign_membership.save(update_fields=['is_default'])
        response = self.client.get('/api/hr/my-payslips/')
        self.assertEqual([row['id'] for row in response.data['results']], [self.foreign_record.pk])
        self.assertEqual(self.client.get(f'/api/hr/my-payslips/{self.current.pk}/download/').status_code, 404)

    def test_authentication_and_active_hr_module_are_required(self):
        with patch('Platform_Core.platform.get_active_tenant_module_slugs', return_value=set()):
            self.assertEqual(self.client.get('/api/hr/my-payslips/').status_code, 403)
            self.assertEqual(self.client.get(f'/api/hr/my-payslips/{self.current.pk}/download/').status_code, 403)
        self.client.force_authenticate(user=None)
        self.assertIn(self.client.get('/api/hr/my-payslips/').status_code, [401, 403])
        self.assertIn(self.client.get(f'/api/hr/my-payslips/{self.current.pk}/download/').status_code, [401, 403])

    def test_payslip_includes_shared_organization_contact_details(self):
        TenantSettings.objects.create(tenant=self.tenant, invoice_address="Office Park\nP.O. Box 98765, Nairobi", invoice_website="https://payroll.example.com", invoice_tax_number="P098765432X")
        response = self.client.get(f'/api/hr/my-payslips/{self.current.pk}/download/')
        self.assertEqual(response.status_code, 200)
        text = "\n".join(page.extract_text() for page in PdfReader(BytesIO(response.content)).pages)
        for value in ["Office Park", "P.O. Box 98765, Nairobi", "https://payroll.example.com", "P098765432X"]:
            self.assertIn(value, text)
