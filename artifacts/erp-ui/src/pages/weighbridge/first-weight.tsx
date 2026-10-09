/**
 * First Weight — captures gross weight from the live indicator.
 *
 * Updated flow:
 *   1. Pick customer / vehicle / commodity first
 *   2. Confirm branch & operation (branch defaults from signed-in user when available)
 *   3. Capture gross weight last
 *   4. Submit → creates First Weight transaction with payment pending
 */
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import {
  useCreateTransaction,
  getListTransactionsQueryKey,
} from '@workspace/api-client-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/use-auth';
import { ERP_BRANCHES_QUERY_KEY, fetchErpBranches } from '@/lib/branches';
import { cn } from '@/lib/utils';
import { Check, ChevronsUpDown, Plus, Scale, WifiOff } from 'lucide-react';
import LiveIndicator from '@/components/weighbridge/live-indicator';
import { apiErrorFromResponse, formatApiError } from '@/lib/api-errors';

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
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
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
                    {option.meta ? (
                      <div className="truncate text-xs text-muted-foreground">{option.meta}</div>
                    ) : null}
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

export default function FirstWeightPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const create = useCreateTransaction();

  const [branchId, setBranchId] = useState('');
  const [operationTypeId, setOperationTypeId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [vehicleTypeId, setVehicleTypeId] = useState('');
  const [itemId, setItemId] = useState('');
  const [destination, setDestination] = useState('');
  const [manualMode, setManualMode] = useState(false);
  const [grossWeight, setGrossWeight] = useState<number | null>(null);
  const [manualWeight, setManualWeight] = useState('');
  const [weightReason, setWeightReason] = useState('');
  const [customerOpen, setCustomerOpen] = useState(false);
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [itemOpen, setItemOpen] = useState(false);
  const [customerForm, setCustomerForm] = useState({ name: '', phone_number: '', email: '', address: '' });
  const [vehicleForm, setVehicleForm] = useState({ number_plate: '', vehicle_type: '' });
  const [itemForm, setItemForm] = useState({ name: '', description: '' });
  const [currentStep, setCurrentStep] = useState(0);

  const fetchToken = () => localStorage.getItem('sl-erp-token');
  const userBranchId = String((user as any)?.branch_id ?? '');

  const { data: branches } = useQuery({
    queryKey: ERP_BRANCHES_QUERY_KEY,
    queryFn: async () => fetchErpBranches(fetchToken() || ''),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const { data: customers } = useQuery({
    queryKey: ['wb-customers'],
    queryFn: async () => fetch('/api/commercial-weighbridge/customers/?page_size=1000&search=', { headers: { Authorization: `Token ${fetchToken()}` } }).then(r => r.json()),
  });
  const { data: vehicles } = useQuery({
    queryKey: ['wb-vehicles', customerId],
    queryFn: async () => fetch(`/api/commercial-weighbridge/vehicles/?customer_id=${customerId}`, { headers: { Authorization: `Token ${fetchToken()}` } }).then(r => r.json()),
    enabled: !!customerId,
  });
  const { data: items } = useQuery({
    queryKey: ['items-picker'],
    queryFn: async () => {
      const token = fetchToken();
      return fetch('/api/commercial-weighbridge/items/', { headers: { Authorization: `Token ${token}` } }).then(r => r.json());
    },
  });
  const { data: vehicleTypesRaw } = useQuery({
    queryKey: ['wb-vehicle-types'],
    queryFn: async () => fetch('/api/commercial-weighbridge/vehicle-types/', { headers: { Authorization: `Token ${fetchToken()}` } }).then(r => r.json()),
  });
  const { data: operationTypesRaw } = useQuery({
    queryKey: ['wb-operation-types'],
    queryFn: async () => fetch('/api/commercial-weighbridge/weighing-operation-types/', { headers: { Authorization: `Token ${fetchToken()}` } }).then(r => r.json()),
  });

  const branchList = Array.isArray(branches) ? branches : [];
  const customerList = Array.isArray(customers) ? customers : (customers as any)?.results ?? [];
  const vehicleList = Array.isArray(vehicles) ? vehicles : (vehicles as any)?.results ?? [];
  const itemList = Array.isArray(items) ? items : (items as any)?.results ?? [];
  const vehicleTypeList = Array.isArray(vehicleTypesRaw) ? vehicleTypesRaw : (vehicleTypesRaw as any)?.results ?? [];
  const operationTypeList = (Array.isArray(operationTypesRaw) ? operationTypesRaw : (operationTypesRaw as any)?.results ?? []).filter((row: any) => row.is_active && row.flow_kind !== 'second');
  const operator = (user as any)?.username ?? '';
  const selectedOperationType = operationTypeList.find((row: any) => String(row.id) === operationTypeId) ?? operationTypeList[0];
  const showBranchSelector = branchList.length > 1;

  useEffect(() => {
    if (branchId || branchList.length === 0) return;
    if (userBranchId && branchList.some((branch: any) => String(branch.id) === userBranchId)) {
      setBranchId(userBranchId);
      return;
    }
    if (branchList.length === 1) {
      setBranchId(String(branchList[0].id));
    }
  }, [branchId, branchList, userBranchId]);

  useEffect(() => {
    if (!selectedOperationType?.id || operationTypeId) return;
    setOperationTypeId(String(selectedOperationType.id));
  }, [operationTypeId, selectedOperationType]);

  const effectiveWeight = manualMode ? parseInt(manualWeight, 10) || null : grossWeight;

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchId || !customerId || !vehicleId) {
      toast({ title: 'Missing fields', description: 'Branch, customer and vehicle are required.', variant: 'destructive' });
      return;
    }
    if (!effectiveWeight || effectiveWeight <= 0) {
      toast({ title: 'No weight captured', description: manualMode ? 'Enter a weight manually.' : 'Press Capture on the indicator panel.', variant: 'destructive' });
      return;
    }
    if (manualMode && !weightReason.trim()) {
      toast({ title: 'Reason required', description: 'Enter a reason for manual weight entry.', variant: 'destructive' });
      return;
    }

    const payload: Record<string, unknown> = {
      branch: parseInt(branchId, 10),
      customer: parseInt(customerId, 10),
      vehicle: parseInt(vehicleId, 10),
      weight_type: selectedOperationType?.legacy_weight_type ?? 'First Weight',
      gross_weight: effectiveWeight,
      destination,
      operator,
      payment_mode: 'Cash',
      payment_status: 'Pending',
      manual_weight_capture: manualMode,
    };
    if (selectedOperationType?.id) payload.operation_type = selectedOperationType.id;
    if (itemId) payload.item = parseInt(itemId, 10);
    if (vehicleTypeId) payload.vehicle_type = parseInt(vehicleTypeId, 10);
    if (manualMode && weightReason) payload.weight_reason = weightReason;

    create.mutate({ data: payload as any }, {
      onSuccess: (tx: any) => {
        toast({ title: `✓ First weight logged — TX-${String(tx?.id ?? '').padStart(5, '0')}` });
        queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
        setLocation('/weighbridge/transactions');
      },
      onError: (err: any) => toast({ title: 'Could not log transaction', description: formatApiError(err), variant: 'destructive' }),
    });
  };

  const stepLabels = ['Vehicle & Commodity', 'Branch & Operation', 'Capture Gross Weight'];
  const canContinueStepOne = Boolean(customerId && vehicleId);
  const canContinueStepTwo = Boolean(branchId && operationTypeId);
  const canSubmit = Boolean(effectiveWeight && branchId && customerId && vehicleId);

  const createCustomer = async () => {
    const payload = {
      name: customerForm.name.trim(),
      phone_number: customerForm.phone_number.trim(),
      address: customerForm.address.trim(),
      ...(customerForm.email.trim() ? { email: customerForm.email.trim() } : {}),
    };
    const res = await fetch('/api/commercial-weighbridge/customers/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Token ${fetchToken()}` },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw await apiErrorFromResponse(res, 'The customer could not be added.');
    const response = await res.json();
    const customer = response?.data ?? response;
    if (!customer?.id) throw new Error('Customer was created, but no customer record was returned.');
    await queryClient.invalidateQueries({ queryKey: ['wb-customers'] });
    await queryClient.refetchQueries({ queryKey: ['wb-customers'], type: 'active' });
    setCustomerId(String(customer.id));
    setVehicleId('');
    setCustomerOpen(false);
    setCustomerForm({ name: '', phone_number: '', email: '', address: '' });
  };

  const createVehicle = async () => {
    const res = await fetch('/api/commercial-weighbridge/vehicles/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Token ${fetchToken()}` },
      body: JSON.stringify({
        customer: Number(customerId),
        vehicle_type: Number(vehicleForm.vehicle_type || vehicleTypeId),
        number_plate: vehicleForm.number_plate.toUpperCase(),
      }),
    });
    if (!res.ok) throw await apiErrorFromResponse(res, 'The vehicle could not be added.');
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
      headers: { 'Content-Type': 'application/json', Authorization: `Token ${fetchToken()}` },
      body: JSON.stringify(itemForm),
    });
    if (!res.ok) throw await apiErrorFromResponse(res, 'The commodity could not be added.');
    const response = await res.json();
    const item = response?.data ?? response;
    if (!item?.id) throw new Error('Commodity was created, but no commodity record was returned.');
    await queryClient.invalidateQueries({ queryKey: ['items-picker'] });
    await queryClient.refetchQueries({ queryKey: ['items-picker'], type: 'active' });
    setItemId(String(item.id));
    setItemOpen(false);
    setItemForm({ name: '', description: '' });
  };

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center gap-4 border-b pb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Scale className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">First Weight</h1>
          <p className="text-sm text-muted-foreground">Capture gross weight and open a new transaction</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid gap-3 md:grid-cols-3">
          {stepLabels.map((label, index) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                if (index === 0) setCurrentStep(0);
                if (index === 1 && canContinueStepOne) setCurrentStep(1);
                if (index === 2 && canContinueStepOne && canContinueStepTwo) setCurrentStep(2);
              }}
              className={cn(
                'rounded-xl border px-4 py-3 text-left transition-colors',
                currentStep === index ? 'border-primary bg-primary/5' : 'border-border bg-card',
              )}
            >
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Step {index + 1}</div>
              <div className="mt-1 text-sm font-semibold">{label}</div>
            </button>
          ))}
        </div>

        {currentStep === 0 && (
        <Card className="shadow-sm">
          <CardHeader className="border-b bg-muted/20 py-3">
            <CardTitle className="text-sm font-bold uppercase tracking-widest">1 · Vehicle & Commodity</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 p-5 md:grid-cols-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Customer *</label>
                <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => setCustomerOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> Add Customer
                </Button>
              </div>
              <SearchSelect
                value={customerId}
                onChange={(value) => {
                  setCustomerId(value);
                  setVehicleId('');
                  setVehicleTypeId('');
                }}
                placeholder="Search customer…"
                searchPlaceholder="Search customer…"
                emptyLabel="No customer found."
                options={customerOptions}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Vehicle *</label>
                <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => setVehicleOpen(true)} disabled={!customerId}>
                  <Plus className="h-3.5 w-3.5" /> Add Vehicle
                </Button>
              </div>
              <SearchSelect
                value={vehicleId}
                onChange={(value) => {
                  setVehicleId(value);
                  const selectedVehicle = vehicleList.find((vehicle: any) => String(vehicle.id) === value);
                  if (selectedVehicle?.vehicle_type) setVehicleTypeId(String(selectedVehicle.vehicle_type));
                }}
                placeholder={customerId ? 'Search vehicle…' : 'Select customer first'}
                searchPlaceholder="Search vehicle…"
                emptyLabel={customerId ? 'No vehicle found.' : 'Select a customer first.'}
                disabled={!customerId}
                options={vehicleOptions}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Item / Commodity</label>
                <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1 whitespace-nowrap" onClick={() => setItemOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> Add Item
                </Button>
              </div>
              <Select value={itemId} onValueChange={setItemId}>
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>{itemList.map((item: any) => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Destination</label>
              <Input placeholder="e.g. Nairobi CBD" value={destination} onChange={e => setDestination(e.target.value)} />
            </div>
          </CardContent>
        </Card>
        )}

        {currentStep === 1 && (
        <Card className="shadow-sm">
          <CardHeader className="border-b bg-muted/20 py-3">
            <CardTitle className="text-sm font-bold uppercase tracking-widest">2 · Branch & Operation</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 p-5 md:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Operation Type *</label>
              <Select value={operationTypeId || (selectedOperationType ? String(selectedOperationType.id) : '')} onValueChange={setOperationTypeId}>
                <SelectTrigger><SelectValue placeholder="Select weighing operation…" /></SelectTrigger>
                <SelectContent>
                  {operationTypeList.map((row: any) => <SelectItem key={row.id} value={String(row.id)}>{row.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              {showBranchSelector ? (
                <>
                  <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Branch *</label>
                  <Select value={branchId} onValueChange={setBranchId} required>
                    <SelectTrigger><SelectValue placeholder="Select branch to activate indicator…" /></SelectTrigger>
                    <SelectContent>{branchList.map((branch: any) => <SelectItem key={branch.id} value={String(branch.id)}>{branch.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Active assigned branches are available here.</p>
                </>
              ) : (
                <>
                  <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Branch</label>
                  <div className="flex h-10 items-center rounded-md border bg-muted/30 px-3 text-sm text-foreground">
                    {branchList[0]?.name || 'Auto-selected in background'}
                  </div>
                  <p className="text-xs text-muted-foreground">The only available active branch is being used automatically.</p>
                </>
              )}
            </div>
          </CardContent>
        </Card>
        )}

        {currentStep === 2 && (
        <Card className="overflow-hidden shadow-sm">
          <CardHeader className="flex-row items-center justify-between border-b bg-muted/20 py-3">
            <div>
              <CardTitle className="text-sm font-bold uppercase tracking-widest">3 · Capture Gross Weight</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Payment stays pending here and is completed later from preview or listing.</p>
            </div>
            <button
              type="button"
              onClick={() => { setManualMode(mode => !mode); setGrossWeight(null); setManualWeight(''); }}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide transition-colors ${
                manualMode ? 'border-orange-300 bg-orange-100 text-orange-700' : 'border-border bg-card text-muted-foreground hover:text-foreground'
              }`}
            >
              <WifiOff className="h-3 w-3" />
              {manualMode ? 'Manual mode ON' : 'Switch to manual'}
            </button>
          </CardHeader>
          <CardContent className="p-5">
            {manualMode ? (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
                <div className="flex items-end gap-3">
                  <Input
                    type="number"
                    min={1}
                    value={manualWeight}
                    onChange={e => setManualWeight(e.target.value)}
                    placeholder="0"
                    className="h-16 border-orange-300 text-center font-mono text-4xl focus:border-orange-400"
                    autoFocus
                  />
                  <span className="mb-2 text-2xl font-medium text-muted-foreground">kg</span>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Reason for manual entry *</label>
                  <Input value={weightReason} onChange={e => setWeightReason(e.target.value)} placeholder="e.g. Indicator offline — manually read scale display" />
                </div>
              </div>
            ) : (
              <LiveIndicator
                branchId={branchId}
                label="Gross Weight"
                onCapture={weight => setGrossWeight(weight)}
                capturedWeight={grossWeight}
                disabled={!branchId}
              />
            )}
          </CardContent>
        </Card>
        )}

        {effectiveWeight && effectiveWeight > 0 && (
          <div className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 p-4">
            <span className="text-sm font-bold uppercase tracking-wide text-primary">Gross Weight to Submit</span>
            <span className="font-mono text-2xl font-black text-primary">{effectiveWeight.toLocaleString()} kg</span>
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => setCurrentStep(step => Math.max(0, step - 1))}
            disabled={currentStep === 0}
          >
            Back
          </Button>

          <div className="flex gap-3">
            {currentStep < 2 ? (
              <Button
                type="button"
                onClick={() => setCurrentStep(step => Math.min(2, step + 1))}
                disabled={(currentStep === 0 && !canContinueStepOne) || (currentStep === 1 && !canContinueStepTwo)}
                className="font-bold uppercase tracking-widest"
              >
                Next
              </Button>
            ) : (
              <Button
                type="submit"
                size="lg"
                className="font-bold uppercase tracking-widest"
                disabled={create.isPending || !canSubmit}
              >
                {create.isPending ? 'Logging…' : 'Submit First Weight'}
              </Button>
            )}
          </div>
        </div>
      </form>

      <Dialog open={customerOpen} onOpenChange={setCustomerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Customer</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <Input placeholder="Customer name *" value={customerForm.name} onChange={e => setCustomerForm(previous => ({ ...previous, name: e.target.value }))} />
            <Input placeholder="Phone number *" value={customerForm.phone_number} onChange={e => setCustomerForm(previous => ({ ...previous, phone_number: e.target.value }))} />
            <Input type="email" placeholder="Email address (optional)" value={customerForm.email} onChange={e => setCustomerForm(previous => ({ ...previous, email: e.target.value }))} />
            <Textarea placeholder="Address" value={customerForm.address} onChange={e => setCustomerForm(previous => ({ ...previous, address: e.target.value }))} rows={3} />
            <Button type="button" onClick={() => createCustomer().catch(err => toast({ title: 'Could not add customer', description: formatApiError(err), variant: 'destructive' }))}>Save Customer</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={vehicleOpen} onOpenChange={setVehicleOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Vehicle</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <Input placeholder="Number plate" value={vehicleForm.number_plate} onChange={e => setVehicleForm(previous => ({ ...previous, number_plate: e.target.value.toUpperCase() }))} />
            <Select value={vehicleForm.vehicle_type || vehicleTypeId} onValueChange={value => setVehicleForm(previous => ({ ...previous, vehicle_type: value }))}>
              <SelectTrigger><SelectValue placeholder="Select vehicle type…" /></SelectTrigger>
              <SelectContent>{vehicleTypeList.map((vehicleType: any) => <SelectItem key={vehicleType.id} value={String(vehicleType.id)}>{vehicleType.name}</SelectItem>)}</SelectContent>
            </Select>
            <Button type="button" onClick={() => createVehicle().catch(err => toast({ title: 'Could not add vehicle', description: formatApiError(err), variant: 'destructive' }))} disabled={!customerId}>Save Vehicle</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={itemOpen} onOpenChange={setItemOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Item</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <Input placeholder="Item name" value={itemForm.name} onChange={e => setItemForm(previous => ({ ...previous, name: e.target.value }))} />
            <Textarea placeholder="Description" value={itemForm.description} onChange={e => setItemForm(previous => ({ ...previous, description: e.target.value }))} rows={3} />
            <Button type="button" onClick={() => createItem().catch(err => toast({ title: 'Could not add item', description: formatApiError(err), variant: 'destructive' }))}>Save Item</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
