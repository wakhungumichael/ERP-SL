from datetime import date, timedelta
from io import BytesIO
from unittest.mock import patch
from django.contrib.auth.models import Group, Permission, User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from Platform_Core.models import OrganizationMembership, Tenant
from SL_HR.models import Employee, EmployeeDocument, HRPolicy, LeaveRequest, PayPeriod
from .workforce import leave_days


class WorkforceTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name='HR company', code='hr-workforce')
        self.other_tenant = Tenant.objects.create(name='Other company', code='hr-foreign')
        self.admin = User.objects.create_user('hr-manager')
        self.employee_user = User.objects.create_user('hr-employee')
        self.other_user = User.objects.create_user('hr-other')
        OrganizationMembership.objects.create(user=self.admin, tenant=self.tenant, is_org_admin=True, is_default=True)
        for user in [self.employee_user, self.other_user]:
            OrganizationMembership.objects.create(user=user, tenant=self.tenant, is_default=True)
        role = Group.objects.create(name='Employee')
        role.permissions.set(Permission.objects.filter(content_type__app_label='SL_HR', codename__in=['request_own_leave', 'add_employeedocument', 'add_employeeservicerequest']))
        self.employee_user.groups.add(role)
        self.employee = Employee.objects.create(tenant=self.tenant, user=self.employee_user, employee_number='EMP1', full_name='Employee One', start_date='2025-01-01', manager=self.admin, status='active')
        self.other = Employee.objects.create(tenant=self.tenant, user=self.other_user, employee_number='EMP2', full_name='Employee Two', start_date='2025-01-01', status='active')
        self.config = HRPolicy.objects.create(tenant=self.tenant)
        self.client = APIClient()
        self.client.force_authenticate(self.employee_user)
        mock = patch('Platform_Core.platform.get_active_tenant_module_slugs', return_value={'hr-payroll'})
        mock.start()
        self.addCleanup(mock.stop)

    def draft(self, **kwargs):
        payload = dict(employee=self.employee.pk, leave_type='annual', start_date='2026-11-02', end_date='2026-11-06', reason='Family time') | kwargs
        response = self.client.post('/api/hr/leave/', payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return response.data['id']

    def action(self, pk, action):
        return self.client.post(f'/api/hr/leave/{pk}/action/', dict(action=action, notes='Reviewed'), format='json')

    def test_employee_self_service_cannot_see_colleagues_or_salaries(self):
        response = self.client.get('/api/hr/employees/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([r['id'] for r in response.data['results']], [self.employee.pk])
        self.assertEqual(self.client.get(f'/api/hr/employees/{self.other.pk}/').status_code, 404)
        self.assertEqual(self.client.get('/api/hr/pay-periods/').status_code, 403)
        self.assertEqual(self.client.patch('/api/hr/settings/', {'annual_leave_days': 50}).status_code, 403)

    def test_leave_submission_reserves_balance_approval_and_cancellation_release(self):
        pk = self.draft()
        self.assertEqual(self.action(pk, 'submit').status_code, 200)
        self.assertEqual(self.client.get('/api/hr/leave/').data['balances']['annual'], 16)
        overlap = self.draft()
        self.assertEqual(self.action(overlap, 'submit').status_code, 400)
        self.assertEqual(self.action(pk, 'approve').status_code, 403)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.action(pk, 'approve').status_code, 200)
        self.assertEqual(self.action(pk, 'revoke').status_code, 200)
        self.client.force_authenticate(self.employee_user)
        self.assertEqual(self.client.get('/api/hr/leave/').data['balances']['annual'], 21)

    def test_leave_for_other_employee_is_rejected(self):
        response = self.client.post('/api/hr/leave/', dict(employee=self.other.pk, leave_type='annual', start_date='2026-11-02', end_date='2026-11-06', reason='Wrong employee'))
        self.assertEqual(response.status_code, 400)

    def test_public_holidays_and_working_days_are_not_charged(self):
        self.config.public_holidays = ['2026-12-24']
        self.assertEqual(leave_days(date(2026,12,24), date(2026,12,28), 'annual', self.config), 1)
        self.assertEqual(leave_days(date(2026,12,24), date(2026,12,28), 'paternity', self.config), 5)

    def test_balance_exhaustion_and_sick_evidence_are_checked_on_submission(self):
        pk = self.draft(end_date='2026-12-04')
        self.assertEqual(self.action(pk, 'submit').status_code, 400)
        sick = self.draft(leave_type='sick_full')
        self.assertEqual(self.action(sick, 'submit').status_code, 400)

    def test_maternity_uses_calendar_months_and_does_not_use_annual_balance(self):
        pk = self.draft(leave_type='maternity', start_date='2026-07-01', end_date='2026-09-30')
        self.assertEqual(self.action(pk, 'submit').status_code, 200)
        self.assertEqual(LeaveRequest.objects.get(pk=pk).days, 92)
        self.assertEqual(self.client.get('/api/hr/leave/').data['balances']['annual'], 21)

    def test_onboarding_requires_verified_private_documents(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post('/api/hr/employees/', dict(employee_number='EMP3', full_name='New Hire', start_date='2026-11-01'), format='json')
        self.assertEqual(response.status_code, 201, response.data)
        pk = response.data['id']
        self.assertEqual(self.client.post(f'/api/hr/employees/{pk}/', {}).status_code, 400)
        for kind in self.config.required_documents:
            upload = SimpleUploadedFile(f'{kind}.pdf', b'%PDF-1.4 sample', content_type='application/pdf')
            response = self.client.post(f'/api/hr/employees/{pk}/documents/', {'document_type': kind, 'file': upload}, format='multipart')
            self.assertEqual(response.status_code, 201, response.data)
            document_id = response.data['id']
            response = self.client.get(f'/api/hr/employees/{pk}/documents/{document_id}/')
            self.assertEqual(response.content, b'%PDF-1.4 sample')
            self.assertEqual(response['Cache-Control'], 'private, no-store')
            self.assertEqual(self.client.patch(f'/api/hr/employees/{pk}/documents/{document_id}/', {}).status_code, 200)
        self.assertEqual(self.client.post(f'/api/hr/employees/{pk}/', {}).status_code, 200)
        self.client.force_authenticate(self.employee_user)
        self.assertEqual(self.client.get(f'/api/hr/employees/{pk}/documents/').status_code, 404)

    def test_policy_cannot_reduce_statutory_minimum(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.patch('/api/hr/settings/', {'annual_leave_days': 10}).status_code, 400)
        self.assertEqual(self.client.patch('/api/hr/settings/', {'annual_leave_days': 25}).status_code, 200)

    def test_payroll_record_creation_attaches_period_and_calculates_net(self):
        self.client.force_authenticate(self.admin)
        period = PayPeriod.objects.create(tenant=self.tenant, name='November', period_start='2026-11-01', period_end='2026-11-30')
        response = self.client.post(f'/api/hr/pay-periods/{period.pk}/records/', dict(employee=self.employee_user.pk, basic_pay='30000', allowances='2000', deductions='5000', net_pay='99999'))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['net_pay'], '27000.00')
        self.assertEqual(period.records.count(), 1)
        period.status = 'Completed'
        period.save()
        response = self.client.patch(f'/api/hr/pay-periods/{period.pk}/records/{response.data["id"]}/', {'basic_pay': '1'})
        self.assertEqual(response.status_code, 400)
        self.client.force_authenticate(self.employee_user)
        self.assertEqual(len(self.client.get('/api/hr/my-payslips/').data['results']), 1)

    def test_employee_request_lifecycle_is_own_scoped(self):
        response = self.client.post('/api/hr/requests/', dict(employee=self.employee.pk, request_type='employment_letter', subject='Visa letter', details='Please prepare my employment letter.'))
        self.assertEqual(response.status_code, 201, response.data)
        pk = response.data['id']
        self.assertEqual(self.client.patch(f'/api/hr/requests/{pk}/', {'status': 'resolved', 'response': 'Done'}).status_code, 403)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.patch(f'/api/hr/requests/{pk}/', {'status': 'resolved', 'response': 'Letter prepared'}).status_code, 200)

    def test_private_document_content_is_not_copied_into_audit_history(self):
        from Platform_Core.audit import _instance_snapshot, _resolve_instance_tenant
        doc = EmployeeDocument.objects.create(employee=self.employee, document_type='contract', name='contract.pdf', content_type='application/pdf', size=13, content=b'%PDF-private')
        snapshot = _instance_snapshot(doc)
        self.assertNotIn('content', snapshot)
        self.assertEqual(snapshot['name'], 'contract.pdf')
        self.assertEqual(_resolve_instance_tenant(doc), self.tenant)
