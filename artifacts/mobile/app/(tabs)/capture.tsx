import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/context/auth';
import {
  apiRequest,
  type Branch,
  type Customer,
  type Vehicle,
  type Item,
  type WorkflowContext,
} from '@/lib/api';
import colors from '@/constants/colors';

const C = colors.light;

// ── Sub-components ────────────────────────────────────────────────────────────

interface SelectFieldProps {
  label: string;
  value: string;
  placeholder?: string;
  onPress: () => void;
  disabled?: boolean;
  icon?: keyof typeof Feather.glyphMap;
}

function SelectField({ label, value, placeholder = 'Select…', onPress, disabled, icon }: SelectFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        style={({ pressed }) => [styles.selectBtn, pressed && { opacity: 0.7 }, disabled && styles.selectDisabled]}
        onPress={onPress}
        disabled={disabled}
      >
        {icon && <Feather name={icon} size={16} color={C.mutedForeground} style={{ marginRight: 8 }} />}
        <Text style={[styles.selectText, !value && styles.selectPlaceholder]} numberOfLines={1}>
          {value || placeholder}
        </Text>
        <Feather name="chevron-down" size={16} color={C.mutedForeground} />
      </Pressable>
    </View>
  );
}

interface PickerSheetProps<T> {
  title: string;
  items: T[];
  getLabel: (item: T) => string;
  getValue: (item: T) => number | string;
  onSelect: (item: T) => void;
  onClose: () => void;
}

