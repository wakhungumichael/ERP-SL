/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
const PATH_PERMISSION_RULES: Array<{ prefix: string; permissions: string[]; exact?: boolean }> = [
  { prefix: '/dashboard', permissions: ['Platform_Core.can_view_workspace_dashboard'] },
  { prefix: '/workspace/operations/dashboard', permissions: ['Platform_Core.can_view_weighbridge_overview'] },
  { prefix: '/weighbridge/weighment-entry', permissions: ['SL_Weighbridge.can_access_weighment_entry'] },
  { prefix: '/weighbridge/transactions', permissions: ['SL_Weighbridge.*_transaction'] },
  { prefix: '/weighbridge/customers', permissions: ['SL_Weighbridge.*_customer'] },
  { prefix: '/weighbridge/vehicles', permissions: ['SL_Weighbridge.*_vehicle'] },
  { prefix: '/weighbridge/live', permissions: ['SL_Weighbridge.can_view_live_weight'] },
  { prefix: '/weighbridge/reports', permissions: ['SL_Weighbridge.can_manage_weighbridge_reports', 'SL_Weighbridge.*_report'] },
  { prefix: '/weighbridge/settings', permissions: ['SL_Weighbridge.can_manage_weighbridge_settings'] },
  { prefix: '/weighbridge/overweight-log', permissions: ['SL_Weighbridge.*_vehiclepresence', 'SL_Weighbridge.*_overweightevent'] },
  { prefix: '/weighbridge/discrepancies', permissions: ['SL_Weighbridge.can_review_weighbridge_discrepancies', 'SL_Weighbridge.*_weighbridgediscrepancy', 'SL_Weighbridge.*_discrepancyreport'] },
  { prefix: '/weighbridge/overview', permissions: ['Platform_Core.can_view_weighbridge_overview'] },

  { prefix: '/sales/estimates', permissions: ['SL_Sales.*_estimate'] },
  { prefix: '/sales/orders', permissions: ['SL_Sales.*_salesorder'] },
  { prefix: '/sales/recurring', permissions: ['SL_Sales.*_recurringinvoice'] },
  { prefix: '/sales/products', permissions: ['SL_Sales.*_product'] },
  { prefix: '/sales/customers', permissions: ['SL_Sales.*_salescustomer'] },
  { prefix: '/sales/statements', permissions: ['SL_Sales.can_view_customer_statements'] },
  { prefix: '/sales/overview', permissions: ['Platform_Core.can_view_sales_overview'] },

  { prefix: '/inventory/warehouses', permissions: ['SL_Inventory.*_warehouse'] },
  { prefix: '/inventory/movements', permissions: ['SL_Inventory.*_inventorymovement'] },
  { prefix: '/inventory/stock', permissions: ['SL_Inventory.*_inventorybalance'] },
  { prefix: '/inventory/overview', permissions: ['Platform_Core.can_view_inventory_overview'] },

  { prefix: '/finance/overview', permissions: ['Platform_Core.can_view_finance_overview'] },
  { prefix: '/payments/invoices', permissions: ['SL_Weighbridge.view_invoice', 'SL_Weighbridge.add_invoice', 'SL_Weighbridge.change_invoice'] },
  { prefix: '/finance', permissions: ['Platform_Core.can_access_finance_workspace'] },
  { prefix: '/accounting', permissions: ['Platform_Core.can_access_finance_workspace'] },
  { prefix: '/payments', permissions: ['Platform_Core.can_access_finance_workspace'] },

  { prefix: '/crm/companies', permissions: ['SL_CRM.*_organisation'] },
  { prefix: '/crm/people', permissions: ['SL_CRM.*_contact'] },
  { prefix: '/crm/suppliers', permissions: ['SL_CRM.*_supplier'] },
  { prefix: '/crm/opportunities', permissions: ['SL_CRM.*_lead'] },
  { prefix: '/crm/follow-ups', permissions: ['SL_CRM.*_activity'] },
  { prefix: '/crm/dashboard', permissions: ['Platform_Core.can_view_crm_overview'] },

  { prefix: '/ticketing/forms', permissions: ['SL_Ticketing.*_ticketformschema'] },
  { prefix: '/ticketing/automation', permissions: ['SL_Ticketing.*_ticketroutingrule'] },
  { prefix: '/ticketing/settings', permissions: ['SL_Ticketing.*_ticketinginboxconfig', 'SL_Ticketing.*_ticketingapikey', 'SL_Ticketing.*_ticketingwebhookendpoint'] },
  { prefix: '/ticketing/queue', permissions: ['SL_Ticketing.*_ticket'] },
  { prefix: '/ticketing/overview', permissions: ['Platform_Core.can_view_ticketing_overview'] },

  { prefix: '/projects/overview', permissions: ['SL_Projects.view_project_dashboard', 'SL_Projects.view_projecttask', 'SL_Projects.view_own_projecttask', 'SL_Projects.view_all_projecttask'] },
  { prefix: '/projects/team-tasks', permissions: ['SL_Projects.view_projecttask', 'SL_Projects.view_all_projecttask'] },
  { prefix: '/projects/my-tasks', permissions: ['SL_Projects.view_projecttask', 'SL_Projects.view_own_projecttask', 'SL_Projects.view_all_projecttask'] },
  { prefix: '/projects/board', permissions: ['SL_Projects.view_projecttask', 'SL_Projects.view_own_projecttask', 'SL_Projects.view_all_projecttask'] },
  { prefix: '/projects/calendar', permissions: ['SL_Projects.view_projecttask', 'SL_Projects.view_own_projecttask', 'SL_Projects.view_all_projecttask'] },
  { prefix: '/projects/reports', permissions: ['SL_Projects.export_project', 'SL_Projects.export_projecttask'] },
  { prefix: '/projects/follow-ups', permissions: ['SL_Projects.view_projecttask', 'SL_Projects.view_own_projecttask', 'SL_Projects.view_all_projecttask'] },
  { prefix: '/projects/tasks', exact: true, permissions: ['SL_Projects.view_projecttask', 'SL_Projects.view_all_projecttask'] },
  { prefix: '/projects/tasks/', permissions: ['SL_Projects.view_projecttask', 'SL_Projects.view_own_projecttask', 'SL_Projects.view_all_projecttask'] },
  { prefix: '/projects', exact: true, permissions: ['SL_Projects.view_project', 'SL_Projects.add_project', 'SL_Projects.view_projecttask', 'SL_Projects.view_own_projecttask', 'SL_Projects.view_all_projecttask'] },
  { prefix: '/projects/', permissions: ['SL_Projects.view_project', 'SL_Projects.add_project', 'SL_Projects.view_projecttask', 'SL_Projects.view_own_projecttask', 'SL_Projects.view_all_projecttask'] },
  { prefix: '/hr/employees', permissions: ['SL_HR.view_employee', 'SL_HR.view_all_employee', 'SL_HR.add_employee', 'SL_HR.request_own_leave'] },
  { prefix: '/hr/leave', permissions: ['SL_HR.request_own_leave', 'SL_HR.view_all_leaverequest', 'SL_HR.approve_leaverequest'] },
  { prefix: '/hr/requests', permissions: ['SL_HR.add_employeeservicerequest', 'SL_HR.change_employeeservicerequest'] },
  { prefix: '/hr/settings', permissions: ['SL_HR.change_hrpolicy'] },
  { prefix: '/hr/my-payslips', permissions: ['SL_HR.request_own_leave', 'SL_HR.view_payrecord'] },
  { prefix: '/hr/staff', permissions: ['SL_HR.view_payperiod'] },
  { prefix: '/procurement/departments', permissions: ['SL_Procurement.view_department', 'SL_Procurement.change_department', 'SL_Procurement.add_department'] },
  { prefix: '/procurement/requisitions', permissions: ['SL_Procurement.*_requisition'] },
  { prefix: '/procurement/vendors', permissions: ['SL_CRM.*_supplier'] },
  { prefix: '/procurement/purchase-orders', permissions: ['SL_Procurement.*_purchaseorder'] },
  { prefix: '/procurement/receipts', permissions: ['SL_Procurement.*_goodsreceiptnote'] },
  { prefix: '/procurement/bills', permissions: ['SL_Procurement.*_bill'] },
  { prefix: '/procurement/payment-queue', permissions: ['SL_Procurement.*_paymentqueueitem'] },
  { prefix: '/procurement/approval-rules', permissions: ['SL_Procurement.*_approvalmatrix'] },
  { prefix: '/purchases/requisitions', permissions: ['SL_Procurement.*_requisition'] },
  { prefix: '/purchases/purchase-orders', permissions: ['SL_Procurement.*_purchaseorder'] },
  { prefix: '/purchases/receipts', permissions: ['SL_Procurement.*_goodsreceiptnote'] },
  { prefix: '/purchases/bills', permissions: ['SL_Procurement.*_bill'] },
  { prefix: '/purchases/payment-queue', permissions: ['SL_Procurement.*_paymentqueueitem'] },
  { prefix: '/purchases', permissions: ['SL_Procurement.*'] },
  { prefix: '/budgeting/overview', permissions: ['SL_Budgeting.*'] },
  { prefix: '/reports/dashboard', permissions: ['Platform_Core.can_view_erp_reports'] },
  // Workflow access is independent of the source module: an assigned approver
  // must be able to review requests even without that module's list permission.
  { prefix: '/workflows/approvals', permissions: ['Platform_Core.approve_workflow'] },
  { prefix: '/manufacturing/overview', permissions: ['Platform_Core.can_view_manufacturing_overview'] },
  { prefix: '/retail/overview', permissions: ['Platform_Core.can_view_retail_overview'] },
  { prefix: '/services/overview', permissions: ['Platform_Core.can_view_services_overview'] },
].sort((a, b) => b.prefix.length - a.prefix.length);

function pathMatches(path: string, prefix: string, exact = false) {
  if (exact) return path === prefix;
  return path === prefix || path.startsWith(`${prefix}/`);
}

function permissionMatches(permission: string, requirement: string) {
  const wildcardIndex = requirement.indexOf('*');
  if (wildcardIndex < 0) return permission === requirement;
  return permission.startsWith(requirement.slice(0, wildcardIndex))
    && permission.endsWith(requirement.slice(wildcardIndex + 1));
}

export function hasMenuPathPermission(path: string, permissions: string[]) {
  if (path === '/') return true;
  const cleanPath = path.split('?')[0]?.split('#')[0] ?? path;
  const rule = PATH_PERMISSION_RULES.find(candidate => pathMatches(cleanPath, candidate.prefix, candidate.exact));
  if (!rule) return false;
  return rule.permissions.some(requirement =>
    permissions.some(permission => permissionMatches(permission, requirement)),
  );
}
