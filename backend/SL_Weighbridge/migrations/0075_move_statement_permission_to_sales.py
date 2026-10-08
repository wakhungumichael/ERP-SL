from django.db import migrations


def remove_old_statement_permission(apps, schema_editor):
    Permission = apps.get_model("auth", "Permission")
    Permission.objects.filter(
        content_type__app_label="SL_Weighbridge",
        content_type__model="customer",
        codename="can_view_customer_statements",
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("SL_Weighbridge", "0074_transaction_image"),
        ("SL_Sales", "0005_sales_customer_permissions"),
    ]

    operations = [
        migrations.AlterModelOptions(
            name="customer",
            options={"ordering": ["name"]},
        ),
        migrations.RunPython(remove_old_statement_permission, migrations.RunPython.noop),
    ]
