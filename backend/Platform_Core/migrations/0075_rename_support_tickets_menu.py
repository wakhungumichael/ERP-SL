from django.db import migrations


def rename_menu(apps, schema_editor):
    Item = apps.get_model("Platform_Core", "WorkspaceMenuItem")
    Item.objects.using(schema_editor.connection.alias).filter(
        route_path="/ticketing/queue", title="Agent Queue"
    ).update(title="Support Tickets")


def restore_menu(apps, schema_editor):
    Item = apps.get_model("Platform_Core", "WorkspaceMenuItem")
    Item.objects.using(schema_editor.connection.alias).filter(
        route_path="/ticketing/queue", title="Support Tickets"
    ).update(title="Agent Queue")


class Migration(migrations.Migration):
    dependencies = [("Platform_Core", "0074_remove_duplicate_structure_menu")]
    operations = [migrations.RunPython(rename_menu, restore_menu)]
