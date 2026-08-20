import { Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BadgePercent, ShoppingBag, Store, Truck, UserRound } from 'lucide-react';

const capabilities = [
  { title: 'Merchandising', text: 'Assortment, promotion, and loyalty rules should sit above the shared item and pricing masters.', icon: <BadgePercent className="h-4 w-4 text-rose-600" /> },
  { title: 'Store Operations', text: 'POS sessions and terminals can be a standalone SaaS pack while still posting sales, stock, and cash events to the core.', icon: <Store className="h-4 w-4 text-indigo-600" /> },
  { title: 'Omnichannel Orders', text: 'Commerce orders should feed into the same order, fulfillment, and inventory backbone as direct ERP sales.', icon: <ShoppingBag className="h-4 w-4 text-emerald-600" /> },
  { title: 'Customer Loyalty', text: 'Retail-specific customer insights should enrich the shared party master rather than create another isolated customer silo.', icon: <UserRound className="h-4 w-4 text-amber-600" /> },
];

export default function RetailOverview() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Retail & Commerce Pack</h1>
          <p className="mt-1 text-sm text-muted-foreground">Standalone commerce operations with shared ERP fulfillment, finance, and customer masters.</p>
        </div>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="bg-muted/20 border-b py-3">
          <CardTitle className="text-sm font-bold uppercase tracking-widest">Standalone Pack Pattern</CardTitle>
        </CardHeader>
        <CardContent className="p-5 text-sm text-muted-foreground">
          Retail can operate as its own SaaS front door, but stock, billing, customers, and cash controls should still reconcile into the core platform.
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {capabilities.map((item) => (
          <Card key={item.title} className="shadow-sm">
            <CardContent className="p-5">
              <div className="mb-3 inline-flex rounded-full bg-muted p-2">{item.icon}</div>
              <p className="font-semibold">{item.title}</p>
              <p className="mt-2 text-sm text-muted-foreground">{item.text}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Link href="/sales/orders" className="rounded-xl border p-4 transition-colors hover:bg-muted/30">
          <div className="flex items-center gap-2 font-semibold"><ShoppingBag className="h-4 w-4 text-sky-600" /> Shared Order Backbone</div>
          <p className="mt-2 text-sm text-muted-foreground">BOPIS, delivery, and web orders should resolve into the common order management model.</p>
        </Link>
        <Link href="/inventory/overview" className="rounded-xl border p-4 transition-colors hover:bg-muted/30">
          <div className="flex items-center gap-2 font-semibold"><Truck className="h-4 w-4 text-emerald-600" /> Stock & Fulfillment</div>
          <p className="mt-2 text-sm text-muted-foreground">Store and warehouse stock should share the same inventory ledger with pack-specific views layered on top.</p>
        </Link>
        <Link href="/finance/receivables" className="rounded-xl border p-4 transition-colors hover:bg-muted/30">
          <div className="flex items-center gap-2 font-semibold"><Store className="h-4 w-4 text-violet-600" /> Cash & Settlement</div>
          <p className="mt-2 text-sm text-muted-foreground">Registers, payment captures, and end-of-day reconciliation should land in the finance core.</p>
        </Link>
      </div>
    </div>
  );
}
