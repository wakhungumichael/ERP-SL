from django.contrib.auth.models import Permission, User
from django.contrib.contenttypes.models import ContentType
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from Platform_Core.models import AuditEventLog, DocumentTemplate, Tenant, TenantUserProfile


class RecordAuditTrailTenantScopingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.tenant_a = Tenant.objects.create(
            name="Audit Tenant A",
            code="audit-a",
            is_active=True,
            status="active",
        )
        self.tenant_b = Tenant.objects.create(
            name="Audit Tenant B",
            code="audit-b",
            is_active=True,
            status="active",
        )
        self.user_a = User.objects.create_user("audit_admin_a", password="pass", is_staff=True)
        TenantUserProfile.objects.create(user=self.user_a, tenant=self.tenant_a, is_tenant_admin=True)

        content_type = ContentType.objects.get_for_model(Tenant)
        permission, _ = Permission.objects.get_or_create(
            content_type=content_type,
            codename="view_tenant_audit_logs",
            defaults={"name": "Can view tenant audit logs"},
        )
        self.user_a.user_permissions.add(permission)
        self.client.force_authenticate(self.user_a)

        self.template_a = DocumentTemplate.objects.create(
            tenant=self.tenant_a,
            name="Template A",
            document_type="invoice",
            engine="html",
            body_template="<p>A</p>",
        )
        self.template_b = DocumentTemplate.objects.create(
            tenant=self.tenant_b,
            name="Template B",
            document_type="invoice",
            engine="html",
            body_template="<p>B</p>",
        )

        AuditEventLog.objects.create(
            tenant=self.tenant_b,
            actor=self.user_a,
            event_group="model",
            event_type="create",
            model_label="Platform_Core.DocumentTemplate",
            object_pk=str(self.template_a.id),
            object_repr="Cross-tenant template event",
            changes={},
            metadata={},
        )
        AuditEventLog.objects.create(
            tenant=self.tenant_a,
            actor=self.user_a,
            event_group="model",
            event_type="update",
            model_label="Platform_Core.DocumentTemplate",
            object_pk=str(self.template_a.id),
            object_repr="Tenant A template event",
            changes={},
            metadata={},
        )

    def test_record_audit_trail_summary_is_tenant_scoped(self):
        response = self.client.get(
            reverse("platform-record-audit-trail"),
            {
                "model_label": "Platform_Core.DocumentTemplate",
                "object_pk": self.template_a.id,
            },
        )

        self.assertEqual(response.status_code, 200, response.data)
        payload = response.data["data"]
        self.assertGreaterEqual(len(payload["events"]), 1)
        self.assertTrue(all(event["tenant"] == self.tenant_a.id for event in payload["events"]))
        self.assertIsNotNone(payload["summary"]["updated_by_id"])
