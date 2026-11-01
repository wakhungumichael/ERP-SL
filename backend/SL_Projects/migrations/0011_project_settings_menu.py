from django.db import migrations


def add_menu(apps, schema_editor):
    Section = apps.get_model("Platform_Core", "WorkspaceMenuSection")
    Item = apps.get_model("Platform_Core", "WorkspaceMenuItem")
    alias = schema_editor.connection.alias
    section = Section.objects.using(alias).filter(key="projects-tasks").first()
    if section:
        Item.objects.using(alias).update_or_create(section=section, key="settings", defaults={
            "title": "Settings", "icon": "settings", "route_path": "/projects/settings",
            "api_path": "/api/projects/settings/", "required_module_id": section.module_id,
            "metadata": {"required_any_permissions": ["SL_Projects.change_projectmodulesettings"]},
            "sort_order": 10, "is_active": True,
        })


class Migration(migrations.Migration):
    dependencies = [("SL_Projects", "0010_module_settings")]
    operations = [migrations.RunPython(add_menu, migrations.RunPython.noop)]
