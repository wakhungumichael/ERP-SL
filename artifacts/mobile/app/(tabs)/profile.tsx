import React from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/context/auth';
import colors from '@/constants/colors';

const C = colors.light;

function detectRole(user: { is_superuser?: boolean; groups?: Array<{ name: string }> } | null): string {
  if (!user) return 'Guest';
  if (user.is_superuser) return 'Super Admin';
  const g = user.groups?.map((x) => x.name) ?? [];
  if (g.includes('tenant_admin')) return 'Tenant Admin';
  if (g.includes('finance')) return 'Finance';
  if (g.includes('operator')) return 'Operator';
  return 'User';
}

function roleColor(role: string): string {
  switch (role) {
    case 'Super Admin': return C.primary;
    case 'Tenant Admin': return '#7C3AED';
    case 'Finance': return '#0891B2';
    case 'Operator': return C.success;
    default: return C.mutedForeground;
  }
}

interface RowProps {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
}
function InfoRow({ icon, label, value }: RowProps) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}>
        <Feather name={icon} size={15} color={C.mutedForeground} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value || '–'}</Text>
      </View>
    </View>
  );
}

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top;
  const role = detectRole(user);
  const initial = (user?.username?.[0] ?? '?').toUpperCase();

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          await logout();
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={[styles.root, { paddingTop: topPad }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Avatar + name block */}
      <View style={styles.hero}>
        <View style={styles.avatarRing}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
        </View>
        <Text style={styles.displayName}>
          {user?.first_name && user?.last_name
            ? `${user.first_name} ${user.last_name}`
            : user?.username ?? '–'}
        </Text>
        <Text style={styles.username}>@{user?.username}</Text>
        <View style={[styles.roleBadge, { backgroundColor: roleColor(role) }]}>
          <Text style={styles.roleText}>{role}</Text>
        </View>
      </View>

      {/* Account info card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Account</Text>
        <InfoRow icon="user" label="Username" value={user?.username ?? ''} />
        <InfoRow icon="mail" label="Email" value={user?.email ?? ''} />
        <InfoRow icon="shield" label="Role" value={role} />
        {user?.groups?.length ? (
          <InfoRow
            icon="users"
            label="Groups"
            value={user.groups.map((g) => g.name).join(', ')}
          />
        ) : null}
      </View>

      {/* App info card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Application</Text>
        <InfoRow icon="box" label="Version" value="1.0.0" />
        <InfoRow icon="server" label="Platform" value="SL-ERP" />
        <InfoRow icon="globe" label="Client" value="Siakora Commercial Ltd" />
      </View>

      {/* Sign out */}
      <Pressable
        style={({ pressed }) => [styles.signOutBtn, pressed && { opacity: 0.8 }]}
        onPress={handleLogout}
      >
        <Feather name="log-out" size={18} color="#EF4444" />
        <Text style={styles.signOutText}>Sign Out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.background },

  hero: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 20,
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  avatarRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 3,
    borderColor: C.primaryLight,
    padding: 3,
    marginBottom: 14,
  },
  avatar: {
    flex: 1,
    borderRadius: 40,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 32, fontFamily: 'Inter_700Bold', color: '#fff' },
  displayName: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.foreground },
  username: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.mutedForeground, marginTop: 4 },
  roleBadge: {
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
  },
  roleText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#fff', textTransform: 'uppercase', letterSpacing: 0.5 },

  card: {
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
  },
  cardTitle: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    color: C.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 12,
  },
  infoIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: C.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.mutedForeground, textTransform: 'uppercase', letterSpacing: 0.5 },
  infoValue: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.foreground, marginTop: 1 },

  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 24,
    paddingVertical: 15,
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  signOutText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#EF4444' },
});
