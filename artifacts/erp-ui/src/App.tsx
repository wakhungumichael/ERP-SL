import PlanningWorkspace from "@/pages/budgeting/planning";
import SharedDocument from "@/pages/public/shared-document";
import MyPayslips from "@/pages/hr/my-payslips";
import ProjectSettingsPage from "@/pages/projects/settings";
/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { useAppBranding } from "@/hooks/use-app-branding";
import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { toast } from "@/hooks/use-toast";
import { getUserFacingError } from "@/lib/api-errors";
import { ERPErrorBoundary } from "@/components/erp/error-boundary";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, Redirect, Router as WouterRouter } from "wouter";
import { Shell } from "@/components/shell";
import { useLocation } from "wouter";
import { WorkspaceProvider } from "@/context/workspace-context";
import { WorkspaceOutlet } from "@/components/erp/workspace/workspace-outlet";
import WorkspaceHome from "@/pages/home";
import { AuthProvider } from "@/context/auth-context";

import { useAuth } from "@/context/use-auth";
import type { AppRole } from "@/lib/roles";
import { CAN_VIEW_REPORTS_WORKSPACE } from "@/lib/roles";
import Login from "@/pages/login";
import LandingPage from "@/pages/landing";
import MarketingAppsPage from "@/pages/marketing-apps";
import MarketingPricingPage from "@/pages/marketing-pricing";
import MarketingAboutPage from "@/pages/marketing-about";
import MarketingSupportPage from "@/pages/marketing-support";
import PrivacyPolicyPage from "@/pages/privacy-policy";
import Dashboard from "@/pages/dashboard";
import WeighbridgeOverview from "@/pages/weighbridge/overview";
import TransactionsList from "@/pages/transactions/list";
import TransactionDetail from "@/pages/transactions/detail";
import WeighmentEntryPage from "@/pages/weighbridge/weighment-entry";
import CustomersList from "@/pages/customers/list";
import VehiclesList from "@/pages/vehicles/list";
import LiveWeight from "@/pages/live-weight";
import InvoicesList from "@/pages/invoices/list";
import InvoiceDetail from "@/pages/invoices/detail";
import PaymentMethods from "@/pages/payments/methods";
import AccountingDashboard from "@/pages/accounting/dashboard";
import CRMDashboard from "@/pages/crm/dashboard";
import Companies from "@/pages/crm/companies";
import People from "@/pages/crm/people";
import Suppliers from "@/pages/crm/suppliers";
import Opportunities from "@/pages/crm/opportunities";
import FollowUps from "@/pages/crm/follow-ups";
import SalesPerformance from "@/pages/crm/performance";
import TicketingOverview from "@/pages/ticketing/overview";
import TicketingQueue from "@/pages/ticketing/queue";
import TicketingForms from "@/pages/ticketing/forms";
import TicketingAutomation from "@/pages/ticketing/automation";
import TicketingSettings from "@/pages/ticketing/settings";
import Tenants from "@/pages/platform/tenants";
import BillingCenter from "@/pages/platform/billing";
import Industries from "@/pages/platform/industries";
import Roles from "@/pages/platform/roles";
import Modules from "@/pages/platform/modules";
import Plans from "@/pages/platform/plans";
import Subscriptions from "@/pages/platform/subscriptions";
import Licenses from "@/pages/platform/licenses";
import Integrations from "@/pages/platform/integrations";
import Workspace from "@/pages/platform/workspace";
import WorkflowCenter from "@/pages/platform/workflows";
import WorkflowApprovals from "@/pages/workflow/approvals";
import ProjectsWorkspace from "@/pages/projects/workspace";
import TaskDetail from "@/pages/projects/task-detail";
import ProjectKanban from "@/pages/projects/kanban";
import ProjectCalendar from "@/pages/projects/calendar";
import ProjectDetail from "@/pages/projects/project-detail";
import ProjectsReports from "@/pages/projects/reports";
import ProjectFollowUps from "@/pages/projects/follow-ups";
import Backups from "@/pages/platform/backups";
import OrganizationSettings from "@/pages/platform/company-settings";
import Users from "@/pages/platform/users";
import AuditLogsPage from "@/pages/platform/audit-logs";
import WeighbridgeSettings from "@/pages/weighbridge/settings";
import OverweightLog from "@/pages/weighbridge/overweight-log";
import Discrepancies from "@/pages/weighbridge/discrepancies";
import ReportsDashboard from "@/pages/reports/dashboard";
import HRWorkforce from "@/pages/hr/workforce";
import HRStaff from "@/pages/hr/staff";
import PurchaseOrders from "@/pages/procurement/purchase-orders";
import OrganizationUnits from "@/components/organization/organization-units";
import ProcurementConfiguration from "@/pages/procurement/configuration";
import ProcurementRequisitions from "@/pages/procurement/requisitions";
import ProcurementApprovalRules from "@/pages/procurement/approval-rules";
import GoodsReceiptsPage from "@/pages/procurement/receipts";
import BudgetingOverview from "@/pages/budgeting/overview";
import InventoryOverview from "@/pages/inventory/overview";
import InventoryStock from "@/pages/inventory/stock";
import InventoryWarehouses from "@/pages/inventory/warehouses";
import InventoryMovements from "@/pages/inventory/movements";
import ManufacturingOverview from "@/pages/industry/manufacturing-overview";
import RetailOverview from "@/pages/industry/retail-overview";
import ServicesOverview from "@/pages/industry/services-overview";
import NotFound from "@/pages/not-found";

