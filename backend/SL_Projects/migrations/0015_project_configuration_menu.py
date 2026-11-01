from django.db import migrations


def configure_menu(apps, schema_editor):
    Section = apps.get_model("Platform_Core", "WorkspaceMenuSection")
    Item = apps.get_model("Platform_Core", "WorkspaceMenuItem")
    alias = schema_editor.connection.alias
    section = Section.objects.using(alias).filter(key="projects-tasks").first()
    if section is None:
        return
    item, _ = Item.objects.using(alias).get_or_create(section=section, key="settings", defaults={
        "route_path": "/projects/settings", "api_path": "/api/projects/settings/",
        "icon": "settings", "required_module_id": section.module_id,
        "metadata": {"required_any_permissions": ["SL_Projects.change_projectmodulesettings"]},
        "sort_order": 10,
    })
    item.title = "Configuration"
    item.description = "Configure task types, defaults, statuses, follow-ups, and ticket sync."
    item.is_active = True
    item.save(using=alias, update_fields=["title", "description", "is_active"])


class Migration(migrations.Migration):
    dependencies = [("SL_Projects", "0014_align_project_page_permissions")]
    operations = [migrations.RunPython(configure_menu, migrations.RunPython.noop)]
