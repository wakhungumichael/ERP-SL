# Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
from django.contrib.auth.models import Group, Permission, User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from Platform_Core.models import (
    Tenant,
    OrganizationMembership,
    TenantUserProfile,
    WorkflowDefinition,
    WorkflowEntityBinding,
    WorkflowInboxItem,
    WorkflowNodeDefinition,
    WorkflowTransitionDefinition,
    SystemNotification,
)


class WorkflowRuntimeTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.tenant = Tenant.objects.create(name="Workflow Tenant", code="workflow-tenant", is_active=True, status="active")
        self.submitter = User.objects.create_user("workflow_submitter", password="pass")
        self.approver = User.objects.create_user("workflow_approver", password="pass")
        TenantUserProfile.objects.create(user=self.submitter, tenant=self.tenant, is_tenant_admin=True)
        TenantUserProfile.objects.create(user=self.approver, tenant=self.tenant)
        self.approver_group = Group.objects.create(name="Workflow Approvers")
        self.approver.groups.add(self.approver_group)
        self.workflow = WorkflowDefinition.objects.create(
            tenant=self.tenant,
            code="weighbridge-review",
            name="Weighbridge Review",
            entity_type="weighbridge_transaction",
            trigger_event="submit",
            status="published",
        )
        WorkflowEntityBinding.objects.create(
            workflow=self.workflow,
            module_slug="weighbridge",
            entity_type="weighbridge_transaction",
            entity_label="Weighbridge Transaction",
            trigger_events=["submit"],
            is_primary=True,
        )
        WorkflowNodeDefinition.objects.create(
            workflow=self.workflow,
            code="operator-review",
            name="Operator Review",
            node_type="approval",
            is_initial=True,
            approval_group=self.approver_group,
        )

    def test_bound_record_can_be_forwarded_and_completed_by_assigned_group(self):
        self.client.force_authenticate(self.submitter)
        forwarded = self.client.post(
            reverse("workflow-forward"),
            {
                "module_slug": "weighbridge",
                "entity_type": "weighbridge_transaction",
                "entity_id": 91,
                "reference": "TX-00091",
                "title": "Approval required: TX-00091",
            },
            format="json",
        )

        self.assertEqual(forwarded.status_code, 201, forwarded.data)
        item = WorkflowInboxItem.objects.get(entity_id=91)
        self.assertEqual(item.assigned_group, self.approver_group)
        self.assertEqual(item.status, "pending")

        requirement = self.client.get(
            reverse("workflow-requirement"),
            {"module_slug": "weighbridge", "entity_type": "weighbridge_transaction", "trigger_event": "submit", "entity_id": 91},
        )
        self.assertEqual(requirement.status_code, 200, requirement.data)
        self.assertTrue(requirement.data["data"]["required"])
        self.assertTrue(requirement.data["data"]["in_progress"])

        self.client.force_authenticate(self.approver)
        completed = self.client.post(
            reverse("workflow-inbox-action", kwargs={"pk": item.pk}),
            {"decision": "approve"},
            format="json",
        )

        self.assertEqual(completed.status_code, 200, completed.data)
        item.refresh_from_db()
        self.assertEqual(item.status, "completed")
        self.assertEqual(item.acted_by, self.approver)

    def test_published_workflow_is_revised_instead_of_edited(self):
        self.client.force_authenticate(self.submitter)

        update = self.client.patch(
            reverse("workflow-definition-detail", kwargs={"pk": self.workflow.pk}),
            {"name": "Changed workflow"},
            format="json",
        )
        self.assertEqual(update.status_code, 400, update.data)
        self.workflow.refresh_from_db()
        self.assertEqual(self.workflow.name, "Weighbridge Review")

        revision = self.client.post(
            reverse("workflow-definition-action", kwargs={"pk": self.workflow.pk, "action": "duplicate"}),
            format="json",
        )
        self.assertEqual(revision.status_code, 201, revision.data)
        draft = WorkflowDefinition.objects.get(revision_of=self.workflow)
        self.assertEqual(draft.status, "draft")
        self.assertEqual(draft.version, "1.1")
        self.assertEqual(draft.nodes.count(), 1)
        self.assertEqual(draft.entity_bindings.count(), 1)

    def test_inactive_workflow_is_not_required_or_forwarded(self):
        self.workflow.status = "inactive"
        self.workflow.is_active = False
        self.workflow.save()
        self.client.force_authenticate(self.submitter)

        requirement = self.client.get(
            reverse("workflow-requirement"),
            {"module_slug": "weighbridge", "entity_type": "weighbridge_transaction", "trigger_event": "submit"},
        )
        self.assertEqual(requirement.status_code, 200)
        self.assertFalse(requirement.data["data"]["required"])

        forwarded = self.client.post(reverse("workflow-forward"), {"module_slug": "weighbridge", "entity_type": "weighbridge_transaction", "entity_id": 92}, format="json")
        self.assertEqual(forwarded.status_code, 400)

    def test_forwarding_requires_the_active_role_permission(self):
        submitter = User.objects.create_user("workflow_limited_submitter", password="pass")
        TenantUserProfile.objects.create(user=submitter, tenant=self.tenant)
        active_group = Group.objects.create(name="Workflow Cashier")
        submitter_group = Group.objects.create(name="Workflow Submitters")
        submitter.groups.add(active_group, submitter_group)
        membership = OrganizationMembership.objects.create(
            user=submitter,
            tenant=self.tenant,
            role="member",
            active_role_group_name=active_group.name,
            is_default=True,
        )
        self.client.force_authenticate(submitter)

        denied = self.client.post(reverse("workflow-forward"), {
            "module_slug": "weighbridge", "entity_type": "weighbridge_transaction", "entity_id": 94,
        }, format="json")
        self.assertEqual(denied.status_code, 403)

        permission = Permission.objects.get(
            content_type__app_label="Platform_Core", codename="forward_workflow"
        )
        submitter_group.permissions.add(permission)

        # The user owns the permission through a second role, but it must not
        # apply until they select that role for the active workspace session.
        still_denied = self.client.post(reverse("workflow-forward"), {
            "module_slug": "weighbridge", "entity_type": "weighbridge_transaction", "entity_id": 94,
        }, format="json")
        self.assertEqual(still_denied.status_code, 403)

        membership.active_role_group_name = submitter_group.name
        membership.save(update_fields=["active_role_group_name", "updated_at"])

        allowed = self.client.post(reverse("workflow-forward"), {
            "module_slug": "weighbridge", "entity_type": "weighbridge_transaction", "entity_id": 94,
        }, format="json")
        self.assertEqual(allowed.status_code, 201, allowed.data)

    def test_high_value_request_routes_to_second_step_and_notifies_assignee(self):
        finance = Group.objects.create(name="Workflow Finance")
        finance_user = User.objects.create_user("workflow_finance", password="pass")
        TenantUserProfile.objects.create(user=finance_user, tenant=self.tenant)
        finance_user.groups.add(finance)
        final_node = WorkflowNodeDefinition.objects.create(
            workflow=self.workflow, code="finance-review", name="Finance Review", node_type="approval", step_order=2, approval_group=finance,
        )
        WorkflowTransitionDefinition.objects.create(
            workflow=self.workflow, from_node=self.workflow.nodes.get(code="operator-review"), to_node=final_node,
            name="High value", decision="approve", condition_field="context.total_amount", condition_operator="gte", condition_value="50000",
        )
        self.client.force_authenticate(self.submitter)
        forwarded = self.client.post(reverse("workflow-forward"), {
            "module_slug": "weighbridge", "entity_type": "weighbridge_transaction", "entity_id": 93,
            "metadata": {"context": {"total_amount": 60000}},
        }, format="json")
        self.assertEqual(forwarded.status_code, 201, forwarded.data)
        first = WorkflowInboxItem.objects.get(entity_id=93)
        self.assertTrue(SystemNotification.objects.filter(recipient=self.approver, source_id=first.id).exists())
        self.client.force_authenticate(self.approver)
        approved = self.client.post(reverse("workflow-inbox-action", kwargs={"pk": first.pk}), {"decision": "approve"}, format="json")
        self.assertEqual(approved.status_code, 200, approved.data)
        second = WorkflowInboxItem.objects.get(entity_id=93, status="pending")
        self.assertEqual(second.assigned_group, finance)
        self.assertTrue(SystemNotification.objects.filter(recipient=finance_user, source_id=second.id).exists())

    def test_inbox_scopes_pagination_submissions_and_decisions_to_active_role(self):
        cashier = Group.objects.create(name="Workflow Cashier")
        supervisor = Group.objects.create(name="Workflow Supervisor")
        self.approver.groups.add(cashier, supervisor)
        membership = OrganizationMembership.objects.create(
            user=self.approver,
            tenant=self.tenant,
            role="member",
            active_role_group_name=cashier.name,
            is_default=True,
        )

        def create_item(entity_id, *, group, status="pending", submitted_role="", acted=False):
            return WorkflowInboxItem.objects.create(
                tenant=self.tenant,
                workflow=self.workflow,
                node_definition=self.workflow.nodes.get(code="operator-review"),
                entity_type="weighbridge_transaction",
                entity_id=entity_id,
                title=f"Approval required: TX-{entity_id}",
                status=status,
                assigned_group=group,
                acted_by=self.approver if acted else None,
                metadata={"submitted_by": self.approver.id, "submitted_role": submitted_role},
            )

        cashier_pending = create_item(101, group=cashier, submitted_role=cashier.name)
        cashier_pending_second = create_item(102, group=cashier, submitted_role=cashier.name)
        supervisor_pending = create_item(103, group=supervisor, submitted_role=supervisor.name)
        cashier_decision = create_item(104, group=cashier, status="completed", submitted_role=cashier.name, acted=True)
        create_item(105, group=supervisor, status="completed", submitted_role=supervisor.name, acted=True)

        self.client.force_authenticate(self.approver)
        inbox = self.client.get(reverse("workflow-inbox"), {"page": 1, "page_size": 1})
        self.assertEqual(inbox.status_code, 200, inbox.data)
        self.assertEqual(inbox.data["data"]["count"], 2)
        self.assertEqual(inbox.data["data"]["pagination"]["total_pages"], 2)
        self.assertEqual(inbox.data["data"]["results"][0]["assigned_group"], cashier.id)
        self.assertNotEqual(inbox.data["data"]["results"][0]["id"], supervisor_pending.id)

        submissions = self.client.get(reverse("workflow-inbox"), {"scope": "submitted", "status": "all"})
        self.assertEqual({row["id"] for row in submissions.data["data"]["results"]}, {cashier_pending.id, cashier_pending_second.id, cashier_decision.id})

        decisions = self.client.get(reverse("workflow-inbox"), {"scope": "decided", "status": "all"})
        self.assertEqual([row["id"] for row in decisions.data["data"]["results"]], [cashier_decision.id])

        membership.active_role_group_name = supervisor.name
        membership.save(update_fields=["active_role_group_name", "updated_at"])
        supervisor_inbox = self.client.get(reverse("workflow-inbox"))
        self.assertEqual([row["id"] for row in supervisor_inbox.data["data"]["results"]], [supervisor_pending.id])
