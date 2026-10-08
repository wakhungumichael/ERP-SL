import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { useCreateTransaction, getListTransactionsQueryKey } from '@workspace/api-client-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/use-auth';
import { ERP_BRANCHES_QUERY_KEY, fetchErpBranches } from '@/lib/branches';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import LiveIndicator from '@/components/weighbridge/live-indicator';
import { Camera, Check, ChevronsUpDown, LockKeyhole, Package, Plus, RefreshCw, Scale, Search, Truck, UserRound, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ERPPageHeader } from '@/components/erp/workspace/workspace-ui';
import { hasPermission } from '@/lib/permissions';

type RouteFlow = 'first' | 'second';

type OperationType = {
  id: number;
  name: string;
  flow_kind: string;
  legacy_weight_type: string;
  is_active: boolean;
};

type CameraPreview = {
  id: number;
  name: string;
  camera_type: string;
  available: boolean;
  image_data_url: string | null;
};

type WorkflowContextDefaults = {
  item_id: number | null;
  vehicle_type_id: number | null;
  destination: string;
  driver_name: string;
  driver_phone: string;
};

type WorkflowContextOpenTransaction = {
  id: number;
  status: string;
  flow_kind: string;
  weight_type: string;
  operation_type_name: string;
};

type WorkflowContextPayload = {
  has_pending_first_weight?: boolean;
  first_weight_transaction?: any;
  customer_name?: string;
  message?: string;
  latest_transaction_defaults?: WorkflowContextDefaults | null;
  open_transactions?: WorkflowContextOpenTransaction[];
};

function authHeaders() {
  const token = localStorage.getItem('sl-erp-token');
  return { Authorization: `Token ${token}` };
}

function extractApiErrorMessage(error: any, fallback: string) {
  const candidates = [
    error?.response?.data,
    error?.data,
    error?.body,
    error?.cause,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate === 'string') return candidate;
    if (typeof candidate?.detail === 'string') return candidate.detail;
    if (typeof candidate?.error === 'string') return candidate.error;
    if (Array.isArray(candidate?.non_field_errors) && candidate.non_field_errors.length > 0) {
      return String(candidate.non_field_errors[0]);
    }
    for (const value of Object.values(candidate)) {
      if (typeof value === 'string' && value.trim()) return value;
      if (Array.isArray(value) && value.length > 0) return String(value[0]);
    }
  }

  const message = typeof error?.message === 'string' ? error.message : '';
  if (message && !message.includes('<!DOCTYPE html>')) return message;
  return fallback;
}

function SearchSelect({
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  disabled,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  disabled?: boolean;
  options: Array<{ value: string; label: string; meta?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} disabled={disabled} className="w-full justify-between font-normal">
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.meta ?? ''}`}
                  onSelect={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className="flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="truncate">{option.label}</div>
                    {option.meta ? <div className="truncate text-xs text-muted-foreground">{option.meta}</div> : null}
                  </div>
                  <Check className={cn('h-4 w-4 shrink-0', value === option.value ? 'opacity-100' : 'opacity-0')} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function CameraPanel({ branchId, snapshotVersion, onRefresh }: { branchId: string; snapshotVersion: number; onRefresh: () => void }) {
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['wb-camera-preview', branchId, snapshotVersion],
    enabled: !!branchId,
    queryFn: async () => {
      const res = await fetch(`/api/commercial-weighbridge/camera-configs/preview/?branch_id=${branchId}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('Failed to load camera previews');
      return res.json() as Promise<{ results: CameraPreview[] }>;
    },
  });

  const previews = data?.results ?? [];
  const selectedCamera = previews.find((camera) => String(camera.id) === selectedCameraId) ?? previews[0];

  return (
    <Card className="overflow-hidden border-primary/20 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between border-b border-primary/15 bg-primary/5 px-4 py-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Camera className="h-4 w-4" />
          Camera View
        </CardTitle>
        {previews.length > 1 ? (
          <Select value={selectedCameraId || String(selectedCamera?.id ?? '')} onValueChange={setSelectedCameraId}>
            <SelectTrigger className="h-7 w-28 text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>{previews.map((camera) => <SelectItem key={camera.id} value={String(camera.id)}>{camera.name}</SelectItem>)}</SelectContent>
          </Select>
        ) : null}
      </CardHeader>
      <CardContent className="p-3">
        {!branchId ? (
          <div className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
            Select a branch to load camera previews.
          </div>
        ) : isLoading ? (
          <div className="rounded-lg border px-4 py-10 text-center text-sm text-muted-foreground">Loading camera previews…</div>
        ) : previews.length === 0 ? (
          <div className="rounded-lg border px-4 py-10 text-center text-sm text-muted-foreground">No active cameras configured for this branch.</div>
        ) : (
          <div className="overflow-hidden rounded-md border bg-black">
            {selectedCamera?.image_data_url ? (
              <img src={selectedCamera.image_data_url} alt={selectedCamera.name} className="aspect-[16/8] w-full object-cover" />
            ) : (
              <div className="flex aspect-[16/8] items-center justify-center text-xs text-muted-foreground">Preview unavailable</div>
            )}
          </div>
        )}
        <div className="mt-2 flex justify-end">
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onRefresh} disabled={!branchId || isFetching}>
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', isFetching && 'animate-spin')} />Refresh
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function normalizeBranchId(value: unknown): string | null {
  if (value == null || value === '') return null;
  return String(value);
}

