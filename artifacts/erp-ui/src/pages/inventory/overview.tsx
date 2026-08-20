import { Link } from 'wouter';
import {
  ArrowRight,
  ArrowRightLeft,
  Boxes,
  Building2,
  ClipboardList,
  PackageCheck,
  ScanSearch,
  ShoppingCart,
  Wallet,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ProcessFlow } from '@/components/workflow/process-flow';
import { formatCount, numberValue, useInventoryWorkspaceData } from '@/pages/inventory/shared';

const statusTone: Record<string, string> = {
  healthy: 'bg-emerald-100 text-emerald-700',
  watch: 'bg-amber-100 text-amber-700',
  blocked: 'bg-rose-100 text-rose-700',
};

export default function InventoryOverviewPage() {
  const { data, isLoading } = useInventoryWorkspaceData();

  const products = data?.products ?? [];
  const requisitions = data?.requisitions ?? [];
  const balances = data?.balances ?? [];
  const reservations = data?.reservations ?? [];
  const movements = data?.movements ?? [];
  const inventoryDashboard = data?.inventoryDashboard;

  const stockProducts = products.filter((product) => product.product_type === 'product');
  const activeStockProducts = stockProducts.filter((product) => product.is_active);
  const openRequisitions = requisitions.filter((req) => ['submitted', 'pending_approval', 'approved'].includes(req.status));
  const approvedRequisitions = requisitions.filter((req) => req.status === 'approved');
  const blockedRequisitions = requisitions.filter((req) => req.budget_status === 'blocked');
  const activeReservations = reservations.filter((reservation) => reservation.status === 'active');
  const receiptMovements = movements.filter((movement) => movement.movement_type === 'receipt');
  const issueMovements = movements.filter((movement) => movement.movement_type === 'issue');
  const warehousesInUse = new Set(balances.map((balance) => balance.warehouse)).size;

  const onHand = numberValue(inventoryDashboard?.totals?.on_hand);
  const reserved = numberValue(inventoryDashboard?.totals?.reserved);
  const available = numberValue(inventoryDashboard?.totals?.available);
  const valuation = numberValue(inventoryDashboard?.totals?.valuation);
  const receivedUnits = receiptMovements.reduce((sum, movement) => sum + numberValue(movement.quantity), 0);

  const controlRows = [
    {
      domain: 'Product master',
      source: '/sales/products',
      owner: 'Sales / shared item master',
      signal: `${activeStockProducts.length} active stock items`,
      status: activeStockProducts.length > 0 ? 'healthy' : 'watch',
      note: 'Inventory now uses the shared product master with stock flags instead of another item table.',
    },
    {
      domain: 'Demand planning',
      source: '/procurement/requisitions',
      owner: 'Procurement',
      signal: `${openRequisitions.length} open requisitions`,
      status: blockedRequisitions.length > 0 ? 'blocked' : openRequisitions.length > 0 ? 'healthy' : 'watch',
      note: 'Requisitions remain the upstream demand signal for replenishment and sourcing.',
    },
    {
      domain: 'Sales reservation',
      source: '/sales/orders',
      owner: 'Sales + Inventory',
      signal: `${activeReservations.length} active reservations`,
      status: reserved > onHand && onHand > 0 ? 'blocked' : activeReservations.length > 0 ? 'healthy' : 'watch',
      note: 'Confirmed orders now create real inventory reservations before dispatch and invoicing.',
    },
    {
      domain: 'Warehouse execution',
      source: '/inventory/warehouses',
      owner: 'Inventory operations',
      signal: `${warehousesInUse || inventoryDashboard?.counts?.warehouses || 0} warehouses with stock activity`,
      status: (warehousesInUse || inventoryDashboard?.counts?.warehouses || 0) > 0 ? 'healthy' : 'watch',
      note: 'Receipts, balances, and issues now live in warehouse-owned stock records.',
    },
  ];

  const ledgerMilestones = [
    {
      title: 'Material Request / Requisition',
      value: formatCount(openRequisitions.length),
      helper: 'Procurement demand awaiting sourcing, approval, or receipt.',
      href: '/procurement/requisitions',
    },
    {
      title: 'Receipt To Warehouse',
      value: formatCount(receivedUnits),
      helper: 'Units already posted into stock through goods receipt movements.',
      href: '/procurement/receipts',
    },
    {
      title: 'Reservation Demand',
      value: formatCount(activeReservations.length),
      helper: 'Active reservations currently protecting available stock for customer orders.',
      href: '/sales/orders',
    },
    {
      title: 'Inventory Valuation',
      value: `KES ${formatCount(valuation)}`,
      helper: 'Current stock value derived from warehouse balances and movement cost data.',
      href: '/inventory/movements',
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Inventory Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            See stock on hand, reservations, warehouse activity, and the work needed to fulfill customer orders.
          </p>
        </div>
        <div className="rounded-xl border bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Stock now moves through real warehouse transactions instead of manual quantity edits.
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Active Stock SKUs', value: activeStockProducts.length, icon: <Boxes className="h-5 w-5 text-sky-600" /> },
          { label: 'On Hand Units', value: formatCount(onHand), icon: <ShoppingCart className="h-5 w-5 text-indigo-600" /> },
          { label: 'Available Units', value: formatCount(available), icon: <ClipboardList className="h-5 w-5 text-orange-600" /> },
          { label: 'Reserved Units', value: formatCount(reserved), icon: <PackageCheck className="h-5 w-5 text-emerald-600" /> },
        ].map((item) => (
          <Card key={item.label}>
            <CardContent className="flex items-start justify-between pt-5">
              <div>
                <p className="text-3xl font-black">{isLoading ? '…' : item.value}</p>
                <p className="mt-1 text-sm text-muted-foreground">{item.label}</p>
              </div>
              <div className="rounded-full bg-muted p-3">{item.icon}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <ProcessFlow
        title="Stock Flow"
        description="Move stock from requisition to receipt, reservation, dispatch, and valuation in one clear flow."
        stages={[
          { label: 'Product Master', active: activeStockProducts.length > 0 },
          { label: 'Requisition', active: openRequisitions.length > 0 },
          { label: 'Receipt', active: receiptMovements.length > 0 },
          { label: 'Reservation', active: activeReservations.length > 0, current: activeReservations.length > 0 },
          { label: 'Dispatch', active: issueMovements.length > 0 },
          { label: 'Valuation', active: valuation > 0 },
        ]}
        actions={[
          {
            label: 'View Stock',
            href: '/inventory/stock',
            icon: <Boxes className="h-4 w-4 text-sky-600" />,
            helper: 'Check stock levels, reservations, and item availability.',
            tone: 'default',
          },
          {
            label: 'View Warehouses',
            href: '/inventory/warehouses',
            icon: <Building2 className="h-4 w-4 text-violet-600" />,
            helper: 'See which warehouses are receiving, holding, and dispatching stock.',
            tone: 'warning',
          },
          {
            label: 'View Movements',
            href: '/inventory/movements',
            icon: <ArrowRightLeft className="h-4 w-4 text-emerald-600" />,
            helper: 'Review receipts, reservations, issues, and stock adjustments.',
            tone: 'success',
          },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between border-b bg-muted/20 py-3">
            <CardTitle className="text-sm font-bold uppercase tracking-widest">Inventory Checks</CardTitle>
            <Link href="/inventory/movements" className="text-xs text-primary hover:underline">
              View movement records
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Domain</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Signal</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {controlRows.map((row) => (
                  <TableRow key={row.domain}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{row.domain}</p>
                        <p className="text-xs text-muted-foreground">{row.owner}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Link href={row.source} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                        Open page <ArrowRight className="h-3 w-3" />
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{row.signal}</p>
                        <p className="text-xs text-muted-foreground">{row.note}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold capitalize ${statusTone[row.status]}`}>
                        {row.status}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b bg-muted/20 py-3">
            <CardTitle className="text-sm font-bold uppercase tracking-widest">Priority Work</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-5">
            {ledgerMilestones.map((item) => (
              <Link key={item.title} href={item.href} className="block rounded-xl border p-4 transition-colors hover:bg-muted/30">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold">{item.title}</p>
                    <p className="mt-1 text-2xl font-black">{isLoading ? '…' : item.value}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{item.helper}</p>
                  </div>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {[
          {
            icon: <ScanSearch className="h-4 w-4 text-sky-600" />,
            title: 'Stock checks',
            text: `Inventory now tracks ${formatCount(data?.inventoryDashboard?.counts?.movements ?? 0)} movement records, giving counts and adjustments a clear transaction trail.`,
          },
          {
            icon: <ArrowRightLeft className="h-4 w-4 text-orange-600" />,
            title: 'Reserved stock',
            text: `Sales orders are currently holding ${formatCount(reserved)} reserved units before dispatch so orders do not move ahead of available stock.`,
          },
          {
            icon: <Wallet className="h-4 w-4 text-emerald-600" />,
            title: 'Stock value',
            text: `Tracked inventory valuation is KES ${formatCount(valuation)} and now has a warehouse-level stock basis for finance posting.`,
          },
        ].map((item) => (
          <Card key={item.title}>
            <CardContent className="pt-5">
              <div className="flex items-center gap-2 font-semibold">
                {item.icon}
                {item.title}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{item.text}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
