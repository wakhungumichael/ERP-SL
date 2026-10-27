"""Add missing tenant setup and explicitly selected, removable master examples."""
import hashlib
import json
from io import StringIO

from django.apps import apps
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from Platform_Core.models import Account, Journal, OrganizationSetupImport, Tenant

MARKER = '[ERP DEMO MASTER v1]'
CATALOG = [
    {'key': 'workflows', 'name': 'Standard workflows', 'description': 'Add missing approval workflows. Existing customized or disabled setups are preserved.'},
    {'key': 'approval_rules', 'name': 'Procurement approval rules', 'description': 'Starter amount bands using existing staffed approval groups; existing rules are preserved.'},
    {'key': 'finance_masters', 'name': 'Chart of accounts & journals', 'description': 'Add missing standard accounts and journals. Opening balances and transactions are not created.'},
    {'key': 'hr_defaults', 'name': 'HR defaults & employee role', 'description': 'Kenyan leave defaults and an unassigned employee self-service role.'},
    {'key': 'demo_masters', 'name': 'Optional demo master data', 'description': 'Clearly marked sample customers, suppliers, products and services.'},
    {'key': 'project_samples', 'name': 'Optional demo projects', 'description': 'Sample projects, tasks, milestones and follow-ups assigned to existing organization members.'},
]


def fingerprint(obj):
    fields = {field.attname: field.value_from_object(obj) for field in obj._meta.concrete_fields if field.name not in {'created_at', 'updated_at'}}
    return hashlib.sha256(json.dumps(fields, sort_keys=True, default=str).encode()).hexdigest()


@transaction.atomic
def import_setup(tenant, actor, selections, *, publish=True, dry_run=False):
    from django.contrib.auth.models import Group, Permission
    from Platform_Core.accounting import DEFAULT_ACCOUNT_MATRIX, DEFAULT_JOURNALS
    from SL_CRM.models import Supplier
    from SL_HR.models import HRPolicy
    from SL_Procurement.models import ApprovalMatrix, ProcurementPolicy
    from SL_Procurement.management.commands.seed_procurement_approval_matrix import DEFAULT_RULES
    from SL_Sales.models import Product
    from SL_Weighbridge.models import Customer
    from Platform_Core.management.commands.seed_workflows import Command as WorkflowSeeder

    Tenant.objects.select_for_update().get(pk=tenant.pk)
    allowed = {entry['key'] for entry in CATALOG}
    if not selections or not set(selections) <= allowed:
        raise ValidationError({'selections': 'Choose one or more available setup packages.'})
    report, records = {}, []
    def example(model, lookup, defaults):
        obj, made = model.objects.get_or_create(tenant=tenant, **lookup, defaults=defaults)
        if made:
            obj.refresh_from_db()
            records.append({'model': obj._meta.label, 'pk': obj.pk, 'fingerprint': fingerprint(obj)})
        return int(made)
    if 'workflows' in selections:
        before = tenant.workflow_definitions.count()
        output = StringIO()
        call_command('seed_workflows', tenant_code=tenant.code, publish=publish, stdout=output)
        report['workflows'] = {'created': tenant.workflow_definitions.count()-before, 'activation': 'published' if publish else 'draft'}
    if 'approval_rules' in selections:
        count = 0
        preserved = ApprovalMatrix.objects.filter(tenant=tenant).exists() or ProcurementPolicy.objects.filter(tenant=tenant, approval_source='matrix').exists()
        if not preserved:
            chooser = WorkflowSeeder()
            chooser.stdout = StringIO()
            for rule in DEFAULT_RULES:
                group = chooser._group(tenant, rule['group_name'])
                ApprovalMatrix.objects.create(tenant=tenant, name=rule['name'], cost_center=rule['cost_center'], min_amount=rule['min_amount'], max_amount=rule['max_amount'], step_order=rule['step_order'], approval_group=group, metadata={'source': 'organization-setup-import'})
                count += 1
        report['approval_rules'] = {'created': count, 'existing_setup_preserved': bool(preserved)}
    if 'finance_masters' in selections:
        count = journals = 0
        account_map = {obj.code: obj for obj in Account.objects.filter(tenant=tenant)}
        for spec in DEFAULT_ACCOUNT_MATRIX:
            obj, made = Account.objects.get_or_create(tenant=tenant, code=spec['code'], defaults={'name': spec['name'], 'account_type': spec['account_type'], 'parent': account_map.get(spec['parent']) if spec['parent'] else None, 'allow_posting': spec['allow_posting'], 'metadata': {'source': 'organization-setup-import'}})
            account_map[obj.code] = obj
            count += int(made)
        for spec in DEFAULT_JOURNALS:
            _, made = Journal.objects.get_or_create(tenant=tenant, code=spec['code'], defaults={'name': spec['name'], 'journal_type': spec['journal_type'], 'metadata': {'source': 'organization-setup-import'}})
            journals += int(made)
        report['finance_masters'] = {'accounts_created': count, 'journals_created': journals}
    if 'hr_defaults' in selections:
        _, policy_made = HRPolicy.objects.get_or_create(tenant=tenant)
        group, made = Group.objects.get_or_create(name=f'tenant:{tenant.pk}:Employee Self Service')
        if made:
            group.permissions.add(*Permission.objects.filter(content_type__app_label='SL_HR', codename__in=['view_employee', 'request_own_leave', 'add_employeedocument', 'view_employeedocument', 'add_employeeservicerequest', 'view_employeeservicerequest']))
            group.permissions.add(*Permission.objects.filter(content_type__app_label='SL_Procurement', codename__in=['add_requisition', 'change_requisition', 'view_requisition']))
        report['hr_defaults'] = {'policy_created': policy_made, 'employee_role_created': made, 'users_assigned': 0}
    if 'demo_masters' in selections:
        counts = {'customers': 0, 'suppliers': 0, 'products': 0}
        for index in range(1, 3):
            counts['customers'] += example(Customer, {'email': f'demo.customer{index}.t{tenant.pk}@example.invalid'}, {'name': f'[DEMO] Sample Customer {index}', 'phone_number': f'DEMO-{tenant.pk}-C{index}', 'address': MARKER})
            counts['suppliers'] += example(Supplier, {'name': f'[DEMO] Sample Supplier {index}'}, {'email': f'demo.supplier{index}.t{tenant.pk}@example.invalid', 'notes': MARKER})
        for code, name, kind, unit in [('DEMO-MASTER-GOODS', '[DEMO] Sample Supply Item', 'product', 'pcs'), ('DEMO-MASTER-SERVICE', '[DEMO] Sample Professional Service', 'service', 'hour')]:
            counts['products'] += example(Product, {'code': code}, {'name': name, 'description': MARKER, 'product_type': kind, 'is_service': kind == 'service', 'unit': unit, 'unit_price': 1000, 'tax_rate': 0})
        report['demo_masters'] = {'created': counts}
    if 'project_samples' in selections:
        before = tenant.project_tasks.count()
        call_command('seed_project_samples', tenant=tenant.code, stdout=StringIO())
        report['project_samples'] = {'tasks_created': tenant.project_tasks.count()-before}
    run = OrganizationSetupImport.objects.create(tenant=tenant, imported_by=actor, selections=selections, report=report, demo_records=records)
    result = {'id': run.pk, 'report': report, 'dry_run': dry_run, 'demo_records_created': len(records)}
    if dry_run:
        transaction.set_rollback(True)
    return result


