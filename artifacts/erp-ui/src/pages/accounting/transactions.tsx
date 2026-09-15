import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BookOpen, CalendarRange, ChevronDown, ChevronLeft, ChevronRight, Plus, Search, Send, RotateCcw, X } from 'lucide-react';
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

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
  source_reference?: string;
  debit_total: number;
  credit_total: number;
  lines: JournalLine[];
  created_at?: string;
  updated_at?: string;
};

type Journal = { id: number; code: string; name: string; journal_type: string };
type AccountOption = { id: number; code: string; name: string; account_type: string; allow_posting?: boolean };
type FormLine = { account: string; description: string; debit_amount: string; credit_amount: string };
type EntryTab = 'all' | 'draft' | 'posted' | 'reversed' | 'recurring' | 'imported';
type AuditEvent = { id: number; event_type: string; status: string; actor_name?: string | null; note?: string; created_at: string };

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

  const [filterStatus, setFilterStatus] = useState(() => new URLSearchParams(window.location.search).get('status') || 'all');
  const [filterSource, setFilterSource] = useState(() => new URLSearchParams(window.location.search).get('source_type') || 'all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actingId, setActingId] = useState<number | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(() => Number(new URLSearchParams(window.location.search).get('entry')) || null);
  const [detailsDismissed, setDetailsDismissed] = useState(false);
  const [detailTab, setDetailTab] = useState<'details' | 'lines' | 'audit'>('details');
  const [entryTab, setEntryTab] = useState<EntryTab>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

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

  const { data: auditTrailData, isLoading: isAuditLoading } = useQuery({
    queryKey: ['journal-entry-audit', token, selectedEntryId],
    enabled: !!token && !!selectedEntryId,
    queryFn: async () => {
      const params = new URLSearchParams({ model_label: 'Platform_Core.JournalEntry', object_pk: String(selectedEntryId) });
      const response = await fetch(BASE_URL + '/api/platform/audit/record-trail/?' + params.toString(), { headers: { Authorization: 'Token ' + token } });
      if (!response.ok) throw new Error('audit trail unavailable');
      const payload = await response.json();
      return (payload?.data?.events ?? []) as AuditEvent[];
    },
    staleTime: 30_000,
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

  const tabbedEntries = useMemo(() => filteredEntries.filter((entry) => {
    if (entryTab === 'all') return true;
    if (entryTab === 'recurring') return entry.source_type === 'recurring';
    if (entryTab === 'imported') return entry.source_type === 'import';
    return entry.status === entryTab;
  }), [entryTab, filteredEntries]);
  const totalCount = tabbedEntries.length;
  const postedCount = filteredEntries.filter((e) => e.status === 'posted').length;
  const draftCount = filteredEntries.filter((e) => e.status === 'draft').length;
  const reversedCount = filteredEntries.filter((e) => e.status === 'reversed').length;
  const totalPostedDebits = filteredEntries
    .filter((e) => e.status === 'posted')
    .reduce((sum, e) => sum + Number(e.debit_total ?? 0), 0);
  const totalPostedCredits = filteredEntries
    .filter((e) => e.status === 'posted')
    .reduce((sum, e) => sum + Number(e.credit_total ?? 0), 0);
  const selectedEntry = entries.find((entry) => entry.id === selectedEntryId) ?? null;
  const auditEvents = auditTrailData ?? [];
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const paginatedEntries = tabbedEntries.slice((page - 1) * pageSize, page * pageSize);
  const pageStart = totalCount ? (page - 1) * pageSize + 1 : 0;
  const pageEnd = Math.min(page * pageSize, totalCount);

  useEffect(() => {
    if (entries.length && !detailsDismissed && !entries.some((entry) => entry.id === selectedEntryId)) {
      setSelectedEntryId(entries[0].id);
    }
  }, [detailsDismissed, entries, selectedEntryId]);

  useEffect(() => {
    setPage(1);
  }, [entryTab, filterDateFrom, filterDateTo, filterSource, filterStatus, pageSize, search]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

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
        status: 'draft',
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
      toast({ title: 'Journal entry saved as draft' });
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
    <div className="w-full space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Finance / General Ledger</p>
          <h1 className="text-2xl font-bold tracking-tight">Journal Entries</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create, review, and post balanced entries that flow into the general ledger.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={openCreate} className="h-10 font-bold uppercase tracking-wide">
            <Plus className="mr-2 h-4 w-4" /> Manual Entry
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" className="h-10 gap-2 font-semibold">More Actions <ChevronDown className="h-4 w-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild><Link href="/finance/reports">Open Financial Reports</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link href="/finance/chart-of-accounts">Open Chart of Accounts</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link href="/finance/posting-rules">Review Posting Rules</Link></DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => window.print()}>Print current view</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex gap-5 overflow-x-auto border-b px-1" role="tablist" aria-label="Journal entry status">
        {[
          ['all', 'All Entries'], ['draft', 'Drafts'], ['posted', 'Posted'], ['reversed', 'Reversed'], ['recurring', 'Recurring'], ['imported', 'Import Journals'],
        ].map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={entryTab === value} onClick={() => setEntryTab(value as EntryTab)} className={`shrink-0 border-b-2 px-1 pb-3 text-xs font-semibold transition-colors ${entryTab === value ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{label}</button>
        ))}
      </div>

      <ProcessFlow
        compact
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Total Entries</div><div className="mt-2 text-2xl font-semibold">{totalCount}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Posted</div><div className="mt-2 text-2xl font-semibold text-emerald-600">{postedCount}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Draft / Reversed</div><div className="mt-2 text-2xl font-semibold">{draftCount + reversedCount}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Posted Debits</div><div className="mt-2 text-xl font-semibold">{fmt(totalPostedDebits)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Posted Credits</div><div className="mt-2 text-xl font-semibold">{fmt(totalPostedCredits)}</div></CardContent></Card>
      </div>

      <div className="rounded-xl border-2 border-primary/40 bg-card p-1 shadow-sm">
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
          {(search || filterStatus !== 'all' || filterSource !== 'all' || filterDateFrom || filterDateTo) && <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-destructive" onClick={() => { setSearch(''); setFilterStatus('all'); setFilterSource('all'); setFilterDateFrom(''); setFilterDateTo(''); }}>Clear filters</Button>}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_310px]">
      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Journal Entries</CardTitle>
          <div className="text-sm text-muted-foreground">{totalCount} entries</div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Loading finance transactions…</div>
          ) : filteredEntries.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
              <BookOpen className="h-10 w-10 opacity-40" />
              <p className="text-sm">No transactions found for the selected filters.</p>
            </div>
          ) : (
            <Table className="min-w-[980px]">
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
                {paginatedEntries.map((entry) => (
                  <TableRow key={entry.id} className={`cursor-pointer hover:bg-muted/40 ${selectedEntryId === entry.id ? 'bg-primary/5' : ''}`} onClick={() => { setSelectedEntryId(entry.id); setDetailsDismissed(false); setDetailTab('details'); }}>
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
        {totalCount > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
          <span>Showing {pageStart}-{pageEnd} of {totalCount} entries</span>
          <div className="flex items-center gap-2"><Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}><SelectTrigger className="h-8 w-32 text-xs" aria-label="Records per page"><SelectValue /></SelectTrigger><SelectContent>{[10, 25, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size} records</SelectItem>)}</SelectContent></Select><Button variant="outline" size="icon" className="h-8 w-8" disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button><span className="min-w-16 text-center">{page} / {totalPages}</span><Button variant="outline" size="icon" className="h-8 w-8" disabled={page === totalPages} onClick={() => setPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button></div>
        </div>}
      </Card>

      <Card className="h-fit xl:sticky xl:top-4">
        <CardHeader className="flex flex-row items-start justify-between gap-3 border-b pb-4">
          <div>
            <CardTitle className="text-base">Journal Entry Details</CardTitle>
            {selectedEntry && <p className="mt-1 text-xs text-muted-foreground">{selectedEntry.entry_number}</p>}
          </div>
          {selectedEntry && <Badge className={STATUS_COLORS[selectedEntry.status] ?? 'bg-gray-100 text-gray-700'}>{selectedEntry.status}</Badge>}
          {selectedEntry && <Button variant="ghost" size="icon" className="-mr-2 -mt-2 h-8 w-8" onClick={() => { setSelectedEntryId(null); setDetailsDismissed(true); }} aria-label="Close entry details"><X className="h-4 w-4" /></Button>}
        </CardHeader>
        <CardContent className="p-0">
          {!selectedEntry ? (
            <div className="flex min-h-60 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground"><BookOpen className="h-8 w-8 opacity-40" />Select a journal entry to review its accounting details.</div>
          ) : (
            <>
              <div className="grid grid-cols-3 border-b px-2" role="tablist" aria-label="Journal entry details">
                <button type="button" role="tab" aria-selected={detailTab === 'details'} className={`border-b-2 px-1 py-3 text-xs font-bold ${detailTab === 'details' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`} onClick={() => setDetailTab('details')}>Details</button>
                <button type="button" role="tab" aria-selected={detailTab === 'lines'} className={`border-b-2 px-1 py-3 text-xs font-bold ${detailTab === 'lines' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`} onClick={() => setDetailTab('lines')}>Lines</button>
                <button type="button" role="tab" aria-selected={detailTab === 'audit'} className={`border-b-2 px-1 py-3 text-xs font-bold ${detailTab === 'audit' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`} onClick={() => setDetailTab('audit')}>Audit Trail</button>
              </div>
              {detailTab === 'details' ? (
                <dl className="space-y-3 p-4 text-xs">
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Date</dt><dd className="font-medium">{selectedEntry.entry_date}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Journal</dt><dd className="text-right font-medium">{selectedEntry.journal_name}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Source</dt><dd><Badge className={SOURCE_COLORS[selectedEntry.source_type] ?? 'bg-gray-100 text-gray-700'}>{SOURCE_LABELS[selectedEntry.source_type] ?? selectedEntry.source_type}</Badge></dd></div>
                  <div className="space-y-1 border-t pt-3"><dt className="text-muted-foreground">Memo</dt><dd className="leading-5">{selectedEntry.memo || 'No memo provided.'}</dd></div>
                  <div className="space-y-2 border-t pt-3"><div className="flex justify-between"><dt className="text-muted-foreground">Total debit</dt><dd className="font-mono font-semibold">{fmt(Number(selectedEntry.debit_total))}</dd></div><div className="flex justify-between"><dt className="text-muted-foreground">Total credit</dt><dd className="font-mono font-semibold">{fmt(Number(selectedEntry.credit_total))}</dd></div><div className="flex justify-between border-t pt-2"><dt className="font-medium">Balance</dt><dd className={`font-mono font-semibold ${Math.abs(Number(selectedEntry.debit_total) - Number(selectedEntry.credit_total)) < 0.001 ? 'text-emerald-600' : 'text-destructive'}`}>{Math.abs(Number(selectedEntry.debit_total) - Number(selectedEntry.credit_total)) < 0.001 ? 'Balanced' : 'Check totals'}</dd></div></div>
                </dl>
              ) : detailTab === 'lines' ? (
                <div className="divide-y">
                  {selectedEntry.lines.map((line) => <div key={line.id} className="space-y-1 p-4 text-xs"><p className="font-medium">{line.account_code} - {line.account_name}</p><p className="text-muted-foreground">{line.description || 'No line description'}</p><div className="flex justify-between font-mono"><span>Dr {fmt(Number(line.debit_amount))}</span><span>Cr {fmt(Number(line.credit_amount))}</span></div></div>)}
                </div>
              ) : (
                <div className="space-y-4 p-4 text-xs">
                  {isAuditLoading ? <p className="text-muted-foreground">Loading audit trail...</p> : auditEvents.length ? auditEvents.map((event) => <div key={event.id} className="border-l-2 border-primary/40 pl-3"><p className="font-semibold capitalize">{event.event_type.replace(/_/g, ' ')}</p><p className="mt-1 text-muted-foreground">{event.actor_name || 'System'} · {new Date(event.created_at).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}</p>{event.note && <p className="mt-1 leading-5 text-muted-foreground">{event.note}</p>}</div>) : <><div className="border-l-2 border-primary/40 pl-3"><p className="font-semibold">Entry created</p><p className="mt-1 text-muted-foreground">{selectedEntry.created_at ? new Date(selectedEntry.created_at).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }) : 'Timestamp unavailable'}</p></div><div className="border-l-2 border-muted pl-3"><p className="font-semibold capitalize">Current status: {selectedEntry.status}</p><p className="mt-1 text-muted-foreground">{selectedEntry.updated_at ? new Date(selectedEntry.updated_at).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }) : 'No later update recorded'}</p></div><p className="rounded-md bg-muted/50 p-3 leading-5 text-muted-foreground">No additional audit events have been recorded for this entry.</p></>}
                </div>
              )}
              <div className="flex gap-2 border-t p-4">
                <Link href={`/finance/transactions/${selectedEntry.id}`} className="flex-1"><Button variant="outline" size="sm" className="w-full">View Full Entry</Button></Link>
                {selectedEntry.status === 'draft' && <Button size="sm" onClick={() => handlePost(selectedEntry.id)} disabled={actingId === selectedEntry.id}>{actingId === selectedEntry.id ? 'Posting...' : 'Post'}</Button>}
                {selectedEntry.status !== 'reversed' && <Button variant="outline" size="sm" onClick={() => handleReverse(selectedEntry.id)} disabled={actingId === selectedEntry.id}>Reverse</Button>}
              </div>
            </>
          )}
        </CardContent>
      </Card>
      </div>

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
