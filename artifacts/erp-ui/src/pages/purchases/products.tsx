import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/use-auth';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';
const fmt = (v: number) => 'KES ' + Number(v ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2 });

type Product = {
  id: number;
  name: string;
  code?: string;
  unit_price: number;
  tax_rate?: number;
  unit?: string;
  product_type?: string;
};

const TYPE_COLORS: Record<string, string> = {
  product: 'bg-blue-100 text-blue-700',
  service: 'bg-violet-100 text-violet-700',
};

export default function PurchaseProductsPage() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState('');

  const params = new URLSearchParams();
  if (search) params.set('search', search);
  const qs = params.toString() ? '?' + params.toString() : '';

  const { data, isLoading } = useQuery({
    queryKey: ['purchases-products', token, search],
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch(BASE_URL + '/api/purchases/products/' + qs, {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!r.ok) throw new Error('fetch failed');
      return r.json();
    },
  });

  const products: Product[] = Array.isArray(data) ? data : (data?.products ?? data?.results ?? []);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Products &amp; Services</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            This catalog is shared with Sales. Manage it under{' '}
            <span className="font-medium">Sales → Products &amp; Services</span>.
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate('/sales/products')}>
          Go to Sales Products
        </Button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total Products &amp; Services</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-2xl font-semibold">{products.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="max-w-xs">
        <Input
          placeholder="Search products…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-sm"
        />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">Loading…</div>
          ) : products.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7H4a2 2 0 00-2 2v8a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM16 3H8a2 2 0 00-2 2v2h12V5a2 2 0 00-2-2z" />
              </svg>
              <span className="text-sm">No products found</span>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Unit Price</TableHead>
                  <TableHead className="text-right">Tax %</TableHead>
                  <TableHead>Unit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => (
                  <TableRow key={p.id} className="hover:bg-muted/50">
                    <TableCell className="font-mono text-sm">{p.code ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>
                      {p.product_type ? (
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[p.product_type] ?? 'bg-gray-100 text-gray-700'}`}>
                          {p.product_type}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{fmt(p.unit_price)}</TableCell>
                    <TableCell className="text-right">{p.tax_rate != null ? `${p.tax_rate}%` : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>{p.unit ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
