import { createContext, useContext } from 'react';
import type { RegisterResult, SessionUser } from '@/lib/api';

export interface AuthState {
  user: SessionUser | null;
  isAdmin: boolean;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  /** Returns the registration result so the caller can surface the mock link. */
  register: (input: { email: string; password: string; name?: string }) => Promise<RegisterResult>;
  logout: (allDevices?: boolean) => Promise<void>;
  /** Re-reads the profile, e.g. after the email has been verified elsewhere. */
  refreshProfile: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
