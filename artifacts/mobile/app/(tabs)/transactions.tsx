import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/auth';
import {
  apiRequest,
  receivePayment,
  type PaginatedTransactions,
  type Transaction,
} from '@/lib/api';
import colors from '@/constants/colors';

const C = colors.light;

const FILTERS = [
  { label: 'All', value: '' },
  { label: 'Pending', value: 'Pending' },
  { label: 'Completed', value: 'Completed' },
] as const;

const PAYMENT_METHODS = ['Cash', 'Mpesa', 'Bank Transfer', 'Cheque'] as const;

function formatWeight(kg: number | null): string {
  if (!kg) return '–';
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)}t`;
  return `${kg.toLocaleString()} kg`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// ── Pay Bottom Sheet ──────────────────────────────────────────────────────────

interface PaySheetProps {
  tx: Transaction | null;
  visible: boolean;
  onClose: () => void;
  onSuccess: (updated: Transaction) => void;
  token: string | null | undefined;
}

function PayBottomSheet({ tx, visible, onClose, onSuccess, token }: PaySheetProps) {
  const insets = useSafeAreaInsets();
  const [method, setMethod] = useState<string>('Cash');
  const [reference, setReference] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const slideAnim = useRef(new Animated.Value(400)).current;

  React.useEffect(() => {
    if (visible) {
      setMethod('Cash');
      setReference('');
      setError(null);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 4,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: 400,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  const handleConfirm = async () => {
    if (!tx) return;
    setLoading(true);
    setError(null);
    try {
      const res = await receivePayment(tx.id, method, reference, token);
      onSuccess(res.transaction);
    } catch (e: any) {
      setError(e?.message || 'Payment failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!tx) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.overlay} />
        </TouchableWithoutFeedback>

        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: insets.bottom + 16, transform: [{ translateY: slideAnim }] },
          ]}
        >
          {/* Handle */}
          <View style={styles.sheetHandle} />

          {/* Header */}
          <View style={styles.sheetHeader}>
            <View>
              <Text style={styles.sheetTitle}>Receive Payment</Text>
              <Text style={styles.sheetSub}>
                {tx.vehicle_plate} · {tx.customer_name}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12}>
              <Feather name="x" size={20} color={C.mutedForeground} />
            </Pressable>
          </View>

          {/* Charge summary */}
          <View style={styles.chargeRow}>
            <Text style={styles.chargeLabel}>Amount Due</Text>
            <Text style={styles.chargeAmount}>
              KES {parseFloat(tx.charge || '0').toLocaleString()}
            </Text>
          </View>

          {/* Method selector */}
          <Text style={styles.fieldLabel}>Payment Method</Text>
          <View style={styles.methodRow}>
            {PAYMENT_METHODS.map((m) => (
              <Pressable
                key={m}
                style={[styles.methodChip, method === m && styles.methodChipActive]}
                onPress={() => setMethod(m)}
              >
                <Text style={[styles.methodText, method === m && styles.methodTextActive]}>
                  {m}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Reference field */}
          <Text style={styles.fieldLabel}>Reference / Receipt No. <Text style={styles.optional}>(optional)</Text></Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Mpesa code, cheque no."
            placeholderTextColor={C.mutedForeground}
            value={reference}
            onChangeText={setReference}
            returnKeyType="done"
            autoCapitalize="characters"
          />

          {/* Error */}
          {error ? (
            <View style={styles.errorBox}>
              <Feather name="alert-circle" size={14} color="#B91C1C" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Confirm button */}
          <Pressable
            style={[styles.confirmBtn, loading && { opacity: 0.6 }]}
            onPress={handleConfirm}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.confirmBtnText}>Confirm Payment</Text>
            )}
          </Pressable>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Transaction Card ──────────────────────────────────────────────────────────

interface TxCardProps {
  tx: Transaction;
  onPay: (tx: Transaction) => void;
}

function TxCard({ tx, onPay }: TxCardProps) {
  const isDone = tx.status === 'Completed';
  const isPaid = tx.payment_status === 'Paid';
  const isPending = tx.payment_status === 'Pending';
  const canPay = isDone && !isPaid;

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.plateRow}>
          <Text style={styles.plate}>{tx.vehicle_plate}</Text>
          <View style={[styles.badge, isDone ? styles.badgeGreen : styles.badgeAmber]}>
            <Text style={[styles.badgeText, isDone ? styles.badgeTextGreen : styles.badgeTextAmber]}>
              {tx.status}
            </Text>
          </View>
        </View>
        <Text style={styles.time}>{relativeTime(tx.created_at)}</Text>
      </View>

      <View style={styles.cardBody}>
        <View style={styles.infoCol}>
          <Text style={styles.infoLabel}>Customer</Text>
          <Text style={styles.infoValue}>{tx.customer_name}</Text>
        </View>
        <View style={styles.infoCol}>
          <Text style={styles.infoLabel}>Item</Text>
          <Text style={styles.infoValue}>{tx.item_name || '–'}</Text>
        </View>
        <View style={styles.infoCol}>
          <Text style={styles.infoLabel}>Branch</Text>
          <Text style={styles.infoValue}>{tx.branch_name}</Text>
        </View>
      </View>

      <View style={styles.cardFooter}>
        <View style={styles.weightBlock}>
          <Text style={styles.weightLabel}>Gross</Text>
          <Text style={styles.weightVal}>{formatWeight(tx.gross_weight)}</Text>
        </View>
        <Feather name="minus" size={12} color={C.mutedForeground} />
        <View style={styles.weightBlock}>
          <Text style={styles.weightLabel}>Tare</Text>
          <Text style={styles.weightVal}>{formatWeight(tx.tare_weight)}</Text>
        </View>
        <Feather name="equals" size={12} color={C.primary} />
        <View style={styles.weightBlock}>
          <Text style={styles.weightLabel}>Net</Text>
          <Text style={[styles.weightVal, styles.netWeight]}>{formatWeight(tx.net_weight)}</Text>
        </View>

        <View style={{ flex: 1 }} />

        {tx.payment_status ? (
          <View style={[
            styles.badge,
            isPaid ? styles.badgeGreen : isPending ? styles.badgeAmber : styles.badgeGrey,
          ]}>
            <Text style={[
              styles.badgeText,
              isPaid ? styles.badgeTextGreen : isPending ? styles.badgeTextAmber : styles.badgeTextGrey,
            ]}>
              {tx.payment_status}
            </Text>
          </View>
        ) : null}

        <Text style={styles.charge}>KES {parseFloat(tx.charge || '0').toLocaleString()}</Text>

        {canPay && (
          <Pressable style={styles.payBtn} onPress={() => onPay(tx)}>
            <Feather name="credit-card" size={12} color="#fff" />
            <Text style={styles.payBtnText}>Pay</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function TransactionsScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'' | 'Pending' | 'Completed'>('');
  const [payTx, setPayTx] = useState<Transaction | null>(null);
  const topPad = Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top;

  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<PaginatedTransactions>({
    queryKey: ['transactions', filter],
    queryFn: ({ pageParam = 1 }) =>
      apiRequest(
        `/commercial-weighbridge/transactions/?page=${pageParam}&page_size=20${filter ? `&status=${filter}` : ''}`,
        {},
        token,
      ),
    getNextPageParam: (last, pages) => (last.next ? pages.length + 1 : undefined),
    initialPageParam: 1,
    enabled: !!token,
  });

  const transactions: Transaction[] = data?.pages.flatMap((p) => p.results) ?? [];
  const total = data?.pages[0]?.count ?? 0;

  const handlePaySuccess = (updated: Transaction) => {
    setPayTx(null);
    // Invalidate to refetch fresh data
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      {/* Filter tabs */}
      <View style={styles.filterBar}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.value}
            style={[styles.filterTab, filter === f.value && styles.filterTabActive]}
            onPress={() => setFilter(f.value)}
          >
            <Text style={[styles.filterText, filter === f.value && styles.filterTextActive]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
        <Text style={styles.totalText}>{total} records</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color={C.primary} style={{ marginTop: 60 }} />
      ) : isError ? (
        <View style={styles.errState}>
          <Feather name="wifi-off" size={32} color={C.mutedForeground} />
          <Text style={styles.errText}>Could not load transactions</Text>
          <Pressable style={styles.retryBtn} onPress={() => refetch()}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={transactions}
          keyExtractor={(t) => String(t.id)}
          renderItem={({ item }) => <TxCard tx={item} onPay={setPayTx} />}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: insets.bottom + 100,
            flexGrow: 1,
          }}
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={refetch} tintColor={C.primary} />
          }
          onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Feather name="inbox" size={36} color={C.mutedForeground} />
              <Text style={styles.emptyText}>No transactions found</Text>
            </View>
          }
          ListFooterComponent={
            isFetchingNextPage
              ? <ActivityIndicator color={C.primary} style={{ marginVertical: 16 }} />
              : null
          }
          scrollEnabled
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Pay bottom sheet */}
      <PayBottomSheet
        tx={payTx}
        visible={!!payTx}
        onClose={() => setPayTx(null)}
        onSuccess={handlePaySuccess}
        token={token}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.background },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.card,
  },
  filterTab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: C.muted,
  },
  filterTabActive: { backgroundColor: C.primary },
  filterText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground },
  filterTextActive: { color: '#fff' },
  totalText: { marginLeft: 'auto', fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground },

  card: {
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 10,
    overflow: 'hidden',
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  plateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  plate: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.foreground, letterSpacing: 0.5 },
  time: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },

  cardBody: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  infoCol: { flex: 1 },
  infoLabel: { fontSize: 10, fontFamily: 'Inter_500Medium', color: C.mutedForeground, textTransform: 'uppercase', letterSpacing: 0.5 },
  infoValue: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.foreground, marginTop: 2 },

  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
    flexWrap: 'nowrap',
  },
  weightBlock: { alignItems: 'center' },
  weightLabel: { fontSize: 9, fontFamily: 'Inter_500Medium', color: C.mutedForeground, textTransform: 'uppercase' },
  weightVal: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.foreground },
  netWeight: { color: C.primary },
  charge: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.foreground },

  payBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.primary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  payBtnText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff' },

  badge: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4 },
  badgeGreen: { backgroundColor: C.successLight },
  badgeAmber: { backgroundColor: C.warningLight },
  badgeGrey: { backgroundColor: C.muted },
  badgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', textTransform: 'uppercase', letterSpacing: 0.3 },
  badgeTextGreen: { color: '#15803D' },
  badgeTextAmber: { color: '#B45309' },
  badgeTextGrey: { color: C.mutedForeground },

  errState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: C.primary, borderRadius: 8 },
  retryBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 12 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground },

  // Bottom sheet
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: C.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 20,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  sheetTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.foreground },
  sheetSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },

  chargeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: C.muted,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 20,
  },
  chargeLabel: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.mutedForeground },
  chargeAmount: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.primary },

  fieldLabel: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: C.foreground,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  optional: { fontFamily: 'Inter_400Regular', color: C.mutedForeground, textTransform: 'none', letterSpacing: 0 },
  methodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  methodChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: C.background,
  },
  methodChipActive: {
    borderColor: C.primary,
    backgroundColor: `${C.primary}15`,
  },
  methodText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground },
  methodTextActive: { color: C.primary },

  input: {
    backgroundColor: C.background,
    borderWidth: 1.5,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.foreground,
    marginBottom: 16,
  },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#B91C1C', flex: 1 },

  confirmBtn: {
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
});
