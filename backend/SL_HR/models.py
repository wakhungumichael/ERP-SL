# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.conf import settings
from django.db import models
from Platform_Core.models import AuditMetadataMixin


class PayPeriod(AuditMetadataMixin, models.Model):
    """A payroll period (e.g. July 2026)."""
    tenant = models.ForeignKey(
        "Platform_Core.Tenant",
        on_delete=models.CASCADE,
        related_name="pay_periods",
        null=True,
        blank=True,
    )
    name = models.CharField(max_length=100)          # "July 2026"
    period_start = models.DateField()
    period_end = models.DateField()
    STATUS = [
        ("Draft",       "Draft"),
        ("Processing",  "Processing"),
        ("Completed",   "Completed"),
    ]
    status = models.CharField(max_length=20, choices=STATUS, default="Draft")
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-period_start"]
        unique_together = [("tenant", "name", "period_start", "period_end")]

    def __str__(self):
        return f"{self.name} ({self.status})"


class PayRecord(AuditMetadataMixin, models.Model):
    """One employee's pay entry for a given period."""
    period     = models.ForeignKey(PayPeriod, on_delete=models.CASCADE, related_name="records")
    employee   = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="pay_records")
    basic_pay  = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    allowances = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    deductions = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    net_pay    = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    notes      = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("period", "employee")]
        ordering = ["employee__username"]

    def __str__(self):
        return f"{self.employee.get_full_name() or self.employee.username} — {self.period}"


def default_working_days():
    return [0, 1, 2, 3, 4]


def default_documents():
    return ['employment_contract', 'identity_document', 'kra_pin', 'nssf', 'sha', 'bank_details']


class HRPolicy(models.Model):
    tenant = models.OneToOneField('Platform_Core.Tenant', on_delete=models.CASCADE, related_name='hr_policy')
    annual_leave_days = models.PositiveSmallIntegerField(default=21)
    sick_full_pay_days = models.PositiveSmallIntegerField(default=7)
    sick_half_pay_days = models.PositiveSmallIntegerField(default=7)
    working_days = models.JSONField(default=default_working_days)
    public_holidays = models.JSONField(default=list, blank=True)
    required_documents = models.JSONField(default=default_documents)
    carry_forward_limit = models.PositiveSmallIntegerField(default=0)
    leave_approver_group = models.ForeignKey('auth.Group', on_delete=models.PROTECT, null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)


class Employee(models.Model):
    tenant = models.ForeignKey('Platform_Core.Tenant', on_delete=models.CASCADE, related_name='employees')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name='employee_profiles')
    employee_number = models.CharField(max_length=50)
    full_name = models.CharField(max_length=180)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=40, blank=True)
    job_title = models.CharField(max_length=150, blank=True)
    department = models.ForeignKey('SL_Procurement.Department', on_delete=models.PROTECT, null=True, blank=True, related_name='employees')
    manager = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name='hr_direct_reports')
    start_date = models.DateField()
    employment_type = models.CharField(max_length=20, choices=[('permanent', 'Permanent'), ('fixed_term', 'Fixed term'), ('casual', 'Casual'), ('intern', 'Intern')], default='permanent')
    status = models.CharField(max_length=20, choices=[('onboarding', 'Onboarding'), ('active', 'Active'), ('on_leave', 'On leave'), ('exited', 'Exited')], default='onboarding')
    emergency_contact_name = models.CharField(max_length=180, blank=True)
    emergency_contact_phone = models.CharField(max_length=40, blank=True)
    exit_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['full_name']
        unique_together = [('tenant', 'employee_number'), ('tenant', 'user')]
        permissions = [('view_all_employee', 'Can view all employee records'), ('manage_onboarding', 'Can complete employee onboarding')]


class EmployeeDocument(models.Model):
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='documents')
    document_type = models.CharField(max_length=60)
    name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100)
    content = models.BinaryField()
    size = models.PositiveIntegerField()
    expires_on = models.DateField(null=True, blank=True)
    verified_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='verified_hr_documents')
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='uploaded_hr_documents')
    created_at = models.DateTimeField(auto_now_add=True)


class LeaveRequest(models.Model):
    LEAVE_TYPES = [('annual', 'Annual leave'), ('sick_full', 'Sick leave (full pay)'), ('sick_half', 'Sick leave (half pay)'), ('maternity', 'Maternity leave'), ('paternity', 'Paternity leave'), ('pre_adoptive', 'Pre-adoptive leave'), ('compassionate', 'Compassionate leave'), ('unpaid', 'Unpaid leave')]
    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name='leave_requests')
    leave_type = models.CharField(max_length=20, choices=LEAVE_TYPES)
    start_date = models.DateField()
    end_date = models.DateField()
    days = models.DecimalField(max_digits=6, decimal_places=2)
    reason = models.TextField()
    supporting_document = models.ForeignKey(EmployeeDocument, on_delete=models.PROTECT, null=True, blank=True)
    status = models.CharField(max_length=12, choices=[('draft', 'Draft'), ('submitted', 'Submitted'), ('approved', 'Approved'), ('rejected', 'Rejected'), ('cancelled', 'Cancelled')], default='draft')
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='reviewed_leave_requests')
    reviewed_at = models.DateTimeField(null=True, blank=True)
    decision_notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        permissions = [('view_all_leaverequest', 'Can view all leave requests'), ('approve_leaverequest', 'Can approve leave requests'), ('request_own_leave', 'Can request own leave')]


class LeaveAllocation(models.Model):
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name='leave_allocations')
    year = models.PositiveSmallIntegerField()
    leave_type = models.CharField(max_length=20, choices=LeaveRequest.LEAVE_TYPES)
    additional_days = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    notes = models.TextField()

    class Meta:
        unique_together = [('employee', 'year', 'leave_type')]


class EmployeeServiceRequest(models.Model):
    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name='service_requests')
    request_type = models.CharField(max_length=30, choices=[('employment_letter', 'Employment letter'), ('payslip', 'Payslip request'), ('profile_update', 'Profile correction'), ('training', 'Training request'), ('other', 'Other HR request')])
    subject = models.CharField(max_length=180)
    details = models.TextField()
    status = models.CharField(max_length=12, choices=[('open', 'Open'), ('in_progress', 'In progress'), ('resolved', 'Resolved'), ('rejected', 'Rejected')], default='open')
    response = models.TextField(blank=True)
    handled_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
