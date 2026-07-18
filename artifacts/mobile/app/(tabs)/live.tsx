import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/auth';
import { apiRequest, type LiveWeight } from '@/lib/api';
import colors from '@/constants/colors';

const C = colors.light;

function formatWeight(w: number | null, unit: string): string {
  if (w == null) return '– – –';
  if (w >= 1000) return `${(w / 1000).toFixed(2)} t`;
  return `${w.toLocaleString()} kg`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function LiveWeightScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top;

  const [data, setData] = useState<LiveWeight | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [polling, setPolling] = useState(true);

  const fetchWeight = async () => {
    if (!token) return;
    try {
      const result = await apiRequest<LiveWeight>('/commercial-weighbridge/live-weight/', {}, token);
      setData(result);
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Connection error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWeight();
  }, [token]);

  useEffect(() => {
    if (!polling) return;
    const id = setInterval(fetchWeight, 2000);
    return () => clearInterval(id);
  }, [polling, token]);

  const isConnected = data?.source !== 'stub' && data?.source != null;
  const isStable = data?.stable ?? false;

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Live Weight</Text>
        <View style={styles.headerRight}>
          <View style={[styles.statusDot, polling ? styles.dotPulsing : styles.dotOff]} />
          <Text style={styles.statusText}>{polling ? 'Live' : 'Paused'}</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={styles.loadingText}>Connecting to indicator…</Text>
        </View>
      ) : (
        <View style={styles.content}>
          {/* Main weight display */}
          <View style={styles.displayCard}>
            {error ? (
              <View style={styles.errorInCard}>
                <Feather name="wifi-off" size={24} color="#EF4444" />
                <Text style={styles.errorMsg}>{error}</Text>
              </View>
            ) : (
              <>
                <Text style={styles.weightDisplay}>
                  {formatWeight(data?.weight ?? null, data?.unit ?? 'kg')}
                </Text>
                <View style={styles.unitRow}>
                  <Text style={styles.unitText}>{data?.weight != null && data.weight >= 1000 ? 'tonnes' : 'kilograms'}</Text>
                </View>
              </>
            )}
          </View>

          {/* Status indicators */}
          <View style={styles.indicatorRow}>
            <View style={[styles.indicator, isStable ? styles.indicatorGreen : styles.indicatorAmber]}>
              <Feather
                name={isStable ? 'check-circle' : 'alert-circle'}
                size={16}
                color={isStable ? '#15803D' : '#B45309'}
              />
              <Text style={[styles.indicatorText, isStable ? styles.indicatorTextGreen : styles.indicatorTextAmber]}>
                {isStable ? 'STABLE' : 'UNSTABLE'}
              </Text>
            </View>

            <View style={[styles.indicator, isConnected ? styles.indicatorGreen : styles.indicatorGrey]}>
              <Feather
                name={isConnected ? 'radio' : 'slash'}
                size={16}
                color={isConnected ? '#15803D' : C.mutedForeground}
              />
              <Text style={[styles.indicatorText, isConnected ? styles.indicatorTextGreen : { color: C.mutedForeground }]}>
                {data?.source?.toUpperCase() ?? 'NO INDICATOR'}
              </Text>
            </View>
          </View>

          {/* Timestamp */}
          {data?.timestamp && (
            <Text style={styles.timestamp}>
              Last read: {formatTime(data.timestamp)}
            </Text>
          )}

          {/* Stub notice */}
          {data?.source === 'stub' && (
            <View style={styles.stubNotice}>
              <Feather name="info" size={14} color={C.mutedForeground} />
              <Text style={styles.stubText}>
                No physical indicator connected. A serial indicator (RS-232/RS-485) 
                must be configured in the admin panel.
              </Text>
            </View>
          )}

          {/* Controls */}
          <View style={styles.controls}>
            <Pressable
              style={({ pressed }) => [styles.controlBtn, pressed && { opacity: 0.7 }]}
              onPress={() => { setPolling(!polling); }}
            >
              <Feather name={polling ? 'pause' : 'play'} size={18} color={C.primary} />
              <Text style={styles.controlText}>{polling ? 'Pause' : 'Resume'}</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.controlBtn, pressed && { opacity: 0.7 }]}
              onPress={() => { setLoading(true); fetchWeight(); }}
            >
              <Feather name="refresh-cw" size={18} color={C.primary} />
              <Text style={styles.controlText}>Refresh</Text>
            </Pressable>
          </View>

          {/* Info card */}
          <View style={styles.infoCard}>
            <Text style={styles.infoCardTitle}>About Live Weight</Text>
            <Text style={styles.infoCardBody}>
              This screen polls the weighbridge indicator every 2 seconds. 
              The indicator must be connected to the server via a serial port (COM/USB-RS232 adapter).
              Contact your system administrator to configure the indicator settings.
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.card,
  },
  headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.foreground },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  dotPulsing: { backgroundColor: C.success },
  dotOff: { backgroundColor: C.mutedForeground },
  statusText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.mutedForeground },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground },

  content: { flex: 1, paddingHorizontal: 20, paddingTop: 24 },

  displayCard: {
    backgroundColor: C.sidebar,
    borderRadius: 20,
    paddingVertical: 48,
    paddingHorizontal: 32,
    alignItems: 'center',
    marginBottom: 20,
  },
  weightDisplay: {
    fontSize: 56,
    fontFamily: 'Inter_700Bold',
    color: C.primary,
    textAlign: 'center',
    letterSpacing: 2,
  },
  unitRow: { marginTop: 8 },
  unitText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground, textTransform: 'uppercase', letterSpacing: 2 },
  errorInCard: { alignItems: 'center', gap: 12 },
  errorMsg: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#EF4444', textAlign: 'center' },

  indicatorRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  indicator: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 10 },
  indicatorGreen: { backgroundColor: C.successLight },
  indicatorAmber: { backgroundColor: C.warningLight },
  indicatorGrey: { backgroundColor: C.muted },
  indicatorText: { fontSize: 12, fontFamily: 'Inter_700Bold', textTransform: 'uppercase', letterSpacing: 0.5 },
  indicatorTextGreen: { color: '#15803D' },
  indicatorTextAmber: { color: '#B45309' },

  timestamp: { textAlign: 'center', fontSize: 12, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginBottom: 20 },

  stubNotice: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: C.muted,
    borderRadius: 10,
    padding: 14,
    marginBottom: 20,
    alignItems: 'flex-start',
  },
  stubText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground, lineHeight: 18 },

  controls: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  controlBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.primary,
    backgroundColor: C.primaryLight,
  },
  controlText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },

  infoCard: {
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
  },
  infoCardTitle: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.foreground, marginBottom: 6 },
  infoCardBody: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.mutedForeground, lineHeight: 20 },
});
