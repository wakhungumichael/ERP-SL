import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { ArrowRight, Boxes, PackageCheck, Search, ShoppingCart, Truck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency, formatCount, numberValue, useInventoryWorkspaceData } from '@/pages/inventory/shared';

type InventoryRole = 'stock item' | 'service item';
type Readiness = 'ready' | 'watch' | 'service-only';

const readinessTone: Record<Readiness, string> = {
  ready: 'bg-emerald-100 text-emerald-700',
  watch: 'bg-amber-100 text-amber-700',
  'service-only': 'bg-slate-100 text-slate-700',
};

export default function InventoryStockPage() {
  const { data, isLoading } = useInventoryWorkspaceData();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | InventoryRole>('all');
  const [readinessFilter, setReadinessFilter] = useState<'all' | Readiness>('all');

  const products = data?.products ?? [];
  const balances = data?.balances ?? [];
  const reservations = data?.reservations ?? [];
  const movements = data?.movements ?? [];
  const requisitions = data?.requisitions ?? [];

  const rows = useMemo(() => {
    return products.map((product) => {
      const role: InventoryRole = product.is_stock_item || product.product_type === 'product' ? 'stock item' : 'service item';
      const productBalances = balances.filter((balance) => balance.product === product.id);
      const productReservations = reservations.filter((reservation) => reservation.product === product.id && reservation.status === 'active');
      const productMovements = movements.filter((movement) => movement.product === product.id);
      const requisitionCount = requisitions.filter((req) =>
        (req.lines ?? []).some((line) => Number((line as { product?: number | string }).product) === product.id || (line.description ?? '').toLowerCase().includes(product.name.toLowerCase())),
      ).length;

      const onHand = productBalances.reduce((sum, balance) => sum + numberValue(balance.on_hand_qty), 0);
      const reserved = productBalances.reduce((sum, balance) => sum + numberValue(balance.reserved_qty), 0);
      const available = productBalances.reduce((sum, balance) => sum + numberValue(balance.available_qty), 0);
      const valuation = productBalances.reduce((sum, balance) => sum + numberValue(balance.valuation_amount), 0);
      const warehouses = productBalances.map((balance) => balance.warehouse_name).filter(Boolean);
      const receiptCount = productMovements.filter((movement) => movement.movement_type === 'receipt').length;
      const issueCount = productMovements.filter((movement) => movement.movement_type === 'issue').length;

      let readiness: Readiness = 'service-only';
      if (role === 'stock item') {
        readiness = onHand > 0 || receiptCount > 0 ? 'ready' : 'watch';
      }

      const nextStep =
        role === 'service item'
          ? { href: '/sales/products', label: 'Keep in shared catalog' }
          : onHand === 0
            ? { href: '/procurement/requisitions', label: 'Trigger replenishment' }
            : reserved > available
              ? { href: '/sales/orders', label: 'Review reservation pressure' }
              : { href: '/inventory/movements', label: 'Track stock movement' };

      return {
        id: product.id,
        product,
        role,
        readiness,
        onHand,
        reserved,
        available,
        valuation,
        requisitionCount,
        reservationCount: productReservations.length,
        receiptCount,
        issueCount,
        warehouses: warehouses.length > 0 ? warehouses.join(', ') : role === 'service item' ? 'Non-stock / service' : 'Not yet stocked',
        nextStep,
      };
    });
  }, [balances, movements, products, requisitions, reservations]);

  const filteredRows = rows.filter((row) => {
    const query = search.trim().toLowerCase();
    const matchesSearch =
      !query ||
      row.product.name.toLowerCase().includes(query) ||
      (row.product.code ?? '').toLowerCase().includes(query) ||
      row.warehouses.toLowerCase().includes(query);

    const matchesRole = roleFilter === 'all' || row.role === roleFilter;
    const matchesReadiness = readinessFilter === 'all' || row.readiness === readinessFilter;
    return matchesSearch && matchesRole && matchesReadiness;
  });

  const totals = {
    all: rows.length,
    stock: rows.filter((row) => row.role === 'stock item').length,
    ready: rows.filter((row) => row.readiness === 'ready').length,
    watch: rows.filter((row) => row.readiness === 'watch').length,
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Stock Items</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review stock items using live balances, reservations, warehouses, and item value.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/sales/products">View Product Catalog</Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Catalog Items', value: totals.all, icon: <Boxes className="h-5 w-5 text-sky-600" /> },
          { label: 'Stock Candidates', value: totals.stock, icon: <PackageCheck className="h-5 w-5 text-emerald-600" /> },
          { label: 'Ready For Inventory', value: totals.ready, icon: <Truck className="h-5 w-5 text-indigo-600" /> },
          { label: 'Need Setup', value: totals.watch, icon: <ShoppingCart className="h-5 w-5 text-orange-600" /> },
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
          <CardTitle className="text-sm font-bold uppercase tracking-widest">Stock Readiness</CardTitle>
          <div className="flex flex-1 flex-col gap-3 xl:flex-row xl:justify-end">
            <div className="relative w-full xl:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search item, code, or warehouse"
                className="pl-9"
              />
            </div>
            <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value as 'all' | InventoryRole)}>
              <SelectTrigger className="w-full xl:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                <SelectItem value="stock item">Stock item</SelectItem>
                <SelectItem value="service item">Service item</SelectItem>
              </SelectContent>
            </Select>
            <Select value={readinessFilter} onValueChange={(value) => setReadinessFilter(value as 'all' | Readiness)}>
              <SelectTrigger className="w-full xl:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All states</SelectItem>
                <SelectItem value="ready">Ready</SelectItem>
                <SelectItem value="watch">Watch</SelectItem>
                <SelectItem value="service-only">Service only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Loading inventory balances…</div>
          ) : filteredRows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-12 text-center text-sm text-muted-foreground">
              <Boxes className="h-8 w-8 opacity-50" />
              <p>No items match the current filters.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Role</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Stock Position</TableHead>
                  <TableHead>Activity</TableHead>
                  <TableHead>Item Value</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Next Step</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{row.product.name}</p>
                        <p className="text-xs text-muted-foreground">{row.product.code || `Product #${row.id}`}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={row.role === 'stock item' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'}>
                        {row.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{row.warehouses}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.role === 'stock item' ? 'Live warehouse stock view' : 'Service or non-stock item'}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">On hand {formatCount(row.onHand)}</p>
                        <p className="text-xs text-muted-foreground">Reserved {formatCount(row.reserved)} · Available {formatCount(row.available)}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{row.receiptCount} receipts · {row.issueCount} issues</p>
                        <p className="text-xs text-muted-foreground">{row.requisitionCount} requisitions · {row.reservationCount} active reservations</p>
                      </div>
                    </TableCell>
                    <TableCell>{formatCurrency(row.valuation)}</TableCell>
                    <TableCell>
                      <Badge className={readinessTone[row.readiness]}>{row.readiness}</Badge>
                    </TableCell>
                    <TableCell>
                      <Link href={row.nextStep.href} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                        {row.nextStep.label} <ArrowRight className="h-3 w-3" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {[
          {
            title: 'Shared item records',
            text: 'The same product catalog now drives real inventory balances, not just item labels.',
          },
          {
            title: 'Warehouse control',
            text: 'Only stock items move through warehouse balances, reservations, receipts, and issues. Services stay commercial without stock impact.',
          },
          {
            title: 'Live stock position',
            text: `This screen now reflects actual on-hand, reserved, available, and valuation figures from the inventory ledger.`,
          },
        ].map((card) => (
          <Card key={card.title}>
            <CardContent className="pt-5">
              <p className="font-semibold">{card.title}</p>
              <p className="mt-2 text-sm text-muted-foreground">{card.text}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
