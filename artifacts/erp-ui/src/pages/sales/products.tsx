import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, ChevronRight, Package, Pencil, Trash2 } from 'lucide-react';

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';
const fmt = (v: number) => 'KES ' + Number(v ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2 });

const typeColors: Record<string, string> = {
  product: 'bg-blue-100 text-blue-700',
  service: 'bg-violet-100 text-violet-700',
};

interface Product {
  id: number;
  name: string;
  code: string;
  product_type: string;
  unit: string;
  unit_price: number;
  tax_rate: number;
  description: string;
  is_active: boolean;
  source: string;
}

type FormState = {
  name: string;
  code: string;
  product_type: string;
  unit: string;
  unit_price: string;
  tax_rate: string;
  description: string;
  is_active: boolean;
};

const emptyForm = (defaultTaxRate = '0'): FormState => ({
  name: '',
  code: '',
  product_type: 'product',
  unit: '',
  unit_price: '',
  tax_rate: defaultTaxRate,
  description: '',
  is_active: true,
});

export default function ProductsPage() {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const tenantId = (user as any)?.tenant_id;

  const [filterType, setFilterType] = useState('');
  const [filterActive, setFilterActive] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [open, setOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());

  const { data: tenantSettingsData } = useQuery({
    queryKey: ['tenant-settings-default-tax', tenantId, token],
    enabled: !!tenantId && !!token,
    queryFn: async () => {
      const r = await fetch(BASE_URL + `/api/platform/tenants/${tenantId}/settings/`, {
        headers: { Authorization: 'Token ' + token },
      });
      if (!r.ok) throw new Error('settings fetch failed');
      return r.json();
    },
  });

  const tenantSettings = tenantSettingsData?.data ?? tenantSettingsData ?? {};
  const defaultTaxRate = String(tenantSettings.default_tax_rate ?? '0');
  const defaultTaxName = tenantSettings.default_tax_name || 'Tax';

  const params = new URLSearchParams();
  if (filterType) params.set('product_type', filterType);
  if (filterActive) params.set('is_active', filterActive);
  if (search) params.set('search', search);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['products', token, filterType, filterActive, search],
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch(BASE_URL + '/api/sales/products/?' + params.toString(), {
        headers: { Authorization: 'Token ' + token },
      });
      if (!r.ok) throw new Error('fetch failed');
      return r.json();
    },
  });

  const products: Product[] = Array.isArray(data) ? data : (data?.results ?? []);
  const totalPages = Math.max(1, Math.ceil(products.length / pageSize));
  const pagedProducts = products.slice((page - 1) * pageSize, page * pageSize);

  const counts = {
    total: products.length,
    products: products.filter((p) => p.product_type === 'product').length,
    services: products.filter((p) => p.product_type === 'service').length,
    active: products.filter((p) => p.is_active).length,
  };

  function openCreate() {
    setEditTarget(null);
    setForm(emptyForm(defaultTaxRate));
    setOpen(true);
  }

  function openEdit(p: Product) {
    setEditTarget(p);
    setForm({
      name: p.name,
      code: p.code ?? '',
      product_type: p.product_type,
      unit: p.unit ?? '',
      unit_price: String(p.unit_price ?? ''),
      tax_rate: String(p.tax_rate ?? '0'),
      description: p.description ?? '',
      is_active: p.is_active,
    });
    setOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        ...form,
        unit_price: parseFloat(form.unit_price) || 0,
        tax_rate: parseFloat(form.tax_rate) || 0,
      };
      const url = editTarget
        ? BASE_URL + '/api/sales/products/' + editTarget.id + '/'
        : BASE_URL + '/api/sales/products/';
      const method = editTarget ? 'PATCH' : 'POST';
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: 'Token ' + token },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error('Failed');
      toast({ title: editTarget ? 'Product updated' : 'Product created' });
      refetch();
      setOpen(false);
      setPage(1);
    } catch {
      toast({ title: 'Error saving product', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const r = await fetch(BASE_URL + '/api/sales/products/' + deleteTarget.id + '/', {
        method: 'DELETE',
        headers: { Authorization: 'Token ' + token },
      });
      if (!r.ok) throw new Error('Failed');
      toast({ title: 'Product deleted' });
      refetch();
      setDeleteTarget(null);
    } catch {
      toast({ title: 'Error deleting product', variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Products &amp; Services</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manual catalog items live here, and weighbridge vehicle-type services sync in automatically.
          </p>
        </div>
        <Button onClick={openCreate}>+ New Product</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Total', value: counts.total },
          { label: 'Products', value: counts.products },
          { label: 'Services', value: counts.services },
          { label: 'Active', value: counts.active },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-4">
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-sm text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          <Input
            placeholder="Search…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-48"
          />
          <Select value={filterType || '__all__'} onValueChange={(value) => { setFilterType(value === '__all__' ? '' : value); setPage(1); }}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Types</SelectItem>
              <SelectItem value="product">Product</SelectItem>
              <SelectItem value="service">Service</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterActive || '__all__'} onValueChange={(value) => { setFilterActive(value === '__all__' ? '' : value); setPage(1); }}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Statuses</SelectItem>
              <SelectItem value="true">Active</SelectItem>
              <SelectItem value="false">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Records:</span>
          <Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPage(1); }}>
            <SelectTrigger className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[5, 10, 25, 50].map((size) => (
                <SelectItem key={size} value={String(size)}>{size}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="text-sm text-muted-foreground">
        {products.length} record{products.length !== 1 ? 's' : ''} found
      </div>

      {/* Table */}
      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
          <Package className="h-10 w-10 opacity-40" />
          <p>No products found</p>
        </div>
      ) : (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Unit Price</TableHead>
                  <TableHead>Tax %</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedProducts.map((p) => (
                  <TableRow key={p.id} className="hover:bg-muted/50">
                    <TableCell className="font-mono text-sm">{p.code || '—'}</TableCell>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${typeColors[p.product_type] ?? 'bg-gray-100 text-gray-700'}`}>
                        {p.product_type}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${p.source === 'weighbridge' ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-700'}`}>
                        {p.source === 'weighbridge' ? 'Weighbridge' : 'Manual'}
                      </span>
                    </TableCell>
                    <TableCell>{fmt(p.unit_price)}</TableCell>
                    <TableCell>{p.tax_rate ?? 0}%</TableCell>
                    <TableCell>{p.unit || '—'}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${p.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                        {p.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => setDeleteTarget(p)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between text-sm mt-4">
            <span className="text-muted-foreground">
              Showing {Math.min((page - 1) * pageSize + 1, products.length)}-{Math.min(page * pageSize, products.length)} of {products.length}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Previous
              </Button>
              <span className="text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Edit Product' : 'New Product'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label>Code</Label>
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Type</Label>
                <Select value={form.product_type} onValueChange={(v) => setForm({ ...form, product_type: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="product">Product</SelectItem>
                    <SelectItem value="service">Service</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Unit</Label>
                <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="e.g. kg, hr, piece" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Unit Price</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.unit_price}
                  onChange={(e) => setForm({ ...form, unit_price: e.target.value })}
                />
              </div>
              <div>
                <Label>Tax Rate (%)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.tax_rate}
                  onChange={(e) => setForm({ ...form, tax_rate: e.target.value })}
                />
                <p className="mt-1 text-xs text-muted-foreground">Default {defaultTaxName}: {defaultTaxRate}%</p>
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="is_active"
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="is_active">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.name}>
              {saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Create Product'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Product</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
