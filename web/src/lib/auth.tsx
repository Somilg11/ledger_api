import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getSession, setSession, onUnauthenticated, type SessionUser } from '@/lib/api';

interface AuthState {
  user: SessionUser | null;
  isAdmin: boolean;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { email: string; password: string; name?: string }) => Promise<void>;
  logout: (allDevices?: boolean) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(() => getSession()?.user ?? null);
  const [ready, setReady] = useState(false);

  // A stored session is only trusted once the server confirms the token is
  // still valid - it may have been revoked by a logout elsewhere.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!getSession()) {
        setReady(true);
        return;
      }
      try {
        const profile = await api.auth.me();
        if (!cancelled) setUser({ ...profile, id: profile.id ?? (profile as { _id?: string })._id ?? '' });
      } catch {
        if (!cancelled) {
          setSession(null);
          setUser(null);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    onUnauthenticated(() => setUser(null));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.auth.login({ email, password });
    setSession({ accessToken: result.accessToken, refreshToken: result.refreshToken, user: result.user });
    setUser(result.user);
  }, []);

  const register = useCallback(
    async (input: { email: string; password: string; name?: string }) => {
      await api.auth.register(input);
      await login(input.email, input.password);
    },
    [login]
  );

  const logout = useCallback(async (allDevices = false) => {
    const current = getSession();
    try {
      if (current) await api.auth.logout(current.refreshToken, allDevices);
    } catch {
      // A failed revoke must not trap the user in a logged-in shell.
    } finally {
      setSession(null);
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, isAdmin: Boolean(user?.roles?.includes('ADMIN')), ready, login, register, logout }),
    [user, ready, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
