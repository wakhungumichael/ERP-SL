import { Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Cog, Factory, GitBranch, Package2, ShieldCheck, TrendingUp } from 'lucide-react';

const pillars = [
  { title: 'Engineering Data', text: 'BOMs, routings, and ECOs should stay structured but consume shared products, units, and costing masters.', icon: <GitBranch className="h-4 w-4 text-indigo-600" /> },
  { title: 'Planning Layer', text: 'MRP, MPS, and capacity planning should sit on top of demand from Sales and availability from Inventory.', icon: <TrendingUp className="h-4 w-4 text-emerald-600" /> },
  { title: 'Shop Floor', text: 'Work orders, labor logging, and machine events should execute operationally while posting costs back into Finance.', icon: <Factory className="h-4 w-4 text-amber-600" /> },
  { title: 'Quality', text: 'Inspections and CAPA should be woven into receiving, production, and dispatch instead of living outside the flow.', icon: <ShieldCheck className="h-4 w-4 text-sky-600" /> },
];

export default function ManufacturingOverview() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Manufacturing Pack</h1>
          <p className="mt-1 text-sm text-muted-foreground">Standalone SaaS vertical on top of shared ERP masters and transactions.</p>
        </div>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="bg-muted/20 border-b py-3">
          <CardTitle className="text-sm font-bold uppercase tracking-widest">Pack Design Rule</CardTitle>
        </CardHeader>
        <CardContent className="p-5 text-sm text-muted-foreground">
          Manufacturing should own production-specific workflows while reusing shared party, product, inventory, procurement, and finance data.
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {pillars.map((item) => (
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
        <Link href="/inventory/overview" className="rounded-xl border p-4 transition-colors hover:bg-muted/30">
          <div className="flex items-center gap-2 font-semibold"><Package2 className="h-4 w-4 text-emerald-600" /> Shared Inventory Core</div>
          <p className="mt-2 text-sm text-muted-foreground">Material receipts, reservations, and stock valuation should come from the common inventory engine.</p>
        </Link>
        <Link href="/procurement/requisitions" className="rounded-xl border p-4 transition-colors hover:bg-muted/30">
          <div className="flex items-center gap-2 font-semibold"><Cog className="h-4 w-4 text-violet-600" /> Procurement Dependencies</div>
          <p className="mt-2 text-sm text-muted-foreground">Manufacturing demand should flow into requisitions, purchase orders, and supplier receipts instead of bypassing source-to-pay.</p>
        </Link>
        <Link href="/finance/overview" className="rounded-xl border p-4 transition-colors hover:bg-muted/30">
          <div className="flex items-center gap-2 font-semibold"><TrendingUp className="h-4 w-4 text-sky-600" /> Costing & Finance</div>
          <p className="mt-2 text-sm text-muted-foreground">Production usage and variances should settle back into the shared finance layer for costing and profitability.</p>
        </Link>
      </div>
    </div>
  );
}
