import { createContext, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type AppRole, detectRole } from '@/lib/roles';

export interface AuthContextValue {
  token: string | null;
  user: Record<string, unknown> | null;
  role: AppRole;
  isAuthenticated: boolean;
  isLoading: boolean;
  authErrorStatus: number | null;
  setToken: (token: string, user?: Record<string, unknown> | null) => void;
  clearToken: () => void;
  refreshUser: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>({
  token: null,
  user: null,
  role: 'guest',
  isAuthenticated: false,
  isLoading: false,
  authErrorStatus: null,
  setToken: () => {},
  clearToken: () => {},
  refreshUser: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setTokenState] = useState<string | null>(
    () => localStorage.getItem('sl-erp-token')
  );
  const [cachedUser, setCachedUser] = useState<Record<string, unknown> | null>(
    () => {
      try {
        const raw = localStorage.getItem('sl-erp-user');
        return raw ? JSON.parse(raw) as Record<string, unknown> : null;
      } catch {
        return null;
      }
    }
  );

  const { data: user, error, isLoading } = useQuery({
    queryKey: ['platform-auth-me', token ?? 'anonymous'],
    enabled: !!token,
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch('/api/platform/auth/me/', {
        headers: { Authorization: `Token ${token}` },
      });
      if (!res.ok) {
        const authError = new Error(`${res.status}`) as Error & { status?: number };
        authError.status = res.status;
        throw authError;
      }
      return res.json();
    },
  });

  const rawUser = user as Record<string, unknown> | null | undefined;
  const queriedUser = (rawUser?.data as Record<string, unknown> | undefined) ?? rawUser ?? null;
  const unwrappedUser = queriedUser ?? cachedUser;

  const role = useMemo(
    () => detectRole(unwrappedUser as Parameters<typeof detectRole>[0]),
    [unwrappedUser]
  );

  const authErrorStatus = (() => {
    if (!error || typeof error !== 'object' || !('status' in error)) return null;
    return typeof error.status === 'number' ? error.status : null;
  })();

  const refreshUser = async () => {
    await queryClient.invalidateQueries({ queryKey: ['platform-auth-me'] });
    await queryClient.refetchQueries({ queryKey: ['platform-auth-me'], type: 'active' });
    await queryClient.invalidateQueries({ queryKey: ['workspace-nav'] });
    await queryClient.refetchQueries({ queryKey: ['workspace-nav'], type: 'active' });
  };

  const resetSessionCache = () => {
    queryClient.clear();
  };

  const setToken = (t: string, userPayload?: Record<string, unknown> | null) => {
    localStorage.setItem('sl-erp-token', t);
    if (userPayload) {
      localStorage.setItem('sl-erp-user', JSON.stringify(userPayload));
      setCachedUser(userPayload);
    }
    resetSessionCache();
    setTokenState(t);
  };

  const clearToken = () => {
    localStorage.removeItem('sl-erp-token');
    localStorage.removeItem('sl-erp-user');
    setCachedUser(null);
    resetSessionCache();
    setTokenState(null);
  };

  useEffect(() => {
    if (!token || isLoading || (unwrappedUser && Object.keys(unwrappedUser).length > 0)) return;
    if (authErrorStatus === 401 || authErrorStatus === 403) {
      clearToken();
    }
  }, [authErrorStatus, isLoading, token, unwrappedUser]);

  useEffect(() => {
    if (!queriedUser) return;
    localStorage.setItem('sl-erp-user', JSON.stringify(queriedUser));
    setCachedUser(queriedUser);
  }, [queriedUser]);

  return (
    <AuthContext.Provider
      value={{
        token,
        user: unwrappedUser,
        role,
        isAuthenticated: !!token,
        isLoading,
        authErrorStatus,
        setToken,
        clearToken,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
