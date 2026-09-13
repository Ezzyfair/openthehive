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

// §13 step 6 publishes the installer and its digest. Until then the page says so
// rather than printing a number that cannot be checked.
const INSTALLER_VERSION: string | null = null;
const INSTALLER_SHA256: string | null = null;

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
      setNotice('Install token issued. It is shown once, below. Any earlier unused token has been revoked.');
      void load();
    }
  };

  const revokeBee = async (id: string) => {
    const json = await post(`/api/member/bees/${id}/revoke`, `bee:${id}`);
    if (json?.revoked) {
      setNotice('Bee token revoked. That client stops at its next poll.');
      void load();
    }
  };

  const revokeInstall = async (id: string) => {
    const json = await post(`/api/member/join-tokens/${id}/revoke`, `join:${id}`);
    if (json?.revoked) {
      setNotice('Install token revoked.');
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
        <p style={{ fontSize: 13, color: 'var(--muted, #6b6257)', lineHeight: 1.7, marginBottom: 16 }}>
          Download it, check the digest, then run it. Never pipe the download straight into an interpreter.
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

        <div style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>1 · Download</div>
        <pre style={pre}>{DOWNLOAD}</pre>

        <div style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '16px 0 6px' }}>2 · Verify</div>
        <pre style={pre}>{VERIFY[platform]}</pre>
        {INSTALLER_SHA256 ? (
          <p style={{ fontSize: 12.5, marginTop: 8 }}>
            Must equal <code style={{ wordBreak: 'break-all' }}>{INSTALLER_SHA256}</code>
            {INSTALLER_VERSION ? ` (version ${INSTALLER_VERSION})` : null}
          </p>
        ) : (
          <p role="alert" style={{ fontSize: 12.5, marginTop: 8, color: '#8a6d1f' }}>
            <strong>Not published yet.</strong> The installer and its SHA-256 ship with the client build. Until the
            digest is printed here there is nothing to check it against, so do not run the installer yet.
          </p>
        )}

        <div style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '16px 0 6px' }}>3 · Run</div>
        <pre style={pre}>{runLine}</pre>
        {platform === 'windows' && (
          <p style={{ fontSize: 12.5, marginTop: 8, color: 'var(--muted, #6b6257)' }}>
            Run these in PowerShell. If <code>py -3</code> is not recognised, use <code>python</code>.
          </p>
        )}
      </section>

      {/* ── INSTALL TOKEN ───────────────────────────────────────────────── */}
      <section style={box}>
        <h2 style={{ fontSize: 17, marginBottom: 4 }}>Install token</h2>
        <p style={{ fontSize: 13, color: 'var(--muted, #6b6257)', lineHeight: 1.7, marginBottom: 16 }}>
          One-time, valid for 30 minutes. Issuing a new one revokes any unused token you already have.
        </p>

        {issued && (
          <div style={{ ...pre, whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginBottom: 12 }}>
            {issued.token}
            <div style={{ fontFamily: 'inherit', fontSize: 11.5, marginTop: 8, opacity: 0.75 }}>
              Shown once. Expires {fmt(issued.expires_at)}.
            </div>
          </div>
        )}

        <button onClick={issue} disabled={busy === 'issue'} style={{ padding: '10px 18px', fontSize: 14, borderRadius: 8, cursor: 'pointer' }}>
          {busy === 'issue'
            ? 'Issuing…'
            : usableInstall
              ? 'Replace install token'
              : hadInstall
                ? 'Reactivate — issue a new install token'
                : 'Issue install token'}
        </button>

        {!usableInstall && hadInstall && (
          <p style={{ fontSize: 12.5, marginTop: 10, color: 'var(--muted, #6b6257)' }}>
            Your last install token is expired, used, or revoked. Issuing a fresh one is how you reactivate.
          </p>
        )}

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
            No Antenna client has activated yet. Issue an install token above and run the installer.
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
          Revoking stops that client at its next poll and leaves its config file in place for you to read.
        </p>
      </section>
    </main>
  );
}
