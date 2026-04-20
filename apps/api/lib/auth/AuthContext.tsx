'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

// ---- Types -----------------------------------------------------------------

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'agent' | 'user';
}

interface AuthContextValue {
  user: AuthUser | null;
  accessToken: string | null;
  loading: boolean;
  login:    (email: string, password: string) => Promise<void>;
  loginWithQr: (token: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout:   () => void;
}

// ---- Context ---------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

// ---- Helpers ---------------------------------------------------------------

const TOKEN_KEY   = 'dialer_access_token';
const REFRESH_KEY = 'dialer_refresh_token';
const USER_KEY    = 'dialer_user';

function saveSession(accessToken: string, refreshToken: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY,   accessToken);
  localStorage.setItem(REFRESH_KEY, refreshToken);
  localStorage.setItem(USER_KEY,    JSON.stringify(user));
  // Also set an httpOnly-style cookie for server-side middleware check
  document.cookie = `access_token=${accessToken}; path=/; max-age=900; SameSite=Strict`;
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
  document.cookie = 'access_token=; path=/; max-age=0';
}

// ---- Provider --------------------------------------------------------------

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user,        setUser]        = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading,     setLoading]     = useState(true);

  // Rehydrate from localStorage on mount
  // Also migrates sessions saved under the old 'access_token' key (pre-rename)
  useEffect(() => {
    try {
      let token = localStorage.getItem(TOKEN_KEY);
      let raw   = localStorage.getItem(USER_KEY);

      // One-time migration: old key was 'access_token' (without 'dialer_' prefix)
      if (!token) {
        const legacyToken   = localStorage.getItem('access_token');
        const legacyRefresh = localStorage.getItem('refresh_token');
        const legacyUser    = localStorage.getItem('user');
        if (legacyToken) {
          // Migrate to new keys
          localStorage.setItem(TOKEN_KEY,   legacyToken);
          if (legacyRefresh) localStorage.setItem(REFRESH_KEY, legacyRefresh);
          if (legacyUser)    localStorage.setItem(USER_KEY,    legacyUser);
          // Remove old keys to avoid future confusion
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          localStorage.removeItem('user');
          token = legacyToken;
          raw   = legacyUser;
        }
      }

      if (token && raw) {
        setAccessToken(token);
        setUser(JSON.parse(raw) as AuthUser);
      }
    } catch {
      clearSession();
    } finally {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json() as { error?: string };
      throw new Error(body.error ?? 'Login failed');
    }
    const data = await res.json() as { accessToken: string; refreshToken: string; user: AuthUser };
    saveSession(data.accessToken, data.refreshToken, data.user);
    setAccessToken(data.accessToken);
    setUser(data.user);
    router.push('/dashboard');
  }, [router]);

  const loginWithQr = useCallback(async (token: string) => {
    const res = await fetch('/api/auth/qr-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) {
      const body = await res.json() as { error?: string };
      throw new Error(body.error ?? 'QR login failed');
    }

    const data = await res.json() as { accessToken: string; refreshToken: string; user: AuthUser };
    saveSession(data.accessToken, data.refreshToken, data.user);
    setAccessToken(data.accessToken);
    setUser(data.user);
    router.push('/dashboard');
  }, [router]);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const res = await fetch('/api/auth/register', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, email, password, role: 'admin' }),
    });
    if (!res.ok) {
      const body = await res.json() as { error?: string };
      throw new Error(body.error ?? 'Registration failed');
    }
    const data = await res.json() as { accessToken: string; refreshToken: string; user: AuthUser };
    saveSession(data.accessToken, data.refreshToken, data.user);
    setAccessToken(data.accessToken);
    setUser(data.user);
    router.push('/dashboard');
  }, [router]);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
    setAccessToken(null);
    router.push('/login');
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, accessToken, loading, login, loginWithQr, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
