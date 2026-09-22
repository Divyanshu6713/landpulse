import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchProfile, getToken, login as apiLogin, loginWithPosition, logout as apiLogout, onUnauthorized, setToken, suppressUnauthorizedOnce } from '@/api/client';
import type { Profile, RoleId, User } from '@/data/types';
import { markSessionExpired } from './demoSession';

interface AuthState {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (userId: string, password: string) => Promise<void>;
  signInWithPosition: (role: RoleId, position: { orgId: string; units: Record<string, string | undefined> }, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => void;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Session state. The profile comes from the API, so role, scope and
 * permissions shown in the UI are exactly the ones the server enforces.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(Boolean(getToken()));
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!getToken()) {
      setProfile(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    fetchProfile(controller.signal)
      .then(setProfile)
      .catch((err: Error) => {
        if (err.name === 'AbortError') return;
        setToken(null);
        setProfile(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [nonce]);

  useEffect(() => {
    const off = onUnauthorized(() => {
      if (getToken()) markSessionExpired();
      setToken(null);
      setProfile(null);
    });
    return () => {
      off();
    };
  }, []);

  const signIn = useCallback(async (userId: string, password: string) => {
    const { token, downloadToken } = await suppressUnauthorizedOnce(() => apiLogin(userId, password));
    setToken(token, downloadToken);
    setNonce((n) => n + 1);
  }, []);

  const signInWithPosition = useCallback(async (role: RoleId, position: { orgId: string; units: Record<string, string | undefined> }, password: string) => {
    const { token, downloadToken } = await suppressUnauthorizedOnce(() => loginWithPosition(role, position, password));
    setToken(token, downloadToken);
    setNonce((n) => n + 1);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await apiLogout();
    } finally {
      setToken(null);
      setProfile(null);
    }
  }, []);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const value = useMemo<AuthState>(
    () => ({
      user: profile?.user ?? null,
      profile,
      loading,
      signIn,
      signInWithPosition,
      signOut,
      refresh,
      can: (permission: string) => Boolean(profile?.user.permissions.includes(permission)),
    }),
    [profile, loading, signIn, signInWithPosition, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
