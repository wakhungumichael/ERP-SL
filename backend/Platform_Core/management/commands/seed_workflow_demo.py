from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand, CommandError

from Platform_Core.models import (
    Tenant,
    WorkflowDefinition,
    WorkflowEntityBinding,
    WorkflowNodeDefinition,
    WorkflowTransitionDefinition,
)


WORKFLOW_TEMPLATES = [
    {
        "code": "weighbridge-draft-review",
        "name": "Weighbridge Draft Review",
        "module": "weighbridge",
        "entity": "weighbridge_transaction",
        "label": "Weighbridge Transaction",
        "route": "/weighbridge/transactions",
        "groups": ["Finance", "Tenant Admin"],
        "condition": ("context.charge", "gte", "50000"),
    },
    {
        "code": "purchase-requisition-approval",
        "name": "Purchase Requisition Approval",
        "module": "procurement",
        "entity": "purchase_requisition",
        "label": "Purchase Requisition",
        "route": "/procurement/requisitions",
        "groups": ["Finance", "Tenant Admin"],
        "condition": ("context.total_amount", "gte", "50000"),
    },
    {
        "code": "supplier-bill-review",
        "name": "Supplier Bill Review",
        "module": "finance",
        "entity": "supplier_bill",
        "label": "Supplier Bill",
        "route": "/finance/payables",
        "groups": ["Finance", "Tenant Admin"],
        "condition": ("context.total_amount", "gte", "100000"),
    },
    {
        "code": "sales-estimate-approval",
        "name": "Sales Estimate Approval",
        "module": "sales",
        "entity": "estimate",
        "label": "Sales Estimate",
        "route": "/sales/estimates",
        "groups": ["Finance", "Tenant Admin"],
        "condition": ("context.total_amount", "gte", "250000"),
    },
]


class Command(BaseCommand):
    help = "Seed reusable, published example workflows for one local organization."

    def add_arguments(self, parser):
        parser.add_argument("--tenant-code", default="workflow-demo", help="Organization code to receive the sample workflows.")
        parser.add_argument("--create-demo-tenant", action="store_true", help="Create the named local demo organization when it does not exist.")
        parser.add_argument("--all-active-tenants", action="store_true", help="Seed each active local organization. This is intended for local testing only.")

    def handle(self, *args, **options):
        if options["all_active_tenants"]:
            tenants = Tenant.objects.filter(is_active=True).exclude(status__in=["archived", "suspended"]).order_by("name")
            if not tenants.exists():
                raise CommandError("There are no active organizations to seed.")
        else:
            try:
                tenants = [Tenant.objects.get(code=options["tenant_code"])]
            except Tenant.DoesNotExist as exc:
                if not options["create_demo_tenant"]:
                    raise CommandError("No organization exists with that tenant code. Use --create-demo-tenant only for local testing.") from exc
                tenant = Tenant.objects.create(
                    name="Workflow Demo Organization", code=options["tenant_code"], status="active", is_active=True,
                )
                self.stdout.write(self.style.WARNING(f"Created local demo organization: {tenant.name}"))
                tenants = [tenant]

        for tenant in tenants:
            self.stdout.write(self.style.HTTP_INFO(f"Seeding {tenant.name}"))
            self._seed_tenant(tenant)
        self.stdout.write(self.style.SUCCESS("Workflow samples are ready."))

    def _seed_tenant(self, tenant):
        for template in WORKFLOW_TEMPLATES:
            first_group, second_group = [Group.objects.get_or_create(name=name)[0] for name in template["groups"]]
            workflow, created = WorkflowDefinition.objects.get_or_create(
                tenant=tenant,
                code=template["code"],
                defaults={
                    "name": template["name"], "entity_type": template["entity"], "scope": "document",
                    "trigger_event": "submit", "description": "Sample reusable approval route. Edit by creating a revision.",
                    "status": "published", "is_active": True,
                },
            )
            if not created:
                self.stdout.write(f"Skipped existing workflow: {workflow.name}")
                continue
            WorkflowEntityBinding.objects.create(
                workflow=workflow, module_slug=template["module"], entity_type=template["entity"],
                entity_label=template["label"], route_path=template["route"], trigger_events=["submit"], is_primary=True,
            )
            start = WorkflowNodeDefinition.objects.create(workflow=workflow, code="start", name="Submitted", node_type="start", step_order=0, is_initial=True)
            review = WorkflowNodeDefinition.objects.create(workflow=workflow, code="manager-review", name=f"{first_group.name} Review", node_type="approval", step_order=1, approval_group=first_group)
            final = WorkflowNodeDefinition.objects.create(workflow=workflow, code="final-approval", name=f"{second_group.name} Approval", node_type="approval", step_order=2, approval_group=second_group)
            end = WorkflowNodeDefinition.objects.create(workflow=workflow, code="completed", name="Completed", node_type="end", step_order=3)
            WorkflowTransitionDefinition.objects.create(workflow=workflow, from_node=start, to_node=review, name="Submit", transition_key="submit", decision="next", is_default=True)
            WorkflowTransitionDefinition.objects.create(workflow=workflow, from_node=review, to_node=final, name="High-value review", transition_key="high-value", decision="approve", priority=1, condition_field=template["condition"][0], condition_operator=template["condition"][1], condition_value=template["condition"][2])
            WorkflowTransitionDefinition.objects.create(workflow=workflow, from_node=review, to_node=end, name="Standard approval", transition_key="standard", decision="approve", priority=99, is_default=True)
            WorkflowTransitionDefinition.objects.create(workflow=workflow, from_node=final, to_node=end, name="Finalise", transition_key="complete", decision="approve", is_default=True)
            self.stdout.write(self.style.SUCCESS(f"Created {workflow.name} with two approval steps."))
