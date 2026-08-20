import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  ArrowDownAZ,
  ArrowUpAZ,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Printer,
  Search,
  SlidersHorizontal,
} from 'lucide-react';

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';
const moneyFmt = (v: number, currency = 'KES') =>
  currency + ' ' + Number(v ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2 });
const dateFmt = (value?: string | null) => value ? new Date(value).toLocaleDateString('en-KE') : '—';
const dateInputValue = (value: Date) => value.toISOString().slice(0, 10);
const safeHtml = (value?: string | number | null) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  issued: 'bg-blue-100 text-blue-700',
  paid: 'bg-emerald-100 text-emerald-700',
  overdue: 'bg-red-100 text-red-700',
  void: 'bg-gray-100 text-gray-500',
  Pending: 'bg-orange-100 text-orange-700',
  Completed: 'bg-emerald-100 text-emerald-700',
};

interface Customer {
  id: number;
  name: string;
  phone_number?: string;
  phone?: string;
  email?: string;
}

interface StatementInvoice {
  id: number;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  status: string;
  total: number;
  paid_amount: number;
  balance_amount: number;
  source_module: string;
  status_badge?: string;
  transaction_highlights?: Array<{
    transaction_number: string;
    vehicle_plate: string;
    item_name: string;
    branch_name: string;
    destination: string;
    payment_mode: string;
    payment_status: string;
    net_weight_display: string;
    charge_display: string;
  }>;
}

interface Statement {
  customer: {
    id: number;
    code?: string;
    name: string;
    phone: string;
    email: string;
    address: string;
    account_manager?: string;
    contact_person?: string;
    tax_pin?: string;
    credit_limit?: number | null;
    available_credit?: number | null;
    payment_terms?: string;
  };
  company: { name: string; email: string; phone: string; currency: string };
  branding?: { logo_url?: string; primary_color?: string; footer_text?: string };
  summary: {
    total_invoiced: number;
    total_paid: number;
    outstanding: number;
    opening_balance: number;
    sales_during_period: number;
    payments_received: number;
    closing_balance: number;
    amount_overdue: number;
    pending_amount: number;
    debt_amount: number;
    invoice_count: number;
    pending_count: number;
  };
  aging?: {
    current: number;
    days_1_30: number;
    days_31_60: number;
    days_61_90: number;
    days_90_plus: number;
    total: number;
  };
  invoices: StatementInvoice[];
  pending_transactions: Array<never>;
  recent_payments?: Array<{
    receipt_number?: string;
    date: string;
    payment_method?: string;
    reference?: string;
    amount: number;
  }>;
  activity_summary?: {
    total_invoices: number;
    paid_invoices: number;
    outstanding_invoices: number;
    total_payments: number;
    last_payment?: string | null;
    last_invoice?: string | null;
  };
  payment_instructions?: {
    bank?: string;
    account_name?: string;
    account_number?: string;
    branch?: string;
    paybill?: string;
    reference?: string;
    contact_email?: string;
    contact_phone?: string;
  };
}

type CustomerSortKey = 'name' | 'phone' | 'email';
type InvoiceSortKey = 'invoice_number' | 'invoice_date' | 'due_date' | 'source_module' | 'status' | 'total' | 'paid_amount' | 'balance_amount';
type SortDirection = 'asc' | 'desc';

function compareValues(a: string | number, b: string | number, direction: SortDirection) {
  const left = typeof a === 'number' ? a : String(a).toLowerCase();
  const right = typeof b === 'number' ? b : String(b).toLowerCase();
  if (left < right) return direction === 'asc' ? -1 : 1;
  if (left > right) return direction === 'asc' ? 1 : -1;
  return 0;
}

