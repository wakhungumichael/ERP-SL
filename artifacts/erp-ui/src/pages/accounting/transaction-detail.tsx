import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BadgeCheck, BookOpen, RotateCcw, Send } from 'lucide-react';
import { useAuth } from '@/context/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ProcessFlow } from '@/components/workflow/process-flow';
import { RecordWorkspaceHeader } from '@/components/erp/record-workspace-header';

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

const SOURCE_LABELS: Record<string, string> = {
  invoice: 'Invoice',
  payment: 'Payment',
  transaction: 'Direct Cash Sale',
  manual: 'Manual',
  bill: 'Bill',
};

const SOURCE_COLORS: Record<string, string> = {
  invoice: 'bg-blue-100 text-blue-700',
  payment: 'bg-emerald-100 text-emerald-700',
  transaction: 'bg-indigo-100 text-indigo-700',
  manual: 'bg-gray-100 text-gray-700',
  bill: 'bg-amber-100 text-amber-700',
};

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  posted: 'bg-emerald-100 text-emerald-700',
  reversed: 'bg-red-100 text-red-700',
};

export default function AccountingTransactionDetail({ id }: { id: string }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['accounting-transaction-detail', id],
    enabled: !!token && !!id,
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api/accounting/transactions/${id}/`, {
        headers: { Authorization: 'Token ' + token },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Failed to load transaction');
      return body as JournalEntry;
    },
  });

  const entry = query.data;

  async function runAction(action: 'post' | 'reverse') {
    if (!entry) return;
    try {
      const res = await fetch(`${BASE_URL}/api/accounting/transactions/${entry.id}/${action}/`, {
        method: 'POST',
        headers: { Authorization: 'Token ' + token },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Failed to ${action} entry`);
      toast({ title: body.message || `Entry ${action}ed` });
      query.refetch();
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    } catch (error: any) {
      toast({ title: `Unable to ${action} entry`, description: error.message, variant: 'destructive' });
    }
  }

  if (query.isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading transaction workspace…</div>;
  }

  if (query.isError || !entry) {
    return (
      <div className="space-y-4 p-6">
        <RecordWorkspaceHeader
          backHref="/finance/transactions"
          title="Transaction"
          subtitle="The requested finance record could not be loaded."
        />
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Unable to load the selected transaction.
          </CardContent>
        </Card>
      </div>
    );
  }

  const lineDebitSum = (entry.lines ?? []).reduce((sum, line) => sum + Number(line.debit_amount ?? 0), 0);
  const lineCreditSum = (entry.lines ?? []).reduce((sum, line) => sum + Number(line.credit_amount ?? 0), 0);
  const unbalanced = Math.abs(Number(entry.debit_total) - Number(entry.credit_total)) > 0.001;

  return (
    <div className="space-y-6 p-6">
      <RecordWorkspaceHeader
        backHref="/finance/transactions"
        title={entry.entry_number}
        subtitle={`${entry.entry_date} · ${entry.journal_name} · ${SOURCE_LABELS[entry.source_type] ?? entry.source_type}`}
        badges={(
          <>
            <Badge className={STATUS_COLORS[entry.status] ?? 'bg-gray-100 text-gray-700'}>{entry.status}</Badge>
            <Badge className={SOURCE_COLORS[entry.source_type] ?? 'bg-gray-100 text-gray-700'}>
              {SOURCE_LABELS[entry.source_type] ?? entry.source_type}
            </Badge>
          </>
        )}
        actions={(
          <>
            {entry.status === 'draft' ? (
              <Button variant="outline" onClick={() => runAction('post')}>
                <Send className="mr-2 h-4 w-4" /> Post Entry
              </Button>
            ) : null}
            {entry.status !== 'reversed' ? (
              <Button variant="outline" onClick={() => runAction('reverse')}>
                <RotateCcw className="mr-2 h-4 w-4" /> Reverse Entry
              </Button>
            ) : null}
          </>
        )}
      />

      <ProcessFlow
        title="Finance Posting Workflow"
        description="Each journal entry should move through capture, validation, posting, and period reporting as one traceable accounting workflow."
        stages={[
          { label: 'Capture', active: true },
          { label: 'Validate', active: !unbalanced, current: unbalanced },
          { label: 'Post', active: ['posted', 'reversed'].includes(entry.status), current: entry.status === 'draft' },
          { label: 'Reporting', active: entry.status !== 'draft' },
        ]}
        actions={[
          {
            label: 'Open Ledger Reports',
            href: '/finance/reports',
            helper: 'Trace balances and period outcomes after journal posting.',
            tone: 'default',
          },
          {
            label: 'Posting Rules',
            href: '/finance/posting-rules',
            helper: 'Review automation and control points for future transactions.',
            tone: 'warning',
          },
          {
            label: 'Chart Of Accounts',
            href: '/finance/chart-of-accounts',
            helper: 'Review the accounts used by this journal entry.',
            tone: 'success',
          },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Debit Total</div><div className="mt-2 text-2xl font-semibold">{fmt(Number(entry.debit_total))}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Credit Total</div><div className="mt-2 text-2xl font-semibold">{fmt(Number(entry.credit_total))}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Journal</div><div className="mt-2 text-lg font-semibold">{entry.journal_name}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Source</div><div className="mt-2 text-lg font-semibold">{SOURCE_LABELS[entry.source_type] ?? entry.source_type}</div></CardContent></Card>
      </div>

      {unbalanced ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-medium">Unbalanced journal entry</div>
            <div className="text-sm">Debits and credits do not match. This entry should be reviewed before finance period close activities continue.</div>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
          <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-medium">Balanced entry</div>
            <div className="text-sm">The journal lines reconcile correctly and are ready for downstream reporting and audit review.</div>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_360px]">
        <Card>
          <CardHeader className="border-b bg-muted/20">
            <CardTitle className="text-base">Journal Lines</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account Code</TableHead>
                  <TableHead>Account Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entry.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="font-mono text-xs">{line.account_code}</TableCell>
                    <TableCell>{line.account_name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{line.description || '—'}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{Number(line.debit_amount) > 0 ? fmt(Number(line.debit_amount)) : '—'}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{Number(line.credit_amount) > 0 ? fmt(Number(line.credit_amount)) : '—'}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/30 font-semibold">
                  <TableCell>Total</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell className="text-right font-mono">{fmt(lineDebitSum)}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(lineCreditSum)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="border-b bg-muted/20">
              <CardTitle className="text-base">Record Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4 text-sm">
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Entry Number</span><span className="font-medium">{entry.entry_number}</span></div>
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Posting Date</span><span className="font-medium">{entry.entry_date}</span></div>
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Journal</span><span className="font-medium">{entry.journal_name}</span></div>
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Status</span><span className="font-medium capitalize">{entry.status}</span></div>
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Source</span><span className="font-medium">{SOURCE_LABELS[entry.source_type] ?? entry.source_type}</span></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b bg-muted/20">
              <CardTitle className="text-base">Finance Notes</CardTitle>
            </CardHeader>
            <CardContent className="p-4 text-sm text-muted-foreground">
              {entry.memo ? entry.memo : 'No memo was recorded for this entry.'}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b bg-muted/20">
              <CardTitle className="text-base">Next Best Action</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-4 text-sm">
              {entry.status === 'draft' ? (
                <>
                  <div className="font-medium">Post the transaction</div>
                  <p className="text-muted-foreground">Once validated, posting will move this entry into the finance books and make it visible in reporting and reconciliation.</p>
                </>
              ) : entry.status === 'posted' ? (
                <>
                  <div className="font-medium">Review downstream reporting</div>
                  <p className="text-muted-foreground">The transaction is already posted. Use reports, reconciliation, and period close tools for the next stage of finance control.</p>
                </>
              ) : (
                <>
                  <div className="font-medium">Review reversal trail</div>
                  <p className="text-muted-foreground">This entry has already been reversed, so the focus shifts to audit traceability and the active replacement entry where applicable.</p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
