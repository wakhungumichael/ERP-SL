import datetime

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from Platform_Core.models import Account, Journal, JournalEntry, Tenant, TenantUserProfile


class AccountingTenantScopingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.tenant_a = Tenant.objects.create(
            name="Accounting Tenant A",
            code="accounting-a",
            is_active=True,
            status="active",
        )
        self.tenant_b = Tenant.objects.create(
            name="Accounting Tenant B",
            code="accounting-b",
            is_active=True,
            status="active",
        )
        self.user_a = User.objects.create_user("accounting_admin_a", password="pass", is_staff=True)
        TenantUserProfile.objects.create(user=self.user_a, tenant=self.tenant_a, is_tenant_admin=True)
        self.client.force_authenticate(self.user_a)

        self.parent_a = Account.objects.create(
            tenant=self.tenant_a,
            code="1000-A",
            name="Tenant A Parent",
            account_type="asset",
        )
        self.child_a = Account.objects.create(
            tenant=self.tenant_a,
            code="1100-A",
            name="Tenant A Child",
            account_type="asset",
        )
        self.parent_b = Account.objects.create(
            tenant=self.tenant_b,
            code="1000-B",
            name="Tenant B Parent",
            account_type="asset",
        )

        self.journal_a = Journal.objects.create(
            tenant=self.tenant_a,
            code="GENA",
            name="Tenant A General",
            journal_type="general",
        )
        self.journal_b = Journal.objects.create(
            tenant=self.tenant_b,
            code="GENB",
            name="Tenant B General",
            journal_type="general",
        )
        self.entry_a = JournalEntry.objects.create(
            tenant=self.tenant_a,
            journal=self.journal_a,
            entry_date=datetime.datetime(2026, 8, 13, tzinfo=datetime.timezone.utc),
            source_type="manual",
            source_reference="manual:test-entry-a",
            memo="Tenant A draft entry",
            status="draft",
        )

    def test_account_patch_rejects_other_tenant_parent(self):
        response = self.client.patch(
            reverse("account-detail", kwargs={"pk": self.child_a.id}),
            {"parent": self.parent_b.id},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("different tenant", response.data["error"].lower())

    def test_journal_entry_patch_rejects_other_tenant_journal(self):
        response = self.client.patch(
            reverse("journal-entry-detail", kwargs={"pk": self.entry_a.id}),
            {"journal": self.journal_b.id},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("different tenant", response.data["error"].lower())
