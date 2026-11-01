"""Shared organization hierarchy, branch boundaries, and group visibility."""
from django.db.models import Q
from Platform_API.modules.mixins import has_active_permission
from Platform_Core.models import Department, OrganizationMembership, TenantBranch


def membership_for(user, tenant):
    return OrganizationMembership.objects.filter(user=user, tenant=tenant, is_active=True).order_by('-is_default', 'pk').first()


def can_manage_unit(user, action='change'):
    return has_active_permission(user, f'Platform_Core.{action}_department')


def platform_branch(tenant, operational=None, user=None):
    if operational is not None:
        from Platform_Core.models import OrganizationBranchLink
        link = OrganizationBranchLink.objects.select_related('branch').filter(operational_branch=operational, branch__tenant=tenant).first()
        return link.branch if link else TenantBranch.objects.filter(tenant=tenant, name=operational.name).first()
    membership = membership_for(user, tenant) if user else None
    return membership.branch if membership else None


def branch_allowed_for_user(user, branch):
    if not branch or not branch.is_active:
        return False
    if user.is_superuser:
        return True
    membership = membership_for(user, branch.tenant)
    if not membership:
        profile = getattr(user, 'tenant_profile', None)
        return bool(profile and profile.tenant_id == branch.tenant_id and (profile.is_tenant_admin or profile.branch_id == branch.pk))
    return membership.is_org_admin or membership.branch_id == branch.pk or membership.branches.filter(pk=branch.pk).exists() or membership.branch_role_assignments.filter(branch=branch, is_active=True).exists()


def unit_available(unit, user, branch=None, *, membership_check=True, active=True):
    tenant_id, visited = unit.tenant_id, set()
    while unit:
        if unit.pk in visited or unit.tenant_id != tenant_id or active and not unit.is_active:
            return False
        visited.add(unit.pk)
        if unit.branch_scope == 'selected' and (not branch or not unit.branches.filter(pk=branch.pk, tenant_id=tenant_id, is_active=True).exists()):
            return False
        if membership_check and unit.access_mode == 'members' and not can_manage_unit(user) and not (unit.head_id == user.pk or unit.deputy_id == user.pk or unit.members.filter(pk=user.pk).exists()):
            return False
        unit = unit.parent
    return True


def visible_units(user, tenant, *, catalog=False):
    qs = Department.objects.filter(tenant=tenant).select_related('head', 'deputy', 'parent').prefetch_related('members', 'branches')
    if catalog and any(can_manage_unit(user, action) for action in ['view', 'add', 'change']):
        return qs
    branch = platform_branch(tenant, user=user)
    return qs.filter(pk__in=[unit.pk for unit in qs if unit_available(unit, user, branch)])

def ensure_structure_menu():
    from django.apps import apps
    from django.db import connection
    alias = connection.alias
    Section = apps.get_model('Platform_Core', 'WorkspaceMenuSection')
    Item = apps.get_model('Platform_Core', 'WorkspaceMenuItem')
    Module = apps.get_model('Platform_Core', 'ModuleDefinition')
    Item.objects.using(alias).filter(route_path='/platform/organization-structure').update(is_active=False)
    section = Section.objects.using(alias).filter(key='organization-settings').first()
    if section and not Item.objects.using(alias).filter(section=section, is_active=True).exists():
        Section.objects.using(alias).filter(pk=section.pk).update(is_active=False)
    module = Module.objects.using(alias).filter(slug='procurement').first()
    procurement, _ = Section.objects.using(alias).get_or_create(key='procurement', defaults={'title': 'Procurement', 'icon': 'shopping-cart', 'module': module, 'sort_order': 50, 'is_active': True})
    Item.objects.using(alias).filter(route_path='/procurement/departments').update(is_active=False)
    Item.objects.using(alias).update_or_create(section=procurement, key='configuration', defaults={
        'title': 'Configuration', 'icon': 'settings', 'route_path': '/procurement/configuration', 'api_path': '/api/procurement/configuration/', 'required_module': module, 'required_permission': '',
        'metadata': {'required_any_permissions': ['SL_Procurement.view_procurementpolicy', 'SL_Procurement.change_procurementpolicy', 'SL_Procurement.change_approvalmatrix']}, 'sort_order': 20, 'is_active': True})
