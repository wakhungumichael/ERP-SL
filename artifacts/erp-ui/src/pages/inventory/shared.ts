import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/use-auth';

export const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';

export type Product = {
  id: number;
  code?: string;
  name: string;
  product_type: 'product' | 'service';
  unit?: string;
  unit_price?: number;
  tax_rate?: number;
  is_active: boolean;
  is_sales_item?: boolean;
  is_purchase_item?: boolean;
  is_stock_item?: boolean;
  is_service?: boolean;
};

export type SalesOrderLine = {
  id?: number;
  product?: number | null;
  description?: string;
  quantity?: number | string;
};

export type SalesOrder = {
  id: number;
  order_number?: string;
  customer_name?: string;
  customer_display?: string;
  order_date?: string;
  expected_delivery_date?: string | null;
  total?: number;
  status: string;
  line_items?: SalesOrderLine[];
};

export type RequisitionLine = {
  id?: number;
  description?: string;
  quantity?: number | string;
  unit_price?: number | string;
  unit?: string;
  item_type?: string;
};

export type Requisition = {
  id: number;
  request_number?: string;
  title: string;
  cost_center?: string;
  project_code?: string;
  status: string;
  budget_status?: string;
  estimated_total?: string | number;
  currency?: string;
  vendor_option?: string;
  created_at?: string;
  updated_at?: string;
  lines?: RequisitionLine[];
};

export type ReceiptLine = {
  id?: number;
  description?: string;
  ordered_quantity?: number | string;
  received_quantity?: number | string;
  accepted_quantity?: number | string;
  unit_price?: number | string;
};

export type Receipt = {
  id: number;
  receipt_number?: string;
  purchase_order?: string | number;
  received_date?: string;
  status?: string;
  notes?: string;
  lines?: ReceiptLine[];
};

export type Warehouse = {
  id: number;
  branch?: number | null;
  branch_name?: string;
  code: string;
  name: string;
  warehouse_type: string;
  status: string;
  is_default: boolean;
  is_virtual: boolean;
  notes?: string;
};

export type InventoryBalance = {
  id: number;
  warehouse: number;
  warehouse_name?: string;
  product: number;
  product_name?: string;
  product_code?: string;
  on_hand_qty: number | string;
  reserved_qty: number | string;
  available_qty: number | string;
  average_cost: number | string;
  valuation_amount: number | string;
  last_movement_at?: string | null;
};

export type InventoryMovement = {
  id: number;
  warehouse: number;
  warehouse_name?: string;
  product: number;
  product_name?: string;
  product_code?: string;
  movement_type: 'receipt' | 'reservation' | 'release' | 'issue' | 'adjustment';
  reference_type: string;
  reference_id?: number | null;
  reference_line_id?: number | null;
  reference_number?: string;
  quantity: number | string;
  unit_cost: number | string;
  total_cost: number | string;
  movement_date: string;
  notes?: string;
};

export type InventoryReservation = {
  id: number;
  warehouse: number;
  warehouse_name?: string;
  product: number;
  product_name?: string;
  product_code?: string;
  sales_order?: number | null;
  sales_order_number?: string;
  sales_order_line?: number | null;
  quantity: number | string;
  status: string;
  reserved_at: string;
  released_at?: string | null;
  consumed_at?: string | null;
};

export type InventoryDashboard = {
  counts: {
    warehouses: number;
    balances: number;
    movements: number;
    reservations: number;
    active_reservations: number;
  };
  totals: {
    on_hand: number | string;
    reserved: number | string;
    available: number | string;
    valuation: number | string;
  };
};

function extractResults<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object' && Array.isArray((payload as { results?: unknown[] }).results)) {
    return (payload as { results: T[] }).results;
  }
  return [];
}

export function numberValue(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatCurrency(value: number, currency = 'KES') {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatCount(value: number) {
  return Number(value ?? 0).toLocaleString('en-KE');
}

export function warehouseName(index: number) {
  return ['Main Warehouse', 'Transit Warehouse', 'Branch Fulfillment', 'Returns & QA'][index % 4];
}

export function useInventoryWorkspaceData() {
  const { token } = useAuth();

  return useQuery({
    queryKey: ['inventory-workspace', token],
    enabled: !!token,
    staleTime: 60_000,
    queryFn: async () => {
      const headers = { Authorization: `Token ${token}` };
      const [
        productsRes,
        ordersRes,
        requisitionsRes,
        receiptsRes,
        dashboardRes,
        warehousesRes,
        balancesRes,
        movementsRes,
        reservationsRes,
      ] = await Promise.all([
        fetch(BASE_URL + '/api/sales/products/', { headers }),
        fetch(BASE_URL + '/api/sales/sales-orders/?page_size=100', { headers }),
        fetch(BASE_URL + '/api/procurement/requisitions/?page_size=100', { headers }),
        fetch(BASE_URL + '/api/procurement/receipts/?page_size=100', { headers }),
        fetch(BASE_URL + '/api/inventory/dashboard/', { headers }),
        fetch(BASE_URL + '/api/inventory/warehouses/', { headers }),
        fetch(BASE_URL + '/api/inventory/balances/', { headers }),
        fetch(BASE_URL + '/api/inventory/movements/', { headers }),
        fetch(BASE_URL + '/api/inventory/reservations/', { headers }),
      ]);

      const [
        productsPayload,
        ordersPayload,
        requisitionsPayload,
        receiptsPayload,
        dashboardPayload,
        warehousesPayload,
        balancesPayload,
        movementsPayload,
        reservationsPayload,
      ] = await Promise.all([
        productsRes.ok ? productsRes.json() : [],
        ordersRes.ok ? ordersRes.json() : { results: [] },
        requisitionsRes.ok ? requisitionsRes.json() : { results: [] },
        receiptsRes.ok ? receiptsRes.json() : { results: [] },
        dashboardRes.ok ? dashboardRes.json() : { counts: {}, totals: {} },
        warehousesRes.ok ? warehousesRes.json() : [],
        balancesRes.ok ? balancesRes.json() : [],
        movementsRes.ok ? movementsRes.json() : [],
        reservationsRes.ok ? reservationsRes.json() : [],
      ]);

      return {
        products: extractResults<Product>(productsPayload),
        orders: extractResults<SalesOrder>(ordersPayload),
        requisitions: extractResults<Requisition>(requisitionsPayload),
        receipts: extractResults<Receipt>(receiptsPayload),
        inventoryDashboard: dashboardPayload as InventoryDashboard,
        warehouses: extractResults<Warehouse>(warehousesPayload),
        balances: extractResults<InventoryBalance>(balancesPayload),
        movements: extractResults<InventoryMovement>(movementsPayload),
        reservations: extractResults<InventoryReservation>(reservationsPayload),
      };
    },
  });
}
