import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Shell } from '@/components/shell';
import { AuthProvider } from '@/context/auth-context';

import { useAuth } from '@/context/use-auth';
import type { AppRole } from '@/lib/roles';
import { CAN_VIEW_REPORTS_WORKSPACE } from '@/lib/roles';
import Login from '@/pages/login';
import LandingPage from '@/pages/landing';
import MarketingAppsPage from '@/pages/marketing-apps';
import MarketingPricingPage from '@/pages/marketing-pricing';
import MarketingAboutPage from '@/pages/marketing-about';
import MarketingSupportPage from '@/pages/marketing-support';
import PrivacyPolicyPage from '@/pages/privacy-policy';
import Dashboard from '@/pages/dashboard';
import WeighbridgeOverview from '@/pages/weighbridge/overview';
import TransactionsList from '@/pages/transactions/list';
import TransactionDetail from '@/pages/transactions/detail';
import WeighmentEntryPage from '@/pages/weighbridge/weighment-entry';
import CustomersList from '@/pages/customers/list';
import VehiclesList from '@/pages/vehicles/list';
import LiveWeight from '@/pages/live-weight';
import InvoicesList from '@/pages/invoices/list';
import InvoiceDetail from '@/pages/invoices/detail';
import PaymentMethods from '@/pages/payments/methods';
import AccountingDashboard from '@/pages/accounting/dashboard';
import CRMDashboard from '@/pages/crm/dashboard';
import Companies from '@/pages/crm/companies';
import People from '@/pages/crm/people';
import Suppliers from '@/pages/crm/suppliers';
import Opportunities from '@/pages/crm/opportunities';
import FollowUps from '@/pages/crm/follow-ups';
import TicketingOverview from '@/pages/ticketing/overview';
import TicketingQueue from '@/pages/ticketing/queue';
import TicketingForms from '@/pages/ticketing/forms';
import TicketingAutomation from '@/pages/ticketing/automation';
import TicketingSettings from '@/pages/ticketing/settings';
import Tenants from '@/pages/platform/tenants';
import BillingCenter from '@/pages/platform/billing';
import Industries from '@/pages/platform/industries';
import Roles from '@/pages/platform/roles';
import Modules from '@/pages/platform/modules';
import Plans from '@/pages/platform/plans';
import Subscriptions from '@/pages/platform/subscriptions';
import Licenses from '@/pages/platform/licenses';
import Integrations from '@/pages/platform/integrations';
import Workspace from '@/pages/platform/workspace';
import WorkflowCenter from '@/pages/platform/workflows';
import Backups from '@/pages/platform/backups';
import OrganizationSettings from '@/pages/platform/company-settings';
import AuditLogsPage from '@/pages/platform/audit-logs';
import WeighbridgeSettings from '@/pages/weighbridge/settings';
import OverweightLog from '@/pages/weighbridge/overweight-log';
import Discrepancies from '@/pages/weighbridge/discrepancies';
import ReportsDashboard from '@/pages/reports/dashboard';
import HRStaff from '@/pages/hr/staff';
import PurchaseOrders from '@/pages/procurement/purchase-orders';
import ProcurementRequisitions from '@/pages/procurement/requisitions';
import ProcurementApprovalRules from '@/pages/procurement/approval-rules';
import GoodsReceiptsPage from '@/pages/procurement/receipts';
import BudgetingOverview from '@/pages/budgeting/overview';
import InventoryOverview from '@/pages/inventory/overview';
import InventoryStock from '@/pages/inventory/stock';
import InventoryWarehouses from '@/pages/inventory/warehouses';
import InventoryMovements from '@/pages/inventory/movements';
import ManufacturingOverview from '@/pages/industry/manufacturing-overview';
import RetailOverview from '@/pages/industry/retail-overview';
import ServicesOverview from '@/pages/industry/services-overview';
import NotFound from '@/pages/not-found';

