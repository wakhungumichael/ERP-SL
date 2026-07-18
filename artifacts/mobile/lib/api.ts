/**
 * SL-ERP Django API client for the mobile app.
 * - Base URL: EXPO_PUBLIC_DOMAIN (auto-injected as REPLIT_DEV_DOMAIN in dev)
 * - Auth: Django Token prefix ("Token <token>", not Bearer)
 * - Response envelope: Platform endpoints wrap in {success, data: {...}}
 *   Weighbridge/payments return data directly — handled transparently.
 */

const getBase = (): string => {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  return domain ? `https://${domain}` : 'http://localhost:8080';
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Token ${token}` } : {}),
  };

  const res = await fetch(`${getBase()}/api${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers as Record<string, string> ?? {}) },
  });

  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const err = await res.json();
      msg =
        err?.detail ||
        err?.non_field_errors?.[0] ||
        err?.message ||
        JSON.stringify(err);
    } catch {}
    throw new ApiError(res.status, msg);
  }

  const json = await res.json();
  // Unwrap Django success envelope: {success: true, data: {...}}
  return (json?.data !== undefined ? json.data : json) as T;
}

// ── Typed helpers ─────────────────────────────────────────────────────────────

export interface User {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  is_superuser: boolean;
  groups: Array<{ id: number; name: string }>;
}

export interface Branch {
  id: number;
  name: string;
  address: string;
  email: string;
  phone: string;
}

export interface Customer {
  id: number;
  name: string;
  /** Backend field is phone_number (not phone) */
  phone_number: string;
  email: string;
  address: string;
  discounted: boolean;
  charge: string;
}

export interface VehicleType {
  id: number;
  name: string;
  charge: string;
  max_gross_weight: number | null;
  max_tare_weight: number | null;
}

export interface Vehicle {
  id: number;
  number_plate: string;
  customer: number;
  customer_name: string;
  vehicle_type: number | null;
  vehicle_type_name: string;
}

export interface Item {
  id: number;
  name: string;
  description: string;
}

export interface Transaction {
  id: number;
  branch: number;
  branch_name: string;
  customer: number;
  customer_name: string;
  vehicle: number;
  vehicle_plate: string;
  vehicle_type: number | null;
  vehicle_type_name: string;
  operator: string;
  item: number | null;
  item_name: string;
  gross_weight: number | null;
  tare_weight: number | null;
  net_weight: number | null;
  gross_weight_date: string | null;
  tare_weight_date: string | null;
  status: 'Pending' | 'Completed';
  /** 'First Weight' | 'Second Weight' */
  weight_type: string;
  payment_mode: string;
  payment_status: string;
  charge: string;
  destination: string;
  invoiced: boolean;
  approval_status: boolean;
  manual_weight_capture: boolean;
  weight_reason: string | null;
  paired: boolean;
  paired_first_transaction: number | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowContext {
  vehicle_id: number;
  vehicle_plate: string;
  customer_id: number;
  customer_name: string;
  vehicle_type_id: number | null;
  vehicle_type_name: string;
  has_pending_first_weight: boolean;
  /** 'first_weight' | 'second_weight' */
  workflow_recommendation: string;
  first_weight_transaction: Transaction | null;
  message: string;
}

export interface PaginatedTransactions {
  count: number;
  next: string | null;
  previous: string | null;
  results: Transaction[];
}

export interface DashboardTotals {
  transactions_today: number;
  transactions_this_month: number;
  net_weight_today: number;
  pending_payments: number;
  total_charge: number;
}

export interface Dashboard {
  totals: DashboardTotals;
  status_breakdown: Array<{ status: string; count: number }>;
  recent_transactions: Transaction[];
}

export interface LiveWeight {
  weight: number | null;
  unit: string;
  stable: boolean;
  source: string;
  branch_id: number | null;
  timestamp: string;
}

export interface CaptureWeightResponse {
  captured_weight: number | null;
  unit: string;
  stable: boolean;
  source: string;
  branch_id: number | null;
  transaction_id: number | null;
  applied: boolean;
  transaction: Transaction | null;
  indicator_meta: Record<string, unknown>;
  timestamp: string;
}

export interface ReceivePaymentResponse {
  success: boolean;
  transaction_id: number;
  payment_mode: string;
  payment_status: string;
  reference: string;
  invoice_id: number | null;
  transaction: Transaction;
}

export async function receivePayment(
  txId: number,
  method: string,
  reference: string,
  token?: string | null,
): Promise<ReceivePaymentResponse> {
  return apiRequest<ReceivePaymentResponse>(
    `/commercial-weighbridge/transactions/${txId}/receive-payment/`,
    { method: 'POST', body: JSON.stringify({ method, reference }) },
    token,
  );
}
