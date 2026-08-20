from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from Platform_Core.models import Tenant, TenantExportJob, TenantOffboardingRequest, TenantUserProfile


class TenantOffboardingApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.tenant_a = Tenant.objects.create(
            name="Offboarding Tenant A",
            code="offboarding-a",
            is_active=True,
            status="active",
        )
        self.tenant_b = Tenant.objects.create(
            name="Offboarding Tenant B",
            code="offboarding-b",
            is_active=True,
            status="active",
        )
        self.user_a = User.objects.create_user("offboarding_admin_a", password="pass", is_staff=True)
        TenantUserProfile.objects.create(user=self.user_a, tenant=self.tenant_a, is_tenant_admin=True)
        self.client.force_authenticate(self.user_a)

    def test_tenant_admin_can_request_delete_for_own_tenant(self):
        response = self.client.post(
            reverse("tenant-offboarding-request-delete", kwargs={"pk": self.tenant_a.id}),
            {
                "retention_days": 14,
                "notes": "Customer requested account closure.",
                "export_requested": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        request_obj = TenantOffboardingRequest.objects.get(tenant=self.tenant_a)
        export_job = TenantExportJob.objects.get(tenant=self.tenant_a)
        self.assertEqual(request_obj.status, "deletion_requested")
        self.assertTrue(request_obj.export_requested)
        self.assertEqual(export_job.offboarding_request_id, request_obj.id)

    def test_tenant_admin_can_queue_export_and_view_status(self):
        export_response = self.client.post(
            reverse("tenant-offboarding-export", kwargs={"pk": self.tenant_a.id}),
            {"export_format": "csv_bundle"},
            format="json",
        )
        self.assertEqual(export_response.status_code, 201, export_response.data)

        status_response = self.client.get(
            reverse("tenant-offboarding-status", kwargs={"pk": self.tenant_a.id})
        )
        self.assertEqual(status_response.status_code, 200, status_response.data)
        payload = status_response.data["data"]
        self.assertIsNone(payload["offboarding_request"])
        self.assertEqual(payload["latest_export_job"]["tenant"]["id"], self.tenant_a.id)
        self.assertEqual(payload["latest_export_job"]["export_format"], "csv_bundle")
        self.assertTrue(payload["capabilities"]["raw_delete_blocked"])

    def test_tenant_admin_cannot_request_other_tenant_offboarding(self):
        response = self.client.post(
            reverse("tenant-offboarding-request-delete", kwargs={"pk": self.tenant_b.id}),
            {"retention_days": 7},
            format="json",
        )

        self.assertEqual(response.status_code, 403, response.data)
        self.assertFalse(TenantOffboardingRequest.objects.filter(tenant=self.tenant_b).exists())