// ── Sales ─────────────────────────────────────────────────────────────────────
import SalesEstimates from '@/pages/sales/estimates';
import SalesInvoices from '@/pages/sales/invoices';
import SalesRecurring from '@/pages/sales/recurring';
import SalesStatements from '@/pages/sales/statements';
import SalesCustomers from '@/pages/sales/customers';
import SalesProducts from '@/pages/sales/products';
import SalesOrders from '@/pages/sales/orders';

// ── Procurement legacy pages ──────────────────────────────────────────────────
import PurchaseBills from '@/pages/purchases/bills';
import PaymentQueuePage from '@/pages/purchases/payment-queue';
import PurchaseVendors from '@/pages/purchases/vendors';
import PurchaseProducts from '@/pages/purchases/products';

// ── Finance legacy pages ──────────────────────────────────────────────────────
import ChartOfAccounts from '@/pages/accounting/chart-of-accounts';
import AccountingTransactions from '@/pages/accounting/transactions';
import AccountingTransactionDetail from '@/pages/accounting/transaction-detail';
import AccountingPostingRules from '@/pages/accounting/posting-rules';
import AccountingReports from '@/pages/accounting/reports';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

/** Route-level guard: renders children only if the user holds one of `allowedRoles`. */
function RoleGuard({ allowedRoles, children }: { allowedRoles: AppRole[]; children: React.ReactNode }) {
  const { role, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[240px] text-sm text-muted-foreground">
        Loading access…
      </div>
    );
  }
  if (!allowedRoles.includes(role)) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-12 text-center gap-3">
        <p className="text-lg font-semibold">Access Denied</p>
        <p className="text-sm text-muted-foreground">You do not have permission to view this page.</p>
      </div>
    );
  }
  return <>{children}</>;
}

