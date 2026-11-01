from django.db import migrations


def remove_duplicate_menu(apps, schema_editor):
    Item = apps.get_model('Platform_Core', 'WorkspaceMenuItem')
    Section = apps.get_model('Platform_Core', 'WorkspaceMenuSection')
    alias = schema_editor.connection.alias
    Item.objects.using(alias).filter(route_path='/platform/organization-structure').update(is_active=False)
    for section in Section.objects.using(alias).filter(key='organization-settings'):
        if not Item.objects.using(alias).filter(section=section, is_active=True).exists():
            Section.objects.using(alias).filter(pk=section.pk).update(is_active=False)


class Migration(migrations.Migration):
    dependencies = [('Platform_Core', '0073_organizationbranchlink')]
    operations = [migrations.RunPython(remove_duplicate_menu, migrations.RunPython.noop)]
