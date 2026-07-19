import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FileText } from 'lucide-react';

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';
const fmt = (v: number) => 'KES ' + Number(v ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2 });

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  paid: 'bg-emerald-100 text-emerald-700',
  partial: 'bg-amber-100 text-amber-700',
  overdue: 'bg-red-100 text-red-700',
  void: 'bg-gray-100 text-gray-500',
};

interface Customer {
  id: number;
  name: string;
  phone: string;
}

interface StatementInvoice {
  id: number;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  status: string;
  total: number;
}

interface Statement {
  customer: { name: string; phone: string; email: string };
  summary: {
    total_invoiced: number;
    total_paid: number;
    outstanding: number;
    invoice_count: number;
  };
  invoices: StatementInvoice[];
}

export default function StatementsPage() {
  const { token } = useAuth();
  const { toast } = useToast();

  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data: customersData, isLoading: loadingCustomers } = useQuery({
    queryKey: ['statement-customers', token, search],
    enabled: !!token,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const r = await fetch(BASE_URL + '/api/sales/customers/?' + params.toString(), {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!r.ok) throw new Error('fetch failed');
      return r.json();
    },
  });

  const customers: Customer[] = customersData?.customers ?? (Array.isArray(customersData) ? customersData : []);

  const { data: statement, isLoading: loadingStatement } = useQuery({
    queryKey: ['customer-statement', token, selectedId, dateFrom, dateTo],
    enabled: !!token && selectedId !== null,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      const r = await fetch(BASE_URL + '/api/sales/customer-statements/' + selectedId + '/?' + params.toString(), {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!r.ok) throw new Error('fetch failed');
      return r.json() as Promise<Statement>;
    },
  });

  function handleExport() {
    toast({ title: 'Export coming soon' });
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Customer Statements</h1>
      </div>

      <div className="flex gap-0 rounded-md border overflow-hidden" style={{ minHeight: '70vh' }}>
        {/* Left Panel */}
        <div className="w-72 border-r flex flex-col">
          <div className="p-3 border-b">
            <Input
              placeholder="Search customers…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingCustomers ? (
              <p className="p-4 text-sm text-muted-foreground">Loading…</p>
            ) : customers.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No customers found</p>
            ) : (
              customers.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full text-left px-4 py-3 border-b text-sm hover:bg-muted/50 transition-colors ${
                    selectedId === c.id ? 'bg-primary/10 font-medium' : ''
                  }`}
                >
                  <p className="font-medium">{c.name}</p>
                  {c.phone && <p className="text-muted-foreground text-xs">{c.phone}</p>}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right Panel */}
        <div className="flex-1 p-6 overflow-y-auto">
          {selectedId === null ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
              <FileText className="h-10 w-10 opacity-40" />
              <p>Select a customer to view their statement</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Date filters + export */}
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">From</label>
                  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">To</label>
                  <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
                </div>
                <Button variant="outline" onClick={handleExport}>
                  Print / Export
                </Button>
              </div>

              {loadingStatement ? (
                <p className="text-muted-foreground">Loading statement…</p>
              ) : statement ? (
                <>
                  {/* Customer Info */}
                  <div>
                    <h2 className="text-xl font-semibold">{statement.customer.name}</h2>
                    <p className="text-sm text-muted-foreground">
                      {statement.customer.phone} {statement.customer.email ? '· ' + statement.customer.email : ''}
                    </p>
                  </div>

                  {/* Summary Cards */}
                  <div className="grid grid-cols-3 gap-4">
                    <Card>
                      <CardContent className="pt-4">
                        <p className="text-2xl font-bold">{fmt(statement.summary.total_invoiced)}</p>
                        <p className="text-sm text-muted-foreground">Total Invoiced</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <p className="text-2xl font-bold">{fmt(statement.summary.total_paid)}</p>
                        <p className="text-sm text-muted-foreground">Total Paid</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <p className={`text-2xl font-bold ${statement.summary.outstanding > 0 ? 'text-red-600' : ''}`}>
                          {fmt(statement.summary.outstanding)}
                        </p>
                        <p className="text-sm text-muted-foreground">Outstanding</p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Invoice Table */}
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice #</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Due Date</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {statement.invoices.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                              No invoices found
                            </TableCell>
                          </TableRow>
                        ) : (
                          statement.invoices.map((inv) => (
                            <TableRow key={inv.id} className="hover:bg-muted/50">
                              <TableCell className="font-medium">{inv.invoice_number}</TableCell>
                              <TableCell>{inv.invoice_date}</TableCell>
                              <TableCell>{inv.due_date || '—'}</TableCell>
                              <TableCell>
                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[inv.status] ?? 'bg-gray-100 text-gray-700'}`}>
                                  {inv.status}
                                </span>
                              </TableCell>
                              <TableCell>{fmt(inv.total)}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
