import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '@/context/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ArrowUpRight, CalendarRange, CheckCircle2, ChevronLeft, ChevronRight, Download, Eye, FileBarChart2, Landmark, Link2, Lock, MoreHorizontal, Pencil, Printer, RefreshCw, Scale, Unlink, Wallet, X } from 'lucide-react';

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';
const PAGE_SIZE = 8;

const money = (value: number) =>
  'KES ' + Number(value ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const accountTypeLabel: Record<string, string> = {
  asset: 'Asset',
  liability: 'Liability',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expense',
};

const sourceTypeLabel: Record<string, string> = {
  invoice: 'Invoice',
  payment: 'Payment',
  bill: 'Bill',
  manual: 'Manual',
  transaction: 'Direct Cash Sale',
};

type ReportBalanceRow = {
  account_id: number | null;
  code: string;
  name: string;
  amount?: number;
  balance?: number;
  debit_total?: number;
  credit_total?: number;
  account_type?: string;
  account_group?: string;
  is_active?: boolean;
  opening_debit?: number;
  opening_credit?: number;
  movement_debit?: number;
  movement_credit?: number;
  closing_debit?: number;
  closing_credit?: number;
  display_amount: number;
  display_side: string;
  is_abnormal: boolean;
};

type TrialBalanceResponse = {
  date_from: string | null;
  date_to: string;
  period: AccountingPeriod | null;
  rows: Array<ReportBalanceRow>;
  summary: {
    total_debits: number;
    total_credits: number;
    balanced: boolean;
    opening_debit?: number;
    opening_credit?: number;
    movement_debit?: number;
    movement_credit?: number;
    closing_debit?: number;
    closing_credit?: number;
  };
};

type IncomeStatementResponse = {
  date_from: string;
  date_to: string;
  period: AccountingPeriod | null;
  income: Array<ReportBalanceRow>;
  expenses: Array<ReportBalanceRow>;
  summary: {
    total_income: number;
    total_expenses: number;
    net_income: number;
  };
};

type BalanceSheetResponse = {
  date_to: string;
  period: AccountingPeriod | null;
  assets: Array<ReportBalanceRow>;
  liabilities: Array<ReportBalanceRow>;
  equity: Array<ReportBalanceRow>;
  summary: {
    total_assets: number;
    total_liabilities: number;
    total_equity: number;
    balanced: boolean;
  };
  notes?: {
    balanced_definition?: string;
    negative_balances_possible?: boolean;
  };
};

type LedgerResponse = {
  account: { id: number; code: string; name: string; account_type: string };
  period: AccountingPeriod | null;
  date_from: string | null;
  date_to: string | null;
  opening_balance: number;
  entries: Array<{
    entry_id: number;
    entry_number: string;
    entry_date: string;
    journal: string;
    source_type: string;
    source_reference: string;
    memo: string;
    description: string;
    debit_amount: number;
    credit_amount: number;
    running_balance: number;
  }>;
  summary: {
    debit_total: number;
    credit_total: number;
    closing_balance: number;
  };
  monthly_trend: Array<{ label: string; amount: number }>;
};

type PeriodClosePreview = {
  period?: AccountingPeriod | null;
  period_start: string;
  period_end: string;
  retained_earnings_account: { id: number; code: string; name: string };
  lines: Array<{
    account_id: number;
    code: string;
    name: string;
    debit_amount: number;
    credit_amount: number;
  }>;
  totals: {
    debit_total: number;
    credit_total: number;
  };
  net_income: number;
  balanced: boolean;
  existing_close: boolean;
};

type AccountOption = {
  id: number;
  code: string;
  name: string;
  account_type: string;
  allow_posting?: boolean;
};

type FinancialYear = {
  id: number;
  name: string;
  code: string;
  start_date: string;
  end_date: string;
  status: string;
  is_active: boolean;
  periods_count: number;
};

type AccountingPeriod = {
  id: number;
  financial_year: number;
  financial_year_name: string;
  name: string;
  code: string;
  start_date: string;
  end_date: string;
  period_type: string;
  status: string;
  sequence_number: number;
  is_adjustment: boolean;
};

type PeriodListResponse = {
  results: AccountingPeriod[];
  count: number;
  page: number;
  page_size: number;
  total_pages: number;
};

type ComparativeIncomeResponse = {
  current: IncomeStatementResponse;
  comparison: IncomeStatementResponse;
  period: AccountingPeriod | null;
};

type ComparativeBalanceSheetResponse = {
  current: BalanceSheetResponse & { date_to: string };
  comparison: BalanceSheetResponse & { date_to: string };
  period: AccountingPeriod | null;
};

type RetainedEarningsRollforwardResponse = {
  account: { id: number; code: string; name: string };
  period: AccountingPeriod | null;
  period_start: string;
  period_end: string;
  opening_balance: number;
  direct_movements: number;
  net_income_transfer: number;
  closing_balance: number;
  entries: Array<{
    entry_id: number;
    entry_number: string;
    entry_date: string;
    memo: string;
    source_type: string;
    amount: number;
  }>;
};

type PeriodAuditLog = {
  id: number;
  financial_year_name: string | null;
  period_name: string | null;
  action: string;
  performed_by_name: string | null;
  note: string;
  created_at: string;
};

type ReconciliationSession = {
  id: number;
  account: number;
  account_code: string;
  account_name: string;
  financial_year: number | null;
  financial_year_name: string | null;
  period: number | null;
  period_name: string | null;
  name: string;
  code: string;
  statement_date_from: string;
  statement_date_to: string;
  statement_opening_balance: number;
  statement_closing_balance: number;
  notes: string;
  status: string;
  summary: {
    total_lines: number;
    matched_lines: number;
    ignored_lines: number;
    open_lines: number;
    matched_total: number;
    unmatched_total: number;
  };
};

type ReconciliationLine = {
  id: number;
  session: number;
  line_date: string;
  reference: string;
  description: string;
  amount: number;
  status: string;
  matched_journal_line: number | null;
  matched_entry_id: number | null;
  matched_entry_number: string | null;
  matched_entry_date: string | null;
  matched_entry_memo: string | null;
  matched_amount: number | null;
  notes: string;
};

type ReconciliationLinesResponse = {
  session: ReconciliationSession;
  book_closing_balance: number;
  results: ReconciliationLine[];
};

type ReconciliationCandidate = {
  journal_line_id: number;
  entry_id: number;
  entry_number: string;
  entry_date: string;
  journal_code: string;
  journal_name: string;
  source_type: string;
  source_reference: string;
  memo: string;
  description: string;
  signed_amount: number;
  amount_delta: number;
  date_delta_days: number;
  already_matched: boolean;
};

function getTodayISO() {
  return new Date().toISOString().slice(0, 10);
}

function getYearStartISO() {
  const now = new Date();
  return `${now.getFullYear()}-01-01`;
}

function paginate<T>(rows: T[], page: number, pageSize = PAGE_SIZE) {
  const totalPages = Math.max(Math.ceil(rows.length / pageSize), 1);
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    page: safePage,
    totalPages,
    total: rows.length,
  };
}

