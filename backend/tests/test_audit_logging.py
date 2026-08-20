from django.contrib.auth.models import Group, Permission, User
from django.test import RequestFactory, TestCase
from django.urls import reverse
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from Platform_Core.audit import clear_audit_request, log_access_event, log_business_event, set_audit_request
from Platform_Core.models import AuditAccessLog, AuditEventLog, Tenant, TenantUserProfile


class AuditLoggingTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name="Audit Tenant", code="audit-tenant")
        self.user = User.objects.create_user(username="auditor", password="pass123")
        TenantUserProfile.objects.create(user=self.user, tenant=self.tenant, is_tenant_admin=True)
        self.factory = RequestFactory()
        self.client = APIClient()

    def test_model_create_and_update_are_audited_with_tenant_scope(self):
        request = self.factory.post("/api/platform/tenants/")
        request.user = self.user
        set_audit_request(request)

        tenant = Tenant.objects.create(name="Created Tenant", code="created-tenant")
        tenant.name = "Created Tenant Updated"
        tenant.save()
        clear_audit_request()

        logs = AuditEventLog.objects.filter(model_label="Platform_Core.Tenant", object_pk=str(tenant.pk)).order_by("created_at")
        self.assertEqual(logs.count(), 2)
        self.assertEqual(logs.first().event_type, "create")
        self.assertEqual(logs.last().event_type, "update")
        self.assertEqual(logs.first().actor, self.user)
        self.assertIn("name", logs.last().changes)

    def test_access_logs_are_tenant_aware(self):
        request = self.factory.get("/api/sales/products/", {"page": "1"})
        request.user = self.user
        response = type("Response", (), {"status_code": 200})()

        log_access_event(request=request, response=response, user=self.user, event_type="view")

        log = AuditAccessLog.objects.get()
        self.assertEqual(log.tenant, self.tenant)
        self.assertEqual(log.actor, self.user)
        self.assertEqual(log.event_type, "view")
        self.assertEqual(log.status_code, 200)
        self.assertEqual(log.metadata["host"], "testserver")
        self.assertEqual(log.metadata["client_ip"], "127.0.0.1")

    def test_guest_access_logs_capture_host_and_forwarded_ip_details(self):
        request = self.factory.get(
            "/login/",
            HTTP_HOST="erp.example.com",
            HTTP_X_FORWARDED_FOR="41.90.1.10, 10.0.0.3",
            HTTP_X_REAL_IP="41.90.1.10",
            HTTP_REFERER="https://portal.example.com/",
            HTTP_ORIGIN="https://portal.example.com",
            REMOTE_ADDR="10.0.0.3",
        )
        request.user = type("AnonymousUser", (), {"is_authenticated": False})()
        response = type("Response", (), {"status_code": 200})()

        log_access_event(request=request, response=response, user=None, event_type="guest_view")

        log = AuditAccessLog.objects.get()
        self.assertIsNone(log.actor)
        self.assertEqual(log.event_type, "guest_view")
        self.assertEqual(log.remote_addr, "41.90.1.10")
        self.assertEqual(log.metadata["host"], "erp.example.com")
        self.assertEqual(log.metadata["client_ip"], "41.90.1.10")
        self.assertEqual(log.metadata["forwarded_for"], "41.90.1.10, 10.0.0.3")
        self.assertEqual(log.metadata["real_ip"], "41.90.1.10")

    def test_business_events_can_be_grouped_per_process(self):
        request = self.factory.post("/api/accounting/periods/close/")
        request.user = self.user
        set_audit_request(request)

        log_business_event(
            event_group="workflow",
            event_type="close_period",
            tenant=self.tenant,
            actor=self.user,
            note="Closed accounting period via workflow action.",
            metadata={"module": "accounting"},
        )
        clear_audit_request()

        log = AuditEventLog.objects.get(event_group="workflow")
        self.assertEqual(log.tenant, self.tenant)
        self.assertEqual(log.actor, self.user)
        self.assertEqual(log.event_type, "close_period")

    def test_group_role_create_is_audited(self):
        request = self.factory.post("/api/platform/roles/")
        request.user = self.user
        set_audit_request(request)

        role = Group.objects.create(name="Yard Supervisor")

        clear_audit_request()

        log = AuditEventLog.objects.filter(model_label="auth.Group", object_pk=str(role.pk)).order_by("created_at").first()
        self.assertIsNotNone(log)
        self.assertEqual(log.event_type, "create")
        self.assertEqual(log.actor, self.user)
        self.assertEqual(log.tenant, self.tenant)

    def test_group_permission_assignment_is_audited(self):
        request = self.factory.post("/api/platform/roles/")
        request.user = self.user
        set_audit_request(request)

        role = Group.objects.create(name="Dispatch Controller")
        permission = Permission.objects.get(codename="view_tenant_audit_logs")
        role.permissions.add(permission)

        clear_audit_request()

        log = AuditEventLog.objects.filter(
            model_label="auth.Group",
            object_pk=str(role.pk),
            event_type="m2m_add",
        ).order_by("-created_at").first()
        self.assertIsNotNone(log)
        self.assertIn("permissions", log.changes)
        self.assertEqual(log.changes["permissions"]["related_model"], "auth.Permission")
        self.assertEqual(log.changes["permissions"]["related_ids"], [permission.pk])

    def test_tenant_admin_with_permission_can_fetch_only_own_tenant_audit_logs(self):
        self.user.user_permissions.add(
            Permission.objects.get(codename="view_tenant_audit_logs")
        )

        other_tenant = Tenant.objects.create(name="Other Tenant", code="other-tenant")
        other_user = User.objects.create_user(username="other", password="pass123")
        TenantUserProfile.objects.create(user=other_user, tenant=other_tenant, is_tenant_admin=True)

        AuditEventLog.objects.create(tenant=self.tenant, actor=self.user, event_group="workflow", event_type="approve")
        AuditEventLog.objects.create(tenant=other_tenant, actor=other_user, event_group="workflow", event_type="approve")

        token, _ = Token.objects.get_or_create(user=self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        response = self.client.get(reverse("platform-audit-event-list"), {"event_type": "approve"})

        self.assertEqual(response.status_code, 200)
        payload = response.data["data"]
        self.assertEqual(len(payload), 1)
        self.assertEqual(payload[0]["tenant"], self.tenant.id)

    def test_record_audit_trail_endpoint_filters_by_object(self):
        self.user.user_permissions.add(
            Permission.objects.get(codename="view_tenant_audit_logs")
        )

        log = AuditEventLog.objects.create(
            tenant=self.tenant,
            actor=self.user,
            event_group="data_lifecycle",
            event_type="update",
            model_label="Platform_Core.Tenant",
            object_pk="99",
            object_repr="Tenant 99",
        )
        AuditEventLog.objects.create(
            tenant=self.tenant,
            actor=self.user,
            event_group="data_lifecycle",
            event_type="update",
            model_label="Platform_Core.Tenant",
            object_pk="100",
            object_repr="Tenant 100",
        )

        token, _ = Token.objects.get_or_create(user=self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        response = self.client.get(
            reverse("platform-record-audit-trail"),
            {"model_label": "Platform_Core.Tenant", "object_pk": "99"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.data["data"]
        self.assertEqual(len(payload["events"]), 1)
        self.assertEqual(payload["events"][0]["id"], log.id)
