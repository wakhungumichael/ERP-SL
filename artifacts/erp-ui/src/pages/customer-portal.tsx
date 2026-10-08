import { useQuery } from '@tanstack/react-query';
import { LogOut, ReceiptText, Scale, WalletCards } from 'lucide-react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/context/use-auth';

export default function CustomerPortalPage() {
  const { token, user, clearToken } = useAuth();
  const [, setLocation] = useLocation();
  const query = useQuery({
    queryKey: ['customer-portal', token], enabled: !!token,
    queryFn: async () => {
      const response = await fetch('/api/commercial-weighbridge/customer-portal/summary/', { headers: { Authorization: `Token ${token}` } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || 'Could not load your customer records.');
      return body;
    },
  });
  const records = query.data?.transactions ?? [];
  const statement = query.data?.statement ?? [];
  const paid = records.filter((record: any) => record.payment_status === 'Paid').length;
  const outstanding = records.filter((record: any) => record.payment_status === 'Pending').reduce((sum: number, record: any) => sum + Number(record.charge || 0), 0);
  return <main className="min-h-screen bg-stone-50 p-5 sm:p-8"><div className="mx-auto max-w-6xl space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-200 pb-5"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-primary">Customer Portal</p><h1 className="mt-1 text-3xl font-black">Welcome, {query.data?.customer?.name || (user as any)?.first_name || 'Customer'}</h1><p className="mt-1 text-sm text-muted-foreground">Your weighbridge records, receipts, and account activity.</p></div><Button variant="outline" onClick={() => { clearToken(); setLocation('/login'); }}><LogOut className="mr-2 h-4 w-4" />Sign out</Button></header>
    <section className="grid gap-4 md:grid-cols-3"><Metric icon={<Scale />} label="Weighbridge records" value={records.length} /><Metric icon={<ReceiptText />} label="Paid records" value={paid} /><Metric icon={<WalletCards />} label="Outstanding balance" value={`KES ${outstanding.toLocaleString('en-KE', { minimumFractionDigits: 2 })}`} /></section>
    <Card><CardHeader><CardTitle>Customer Statement</CardTitle></CardHeader><CardContent>{statement.length ? <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="pb-3">Invoice</th><th className="pb-3">Issued</th><th className="pb-3">Due</th><th className="pb-3">Status</th><th className="pb-3 text-right">Amount</th></tr></thead><tbody>{statement.map((invoice: any) => <tr key={invoice.number} className="border-b last:border-0"><td className="py-3 font-mono font-semibold">{invoice.number}</td><td>{invoice.date ? new Date(invoice.date).toLocaleDateString('en-KE') : '—'}</td><td>{invoice.due_date || '—'}</td><td className="capitalize">{invoice.status}</td><td className="text-right font-mono">{invoice.currency || 'KES'} {Number(invoice.amount || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">No invoices are available on your statement.</p>}</CardContent></Card>
    <Card><CardHeader><CardTitle>Your Recent Weighbridge Records</CardTitle></CardHeader><CardContent>{query.isLoading ? <p className="text-sm text-muted-foreground">Loading your records...</p> : query.isError ? <p className="text-sm text-destructive">{(query.error as Error).message}</p> : records.length ? <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm"><thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="pb-3">Ticket</th><th className="pb-3">Vehicle</th><th className="pb-3">Commodity</th><th className="pb-3 text-right">Net weight</th><th className="pb-3">Status</th><th className="pb-3">Date</th></tr></thead><tbody>{records.map((record: any) => <tr key={record.id} className="border-b last:border-0"><td className="py-3 font-mono font-semibold">TX-{String(record.id).padStart(5, '0')}</td><td>{record.vehicle_plate || '—'}</td><td>{record.item_name || '—'}</td><td className="text-right font-mono">{Number(record.net_weight || 0).toLocaleString()} kg</td><td>{record.payment_status || record.status}</td><td>{record.created_at ? new Date(record.created_at).toLocaleDateString('en-KE') : '—'}</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">No weighbridge records are available yet.</p>}</CardContent></Card>
  </div></main>;
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) { return <Card><CardContent className="p-5"><div className="flex items-center gap-3 text-primary">{icon}<span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</span></div><div className="mt-3 text-2xl font-black">{value}</div></CardContent></Card>; }
