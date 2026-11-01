from unittest.mock import patch
from django.contrib.auth.models import Group, Permission, User
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient
from Platform_Core.models import OrganizationMembership, Tenant, TenantBranch, TenantUserProfile
from SL_Projects.models import Project
from SL_Ticketing.models import Ticket, TicketFormSchema, TicketRoutingRule, TicketingInboxConfig
from Platform_API.modules.ticketing.public_forms import PublicFormSubmissionThrottle


class TicketIntakeTests(TestCase):
    def setUp(self):
        cache.clear()
        self.tenant=Tenant.objects.create(name="Intake organization",code="intake-tests",is_active=True)
        self.other=Tenant.objects.create(name="Other intake organization",code="other-intake",is_active=True)
        self.branch=TenantBranch.objects.create(tenant=self.tenant,name="Main")
        self.second=TenantBranch.objects.create(tenant=self.tenant,name="Field")
        self.foreign_branch=TenantBranch.objects.create(tenant=self.other,name="Other")
        self.agent=User.objects.create_user("intake-agent",email="agent@example.test",first_name="Queue",last_name="Agent")
        self.creator=Group.objects.create(name=f"tenant:{self.tenant.pk}:Intake manager")
        self.creator.permissions.set(Permission.objects.filter(content_type__app_label="SL_Ticketing"))
        self.reader=Group.objects.create(name=f"tenant:{self.tenant.pk}:Intake reader")
        self.reader.permissions.set(Permission.objects.filter(content_type__app_label="SL_Ticketing",codename="view_ticket"))
        self.agent.groups.add(self.creator,self.reader)
        self.membership=OrganizationMembership.objects.create(user=self.agent,tenant=self.tenant,branch=self.branch,is_default=True,active_role_group_name=self.creator.name)
        self.client=APIClient();self.client.force_authenticate(self.agent)
        self.public=APIClient()
        self.form=TicketFormSchema.objects.create(tenant=self.tenant,name="Website support",is_public=True,project_branch=self.second,schema={"fields":[{"key":"asset_number","label":"Asset number","type":"text","required":True}]})
        self.config=TicketingInboxConfig.objects.create(tenant=self.tenant,allowed_domains=["https://customer.example.com"],brand_settings={"primary_color":"#123456"})
        self.path=f"/api/ticketing/public/forms/{self.tenant.code}/{self.form.slug}/"
        self.payload={"requester_name":"Customer","requester_email":"customer@example.test","subject":"Support needed","description":"Please investigate this issue.","priority":"normal","custom_fields":{"asset_number":"ASSET-7"}}

    def test_new_ticket_capabilities_and_saved_project_suggestions(self):
        Project.objects.create(tenant=self.tenant,branch=self.branch,name="Harbour Upgrade",code="HU-1")
        options=self.client.get("/api/ticketing/tickets/options/")
        self.assertEqual(options.status_code,200,options.data)
        self.assertTrue(options.data["can_create"])
        self.assertEqual(options.data["requester_defaults"]["email"],self.agent.email)
        self.assertIn("Harbour Upgrade",options.data["project_names"])
        self.assertIn(self.form.pk,{form["id"] for form in options.data["forms"]})

    def test_agent_create_is_tenant_bound_and_records_initial_message_and_actor(self):
        response=self.client.post("/api/ticketing/tickets/",{**self.payload,"tenant":self.other.pk,"source_channel":"portal"},format="json")
        self.assertEqual(response.status_code,201,response.data)
        ticket=Ticket.objects.get(pk=response.data["id"])
        self.assertEqual(ticket.tenant_id,self.tenant.pk);self.assertEqual(ticket.source_channel,"erp")
        self.assertEqual(ticket.messages.get().channel,"erp")
        event=ticket.events.get(event_type="ticket.created")
        self.assertEqual(event.payload["created_by"],self.agent.pk);self.assertFalse(event.is_public)
        self.assertIn(ticket.pk,[row["id"] for row in self.client.get("/api/ticketing/tickets/").data])

    def test_selected_reader_role_cannot_create_configure_publish_or_edit(self):
        ticket=Ticket.objects.create(tenant=self.tenant,requester_email="existing@example.test",subject="Existing")
        self.membership.active_role_group_name=self.reader.name;self.membership.save()
        self.assertFalse(self.client.get("/api/ticketing/tickets/options/").data["can_create"])
        self.assertEqual(self.client.post("/api/ticketing/tickets/",self.payload,format="json").status_code,403)
        self.assertEqual(self.client.get(f"/api/ticketing/forms/{self.form.pk}/publish/").status_code,403)
        self.assertEqual(self.client.patch(f"/api/ticketing/forms/{self.form.pk}/",{"name":"No"},format="json").status_code,403)
        self.assertEqual(self.client.patch(f"/api/ticketing/tickets/{ticket.pk}/",{"project_name":"No new project"},format="json").status_code,403)
        self.assertFalse(Project.objects.exists())

    def test_legacy_admin_and_organization_admin_can_create(self):
        legacy=User.objects.create_user("legacy-intake-admin")
        TenantUserProfile.objects.create(user=legacy,tenant=self.tenant,is_tenant_admin=True)
        self.client.force_authenticate(legacy)
        self.assertEqual(self.client.post("/api/ticketing/tickets/",self.payload,format="json").status_code,201)
        self.client.force_authenticate(self.agent);self.agent.groups.clear();self.membership.is_org_admin=True;self.membership.save()
        self.assertEqual(self.client.post("/api/ticketing/tickets/",self.payload,format="json").status_code,201)

    def test_case_spacing_and_code_matches_reuse_existing_project(self):
        project=Project.objects.create(tenant=self.tenant,branch=self.branch,name="Harbour Upgrade",code="HU-1")
        for name in [" harbour    UPGRADE ","hu-1","Harbour Upgrade"]:
            response=self.client.post("/api/ticketing/tickets/",{**self.payload,"project_name":name},format="json")
            self.assertEqual(response.status_code,201,response.data)
            self.assertEqual(response.data["project"],project.pk);self.assertEqual(response.data["project_name"],project.name)
        self.assertEqual(Project.objects.count(),1)

    def test_unknown_names_create_one_draft_project_in_the_agent_branch(self):
        for name in ["Fish Health Programme","fish   HEALTH programme"]:
            response=self.client.post("/api/ticketing/tickets/",{**self.payload,"project_name":name},format="json")
            self.assertEqual(response.status_code,201,response.data)
        project=Project.objects.get();self.assertEqual(project.status,"draft");self.assertEqual(project.branch_id,self.branch.pk)
        self.assertEqual(project.created_by_id,self.agent.pk)
        self.assertEqual(Ticket.objects.filter(project=project).count(),2)

    def test_public_form_auto_creation_uses_configured_branch_and_never_exposes_project_ids(self):
        response=self.public.post(self.path,{**self.payload,"project_name":"Clinic Expansion"},format="json")
        self.assertEqual(response.status_code,201,response.data)
        ticket=Ticket.objects.get(public_id=response.data["ticket_id"])
        self.assertEqual(ticket.project.branch_id,self.second.pk);self.assertEqual(ticket.project.status,"draft")
        self.assertIsNone(ticket.project.created_by_id)
        self.assertNotIn("project",response.data);self.assertNotIn("project_name",response.data)
        self.assertFalse(ticket.events.filter(event_type="ticket.created").get().payload.get("created_by"))

    def test_other_organization_project_is_not_reused(self):
        foreign=Project.objects.create(tenant=self.other,branch=self.foreign_branch,name="Private Project",code="FOREIGN")
        response=self.client.post("/api/ticketing/tickets/",{**self.payload,"project_name":foreign.name,"project":foreign.pk},format="json")
        self.assertEqual(response.status_code,201,response.data)
        ticket=Ticket.objects.get(pk=response.data["id"])
        self.assertNotEqual(ticket.project_id,foreign.pk);self.assertEqual(ticket.project.tenant_id,self.tenant.pk)

    def test_ambiguous_names_need_code_and_do_not_create_a_third_project(self):
        first=Project.objects.create(tenant=self.tenant,branch=self.branch,name="Same Name",code="A-CODE")
        Project.objects.create(tenant=self.tenant,branch=self.second,name="Same Name",code="B-CODE")
        response=self.client.post("/api/ticketing/tickets/",{**self.payload,"project_name":"same name"},format="json")
        self.assertEqual(response.status_code,400,response.data)
        response=self.client.post("/api/ticketing/tickets/",{**self.payload,"project_name":first.code},format="json")
        self.assertEqual(response.status_code,201,response.data);self.assertEqual(response.data["project"],first.pk)
        self.assertEqual(Project.objects.count(),2)

    def test_failed_creation_rolls_back_new_project_and_ticket(self):
        with patch("Platform_API.modules.ticketing.views._apply_routing",side_effect=RuntimeError("Routing failure")):
            with self.assertRaises(RuntimeError):self.client.post("/api/ticketing/tickets/",{**self.payload,"project_name":"Rollback project"},format="json")
        self.assertEqual(Ticket.objects.count(),0);self.assertEqual(Project.objects.count(),0)

    def test_existing_routing_applies_after_agent_creation(self):
        TicketRoutingRule.objects.create(tenant=self.tenant,name="Route support",conditions={"priority":"normal"},assign_to=self.agent,target_status="open")
        response=self.client.post("/api/ticketing/tickets/",self.payload,format="json")
        self.assertEqual(response.status_code,201,response.data);self.assertEqual(response.data["assigned_to"],self.agent.pk);self.assertEqual(response.data["status"],"open")

    def test_form_configuration_validates_keys_and_foreign_project_branch(self):
        for schema in [{"fields":[{"key":"duplicate","type":"text"},{"key":"duplicate","type":"email"}]},[],{"fields":[{"key":"priority","type":"select","options":["impossible"]}]}]:
            response=self.client.post("/api/ticketing/forms/",{"name":"Bad form","schema":schema},format="json")
            self.assertEqual(response.status_code,400,response.data)
        response=self.client.patch(f"/api/ticketing/forms/{self.form.pk}/",{"project_branch":self.foreign_branch.pk},format="json")
        self.assertEqual(response.status_code,400,response.data)

    def test_form_configuration_adds_core_fields_and_publish_metadata_is_scoped(self):
        response=self.client.post("/api/ticketing/forms/",{"name":"New form","schema":{"fields":[{"key":"machine_code","type":"text","label":"Machine","required":True}]}},format="json")
        self.assertEqual(response.status_code,201,response.data)
        self.assertTrue({"requester_email","subject","description","project_name"}<={field["key"] for field in response.data["schema"]["fields"]})
        published=self.client.get(f"/api/ticketing/forms/{self.form.pk}/publish/")
        self.assertEqual(published.status_code,200,published.data);self.assertEqual(published.data["form_path"],self.path)
        other_form=TicketFormSchema.objects.create(tenant=self.other,name="Foreign form")
        self.assertEqual(self.client.get(f"/api/ticketing/forms/{other_form.pk}/publish/").status_code,404)

    def test_private_and_inactive_organization_forms_are_not_public(self):
        self.form.is_public=False;self.form.save()
        self.assertEqual(self.public.get(self.path).status_code,404)
        self.assertEqual(self.public.post(self.path,self.payload,format="json").status_code,404)
        self.form.is_public=True;self.form.save();self.tenant.is_active=False;self.tenant.save()
        self.assertEqual(self.public.get(self.path).status_code,404)

    def test_public_form_renders_without_login_and_has_explicit_frame_policy(self):
        self.form.name='<script>alert("x")</script>';self.form.save()
        response=self.public.get(self.path)
        self.assertEqual(response.status_code,200)
        self.assertContains(response,"Asset number")
        self.assertContains(response,"Project name")
        self.assertNotContains(response,self.form.name)
        self.assertIn("https://customer.example.com",response["Content-Security-Policy"])
        self.assertIn("frame-ancestors 'self'",response["Content-Security-Policy"])
        self.assertNotIn("X-Frame-Options",response)
        self.assertEqual(response["Cache-Control"],"no-store")

    def test_required_custom_fields_and_dropdown_options_are_enforced_on_the_server(self):
        response=self.public.post(self.path,{**self.payload,"custom_fields":{}},format="json")
        self.assertEqual(response.status_code,400,response.data);self.assertIn("asset_number",response.data)
        self.form.schema={"fields":[{"key":"issue","label":"Issue","type":"select","options":["Billing","Technical"],"required":True}]};self.form.save()
        response=self.public.post(self.path,{**self.payload,"custom_fields":{"issue":"Invalid"}},format="json")
        self.assertEqual(response.status_code,400,response.data)
        self.assertFalse(Ticket.objects.exists())

    def test_public_form_cannot_switch_tenant_or_form_and_records_custom_answers(self):
        foreign_form=TicketFormSchema.objects.create(tenant=self.other,name="Other",is_public=False)
        response=self.public.post(self.path,{**self.payload,"tenant":self.other.pk,"form_schema":foreign_form.pk},format="json")
        self.assertEqual(response.status_code,201,response.data)
        ticket=Ticket.objects.get();self.assertEqual(ticket.tenant_id,self.tenant.pk);self.assertEqual(ticket.form_schema_id,self.form.pk)
        self.assertEqual(ticket.custom_fields,{"asset_number":"ASSET-7"})

    def test_internal_creation_rejects_foreign_form_and_preserves_data_on_validation_error(self):
        foreign_form=TicketFormSchema.objects.create(tenant=self.other,name="Other form")
        response=self.client.post("/api/ticketing/tickets/",{**self.payload,"form_schema":foreign_form.pk},format="json")
        self.assertEqual(response.status_code,400,response.data)
        for changes in [{"requester_email":"invalid"},{"subject":"   "},{"priority":"invalid"}]:
            self.assertEqual(self.client.post("/api/ticketing/tickets/",{**self.payload,**changes},format="json").status_code,400)
        self.assertFalse(Ticket.objects.exists())

    def test_public_submission_is_rate_limited(self):
        with patch.object(PublicFormSubmissionThrottle,"rate","2/min"):
            self.assertEqual(self.public.post(self.path,self.payload,format="json").status_code,201)
            self.assertEqual(self.public.post(self.path,self.payload,format="json").status_code,201)
            self.assertEqual(self.public.post(self.path,self.payload,format="json").status_code,429)

    def test_project_can_be_created_when_organization_has_no_branch(self):
        new=Tenant.objects.create(name="No branch",code="intake-no-branch")
        form=TicketFormSchema.objects.create(tenant=new,name="Start",is_public=True,schema={})
        response=self.public.post(f"/api/ticketing/public/forms/{new.code}/{form.slug}/",{**self.payload,"project_name":"First project"},format="json")
        self.assertEqual(response.status_code,201,response.data)
        ticket=Ticket.objects.get(tenant=new);self.assertEqual(ticket.project.branch.name,"Main")

    def test_agent_new_project_form_branch_overrides_the_agent_default(self):
        response=self.client.post("/api/ticketing/tickets/",{**self.payload,"form_schema":self.form.pk,"project_name":"Form branch project"},format="json")
        self.assertEqual(response.status_code,201,response.data)
        self.assertEqual(Ticket.objects.get().project.branch_id,self.second.pk)

    def test_public_legacy_api_uses_the_same_project_matcher(self):
        self.config.require_cors_origin=False;self.config.save()
        response=self.public.post("/api/ticketing/v1/tickets/",{**self.payload,"project_name":"Legacy public project"},format="json",HTTP_X_TENANT_ID=self.tenant.code)
        self.assertEqual(response.status_code,201,response.data)
        self.assertEqual(Ticket.objects.get().project.name,"Legacy public project")

    def test_legacy_project_names_are_reused_when_creating_a_new_project(self):
        import importlib
        from types import SimpleNamespace
        from django.apps import apps
        from django.db import connection
        legacy=Ticket.objects.create(tenant=self.tenant,requester_email="legacy@example.test",subject="Old request",custom_fields={"project_name":"Previous Project"})
        migration=importlib.import_module("SL_Ticketing.migrations.0005_copy_legacy_project_names")
        migration.copy_names(apps,SimpleNamespace(connection=connection))
        legacy.refresh_from_db();self.assertEqual(legacy.project_name,"Previous Project")
        self.assertTrue(legacy.project_name_key);self.assertIsNone(legacy.project_id)
        response=self.client.post("/api/ticketing/tickets/",{**self.payload,"project_name":"previous   PROJECT"},format="json")
        self.assertEqual(response.status_code,201,response.data)
        self.assertEqual(Project.objects.get().name,"Previous Project")

    def test_ticket_created_tasks_use_the_linked_project_in_its_branch(self):
        self.membership.is_org_admin=True;self.membership.save()
        ticket=self.client.post("/api/ticketing/tickets/",{**self.payload,"project_name":"Linked work"},format="json").data
        with patch("Platform_API.modules.projects.views.get_active_tenant_module_slugs",return_value={"projects-tasks"}):
            response=self.client.post(f"/api/projects/tickets/{ticket['id']}/tasks/",{"title":"Investigate linked project"},format="json")
            self.assertEqual(response.status_code,201,response.data)
            self.assertEqual(response.data["project"],ticket["project"])