@transaction.atomic
def remove_optional_examples(tenant):
    Tenant.objects.select_for_update().get(pk=tenant.pk)
    imports = list(OrganizationSetupImport.objects.select_for_update().filter(tenant=tenant, examples_removed_at__isnull=True))
    entries = {(entry['model'], entry['pk']): entry for run in imports for entry in run.demo_records}
    objects = []
    for (label, pk), entry in entries.items():
        model = apps.get_model(label)
        obj = model.objects.filter(tenant=tenant, pk=pk).first()
        if obj is None:
            continue
        if fingerprint(obj) != entry['fingerprint']:
            raise ValidationError({'examples': f'{obj} has been edited. Review it individually; no examples were removed.'})
        for relation in obj._meta.related_objects:
            accessor = relation.get_accessor_name()
            if not accessor:
                continue
            from django.core.exceptions import ObjectDoesNotExist
            try:
                related = getattr(obj, accessor)
            except ObjectDoesNotExist:
                continue
            if (hasattr(related, 'exists') and related.exists()) or (not hasattr(related, 'exists') and related is not None):
                raise ValidationError({'examples': f'{obj} is used by other records. Review it individually; no examples were removed.'})
        objects.append(obj)
    # The project command has its own protection against edits and real work.
    try:
        call_command('seed_project_samples', tenant=tenant.code, clear=True, stdout=StringIO())
    except CommandError as exc:
        raise ValidationError({'examples': str(exc)})
    for obj in objects:
        obj.delete()
    OrganizationSetupImport.objects.filter(pk__in=[run.pk for run in imports]).update(examples_removed_at=timezone.now())
    return {'master_records_removed': len(objects), 'detail': 'Untouched optional examples removed. Standard setup and business records were preserved.'}