function PickerSheet<T>({ title, items, getLabel, getValue, onSelect, onClose }: PickerSheetProps<T>) {
  return (
    <View style={styles.sheet}>
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetTitle}>{title}</Text>
        <Pressable onPress={onClose}>
          <Feather name="x" size={20} color={C.mutedForeground} />
        </Pressable>
      </View>
      <ScrollView style={styles.sheetList} keyboardShouldPersistTaps="handled">
        {items.map((item) => (
          <Pressable
            key={String(getValue(item))}
            style={({ pressed }) => [styles.sheetItem, pressed && { backgroundColor: C.muted }]}
            onPress={() => { onSelect(item); onClose(); }}
          >
            <Text style={styles.sheetItemText}>{getLabel(item)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

// ── Workflow context banner ───────────────────────────────────────────────────

function WorkflowBanner({ ctx, loading }: { ctx?: WorkflowContext; loading: boolean }) {
  if (loading) {
    return (
      <View style={[styles.banner, styles.bannerNeutral]}>
        <Text style={styles.bannerText}>Checking workflow context…</Text>
      </View>
    );
  }
  if (!ctx) return null;

  if (ctx.has_pending_first_weight && ctx.first_weight_transaction) {
    const tx = ctx.first_weight_transaction;
    return (
      <View style={[styles.banner, styles.bannerWarning]}>
        <Feather name="alert-triangle" size={16} color="#b45309" style={{ marginRight: 8 }} />
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle}>Pending First Weight Found</Text>
          <Text style={styles.bannerSub}>
            TX-{String(tx.id).padStart(5, '0')} · {tx.gross_weight?.toLocaleString()} kg
            {tx.destination ? ` · ${tx.destination}` : ''}
          </Text>
          <Text style={styles.bannerSub}>Switch to "Second Weight" to complete this transaction.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.banner, styles.bannerGreen]}>
      <Feather name="check-circle" size={16} color="#059669" style={{ marginRight: 8 }} />
      <Text style={[styles.bannerText, { color: '#065f46' }]}>No pending first weight — ready for first weight.</Text>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

type WeightType = 'First Weight' | 'Second Weight';
type PaymentMode = 'Cash' | 'Mpesa' | 'Bank Deposit' | 'Debt';
type PaymentStatus = 'Pending' | 'Paid';

export default function CaptureScreen() {
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top;

  // Form state
  const [branchId, setBranchId]         = useState<number | null>(null);
  const [branchName, setBranchName]     = useState('');
  const [customerId, setCustomerId]     = useState<number | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [vehicleId, setVehicleId]       = useState<number | null>(null);
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleTypeId, setVehicleTypeId] = useState<number | null>(null);
  const [itemId, setItemId]             = useState<number | null>(null);
  const [itemName, setItemName]         = useState('');
  const [weightKg, setWeightKg]         = useState('');
  const [weightType, setWeightType]     = useState<WeightType>('First Weight');
  const [paymentMode, setPaymentMode]   = useState<PaymentMode>('Cash');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('Pending');
  const [destination, setDestination]   = useState('');
  const [manualCapture, setManualCapture] = useState(false);
  const [weightReason, setWeightReason] = useState('');

  // Sheet state
  const [openSheet, setOpenSheet] = useState<
    'branch' | 'customer' | 'vehicle' | 'item' | 'weightType' | 'paymentMode' | 'paymentStatus' | null
  >(null);

  // API queries
  const { data: branchesRaw } = useQuery({
    queryKey: ['branches'],
    queryFn: () => apiRequest<any>('/commercial-weighbridge/branches/', {}, token),
    enabled: !!token,
  });

  const { data: customersRaw } = useQuery({
    queryKey: ['customers-picker'],
    queryFn: () => apiRequest<any>('/commercial-weighbridge/customers/?page_size=200', {}, token),
    enabled: !!token,
  });

  const { data: vehiclesRaw } = useQuery({
    queryKey: ['vehicles-picker', customerId],
    queryFn: () => apiRequest<any>(
      `/commercial-weighbridge/vehicles/?page_size=200${customerId ? `&customer_id=${customerId}` : ''}`,
      {}, token,
    ),
    enabled: !!token,
  });

  const { data: itemsRaw } = useQuery({
    queryKey: ['items'],
    queryFn: () => apiRequest<any>('/commercial-weighbridge/items/', {}, token),
    enabled: !!token,
  });

  // Normalise: both plain arrays and paginated {results:[]} responses
  const branches: Branch[]   = Array.isArray(branchesRaw)   ? branchesRaw   : branchesRaw?.results  ?? [];
  const customerList: Customer[] = Array.isArray(customersRaw) ? customersRaw : customersRaw?.results ?? [];
  const vehicleList: Vehicle[]   = Array.isArray(vehiclesRaw)  ? vehiclesRaw  : vehiclesRaw?.results  ?? [];
  const itemList: Item[]         = Array.isArray(itemsRaw)     ? itemsRaw     : itemsRaw?.results     ?? [];

  // Workflow context — only relevant when Second Weight is selected and a vehicle is chosen
  const { data: workflowCtx, isLoading: ctxLoading } = useQuery<WorkflowContext>({
    queryKey: ['workflow-context', vehicleId],
    queryFn: () => apiRequest(
      `/commercial-weighbridge/transactions/workflow-context/?vehicle_id=${vehicleId}`,
      {}, token,
    ),
    enabled: !!token && !!vehicleId,
    staleTime: 15_000,
  });

  const create = useMutation({
    mutationFn: (body: object) =>
      apiRequest('/commercial-weighbridge/transactions/', { method: 'POST', body: JSON.stringify(body) }, token),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['workflow-context', vehicleId] });
      Alert.alert(
        '✓ Transaction Logged',
        `${weightType} recorded for ${vehiclePlate}`,
        [{ text: 'OK', onPress: resetForm }],
      );
    },
    onError: (e: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', e.message || 'Could not log transaction');
    },
  });

  const resetForm = () => {
    setWeightKg('');
    setDestination('');
    setWeightReason('');
    setManualCapture(false);
  };

  const handleSubmit = () => {
    if (!branchId || !customerId || !vehicleId) {
      Alert.alert('Missing Fields', 'Select branch, customer, and vehicle.');
      return;
    }
    if (!weightKg || isNaN(Number(weightKg)) || Number(weightKg) <= 0) {
      Alert.alert('Invalid Weight', 'Enter a valid weight in kg.');
      return;
    }
    if (manualCapture && !weightReason.trim()) {
      Alert.alert('Weight Reason Required', 'Provide a reason for manual weight capture.');
      return;
    }

    // Second weight: validate workflow context
    if (weightType === 'Second Weight') {
      if (!workflowCtx?.has_pending_first_weight) {
        Alert.alert(
          'No Pending First Weight',
          workflowCtx?.message ?? 'This vehicle does not have a pending first weight. Create a first weight first.',
        );
        return;
      }
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const payload: Record<string, unknown> = {
      branch: branchId,
      customer: customerId,
      vehicle: vehicleId,
      item: itemId,
      weight_type: weightType,
      destination,
      operator: user?.username ?? '',
      payment_mode: paymentMode,
      payment_status: paymentStatus,
      manual_weight_capture: manualCapture,
    };

    if (vehicleTypeId) payload.vehicle_type = vehicleTypeId;
    if (manualCapture && weightReason) payload.weight_reason = weightReason;

    // Assign weight to correct field based on weight type
    if (weightType === 'First Weight') {
      payload.gross_weight = Number(weightKg);
    } else {
      payload.tare_weight = Number(weightKg);
      // Link to pending first weight transaction for pairing
      if (workflowCtx?.first_weight_transaction) {
        payload.paired_first_transaction = workflowCtx.first_weight_transaction.id;
        const gross = workflowCtx.first_weight_transaction.gross_weight ?? 0;
        payload.net_weight = Math.abs(gross - Number(weightKg));
      }
    }

    create.mutate(payload);
  };

  // Show workflow banner when Second Weight is selected and vehicle is picked
  const showWorkflowBanner = weightType === 'Second Weight' && !!vehicleId;

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: topPad }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 120 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.pageTitle}>Capture Weight</Text>
        <Text style={styles.pageSubtitle}>Log a new weighbridge transaction</Text>

        {/* Weight type toggle */}
        <View style={styles.toggleRow}>
          {(['First Weight', 'Second Weight'] as WeightType[]).map((wt) => (
            <Pressable
              key={wt}
              style={[styles.toggleBtn, weightType === wt && styles.toggleBtnActive]}
              onPress={() => setWeightType(wt)}
            >
              <Text style={[styles.toggleText, weightType === wt && styles.toggleTextActive]}>{wt}</Text>
            </Pressable>
          ))}
        </View>

        {/* Weight input — prominent */}
        <View style={styles.weightInputWrap}>
          <TextInput
            style={styles.weightInput}
            placeholder="0"
            placeholderTextColor={C.border}
            value={weightKg}
            onChangeText={setWeightKg}
            keyboardType="numeric"
            returnKeyType="done"
          />
          <Text style={styles.weightUnit}>kg</Text>
        </View>

        {/* Net weight preview for second weight */}
        {weightType === 'Second Weight' && workflowCtx?.first_weight_transaction && weightKg && (
          <View style={styles.netPreview}>
            <Text style={styles.netPreviewLabel}>Calculated Net</Text>
            <Text style={styles.netPreviewValue}>
              {Math.abs((workflowCtx.first_weight_transaction.gross_weight ?? 0) - Number(weightKg || '0')).toLocaleString()} kg
            </Text>
          </View>
        )}

        <View style={styles.divider} />

        {/* Workflow context banner */}
        {showWorkflowBanner && (
          <WorkflowBanner ctx={workflowCtx} loading={ctxLoading} />
        )}

        {/* Branch */}
        <SelectField
          label="Branch"
          value={branchName}
          placeholder="Select branch…"
          icon="map-pin"
          onPress={() => setOpenSheet('branch')}
        />

        {/* Customer */}
        <SelectField
          label="Customer"
          value={customerName}
          placeholder="Select customer…"
          icon="briefcase"
          onPress={() => setOpenSheet('customer')}
        />

        {/* Vehicle */}
        <SelectField
          label="Vehicle"
          value={vehiclePlate}
          placeholder={customerId ? 'Select vehicle…' : 'Select customer first'}
          icon="truck"
          onPress={() => setOpenSheet('vehicle')}
          disabled={!customerId}
        />

        {/* Item */}
        <SelectField
          label="Item / Commodity"
          value={itemName}
          placeholder="Select item (optional)"
          icon="package"
          onPress={() => setOpenSheet('item')}
        />

        {/* Destination */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Destination</Text>
          <View style={styles.inputWrap}>
            <Feather name="navigation" size={16} color={C.mutedForeground} style={{ marginRight: 8 }} />
            <TextInput
              style={styles.textInput}
              placeholder="e.g. Nairobi CBD"
              placeholderTextColor={C.mutedForeground}
              value={destination}
              onChangeText={setDestination}
              returnKeyType="done"
            />
          </View>
        </View>

        {/* Payment mode */}
        <SelectField
          label="Payment Mode"
          value={paymentMode}
          icon="credit-card"
          onPress={() => setOpenSheet('paymentMode')}
        />

        {/* Payment status */}
        <SelectField
          label="Payment Status"
          value={paymentStatus}
          icon="check-circle"
          onPress={() => setOpenSheet('paymentStatus')}
        />

        {/* Manual capture toggle */}
        <View style={styles.checkRow}>
          <Pressable
            style={[styles.checkbox, manualCapture && styles.checkboxChecked]}
            onPress={() => setManualCapture(v => !v)}
          >
            {manualCapture && <Feather name="check" size={12} color="#fff" />}
          </Pressable>
          <Text style={styles.checkLabel}>Manual weight capture (indicator offline)</Text>
        </View>

        {manualCapture && (
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Weight Reason *</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. Indicator offline — read manually"
                placeholderTextColor={C.mutedForeground}
                value={weightReason}
                onChangeText={setWeightReason}
                returnKeyType="done"
              />
            </View>
          </View>
        )}

        {/* Submit */}
        <Pressable
          style={({ pressed }) => [styles.submitBtn, pressed && { opacity: 0.85 }, create.isPending && { opacity: 0.7 }]}
          onPress={handleSubmit}
          disabled={create.isPending}
        >
          {create.isPending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Feather name="save" size={18} color="#fff" />
              <Text style={styles.submitText}>Log {weightType}</Text>
            </>
          )}
        </Pressable>
      </ScrollView>

      {/* Picker sheets */}
      {openSheet === 'branch' && (
        <PickerSheet
          title="Select Branch"
          items={branches}
          getLabel={(b) => b.name}
          getValue={(b) => b.id}
          onSelect={(b) => { setBranchId(b.id); setBranchName(b.name); }}
          onClose={() => setOpenSheet(null)}
        />
      )}
      {openSheet === 'customer' && (
        <PickerSheet
          title="Select Customer"
          items={customerList}
          getLabel={(c: Customer) => c.name}
          getValue={(c: Customer) => c.id}
          onSelect={(c: Customer) => {
            setCustomerId(c.id);
            setCustomerName(c.name);
            setVehicleId(null);
            setVehiclePlate('');
          }}
          onClose={() => setOpenSheet(null)}
        />
      )}
      {openSheet === 'vehicle' && (
        <PickerSheet
          title="Select Vehicle"
          items={vehicleList}
          getLabel={(v: Vehicle) => `${v.number_plate}${v.vehicle_type_name ? ` — ${v.vehicle_type_name}` : ''}`}
          getValue={(v: Vehicle) => v.id}
          onSelect={(v: Vehicle) => {
            setVehicleId(v.id);
            setVehiclePlate(v.number_plate);
            setVehicleTypeId(v.vehicle_type);
          }}
          onClose={() => setOpenSheet(null)}
        />
      )}
      {openSheet === 'item' && (
        <PickerSheet
          title="Select Item"
          items={items}
          getLabel={(i) => i.name}
          getValue={(i) => i.id}
          onSelect={(i) => { setItemId(i.id); setItemName(i.name); }}
          onClose={() => setOpenSheet(null)}
        />
      )}
      {openSheet === 'paymentMode' && (
        <PickerSheet
          title="Payment Mode"
          items={(['Cash', 'Mpesa', 'Bank Deposit', 'Debt'] as PaymentMode[]).map((m) => ({ id: m, name: m }))}
          getLabel={(m) => m.name}
          getValue={(m) => m.id}
          onSelect={(m) => setPaymentMode(m.name as PaymentMode)}
          onClose={() => setOpenSheet(null)}
        />
      )}
      {openSheet === 'paymentStatus' && (
        <PickerSheet
          title="Payment Status"
          items={(['Pending', 'Paid'] as PaymentStatus[]).map((s) => ({ id: s, name: s }))}
          getLabel={(s) => s.name}
          getValue={(s) => s.id}
          onSelect={(s) => setPaymentStatus(s.name as PaymentStatus)}
          onClose={() => setOpenSheet(null)}
        />
      )}
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.background },
  pageTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.foreground, marginTop: 16 },
  pageSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 4, marginBottom: 20 },

  toggleRow: {
    flexDirection: 'row',
    backgroundColor: C.muted,
    borderRadius: 10,
    padding: 3,
    marginBottom: 20,
  },
  toggleBtn: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 8 },
  toggleBtnActive: {
    backgroundColor: C.card,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1, shadowRadius: 2, elevation: 2,
  },
  toggleText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground },
  toggleTextActive: { color: C.primary },

  weightInputWrap: {
    flexDirection: 'row', alignItems: 'flex-end',
    justifyContent: 'center', marginBottom: 8, gap: 8,
  },
  weightInput: {
    fontSize: 56, fontFamily: 'Inter_700Bold', color: C.primary,
    textAlign: 'right', minWidth: 120, padding: 0,
  },
  weightUnit: { fontSize: 24, fontFamily: 'Inter_500Medium', color: C.mutedForeground, paddingBottom: 8 },

  netPreview: {
    alignItems: 'center', marginBottom: 8,
    padding: 12, borderRadius: 10,
    backgroundColor: '#d1fae5', borderWidth: 1, borderColor: '#6ee7b7',
  },
  netPreviewLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#065f46', textTransform: 'uppercase', letterSpacing: 0.8 },
  netPreviewValue: { fontSize: 28, fontFamily: 'Inter_700Bold', color: '#059669', marginTop: 2 },

  divider: { height: 1, backgroundColor: C.border, marginBottom: 20 },

  banner: {
    flexDirection: 'row', alignItems: 'flex-start',
    borderRadius: 10, padding: 12, marginBottom: 16,
    borderWidth: 1,
  },
  bannerNeutral: { backgroundColor: C.muted, borderColor: C.border },
  bannerWarning: { backgroundColor: '#fffbeb', borderColor: '#fcd34d' },
  bannerGreen:   { backgroundColor: '#d1fae5', borderColor: '#6ee7b7' },
  bannerText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.foreground, flex: 1 },
  bannerTitle: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#92400e' },
  bannerSub:   { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#b45309', marginTop: 2 },

  field: { marginBottom: 16 },
  fieldLabel: {
    fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6,
  },
  selectBtn: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
    backgroundColor: C.card, paddingHorizontal: 12, paddingVertical: 13,
  },
  selectDisabled: { opacity: 0.5 },
  selectText: { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular', color: C.foreground },
  selectPlaceholder: { color: C.mutedForeground },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
    backgroundColor: C.card, paddingHorizontal: 12,
  },
  textInput: { flex: 1, height: 48, fontSize: 15, fontFamily: 'Inter_400Regular', color: C.foreground },

  checkRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 10 },
  checkbox: {
    width: 20, height: 20, borderRadius: 5,
    borderWidth: 2, borderColor: C.border, backgroundColor: C.card,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: C.primary, borderColor: C.primary },
  checkLabel: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.foreground, flex: 1 },

  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, height: 54, backgroundColor: C.primary, borderRadius: 12,
    marginTop: 8, shadowColor: C.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  submitText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },

  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '60%', shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15, shadowRadius: 16, elevation: 12,
  },
  sheetHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  sheetTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.foreground },
  sheetList: { paddingVertical: 8 },
  sheetItem: {
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  sheetItemText: { fontSize: 15, fontFamily: 'Inter_400Regular', color: C.foreground },
});
