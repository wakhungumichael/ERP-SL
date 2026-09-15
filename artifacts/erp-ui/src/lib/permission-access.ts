const PATH_PERMISSION_RULES: Array<{ prefix: string; permissions: string[] }> = [
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
  { prefix: '/sales/customers', permissions: ['SL_Weighbridge.*_customer'] },
  { prefix: '/sales/statements', permissions: ['SL_Weighbridge.*_invoice', 'SL_Weighbridge.*_customer'] },
  { prefix: '/sales/overview', permissions: ['Platform_Core.can_view_sales_overview'] },

  { prefix: '/inventory/warehouses', permissions: ['SL_Inventory.*_warehouse'] },
  { prefix: '/inventory/movements', permissions: ['SL_Inventory.*_inventorymovement'] },
  { prefix: '/inventory/stock', permissions: ['SL_Inventory.*_inventorybalance'] },
  { prefix: '/inventory/overview', permissions: ['Platform_Core.can_view_inventory_overview'] },

  { prefix: '/finance/overview', permissions: ['Platform_Core.can_view_finance_overview'] },
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

  { prefix: '/hr/staff', permissions: ['SL_HR.*'] },
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
  { prefix: '/manufacturing/overview', permissions: ['Platform_Core.can_view_manufacturing_overview'] },
  { prefix: '/retail/overview', permissions: ['Platform_Core.can_view_retail_overview'] },
  { prefix: '/services/overview', permissions: ['Platform_Core.can_view_services_overview'] },
].sort((a, b) => b.prefix.length - a.prefix.length);

function pathMatches(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function permissionMatches(permission: string, requirement: string) {
  const wildcardIndex = requirement.indexOf('*');
  if (wildcardIndex < 0) return permission === requirement;
  return permission.startsWith(requirement.slice(0, wildcardIndex))
    && permission.endsWith(requirement.slice(wildcardIndex + 1));
}

export function hasMenuPathPermission(path: string, permissions: string[]) {
  if (path === '/' || path === '/dashboard') return true;
  const cleanPath = path.split('?')[0]?.split('#')[0] ?? path;
  const rule = PATH_PERMISSION_RULES.find(candidate => pathMatches(cleanPath, candidate.prefix));
  if (!rule) return false;
  return rule.permissions.some(requirement =>
    permissions.some(permission => permissionMatches(permission, requirement)),
  );
}
