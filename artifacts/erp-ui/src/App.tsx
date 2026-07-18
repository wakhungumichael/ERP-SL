import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Shell } from '@/components/shell';
import { AuthProvider } from '@/context/auth-context';

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
import Integrations from '@/pages/platform/integrations';
import Workspace from '@/pages/platform/workspace';
import WeighbridgeSettings from '@/pages/weighbridge/settings';
import ReportsDashboard from '@/pages/reports/dashboard';
import HRStaff from '@/pages/hr/staff';
import PurchaseOrders from '@/pages/procurement/purchase-orders';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

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

      {/* Payments & Finance */}
      <Route path="/payments/invoices">
        <Shell><InvoicesList /></Shell>
      </Route>
      <Route path="/payments/invoices/:id">
        {params => <Shell><InvoiceDetail id={params.id} /></Shell>}
      </Route>
      <Route path="/payments/methods">
        <Shell><PaymentMethods /></Shell>
      </Route>

      {/* Accounting */}
      <Route path="/accounting/dashboard">
        <Shell><AccountingDashboard /></Shell>
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

      {/* Platform Admin */}
      <Route path="/platform/tenants"><Shell><Tenants /></Shell></Route>
      <Route path="/platform/users"><Shell><Users /></Shell></Route>
      <Route path="/platform/roles"><Shell><Roles /></Shell></Route>
      <Route path="/platform/modules"><Shell><Modules /></Shell></Route>
      <Route path="/platform/plans"><Shell><Plans /></Shell></Route>
      <Route path="/platform/subscriptions"><Shell><Subscriptions /></Shell></Route>
      <Route path="/platform/integrations"><Shell><Integrations /></Shell></Route>
      <Route path="/platform/workspace"><Shell><Workspace /></Shell></Route>

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
