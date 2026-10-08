import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/use-auth';
import { ERP_BRANCHES_QUERY_KEY, fetchErpBranches, type ErpBranch } from '@/lib/branches';
import { type AppRole, CAN_EXPORT } from '@/lib/roles';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Activity,
  AlertTriangle,
  Banknote,
  CreditCard,
  Download,
  FileSpreadsheet,
  FileText,
  Search,
  ShieldAlert,
  Truck,
  UserCircle2,
  Wallet,
} from 'lucide-react';
import { ERPFilterBar } from '@/components/erp/listing/filter-bar';
import { ERPDataTable, type ERPTableColumn } from '@/components/erp/listing/data-table';
import { ListingPagination } from '@/components/erp/listing/pagination';
import { ERPWorkspacePage } from '@/components/erp/workspace/workspace-page';

type TransactionRow = {
  id: number;
  branch_name?: string;
  customer_name?: string;
  vehicle_plate?: string;
  vehicle_type_name?: string;
  operation_type_name?: string;
  operation_type_flow_kind?: string;
  actor_user_id?: number | null;
  actor_display_name?: string;
  actor_username?: string;
  operator?: string;
  driver_name?: string;
  driver_phone?: string;
  item_name?: string;
  net_weight?: number | string | null;
  status?: string;
  weight_type?: string;
  payment_mode?: string;
  payment_status?: string;
  payment_reference?: string;
  payment_received_at?: string | null;
  charge?: number | string | null;
  destination?: string;
  approval_status?: boolean;
  manual_weight_capture?: boolean;
  created_at?: string | null;
  gross_weight_date?: string | null;
  tare_weight_date?: string | null;
};

type OverweightEventRow = {
  id: number;
  branch_name?: string;
  vehicle_plate?: string;
  net_weight?: number | string | null;
  threshold_at_capture?: number | string | null;
  discrepancy_raised?: boolean;
  linked_transaction_id?: number | null;
  operator_name?: string;
  recorded_at?: string | null;
};

type DiscrepancyRow = {
  id: number;
  branch_name?: string;
  resolution_status?: string;
  created_at?: string | null;
  resolved_at?: string | null;
  resolution_note?: string;
};

type Filters = {
  branchId: string;
  operator: string;
  status: string;
  paymentStatus: string;
  weightType: string;
  search: string;
  dateFrom: string;
  dateTo: string;
};

type ReportTab = 'operations' | 'financial';
type ReportId =
  | 'ops_transactions'
  | 'ops_approvals'
  | 'ops_overweight'
  | 'ops_discrepancies'
  | 'ops_operators'
  | 'fin_collections'
  | 'fin_receivables'
  | 'fin_customers'
  | 'fin_branches';

type ReportColumn = {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
};

type ReportRow = Record<string, ReactNode | string | number>;
type DisplayRow = { id: string | number } & ReportRow;

type ReportDefinition = {
  id: ReportId;
  tab: ReportTab;
  title: string;
  description: string;
  metricLabel: string;
  metricValue: string;
  icon: ReactNode;
  columns: ReportColumn[];
  rows: ReportRow[];
  exportRows: Array<Record<string, unknown>>;
};

type OperatorOption = {
  value: string;
  label: string;
};

