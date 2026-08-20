from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("Platform_Core", "0017_workflow_engine_nodes"),
        ("SL_Procurement", "0008_paymentqueueitem"),
    ]

    operations = [
        migrations.AddField(
            model_name="requisitionapproval",
            name="workflow_node",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="procurement_approvals", to="Platform_Core.workflownodedefinition"),
        ),
    ]
