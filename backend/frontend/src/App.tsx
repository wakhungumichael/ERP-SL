import { useEffect, useState } from "react";
import { fetchEnvelope, getSavedToken, postEnvelope, saveToken } from "./api/client";
import type { EndpointDescriptor, QueryScope, StatusBadge, SummaryCard } from "./api/types";
import { JsonViewer } from "./components/JsonViewer";
import { MetricCard } from "./components/MetricCard";

type EndpointState = {
  metrics: SummaryCard[];
  payload: unknown;
  loading: boolean;
  error?: string;
};

type SelectOption = {
  id: number;
  label: string;
};

type BranchOption = {
  id: number;
  name: string;
};

type CustomerOption = {
  id: number;
  name: string;
};

type VehicleOption = {
  id: number;
  number_plate: string;
  customer_id?: number;
  customer_name?: string;
  vehicle_type_id?: number;
  vehicle_type_name?: string;
};

type ItemOption = {
  id: number;
  name: string;
};

type TransactionRow = {
  id: number;
  vehicle_number_plate?: string;
  customer_name?: string;
  status?: string;
  weight_type?: string;
  payment_status?: string;
};

type InvoiceRow = {
  id: number;
  invoice_number?: string;
  customer_name?: string;
  status?: string;
  total_amount?: string | number;
};

type PaymentRow = {
  id: number;
  reference?: string;
  status?: string;
  amount?: string | number;
  invoice?: {
    invoice_number?: string;
  };
  method?: {
    name?: string;
  };
};

type AuthUser = {
  id?: number;
  username?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  is_superuser?: boolean;
  groups?: Array<{ id: number; name: string }>;
};

type AuthState = {
  username: string;
  password: string;
  token: string;
  user?: AuthUser | null;
  loading: boolean;
  error?: string;
};

type ActionState = {
  transactionId: string;
  invoiceId: string;
  paymentId: string;
  paymentMethodId: string;
  paymentReference: string;
  paymentAmount: string;
  gatewayProvider: string;
  callbackUrl: string;
  autoConfirmGateway: boolean;
  gatewayCallbackStatus: string;
  loading: boolean;
  result?: unknown;
  error?: string;
};

type BrowserState = {
  transactions: TransactionRow[];
  invoices: InvoiceRow[];
  payments: PaymentRow[];
  loading: boolean;
  error?: string;
};

type CreateTransactionState = {
  branchId: string;
  customerId: string;
  vehicleId: string;
  itemId: string;
  operator: string;
  destination: string;
  weightType: string;
  paymentMode: string;
  paymentStatus: string;
  manualWeightCapture: boolean;
  weightReason: string;
  loading: boolean;
  error?: string;
};

type DetailState = {
  transaction: unknown | null;
  invoice: unknown | null;
  payment: unknown | null;
  loading: boolean;
  error?: string;
};

type WorkflowContextState = {
  data: any | null;
  loading: boolean;
  error?: string;
};

type WorkspaceMenuItem = {
  id: number;
  key: string;
  title: string;
  icon?: string;
  description?: string;
  route_path?: string;
  api_path?: string;
  required_module?: string | null;
};

type WorkspaceMenuSection = {
  id: number;
  key: string;
  title: string;
  icon?: string;
  description?: string;
  items: WorkspaceMenuItem[];
};

type WorkspaceNavigationState = {
  sections: WorkspaceMenuSection[];
  loading: boolean;
  error?: string;
};

const endpoints: EndpointDescriptor[] = [
  {
    key: "checklist",
    title: "Implementation Checklist",
    description: "Delivery tracker for backend alignment, workspace maturity, and end-to-end validation.",
    path: "/api/system/checklist/",
    cards: (payload) => {
      const sections = payload?.sections || [];
      return [
        { label: "Phase", value: payload?.current_phase ?? "-" },
        { label: "Sections", value: sections.length ?? "-" },
        {
          label: "Completed",
          value: sections.filter((section: { status?: string }) => section.status === "completed").length,
        },
        {
          label: "Pending",
          value: sections.filter((section: { status?: string }) => section.status === "pending").length,
        },
      ];
    },
  },
  {
    key: "platform",
    title: "Platform Overview",
    description: "Tenants, plans, modules, subscriptions, and core platform discovery.",
    path: "/api/platform/",
    cards: (payload) => {
      const catalog = payload?.catalog || {};
      return [
        { label: "Tenants", value: catalog.tenants ?? "-" },
        { label: "Plans", value: catalog.plans ?? "-" },
        { label: "Modules", value: catalog.modules ?? "-" },
        { label: "Licenses", value: catalog.licenses ?? "-" },
      ];
    },
  },
  {
    key: "workspaceUsers",
    title: "Users",
    description: "Platform users available for role assignment and access review.",
    path: "/api/platform/users/",
    cards: (payload) => {
      const results = payload?.results || [];
      return [
        { label: "Users", value: payload?.count ?? results.length ?? "-" },
        { label: "Active", value: results.filter((item: { is_active?: boolean }) => item.is_active).length ?? "-" },
        { label: "Staff", value: results.filter((item: { is_staff?: boolean }) => item.is_staff).length ?? "-" },
        { label: "Superusers", value: results.filter((item: { is_superuser?: boolean }) => item.is_superuser).length ?? "-" },
      ];
    },
  },
  {
    key: "workspaceRoles",
    title: "Roles",
    description: "Role catalog and attached permissions for role-based menus.",
    path: "/api/platform/roles/",
    cards: (payload) => {
      const results = payload?.results || [];
      const permissionCount = results.reduce(
        (total: number, item: { permissions?: unknown[] }) => total + (item.permissions?.length || 0),
        0,
      );
      return [
        { label: "Roles", value: payload?.count ?? results.length ?? "-" },
        { label: "Permissions", value: permissionCount || "-" },
        { label: "Named Roles", value: results.filter((item: { name?: string }) => Boolean(item.name)).length ?? "-" },
        { label: "Scope", value: "global" },
      ];
    },
  },
  {
    key: "workspaceMenuSections",
    title: "Workspace Menu",
    description: "Menu sections and items used to drive role-based workspace navigation.",
    path: "/api/platform/workspace/menu-sections/",
    cards: (payload) => {
      const results = payload?.results || [];
      const itemCount = results.reduce(
        (total: number, item: { items?: unknown[] }) => total + (item.items?.length || 0),
        0,
      );
      return [
        { label: "Sections", value: payload?.count ?? results.length ?? "-" },
        { label: "Items", value: itemCount || "-" },
        { label: "Active", value: results.filter((item: { is_active?: boolean }) => item.is_active).length ?? "-" },
        { label: "System", value: results.filter((item: { is_system?: boolean }) => item.is_system).length ?? "-" },
      ];
    },
  },
  {
    key: "accountingDashboard",
    title: "Accounting Dashboard",
    description: "Linked accounting foundation for receivables, postings, ledgers, and journals.",
    path: "/api/accounting/dashboard/",
    cards: (payload) => {
      const summary = payload?.summary || {};
      return [
        { label: "Accounts", value: summary.accounts ?? "-" },
        { label: "Entries", value: summary.journal_entries ?? "-" },
        { label: "Debits", value: summary.total_debits ?? "-" },
        { label: "Credits", value: summary.total_credits ?? "-" },
      ];
    },
  },
  {
    key: "integrationHealth",
    title: "Integration Health",
    description: "Configured endpoints, primaries, actives, and runtime health summary.",
    path: "/api/platform/integrations/health/",
    params: () => ({ include_runtime: true }),
    cards: (payload) => {
      const summary = payload?.summary || {};
      return [
        { label: "Configured", value: summary.integrations ?? "-" },
        { label: "Active", value: summary.active_integrations ?? "-" },
        { label: "Primary", value: summary.primary_integrations ?? "-" },
        { label: "Healthy", value: summary.healthy_integrations ?? "-" },
      ];
    },
  },
  {
    key: "indicatorRegistry",
    title: "Indicator Registry",
    description: "Source registry for serial, network, and streamed indicator integrations.",
    path: "/api/platform/indicators/source-registry/",
    cards: (payload) => {
      const summary = payload?.summary || {};
      return [
        { label: "Sources", value: summary.sources ?? "-" },
        { label: "Active", value: summary.active_sources ?? "-" },
        { label: "Primary", value: summary.primary_sources ?? "-" },
        { label: "Transports", value: (summary.transports || []).length ?? "-" },
      ];
    },
  },
  {
    key: "providers",
    title: "Payment Providers",
    description: "Provider capabilities, settlement modes, and active payment integrations.",
    path: "/api/payments/provider-capabilities/",
    cards: (payload) => {
      const summary = payload?.summary || {};
      return [
        { label: "Providers", value: summary.providers ?? "-" },
        { label: "Active", value: summary.active_integrations ?? "-" },
        { label: "Primary", value: summary.primary_integrations ?? "-" },
        { label: "Results", value: payload?.results?.length ?? "-" },
      ];
    },
  },
  {
    key: "weighbridgeDashboard",
    title: "Operations Dashboard",
    description: "Weights, charges, approvals, and operational transaction totals.",
    path: "/api/commercial-weighbridge/dashboard/",
    cards: (payload) => {
      const summary = payload?.summary || {};
      return [
        { label: "Pending", value: summary.pending_transactions ?? "-" },
        { label: "Completed", value: summary.completed_transactions ?? "-" },
        { label: "Net Weight", value: summary.net_weight_total ?? "-" },
        { label: "Charges", value: summary.charge_total ?? "-" },
      ];
    },
  },
  {
    key: "weighbridge",
    title: "Commercial Weighbridge",
    description: "Operations overview for branches, vehicles, customers, and transaction flow.",
    path: "/api/commercial-weighbridge/",
    cards: (payload) => {
      const summary = payload?.summary || {};
      return [
        { label: "Branches", value: summary.branches ?? "-" },
        { label: "Customers", value: summary.customers ?? "-" },
        { label: "Vehicles", value: summary.vehicles ?? "-" },
        { label: "Transactions", value: summary.transactions ?? "-" },
      ];
    },
  },
  {
    key: "liveWeight",
    title: "Live Weight",
    description: "Current live reading resolved through the tenant and branch indicator integration.",
    path: "/api/commercial-weighbridge/live-weight/",
    cards: (payload) => {
      const reading = payload?.reading || {};
      return [
        { label: "Weight", value: reading.value ?? reading.weight ?? "-" },
        { label: "Unit", value: reading.unit ?? "kg" },
        { label: "Stable", value: String(reading.stable ?? reading.is_stable ?? "-") },
        { label: "Branch", value: payload?.branch_id ?? "default" },
      ];
    },
  },
  {
    key: "workflowContext",
    title: "Workflow Context",
    description: "Vehicle-level pairing context for first and second weight transaction flow.",
    path: "/api/commercial-weighbridge/transactions/workflow-context/",
    isEnabled: (scope) => Boolean(scope.vehicleId),
    disabledMessage: "Add a vehicle ID to inspect transaction workflow context.",
    params: (scope) => ({ vehicle_id: scope.vehicleId }),
    cards: (payload) => {
      const firstWeight = payload?.recent_first_weight || {};
      return [
        { label: "Vehicle", value: payload?.vehicle_number_plate ?? "-" },
        { label: "Pending", value: String(payload?.pending_transaction_exists ?? false) },
        { label: "First Weight ID", value: firstWeight.id ?? "-" },
        { label: "Gross Weight", value: firstWeight.gross_weight ?? "-" },
      ];
    },
  },
  {
    key: "reporting",
    title: "Reporting",
    description: "Commercial reporting surface for transactions, invoices, discrepancies, and generated reports.",
    path: "/api/commercial-weighbridge/reports/",
    cards: (payload) => {
      const summary = payload?.summary || {};
      return [
        { label: "Transactions", value: summary.transactions ?? "-" },
        { label: "Invoices", value: summary.invoices ?? "-" },
        { label: "Presence", value: summary.vehicle_presence_records ?? "-" },
        { label: "Discrepancies", value: summary.discrepancy_records ?? "-" },
      ];
    },
  },
  {
    key: "finance",
    title: "Finance",
    description: "Payment methods, gateways, confirmed collections, and pending invoices.",
    path: "/api/payments/",
    cards: (payload) => {
      const summary = payload?.summary || {};
      return [
        { label: "Methods", value: summary.payment_methods ?? "-" },
        { label: "Payments", value: summary.payments ?? "-" },
        { label: "Gateways", value: summary.active_gateway_integrations ?? "-" },
        { label: "Confirmed", value: summary.confirmed_payments_total ?? "-" },
      ];
    },
  },
];

