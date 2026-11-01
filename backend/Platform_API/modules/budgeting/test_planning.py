from datetime import date
from decimal import Decimal
from django.contrib.auth.models import Group, Permission, User
from django.test import TestCase
from rest_framework.test import APIClient
from Platform_Core.models import Account, Department, OrganizationMembership, Tenant, TenantBranch, WorkflowDefinition, WorkflowEntityBinding, WorkflowNodeDefinition, WorkflowTransitionDefinition, WorkflowInboxItem
from SL_Budgeting.models import Budget, BudgetLine
from SL_Procurement.models import ProcurementPlan


class PlanningTests(TestCase):
    def setUp(self):
        self.tenant=Tenant.objects.create(name='Planning',code='planning',status='active',is_active=True)
        self.other=Tenant.objects.create(name='Other',code='plan-other',status='active',is_active=True)
        self.owner=User.objects.create_user('budget-owner')
        self.reviewer=User.objects.create_user('budget-reviewer')
        self.worker=User.objects.create_user('budget-worker')
        for user in [self.owner,self.reviewer]:
            OrganizationMembership.objects.create(user=user,tenant=self.tenant,is_default=True,is_org_admin=True)
        OrganizationMembership.objects.create(user=self.worker,tenant=self.tenant,is_default=True)
        self.department=Department.objects.create(tenant=self.tenant,name='IT',code='IT',head=self.worker)
        self.second=Department.objects.create(tenant=self.tenant,name='Operations',code='OPS',head=self.owner)
        self.account=Account.objects.create(tenant=self.tenant,code='5000',name='Supplies',account_type='expense')
        self.client=APIClient()
        self.client.force_authenticate(self.owner)
        for entity,module in [('department_budget','budgeting'),('annual_budget','budgeting'),('procurement_plan','procurement')]:
            workflow=WorkflowDefinition.objects.create(tenant=self.tenant,name=entity,code=entity,entity_type=entity,status='published',is_active=True,trigger_event='submit')
            WorkflowEntityBinding.objects.create(workflow=workflow,module_slug=module,entity_type=entity,entity_label=entity,route_path='/finance/budgets')
            WorkflowNodeDefinition.objects.create(workflow=workflow,code='review',name='Review',node_type='approval',is_initial=True,assigned_user=self.reviewer,step_order=1)

    def create_budget(self,department=None,amount='1000',code='IT-2027'):
        response=self.client.post('/api/budgeting/budgets/',{'name':code,'code':code,'department':(department or self.department).pk,'start_date':'2027-01-01','end_date':'2027-12-31','currency':'KES','lines':[{'account':self.account.pk,'cost_center':'FORGED','period_year':2027,'allocated_amount':amount}]},format='json')
        self.assertEqual(response.status_code,201,response.data)
        return Budget.objects.get(pk=response.data['id'])

    def forward(self,obj,entity):
        self.client.force_authenticate(self.owner)
        result=self.client.post('/api/platform/workflows/forward/',{'module_slug':'procurement' if entity=='procurement_plan' else 'budgeting','entity_type':entity,'entity_id':obj.pk,'metadata':{'amount':'0','organization_id':self.other.pk}},format='json')
        self.assertEqual(result.status_code,201,result.data)
        return WorkflowInboxItem.objects.get(pk=result.data['data']['id'])

    def approve(self,item):
        self.client.force_authenticate(self.reviewer)
        response=self.client.post(f'/api/platform/workflows/inbox/{item.pk}/action/',{'decision':'approve'},format='json')
        self.assertEqual(response.status_code,200,response.data)
        self.client.force_authenticate(self.owner)

    def annual(self):
        first=self.create_budget()
        self.approve(self.forward(first,'department_budget'))
        response=self.client.post('/api/budgeting/budgets/consolidate/',{'name':'Annual 2027','code':'ANNUAL-2027','budgets':[first.pk]},format='json')
        self.assertEqual(response.status_code,201,response.data)
        annual=Budget.objects.get(pk=response.data['id'])
        self.approve(self.forward(annual,'annual_budget'))
        return first,annual

    def test_department_approval_consolidation_and_plan_complete_flow(self):
        first=self.create_budget()
        self.assertEqual(first.lines.get().cost_center,'IT')
        item=self.forward(first,'department_budget')
        self.assertEqual(Decimal(item.metadata['amount']),Decimal('1000'))
        self.assertEqual(item.metadata['organization_id'],self.tenant.pk)
        self.assertEqual(self.client.post(f'/api/platform/workflows/inbox/{item.pk}/action/',{'decision':'approve'},format='json').status_code,403)
        self.assertEqual(self.client.patch(f'/api/budgeting/budgets/{first.pk}/',{'name':'Changed'},format='json').status_code,400)
        self.approve(item)
        response=self.client.post('/api/budgeting/budgets/consolidate/',{'name':'Annual 2027','code':'ANNUAL-2027','budgets':[first.pk]},format='json')
        self.assertEqual(response.status_code,201,response.data)
        annual=Budget.objects.get(pk=response.data['id'])
        first.refresh_from_db()
        self.assertEqual(first.approval_status,'consolidated')
        self.assertEqual(first.annual_budget,annual)
        self.assertEqual(annual.lines.get().allocated_amount,Decimal('1000'))
        self.assertEqual(annual.lines.get().committed_amount,0)
        self.assertEqual(self.client.post('/api/budgeting/budgets/consolidate/',{'name':'Duplicate','code':'DUP','budgets':[first.pk]},format='json').status_code,400)
        self.approve(self.forward(annual,'annual_budget'))
        annual.refresh_from_db()
        self.assertEqual((annual.status,annual.approval_status),('active','approved'))
        created=self.client.post('/api/procurement/plans/',{'name':'Annual purchases','code':'PLAN-2027','annual_budget':annual.pk},format='json')
        self.assertEqual(created.status_code,201,created.data)
        plan=ProcurementPlan.objects.get(pk=created.data['id'])
        self.assertEqual(plan.lines.get().estimated_amount,Decimal('1000'))
        blocked=self.client.post('/api/platform/workflows/forward/',{'module_slug':'procurement','entity_type':'procurement_plan','entity_id':plan.pk},format='json')
        self.assertEqual(blocked.status_code,400,blocked.data)
        line=created.data['lines'][0]
        line['planned_date']='2027-03-01'
        updated=self.client.patch(f'/api/procurement/plans/{plan.pk}/',{'lines':[line]},format='json')
        self.assertEqual(updated.status_code,200,updated.data)
        self.approve(self.forward(plan,'procurement_plan'))
        plan.refresh_from_db()
        self.assertEqual(plan.status,'approved')
        self.assertEqual(self.client.patch(f'/api/procurement/plans/{plan.pk}/',{'name':'Changed'},format='json').status_code,400)
        exported=self.client.get(f'/api/procurement/plans/{plan.pk}/?export=csv')
        self.assertEqual(exported.status_code,200)
        self.assertIn(b'Estimated amount',exported.content)

    def test_mismatched_periods_and_unapproved_sources_are_rejected(self):
        first=self.create_budget()
        invalid=self.client.post('/api/budgeting/budgets/consolidate/',{'name':'Annual','code':'ANNUAL','budgets':[first.pk]},format='json')
        self.assertEqual(invalid.status_code,400)
        self.approve(self.forward(first,'department_budget'))
        second=self.create_budget(self.second,code='OPS-2027')
        self.approve(self.forward(second,'department_budget'))
        second.currency='USD';second.save()
        invalid=self.client.post('/api/budgeting/budgets/consolidate/',{'name':'Annual','code':'ANNUAL','budgets':[first.pk,second.pk]},format='json')
        self.assertEqual(invalid.status_code,400)
        first.refresh_from_db()
        self.assertIsNone(first.annual_budget_id)

    def test_plan_requires_approved_budget_and_allocation_caps(self):
        first,annual=self.annual()
        line=annual.lines.get()
        payload={'name':'Plan','code':'PLAN','annual_budget':annual.pk,'lines':[{'budget_line':line.pk,'description':'Supplies','estimated_amount':'1001','quantity':'1','planned_date':'2027-01-01'}]}
        result=self.client.post('/api/procurement/plans/',payload,format='json')
        self.assertEqual(result.status_code,400,result.data)
        payload['lines'][0]['estimated_amount']='1000'
        payload['lines'][0]['budget_line']=first.lines.get().pk
        self.assertEqual(self.client.post('/api/procurement/plans/',payload,format='json').status_code,400)
        payload['lines'][0]['budget_line']=line.pk
        payload['lines'][0]['planned_date']='2028-01-01'
        self.assertEqual(self.client.post('/api/procurement/plans/',payload,format='json').status_code,400)
        payload.pop('lines')
        result=self.client.post('/api/procurement/plans/',payload,format='json')
        self.assertEqual(result.status_code,201,result.data)
        payload['code']='PLAN2'
        self.assertEqual(self.client.post('/api/procurement/plans/',payload,format='json').status_code,400)

    def test_permission_and_organization_boundaries(self):
        first=self.create_budget()
        self.client.force_authenticate(self.worker)
        self.assertEqual(self.client.get('/api/budgeting/budgets/').status_code,403)
        self.assertEqual(self.client.patch(f'/api/budgeting/budgets/{first.pk}/',{'name':'Forged'},format='json').status_code,403)
        role=Group.objects.create(name='tenant:%s:Department budgets'%self.tenant.pk)
        role.permissions.add(*Permission.objects.filter(content_type__app_label='SL_Budgeting',codename__in=['view_budget','add_budget','change_budget','submit_budget']))
        self.worker.groups.add(role)
        membership=OrganizationMembership.objects.get(user=self.worker);membership.active_role_group_name=role.name;membership.save()
        self.assertEqual(self.client.get('/api/budgeting/budgets/').status_code,200)
        forged=self.client.post('/api/budgeting/budgets/',{'name':'OPS','code':'FORGED','department':self.second.pk,'start_date':'2027-01-01','end_date':'2027-12-31'},format='json')
        self.assertEqual(forged.status_code,403,forged.data)
        foreign=Budget.objects.create(tenant=self.other,code='FOREIGN',name='Foreign',start_date=date(2027,1,1),end_date=date(2027,12,31))
        self.assertEqual(self.client.get(f'/api/budgeting/budgets/{foreign.pk}/').status_code,404)
        workflow=self.client.post('/api/platform/workflows/forward/',{'module_slug':'budgeting','entity_type':'annual_budget','entity_id':foreign.pk},format='json')
        self.assertEqual(workflow.status_code,403)

    def test_deferred_submission_is_idempotent_and_cannot_edit(self):
        first=self.create_budget()
        item=self.forward(first,'department_budget')
        self.client.force_authenticate(self.reviewer)
        response=self.client.post(f'/api/platform/workflows/inbox/{item.pk}/action/',{'decision':'defer'},format='json')
        self.assertEqual(response.status_code,200,response.data)
        self.client.force_authenticate(self.owner)
        result=self.client.post('/api/platform/workflows/forward/',{'module_slug':'budgeting','entity_type':'department_budget','entity_id':first.pk},format='json')
        self.assertEqual(result.status_code,200,result.data)
        self.assertEqual(WorkflowInboxItem.objects.filter(entity_type='department_budget',entity_id=first.pk).count(),1)
        self.assertEqual(self.client.patch(f'/api/budgeting/budgets/{first.pk}/',{'lines':[]},format='json').status_code,400)

    def test_rejected_department_budget_can_be_corrected_and_resubmitted(self):
        first=self.create_budget()
        item=self.forward(first,'department_budget')
        self.client.force_authenticate(self.reviewer)
        response=self.client.post(f'/api/platform/workflows/inbox/{item.pk}/action/',{'decision':'reject','comment':'Revise allocation'},format='json')
        self.assertEqual(response.status_code,200,response.data)
        self.client.force_authenticate(self.owner)
        response=self.client.patch(f'/api/budgeting/budgets/{first.pk}/',{'name':'Revised'},format='json')
        self.assertEqual(response.status_code,200,response.data)
        self.approve(self.forward(first,'department_budget'))
        first.refresh_from_db();self.assertEqual(first.approval_status,'approved')

    def test_clients_cannot_activate_drafts_or_set_spending(self):
        first=self.create_budget()
        response=self.client.patch(f'/api/budgeting/budgets/{first.pk}/',{'status':'active'},format='json')
        self.assertEqual(response.status_code,400,response.data)
        response=self.client.patch(f'/api/budgeting/budgets/{first.pk}/',{'lines':[{'account':self.account.pk,'cost_center':'IT','period_year':2027,'allocated_amount':'1000','actual_amount':'500'}]},format='json')
        self.assertEqual(response.status_code,200,response.data)
        self.assertEqual(first.lines.get().actual_amount,0)

    def test_submitter_cannot_approve_even_when_workflow_assigns_them(self):
        node=WorkflowNodeDefinition.objects.get(workflow__tenant=self.tenant,workflow__entity_type='department_budget')
        node.assigned_user=self.owner;node.save()
        budget=self.create_budget()
        item=self.forward(budget,'department_budget')
        result=self.client.post(f'/api/platform/workflows/inbox/{item.pk}/action/',{'decision':'approve'},format='json')
        self.assertEqual(result.status_code,403,result.data)
        budget.refresh_from_db();self.assertEqual(budget.approval_status,'submitted')

    def test_branch_restrictions_apply_to_finance_inbox_and_actions(self):
        main=TenantBranch.objects.create(tenant=self.tenant,name='Main')
        west=TenantBranch.objects.create(tenant=self.tenant,name='West')
        role=Group.objects.create(name=f'tenant:{self.tenant.pk}:Finance reviewer')
        role.permissions.add(*Permission.objects.filter(content_type__app_label='SL_Budgeting',codename__in=['approve_budget','view_budget']))
        self.reviewer.groups.add(role)
        membership=OrganizationMembership.objects.get(user=self.reviewer,tenant=self.tenant)
        membership.is_org_admin=False;membership.branch=main;membership.active_role_group_name=role.name;membership.save()
        budget=self.create_budget();budget.branch=west;budget.save()
        item=self.forward(budget,'department_budget')
        self.client.force_authenticate(self.reviewer)
        inbox=self.client.get('/api/platform/workflows/inbox/').data['data']['results']
        self.assertNotIn(item.pk,[row['id'] for row in inbox])
        result=self.client.post(f'/api/platform/workflows/inbox/{item.pk}/action/',{'decision':'approve'},format='json')
        self.assertEqual(result.status_code,403,result.data)
        self.assertEqual(self.client.get(f'/api/platform/workflows/inbox/{item.pk}/subject/').status_code,403)

    def test_repeated_plan_submission_cannot_disclose_another_branch(self):
        west=TenantBranch.objects.create(tenant=self.tenant,name='West')
        main=TenantBranch.objects.create(tenant=self.tenant,name='Main')
        annual=Budget.objects.create(tenant=self.tenant,branch=west,name='West annual',code='WEST',period_type='annual',status='active',approval_status='approved',start_date=date(2027,1,1),end_date=date(2027,12,31))
        line=BudgetLine.objects.create(budget=annual,account=self.account,cost_center='IT',period_year=2027,allocated_amount=1000)
        response=self.client.post('/api/procurement/plans/',{'name':'West plan','code':'WEST-PLAN','annual_budget':annual.pk,'lines':[{'budget_line':line.pk,'description':'Supplies','quantity':1,'estimated_amount':1000,'planned_date':'2027-05-01'}]},format='json')
        self.assertEqual(response.status_code,201,response.data)
        plan=ProcurementPlan.objects.get(pk=response.data['id'])
        self.forward(plan,'procurement_plan')
        role=Group.objects.create(name=f'tenant:{self.tenant.pk}:Plan submitter')
        role.permissions.add(*Permission.objects.filter(content_type__app_label='SL_Procurement',codename__in=['submit_procurementplan','view_procurementplan']))
        self.worker.groups.add(role)
        membership=OrganizationMembership.objects.get(user=self.worker,tenant=self.tenant);membership.branch=main;membership.active_role_group_name=role.name;membership.save()
        self.client.force_authenticate(self.worker)
        result=self.client.post('/api/platform/workflows/forward/',{'module_slug':'procurement','entity_type':'procurement_plan','entity_id':plan.pk},format='json')
        self.assertEqual(result.status_code,403,result.data)

    def test_invalid_currency_cannot_break_budget_presentation(self):
        budget=self.create_budget()
        result=self.client.patch(f'/api/budgeting/budgets/{budget.pk}/',{'currency':'NOT-MONEY'},format='json')
        self.assertEqual(result.status_code,400,result.data)
        budget.refresh_from_db();self.assertEqual(budget.currency,'KES')