const PAGE_SIZE = 8;
const LIBRARY_PAGE_SIZE = 4;
const OPERATIONS_ACCESS: AppRole[] = ['superadmin', 'tenant_admin', 'operator'];
const FINANCIAL_ACCESS: AppRole[] = ['superadmin', 'tenant_admin', 'finance'];

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoString(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

const DEFAULT_FILTERS: Filters = {
  branchId: 'all',
  operator: 'all',
  status: 'all',
  paymentStatus: 'all',
  weightType: 'all',
  search: '',
  dateFrom: daysAgoString(30),
  dateTo: todayString(),
};

function fmtDate(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-KE', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function fmtMoney(value: number) {
  return `KES ${value.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtInt(value: number) {
  return value.toLocaleString('en-KE');
}

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasAccess(role: AppRole, allowed: AppRole[]) {
  return allowed.includes(role);
}

function transactionActorLabel(tx: TransactionRow) {
  return (tx.actor_display_name || tx.actor_username || tx.operator || '').trim();
}

function buildQuery(filters: Filters, includeSearch = true) {
  const qs = new URLSearchParams();
  qs.set('page_size', '200');
  qs.set('date_field', 'created_at');
  qs.set('time_from', '00:00');
  qs.set('time_to', '23:59');
  if (filters.branchId !== 'all') qs.set('branch_id', filters.branchId);
  if (filters.status !== 'all') qs.set('status', filters.status);
  if (filters.paymentStatus !== 'all') qs.set('payment_status', filters.paymentStatus);
  if (filters.weightType !== 'all') qs.set('weight_type', filters.weightType);
  if (filters.dateFrom) qs.set('date_from', filters.dateFrom);
  if (filters.dateTo) qs.set('date_to', filters.dateTo);
  if (includeSearch && filters.search.trim()) qs.set('search', filters.search.trim());
  return qs;
}

async function fetchAllPages<T>(endpoint: string, token: string, params: URLSearchParams, maxPages = 8): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const query = new URLSearchParams(params);
    query.set('page', String(page));
    const res = await fetch(`${endpoint}?${query.toString()}`, {
      headers: { Authorization: `Token ${token}` },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const payload = await res.json();
    if (Array.isArray(payload)) return payload;
    const batch = Array.isArray(payload?.results) ? payload.results : [];
    rows.push(...batch);
    if (!payload?.next || batch.length === 0) break;
  }
  return rows;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function exportCsv(rows: Array<Record<string, unknown>>, fileName: string) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const escapeCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const body = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(',')),
  ].join('\n');
  downloadBlob(new Blob([body], { type: 'text/csv;charset=utf-8;' }), fileName);
}

function exportExcel(rows: Array<Record<string, unknown>>, fileName: string) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const html = `
    <html><head><meta charset="utf-8" /></head><body>
    <table border="1">
      <thead><tr>${headers.map((header) => `<th>${header}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${headers.map((header) => `<td>${String(row[header] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
    </body></html>
  `;
  downloadBlob(new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' }), fileName);
}

function prettifyExportLabel(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim();
}

function inferColumnAlignment(key: string): 'left' | 'right' {
  return /(amount|weight|kg|transactions|reviews|revenue|collected|outstanding|queue|records)/i.test(key)
    ? 'right'
    : 'left';
}

function printHtmlDocument(html: string) {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);

  const cleanup = () => {
    window.setTimeout(() => {
      iframe.remove();
    }, 1000);
  };

  iframe.onload = () => {
    const frameWindow = iframe.contentWindow;
    if (!frameWindow) {
      cleanup();
      return;
    }
    frameWindow.focus();
    frameWindow.print();
    cleanup();
  };

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    cleanup();
    return false;
  }
  doc.open();
  doc.write(html);
  doc.close();
  return true;
}

function badgeTone(value: string | undefined) {
  switch (value) {
    case 'Completed':
    case 'Paid':
    case 'resolved':
      return 'bg-primary/10 text-primary border-primary/20';
    case 'Pending':
    case 'Draft':
    case 'reviewed':
      return 'bg-secondary text-secondary-foreground border-border';
    case 'Rejected':
    case 'Recalled':
    case 'unresolved':
      return 'bg-destructive/10 text-destructive border-destructive/20';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

function LibraryTile({
  title,
  active,
  onClick,
}: {
  title: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-2xl border p-4 text-left transition-all ${
        active
          ? 'border-primary/30 bg-primary/8 shadow-sm'
          : 'border-border bg-card hover:border-primary/20 hover:bg-muted/40'
      }`}
    >
      <div className="mt-1">
        <div className="font-semibold text-foreground">{title}</div>
      </div>
    </button>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-xl font-black tracking-tight text-foreground">{value}</div>
    </div>
  );
}

function ReportsDashboardContent() {
  const { token, role } = useAuth();
  const { toast } = useToast();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [reportSearch, setReportSearch] = useState('');
  const [activeTab, setActiveTab] = useState<ReportTab>(hasAccess(role, OPERATIONS_ACCESS) ? 'operations' : 'financial');
  const [selectedReportId, setSelectedReportId] = useState<ReportId>('ops_transactions');
  const [page, setPage] = useState(1);
  const [libraryPage, setLibraryPage] = useState(1);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const canViewOperations = hasAccess(role, OPERATIONS_ACCESS);
  const canViewFinancial = hasAccess(role, FINANCIAL_ACCESS);
  const canExport = hasAccess(role, CAN_EXPORT);

  const branchesQuery = useQuery({
    queryKey: [...ERP_BRANCHES_QUERY_KEY, token],
    queryFn: () => fetchErpBranches(token!),
    enabled: !!token,
    staleTime: 300000,
  });

  const reportQuery = useQuery({
    queryKey: ['weighbridge-reports', token, filters],
    enabled: !!token && (canViewOperations || canViewFinancial),
    staleTime: 60000,
    queryFn: async () => {
      const txQuery = buildQuery(filters);
      const auxQuery = buildQuery(filters, false);
      const [transactions, overweightEvents, discrepancies] = await Promise.all([
        fetchAllPages<TransactionRow>('/api/commercial-weighbridge/transactions/', token!, txQuery),
        fetchAllPages<OverweightEventRow>('/api/commercial-weighbridge/overweight-events/', token!, auxQuery),
        fetchAllPages<DiscrepancyRow>('/api/commercial-weighbridge/surveillance-discrepancies/', token!, auxQuery),
      ]);
      return { transactions, overweightEvents, discrepancies };
    },
  });

  const branches = branchesQuery.data ?? [];
  const transactions = reportQuery.data?.transactions ?? [];
  const overweightEvents = reportQuery.data?.overweightEvents ?? [];
  const discrepancies = reportQuery.data?.discrepancies ?? [];

  const operatorOptions = useMemo<OperatorOption[]>(() => {
    const options = new Map<string, string>();
    transactions.forEach((tx) => {
      const actorLabel = transactionActorLabel(tx);
      if (tx.actor_user_id && actorLabel) {
        options.set(`user:${tx.actor_user_id}`, actorLabel);
        return;
      }
      if (actorLabel) {
        options.set(`legacy:${actorLabel}`, actorLabel);
      }
    });
    overweightEvents.forEach((event) => {
      const value = (event.operator_name || '').trim();
      if (value && !options.has(`legacy:${value}`)) {
        options.set(`legacy:${value}`, value);
      }
    });
    return [...options.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [transactions, overweightEvents]);

  const searchedTransactions = useMemo(() => {
    const needle = filters.search.trim().toLowerCase();
    return transactions.filter((tx) => {
      const actorLabel = transactionActorLabel(tx);
      const actorValue = tx.actor_user_id ? `user:${tx.actor_user_id}` : actorLabel ? `legacy:${actorLabel}` : '';
      const matchesOperator = filters.operator === 'all' || actorValue === filters.operator;
      const matchesSearch =
        !needle ||
        [
          tx.vehicle_plate,
          tx.customer_name,
          tx.actor_display_name,
          tx.actor_username,
          tx.operator,
          tx.driver_name,
          tx.driver_phone,
          tx.item_name,
          tx.destination,
          tx.operation_type_name,
        ].some((value) => String(value ?? '').toLowerCase().includes(needle));
      return matchesOperator && matchesSearch;
    });
  }, [filters.operator, filters.search, transactions]);

  const searchedOverweightEvents = useMemo(() => {
    const needle = filters.search.trim().toLowerCase();
    return overweightEvents.filter((row) => {
      const operatorName = (row.operator_name || '').trim();
      const matchesOperator =
        filters.operator === 'all' ||
        (filters.operator.startsWith('legacy:') && filters.operator === `legacy:${operatorName}`) ||
        operatorOptions.some((option) => option.value === filters.operator && option.label === operatorName);
      const matchesSearch =
        !needle ||
        [row.vehicle_plate, row.branch_name, row.operator_name].some((value) =>
          String(value ?? '').toLowerCase().includes(needle)
        );
      return matchesOperator && matchesSearch;
    });
  }, [filters.operator, filters.search, overweightEvents]);

  const searchedDiscrepancies = useMemo(() => {
    if (!filters.search.trim()) return discrepancies;
    const needle = filters.search.trim().toLowerCase();
    return discrepancies.filter((row) =>
      [row.branch_name, row.resolution_status, row.resolution_note].some((value) =>
        String(value ?? '').toLowerCase().includes(needle)
      )
    );
  }, [filters.search, discrepancies]);

  const completedTransactions = searchedTransactions.filter((tx) => tx.status === 'Completed');
  const pendingPayments = searchedTransactions.filter((tx) => tx.payment_status === 'Pending');
  const paidTransactions = searchedTransactions.filter((tx) => tx.payment_status === 'Paid');
  const approvalQueue = searchedTransactions.filter((tx) => tx.manual_weight_capture && !tx.approval_status);

  const reportDefinitions = useMemo<ReportDefinition[]>(() => {
    const operatorSummary = [...new Map(
      searchedTransactions.map((tx) => [transactionActorLabel(tx) || 'Unassigned', {
        operator: transactionActorLabel(tx) || 'Unassigned',
        transactions: 0,
        netWeight: 0,
        pendingApprovals: 0,
      }])
    ).values()];

    searchedTransactions.forEach((tx) => {
      const row = operatorSummary.find((item) => item.operator === (transactionActorLabel(tx) || 'Unassigned'));
      if (!row) return;
      row.transactions += 1;
      row.netWeight += num(tx.net_weight);
      if (tx.manual_weight_capture && !tx.approval_status) row.pendingApprovals += 1;
    });

    const customerSummary = [...new Map(
      completedTransactions.map((tx) => [tx.customer_name || 'Walk-in', {
        customer: tx.customer_name || 'Walk-in',
        transactions: 0,
        collected: 0,
        outstanding: 0,
      }])
    ).values()];

    completedTransactions.forEach((tx) => {
      const row = customerSummary.find((item) => item.customer === (tx.customer_name || 'Walk-in'));
      if (!row) return;
      row.transactions += 1;
      row.collected += tx.payment_status === 'Paid' ? num(tx.charge) : 0;
      row.outstanding += tx.payment_status === 'Pending' ? num(tx.charge) : 0;
    });

    const branchSummary = [...new Map(
      completedTransactions.map((tx) => [tx.branch_name || 'Unassigned', {
        branch: tx.branch_name || 'Unassigned',
        transactions: 0,
        revenue: 0,
        netWeight: 0,
      }])
    ).values()];

    completedTransactions.forEach((tx) => {
      const row = branchSummary.find((item) => item.branch === (tx.branch_name || 'Unassigned'));
      if (!row) return;
      row.transactions += 1;
      row.revenue += num(tx.charge);
      row.netWeight += num(tx.net_weight);
    });

    return [
      {
        id: 'ops_transactions',
        tab: 'operations',
        title: 'Transactions',
        description: '',
        metricLabel: 'Transactions',
        metricValue: fmtInt(searchedTransactions.length),
        icon: <Truck className="h-4 w-4" />,
        columns: [
          { key: 'tx', label: 'Tx' },
          { key: 'vehicle', label: 'Vehicle' },
          { key: 'customer', label: 'Customer' },
          { key: 'driver', label: 'Driver' },
          { key: 'operator', label: 'Operator' },
          { key: 'status', label: 'Status' },
          { key: 'net', label: 'Net Weight', align: 'right' },
          { key: 'created', label: 'Created' },
        ],
        rows: searchedTransactions.map((tx) => ({
          tx: String(tx.id).padStart(5, '0'),
          vehicle: tx.vehicle_plate || '—',
          customer: tx.customer_name || '—',
          driver: tx.driver_name || '—',
          operator: transactionActorLabel(tx) || '—',
          status: <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${badgeTone(tx.status)}`}>{tx.status || '—'}</span>,
          net: `${fmtInt(num(tx.net_weight))} kg`,
          created: fmtDate(tx.created_at),
        })),
        exportRows: searchedTransactions.map((tx) => ({
          Transaction: tx.id,
          Vehicle: tx.vehicle_plate || '',
          Customer: tx.customer_name || '',
          DriverName: tx.driver_name || '',
          DriverPhone: tx.driver_phone || '',
          Operator: transactionActorLabel(tx) || '',
          Status: tx.status || '',
          NetWeightKg: num(tx.net_weight),
          CreatedAt: fmtDate(tx.created_at),
        })),
      },
      {
        id: 'ops_approvals',
        tab: 'operations',
        title: 'Pending Approvals',
        description: '',
        metricLabel: 'Pending Reviews',
        metricValue: fmtInt(approvalQueue.length),
        icon: <ShieldAlert className="h-4 w-4" />,
        columns: [
          { key: 'tx', label: 'Tx' },
          { key: 'vehicle', label: 'Vehicle' },
          { key: 'branch', label: 'Branch' },
          { key: 'driver', label: 'Driver' },
          { key: 'operator', label: 'Operator' },
          { key: 'reason', label: 'Capture Mode' },
          { key: 'time', label: 'Created' },
        ],
        rows: approvalQueue.map((tx) => ({
          tx: String(tx.id).padStart(5, '0'),
          vehicle: tx.vehicle_plate || '—',
          branch: tx.branch_name || '—',
          driver: tx.driver_name || '—',
          operator: transactionActorLabel(tx) || '—',
          reason: 'Manual capture',
          time: fmtDate(tx.created_at),
        })),
        exportRows: approvalQueue.map((tx) => ({
          Transaction: tx.id,
          Vehicle: tx.vehicle_plate || '',
          Branch: tx.branch_name || '',
          DriverName: tx.driver_name || '',
          DriverPhone: tx.driver_phone || '',
          Operator: transactionActorLabel(tx) || '',
          Mode: 'Manual capture',
          CreatedAt: fmtDate(tx.created_at),
        })),
      },
      {
        id: 'ops_overweight',
        tab: 'operations',
        title: 'Vehicle Presence Log',
        description: '',
        metricLabel: 'Events',
        metricValue: fmtInt(searchedOverweightEvents.length),
        icon: <AlertTriangle className="h-4 w-4" />,
        columns: [
          { key: 'event', label: 'Event' },
          { key: 'vehicle', label: 'Vehicle' },
          { key: 'branch', label: 'Branch' },
          { key: 'operator', label: 'Operator' },
          { key: 'weight', label: 'Net Weight', align: 'right' },
          { key: 'recorded', label: 'Recorded' },
        ],
        rows: searchedOverweightEvents.map((row) => ({
          event: String(row.id).padStart(5, '0'),
          vehicle: row.vehicle_plate || '—',
          branch: row.branch_name || '—',
          operator: row.operator_name || '—',
          weight: `${fmtInt(num(row.net_weight))} kg`,
          recorded: fmtDate(row.recorded_at),
        })),
        exportRows: searchedOverweightEvents.map((row) => ({
          Event: row.id,
          Vehicle: row.vehicle_plate || '',
          Branch: row.branch_name || '',
          Operator: row.operator_name || '',
          NetWeightKg: num(row.net_weight),
          ThresholdKg: num(row.threshold_at_capture),
          RecordedAt: fmtDate(row.recorded_at),
        })),
      },
      {
        id: 'ops_discrepancies',
        tab: 'operations',
        title: 'Issues',
        description: '',
        metricLabel: 'Open Issues',
        metricValue: fmtInt(searchedDiscrepancies.filter((row) => row.resolution_status !== 'resolved').length),
        icon: <Activity className="h-4 w-4" />,
        columns: [
          { key: 'id', label: 'Issue' },
          { key: 'branch', label: 'Branch' },
          { key: 'status', label: 'Status' },
          { key: 'note', label: 'Note' },
          { key: 'created', label: 'Created' },
          { key: 'resolved', label: 'Resolved' },
        ],
        rows: searchedDiscrepancies.map((row) => ({
          id: String(row.id).padStart(5, '0'),
          branch: row.branch_name || '—',
          status: <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${badgeTone(row.resolution_status)}`}>{row.resolution_status || '—'}</span>,
          note: row.resolution_note || '—',
          created: fmtDate(row.created_at),
          resolved: fmtDate(row.resolved_at),
        })),
        exportRows: searchedDiscrepancies.map((row) => ({
          Issue: row.id,
          Branch: row.branch_name || '',
          Status: row.resolution_status || '',
          Note: row.resolution_note || '',
          CreatedAt: fmtDate(row.created_at),
          ResolvedAt: fmtDate(row.resolved_at),
        })),
      },
      {
        id: 'ops_operators',
        tab: 'operations',
        title: 'Operators',
        description: '',
        metricLabel: 'Operators',
        metricValue: fmtInt(operatorSummary.length),
        icon: <UserCircle2 className="h-4 w-4" />,
        columns: [
          { key: 'operator', label: 'Operator' },
          { key: 'transactions', label: 'Transactions', align: 'right' },
          { key: 'net', label: 'Net Weight', align: 'right' },
          { key: 'reviews', label: 'Pending Reviews', align: 'right' },
        ],
        rows: operatorSummary
          .sort((a, b) => b.transactions - a.transactions)
          .map((row) => ({
            operator: row.operator,
            transactions: fmtInt(row.transactions),
            net: `${fmtInt(row.netWeight)} kg`,
            reviews: fmtInt(row.pendingApprovals),
          })),
        exportRows: operatorSummary.map((row) => ({
          Operator: row.operator,
          Transactions: row.transactions,
          NetWeightKg: row.netWeight,
          PendingReviews: row.pendingApprovals,
        })),
      },
      {
        id: 'fin_collections',
        tab: 'financial',
        title: 'Collections',
        description: '',
        metricLabel: 'Collected',
        metricValue: fmtMoney(paidTransactions.reduce((sum, tx) => sum + num(tx.charge), 0)),
        icon: <Wallet className="h-4 w-4" />,
        columns: [
          { key: 'tx', label: 'Tx' },
          { key: 'customer', label: 'Customer' },
          { key: 'branch', label: 'Branch' },
          { key: 'mode', label: 'Payment Mode' },
          { key: 'amount', label: 'Amount', align: 'right' },
          { key: 'reference', label: 'Reference' },
          { key: 'received', label: 'Received' },
        ],
        rows: paidTransactions.map((tx) => ({
          tx: String(tx.id).padStart(5, '0'),
          customer: tx.customer_name || '—',
          branch: tx.branch_name || '—',
          mode: tx.payment_mode || '—',
          amount: fmtMoney(num(tx.charge)),
          reference: tx.payment_reference || '—',
          received: fmtDate(tx.payment_received_at),
        })),
        exportRows: paidTransactions.map((tx) => ({
          Transaction: tx.id,
          Customer: tx.customer_name || '',
          Branch: tx.branch_name || '',
          PaymentMode: tx.payment_mode || '',
          Amount: num(tx.charge),
          Reference: tx.payment_reference || '',
          ReceivedAt: fmtDate(tx.payment_received_at),
        })),
      },
      {
        id: 'fin_receivables',
        tab: 'financial',
        title: 'Receivables',
        description: '',
        metricLabel: 'Outstanding',
        metricValue: fmtMoney(pendingPayments.reduce((sum, tx) => sum + num(tx.charge), 0)),
        icon: <CreditCard className="h-4 w-4" />,
        columns: [
          { key: 'tx', label: 'Tx' },
          { key: 'customer', label: 'Customer' },
          { key: 'vehicle', label: 'Vehicle' },
          { key: 'branch', label: 'Branch' },
          { key: 'amount', label: 'Amount', align: 'right' },
          { key: 'status', label: 'Status' },
          { key: 'created', label: 'Created' },
        ],
        rows: pendingPayments.map((tx) => ({
          tx: String(tx.id).padStart(5, '0'),
          customer: tx.customer_name || '—',
          vehicle: tx.vehicle_plate || '—',
          branch: tx.branch_name || '—',
          amount: fmtMoney(num(tx.charge)),
          status: <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${badgeTone(tx.payment_status)}`}>{tx.payment_status || '—'}</span>,
          created: fmtDate(tx.created_at),
        })),
        exportRows: pendingPayments.map((tx) => ({
          Transaction: tx.id,
          Customer: tx.customer_name || '',
          Vehicle: tx.vehicle_plate || '',
          Branch: tx.branch_name || '',
          Amount: num(tx.charge),
          PaymentStatus: tx.payment_status || '',
          CreatedAt: fmtDate(tx.created_at),
        })),
      },
      {
        id: 'fin_customers',
        tab: 'financial',
        title: 'Customers',
        description: '',
        metricLabel: 'Customers',
        metricValue: fmtInt(customerSummary.length),
        icon: <Banknote className="h-4 w-4" />,
        columns: [
          { key: 'customer', label: 'Customer' },
          { key: 'transactions', label: 'Transactions', align: 'right' },
          { key: 'collected', label: 'Collected', align: 'right' },
          { key: 'outstanding', label: 'Outstanding', align: 'right' },
        ],
        rows: customerSummary
          .sort((a, b) => (b.collected + b.outstanding) - (a.collected + a.outstanding))
          .map((row) => ({
            customer: row.customer,
            transactions: fmtInt(row.transactions),
            collected: fmtMoney(row.collected),
            outstanding: fmtMoney(row.outstanding),
          })),
        exportRows: customerSummary.map((row) => ({
          Customer: row.customer,
          Transactions: row.transactions,
          Collected: row.collected,
          Outstanding: row.outstanding,
        })),
      },
      {
        id: 'fin_branches',
        tab: 'financial',
        title: 'Branches',
        description: '',
        metricLabel: 'Branches',
        metricValue: fmtInt(branchSummary.length),
        icon: <FileText className="h-4 w-4" />,
        columns: [
          { key: 'branch', label: 'Branch' },
          { key: 'transactions', label: 'Transactions', align: 'right' },
          { key: 'revenue', label: 'Revenue', align: 'right' },
          { key: 'weight', label: 'Net Weight', align: 'right' },
        ],
        rows: branchSummary
          .sort((a, b) => b.revenue - a.revenue)
          .map((row) => ({
            branch: row.branch,
            transactions: fmtInt(row.transactions),
            revenue: fmtMoney(row.revenue),
            weight: `${fmtInt(row.netWeight)} kg`,
          })),
        exportRows: branchSummary.map((row) => ({
          Branch: row.branch,
          Transactions: row.transactions,
          Revenue: row.revenue,
          NetWeightKg: row.netWeight,
        })),
      },
    ];
  }, [approvalQueue, completedTransactions, paidTransactions, pendingPayments, searchedDiscrepancies, searchedOverweightEvents, searchedTransactions]);

  const visibleTabs = useMemo(() => {
    const tabs: ReportTab[] = [];
    if (canViewOperations) tabs.push('operations');
    if (canViewFinancial) tabs.push('financial');
    return tabs;
  }, [canViewFinancial, canViewOperations]);

  const visibleReports = useMemo(() => {
    const tabbed = reportDefinitions.filter((report) => report.tab === activeTab);
    const needle = reportSearch.trim().toLowerCase();
    if (!needle) return tabbed;
    return tabbed.filter((report) =>
      report.title.toLowerCase().includes(needle) ||
      report.description.toLowerCase().includes(needle)
    );
  }, [activeTab, reportDefinitions, reportSearch]);

  const selectedReport = useMemo(
    () => visibleReports.find((report) => report.id === selectedReportId) ?? visibleReports[0] ?? null,
    [selectedReportId, visibleReports]
  );

  useEffect(() => {
    if (!visibleTabs.includes(activeTab)) {
      setActiveTab(visibleTabs[0] ?? 'operations');
    }
  }, [activeTab, visibleTabs]);

  useEffect(() => {
    if (!selectedReport || selectedReport.tab !== activeTab) {
      const fallback = visibleReports[0];
      if (fallback) setSelectedReportId(fallback.id);
    }
  }, [activeTab, selectedReport, visibleReports]);

  useEffect(() => {
    setPage(1);
  }, [selectedReportId, activeTab, filters]);

  useEffect(() => {
    setLibraryPage(1);
  }, [activeTab, reportSearch]);

  if (!canViewOperations && !canViewFinancial) {
    return (
      <Card className="border-border/70 shadow-sm">
        <CardContent className="p-10 text-center">
          <h1 className="text-xl font-bold">Access Denied</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your role does not have permission to view weighbridge reports.
          </p>
        </CardContent>
      </Card>
    );
  }

  const pagedRows = selectedReport ? selectedReport.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : [];
  const totalPages = selectedReport ? Math.max(1, Math.ceil(selectedReport.rows.length / PAGE_SIZE)) : 1;
  const rowStart = selectedReport && selectedReport.rows.length ? (page - 1) * PAGE_SIZE + 1 : 0;
  const rowEnd = selectedReport ? Math.min(page * PAGE_SIZE, selectedReport.rows.length) : 0;
  const pagedVisibleReports = visibleReports.slice((libraryPage - 1) * LIBRARY_PAGE_SIZE, libraryPage * LIBRARY_PAGE_SIZE);
  const displayRows: DisplayRow[] = pagedRows.map((row, index) => ({
    id: `${selectedReport?.id ?? 'report'}-${rowStart + index}`,
    ...row,
  }));
  const reportColumns: ERPTableColumn<DisplayRow>[] = (selectedReport?.columns ?? []).map((column) => ({
    key: column.key,
    label: column.label,
    headerClassName: `h-12 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground ${
      column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : ''
    }`,
    cellClassName: `py-3 text-sm text-foreground whitespace-nowrap ${
      column.align === 'right' ? 'text-right font-mono' : column.align === 'center' ? 'text-center' : ''
    }`,
    render: (row) => row[column.key] ?? '—',
  }));
  const totalCollected = paidTransactions.reduce((sum, tx) => sum + num(tx.charge), 0);
  const totalOutstanding = pendingPayments.reduce((sum, tx) => sum + num(tx.charge), 0);
  const totalOpsWeight = searchedTransactions.reduce((sum, tx) => sum + num(tx.net_weight), 0);
  const openIssues = searchedDiscrepancies.filter((row) => row.resolution_status !== 'resolved').length;
  const summaryItems = activeTab === 'operations'
    ? [
        { label: 'Transactions', value: fmtInt(searchedTransactions.length) },
        { label: 'Net Weight', value: `${fmtInt(totalOpsWeight)} kg` },
        { label: 'Approval Queue', value: fmtInt(approvalQueue.length) },
        { label: 'Open Issues', value: fmtInt(openIssues) },
      ]
    : [
        { label: 'Collections', value: fmtMoney(totalCollected) },
        { label: 'Receivables', value: fmtMoney(totalOutstanding) },
        { label: 'Paid Records', value: fmtInt(paidTransactions.length) },
        { label: 'Pending Records', value: fmtInt(pendingPayments.length) },
      ];
  const libraryGroups = [
    {
      key: 'operations',
      title: 'Operations Library',
      visible: canViewOperations,
      reports: reportDefinitions.filter((report) => report.tab === 'operations'),
    },
    {
      key: 'financial',
      title: 'Financial Library',
      visible: canViewFinancial,
      reports: reportDefinitions.filter((report) => report.tab === 'financial'),
    },
  ].filter((group) => group.visible);
  async function handleCsvExport() {
    if (!selectedReport || !canExport) return;
    exportCsv(selectedReport.exportRows, `${selectedReport.id}-${todayString()}.csv`);
  }

  function handleExcelExport() {
    if (!selectedReport || !canExport) return;
    exportExcel(selectedReport.exportRows, `${selectedReport.id}-${todayString()}.xls`);
  }

  async function handlePdfExport() {
    if (!selectedReport || !canExport || !token) return;
    try {
      const exportHeaders = selectedReport.exportRows.length ? Object.keys(selectedReport.exportRows[0]) : [];
      const res = await fetch('/api/commercial-weighbridge/reports/document/', {
        method: 'POST',
        headers: {
          Authorization: `Token ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          report_id: selectedReport.id,
          title: selectedReport.title,
          category: selectedReport.tab,
          columns: exportHeaders.map((key) => ({
            key,
            label: prettifyExportLabel(key),
            align: inferColumnAlignment(key),
          })),
          rows: selectedReport.exportRows,
          filters,
          summary_items: summaryItems,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.detail || payload?.error || `Export failed (${res.status})`);
      }
      const html = await res.text();
      const opened = printHtmlDocument(html);
      if (!opened) {
        throw new Error('The browser could not open the print document.');
      }
    } catch (error: any) {
      toast({
        title: 'PDF export failed',
        description: error?.message || 'Could not prepare the PDF export.',
        variant: 'destructive',
      });
    }
  }

  return (
    <ERPWorkspacePage
      title="Reports"
    >
      <section className="overflow-hidden border-y border-border bg-background shadow-sm">
        <div className="grid min-h-0 gap-0 xl:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="min-w-0 border-b border-border bg-card xl:border-b-0 xl:border-r">
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ReportTab)} className="space-y-4">
              <div className="border-b border-border px-3 py-3">
                <div className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Report Categories
                </div>
                <TabsList className="grid h-auto w-full grid-cols-2 rounded-2xl bg-muted p-1">
                {canViewOperations ? (
                  <TabsTrigger value="operations" className="rounded-xl px-3 py-2 text-sm font-semibold data-[state=active]:bg-background data-[state=active]:text-foreground">
                    Operations
                  </TabsTrigger>
                ) : null}
                {canViewFinancial ? (
                  <TabsTrigger value="financial" className="rounded-xl px-3 py-2 text-sm font-semibold data-[state=active]:bg-background data-[state=active]:text-foreground">
                    Financial
                  </TabsTrigger>
                ) : null}
                </TabsList>
                <div className="mt-2 text-xs text-muted-foreground">
                  Click a category, then choose a report below.
                </div>
              </div>
            </Tabs>

            <div className="border-b border-border px-3 py-3">
              <Label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Find Report
              </Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  value={reportSearch}
                  onChange={(event) => setReportSearch(event.target.value)}
                  placeholder="Search report names..."
                />
              </div>
            </div>

            <div className="max-h-[22rem] overflow-y-auto px-3 py-4 xl:max-h-[calc(100vh-15rem)]">
              {libraryGroups
                .filter((group) => group.key === activeTab)
                .map((group) => (
                  <div key={group.key} className="space-y-3">
                    <div className="mb-3 rounded-xl border border-border bg-muted px-3 py-2 text-sm font-bold uppercase tracking-[0.12em] text-foreground">
                      {group.title}
                    </div>
                    <div className="space-y-3">
                      {pagedVisibleReports.map((report) => (
                        <LibraryTile
                          key={report.id}
                          title={report.title}
                          active={selectedReport?.id === report.id}
                          onClick={() => setSelectedReportId(report.id)}
                        />
                      ))}
                      {visibleReports.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
                          No reports match "{reportSearch}".
                        </div>
                      ) : null}
                      {visibleReports.length > 0 ? (
                        <ListingPagination
                          page={libraryPage}
                          pageSize={LIBRARY_PAGE_SIZE}
                          totalCount={visibleReports.length}
                          onPage={setLibraryPage}
                          onPageSize={() => {}}
                        />
                      ) : null}
                    </div>
                  </div>
                ))}
            </div>
          </aside>

          <main className="min-w-0 overflow-hidden bg-muted/20 p-0">
            <div className="space-y-0">
              <Card className="overflow-hidden border-border shadow-sm">
                <CardContent className="p-0">
                  <div className="border-b border-border bg-card px-5 py-4 lg:px-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h2 className="mt-1 text-2xl font-black tracking-tight text-foreground">
                          {selectedReport?.title || 'Report'}
                        </h2>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
                          <DialogTrigger asChild>
                            <Button variant="outline">View Summary</Button>
                          </DialogTrigger>
                          <DialogContent className="sm:max-w-2xl">
                            <DialogHeader>
                              <DialogTitle>{activeTab === 'operations' ? 'Operations Summary' : 'Financial Summary'}</DialogTitle>
                            </DialogHeader>
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                              {summaryItems.map((item) => (
                                <SummaryCard key={item.label} label={item.label} value={item.value} />
                              ))}
                            </div>
                          </DialogContent>
                        </Dialog>
                        {canExport ? (
                          <>
                            <Button variant="outline" className="gap-2" onClick={handleCsvExport}>
                              <Download className="h-4 w-4" />
                              CSV
                            </Button>
                            <Button variant="outline" className="gap-2" onClick={handleExcelExport}>
                              <FileSpreadsheet className="h-4 w-4" />
                              Excel
                            </Button>
                            <Button className="gap-2" onClick={handlePdfExport}>
                              <FileText className="h-4 w-4" />
                              PDF
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="border-b border-border bg-card p-4 lg:px-6">
                    <ERPFilterBar
                      searchSlot={(
                        <>
                          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <Input
                            value={filters.search}
                            onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                            placeholder="Search selected report..."
                            className="h-8 border-0 shadow-none focus-visible:ring-0"
                          />
                        </>
                      )}
                      filterSlot={(
                        <>
                          <Select value={filters.branchId} onValueChange={(value) => setFilters((current) => ({ ...current, branchId: value }))}>
                            <SelectTrigger className="w-[170px]"><SelectValue placeholder="All branches" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All branches</SelectItem>
                              {branches.map((branch: ErpBranch) => (
                                <SelectItem key={branch.id} value={String(branch.id)}>{branch.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select value={filters.operator} onValueChange={(value) => setFilters((current) => ({ ...current, operator: value }))}>
                            <SelectTrigger className="w-[190px]"><SelectValue placeholder="All operators" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All operators</SelectItem>
                              {operatorOptions.map((operator) => (
                                <SelectItem key={operator.value} value={operator.value}>{operator.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select value={filters.status} onValueChange={(value) => setFilters((current) => ({ ...current, status: value }))}>
                            <SelectTrigger className="w-[150px]"><SelectValue placeholder="All statuses" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All statuses</SelectItem>
                              <SelectItem value="Draft">Draft</SelectItem>
                              <SelectItem value="Recalled">Recalled</SelectItem>
                              <SelectItem value="Rejected">Rejected</SelectItem>
                              <SelectItem value="Completed">Completed</SelectItem>
                            </SelectContent>
                          </Select>
                          <Select value={filters.paymentStatus} onValueChange={(value) => setFilters((current) => ({ ...current, paymentStatus: value }))}>
                            <SelectTrigger className="w-[150px]"><SelectValue placeholder="All payments" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All payments</SelectItem>
                              <SelectItem value="Paid">Paid</SelectItem>
                              <SelectItem value="Pending">Pending</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input type="date" value={filters.dateFrom} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))} className="w-[160px]" />
                          <Input type="date" value={filters.dateTo} onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))} className="w-[160px]" />
                        </>
                      )}
                    />
                  </div>

                  <div className="border-b border-border bg-card px-5 py-3 lg:px-6">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="text-sm font-medium text-foreground">
                        {selectedReport?.rows.length || 0} rows
                      </div>
                      <div className="text-xs text-muted-foreground">Showing {rowStart}-{rowEnd} of {selectedReport?.rows.length || 0}</div>
                    </div>
                  </div>

                  <div className="w-full overflow-x-auto bg-card">
                    <ERPDataTable
                      columns={reportColumns}
                      rows={displayRows}
                      emptyState="No rows matched the current filters for this report."
                    />
                  </div>

                  {totalPages > 1 ? (
                    <div className="border-t border-border bg-card px-5 py-4 lg:px-6">
                      <ListingPagination
                        page={page}
                        pageSize={PAGE_SIZE}
                        totalCount={selectedReport?.rows.length || 0}
                        onPage={setPage}
                        onPageSize={() => {}}
                      />
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          </main>
        </div>
      </section>

      {reportQuery.isLoading ? (
        <Card className="border-dashed">
          <CardContent className="flex items-center gap-3 p-5 text-sm text-muted-foreground">
            <Activity className="h-4 w-4 animate-pulse" />
            Loading report data for the selected workspace...
          </CardContent>
        </Card>
      ) : null}
    </ERPWorkspacePage>
  );
}

export default function ReportsDashboard() {
  const { user, role } = useAuth();
  const granted = new Set<string>(Array.isArray((user as any)?.permissions) ? (user as any).permissions.map(String) : []);
  const canViewReports = role === 'superadmin' || role === 'tenant_admin' || granted.has('Platform_Core.can_view_erp_reports');

  if (!canViewReports) {
    return (
      <div className="mx-auto flex min-h-[55vh] max-w-xl flex-col items-center justify-center gap-4 text-center">
        <div className="rounded-full bg-muted p-4"><FileSpreadsheet className="h-8 w-8 text-muted-foreground" /></div>
        <div>
          <h1 className="text-2xl font-bold">Reports access is not assigned</h1>
          <p className="mt-2 text-sm text-muted-foreground">Ask an administrator to grant your role the ERP Reports permission.</p>
        </div>
      </div>
    );
  }

  return <ReportsDashboardContent />;
}