function TablePager({
  page,
  totalPages,
  onPageChange,
  pageSize,
  onPageSizeChange,
  totalRows,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  pageSize?: number;
  onPageSizeChange?: (pageSize: number) => void;
  totalRows?: number;
}) {
  return (
    <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
      <div className="text-muted-foreground">{typeof totalRows === 'number' ? `${totalRows} record${totalRows === 1 ? '' : 's'} · ` : ''}Page {page} of {totalPages}</div>
      <div className="flex items-center gap-2">
        {onPageSizeChange && <Select value={String(pageSize ?? PAGE_SIZE)} onValueChange={(value) => onPageSizeChange(Number(value))}><SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger><SelectContent>{[5, 10, 25, 50].map((size) => <SelectItem key={size} value={String(size)}>{size} / page</SelectItem>)}</SelectContent></Select>}
        <Button variant="outline" size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
          <ChevronLeft className="mr-1 h-4 w-4" /> Previous
        </Button>
        <Button variant="outline" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>
          Next <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function BalanceBadge({ row }: { row: ReportBalanceRow }) {
  if (!row.is_abnormal) {
    return (
      <Badge variant="secondary" className="capitalize">
        {row.display_side} balance
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="capitalize">
      Abnormal {row.display_side}
    </Badge>
  );
}

export default function AccountingReports() {
  const { token } = useAuth();
  const { toast } = useToast();
  const drilldown = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      type: params.get('drill'),
      search: params.get('search'),
      dateFrom: params.get('date_from'),
      dateTo: params.get('date_to'),
    };
  }, []);

  const [dateFrom, setDateFrom] = useState(() => new URLSearchParams(window.location.search).get('date_from') || getYearStartISO());
  const [dateTo, setDateTo] = useState(() => new URLSearchParams(window.location.search).get('date_to') || getTodayISO());
  const [activeTab, setActiveTab] = useState(() => new URLSearchParams(window.location.search).get('tab') || 'trial-balance');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [accountDrawerOpen, setAccountDrawerOpen] = useState(false);
  const [guidanceOpen, setGuidanceOpen] = useState(false);
  const [comparisonEnabled, setComparisonEnabled] = useState(true);
  const [accountPanelTab, setAccountPanelTab] = useState<'summary' | 'transactions' | 'documents' | 'analysis'>('summary');
  const [selectedFinancialYearId, setSelectedFinancialYearId] = useState('');
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('search') || '');
  const [tbPage, setTbPage] = useState(1);
  const [tbPageSize, setTbPageSize] = useState(10);
  const [tbTableSearch, setTbTableSearch] = useState('');
  const [tbAccountType, setTbAccountType] = useState('all');
  const [tbAccountGroup, setTbAccountGroup] = useState('all');
  const [tbAccountStatus, setTbAccountStatus] = useState('all');
  const [tbShowZeroBalance, setTbShowZeroBalance] = useState(false);
  const [tbViewBy, setTbViewBy] = useState<'account' | 'group'>('account');
  const [incomePage, setIncomePage] = useState(1);
  const [expensePage, setExpensePage] = useState(1);
  const [incomePageSize, setIncomePageSize] = useState(10);
  const [expensePageSize, setExpensePageSize] = useState(10);
  const [incomeTableSearch, setIncomeTableSearch] = useState('');
  const [expenseTableSearch, setExpenseTableSearch] = useState('');
  const [assetPage, setAssetPage] = useState(1);
  const [liabilityPage, setLiabilityPage] = useState(1);
  const [equityPage, setEquityPage] = useState(1);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [periodPage, setPeriodPage] = useState(1);
  const [reconciliationSessionPage, setReconciliationSessionPage] = useState(1);
  const [reconciliationLinePage, setReconciliationLinePage] = useState(1);
  const [candidatePage, setCandidatePage] = useState(1);
  const [previewingClose, setPreviewingClose] = useState(false);
  const [executingClose, setExecutingClose] = useState(false);
  const [creatingYear, setCreatingYear] = useState(false);
  const [creatingPeriod, setCreatingPeriod] = useState(false);
  const [creatingReconciliationSession, setCreatingReconciliationSession] = useState(false);
  const [creatingReconciliationLine, setCreatingReconciliationLine] = useState(false);
  const [matchingReconciliationLineId, setMatchingReconciliationLineId] = useState<number | null>(null);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [editingYear, setEditingYear] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState(false);
  const [yearDialogOpen, setYearDialogOpen] = useState(false);
  const [periodDialogOpen, setPeriodDialogOpen] = useState(false);
  const [createPeriodDialogOpen, setCreatePeriodDialogOpen] = useState(false);
  const [createReconciliationSessionDialogOpen, setCreateReconciliationSessionDialogOpen] = useState(false);
  const [createReconciliationLineDialogOpen, setCreateReconciliationLineDialogOpen] = useState(false);
  const [yearFormError, setYearFormError] = useState('');
  const [periodFormError, setPeriodFormError] = useState('');
  const [reconciliationFormError, setReconciliationFormError] = useState('');
  const [reconciliationLineFormError, setReconciliationLineFormError] = useState('');
  const [editingYearId, setEditingYearId] = useState<number | null>(null);
  const [editingPeriodId, setEditingPeriodId] = useState<number | null>(null);
  const [selectedReconciliationSessionId, setSelectedReconciliationSessionId] = useState('');
  const [selectedReconciliationLineId, setSelectedReconciliationLineId] = useState('');
  const [closePreview, setClosePreview] = useState<PeriodClosePreview | null>(null);
  const [reconciliationCandidates, setReconciliationCandidates] = useState<ReconciliationCandidate[]>([]);
  const [yearForm, setYearForm] = useState({
    name: `Financial Year ${new Date().getFullYear()}`,
    code: `FY${new Date().getFullYear()}`,
    start_date: getYearStartISO(),
    end_date: `${new Date().getFullYear()}-12-31`,
    status: 'open',
  });
  const [periodForm, setPeriodForm] = useState({
    financial_year: '',
    name: '',
    code: '',
    start_date: '',
    end_date: '',
    period_type: 'custom',
    status: 'draft',
    sequence_number: '1',
    is_adjustment: false,
  });
  const [reconciliationSessionForm, setReconciliationSessionForm] = useState({
    account: '',
    financial_year: '',
    period: '',
    name: '',
    code: '',
    statement_date_from: dateFrom,
    statement_date_to: dateTo,
    statement_opening_balance: '0.00',
    statement_closing_balance: '0.00',
    notes: '',
  });
  const [reconciliationLineForm, setReconciliationLineForm] = useState({
    line_date: dateTo,
    reference: '',
    description: '',
    amount: '0.00',
    notes: '',
  });

  const authHeaders = useMemo(() => ({ Authorization: `Token ${token}` }), [token]);

  const { data: dashboardSnapshot } = useQuery({
    queryKey: ['accounting-report-dashboard-snapshot', token],
    enabled: !!token,
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api/accounting/dashboard/`, { headers: authHeaders });
      if (!res.ok) throw new Error('Failed to load finance summary');
      return res.json();
    },
    staleTime: 60_000,
  });

  const { data: accountOptions = [] } = useQuery({
    queryKey: ['accounting-report-accounts', token],
    enabled: !!token,
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api/accounting/chart-of-accounts/?is_active=true`, {
        headers: authHeaders,
      });
      if (!res.ok) throw new Error('Failed to load accounts');
      return (await res.json()) as AccountOption[];
    },
  });

  const { data: financialYears = [], refetch: refetchYears } = useQuery({
    queryKey: ['accounting-financial-years', token],
    enabled: !!token,
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api/accounting/financial-years/`, { headers: authHeaders });
      if (!res.ok) throw new Error('Failed to load financial years');
      return (await res.json()) as FinancialYear[];
    },
  });

  const { data: periodsData, refetch: refetchPeriods } = useQuery({
    queryKey: ['accounting-periods', token, selectedFinancialYearId, periodPage],
    enabled: !!token,
    queryFn: async () => {
      const params = new URLSearchParams({
        page: '1',
        page_size: '100',
      });
      if (selectedFinancialYearId) params.set('financial_year_id', selectedFinancialYearId);
      const res = await fetch(`${BASE_URL}/api/accounting/periods/?${params.toString()}`, { headers: authHeaders });
      if (!res.ok) throw new Error('Failed to load periods');
      return (await res.json()) as PeriodListResponse;
    },
  });

  const allPeriods = periodsData?.results ?? [];
  const selectedPeriod = useMemo(
    () => allPeriods.find((period) => String(period.id) === selectedPeriodId) ?? null,
    [allPeriods, selectedPeriodId],
  );

  useEffect(() => {
    if (!selectedFinancialYearId && financialYears.length > 0) {
      const openYear = financialYears.find((year) => year.status === 'open') ?? financialYears[0];
      setSelectedFinancialYearId(String(openYear.id));
    }
  }, [financialYears, selectedFinancialYearId]);

  useEffect(() => {
    if (selectedPeriod) {
      setDateFrom(selectedPeriod.start_date);
      setDateTo(selectedPeriod.end_date);
    }
  }, [selectedPeriod]);

  const reportQueryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedPeriodId) {
      params.set('period_id', selectedPeriodId);
    } else {
      params.set('date_from', dateFrom);
      params.set('date_to', dateTo);
    }
    return params.toString();
  }, [dateFrom, dateTo, selectedPeriodId]);

  const { data: trialBalance, isLoading: tbLoading, refetch: refetchTrialBalance } = useQuery({
    queryKey: ['trial-balance-report', token, reportQueryParams, tbAccountType, tbAccountGroup, tbAccountStatus, tbShowZeroBalance],
    enabled: !!token,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedPeriodId) params.set('period_id', selectedPeriodId);
      else {
        params.set('date_from', dateFrom);
        params.set('date_to', dateTo);
      }
      if (tbAccountType !== 'all') params.set('account_type', tbAccountType);
      if (tbAccountGroup !== 'all') params.set('account_group', tbAccountGroup);
      if (tbAccountStatus !== 'all') params.set('is_active', tbAccountStatus === 'active' ? 'true' : 'false');
      if (tbShowZeroBalance) params.set('show_zero_balance', 'true');
      const res = await fetch(`${BASE_URL}/api/accounting/reports/trial-balance/?${params.toString()}`, { headers: authHeaders });
      if (!res.ok) throw new Error('Failed to load trial balance');
      return (await res.json()) as TrialBalanceResponse;
    },
  });

  const { data: incomeStatement, isLoading: isLoadingIncome, refetch: refetchIncome } = useQuery({
    queryKey: ['income-statement-report', token, reportQueryParams],
    enabled: !!token,
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api/accounting/reports/income-statement/?${reportQueryParams}`, { headers: authHeaders });
      if (!res.ok) throw new Error('Failed to load income statement');
      return (await res.json()) as IncomeStatementResponse;
    },
  });

  const { data: balanceSheet, isLoading: bsLoading, refetch: refetchBalanceSheet } = useQuery({
    queryKey: ['balance-sheet-report', token, selectedPeriodId, dateTo],
    enabled: !!token,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedPeriodId) params.set('period_id', selectedPeriodId);
      else params.set('date_to', dateTo);
      const res = await fetch(`${BASE_URL}/api/accounting/reports/balance-sheet/?${params.toString()}`, { headers: authHeaders });
      if (!res.ok) throw new Error('Failed to load balance sheet');
      return (await res.json()) as BalanceSheetResponse;
    },
  });

  const { data: comparativeIncome } = useQuery({
    queryKey: ['comparative-income-report', token, reportQueryParams],
    enabled: !!token,
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api/accounting/reports/income-statement/comparative/?${reportQueryParams}`, { headers: authHeaders });
      if (!res.ok) throw new Error('Failed to load comparative income statement');
      return (await res.json()) as ComparativeIncomeResponse;
    },
  });

  const { data: comparativeBalanceSheet } = useQuery({
    queryKey: ['comparative-balance-sheet-report', token, selectedPeriodId, dateTo],
    enabled: !!token,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedPeriodId) params.set('period_id', selectedPeriodId);
      else params.set('date_to', dateTo);
      const res = await fetch(`${BASE_URL}/api/accounting/reports/balance-sheet/comparative/?${params.toString()}`, { headers: authHeaders });
      if (!res.ok) throw new Error('Failed to load comparative balance sheet');
      return (await res.json()) as ComparativeBalanceSheetResponse;
    },
  });

  const { data: retainedRollforward } = useQuery({
    queryKey: ['retained-earnings-rollforward-report', token, reportQueryParams],
    enabled: !!token,
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api/accounting/reports/retained-earnings-rollforward/?${reportQueryParams}`, { headers: authHeaders });
      if (!res.ok) throw new Error('Failed to load retained earnings roll-forward');
      return (await res.json()) as RetainedEarningsRollforwardResponse;
    },
  });

  const { data: auditLogs = [], refetch: refetchAuditLogs } = useQuery({
    queryKey: ['period-audit-log', token, selectedFinancialYearId, selectedPeriodId],
    enabled: !!token,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedFinancialYearId) params.set('financial_year_id', selectedFinancialYearId);
      if (selectedPeriodId) params.set('period_id', selectedPeriodId);
      const res = await fetch(`${BASE_URL}/api/accounting/period-audit-log/?${params.toString()}`, { headers: authHeaders });
      if (!res.ok) throw new Error('Failed to load audit log');
      return (await res.json()) as PeriodAuditLog[];
    },
  });

  const { data: ledger, isLoading: ledgerLoading, refetch: refetchLedger } = useQuery({
    queryKey: ['general-ledger-report', token, selectedAccountId, reportQueryParams],
    enabled: !!token && !!selectedAccountId,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('account_id', selectedAccountId);
      if (selectedPeriodId) params.set('period_id', selectedPeriodId);
      else {
        params.set('date_from', dateFrom);
        params.set('date_to', dateTo);
      }
      const res = await fetch(`${BASE_URL}/api/accounting/reports/general-ledger/?${params.toString()}`, {
        headers: authHeaders,
      });
      if (!res.ok) throw new Error('Failed to load general ledger');
      return (await res.json()) as LedgerResponse;
    },
  });

  const { data: reconciliationSessions = [], refetch: refetchReconciliationSessions } = useQuery({
    queryKey: ['reconciliation-sessions', token],
    enabled: !!token,
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api/accounting/reconciliation/sessions/`, { headers: authHeaders });
      if (!res.ok) throw new Error('Failed to load reconciliation sessions');
      return (await res.json()) as ReconciliationSession[];
    },
  });

  const { data: reconciliationLinesData, refetch: refetchReconciliationLines } = useQuery({
    queryKey: ['reconciliation-lines', token, selectedReconciliationSessionId],
    enabled: !!token && !!selectedReconciliationSessionId,
    queryFn: async () => {
      const res = await fetch(`${BASE_URL}/api/accounting/reconciliation/sessions/${selectedReconciliationSessionId}/lines/`, {
        headers: authHeaders,
      });
      if (!res.ok) throw new Error('Failed to load reconciliation lines');
      return (await res.json()) as ReconciliationLinesResponse;
    },
  });

  const postingAccounts = useMemo(
    () => accountOptions.filter((account) => account.allow_posting ?? true),
    [accountOptions],
  );
  const reconciliationAccounts = useMemo(
    () => postingAccounts.filter((account) => account.account_type === 'asset'),
    [postingAccounts],
  );

  const searchTerm = search.trim().toLowerCase();
  const filterRows = <T extends { code: string; name: string }>(rows: T[]) =>
    rows.filter((row) => !searchTerm || `${row.code} ${row.name}`.toLowerCase().includes(searchTerm));

  const trialBalanceSearch = `${search} ${tbTableSearch}`.trim().toLowerCase();
  const trialBalanceFiltered = (trialBalance?.rows ?? []).filter((row) =>
    !trialBalanceSearch || `${row.code} ${row.name} ${row.account_group ?? ''} ${row.account_type ?? ''}`.toLowerCase().includes(trialBalanceSearch),
  );
  const trialBalanceGroups = useMemo(
    () => Array.from(new Set((trialBalance?.rows ?? []).map((row) => row.account_group).filter(Boolean) as string[])).sort(),
    [trialBalance],
  );
  const trialBalanceRows = useMemo(() => {
    const rows = [...trialBalanceFiltered];
    return rows.sort((left, right) => tbViewBy === 'group'
      ? `${left.account_group ?? ''} ${left.code}`.localeCompare(`${right.account_group ?? ''} ${right.code}`)
      : left.code.localeCompare(right.code));
  }, [trialBalanceFiltered, tbViewBy]);
  const trialBalanceTotals = useMemo(() => trialBalanceFiltered.reduce((totals, row) => ({
    opening_debit: totals.opening_debit + Number(row.opening_debit ?? 0),
    opening_credit: totals.opening_credit + Number(row.opening_credit ?? 0),
    movement_debit: totals.movement_debit + Number(row.movement_debit ?? 0),
    movement_credit: totals.movement_credit + Number(row.movement_credit ?? 0),
    closing_debit: totals.closing_debit + Number(row.closing_debit ?? 0),
    closing_credit: totals.closing_credit + Number(row.closing_credit ?? 0),
  }), { opening_debit: 0, opening_credit: 0, movement_debit: 0, movement_credit: 0, closing_debit: 0, closing_credit: 0 }), [trialBalanceFiltered]);
  const incomeFiltered = filterRows(incomeStatement?.income ?? []).filter((row) => !incomeTableSearch.trim() || `${row.code} ${row.name}`.toLowerCase().includes(incomeTableSearch.trim().toLowerCase()));
  const expenseFiltered = filterRows(incomeStatement?.expenses ?? []).filter((row) => !expenseTableSearch.trim() || `${row.code} ${row.name}`.toLowerCase().includes(expenseTableSearch.trim().toLowerCase()));
  const comparisonRows = useMemo(() => new Map([
    ...(comparativeIncome?.comparison.income ?? []),
    ...(comparativeIncome?.comparison.expenses ?? []),
  ].map((row) => [row.account_id, row])), [comparativeIncome]);
  const assetsFiltered = filterRows(balanceSheet?.assets ?? []);
  const liabilitiesFiltered = filterRows(balanceSheet?.liabilities ?? []);
  const equityFiltered = filterRows(balanceSheet?.equity ?? []);
  const ledgerFiltered = (ledger?.entries ?? []).filter((entry) =>
    !searchTerm ||
    `${entry.entry_number} ${entry.memo} ${entry.description} ${entry.source_reference}`.toLowerCase().includes(searchTerm),
  );
  const periodsFiltered = allPeriods.filter((period) =>
    !searchTerm || `${period.code} ${period.name} ${period.status}`.toLowerCase().includes(searchTerm),
  );
  const reconciliationSessionsFiltered = reconciliationSessions.filter((session) =>
    !searchTerm ||
    `${session.code} ${session.name} ${session.account_code} ${session.account_name} ${session.status}`.toLowerCase().includes(searchTerm),
  );
  const reconciliationLines = reconciliationLinesData?.results ?? [];
  const selectedReconciliationSession = reconciliationLinesData?.session
    ?? reconciliationSessions.find((session) => String(session.id) === selectedReconciliationSessionId)
    ?? null;
  const selectedReconciliationLine = reconciliationLines.find((line) => String(line.id) === selectedReconciliationLineId) ?? null;
  const reconciliationLinesFiltered = reconciliationLines.filter((line) =>
    !searchTerm ||
    `${line.reference} ${line.description} ${line.matched_entry_number ?? ''} ${line.status} ${line.amount}`.toLowerCase().includes(searchTerm),
  );
  const reconciliationCandidatesFiltered = reconciliationCandidates.filter((candidate) =>
    !searchTerm ||
    `${candidate.entry_number} ${candidate.memo} ${candidate.description} ${candidate.source_reference}`.toLowerCase().includes(searchTerm),
  );

  const tbPaged = paginate(trialBalanceRows, tbPage, tbPageSize);
  const incomePaged = paginate(incomeFiltered, incomePage, incomePageSize);
  const expensePaged = paginate(expenseFiltered, expensePage, expensePageSize);
  const assetPaged = paginate(assetsFiltered, assetPage);
  const liabilityPaged = paginate(liabilitiesFiltered, liabilityPage);
  const equityPaged = paginate(equityFiltered, equityPage);
  const ledgerPaged = paginate(ledgerFiltered, ledgerPage);
  const periodPaged = paginate(periodsFiltered, periodPage);
  const reconciliationSessionPaged = paginate(reconciliationSessionsFiltered, reconciliationSessionPage);
  const reconciliationLinePaged = paginate(reconciliationLinesFiltered, reconciliationLinePage);
  const candidatePaged = paginate(reconciliationCandidatesFiltered, candidatePage);

  useEffect(() => {
    setTbPage(1);
    setIncomePage(1);
    setExpensePage(1);
    setAssetPage(1);
    setLiabilityPage(1);
    setEquityPage(1);
    setLedgerPage(1);
    setReconciliationSessionPage(1);
    setReconciliationLinePage(1);
    setCandidatePage(1);
  }, [search, selectedPeriodId, dateFrom, dateTo, tbPageSize, tbTableSearch, tbAccountType, tbAccountGroup, tbAccountStatus, tbShowZeroBalance, incomePageSize, expensePageSize, incomeTableSearch, expenseTableSearch]);

  useEffect(() => {
    if (activeTab === 'income-statement' && !selectedAccountId && incomeFiltered[0]?.account_id) {
      setSelectedAccountId(String(incomeFiltered[0].account_id));
    }
  }, [activeTab, incomeFiltered, selectedAccountId]);

  useEffect(() => {
    if (!selectedReconciliationSessionId && reconciliationSessions.length > 0) {
      setSelectedReconciliationSessionId(String(reconciliationSessions[0].id));
    }
  }, [reconciliationSessions, selectedReconciliationSessionId]);

  function openAccount(accountId: number | null) {
    if (!accountId) return;
    setSelectedAccountId(String(accountId));
    setAccountPanelTab('summary');
    if (activeTab !== 'income-statement') setAccountDrawerOpen(true);
  }

  async function refreshAll() {
    await Promise.all([
      refetchTrialBalance(),
      refetchIncome(),
      refetchBalanceSheet(),
      refetchLedger(),
      refetchPeriods(),
      refetchYears(),
      refetchAuditLogs(),
      refetchReconciliationSessions(),
      refetchReconciliationLines(),
    ]);
  }

  function openCreateReconciliationSessionDialog() {
    setReconciliationSessionForm({
      account: selectedReconciliationSession ? String(selectedReconciliationSession.account) : (reconciliationAccounts[0] ? String(reconciliationAccounts[0].id) : ''),
      financial_year: selectedFinancialYearId,
      period: selectedPeriodId,
      name: selectedReconciliationSession?.account_name ? `${selectedReconciliationSession.account_name} reconciliation` : '',
      code: '',
      statement_date_from: dateFrom,
      statement_date_to: dateTo,
      statement_opening_balance: '0.00',
      statement_closing_balance: '0.00',
      notes: '',
    });
    setReconciliationFormError('');
    setCreateReconciliationSessionDialogOpen(true);
  }

  async function createReconciliationSession() {
    setCreatingReconciliationSession(true);
    setReconciliationFormError('');
    try {
      const res = await fetch(`${BASE_URL}/api/accounting/reconciliation/sessions/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          ...reconciliationSessionForm,
          account: Number(reconciliationSessionForm.account),
          financial_year: reconciliationSessionForm.financial_year ? Number(reconciliationSessionForm.financial_year) : null,
          period: reconciliationSessionForm.period ? Number(reconciliationSessionForm.period) : null,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || 'Failed to create reconciliation session');
      setCreateReconciliationSessionDialogOpen(false);
      setSelectedReconciliationSessionId(String(payload.id));
      toast({ title: 'Reconciliation session created', description: payload.code });
      await refetchReconciliationSessions();
      await refetchReconciliationLines();
      setActiveTab('reconciliation');
    } catch (error: any) {
      setReconciliationFormError(error.message);
      toast({ title: 'Create failed', description: error.message, variant: 'destructive' });
    } finally {
      setCreatingReconciliationSession(false);
    }
  }

  function openCreateReconciliationLineDialog() {
    setReconciliationLineForm({
      line_date: selectedReconciliationSession?.statement_date_to ?? dateTo,
      reference: '',
      description: '',
      amount: '0.00',
      notes: '',
    });
    setReconciliationLineFormError('');
    setCreateReconciliationLineDialogOpen(true);
  }

  async function createReconciliationLine() {
    if (!selectedReconciliationSessionId) return;
    setCreatingReconciliationLine(true);
    setReconciliationLineFormError('');
    try {
      const res = await fetch(`${BASE_URL}/api/accounting/reconciliation/sessions/${selectedReconciliationSessionId}/lines/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(reconciliationLineForm),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || 'Failed to add statement line');
      setCreateReconciliationLineDialogOpen(false);
      toast({ title: 'Statement line added' });
      await refetchReconciliationLines();
      await refetchReconciliationSessions();
    } catch (error: any) {
      setReconciliationLineFormError(error.message);
      toast({ title: 'Create failed', description: error.message, variant: 'destructive' });
    } finally {
      setCreatingReconciliationLine(false);
    }
  }

  async function loadReconciliationCandidates(lineId: number) {
    setSelectedReconciliationLineId(String(lineId));
    setLoadingCandidates(true);
    try {
      const res = await fetch(`${BASE_URL}/api/accounting/reconciliation/lines/${lineId}/candidates/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({}),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || 'Failed to load reconciliation candidates');
      setReconciliationCandidates((payload?.candidates ?? []) as ReconciliationCandidate[]);
    } catch (error: any) {
      toast({ title: 'Candidate lookup failed', description: error.message, variant: 'destructive' });
    } finally {
      setLoadingCandidates(false);
    }
  }

  async function matchReconciliationLine(lineId: number, journalLineId: number) {
    setMatchingReconciliationLineId(lineId);
    try {
      const res = await fetch(`${BASE_URL}/api/accounting/reconciliation/lines/${lineId}/match/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ journal_line_id: journalLineId }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || 'Failed to match statement line');
      toast({ title: 'Statement line matched', description: payload.matched_entry_number ?? 'Matched successfully' });
      await refetchReconciliationLines();
      await refetchReconciliationSessions();
      await loadReconciliationCandidates(lineId);
    } catch (error: any) {
      toast({ title: 'Match failed', description: error.message, variant: 'destructive' });
    } finally {
      setMatchingReconciliationLineId(null);
    }
  }

  async function unmatchReconciliationLine(lineId: number) {
    setMatchingReconciliationLineId(lineId);
    try {
      const res = await fetch(`${BASE_URL}/api/accounting/reconciliation/lines/${lineId}/unmatch/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({}),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || 'Failed to unmatch statement line');
      toast({ title: 'Statement line reopened', description: payload.reference || payload.description || 'Ready for rematch' });
      await refetchReconciliationLines();
      await refetchReconciliationSessions();
      await loadReconciliationCandidates(lineId);
    } catch (error: any) {
      toast({ title: 'Unmatch failed', description: error.message, variant: 'destructive' });
    } finally {
      setMatchingReconciliationLineId(null);
    }
  }

  async function setReconciliationLineStatus(lineId: number, status: 'open' | 'ignored') {
    setMatchingReconciliationLineId(lineId);
    try {
      const res = await fetch(`${BASE_URL}/api/accounting/reconciliation/lines/${lineId}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ status }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || 'Failed to update statement line');
      toast({ title: status === 'ignored' ? 'Statement line ignored' : 'Statement line reopened' });
      await refetchReconciliationLines();
      await refetchReconciliationSessions();
      if (selectedReconciliationLineId === String(lineId) && status === 'ignored') {
        setReconciliationCandidates([]);
      }
      if (selectedReconciliationLineId === String(lineId) && status === 'open') {
        await loadReconciliationCandidates(lineId);
      }
    } catch (error: any) {
      toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
    } finally {
      setMatchingReconciliationLineId(null);
    }
  }

  function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number>>) {
    const escape = (value: string | number) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [headers.map(escape).join(','), ...rows.map((row) => row.map(escape).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleExportCurrentView() {
    if (activeTab === 'trial-balance') {
      downloadCsv('trial-balance.csv', ['Code', 'Account', 'Type', 'Debits', 'Credits', 'Balance Side', 'Balance'], trialBalanceFiltered.map((row) => [
        row.code, row.name, accountTypeLabel[row.account_type ?? ''] ?? row.account_type ?? '', row.debit_total ?? 0, row.credit_total ?? 0, row.display_side, row.display_amount,
      ]));
      return;
    }
    if (activeTab === 'income-statement') {
      downloadCsv('income-statement.csv', ['Section', 'Code', 'Account', 'Balance Side', 'Amount'], [
        ...incomeFiltered.map((row) => ['Income', row.code, row.name, row.display_side, row.display_amount]),
        ...expenseFiltered.map((row) => ['Expense', row.code, row.name, row.display_side, row.display_amount]),
      ]);
      return;
    }
    if (activeTab === 'balance-sheet') {
      downloadCsv('balance-sheet.csv', ['Section', 'Code', 'Account', 'Balance Side', 'Amount'], [
        ...assetsFiltered.map((row) => ['Asset', row.code, row.name, row.display_side, row.display_amount]),
        ...liabilitiesFiltered.map((row) => ['Liability', row.code, row.name, row.display_side, row.display_amount]),
        ...equityFiltered.map((row) => ['Equity', row.code, row.name, row.display_side, row.display_amount]),
      ]);
      return;
    }
    if (activeTab === 'general-ledger') {
      downloadCsv('general-ledger.csv', ['Date', 'Entry', 'Journal', 'Source', 'Description', 'Debit', 'Credit', 'Running Balance'], ledgerFiltered.map((row) => [
        row.entry_date.slice(0, 10), row.entry_number, row.journal, sourceTypeLabel[row.source_type] ?? row.source_type, row.description || row.memo || row.source_reference, row.debit_amount, row.credit_amount, row.running_balance,
      ]));
      return;
    }
    if (activeTab === 'reconciliation') {
      downloadCsv('reconciliation-lines.csv', ['Date', 'Reference', 'Description', 'Amount', 'Status', 'Matched Entry', 'Matched Amount'], reconciliationLinesFiltered.map((row) => [
        row.line_date, row.reference, row.description, row.amount, row.status, row.matched_entry_number ?? '', row.matched_amount ?? '',
      ]));
      return;
    }
    downloadCsv('period-audit-log.csv', ['Financial Year', 'Period', 'Action', 'By', 'Note', 'Created'], auditLogs.map((row) => [
      row.financial_year_name ?? '', row.period_name ?? '', row.action, row.performed_by_name ?? '', row.note, row.created_at,
    ]));
  }

  function handlePrintCurrentView() {
    window.print();
  }

  async function previewPeriodClose(periodId?: string) {
    setPreviewingClose(true);
    try {
      const body = periodId
        ? { period_id: periodId }
        : selectedPeriodId
          ? { period_id: selectedPeriodId }
          : { date_from: dateFrom, date_to: dateTo };
      const res = await fetch(`${BASE_URL}/api/accounting/period-close/preview/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || 'Failed to preview period close');
      setClosePreview(payload as PeriodClosePreview);
      setActiveTab('period-close');
    } catch (error: any) {
      toast({ title: 'Preview failed', description: error.message, variant: 'destructive' });
    } finally {
      setPreviewingClose(false);
    }
  }

  async function executePeriodClose() {
    setExecutingClose(true);
    try {
      const body = selectedPeriodId ? { period_id: selectedPeriodId } : { date_from: dateFrom, date_to: dateTo };
      const res = await fetch(`${BASE_URL}/api/accounting/period-close/close/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || 'Failed to close period');
      toast({
        title: 'Period closed',
        description: payload?.entry_number ? `Closing entry ${payload.entry_number} posted.` : payload?.message,
      });
      await refreshAll();
      await previewPeriodClose();
    } catch (error: any) {
      toast({ title: 'Close failed', description: error.message, variant: 'destructive' });
    } finally {
      setExecutingClose(false);
    }
  }

  async function createFinancialYear() {
    setCreatingYear(true);
    setYearFormError('');
    try {
      const res = await fetch(`${BASE_URL}/api/accounting/financial-years/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ ...yearForm, auto_generate_periods: true }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || 'Failed to create financial year');
      toast({
        title: 'Financial year created',
        description: payload?.periods_created ? `${payload.periods_created} period(s) generated.` : 'Created successfully.',
      });
      await refetchYears();
      await refetchPeriods();
    } catch (error: any) {
      setYearFormError(error.message);
      toast({ title: 'Create failed', description: error.message, variant: 'destructive' });
    } finally {
      setCreatingYear(false);
    }
  }

  function openCreatePeriodDialog() {
    setPeriodForm({
      financial_year: selectedFinancialYearId || (financialYears[0] ? String(financialYears[0].id) : ''),
      name: '',
      code: '',
      start_date: '',
      end_date: '',
      period_type: 'custom',
      status: 'draft',
      sequence_number: '1',
      is_adjustment: false,
    });
    setPeriodFormError('');
    setCreatePeriodDialogOpen(true);
  }

  async function createPeriod() {
    setCreatingPeriod(true);
    setPeriodFormError('');
    try {
      const res = await fetch(`${BASE_URL}/api/accounting/periods/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          ...periodForm,
          financial_year: Number(periodForm.financial_year),
          sequence_number: Number(periodForm.sequence_number),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || 'Failed to create accounting period');
      toast({ title: 'Accounting period created' });
      setCreatePeriodDialogOpen(false);
      await refetchPeriods();
      await refetchAuditLogs();
    } catch (error: any) {
      setPeriodFormError(error.message);
      toast({ title: 'Create failed', description: error.message, variant: 'destructive' });
    } finally {
      setCreatingPeriod(false);
    }
  }

  function openEditYear(year: FinancialYear) {
    setEditingYearId(year.id);
    setYearForm({
      name: year.name,
      code: year.code,
      start_date: year.start_date,
      end_date: year.end_date,
      status: year.status,
    });
    setYearFormError('');
    setYearDialogOpen(true);
  }

  async function saveYearEdit() {
    if (!editingYearId) return;
    setEditingYear(true);
    setYearFormError('');
    try {
      const res = await fetch(`${BASE_URL}/api/accounting/financial-years/${editingYearId}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(yearForm),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || 'Failed to update financial year');
      toast({ title: 'Financial year updated' });
      setYearDialogOpen(false);
      await refetchYears();
      await refetchPeriods();
      await refetchAuditLogs();
    } catch (error: any) {
      setYearFormError(error.message);
      toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
    } finally {
      setEditingYear(false);
    }
  }

  function openEditPeriod(period: AccountingPeriod) {
    setEditingPeriodId(period.id);
    setPeriodForm({
      financial_year: String(period.financial_year),
      name: period.name,
      code: period.code,
      start_date: period.start_date,
      end_date: period.end_date,
      period_type: period.period_type,
      status: period.status,
      sequence_number: String(period.sequence_number),
      is_adjustment: period.is_adjustment,
    });
    setPeriodFormError('');
    setPeriodDialogOpen(true);
  }

  async function savePeriodEdit() {
    if (!editingPeriodId) return;
    setEditingPeriod(true);
    setPeriodFormError('');
    try {
      const res = await fetch(`${BASE_URL}/api/accounting/periods/${editingPeriodId}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          ...periodForm,
          financial_year: Number(periodForm.financial_year),
          sequence_number: Number(periodForm.sequence_number),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || 'Failed to update accounting period');
      toast({ title: 'Accounting period updated' });
      setPeriodDialogOpen(false);
      await refetchPeriods();
      await refetchAuditLogs();
    } catch (error: any) {
      setPeriodFormError(error.message);
      toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
    } finally {
      setEditingPeriod(false);
    }
  }

  async function runPeriodAction(periodId: number, action: 'open' | 'close') {
    try {
      const res = await fetch(`${BASE_URL}/api/accounting/periods/${periodId}/${action}/`, {
        method: 'POST',
        headers: authHeaders,
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || `Failed to ${action} period`);
      toast({ title: payload?.message || `Period ${action}ed successfully` });
      await refetchPeriods();
      await refetchYears();
      await refetchAuditLogs();
    } catch (error: any) {
      toast({ title: 'Action failed', description: error.message, variant: 'destructive' });
    }
  }

  async function lockPeriod(periodId: number) {
    try {
      const res = await fetch(`${BASE_URL}/api/accounting/periods/${periodId}/lock/`, {
        method: 'POST',
        headers: authHeaders,
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || 'Failed to lock period');
      toast({ title: payload?.message || 'Period locked successfully' });
      await refetchPeriods();
      await refetchAuditLogs();
    } catch (error: any) {
      toast({ title: 'Lock failed', description: error.message, variant: 'destructive' });
    }
  }

  async function generatePeriods(yearId: number) {
    try {
      const res = await fetch(`${BASE_URL}/api/accounting/financial-years/${yearId}/generate-periods/`, {
        method: 'POST',
        headers: authHeaders,
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || 'Failed to generate periods');
      toast({ title: 'Periods generated', description: payload?.message });
      await refetchPeriods();
      await refetchYears();
    } catch (error: any) {
      toast({ title: 'Generation failed', description: error.message, variant: 'destructive' });
    }
  }

  const reportRefreshing = tbLoading || isLoadingIncome || bsLoading;

  return (
    <div className="w-full space-y-5 p-4 md:p-6">
      <div className="flex flex-col gap-4 border-b pb-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Financial Reports</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Analyze financial position, performance, and underlying transactions.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="space-y-2">
            <Label>Financial Year</Label>
            <Select value={selectedFinancialYearId || undefined} onValueChange={(value) => {
              setSelectedFinancialYearId(value);
              setSelectedPeriodId('');
              setPeriodPage(1);
            }}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder="Choose financial year" />
              </SelectTrigger>
              <SelectContent>
                {financialYears.map((year) => (
                  <SelectItem key={year.id} value={String(year.id)}>
                    {year.code} • {year.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Report Period</Label>
            <Select value={selectedPeriodId || 'custom'} onValueChange={(value) => setSelectedPeriodId(value === 'custom' ? '' : value)}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Custom dates" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="custom">Custom dates</SelectItem>
                {allPeriods.map((period) => (
                  <SelectItem key={period.id} value={String(period.id)}>
                    {period.code} • {period.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Comparison</Label>
            <Select value={comparisonEnabled ? 'previous' : 'none'} onValueChange={(value) => setComparisonEnabled(value === 'previous')}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="previous">Previous comparable period</SelectItem><SelectItem value="none">No comparison</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="report-date-from">From</Label>
            <Input id="report-date-from" type="date" value={dateFrom} onChange={(e) => {
              setDateFrom(e.target.value);
              setSelectedPeriodId('');
            }} className="w-44" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="report-date-to">To / As Of</Label>
            <Input id="report-date-to" type="date" value={dateTo} onChange={(e) => {
              setDateTo(e.target.value);
              setSelectedPeriodId('');
            }} className="w-44" />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        {activeTab !== 'trial-balance' && <div className="flex flex-wrap gap-3">
          <div className="space-y-2">
            <Label htmlFor="report-search">Search</Label>
            <Input
              id="report-search"
              placeholder="Search accounts, codes, entries, periods"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-80"
            />
          </div>
        </div>}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={refreshAll}>
            <RefreshCw className="mr-1 h-4 w-4" /> {reportRefreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button variant={comparisonEnabled ? 'secondary' : 'outline'} onClick={() => setComparisonEnabled((enabled) => !enabled)}><Scale className="mr-1 h-4 w-4" /> Compare Period</Button>
          <Button onClick={handleExportCurrentView}><Download className="mr-1 h-4 w-4" /> Export</Button>
          <Button variant="outline" onClick={handlePrintCurrentView}><Printer className="mr-1 h-4 w-4" /> Print</Button>
        </div>
      </div>

      {drilldown.type && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          <div>
            <p className="font-semibold">Dashboard drill-down</p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs"><span className="rounded-full border bg-background px-2 py-1">Income Statement</span><span className="rounded-full border bg-background px-2 py-1">{drilldown.type === 'expense-category' ? `Expense: ${drilldown.search || 'selected category'}` : drilldown.type === 'expenses' ? 'Expenses' : drilldown.type === 'profit' ? 'Profit and loss' : 'Revenue'}</span>{drilldown.dateFrom && <span className="rounded-full border bg-background px-2 py-1">From {drilldown.dateFrom}</span>}{drilldown.dateTo && <span className="rounded-full border bg-background px-2 py-1">To {drilldown.dateTo}</span>}</div>
          </div>
          <div className="flex gap-2"><Link href="/finance/overview" className="rounded-md border bg-background px-3 py-2 text-xs font-semibold hover:border-primary hover:text-primary">Back to overview</Link><Link href="/finance/reports" className="rounded-md border bg-background px-3 py-2 text-xs font-semibold hover:border-primary hover:text-primary">Clear drill-down</Link></div>
        </div>
      )}

      {activeTab !== 'trial-balance' && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: 'Revenue (Period)', value: dashboardSnapshot?.transactions?.total_charge_this_month ?? incomeStatement?.summary?.total_income ?? 0, href: `/finance/reports?tab=income-statement&drill=revenue&date_from=${dateFrom}&date_to=${dateTo}`, tone: 'text-emerald-600 bg-emerald-100' },
          { label: 'Total Invoiced', value: dashboardSnapshot?.invoices?.total_invoiced ?? 0, href: '/finance/receivables?status=issued', tone: 'text-blue-600 bg-blue-100' },
          { label: 'Collected', value: dashboardSnapshot?.invoices?.total_paid ?? 0, href: '/finance/receivables?status=paid', tone: 'text-emerald-600 bg-emerald-100' },
          { label: 'Outstanding', value: dashboardSnapshot?.invoices?.outstanding ?? 0, href: '/finance/receivables?status=overdue', tone: 'text-orange-600 bg-orange-100' },
          { label: 'Profit (Period)', value: incomeStatement?.summary?.net_income ?? 0, href: `/finance/reports?tab=income-statement&drill=profit&date_from=${dateFrom}&date_to=${dateTo}`, tone: 'text-violet-600 bg-violet-100' },
        ].map((metric) => <Link key={metric.label} href={metric.href} className="group"><Card className="h-full shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"><CardContent className="flex items-center justify-between p-4"><div><p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{metric.label}</p><p className="mt-2 font-mono text-lg font-black">{money(metric.value)}</p><p className="mt-1 text-[10px] font-medium text-primary">View details <ArrowUpRight className="inline h-3 w-3" /></p></div><div className={`rounded-full p-3 ${metric.tone}`}><Landmark className="h-5 w-5" /></div></CardContent></Card></Link>)}
      </div>}

      {activeTab !== 'trial-balance' && <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-4 py-2.5">
        <div className="text-xs text-muted-foreground"><span className="font-semibold text-foreground">Report status:</span> {trialBalance?.summary?.balanced ? 'Trial balance is balanced.' : 'Trial balance needs review.'} {selectedPeriod ? `${selectedPeriod.code} is ${selectedPeriod.status}.` : 'Using custom dates.'}</div>
        <Button variant="ghost" size="sm" className="text-xs" onClick={() => setGuidanceOpen((open) => !open)}>{guidanceOpen ? 'Hide guidance' : 'Report guidance'}</Button>
      </div>}
      {guidanceOpen && <Card className="border-sky-200 bg-sky-50/60 shadow-sm"><CardContent className="space-y-2 p-4 text-sm text-slate-700"><p className="font-semibold">Report Guidance</p><p>A trial balance is balanced when total debits equal total credits. A balance sheet is balanced when assets equal liabilities plus equity.</p><p>Negative rows can be valid for contra balances or current-period losses reducing equity.</p></CardContent></Card>}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <div className="flex items-center justify-between gap-3 border-b">
          <TabsList className="flex h-auto max-w-full flex-1 justify-start gap-1 overflow-x-auto rounded-none bg-transparent p-0">
            {[["trial-balance", "Trial Balance"], ["income-statement", "Income Statement"], ["balance-sheet", "Balance Sheet"], ["general-ledger", "General Ledger"], ["reconciliation", "Reconciliation"], ["period-close", "Period Close"]].map(([value, label]) => <TabsTrigger key={value} value={value} className="shrink-0 rounded-none border-b-2 border-transparent px-3 py-3 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none">{label}</TabsTrigger>)}
          </TabsList>
          <Button variant="outline" size="sm" className="shrink-0 text-xs" onClick={() => setGuidanceOpen((open) => !open)}>Report Guidance</Button>
        </div>

        <TabsContent value="trial-balance" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              { label: 'Trial Balance', value: trialBalance?.summary?.balanced ? 'Balanced' : 'Review needed', detail: trialBalance?.summary?.balanced ? 'Debits equal credits' : 'Debits and credits differ', tone: 'text-emerald-600 bg-emerald-100' },
              { label: 'Total Debits', value: money(trialBalanceTotals.closing_debit), detail: `Across ${trialBalanceFiltered.length} accounts`, tone: 'text-blue-600 bg-blue-100' },
              { label: 'Total Credits', value: money(trialBalanceTotals.closing_credit), detail: `Across ${trialBalanceFiltered.length} accounts`, tone: 'text-violet-600 bg-violet-100' },
              { label: 'Net Difference', value: money(Math.abs(trialBalanceTotals.closing_debit - trialBalanceTotals.closing_credit)), detail: trialBalanceTotals.closing_debit === trialBalanceTotals.closing_credit ? 'No imbalance detected' : 'Investigate before close', tone: 'text-orange-600 bg-orange-100' },
              { label: 'Period Status', value: selectedPeriod?.status === 'closed' ? 'Closed' : 'Open', detail: selectedPeriod ? selectedPeriod.name : `${dateFrom} to ${dateTo}`, tone: 'text-rose-600 bg-rose-100' },
            ].map((metric) => <Card key={metric.label} className="shadow-sm"><CardContent className="flex items-center gap-3 p-4"><div className={`rounded-full p-3 ${metric.tone}`}><Scale className="h-5 w-5" /></div><div><p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{metric.label}</p><p className="mt-1 font-mono text-base font-black">{metric.value}</p><p className="mt-1 text-[10px] text-muted-foreground">{metric.detail}</p></div></CardContent></Card>)}
          </div>

          <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <Input aria-label="Search trial balance accounts" value={tbTableSearch} onChange={(event) => setTbTableSearch(event.target.value)} placeholder="Search accounts, codes, descriptions..." className="h-9 min-w-[220px] flex-1 xl:max-w-sm" />
              <Select value={tbAccountType} onValueChange={setTbAccountType}><SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder="All account types" /></SelectTrigger><SelectContent><SelectItem value="all">All account types</SelectItem>{Object.entries(accountTypeLabel).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
              <Select value={tbAccountGroup} onValueChange={setTbAccountGroup}><SelectTrigger className="h-9 w-[170px]"><SelectValue placeholder="All account groups" /></SelectTrigger><SelectContent><SelectItem value="all">All account groups</SelectItem>{trialBalanceGroups.map((group) => <SelectItem key={group} value={group}>{group}</SelectItem>)}</SelectContent></Select>
              <Select value={tbAccountStatus} onValueChange={setTbAccountStatus}><SelectTrigger className="h-9 w-[135px]"><SelectValue placeholder="All statuses" /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent></Select>
              <label className="flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-medium"><input type="checkbox" checked={tbShowZeroBalance} onChange={(event) => setTbShowZeroBalance(event.target.checked)} className="accent-primary" /> Show zero balance</label>
              <Button variant="outline" size="sm" onClick={() => { setTbTableSearch(''); setTbAccountType('all'); setTbAccountGroup('all'); setTbAccountStatus('all'); setTbShowZeroBalance(false); }}>Clear filters</Button>
            </div>
            <div className="flex items-center gap-3 text-xs font-medium"><span className="text-muted-foreground">View by:</span><label className="flex items-center gap-1.5"><input type="radio" name="trial-balance-view" checked={tbViewBy === 'account'} onChange={() => setTbViewBy('account')} className="accent-primary" /> Account</label><label className="flex items-center gap-1.5"><input type="radio" name="trial-balance-view" checked={tbViewBy === 'group'} onChange={() => setTbViewBy('group')} className="accent-primary" /> Account group</label></div>
          </div>

          <Card className="overflow-hidden shadow-sm">
            <CardHeader className="border-b py-3"><div className="flex items-center justify-between"><div><CardTitle className="text-sm font-bold uppercase tracking-widest">Trial Balance</CardTitle><CardDescription>Opening, period movement, and closing balances. Select an account to inspect its ledger.</CardDescription></div><Badge variant={trialBalance?.summary?.balanced ? 'default' : 'destructive'}>{trialBalance?.summary?.balanced ? 'Balanced' : 'Review needed'}</Badge></div></CardHeader>
            <div className="overflow-x-auto">
              <Table className="min-w-[1250px]">
                <TableHeader>
                  <TableRow className="bg-muted/30"><TableHead rowSpan={2}>Code</TableHead><TableHead rowSpan={2}>Account</TableHead><TableHead rowSpan={2}>Account Type</TableHead><TableHead rowSpan={2}>Account Group</TableHead><TableHead colSpan={2} className="text-center">Opening Balance (KES)</TableHead><TableHead colSpan={2} className="text-center">Movement (KES)</TableHead><TableHead colSpan={2} className="text-center">Closing Balance (KES)</TableHead><TableHead rowSpan={2} className="w-24 text-right">Action</TableHead></TableRow>
                  <TableRow className="bg-muted/30"><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {tbPaged.rows.length === 0 ? <TableRow><TableCell colSpan={11} className="py-10 text-center text-sm text-muted-foreground">{tbLoading ? 'Loading trial balance...' : 'No accounts match the selected filters.'}</TableCell></TableRow> : tbPaged.rows.map((row) => <TableRow key={row.account_id ?? row.code} className="cursor-pointer hover:bg-muted/40" onClick={() => openAccount(row.account_id)}><TableCell className="font-mono text-xs">{row.code}</TableCell><TableCell className="font-medium"><button type="button" className="text-left text-primary hover:underline">{row.name}</button></TableCell><TableCell className="text-xs">{accountTypeLabel[row.account_type ?? ''] ?? row.account_type}</TableCell><TableCell className="text-xs text-muted-foreground">{row.account_group}</TableCell><TableCell className="text-right font-mono text-xs">{money(row.opening_debit ?? 0)}</TableCell><TableCell className="text-right font-mono text-xs">{money(row.opening_credit ?? 0)}</TableCell><TableCell className="text-right font-mono text-xs">{money(row.movement_debit ?? 0)}</TableCell><TableCell className="text-right font-mono text-xs">{money(row.movement_credit ?? 0)}</TableCell><TableCell className="text-right font-mono text-xs">{money(row.closing_debit ?? 0)}</TableCell><TableCell className="text-right font-mono text-xs">{money(row.closing_credit ?? 0)}</TableCell><TableCell className="text-right"><Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); openAccount(row.account_id); }}><Eye className="mr-1 h-3.5 w-3.5" /> View</Button></TableCell></TableRow>)}
                  <TableRow className="bg-muted/50 font-semibold"><TableCell /><TableCell>Totals</TableCell><TableCell /><TableCell /><TableCell className="text-right font-mono text-xs">{money(trialBalanceTotals.opening_debit)}</TableCell><TableCell className="text-right font-mono text-xs">{money(trialBalanceTotals.opening_credit)}</TableCell><TableCell className="text-right font-mono text-xs">{money(trialBalanceTotals.movement_debit)}</TableCell><TableCell className="text-right font-mono text-xs">{money(trialBalanceTotals.movement_credit)}</TableCell><TableCell className="text-right font-mono text-xs">{money(trialBalanceTotals.closing_debit)}</TableCell><TableCell className="text-right font-mono text-xs">{money(trialBalanceTotals.closing_credit)}</TableCell><TableCell /></TableRow>
                </TableBody>
              </Table>
            </div>
            <TablePager page={tbPaged.page} totalPages={tbPaged.totalPages} onPageChange={setTbPage} pageSize={tbPageSize} onPageSizeChange={setTbPageSize} totalRows={tbPaged.total} />
          </Card>
        </TabsContent>

        <TabsContent value="income-statement">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.5fr)]">
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <Card className="border-blue-200 bg-blue-50/50 shadow-sm"><CardContent className="p-4"><p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Current Period</p><p className="mt-2 font-mono text-lg font-black">{money(comparativeIncome?.current.summary.net_income ?? 0)}</p><p className="mt-1 text-[11px] text-muted-foreground">{comparativeIncome?.current.date_from} to {comparativeIncome?.current.date_to}</p></CardContent></Card>
                <Card className="border-emerald-200 bg-emerald-50/50 shadow-sm"><CardContent className="p-4"><p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Comparison Period</p><p className="mt-2 font-mono text-lg font-black">{money(comparativeIncome?.comparison.summary.net_income ?? 0)}</p><p className="mt-1 text-[11px] text-muted-foreground">{comparativeIncome?.comparison.date_from} to {comparativeIncome?.comparison.date_to}</p></CardContent></Card>
                <Card className="border-violet-200 bg-violet-50/50 shadow-sm"><CardContent className="p-4"><p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Variance</p><p className="mt-2 font-mono text-lg font-black">{money((comparativeIncome?.current.summary.net_income ?? 0) - (comparativeIncome?.comparison.summary.net_income ?? 0))}</p><p className="mt-1 text-[11px] text-muted-foreground">Current period minus comparison</p></CardContent></Card>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input aria-label="Search revenue accounts" value={incomeTableSearch} onChange={(event) => setIncomeTableSearch(event.target.value)} placeholder="Search revenue accounts..." className="h-9 text-xs" />
                <Input aria-label="Search expense accounts" value={expenseTableSearch} onChange={(event) => setExpenseTableSearch(event.target.value)} placeholder="Search expense accounts..." className="h-9 text-xs" />
              </div>
              {[{ title: 'Revenue', rows: incomePaged.rows, totalRows: incomeFiltered.length, total: incomeStatement?.summary?.total_income ?? 0, className: 'text-emerald-600', page: incomePaged.page, totalPages: incomePaged.totalPages, pageSize: incomePageSize, setPage: setIncomePage, setPageSize: setIncomePageSize }, { title: 'Expenses', rows: expensePaged.rows, totalRows: expenseFiltered.length, total: incomeStatement?.summary?.total_expenses ?? 0, className: 'text-orange-600', page: expensePaged.page, totalPages: expensePaged.totalPages, pageSize: expensePageSize, setPage: setExpensePage, setPageSize: setExpensePageSize }].map((section) => <Card key={section.title} className="overflow-hidden shadow-sm"><CardHeader className="border-b py-3"><CardTitle className={`text-xs font-bold uppercase tracking-wide ${section.className}`}>{section.title}</CardTitle></CardHeader><div className="overflow-x-auto"><Table className="min-w-[790px]"><TableHeader><TableRow className="bg-muted/40"><TableHead>Account Code</TableHead><TableHead>Account Name</TableHead><TableHead className="text-right">Current Period</TableHead><TableHead className="text-right">% of {section.title}</TableHead><TableHead className="text-right">Comparison</TableHead><TableHead className="text-right">Variance</TableHead><TableHead className="text-right">Variance %</TableHead></TableRow></TableHeader><TableBody>{section.rows.length ? section.rows.map((row) => { const previous = Number(comparisonRows.get(row.account_id)?.display_amount ?? 0); const current = Number(row.display_amount ?? 0); const variance = current - previous; const share = section.total ? (current / Number(section.total)) * 100 : 0; const variancePercent = previous ? (variance / Math.abs(previous)) * 100 : 0; return <TableRow key={row.account_id ?? row.code} className="cursor-pointer hover:bg-muted/40" onClick={() => openAccount(row.account_id)}><TableCell className="font-mono text-xs">{row.code}</TableCell><TableCell className="font-medium"><button type="button" className="text-left hover:text-primary hover:underline">{row.name}</button></TableCell><TableCell className="text-right font-mono text-xs">{money(current)}</TableCell><TableCell className="text-right text-xs">{share.toFixed(1)}%</TableCell><TableCell className="text-right font-mono text-xs">{money(previous)}</TableCell><TableCell className={`text-right font-mono text-xs ${variance >= 0 ? section.title === 'Revenue' ? 'text-emerald-600' : 'text-orange-600' : 'text-destructive'}`}>{money(variance)}</TableCell><TableCell className="text-right text-xs">{previous ? `${variancePercent >= 0 ? '+' : ''}${variancePercent.toFixed(1)}%` : '—'}</TableCell></TableRow>; }) : <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">{isLoadingIncome ? 'Loading statement...' : 'No rows found for the selected filters.'}</TableCell></TableRow>}<TableRow className="bg-muted/40"><TableCell /><TableCell className="font-semibold">Total {section.title}</TableCell><TableCell className="text-right font-mono font-semibold">{money(section.total)}</TableCell><TableCell className="text-right font-semibold">100%</TableCell><TableCell /><TableCell /><TableCell /></TableRow></TableBody></Table></div><TablePager page={section.page} totalPages={section.totalPages} onPageChange={section.setPage} pageSize={section.pageSize} onPageSizeChange={section.setPageSize} totalRows={section.totalRows} /></Card>)}
              <Card className="border-red-200 bg-red-50/50 shadow-sm"><CardContent className="flex items-center justify-between p-4"><span className="text-xs font-bold uppercase tracking-wide text-red-600">Net Income (Loss)</span><span className="font-mono font-black text-red-600">{money(incomeStatement?.summary?.net_income ?? 0)}</span></CardContent></Card>
            </div>
            <Card className="h-fit xl:sticky xl:top-4">
              <CardHeader className="flex flex-row items-center justify-between border-b py-4"><CardTitle className="text-base">{ledger?.account ? `${ledger.account.name} (${ledger.account.code})` : 'Account Analysis'}</CardTitle>{ledger?.account && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedAccountId('')} aria-label="Clear account selection"><X className="h-4 w-4" /></Button>}</CardHeader>
              <CardContent className="p-0">{ledger?.account ? <>
                <div className="grid grid-cols-4 border-b" role="tablist" aria-label="Account analysis">
                  {(['summary', 'transactions', 'documents', 'analysis'] as const).map((tab) => <button key={tab} type="button" role="tab" aria-selected={accountPanelTab === tab} onClick={() => setAccountPanelTab(tab)} className={`border-b-2 px-1 py-3 text-[10px] font-bold capitalize ${accountPanelTab === tab ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}>{tab}</button>)}
                </div>
                <div className="space-y-4 p-4">
                  {accountPanelTab === 'summary' && <><div className="grid grid-cols-3 divide-x rounded-lg border"><div className="p-3"><p className="text-[10px] uppercase text-muted-foreground">Opening</p><p className="mt-1 font-mono text-xs font-bold">{money(ledger.opening_balance)}</p></div><div className="p-3"><p className="text-[10px] uppercase text-muted-foreground">Movement</p><p className="mt-1 font-mono text-xs font-bold">{money(ledger.summary.credit_total - ledger.summary.debit_total)}</p></div><div className="p-3"><p className="text-[10px] uppercase text-muted-foreground">Closing</p><p className="mt-1 font-mono text-xs font-bold">{money(ledger.summary.closing_balance)}</p></div></div><div className="grid grid-cols-4 gap-2 text-xs"><div><p className="text-muted-foreground">Type</p><p className="mt-1 font-semibold capitalize">{ledger.account.account_type}</p></div><div className="col-span-2"><p className="text-muted-foreground">Period</p><p className="mt-1 font-semibold">{dateFrom} to {dateTo}</p></div><div><p className="text-muted-foreground">Status</p><Badge className="mt-1 bg-emerald-100 text-emerald-700">Active</Badge></div></div><div><div className="mb-2 flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Monthly Trend (KES)</p><span className="rounded border px-2 py-1 text-[10px]">Last 6 Months</span></div><div className="h-40"><ResponsiveContainer width="100%" height="100%"><LineChart data={ledger.monthly_trend ?? []}><CartesianGrid vertical={false} stroke="#e5e7eb" /><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 9 }} /><YAxis tickLine={false} axisLine={false} tick={{ fontSize: 9 }} tickFormatter={(value) => `${Number(value) / 1000}K`} /><Tooltip formatter={(value: number) => money(value)} /><Line type="monotone" dataKey="amount" stroke="#10b981" strokeWidth={2.5} dot={{ fill: '#10b981', r: 3 }} /></LineChart></ResponsiveContainer></div></div></>}
                  {accountPanelTab === 'transactions' && <div className="space-y-2">{ledger.entries.slice(0, 8).map((entry) => <Link key={`${entry.entry_id}-${entry.entry_number}`} href={`/finance/transactions/${entry.entry_id}`} className="grid grid-cols-[64px_1fr_auto] gap-2 rounded-md border p-2 text-xs hover:border-primary/40 hover:bg-muted/30"><span>{entry.entry_date.slice(0, 10)}</span><span className="truncate font-mono text-primary">{entry.entry_number}</span><span className="font-mono">{money(entry.credit_amount || entry.debit_amount)}</span></Link>)}{!ledger.entries.length && <p className="py-8 text-center text-sm text-muted-foreground">No activity for this period.</p>}</div>}
                  {accountPanelTab === 'documents' && <div className="space-y-2">{ledger.entries.length ? ledger.entries.slice(0, 8).map((entry) => <Link key={`document-${entry.entry_id}`} href={`/finance/transactions/${entry.entry_id}`} className="flex items-center justify-between rounded-md border p-3 text-xs hover:border-primary/40"><span className="capitalize">{sourceTypeLabel[entry.source_type] ?? entry.source_type}</span><span className="font-mono text-primary">{entry.entry_number}</span></Link>) : <p className="py-8 text-center text-sm text-muted-foreground">No source documents in this period.</p>}</div>}
                  {accountPanelTab === 'analysis' && <div className="space-y-3 text-sm"><div className="rounded-md bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Debit movement</p><p className="mt-1 font-mono font-bold">{money(ledger.summary.debit_total)}</p></div><div className="rounded-md bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Credit movement</p><p className="mt-1 font-mono font-bold">{money(ledger.summary.credit_total)}</p></div></div>}
                  <Button variant="outline" size="sm" className="w-full" onClick={() => setActiveTab('general-ledger')}>View in General Ledger <ArrowUpRight className="ml-1 h-4 w-4" /></Button>
                </div>
              </> : <p className="py-12 text-center text-sm text-muted-foreground">Select an account to inspect its activity.</p>}</CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="balance-sheet">
          <div className="mb-6 grid gap-4 md:grid-cols-3">
            <Card className="shadow-sm"><CardContent className="p-5"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Current Assets</div><div className="mt-2 text-xl font-black font-mono">{money(comparativeBalanceSheet?.current.summary.total_assets ?? 0)}</div><div className="mt-1 text-xs text-muted-foreground">As of {comparativeBalanceSheet?.current.date_to}</div></CardContent></Card>
            <Card className="shadow-sm"><CardContent className="p-5"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Comparison Assets</div><div className="mt-2 text-xl font-black font-mono">{money(comparativeBalanceSheet?.comparison.summary.total_assets ?? 0)}</div><div className="mt-1 text-xs text-muted-foreground">As of {comparativeBalanceSheet?.comparison.date_to}</div></CardContent></Card>
            <Card className="shadow-sm"><CardContent className="p-5"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Asset Variance</div><div className="mt-2 text-xl font-black font-mono">{money((comparativeBalanceSheet?.current.summary.total_assets ?? 0) - (comparativeBalanceSheet?.comparison.summary.total_assets ?? 0))}</div><div className="mt-1 text-xs text-muted-foreground">Current versus comparison balance sheet</div></CardContent></Card>
          </div>
          <div className="grid gap-6 xl:grid-cols-3">
            {[{
              title: 'Assets',
              rows: assetPaged.rows,
              page: assetPaged.page,
              totalPages: assetPaged.totalPages,
              setPage: setAssetPage,
              total: balanceSheet?.summary?.total_assets ?? 0,
            }, {
              title: 'Liabilities',
              rows: liabilityPaged.rows,
              page: liabilityPaged.page,
              totalPages: liabilityPaged.totalPages,
              setPage: setLiabilityPage,
              total: balanceSheet?.summary?.total_liabilities ?? 0,
            }, {
              title: 'Equity',
              rows: equityPaged.rows,
              page: equityPaged.page,
              totalPages: equityPaged.totalPages,
              setPage: setEquityPage,
              total: balanceSheet?.summary?.total_equity ?? 0,
            }].map((section) => (
              <Card key={section.title} className="shadow-sm">
                <CardHeader className="border-b bg-muted/20 py-4">
                  <CardTitle className="text-sm font-bold uppercase tracking-widest">{section.title}</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead>Nature</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="w-[48px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {section.rows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                            {bsLoading ? 'Loading balance sheet…' : 'No rows found.'}
                          </TableCell>
                        </TableRow>
                      ) : (
                        section.rows.map((row) => (
                          <TableRow key={`${section.title}-${row.code}`}>
                            <TableCell className="font-mono">{row.code}</TableCell>
                            <TableCell className="font-medium"><button type="button" onClick={() => openAccount(row.account_id)} className="text-left hover:text-primary hover:underline">{row.name}</button></TableCell>
                            <TableCell><BalanceBadge row={row} /></TableCell>
                            <TableCell className="text-right font-mono">{money(row.display_amount)}</TableCell>
                            <TableCell>
                              {row.account_id ? (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => openAccount(row.account_id)}>
                                      <Eye className="h-4 w-4" /> Open Ledger
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                      <TableRow className="bg-muted/40">
                        <TableCell />
                        <TableCell className="font-semibold">Total {section.title}</TableCell>
                        <TableCell />
                        <TableCell className="text-right font-mono font-semibold">{money(section.total)}</TableCell>
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                  <TablePager page={section.page} totalPages={section.totalPages} onPageChange={section.setPage} />
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="shadow-sm">
            <CardContent className="flex flex-col gap-2 p-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Statement Health</div>
                <div className="text-sm text-muted-foreground">
                  {balanceSheet?.notes?.balanced_definition ?? 'Assets should equal liabilities plus equity.'}
                </div>
              </div>
              <Badge variant={balanceSheet?.summary?.balanced ? 'default' : 'destructive'}>
                {balanceSheet?.summary?.balanced ? 'Balanced' : 'Review Needed'}
              </Badge>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="general-ledger">
          <Card className="shadow-sm">
            <CardHeader className="border-b bg-muted/20 py-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <CardTitle className="text-sm font-bold uppercase tracking-widest">General Ledger By Account</CardTitle>
                  <CardDescription>
                    Preview account activity, search entries, and trace the report figures back to journal movements.
                  </CardDescription>
                </div>
                <div className="w-full max-w-lg space-y-2">
                  <Label>Account</Label>
                  <Select value={selectedAccountId || undefined} onValueChange={setSelectedAccountId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose an account" />
                    </SelectTrigger>
                    <SelectContent>
                      {postingAccounts.map((account) => (
                        <SelectItem key={account.id} value={String(account.id)}>
                          {account.code} • {account.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 p-5">
              {ledger?.account ? (
                <div className="grid gap-4 md:grid-cols-4">
                  <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Account</div><div className="mt-1 text-sm font-semibold">{ledger.account.code} • {ledger.account.name}</div></CardContent></Card>
                  <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Opening</div><div className="mt-1 font-mono">{money(ledger.opening_balance)}</div></CardContent></Card>
                  <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Period Debits</div><div className="mt-1 font-mono">{money(ledger.summary.debit_total)}</div></CardContent></Card>
                  <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Closing</div><div className="mt-1 font-mono">{money(ledger.summary.closing_balance)}</div></CardContent></Card>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  Select an account or click any report row action to open its ledger.
                </div>
              )}

              <div className="overflow-hidden rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Entry</TableHead>
                      <TableHead>Journal</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                      <TableHead className="text-right">Running Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!selectedAccountId ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                          Choose an account to preview its activity.
                        </TableCell>
                      </TableRow>
                    ) : ledgerPaged.rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                          {ledgerLoading ? 'Loading ledger…' : 'No entries match the current filters.'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      ledgerPaged.rows.map((entry) => (
                        <TableRow key={`${entry.entry_id}-${entry.entry_number}`}>
                          <TableCell className="font-mono text-xs">{entry.entry_date.slice(0, 10)}</TableCell>
                          <TableCell className="font-mono">{entry.entry_number}</TableCell>
                          <TableCell>{entry.journal || '—'}</TableCell>
                          <TableCell>{sourceTypeLabel[entry.source_type] ?? entry.source_type}</TableCell>
                          <TableCell className="max-w-[320px] truncate">{entry.description || entry.memo || entry.source_reference || '—'}</TableCell>
                          <TableCell className="text-right font-mono">{money(entry.debit_amount)}</TableCell>
                          <TableCell className="text-right font-mono">{money(entry.credit_amount)}</TableCell>
                          <TableCell className="text-right font-mono">{money(entry.running_balance)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
                <TablePager page={ledgerPaged.page} totalPages={ledgerPaged.totalPages} onPageChange={setLedgerPage} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reconciliation">
          <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <Card className="shadow-sm">
              <CardHeader className="border-b bg-muted/20 py-4">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div>
                    <CardTitle className="text-sm font-bold uppercase tracking-widest">Reconciliation Sessions</CardTitle>
                    <CardDescription>
                      Match statement lines to posted bank or cash movements so finance can prove the account balance.
                    </CardDescription>
                  </div>
                  <Button variant="outline" onClick={openCreateReconciliationSessionDialog}>
                    New Session
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Session</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>Range</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Open Items</TableHead>
                      <TableHead className="w-[48px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reconciliationSessionPaged.rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                          No reconciliation sessions found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      reconciliationSessionPaged.rows.map((session) => (
                        <TableRow
                          key={session.id}
                          className={selectedReconciliationSessionId === String(session.id) ? 'bg-muted/40' : undefined}
                        >
                          <TableCell>
                            <div className="font-medium">{session.code}</div>
                            <div className="text-xs text-muted-foreground">{session.name}</div>
                          </TableCell>
                          <TableCell>{session.account_code} • {session.account_name}</TableCell>
                          <TableCell className="text-xs">{session.statement_date_from} to {session.statement_date_to}</TableCell>
                          <TableCell>
                            <Badge variant={session.status === 'completed' ? 'default' : 'secondary'}>
                              {session.status.replace('_', ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">{session.summary.open_lines}</TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setSelectedReconciliationSessionId(String(session.id));
                                setSelectedReconciliationLineId('');
                                setReconciliationCandidates([]);
                              }}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
                <TablePager page={reconciliationSessionPaged.page} totalPages={reconciliationSessionPaged.totalPages} onPageChange={setReconciliationSessionPage} />
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card className="shadow-sm">
                <CardHeader className="border-b bg-muted/20 py-4">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div>
                      <CardTitle className="text-sm font-bold uppercase tracking-widest">Statement Lines</CardTitle>
                      <CardDescription>
                        {selectedReconciliationSession
                          ? `${selectedReconciliationSession.account_code} • ${selectedReconciliationSession.account_name}`
                          : 'Select a reconciliation session to review statement lines.'}
                      </CardDescription>
                    </div>
                    <Button variant="outline" onClick={openCreateReconciliationLineDialog} disabled={!selectedReconciliationSessionId}>
                      Add Statement Line
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 p-5">
                  {selectedReconciliationSession ? (
                    <div className="grid gap-4 md:grid-cols-4">
                      <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Statement Closing</div><div className="mt-1 font-mono">{money(selectedReconciliationSession.statement_closing_balance)}</div></CardContent></Card>
                      <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Book Closing</div><div className="mt-1 font-mono">{money(reconciliationLinesData?.book_closing_balance ?? 0)}</div></CardContent></Card>
                      <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Matched Lines</div><div className="mt-1 font-mono">{selectedReconciliationSession.summary.matched_lines} / {selectedReconciliationSession.summary.total_lines}</div></CardContent></Card>
                      <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Unmatched Total</div><div className="mt-1 font-mono">{money(selectedReconciliationSession.summary.unmatched_total)}</div></CardContent></Card>
                    </div>
                  ) : null}

                  <div className="overflow-hidden rounded-xl border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Reference</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Matched Entry</TableHead>
                          <TableHead className="w-[48px]" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {!selectedReconciliationSessionId ? (
                          <TableRow>
                            <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                              Select a reconciliation session to begin.
                            </TableCell>
                          </TableRow>
                        ) : reconciliationLinePaged.rows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                              No statement lines have been entered for this session.
                            </TableCell>
                          </TableRow>
                        ) : (
                          reconciliationLinePaged.rows.map((line) => (
                            <TableRow
                              key={line.id}
                              className={selectedReconciliationLineId === String(line.id) ? 'bg-muted/40' : undefined}
                            >
                              <TableCell className="font-mono text-xs">{line.line_date}</TableCell>
                              <TableCell>{line.reference || '—'}</TableCell>
                              <TableCell>{line.description || '—'}</TableCell>
                              <TableCell className="text-right font-mono">{money(line.amount)}</TableCell>
                              <TableCell>
                                <Badge variant={line.status === 'matched' ? 'default' : line.status === 'ignored' ? 'secondary' : 'outline'}>
                                  {line.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs">
                                {line.matched_entry_number ? `${line.matched_entry_number}` : '—'}
                              </TableCell>
                              <TableCell>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => loadReconciliationCandidates(line.id)}>
                                      <Link2 className="h-4 w-4" /> Find matches
                                    </DropdownMenuItem>
                                    {line.matched_journal_line ? (
                                      <DropdownMenuItem onClick={() => unmatchReconciliationLine(line.id)}>
                                        <Unlink className="h-4 w-4" /> Unmatch
                                      </DropdownMenuItem>
                                    ) : null}
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => setReconciliationLineStatus(line.id, 'ignored')}>
                                      Ignore line
                                    </DropdownMenuItem>
                                    {line.status === 'ignored' ? (
                                      <DropdownMenuItem onClick={() => setReconciliationLineStatus(line.id, 'open')}>
                                        Reopen line
                                      </DropdownMenuItem>
                                    ) : null}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                    <TablePager page={reconciliationLinePaged.page} totalPages={reconciliationLinePaged.totalPages} onPageChange={setReconciliationLinePage} />
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader className="border-b bg-muted/20 py-4">
                  <CardTitle className="text-sm font-bold uppercase tracking-widest">Candidate Book Entries</CardTitle>
                  <CardDescription>
                    {selectedReconciliationLine
                      ? `Statement line ${selectedReconciliationLine.reference || selectedReconciliationLine.description || selectedReconciliationLine.id}`
                      : 'Choose a statement line to inspect possible posted journal matches.'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 p-5">
                  {selectedReconciliationLine ? (
                    <div className="grid gap-4 md:grid-cols-4">
                      <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Statement Amount</div><div className="mt-1 font-mono">{money(selectedReconciliationLine.amount)}</div></CardContent></Card>
                      <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Current Status</div><div className="mt-1"><Badge variant={selectedReconciliationLine.status === 'matched' ? 'default' : 'secondary'}>{selectedReconciliationLine.status}</Badge></div></CardContent></Card>
                      <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Matched Entry</div><div className="mt-1 font-mono text-xs">{selectedReconciliationLine.matched_entry_number ?? '—'}</div></CardContent></Card>
                      <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Candidate Rows</div><div className="mt-1 font-mono">{reconciliationCandidatesFiltered.length}</div></CardContent></Card>
                    </div>
                  ) : null}

                  <div className="overflow-hidden rounded-xl border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Entry</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Journal</TableHead>
                          <TableHead>Source</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="text-right">Delta</TableHead>
                          <TableHead className="text-right">Days</TableHead>
                          <TableHead className="w-[48px]" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {!selectedReconciliationLine ? (
                          <TableRow>
                            <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                              Select a statement line, then use <span className="font-semibold">Find matches</span>.
                            </TableCell>
                          </TableRow>
                        ) : candidatePaged.rows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                              {loadingCandidates ? 'Searching posted entries…' : 'No candidate book entries found in the current search.'}
                            </TableCell>
                          </TableRow>
                        ) : (
                          candidatePaged.rows.map((candidate) => (
                            <TableRow key={candidate.journal_line_id}>
                              <TableCell>
                                <div className="font-mono text-xs">{candidate.entry_number}</div>
                                <div className="text-xs text-muted-foreground truncate max-w-[220px]">{candidate.memo || candidate.description || candidate.source_reference || '—'}</div>
                              </TableCell>
                              <TableCell className="font-mono text-xs">{candidate.entry_date.slice(0, 10)}</TableCell>
                              <TableCell>{candidate.journal_code}</TableCell>
                              <TableCell>{sourceTypeLabel[candidate.source_type] ?? candidate.source_type}</TableCell>
                              <TableCell className="text-right font-mono">{money(candidate.signed_amount)}</TableCell>
                              <TableCell className="text-right font-mono">{money(candidate.amount_delta)}</TableCell>
                              <TableCell className="text-right font-mono">{candidate.date_delta_days}</TableCell>
                              <TableCell>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  disabled={candidate.already_matched || !selectedReconciliationLine || matchingReconciliationLineId === selectedReconciliationLine.id}
                                  onClick={() => selectedReconciliationLine && matchReconciliationLine(selectedReconciliationLine.id, candidate.journal_line_id)}
                                >
                                  <CheckCircle2 className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                    <TablePager page={candidatePaged.page} totalPages={candidatePaged.totalPages} onPageChange={setCandidatePage} />
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="period-close">
          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <Card className="shadow-sm">
              <CardHeader className="border-b bg-muted/20 py-4">
                <CardTitle className="text-sm font-bold uppercase tracking-widest">Period Close Preview</CardTitle>
                <CardDescription>
                  Mature ERP finance usually works by financial year and accounting period. Open periods accept postings; close moves P&amp;L into retained earnings and prevents accidental continuation.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 p-5">
                {retainedRollforward ? (
                  <div className="grid gap-4 md:grid-cols-4">
                    <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Opening R/E</div><div className="mt-1 font-mono">{money(retainedRollforward.opening_balance)}</div></CardContent></Card>
                    <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Direct Movements</div><div className="mt-1 font-mono">{money(retainedRollforward.direct_movements)}</div></CardContent></Card>
                    <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Period Net Income</div><div className="mt-1 font-mono">{money(retainedRollforward.net_income_transfer)}</div></CardContent></Card>
                    <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Closing R/E</div><div className="mt-1 font-mono">{money(retainedRollforward.closing_balance)}</div></CardContent></Card>
                  </div>
                ) : null}
                {!closePreview ? (
                  <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                    Run a close preview to inspect the balancing lines before posting.
                  </div>
                ) : (
                  <>
                    <div className="grid gap-4 md:grid-cols-4">
                      <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Period</div><div className="mt-1 text-sm font-semibold">{closePreview.period?.name ?? `${closePreview.period_start} to ${closePreview.period_end}`}</div></CardContent></Card>
                      <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Net Income</div><div className="mt-1 font-mono">{money(closePreview.net_income)}</div></CardContent></Card>
                      <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Retained Earnings</div><div className="mt-1 text-sm font-semibold">{closePreview.retained_earnings_account.code} • {closePreview.retained_earnings_account.name}</div></CardContent></Card>
                      <Card><CardContent className="p-4"><div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Status</div><div className="mt-1"><Badge variant={closePreview.balanced ? 'default' : 'destructive'}>{closePreview.balanced ? 'Balanced' : 'Needs Review'}</Badge>{closePreview.existing_close ? <Badge variant="secondary" className="ml-2">Already Closed</Badge> : null}</div></CardContent></Card>
                    </div>

                    <div className="overflow-hidden rounded-xl border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Code</TableHead>
                            <TableHead>Account</TableHead>
                            <TableHead className="text-right">Debit</TableHead>
                            <TableHead className="text-right">Credit</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {closePreview.lines.map((line) => (
                            <TableRow key={`${line.account_id}-${line.code}`}>
                              <TableCell className="font-mono">{line.code}</TableCell>
                              <TableCell className="font-medium">{line.name}</TableCell>
                              <TableCell className="text-right font-mono">{money(line.debit_amount)}</TableCell>
                              <TableCell className="text-right font-mono">{money(line.credit_amount)}</TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="bg-muted/40">
                            <TableCell />
                            <TableCell className="font-semibold">Totals</TableCell>
                            <TableCell className="text-right font-mono font-semibold">{money(closePreview.totals.debit_total)}</TableCell>
                            <TableCell className="text-right font-mono font-semibold">{money(closePreview.totals.credit_total)}</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>

                    <div className="flex flex-wrap justify-end gap-3">
                      <Button variant="outline" onClick={() => previewPeriodClose()} disabled={previewingClose}>
                        {previewingClose ? 'Refreshing…' : 'Refresh Preview'}
                      </Button>
                      <Button onClick={executePeriodClose} disabled={executingClose || !closePreview.balanced || closePreview.existing_close}>
                        {executingClose ? 'Closing…' : 'Post Closing Entry'}
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card className="shadow-sm">
                <CardHeader className="border-b bg-muted/20 py-4">
                  <CardTitle className="text-sm font-bold uppercase tracking-widest">Create Financial Year</CardTitle>
                  <CardDescription>Define start and end dates first, then let the system generate periods from that structure.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 p-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input value={yearForm.name} onChange={(e) => setYearForm((prev) => ({ ...prev, name: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Code</Label>
                    <Input value={yearForm.code} onChange={(e) => setYearForm((prev) => ({ ...prev, code: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Start Date</Label>
                    <Input type="date" value={yearForm.start_date} onChange={(e) => setYearForm((prev) => ({ ...prev, start_date: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>End Date</Label>
                    <Input type="date" value={yearForm.end_date} onChange={(e) => setYearForm((prev) => ({ ...prev, end_date: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select value={yearForm.status} onValueChange={(value) => setYearForm((prev) => ({ ...prev, status: value }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="open">Open</SelectItem>
                        <SelectItem value="closed">Closed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <Button onClick={createFinancialYear} disabled={creatingYear}>
                      {creatingYear ? 'Creating…' : 'Create Year + Periods'}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader className="border-b bg-muted/20 py-4">
                  <CardTitle className="text-sm font-bold uppercase tracking-widest">Period Registry</CardTitle>
                  <CardDescription>Preview and act on open and closed periods. Use these periods to drive reporting and close control.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 p-5">
                  <div className="space-y-2">
                    <Label>Selected Financial Year</Label>
                    <div className="flex flex-wrap gap-2">
                      {financialYears.map((year) => (
                        <div key={year.id} className="flex items-center gap-2">
                          <Button
                            variant={String(year.id) === selectedFinancialYearId ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => {
                              setSelectedFinancialYearId(String(year.id));
                              setSelectedPeriodId('');
                            }}
                          >
                            {year.code} • {year.status}
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => openEditYear(year)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    {selectedFinancialYearId ? (
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={() => generatePeriods(Number(selectedFinancialYearId))}>
                          Generate Missing Periods
                        </Button>
                        <Button variant="outline" size="sm" onClick={openCreatePeriodDialog}>
                          New Period
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  <div className="overflow-hidden rounded-xl border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Period</TableHead>
                          <TableHead>Dates</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="w-[56px]" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {periodPaged.rows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                              No periods match the current filters.
                            </TableCell>
                          </TableRow>
                        ) : (
                          periodPaged.rows.map((period) => (
                            <TableRow key={period.id}>
                              <TableCell>
                                <div className="font-medium">{period.code}</div>
                                <div className="text-xs text-muted-foreground">{period.name}</div>
                              </TableCell>
                              <TableCell className="font-mono text-xs">{period.start_date} to {period.end_date}</TableCell>
                              <TableCell><Badge variant={period.status === 'open' ? 'default' : period.status === 'closed' ? 'secondary' : 'outline'}>{period.status}</Badge></TableCell>
                              <TableCell>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => {
                                      setSelectedPeriodId(String(period.id));
                                      setActiveTab('trial-balance');
                                    }}>
                                      <Eye className="h-4 w-4" /> Use In Reports
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => previewPeriodClose(String(period.id))}>
                                      <CalendarRange className="h-4 w-4" /> Preview Close
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => openEditPeriod(period)}>
                                      <Pencil className="h-4 w-4" /> Edit Period
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => lockPeriod(period.id)}>
                                      <Lock className="h-4 w-4" /> Lock Period
                                    </DropdownMenuItem>
                                    {period.status === 'open' ? (
                                      <DropdownMenuItem onClick={() => runPeriodAction(period.id, 'close')}>
                                        Close Period
                                      </DropdownMenuItem>
                                    ) : (
                                      <DropdownMenuItem onClick={() => runPeriodAction(period.id, 'open')}>
                                        Reopen Period
                                      </DropdownMenuItem>
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                    <TablePager page={periodPaged.page} totalPages={periodPaged.totalPages} onPageChange={setPeriodPage} />
                  </div>

                  <div className="overflow-hidden rounded-xl border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>When</TableHead>
                          <TableHead>Action</TableHead>
                          <TableHead>Target</TableHead>
                          <TableHead>By</TableHead>
                          <TableHead>Note</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {auditLogs.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                              No audit actions recorded yet.
                            </TableCell>
                          </TableRow>
                        ) : (
                          auditLogs.slice(0, 12).map((log) => (
                            <TableRow key={log.id}>
                              <TableCell className="font-mono text-xs">{log.created_at.slice(0, 19).replace('T', ' ')}</TableCell>
                              <TableCell className="capitalize">{log.action}</TableCell>
                              <TableCell>{log.period_name || log.financial_year_name || 'Accounting'}</TableCell>
                              <TableCell>{log.performed_by_name || 'System'}</TableCell>
                              <TableCell className="max-w-[260px] truncate">{log.note || '—'}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Sheet open={accountDrawerOpen} onOpenChange={setAccountDrawerOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-xl">
          <SheetHeader className="border-b px-6 py-5 pr-12">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Account activity</p>
            <SheetTitle>{ledger?.account ? `${ledger.account.code} - ${ledger.account.name}` : 'Loading account activity'}</SheetTitle>
            <p className="text-sm text-muted-foreground">{dateFrom} to {dateTo}</p>
          </SheetHeader>
          {ledger?.account ? <div className="space-y-5 p-6">
            <div className="grid grid-cols-3 gap-3"><Card><CardContent className="p-3"><p className="text-[10px] font-bold uppercase text-muted-foreground">Opening</p><p className="mt-1 font-mono text-sm font-bold">{money(ledger.opening_balance)}</p></CardContent></Card><Card><CardContent className="p-3"><p className="text-[10px] font-bold uppercase text-muted-foreground">Movement</p><p className="mt-1 font-mono text-sm font-bold">{money(ledger.summary.credit_total - ledger.summary.debit_total)}</p></CardContent></Card><Card><CardContent className="p-3"><p className="text-[10px] font-bold uppercase text-muted-foreground">Closing</p><p className="mt-1 font-mono text-sm font-bold">{money(ledger.summary.closing_balance)}</p></CardContent></Card></div>
            <div className="flex items-center justify-between"><h3 className="text-sm font-bold uppercase tracking-wide">Underlying transactions</h3><Button variant="outline" size="sm" onClick={() => { setAccountDrawerOpen(false); setActiveTab('general-ledger'); }}>Open full ledger</Button></div>
            <div className="overflow-hidden rounded-lg border"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Reference</TableHead><TableHead>Source</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead></TableRow></TableHeader><TableBody>{ledger.entries.length ? ledger.entries.map((entry) => <TableRow key={`${entry.entry_id}-${entry.entry_number}`}><TableCell className="text-xs">{entry.entry_date.slice(0, 10)}</TableCell><TableCell><Link href={`/finance/transactions/${entry.entry_id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{entry.entry_number}</Link></TableCell><TableCell className="capitalize text-xs">{sourceTypeLabel[entry.source_type] ?? entry.source_type}</TableCell><TableCell className="text-right font-mono text-xs">{money(entry.debit_amount)}</TableCell><TableCell className="text-right font-mono text-xs">{money(entry.credit_amount)}</TableCell></TableRow>) : <TableRow><TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">{ledgerLoading ? 'Loading activity...' : 'No transactions for the selected filters.'}</TableCell></TableRow>}</TableBody></Table></div>
          </div> : <div className="p-8 text-sm text-muted-foreground">{ledgerLoading ? 'Loading account activity...' : 'Select an account to inspect its activity.'}</div>}
        </SheetContent>
      </Sheet>

      <Dialog open={yearDialogOpen} onOpenChange={setYearDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Financial Year</DialogTitle>
            <DialogDescription>Adjust the financial year dates or status. Overlapping date ranges will be rejected.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={yearForm.name} onChange={(e) => setYearForm((prev) => ({ ...prev, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Code</Label>
              <Input value={yearForm.code} onChange={(e) => setYearForm((prev) => ({ ...prev, code: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input type="date" value={yearForm.start_date} onChange={(e) => setYearForm((prev) => ({ ...prev, start_date: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Input type="date" value={yearForm.end_date} onChange={(e) => setYearForm((prev) => ({ ...prev, end_date: e.target.value }))} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Status</Label>
              <Select value={yearForm.status} onValueChange={(value) => setYearForm((prev) => ({ ...prev, status: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {yearFormError ? (
              <div className="md:col-span-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {yearFormError}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setYearDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveYearEdit} disabled={editingYear}>{editingYear ? 'Saving…' : 'Save Changes'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={periodDialogOpen} onOpenChange={setPeriodDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Accounting Period</DialogTitle>
            <DialogDescription>Keep the period inside its financial year. Overlapping periods will be rejected.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label>Financial Year</Label>
              <Select value={periodForm.financial_year || undefined} onValueChange={(value) => setPeriodForm((prev) => ({ ...prev, financial_year: value }))}>
                <SelectTrigger><SelectValue placeholder="Choose financial year" /></SelectTrigger>
                <SelectContent>
                  {financialYears.map((year) => (
                    <SelectItem key={year.id} value={String(year.id)}>
                      {year.code} • {year.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={periodForm.name} onChange={(e) => setPeriodForm((prev) => ({ ...prev, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Code</Label>
              <Input value={periodForm.code} onChange={(e) => setPeriodForm((prev) => ({ ...prev, code: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input type="date" value={periodForm.start_date} onChange={(e) => setPeriodForm((prev) => ({ ...prev, start_date: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Input type="date" value={periodForm.end_date} onChange={(e) => setPeriodForm((prev) => ({ ...prev, end_date: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Period Type</Label>
              <Select value={periodForm.period_type} onValueChange={(value) => setPeriodForm((prev) => ({ ...prev, period_type: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">Month</SelectItem>
                  <SelectItem value="quarter">Quarter</SelectItem>
                  <SelectItem value="year">Year</SelectItem>
                  <SelectItem value="adjustment">Adjustment</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={periodForm.status} onValueChange={(value) => setPeriodForm((prev) => ({ ...prev, status: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                  <SelectItem value="locked">Locked</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Sequence Number</Label>
              <Input type="number" min="1" value={periodForm.sequence_number} onChange={(e) => setPeriodForm((prev) => ({ ...prev, sequence_number: e.target.value }))} />
            </div>
            {periodFormError ? (
              <div className="md:col-span-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {periodFormError}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPeriodDialogOpen(false)}>Cancel</Button>
            <Button onClick={savePeriodEdit} disabled={editingPeriod}>{editingPeriod ? 'Saving…' : 'Save Changes'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createPeriodDialogOpen} onOpenChange={setCreatePeriodDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Accounting Period</DialogTitle>
            <DialogDescription>Create a custom or adjustment period inside the selected financial year. Overlapping or out-of-range dates will be rejected.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label>Financial Year</Label>
              <Select value={periodForm.financial_year || undefined} onValueChange={(value) => setPeriodForm((prev) => ({ ...prev, financial_year: value }))}>
                <SelectTrigger><SelectValue placeholder="Choose financial year" /></SelectTrigger>
                <SelectContent>
                  {financialYears.map((year) => (
                    <SelectItem key={year.id} value={String(year.id)}>
                      {year.code} • {year.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={periodForm.name} onChange={(e) => setPeriodForm((prev) => ({ ...prev, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Code</Label>
              <Input value={periodForm.code} onChange={(e) => setPeriodForm((prev) => ({ ...prev, code: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input type="date" value={periodForm.start_date} onChange={(e) => setPeriodForm((prev) => ({ ...prev, start_date: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Input type="date" value={periodForm.end_date} onChange={(e) => setPeriodForm((prev) => ({ ...prev, end_date: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Period Type</Label>
              <Select value={periodForm.period_type} onValueChange={(value) => setPeriodForm((prev) => ({ ...prev, period_type: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">Month</SelectItem>
                  <SelectItem value="quarter">Quarter</SelectItem>
                  <SelectItem value="year">Year</SelectItem>
                  <SelectItem value="adjustment">Adjustment</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={periodForm.status} onValueChange={(value) => setPeriodForm((prev) => ({ ...prev, status: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                  <SelectItem value="locked">Locked</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Sequence Number</Label>
              <Input type="number" min="1" value={periodForm.sequence_number} onChange={(e) => setPeriodForm((prev) => ({ ...prev, sequence_number: e.target.value }))} />
            </div>
            {periodFormError ? (
              <div className="md:col-span-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {periodFormError}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreatePeriodDialogOpen(false)}>Cancel</Button>
            <Button onClick={createPeriod} disabled={creatingPeriod}>{creatingPeriod ? 'Creating…' : 'Create Period'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createReconciliationSessionDialogOpen} onOpenChange={setCreateReconciliationSessionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Reconciliation Session</DialogTitle>
            <DialogDescription>
              Start a bank or cash reconciliation for one posted account and one statement date range.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label>Account</Label>
              <Select value={reconciliationSessionForm.account || undefined} onValueChange={(value) => setReconciliationSessionForm((prev) => ({ ...prev, account: value }))}>
                <SelectTrigger><SelectValue placeholder="Choose bank or cash account" /></SelectTrigger>
                <SelectContent>
                  {reconciliationAccounts.map((account) => (
                    <SelectItem key={account.id} value={String(account.id)}>
                      {account.code} • {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={reconciliationSessionForm.name} onChange={(e) => setReconciliationSessionForm((prev) => ({ ...prev, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Code</Label>
              <Input value={reconciliationSessionForm.code} onChange={(e) => setReconciliationSessionForm((prev) => ({ ...prev, code: e.target.value }))} placeholder="Optional" />
            </div>
            <div className="space-y-2">
              <Label>Financial Year</Label>
              <Select value={reconciliationSessionForm.financial_year || 'none'} onValueChange={(value) => setReconciliationSessionForm((prev) => ({ ...prev, financial_year: value === 'none' ? '' : value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {financialYears.map((year) => (
                    <SelectItem key={year.id} value={String(year.id)}>
                      {year.code} • {year.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Accounting Period</Label>
              <Select value={reconciliationSessionForm.period || 'none'} onValueChange={(value) => setReconciliationSessionForm((prev) => ({ ...prev, period: value === 'none' ? '' : value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {allPeriods.map((period) => (
                    <SelectItem key={period.id} value={String(period.id)}>
                      {period.code} • {period.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Statement From</Label>
              <Input type="date" value={reconciliationSessionForm.statement_date_from} onChange={(e) => setReconciliationSessionForm((prev) => ({ ...prev, statement_date_from: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Statement To</Label>
              <Input type="date" value={reconciliationSessionForm.statement_date_to} onChange={(e) => setReconciliationSessionForm((prev) => ({ ...prev, statement_date_to: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Statement Opening Balance</Label>
              <Input value={reconciliationSessionForm.statement_opening_balance} onChange={(e) => setReconciliationSessionForm((prev) => ({ ...prev, statement_opening_balance: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Statement Closing Balance</Label>
              <Input value={reconciliationSessionForm.statement_closing_balance} onChange={(e) => setReconciliationSessionForm((prev) => ({ ...prev, statement_closing_balance: e.target.value }))} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Notes</Label>
              <Textarea value={reconciliationSessionForm.notes} onChange={(e) => setReconciliationSessionForm((prev) => ({ ...prev, notes: e.target.value }))} rows={3} />
            </div>
            {reconciliationFormError ? (
              <div className="md:col-span-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {reconciliationFormError}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateReconciliationSessionDialogOpen(false)}>Cancel</Button>
            <Button onClick={createReconciliationSession} disabled={creatingReconciliationSession}>
              {creatingReconciliationSession ? 'Creating…' : 'Create Session'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createReconciliationLineDialogOpen} onOpenChange={setCreateReconciliationLineDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Statement Line</DialogTitle>
            <DialogDescription>
              Enter a cleared bank statement or cashbook line, then match it to the posted journal entry.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Line Date</Label>
              <Input type="date" value={reconciliationLineForm.line_date} onChange={(e) => setReconciliationLineForm((prev) => ({ ...prev, line_date: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Reference</Label>
              <Input value={reconciliationLineForm.reference} onChange={(e) => setReconciliationLineForm((prev) => ({ ...prev, reference: e.target.value }))} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Description</Label>
              <Input value={reconciliationLineForm.description} onChange={(e) => setReconciliationLineForm((prev) => ({ ...prev, description: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input value={reconciliationLineForm.amount} onChange={(e) => setReconciliationLineForm((prev) => ({ ...prev, amount: e.target.value }))} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Notes</Label>
              <Textarea value={reconciliationLineForm.notes} onChange={(e) => setReconciliationLineForm((prev) => ({ ...prev, notes: e.target.value }))} rows={3} />
            </div>
            {reconciliationLineFormError ? (
              <div className="md:col-span-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {reconciliationLineFormError}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateReconciliationLineDialogOpen(false)}>Cancel</Button>
            <Button onClick={createReconciliationLine} disabled={creatingReconciliationLine}>
              {creatingReconciliationLine ? 'Adding…' : 'Add Statement Line'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