export function App() {
  const [scope, setScope] = useState<QueryScope>({ tenantCode: "default", branchId: "", vehicleId: "" });
  const [selected, setSelected] = useState<string>("platform");
  const [state, setState] = useState<Record<string, EndpointState>>({});
  const [auth, setAuth] = useState<AuthState>({
    username: "",
    password: "",
    token: getSavedToken(),
    user: null,
    loading: false,
  });
  const [paymentMethods, setPaymentMethods] = useState<SelectOption[]>([]);
  const [invoices, setInvoices] = useState<SelectOption[]>([]);
  const [payments, setPayments] = useState<SelectOption[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [actions, setActions] = useState<ActionState>({
    transactionId: "",
    invoiceId: "",
    paymentId: "",
    paymentMethodId: "",
    paymentReference: "",
    paymentAmount: "",
    gatewayProvider: "",
    callbackUrl: "",
    autoConfirmGateway: false,
    gatewayCallbackStatus: "confirmed",
    loading: false,
  });
  const [browser, setBrowser] = useState<BrowserState>({
    transactions: [],
    invoices: [],
    payments: [],
    loading: false,
  });
  const [details, setDetails] = useState<DetailState>({
    transaction: null,
    invoice: null,
    payment: null,
    loading: false,
  });
  const [workflowContext, setWorkflowContext] = useState<WorkflowContextState>({
    data: null,
    loading: false,
  });
  const [workspaceNavigation, setWorkspaceNavigation] = useState<WorkspaceNavigationState>({
    sections: [],
    loading: false,
  });
  const [createTransaction, setCreateTransaction] = useState<CreateTransactionState>({
    branchId: "",
    customerId: "",
    vehicleId: "",
    itemId: "",
    operator: "",
    destination: "",
    weightType: "First Weight",
    paymentMode: "Cash",
    paymentStatus: "Pending",
    manualWeightCapture: false,
    weightReason: "",
    loading: false,
  });
  const tenantScope = { tenantCode: scope.tenantCode, branchId: scope.branchId, vehicleId: "" };

  async function loadBrowsers() {
    setBrowser((current) => ({ ...current, loading: true, error: undefined }));
    try {
      const [transactionsResponse, invoicesResponse, paymentsResponse] = await Promise.all([
        fetchEnvelope<any>("/api/commercial-weighbridge/transactions/", scope, { page_size: 8 }, auth.token),
        fetchEnvelope<any>("/api/payments/invoices/", scope, { page_size: 8 }, auth.token),
        fetchEnvelope<any>("/api/payments/entries/", scope, { page_size: 8 }, auth.token),
      ]);

      setBrowser({
        transactions: transactionsResponse.data?.results || [],
        invoices: invoicesResponse.data?.results || [],
        payments: paymentsResponse.data?.results || [],
        loading: false,
      });
    } catch (error) {
      setBrowser({
        transactions: [],
        invoices: [],
        payments: [],
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function loadEndpoint(descriptor: EndpointDescriptor) {
    if (descriptor.isEnabled && !descriptor.isEnabled(scope)) {
      setState((current) => ({
        ...current,
        [descriptor.key]: {
          metrics: [],
          payload: {
            message: descriptor.disabledMessage || "This panel needs more scope filters before it can load.",
          },
          loading: false,
          error: descriptor.disabledMessage,
        },
      }));
      return;
    }

    setState((current) => ({
      ...current,
      [descriptor.key]: {
        ...current[descriptor.key],
        loading: true,
        error: undefined,
      },
    }));

    try {
      const extras = descriptor.params?.(scope);
      const response = await fetchEnvelope<any>(descriptor.path, scope, extras, auth.token);
      const payload = response.data;
      setState((current) => ({
        ...current,
        [descriptor.key]: {
          metrics: descriptor.cards(payload),
          payload,
          loading: false,
        },
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        [descriptor.key]: {
          metrics: [],
          payload: null,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  }

  async function loadWorkspaceNavigation() {
    if (!auth.token) {
      setWorkspaceNavigation({
        sections: [],
        loading: false,
        error: "Sign in to load role-based workspace navigation.",
      });
      return;
    }

    setWorkspaceNavigation((current) => ({ ...current, loading: true, error: undefined }));
    try {
      const response = await fetchEnvelope<any>(
        "/api/platform/workspace/navigation/",
        tenantScope,
        undefined,
        auth.token,
      );
      setWorkspaceNavigation({
        sections: response.data?.workspace?.sections || [],
        loading: false,
      });
    } catch (error) {
      setWorkspaceNavigation({
        sections: [],
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  useEffect(() => {
    endpoints.forEach((descriptor) => {
      void loadEndpoint(descriptor);
    });
  }, [auth.token, scope.branchId, scope.tenantCode, scope.vehicleId]);

  useEffect(() => {
    void loadWorkspaceNavigation();
  }, [auth.token, scope.branchId, scope.tenantCode]);

  useEffect(() => {
    if (auth.token && !auth.user && !auth.loading) {
      void loadCurrentUser();
    }
  }, [auth.loading, auth.token, auth.user]);

  useEffect(() => {
    async function loadActionOptions() {
      try {
        const [methodsResponse, invoicesResponse, paymentsResponse, branchesResponse, customersResponse, vehiclesResponse, itemsResponse] = await Promise.all([
          fetchEnvelope<any>("/api/payments/methods/", scope, undefined, auth.token),
          fetchEnvelope<any>("/api/payments/invoices/", scope, undefined, auth.token),
          fetchEnvelope<any>("/api/payments/entries/", scope, undefined, auth.token),
          fetchEnvelope<any>("/api/commercial-weighbridge/branches/", scope, { page_size: 100 }, auth.token),
          fetchEnvelope<any>("/api/commercial-weighbridge/customers/", scope, { page_size: 100 }, auth.token),
          fetchEnvelope<any>("/api/commercial-weighbridge/vehicles/", scope, { page_size: 100 }, auth.token),
          fetchEnvelope<any>("/api/commercial-weighbridge/items/", scope, { page_size: 100 }, auth.token),
        ]);

        const methodResults = methodsResponse.data?.results || methodsResponse.data || [];
        const invoiceResults = invoicesResponse.data?.results || invoicesResponse.data || [];
        const paymentResults = paymentsResponse.data?.results || paymentsResponse.data || [];
        const branchResults = branchesResponse.data?.results || branchesResponse.data || [];
        const customerResults = customersResponse.data?.results || customersResponse.data || [];
        const vehicleResults = vehiclesResponse.data?.results || vehiclesResponse.data || [];
        const itemResults = itemsResponse.data?.results || itemsResponse.data || [];

        setPaymentMethods(
          methodResults.map((item: { id: number; name?: string; code?: string }) => ({
            id: item.id,
            label: item.name ? `${item.name}${item.code ? ` (${item.code})` : ""}` : `Method #${item.id}`,
          })),
        );
        setInvoices(
          invoiceResults.map((item: { id: number; invoice_number?: string; customer_name?: string }) => ({
            id: item.id,
            label: item.invoice_number
              ? `${item.invoice_number}${item.customer_name ? ` - ${item.customer_name}` : ""}`
              : `Invoice #${item.id}`,
          })),
        );
        setPayments(
          paymentResults.map((item: { id: number; reference?: string; invoice?: { invoice_number?: string } }) => ({
            id: item.id,
            label: item.reference || item.invoice?.invoice_number || `Payment #${item.id}`,
          })),
        );
        setBranches(branchResults);
        setCustomers(customerResults);
        setVehicles(vehicleResults);
        setItems(itemResults);
      } catch (_error) {
        setPaymentMethods([]);
        setInvoices([]);
        setPayments([]);
        setBranches([]);
        setCustomers([]);
        setVehicles([]);
        setItems([]);
      }
    }

    void loadActionOptions();
  }, [auth.token, scope.tenantCode]);

  useEffect(() => {
    void loadBrowsers();
  }, [auth.token, scope.branchId, scope.tenantCode]);

  useEffect(() => {
    async function loadCreateWorkflowContext() {
      if (!createTransaction.vehicleId) {
        setWorkflowContext({
          data: null,
          loading: false,
        });
        return;
      }

      setWorkflowContext((current) => ({ ...current, loading: true, error: undefined }));
      try {
        const response = await fetchEnvelope<any>(
          "/api/commercial-weighbridge/transactions/workflow-context/",
          scope,
          { vehicle_id: createTransaction.vehicleId },
          auth.token,
        );
        const payload = response.data;
        setWorkflowContext({
          data: payload,
          loading: false,
        });

        if (createTransaction.weightType === "Second Weight" && payload?.recent_first_weight) {
          setCreateTransaction((current) => ({
            ...current,
            branchId: current.branchId || String(payload.recent_first_weight.branch_id || ""),
            customerId: current.customerId || String(payload.recent_first_weight.customer_id || ""),
            itemId: current.itemId || String(payload.recent_first_weight.item_id || ""),
            destination: current.destination || payload.recent_first_weight.destination || "",
            paymentMode: current.paymentMode || payload.recent_first_weight.payment_mode || current.paymentMode,
            paymentStatus: current.paymentStatus || payload.recent_first_weight.payment_status || current.paymentStatus,
          }));
          setScope((current) => ({
            ...current,
            vehicleId: current.vehicleId || String(payload.vehicle_id || createTransaction.vehicleId),
          }));
        }
      } catch (error) {
        setWorkflowContext({
          data: null,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    void loadCreateWorkflowContext();
  }, [auth.token, createTransaction.vehicleId, createTransaction.weightType, scope.branchId, scope.tenantCode]);

  useEffect(() => {
    if (!createTransaction.vehicleId) {
      return;
    }

    const vehicle = vehicles.find((item) => String(item.id) === createTransaction.vehicleId);
    if (!vehicle) {
      return;
    }

    setCreateTransaction((current) => {
      const nextCustomerId = vehicle.customer_id ? String(vehicle.customer_id) : current.customerId;
      if (current.customerId === nextCustomerId) {
        return current;
      }
      return {
        ...current,
        customerId: nextCustomerId,
      };
    });
  }, [createTransaction.vehicleId, vehicles]);

  useEffect(() => {
    async function loadSelectedDetails() {
      const transactionId = actions.transactionId.trim();
      const invoiceId = actions.invoiceId.trim();
      const paymentId = actions.paymentId.trim();

      if (!transactionId && !invoiceId && !paymentId) {
        setDetails({
          transaction: null,
          invoice: null,
          payment: null,
          loading: false,
        });
        return;
      }

      setDetails((current) => ({ ...current, loading: true, error: undefined }));

      try {
        const [transactionResponse, invoiceResponse, paymentResponse] = await Promise.all([
          transactionId
            ? fetchEnvelope<any>(
                `/api/commercial-weighbridge/transactions/${transactionId}/`,
                tenantScope,
                undefined,
                auth.token,
              )
            : Promise.resolve(null),
          invoiceId
            ? fetchEnvelope<any>(`/api/payments/invoices/${invoiceId}/`, tenantScope, undefined, auth.token)
            : Promise.resolve(null),
          paymentId
            ? fetchEnvelope<any>(`/api/payments/entries/${paymentId}/`, tenantScope, undefined, auth.token)
            : Promise.resolve(null),
        ]);

        const transactionDetail = transactionResponse?.data ?? null;
        const invoiceDetail = invoiceResponse?.data ?? null;
        const paymentDetail = paymentResponse?.data ?? null;

        setDetails({
          transaction: transactionDetail,
          invoice: invoiceDetail,
          payment: paymentDetail,
          loading: false,
        });

        if (transactionDetail?.vehicle && !scope.vehicleId) {
          setScope((current) => ({
            ...current,
            vehicleId: String(transactionDetail.vehicle),
          }));
        }
      } catch (error) {
        setDetails({
          transaction: null,
          invoice: null,
          payment: null,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    void loadSelectedDetails();
  }, [actions.invoiceId, actions.paymentId, actions.transactionId, auth.token, scope.branchId, scope.tenantCode]);

  async function login() {
    setAuth((current) => ({ ...current, loading: true, error: undefined }));
    try {
      const response = await postEnvelope<{ token: string; user: AuthUser }>(
        "/api/platform/auth/token/",
        {
          username: auth.username,
          password: auth.password,
        },
      );
      saveToken(response.data.token);
      setAuth((current) => ({
        ...current,
        token: response.data.token,
        user: response.data.user,
        loading: false,
        password: "",
      }));
    } catch (error) {
      setAuth((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async function loadCurrentUser() {
    if (!auth.token) {
      setAuth((current) => ({
        ...current,
        error: "Load a token first to fetch the current user.",
      }));
      return;
    }
    setAuth((current) => ({ ...current, loading: true, error: undefined }));
    try {
      const response = await fetchEnvelope<AuthUser>("/api/platform/auth/me/", scope, undefined, auth.token);
      setAuth((current) => ({
        ...current,
        user: response.data,
        loading: false,
      }));
    } catch (error) {
      setAuth((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  function clearToken() {
    saveToken("");
    setAuth((current) => ({
      ...current,
      token: "",
      user: null,
      error: undefined,
    }));
  }

  async function runAction(
    path: string,
    body: Record<string, unknown>,
    successMessage: string,
    refreshKeys: string[] = [],
    onSuccess?: (responseData: any) => void,
  ) {
    setActions((current) => ({ ...current, loading: true, error: undefined }));
    try {
      const response = await postEnvelope<any>(path, body, auth.token);
      setActions((current) => ({
        ...current,
        loading: false,
        result: {
          message: successMessage,
          response: response.data,
        },
      }));
      onSuccess?.(response.data);
      endpoints
        .filter((endpoint) => refreshKeys.includes(endpoint.key))
        .forEach((endpoint) => void loadEndpoint(endpoint));
      void loadBrowsers();
    } catch (error) {
      setActions((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async function createTransactionRecord() {
    const selectedVehicle = vehicles.find((item) => String(item.id) === createTransaction.vehicleId);
    if (!selectedVehicle?.vehicle_type_id) {
      setCreateTransaction((current) => ({
        ...current,
        error: "Select a vehicle with a resolved vehicle type before creating a transaction.",
      }));
      return;
    }

    setCreateTransaction((current) => ({ ...current, loading: true, error: undefined }));
    try {
      const response = await postEnvelope<any>(
        "/api/commercial-weighbridge/transactions/",
        {
          branch: Number(createTransaction.branchId),
          customer: Number(createTransaction.customerId),
          vehicle: Number(createTransaction.vehicleId),
          operator: createTransaction.operator,
          item: Number(createTransaction.itemId),
          vehicle_type: selectedVehicle.vehicle_type_id,
          destination: createTransaction.destination,
          weight_type: createTransaction.weightType,
          payment_mode: createTransaction.paymentMode,
          payment_status: createTransaction.paymentStatus,
          manual_weight_capture: createTransaction.manualWeightCapture,
          weight_reason: createTransaction.weightReason || undefined,
        },
        auth.token,
      );

      setCreateTransaction((current) => ({
        ...current,
        loading: false,
        error: undefined,
        operator: "",
        destination: "",
        weightReason: "",
      }));
      setActions((current) => ({
        ...current,
        transactionId: String(response.data.id),
        result: {
          message: "Transaction created successfully.",
          response: response.data,
        },
      }));
      setScope((current) => ({
        ...current,
        vehicleId: String(response.data.vehicle || createTransaction.vehicleId),
      }));
      setSelected("weighbridge");
      void loadBrowsers();
      endpoints
        .filter((endpoint) => ["weighbridge", "weighbridgeDashboard", "workflowContext", "reporting"].includes(endpoint.key))
        .forEach((endpoint) => void loadEndpoint(endpoint));
    } catch (error) {
      setCreateTransaction((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  function prefillFromWorkflowContext() {
    if (!createTransaction.vehicleId || !workflowContext.data?.recent_first_weight) {
      return;
    }

    const firstWeight = workflowContext.data.recent_first_weight;
    setCreateTransaction((current) => ({
      ...current,
      branchId: String(firstWeight.branch_id || current.branchId || ""),
      customerId: String(firstWeight.customer_id || current.customerId || ""),
      itemId: String(firstWeight.item_id || current.itemId || ""),
      destination: current.destination || firstWeight.destination || "",
      paymentMode: firstWeight.payment_mode || current.paymentMode,
      paymentStatus: firstWeight.payment_status || current.paymentStatus,
      weightType: "Second Weight",
    }));
    setScope((current) => ({
      ...current,
      vehicleId: current.vehicleId || String(workflowContext.data.vehicle_id || createTransaction.vehicleId),
    }));
    setSelected("workflowContext");
  }

  function prefillFromSelectedTransaction() {
    const transaction = details.transaction as
      | {
          branch?: number;
          customer?: number;
          vehicle?: number;
          item?: number;
          destination?: string;
          payment_mode?: string;
          payment_status?: string;
        }
      | null;

    if (!transaction) {
      return;
    }

    setCreateTransaction((current) => ({
      ...current,
      branchId: transaction.branch ? String(transaction.branch) : current.branchId,
      customerId: transaction.customer ? String(transaction.customer) : current.customerId,
      vehicleId: transaction.vehicle ? String(transaction.vehicle) : current.vehicleId,
      itemId: transaction.item ? String(transaction.item) : current.itemId,
      destination: current.destination || transaction.destination || "",
      paymentMode: transaction.payment_mode || current.paymentMode,
      paymentStatus: transaction.payment_status || current.paymentStatus,
      weightType: "Second Weight",
    }));
    if (transaction.vehicle) {
      setScope((current) => ({
        ...current,
        vehicleId: String(transaction.vehicle),
      }));
    }
    setSelected("workflowContext");
  }

  async function prepareSecondWeightFromTransaction(transactionId: number) {
    setCreateTransaction((current) => ({
      ...current,
      loading: true,
      error: undefined,
    }));

    try {
      const response = await fetchEnvelope<any>(
        `/api/commercial-weighbridge/transactions/${transactionId}/`,
        tenantScope,
        undefined,
        auth.token,
      );
      const transaction = response.data;

      setActions((current) => ({
        ...current,
        transactionId: String(transactionId),
      }));
      setCreateTransaction((current) => ({
        ...current,
        branchId: transaction.branch ? String(transaction.branch) : current.branchId,
        customerId: transaction.customer ? String(transaction.customer) : current.customerId,
        vehicleId: transaction.vehicle ? String(transaction.vehicle) : current.vehicleId,
        itemId: transaction.item ? String(transaction.item) : current.itemId,
        destination: transaction.destination || current.destination,
        paymentMode: transaction.payment_mode || current.paymentMode,
        paymentStatus: transaction.payment_status || current.paymentStatus,
        weightType: "Second Weight",
        loading: false,
      }));

      if (transaction.vehicle) {
        setScope((current) => ({
          ...current,
          vehicleId: String(transaction.vehicle),
        }));
      }
      setSelected("workflowContext");
    } catch (error) {
      setCreateTransaction((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  const statusBadges: StatusBadge[] = [
    {
      label: "Auth",
      value: auth.token ? "Token loaded" : "Anonymous session",
      tone: auth.token ? "good" : "default",
    },
    {
      label: "Tenant",
      value: scope.tenantCode || "none",
      tone: scope.tenantCode ? "good" : "warn",
    },
    {
      label: "Branch",
      value: scope.branchId || "default",
      tone: scope.branchId ? "good" : "default",
    },
    {
      label: "Vehicle",
      value: scope.vehicleId || "not selected",
      tone: scope.vehicleId ? "good" : "default",
    },
  ];

  const selectedState = state[selected];
  const endpointKeyByPath = endpoints.reduce<Record<string, string>>((current, endpoint) => {
    current[endpoint.path] = endpoint.key;
    return current;
  }, {});
  const filteredVehicles = vehicles.filter((vehicle) => {
    if (!createTransaction.customerId) {
      return true;
    }
    return String(vehicle.customer_id) === createTransaction.customerId;
  });
  const selectedVehicle = vehicles.find((vehicle) => String(vehicle.id) === createTransaction.vehicleId);
  const recentFirstWeight = workflowContext.data?.recent_first_weight;
  const selectedTransaction = browser.transactions.find((item) => String(item.id) === actions.transactionId);
  const selectedInvoice = browser.invoices.find((item) => String(item.id) === actions.invoiceId);
  const selectedPayment = browser.payments.find((item) => String(item.id) === actions.paymentId);
  const selectedRecordSnapshot = {
    transaction: details.transaction || selectedTransaction || null,
    invoice: details.invoice || selectedInvoice || null,
    payment: details.payment || selectedPayment || null,
  };

  const workspaceEndpointKeys = workspaceNavigation.sections.flatMap((section) =>
    section.items
      .map((item) => {
        if (item.api_path && endpointKeyByPath[item.api_path]) {
          return endpointKeyByPath[item.api_path];
        }
        if (item.api_path?.includes("/api/platform/users/")) {
          return "workspaceUsers";
        }
        if (item.api_path?.includes("/api/platform/roles/")) {
          return "workspaceRoles";
        }
        if (item.api_path?.includes("/api/platform/workspace/menu-sections/")) {
          return "workspaceMenuSections";
        }
        return null;
      })
      .filter((key): key is string => Boolean(key)),
  );

  const selectedEndpoint = endpoints.find((item) => item.key === selected) || endpoints.find((item) => item.key === "weighbridge");
  const selectedWorkspaceSection = workspaceNavigation.sections.find((section) =>
    section.items.some((item) => {
      const mappedKey = item.api_path ? endpointKeyByPath[item.api_path] : undefined;
      return mappedKey === selected || (item.api_path?.includes("/api/platform/users/") && selected === "workspaceUsers") || (item.api_path?.includes("/api/platform/roles/") && selected === "workspaceRoles") || (item.api_path?.includes("/api/platform/workspace/menu-sections/") && selected === "workspaceMenuSections");
    }),
  );
  const fullName = [auth.user?.first_name, auth.user?.last_name].filter(Boolean).join(" ");

  useEffect(() => {
    if (!auth.token || workspaceNavigation.loading || !workspaceNavigation.sections.length) {
      return;
    }
    if (!workspaceEndpointKeys.length) {
      return;
    }
    if (!workspaceEndpointKeys.includes(selected)) {
      setSelected(workspaceEndpointKeys[0]);
    }
  }, [auth.token, selected, workspaceEndpointKeys, workspaceNavigation.loading, workspaceNavigation.sections]);

  function openWorkspaceItem(item: WorkspaceMenuItem) {
    if (item.api_path && endpointKeyByPath[item.api_path]) {
      setSelected(endpointKeyByPath[item.api_path]);
      return;
    }
    if (item.api_path && item.api_path.includes("/api/platform/users/")) {
      setSelected("workspaceUsers");
      return;
    }
    if (item.api_path && item.api_path.includes("/api/platform/roles/")) {
      setSelected("workspaceRoles");
      return;
    }
    setSelected("platform");
  }

  if (!auth.token) {
    return (
      <div className="login-shell">
        <section className="login-hero">
          <div className="login-copy">
            <p className="eyebrow">Commercial Weighbridge</p>
            <h1>Enterprise Workspace</h1>
            <p>
              Sign in to access your tenant workspace, role-based navigation, weighbridge operations, finance, and platform administration.
            </p>
            <div className="login-points">
              <div className="login-point">
                <strong>Role-Based Access</strong>
                <span>Menus and modules resolve from your user groups, permissions, and active tenant plan.</span>
              </div>
              <div className="login-point">
                <strong>Operations + Finance</strong>
                <span>Run first weight, second weight, invoicing, payment, and accounting workflows from one shell.</span>
              </div>
              <div className="login-point">
                <strong>Tenant Aware</strong>
                <span>Workspaces are scoped by tenant and ready for SaaS-style module activation.</span>
              </div>
            </div>
          </div>
          <article className="login-panel panel">
            <div className="login-panel-header">
              <h2>Sign In</h2>
              <p>Use your platform account to open the workspace.</p>
            </div>
            <div className="login-form">
              <label>
                Username
                <input
                  value={auth.username}
                  onChange={(event) => setAuth((current) => ({ ...current, username: event.target.value }))}
                  placeholder="username"
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={auth.password}
                  onChange={(event) => setAuth((current) => ({ ...current, password: event.target.value }))}
                  placeholder="password"
                />
              </label>
              <button type="button" onClick={() => void login()} disabled={auth.loading || !auth.username || !auth.password}>
                {auth.loading ? "Signing In..." : "Open Workspace"}
              </button>
            </div>
            <div className="auth-note">
              {auth.error || "Authentication uses the platform token API and then loads your role-aware workspace."}
            </div>
          </article>
        </section>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="workspace-header panel">
        <div className="workspace-brand">
          <p className="eyebrow">Commercial Weighbridge</p>
          <h1>Workspace</h1>
          <p className="hero-copy">
            {selectedWorkspaceSection?.description || "Role-based enterprise workspace for operations, finance, and platform administration."}
          </p>
          <div className="status-strip">
            {statusBadges.map((badge) => (
              <span key={badge.label} className={`status-badge ${badge.tone || "default"}`}>
                {badge.label}: {badge.value}
              </span>
            ))}
          </div>
        </div>
        <div className="workspace-user">
          <div className="workspace-user-card">
            <strong>{fullName || auth.user?.username || "Authenticated User"}</strong>
            <span>{auth.user?.email || "Platform account"}</span>
            <div className="workspace-role-list">
              {(auth.user?.groups || []).map((group) => (
                <span key={group.id} className="workspace-role-chip">
                  {group.name}
                </span>
              ))}
              {auth.user?.is_superuser ? <span className="workspace-role-chip admin">Superuser</span> : null}
            </div>
          </div>
          <div className="auth-actions">
            <button type="button" className="secondary-button" onClick={() => void loadCurrentUser()} disabled={auth.loading}>
              Refresh User
            </button>
            <button type="button" className="secondary-button" onClick={clearToken} disabled={auth.loading}>
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <section className="workspace-toolbar panel">
        <div className="workspace-toolbar-copy">
          <strong>{selectedEndpoint?.title || "Workspace Panel"}</strong>
          <span>{selectedEndpoint?.description || "Select a menu item from the sidebar."}</span>
        </div>
        <div className="workspace-toolbar-controls">
          <label>
            Tenant Code
            <input
              value={scope.tenantCode}
              onChange={(event) => setScope((current) => ({ ...current, tenantCode: event.target.value }))}
              placeholder="default"
            />
          </label>
          <label>
            Branch ID
            <input
              value={scope.branchId}
              onChange={(event) => setScope((current) => ({ ...current, branchId: event.target.value }))}
              placeholder="optional"
            />
          </label>
          <label>
            Vehicle ID
            <input
              value={scope.vehicleId}
              onChange={(event) => setScope((current) => ({ ...current, vehicleId: event.target.value }))}
              placeholder="for workflow context"
            />
          </label>
        </div>
      </section>

      <section className="workspace-frame">
        <aside className="workspace-sidebar panel">
          <div className="workspace-sidebar-header">
            <p className="eyebrow">Navigation</p>
            <h2>Role-Based Menu</h2>
            <p>
              Your sidebar is resolved from your platform roles, permissions, and active tenant modules.
            </p>
          </div>
          <div className="workspace-sidebar-meta">
            {workspaceNavigation.error
              ? workspaceNavigation.error
              : workspaceNavigation.loading
                ? "Loading workspace navigation..."
                : `${workspaceNavigation.sections.length} section(s) available for the current user.`}
          </div>
          <div className="workspace-menu">
            {workspaceNavigation.sections.map((section) => (
              <div key={section.key} className="workspace-menu-section">
                <div className="workspace-menu-title">{section.title}</div>
                <div className="workspace-menu-items">
                  {section.items.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={selected === endpointKeyByPath[item.api_path || ""] ? "workspace-menu-item active" : "workspace-menu-item"}
                      onClick={() => openWorkspaceItem(item)}
                    >
                      <strong>{item.title}</strong>
                      <span>{item.description || item.api_path || item.route_path || "Workspace item"}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div className="workspace-main">
          <main className="content-grid">
            <section className="card-grid">
              {selectedEndpoint ? (
                <MetricCard
                  title={selectedEndpoint.title}
                  description={selectedState?.error || selectedEndpoint.description}
                  metrics={selectedState?.metrics || []}
                  isLoading={Boolean(selectedState?.loading)}
                  onRefresh={() => void loadEndpoint(selectedEndpoint)}
                />
              ) : null}
              <article className="card workspace-summary-card">
                <div className="card-header">
                  <div>
                    <h3>Workspace Summary</h3>
                    <p>Current user, available sections, and active role-driven navigation scope.</p>
                  </div>
                </div>
                <div className="metric-grid">
                  <div className="metric">
                    <strong>{workspaceNavigation.sections.length}</strong>
                    <span>Menu Sections</span>
                  </div>
                  <div className="metric">
                    <strong>{workspaceEndpointKeys.length}</strong>
                    <span>Accessible Panels</span>
                  </div>
                  <div className="metric">
                    <strong>{(auth.user?.groups || []).length || (auth.user?.is_superuser ? 1 : 0)}</strong>
                    <span>Roles</span>
                  </div>
                  <div className="metric">
                    <strong>{scope.tenantCode || "default"}</strong>
                    <span>Tenant Scope</span>
                  </div>
                </div>
              </article>
            </section>

            <JsonViewer
              title={`${selectedEndpoint?.title || "Selected"} Payload`}
              value={selectedState?.payload || { message: "Select a panel to inspect the latest payload." }}
            />
          </main>
        </div>
      </section>

      <section className="create-section">
        <article className="panel create-panel">
          <div className="card-header">
            <div>
              <h3>Create Transaction</h3>
              <p>Start a first-weight or second-weight flow directly from the module API using current tenant-scoped lookup data.</p>
            </div>
          </div>
          <div className="action-grid two-up">
            <label>
              Branch
              <select
                value={createTransaction.branchId}
                onChange={(event) => setCreateTransaction((current) => ({ ...current, branchId: event.target.value }))}
              >
                <option value="">Select branch</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Customer
              <select
                value={createTransaction.customerId}
                onChange={(event) =>
                  setCreateTransaction((current) => ({
                    ...current,
                    customerId: event.target.value,
                    vehicleId: "",
                  }))
                }
              >
                <option value="">Select customer</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Vehicle
              <select
                value={createTransaction.vehicleId}
                onChange={(event) =>
                  setCreateTransaction((current) => ({
                    ...current,
                    vehicleId: event.target.value,
                    error: undefined,
                  }))
                }
              >
                <option value="">Select vehicle</option>
                {filteredVehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.number_plate} {vehicle.vehicle_type_name ? `- ${vehicle.vehicle_type_name}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Item
              <select
                value={createTransaction.itemId}
                onChange={(event) =>
                  setCreateTransaction((current) => ({
                    ...current,
                    itemId: event.target.value,
                    error: undefined,
                  }))
                }
              >
                <option value="">Select item</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Operator
              <input
                value={createTransaction.operator}
                onChange={(event) => setCreateTransaction((current) => ({ ...current, operator: event.target.value }))}
                placeholder="operator or driver"
              />
            </label>
            <label>
              Destination
              <input
                value={createTransaction.destination}
                onChange={(event) => setCreateTransaction((current) => ({ ...current, destination: event.target.value }))}
                placeholder="destination"
              />
            </label>
            <label>
              Weight Type
              <select
                value={createTransaction.weightType}
                onChange={(event) => setCreateTransaction((current) => ({ ...current, weightType: event.target.value }))}
                
              >
                <option value="First Weight">First Weight</option>
                <option value="Second Weight">Second Weight</option>
              </select>
            </label>
            <label>
              Payment Mode
              <select
                value={createTransaction.paymentMode}
                onChange={(event) => setCreateTransaction((current) => ({ ...current, paymentMode: event.target.value }))}
              >
                <option value="Cash">Cash</option>
                <option value="Mpesa">Mpesa</option>
                <option value="Bank Deposit">Bank Deposit</option>
                <option value="Debt">Debt</option>
              </select>
            </label>
            <label>
              Payment Status
              <select
                value={createTransaction.paymentStatus}
                onChange={(event) => setCreateTransaction((current) => ({ ...current, paymentStatus: event.target.value }))}
              >
                <option value="Pending">Pending</option>
                <option value="Paid">Paid</option>
              </select>
            </label>
            <label>
              Weight Reason
              <input
                value={createTransaction.weightReason}
                onChange={(event) => setCreateTransaction((current) => ({ ...current, weightReason: event.target.value }))}
                placeholder="optional for manual capture"
              />
            </label>
          </div>
          <div className="selection-card create-hint">
            <strong>Derived Vehicle Type</strong>
            <span>{selectedVehicle?.vehicle_type_name || "Select a vehicle"}</span>
            <p>
              The create form automatically posts the selected vehicle's resolved `vehicle_type` so the module API stays
              consistent with the current validation rules.
            </p>
          </div>
          <div className="selection-grid create-context-grid">
            <div className="selection-card">
              <strong>Workflow State</strong>
              <span>
                {workflowContext.loading
                  ? "Loading..."
                  : workflowContext.error
                    ? "Unavailable"
                    : workflowContext.data?.pending_transaction_exists
                      ? "Pending transaction exists"
                      : "No pending transaction"}
              </span>
              <p>
                {workflowContext.error
                  ? workflowContext.error
                  : "The console checks the selected vehicle before creating or pairing weight records."}
              </p>
              <div className="selection-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={prefillFromWorkflowContext}
                  disabled={!createTransaction.vehicleId || !workflowContext.data?.recent_first_weight}
                >
                  Prepare Second Weight
                </button>
              </div>
            </div>
            <div className="selection-card">
              <strong>Recent First Weight</strong>
              <span>{recentFirstWeight ? `#${recentFirstWeight.id}` : "None available"}</span>
              <p>
                {recentFirstWeight
                  ? `${recentFirstWeight.gross_weight || "-"} KG · ${recentFirstWeight.destination || "-"} · ${recentFirstWeight.payment_mode || "-"}`
                  : "Select a vehicle to inspect whether a valid first-weight record can support second-weight flow."}
              </p>
              <div className="selection-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setCreateTransaction((current) => ({
                      ...current,
                      vehicleId: current.vehicleId || String(workflowContext.data?.vehicle_id || ""),
                    }));
                    prefillFromWorkflowContext();
                  }}
                  disabled={!workflowContext.data?.recent_first_weight}
                >
                  Use First Weight Context
                </button>
              </div>
            </div>
          </div>
          <div className="toggle-row">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={createTransaction.manualWeightCapture}
                onChange={(event) =>
                  setCreateTransaction((current) => ({
                    ...current,
                    manualWeightCapture: event.target.checked,
                  }))
                }
              />
              <span>Manual weight capture</span>
            </label>
          </div>
          <div className="action-buttons">
            <button
              type="button"
              onClick={() => void createTransactionRecord()}
              disabled={
                createTransaction.loading ||
                !createTransaction.branchId ||
                !createTransaction.customerId ||
                !createTransaction.vehicleId ||
                !createTransaction.itemId ||
                !createTransaction.operator ||
                !createTransaction.destination ||
                (createTransaction.weightType === "Second Weight" && !recentFirstWeight) ||
                Boolean(workflowContext.data?.pending_transaction_exists)
              }
            >
              {createTransaction.loading ? "Creating..." : "Create Transaction"}
            </button>
          </div>
          <div className="auth-note">
            {createTransaction.error
              ? createTransaction.error
              : createTransaction.weightType === "Second Weight" && !recentFirstWeight
                ? "Second-weight creation requires a valid recent first-weight transaction for the selected vehicle."
                : workflowContext.data?.pending_transaction_exists
                  ? "A pending transaction already exists for this vehicle. Resolve it before creating another."
              : "Create a tenant-scoped transaction record directly through `/api/commercial-weighbridge/transactions/`."}
          </div>
        </article>
      </section>

      <section className="actions-section">
        <article className="panel action-panel">
          <div className="card-header">
            <div>
              <h3>Transaction Actions</h3>
              <p>Run capture, approval, and transaction-to-billing actions against a selected transaction ID.</p>
            </div>
          </div>
          <div className="action-grid">
            <label>
              Transaction ID
              <input
                value={actions.transactionId}
                onChange={(event) => setActions((current) => ({ ...current, transactionId: event.target.value }))}
                placeholder="transaction id"
              />
            </label>
            <div className="action-buttons">
              <button
                type="button"
                onClick={() =>
                  void runAction(
                    "/api/commercial-weighbridge/transactions/capture-weight/",
                    { transaction_id: Number(actions.transactionId) },
                    "Capture-weight action completed.",
                    ["weighbridge", "weighbridgeDashboard", "workflowContext"],
                  )
                }
                disabled={actions.loading || !actions.transactionId}
              >
                Capture Weight
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  void runAction(
                    "/api/commercial-weighbridge/transactions/approve/",
                    { transaction_ids: [Number(actions.transactionId)] },
                    "Approve action completed.",
                    ["weighbridge", "weighbridgeDashboard"],
                  )
                }
                disabled={actions.loading || !actions.transactionId}
              >
                Approve
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  void runAction(
                    "/api/commercial-weighbridge/transactions/recall/",
                    { transaction_ids: [Number(actions.transactionId)] },
                    "Recall action completed.",
                    ["weighbridge", "weighbridgeDashboard"],
                  )
                }
                disabled={actions.loading || !actions.transactionId}
              >
                Recall
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  void runAction(
                    "/api/payments/transactions/generate-invoices/",
                    { transaction_ids: [Number(actions.transactionId)] },
                    "Generate-invoices action completed.",
                    ["finance", "reporting", "accountingDashboard"],
                    (responseData) => {
                      const invoiceId = responseData?.invoice_ids?.[0];
                      if (invoiceId) {
                        setActions((current) => ({
                          ...current,
                          invoiceId: String(invoiceId),
                        }));
                      }
                    },
                  )
                }
                disabled={actions.loading || !actions.transactionId}
              >
                Generate Invoice
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  void runAction(
                    "/api/payments/transactions/mark-paid/",
                    {
                      transaction_ids: [Number(actions.transactionId)],
                      method_id: actions.paymentMethodId ? Number(actions.paymentMethodId) : undefined,
                    },
                    "Mark-transaction-paid action completed.",
                    ["finance", "weighbridge", "weighbridgeDashboard", "accountingDashboard"],
                  )
                }
                disabled={actions.loading || !actions.transactionId}
              >
                Mark Transaction Paid
              </button>
            </div>
          </div>
        </article>

        <article className="panel action-panel">
          <div className="card-header">
            <div>
              <h3>Invoice and Payment Actions</h3>
              <p>Issue invoices, receive payments, and confirm payment records using existing module endpoints.</p>
            </div>
          </div>
          <div className="action-grid two-up">
            <label>
              Invoice
              <select
                value={actions.invoiceId}
                onChange={(event) => setActions((current) => ({ ...current, invoiceId: event.target.value }))}
              >
                <option value="">Select invoice</option>
                {invoices.map((invoice) => (
                  <option key={invoice.id} value={invoice.id}>
                    {invoice.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Payment Method
              <select
                value={actions.paymentMethodId}
                onChange={(event) => setActions((current) => ({ ...current, paymentMethodId: event.target.value }))}
              >
                <option value="">Select method</option>
                {paymentMethods.map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Amount
              <input
                value={actions.paymentAmount}
                onChange={(event) => setActions((current) => ({ ...current, paymentAmount: event.target.value }))}
                placeholder="optional override"
              />
            </label>
            <label>
              Reference
              <input
                value={actions.paymentReference}
                onChange={(event) => setActions((current) => ({ ...current, paymentReference: event.target.value }))}
                placeholder="payment reference"
              />
            </label>
            <label>
              Gateway Provider
              <input
                value={actions.gatewayProvider}
                onChange={(event) => setActions((current) => ({ ...current, gatewayProvider: event.target.value }))}
                placeholder="optional provider override"
              />
            </label>
            <label>
              Callback URL
              <input
                value={actions.callbackUrl}
                onChange={(event) => setActions((current) => ({ ...current, callbackUrl: event.target.value }))}
                placeholder="https://example.com/callback"
              />
            </label>
            <label>
              Gateway Callback Status
              <select
                value={actions.gatewayCallbackStatus}
                onChange={(event) => setActions((current) => ({ ...current, gatewayCallbackStatus: event.target.value }))}
              >
                <option value="confirmed">confirmed</option>
                <option value="failed">failed</option>
              </select>
            </label>
          </div>
          <div className="toggle-row">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={actions.autoConfirmGateway}
                onChange={(event) =>
                  setActions((current) => ({
                    ...current,
                    autoConfirmGateway: event.target.checked,
                  }))
                }
              />
              <span>Auto-confirm gateway payment after initiation</span>
            </label>
          </div>
          <div className="action-buttons">
            <button
              type="button"
              onClick={() =>
                void runAction(
                  `/api/payments/invoices/${actions.invoiceId}/issue/`,
                  {},
                  "Invoice issue action completed.",
                  ["finance", "accountingDashboard"],
                )
              }
              disabled={actions.loading || !actions.invoiceId}
            >
              Issue Invoice
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                void runAction(
                  `/api/payments/invoices/${actions.invoiceId}/receive-payment/`,
                  {
                    method_id: Number(actions.paymentMethodId),
                    amount: actions.paymentAmount || undefined,
                    reference: actions.paymentReference || undefined,
                  },
                  "Receive-payment action completed.",
                  ["finance", "accountingDashboard"],
                )
              }
              disabled={actions.loading || !actions.invoiceId || !actions.paymentMethodId}
            >
              Receive Payment
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                void runAction(
                  `/api/payments/invoices/${actions.invoiceId}/initiate-gateway-payment/`,
                  {
                    method_id: Number(actions.paymentMethodId),
                    amount: actions.paymentAmount || undefined,
                    reference: actions.paymentReference || undefined,
                    provider: actions.gatewayProvider || undefined,
                    callback_url: actions.callbackUrl || undefined,
                    auto_confirm: actions.autoConfirmGateway,
                  },
                  "Initiate-gateway-payment action completed.",
                  ["finance", "accountingDashboard"],
                  (responseData) => {
                    if (responseData?.payment_id) {
                      setActions((current) => ({
                        ...current,
                        paymentId: String(responseData.payment_id),
                      }));
                    }
                  },
                )
              }
              disabled={actions.loading || !actions.invoiceId || !actions.paymentMethodId}
            >
              Initiate Gateway Payment
            </button>
          </div>
          <div className="action-grid">
            <label>
              Payment
              <select
                value={actions.paymentId}
                onChange={(event) => setActions((current) => ({ ...current, paymentId: event.target.value }))}
              >
                <option value="">Select payment</option>
                {payments.map((payment) => (
                  <option key={payment.id} value={payment.id}>
                    {payment.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="action-buttons">
              <button
                type="button"
                onClick={() =>
                  void runAction(
                    `/api/payments/entries/${actions.paymentId}/confirm/`,
                    {
                      reference: actions.paymentReference || undefined,
                    },
                    "Payment confirm action completed.",
                    ["finance", "accountingDashboard"],
                  )
                }
                disabled={actions.loading || !actions.paymentId}
              >
                Confirm Payment
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  void runAction(
                    "/api/payments/gateway-callback/",
                    {
                      payment_id: Number(actions.paymentId),
                      reference: actions.paymentReference || undefined,
                      status: actions.gatewayCallbackStatus,
                    },
                    "Gateway callback simulation completed.",
                    ["finance", "accountingDashboard"],
                  )
                }
                disabled={actions.loading || !actions.paymentId}
              >
                Simulate Gateway Callback
              </button>
            </div>
          </div>
        </article>

        <article className="panel action-panel">
          <div className="card-header">
            <div>
              <h3>Action Result</h3>
              <p>Latest response from an operational action executed through the API.</p>
            </div>
          </div>
          <pre className="action-result">
            {JSON.stringify(
              actions.error
                ? { error: actions.error }
                : actions.result || { message: "Run an action to inspect the response here." },
              null,
              2,
            )}
          </pre>
        </article>
      </section>

      <section className="selection-section">
        <article className="panel selection-panel">
          <div className="card-header">
            <div>
              <h3>Selected Record Context</h3>
              <p>Current transaction, invoice, and payment selections used by the action panels.</p>
            </div>
            <button onClick={() => void loadBrowsers()} disabled={browser.loading}>
              {browser.loading ? "Refreshing..." : "Refresh Lists"}
            </button>
          </div>
          <div className="selection-grid">
            <div className="selection-card">
              <strong>Transaction</strong>
              <span>{selectedTransaction ? `#${selectedTransaction.id}` : "None selected"}</span>
              <p>
                {details.transaction && typeof details.transaction === "object"
                  ? `${(details.transaction as { vehicle_number_plate?: string }).vehicle_number_plate || "-"} · ${(
                      details.transaction as { weight_type?: string }
                    ).weight_type || "-"} · ${(details.transaction as { status?: string }).status || "-"}`
                  : selectedTransaction
                    ? `${selectedTransaction.vehicle_number_plate || "-"} · ${selectedTransaction.weight_type || "-"} · ${selectedTransaction.status || "-"}`
                    : "Pick a recent transaction below or enter an ID manually."}
              </p>
              <div className="selection-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={prefillFromSelectedTransaction}
                  disabled={!details.transaction}
                >
                  Use In Create Form
                </button>
              </div>
            </div>
            <div className="selection-card">
              <strong>Invoice</strong>
              <span>
                {(details.invoice as { invoice_number?: string } | null)?.invoice_number || selectedInvoice?.invoice_number || "None selected"}
              </span>
              <p>
                {details.invoice && typeof details.invoice === "object"
                  ? `${(details.invoice as { customer_name?: string }).customer_name || "-"} · ${(
                      details.invoice as { status?: string }
                    ).status || "-"} · ${(details.invoice as { total_amount?: string | number }).total_amount ?? "-"}`
                  : selectedInvoice
                    ? `${selectedInvoice.customer_name || "-"} · ${selectedInvoice.status || "-"} · ${selectedInvoice.total_amount ?? "-"}`
                    : "Pick a recent invoice below or use the finance action form."}
              </p>
            </div>
            <div className="selection-card">
              <strong>Payment</strong>
              <span>
                {(details.payment as { reference?: string } | null)?.reference || selectedPayment?.reference || "None selected"}
              </span>
              <p>
                {details.payment && typeof details.payment === "object"
                  ? `${(details.payment as { method?: { name?: string } }).method?.name || "-"} · ${(
                      details.payment as { status?: string }
                    ).status || "-"} · ${(details.payment as { amount?: string | number }).amount ?? "-"}`
                  : selectedPayment
                    ? `${selectedPayment.method?.name || "-"} · ${selectedPayment.status || "-"} · ${selectedPayment.amount ?? "-"}`
                    : "Pick a recent payment below when testing confirmation flow."}
              </p>
            </div>
          </div>
          <div className="browser-meta">
            {details.error
              ? details.error
              : details.loading
                ? "Loading full detail payloads for the current selections..."
                : "Selected record details are hydrated from the module detail endpoints."}
          </div>
        </article>

        <JsonViewer title="Selected Record Snapshot" value={selectedRecordSnapshot} />
      </section>

      <section className="browser-section">
        <article className="panel browser-panel">
          <div className="card-header">
            <div>
              <h3>Recent Transactions</h3>
              <p>Quick-pick a transaction for capture, approve, or recall actions.</p>
            </div>
            <button onClick={() => setActions((current) => ({ ...current, transactionId: "" }))} disabled={browser.loading}>
              Clear
            </button>
          </div>
          <div className="browser-meta">
            {browser.error ? browser.error : browser.loading ? "Loading recent records..." : "Latest tenant-scoped transaction feed."}
          </div>
          <div className="record-list">
            {browser.transactions.map((transaction) => (
              <div
                key={transaction.id}
                className={actions.transactionId === String(transaction.id) ? "record-row active" : "record-row"}
              >
                <button
                  type="button"
                  className="record-row-main"
                  onClick={() => {
                    setActions((current) => ({ ...current, transactionId: String(transaction.id) }));
                    setSelected("workflowContext");
                  }}
                >
                  <strong>#{transaction.id}</strong>
                  <span>{transaction.vehicle_number_plate || "-"}</span>
                  <span>{transaction.customer_name || "-"}</span>
                  <span>{transaction.weight_type || "-"}</span>
                  <span>{transaction.status || "-"}</span>
                </button>
                <div className="record-row-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setActions((current) => ({ ...current, transactionId: String(transaction.id) }));
                      setSelected("workflowContext");
                    }}
                  >
                    Inspect
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void prepareSecondWeightFromTransaction(transaction.id)}
                    disabled={createTransaction.loading}
                  >
                    Second Weight
                  </button>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel browser-panel">
          <div className="card-header">
            <div>
              <h3>Recent Invoices</h3>
              <p>Select an invoice and payment method for finance actions.</p>
            </div>
            <button onClick={() => setActions((current) => ({ ...current, invoiceId: "" }))} disabled={browser.loading}>
              Clear
            </button>
          </div>
          <div className="browser-meta">Latest tenant-scoped invoices for issue and receive-payment actions.</div>
          <div className="record-list">
            {browser.invoices.map((invoice) => (
              <button
                key={invoice.id}
                type="button"
                className={actions.invoiceId === String(invoice.id) ? "record-row active" : "record-row"}
                onClick={() => setActions((current) => ({ ...current, invoiceId: String(invoice.id) }))}
              >
                <strong>{invoice.invoice_number || `#${invoice.id}`}</strong>
                <span>{invoice.customer_name || "-"}</span>
                <span>{invoice.status || "-"}</span>
                <span>{invoice.total_amount ?? "-"}</span>
              </button>
            ))}
          </div>
        </article>

        <article className="panel browser-panel">
          <div className="card-header">
            <div>
              <h3>Recent Payments</h3>
              <p>Select a payment record for confirm-payment testing and follow-up verification.</p>
            </div>
            <button onClick={() => setActions((current) => ({ ...current, paymentId: "" }))} disabled={browser.loading}>
              Clear
            </button>
          </div>
          <div className="browser-meta">Recent payment entries returned by the finance module.</div>
          <div className="record-list">
            {browser.payments.map((payment) => (
              <button
                key={payment.id}
                type="button"
                className={actions.paymentId === String(payment.id) ? "record-row active" : "record-row"}
                onClick={() =>
                  setActions((current) => ({
                    ...current,
                    paymentId: String(payment.id),
                    paymentReference: payment.reference || current.paymentReference,
                  }))
                }
              >
                <strong>{payment.reference || `Payment #${payment.id}`}</strong>
                <span>{payment.invoice?.invoice_number || "-"}</span>
                <span>{payment.method?.name || "-"}</span>
                <span>{payment.status || "-"}</span>
                <span>{payment.amount ?? "-"}</span>
              </button>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
