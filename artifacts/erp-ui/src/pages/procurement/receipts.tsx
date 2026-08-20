import { useState } from 'react';
import { Link } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/context/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ProcessFlow } from '@/components/workflow/process-flow';
import { ArrowRight, Boxes, ReceiptText, ShoppingCart } from 'lucide-react';

export default function GoodsReceiptsPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState('10');
  const [form, setForm] = useState({
    purchase_order: '',
    received_date: '',
    status: 'received',
    notes: '',
    line_description: '',
    ordered_quantity: '0',
    received_quantity: '0',
    accepted_quantity: '0',
    unit_price: '0',
  });

  const receiptsQuery = useQuery({
    queryKey: ['procurement-receipts'],
    enabled: !!token,
    queryFn: async () => {
      const res = await fetch('/api/procurement/receipts/', {
        headers: { Authorization: `Token ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load receipts');
      return res.json();
    },
  });

  const poQuery = useQuery({
    queryKey: ['procurement-orders-for-receipts'],
    enabled: !!token,
    queryFn: async () => {
      const res = await fetch('/api/procurement/orders/', {
        headers: { Authorization: `Token ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load orders');
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        purchase_order: Number(form.purchase_order),
        received_date: form.received_date,
        status: form.status,
        notes: form.notes,
        lines: [
          {
            description: form.line_description,
            ordered_quantity: Number(form.ordered_quantity),
            received_quantity: Number(form.received_quantity),
            accepted_quantity: Number(form.accepted_quantity),
            unit_price: Number(form.unit_price),
          },
        ],
      };
      const res = await fetch('/api/procurement/receipts/', {
        method: 'POST',
        headers: {
          Authorization: `Token ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to create GRN');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['procurement-receipts'] });
      setOpen(false);
      setForm({
        purchase_order: '',
        received_date: '',
        status: 'received',
        notes: '',
        line_description: '',
        ordered_quantity: '0',
        received_quantity: '0',
        accepted_quantity: '0',
        unit_price: '0',
      });
    },
  });

  const receipts = receiptsQuery.data?.results ?? [];
  const orders = poQuery.data?.results ?? [];
  const totalPages = Math.max(1, Math.ceil(receipts.length / Number(pageSize)));
  const visibleReceipts = receipts.slice((page - 1) * Number(pageSize), page * Number(pageSize));

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Goods received</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Record deliveries against purchase orders before supplier bills are matched and approved.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>Record delivery</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Record goods received</DialogTitle></DialogHeader>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Purchase order</Label>
                <Select value={form.purchase_order} onValueChange={(value) => setForm({ ...form, purchase_order: value })}>
                  <SelectTrigger><SelectValue placeholder="Choose a purchase order" /></SelectTrigger>
                  <SelectContent>
                    {orders.map((po: any) => (
                      <SelectItem key={po.id} value={String(po.id)}>{po.reference} · {po.supplier_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Delivery date</Label>
                <Input type="date" value={form.received_date} onChange={(e) => setForm({ ...form, received_date: e.target.value })} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="space-y-2 md:col-span-2 rounded-lg border p-4">
                <Label className="mb-3 block">Delivery line</Label>
                <div className="grid gap-3 md:grid-cols-2">
                  <Input placeholder="What was delivered?" value={form.line_description} onChange={(e) => setForm({ ...form, line_description: e.target.value })} />
                  <Input placeholder="Ordered quantity" value={form.ordered_quantity} onChange={(e) => setForm({ ...form, ordered_quantity: e.target.value })} />
                  <Input placeholder="Received quantity" value={form.received_quantity} onChange={(e) => setForm({ ...form, received_quantity: e.target.value })} />
                  <Input placeholder="Accepted quantity" value={form.accepted_quantity} onChange={(e) => setForm({ ...form, accepted_quantity: e.target.value })} />
                  <Input placeholder="Unit price" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} />
                </div>
              </div>
              <div className="md:col-span-2 flex justify-end">
                <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.purchase_order}>
                  Save delivery
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <ProcessFlow
        title="Receiving workflow"
        description="Receiving is the control point between purchasing, inventory, and accounts payable, and it should drive downstream inventory and match actions."
        stages={[
          { label: 'Purchase Order', active: orders.length > 0 },
          { label: 'Goods Receipt', active: true, current: true },
          { label: 'Inventory Update' },
          { label: '3-Way Match' },
          { label: 'Vendor Bill' },
          { label: 'Payment' },
        ]}
        actions={[
          {
            label: 'Upstream Purchase Orders',
            href: '/procurement/purchase-orders',
            icon: <ShoppingCart className="h-4 w-4 text-sky-600" />,
            helper: 'Receipts should always be tied to approved supplier orders.',
            tone: 'default',
          },
          {
            label: 'Inventory Impact',
            href: '/inventory/overview',
            icon: <Boxes className="h-4 w-4 text-violet-600" />,
            helper: 'Accepted quantities should become usable warehouse stock.',
            tone: 'success',
          },
          {
            label: 'Supplier Bill Match',
            href: '/purchases/bills',
            icon: <ReceiptText className="h-4 w-4 text-emerald-600" />,
            helper: 'After receiving, match the PO, GRN, and bill before payment.',
            tone: 'warning',
          },
        ]}
      />

      <Card>
        <CardHeader><CardTitle>Delivery register</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Receipt #</TableHead>
                <TableHead>Purchase order</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Lines</TableHead>
                <TableHead className="text-right">Next step</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleReceipts.map((receipt: any) => (
                <TableRow key={receipt.id}>
                  <TableCell className="font-medium">{receipt.receipt_number}</TableCell>
                  <TableCell>{receipt.purchase_order}</TableCell>
                  <TableCell>{receipt.received_date}</TableCell>
                  <TableCell><Badge variant="secondary">{receipt.status}</Badge></TableCell>
                  <TableCell>{receipt.lines?.length ?? 0}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/purchases/bills?create=1&receipt_id=${receipt.id}&purchase_order_id=${receipt.purchase_order}`}>
                        Create bill
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {receipts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">No deliveries have been recorded yet.</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {receipts.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">
            Showing page {page} of {totalPages} with {receipts.length} delivery records
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Rows</span>
            <Select value={pageSize} onValueChange={(value) => { setPageSize(value); setPage(1); }}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
