from django.db import migrations


def configure_structure_menu(apps, schema_editor):
    Section = apps.get_model('Platform_Core', 'WorkspaceMenuSection')
    Item = apps.get_model('Platform_Core', 'WorkspaceMenuItem')
    Module = apps.get_model('Platform_Core', 'ModuleDefinition')
    alias = schema_editor.connection.alias
    organization, _ = Section.objects.using(alias).get_or_create(key='organization-settings', defaults={'title': 'Organization Settings', 'icon': 'building-2', 'sort_order': 90, 'is_active': True})
    Item.objects.using(alias).update_or_create(section=organization, key='organization-structure', defaults={
        'title': 'Departments & groupings', 'icon': 'users-round', 'route_path': '/platform/organization-structure', 'api_path': '/api/platform/organization-units/', 'required_module': None,
        'required_permission': '', 'metadata': {'required_any_permissions': ['Platform_Core.view_department', 'Platform_Core.add_department', 'Platform_Core.change_department']}, 'sort_order': 2, 'is_active': True})
    module = Module.objects.using(alias).filter(slug='procurement').first()
    procurement, _ = Section.objects.using(alias).get_or_create(key='procurement', defaults={'title': 'Procurement', 'icon': 'shopping-cart', 'module': module, 'sort_order': 50, 'is_active': True})
    Item.objects.using(alias).filter(route_path='/procurement/departments').update(is_active=False)
    Item.objects.using(alias).update_or_create(section=procurement, key='configuration', defaults={
        'title': 'Configuration', 'icon': 'settings', 'route_path': '/procurement/configuration', 'api_path': '/api/procurement/configuration/', 'required_module': module, 'required_permission': '',
        'metadata': {'required_any_permissions': ['SL_Procurement.view_procurementpolicy', 'SL_Procurement.change_procurementpolicy', 'SL_Procurement.change_approvalmatrix']}, 'sort_order': 20, 'is_active': True})


class Migration(migrations.Migration):
    dependencies = [('Platform_Core', '0071_department'), ('SL_Procurement', '0014_alter_requisition_department_and_more')]
    operations = [migrations.RunPython(configure_structure_menu, migrations.RunPython.noop)]
