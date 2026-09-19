'use client';

// app/member/login/page.tsx
// ----------------------------------------------------------------------------
// THE HIVE — member sign-in. Magic link only: no password is stored or asked for.
//
// emailRedirectTo is built from window.location.origin, so a preview deployment
// sends its own domain and the link comes back to the deployment you signed in
// from. Every origin used this way must be in Supabase's redirect allow-list.
// ----------------------------------------------------------------------------
import React, { useState } from 'react';
import { createClient } from '@/lib/supabase/browser';

export default function MemberLoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // Read the address from the FORM, not from React state.
    //
    // Browser autofill often sets input.value without firing the events React
    // listens for, so a controlled input's state can stay empty while the field
    // visibly contains an address. The DOM always holds what the member can
    // actually see; React state only holds what React was told about.
    const typed = String(new FormData(e.currentTarget).get('email') ?? '').trim();
    if (!typed) {
      setError('Please enter the email address on your membership.');
      return;
    }
    // Keep state in step so the confirmation panel shows the address back.
    setEmail(typed);

    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: err } = await supabase.auth.signInWithOtp({
        email: typed,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/member` },
      });
      if (err) throw new Error(err.message);
      // Always the same confirmation, whether or not the address is a member:
      // this page must not become a way to test which emails exist.
      setSent(true);
    } catch (err: any) {
      setError(err?.message || 'Could not send the link. Try again in a moment.');
    }
    setBusy(false);
  };

  return (
    <main style={{ maxWidth: 460, margin: '0 auto', padding: '96px 24px' }}>
      <h1 style={{ fontFamily: 'Cormorant Garamond,serif', fontSize: 34, marginBottom: 8 }}>Your Bees</h1>
      <p style={{ color: 'var(--muted, #6b6257)', fontSize: 14, lineHeight: 1.7, marginBottom: 28 }}>
        Sign in with the email address on your membership. We send a one-time link — there is no password.
      </p>

      {sent ? (
        <div
          role="status"
          style={{ border: '1px solid rgba(201,168,76,0.4)', padding: 20, borderRadius: 10, fontSize: 14, lineHeight: 1.7 }}
        >
          <strong>Check your email.</strong>
          <br />
          If <span style={{ wordBreak: 'break-all' }}>{email.trim()}</span> is on a membership, a sign-in link is on its
          way. It expires shortly and can be used once.
        </div>
      ) : (
        <form onSubmit={send}>
          <label htmlFor="email" style={{ display: 'block', fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            defaultValue={email}
            style={{ width: '100%', padding: '12px 14px', fontSize: 15, border: '1px solid rgba(0,0,0,0.2)', borderRadius: 8, marginBottom: 16 }}
          />
          {/* disabled ONLY while a request is in flight. Gating on React state
              meant an autofilled field left the button disabled, so the click
              never became a submit event: no request, and no error either,
              because no handler ran. `required` plus type="email" gives the
              native empty/!valid check, and the handler re-checks. */}
          <button
            type="submit"
            disabled={busy}
            style={{ width: '100%', padding: '12px 16px', fontSize: 15, borderRadius: 8, cursor: busy ? 'wait' : 'pointer' }}
          >
            {busy ? 'Sending…' : 'Send me a sign-in link'}
          </button>
        </form>
      )}

      {error && (
        <p role="alert" style={{ color: '#b3261e', fontSize: 13, marginTop: 16 }}>
          {error}
        </p>
      )}
    </main>
  );
}
