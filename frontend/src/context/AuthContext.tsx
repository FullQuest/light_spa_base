import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import * as api from '../api/client';
import type { UserPublic } from '../types/auth';

interface AuthContextValue {
  user: UserPublic | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    fullName: string,
    password: string,
  ) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!api.getToken()) {
      setLoading(false);
      return;
    }
    api
      .getMe()
      .then(setUser)
      .catch(() => api.clearToken())
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const token = await api.login(email, password);
    api.setToken(token.access_token);
    const me = await api.getMe();
    setUser(me);
  }, []);

  const register = useCallback(
    async (email: string, fullName: string, password: string) => {
      await api.register(email, fullName, password);
      const token = await api.login(email, password);
      api.setToken(token.access_token);
      const me = await api.getMe();
      setUser(me);
    },
    [],
  );

  const logout = useCallback(() => {
    api.clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}