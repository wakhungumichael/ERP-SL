/**
 * CRM mobile screens — Companies, People, Suppliers, Opportunities, Follow-ups.
 * Accessible from the main menu / drawer on mobile.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  RefreshControl,
  Alert,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/auth';
import { apiRequest } from '@/lib/api';
import colors from '@/constants/colors';

const C = colors.light;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Organisation {
  id: number; name: string; type: string; industry: string;
  email: string; phone: string; contact_count: number; open_leads: number;
}

interface Contact {
  id: number; full_name: string; job_title: string;
  email: string; phone: string; organisation_name: string;
}

interface Supplier {
  id: number; name: string; contact_person: string;
  email: string; phone: string; payment_terms_display: string;
}

interface Lead {
  id: number; title: string; organisation_name: string;
  stage: string; stage_display: string; value: string; currency: string;
  expected_close_date: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STAGE_COLORS: Record<string, string> = {
  new:         '#94a3b8',
  contacted:   '#3b82f6',
  proposal:    '#a855f7',
  negotiation: '#f97316',
  won:         '#10b981',
  lost:        '#ef4444',
};

type CRMTab = 'companies' | 'people' | 'suppliers' | 'opportunities';

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function CRMScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<CRMTab>('companies');
  const [search, setSearch] = useState('');

  const TABS: { key: CRMTab; label: string; icon: keyof typeof Feather.glyphMap }[] = [
    { key: 'companies',    label: 'Companies',     icon: 'briefcase' },
    { key: 'people',       label: 'People',        icon: 'users' },
    { key: 'suppliers',    label: 'Suppliers',     icon: 'truck' },
    { key: 'opportunities',label: 'Deals',         icon: 'trending-up' },
  ];

  const { data: companiesData, isLoading: cLoading, refetch: refetchC } = useQuery({
    queryKey: ['crm-companies-mobile', search],
    queryFn: () => apiRequest<any>(`/crm/companies/?search=${encodeURIComponent(search)}`, {}, token),
    enabled: !!token && tab === 'companies',
  });

  const { data: peopleData, isLoading: pLoading, refetch: refetchP } = useQuery({
    queryKey: ['crm-people-mobile', search],
    queryFn: () => apiRequest<any>(`/crm/people/?search=${encodeURIComponent(search)}`, {}, token),
    enabled: !!token && tab === 'people',
  });

  const { data: suppliersData, isLoading: sLoading, refetch: refetchS } = useQuery({
    queryKey: ['crm-suppliers-mobile', search],
    queryFn: () => apiRequest<any>(`/crm/suppliers/?search=${encodeURIComponent(search)}`, {}, token),
    enabled: !!token && tab === 'suppliers',
  });

  const { data: oppsData, isLoading: oLoading, refetch: refetchO } = useQuery({
    queryKey: ['crm-opps-mobile', search],
    queryFn: () => apiRequest<any>(`/crm/opportunities/?search=${encodeURIComponent(search)}`, {}, token),
    enabled: !!token && tab === 'opportunities',
  });

  const companies:     Organisation[] = Array.isArray(companiesData) ? companiesData : companiesData?.results ?? [];
  const people:        Contact[]      = Array.isArray(peopleData)    ? peopleData    : peopleData?.results ?? [];
  const suppliers:     Supplier[]     = Array.isArray(suppliersData) ? suppliersData : suppliersData?.results ?? [];
  const opportunities: Lead[]         = Array.isArray(oppsData)      ? oppsData      : oppsData?.results ?? [];

  const isLoading = cLoading || pLoading || sLoading || oLoading;
  const refetch = tab === 'companies' ? refetchC : tab === 'people' ? refetchP : tab === 'suppliers' ? refetchS : refetchO;

  const renderCompany = ({ item }: { item: Organisation }) => (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{item.name[0]}</Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>{item.name}</Text>
          <Text style={styles.cardSub}>{item.industry || item.type}</Text>
        </View>
        <View style={styles.cardMeta}>
          {item.open_leads > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{item.open_leads} deal{item.open_leads > 1 ? 's' : ''}</Text>
            </View>
          )}
          <Text style={styles.cardCount}>{item.contact_count} people</Text>
        </View>
      </View>
      {item.email ? (
        <Text style={styles.cardDetail}><Feather name="mail" size={11} color={C.mutedForeground} /> {item.email}</Text>
      ) : null}
    </View>
  );

  const renderPerson = ({ item }: { item: Contact }) => (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <View style={[styles.avatar, { backgroundColor: '#e0e7ff' }]}>
          <Text style={[styles.avatarText, { color: '#4338ca' }]}>
            {item.full_name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
          </Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>{item.full_name}</Text>
          <Text style={styles.cardSub}>{item.job_title || 'No title'}</Text>
          {item.organisation_name ? <Text style={styles.cardOrg}>@ {item.organisation_name}</Text> : null}
        </View>
      </View>
      <View style={styles.contactRow}>
        {item.email ? <Text style={styles.cardDetail}><Feather name="mail" size={11} color={C.mutedForeground} /> {item.email}</Text> : null}
        {item.phone ? <Text style={styles.cardDetail}><Feather name="phone" size={11} color={C.mutedForeground} /> {item.phone}</Text> : null}
      </View>
    </View>
  );

  const renderSupplier = ({ item }: { item: Supplier }) => (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <View style={[styles.avatar, { backgroundColor: '#fef3c7' }]}>
          <Text style={[styles.avatarText, { color: '#92400e' }]}>{item.name[0]}</Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>{item.name}</Text>
          {item.contact_person ? <Text style={styles.cardSub}>{item.contact_person}</Text> : null}
        </View>
        <View style={styles.termsBadge}>
          <Text style={styles.termsText}>{item.payment_terms_display}</Text>
        </View>
      </View>
      <View style={styles.contactRow}>
        {item.email ? <Text style={styles.cardDetail}><Feather name="mail" size={11} color={C.mutedForeground} /> {item.email}</Text> : null}
        {item.phone ? <Text style={styles.cardDetail}><Feather name="phone" size={11} color={C.mutedForeground} /> {item.phone}</Text> : null}
      </View>
    </View>
  );

  const renderOpp = ({ item }: { item: Lead }) => (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <View style={[styles.stageDot, { backgroundColor: STAGE_COLORS[item.stage] ?? '#94a3b8' }]} />
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          {item.organisation_name ? <Text style={styles.cardSub}>@ {item.organisation_name}</Text> : null}
        </View>
        <View style={styles.cardMeta}>
          <Text style={[styles.stageLabel, { color: STAGE_COLORS[item.stage] ?? '#94a3b8' }]}>{item.stage_display}</Text>
          {item.value ? (
            <Text style={styles.cardCount}>{item.currency} {parseFloat(item.value).toLocaleString()}</Text>
          ) : null}
        </View>
      </View>
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <Text style={styles.title}>Relationships</Text>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {TABS.map(t => (
          <Pressable
            key={t.key}
            style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]}
            onPress={() => { setTab(t.key); setSearch(''); }}
          >
            <Feather name={t.icon} size={14} color={tab === t.key ? C.primary : C.mutedForeground} />
            <Text style={[styles.tabLabel, tab === t.key && styles.tabLabelActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* Search */}
      <View style={styles.searchBar}>
        <Feather name="search" size={16} color={C.mutedForeground} />
        <TextInput
          style={styles.searchInput}
          placeholder={`Search ${tab}…`}
          placeholderTextColor={C.mutedForeground}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
        {search ? (
          <Pressable onPress={() => setSearch('')}>
            <Feather name="x" size={16} color={C.mutedForeground} />
          </Pressable>
        ) : null}
      </View>

      {/* List */}
      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={C.primary} />
      ) : (
        <FlatList
          data={
            tab === 'companies' ? companies :
            tab === 'people' ? people :
            tab === 'suppliers' ? suppliers :
            opportunities
          }
          keyExtractor={item => String((item as any).id)}
          renderItem={
            tab === 'companies'     ? renderCompany :
            tab === 'people'        ? renderPerson :
            tab === 'suppliers'     ? renderSupplier :
            renderOpp
          }
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100 }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={C.primary} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No {tab} found.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.background },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.foreground, paddingHorizontal: 16, marginBottom: 12 },

  tabBar: { flexDirection: 'row', paddingHorizontal: 12, marginBottom: 12, gap: 4 },
  tabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: 8, borderRadius: 8, backgroundColor: C.muted,
  },
  tabBtnActive: { backgroundColor: `${C.primary}18` },
  tabLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground },
  tabLabelActive: { color: C.primary },

  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.foreground },

  card: {
    backgroundColor: C.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  avatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: `${C.primary}20`,
    alignItems: 'center', justifyContent: 'center', shrink: 0,
  } as any,
  avatarText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.primary },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.foreground },
  cardSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 2 },
  cardOrg: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.primary, marginTop: 2 },
  cardMeta: { alignItems: 'flex-end', gap: 4 },
  cardCount: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
  cardDetail: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 6 },
  contactRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap', marginTop: 4 },

  badge: {
    backgroundColor: `${C.primary}15`, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  badgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: C.primary },

  termsBadge: {
    backgroundColor: '#fef3c7', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3,
  },
  termsText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: '#92400e' },

  stageDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5, flexShrink: 0 } as any,
  stageLabel: { fontSize: 11, fontFamily: 'Inter_700Bold' },

  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground },
});
