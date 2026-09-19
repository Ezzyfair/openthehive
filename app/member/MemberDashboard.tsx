'use client';

// app/member/MemberDashboard.tsx
// ----------------------------------------------------------------------------
// THE HIVE — Antenna dashboard (XI-1 v0.2.2 §2, §3, §8, F11).
//
// Delivery is download -> verify -> run, never `curl | python` (§2). The verify
// step is shown as a required line, not an optional one, and it stays visibly
// BLOCKED until the published SHA-256 exists (§13 step 6) so nobody learns to
// skip past it.
// ----------------------------------------------------------------------------
import React, { useCallback, useEffect, useState } from 'react';
import { ANTENNA_SHA256, LATEST_CLIENT_VERSION } from '@/lib/antenna/version';

type Platform = 'linux' | 'macos' | 'windows';

interface TokenRow {
  bee_token_id: string;
  token_id: string;
  created_at: string;
  last_used_at: string | null;
  client_version: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  live: boolean;
}
interface InstallRow {
  join_token_id: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  usable: boolean;
}
interface BeeRow {
  agent: { id: string; name: string; soul: string | null; soul_emoji: string | null; status: string | null } | null;
  tokens: TokenRow[];
  install_tokens: InstallRow[];
}

// Single-sourced from lib/antenna/version.ts, which scripts/antenna-release.mjs
// keeps in step with the published file. The page never carries its own copy of
// the digest — a stale number here is worse than no number, because a member who
// checks it and sees a mismatch has no way to tell which side is wrong.
const INSTALLER_VERSION: string | null = LATEST_CLIENT_VERSION;
const INSTALLER_SHA256: string | null = ANTENNA_SHA256;

const DOWNLOAD = 'curl -fsSL https://openthehive.ai/antenna/antenna.py -o antenna.py';

const VERIFY: Record<Platform, string> = {
  linux: 'sha256sum antenna.py',
  macos: 'shasum -a 256 antenna.py',
  windows: 'Get-FileHash antenna.py -Algorithm SHA256',
};

// §14 ruling 7 / Nikita N1: Windows is not "the same but with backslashes".
const RUN: Record<Platform, string> = {
  linux: 'python3 antenna.py --join TOKEN',
  macos: 'python3 antenna.py --join TOKEN',
  windows: 'py -3 antenna.py --join TOKEN',
};

const PLATFORM_LABEL: Record<Platform, string> = { linux: 'Linux', macos: 'macOS', windows: 'Windows' };

// Where a member actually types these. Naming the app is the difference between an
// instruction and a guess, and most people have never opened either one.
const TERMINAL_APP: Record<Platform, string> = {
  linux: 'Terminal',
  macos: 'Terminal',
  windows: 'PowerShell',
};
const OPEN_TERMINAL: Record<Platform, string> = {
  linux: 'Open Terminal. On most systems it is in your applications list, or press Ctrl+Alt+T.',
  macos: 'Open Terminal. Press Cmd+Space, type Terminal, press Return.',
  windows: 'Open PowerShell. Press the Start key, type PowerShell, press Enter.',
};

function fmt(ts: string | null): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'linux';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('win')) return 'windows';
  if (ua.includes('mac')) return 'macos';
  return 'linux';
}

