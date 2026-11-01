"""Organization-owned departments and other organizational groupings."""
from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from Platform_API.modules.mixins import tenant_or_403
from Platform_Core.audit import log_business_event
from Platform_Core.models import Department, OrganizationMembership, Tenant, TenantBranch
from Platform_Core.organization import can_manage_unit, visible_units, branch_allowed_for_user


def organization_for(user):
    tenant = tenant_or_403(user)
    if tenant is None:
        raise PermissionDenied('Select an organization first.')
    return tenant


class OrganizationUnitSerializer(serializers.ModelSerializer):
    head_name = serializers.SerializerMethodField()
    deputy_name = serializers.SerializerMethodField()
    organization_id = serializers.IntegerField(source='tenant_id', read_only=True)
    class Meta:
        model = Department
        exclude = ['tenant']

    def get_head_name(self, obj):
        return obj.head.get_full_name() or obj.head.username

    def get_deputy_name(self, obj):
        return (obj.deputy.get_full_name() or obj.deputy.username) if obj.deputy_id else ''

    def validate(self, data):
        tenant = self.context['tenant']
        if self.instance and data == {'is_active': False}:
            return data
        instance = self.instance
        value = lambda name, default=None: data.get(name, getattr(instance, name, default))
        if Department.objects.filter(tenant=tenant, code__iexact=value('code', '').strip()).exclude(pk=getattr(instance, 'pk', None)).exists():
            raise ValidationError({'code': 'This code is already used in this organization.'})
        if 'code' in data:
            data['code'] = data['code'].strip()
        head, deputy = value('head'), value('deputy')
        if head and deputy and head.pk == deputy.pk:
            raise ValidationError({'deputy': 'Choose different users for head and deputy.'})
        users = list(data.get('members', instance.members.all() if instance else [])) + [user for user in [head, deputy] if user]
        for user in users:
            if not OrganizationMembership.objects.filter(tenant=tenant, user=user, is_active=True, user__is_active=True).exists():
                raise ValidationError({'members': 'Choose active members of this organization.'})
        branches = list(data.get('branches', instance.branches.all() if instance else []))
        if any(branch.tenant_id != tenant.pk or not branch.is_active for branch in branches):
            raise ValidationError({'branches': 'Choose active branches of this organization.'})
        if value('branch_scope', 'all') == 'selected' and not branches:
            raise ValidationError({'branches': 'Select at least one branch for restricted access.'})
        if value('branch_scope', 'all') == 'selected':
            for user in users:
                if not any(branch_allowed_for_user(user, branch) for branch in branches):
                    raise ValidationError({'members': 'Every selected head, deputy, and member must have organization access to an allowed branch.'})
        parent, visited = value('parent'), set()
        while parent:
            if parent.tenant_id != tenant.pk or not parent.is_active:
                raise ValidationError({'parent': 'Choose an active parent grouping in this organization.'})
            if parent.pk in visited or instance and parent.pk == instance.pk:
                raise ValidationError({'parent': 'The hierarchy cannot contain a cycle.'})
            visited.add(parent.pk)
            parent = parent.parent
        if instance and value('unit_type') != instance.unit_type and (instance.requisitions.exists() or instance.employees.exists()):
            raise ValidationError({'unit_type': 'A department linked to employee or requisition history must remain a department.'})
        return data


class OrganizationUnitOptionsView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        tenant = organization_for(request.user)
        permissions = {action: can_manage_unit(request.user, action) for action in ['view', 'add', 'change', 'delete']}
        users = OrganizationMembership.objects.filter(tenant=tenant, is_active=True, user__is_active=True).select_related('user')
        return Response({'organization': {'id': tenant.pk, 'name': tenant.name}, 'permissions': permissions,
            'unit_types': [{'value': key, 'label': label} for key, label in Department.UNIT_TYPES],
            'branches': list(TenantBranch.objects.filter(tenant=tenant, is_active=True).values('id', 'name')),
            'units': list(visible_units(request.user, tenant, catalog=True).filter(is_active=True).values('id', 'name', 'unit_type')),
            'users': [{'id': member.user_id, 'name': member.user.get_full_name() or member.user.username} for member in users] if any(permissions.values()) else []})


class UnitPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 100


class OrganizationUnitListView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        tenant = organization_for(request.user)
        qs = visible_units(request.user, tenant, catalog=True)
        if search := request.query_params.get('search', '').strip():
            qs = qs.filter(Q(name__icontains=search) | Q(code__icontains=search))
        if kind := request.query_params.get('unit_type'):
            qs = qs.filter(unit_type=kind)
        pager = UnitPagination()
        ordering = request.query_params.get('ordering', 'name')
        if ordering not in {'name', '-name', 'code', '-code', 'id', '-id'}:
            ordering = 'name'
        rows = pager.paginate_queryset(qs.order_by(ordering, 'pk'), request)
        return pager.get_paginated_response(OrganizationUnitSerializer(rows, many=True).data)

    @transaction.atomic
    def post(self, request):
        if not can_manage_unit(request.user, 'add'):
            raise PermissionDenied('Your active role cannot create organization groupings.')
        tenant = organization_for(request.user)
        Tenant.objects.select_for_update().get(pk=tenant.pk)
        serializer = OrganizationUnitSerializer(data=request.data, context={'tenant': tenant})
        serializer.is_valid(raise_exception=True)
        unit = serializer.save(tenant=tenant)
        log_business_event(event_group='data_lifecycle', event_type='create', tenant=tenant, actor=request.user, obj=unit, note='Organization grouping created.')
        return Response(serializer.data, status=201)


class OrganizationUnitDetailView(APIView):
    permission_classes = [IsAuthenticated]
    @transaction.atomic
    def patch(self, request, pk):
        if not can_manage_unit(request.user):
            raise PermissionDenied('Your active role cannot change organization groupings.')
        tenant = organization_for(request.user)
        Tenant.objects.select_for_update().get(pk=tenant.pk)
        unit = get_object_or_404(Department, tenant=tenant, pk=pk)
        serializer = OrganizationUnitSerializer(unit, data=request.data, partial=True, context={'tenant': tenant})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        log_business_event(event_group='data_lifecycle', event_type='update', tenant=tenant, actor=request.user, obj=unit, note='Organization grouping updated.')
        return Response(serializer.data)

    def delete(self, request, pk):
        if not can_manage_unit(request.user, 'delete'):
            raise PermissionDenied('Your active role cannot remove organization groupings.')
        get_object_or_404(Department, tenant=organization_for(request.user), pk=pk)
        raise ValidationError({'department': 'Deactivate organizational groupings to retain ERP history.'})