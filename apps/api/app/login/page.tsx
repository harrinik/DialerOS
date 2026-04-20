'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth/AuthContext';
import { Zap, Mail, Lock, Eye, EyeOff, AlertCircle, Loader2, QrCode } from 'lucide-react';
import { useEffect } from 'react';

export default function LoginPage() {
  const { login, loginWithQr } = useAuth();

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPwd,  setShowPwd]  = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [qrToken,  setQrToken]  = useState('');

  async function performQrLogin(token: string) {
    setError(null);
    setLoading(true);
    try {
      await loginWithQr(token);
    } catch (err) {
      setError((err as Error).message ?? 'QR login failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError((err as Error).message ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleQrSubmit(e: FormEvent) {
    e.preventDefault();
    if (!qrToken.trim()) return;
    await performQrLogin(qrToken.trim());
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const token = new URLSearchParams(window.location.search).get('qrToken') ?? '';
    if (!token) return;
    setQrToken(token);
    void performQrLogin(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loginWithQr]);

  return (
    <div className="auth-page">
      {/* Background grid + glow */}
      <div className="auth-bg-grid" aria-hidden />
      <div className="auth-bg-glow" aria-hidden />

      <div className="auth-card">
        {/* Logo */}
        <div className="auth-logo">
          <div className="auth-logo-icon">
            <Zap className="h-6 w-6 text-primary" />
          </div>
          <div>
            <p className="auth-logo-name">DialerOS</p>
            <p className="auth-logo-sub">Predictive Dialer Platform</p>
          </div>
        </div>

        <h1 className="auth-title">Welcome back</h1>
        <p className="auth-subtitle">Sign in to access your control panel</p>

        {error && (
          <div className="auth-error" role="alert">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={(e) => { void handleSubmit(e); }} className="auth-form" noValidate>
          {/* Email */}
          <div className="auth-field">
            <label htmlFor="login-email" className="auth-label">Email address</label>
            <div className="auth-input-wrap">
              <Mail className="auth-input-icon" />
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                required
                placeholder="admin@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="auth-input"
              />
            </div>
          </div>

          {/* Password */}
          <div className="auth-field">
            <div className="auth-label-row">
              <label htmlFor="login-password" className="auth-label">Password</label>
              <Link href="/forgot-password" className="auth-link-sm">Forgot password?</Link>
            </div>
            <div className="auth-input-wrap">
              <Lock className="auth-input-icon" />
              <input
                id="login-password"
                type={showPwd ? 'text' : 'password'}
                autoComplete="current-password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="auth-input auth-input-password"
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="auth-eye-btn"
                aria-label={showPwd ? 'Hide password' : 'Show password'}
              >
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            id="login-submit"
            disabled={loading}
            className="auth-btn-primary"
          >
            {loading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in…</>
            ) : 'Sign In'}
          </button>
        </form>

        <div className="my-4 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground mb-2 flex items-center gap-2">
            <QrCode className="h-3.5 w-3.5" /> Agent QR Login
          </p>
          <form onSubmit={(e) => { void handleQrSubmit(e); }} className="auth-form">
            <div className="auth-field">
              <label htmlFor="qr-token" className="auth-label">QR token</label>
              <input
                id="qr-token"
                value={qrToken}
                onChange={(e) => setQrToken(e.target.value)}
                placeholder="Paste token or open scan link"
                className="auth-input"
              />
            </div>
            <button type="submit" disabled={loading || !qrToken.trim()} className="auth-btn-primary">
              {loading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying…</>
              ) : 'Login with QR'}
            </button>
          </form>
        </div>

        <p className="auth-footer-text">
          Don&apos;t have an account?{' '}
          <Link href="/register" className="auth-link">Create one</Link>
        </p>
      </div>
    </div>
  );
}