export default function MemberDashboard({ email }: { email: string }) {
  const [platform, setPlatform] = useState<Platform>('linux');
  const [bees, setBees] = useState<BeeRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ token: string; expires_at: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const copyToken = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 4000);
    } catch {
      setNotice('Could not copy automatically — select the token and copy it by hand.');
    }
  };

  useEffect(() => setPlatform(detectPlatform()), []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch('/api/member/bees', { cache: 'no-store' });
      if (res.status === 401) {
        window.location.href = '/member/login';
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || 'Could not load your bees.');
      setBees(json.bees ?? []);
    } catch (e: any) {
      setLoadError(e?.message || 'Could not load your bees.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async (url: string, label: string) => {
    setBusy(label);
    setNotice(null);
    try {
      const res = await fetch(url, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (res.status === 401) {
        window.location.href = '/member/login';
        return null;
      }
      if (!res.ok) throw new Error(json?.message || 'That did not work.');
      return json;
    } catch (e: any) {
      setNotice(e?.message || 'That did not work.');
      return null;
    } finally {
      setBusy(null);
    }
  };

  const issue = async () => {
    const json = await post('/api/member/join-tokens/issue', 'issue');
    if (json?.install_token) {
      setIssued({ token: json.install_token, expires_at: json.expires_at });
      setNotice('Here is your token, below. It is shown once, and any earlier unused token has now stopped working.');
      void load();
    }
  };

  const revokeBee = async (id: string) => {
    const json = await post(`/api/member/bees/${id}/revoke`, `bee:${id}`);
    if (json?.revoked) {
      setNotice('Done. That bee stops the next time it checks in, within a minute or so.');
      void load();
    }
  };

  const revokeInstall = async (id: string) => {
    const json = await post(`/api/member/join-tokens/${id}/revoke`, `join:${id}`);
    if (json?.revoked) {
      setNotice('Done. That install token no longer works.');
      void load();
    }
  };

  const bee = bees?.[0] ?? null;
  const usableInstall = bee?.install_tokens.find((t) => t.usable) ?? null;
  const hadInstall = (bee?.install_tokens.length ?? 0) > 0;
  const runLine = RUN[platform].replace('TOKEN', issued ? issued.token : '<your install token>');

  const box: React.CSSProperties = {
    border: '1px solid rgba(201,168,76,0.35)',
    borderRadius: 10,
    padding: 20,
    marginBottom: 24,
  };
  const step: React.CSSProperties = {
    fontSize: 13.5,
    fontWeight: 700,
    margin: '20px 0 8px',
  };
  const stepText: React.CSSProperties = {
    fontSize: 13,
    lineHeight: 1.75,
    color: 'var(--muted, #6b6257)',
    margin: '8px 0',
  };
  const pre: React.CSSProperties = {
    background: 'rgba(0,0,0,0.06)',
    padding: '10px 12px',
    borderRadius: 6,
    fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
    fontSize: 12.5,
    overflowX: 'auto',
    whiteSpace: 'pre',
  };

  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '64px 24px' }}>
      <h1 style={{ fontFamily: 'Cormorant Garamond,serif', fontSize: 34, marginBottom: 4 }}>Your Bees</h1>
      <p style={{ fontSize: 13, color: 'var(--muted, #6b6257)', marginBottom: 32 }}>Signed in as {email}</p>

      {notice && (
        <p role="status" style={{ ...box, background: 'rgba(201,168,76,0.08)', fontSize: 13.5 }}>
          {notice}
        </p>
      )}

      {/* ── INSTALL ─────────────────────────────────────────────────────── */}
      <section style={box}>
        <h2 style={{ fontSize: 17, marginBottom: 4 }}>Install Antenna</h2>
        <p style={{ fontSize: 13, color: 'var(--muted, #6b6257)', lineHeight: 1.7, marginBottom: 8 }}>
          Antenna is the small program that connects your bee to the colony. You download it, check that
          the file you got is the file we published, and then start it. Four steps, once.
        </p>
        <p style={{ fontSize: 13, color: 'var(--muted, #6b6257)', lineHeight: 1.7, marginBottom: 16 }}>
          Pick your computer below. The commands are different on each, so use the tab that matches.
        </p>

        <div role="group" aria-label="Platform" style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {(['linux', 'macos', 'windows'] as Platform[]).map((p) => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              aria-pressed={platform === p}
              style={{
                padding: '6px 14px',
                fontSize: 13,
                borderRadius: 999,
                cursor: 'pointer',
                border: platform === p ? '1px solid rgba(201,168,76,0.9)' : '1px solid rgba(0,0,0,0.2)',
                fontWeight: platform === p ? 700 : 400,
              }}
            >
              {PLATFORM_LABEL[p]}
            </button>
          ))}
        </div>

        <div style={step}>Step 1 — open a command window</div>
        <p style={stepText}>{OPEN_TERMINAL[platform]}</p>
        <p style={stepText}>
          A window opens with a blinking cursor. You type the commands below into that window, one at a
          time, pressing {platform === 'windows' ? 'Enter' : 'Return'} after each.
        </p>

        <div style={step}>Step 2 — download the file</div>
        <p style={stepText}>Type this and press {platform === 'windows' ? 'Enter' : 'Return'}:</p>
        <pre style={pre}>{DOWNLOAD}</pre>
        <p style={stepText}>
          This saves a file called <code>antenna.py</code> into whichever folder the window is currently
          in. That is your home folder unless you have moved somewhere else.
        </p>

        <div style={step}>Step 3 — check the file is the one we published</div>
        <p style={stepText}>
          A digest is a short fingerprint of a file: the same file always produces the same one, and any
          change to the file produces a different one. Comparing the digest of what you downloaded against
          the one printed here is how you know nothing was swapped or damaged on the way.
        </p>
        <p style={stepText}>Type this:</p>
        <pre style={pre}>{VERIFY[platform]}</pre>
        {INSTALLER_SHA256 ? (
          <>
            <p style={stepText}>It prints a long string of letters and numbers. It must match this exactly:</p>
            <pre style={{ ...pre, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{INSTALLER_SHA256}</pre>
            <p style={{ ...stepText, fontWeight: 700 }}>
              If the two values differ, delete the file and download again — do not run it.
            </p>
            {INSTALLER_VERSION && (
              <p style={stepText}>This is Antenna version {INSTALLER_VERSION}.</p>
            )}
          </>
        ) : (
          <p role="alert" style={{ ...stepText, color: '#8a6d1f' }}>
            <strong>Not published yet.</strong> There is nothing here to compare against yet, so please do
            not run the installer. This page will show the digest as soon as it is published.
          </p>
        )}

        <div style={step}>Step 4 — start it</div>
        <p style={stepText}>
          You need your install token first — get it from the next section, then come back. Type this,
          putting your token in place of the placeholder:
        </p>
        <pre style={pre}>{runLine}</pre>
        <p style={stepText}>
          Run this in the same window, in the same folder you downloaded to — if you have moved folders
          since step 2, {TERMINAL_APP[platform]} will say it cannot find the file.
        </p>
        <p style={stepText}>
          <strong>Leave the window open.</strong> Antenna runs for as long as that window stays open, and
          your bee stops when you close it. Setting it up to start on its own, in the background, comes
          after the September 21 milestone — for now, leaving the window open is the whole of it.
        </p>
        {platform === 'windows' && (
          <p style={stepText}>
            If PowerShell says <code>py</code> is not recognised, type <code>python</code> instead of{' '}
            <code>py -3</code>.
          </p>
        )}
      </section>

      {/* ── INSTALL TOKEN ───────────────────────────────────────────────── */}
      <section style={box}>
        <h2 style={{ fontSize: 17, marginBottom: 4 }}>Your install token</h2>
        <p style={{ ...stepText, marginBottom: 4 }}>
          The install token is a one-time password that tells the colony which bee is being connected. You
          paste it into the step 4 command above.
        </p>
        <p style={{ ...stepText, marginBottom: 16 }}>
          It is shown once, right here, and it stops working after 30 minutes. If it expires before you
          finish, come back and get another — there is no limit on how many times you can do that.
        </p>

        {/* Hidden until asked for: a token sitting on screen from a page load an hour
            ago is a credential nobody chose to reveal. */}
        {issued ? (
          <div style={{ marginBottom: 12 }}>
            <div style={{ ...pre, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{issued.token}</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
              <button
                onClick={copyToken}
                style={{ padding: '6px 14px', fontSize: 13, borderRadius: 8, cursor: 'pointer' }}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
              <span style={{ fontSize: 12.5, color: 'var(--muted, #6b6257)' }}>
                Shown once. Stops working at {fmt(issued.expires_at)}.
              </span>
            </div>
          </div>
        ) : null}

        <button onClick={issue} disabled={busy === 'issue'} style={{ padding: '10px 18px', fontSize: 14, borderRadius: 8, cursor: 'pointer' }}>
          {busy === 'issue'
            ? 'Getting your token…'
            : issued
              ? 'Replace'
              : usableInstall
                ? 'Replace'
                : 'Get your install token'}
        </button>

        <p style={{ ...stepText, marginTop: 10 }}>
          {usableInstall || issued
            ? 'Replace gets you a new token and immediately stops the old one working, in case it has gone somewhere you did not intend.'
            : hadInstall
              ? 'Your last token has been used, has expired, or was stopped. Getting a new one is how you reconnect a bee.'
              : 'Getting a token does not start anything on its own — you still run the step 4 command.'}
        </p>

        {(bee?.install_tokens.length ?? 0) > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, marginTop: 18, fontSize: 12.5 }}>
            {bee!.install_tokens.map((t) => (
              <li key={t.join_token_id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '8px 0', borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                <span style={{ flex: 1 }}>
                  issued {fmt(t.created_at)} · {t.consumed_at ? `used ${fmt(t.consumed_at)}` : t.revoked_at ? `revoked (${t.revoked_by})` : `expires ${fmt(t.expires_at)}`}
                </span>
                {t.usable && (
                  <button onClick={() => revokeInstall(t.join_token_id)} disabled={busy === `join:${t.join_token_id}`} style={{ fontSize: 12, padding: '4px 10px', cursor: 'pointer' }}>
                    {busy === `join:${t.join_token_id}` ? 'Revoking…' : 'Revoke'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── BEE TOKENS ──────────────────────────────────────────────────── */}
      <section style={box}>
        <h2 style={{ fontSize: 17, marginBottom: 16 }}>
          {bee?.agent ? `${bee.agent.soul_emoji ?? '🐝'} ${bee.agent.name}` : 'Your bee'}
        </h2>

        {loadError && <p role="alert" style={{ color: '#b3261e', fontSize: 13 }}>{loadError}</p>}
        {!bees && !loadError && <p style={{ fontSize: 13 }}>Loading…</p>}
        {bees && (bee?.tokens.length ?? 0) === 0 && (
          <p style={{ fontSize: 13, color: 'var(--muted, #6b6257)' }}>
            No bee has connected yet. Get an install token above, then follow the four steps.
          </p>
        )}

        {(bee?.tokens.length ?? 0) > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px' }}>Token</th>
                  <th style={{ padding: '6px 8px' }}>Activated</th>
                  <th style={{ padding: '6px 8px' }}>Last seen</th>
                  <th style={{ padding: '6px 8px' }}>Version</th>
                  <th style={{ padding: '6px 8px' }}>State</th>
                  <th style={{ padding: '6px 8px' }} />
                </tr>
              </thead>
              <tbody>
                {bee!.tokens.map((t) => (
                  <tr key={t.bee_token_id} style={{ borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                    <td style={{ padding: '8px', fontFamily: 'ui-monospace,monospace' }}>{t.token_id}</td>
                    <td style={{ padding: '8px' }}>{fmt(t.created_at)}</td>
                    <td style={{ padding: '8px' }}>{fmt(t.last_used_at)}</td>
                    <td style={{ padding: '8px' }}>{t.client_version ?? '—'}</td>
                    <td style={{ padding: '8px' }}>{t.live ? 'live' : `revoked (${t.revoked_by})`}</td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>
                      {t.live && (
                        <button onClick={() => revokeBee(t.bee_token_id)} disabled={busy === `bee:${t.bee_token_id}`} style={{ fontSize: 12, padding: '4px 10px', cursor: 'pointer' }}>
                          {busy === `bee:${t.bee_token_id}` ? 'Revoking…' : 'Revoke'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ fontSize: 12, color: 'var(--muted, #6b6257)', marginTop: 14, lineHeight: 1.7 }}>
          Revoke stops that bee the next time it checks in, within a minute or so. Its settings file stays
          on the machine so you can see what happened, with the token replaced by the word "revoked".
        </p>
      </section>
    </main>
  );
}