function downloadBlob(filename: string, content: BlobPart, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function buildStatementHtml({
  statement,
  invoices,
  recentPayments,
  dateFrom,
  dateTo,
}: {
  statement: Statement;
  invoices: StatementInvoice[];
  recentPayments: NonNullable<Statement['recent_payments']>;
  dateFrom: string;
  dateTo: string;
}) {
  const period = [dateFrom ? dateFmt(dateFrom) : 'Start', dateTo ? dateFmt(dateTo) : 'Today'].join(' to ');
  const brandColor = statement.branding?.primary_color || '#284B63';
  const footerText = statement.branding?.footer_text || 'Generated by SL-ERP';
  const logoUrl = statement.branding?.logo_url || '';
  const currency = statement.company.currency || 'KES';
  const aging = statement.aging || {
    current: 0,
    days_1_30: 0,
    days_31_60: 0,
    days_61_90: 0,
    days_90_plus: 0,
    total: 0,
  };
  const activitySummary = statement.activity_summary || {
    total_invoices: invoices.length,
    paid_invoices: 0,
    outstanding_invoices: invoices.filter((invoice) => invoice.balance_amount > 0).length,
    total_payments: statement.summary.total_paid,
    last_payment: null,
    last_invoice: null,
  };
  const paymentInstructions = statement.payment_instructions || {};
  const outstandingInvoices = invoices.filter((invoice) => invoice.balance_amount > 0);
  const accountRows = [
    ['Opening Balance', moneyFmt(statement.summary.opening_balance, currency)],
    ['Sales During Period', moneyFmt(statement.summary.sales_during_period, currency)],
    ['Payments Received', moneyFmt(statement.summary.payments_received, currency)],
    ['Closing Balance', moneyFmt(statement.summary.closing_balance, currency)],
    ['Amount Overdue', moneyFmt(statement.summary.amount_overdue, currency)],
  ];
  const customerRows = [
    ['Customer Code', statement.customer.code || '—'],
    ['Customer Name', statement.customer.name || '—'],
    ['Account Manager', statement.customer.account_manager || '—'],
    ['Contact Person', statement.customer.contact_person || '—'],
    ['Email', statement.customer.email || '—'],
    ['Phone', statement.customer.phone || '—'],
    ['Tax PIN', statement.customer.tax_pin || '—'],
    ['Credit Limit', statement.customer.credit_limit != null ? moneyFmt(statement.customer.credit_limit, currency) : '—'],
    ['Available Credit', statement.customer.available_credit != null ? moneyFmt(statement.customer.available_credit, currency) : '—'],
    ['Payment Terms', statement.customer.payment_terms || '—'],
    ['Currency', currency],
  ];
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Statement - ${safeHtml(statement.customer.name)}</title>
  <style>
    :root { --brand-color: ${safeHtml(brandColor)}; --brand-color-soft: #eef3f8; --brand-color-strong: #1f3e53; }
    body { font-family: "Segoe UI", Tahoma, sans-serif; margin: 24px; color: #0f172a; background: #f8fafc; }
    .document { max-width: 980px; margin: 0 auto; background: #fff; padding: 32px; border: 1px solid #e2e8f0; box-shadow: 0 18px 48px rgba(15, 23, 42, 0.08); }
    .header { text-align: center; margin-bottom: 24px; padding-bottom: 20px; border-bottom: 3px solid var(--brand-color); }
    .logo { width: 120px; max-height: 92px; object-fit: contain; display: block; margin: 0 auto 12px; }
    .panel { border: 1px solid #dbe4ec; border-radius: 12px; padding: 16px; background: #fff; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 20px 0; }
    .split { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin: 20px 0; }
    .metric { border: 1px solid #dbe4ec; border-radius: 12px; padding: 14px; background: var(--brand-color-soft); }
    .metric small { display: block; color: #64748b; margin-top: 6px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 10px 8px; text-align: left; font-size: 13px; vertical-align: top; }
    th { color: #f8fafc; background: var(--brand-color); }
    tbody tr:nth-child(even) { background: #f8fbfd; }
    h1, h2, h3, p { margin: 0; }
    h2 { margin-top: 28px; margin-bottom: 8px; }
    .section-title { margin-top: 24px; padding: 10px 14px; border-radius: 10px; background: var(--brand-color); color: #fff; font-size: 14px; font-weight: 700; }
    .kicker { color: var(--brand-color); font-size: 11px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; }
    .muted { color: #64748b; }
    .pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 4px 10px; font-size: 12px; font-weight: 600; }
    .paid { background: #dcfce7; color: #166534; }
    .outstanding { background: #dbeafe; color: #1d4ed8; }
    .overdue { background: #fee2e2; color: #b91c1c; }
    .closing { background: var(--brand-color-strong); color: #fff; }
    .footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 12px; }
    @media print {
      body { margin: 0; background: #fff; }
      .document { max-width: none; border: none; box-shadow: none; padding: 0; }
      .panel { break-inside: avoid; }
    }
    @media (max-width: 768px) {
      body { margin: 0; }
      .document { padding: 20px; }
      .grid, .split { display: block; }
      .grid > * + * { margin-top: 12px; }
      .panel + .panel { margin-top: 12px; }
    }
  </style>
</head>
<body>
  <div class="document">
    <div class="header">
      ${logoUrl ? `<img src="${safeHtml(logoUrl)}" alt="${safeHtml(statement.company.name)} logo" class="logo" />` : ''}
      <div class="kicker">${safeHtml(statement.company.name || 'SL-ERP')}</div>
      <h1 style="margin-top: 8px;">Customer Statement</h1>
      <p class="muted" style="margin-top: 8px;">Statement Period: ${safeHtml(period)}</p>
      <p class="muted">Generated: ${safeHtml(new Date().toLocaleString('en-KE'))}</p>
      <p class="muted">${safeHtml(statement.company.email || '')} ${statement.company.phone ? `· ${safeHtml(statement.company.phone)}` : ''}</p>
    </div>

    <div class="grid">
      <div class="metric"><strong>${safeHtml(moneyFmt(statement.summary.opening_balance, currency))}</strong><small>Opening Balance</small></div>
      <div class="metric"><strong>${safeHtml(moneyFmt(statement.summary.sales_during_period, currency))}</strong><small>Sales During Period</small></div>
      <div class="metric"><strong>${safeHtml(moneyFmt(statement.summary.payments_received, currency))}</strong><small>Payments Received</small></div>
      <div class="metric closing"><strong>${safeHtml(moneyFmt(statement.summary.closing_balance, currency))}</strong><small style="color:#dbeafe;">Closing Balance</small></div>
    </div>

    <div class="split">
      <div class="panel">
        <div class="section-title" style="margin-top:0;">Customer Information</div>
        <table>
          <tbody>
            ${customerRows.map(([label, value]) => `
              <tr>
                <td style="font-weight:600; width:42%; background:#f8fafc;">${safeHtml(label)}</td>
                <td>${safeHtml(value)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div class="panel">
        <div class="section-title" style="margin-top:0;">Account Summary</div>
        <table>
          <tbody>
            ${accountRows.map(([label, value]) => `
              <tr${label === 'Closing Balance' ? ' class="closing"' : ''}>
                <td style="font-weight:600; width:42%;">${safeHtml(label)}</td>
                <td>${safeHtml(value)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="section-title">Aging Analysis</div>
    <table>
      <thead>
        <tr>
          <th>Current</th>
          <th>1-30 Days</th>
          <th>31-60 Days</th>
          <th>61-90 Days</th>
          <th>Over 90 Days</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${safeHtml(moneyFmt(aging.current, currency))}</td>
          <td>${safeHtml(moneyFmt(aging.days_1_30, currency))}</td>
          <td>${safeHtml(moneyFmt(aging.days_31_60, currency))}</td>
          <td>${safeHtml(moneyFmt(aging.days_61_90, currency))}</td>
          <td>${safeHtml(moneyFmt(aging.days_90_plus, currency))}</td>
          <td>${safeHtml(moneyFmt(aging.total, currency))}</td>
        </tr>
      </tbody>
    </table>

    <div class="section-title">Outstanding Transactions</div>
    <table>
      <thead>
        <tr>
          <th>Invoice #</th>
          <th>Date</th>
          <th>Due Date</th>
          <th>Reference</th>
          <th>Description</th>
          <th>Amount</th>
          <th>Paid</th>
          <th>Balance</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${outstandingInvoices.length ? outstandingInvoices.map((invoice) => {
          const tx = invoice.transaction_highlights?.[0];
          const badgeClass = (invoice.status_badge || '').toLowerCase() === 'paid'
            ? 'paid'
            : (invoice.status_badge || '').toLowerCase() === 'overdue'
              ? 'overdue'
              : 'outstanding';
          return `
          <tr>
            <td>${safeHtml(invoice.invoice_number)}</td>
            <td>${safeHtml(dateFmt(invoice.invoice_date))}</td>
            <td>${safeHtml(dateFmt(invoice.due_date))}</td>
            <td>${safeHtml(tx?.transaction_number || '—')}</td>
            <td>${safeHtml(tx ? `${tx.vehicle_plate} @ ${tx.net_weight_display}` : '—')}</td>
            <td>${safeHtml(moneyFmt(invoice.total, currency))}</td>
            <td>${safeHtml(moneyFmt(invoice.paid_amount, currency))}</td>
            <td>${safeHtml(moneyFmt(invoice.balance_amount, currency))}</td>
            <td><span class="pill ${badgeClass}">${safeHtml(invoice.status_badge || invoice.status)}</span></td>
          </tr>
        `;
        }).join('') : '<tr><td colspan="8" class="muted">No outstanding invoices match the active filters.</td></tr>'}
      </tbody>
    </table>

    <div class="section-title">Recent Payments</div>
    <table>
      <thead>
        <tr>
          <th>Receipt No</th>
          <th>Date</th>
          <th>Payment Method</th>
          <th>Reference</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>
        ${recentPayments.length ? recentPayments.map((payment) => `
          <tr>
            <td>${safeHtml(payment.receipt_number || '—')}</td>
            <td>${safeHtml(dateFmt(payment.date))}</td>
            <td>${safeHtml(payment.payment_method || '—')}</td>
            <td>${safeHtml(payment.reference || '—')}</td>
            <td>${safeHtml(moneyFmt(payment.amount, currency))}</td>
          </tr>
        `).join('') : '<tr><td colspan="5" class="muted">No payments match the active filters.</td></tr>'}
      </tbody>
    </table>

    <div class="split">
      <div class="panel">
        <div class="section-title" style="margin-top:0;">Account Activity Summary</div>
        <table>
          <tbody>
            <tr><td style="font-weight:600;">Total Invoices</td><td>${safeHtml(activitySummary.total_invoices)}</td></tr>
            <tr><td style="font-weight:600;">Paid Invoices</td><td>${safeHtml(activitySummary.paid_invoices)}</td></tr>
            <tr><td style="font-weight:600;">Outstanding Invoices</td><td>${safeHtml(activitySummary.outstanding_invoices)}</td></tr>
            <tr><td style="font-weight:600;">Total Payments</td><td>${safeHtml(moneyFmt(activitySummary.total_payments, currency))}</td></tr>
            <tr><td style="font-weight:600;">Last Payment</td><td>${safeHtml(dateFmt(activitySummary.last_payment || undefined))}</td></tr>
            <tr><td style="font-weight:600;">Last Invoice</td><td>${safeHtml(activitySummary.last_invoice || '—')}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="panel">
        <div class="section-title" style="margin-top:0;">Payment Instructions</div>
        <table>
          <tbody>
            <tr><td style="font-weight:600;">Bank</td><td>${safeHtml(paymentInstructions.bank || '—')}</td></tr>
            <tr><td style="font-weight:600;">Account Name</td><td>${safeHtml(paymentInstructions.account_name || '—')}</td></tr>
            <tr><td style="font-weight:600;">Account Number</td><td>${safeHtml(paymentInstructions.account_number || '—')}</td></tr>
            <tr><td style="font-weight:600;">Branch</td><td>${safeHtml(paymentInstructions.branch || '—')}</td></tr>
            <tr><td style="font-weight:600;">Paybill</td><td>${safeHtml(paymentInstructions.paybill || '—')}</td></tr>
            <tr><td style="font-weight:600;">Reference</td><td>${safeHtml(paymentInstructions.reference || '—')}</td></tr>
            <tr><td style="font-weight:600;">Contact</td><td>${safeHtml(paymentInstructions.contact_email || paymentInstructions.contact_phone || '—')}</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="footer">${safeHtml(footerText)}</div>
  </div>
</body>
</html>`;
}

function SortableHead({
  label,
  active,
  direction,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
  className?: string;
}) {
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 text-left font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {label}
        {active ? (
          direction === 'asc' ? <ArrowUpAZ className="h-3.5 w-3.5" /> : <ArrowDownAZ className="h-3.5 w-3.5" />
        ) : (
          <SlidersHorizontal className="h-3.5 w-3.5 opacity-50" />
        )}
      </button>
    </TableHead>
  );
}

export default function StatementsPage() {
  const { token } = useAuth();
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerPage, setCustomerPage] = useState(1);
  const [customerPageSize, setCustomerPageSize] = useState(8);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [detailSearch, setDetailSearch] = useState('');
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState('all');
  const [invoiceSourceFilter, setInvoiceSourceFilter] = useState('all');
  const [invoiceSort, setInvoiceSort] = useState<{ key: InvoiceSortKey; direction: SortDirection }>({
    key: 'invoice_date',
    direction: 'desc',
  });
  const [customerSort, setCustomerSort] = useState<{ key: CustomerSortKey; direction: SortDirection }>({
    key: 'name',
    direction: 'asc',
  });
  const [previewOpen, setPreviewOpen] = useState(false);

  const { data: customersData, isLoading: loadingCustomers } = useQuery({
    queryKey: ['statement-customers', token, customerSearch],
    enabled: !!token,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (customerSearch) params.set('search', customerSearch);
      const r = await fetch(BASE_URL + '/api/sales/customers/?' + params.toString(), {
        headers: { Authorization: 'Token ' + token },
      });
      if (!r.ok) throw new Error('fetch failed');
      return r.json();
    },
  });

  const customers: Customer[] = customersData?.customers ?? [];

  const { data: statement, isLoading: loadingStatement } = useQuery({
    queryKey: ['customer-statement', token, selectedId, dateFrom, dateTo],
    enabled: !!token && selectedId !== null,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      const r = await fetch(BASE_URL + '/api/sales/customer-statements/' + selectedId + '/?' + params.toString(), {
        headers: { Authorization: 'Token ' + token },
      });
      if (!r.ok) throw new Error('fetch failed');
      return r.json() as Promise<Statement>;
    },
  });

  const sortedCustomers = [...customers].sort((a, b) => {
    const left = customerSort.key === 'phone'
      ? (a.phone_number || a.phone || '')
      : customerSort.key === 'email'
        ? (a.email || '')
        : a.name;
    const right = customerSort.key === 'phone'
      ? (b.phone_number || b.phone || '')
      : customerSort.key === 'email'
        ? (b.email || '')
        : b.name;
    return compareValues(left, right, customerSort.direction);
  });
  const customerTotalPages = Math.max(1, Math.ceil(sortedCustomers.length / customerPageSize));
  const pagedCustomers = sortedCustomers.slice((customerPage - 1) * customerPageSize, customerPage * customerPageSize);

  const invoiceStatuses = Array.from(new Set((statement?.invoices ?? []).map((invoice) => invoice.status).filter(Boolean)));
  const invoiceSources = Array.from(new Set((statement?.invoices ?? []).map((invoice) => invoice.source_module).filter(Boolean)));

  const filteredInvoices = [...(statement?.invoices ?? [])]
    .filter((invoice) => invoiceStatusFilter === 'all' || invoice.status === invoiceStatusFilter)
    .filter((invoice) => invoiceSourceFilter === 'all' || invoice.source_module === invoiceSourceFilter)
    .filter((invoice) => {
      if (!detailSearch.trim()) return true;
      const term = detailSearch.toLowerCase();
      return [
        invoice.invoice_number,
        invoice.source_module,
        invoice.status,
        dateFmt(invoice.invoice_date),
        invoice.status_badge,
        ...(invoice.transaction_highlights ?? []).flatMap((tx) => [
          tx.transaction_number,
          tx.vehicle_plate,
          tx.branch_name,
          tx.item_name,
          tx.destination,
        ]),
      ].some((value) => value?.toLowerCase().includes(term));
    })
    .sort((a, b) => {
      const left = invoiceSort.key === 'total'
        ? a.total
        : invoiceSort.key === 'paid_amount'
          ? a.paid_amount
          : invoiceSort.key === 'balance_amount'
            ? a.balance_amount
        : invoiceSort.key === 'invoice_date'
          ? new Date(a.invoice_date).getTime()
          : invoiceSort.key === 'due_date'
            ? new Date(a.due_date ?? '').getTime() || 0
            : a[invoiceSort.key];
      const right = invoiceSort.key === 'total'
        ? b.total
        : invoiceSort.key === 'paid_amount'
          ? b.paid_amount
          : invoiceSort.key === 'balance_amount'
            ? b.balance_amount
        : invoiceSort.key === 'invoice_date'
          ? new Date(b.invoice_date).getTime()
          : invoiceSort.key === 'due_date'
            ? new Date(b.due_date ?? '').getTime() || 0
            : b[invoiceSort.key];
      return compareValues(left, right, invoiceSort.direction);
    });
  const filteredOutstandingInvoices = filteredInvoices.filter((invoice) => invoice.balance_amount > 0);
  const filteredRecentPayments = (statement?.recent_payments ?? []).filter((payment) => {
    if (!detailSearch.trim()) return true;
    const term = detailSearch.toLowerCase();
    return [
      payment.receipt_number,
      payment.payment_method,
      payment.reference,
      dateFmt(payment.date),
    ].some((value) => value?.toLowerCase().includes(term));
  });

  function toggleCustomerSort(key: CustomerSortKey) {
    setCustomerSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  }

  function toggleInvoiceSort(key: InvoiceSortKey) {
    setInvoiceSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  }

  function applyQuickDatePreset(preset: 'thisMonth' | 'last30' | 'clear') {
    if (preset === 'clear') {
      setDateFrom('');
      setDateTo('');
      return;
    }
    const today = new Date();
    if (preset === 'last30') {
      const start = new Date(today);
      start.setDate(today.getDate() - 30);
      setDateFrom(dateInputValue(start));
      setDateTo(dateInputValue(today));
      return;
    }
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    setDateFrom(dateInputValue(startOfMonth));
    setDateTo(dateInputValue(today));
  }

  async function handleServerPrint() {
    if (!selectedId || !token) return;
    const params = new URLSearchParams();
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    params.set('download', 'pdf');
    const qs = params.toString();
    try {
      const response = await fetch(
        BASE_URL + '/api/sales/customer-statements/' + selectedId + '/document/' + (qs ? '?' + qs : ''),
        {
          headers: {
            Authorization: 'Token ' + token,
          },
        },
      );
      if (!response.ok) {
        throw new Error('Statement print failed with status ' + response.status);
      }
      const pdfBlob = await response.blob();
      const pdfUrl = URL.createObjectURL(pdfBlob);
      const anchor = document.createElement('a');
      anchor.href = pdfUrl;
      anchor.download = `customer_statement_${selectedId}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(pdfUrl), 60_000);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load statement.';
      console.error('Statement PDF download failed:', message);
      window.alert(`Statement PDF download failed: ${message}`);
    }
  }

  function handlePrintPreview() {
    if (!statement) return;
    setPreviewOpen(true);
  }

  function handleExportCsv() {
    if (!statement) return;
    const rows = [
      ['Section', 'Label', 'Value 1', 'Value 2', 'Value 3', 'Value 4', 'Value 5', 'Value 6', 'Value 7'],
      ['Account Summary', 'Opening Balance', String(statement.summary.opening_balance), '', '', '', '', '', ''],
      ['Account Summary', 'Sales During Period', String(statement.summary.sales_during_period), '', '', '', '', '', ''],
      ['Account Summary', 'Payments Received', String(statement.summary.payments_received), '', '', '', '', '', ''],
      ['Account Summary', 'Closing Balance', String(statement.summary.closing_balance), '', '', '', '', '', ''],
      ['Account Summary', 'Amount Overdue', String(statement.summary.amount_overdue), '', '', '', '', '', ''],
      ['Aging Analysis', 'Current', String(statement.aging?.current ?? 0), '', '', '', '', '', ''],
      ['Aging Analysis', '1-30 Days', String(statement.aging?.days_1_30 ?? 0), '', '', '', '', '', ''],
      ['Aging Analysis', '31-60 Days', String(statement.aging?.days_31_60 ?? 0), '', '', '', '', '', ''],
      ['Aging Analysis', '61-90 Days', String(statement.aging?.days_61_90 ?? 0), '', '', '', '', '', ''],
      ['Aging Analysis', 'Over 90 Days', String(statement.aging?.days_90_plus ?? 0), '', '', '', '', '', ''],
      ['Aging Analysis', 'Total', String(statement.aging?.total ?? 0), '', '', '', '', '', ''],
      ...filteredOutstandingInvoices.map((invoice) => {
        const tx = invoice.transaction_highlights?.[0];
        return [
          'Outstanding Transaction',
          invoice.invoice_number,
          dateFmt(invoice.invoice_date),
          dateFmt(invoice.due_date),
          tx?.transaction_number || '',
          tx ? `${tx.vehicle_plate} @ ${tx.net_weight_display}` : '',
          String(invoice.total),
          String(invoice.paid_amount),
          String(invoice.balance_amount),
        ];
      }),
      ...filteredRecentPayments.map((payment) => [
        'Recent Payment',
        payment.receipt_number || '',
        dateFmt(payment.date),
        payment.payment_method || '',
        payment.reference || '',
        String(payment.amount),
        '',
        '',
        '',
      ]),
    ];
    const csv = rows
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))
      .join('\n');
    downloadBlob(
      `${statement.customer.name.replace(/\s+/g, '_').toLowerCase()}_statement.csv`,
      csv,
      'text/csv;charset=utf-8;',
    );
  }

  function handleExportWord() {
    if (!statement) return;
    const html = buildStatementHtml({
      statement,
      invoices: filteredInvoices,
      recentPayments: filteredRecentPayments,
      dateFrom,
      dateTo,
    });
    downloadBlob(
      `${statement.customer.name.replace(/\s+/g, '_').toLowerCase()}_statement.doc`,
      html,
      'application/msword',
    );
  }

  const previewHtml = statement
    ? buildStatementHtml({
        statement,
        invoices: filteredInvoices,
        recentPayments: filteredRecentPayments,
        dateFrom,
        dateTo,
      })
    : '';

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Customer Statements</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review customer balances, outstanding invoices, payments, and statement exports in one place.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-2" onClick={handlePrintPreview} disabled={!statement}>
            <Eye className="h-4 w-4" />
            Preview
          </Button>
          <Button variant="outline" className="gap-2" onClick={handleExportCsv} disabled={!statement}>
            <FileSpreadsheet className="h-4 w-4" />
            Excel / CSV
          </Button>
          <Button variant="outline" className="gap-2" onClick={handleExportWord} disabled={!statement}>
            <Download className="h-4 w-4" />
            Word
          </Button>
          <Button className="gap-2" onClick={handleServerPrint} disabled={!statement}>
            <Printer className="h-4 w-4" />
            Print
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <CardContent className="space-y-4 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Customers</h2>
                <p className="text-sm text-muted-foreground">Use search, sorting, and pagination as the list grows.</p>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Rows</span>
                <Select
                  value={String(customerPageSize)}
                  onValueChange={(value) => {
                    setCustomerPageSize(Number(value));
                    setCustomerPage(1);
                  }}
                >
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[8, 12, 20, 30].map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search by customer name, phone, or email…"
                value={customerSearch}
                onChange={(e) => {
                  setCustomerSearch(e.target.value);
                  setCustomerPage(1);
                }}
              />
            </div>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead
                      label="Customer"
                      active={customerSort.key === 'name'}
                      direction={customerSort.direction}
                      onClick={() => toggleCustomerSort('name')}
                    />
                    <SortableHead
                      label="Phone"
                      active={customerSort.key === 'phone'}
                      direction={customerSort.direction}
                      onClick={() => toggleCustomerSort('phone')}
                    />
                    <SortableHead
                      label="Email"
                      active={customerSort.key === 'email'}
                      direction={customerSort.direction}
                      onClick={() => toggleCustomerSort('email')}
                    />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingCustomers ? (
                    <TableRow>
                      <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">Loading customers…</TableCell>
                    </TableRow>
                  ) : pagedCustomers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">No customers found</TableCell>
                    </TableRow>
                  ) : (
                    pagedCustomers.map((customer) => (
                      <TableRow
                        key={customer.id}
                        className={cn(
                          'cursor-pointer transition-colors hover:bg-muted/50',
                          selectedId === customer.id && 'bg-primary/10',
                        )}
                        onClick={() => setSelectedId(customer.id)}
                      >
                        <TableCell className="font-medium">{customer.name}</TableCell>
                        <TableCell>{customer.phone_number || customer.phone || '—'}</TableCell>
                        <TableCell>{customer.email || '—'}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Showing {sortedCustomers.length ? (customerPage - 1) * customerPageSize + 1 : 0}
                -
                {Math.min(customerPage * customerPageSize, sortedCustomers.length)} of {sortedCustomers.length}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={customerPage <= 1}
                  onClick={() => setCustomerPage((page) => Math.max(1, page - 1))}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Previous
                </Button>
                <span className="text-muted-foreground">Page {customerPage} of {customerTotalPages}</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={customerPage >= customerTotalPages}
                  onClick={() => setCustomerPage((page) => Math.min(customerTotalPages, page + 1))}
                >
                  Next
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-4 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Statement Filters</h2>
                  <p className="text-sm text-muted-foreground">Choose what appears on screen and in print or export output.</p>
                </div>
                <Badge variant="outline">
                  {statement ? `${filteredOutstandingInvoices.length} outstanding invoices • ${filteredRecentPayments.length} payments` : 'No customer selected'}
                </Badge>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">From</label>
                  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">To</label>
                  <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Invoice status</label>
                  <Select value={invoiceStatusFilter} onValueChange={setInvoiceStatusFilter}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      {invoiceStatuses.map((status) => (
                        <SelectItem key={status} value={status}>
                          {status}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Invoice source</label>
                  <Select value={invoiceSourceFilter} onValueChange={setInvoiceSourceFilter}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All sources</SelectItem>
                      {invoiceSources.map((source) => (
                        <SelectItem key={source} value={source}>
                          {source}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Statement snapshot</label>
                  <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                    Outstanding invoices and recorded payments only
                  </div>
                </div>
                <div className="md:col-span-2 xl:col-span-3">
                  <label className="mb-1 block text-xs text-muted-foreground">Search in selected statement</label>
                  <Input
                    placeholder="Search invoice numbers, transactions, branches, vehicles, references, or statuses…"
                    value={detailSearch}
                    onChange={(e) => setDetailSearch(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => applyQuickDatePreset('thisMonth')}>This month</Button>
                <Button variant="outline" size="sm" onClick={() => applyQuickDatePreset('last30')}>Last 30 days</Button>
                <Button variant="outline" size="sm" onClick={() => applyQuickDatePreset('clear')}>Clear dates</Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setInvoiceStatusFilter('all');
                    setInvoiceSourceFilter('all');
                    setDetailSearch('');
                  }}
                >
                  Reset content filters
                </Button>
              </div>
            </CardContent>
          </Card>

          {selectedId === null ? (
            <Card>
              <CardContent className="flex min-h-[420px] flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
                <FileText className="h-10 w-10 opacity-40" />
                <div>
                  <p className="font-medium text-foreground">Select a customer to view their statement</p>
                  <p className="text-sm text-muted-foreground">Filters and export tools will apply to the selected customer statement.</p>
                </div>
              </CardContent>
            </Card>
          ) : loadingStatement ? (
            <Card>
              <CardContent className="p-6 text-muted-foreground">Loading statement…</CardContent>
            </Card>
          ) : statement ? (
            <>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <Card><CardContent className="space-y-1 pt-4"><p className="text-2xl font-bold">{moneyFmt(statement.summary.opening_balance, statement.company.currency)}</p><p className="text-sm text-muted-foreground">Opening Balance</p></CardContent></Card>
                <Card><CardContent className="space-y-1 pt-4"><p className="text-2xl font-bold">{moneyFmt(statement.summary.sales_during_period, statement.company.currency)}</p><p className="text-sm text-muted-foreground">Sales During Period</p></CardContent></Card>
                <Card><CardContent className="space-y-1 pt-4"><p className="text-2xl font-bold text-emerald-700">{moneyFmt(statement.summary.payments_received, statement.company.currency)}</p><p className="text-sm text-muted-foreground">Payments Received</p></CardContent></Card>
                <Card><CardContent className="space-y-1 pt-4"><p className={cn('text-2xl font-bold', statement.summary.closing_balance > 0 && 'text-red-600')}>{moneyFmt(statement.summary.closing_balance, statement.company.currency)}</p><p className="text-sm text-muted-foreground">Closing Balance</p></CardContent></Card>
                <Card><CardContent className="space-y-1 pt-4"><p className={cn('text-2xl font-bold', statement.summary.amount_overdue > 0 && 'text-amber-600')}>{moneyFmt(statement.summary.amount_overdue, statement.company.currency)}</p><p className="text-sm text-muted-foreground">Amount Overdue</p></CardContent></Card>
              </div>

              <Tabs defaultValue="overview" className="space-y-4">
                <TabsList className="grid h-auto w-full grid-cols-3">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="transactions">Outstanding</TabsTrigger>
                  <TabsTrigger value="payments">Payments</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4">
                  <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                    <Card>
                      <CardContent className="space-y-4 p-4">
                        <div className="flex items-center justify-between">
                          <h2 className="text-lg font-semibold">Customer Information</h2>
                          <Badge variant="outline">{statement.customer.code || 'Customer Record'}</Badge>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          <div className="rounded-lg border p-3">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Customer Name</p>
                            <p className="font-medium">{statement.customer.name}</p>
                          </div>
                          <div className="rounded-lg border p-3">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Contact Person</p>
                            <p className="font-medium">{statement.customer.contact_person || '—'}</p>
                          </div>
                          <div className="rounded-lg border p-3">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Phone</p>
                            <p className="font-medium">{statement.customer.phone || '—'}</p>
                          </div>
                          <div className="rounded-lg border p-3">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Email</p>
                            <p className="font-medium break-all">{statement.customer.email || '—'}</p>
                          </div>
                          <div className="rounded-lg border p-3">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Payment Terms</p>
                            <p className="font-medium">{statement.customer.payment_terms || '—'}</p>
                          </div>
                          <div className="rounded-lg border p-3">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Account Manager</p>
                            <p className="font-medium">{statement.customer.account_manager || '—'}</p>
                          </div>
                        </div>
                        {statement.customer.address ? (
                          <div className="rounded-lg border p-3">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Address</p>
                            <p className="font-medium">{statement.customer.address}</p>
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardContent className="space-y-4 p-4">
                        <div className="flex items-center justify-between">
                          <h2 className="text-lg font-semibold">Aging Analysis</h2>
                          <Badge variant="secondary">{moneyFmt(statement.aging?.total ?? 0, statement.company.currency)}</Badge>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-lg border p-3">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Current</p>
                            <p className="text-lg font-semibold">{moneyFmt(statement.aging?.current ?? 0, statement.company.currency)}</p>
                          </div>
                          <div className="rounded-lg border p-3">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">1-30 Days</p>
                            <p className="text-lg font-semibold">{moneyFmt(statement.aging?.days_1_30 ?? 0, statement.company.currency)}</p>
                          </div>
                          <div className="rounded-lg border p-3">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">31-60 Days</p>
                            <p className="text-lg font-semibold">{moneyFmt(statement.aging?.days_31_60 ?? 0, statement.company.currency)}</p>
                          </div>
                          <div className="rounded-lg border p-3">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">61-90 Days</p>
                            <p className="text-lg font-semibold">{moneyFmt(statement.aging?.days_61_90 ?? 0, statement.company.currency)}</p>
                          </div>
                          <div className="rounded-lg border p-3">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Over 90 Days</p>
                            <p className="text-lg font-semibold">{moneyFmt(statement.aging?.days_90_plus ?? 0, statement.company.currency)}</p>
                          </div>
                          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total Due</p>
                            <p className="text-lg font-semibold">{moneyFmt(statement.aging?.total ?? 0, statement.company.currency)}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <Card>
                      <CardContent className="space-y-3 p-4">
                        <div className="flex items-center justify-between">
                          <h3 className="text-lg font-semibold">Account Activity Summary</h3>
                          <Badge variant="outline">{statement.activity_summary?.total_invoices ?? filteredInvoices.length} invoices</Badge>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-lg border p-3">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Paid Invoices</p>
                            <p className="text-lg font-semibold">{statement.activity_summary?.paid_invoices ?? 0}</p>
                          </div>
                          <div className="rounded-lg border p-3">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Outstanding Invoices</p>
                            <p className="text-lg font-semibold">{statement.activity_summary?.outstanding_invoices ?? filteredOutstandingInvoices.length}</p>
                          </div>
                          <div className="rounded-lg border p-3">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total Payments</p>
                            <p className="text-lg font-semibold">{moneyFmt(statement.activity_summary?.total_payments ?? 0, statement.company.currency)}</p>
                          </div>
                          <div className="rounded-lg border p-3">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Last Payment</p>
                            <p className="text-lg font-semibold">{dateFmt(statement.activity_summary?.last_payment || undefined)}</p>
                          </div>
                          <div className="rounded-lg border p-3 sm:col-span-2">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Last Invoice</p>
                            <p className="text-lg font-semibold">{statement.activity_summary?.last_invoice || '—'}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardContent className="space-y-3 p-4">
                        <h3 className="text-lg font-semibold">Payment Instructions</h3>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-lg border p-3"><p className="text-xs uppercase tracking-wide text-muted-foreground">Bank</p><p className="font-medium">{statement.payment_instructions?.bank || '—'}</p></div>
                          <div className="rounded-lg border p-3"><p className="text-xs uppercase tracking-wide text-muted-foreground">Account Name</p><p className="font-medium">{statement.payment_instructions?.account_name || '—'}</p></div>
                          <div className="rounded-lg border p-3"><p className="text-xs uppercase tracking-wide text-muted-foreground">Account Number</p><p className="font-medium">{statement.payment_instructions?.account_number || '—'}</p></div>
                          <div className="rounded-lg border p-3"><p className="text-xs uppercase tracking-wide text-muted-foreground">Branch</p><p className="font-medium">{statement.payment_instructions?.branch || '—'}</p></div>
                          <div className="rounded-lg border p-3"><p className="text-xs uppercase tracking-wide text-muted-foreground">Paybill</p><p className="font-medium">{statement.payment_instructions?.paybill || '—'}</p></div>
                          <div className="rounded-lg border p-3"><p className="text-xs uppercase tracking-wide text-muted-foreground">Reference</p><p className="font-medium">{statement.payment_instructions?.reference || '—'}</p></div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>

                <TabsContent value="transactions" className="space-y-4">
                  <Card>
                    <CardContent className="space-y-3 p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="text-lg font-semibold">Outstanding Transactions</h3>
                          <p className="text-sm text-muted-foreground">Only invoices with a remaining balance appear here.</p>
                        </div>
                        <Badge variant="outline">{filteredOutstandingInvoices.length} visible</Badge>
                      </div>
                      <div className="rounded-md border">
                        <ScrollArea className="max-h-[540px]">
                          <div className="min-w-[1120px]">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <SortableHead label="Invoice #" active={invoiceSort.key === 'invoice_number'} direction={invoiceSort.direction} onClick={() => toggleInvoiceSort('invoice_number')} />
                                  <SortableHead label="Date" active={invoiceSort.key === 'invoice_date'} direction={invoiceSort.direction} onClick={() => toggleInvoiceSort('invoice_date')} />
                                  <SortableHead label="Due Date" active={invoiceSort.key === 'due_date'} direction={invoiceSort.direction} onClick={() => toggleInvoiceSort('due_date')} />
                                  <TableHead className="min-w-[120px]">Reference</TableHead>
                                  <TableHead className="min-w-[220px]">Description</TableHead>
                                  <SortableHead label="Amount" active={invoiceSort.key === 'total'} direction={invoiceSort.direction} onClick={() => toggleInvoiceSort('total')} className="min-w-[120px]" />
                                  <SortableHead label="Paid" active={invoiceSort.key === 'paid_amount'} direction={invoiceSort.direction} onClick={() => toggleInvoiceSort('paid_amount')} className="min-w-[120px]" />
                                  <SortableHead label="Balance" active={invoiceSort.key === 'balance_amount'} direction={invoiceSort.direction} onClick={() => toggleInvoiceSort('balance_amount')} className="min-w-[120px]" />
                                  <SortableHead label="Status" active={invoiceSort.key === 'status'} direction={invoiceSort.direction} onClick={() => toggleInvoiceSort('status')} className="min-w-[120px]" />
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {filteredOutstandingInvoices.length === 0 ? (
                                  <TableRow>
                                    <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">No outstanding invoices match the current filters</TableCell>
                                  </TableRow>
                                ) : (
                                  filteredOutstandingInvoices.map((invoice) => {
                                    const tx = invoice.transaction_highlights?.[0];
                                    return (
                                      <TableRow key={invoice.id}>
                                        <TableCell className="font-medium">{invoice.invoice_number}</TableCell>
                                        <TableCell>{dateFmt(invoice.invoice_date)}</TableCell>
                                        <TableCell>{dateFmt(invoice.due_date)}</TableCell>
                                        <TableCell>{tx?.transaction_number || '—'}</TableCell>
                                        <TableCell>{tx ? `${tx.vehicle_plate} @ ${tx.net_weight_display}` : '—'}</TableCell>
                                        <TableCell>{moneyFmt(invoice.total, statement.company.currency)}</TableCell>
                                        <TableCell>{moneyFmt(invoice.paid_amount, statement.company.currency)}</TableCell>
                                        <TableCell className="font-semibold">{moneyFmt(invoice.balance_amount, statement.company.currency)}</TableCell>
                                        <TableCell>
                                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[invoice.status] ?? statusColors[invoice.status_badge || ''] ?? 'bg-gray-100 text-gray-700'}`}>
                                            {invoice.status_badge || invoice.status}
                                          </span>
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })
                                )}
                              </TableBody>
                            </Table>
                          </div>
                        </ScrollArea>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="payments" className="space-y-4">
                  <Card>
                    <CardContent className="space-y-3 p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="text-lg font-semibold">Recent Payments</h3>
                          <p className="text-sm text-muted-foreground">Payments received in the selected statement period.</p>
                        </div>
                        <Badge variant="secondary">{filteredRecentPayments.length} visible</Badge>
                      </div>
                      <div className="rounded-md border">
                        <ScrollArea className="max-h-[540px]">
                          <div className="min-w-[760px]">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="min-w-[140px]">Receipt No</TableHead>
                                  <TableHead className="min-w-[120px]">Date</TableHead>
                                  <TableHead className="min-w-[160px]">Payment Method</TableHead>
                                  <TableHead className="min-w-[180px]">Reference</TableHead>
                                  <TableHead className="min-w-[140px]">Amount</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {filteredRecentPayments.length === 0 ? (
                                  <TableRow>
                                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">No payments match the current filters</TableCell>
                                  </TableRow>
                                ) : (
                                  filteredRecentPayments.map((payment, index) => (
                                    <TableRow key={`${payment.receipt_number || 'payment'}-${index}`}>
                                      <TableCell className="font-medium">{payment.receipt_number || '—'}</TableCell>
                                      <TableCell>{dateFmt(payment.date)}</TableCell>
                                      <TableCell>{payment.payment_method || '—'}</TableCell>
                                      <TableCell>{payment.reference || '—'}</TableCell>
                                      <TableCell>{moneyFmt(payment.amount, statement.company.currency)}</TableCell>
                                    </TableRow>
                                  ))
                                )}
                              </TableBody>
                            </Table>
                          </div>
                        </ScrollArea>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </>
          ) : null}
        </div>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-6xl">
          <DialogHeader>
            <DialogTitle>Statement Preview</DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Review how the document will look before printing or saving it for Word.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleExportWord} disabled={!statement}>
                Save as Word
              </Button>
              <Button
                onClick={() => {
                  const win = window.open('', '_blank', 'noopener,noreferrer');
                  if (!win) return;
                  win.document.open();
                  win.document.write(previewHtml);
                  win.document.close();
                  win.focus();
                  setTimeout(() => win.print(), 300);
                }}
                disabled={!statement}
              >
                Print from Preview
              </Button>
            </div>
          </div>
          <iframe title="Statement Preview" srcDoc={previewHtml} className="min-h-[70vh] w-full rounded-md border bg-white" />
        </DialogContent>
      </Dialog>
    </div>
  );
}
