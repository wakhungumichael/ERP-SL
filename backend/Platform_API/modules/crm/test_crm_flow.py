from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from Platform_Core.models import Tenant, TenantUserProfile
from SL_CRM.models import Activity, Contact, Lead, Organisation
from SL_Weighbridge.models import Customer


class CRMEndToEndFlowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.tenant = Tenant.objects.create(
            name="Savannah CRM",
            code="savannah-crm",
            is_active=True,
            status="active",
        )
        self.user = User.objects.create_user("crm_admin", password="pass")
        TenantUserProfile.objects.create(
            user=self.user,
            tenant=self.tenant,
            is_tenant_admin=True,
        )
        self.client.force_authenticate(self.user)

    def test_crm_core_flow_and_dashboard_visibility(self):
        frozen_now = timezone.now().replace(hour=10, minute=0, second=0, microsecond=0)

        with patch("Platform_API.modules.crm.views.timezone.now", return_value=frozen_now):
            company_response = self.client.post(
                reverse("organisation-list"),
                {
                    "name": "Acme Distribution",
                    "type": "prospect",
                    "industry": "Distribution",
                    "email": "hello@acme.test",
                    "phone": "+254700000123",
                    "address": "Nairobi",
                    "notes": "Priority account",
                },
                format="json",
            )
            self.assertEqual(company_response.status_code, 201, company_response.data)
            company_id = company_response.data["id"]

            person_response = self.client.post(
                reverse("contact-list"),
                {
                    "first_name": "Jane",
                    "last_name": "Otieno",
                    "job_title": "Procurement Lead",
                    "email": "jane@acme.test",
                    "phone": "+254700000124",
                    "organisation": company_id,
                },
                format="json",
            )
            self.assertEqual(person_response.status_code, 201, person_response.data)
            person_id = person_response.data["id"]

            opp_response = self.client.post(
                reverse("lead-list"),
                {
                    "title": "Annual supply framework",
                    "organisation": company_id,
                    "contact": person_id,
                    "stage": "proposal",
                    "value": "125000.00",
                    "currency": "KES",
                    "expected_close_date": (frozen_now.date() + timedelta(days=3)).isoformat(),
                    "notes": "Needs commercial approval",
                },
                format="json",
            )
            self.assertEqual(opp_response.status_code, 201, opp_response.data)
            opportunity_id = opp_response.data["id"]

            overdue_response = self.client.post(
                reverse("activity-list"),
                {
                    "type": "call",
                    "summary": "Recover delayed pricing feedback",
                    "date": (frozen_now - timedelta(days=1)).isoformat(),
                    "contact": person_id,
                    "lead": opportunity_id,
                    "organisation": company_id,
                },
                format="json",
            )
            self.assertEqual(overdue_response.status_code, 201, overdue_response.data)

            upcoming_response = self.client.post(
                reverse("activity-list"),
                {
                    "type": "meeting",
                    "summary": "Commercial negotiation review",
                    "date": (frozen_now + timedelta(days=2)).isoformat(),
                    "contact": person_id,
                    "lead": opportunity_id,
                    "organisation": company_id,
                },
                format="json",
            )
            self.assertEqual(upcoming_response.status_code, 201, upcoming_response.data)

            company_people = self.client.get(reverse("contact-list"), {"organisation": company_id})
            self.assertEqual(company_people.status_code, 200, company_people.data)
            people_results = company_people.data.get("results", company_people.data)
            self.assertEqual(len(people_results), 1)
            self.assertEqual(people_results[0]["id"], person_id)

            company_opps = self.client.get(reverse("lead-list"), {"organisation": company_id})
            self.assertEqual(company_opps.status_code, 200, company_opps.data)
            opp_results = company_opps.data.get("results", company_opps.data)
            self.assertEqual(len(opp_results), 1)
            self.assertEqual(opp_results[0]["id"], opportunity_id)

            person_opps = self.client.get(reverse("lead-list"), {"contact": person_id})
            self.assertEqual(person_opps.status_code, 200, person_opps.data)
            person_opp_results = person_opps.data.get("results", person_opps.data)
            self.assertEqual(len(person_opp_results), 1)
            self.assertEqual(person_opp_results[0]["id"], opportunity_id)

            follow_ups = self.client.get(reverse("activity-list"), {"organisation": company_id})
            self.assertEqual(follow_ups.status_code, 200, follow_ups.data)
            follow_up_results = follow_ups.data.get("results", follow_ups.data)
            self.assertEqual(len(follow_up_results), 2)

            dashboard = self.client.get(reverse("crm-dashboard"))
            self.assertEqual(dashboard.status_code, 200, dashboard.data)

            summary = dashboard.data["summary"]
            self.assertEqual(summary["companies"], 1)
            self.assertEqual(summary["people"], 1)
            self.assertEqual(summary["open_opportunities"], 1)
            self.assertEqual(summary["pipeline_value"], 125000.0)
            self.assertEqual(summary["overdue_follow_ups"], 1)
            self.assertEqual(summary["upcoming_follow_ups"], 1)

            queues = dashboard.data["priority_queues"]
            self.assertEqual(len(queues["stale_opportunities"]), 0)
            self.assertEqual(len(queues["closing_soon"]), 1)
            self.assertEqual(len(queues["overdue_follow_ups"]), 1)
            self.assertEqual(len(queues["upcoming_follow_ups"]), 1)
            self.assertEqual(queues["closing_soon"][0]["id"], opportunity_id)

            estimate_response = self.client.post(
                reverse("lead-convert-to-estimate", kwargs={"pk": opportunity_id}),
                {
                    "status": "sent",
                    "line_items": [
                        {
                            "description": "Annual supply contract",
                            "quantity": "2.000",
                            "unit_price": "62500.00",
                            "tax_rate": "16.00",
                            "discount_amount": "0.00",
                            "sort_order": 0,
                        }
                    ],
                },
                format="json",
            )
            self.assertEqual(estimate_response.status_code, 201, estimate_response.data)
            self.assertIn("estimate_id", estimate_response.data)

            order_response = self.client.post(
                reverse("lead-convert-to-sales-order", kwargs={"pk": opportunity_id}),
                {
                    "status": "confirmed",
                    "line_items": [
                        {
                            "description": "Annual supply contract",
                            "quantity": "1.000",
                            "unit_price": "125000.00",
                            "tax_rate": "0.00",
                            "discount_amount": "0.00",
                            "sort_order": 0,
                        }
                    ],
                },
                format="json",
            )
            self.assertEqual(order_response.status_code, 201, order_response.data)
            self.assertIn("sales_order_id", order_response.data)

    def test_crm_data_is_scoped_to_authenticated_tenant(self):
        other_tenant = Tenant.objects.create(
            name="Other CRM",
            code="other-crm",
            is_active=True,
            status="active",
        )
        other_company = Organisation.objects.create(
            name="Hidden Corp",
            type="customer",
            tenant=other_tenant,
        )
        other_person = Contact.objects.create(
            first_name="Hidden",
            last_name="User",
            tenant=other_tenant,
            organisation=other_company,
        )
        other_lead = Lead.objects.create(
            title="Hidden deal",
            tenant=other_tenant,
            organisation=other_company,
            contact=other_person,
            stage="new",
            value=Decimal("5000.00"),
        )
        Activity.objects.create(
            type="task",
            summary="Hidden activity",
            date=timezone.now(),
            tenant=other_tenant,
            organisation=other_company,
            contact=other_person,
            lead=other_lead,
            created_by=self.user,
        )

        companies = self.client.get(reverse("organisation-list"))
        people = self.client.get(reverse("contact-list"))
        opportunities = self.client.get(reverse("lead-list"))
        activities = self.client.get(reverse("activity-list"))
        dashboard = self.client.get(reverse("crm-dashboard"))

        self.assertEqual(companies.status_code, 200, companies.data)
        self.assertEqual(people.status_code, 200, people.data)
        self.assertEqual(opportunities.status_code, 200, opportunities.data)
        self.assertEqual(activities.status_code, 200, activities.data)
        self.assertEqual(dashboard.status_code, 200, dashboard.data)

        self.assertEqual(companies.data.get("count", len(companies.data)), 0)
        self.assertEqual(people.data.get("count", len(people.data)), 0)
        self.assertEqual(opportunities.data.get("count", len(opportunities.data)), 0)
        self.assertEqual(activities.data.get("count", len(activities.data)), 0)
        self.assertEqual(dashboard.data["summary"]["companies"], 0)

    def test_crm_rejects_cross_tenant_relationship_links(self):
        other_tenant = Tenant.objects.create(
            name="Other CRM",
            code="other-crm-links",
            is_active=True,
            status="active",
        )
        other_company = Organisation.objects.create(
            name="Other Tenant Org",
            type="customer",
            tenant=other_tenant,
        )
        other_contact = Contact.objects.create(
            first_name="Other",
            last_name="Contact",
            tenant=other_tenant,
            organisation=other_company,
        )
        other_lead = Lead.objects.create(
            title="Other Tenant Deal",
            tenant=other_tenant,
            organisation=other_company,
            contact=other_contact,
            stage="new",
        )

        contact_response = self.client.post(
            reverse("contact-list"),
            {
                "first_name": "Jane",
                "last_name": "CrossLink",
                "organisation": other_company.id,
            },
            format="json",
        )
        self.assertEqual(contact_response.status_code, 400, contact_response.data)
        self.assertIn("organisation", contact_response.data)

        lead_response = self.client.post(
            reverse("lead-list"),
            {
                "title": "Cross tenant opportunity",
                "organisation": other_company.id,
                "contact": other_contact.id,
                "stage": "proposal",
            },
            format="json",
        )
        self.assertEqual(lead_response.status_code, 400, lead_response.data)
        self.assertIn("organisation", lead_response.data)
        self.assertIn("contact", lead_response.data)

        activity_response = self.client.post(
            reverse("activity-list"),
            {
                "type": "call",
                "summary": "Should not cross tenants",
                "date": timezone.now().isoformat(),
                "organisation": other_company.id,
                "contact": other_contact.id,
                "lead": other_lead.id,
            },
            format="json",
        )
        self.assertEqual(activity_response.status_code, 400, activity_response.data)
        self.assertIn("organisation", activity_response.data)
        self.assertIn("contact", activity_response.data)
        self.assertIn("lead", activity_response.data)

    def test_crm_conversion_does_not_adopt_other_tenant_customer(self):
        other_tenant = Tenant.objects.create(
            name="Other CRM",
            code="other-crm-customer",
            is_active=True,
            status="active",
        )
        other_customer = Customer.objects.create(
            tenant=other_tenant,
            name="Acme Distribution",
            email="hello@acme.test",
            phone_number="+254700000123",
        )
        company = Organisation.objects.create(
            name="Acme Distribution",
            type="prospect",
            email="hello@acme.test",
            phone="+254700000123",
            tenant=self.tenant,
        )
        contact = Contact.objects.create(
            first_name="Jane",
            last_name="Otieno",
            tenant=self.tenant,
            organisation=company,
        )
        lead = Lead.objects.create(
            title="Protected conversion",
            tenant=self.tenant,
            organisation=company,
            contact=contact,
            stage="proposal",
            value=Decimal("50000.00"),
        )

        response = self.client.post(
            reverse("lead-convert-to-estimate", kwargs={"pk": lead.id}),
            {
                "status": "sent",
                "line_items": [
                    {
                        "description": "Protected conversion",
                        "quantity": "1.000",
                        "unit_price": "50000.00",
                        "tax_rate": "0.00",
                        "discount_amount": "0.00",
                        "sort_order": 0,
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        company.refresh_from_db()
        self.assertIsNotNone(company.weighbridge_customer_id)
        self.assertEqual(company.weighbridge_customer.tenant_id, self.tenant.id)
        self.assertNotEqual(company.weighbridge_customer_id, other_customer.id)
        self.assertEqual(Customer.objects.filter(tenant=self.tenant).count(), 1)
        self.assertEqual(Customer.objects.filter(tenant=other_tenant).count(), 1)
