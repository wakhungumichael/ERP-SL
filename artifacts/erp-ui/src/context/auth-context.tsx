import { createContext, useMemo, useState } from 'react';
import { useAuthMe, getAuthMeQueryKey } from '@workspace/api-client-react';
import { type AppRole, detectRole } from '@/lib/roles';

export interface AuthContextValue {
  token: string | null;
  user: Record<string, unknown> | null;
  role: AppRole;
  isAuthenticated: boolean;
  isLoading: boolean;
  setToken: (token: string) => void;
  clearToken: () => void;
}

export const AuthContext = createContext<AuthContextValue>({
  token: null,
  user: null,
  role: 'guest',
  isAuthenticated: false,
  isLoading: false,
  setToken: () => {},
  clearToken: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(
    () => localStorage.getItem('sl-erp-token')
  );

  const { data: user, isLoading } = useAuthMe({
    query: {
      enabled: !!token,
      queryKey: getAuthMeQueryKey(),
      retry: false,
      staleTime: 5 * 60 * 1000,
    },
  });

  // Platform API wraps responses in {success, data: {...}} — unwrap the user
  const rawUser = user as Record<string, unknown> | null | undefined;
  const unwrappedUser = (rawUser?.data as Record<string, unknown> | undefined) ?? rawUser ?? null;

  const role = useMemo(
    () => detectRole(unwrappedUser as Parameters<typeof detectRole>[0]),
    [unwrappedUser]
  );

  const setToken = (t: string) => {
    localStorage.setItem('sl-erp-token', t);
    setTokenState(t);
  };

  const clearToken = () => {
    localStorage.removeItem('sl-erp-token');
    setTokenState(null);
  };

  return (
    <AuthContext.Provider
      value={{
        token,
        user: unwrappedUser,
        role,
        isAuthenticated: !!token,
        isLoading,
        setToken,
        clearToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
