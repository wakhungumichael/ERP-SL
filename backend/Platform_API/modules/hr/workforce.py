"""Private employee records, onboarding, leave and employee self service."""
import calendar
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

from django.db import transaction
from django.db.models import Q, Sum
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from Platform_API.modules.hr.views import _resolved_tenant_or_403, _user_belongs_to_tenant
from Platform_API.modules.mixins import has_active_permission
from Platform_Core.audit import log_business_event
from Platform_Core.models import OrganizationMembership, SystemNotification
from SL_HR.models import Employee, EmployeeDocument, EmployeeServiceRequest, HRPolicy, LeaveAllocation, LeaveRequest, PayRecord


def can(user, codename):
    membership = OrganizationMembership.objects.filter(user=user, is_active=True).order_by('-is_default', 'tenant__name').first()
    role = membership.effective_role_group_name() if membership else ''
    if role.startswith('tenant:') and not role.startswith(f'tenant:{membership.tenant_id}:'):
        return False
    if role and role not in {'Tenant Admin', 'Platform Admin', 'Super Admin'} and not user.is_superuser:
        group = user.groups.filter(name=role).first()
        return bool(group and group.permissions.filter(content_type__app_label='SL_HR', codename=codename).exists())
    return has_active_permission(user, f'SL_HR.{codename}')


def require(user, codename):
    if not can(user, codename):
        raise PermissionDenied('Your active role does not have permission for this HR action.')


def tenant_for(user):
    tenant = _resolved_tenant_or_403(user)
    from Platform_Core.platform import get_active_tenant_module_slugs
    if not user.is_superuser and not set(get_active_tenant_module_slugs(tenant)) & {'hr', 'hr-payroll', 'hcm'}:
        raise PermissionDenied('HR is not enabled for this organization.')
    return tenant


def employees(user):
    qs = Employee.objects.filter(tenant=tenant_for(user)).select_related('user', 'manager', 'department')
    return qs if can(user, 'view_all_employee') or can(user, 'change_employee') else qs.filter(user=user)


def policy(tenant):
    return HRPolicy.objects.get_or_create(tenant=tenant)[0]


def event(request, obj, action, note):
    employee = getattr(obj, 'employee', obj)
    log_business_event(event_group='data_lifecycle', event_type=action, tenant=employee.tenant, actor=request.user, obj=obj, note=note)


class Pages(PageNumberPagination):
    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 100


def paged(request, qs, serializer):
    paginator = Pages()
    return paginator.get_paginated_response(serializer(paginator.paginate_queryset(qs, request), many=True).data)


class PolicySerializer(serializers.ModelSerializer):
    class Meta:
        model = HRPolicy
        exclude = ['id', 'tenant']
        read_only_fields = ['updated_at']

    def validate(self, data):
        for key, floor in [('annual_leave_days', 21), ('sick_full_pay_days', 7), ('sick_half_pay_days', 7)]:
            if key in data and data[key] < floor:
                raise ValidationError({key: f'Kenyan statutory minimum is {floor} days; enhanced terms may be configured.'})
        if 'working_days' in data:
            days = data['working_days']
            if not isinstance(days, list) or not days or any(type(d) is not int or d not in range(7) for d in days) or len(set(days)) != len(days):
                raise ValidationError({'working_days': 'Choose distinct weekday numbers, Monday 0 to Sunday 6.'})
        if 'public_holidays' in data:
            if not isinstance(data['public_holidays'], list):
                raise ValidationError({'public_holidays': 'Use an array of YYYY-MM-DD dates.'})
            try:
                for value in data['public_holidays']:
                    date.fromisoformat(value)
            except (ValueError, TypeError):
                raise ValidationError({'public_holidays': 'Use YYYY-MM-DD dates.'})
        if 'required_documents' in data and (not isinstance(data['required_documents'], list) or any(not isinstance(x, str) or not x.strip() or len(x)>60 for x in data['required_documents'])):
            raise ValidationError({'required_documents': 'Use document type names, each up to 60 characters.'})
        group = data.get('leave_approver_group')
        if group and group.name.startswith('tenant:') and not group.name.startswith(f'tenant:{self.context["tenant"].pk}:'):
            raise ValidationError({'leave_approver_group': 'Choose a role belonging to this organization.'})
        if group and not group.user_set.filter(is_active=True, organization_memberships__tenant=self.context['tenant'], organization_memberships__is_active=True).exists():
            raise ValidationError({'leave_approver_group': 'Choose a group with active members in this organization.'})
        return data


class HRSettingsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        tenant = tenant_for(request.user)
        require(request.user, 'view_hrpolicy')
        return Response(PolicySerializer(policy(tenant)).data)

    def patch(self, request):
        tenant = tenant_for(request.user)
        require(request.user, 'change_hrpolicy')
        ser = PolicySerializer(policy(tenant), data=request.data, partial=True, context={'tenant': tenant})
        ser.is_valid(raise_exception=True)
        ser.save()
        log_business_event(event_group='configuration', event_type='update', tenant=tenant, actor=request.user, obj=ser.instance, note='HR policy updated.')
        return Response(ser.data)


class EmployeeSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source='department.name', read_only=True)
    manager_name = serializers.SerializerMethodField()
    missing_documents = serializers.SerializerMethodField()

    class Meta:
        model = Employee
        exclude = ['tenant']
        read_only_fields = ['created_at', 'updated_at']

    def get_manager_name(self, obj):
        return (obj.manager.get_full_name() or obj.manager.username) if obj.manager_id else ''

    def get_missing_documents(self, obj):
        verified = set(obj.documents.filter(verified_by__isnull=False).filter(Q(expires_on__isnull=True) | Q(expires_on__gte=timezone.localdate())).values_list('document_type', flat=True))
        return [name for name in policy(obj.tenant).required_documents if name not in verified]

    def create(self, validated_data):
        obj = super().create(validated_data)
        if obj.department_id and obj.user_id:
            obj.department.members.add(obj.user)
        return obj

    def update(self, instance, validated_data):
        previous_department, previous_user = instance.department, instance.user
        obj = super().update(instance, validated_data)
        if previous_department and previous_user and (previous_department.pk != obj.department_id or previous_user.pk != obj.user_id):
            if previous_user.pk not in {previous_department.head_id, previous_department.deputy_id}:
                previous_department.members.remove(previous_user)
        if obj.department_id and obj.user_id:
            obj.department.members.add(obj.user)
        return obj

    def validate(self, data):
        tenant = self.context['tenant']
        for name in ['user', 'manager']:
            if data.get(name) and (not data[name].is_active or not _user_belongs_to_tenant(data[name], tenant)):
                raise ValidationError({name: 'Choose an active member of this organization.'})
        if data.get('department') and data['department'].tenant_id != tenant.pk:
            raise ValidationError({'department': 'Choose a department in this organization.'})
        for field in ['employee_number', 'user']:
            value = data.get(field, getattr(self.instance, field, None))
            if value is not None and Employee.objects.filter(tenant=tenant, **{field: value}).exclude(pk=getattr(self.instance, 'pk', None)).exists():
                raise ValidationError({field: 'An employee record already uses this value in this organization.'})
        if data.get('exit_date') and data['exit_date'] < data.get('start_date', getattr(self.instance, 'start_date', data['exit_date'])):
            raise ValidationError({'exit_date': 'Exit date cannot precede employment start.'})
        if 'status' in data and data['status'] == 'active' and (not self.instance or self.instance.status == 'onboarding'):
            raise ValidationError({'status': 'Use Complete onboarding after verifying required documents.'})
        return data


class EmployeeListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = employees(request.user)
        if q := request.query_params.get('search'):
            qs = qs.filter(Q(full_name__icontains=q) | Q(employee_number__icontains=q) | Q(department__name__icontains=q))
        if value := request.query_params.get('status'):
            qs = qs.filter(status=value)
        response = paged(request, qs, EmployeeSerializer)
        response.data['access'] = {name: can(request.user, name) for name in ['add_employee', 'change_employee', 'manage_onboarding', 'view_all_employee', 'approve_leaverequest', 'change_hrpolicy', 'request_own_leave', 'add_employeeservicerequest', 'add_employeedocument', 'change_employeedocument', 'delete_employeedocument', 'change_leaveallocation', 'change_employeeservicerequest', 'view_payperiod', 'add_leaverequest']}
        return response

    def post(self, request):
        tenant = tenant_for(request.user)
        require(request.user, 'add_employee')
        ser = EmployeeSerializer(data=request.data, context={'tenant': tenant})
        ser.is_valid(raise_exception=True)
        obj = ser.save(tenant=tenant)
        event(request, obj, 'create', 'Employee onboarding record created.')
        return Response(EmployeeSerializer(obj).data, status=201)


class EmployeeDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        return Response(EmployeeSerializer(get_object_or_404(employees(request.user), pk=pk)).data)

    def patch(self, request, pk):
        require(request.user, 'change_employee')
        obj = get_object_or_404(employees(request.user), pk=pk)
        ser = EmployeeSerializer(obj, data=request.data, partial=True, context={'tenant': obj.tenant})
        ser.is_valid(raise_exception=True)
        obj = ser.save()
        event(request, obj, 'update', 'Employee record updated.')
        return Response(ser.data)

    def post(self, request, pk):
        require(request.user, 'manage_onboarding')
        obj = get_object_or_404(Employee.objects.filter(tenant=tenant_for(request.user)), pk=pk)
        missing = EmployeeSerializer(obj).data['missing_documents']
        if missing:
            raise ValidationError({'documents': 'Verify the required documents: ' + ', '.join(missing)})
        if obj.status != 'onboarding':
            raise ValidationError({'status': 'Only onboarding employees can be activated.'})
        obj.status = 'active'
        obj.save(update_fields=['status', 'updated_at'])
        event(request, obj, 'update', 'Employee onboarding completed.')
        return Response(EmployeeSerializer(obj).data)


class DocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmployeeDocument
        fields = ['id', 'employee', 'document_type', 'name', 'content_type', 'size', 'expires_on', 'verified_by', 'created_at']
        read_only_fields = fields


class EmployeeDocumentsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        obj = get_object_or_404(employees(request.user), pk=pk)
        return Response({'results': DocumentSerializer(obj.documents.order_by('-created_at'), many=True).data})

    def post(self, request, pk):
        obj = get_object_or_404(employees(request.user), pk=pk)
        require(request.user, 'add_employeedocument')
        upload = request.FILES.get('file')
        if not upload or upload.size > 10*1024*1024 or upload.size == 0:
            raise ValidationError({'file': 'Choose a non-empty PDF, PNG, JPG or DOCX file up to 10 MB.'})
        suffix = Path(upload.name).suffix.lower()
        allowed = {'.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}
        if suffix not in allowed:
            raise ValidationError({'file': 'Use PDF, PNG, JPG or DOCX.'})
        kind = serializers.CharField(max_length=60).run_validation(request.data.get('document_type'))
        expires = serializers.DateField(allow_null=True).run_validation(request.data.get('expires_on') or None)
        content = upload.read()
        signatures = {'.pdf': b'%PDF', '.png': b'\x89PNG\r\n\x1a\n', '.jpg': b'\xff\xd8\xff', '.jpeg': b'\xff\xd8\xff', '.docx': b'PK'}
        if not content.startswith(signatures[suffix]):
            raise ValidationError({'file': 'The file contents do not match its extension.'})
        doc = EmployeeDocument.objects.create(employee=obj, document_type=kind, name=Path(upload.name).name, content_type=allowed[suffix], size=upload.size, content=content, expires_on=expires, uploaded_by=request.user)
        event(request, doc, 'create', f'Employee document attached: {kind}.')
        return Response(DocumentSerializer(doc).data, status=201)


class EmployeeDocumentView(APIView):
    permission_classes = [IsAuthenticated]

    def get_doc(self, request, pk, document_id):
        obj = get_object_or_404(employees(request.user), pk=pk)
        return get_object_or_404(obj.documents, pk=document_id)

    def get(self, request, pk, document_id):
        doc = self.get_doc(request, pk, document_id)
        from django.utils.http import content_disposition_header
        response = HttpResponse(bytes(doc.content), content_type=doc.content_type)
        response['Content-Disposition'] = content_disposition_header(True, doc.name)
        response['Cache-Control'] = 'private, no-store'
        response['X-Content-Type-Options'] = 'nosniff'
        return response

    def patch(self, request, pk, document_id):
        require(request.user, 'change_employeedocument')
        doc = self.get_doc(request, pk, document_id)
        doc.verified_by = request.user
        doc.save(update_fields=['verified_by'])
        event(request, doc, 'update', 'Employee document verified.')
        return Response(DocumentSerializer(doc).data)

    def delete(self, request, pk, document_id):
        require(request.user, 'delete_employeedocument')
        doc = self.get_doc(request, pk, document_id)
        if doc.leaverequest_set.exists():
            raise ValidationError({'document': 'Document supports a leave request and must be retained.'})
        event(request, doc, 'delete', 'Employee document removed.')
        doc.delete()
        return Response(status=204)


def add_months(value, months):
    index = value.month - 1 + months
    year, month = value.year + index//12, index%12+1
    return date(year, month, min(value.day, calendar.monthrange(year, month)[1]))


def leave_days(start, end, kind, config):
    if kind in {'maternity', 'paternity', 'pre_adoptive'}:
        return (end-start).days+1
    # Fixed national holidays; HR adds movable and gazetted holidays in settings.
    fixed = {(1, 1), (5, 1), (6, 1), (10, 10), (10, 20), (12, 12), (12, 25), (12, 26)}
    holidays = set(config.public_holidays)
    for year in range(start.year, end.year+1):
        for month, day in fixed:
            holiday = date(year, month, day)
            if holiday.weekday() == 6:
                holidays.add((holiday+timedelta(days=1)).isoformat())
    total = 0
    cursor = start
    while cursor <= end:
        if cursor.weekday() in config.working_days and cursor.isoformat() not in holidays and (cursor.month, cursor.day) not in fixed:
            total += 1
        cursor += timedelta(days=1)
    return total


def leave_balance(employee, year, kind, config, exclude=None):
    entitlement = {'annual': config.annual_leave_days, 'sick_full': config.sick_full_pay_days, 'sick_half': config.sick_half_pay_days}.get(kind)
    if entitlement is None:
        return None
    additional = LeaveAllocation.objects.filter(employee=employee, year=year, leave_type=kind).aggregate(total=Sum('additional_days'))['total'] or Decimal('0')
    used = LeaveRequest.objects.filter(employee=employee, leave_type=kind, start_date__year=year, status__in=['submitted', 'approved']).exclude(pk=exclude).aggregate(total=Sum('days'))['total'] or Decimal('0')
    carry = Decimal('0')
    if kind == 'annual' and config.carry_forward_limit and employee.start_date.year < year:
        previous_extra = LeaveAllocation.objects.filter(employee=employee, year=year-1, leave_type=kind).aggregate(total=Sum('additional_days'))['total'] or Decimal('0')
        previous_used = LeaveRequest.objects.filter(employee=employee, leave_type=kind, start_date__year=year-1, status__in=['submitted', 'approved']).aggregate(total=Sum('days'))['total'] or Decimal('0')
        carry = min(Decimal(config.carry_forward_limit), max(Decimal('0'), Decimal(entitlement)+previous_extra-previous_used))
    return Decimal(entitlement)+carry+additional-used


class LeaveSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    class Meta:
        model = LeaveRequest
        fields = '__all__'
        read_only_fields = ['days', 'status', 'reviewed_by', 'reviewed_at', 'decision_notes', 'created_at', 'updated_at']

    def validate(self, data):
        employee = data.get('employee', getattr(self.instance, 'employee', None))
        if employee and not employees(self.context['request'].user).filter(pk=employee.pk).exists():
            raise ValidationError({'employee': 'Choose an employee visible in this organization.'})
        start = data.get('start_date', getattr(self.instance, 'start_date', None))
        end = data.get('end_date', getattr(self.instance, 'end_date', None))
        if start and end and (end < start or end-start > timedelta(days=366)):
            raise ValidationError({'end_date': 'Choose a valid range of up to one year.'})
        if start and end and start.year != end.year and data.get('leave_type', getattr(self.instance, 'leave_type', '')) in {'annual', 'sick_full', 'sick_half'}:
            raise ValidationError({'end_date': 'Split annual or sick leave at the year boundary for correct balances.'})
        doc = data.get('supporting_document')
        if doc and doc.employee_id != employee.pk:
            raise ValidationError({'supporting_document': 'Choose this employee’s supporting document.'})
        return data


def leave_scope(user):
    tenant = tenant_for(user)
    qs = LeaveRequest.objects.filter(employee__tenant=tenant).select_related('employee', 'employee__manager', 'employee__department')
    config = policy(tenant)
    if can(user, 'view_all_leaverequest') or (can(user, 'approve_leaverequest') and config.leave_approver_group_id and user.groups.filter(pk=config.leave_approver_group_id).exists()):
        return qs
    if can(user, 'approve_leaverequest'):
        return qs.filter(Q(employee__user=user) | Q(employee__manager=user) | Q(employee__department__head=user) | Q(employee__department__deputy=user))
    return qs.filter(employee__user=user)


def validate_submission(obj, config):
    if obj.employee.status not in {'active', 'on_leave'}:
        raise ValidationError({'employee': 'Complete employee onboarding before requesting leave.'})
    if obj.start_date < obj.employee.start_date:
        raise ValidationError({'start_date': 'Leave cannot precede employment.'})
    if LeaveRequest.objects.filter(employee=obj.employee, status__in=['submitted', 'approved'], start_date__lte=obj.end_date, end_date__gte=obj.start_date).exclude(pk=obj.pk).exists():
        raise ValidationError({'dates': 'This request overlaps another submitted or approved leave request.'})
    if obj.leave_type == 'pre_adoptive' and not obj.supporting_document_id:
        raise ValidationError({'supporting_document': 'Attach the placement or custody documentation for pre-adoptive leave.'})
    if obj.leave_type == 'sick_half' and leave_balance(obj.employee, obj.start_date.year, 'sick_full', config) > 0:
        raise ValidationError({'leave_type': 'Use the full-pay sick leave balance before requesting half-pay sick leave.'})
    if obj.leave_type in {'sick_full', 'sick_half'}:
        if obj.start_date < add_months(obj.employee.start_date, 2):
            raise ValidationError({'start_date': 'Sick leave requires two consecutive months of service.'})
        if not obj.supporting_document_id:
            raise ValidationError({'supporting_document': 'Attach medical evidence for sick leave.'})
    limits = {'maternity': add_months(obj.start_date, 3)-timedelta(days=1), 'pre_adoptive': add_months(obj.start_date, 1)-timedelta(days=1), 'paternity': obj.start_date+timedelta(days=13)}
    if obj.leave_type in limits and obj.end_date > limits[obj.leave_type]:
        raise ValidationError({'end_date': 'Range exceeds this statutory leave period. Submit any extension separately under the appropriate leave type.'})
    days = leave_days(obj.start_date, obj.end_date, obj.leave_type, config)
    if days <= 0:
        raise ValidationError({'dates': 'This request contains no chargeable leave days.'})
    balance = leave_balance(obj.employee, obj.start_date.year, obj.leave_type, config, exclude=obj.pk)
    if balance is not None and days > balance:
        raise ValidationError({'days': f'Insufficient leave balance: {balance} days available.'})
    obj.days = days


class LeaveListView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        qs = leave_scope(request.user)
        if value := request.query_params.get('status'):
            qs = qs.filter(status=value)
        if q := request.query_params.get('search'):
            qs = qs.filter(Q(employee__full_name__icontains=q) | Q(reason__icontains=q))
        response = paged(request, qs, LeaveSerializer)
        own = employees(request.user).filter(user=request.user).first()
        config = policy(tenant_for(request.user))
        response.data['balances'] = {kind: leave_balance(own, timezone.localdate().year, kind, config) for kind in ['annual', 'sick_full', 'sick_half']} if own else {}
        response.data['leave_types'] = LeaveRequest.LEAVE_TYPES
        response.data['can_approve'] = can(request.user, 'approve_leaverequest')
        return response

    @transaction.atomic
    def post(self, request):
        if not can(request.user, 'request_own_leave'):
            require(request.user, 'add_leaverequest')
        ser = LeaveSerializer(data=request.data, context={'request': request})
        ser.is_valid(raise_exception=True)
        emp = get_object_or_404(Employee.objects.select_for_update(), pk=ser.validated_data['employee'].pk)
        if emp.user_id != request.user.pk:
            require(request.user, 'add_leaverequest')
        obj = ser.save(days=0, status='draft')
        obj.days = leave_days(obj.start_date, obj.end_date, obj.leave_type, policy(emp.tenant))
        obj.save(update_fields=['days'])
        event(request, obj, 'create', 'Leave request drafted.')
        return Response(LeaveSerializer(obj).data, status=201)


class LeaveActionView(APIView):
    permission_classes = [IsAuthenticated]
    @transaction.atomic
    def post(self, request, pk):
        obj = get_object_or_404(leave_scope(request.user).select_for_update(of=('self',)), pk=pk)
        Employee.objects.select_for_update().get(pk=obj.employee_id)
        action = request.data.get('action')
        config = policy(obj.employee.tenant)
        if action in {'submit', 'cancel'}:
            if obj.employee.user_id != request.user.pk:
                require(request.user, 'change_leaverequest')
            else:
                require(request.user, 'request_own_leave')
            if action == 'submit':
                if obj.status != 'draft':
                    raise ValidationError({'status': 'Only draft requests may be submitted.'})
                validate_submission(obj, config)
                obj.status = 'submitted'
            else:
                if obj.status not in {'draft', 'submitted'}:
                    raise ValidationError({'status': 'Only drafts or submitted requests may be cancelled by the employee.'})
                obj.status = 'cancelled'
        elif action in {'approve', 'reject', 'revoke'}:
            require(request.user, 'approve_leaverequest')
            if obj.employee.user_id == request.user.pk:
                raise PermissionDenied('Employees cannot approve their own leave.')
            if action == 'revoke' and obj.status != 'approved' or action != 'revoke' and obj.status != 'submitted':
                raise ValidationError({'status': 'Request is not awaiting this action.'})
            if config.leave_approver_group_id and not request.user.is_superuser:
                admin = OrganizationMembership.objects.filter(user=request.user, tenant=obj.employee.tenant, is_active=True, is_org_admin=True).exists()
                if not admin and not request.user.groups.filter(pk=config.leave_approver_group_id).exists():
                    raise PermissionDenied('Your role is not in the configured leave approval group.')
            notes = serializers.CharField(allow_blank=action=='approve').run_validation(request.data.get('notes', ''))
            if action == 'approve':
                validate_submission(obj, config)
            obj.status = {'approve': 'approved', 'reject': 'rejected', 'revoke': 'cancelled'}[action]
            obj.reviewed_by, obj.reviewed_at, obj.decision_notes = request.user, timezone.now(), notes
        else:
            raise ValidationError({'action': 'Choose submit, cancel, approve, reject or revoke.'})
        obj.save()
        event(request, obj, 'update', f'Leave request {action}.')
        recipient = obj.employee.user if action != 'submit' else obj.employee.manager or (obj.employee.department.head if obj.employee.department_id else None)
        if recipient and recipient.pk != request.user.pk:
            SystemNotification.objects.update_or_create(
                tenant=obj.employee.tenant,
                recipient=recipient,
                source_type='hr_leave',
                source_id=obj.pk,
                defaults={
                    'category': 'reminder',
                    'title': f'Leave request {obj.status}',
                    'message': f'{obj.employee.full_name}: {obj.get_leave_type_display()} {obj.start_date} to {obj.end_date}.',
                    'route_path': '/hr/leave',
                    'is_read': False,
                    'read_at': None,
                },
            )
        return Response(LeaveSerializer(obj).data)


class LeaveAllocationView(APIView):
    permission_classes = [IsAuthenticated]
    @transaction.atomic
    def post(self, request):
        require(request.user, 'change_leaveallocation')
        emp = get_object_or_404(Employee.objects.select_for_update().filter(tenant=tenant_for(request.user)), pk=serializers.IntegerField().run_validation(request.data.get('employee')))
        year = serializers.IntegerField(min_value=2000, max_value=2200).run_validation(request.data.get('year'))
        kind = serializers.ChoiceField(choices=['annual', 'sick_full', 'sick_half']).run_validation(request.data.get('leave_type'))
        days = serializers.DecimalField(max_digits=6, decimal_places=2).run_validation(request.data.get('additional_days'))
        notes = serializers.CharField().run_validation(request.data.get('notes'))
        obj, _ = LeaveAllocation.objects.update_or_create(employee=emp, year=year, leave_type=kind, defaults={'additional_days': days, 'notes': notes})
        if leave_balance(emp, year, kind, policy(emp.tenant)) < 0:
            raise ValidationError({'additional_days': 'Adjustment cannot make the leave balance negative.'})
        event(request, obj, 'update', 'Leave balance adjustment recorded: ' + notes)
        return Response({'id': obj.pk, 'balance': leave_balance(emp, year, kind, policy(emp.tenant))})


class ServiceSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    class Meta:
        model = EmployeeServiceRequest
        fields = '__all__'
        read_only_fields = ['status', 'response', 'handled_by', 'created_at', 'updated_at']


class EmployeeServiceView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        qs = EmployeeServiceRequest.objects.filter(employee__tenant=tenant_for(request.user)).select_related('employee').order_by('-created_at')
        if not can(request.user, 'change_employeeservicerequest'):
            qs = qs.filter(employee__user=request.user)
        return paged(request, qs, ServiceSerializer)

    def post(self, request):
        require(request.user, 'add_employeeservicerequest')
        ser = ServiceSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        emp = ser.validated_data['employee']
        if not employees(request.user).filter(pk=emp.pk, user=request.user).exists():
            raise PermissionDenied('Submit employee service requests for your own profile.')
        obj = ser.save()
        event(request, obj, 'create', 'Employee service request opened.')
        return Response(ser.data, status=201)


class EmployeeServiceDetailView(APIView):
    permission_classes = [IsAuthenticated]
    def patch(self, request, pk):
        require(request.user, 'change_employeeservicerequest')
        obj = get_object_or_404(EmployeeServiceRequest.objects.filter(employee__tenant=tenant_for(request.user)), pk=pk)
        obj.status = serializers.ChoiceField(choices=['in_progress', 'resolved', 'rejected']).run_validation(request.data.get('status'))
        obj.response = serializers.CharField().run_validation(request.data.get('response'))
        obj.handled_by = request.user
        obj.save()
        event(request, obj, 'update', 'Employee service request handled.')
        return Response(ServiceSerializer(obj).data)


class MyPayslipsView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        tenant = tenant_for(request.user)
        from Platform_API.modules.hr.views import PayRecordSerializer
        qs = PayRecord.objects.filter(period__tenant=tenant, employee=request.user, period__status='Completed').select_related('employee', 'period').order_by('-period__period_start')
        return Response({'results': [{**PayRecordSerializer(row).data, 'period_name': row.period.name} for row in qs]})
