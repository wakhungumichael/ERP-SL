import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Scale, Pencil, Trash2 } from 'lucide-react';

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';

type Account = {
  id: number;
  code: string;
  name: string;
  account_type: string;
  parent: number | null;
  parent_name: string | null;
  is_active: boolean;
  allow_posting: boolean;
  children_count: number;
};

const TYPE_LABELS: Record<string, string> = {
  asset: 'Asset',
  liability: 'Liability',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expense',
};

const TYPE_COLORS: Record<string, string> = {
  asset: 'bg-blue-100 text-blue-700',
  liability: 'bg-red-100 text-red-700',
  equity: 'bg-purple-100 text-purple-700',
  income: 'bg-emerald-100 text-emerald-700',
  expense: 'bg-orange-100 text-orange-700',
};

const emptyForm = {
  code: '',
  name: '',
  account_type: 'asset',
  parent: '' as string | number,
  allow_posting: true,
  is_active: true,
};

export default function ChartOfAccounts() {
  const { token } = useAuth();
  const { toast } = useToast();

  const [filterType, setFilterType] = useState('');
  const [filterActive, setFilterActive] = useState('');
  const [open, setOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['chart-of-accounts', token, filterType, filterActive],
    enabled: !!token,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterType) params.set('account_type', filterType);
      if (filterActive) params.set('is_active', filterActive);
      const r = await fetch(BASE_URL + '/api/accounting/chart-of-accounts/?' + params.toString(), {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!r.ok) throw new Error('fetch failed');
      return r.json() as Promise<Account[]>;
    },
  });

  const accounts: Account[] = data ?? [];

  const typeCounts = ['asset', 'liability', 'equity', 'income', 'expense'].map((t) => ({
    type: t,
    count: accounts.filter((a) => a.account_type === t).length,
  }));

  function openCreate() {
    setEditAccount(null);
    setForm({ ...emptyForm });
    setOpen(true);
  }

  function openEdit(a: Account) {
    setEditAccount(a);
    setForm({
      code: a.code,
      name: a.name,
      account_type: a.account_type,
      parent: a.parent ?? '',
      allow_posting: a.allow_posting,
      is_active: a.is_active,
    });
    setOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        code: form.code,
        name: form.name,
        account_type: form.account_type,
        allow_posting: form.allow_posting,
        is_active: form.is_active,
        parent: form.parent === '' ? null : Number(form.parent),
      };
      const url = editAccount
        ? BASE_URL + `/api/accounting/chart-of-accounts/${editAccount.id}/`
        : BASE_URL + '/api/accounting/chart-of-accounts/';
      const method = editAccount ? 'PATCH' : 'POST';
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('Failed');
      toast({ title: editAccount ? 'Account updated' : 'Account created' });
      refetch();
      setOpen(false);
    } catch {
      toast({ title: 'Error saving account', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const r = await fetch(BASE_URL + `/api/accounting/chart-of-accounts/${deleteTarget.id}/`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!r.ok) {
        let msg = 'Cannot delete account';
        try {
          const json = await r.json();
          if (json?.error) msg = json.error;
          else if (json?.detail) msg = json.detail;
          else if (typeof json === 'string') msg = json;
        } catch { /* ignore */ }
        toast({ title: msg, variant: 'destructive' });
        return;
      }
      toast({ title: 'Account deleted' });
      refetch();
      setDeleteTarget(null);
    } catch {
      toast({ title: 'Error deleting account', variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  }

  const parentOptions = accounts.filter((a) => !editAccount || a.id !== editAccount.id);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Chart of Accounts</h1>
        <Button onClick={openCreate}>+ New Account</Button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {typeCounts.map(({ type, count }) => (
          <Card key={type}>
            <CardContent className="p-4">
              <p className="text-2xl font-bold">{count}</p>
              <p className="text-sm text-muted-foreground capitalize">{TYPE_LABELS[type]}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={filterType || 'all'} onValueChange={(v) => setFilterType(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="asset">Asset</SelectItem>
            <SelectItem value="liability">Liability</SelectItem>
            <SelectItem value="equity">Equity</SelectItem>
            <SelectItem value="income">Income</SelectItem>
            <SelectItem value="expense">Expense</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterActive || 'all'} onValueChange={(v) => setFilterActive(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="true">Active</SelectItem>
            <SelectItem value="false">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="py-16 text-center text-muted-foreground">Loading...</div>
      ) : accounts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
          <Scale className="h-10 w-10 opacity-40" />
          <p className="text-sm">No accounts found</p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Parent</TableHead>
                <TableHead className="text-center">Post</TableHead>
                <TableHead className="text-center">Active</TableHead>
                <TableHead className="text-center">Children</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => (
                <TableRow key={a.id} className="hover:bg-muted/50">
                  <TableCell className="font-mono text-sm">{a.code}</TableCell>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[a.account_type] ?? 'bg-gray-100 text-gray-700'}`}>
                      {TYPE_LABELS[a.account_type] ?? a.account_type}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{a.parent_name ?? '—'}</TableCell>
                  <TableCell className="text-center">{a.allow_posting ? '✓' : '—'}</TableCell>
                  <TableCell className="text-center">{a.is_active ? '✓' : '—'}</TableCell>
                  <TableCell className="text-center">{a.children_count}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(a)} title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(a)} title="Delete" className="text-red-500 hover:text-red-700">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editAccount ? 'Edit Account' : 'New Account'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Code *</Label>
                <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="e.g. 1000" />
              </div>
              <div className="space-y-1">
                <Label>Name *</Label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Account name" />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Account Type *</Label>
              <Select value={form.account_type} onValueChange={(v) => setForm((f) => ({ ...f, account_type: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="asset">Asset</SelectItem>
                  <SelectItem value="liability">Liability</SelectItem>
                  <SelectItem value="equity">Equity</SelectItem>
                  <SelectItem value="income">Income</SelectItem>
                  <SelectItem value="expense">Expense</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Parent Account</Label>
              <Select
                value={form.parent === '' ? '__none__' : String(form.parent)}
                onValueChange={(v) => setForm((f) => ({ ...f, parent: v === '__none__' ? '' : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="No parent (top-level)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No parent (top-level)</SelectItem>
                  {parentOptions.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.code} — {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.allow_posting}
                  onChange={(e) => setForm((f) => ({ ...f, allow_posting: e.target.checked }))}
                  className="h-4 w-4"
                />
                Allow Posting
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                  className="h-4 w-4"
                />
                Active
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.code || !form.name}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Account</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <strong>{deleteTarget?.code} — {deleteTarget?.name}</strong>? This action cannot be undone.
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
