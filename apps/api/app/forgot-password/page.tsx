'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Zap, Mail, AlertCircle, CheckCircle2, Loader2, ArrowLeft } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [email,     setEmail]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // POST to the forgot-password API (returns 200 regardless to prevent email enumeration)
      await fetch('/api/auth/forgot-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim() }),
      });
      setSubmitted(true);
    } catch {
      setError('Something went wrong. Please try again.');
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

        {submitted ? (
          <>
            <div className="auth-success" role="status">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>
                If <strong>{email}</strong> is registered, a reset link has been sent.
                Check your inbox.
              </span>
            </div>
            <p className="auth-footer-text">
              <Link href="/login" className="auth-link">
                <ArrowLeft className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
                Back to sign in
              </Link>
            </p>
          </>
        ) : (
          <>
            <h1 className="auth-title">Reset your password</h1>
            <p className="auth-subtitle">
              Enter your email and we&apos;ll send you a reset link.
            </p>

            {error && (
              <div className="auth-error" role="alert">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={(e) => { void handleSubmit(e); }} className="auth-form" noValidate>
              <div className="auth-field">
                <label htmlFor="fp-email" className="auth-label">Email address</label>
                <div className="auth-input-wrap">
                  <Mail className="auth-input-icon" />
                  <input
                    id="fp-email"
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

              <button
                type="submit"
                id="forgot-password-submit"
                disabled={loading}
                className="auth-btn-primary"
              >
                {loading ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…</>
                ) : 'Send Reset Link'}
              </button>
            </form>

            <p className="auth-footer-text">
              <Link href="/login" className="auth-link">
                <ArrowLeft className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
