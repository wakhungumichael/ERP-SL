from django.db import migrations


def grant_deactivation(apps, schema_editor):
    ContentType=apps.get_model("contenttypes","ContentType")
    Permission=apps.get_model("auth","Permission")
    Group=apps.get_model("auth","Group")
    alias=schema_editor.connection.alias
    content_type,_=ContentType.objects.using(alias).get_or_create(app_label="SL_Projects",model="projecttask")
    permission,_=Permission.objects.using(alias).get_or_create(content_type=content_type,codename="deactivate_projecttask",defaults={"name":"Can deactivate and reactivate project tasks"})
    for group in Group.objects.using(alias).filter(permissions__content_type=content_type,permissions__codename="delete_projecttask").distinct():
        group.permissions.add(permission)
    User=apps.get_model("auth","User")
    for user in User.objects.using(alias).filter(user_permissions__content_type=content_type,user_permissions__codename="delete_projecttask").distinct():
        user.user_permissions.add(permission)


class Migration(migrations.Migration):
    dependencies=[("SL_Projects","0012_task_deactivation")]
    operations=[migrations.RunPython(grant_deactivation,migrations.RunPython.noop)]
