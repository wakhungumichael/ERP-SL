from django.db import migrations


def move_statement_permission(apps, schema_editor):
    ContentType = apps.get_model("contenttypes", "ContentType")
    Permission = apps.get_model("auth", "Permission")

    sales_content_type, _ = ContentType.objects.get_or_create(
        app_label="SL_Sales",
        model="salescustomer",
    )
    sales_permission, _ = Permission.objects.get_or_create(
        content_type=sales_content_type,
        codename="can_view_customer_statements",
        defaults={"name": "Can view customer statements"},
    )

    old_permission = Permission.objects.filter(
        content_type__app_label="SL_Weighbridge",
        content_type__model="customer",
        codename="can_view_customer_statements",
    ).first()
    if old_permission is None:
        return

    for group in old_permission.group_set.all():
        group.permissions.add(sales_permission)
    for user in old_permission.user_set.all():
        user.user_permissions.add(sales_permission)


def restore_statement_permission(apps, schema_editor):
    ContentType = apps.get_model("contenttypes", "ContentType")
    Permission = apps.get_model("auth", "Permission")

    weighbridge_content_type, _ = ContentType.objects.get_or_create(
        app_label="SL_Weighbridge",
        model="customer",
    )
    old_permission, _ = Permission.objects.get_or_create(
        content_type=weighbridge_content_type,
        codename="can_view_customer_statements",
        defaults={"name": "Can view customer statements"},
    )
    sales_permission = Permission.objects.filter(
        content_type__app_label="SL_Sales",
        content_type__model="salescustomer",
        codename="can_view_customer_statements",
    ).first()
    if sales_permission is None:
        return

    for group in sales_permission.group_set.all():
        group.permissions.add(old_permission)
    for user in sales_permission.user_set.all():
        user.user_permissions.add(old_permission)


class Migration(migrations.Migration):

    dependencies = [
        ("SL_Sales", "0004_product_inventory_flags"),
        ("SL_Weighbridge", "0073_alter_customer_options"),
    ]

    operations = [
        migrations.CreateModel(
            name="SalesCustomer",
            fields=[],
            options={
                "verbose_name": "sales customer",
                "verbose_name_plural": "sales customers",
                "permissions": [("can_view_customer_statements", "Can view customer statements")],
                "proxy": True,
                "indexes": [],
                "constraints": [],
            },
            bases=("SL_Weighbridge.customer",),
        ),
        migrations.RunPython(move_statement_permission, restore_statement_permission),
    ]
