import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import {
  ArrowRight,
  ArrowRightLeft,
  PackageMinus,
  PackagePlus,
  ScanSearch,
  Search,
  Wallet,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ProcessFlow } from '@/components/workflow/process-flow';
import { formatCount, formatCurrency, numberValue, useInventoryWorkspaceData } from '@/pages/inventory/shared';

type MovementType = 'receipt' | 'reservation' | 'issue' | 'adjustment' | 'release';

const movementTone: Record<MovementType, string> = {
  receipt: 'bg-emerald-100 text-emerald-700',
  reservation: 'bg-sky-100 text-sky-700',
  issue: 'bg-violet-100 text-violet-700',
  adjustment: 'bg-amber-100 text-amber-700',
  release: 'bg-slate-100 text-slate-700',
};

export default function InventoryMovementsPage() {
  const { data, isLoading } = useInventoryWorkspaceData();
  const [search, setSearch] = useState('');
  const [movementFilter, setMovementFilter] = useState<'all' | MovementType>('all');

  const movements = data?.movements ?? [];
  const requisitions = data?.requisitions ?? [];

  const rows = useMemo(() => {
    return movements.map((movement) => ({
      id: movement.id,
      date: movement.movement_date,
      type: movement.movement_type as MovementType,
      document: movement.reference_number || `${movement.reference_type}-${movement.reference_id ?? movement.id}`,
      source:
        movement.reference_type === 'goods_receipt'
          ? `Goods receipt into ${movement.warehouse_name || 'warehouse'}`
          : movement.reference_type === 'sales_order'
            ? `Sales order movement for ${movement.product_name || 'stock item'}`
            : `Manual ${movement.movement_type} event`,
      warehouse: movement.warehouse_name || 'Warehouse',
      product: movement.product_name || movement.product_code || `Product #${movement.product}`,
      quantity: numberValue(movement.quantity),
      status:
        movement.movement_type === 'reservation'
          ? 'active'
          : movement.movement_type === 'release'
            ? 'released'
            : 'posted',
      value: numberValue(movement.total_cost),
      nextStep:
        movement.reference_type === 'goods_receipt'
          ? { href: '/procurement/receipts', label: 'Review GRN' }
          : movement.reference_type === 'sales_order'
            ? { href: '/sales/orders', label: movement.movement_type === 'issue' ? 'Review fulfillment' : 'Review order' }
            : { href: '/inventory/overview', label: 'Open inventory workspace' },
      note:
        movement.movement_type === 'receipt'
          ? 'Stock increased through an accepted goods receipt.'
          : movement.movement_type === 'reservation'
            ? 'Availability was protected for a confirmed sales order.'
            : movement.movement_type === 'issue'
              ? 'Stock left the warehouse through fulfillment.'
              : movement.movement_type === 'release'
                ? 'Previously held stock was released back to availability.'
                : 'Controlled stock correction or manual balancing event.',
    }));
  }, [movements]);

  const filteredMovements = rows.filter((movement) => {
    const query = search.trim().toLowerCase();
    const matchesSearch =
      !query ||
      movement.document.toLowerCase().includes(query) ||
      movement.source.toLowerCase().includes(query) ||
      movement.warehouse.toLowerCase().includes(query) ||
      movement.product.toLowerCase().includes(query);

    const matchesType = movementFilter === 'all' || movement.type === movementFilter;
    return matchesSearch && matchesType;
  });

  const counts = {
    receipts: rows.filter((movement) => movement.type === 'receipt').length,
    reservations: rows.filter((movement) => movement.type === 'reservation').length,
    issues: rows.filter((movement) => movement.type === 'issue').length,
    adjustments: rows.filter((movement) => movement.type === 'adjustment').length,
    releases: rows.filter((movement) => movement.type === 'release').length,
  };

  return (
    <div className="space-y-6 p-6">
      <div className="border-b pb-4">
        <h1 className="text-3xl font-bold tracking-tight">Stock Movements</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review stock receipts, reservations, issues, releases, and adjustments from one movement history page.
        </p>
      </div>

      <ProcessFlow
        title="Movement Flow"
        description="Each stock change is recorded as a receipt, reservation, release, issue, or adjustment."
        stages={[
          { label: 'Demand', active: requisitions.length > 0 },
          { label: 'Receipt', active: counts.receipts > 0 },
          { label: 'Reservation', active: counts.reservations > 0, current: counts.reservations > 0 },
          { label: 'Release / Issue', active: counts.releases > 0 || counts.issues > 0 },
          { label: 'Reconcile', active: counts.adjustments > 0 },
          { label: 'Post Value', active: rows.some((movement) => movement.value > 0) },
        ]}
        actions={[
          {
            label: 'Receipts',
            href: '/procurement/receipts',
            icon: <PackagePlus className="h-4 w-4 text-emerald-600" />,
            helper: 'Goods receipts are the main source of stock increases.',
            tone: 'success',
          },
          {
            label: 'Orders',
            href: '/sales/orders',
            icon: <ArrowRightLeft className="h-4 w-4 text-sky-600" />,
            helper: 'Confirmed orders create reservations and fulfilled orders create issues.',
            tone: 'default',
          },
          {
            label: 'Warehouses',
            href: '/inventory/warehouses',
            icon: <PackageMinus className="h-4 w-4 text-violet-600" />,
            helper: 'Movement meaning depends on clear warehouse ownership and stock control.',
            tone: 'warning',
          },
        ]}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: 'Receipt Events', value: counts.receipts, icon: <PackagePlus className="h-5 w-5 text-emerald-600" /> },
          { label: 'Reservation Events', value: counts.reservations, icon: <ArrowRightLeft className="h-5 w-5 text-sky-600" /> },
          { label: 'Issue Events', value: counts.issues, icon: <PackageMinus className="h-5 w-5 text-violet-600" /> },
          { label: 'Release Events', value: counts.releases, icon: <ArrowRight className="h-5 w-5 text-slate-600" /> },
          { label: 'Adjustment Events', value: counts.adjustments, icon: <ScanSearch className="h-5 w-5 text-amber-600" /> },
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

      <Card>
        <CardHeader className="flex-col gap-3 border-b bg-muted/20 py-3 xl:flex-row xl:items-center xl:justify-between">
          <CardTitle className="text-sm font-bold uppercase tracking-widest">Movement History</CardTitle>
          <div className="flex flex-1 flex-col gap-3 xl:flex-row xl:justify-end">
            <div className="relative w-full xl:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search document, product, or warehouse"
                className="pl-9"
              />
            </div>
            <Select value={movementFilter} onValueChange={(value) => setMovementFilter(value as 'all' | MovementType)}>
              <SelectTrigger className="w-full xl:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All movements</SelectItem>
                <SelectItem value="receipt">Receipt</SelectItem>
                <SelectItem value="reservation">Reservation</SelectItem>
                <SelectItem value="release">Release</SelectItem>
                <SelectItem value="issue">Issue</SelectItem>
                <SelectItem value="adjustment">Adjustment</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Loading movement register…</div>
          ) : filteredMovements.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No movement records match the current filters.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Document</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Next Step</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMovements.map((movement) => (
                  <TableRow key={movement.id}>
                    <TableCell>{movement.date}</TableCell>
                    <TableCell>
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold capitalize ${movementTone[movement.type]}`}>
                        {movement.type}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{movement.document}</p>
                        <p className="text-xs text-muted-foreground">{movement.source}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{movement.product}</p>
                        <p className="text-xs text-muted-foreground">{movement.note}</p>
                      </div>
                    </TableCell>
                    <TableCell>{movement.warehouse}</TableCell>
                    <TableCell>{formatCount(movement.quantity)}</TableCell>
                    <TableCell>{formatCurrency(movement.value)}</TableCell>
                    <TableCell>
                      <Link href={movement.nextStep.href} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                        {movement.nextStep.label} <ArrowRight className="h-3 w-3" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b bg-muted/20 py-3">
          <CardTitle className="text-sm font-bold uppercase tracking-widest">Value Tracking</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start gap-3 rounded-xl border p-4">
            <Wallet className="mt-0.5 h-5 w-5 text-emerald-600" />
            <div>
              <p className="font-semibold">Each movement now carries a stock value</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Receipts raise stock value, issues reduce it, and the ledger now provides a clear base for finance posting and reconciliation.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