// ── Sales ─────────────────────────────────────────────────────────────────────
import SalesEstimates from "@/pages/sales/estimates";
import SalesInvoices from "@/pages/sales/invoices";
import SalesRecurring from "@/pages/sales/recurring";
import SalesStatements from "@/pages/sales/statements";
import SalesCustomers from "@/pages/sales/customers";
import SalesProducts from "@/pages/sales/products";
import SalesOrders from "@/pages/sales/orders";

// ── Procurement legacy pages ──────────────────────────────────────────────────
import PurchaseBills from "@/pages/purchases/bills";
import PaymentQueuePage from "@/pages/purchases/payment-queue";
import PurchaseVendors from "@/pages/purchases/vendors";
import PurchaseProducts from "@/pages/purchases/products";

// ── Finance legacy pages ──────────────────────────────────────────────────────
import ChartOfAccounts from "@/pages/accounting/chart-of-accounts";
import AccountingTransactions from "@/pages/accounting/transactions";
import AccountingTransactionDetail from "@/pages/accounting/transaction-detail";
import AccountingPostingRules from "@/pages/accounting/posting-rules";
import AccountingReports from "@/pages/accounting/reports";

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      // Loading errors rarely have a page-level handler. Give users a clear
      // notification without duplicating mutation toasts managed by forms.
      if (query.state.data !== undefined) return;
      const message = getUserFacingError(
        error,
        "Refresh the page and try again.",
      );
      toast({
        title: message.title,
        description: message.description,
        variant: "destructive",
      });
    },
  }),
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

