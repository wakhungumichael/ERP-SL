import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { apiRequest, type User } from '@/lib/api';

const TOKEN_KEY = 'sl-erp-token';

interface AuthContextType {
  token: string | null;
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Rehydrate stored session
    AsyncStorage.getItem(TOKEN_KEY).then(async (stored) => {
      if (stored) {
        try {
          const me = await apiRequest<User>('/platform/auth/me/', {}, stored);
          setToken(stored);
          setUser(me);
        } catch {
          await AsyncStorage.removeItem(TOKEN_KEY);
        }
      }
      setLoading(false);
    });
  }, []);

  const login = async (username: string, password: string) => {
    const result = await apiRequest<{ token: string }>(
      '/platform/auth/token/',
      { method: 'POST', body: JSON.stringify({ username, password }) },
    );
    const tk = result.token;
    await AsyncStorage.setItem(TOKEN_KEY, tk);
    const me = await apiRequest<User>('/platform/auth/me/', {}, tk);
    setToken(tk);
    setUser(me);
  };

  const logout = async () => {
    try {
      if (token) {
        await apiRequest('/platform/auth/logout/', { method: 'POST' }, token);
      }
    } catch {}
    await AsyncStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ token, user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

const SAFE_DEFAULT: AuthContextType = {
  token: null,
  user: null,
  loading: true,
  login: async () => {},
  logout: async () => {},
};

export function useAuth(): AuthContextType {
  return useContext(AuthContext) ?? SAFE_DEFAULT;
}
