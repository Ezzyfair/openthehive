'use client';

// app/member/login/page.tsx
// ----------------------------------------------------------------------------
// THE HIVE — member sign-in. An emailed link or code: no password is stored or asked for.
//
// /auth/member/send builds the link from the request's own origin, so a preview
// deployment's mail comes back to that deployment. The code field stays on screen
// after sending: it is the path for reading the email on another device.
// ----------------------------------------------------------------------------
import React, { useEffect, useState } from 'react';
import { INBOX_LINE } from '@/lib/member-copy';

export default function MemberLoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // /auth/member/confirm sends a refused link back here. Saying so is what stops a
  // spent link from looking like a page that silently forgot the member.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('error')) {
      setError('That link has expired or was already used. Send a new one, or type the code.');
    }
  }, []);

  const verify = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code') ?? '').trim();
    // From the field, as in send() below: autofill does not always reach React state.
    const address = String((document.getElementById('email') as HTMLInputElement | null)?.value ?? '').trim();
    if (!address || !code) {
      setError('Enter your email address and the code.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/auth/member/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: address, code }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || 'That code did not work. Check it, or send a new one.');
      window.location.href = '/member';
      return;
    } catch (err: any) {
      setError(err?.message || 'That code did not work. Check it, or send a new one.');
    }
    setBusy(false);
  };

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
      const res = await fetch('/auth/member/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: typed }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.message || 'Could not send the link. Try again in a moment.');
      }
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
      {/* MEMBER-002 item 5 (MS3) — whoever reads the inbox can manage the bee. */}
      <p style={{ color: 'var(--muted, #6b6257)', fontSize: 14, lineHeight: 1.7, marginTop: -16, marginBottom: 28 }}>
        {INBOX_LINE}
      </p>

      {sent && (
        <div
          role="status"
          style={{ border: '1px solid rgba(201,168,76,0.4)', padding: 20, borderRadius: 10, fontSize: 14, lineHeight: 1.7 }}
        >
          <strong>Check your email.</strong>
          <br />
          If <span style={{ wordBreak: 'break-all' }}>{email.trim()}</span> is on a membership, a sign-in link is on its
          way. It expires shortly and can be used once.
        </div>
      )}

      <form onSubmit={send} style={{ marginTop: sent ? 20 : 0 }}>
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

      <p style={{ color: 'var(--muted, #6b6257)', fontSize: 14, lineHeight: 1.7, margin: '24px 0 16px' }}>
        Open the link on this phone or computer, or type the code.
      </p>
      <form onSubmit={verify}>
        <label htmlFor="code" style={{ display: 'block', fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
          Code
        </label>
        <input
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          style={{ width: '100%', padding: '12px 14px', fontSize: 15, border: '1px solid rgba(0,0,0,0.2)', borderRadius: 8, marginBottom: 16 }}
        />
        <button
          type="submit"
          disabled={busy}
          style={{ width: '100%', padding: '12px 16px', fontSize: 15, borderRadius: 8, cursor: busy ? 'wait' : 'pointer' }}
        >
          Sign in with the code
        </button>
      </form>

      {error && (
        <p role="alert" style={{ color: '#b3261e', fontSize: 13, marginTop: 16 }}>
          {error}
        </p>
      )}
    </main>
  );
}
