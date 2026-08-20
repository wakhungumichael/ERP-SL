import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BookOpen, CalendarRange, Plus, Search, Send, RotateCcw } from 'lucide-react';
import { useAuth } from '@/context/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ProcessFlow } from '@/components/workflow/process-flow';

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';

const fmt = (v: number) => 'KES ' + Number(v ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2 });

type JournalLine = {
  id: number;
  account: number;
  account_code: string;
  account_name: string;
  description: string;
  debit_amount: string | number;
  credit_amount: string | number;
};

type JournalEntry = {
  id: number;
  entry_number: string;
  entry_date: string;
  journal_name: string;
  source_type: string;
  memo: string;
  status: string;
  debit_total: number;
  credit_total: number;
  lines: JournalLine[];
};

type Journal = { id: number; code: string; name: string; journal_type: string };
type AccountOption = { id: number; code: string; name: string; account_type: string; allow_posting?: boolean };
type FormLine = { account: string; description: string; debit_amount: string; credit_amount: string };

const SOURCE_COLORS: Record<string, string> = {
  invoice: 'bg-blue-100 text-blue-700',
  payment: 'bg-emerald-100 text-emerald-700',
  transaction: 'bg-indigo-100 text-indigo-700',
  manual: 'bg-gray-100 text-gray-700',
  bill: 'bg-amber-100 text-amber-700',
};

const SOURCE_LABELS: Record<string, string> = {
  invoice: 'Invoice',
  payment: 'Payment',
  transaction: 'Direct Cash Sale',
  manual: 'Manual',
  bill: 'Bill',
};

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  posted: 'bg-emerald-100 text-emerald-700',
  reversed: 'bg-red-100 text-red-700',
};

const emptyLine = (): FormLine => ({ account: '', description: '', debit_amount: '', credit_amount: '' });

function getTodayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function Transactions() {
  const { token } = useAuth();
  const { toast } = useToast();

  const [filterStatus, setFilterStatus] = useState('all');
  const [filterSource, setFilterSource] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actingId, setActingId] = useState<number | null>(null);

  const [formJournal, setFormJournal] = useState('');
  const [formDate, setFormDate] = useState(getTodayISO());
  const [formMemo, setFormMemo] = useState('');
  const [formLines, setFormLines] = useState<FormLine[]>([emptyLine(), emptyLine()]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['transactions', token, filterStatus, filterSource, filterDateFrom, filterDateTo],
    enabled: !!token,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterStatus !== 'all') params.set('status', filterStatus);
      if (filterSource !== 'all') params.set('source_type', filterSource);
      if (filterDateFrom) params.set('date_from', filterDateFrom);
      if (filterDateTo) params.set('date_to', filterDateTo);
      const r = await fetch(BASE_URL + '/api/accounting/transactions/?' + params.toString(), {
        headers: { Authorization: 'Token ' + token },
      });
      if (!r.ok) throw new Error('fetch failed');
      return r.json() as Promise<JournalEntry[]>;
    },
  });

  const { data: journalsData } = useQuery({
    queryKey: ['journals', token],
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch(BASE_URL + '/api/accounting/journals/', {
        headers: { Authorization: 'Token ' + token },
      });
      if (!r.ok) throw new Error('fetch failed');
      return r.json() as Promise<{ journals: Journal[] }>;
    },
  });

  const { data: accountsData } = useQuery({
    queryKey: ['accounting-accounts', token],
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch(BASE_URL + '/api/accounting/chart-of-accounts/?is_active=true', {
        headers: { Authorization: 'Token ' + token },
      });
      if (!r.ok) throw new Error('fetch failed');
      return r.json() as Promise<AccountOption[]>;
    },
  });

  const entries: JournalEntry[] = data ?? [];
  const journals: Journal[] = journalsData?.journals ?? [];
  const accountOptions: AccountOption[] = (accountsData ?? []).filter((account) => account.allow_posting ?? true);

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((entry) =>
      entry.entry_number?.toLowerCase().includes(q) ||
      entry.journal_name?.toLowerCase().includes(q) ||
      entry.memo?.toLowerCase().includes(q) ||
      SOURCE_LABELS[entry.source_type]?.toLowerCase().includes(q),
    );
  }, [entries, search]);

  const totalCount = filteredEntries.length;
  const postedCount = filteredEntries.filter((e) => e.status === 'posted').length;
  const draftCount = filteredEntries.filter((e) => e.status === 'draft').length;
  const reversedCount = filteredEntries.filter((e) => e.status === 'reversed').length;
  const totalPostedDebits = filteredEntries
    .filter((e) => e.status === 'posted')
    .reduce((sum, e) => sum + Number(e.debit_total ?? 0), 0);

  function updateLine(idx: number, field: keyof FormLine, value: string) {
    setFormLines((lines) => lines.map((line, lineIdx) => (lineIdx === idx ? { ...line, [field]: value } : line)));
  }

  function addLine() {
    if (formLines.length >= 20) return;
    setFormLines((lines) => [...lines, emptyLine()]);
  }

  function removeLine(idx: number) {
    setFormLines((lines) => lines.filter((_, lineIdx) => lineIdx !== idx));
  }

  const runningDebit = formLines.reduce((sum, line) => sum + (parseFloat(line.debit_amount) || 0), 0);
  const runningCredit = formLines.reduce((sum, line) => sum + (parseFloat(line.credit_amount) || 0), 0);
  const isBalanced = Math.abs(runningDebit - runningCredit) < 0.001 && runningDebit > 0;

  function openCreate() {
    setFormJournal('');
    setFormDate(getTodayISO());
    setFormMemo('');
    setFormLines([emptyLine(), emptyLine()]);
    setOpen(true);
  }

  async function handleCreate() {
    if (!isBalanced) return;
    setSaving(true);
    try {
      const body = {
        journal: Number(formJournal),
        entry_date: formDate,
        memo: formMemo,
        source_type: 'manual',
        status: 'posted',
        lines: formLines
          .filter((line) => line.account)
          .map((line) => ({
            account: Number(line.account),
            description: line.description,
            debit_amount: parseFloat(line.debit_amount) || 0,
            credit_amount: parseFloat(line.credit_amount) || 0,
          })),
      };
      const r = await fetch(BASE_URL + '/api/accounting/transactions/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Token ' + token },
        body: JSON.stringify(body),
      });
      const response = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(response?.error || 'Failed');
      toast({ title: 'Transaction created successfully' });
      refetch();
      setOpen(false);
    } catch (error: any) {
      toast({ title: 'Error creating transaction', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handlePost(entryId: number) {
    setActingId(entryId);
    try {
      const r = await fetch(BASE_URL + `/api/accounting/transactions/${entryId}/post/`, {
        method: 'POST',
        headers: { Authorization: 'Token ' + token },
      });
      const response = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(response?.error || 'Failed to post entry');
      toast({ title: response.message || 'Entry posted' });
      refetch();
    } catch (error: any) {
      toast({ title: 'Unable to post entry', description: error.message, variant: 'destructive' });
    } finally {
      setActingId(null);
    }
  }

  async function handleReverse(entryId: number) {
    setActingId(entryId);
    try {
      const r = await fetch(BASE_URL + `/api/accounting/transactions/${entryId}/reverse/`, {
        method: 'POST',
        headers: { Authorization: 'Token ' + token },
      });
      const response = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(response?.error || 'Failed to reverse entry');
      toast({ title: response.message || 'Entry reversed' });
      refetch();
    } catch (error: any) {
      toast({ title: 'Unable to reverse entry', description: error.message, variant: 'destructive' });
    } finally {
      setActingId(null);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Finance Transactions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review journal entries in a cleaner queue, then open each record in a focused finance workspace.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> Manual Entry
        </Button>
      </div>

      <ProcessFlow
        title="Journal To Reporting Workflow"
        description="Transactions should move from capture into posting and reporting through one consistent accounting flow."
        stages={[
          { label: 'Capture', active: true },
          { label: 'Validate', active: totalCount > 0 },
          { label: 'Post', active: postedCount > 0 },
          { label: 'Report', active: postedCount > 0 },
        ]}
        actions={[
          {
            label: 'Open Posting Rules',
            href: '/finance/posting-rules',
            helper: 'Review automation and controls behind accounting entries.',
            tone: 'warning',
          },
          {
            label: 'Open Reports',
            href: '/finance/reports',
            helper: 'Trace posted entries into trial balance, ledger, and statements.',
            tone: 'default',
          },
          {
            label: 'Chart Of Accounts',
            href: '/finance/chart-of-accounts',
            helper: 'Maintain the account structure used by journals and postings.',
            tone: 'success',
          },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Total Entries</div><div className="mt-2 text-2xl font-semibold">{totalCount}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Posted</div><div className="mt-2 text-2xl font-semibold text-emerald-600">{postedCount}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Draft / Reversed</div><div className="mt-2 text-2xl font-semibold">{draftCount + reversedCount}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Posted Debits</div><div className="mt-2 text-xl font-semibold">{fmt(totalPostedDebits)}</div></CardContent></Card>
      </div>

      <div className="rounded-lg border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-3 p-3">
          <div className="flex min-w-[220px] flex-1 items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              placeholder="Search entry number, journal, memo, source…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 border-0 shadow-none focus-visible:ring-0"
            />
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="posted">Posted</SelectItem>
              <SelectItem value="reversed">Reversed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterSource} onValueChange={setFilterSource}>
            <SelectTrigger className="h-8 w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="invoice">Invoice</SelectItem>
              <SelectItem value="payment">Payment</SelectItem>
              <SelectItem value="transaction">Transaction</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="bill">Bill</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-muted-foreground" />
            <Input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} className="h-8 w-[150px]" />
            <Input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} className="h-8 w-[150px]" />
          </div>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Journal Queue</CardTitle>
          <div className="text-sm text-muted-foreground">{totalCount} transactions</div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Loading finance transactions…</div>
          ) : filteredEntries.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
              <BookOpen className="h-10 w-10 opacity-40" />
              <p className="text-sm">No transactions found for the selected filters.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entry #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Journal</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Memo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead>Next Step</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEntries.map((entry) => (
                  <TableRow key={entry.id} className="hover:bg-muted/40">
                    <TableCell className="font-medium">
                      <Link href={`/finance/transactions/${entry.id}`} className="inline-flex items-center gap-2 text-primary hover:underline">
                        {entry.entry_number}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{entry.entry_date}</TableCell>
                    <TableCell>{entry.journal_name}</TableCell>
                    <TableCell>
                      <Badge className={SOURCE_COLORS[entry.source_type] ?? 'bg-gray-100 text-gray-700'}>
                        {SOURCE_LABELS[entry.source_type] ?? entry.source_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate text-sm text-muted-foreground" title={entry.memo}>
                      {entry.memo || '—'}
                    </TableCell>
                    <TableCell>
                      <Badge className={STATUS_COLORS[entry.status] ?? 'bg-gray-100 text-gray-700'}>
                        {entry.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmt(Number(entry.debit_total))}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmt(Number(entry.credit_total))}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {entry.status === 'draft' ? 'Validate and post' : entry.status === 'posted' ? 'Review in reports' : 'Audit reversal'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Link href={`/finance/transactions/${entry.id}`}>
                          <Button size="sm" variant="outline">Open</Button>
                        </Link>
                        {entry.status === 'draft' ? (
                          <Button size="sm" variant="outline" onClick={() => handlePost(entry.id)} disabled={actingId === entry.id}>
                            <Send className="mr-1 h-4 w-4" /> Post
                          </Button>
                        ) : null}
                        {entry.status !== 'reversed' ? (
                          <Button size="sm" variant="outline" onClick={() => handleReverse(entry.id)} disabled={actingId === entry.id}>
                            <RotateCcw className="mr-1 h-4 w-4" /> Reverse
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Manual Entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Journal *</Label>
                <Select value={formJournal} onValueChange={setFormJournal}>
                  <SelectTrigger><SelectValue placeholder="Select journal…" /></SelectTrigger>
                  <SelectContent>
                    {journals.map((journal) => (
                      <SelectItem key={journal.id} value={String(journal.id)}>
                        {journal.code} — {journal.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Entry Date *</Label>
                <Input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Memo</Label>
              <Textarea value={formMemo} onChange={(e) => setFormMemo(e.target.value)} placeholder="Optional description…" rows={2} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Journal Lines</Label>
                <Button type="button" variant="outline" size="sm" onClick={addLine} disabled={formLines.length >= 20}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add Line
                </Button>
              </div>

              <div className="rounded border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="text-xs">Account</TableHead>
                      <TableHead className="text-xs">Description</TableHead>
                      <TableHead className="text-right text-xs">Debit</TableHead>
                      <TableHead className="text-right text-xs">Credit</TableHead>
                      <TableHead className="w-8"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {formLines.map((line, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="py-1 pr-1">
                          <Select value={line.account || '__none__'} onValueChange={(value) => updateLine(idx, 'account', value === '__none__' ? '' : value)}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select account" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">Select account</SelectItem>
                              {accountOptions.map((account) => (
                                <SelectItem key={account.id} value={String(account.id)}>
                                  {account.code} — {account.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="py-1 px-1">
                          <Input className="h-8 text-xs" placeholder="Description" value={line.description} onChange={(e) => updateLine(idx, 'description', e.target.value)} />
                        </TableCell>
                        <TableCell className="py-1 px-1">
                          <Input className="h-8 text-xs text-right" type="number" min="0" step="0.01" placeholder="0.00" value={line.debit_amount} onChange={(e) => updateLine(idx, 'debit_amount', e.target.value)} />
                        </TableCell>
                        <TableCell className="py-1 px-1">
                          <Input className="h-8 text-xs text-right" type="number" min="0" step="0.01" placeholder="0.00" value={line.credit_amount} onChange={(e) => updateLine(idx, 'credit_amount', e.target.value)} />
                        </TableCell>
                        <TableCell className="py-1 pl-1">
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeLine(idx)} disabled={formLines.length <= 1}>
                            x
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/30">
                      <TableCell colSpan={2} className="text-xs font-semibold text-right">Running Total</TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold">{fmt(runningDebit)}</TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold">{fmt(runningCredit)}</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              {!isBalanced && runningDebit > 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  Debits and credits must balance before the entry can be saved.
                </div>
              ) : null}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || !isBalanced || !formJournal || !formDate}>
              {saving ? 'Saving…' : 'Save Entry'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