/** Route-level guard: renders children only if the user holds one of `allowedRoles`. */
function RoleGuard({
  allowedRoles,
  children,
}: {
  allowedRoles: AppRole[];
  children: React.ReactNode;
}) {
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
        <p className="text-sm text-muted-foreground">
          You do not have permission to view this page.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

function Router() {
  useAppBranding();
  const { token, user, role, isLoading } = useAuth();

  const homeContent = (() => {
    if (token && isLoading) {
      return (
        <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
          Loading workspace…
        </div>
      );
    }

    if (token && user) return <WorkspaceHome />;

    return <LandingPage />;
  })();

  const routeContent = (
    <Switch>
      <Route path="/home">
        <WorkspaceHome />
      </Route>
      <Route path="/documents/scan/:token">
        {(params) => <SharedDocument token={params.token} />}
      </Route>
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
        {(params) => <MarketingAppsPage tenantCode={params.tenantCode} />}
      </Route>
      <Route path="/landing/:tenantCode/pricing">
        {(params) => <MarketingPricingPage tenantCode={params.tenantCode} />}
      </Route>
      <Route path="/landing/:tenantCode/about">
        {(params) => <MarketingAboutPage tenantCode={params.tenantCode} />}
      </Route>
      <Route path="/landing/:tenantCode/support">
        {(params) => <MarketingSupportPage tenantCode={params.tenantCode} />}
      </Route>
      <Route path="/landing/:tenantCode/privacy">
        {(params) => <PrivacyPolicyPage tenantCode={params.tenantCode} />}
      </Route>
      <Route path="/landing/:tenantCode">
        {(params) => <LandingPage tenantCode={params.tenantCode} />}
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
      <Route path="/">{homeContent}</Route>
      <Route path="/dashboard">
        <RoleGuard
          allowedRoles={["superadmin", "tenant_admin", "finance", "operator"]}
        >
          {role === "superadmin" ? <BillingCenter /> : <Dashboard />}
        </RoleGuard>
      </Route>
      <Route path="/workflows/approvals">
        <WorkflowApprovals />
      </Route>
      <Route path="/projects/overview">
        <ProjectsWorkspace mode="overview" />
      </Route>
      <Route path="/projects/tasks">
        <ProjectsWorkspace mode="tasks" />
      </Route>
      <Route path="/projects/tasks/:id">
        {(params) => <TaskDetail id={params.id} />}
      </Route>
      <Route path="/projects/board">
        <ProjectKanban />
      </Route>
      <Route path="/projects/calendar">
        <ProjectCalendar />
      </Route>
      <Route path="/projects/reports">
        <ProjectsReports />
      </Route>
      <Route path="/projects/follow-ups">
        <ProjectFollowUps />
      </Route>
      <Route path="/projects/my-tasks">
        <ProjectsWorkspace mode="mine" />
      </Route>
      <Route path="/projects/team-tasks">
        <ProjectsWorkspace mode="team" />
      </Route>
      <Route path="/projects">
        <ProjectsWorkspace mode="projects" />
      </Route>
      <Route path="/projects/settings">
        <ProjectSettingsPage />
      </Route>
      <Route path="/projects/:id">
        {(params) => <ProjectDetail id={params.id} />}
      </Route>
      <Route path="/workspace/operations/dashboard">
        <RoleGuard
          allowedRoles={["superadmin", "tenant_admin", "finance", "operator"]}
        >
          {role === "superadmin" ? <BillingCenter /> : <Dashboard />}
        </RoleGuard>
      </Route>

      {/* Weighbridge */}
      <Route path="/weighbridge/overview">
        <WeighbridgeOverview />
      </Route>
      <Route path="/weighbridge/transactions">
        <TransactionsList />
      </Route>
      <Route path="/weighbridge/transactions/:id">
        {(params) => <TransactionDetail id={params.id} />}
      </Route>
      <Route path="/weighbridge/first-weight">
        <WeighmentEntryPage preferredFlow="first" />
      </Route>
      <Route path="/weighbridge/second-weight">
        <WeighmentEntryPage preferredFlow="second" />
      </Route>
      <Route path="/weighbridge/weighment-entry">
        <WeighmentEntryPage />
      </Route>
      <Route path="/weighbridge/weight-capture">
        <WeighmentEntryPage />
      </Route>
      <Route path="/weighbridge/customers">
        <CustomersList />
      </Route>
      <Route path="/weighbridge/vehicles">
        <VehiclesList />
      </Route>
      <Route path="/weighbridge/live">
        <LiveWeight />
      </Route>
      <Route path="/weighbridge/settings">
        <WeighbridgeSettings />
      </Route>
      <Route path="/weighbridge/overweight-log">
        <OverweightLog />
      </Route>
      <Route path="/weighbridge/discrepancies">
        <Discrepancies />
      </Route>

      {/* Sales */}
      <Route path="/sales/estimates">
        <SalesEstimates />
      </Route>
      <Route path="/sales/invoices">
        <SalesInvoices />
      </Route>
      <Route path="/sales/orders">
        <SalesOrders />
      </Route>
      <Route path="/sales/recurring">
        <SalesRecurring />
      </Route>
      <Route path="/sales/statements">
        <SalesStatements />
      </Route>
      <Route path="/sales/customers">
        <SalesCustomers />
      </Route>
      <Route path="/sales/products">
        <SalesProducts />
      </Route>

      {/* Purchases legacy paths */}
      <Route path="/procurement/bills">
        <PurchaseBills />
      </Route>
      <Route path="/procurement/payment-queue">
        <PaymentQueuePage />
      </Route>
      <Route path="/purchases/bills">
        <PurchaseBills />
      </Route>
      <Route path="/purchases/payment-queue">
        <PaymentQueuePage />
      </Route>
      <Route path="/purchases/vendors">
        <PurchaseVendors />
      </Route>
      <Route path="/purchases/products">
        <PurchaseProducts />
      </Route>

      {/* Accounting legacy paths */}
      <Route path="/accounting/dashboard">
        <AccountingDashboard />
      </Route>
      <Route path="/accounting/reports">
        <AccountingReports />
      </Route>
      <Route path="/accounting/chart-of-accounts">
        <ChartOfAccounts />
      </Route>
      <Route path="/accounting/transactions">
        <AccountingTransactions />
      </Route>
      <Route path="/accounting/transactions/:id">
        {(params) => <AccountingTransactionDetail id={params.id} />}
      </Route>
      <Route path="/accounting/posting-rules">
        <AccountingPostingRules />
      </Route>

      {/* Finance canonical paths */}
      <Route path="/finance/overview">
        <AccountingDashboard />
      </Route>
      <Route path="/finance/reports">
        <AccountingReports />
      </Route>
      <Route path="/finance/chart-of-accounts">
        <ChartOfAccounts />
      </Route>
      <Route path="/finance/transactions">
        <AccountingTransactions />
      </Route>
      <Route path="/finance/transactions/:id">
        {(params) => <AccountingTransactionDetail id={params.id} />}
      </Route>
      <Route path="/finance/posting-rules">
        <AccountingPostingRules />
      </Route>
      <Route path="/finance/receivables">
        <SalesInvoices />
      </Route>
      <Route path="/finance/payables">
        <PurchaseBills />
      </Route>
      <Route path="/finance/payment-methods">
        <PaymentMethods />
      </Route>
      <Route path="/procurement/plans">
        <PlanningWorkspace plans />
      </Route>
      <Route path="/finance/budgets">
        <PlanningWorkspace />
      </Route>

      {/* Legacy Payments & Finance routes — keep for backward compat */}
      <Route path="/payments/invoices">
        <InvoicesList />
      </Route>
      <Route path="/payments/invoices/:id">
        {(params) => <InvoiceDetail id={params.id} />}
      </Route>
      <Route path="/payments/methods">
        <PaymentMethods />
      </Route>

      {/* CRM — Relationships */}
      <Route path="/crm/dashboard">
        <CRMDashboard />
      </Route>
      <Route path="/crm/companies">
        <Companies />
      </Route>
      <Route path="/crm/people">
        <People />
      </Route>
      <Route path="/crm/suppliers">
        <Suppliers />
      </Route>
      <Route path="/crm/opportunities">
        <Opportunities />
      </Route>
      <Route path="/crm/follow-ups">
        <FollowUps />
      </Route>
      <Route path="/crm/performance">
        <SalesPerformance />
      </Route>

      {/* Ticketing */}
      <Route path="/ticketing/overview">
        <TicketingOverview />
      </Route>
      <Route path="/ticketing/queue">
        <TicketingQueue />
      </Route>
      <Route path="/ticketing/forms">
        <TicketingForms />
      </Route>
      <Route path="/ticketing/automation">
        <TicketingAutomation />
      </Route>
      <Route path="/ticketing/settings">
        <TicketingSettings />
      </Route>

      {/* Reports */}
      <Route path="/weighbridge/reports">
        <RoleGuard allowedRoles={CAN_VIEW_REPORTS_WORKSPACE}>
          <ReportsDashboard />
        </RoleGuard>
      </Route>
      <Route path="/reports/dashboard">
        <RoleGuard allowedRoles={CAN_VIEW_REPORTS_WORKSPACE}>
          <ReportsDashboard />
        </RoleGuard>
      </Route>

      {/* HR */}
      <Route path="/hr/my-payslips">
        <MyPayslips />
      </Route>
      {(["employees", "leave", "requests", "settings"] as const).map((mode) => (
        <Route key={mode} path={`/hr/${mode}`}>
          <HRWorkforce mode={mode} />
        </Route>
      ))}
      <Route path="/hr/staff">
        <HRStaff />
      </Route>

      {/* Procurement */}
      <Route path="/platform/organization-structure">
        <OrganizationUnits />
      </Route>
      <Route path="/procurement/departments">
        <Redirect to="/platform/organization-structure" />
      </Route>
      <Route path="/procurement/configuration">
        <ProcurementConfiguration />
      </Route>
      <Route path="/procurement/approval-rules">
        <ProcurementApprovalRules />
      </Route>
      <Route path="/procurement/requisitions">
        <ProcurementRequisitions />
      </Route>
      <Route path="/procurement/receipts">
        <GoodsReceiptsPage />
      </Route>
      <Route path="/procurement/purchase-orders">
        <PurchaseOrders />
      </Route>
      <Route path="/procurement/vendors">
        <PurchaseVendors />
      </Route>
      <Route path="/procurement/bills">
        <PurchaseBills />
      </Route>

      {/* Inventory */}
      <Route path="/inventory/overview">
        <InventoryOverview />
      </Route>
      <Route path="/inventory/stock">
        <InventoryStock />
      </Route>
      <Route path="/inventory/warehouses">
        <InventoryWarehouses />
      </Route>
      <Route path="/inventory/movements">
        <InventoryMovements />
      </Route>

      {/* Budgeting */}
      <Route path="/budgeting/overview">
        <BudgetingOverview />
      </Route>

      {/* Industry Packs */}
      <Route path="/manufacturing/overview">
        <ManufacturingOverview />
      </Route>
      <Route path="/retail/overview">
        <RetailOverview />
      </Route>
      <Route path="/services/overview">
        <ServicesOverview />
      </Route>

      {/* Platform Admin — superadmin-only pages */}
      <Route path="/platform/billing">
        <RoleGuard allowedRoles={["superadmin"]}>
          <BillingCenter />
        </RoleGuard>
      </Route>
      <Route path="/platform/tenants">
        <RoleGuard allowedRoles={["superadmin"]}>
          <Tenants />
        </RoleGuard>
      </Route>
      <Route path="/platform/industries">
        <RoleGuard allowedRoles={["superadmin"]}>
          <Industries />
        </RoleGuard>
      </Route>
      <Route path="/platform/modules">
        <RoleGuard allowedRoles={["superadmin"]}>
          <Modules />
        </RoleGuard>
      </Route>
      <Route path="/platform/plans">
        <RoleGuard allowedRoles={["superadmin"]}>
          <Plans />
        </RoleGuard>
      </Route>
      <Route path="/platform/subscriptions">
        <RoleGuard allowedRoles={["superadmin"]}>
          <Subscriptions />
        </RoleGuard>
      </Route>
      <Route path="/platform/licenses">
        <RoleGuard allowedRoles={["superadmin"]}>
          <Licenses />
        </RoleGuard>
      </Route>
      <Route path="/platform/integrations">
        <RoleGuard allowedRoles={["superadmin"]}>
          <Integrations />
        </RoleGuard>
      </Route>
      <Route path="/platform/backups">
        <RoleGuard allowedRoles={["superadmin", "tenant_admin"]}>
          <Backups />
        </RoleGuard>
      </Route>

      {/* Platform Admin — superadmin + tenant_admin pages */}
      <Route path="/platform/users">
        <RoleGuard allowedRoles={["superadmin", "tenant_admin"]}>
          <Users />
        </RoleGuard>
      </Route>
      <Route path="/platform/roles">
        <RoleGuard allowedRoles={["superadmin", "tenant_admin"]}>
          <Roles />
        </RoleGuard>
      </Route>
      <Route path="/platform/workspace">
        <RoleGuard allowedRoles={["superadmin"]}>
          <Workspace />
        </RoleGuard>
      </Route>
      <Route path="/platform/workflows">
        <RoleGuard allowedRoles={["superadmin", "tenant_admin"]}>
          <WorkflowCenter />
        </RoleGuard>
      </Route>
      <Route path="/platform/company-settings">
        <RoleGuard allowedRoles={["superadmin", "tenant_admin"]}>
          <OrganizationSettings />
        </RoleGuard>
      </Route>
      <Route path="/platform/organization-settings">
        <RoleGuard allowedRoles={["superadmin", "tenant_admin"]}>
          <OrganizationSettings />
        </RoleGuard>
      </Route>
      <Route path="/platform/audit">
        <RoleGuard allowedRoles={["superadmin", "tenant_admin"]}>
          <AuditLogsPage />
        </RoleGuard>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
  const [path] = useLocation();
  const publicPage =
    /^\/(?:login|landing|privacy|documents\/scan)(?:\/|$)/.test(path);
  return token && !publicPage ? (
    <Shell>
      <WorkspaceOutlet>{routeContent}</WorkspaceOutlet>
    </Shell>
  ) : (
    routeContent
  );
}

export default function App() {
  return (
    <ERPErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <WorkspaceProvider>
                <Router />
              </WorkspaceProvider>
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ERPErrorBoundary>
  );
}
