import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { GitBranch, Pencil, Trash2, Plus } from 'lucide-react';

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';

type Journal = { id: number; code: string; name: string; journal_type: string };
type Account = { id: number; code: string; name: string; account_type: string; allow_posting?: boolean };
type PostingRule = {
  id: number;
  source_type: string;
  payment_method_code: string;
  journal: number;
  journal_name: string;
  debit_account: number;
  debit_account_code: string;
  debit_account_name: string;
  credit_account: number;
  credit_account_code: string;
  credit_account_name: string;
  name: string;
  description: string;
  is_active: boolean;
  is_primary: boolean;
};

const SOURCE_OPTIONS = [
  { value: 'invoice', label: 'Invoice' },
  { value: 'payment', label: 'Payment' },
  { value: 'bill', label: 'Bill' },
  { value: 'transaction', label: 'Transaction' },
  { value: 'manual', label: 'Manual' },
];

const emptyForm = {
  source_type: 'invoice',
  payment_method_code: '',
  journal: '',
  debit_account: '',
  credit_account: '',
  name: '',
  description: '',
  is_active: true,
  is_primary: false,
};

function parseErrorMessage(body: any, fallback: string) {
  if (!body) return fallback;
  if (typeof body === 'string') return body;
  if (body.error) return body.error;
  if (body.detail) return body.detail;
  const first = Object.values(body)[0];
  if (Array.isArray(first) && first.length) return String(first[0]);
  return fallback;
}