function extractAssignedBranchIds(user: Record<string, unknown> | null): string[] {
  if (!user) return [];

  const candidates = [
    user.branch_ids,
    user.assigned_branch_ids,
    user.branch_assignments,
    user.assigned_branches,
    user.branches,
  ];

  const values = candidates.flatMap((candidate) => {
    if (!Array.isArray(candidate)) return [];
    return candidate.map((entry: any) => normalizeBranchId(entry?.id ?? entry?.branch_id ?? entry)).filter(Boolean);
  });

  return Array.from(new Set(values)) as string[];
}

export default function WeighmentEntryPage({ preferredFlow = 'first' }: { preferredFlow?: RouteFlow }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const create = useCreateTransaction();
  const canAddCustomer = hasPermission(user as any, 'SL_Weighbridge.add_customer');
  const canAddVehicle = hasPermission(user as any, 'SL_Weighbridge.add_vehicle');
  const canAddItem = hasPermission(user as any, 'SL_Weighbridge.add_item');

  const [operationTypeId, setOperationTypeId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [vehicleTypeId, setVehicleTypeId] = useState('');
  const [itemId, setItemId] = useState('');
  const [destination, setDestination] = useState('');
  const [manualMode, setManualMode] = useState(false);
  const [capturedWeight, setCapturedWeight] = useState<number | null>(null);
  const [manualWeight, setManualWeight] = useState('');
  const [weightReason, setWeightReason] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [prefillVehicleKey, setPrefillVehicleKey] = useState('');
  const [plateInput, setPlateInput] = useState('');
  const [selectedVehicle, setSelectedVehicle] = useState<any>(null);
  const [showVehicleResults, setShowVehicleResults] = useState(false);
  const [snapshotVersion, setSnapshotVersion] = useState(0);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [itemOpen, setItemOpen] = useState(false);
  const [customerForm, setCustomerForm] = useState({ name: '', phone_number: '', email: '', address: '' });
  const [vehicleForm, setVehicleForm] = useState({ number_plate: '', vehicle_type: '' });
  const [itemForm, setItemForm] = useState({ name: '', description: '' });

  const fetchToken = () => localStorage.getItem('sl-erp-token') || '';
  const userBranchId = String((user as any)?.branch_id ?? '');
  const assignedBranchIds = useMemo(() => extractAssignedBranchIds(user), [user]);
  const operatorName = (user as any)?.full_name || (user as any)?.name || (user as any)?.username || '';

  const { data: branches } = useQuery({
    queryKey: ERP_BRANCHES_QUERY_KEY,
    queryFn: async () => fetchErpBranches(fetchToken()),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const { data: customers } = useQuery({
    queryKey: ['wb-customers-entry'],
    queryFn: async () => fetch('/api/commercial-weighbridge/customers/?search=', { headers: authHeaders() }).then((res) => res.json()),
  });
  const { data: vehicles } = useQuery({
    queryKey: ['wb-vehicles-entry', customerId],
    queryFn: async () => fetch(`/api/commercial-weighbridge/vehicles/?customer_id=${customerId}`, { headers: authHeaders() }).then((res) => res.json()),
    enabled: !!customerId,
  });
  const { data: vehicleSearchResults, isFetching: searchingVehicles } = useQuery({
    queryKey: ['wb-vehicle-search-entry', plateInput],
    queryFn: async () => fetch(`/api/commercial-weighbridge/vehicles/?search=${encodeURIComponent(plateInput)}`, { headers: authHeaders() }).then((res) => res.json()),
    enabled: plateInput.trim().length >= 2,
    staleTime: 30_000,
  });
  const { data: items } = useQuery({
    queryKey: ['wb-items-entry'],
    queryFn: async () => fetch('/api/commercial-weighbridge/items/', { headers: authHeaders() }).then((res) => res.json()),
  });
  const { data: vehicleTypesRaw } = useQuery({
    queryKey: ['wb-vehicle-types-entry'],
    queryFn: async () => fetch('/api/commercial-weighbridge/vehicle-types/', { headers: authHeaders() }).then((res) => res.json()),
  });
  const { data: operationTypesRaw } = useQuery({
    queryKey: ['wb-operation-types-entry'],
    queryFn: async () => fetch('/api/commercial-weighbridge/weighing-operation-types/', { headers: authHeaders() }).then((res) => res.json()),
  });

  const branchList = Array.isArray(branches) ? branches : [];
  const selectableBranchList = useMemo(() => {
    if (assignedBranchIds.length > 0) {
      return branchList.filter((branch: any) => assignedBranchIds.includes(String(branch.id)));
    }
    if (userBranchId) {
      const primaryBranch = branchList.find((branch: any) => String(branch.id) === userBranchId);
      if (primaryBranch) return [primaryBranch];
    }
    return branchList;
  }, [assignedBranchIds, branchList, userBranchId]);
  const customerList = Array.isArray(customers) ? customers : (customers as any)?.results ?? [];
  const vehicleList = Array.isArray(vehicles) ? vehicles : (vehicles as any)?.results ?? [];
  const searchedVehicles = Array.isArray(vehicleSearchResults) ? vehicleSearchResults : (vehicleSearchResults as any)?.results ?? [];
  const itemList = Array.isArray(items) ? items : (items as any)?.results ?? [];
  const vehicleTypeList = Array.isArray(vehicleTypesRaw) ? vehicleTypesRaw : (vehicleTypesRaw as any)?.results ?? [];
  const operationTypeList: OperationType[] = (Array.isArray(operationTypesRaw) ? operationTypesRaw : (operationTypesRaw as any)?.results ?? []).filter((row: any) => row.is_active);
  const selectedVehicleRecord = vehicleList.find((vehicle: any) => String(vehicle.id) === vehicleId) ?? null;
  const lockedVehicleTypeName = selectedVehicleRecord?.vehicle_type_name
    || vehicleTypeList.find((row: any) => String(row.id) === vehicleTypeId)?.name
    || '';
  const selectedOperation = operationTypeList.find((row) => String(row.id) === operationTypeId) ?? null;
  const isSecondFlow = selectedOperation?.flow_kind === 'second';
  const activeVehicleId = isSecondFlow ? selectedVehicle?.id ?? null : (vehicleId ? parseInt(vehicleId, 10) : null);
  const { data: workflowContext, isLoading: loadingWorkflow } = useQuery<WorkflowContextPayload>({
    queryKey: ['wb-workflow-context-entry', activeVehicleId],
    queryFn: async () => {
      const res = await fetch(`/api/commercial-weighbridge/transactions/workflow-context/?vehicle_id=${activeVehicleId}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('Failed to load workflow context');
      return res.json() as Promise<WorkflowContextPayload>;
    },
    enabled: !!activeVehicleId,
  });
  const firstTransaction = workflowContext?.first_weight_transaction;
  const selectedFlowKind = selectedOperation?.flow_kind ?? preferredFlow;
  const openTransactions = workflowContext?.open_transactions ?? [];
  const currentFlowOpenTransaction = openTransactions.find((row) => row.flow_kind === selectedFlowKind) ?? null;
  const duplicateOpenFirstWeight = !isSecondFlow && selectedFlowKind === 'first' ? currentFlowOpenTransaction : null;
  const duplicateOpenSecondWeight = isSecondFlow && currentFlowOpenTransaction && currentFlowOpenTransaction.id !== firstTransaction?.id
    ? currentFlowOpenTransaction
    : null;
  const hasDuplicateOpenTransaction = Boolean(duplicateOpenFirstWeight || duplicateOpenSecondWeight);
  const effectiveBranchId = isSecondFlow ? String(firstTransaction?.branch ?? '') : branchId;
  const effectiveWeight = manualMode ? (parseInt(manualWeight, 10) || null) : capturedWeight;
  const shouldShowBranchSelector = !isSecondFlow && selectableBranchList.length > 1;
  const netWeight = isSecondFlow && firstTransaction && effectiveWeight
    ? Math.abs(Number(firstTransaction.gross_weight || 0) - Number(effectiveWeight))
    : null;

  useEffect(() => {
    if (branchId || selectableBranchList.length === 0) return;
    if (userBranchId && selectableBranchList.some((branch: any) => String(branch.id) === userBranchId)) {
      setBranchId(userBranchId);
      return;
    }
    if (selectableBranchList.length >= 1) {
      setBranchId(String(selectableBranchList[0].id));
    }
  }, [branchId, selectableBranchList, userBranchId]);

  useEffect(() => {
    if (!branchId) return;
    if (isSecondFlow) return;
    if (selectableBranchList.length === 0) return;
    if (!selectableBranchList.some((branch: any) => String(branch.id) === branchId)) {
      setBranchId(String(selectableBranchList[0].id));
    }
  }, [branchId, isSecondFlow, selectableBranchList]);

  useEffect(() => {
    if (operationTypeId || operationTypeList.length === 0) return;
    const preferred = operationTypeList.find((row) => row.flow_kind === preferredFlow)
      ?? operationTypeList.find((row) => row.flow_kind === 'first')
      ?? operationTypeList[0];
    if (preferred) setOperationTypeId(String(preferred.id));
  }, [operationTypeId, operationTypeList, preferredFlow]);

  useEffect(() => {
    setCapturedWeight(null);
    setManualWeight('');
    setWeightReason('');
  }, [operationTypeId]);

  useEffect(() => {
    if (isSecondFlow) return;
    if (!vehicleId || prefillVehicleKey === vehicleId) return;

    const defaults = workflowContext?.latest_transaction_defaults;
    if (!defaults) return;

    setItemId(defaults.item_id ? String(defaults.item_id) : '');
    setDestination(defaults.destination ?? '');
    setDriverName(defaults.driver_name ?? '');
    setDriverPhone(defaults.driver_phone ?? '');
    setPrefillVehicleKey(vehicleId);
  }, [isSecondFlow, vehicleId, prefillVehicleKey, workflowContext]);

  const customerOptions = useMemo(
    () => customerList.map((customer: any) => ({
      value: String(customer.id),
      label: customer.name,
      meta: [customer.phone_number, customer.email].filter(Boolean).join(' · '),
    })),
    [customerList],
  );

  const vehicleOptions = useMemo(
    () => vehicleList.map((vehicle: any) => ({
      value: String(vehicle.id),
      label: vehicle.number_plate,
      meta: vehicle.vehicle_type_name || '',
    })),
    [vehicleList],
  );

  const createCustomer = async () => {
    const res = await fetch('/api/commercial-weighbridge/customers/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(customerForm),
    });
    if (!res.ok) throw new Error(await res.text());
    const json = await res.json();
    setCustomerId(String(json.id));
    setCustomerOpen(false);
    setCustomerForm({ name: '', phone_number: '', email: '', address: '' });
    queryClient.invalidateQueries();
  };

  const createVehicle = async () => {
    const res = await fetch('/api/commercial-weighbridge/vehicles/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        customer: Number(customerId),
        vehicle_type: Number(vehicleForm.vehicle_type || vehicleTypeId),
        number_plate: vehicleForm.number_plate.toUpperCase(),
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    const json = await res.json();
    setVehicleId(String(json.id));
    if (json.vehicle_type) setVehicleTypeId(String(json.vehicle_type));
    setVehicleOpen(false);
    setVehicleForm({ number_plate: '', vehicle_type: '' });
    queryClient.invalidateQueries();
  };

  const createItem = async () => {
    const res = await fetch('/api/commercial-weighbridge/items/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(itemForm),
    });
    if (!res.ok) throw new Error(await res.text());
    const json = await res.json();
    setItemId(String(json.id));
    setItemOpen(false);
    setItemForm({ name: '', description: '' });
    queryClient.invalidateQueries();
  };

  function refreshCameraPreviews() {
    setSnapshotVersion((current) => current + 1);
  }

  function handleCapture(weight: number) {
    setCapturedWeight(weight);
    refreshCameraPreviews();
  }

  function resetSecondFlowState() {
    setPlateInput('');
    setSelectedVehicle(null);
    setShowVehicleResults(false);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedOperation) {
      toast({ title: 'Choose operation type', variant: 'destructive' });
      return;
    }
    if (!effectiveWeight || effectiveWeight <= 0) {
      toast({
        title: 'No weight captured',
        description: manualMode ? 'Enter the weight manually.' : 'Capture the live weight first.',
        variant: 'destructive',
      });
      return;
    }
    if (manualMode && !weightReason.trim()) {
      toast({ title: 'Reason required', description: 'Enter a reason for manual weight entry.', variant: 'destructive' });
      return;
    }

    if (isSecondFlow) {
      if (!selectedVehicle || !workflowContext?.has_pending_first_weight || !firstTransaction) {
        toast({ title: 'Pending first weight required', description: 'Search and select a vehicle with a pending first weight.', variant: 'destructive' });
        return;
      }

      const payload: Record<string, unknown> = {
        branch: firstTransaction.branch,
        customer: firstTransaction.customer,
        vehicle: selectedVehicle.id,
        vehicle_type: firstTransaction.vehicle_type,
        item: firstTransaction.item,
        operation_type: selectedOperation.id,
        weight_type: selectedOperation.legacy_weight_type ?? 'Second Weight',
        tare_weight: effectiveWeight,
        net_weight: netWeight ?? 0,
        destination: firstTransaction.destination ?? '',
        operator: operatorName.trim() || (user as any)?.username || '',
        driver_name: driverName.trim(),
        driver_phone: driverPhone.trim(),
        payment_mode: firstTransaction.payment_mode,
        payment_status: firstTransaction.payment_status,
        paired_first_transaction: firstTransaction.id,
        manual_weight_capture: manualMode,
      };
      if (manualMode && weightReason.trim()) payload.weight_reason = weightReason.trim();

      create.mutate({ data: payload as any }, {
        onSuccess: (tx: any) => {
          refreshCameraPreviews();
          toast({ title: `Second weight completed - TX-${String(tx?.id ?? '').padStart(5, '0')}` });
          queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
          setCapturedWeight(null);
          setManualWeight('');
          setWeightReason('');
          resetSecondFlowState();
          setLocation('/weighbridge/transactions');
        },
        onError: (err: any) => toast({
          title: 'Could not complete second weight',
          description: extractApiErrorMessage(err, 'The server rejected this second-weight entry. Check the vehicle workflow and required fields.'),
          variant: 'destructive',
        }),
      });
      return;
    }

    if (!branchId || !customerId || !vehicleId) {
      toast({ title: 'Missing fields', description: 'Branch, customer, and vehicle are required.', variant: 'destructive' });
      return;
    }

    const payload: Record<string, unknown> = {
      branch: parseInt(branchId, 10),
      customer: parseInt(customerId, 10),
      vehicle: parseInt(vehicleId, 10),
      operation_type: selectedOperation.id,
      weight_type: selectedOperation.legacy_weight_type ?? 'First Weight',
      gross_weight: effectiveWeight,
      destination,
      operator: operatorName.trim() || (user as any)?.username || '',
      driver_name: driverName.trim(),
      driver_phone: driverPhone.trim(),
      payment_mode: 'Cash',
      payment_status: 'Pending',
      manual_weight_capture: manualMode,
    };
    if (itemId) payload.item = parseInt(itemId, 10);
    if (vehicleTypeId) payload.vehicle_type = parseInt(vehicleTypeId, 10);
    if (manualMode && weightReason.trim()) payload.weight_reason = weightReason.trim();

    create.mutate({ data: payload as any }, {
      onSuccess: (tx: any) => {
        refreshCameraPreviews();
        toast({ title: `First weight logged - TX-${String(tx?.id ?? '').padStart(5, '0')}` });
        queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
        setCapturedWeight(null);
        setManualWeight('');
        setWeightReason('');
        setLocation('/weighbridge/transactions');
      },
      onError: (err: any) => toast({
        title: 'Could not log first weight',
        description: extractApiErrorMessage(err, 'The server rejected this first-weight entry. Check the weight, vehicle setup, and required fields.'),
        variant: 'destructive',
      }),
    });
  }

  return (
    <div className="space-y-3">
      <ERPPageHeader
        title={<span className="flex items-center gap-2"><Scale className="h-5 w-5 text-primary" />Weighment Entry</span>}
      />

      <form onSubmit={handleSubmit} className="grid items-start gap-4 xl:grid-cols-[minmax(300px,0.72fr)_minmax(0,1.65fr)]">
        <aside className="space-y-4 xl:sticky xl:top-4">
          <Card className="overflow-hidden border-primary/20 shadow-sm">
            <CardHeader className="flex-row items-center justify-between border-b border-primary/15 bg-primary/5 px-4 py-3">
              <CardTitle className="text-sm font-semibold">Live Weight</CardTitle>
              <Badge className={cn(
                'border-0 hover:bg-transparent',
                effectiveBranchId ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700',
              )}>{effectiveBranchId ? 'Branch selected' : 'Select branch'}</Badge>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">{isSecondFlow ? 'Capture tare weight' : 'Capture gross weight'}</p>
                <button
                  type="button"
                  onClick={() => {
                    setManualMode((current) => !current);
                    setCapturedWeight(null);
                    setManualWeight('');
                  }}
                  className={cn(
                    'flex h-8 items-center gap-1.5 rounded-full border px-2.5 py-0 text-[11px] font-bold uppercase tracking-wide',
                    manualMode ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-primary',
                  )}
                >
                  <WifiOff className="h-3 w-3" />
                  {manualMode ? 'Manual mode on' : 'Switch to manual'}
                </button>
              </div>
              {manualMode ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>{isSecondFlow ? 'Tare weight (kg)' : 'Gross weight (kg)'}</Label>
                    <Input type="number" min="0" value={manualWeight} onChange={(event) => setManualWeight(event.target.value)} placeholder="Enter weight" />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Reason</Label>
                    <Textarea rows={3} value={weightReason} onChange={(event) => setWeightReason(event.target.value)} placeholder="Reason for manual capture" />
                  </div>
                </div>
              ) : (
                <div className="[&_.rounded-xl]:p-3 [&_.mb-3]:mb-2 [&_.mb-4]:mb-2 [&_.text-6xl]:text-5xl [&_.text-5xl]:text-4xl [&_.text-2xl]:text-xl">
                  <LiveIndicator
                    branchId={effectiveBranchId}
                    label={isSecondFlow ? 'Tare Weight' : 'Gross Weight'}
                    capturedWeight={capturedWeight}
                    onCapture={handleCapture}
                    disabled={isSecondFlow ? !workflowContext?.has_pending_first_weight : !branchId}
                  />
                </div>
              )}

              {isSecondFlow && firstTransaction ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border px-4 py-3">
                    <div className="text-xs text-muted-foreground">First weight</div>
                    <div className="text-xl font-bold">{Number(firstTransaction.gross_weight ?? 0).toLocaleString()} kg</div>
                  </div>
                  <div className="rounded-lg border px-4 py-3">
                    <div className="text-xs text-muted-foreground">Captured tare</div>
                    <div className="text-xl font-bold">{effectiveWeight != null ? `${effectiveWeight.toLocaleString()} kg` : '—'}</div>
                  </div>
                  <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3">
                    <div className="text-xs text-emerald-700">Net weight</div>
                    <div className="text-xl font-bold text-emerald-800">{netWeight != null ? `${netWeight.toLocaleString()} kg` : '—'}</div>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <CameraPanel branchId={effectiveBranchId} snapshotVersion={snapshotVersion} onRefresh={refreshCameraPreviews} />
        </aside>

        <section className="min-w-0 space-y-4">
          <Card className="overflow-hidden border-primary/20 shadow-sm">
            <CardHeader className="border-b border-primary/15 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent py-3">
              <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest">
                <span className="h-2 w-2 rounded-full bg-primary" />
                Vehicle and Transaction Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              <div className="grid gap-3 rounded-xl border border-primary/20 bg-primary/[0.04] p-3 md:grid-cols-2 xl:grid-cols-[minmax(210px,0.8fr)_minmax(210px,0.8fr)_1fr]">
                <div className="space-y-1.5">
                  <Label>Operation Type</Label>
                  <Select value={operationTypeId} onValueChange={setOperationTypeId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select operation type" />
                    </SelectTrigger>
                    <SelectContent>
                      {operationTypeList.map((row) => (
                        <SelectItem key={row.id} value={String(row.id)}>
                          {row.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {shouldShowBranchSelector ? (
                  <div className="space-y-1.5">
                    <Label>Branch</Label>
                    <Select value={branchId} onValueChange={setBranchId}>
                      <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                      <SelectContent>
                        {selectableBranchList.map((branch: any) => (
                          <SelectItem key={branch.id} value={String(branch.id)}>{branch.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Only your active assigned branches are available for weighment entry.</p>
                  </div>
                ) : null}
                <div className="hidden items-center gap-3 rounded-lg border border-dashed border-primary/25 bg-background/70 px-4 text-sm text-muted-foreground xl:flex">
                  <Scale className="h-5 w-5 text-primary" />
                  <span>Select the vehicle details, capture a stable weight, then submit the ticket.</span>
                </div>
              </div>

              {isSecondFlow ? (
                <>
                  <div className="relative">
                    <div className="flex items-center gap-2 rounded-lg border px-3 py-2 focus-within:ring-2 focus-within:ring-primary">
                      <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <input
                        className="flex-1 bg-transparent font-mono text-lg font-bold uppercase tracking-widest outline-none placeholder:font-normal placeholder:tracking-normal"
                        placeholder="Type plate to search"
                        value={plateInput}
                        onChange={(event) => {
                          setPlateInput(event.target.value.toUpperCase());
                          setShowVehicleResults(true);
                          setSelectedVehicle(null);
                        }}
                        onFocus={() => setShowVehicleResults(true)}
                      />
                      {searchingVehicles ? <span className="text-xs text-muted-foreground">searching…</span> : null}
                    </div>
                    {showVehicleResults && plateInput.trim().length >= 2 && (
                      <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border bg-card shadow-lg">
                        {searchedVehicles.length === 0 ? (
                          <div className="p-4 text-sm text-muted-foreground">No vehicles found for "{plateInput}"</div>
                        ) : searchedVehicles.map((vehicle: any) => (
                          <button
                            key={vehicle.id}
                            type="button"
                            className="flex w-full items-center justify-between border-b px-4 py-3 text-left transition-colors hover:bg-muted/60 last:border-b-0"
                            onClick={() => {
                              setSelectedVehicle(vehicle);
                              setPlateInput(vehicle.number_plate);
                              setShowVehicleResults(false);
                              setCapturedWeight(null);
                              setManualWeight('');
                            }}
                          >
                            <span className="font-mono font-bold uppercase tracking-wide">{vehicle.number_plate}</span>
                            <span className="text-xs text-muted-foreground">
                              {vehicle.customer_name}{vehicle.vehicle_type_name ? ` · ${vehicle.vehicle_type_name}` : ''}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {selectedVehicle ? (
                    <div className={cn(
                      'rounded-xl border p-4',
                      workflowContext?.has_pending_first_weight
                        ? 'border-emerald-300 bg-emerald-50/70'
                        : 'border-orange-300 bg-orange-50/70',
                    )}>
                      {loadingWorkflow ? (
                        <div className="text-sm text-muted-foreground">Checking pending first weight…</div>
                      ) : workflowContext?.has_pending_first_weight ? (
                        <div className="space-y-2">
                          <div className="font-semibold text-emerald-800">Pending first weight found</div>
                          <div className="grid gap-2 text-sm sm:grid-cols-2">
                            <div>Ticket: <span className="font-mono font-bold">TX-{String(firstTransaction?.id).padStart(5, '0')}</span></div>
                            <div>Gross: <span className="font-mono font-bold">{Number(firstTransaction?.gross_weight ?? 0).toLocaleString()} kg</span></div>
                            <div>Customer: <span className="font-semibold">{workflowContext?.customer_name}</span></div>
                            <div>Branch: <span className="font-semibold">{firstTransaction?.branch_name}</span></div>
                            {firstTransaction?.item_name ? <div>Item: <span className="font-semibold">{firstTransaction.item_name}</span></div> : null}
                            {firstTransaction?.destination ? <div>Destination: <span className="font-semibold">{firstTransaction.destination}</span></div> : null}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <div className="font-semibold text-orange-800">No pending first weight</div>
                          <div className="text-sm text-orange-700">{workflowContext?.message ?? 'A matching first weight was not found.'}</div>
                        </div>
                      )}
                    </div>
                  ) : null}
                  {duplicateOpenSecondWeight ? (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      Open second-flow draft found for this vehicle: <span className="font-mono font-bold">TX-{String(duplicateOpenSecondWeight.id).padStart(5, '0')}</span>. Complete that record before capturing another one.
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="space-y-3">
                  <section className="rounded-xl border border-primary/15 bg-card p-3 shadow-sm">
                    <div className="mb-3 flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">1</span>
                      <div>
                        <h3 className="flex items-center gap-2 font-semibold"><Truck className="h-4 w-4 text-primary" />Vehicle account</h3>
                        <p className="text-xs text-muted-foreground">Choose the customer and registered vehicle for this ticket.</p>
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <div className="space-y-1.5">
                        <div className="flex min-h-8 items-center justify-between gap-3">
                          <Label>Customer</Label>
                          {canAddCustomer ? <Button type="button" variant="outline" size="sm" className="h-8 gap-1 border-primary/25 text-primary hover:bg-primary/10 hover:text-primary" onClick={() => setCustomerOpen(true)}><Plus className="h-3.5 w-3.5" /> Add Customer</Button> : null}
                        </div>
                        <SearchSelect value={customerId} onChange={(value) => { setCustomerId(value); setVehicleId(''); setVehicleTypeId(''); setItemId(''); setDestination(''); setDriverName(''); setDriverPhone(''); setPrefillVehicleKey(''); }} placeholder="Search customer" searchPlaceholder="Search customer" emptyLabel="No customers found" options={customerOptions} />
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex min-h-8 items-center justify-between gap-3">
                          <Label>Vehicle</Label>
                          {canAddVehicle ? <Button type="button" variant="outline" size="sm" className="h-8 gap-1 border-primary/25 text-primary hover:bg-primary/10 hover:text-primary" onClick={() => setVehicleOpen(true)} disabled={!customerId}><Plus className="h-3.5 w-3.5" /> Add Vehicle</Button> : null}
                        </div>
                        <SearchSelect value={vehicleId} onChange={(value) => { setPrefillVehicleKey(''); setVehicleId(value); const selected = vehicleList.find((vehicle: any) => String(vehicle.id) === value); setVehicleTypeId(selected?.vehicle_type ? String(selected.vehicle_type) : ''); }} placeholder={customerId ? 'Search vehicle' : 'Select customer first'} searchPlaceholder="Search vehicle" emptyLabel="No vehicles found" disabled={!customerId} options={vehicleOptions} />
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex min-h-8 items-center gap-2"><Label>Vehicle Type</Label><Badge variant="outline" className="border-primary/20 bg-primary/5 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-primary">Locked</Badge></div>
                        <div className={cn('flex h-9 items-center gap-2 rounded-md border px-3 text-sm shadow-sm', lockedVehicleTypeName ? 'border-primary/20 bg-primary/5 text-foreground' : 'border-input bg-muted/40 text-muted-foreground')}>
                          <LockKeyhole className="h-4 w-4 shrink-0 text-primary" /><span className="truncate">{lockedVehicleTypeName || 'Select a registered vehicle first'}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground">Set on the vehicle record and cannot be changed during weighment.</p>
                      </div>
                      {duplicateOpenFirstWeight ? <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 md:col-span-2 xl:col-span-3">Open draft found for this vehicle: <span className="font-mono font-bold">TX-{String(duplicateOpenFirstWeight.id).padStart(5, '0')}</span>. Complete or approve that {duplicateOpenFirstWeight.operation_type_name.toLowerCase()} record before saving another one.</div> : null}
                    </div>
                  </section>
                  <div className="grid gap-3 xl:grid-cols-2">
                    <section className="rounded-xl border border-primary/15 bg-card p-3 shadow-sm">
                      <div className="mb-3 flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">2</span><div><h3 className="flex items-center gap-2 font-semibold"><Package className="h-4 w-4 text-primary" />Load details</h3><p className="text-xs text-muted-foreground">Record what the vehicle is carrying and where it is going.</p></div></div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5"><div className="flex min-h-8 items-center justify-between gap-3"><Label>Commodity</Label>{canAddItem ? <Button type="button" variant="outline" size="sm" className="h-8 gap-1 border-primary/25 text-primary hover:bg-primary/10 hover:text-primary" onClick={() => setItemOpen(true)}><Plus className="h-3.5 w-3.5" /> Add Item</Button> : null}</div><Select value={itemId} onValueChange={setItemId}><SelectTrigger><SelectValue placeholder="Select commodity" /></SelectTrigger><SelectContent>{itemList.map((row: any) => <SelectItem key={row.id} value={String(row.id)}>{row.name}</SelectItem>)}</SelectContent></Select></div>
                        <div className="space-y-1.5"><div className="flex min-h-8 items-center"><Label>Destination</Label></div><Input value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="Optional destination" /></div>
                      </div>
                    </section>
                    <section className="rounded-xl border border-primary/15 bg-card p-3 shadow-sm">
                      <div className="mb-3 flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">3</span><div><h3 className="flex items-center gap-2 font-semibold"><UserRound className="h-4 w-4 text-primary" />Driver details</h3><p className="text-xs text-muted-foreground">Optional contact details for ticket follow-up.</p></div></div>
                      <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><div className="flex min-h-8 items-center"><Label>Driver Name</Label></div><Input value={driverName} onChange={(event) => setDriverName(event.target.value)} placeholder="Driver name" /></div><div className="space-y-1.5"><div className="flex min-h-8 items-center"><Label>Driver Phone</Label></div><Input type="tel" value={driverPhone} onChange={(event) => setDriverPhone(event.target.value)} placeholder="Driver phone" /></div></div>
                    </section>
                  </div>
                </div>
              )}

              {isSecondFlow ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Driver Name</Label>
                    <Input value={driverName} onChange={(event) => setDriverName(event.target.value)} placeholder="Driver name" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Driver Phone</Label>
                    <Input value={driverPhone} onChange={(event) => setDriverPhone(event.target.value)} placeholder="Driver phone" />
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <div className="sticky bottom-3 z-10 flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-background/95 p-3 shadow-lg backdrop-blur">
            <p className="hidden text-sm text-muted-foreground sm:block">Review the vehicle and captured weight before saving.</p>
            <div className="ml-auto flex items-center gap-3">
            <Button type="button" variant="outline" onClick={() => setLocation('/weighbridge/transactions')}>
              Close
            </Button>
            <Button type="submit" className="h-11 min-w-48 bg-primary px-6 text-primary-foreground shadow-sm hover:bg-primary/90" disabled={create.isPending || hasDuplicateOpenTransaction}>
              {create.isPending
                ? 'Saving…'
                : isSecondFlow
                  ? 'Complete Second Weight'
                  : 'Submit First Weight'}
            </Button>
            </div>
          </div>
        </section>
      </form>

      <Dialog open={customerOpen} onOpenChange={setCustomerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Customer</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <Input placeholder="Customer name" value={customerForm.name} onChange={(event) => setCustomerForm((current) => ({ ...current, name: event.target.value }))} />
            <Input placeholder="Phone number" value={customerForm.phone_number} onChange={(event) => setCustomerForm((current) => ({ ...current, phone_number: event.target.value }))} />
            <Input placeholder="Email address" value={customerForm.email} onChange={(event) => setCustomerForm((current) => ({ ...current, email: event.target.value }))} />
            <Textarea placeholder="Address" value={customerForm.address} onChange={(event) => setCustomerForm((current) => ({ ...current, address: event.target.value }))} rows={3} />
            <Button type="button" onClick={() => createCustomer().catch((err) => toast({ title: 'Could not add customer', description: err.message, variant: 'destructive' }))}>
              Save Customer
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={vehicleOpen} onOpenChange={setVehicleOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Vehicle</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <Input placeholder="Number plate" value={vehicleForm.number_plate} onChange={(event) => setVehicleForm((current) => ({ ...current, number_plate: event.target.value.toUpperCase() }))} />
            <Select value={vehicleForm.vehicle_type || vehicleTypeId} onValueChange={(value) => setVehicleForm((current) => ({ ...current, vehicle_type: value }))}>
              <SelectTrigger><SelectValue placeholder="Select vehicle type…" /></SelectTrigger>
              <SelectContent>
                {vehicleTypeList.map((vehicleType: any) => (
                  <SelectItem key={vehicleType.id} value={String(vehicleType.id)}>{vehicleType.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" onClick={() => createVehicle().catch((err) => toast({ title: 'Could not add vehicle', description: err.message, variant: 'destructive' }))} disabled={!customerId}>
              Save Vehicle
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={itemOpen} onOpenChange={setItemOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Item</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <Input placeholder="Item name" value={itemForm.name} onChange={(event) => setItemForm((current) => ({ ...current, name: event.target.value }))} />
            <Textarea placeholder="Description" value={itemForm.description} onChange={(event) => setItemForm((current) => ({ ...current, description: event.target.value }))} rows={3} />
            <Button type="button" onClick={() => createItem().catch((err) => toast({ title: 'Could not add item', description: err.message, variant: 'destructive' }))}>
              Save Item
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
