import io
import json
import tempfile
import zipfile

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from Platform_Core.models import BackupPolicy, Tenant, TenantUserProfile
from SL_Sales.models import Estimate, EstimateLineItem, Product


class BackupPolicyIsolationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.tenant = Tenant.objects.create(
            name="Backup Tenant",
            code="backup-tenant",
            is_active=True,
            status="active",
        )
        self.other_tenant = Tenant.objects.create(
            name="Other Tenant",
            code="other-tenant",
            is_active=True,
            status="active",
        )
        self.user = User.objects.create_user("backup_admin", password="pass", is_staff=True)
        self.other_user = User.objects.create_user("other_admin", password="pass", is_staff=True)
        TenantUserProfile.objects.create(user=self.user, tenant=self.tenant, is_tenant_admin=True)
        TenantUserProfile.objects.create(user=self.other_user, tenant=self.other_tenant, is_tenant_admin=True)
        self.policy = BackupPolicy.objects.create(
            tenant=self.tenant,
            name="Nightly Tenant Backup",
            frequency="daily",
            retention_days=7,
            storage_backend="local",
            target_path=self.temp_dir.name,
        )
        self.general_policy = BackupPolicy.objects.create(
            tenant=None,
            name="General Backup",
            frequency="daily",
            retention_days=7,
            storage_backend="local",
            target_path=self.temp_dir.name,
        )
        self.product = Product.objects.create(tenant=self.tenant, code="CONSULT", name="Consulting")
        self.other_product = Product.objects.create(tenant=self.other_tenant, code="OTHER", name="Other service")
        self.estimate = Estimate.objects.create(
            tenant=self.tenant,
            customer_name="Backup Customer",
            created_by=self.user,
        )
        self.other_estimate = Estimate.objects.create(
            tenant=self.other_tenant,
            customer_name="Other Customer",
            created_by=self.other_user,
        )
        EstimateLineItem.objects.create(
            estimate=self.estimate,
            product=self.product,
            description="Scoped line",
            quantity=2,
            unit_price=150,
        )
        EstimateLineItem.objects.create(
            estimate=self.other_estimate,
            product=self.other_product,
            description="Other tenant line",
            quantity=1,
            unit_price=999,
        )
        self.client.force_authenticate(self.user)

    def _read_export_archive(self, raw_bytes):
        with zipfile.ZipFile(io.BytesIO(raw_bytes)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            data = {
                name: json.loads(archive.read(name))
                for name in archive.namelist()
                if name.startswith("data/") and name.endswith(".json")
            }
        return manifest, data

    def _records_for_model(self, manifest, data, model_label):
        entry = next(item for item in manifest["models"] if item["model"] == model_label)
        return data[entry["archive_path"]]

    def test_tenant_admin_can_run_tenant_scoped_backup_policy(self):
        response = self.client.post(reverse("backup-policy-run", kwargs={"pk": self.policy.pk}))

        self.assertEqual(response.status_code, 200, response.data)
        self.policy.refresh_from_db()
        self.assertTrue(self.policy.last_backup_file.endswith(".zip"))
        self.assertGreater(self.policy.last_backup_size_bytes, 0)

    def test_tenant_admin_download_receives_only_tenant_scoped_data(self):
        response = self.client.get(reverse("backup-policy-download", kwargs={"pk": self.policy.pk}))

        self.assertEqual(response.status_code, 200)
        manifest, data = self._read_export_archive(b"".join(response.streaming_content))

        self.assertEqual(manifest["format"], "tenant-scoped-export")
        self.assertEqual(manifest["tenant"]["id"], self.tenant.id)

        tenant_records = self._records_for_model(manifest, data, "Platform_Core.Tenant")
        self.assertEqual([record["pk"] for record in tenant_records], [self.tenant.pk])

        profile_records = self._records_for_model(manifest, data, "Platform_Core.TenantUserProfile")
        self.assertEqual({record["fields"]["tenant"] for record in profile_records}, {self.tenant.pk})
        self.assertNotIn(self.other_user.pk, {record["fields"]["user"] for record in profile_records})

        estimate_records = self._records_for_model(manifest, data, "SL_Sales.Estimate")
        self.assertEqual({record["fields"]["tenant"] for record in estimate_records}, {self.tenant.pk})
        self.assertNotIn(self.other_estimate.pk, {record["pk"] for record in estimate_records})

        line_item_records = self._records_for_model(manifest, data, "SL_Sales.EstimateLineItem")
        exported_estimate_ids = {record["fields"]["estimate"] for record in line_item_records}
        self.assertEqual(exported_estimate_ids, {self.estimate.pk})
        self.assertNotIn(self.other_estimate.pk, exported_estimate_ids)

    def test_tenant_admin_cannot_run_general_backup_policy(self):
        response = self.client.post(reverse("backup-policy-run", kwargs={"pk": self.general_policy.pk}))

        self.assertEqual(response.status_code, 403, response.data)
        self.assertIn("do not have permission", str(response.data))
