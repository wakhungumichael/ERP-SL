import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/auth';
import { apiRequest, type Dashboard, type Transaction } from '@/lib/api';
import colors from '@/constants/colors';

const C = colors.light;

function greeting(name: string) {
  const h = new Date().getHours();
  const salut = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return `${salut}, ${name}`;
}

function formatWeight(kg: number | null): string {
  if (kg == null || kg === 0) return '–';
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
  return `${Math.floor(h / 24)}d ago`;
}

interface StatCardProps {
  label: string;
  value: string;
  icon: keyof typeof Feather.glyphMap;
  accent?: boolean;
}

function StatCard({ label, value, icon, accent }: StatCardProps) {
  return (
    <View style={[styles.statCard, accent && styles.statCardAccent]}>
      <View style={[styles.statIcon, accent && styles.statIconAccent]}>
        <Feather name={icon} size={18} color={accent ? C.primaryForeground : C.primary} />
      </View>
      <Text style={[styles.statValue, accent && styles.statValueAccent]}>{value}</Text>
      <Text style={[styles.statLabel, accent && styles.statLabelAccent]}>{label}</Text>
    </View>
  );
}

function TxRow({ tx }: { tx: Transaction }) {
  const isPaid = tx.payment_status === 'Paid';
  const isDone = tx.status === 'Completed';
  return (
    <View style={styles.txRow}>
      <View style={styles.txPlateWrap}>
        <Text style={styles.txPlate}>{tx.vehicle_plate}</Text>
        <View style={[styles.badge, isDone ? styles.badgeGreen : styles.badgeAmber]}>
          <Text style={[styles.badgeText, isDone ? styles.badgeTextGreen : styles.badgeTextAmber]}>
            {tx.status}
          </Text>
        </View>
      </View>
      <View style={styles.txMeta}>
        <Text style={styles.txCustomer}>{tx.customer_name}</Text>
        <Text style={styles.txItem}>{tx.item_name || '–'}</Text>
      </View>
      <View style={styles.txRight}>
        <Text style={styles.txWeight}>{formatWeight(tx.net_weight)}</Text>
        <View style={[styles.badge, isPaid ? styles.badgeGreen : styles.badgeAmber]}>
          <Text style={[styles.badgeText, isPaid ? styles.badgeTextGreen : styles.badgeTextAmber]}>
            {tx.payment_status || 'Pending'}
          </Text>
        </View>
        <Text style={styles.txTime}>{relativeTime(tx.created_at)}</Text>
      </View>
    </View>
  );
}

export default function DashboardScreen() {
  const { user, token } = useAuth();
  const insets = useSafeAreaInsets();

  const { data, isLoading, isError, refetch, isRefetching } = useQuery<Dashboard>({
    queryKey: ['dashboard'],
    queryFn: () => apiRequest('/commercial-weighbridge/dashboard/', {}, token),
    enabled: !!token,
    refetchInterval: 60_000,
  });

  const topPad = Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingTop: topPad + 16, paddingBottom: insets.bottom + 100 }}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refetch}
          tintColor={C.primary}
        />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>{greeting(user?.first_name || user?.username || 'Operator')}</Text>
          <Text style={styles.dateText}>
            {new Date().toLocaleDateString('en-KE', { weekday: 'long', month: 'long', day: 'numeric' })}
          </Text>
        </View>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(user?.username?.[0] ?? 'U').toUpperCase()}
          </Text>
        </View>
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color={C.primary} style={{ marginTop: 60 }} />
      ) : isError ? (
        <View style={styles.errorState}>
          <Feather name="wifi-off" size={32} color={C.mutedForeground} />
          <Text style={styles.errorText}>Could not load dashboard</Text>
          <Pressable style={styles.retryBtn} onPress={() => refetch()}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {/* Stat cards 2×2 */}
          <View style={styles.statsGrid}>
            <StatCard
              label="Today"
              value={String(data?.totals.transactions_today ?? 0)}
              icon="activity"
              accent
            />
            <StatCard
              label="Net Today"
              value={formatWeight(data?.totals.net_weight_today ?? null)}
              icon="layers"
            />
            <StatCard
              label="Pending Pay"
              value={String(data?.totals.pending_payments ?? 0)}
              icon="clock"
            />
            <StatCard
              label="This Month"
              value={String(data?.totals.transactions_this_month ?? 0)}
              icon="bar-chart-2"
            />
          </View>

          {/* Status breakdown */}
          <View style={styles.breakdownRow}>
            {data?.status_breakdown.map((item) => (
              <View
                key={item.status}
                style={[
                  styles.breakdownPill,
                  item.status === 'Completed' ? styles.pillGreen : styles.pillAmber,
                ]}
              >
                <Text style={[styles.pillCount, item.status === 'Completed' ? styles.pillTextGreen : styles.pillTextAmber]}>
                  {item.count}
                </Text>
                <Text style={[styles.pillLabel, item.status === 'Completed' ? styles.pillTextGreen : styles.pillTextAmber]}>
                  {item.status}
                </Text>
              </View>
            ))}
          </View>

          {/* Recent transactions */}
          <Text style={styles.sectionTitle}>Recent Activity</Text>
          {data?.recent_transactions?.length ? (
            data.recent_transactions.slice(0, 8).map((tx) => (
              <TxRow key={tx.id} tx={tx} />
            ))
          ) : (
            <View style={styles.emptyState}>
              <Feather name="inbox" size={28} color={C.mutedForeground} />
              <Text style={styles.emptyText}>No recent transactions</Text>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  greeting: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.foreground },
  dateText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },

  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    minWidth: '44%',
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    alignItems: 'flex-start',
  },
  statCardAccent: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  statIconAccent: { backgroundColor: 'rgba(255,255,255,0.2)' },
  statValue: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    color: C.foreground,
    lineHeight: 32,
  },
  statValueAccent: { color: '#fff' },
  statLabel: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: C.mutedForeground,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statLabelAccent: { color: 'rgba(255,255,255,0.8)' },

  breakdownRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 10,
    marginBottom: 24,
  },
  breakdownPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
  },
  pillGreen: { backgroundColor: C.successLight },
  pillAmber: { backgroundColor: C.warningLight },
  pillCount: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  pillLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', textTransform: 'uppercase' },
  pillTextGreen: { color: '#15803D' },
  pillTextAmber: { color: '#B45309' },

  sectionTitle: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: C.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: 20,
    marginBottom: 10,
  },

  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    gap: 10,
  },
  txPlateWrap: { alignItems: 'center', minWidth: 72 },
  txPlate: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.foreground, letterSpacing: 0.5 },
  txMeta: { flex: 1 },
  txCustomer: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  txItem: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
  txRight: { alignItems: 'flex-end', gap: 3 },
  txWeight: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.primary },
  txTime: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.mutedForeground },

  badge: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, marginTop: 3 },
  badgeGreen: { backgroundColor: C.successLight },
  badgeAmber: { backgroundColor: C.warningLight },
  badgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', textTransform: 'uppercase', letterSpacing: 0.5 },
  badgeTextGreen: { color: '#15803D' },
  badgeTextAmber: { color: '#B45309' },

  errorState: { alignItems: 'center', paddingTop: 60, gap: 12 },
  errorText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: C.primary, borderRadius: 8 },
  retryText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  emptyState: { alignItems: 'center', paddingTop: 40, gap: 8 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
});
