import { useMemo } from 'react';
import { Link } from 'wouter';
import { ArrowRightLeft, Building2, MapPinned, ShieldCheck, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ProcessFlow } from '@/components/workflow/process-flow';
import { formatCount, formatCurrency, numberValue, useInventoryWorkspaceData } from '@/pages/inventory/shared';

export default function InventoryWarehousesPage() {
  const { data, isLoading } = useInventoryWorkspaceData();

  const warehouses = data?.warehouses ?? [];
  const balances = data?.balances ?? [];
  const reservations = data?.reservations ?? [];
  const movements = data?.movements ?? [];

  const warehouseRows = useMemo(() => {
    return warehouses.map((warehouse) => {
      const warehouseBalances = balances.filter((balance) => balance.warehouse === warehouse.id);
      const warehouseReservations = reservations.filter((reservation) => reservation.warehouse === warehouse.id && reservation.status === 'active');
      const warehouseMovements = movements.filter((movement) => movement.warehouse === warehouse.id);

      const inbound = warehouseMovements.filter((movement) => movement.movement_type === 'receipt').length;
      const outbound = warehouseMovements.filter((movement) => movement.movement_type === 'issue').length;
      const releases = warehouseMovements.filter((movement) => movement.movement_type === 'release').length;
      const reservationsCount = warehouseReservations.length;
      const onHand = warehouseBalances.reduce((sum, balance) => sum + numberValue(balance.on_hand_qty), 0);
      const available = warehouseBalances.reduce((sum, balance) => sum + numberValue(balance.available_qty), 0);
      const valuation = warehouseBalances.reduce((sum, balance) => sum + numberValue(balance.valuation_amount), 0);

      return {
        id: warehouse.id,
        name: warehouse.name,
        code: warehouse.code,
        branch: warehouse.branch_name || 'Shared / cross-branch',
        type: warehouse.warehouse_type,
        status: warehouse.status,
        inbound,
        outbound,
        releases,
        reservations: reservationsCount,
        onHand,
        available,
        valuation,
        role:
          warehouse.warehouse_type === 'main'
            ? 'Primary receipting and central stock holding.'
            : warehouse.warehouse_type === 'transit'
              ? 'Short-lived staging for in-transit goods or branch handoff.'
              : warehouse.warehouse_type === 'branch'
                ? 'Operational issue point supporting customer fulfillment.'
                : warehouse.warehouse_type === 'returns'
                  ? 'Returns or quality-hold stock awaiting review.'
                  : 'Controlled or restricted inventory zone.',
      };
    });
  }, [balances, movements, reservations, warehouses]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Warehouses</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review warehouse stock, movements, reservations, and operating roles from one page.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/inventory/movements">View stock movements</Link>
        </Button>
      </div>

      <ProcessFlow
        title="Warehouse Flow"
        description="Warehouses receive stock, hold balances, support reservations, and release stock for dispatch."
        stages={[
          { label: 'Receive', active: movements.some((movement) => movement.movement_type === 'receipt') },
          { label: 'Store', active: warehouses.length > 0, current: warehouses.length > 0 },
          { label: 'Reserve', active: reservations.some((reservation) => reservation.status === 'active') },
          { label: 'Dispatch', active: movements.some((movement) => movement.movement_type === 'issue') },
          { label: 'Count' },
          { label: 'Reconcile' },
        ]}
        actions={[
          {
            label: 'Receipts',
            href: '/procurement/receipts',
            icon: <Truck className="h-4 w-4 text-emerald-600" />,
            helper: 'Accepted supplier receipts now land in branch or default warehouses.',
            tone: 'success',
          },
          {
            label: 'Reservations',
            href: '/sales/orders',
            icon: <ArrowRightLeft className="h-4 w-4 text-sky-600" />,
            helper: 'Orders reserve real warehouse stock instead of abstract availability.',
            tone: 'default',
          },
          {
            label: 'Inventory Overview',
            href: '/inventory/overview',
            icon: <Building2 className="h-4 w-4 text-violet-600" />,
            helper: 'Connect warehouse activity with overall stock position.',
            tone: 'warning',
          },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { title: 'Main Warehouse', subtitle: 'Primary stock holding and receipting', icon: <Building2 className="h-5 w-5 text-sky-600" /> },
          { title: 'Transit Warehouse', subtitle: 'Inter-branch and in-transit staging', icon: <ArrowRightLeft className="h-5 w-5 text-orange-600" /> },
          { title: 'Branch Dispatch', subtitle: 'Local availability and dispatch point', icon: <MapPinned className="h-5 w-5 text-emerald-600" /> },
          { title: 'Returns & QA', subtitle: 'Restricted, inspected, and exception stock', icon: <ShieldCheck className="h-5 w-5 text-violet-600" /> },
        ].map((zone) => (
          <Card key={zone.title}>
            <CardContent className="pt-5">
              <div className="mb-3 inline-flex rounded-full bg-muted p-3">{zone.icon}</div>
              <p className="font-semibold">{zone.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{zone.subtitle}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="border-b bg-muted/20 py-3">
          <CardTitle className="text-sm font-bold uppercase tracking-widest">Warehouse List</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Loading warehouse context…</div>
          ) : warehouseRows.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No warehouses have been set up yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Stock Position</TableHead>
                  <TableHead>Movement Activity</TableHead>
                  <TableHead>Reservations</TableHead>
                  <TableHead>Valuation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {warehouseRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{row.name}</p>
                        <p className="text-xs text-muted-foreground">{row.code} · {row.role}</p>
                      </div>
                    </TableCell>
                    <TableCell className="capitalize">{row.type.replaceAll('_', ' ')}</TableCell>
                    <TableCell>{row.branch}</TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">On hand {formatCount(row.onHand)}</p>
                        <p className="text-xs text-muted-foreground">Available {formatCount(row.available)}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{formatCount(row.inbound)} receipts · {formatCount(row.outbound)} issues</p>
                        <p className="text-xs text-muted-foreground">{formatCount(row.releases)} releases or reversals</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{formatCount(row.reservations)}</p>
                        <p className="text-xs text-muted-foreground">{row.status} warehouse</p>
                      </div>
                    </TableCell>
                    <TableCell>{formatCurrency(row.valuation)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="border-b bg-muted/20 py-3">
            <CardTitle className="text-sm font-bold uppercase tracking-widest">Warehouse Rules</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-5 text-sm text-muted-foreground">
            <p>Each warehouse belongs to a tenant and can align to a branch or shared control role.</p>
            <p>Receiving, release, issue, and balance reconciliation are now the only valid ways to shift stock position.</p>
            <p>Restricted or returns zones can be modeled explicitly instead of being hidden in document notes.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b bg-muted/20 py-3">
            <CardTitle className="text-sm font-bold uppercase tracking-widest">Connected Pages</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-5 text-sm text-muted-foreground">
            <p>Procurement receipts now create stock entries in a warehouse before those quantities become available to Sales.</p>
            <p>Confirmed sales orders reserve stock from a warehouse, and fulfilled or invoiced orders consume it through issue movements.</p>
            <p>The next finance step is mapping receipt and issue valuation changes into formal accounting posting rules.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
