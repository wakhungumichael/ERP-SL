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
import { BookOpen, ChevronDown, ChevronRight, Plus, X, AlertTriangle } from 'lucide-react';

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

type FormLine = {
  account: string;
  description: string;
  debit_amount: string;
  credit_amount: string;
};

const SOURCE_COLORS: Record<string, string> = {
  invoice: 'bg-blue-100 text-blue-700',
  payment: 'bg-emerald-100 text-emerald-700',
  transaction: 'bg-indigo-100 text-indigo-700',
  manual: 'bg-gray-100 text-gray-700',
};

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  posted: 'bg-emerald-100 text-emerald-700',
  reversed: 'bg-red-100 text-red-700',
};

const emptyLine = (): FormLine => ({ account: '', description: '', debit_amount: '', credit_amount: '' });

function getTodayISO() {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

export default function Transactions() {
  const { token } = useAuth();
  const { toast } = useToast();

  const [filterStatus, setFilterStatus] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [formJournal, setFormJournal] = useState('');
  const [formDate, setFormDate] = useState(getTodayISO());
  const [formMemo, setFormMemo] = useState('');
  const [formLines, setFormLines] = useState<FormLine[]>([emptyLine(), emptyLine()]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['transactions', token, filterStatus, filterSource, filterDateFrom, filterDateTo],
    enabled: !!token,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (filterSource) params.set('source_type', filterSource);
      if (filterDateFrom) params.set('date_from', filterDateFrom);
      if (filterDateTo) params.set('date_to', filterDateTo);
      const r = await fetch(BASE_URL + '/api/accounting/transactions/?' + params.toString(), {
        headers: { Authorization: 'Bearer ' + token },
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
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!r.ok) throw new Error('fetch failed');
      return r.json() as Promise<{ journals: Journal[] }>;
    },
  });

  const entries: JournalEntry[] = data ?? [];
  const journals: Journal[] = journalsData?.journals ?? [];

  const totalCount = entries.length;
  const postedCount = entries.filter((e) => e.status === 'posted').length;
  const draftCount = entries.filter((e) => e.status === 'draft').length;
  const totalPostedDebits = entries
    .filter((e) => e.status === 'posted')
    .reduce((sum, e) => sum + Number(e.debit_total ?? 0), 0);

  // Form line helpers
  function updateLine(idx: number, field: keyof FormLine, value: string) {
    setFormLines((lines) => lines.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  }
  function addLine() {
    if (formLines.length >= 20) return;
    setFormLines((lines) => [...lines, emptyLine()]);
  }
  function removeLine(idx: number) {
    setFormLines((lines) => lines.filter((_, i) => i !== idx));
  }

  const runningDebit = formLines.reduce((s, l) => s + (parseFloat(l.debit_amount) || 0), 0);
  const runningCredit = formLines.reduce((s, l) => s + (parseFloat(l.credit_amount) || 0), 0);
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
          .filter((l) => l.account)
          .map((l) => ({
            account: Number(l.account),
            description: l.description,
            debit_amount: parseFloat(l.debit_amount) || 0,
            credit_amount: parseFloat(l.credit_amount) || 0,
          })),
      };
      const r = await fetch(BASE_URL + '/api/accounting/transactions/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('Failed');
      toast({ title: 'Transaction created successfully' });
      refetch();
      setOpen(false);
    } catch {
      toast({ title: 'Error creating transaction', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  function toggleExpand(id: number) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Transactions</h1>
        <Button onClick={openCreate}>+ Manual Entry</Button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold">{totalCount}</p>
            <p className="text-sm text-muted-foreground">Total Entries</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold text-emerald-600">{postedCount}</p>
            <p className="text-sm text-muted-foreground">Posted</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold text-gray-500">{draftCount}</p>
            <p className="text-sm text-muted-foreground">Draft</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-lg font-bold">{fmt(totalPostedDebits)}</p>
            <p className="text-sm text-muted-foreground">Posted Debits</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={filterStatus || 'all'} onValueChange={(v) => setFilterStatus(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="posted">Posted</SelectItem>
            <SelectItem value="reversed">Reversed</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterSource || 'all'} onValueChange={(v) => setFilterSource(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All Sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            <SelectItem value="invoice">Invoice</SelectItem>
            <SelectItem value="payment">Payment</SelectItem>
            <SelectItem value="transaction">Transaction</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <Label className="text-sm text-muted-foreground">From</Label>
          <Input type="date" className="w-40" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm text-muted-foreground">To</Label>
          <Input type="date" className="w-40" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} />
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="py-16 text-center text-muted-foreground">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
          <BookOpen className="h-10 w-10 opacity-40" />
          <p className="text-sm">No transactions found</p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-6"></TableHead>
                <TableHead>Entry #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Journal</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Memo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => {
                const expanded = expandedId === entry.id;
                const lineDebitSum = (entry.lines ?? []).reduce((s, l) => s + Number(l.debit_amount ?? 0), 0);
                const lineCreditSum = (entry.lines ?? []).reduce((s, l) => s + Number(l.credit_amount ?? 0), 0);
                const unbalanced = Math.abs(Number(entry.debit_total) - Number(entry.credit_total)) > 0.001;
                return [
                  <TableRow
                    key={entry.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => toggleExpand(entry.id)}
                  >
                    <TableCell className="pr-0">
                      {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{entry.entry_number}</TableCell>
                    <TableCell className="text-sm">{entry.entry_date}</TableCell>
                    <TableCell className="text-sm">{entry.journal_name}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${SOURCE_COLORS[entry.source_type] ?? 'bg-gray-100 text-gray-700'}`}>
                        {entry.source_type}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground" title={entry.memo}>
                      {entry.memo?.length > 40 ? entry.memo.slice(0, 40) + '…' : entry.memo}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[entry.status] ?? 'bg-gray-100 text-gray-700'}`}>
                        {entry.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmt(Number(entry.debit_total))}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmt(Number(entry.credit_total))}</TableCell>
                  </TableRow>,
                  expanded && (
                    <TableRow key={`${entry.id}-detail`} className="bg-muted/30">
                      <TableCell colSpan={9} className="p-0">
                        <div className="p-4 space-y-3">
                          {/* Meta */}
                          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-3 lg:grid-cols-6">
                            <div><span className="text-muted-foreground">Entry #: </span><span className="font-medium">{entry.entry_number}</span></div>
                            <div><span className="text-muted-foreground">Date: </span><span className="font-medium">{entry.entry_date}</span></div>
                            <div><span className="text-muted-foreground">Journal: </span><span className="font-medium">{entry.journal_name}</span></div>
                            <div><span className="text-muted-foreground">Source: </span><span className="font-medium capitalize">{entry.source_type}</span></div>
                            <div><span className="text-muted-foreground">Status: </span><span className="font-medium capitalize">{entry.status}</span></div>
                            <div className="col-span-2 lg:col-span-1"><span className="text-muted-foreground">Memo: </span><span className="font-medium">{entry.memo || '—'}</span></div>
                          </div>

                          {/* Unbalanced warning */}
                          {unbalanced && (
                            <div className="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
                              <AlertTriangle className="h-4 w-4 shrink-0" />
                              Unbalanced entry
                            </div>
                          )}

                          {/* Lines sub-table */}
                          <div className="rounded border overflow-hidden">
                            <Table>
                              <TableHeader>
                                <TableRow className="bg-muted/50">
                                  <TableHead className="text-xs">Account Code</TableHead>
                                  <TableHead className="text-xs">Account Name</TableHead>
                                  <TableHead className="text-xs">Description</TableHead>
                                  <TableHead className="text-right text-xs">Debit</TableHead>
                                  <TableHead className="text-right text-xs">Credit</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {(entry.lines ?? []).map((line) => (
                                  <TableRow key={line.id} className="hover:bg-muted/50">
                                    <TableCell className="font-mono text-xs">{line.account_code}</TableCell>
                                    <TableCell className="text-xs">{line.account_name}</TableCell>
                                    <TableCell className="text-xs text-muted-foreground">{line.description || '—'}</TableCell>
                                    <TableCell className="text-right font-mono text-xs">{Number(line.debit_amount) > 0 ? fmt(Number(line.debit_amount)) : '—'}</TableCell>
                                    <TableCell className="text-right font-mono text-xs">{Number(line.credit_amount) > 0 ? fmt(Number(line.credit_amount)) : '—'}</TableCell>
                                  </TableRow>
                                ))}
                                {/* Totals footer */}
                                <TableRow className="bg-muted/50 font-semibold">
                                  <TableCell className="text-xs">Total</TableCell>
                                  <TableCell />
                                  <TableCell />
                                  <TableCell className="text-right font-mono text-xs">{fmt(lineDebitSum)}</TableCell>
                                  <TableCell className="text-right font-mono text-xs">{fmt(lineCreditSum)}</TableCell>
                                </TableRow>
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ),
                ];
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create Manual Entry Dialog */}
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
                  <SelectTrigger>
                    <SelectValue placeholder="Select journal…" />
                  </SelectTrigger>
                  <SelectContent>
                    {journals.map((j) => (
                      <SelectItem key={j.id} value={String(j.id)}>
                        {j.code} — {j.name}
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
              <Textarea
                value={formMemo}
                onChange={(e) => setFormMemo(e.target.value)}
                placeholder="Optional description…"
                rows={2}
              />
            </div>

            {/* Lines */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Journal Lines</Label>
                <Button type="button" variant="outline" size="sm" onClick={addLine} disabled={formLines.length >= 20}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Line
                </Button>
              </div>

              <div className="rounded border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="text-xs">Account ID</TableHead>
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
                          <Input
                            className="h-8 text-xs"
                            placeholder="Account ID"
                            value={line.account}
                            onChange={(e) => updateLine(idx, 'account', e.target.value)}
                          />
                        </TableCell>
                        <TableCell className="py-1 px-1">
                          <Input
                            className="h-8 text-xs"
                            placeholder="Description"
                            value={line.description}
                            onChange={(e) => updateLine(idx, 'description', e.target.value)}
                          />
                        </TableCell>
                        <TableCell className="py-1 px-1">
                          <Input
                            className="h-8 text-xs text-right"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            value={line.debit_amount}
                            onChange={(e) => updateLine(idx, 'debit_amount', e.target.value)}
                          />
                        </TableCell>
                        <TableCell className="py-1 px-1">
                          <Input
                            className="h-8 text-xs text-right"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            value={line.credit_amount}
                            onChange={(e) => updateLine(idx, 'credit_amount', e.target.value)}
                          />
                        </TableCell>
                        <TableCell className="py-1 pl-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-red-500"
                            onClick={() => removeLine(idx)}
                            disabled={formLines.length <= 1}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {/* Running totals */}
                    <TableRow className="bg-muted/30">
                      <TableCell colSpan={2} className="text-xs font-semibold text-right">Running Total</TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold">{fmt(runningDebit)}</TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold">{fmt(runningCredit)}</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              {/* Balance warning */}
              {runningDebit > 0 && !isBalanced && (
                <div className="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Entry is unbalanced — debits must equal credits
                </div>
              )}
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
