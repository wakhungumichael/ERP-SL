import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/auth';
import { apiRequest, type PaginatedTransactions, type Transaction } from '@/lib/api';
import colors from '@/constants/colors';

const C = colors.light;

const FILTERS = [
  { label: 'All', value: '' },
  { label: 'Pending', value: 'Pending' },
  { label: 'Completed', value: 'Completed' },
] as const;

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

function TxCard({ tx }: { tx: Transaction }) {
  const isDone = tx.status === 'Completed';
  const isPaid = tx.payment_status === 'Paid';
  const isPending = tx.payment_status === 'Pending';

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
      </View>
    </View>
  );
}

export default function TransactionsScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<'' | 'Pending' | 'Completed'>('');
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
          renderItem={({ item }) => <TxCard tx={item} />}
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
  },
  weightBlock: { alignItems: 'center' },
  weightLabel: { fontSize: 9, fontFamily: 'Inter_500Medium', color: C.mutedForeground, textTransform: 'uppercase' },
  weightVal: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.foreground },
  netWeight: { color: C.primary },
  charge: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.foreground },

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
});
