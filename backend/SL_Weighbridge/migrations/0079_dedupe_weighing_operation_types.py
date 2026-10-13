from django.db import migrations, models


def dedupe_operation_types(apps, schema_editor):
    OperationType = apps.get_model("SL_Weighbridge", "WeighingOperationType")
    Transaction = apps.get_model("SL_Weighbridge", "Transaction")

    tenant_ids = OperationType.objects.order_by().values_list("tenant_id", flat=True).distinct()
    for tenant_id in tenant_ids:
        flow_kinds = (
            OperationType.objects.filter(tenant_id=tenant_id)
            .order_by()
            .values_list("flow_kind", flat=True)
            .distinct()
        )
        for flow_kind in flow_kinds:
            candidates = list(
                OperationType.objects.filter(tenant_id=tenant_id, flow_kind=flow_kind)
                .order_by("-is_default", "display_order", "id")
            )
            if len(candidates) < 2:
                continue

            canonical = candidates[0]
            duplicate_ids = [row.id for row in candidates[1:]]
            # Preserve the workflow recorded on historical transactions before
            # removing duplicate setup rows.
            Transaction.objects.filter(operation_type_id__in=duplicate_ids).update(
                operation_type_id=canonical.id
            )
            OperationType.objects.filter(id__in=duplicate_ids).delete()


class Migration(migrations.Migration):

    # PostgreSQL must commit the transaction re-linking/deleting duplicate
    # operation types before the unique constraint can be added.
    atomic = False

    dependencies = [
        ("SL_Weighbridge", "0078_item_branch"),
    ]

    operations = [
        migrations.RunPython(dedupe_operation_types, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="weighingoperationtype",
            constraint=models.UniqueConstraint(
                fields=("tenant", "flow_kind"),
                name="unique_weighing_operation_flow_per_tenant",
            ),
        ),
    ]