export default function AccountingPostingRules() {
  const { token } = useAuth();
  const { toast } = useToast();

  const [filterSource, setFilterSource] = useState('');
  const [filterActive, setFilterActive] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editRule, setEditRule] = useState<PostingRule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PostingRule | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  const params = new URLSearchParams();
  if (filterSource) params.set('source_type', filterSource);
  if (filterActive) params.set('is_active', filterActive);
  if (search.trim()) params.set('search', search.trim());

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['accounting-posting-rules', token, filterSource, filterActive, search],
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch(BASE_URL + '/api/accounting/posting-rules/?' + params.toString(), {
        headers: { Authorization: 'Token ' + token },
      });
      if (!r.ok) throw new Error('Failed to fetch posting rules');
      return r.json() as Promise<PostingRule[]>;
    },
  });

  const { data: journalsData } = useQuery({
    queryKey: ['accounting-posting-rule-journals', token],
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch(BASE_URL + '/api/accounting/journals/', {
        headers: { Authorization: 'Token ' + token },
      });
      if (!r.ok) throw new Error('Failed to fetch journals');
      return r.json() as Promise<{ journals: Journal[] }>;
    },
  });

  const { data: accountsData } = useQuery({
    queryKey: ['accounting-posting-rule-accounts', token],
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch(BASE_URL + '/api/accounting/chart-of-accounts/?is_active=true', {
        headers: { Authorization: 'Token ' + token },
      });
      if (!r.ok) throw new Error('Failed to fetch accounts');
      return r.json() as Promise<Account[]>;
    },
  });

  const rules = data ?? [];
  const journals = journalsData?.journals ?? [];
  const accounts = (accountsData ?? []).filter((account) => account.allow_posting !== false);

  const counts = useMemo(() => ({
    total: rules.length,
    active: rules.filter((rule) => rule.is_active).length,
    primary: rules.filter((rule) => rule.is_primary).length,
    payment: rules.filter((rule) => rule.source_type === 'payment').length,
  }), [rules]);

  function openCreate() {
    setEditRule(null);
    setForm({ ...emptyForm });
    setOpen(true);
  }

  function openEdit(rule: PostingRule) {
    setEditRule(rule);
    setForm({
      source_type: rule.source_type,
      payment_method_code: rule.payment_method_code || '',
      journal: String(rule.journal),
      debit_account: String(rule.debit_account),
      credit_account: String(rule.credit_account),
      name: rule.name,
      description: rule.description || '',
      is_active: rule.is_active,
      is_primary: rule.is_primary,
    });
    setOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        source_type: form.source_type,
        payment_method_code: form.payment_method_code.trim(),
        journal: Number(form.journal),
        debit_account: Number(form.debit_account),
        credit_account: Number(form.credit_account),
        name: form.name.trim(),
        description: form.description.trim(),
        is_active: form.is_active,
        is_primary: form.is_primary,
      };
      const url = editRule
        ? BASE_URL + `/api/accounting/posting-rules/${editRule.id}/`
        : BASE_URL + '/api/accounting/posting-rules/';
      const method = editRule ? 'PATCH' : 'POST';
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: 'Token ' + token },
        body: JSON.stringify(payload),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(parseErrorMessage(body, 'Failed to save posting rule'));
      toast({ title: editRule ? 'Posting rule updated' : 'Posting rule created' });
      setOpen(false);
      refetch();
    } catch (error: any) {
      toast({ title: 'Unable to save posting rule', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const r = await fetch(BASE_URL + `/api/accounting/posting-rules/${deleteTarget.id}/`, {
        method: 'DELETE',
        headers: { Authorization: 'Token ' + token },
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(parseErrorMessage(body, 'Failed to delete posting rule'));
      }
      toast({ title: 'Posting rule deleted' });
      setDeleteTarget(null);
      refetch();
    } catch (error: any) {
      toast({ title: 'Unable to delete posting rule', description: error.message, variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Posting Rules</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Control how invoices, payments, bills, and manual events translate into debit and credit entries.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" /> New Rule
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Total', value: counts.total },
          { label: 'Active', value: counts.active },
          { label: 'Primary', value: counts.primary },
          { label: 'Payment Rules', value: counts.payment },
        ].map((card) => (
          <Card key={card.label}>
            <CardContent className="pt-4">
              <p className="text-2xl font-bold">{card.value}</p>
              <p className="text-sm text-muted-foreground">{card.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, journal, account, or method" className="w-full md:w-80" />
        <Select value={filterSource || '__all__'} onValueChange={(value) => setFilterSource(value === '__all__' ? '' : value)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All sources</SelectItem>
            {SOURCE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterActive || '__all__'} onValueChange={(value) => setFilterActive(value === '__all__' ? '' : value)}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All status</SelectItem>
            <SelectItem value="true">Active</SelectItem>
            <SelectItem value="false">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-muted-foreground">Loading…</div>
      ) : rules.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
          <GitBranch className="h-10 w-10 opacity-40" />
          <p className="text-sm">No posting rules found</p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Journal</TableHead>
                <TableHead>Debit</TableHead>
                <TableHead>Credit</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell>
                    <div className="font-medium">{rule.name}</div>
                    <div className="text-xs text-muted-foreground">{rule.description || 'No description'}</div>
                  </TableCell>
                  <TableCell className="capitalize">{rule.source_type}</TableCell>
                  <TableCell>{rule.payment_method_code || 'Default'}</TableCell>
                  <TableCell>{rule.journal_name}</TableCell>
                  <TableCell className="text-sm">{rule.debit_account_code} - {rule.debit_account_name}</TableCell>
                  <TableCell className="text-sm">{rule.credit_account_code} - {rule.credit_account_name}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Badge className={rule.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-700'}>
                        {rule.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                      {rule.is_primary && (
                        <Badge className="bg-blue-100 text-blue-700">Primary</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(rule)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-700" onClick={() => setDeleteTarget(rule)}>
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editRule ? 'Edit Posting Rule' : 'New Posting Rule'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Rule Name</Label>
              <Input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="e.g. Sales invoice issue" />
            </div>
            <div className="space-y-1">
              <Label>Source Type</Label>
              <Select value={form.source_type} onValueChange={(value) => setForm((prev) => ({ ...prev, source_type: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SOURCE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Payment Method Code</Label>
              <Input value={form.payment_method_code} onChange={(e) => setForm((prev) => ({ ...prev, payment_method_code: e.target.value }))} placeholder="Optional, e.g. Mpesa" />
            </div>
            <div className="space-y-1">
              <Label>Journal</Label>
              <Select value={form.journal || '__none__'} onValueChange={(value) => setForm((prev) => ({ ...prev, journal: value === '__none__' ? '' : value }))}>
                <SelectTrigger><SelectValue placeholder="Select journal" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select journal</SelectItem>
                  {journals.map((journal) => (
                    <SelectItem key={journal.id} value={String(journal.id)}>{journal.code} - {journal.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Debit Account</Label>
              <Select value={form.debit_account || '__none__'} onValueChange={(value) => setForm((prev) => ({ ...prev, debit_account: value === '__none__' ? '' : value }))}>
                <SelectTrigger><SelectValue placeholder="Select debit account" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select debit account</SelectItem>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={String(account.id)}>{account.code} - {account.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Credit Account</Label>
              <Select value={form.credit_account || '__none__'} onValueChange={(value) => setForm((prev) => ({ ...prev, credit_account: value === '__none__' ? '' : value }))}>
                <SelectTrigger><SelectValue placeholder="Select credit account" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select credit account</SelectItem>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={String(account.id)}>{account.code} - {account.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} placeholder="What business event this rule covers" />
            </div>
            <div className="flex items-center gap-6 md:col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))} className="h-4 w-4" />
                Active
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_primary} onChange={(e) => setForm((prev) => ({ ...prev, is_primary: e.target.checked }))} className="h-4 w-4" />
                Primary rule for this source/method
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={saving || !form.name.trim() || !form.journal || !form.debit_account || !form.credit_account}
            >
              {saving ? 'Saving…' : editRule ? 'Save Changes' : 'Create Rule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(value) => { if (!value) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Posting Rule</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Delete <strong>{deleteTarget?.name}</strong>? This will remove the rule from future accounting postings.
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
