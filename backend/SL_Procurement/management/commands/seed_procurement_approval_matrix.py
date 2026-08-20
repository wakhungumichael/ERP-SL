from decimal import Decimal

from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand

from Platform_Core.models import Tenant
from Platform_Core.models import (
    WorkflowDefinition,
    WorkflowEntityBinding,
    WorkflowNodeDefinition,
    WorkflowStepDefinition,
    WorkflowTransitionDefinition,
)
from SL_Procurement.models import ApprovalMatrix


DEFAULT_RULES = [
    {
        "name": "Line Manager Approval",
        "cost_center": "",
        "min_amount": Decimal("0.00"),
        "max_amount": Decimal("5000.00"),
        "step_order": 1,
        "group_name": "Operator",
    },
    {
        "name": "Finance Approval",
        "cost_center": "",
        "min_amount": Decimal("5000.01"),
        "max_amount": Decimal("25000.00"),
        "step_order": 1,
        "group_name": "Finance",
    },
    {
        "name": "Tenant Admin Approval",
        "cost_center": "",
        "min_amount": Decimal("25000.01"),
        "max_amount": None,
        "step_order": 1,
        "group_name": "Tenant Admin",
    },
]


class Command(BaseCommand):
    help = "Seed default procurement approval thresholds for tenants."

    def add_arguments(self, parser):
        parser.add_argument("--tenant-id", type=int, help="Seed only one tenant by ID.")

    def handle(self, *args, **options):
        queryset = Tenant.objects.all().order_by("name")
        if options.get("tenant_id"):
            queryset = queryset.filter(pk=options["tenant_id"])

        created = 0
        updated = 0
        for tenant in queryset:
            workflow, _ = WorkflowDefinition.objects.update_or_create(
                tenant=tenant,
                code="procurement-requisition-approval",
                defaults={
                    "name": "Procurement Requisition Approval",
                    "entity_type": "procurement_requisition",
                    "scope": "document",
                    "trigger_event": "submit",
                    "description": "Central approval workflow for requisitions before PO conversion.",
                    "is_active": True,
                    "allow_dashboard_quick_actions": True,
                },
            )
            WorkflowEntityBinding.objects.update_or_create(
                workflow=workflow,
                module_slug="procurement",
                entity_type="procurement_requisition",
                defaults={
                    "entity_label": "Procurement Requisition",
                    "route_path": "/procurement/requisitions",
                    "api_base_path": "/api/procurement/requisitions/",
                    "trigger_events": ["submit", "approve", "reject"],
                    "is_primary": True,
                    "is_active": True,
                },
            )
            start_node, _ = WorkflowNodeDefinition.objects.update_or_create(
                workflow=workflow,
                code="start",
                defaults={
                    "name": "Start",
                    "node_type": "start",
                    "step_order": 0,
                    "is_initial": True,
                    "is_active": True,
                    "notify_dashboard": False,
                    "allow_quick_action": False,
                },
            )
            previous_node = start_node
            for spec in DEFAULT_RULES:
                group, _ = Group.objects.get_or_create(name=spec["group_name"])
                obj, was_created = ApprovalMatrix.objects.update_or_create(
                    tenant=tenant,
                    name=spec["name"],
                    cost_center=spec["cost_center"],
                    step_order=spec["step_order"],
                    defaults={
                        "min_amount": spec["min_amount"],
                        "max_amount": spec["max_amount"],
                        "approval_group": group,
                        "is_active": True,
                    },
                )
                if was_created:
                    created += 1
                else:
                    updated += 1
                WorkflowStepDefinition.objects.update_or_create(
                    workflow=workflow,
                    name=spec["name"],
                    step_order=spec["step_order"],
                    defaults={
                        "action_type": "approval",
                        "approval_group": group,
                        "min_amount": spec["min_amount"],
                        "max_amount": spec["max_amount"],
                        "cost_center": spec["cost_center"],
                        "notify_dashboard": True,
                        "allow_quick_action": True,
                        "is_active": True,
                    },
                )
                node, _ = WorkflowNodeDefinition.objects.update_or_create(
                    workflow=workflow,
                    code=spec["name"].lower().replace(" ", "-"),
                    defaults={
                        "name": spec["name"],
                        "node_type": "approval",
                        "step_order": spec["step_order"],
                        "approval_group": group,
                        "approval_mode": "single",
                        "required_approvals": 1,
                        "min_amount": spec["min_amount"],
                        "max_amount": spec["max_amount"],
                        "cost_center": spec["cost_center"],
                        "notify_dashboard": True,
                        "allow_quick_action": True,
                        "is_active": True,
                    },
                )
                WorkflowTransitionDefinition.objects.update_or_create(
                    workflow=workflow,
                    from_node=previous_node,
                    to_node=node,
                    transition_key=f"to-{node.code}",
                    defaults={
                        "name": f"{previous_node.name} -> {node.name}",
                        "decision": "submit" if previous_node == start_node else "approve",
                        "priority": spec["step_order"] or 1,
                        "is_default": True,
                        "condition_field": "estimated_total",
                        "condition_operator": "gte",
                        "condition_value": str(spec["min_amount"]),
                        "is_active": True,
                    },
                )
                previous_node = node

            end_node, _ = WorkflowNodeDefinition.objects.update_or_create(
                workflow=workflow,
                code="end",
                defaults={
                    "name": "Approved",
                    "node_type": "end",
                    "step_order": 999,
                    "is_active": True,
                    "notify_dashboard": False,
                    "allow_quick_action": False,
                },
            )
            WorkflowTransitionDefinition.objects.update_or_create(
                workflow=workflow,
                from_node=previous_node,
                to_node=end_node,
                transition_key="complete",
                defaults={
                    "name": f"{previous_node.name} -> {end_node.name}",
                    "decision": "approve",
                    "priority": 999,
                    "is_default": True,
                    "condition_operator": "always",
                    "is_active": True,
                },
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Procurement approval matrix seeded. Created: {created}, updated: {updated}."
            )
        )
