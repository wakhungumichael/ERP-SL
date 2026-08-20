import json
from decimal import Decimal

from django.http import HttpResponse
from django.db import transaction
from django.db.models import Q
from django.contrib.auth.models import Group
from django.utils import timezone
from django.core.paginator import Paginator
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from Platform_API.modules.mixins import (
    NO_TENANT_ACCESS,
    apply_tenant_filter,
    resolve_user_tenant,
    user_belongs_to_tenant,
)
from Platform_Core.documents import render_purchase_order_document
from SL_Inventory.services import sync_goods_receipt_to_inventory

try:
    from SL_Procurement.models import (
        ApprovalMatrix,
        GoodsReceiptLine,
        GoodsReceiptNote,
        PurchaseOrder,
        PurchaseOrderItem,
        Requisition,
        RequisitionApproval,
        RequisitionLine,
    )
    HAS_PROCUREMENT_MODELS = True
except ImportError:
    HAS_PROCUREMENT_MODELS = False

try:
    from SL_Budgeting.models import BudgetCheckLog, BudgetCommitment, BudgetLine
    HAS_BUDGETING_MODELS = True
except ImportError:
    HAS_BUDGETING_MODELS = False

from Platform_Core.models import (
    WorkflowDefinition,
    WorkflowInboxItem,
    WorkflowNodeDefinition,
    WorkflowStepDefinition,
    WorkflowTransitionDefinition,
)


# ── Serializers ────────────────────────────────────────────────────────────────

class POItemSerializer(serializers.ModelSerializer):
    class Meta:
        model  = PurchaseOrderItem
        fields = ["id", "product", "description", "unit", "quantity", "unit_price", "total"]
        read_only_fields = ["id", "total"]


class PurchaseOrderSerializer(serializers.ModelSerializer):
    items        = POItemSerializer(many=True, read_only=True)
    created_by_name = serializers.SerializerMethodField()
    requisition_number = serializers.CharField(source="requisition.request_number", read_only=True)
    gl_account_code = serializers.CharField(source="gl_account.code", read_only=True)

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return None

    class Meta:
        model  = PurchaseOrder
        fields = [
            "id", "tenant", "branch", "requisition", "requisition_number",
            "reference", "supplier_name", "supplier_email", "supplier_phone",
            "status", "order_date", "expected_date", "total_amount", "currency",
            "cost_center", "gl_account", "gl_account_code", "project_code",
            "notes", "created_by", "created_by_name", "items", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "created_by", "created_by_name"]


class PurchaseOrderWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model  = PurchaseOrder
        fields = [
            "tenant", "branch", "requisition", "reference", "supplier_name", "supplier_email", "supplier_phone",
            "status", "order_date", "expected_date", "cost_center", "gl_account", "project_code",
            "total_amount", "currency", "notes",
        ]


class GoodsReceiptLineSerializer(serializers.ModelSerializer):
    po_item_description = serializers.CharField(source="purchase_order_item.description", read_only=True)

    class Meta:
        model = GoodsReceiptLine
        fields = [
            "id",
            "purchase_order_item",
            "product",
            "po_item_description",
            "description",
            "ordered_quantity",
            "received_quantity",
            "accepted_quantity",
            "unit_price",
            "line_total",
        ]
        read_only_fields = ["id", "line_total", "po_item_description"]


class GoodsReceiptSerializer(serializers.ModelSerializer):
    lines = GoodsReceiptLineSerializer(many=True, read_only=True)
    received_by_name = serializers.SerializerMethodField()

    class Meta:
        model = GoodsReceiptNote
        fields = [
            "id",
            "tenant",
            "branch",
            "purchase_order",
            "receipt_number",
            "received_by",
            "received_by_name",
            "received_date",
            "status",
            "notes",
            "lines",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "tenant", "receipt_number", "received_by", "received_by_name", "created_at", "updated_at"]

    def get_received_by_name(self, obj):
        if obj.received_by:
            return obj.received_by.get_full_name() or obj.received_by.username
        return None


