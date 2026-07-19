import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Shell } from '@/components/shell';
import { AuthProvider } from '@/context/auth-context';

import { useAuth } from '@/context/use-auth';
import type { AppRole } from '@/lib/roles';
import Login from '@/pages/login';
import Dashboard from '@/pages/dashboard';
import TransactionsList from '@/pages/transactions/list';
import TransactionDetail from '@/pages/transactions/detail';
import FirstWeight from '@/pages/weighbridge/first-weight';
import SecondWeight from '@/pages/weighbridge/second-weight';
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
import Tenants from '@/pages/platform/tenants';
import Users from '@/pages/platform/users';
import Roles from '@/pages/platform/roles';
import Modules from '@/pages/platform/modules';
import Plans from '@/pages/platform/plans';
import Subscriptions from '@/pages/platform/subscriptions';
import Licenses from '@/pages/platform/licenses';
import Integrations from '@/pages/platform/integrations';
import Workspace from '@/pages/platform/workspace';
import CompanySettings from '@/pages/platform/company-settings';
import WeighbridgeSettings from '@/pages/weighbridge/settings';
import OverweightLog from '@/pages/weighbridge/overweight-log';
import Discrepancies from '@/pages/weighbridge/discrepancies';
import ReportsDashboard from '@/pages/reports/dashboard';
import HRStaff from '@/pages/hr/staff';
import PurchaseOrders from '@/pages/procurement/purchase-orders';
import NotFound from '@/pages/not-found';

// ── Sales & Payments ──────────────────────────────────────────────────────────
import SalesEstimates from '@/pages/sales/estimates';
import SalesInvoices from '@/pages/sales/invoices';
import SalesRecurring from '@/pages/sales/recurring';
import SalesStatements from '@/pages/sales/statements';
import SalesCustomers from '@/pages/sales/customers';
import SalesProducts from '@/pages/sales/products';

// ── Purchases ─────────────────────────────────────────────────────────────────
import PurchaseBills from '@/pages/purchases/bills';
import PurchaseVendors from '@/pages/purchases/vendors';
import PurchaseProducts from '@/pages/purchases/products';

// ── Accounting ────────────────────────────────────────────────────────────────
import ChartOfAccounts from '@/pages/accounting/chart-of-accounts';
import AccountingTransactions from '@/pages/accounting/transactions';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

/** Route-level guard: renders children only if the user holds one of `allowedRoles`. */
function RoleGuard({ allowedRoles, children }: { allowedRoles: AppRole[]; children: React.ReactNode }) {
  const { role, isLoading } = useAuth();
  if (isLoading) return null;
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
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/">
        <Shell><Dashboard /></Shell>
      </Route>
      <Route path="/dashboard">
        <Shell><Dashboard /></Shell>
      </Route>

      {/* Weighbridge */}
      <Route path="/weighbridge/transactions">
        <Shell><TransactionsList /></Shell>
      </Route>
      <Route path="/weighbridge/transactions/:id">
        {params => <Shell><TransactionDetail id={params.id} /></Shell>}
      </Route>
      <Route path="/weighbridge/first-weight">
        <Shell><FirstWeight /></Shell>
      </Route>
      <Route path="/weighbridge/second-weight">
        <Shell><SecondWeight /></Shell>
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

      {/* Sales & Payments */}
      <Route path="/sales/estimates">
        <Shell><SalesEstimates /></Shell>
      </Route>
      <Route path="/sales/invoices">
        <Shell><SalesInvoices /></Shell>
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

      {/* Purchases */}
      <Route path="/purchases/bills">
        <Shell><PurchaseBills /></Shell>
      </Route>
      <Route path="/purchases/vendors">
        <Shell><PurchaseVendors /></Shell>
      </Route>
      <Route path="/purchases/products">
        <Shell><PurchaseProducts /></Shell>
      </Route>

      {/* Accounting */}
      <Route path="/accounting/dashboard">
        <Shell><AccountingDashboard /></Shell>
      </Route>
      <Route path="/accounting/chart-of-accounts">
        <Shell><ChartOfAccounts /></Shell>
      </Route>
      <Route path="/accounting/transactions">
        <Shell><AccountingTransactions /></Shell>
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

      {/* Reports */}
      <Route path="/reports/dashboard"><Shell><ReportsDashboard /></Shell></Route>

      {/* HR */}
      <Route path="/hr/staff"><Shell><HRStaff /></Shell></Route>

      {/* Procurement */}
      <Route path="/procurement/purchase-orders"><Shell><PurchaseOrders /></Shell></Route>

      {/* Platform Admin — superadmin-only pages */}
      <Route path="/platform/tenants">
        <Shell><RoleGuard allowedRoles={['superadmin']}><Tenants /></RoleGuard></Shell>
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

      {/* Platform Admin — superadmin + tenant_admin pages */}
      <Route path="/platform/users">
        <Shell><RoleGuard allowedRoles={['superadmin', 'tenant_admin']}><Users /></RoleGuard></Shell>
      </Route>
      <Route path="/platform/roles">
        <Shell><RoleGuard allowedRoles={['superadmin']}><Roles /></RoleGuard></Shell>
      </Route>
      <Route path="/platform/workspace">
        <Shell><RoleGuard allowedRoles={['superadmin']}><Workspace /></RoleGuard></Shell>
      </Route>
      <Route path="/platform/company-settings">
        <Shell><RoleGuard allowedRoles={['tenant_admin']}><CompanySettings /></RoleGuard></Shell>
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