function Router() {
  const { token, user, role, isLoading } = useAuth();

  const homeContent = (() => {
    if (token && isLoading) {
      return (
        <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
          Loading workspace…
        </div>
      );
    }

    if (token && user) {
      return role === 'superadmin'
        ? <Shell><BillingCenter /></Shell>
        : <Shell><Dashboard /></Shell>;
    }

    return <LandingPage />;
  })();

  return (
    <Switch>
      <Route path="/landing/apps">
        <MarketingAppsPage />
      </Route>
      <Route path="/landing/pricing">
        <MarketingPricingPage />
      </Route>
      <Route path="/landing/about">
        <MarketingAboutPage />
      </Route>
      <Route path="/landing/support">
        <MarketingSupportPage />
      </Route>
      <Route path="/landing/privacy">
        <PrivacyPolicyPage />
      </Route>
      <Route path="/landing">
        <LandingPage />
      </Route>
      <Route path="/landing/:tenantCode/apps">
        {params => <MarketingAppsPage tenantCode={params.tenantCode} />}
      </Route>
      <Route path="/landing/:tenantCode/pricing">
        {params => <MarketingPricingPage tenantCode={params.tenantCode} />}
      </Route>
      <Route path="/landing/:tenantCode/about">
        {params => <MarketingAboutPage tenantCode={params.tenantCode} />}
      </Route>
      <Route path="/landing/:tenantCode/support">
        {params => <MarketingSupportPage tenantCode={params.tenantCode} />}
      </Route>
      <Route path="/landing/:tenantCode/privacy">
        {params => <PrivacyPolicyPage tenantCode={params.tenantCode} />}
      </Route>
      <Route path="/landing/:tenantCode">
        {params => <LandingPage tenantCode={params.tenantCode} />}
      </Route>
      <Route path="/login/:tenantCode">
        <Login />
      </Route>
      <Route path="/login">
        <Login />
      </Route>
      <Route path="/privacy">
        <PrivacyPolicyPage />
      </Route>
      <Route path="/">
        {homeContent}
      </Route>
      <Route path="/dashboard">
        <Shell>
          <RoleGuard allowedRoles={['superadmin', 'tenant_admin', 'finance', 'operator']}>
            {role === 'superadmin' ? <BillingCenter /> : <Dashboard />}
          </RoleGuard>
        </Shell>
      </Route>
      <Route path="/workspace/operations/dashboard">
        <Shell>
          <RoleGuard allowedRoles={['superadmin', 'tenant_admin', 'finance', 'operator']}>
            {role === 'superadmin' ? <BillingCenter /> : <Dashboard />}
          </RoleGuard>
        </Shell>
      </Route>

      {/* Weighbridge */}
      <Route path="/weighbridge/overview">
        <Shell><WeighbridgeOverview /></Shell>
      </Route>
      <Route path="/weighbridge/transactions">
        <Shell><TransactionsList /></Shell>
      </Route>
      <Route path="/weighbridge/transactions/:id">
        {params => <Shell><TransactionDetail id={params.id} /></Shell>}
      </Route>
      <Route path="/weighbridge/first-weight">
        <Shell><WeighmentEntryPage preferredFlow="first" /></Shell>
      </Route>
      <Route path="/weighbridge/second-weight">
        <Shell><WeighmentEntryPage preferredFlow="second" /></Shell>
      </Route>
      <Route path="/weighbridge/weighment-entry">
        <Shell><WeighmentEntryPage /></Shell>
      </Route>
      <Route path="/weighbridge/weight-capture">
        <Shell><WeighmentEntryPage /></Shell>
      </Route>
      <Route path="/weighbridge/customers">
        <Shell><CustomersList /></Shell>
      </Route>
      <Route path="/weighbridge/vehicles">
        <Shell><VehiclesList /></Shell>
      </Route>
      <Route path="/weighbridge/live">
        <Shell><LiveWeight /></Shell>
      </Route>
      <Route path="/weighbridge/settings">
        <Shell><WeighbridgeSettings /></Shell>
      </Route>
      <Route path="/weighbridge/overweight-log">
        <Shell><OverweightLog /></Shell>
      </Route>
      <Route path="/weighbridge/discrepancies">
        <Shell><Discrepancies /></Shell>
      </Route>

      {/* Sales */}
      <Route path="/sales/estimates">
        <Shell><SalesEstimates /></Shell>
      </Route>
      <Route path="/sales/invoices">
        <Shell><SalesInvoices /></Shell>
      </Route>
      <Route path="/sales/orders">
        <Shell><SalesOrders /></Shell>
      </Route>
      <Route path="/sales/recurring">
        <Shell><SalesRecurring /></Shell>
      </Route>
      <Route path="/sales/statements">
        <Shell><SalesStatements /></Shell>
      </Route>
      <Route path="/sales/customers">
        <Shell><SalesCustomers /></Shell>
      </Route>
      <Route path="/sales/products">
        <Shell><SalesProducts /></Shell>
      </Route>

      {/* Purchases legacy paths */}
      <Route path="/procurement/bills">
        <Shell><PurchaseBills /></Shell>
      </Route>
      <Route path="/procurement/payment-queue">
        <Shell><PaymentQueuePage /></Shell>
      </Route>
      <Route path="/purchases/bills">
        <Shell><PurchaseBills /></Shell>
      </Route>
      <Route path="/purchases/payment-queue">
        <Shell><PaymentQueuePage /></Shell>
      </Route>
      <Route path="/purchases/vendors">
        <Shell><PurchaseVendors /></Shell>
      </Route>
      <Route path="/purchases/products">
        <Shell><PurchaseProducts /></Shell>
      </Route>

      {/* Accounting legacy paths */}
      <Route path="/accounting/dashboard">
        <Shell><AccountingDashboard /></Shell>
      </Route>
      <Route path="/accounting/reports">
        <Shell><AccountingReports /></Shell>
      </Route>
      <Route path="/accounting/chart-of-accounts">
        <Shell><ChartOfAccounts /></Shell>
      </Route>
      <Route path="/accounting/transactions">
        <Shell><AccountingTransactions /></Shell>
      </Route>
      <Route path="/accounting/transactions/:id">
        {params => <Shell><AccountingTransactionDetail id={params.id} /></Shell>}
      </Route>
      <Route path="/accounting/posting-rules">
        <Shell><AccountingPostingRules /></Shell>
      </Route>

      {/* Finance canonical paths */}
      <Route path="/finance/overview">
        <Shell><AccountingDashboard /></Shell>
      </Route>
      <Route path="/finance/reports">
        <Shell><AccountingReports /></Shell>
      </Route>
      <Route path="/finance/chart-of-accounts">
        <Shell><ChartOfAccounts /></Shell>
      </Route>
      <Route path="/finance/transactions">
        <Shell><AccountingTransactions /></Shell>
      </Route>
      <Route path="/finance/transactions/:id">
        {params => <Shell><AccountingTransactionDetail id={params.id} /></Shell>}
      </Route>
      <Route path="/finance/posting-rules">
        <Shell><AccountingPostingRules /></Shell>
      </Route>
      <Route path="/finance/receivables">
        <Shell><SalesInvoices /></Shell>
      </Route>
      <Route path="/finance/payables">
        <Shell><PurchaseBills /></Shell>
      </Route>
      <Route path="/finance/payment-methods">
        <Shell><PaymentMethods /></Shell>
      </Route>
      <Route path="/finance/budgets">
        <Shell><BudgetingOverview /></Shell>
      </Route>

      {/* Legacy Payments & Finance routes — keep for backward compat */}
      <Route path="/payments/invoices">
        <Shell><InvoicesList /></Shell>
      </Route>
      <Route path="/payments/invoices/:id">
        {params => <Shell><InvoiceDetail id={params.id} /></Shell>}
      </Route>
      <Route path="/payments/methods">
        <Shell><PaymentMethods /></Shell>
      </Route>

      {/* CRM — Relationships */}
      <Route path="/crm/dashboard"><Shell><CRMDashboard /></Shell></Route>
      <Route path="/crm/companies"><Shell><Companies /></Shell></Route>
      <Route path="/crm/people"><Shell><People /></Shell></Route>
      <Route path="/crm/suppliers"><Shell><Suppliers /></Shell></Route>
      <Route path="/crm/opportunities"><Shell><Opportunities /></Shell></Route>
      <Route path="/crm/follow-ups"><Shell><FollowUps /></Shell></Route>

      {/* Ticketing */}
      <Route path="/ticketing/overview"><Shell><TicketingOverview /></Shell></Route>
      <Route path="/ticketing/queue"><Shell><TicketingQueue /></Shell></Route>
      <Route path="/ticketing/forms"><Shell><TicketingForms /></Shell></Route>
      <Route path="/ticketing/automation"><Shell><TicketingAutomation /></Shell></Route>
      <Route path="/ticketing/settings"><Shell><TicketingSettings /></Shell></Route>

      {/* Reports */}
      <Route path="/weighbridge/reports">
        <Shell><RoleGuard allowedRoles={CAN_VIEW_REPORTS_WORKSPACE}><ReportsDashboard /></RoleGuard></Shell>
      </Route>
      <Route path="/reports/dashboard">
        <Shell><RoleGuard allowedRoles={CAN_VIEW_REPORTS_WORKSPACE}><ReportsDashboard /></RoleGuard></Shell>
      </Route>

      {/* HR */}
      <Route path="/hr/staff"><Shell><HRStaff /></Shell></Route>

      {/* Procurement */}
      <Route path="/procurement/approval-rules"><Shell><ProcurementApprovalRules /></Shell></Route>
      <Route path="/procurement/requisitions"><Shell><ProcurementRequisitions /></Shell></Route>
      <Route path="/procurement/receipts"><Shell><GoodsReceiptsPage /></Shell></Route>
      <Route path="/procurement/purchase-orders"><Shell><PurchaseOrders /></Shell></Route>
      <Route path="/procurement/vendors"><Shell><PurchaseVendors /></Shell></Route>
      <Route path="/procurement/bills"><Shell><PurchaseBills /></Shell></Route>

      {/* Inventory */}
      <Route path="/inventory/overview"><Shell><InventoryOverview /></Shell></Route>
      <Route path="/inventory/stock"><Shell><InventoryStock /></Shell></Route>
      <Route path="/inventory/warehouses"><Shell><InventoryWarehouses /></Shell></Route>
      <Route path="/inventory/movements"><Shell><InventoryMovements /></Shell></Route>

      {/* Budgeting */}
      <Route path="/budgeting/overview"><Shell><BudgetingOverview /></Shell></Route>

      {/* Industry Packs */}
      <Route path="/manufacturing/overview"><Shell><ManufacturingOverview /></Shell></Route>
      <Route path="/retail/overview"><Shell><RetailOverview /></Shell></Route>
      <Route path="/services/overview"><Shell><ServicesOverview /></Shell></Route>

      {/* Platform Admin — superadmin-only pages */}
      <Route path="/platform/billing">
        <Shell><RoleGuard allowedRoles={['superadmin']}><BillingCenter /></RoleGuard></Shell>
      </Route>
      <Route path="/platform/tenants">
        <Shell><RoleGuard allowedRoles={['superadmin']}><Tenants /></RoleGuard></Shell>
      </Route>
      <Route path="/platform/industries">
        <Shell><RoleGuard allowedRoles={['superadmin']}><Industries /></RoleGuard></Shell>
      </Route>
      <Route path="/platform/modules">
        <Shell><RoleGuard allowedRoles={['superadmin']}><Modules /></RoleGuard></Shell>
      </Route>
      <Route path="/platform/plans">
        <Shell><RoleGuard allowedRoles={['superadmin']}><Plans /></RoleGuard></Shell>
      </Route>
      <Route path="/platform/subscriptions">
        <Shell><RoleGuard allowedRoles={['superadmin']}><Subscriptions /></RoleGuard></Shell>
      </Route>
      <Route path="/platform/licenses">
        <Shell><RoleGuard allowedRoles={['superadmin']}><Licenses /></RoleGuard></Shell>
      </Route>
      <Route path="/platform/integrations">
        <Shell><RoleGuard allowedRoles={['superadmin']}><Integrations /></RoleGuard></Shell>
      </Route>
      <Route path="/platform/backups">
        <Shell><RoleGuard allowedRoles={['superadmin', 'tenant_admin']}><Backups /></RoleGuard></Shell>
      </Route>

      {/* Platform Admin — superadmin + tenant_admin pages */}
      <Route path="/platform/users">
        <Shell><RoleGuard allowedRoles={['superadmin', 'tenant_admin']}><OrganizationSettings /></RoleGuard></Shell>
      </Route>
      <Route path="/platform/roles">
        <Shell><RoleGuard allowedRoles={['superadmin', 'tenant_admin']}><Roles /></RoleGuard></Shell>
      </Route>
      <Route path="/platform/workspace">
        <Shell><RoleGuard allowedRoles={['superadmin']}><Workspace /></RoleGuard></Shell>
      </Route>
      <Route path="/platform/workflows">
        <Shell><RoleGuard allowedRoles={['superadmin', 'tenant_admin']}><WorkflowCenter /></RoleGuard></Shell>
      </Route>
      <Route path="/platform/company-settings">
        <Shell><RoleGuard allowedRoles={['superadmin', 'tenant_admin']}><OrganizationSettings /></RoleGuard></Shell>
      </Route>
      <Route path="/platform/organization-settings">
        <Shell><RoleGuard allowedRoles={['superadmin', 'tenant_admin']}><OrganizationSettings /></RoleGuard></Shell>
      </Route>
      <Route path="/platform/audit">
        <Shell><RoleGuard allowedRoles={['superadmin', 'tenant_admin']}><AuditLogsPage /></RoleGuard></Shell>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