class GoodsReceiptWriteSerializer(serializers.ModelSerializer):
    lines = GoodsReceiptLineSerializer(many=True, required=False)

    class Meta:
        model = GoodsReceiptNote
        fields = [
            "branch",
            "purchase_order",
            "received_date",
            "status",
            "notes",
            "lines",
        ]

    def _sync_lines(self, receipt, lines_data):
        receipt.lines.all().delete()
        for line in lines_data:
            if not line.get("product") and line.get("purchase_order_item"):
                line["product"] = getattr(line["purchase_order_item"], "product", None)
            GoodsReceiptLine.objects.create(goods_receipt=receipt, **line)

    def create(self, validated_data):
        lines_data = validated_data.pop("lines", [])
        receipt = GoodsReceiptNote.objects.create(**validated_data)
        self._sync_lines(receipt, lines_data)
        return receipt

    def update(self, instance, validated_data):
        lines_data = validated_data.pop("lines", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if lines_data is not None:
            self._sync_lines(instance, lines_data)
        return instance


class RequisitionLineSerializer(serializers.ModelSerializer):
    gl_account_code = serializers.CharField(source="gl_account.code", read_only=True)

    class Meta:
        model = RequisitionLine
        fields = [
            "id", "product", "item_type", "description", "unit", "quantity",
            "unit_price", "line_total", "gl_account", "gl_account_code", "notes",
        ]
        read_only_fields = ["id", "line_total"]


class RequisitionSerializer(serializers.ModelSerializer):
    lines = RequisitionLineSerializer(many=True, read_only=True)
    requested_by_name = serializers.SerializerMethodField()
    gl_account_code = serializers.CharField(source="gl_account.code", read_only=True)
    approvals = serializers.SerializerMethodField()

    class Meta:
        model = Requisition
        fields = [
            "id", "tenant", "branch", "requested_by", "requested_by_name",
            "request_number", "title", "description", "cost_center", "gl_account",
            "gl_account_code", "project_code", "needed_by", "status", "budget_status",
            "budget_message", "estimated_total", "currency", "vendor_option",
            "submitted_at", "approved_at", "lines", "approvals", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "tenant", "requested_by", "requested_by_name",
            "request_number", "budget_status", "budget_message", "estimated_total",
            "submitted_at", "approved_at", "created_at", "updated_at",
        ]

    def get_requested_by_name(self, obj):
        if obj.requested_by:
            return obj.requested_by.get_full_name() or obj.requested_by.username
        return None

    def get_approvals(self, obj):
        return [
            {
                "id": approval.id,
                "step_order": approval.step_order,
                "group_id": approval.approval_group_id,
                "group_name": approval.approval_group.name,
                "status": approval.status,
                "assigned_user_id": approval.assigned_user_id,
                "assigned_user_name": (
                    approval.assigned_user.get_full_name() or approval.assigned_user.username
                ) if approval.assigned_user else None,
                "acted_by_id": approval.acted_by_id,
                "acted_by_name": (
                    approval.acted_by.get_full_name() or approval.acted_by.username
                ) if approval.acted_by else None,
                "decision_notes": approval.decision_notes,
                "acted_at": approval.acted_at,
            }
            for approval in obj.approvals.select_related("approval_group", "assigned_user", "acted_by").all()
        ]


class RequisitionWriteSerializer(serializers.ModelSerializer):
    lines = RequisitionLineSerializer(many=True, required=False)

    class Meta:
        model = Requisition
        fields = [
            "branch", "title", "description", "cost_center", "gl_account",
            "project_code", "needed_by", "status", "currency", "vendor_option", "lines",
        ]

    def _sync_lines(self, requisition, lines_data):
        requisition.lines.all().delete()
        for line_data in lines_data:
            RequisitionLine.objects.create(requisition=requisition, **line_data)
        requisition.recalculate_total()

    def create(self, validated_data):
        lines_data = validated_data.pop("lines", [])
        requisition = Requisition.objects.create(**validated_data)
        self._sync_lines(requisition, lines_data)
        return requisition

    def update(self, instance, validated_data):
        lines_data = validated_data.pop("lines", None)
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()
        if lines_data is not None:
            self._sync_lines(instance, lines_data)
        return instance


class ApprovalMatrixSerializer(serializers.ModelSerializer):
    approval_group_name = serializers.CharField(source="approval_group.name", read_only=True)

    class Meta:
        model = ApprovalMatrix
        fields = [
            "id",
            "tenant",
            "name",
            "cost_center",
            "min_amount",
            "max_amount",
            "step_order",
            "approval_group",
            "approval_group_name",
            "is_active",
            "metadata",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "tenant", "created_at", "updated_at", "approval_group_name"]


class ApprovalMatrixWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = ApprovalMatrix
        fields = [
            "name",
            "cost_center",
            "min_amount",
            "max_amount",
            "step_order",
            "approval_group",
            "is_active",
            "metadata",
        ]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _next_reference():
    """Auto-generate PO reference like PO-0042."""
    if not HAS_PROCUREMENT_MODELS:
        return "PO-0001"
    last = PurchaseOrder.objects.order_by("-id").first()
    n = (last.id + 1) if last else 1
    return f"PO-{n:04d}"


def _resolve_tenant(user):
    resolved = resolve_user_tenant(user)
    if resolved is NO_TENANT_ACCESS:
        return False
    return resolved


def _apply_requisition_tenant_filter(user, qs):
    tenant = _resolve_tenant(user)
    if tenant is None:
        return qs
    if tenant is False:
        return qs.none()
    return qs.filter(tenant=tenant)


def _apply_purchase_order_tenant_filter(user, qs):
    tenant = _resolve_tenant(user)
    if tenant is None:
        return qs
    if tenant is False:
        return qs.none()
    return qs.filter(
        Q(tenant=tenant)
        | Q(tenant__isnull=True, created_by__organization_memberships__tenant=tenant)
        | Q(tenant__isnull=True, created_by__tenant_profile__tenant=tenant)
    ).distinct()


def _validate_tenant_owned_relation(*, tenant, obj, label):
    if obj is None or tenant is None:
        return None
    if getattr(obj, "tenant_id", None) != tenant.id:
        return f"{label} belongs to a different tenant."
    return None


def _validate_requisition_payload(*, tenant, branch=None, gl_account=None, lines=None):
    errors = {}
    branch_error = _validate_tenant_owned_relation(tenant=tenant, obj=branch, label="Branch")
    if branch_error:
        errors["branch"] = branch_error
    gl_error = _validate_tenant_owned_relation(tenant=tenant, obj=gl_account, label="GL account")
    if gl_error:
        errors["gl_account"] = gl_error
    for index, line in enumerate(lines or []):
        line_gl = line.get("gl_account")
        line_gl_error = _validate_tenant_owned_relation(
            tenant=tenant,
            obj=line_gl,
            label="Line GL account",
        )
        if line_gl_error:
            errors[f"lines[{index}].gl_account"] = line_gl_error
    return errors


def _validate_purchase_order_payload(*, tenant, branch=None, requisition=None, gl_account=None):
    errors = {}
    for field, obj, label in (
        ("branch", branch, "Branch"),
        ("requisition", requisition, "Requisition"),
        ("gl_account", gl_account, "GL account"),
    ):
        field_error = _validate_tenant_owned_relation(tenant=tenant, obj=obj, label=label)
        if field_error:
            errors[field] = field_error
    if (
        branch is not None
        and requisition is not None
        and requisition.branch_id is not None
        and branch.id != requisition.branch_id
    ):
        errors["branch"] = "Branch must match the selected requisition."
    return errors


def _validate_goods_receipt_payload(*, tenant, branch=None, purchase_order=None, lines=None):
    errors = {}
    branch_error = _validate_tenant_owned_relation(tenant=tenant, obj=branch, label="Branch")
    if branch_error:
        errors["branch"] = branch_error
    po_error = _validate_tenant_owned_relation(tenant=tenant, obj=purchase_order, label="Purchase order")
    if po_error:
        errors["purchase_order"] = po_error
    if (
        branch is not None
        and purchase_order is not None
        and purchase_order.branch_id is not None
        and branch.id != purchase_order.branch_id
    ):
        errors["branch"] = "Branch must match the selected purchase order."
    for index, line in enumerate(lines or []):
        po_item = line.get("purchase_order_item")
        if po_item and purchase_order and po_item.order_id != purchase_order.id:
            errors[f"lines[{index}].purchase_order_item"] = (
                "Receipt line item must belong to the selected purchase order."
            )
    return errors


def _run_budget_check(requisition):
    if not HAS_BUDGETING_MODELS or not requisition.gl_account_id:
        return "pending", "No matching budget control configured yet."

    effective_date = requisition.needed_by or timezone.localdate()
    month = effective_date.month if effective_date else None
    lines = BudgetLine.objects.filter(
        budget__tenant=requisition.tenant,
        budget__status="active",
        account_id=requisition.gl_account_id,
        cost_center=requisition.cost_center,
        period_year=effective_date.year,
    )
    if month:
        lines = lines.filter(period_month__in=[month, None])
    budget_line = lines.select_related("budget").order_by("-period_month").first()
    if not budget_line:
        return "pending", "No active budget line matched this requisition."

    available = budget_line.available_amount
    result = "passed" if available >= requisition.estimated_total else (
        "warning" if budget_line.budget.control_mode == "soft" else "blocked"
    )
    message = (
        f"Budget available {available} for {budget_line.cost_center} / {budget_line.account.code}."
        if result != "blocked"
        else f"Budget exceeded. Available {available}, requested {requisition.estimated_total}."
    )
    BudgetCheckLog.objects.create(
        tenant=requisition.tenant,
        budget_line=budget_line,
        requisition_reference=requisition.request_number,
        amount=requisition.estimated_total,
        result="pass" if result == "passed" else ("warn" if result == "warning" else "block"),
        message=message,
        checked_by=requisition.requested_by,
    )
    return result, message


def _create_commitment_for_requisition(requisition):
    if not HAS_BUDGETING_MODELS or not requisition.gl_account_id:
        return
    effective_date = requisition.needed_by or timezone.localdate()
    lines = BudgetLine.objects.filter(
        budget__tenant=requisition.tenant,
        budget__status="active",
        account_id=requisition.gl_account_id,
        cost_center=requisition.cost_center,
        period_year=effective_date.year,
    )
    if effective_date:
        lines = lines.filter(period_month__in=[effective_date.month, None])
    budget_line = lines.select_related("budget").order_by("-period_month").first()
    if not budget_line:
        return
    exists = BudgetCommitment.objects.filter(
        tenant=requisition.tenant,
        budget_line=budget_line,
        source_type="requisition",
        source_reference=requisition.request_number,
        state="committed",
    ).exists()
    if exists:
        return
    BudgetCommitment.objects.create(
        tenant=requisition.tenant,
        budget_line=budget_line,
        source_type="requisition",
        source_reference=requisition.request_number,
        state="committed",
        amount=requisition.estimated_total,
        created_by=requisition.requested_by,
    )
    budget_line.committed_amount = (budget_line.committed_amount or Decimal("0.00")) + requisition.estimated_total
    budget_line.save(update_fields=["committed_amount", "updated_at"])


def _matching_approval_rules(requisition):
    if not HAS_PROCUREMENT_MODELS:
        return []
    rules = ApprovalMatrix.objects.filter(
        tenant=requisition.tenant,
        is_active=True,
        min_amount__lte=requisition.estimated_total,
    ).select_related("approval_group")
    if requisition.cost_center:
        rules = rules.filter(cost_center__in=["", requisition.cost_center])
    else:
        rules = rules.filter(cost_center="")
    matched = []
    for rule in rules.order_by("step_order", "min_amount", "id"):
        if rule.max_amount is not None and requisition.estimated_total > rule.max_amount:
            continue
        matched.append(rule)
    return matched


def _workflow_context_for_requisition(requisition):
    return {
        "amount": requisition.estimated_total or Decimal("0"),
        "estimated_total": requisition.estimated_total or Decimal("0"),
        "cost_center": requisition.cost_center or "",
        "currency": requisition.currency or "",
        "status": requisition.status or "",
    }


def _coerce_transition_value(value):
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except Exception:
        return str(value)


def _transition_matches(transition, context):
    operator = transition.condition_operator or "always"
    if operator == "always":
        return True

    left = context.get(transition.condition_field or "")
    right = _coerce_transition_value(transition.condition_value)

    if operator == "eq":
        return left == right
    if operator == "neq":
        return left != right
    if operator == "gt":
        return left is not None and right is not None and left > right
    if operator == "gte":
        return left is not None and right is not None and left >= right
    if operator == "lt":
        return left is not None and right is not None and left < right
    if operator == "lte":
        return left is not None and right is not None and left <= right
    if operator == "contains":
        return str(right or "") in str(left or "")
    if operator == "in":
        choices = [item.strip() for item in str(transition.condition_value or "").split(",") if item.strip()]
        return str(left or "") in choices
    if operator == "is_true":
        return bool(left) is True
    if operator == "is_false":
        return bool(left) is False
    return False


def _node_matches_requisition(node, requisition):
    if node.cost_center and node.cost_center != requisition.cost_center:
        return False
    if requisition.estimated_total < node.min_amount:
        return False
    if node.max_amount is not None and requisition.estimated_total > node.max_amount:
        return False
    return True


def _tenant_group_members(group, tenant):
    members = []
    for user in group.user_set.filter(is_active=True).distinct():
        if user_belongs_to_tenant(user, tenant):
            members.append(user)
    return members


def _committee_requirement(node):
    if node.approval_mode == "all_members":
        members = _tenant_group_members(node.approval_group, node.workflow.tenant) if node.approval_group_id else []
        return max(len(members), 1)
    if node.approval_mode == "quorum":
        return max(node.required_approvals or 1, 1)
    return 1


def _matching_central_workflow_path(requisition):
    workflow = WorkflowDefinition.objects.filter(
        tenant=requisition.tenant,
        entity_type="procurement_requisition",
        is_active=True,
    ).select_related("module").prefetch_related(
        "nodes__approval_group",
        "nodes__assigned_user",
        "transitions__from_node",
        "transitions__to_node",
    ).order_by("id").first()
    if not workflow:
        return None, []

    nodes = list(workflow.nodes.filter(is_active=True).select_related("approval_group", "assigned_user").order_by("step_order", "id"))
    if not nodes:
        return workflow, []

    start_node = next((node for node in nodes if node.is_initial), None)
    if not start_node:
        start_node = next((node for node in nodes if node.node_type == "start"), None)
    if not start_node:
        start_node = nodes[0]

    context = _workflow_context_for_requisition(requisition)
    transitions_by_node = {}
    for transition in workflow.transitions.filter(is_active=True).select_related("from_node", "to_node").order_by("priority", "id"):
        transitions_by_node.setdefault(transition.from_node_id, []).append(transition)

    matched_nodes = []
    visited = set()
    current = start_node
    while current and current.id not in visited:
        visited.add(current.id)
        if current.node_type in {"approval", "review"} and _node_matches_requisition(current, requisition):
            matched_nodes.append(current)

        outgoing = transitions_by_node.get(current.id, [])
        next_transition = None
        default_transition = None
        for transition in outgoing:
            if transition.is_default and default_transition is None:
                default_transition = transition
            if _transition_matches(transition, context):
                next_transition = transition
                break
        if next_transition is None:
            next_transition = default_transition
        if next_transition is None:
            break
        current = next_transition.to_node
        if current.node_type == "end":
            break

    return workflow, matched_nodes


def _matching_central_workflow_steps(requisition):
    workflow, nodes = _matching_central_workflow_path(requisition)
    if nodes:
        return workflow, nodes
    workflow = WorkflowDefinition.objects.filter(
        tenant=requisition.tenant,
        entity_type="procurement_requisition",
        is_active=True,
    ).select_related("module").prefetch_related("steps__approval_group").order_by("id").first()
    if not workflow:
        return None, []
    matched = []
    for step in workflow.steps.filter(is_active=True).select_related("approval_group").order_by("step_order", "id"):
        if step.cost_center and step.cost_center != requisition.cost_center:
            continue
        if requisition.estimated_total < step.min_amount:
            continue
        if step.max_amount is not None and requisition.estimated_total > step.max_amount:
            continue
        matched.append(step)
    return workflow, matched


def _build_workflow_inbox_item(requisition, approval, workflow=None, step_definition=None):
    detail = f"{requisition.title} requires {approval.approval_group.name} approval for {requisition.estimated_total} {requisition.currency}."
    if approval.workflow_node_id and approval.workflow_node:
        mode = approval.workflow_node.approval_mode
        if mode == "all_members":
            detail = f"{requisition.title} requires acknowledgment from all members of {approval.approval_group.name}."
        elif mode == "quorum":
            detail = f"{requisition.title} requires {approval.workflow_node.required_approvals} approvals from {approval.approval_group.name}."
        elif mode == "any_one":
            detail = f"{requisition.title} may be approved by any member of {approval.approval_group.name}."

    WorkflowInboxItem.objects.filter(
        tenant=requisition.tenant,
        entity_type="procurement_requisition",
        entity_id=requisition.id,
        status="pending",
    ).exclude(id__isnull=True).update(status="completed", acted_at=timezone.now())

    WorkflowInboxItem.objects.create(
        tenant=requisition.tenant,
        workflow=workflow,
        step_definition=step_definition,
        node_definition=approval.workflow_node,
        module_slug="procurement",
        entity_type="procurement_requisition",
        entity_id=requisition.id,
        reference=requisition.request_number,
        title=f"Approval Required: {requisition.request_number}",
        detail=detail,
        route_path="/procurement/requisitions",
        action_url=f"/api/procurement/requisitions/{requisition.id}/approval-action/",
        status="pending",
        assigned_group=approval.approval_group,
        quick_actions=["approve", "reject"],
        metadata={
            "cost_center": requisition.cost_center,
            "step_order": approval.step_order,
            "budget_status": requisition.budget_status,
            "workflow_node_id": approval.workflow_node_id,
            "approval_mode": approval.workflow_node.approval_mode if approval.workflow_node_id else "single",
        },
    )


def _close_workflow_inbox_items(requisition, *, status_value, acted_by=None):
    update_fields = {
        "status": status_value,
        "acted_at": timezone.now(),
    }
    if acted_by:
        update_fields["acted_by"] = acted_by
    WorkflowInboxItem.objects.filter(
        tenant=requisition.tenant,
        entity_type="procurement_requisition",
        entity_id=requisition.id,
        status="pending",
    ).update(**update_fields)


def _sync_requisition_approvals(requisition):
    requisition.approvals.all().delete()
    workflow, steps = _matching_central_workflow_steps(requisition)
    if steps:
        for step in steps:
            if isinstance(step, WorkflowNodeDefinition) and step.approval_group_id and step.approval_mode in {"any_one", "all_members", "quorum"}:
                members = _tenant_group_members(step.approval_group, requisition.tenant)
                if members:
                    for member in members:
                        RequisitionApproval.objects.create(
                            requisition=requisition,
                            step_order=step.step_order,
                            workflow_node=step,
                            approval_group=step.approval_group,
                            assigned_user=member,
                            status="pending",
                        )
                    continue
            RequisitionApproval.objects.create(
                requisition=requisition,
                step_order=step.step_order,
                workflow_node=step if isinstance(step, WorkflowNodeDefinition) else None,
                approval_group=step.approval_group,
                assigned_user=step.assigned_user if isinstance(step, WorkflowNodeDefinition) else None,
                status="pending",
            )
        pending = _current_pending_approval(requisition)
        if pending:
            _build_workflow_inbox_item(
                requisition,
                pending,
                workflow=workflow,
                step_definition=steps[0] if steps and isinstance(steps[0], WorkflowStepDefinition) else None,
            )
        return steps

    rules = _matching_approval_rules(requisition)
    for rule in rules:
        RequisitionApproval.objects.create(
            requisition=requisition,
            matrix=rule,
            step_order=rule.step_order,
            approval_group=rule.approval_group,
            status="pending",
        )
    pending = _current_pending_approval(requisition)
    if pending:
        _build_workflow_inbox_item(requisition, pending)
    return rules


def _current_pending_approval(requisition):
    return requisition.approvals.filter(status="pending").select_related("approval_group").order_by("step_order", "id").first()


def _current_pending_approval_batch(requisition):
    current = _current_pending_approval(requisition)
    if not current:
        return requisition.approvals.none()
    return requisition.approvals.filter(
        status="pending",
        step_order=current.step_order,
        workflow_node_id=current.workflow_node_id,
    ).select_related("approval_group", "assigned_user", "acted_by", "workflow_node").order_by("id")


def _is_committee_step_complete(requisition, node):
    approvals = requisition.approvals.filter(step_order=node.step_order, workflow_node=node)
    approved_count = approvals.filter(status="approved").count()
    pending_qs = approvals.filter(status="pending")
    pending_count = pending_qs.count()

    if node.approval_mode in {"single", "any_one"}:
        if approved_count >= 1:
            pending_qs.update(status="skipped", updated_at=timezone.now())
            return True
        return False
    if node.approval_mode == "all_members":
        return pending_count == 0 and approved_count >= _committee_requirement(node)
    if node.approval_mode == "quorum":
        if approved_count >= _committee_requirement(node):
            pending_qs.update(status="skipped", updated_at=timezone.now())
            return True
        return False
    return approved_count >= 1


def _finalize_requisition_approval(requisition):
    requisition.status = "approved"
    requisition.approved_at = timezone.now()
    requisition.save(update_fields=["status", "approved_at", "updated_at"])
    _close_workflow_inbox_items(requisition, status_value="approved")
    _create_commitment_for_requisition(requisition)


# ── Views ──────────────────────────────────────────────────────────────────────

class ProcurementDashboardView(APIView):
    permission_classes = [IsAuthenticated]

    @staticmethod
    def _apply_po_tenant_filter(request, qs):
        """
        Three-state queryset filter for PurchaseOrder tables.
        - Superuser               → unfiltered
        - Non-superuser w/ profile → filtered via created_by chain
        - Non-superuser w/o profile → qs.none() (deny-all)
        """
        tenant = resolve_user_tenant(request.user)
        if tenant is None:
            return qs
        if tenant is NO_TENANT_ACCESS:
            return qs.none()
        return qs.filter(
            Q(tenant=tenant)
            | Q(tenant__isnull=True, created_by__organization_memberships__tenant=tenant)
            | Q(tenant__isnull=True, created_by__tenant_profile__tenant=tenant)
        ).distinct()

    def get(self, request):
        if not HAS_PROCUREMENT_MODELS:
            return Response({
                "counts": {"total": 0, "draft": 0, "submitted": 0, "approved": 0, "received": 0, "cancelled": 0},
                "requisitions": {"total": 0, "draft": 0, "submitted": 0, "approved": 0, "blocked": 0},
                "total_value": 0.0,
                "recent": [],
            })
        qs = self._apply_po_tenant_filter(request, PurchaseOrder.objects.all())
        requisitions = _apply_requisition_tenant_filter(request.user, Requisition.objects.all())
        status_counts = {s: qs.filter(status=s).count() for s in ["Draft", "Submitted", "Approved", "Received", "Cancelled"]}
        total_val = float(sum(po.total_amount for po in qs.filter(status__in=["Approved", "Received"])))
        recent = PurchaseOrderSerializer(qs.order_by("-created_at")[:5], many=True).data
        return Response({
            "counts": {
                "total":     qs.count(),
                "draft":     status_counts.get("Draft", 0),
                "submitted": status_counts.get("Submitted", 0),
                "approved":  status_counts.get("Approved", 0),
                "received":  status_counts.get("Received", 0),
                "cancelled": status_counts.get("Cancelled", 0),
            },
            "requisitions": {
                "total": requisitions.count(),
                "draft": requisitions.filter(status="draft").count(),
                "submitted": requisitions.filter(status__in=["submitted", "pending_approval"]).count(),
                "approved": requisitions.filter(status__in=["approved", "po_created"]).count(),
                "blocked": requisitions.filter(budget_status="blocked").count(),
            },
            "total_value": total_val,
            "recent": list(recent),
        })


class ApprovalMatrixListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = _apply_requisition_tenant_filter(
            request.user,
            ApprovalMatrix.objects.select_related("approval_group", "tenant"),
        ).order_by("cost_center", "step_order", "min_amount")
        if cost_center := request.query_params.get("cost_center"):
            qs = qs.filter(cost_center=cost_center)
        return Response({"results": ApprovalMatrixSerializer(qs, many=True).data, "count": qs.count()})

    def post(self, request):
        tenant = _resolve_tenant(request.user)
        if tenant is False:
            return Response({"error": "No tenant profile linked."}, status=status.HTTP_403_FORBIDDEN)
        serializer = ApprovalMatrixWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        obj = serializer.save(tenant=tenant)
        return Response(ApprovalMatrixSerializer(obj).data, status=status.HTTP_201_CREATED)


class ApprovalMatrixDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get(self, request, pk):
        try:
            return _apply_requisition_tenant_filter(
                request.user,
                ApprovalMatrix.objects.select_related("approval_group", "tenant"),
            ).get(pk=pk)
        except ApprovalMatrix.DoesNotExist:
            return None

    def patch(self, request, pk):
        obj = self._get(request, pk)
        if not obj:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = ApprovalMatrixWriteSerializer(obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        obj = serializer.save()
        return Response(ApprovalMatrixSerializer(obj).data)

    def delete(self, request, pk):
        obj = self._get(request, pk)
        if not obj:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ApprovalGroupListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        groups = Group.objects.order_by("name").values("id", "name")
        return Response({"results": list(groups), "count": len(groups)})


class RequisitionListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = _apply_requisition_tenant_filter(
            request.user,
            Requisition.objects.prefetch_related("lines").select_related("gl_account", "requested_by"),
        ).order_by("-created_at")
        if status_filter := request.query_params.get("status"):
            qs = qs.filter(status=status_filter)
        if budget_status := request.query_params.get("budget_status"):
            qs = qs.filter(budget_status=budget_status)
        if q := request.query_params.get("search"):
            from django.db.models import Q

            qs = qs.filter(
                Q(request_number__icontains=q)
                | Q(title__icontains=q)
                | Q(cost_center__icontains=q)
                | Q(project_code__icontains=q)
            )
        if created_from := request.query_params.get("created_from"):
            qs = qs.filter(created_at__date__gte=created_from)
        if created_to := request.query_params.get("created_to"):
            qs = qs.filter(created_at__date__lte=created_to)

        page = max(int(request.query_params.get("page", 1) or 1), 1)
        page_size = min(max(int(request.query_params.get("page_size", 10) or 10), 1), 200)
        paginator = Paginator(qs, page_size)
        page_obj = paginator.get_page(page)
        return Response({
            "results": RequisitionSerializer(page_obj.object_list, many=True).data,
            "count": paginator.count,
            "page": page_obj.number,
            "page_size": page_size,
            "total_pages": paginator.num_pages,
            "next": page_obj.next_page_number() if page_obj.has_next() else None,
            "previous": page_obj.previous_page_number() if page_obj.has_previous() else None,
        })

    def post(self, request):
        tenant = _resolve_tenant(request.user)
        if tenant is False:
            return Response({"error": "No tenant profile linked."}, status=status.HTTP_403_FORBIDDEN)
        serializer = RequisitionWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        relation_errors = _validate_requisition_payload(
            tenant=tenant,
            branch=serializer.validated_data.get("branch"),
            gl_account=serializer.validated_data.get("gl_account"),
            lines=serializer.validated_data.get("lines"),
        )
        if relation_errors:
            return Response(relation_errors, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            requisition = serializer.save(tenant=tenant, requested_by=request.user)
            budget_status, budget_message = _run_budget_check(requisition)
            requisition.budget_status = budget_status
            requisition.budget_message = budget_message
            if requisition.status == "submitted":
                requisition.submitted_at = timezone.now()
                rules = _sync_requisition_approvals(requisition)
                if budget_status == "passed":
                    if rules:
                        requisition.status = "pending_approval"
                    else:
                        _finalize_requisition_approval(requisition)
                        return Response(RequisitionSerializer(requisition).data, status=status.HTTP_201_CREATED)
            requisition.save(
                update_fields=["budget_status", "budget_message", "status", "submitted_at", "updated_at"]
            )
        return Response(RequisitionSerializer(requisition).data, status=status.HTTP_201_CREATED)


class RequisitionDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get(self, request, pk):
        try:
            return _apply_requisition_tenant_filter(
                request.user,
                Requisition.objects.prefetch_related("lines").select_related("gl_account", "requested_by"),
            ).get(pk=pk)
        except Requisition.DoesNotExist:
            return None

    def get(self, request, pk):
        requisition = self._get(request, pk)
        if not requisition:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(RequisitionSerializer(requisition).data)

    def patch(self, request, pk):
        requisition = self._get(request, pk)
        if not requisition:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = RequisitionWriteSerializer(requisition, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        relation_errors = _validate_requisition_payload(
            tenant=requisition.tenant,
            branch=serializer.validated_data.get("branch", requisition.branch),
            gl_account=serializer.validated_data.get("gl_account", requisition.gl_account),
            lines=serializer.validated_data.get("lines"),
        )
        if relation_errors:
            return Response(relation_errors, status=status.HTTP_400_BAD_REQUEST)
        requisition = serializer.save()
        budget_status, budget_message = _run_budget_check(requisition)
        requisition.budget_status = budget_status
        requisition.budget_message = budget_message
        if requisition.status in {"submitted", "pending_approval"}:
            _sync_requisition_approvals(requisition)
        requisition.save(update_fields=["budget_status", "budget_message", "updated_at"])
        return Response(RequisitionSerializer(requisition).data)


class PurchaseOrderListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not HAS_PROCUREMENT_MODELS:
            return Response({"results": [], "count": 0})

        # ── Tenant isolation guard ────────────────────────────────────────────
        # - Superusers: global access
        # - Profiled non-superusers: scoped to their tenant (param check too)
        # - Profileless non-superusers: deny-all via _apply_po_tenant_filter
        if not request.user.is_superuser:
            tenant_code_param = request.query_params.get("tenant_code")
            user_tenant = resolve_user_tenant(request.user)
            if user_tenant is NO_TENANT_ACCESS:
                user_tenant = None
            if tenant_code_param and user_tenant and tenant_code_param != user_tenant.code:
                return Response({"results": [], "count": 0})

        qs = ProcurementDashboardView._apply_po_tenant_filter(
            request,
            PurchaseOrder.objects.prefetch_related("items").order_by("-created_at"),
        )

        if s := request.query_params.get("status"):
            qs = qs.filter(status=s)
        if q := request.query_params.get("search"):
            from django.db.models import Q
            qs = qs.filter(Q(reference__icontains=q) | Q(supplier_name__icontains=q) | Q(notes__icontains=q))
        data = PurchaseOrderSerializer(qs, many=True).data
        return Response({"results": list(data), "count": len(data)})

    def post(self, request):
        if not HAS_PROCUREMENT_MODELS:
            return Response({"error": "Procurement module not available."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        body = request.data
        items_data = body.get("items", [])

        # Auto-reference if not provided
        ref = body.get("reference") or _next_reference()
        write_data = {**body, "reference": ref}
        write_data.pop("items", None)

        ser = PurchaseOrderWriteSerializer(data=write_data)
        ser.is_valid(raise_exception=True)
        tenant = _resolve_tenant(request.user)
        if tenant is False:
            return Response({"error": "No tenant profile linked."}, status=status.HTTP_403_FORBIDDEN)
        relation_errors = _validate_purchase_order_payload(
            tenant=tenant,
            branch=ser.validated_data.get("branch"),
            requisition=ser.validated_data.get("requisition"),
            gl_account=ser.validated_data.get("gl_account"),
        )
        if relation_errors:
            return Response(relation_errors, status=status.HTTP_400_BAD_REQUEST)
        po = ser.save(created_by=request.user, tenant=tenant if tenant is not None else write_data.get("tenant"))

        # Save items
        for item in items_data:
            PurchaseOrderItem.objects.create(
                order=po,
                description=item.get("description", ""),
                unit=item.get("unit", "pcs"),
                quantity=item.get("quantity", 1),
                unit_price=item.get("unit_price", 0),
                total=0,  # calculated in model.save()
            )
        po.recalculate_total()
        return Response(PurchaseOrderSerializer(po).data, status=status.HTTP_201_CREATED)


class RequisitionStatusView(APIView):
    permission_classes = [IsAuthenticated]

    ALLOWED_TRANSITIONS = {
        "draft": ["submitted", "cancelled"],
        "submitted": ["pending_approval", "cancelled", "rejected"],
        "pending_approval": ["approved", "rejected", "cancelled"],
        "approved": ["po_created", "cancelled"],
        "po_created": [],
        "rejected": ["draft"],
        "cancelled": ["draft"],
    }

    def patch(self, request, pk):
        requisition = RequisitionDetailView()._get(request, pk)
        if not requisition:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        new_status = request.data.get("status")
        allowed = self.ALLOWED_TRANSITIONS.get(requisition.status, [])
        if new_status not in allowed:
            return Response(
                {"error": f"Cannot transition from '{requisition.status}' to '{new_status}'. Allowed: {allowed}"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if new_status in {"submitted", "pending_approval"}:
            budget_status, budget_message = _run_budget_check(requisition)
            requisition.budget_status = budget_status
            requisition.budget_message = budget_message
            if budget_status == "blocked":
                return Response(
                    {"error": budget_message, "budget_status": budget_status},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            requisition.submitted_at = requisition.submitted_at or timezone.now()
            rules = _sync_requisition_approvals(requisition)
            if new_status == "pending_approval" and not rules:
                _finalize_requisition_approval(requisition)
                return Response(RequisitionSerializer(requisition).data)
        if new_status == "approved":
            if requisition.approvals.filter(status="pending").exists():
                return Response(
                    {"error": "Requisition still has pending approval steps."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            _finalize_requisition_approval(requisition)
            return Response(RequisitionSerializer(requisition).data)
        requisition.status = new_status
        requisition.save(
            update_fields=[
                "status",
                "budget_status",
                "budget_message",
                "submitted_at",
                "approved_at",
                "updated_at",
            ]
        )
        return Response(RequisitionSerializer(requisition).data)


class RequisitionApprovalActionView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        requisition = RequisitionDetailView()._get(request, pk)
        if not requisition:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        approval_batch = _current_pending_approval_batch(requisition)
        approval = approval_batch.filter(assigned_user=request.user).first() or approval_batch.first()
        if not approval:
            return Response({"error": "No pending approval step."}, status=status.HTTP_400_BAD_REQUEST)

        decision = (request.data.get("decision") or "approve").lower()
        notes = request.data.get("notes", "")
        user_group_ids = set(request.user.groups.values_list("id", flat=True))
        if not request.user.is_superuser and approval.approval_group_id not in user_group_ids:
            return Response(
                {"error": f"Current step requires membership in '{approval.approval_group.name}'."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if approval.assigned_user_id and approval.assigned_user_id != request.user.id and not request.user.is_superuser:
            return Response(
                {"error": "This committee approval is assigned to another member."},
                status=status.HTTP_403_FORBIDDEN,
            )

        with transaction.atomic():
            approval.assigned_user = request.user
            approval.acted_by = request.user
            approval.acted_at = timezone.now()
            approval.decision_notes = notes
            if decision == "reject":
                approval.status = "rejected"
                approval.save(update_fields=["assigned_user", "acted_by", "acted_at", "decision_notes", "status", "updated_at"])
                requisition.status = "rejected"
                requisition.save(update_fields=["status", "updated_at"])
                _close_workflow_inbox_items(requisition, status_value="rejected", acted_by=request.user)
                return Response(RequisitionSerializer(requisition).data)

            approval.status = "approved"
            approval.save(update_fields=["assigned_user", "acted_by", "acted_at", "decision_notes", "status", "updated_at"])

            step_complete = True
            if approval.workflow_node_id:
                step_complete = _is_committee_step_complete(requisition, approval.workflow_node)

            next_step = _current_pending_approval(requisition)
            if not step_complete:
                requisition.status = "pending_approval"
                requisition.save(update_fields=["status", "updated_at"])
                current = _current_pending_approval(requisition)
                if current:
                    _build_workflow_inbox_item(requisition, current, workflow=current.workflow_node.workflow if current.workflow_node_id else None)
            elif next_step:
                requisition.status = "pending_approval"
                requisition.save(update_fields=["status", "updated_at"])
                workflow, steps = _matching_central_workflow_steps(requisition)
                matching_step = None
                for step in steps:
                    if isinstance(step, WorkflowNodeDefinition):
                        if step.id == next_step.workflow_node_id:
                            matching_step = step
                            break
                    elif step.step_order == next_step.step_order and step.approval_group_id == next_step.approval_group_id:
                        matching_step = step
                        break
                _build_workflow_inbox_item(
                    requisition,
                    next_step,
                    workflow=workflow,
                    step_definition=matching_step if isinstance(matching_step, WorkflowStepDefinition) else None,
                )
            else:
                _finalize_requisition_approval(requisition)

        return Response(RequisitionSerializer(requisition).data)


class RequisitionConvertToPOView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        requisition = RequisitionDetailView()._get(request, pk)
        if not requisition:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        if requisition.status not in {"approved", "po_created"}:
            return Response(
                {"error": "Only approved requisitions can be converted to purchase orders."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        existing = _apply_purchase_order_tenant_filter(
            request.user,
            PurchaseOrder.objects.prefetch_related("items"),
        ).filter(requisition=requisition).first()
        if existing:
            return Response(PurchaseOrderSerializer(existing).data)

        supplier_name = request.data.get("supplier_name") or requisition.vendor_option or "Pending Supplier"
        supplier_email = request.data.get("supplier_email", "")
        supplier_phone = request.data.get("supplier_phone", "")
        expected_date = request.data.get("expected_date") or requisition.needed_by

        po = PurchaseOrder.objects.create(
            tenant=requisition.tenant,
            branch=requisition.branch,
            requisition=requisition,
            reference=request.data.get("reference") or _next_reference(),
            supplier_name=supplier_name,
            supplier_email=supplier_email,
            supplier_phone=supplier_phone,
            status="Draft",
            order_date=timezone.localdate(),
            expected_date=expected_date,
            cost_center=requisition.cost_center,
            gl_account=requisition.gl_account,
            project_code=requisition.project_code,
            total_amount=0,
            currency=requisition.currency,
            notes=requisition.description or "",
            created_by=request.user,
        )
        for line in requisition.lines.all():
            PurchaseOrderItem.objects.create(
                order=po,
                product=line.product,
                description=line.description,
                unit=line.unit,
                quantity=line.quantity,
                unit_price=line.unit_price,
                total=0,
            )
        po.recalculate_total()
        requisition.status = "po_created"
        requisition.save(update_fields=["status", "updated_at"])

        if HAS_BUDGETING_MODELS:
            commitment = BudgetCommitment.objects.filter(
                tenant=requisition.tenant,
                source_type="requisition",
                source_reference=requisition.request_number,
                state="committed",
            ).select_related("budget_line").first()
            if commitment:
                budget_line = commitment.budget_line
                amount = commitment.amount
                budget_line.committed_amount = max(Decimal("0.00"), (budget_line.committed_amount or Decimal("0.00")) - amount)
                budget_line.obligated_amount = (budget_line.obligated_amount or Decimal("0.00")) + amount
                budget_line.save(update_fields=["committed_amount", "obligated_amount", "updated_at"])
                commitment.state = "obligated"
                commitment.source_type = "purchase_order"
                commitment.source_reference = po.reference
                commitment.save(update_fields=["state", "source_type", "source_reference", "updated_at"])

        return Response(PurchaseOrderSerializer(po).data, status=status.HTTP_201_CREATED)


class GoodsReceiptListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = _apply_purchase_order_tenant_filter(
            request.user,
            GoodsReceiptNote.objects.prefetch_related("lines").select_related("purchase_order", "received_by"),
        ).order_by("-created_at")
        if po_id := request.query_params.get("purchase_order_id"):
            qs = qs.filter(purchase_order_id=po_id)
        if status_filter := request.query_params.get("status"):
            qs = qs.filter(status=status_filter)
        return Response({"results": GoodsReceiptSerializer(qs, many=True).data, "count": qs.count()})

    def post(self, request):
        tenant = _resolve_tenant(request.user)
        if tenant is False:
            return Response({"error": "No tenant profile linked."}, status=status.HTTP_403_FORBIDDEN)
        serializer = GoodsReceiptWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        relation_errors = _validate_goods_receipt_payload(
            tenant=tenant,
            branch=serializer.validated_data.get("branch"),
            purchase_order=serializer.validated_data.get("purchase_order"),
            lines=serializer.validated_data.get("lines"),
        )
        if relation_errors:
            return Response(relation_errors, status=status.HTTP_400_BAD_REQUEST)
        receipt = serializer.save(tenant=tenant, received_by=request.user)
        sync_goods_receipt_to_inventory(receipt, actor=request.user)
        return Response(GoodsReceiptSerializer(receipt).data, status=status.HTTP_201_CREATED)


class GoodsReceiptDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get(self, request, pk):
        try:
            return _apply_purchase_order_tenant_filter(
                request.user,
                GoodsReceiptNote.objects.prefetch_related("lines").select_related("purchase_order", "received_by"),
            ).get(pk=pk)
        except GoodsReceiptNote.DoesNotExist:
            return None

    def get(self, request, pk):
        receipt = self._get(request, pk)
        if not receipt:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(GoodsReceiptSerializer(receipt).data)

    def patch(self, request, pk):
        receipt = self._get(request, pk)
        if not receipt:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = GoodsReceiptWriteSerializer(receipt, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        relation_errors = _validate_goods_receipt_payload(
            tenant=receipt.tenant,
            branch=serializer.validated_data.get("branch", receipt.branch),
            purchase_order=serializer.validated_data.get("purchase_order", receipt.purchase_order),
            lines=serializer.validated_data.get("lines"),
        )
        if relation_errors:
            return Response(relation_errors, status=status.HTTP_400_BAD_REQUEST)
        receipt = serializer.save()
        sync_goods_receipt_to_inventory(receipt, actor=request.user)
        return Response(GoodsReceiptSerializer(receipt).data)


class PurchaseOrderDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get(self, request, pk):
        """
        Fetch a PurchaseOrder by PK with tenant scoping.

        - Superusers: global access
        - Profiled non-superusers: only POs in their own tenant (others → None/404)
        - Profileless non-superusers: deny-all → qs.none() → always None/404
        """
        qs = ProcurementDashboardView._apply_po_tenant_filter(
            request, PurchaseOrder.objects.prefetch_related("items")
        )
        try:
            return qs.get(pk=pk)
        except PurchaseOrder.DoesNotExist:
            return None

    def get(self, request, pk):
        if not HAS_PROCUREMENT_MODELS:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        po = self._get(request, pk)
        if not po:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(PurchaseOrderSerializer(po).data)

    def patch(self, request, pk):
        if not HAS_PROCUREMENT_MODELS:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        po = self._get(request, pk)
        if not po:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        body = {**request.data}
        items_data = body.pop("items", None)
        ser = PurchaseOrderWriteSerializer(po, data=body, partial=True)
        ser.is_valid(raise_exception=True)
        relation_errors = _validate_purchase_order_payload(
            tenant=po.tenant,
            branch=ser.validated_data.get("branch", po.branch),
            requisition=ser.validated_data.get("requisition", po.requisition),
            gl_account=ser.validated_data.get("gl_account", po.gl_account),
        )
        if relation_errors:
            return Response(relation_errors, status=status.HTTP_400_BAD_REQUEST)
        ser.save()
        if items_data is not None:
            po.items.all().delete()
            for item in items_data:
                PurchaseOrderItem.objects.create(
                    order=po,
                    description=item.get("description", ""),
                    unit=item.get("unit", "pcs"),
                    quantity=item.get("quantity", 1),
                    unit_price=item.get("unit_price", 0),
                    total=0,
                )
            po.recalculate_total()
        return Response(PurchaseOrderSerializer(po).data)

    def delete(self, request, pk):
        if not HAS_PROCUREMENT_MODELS:
            return Response(status=status.HTTP_204_NO_CONTENT)
        po = self._get(request, pk)
        if not po:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        po.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PurchaseOrderDocumentView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        if not HAS_PROCUREMENT_MODELS:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        po = PurchaseOrderDetailView()._get(request, pk)
        if not po:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        tenant = po.tenant
        rendered = render_purchase_order_document(po, request=request, tenant=tenant)
        return HttpResponse(rendered.html, content_type="text/html; charset=utf-8")


class PurchaseOrderStatusView(APIView):
    """PATCH /api/procurement/orders/<pk>/status/  { status: 'Approved' }"""
    permission_classes = [IsAuthenticated]

    ALLOWED_TRANSITIONS = {
        "Draft":     ["Submitted", "Cancelled"],
        "Submitted": ["Approved", "Cancelled", "Draft"],
        "Approved":  ["Received", "Cancelled"],
        "Received":  [],
        "Cancelled": ["Draft"],
    }

    def patch(self, request, pk):
        if not HAS_PROCUREMENT_MODELS:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            qs = ProcurementDashboardView._apply_po_tenant_filter(
                request, PurchaseOrder.objects.all()
            )
            po = qs.get(pk=pk)
        except PurchaseOrder.DoesNotExist:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        new_status = request.data.get("status")
        allowed = self.ALLOWED_TRANSITIONS.get(po.status, [])
        if new_status not in allowed:
            return Response(
                {"error": f"Cannot transition from '{po.status}' to '{new_status}'. Allowed: {allowed}"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        po.status = new_status
        po.save(update_fields=["status", "updated_at"])
        return Response(PurchaseOrderSerializer(po).data)
