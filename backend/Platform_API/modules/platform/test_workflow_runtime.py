from django.contrib.auth.models import Group, User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from Platform_Core.models import (
    Tenant,
    TenantUserProfile,
    WorkflowDefinition,
    WorkflowEntityBinding,
    WorkflowInboxItem,
    WorkflowNodeDefinition,
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
