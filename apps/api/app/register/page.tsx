'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth/AuthContext';
import { Zap, Mail, Lock, User, Eye, EyeOff, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

// Password strength helper
function getStrength(pwd: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pwd.length >= 8)  score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  const labels: [string, string][] = [
    ['',       'transparent'],
    ['Weak',   'var(--destructive)'],
    ['Fair',   'hsl(35,90%,55%)'],
    ['Good',   'hsl(200,80%,50%)'],
    ['Strong', 'var(--success)'],
    ['Strong', 'var(--success)'],
  ];
  const [label, color] = labels[score] ?? ['', 'transparent'];
  return { score, label, color };
}


export default function RegisterPage() {
  const { register } = useAuth();

  const [name,     setName]     = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [showPwd,  setShowPwd]  = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const strength = getStrength(password);
  const pwdMatch = confirm.length > 0 && password === confirm;
  const pwdMismatch = confirm.length > 0 && password !== confirm;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match'); return; }
    if (strength.score < 2)   { setError('Password is too weak'); return; }
    setError(null);
    setLoading(true);
    try {
      await register(name.trim(), email.trim(), password);
    } catch (err) {
      setError((err as Error).message ?? 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
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

        <h1 className="auth-title">Create your account</h1>
        <p className="auth-subtitle">Set up your admin workspace</p>

        {error && (
          <div className="auth-error" role="alert">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={(e) => { void handleSubmit(e); }} className="auth-form" noValidate>
          {/* Full name */}
          <div className="auth-field">
            <label htmlFor="reg-name" className="auth-label">Full name</label>
            <div className="auth-input-wrap">
              <User className="auth-input-icon" />
              <input
                id="reg-name"
                type="text"
                autoComplete="name"
                required
                placeholder="John Smith"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="auth-input"
              />
            </div>
          </div>

          {/* Email */}
          <div className="auth-field">
            <label htmlFor="reg-email" className="auth-label">Email address</label>
            <div className="auth-input-wrap">
              <Mail className="auth-input-icon" />
              <input
                id="reg-email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="auth-input"
              />
            </div>
          </div>

          {/* Password */}
          <div className="auth-field">
            <label htmlFor="reg-password" className="auth-label">Password</label>
            <div className="auth-input-wrap">
              <Lock className="auth-input-icon" />
              <input
                id="reg-password"
                type={showPwd ? 'text' : 'password'}
                autoComplete="new-password"
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
            {/* Strength bar */}
            {password.length > 0 && (
              <div className="auth-strength">
                <div className="auth-strength-bar">
                  {[1,2,3,4,5].map((i) => (
                    <div
                      key={i}
                      className="auth-strength-seg"
                      style={{ backgroundColor: i <= strength.score ? strength.color : undefined }}
                    />
                  ))}
                </div>
                <span className="auth-strength-label" style={{ color: strength.color }}>
                  {strength.label}
                </span>
              </div>
            )}
          </div>

          {/* Confirm password */}
          <div className="auth-field">
            <label htmlFor="reg-confirm" className="auth-label">Confirm password</label>
            <div className="auth-input-wrap">
              <Lock className="auth-input-icon" />
              <input
                id="reg-confirm"
                type={showPwd ? 'text' : 'password'}
                autoComplete="new-password"
                required
                placeholder="••••••••"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={`auth-input auth-input-password ${pwdMismatch ? 'auth-input-error' : ''}`}
              />
              {pwdMatch && (
                <CheckCircle2 className="auth-eye-btn h-4 w-4 text-success pointer-events-none" />
              )}
            </div>
            {pwdMismatch && (
              <p className="auth-field-error">Passwords do not match</p>
            )}
          </div>

          <button
            type="submit"
            id="register-submit"
            disabled={loading || pwdMismatch}
            className="auth-btn-primary"
          >
            {loading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating account…</>
            ) : 'Create Account'}
          </button>
        </form>

        <p className="auth-footer-text">
          Already have an account?{' '}
          <Link href="/login" className="auth-link">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
