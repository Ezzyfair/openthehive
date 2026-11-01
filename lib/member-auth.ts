// lib/member-auth.ts
// ----------------------------------------------------------------------------
// THE HIVE — the sign-in mail and the small rules around it (MEMBER-001 items 1, 2, 8).
//
// Sign-in used to be signInWithOtp from the browser: Supabase issued the token, sent
// the mail from a dashboard template, and spent the token on the GET of the link, so
// a mail scanner opening the link spent it first. Now the server asks Supabase for
// the token (auth.admin.generateLink), the mail leaves through the one door
// (lib/mail/sendEmail.ts), and only a POST consumes it.
//
// The link and the code are one token family: both come from one generateLink call,
// so they share one expiry and spending either spends both. The expiry is Supabase's.
// ----------------------------------------------------------------------------
import { createHash } from 'node:crypto';

export const SIGNIN_SUBJECT = 'Your sign-in link for The Hive';
export const SIGNIN_TEMPLATE = 'member_signin_v1';

/** Supabase stores addresses lowercased, and members.email is matched against that. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/** Digits only, so "482 913" as printed in the mail is accepted as typed. */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.replace(/\s+/g, '');
  return /^\d{6,10}$/.test(code) ? code : null;
}

/** 482913 -> 482 913, the way the mail prints it. */
export function formatCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

/** Rate-limit buckets are stored; an address is not something to store in a key. */
export function emailBucket(email: string): string {
  return createHash('sha256').update(email).digest('hex').slice(0, 32);
}

/**
 * Refuses a browser form or fetch from another site. Sec-Fetch-Site is the browser's
 * own statement and cannot be set by a page, so it is asked first. Origin is the
 * fallback for browsers that do not send it. A request with neither is not a browser
 * form, so it carries no cookie an attacker could borrow.
 */
export function sameOrigin(req: { headers: { get(name: string): string | null }; nextUrl: { origin: string } }): boolean {
  const site = req.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin' || site === 'none';
  const origin = req.headers.get('origin');
  return origin === null || origin === req.nextUrl.origin;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function signinHtml(link: string, code: string): string {
  return `
    <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:32px 24px;font-size:16px;line-height:1.6;">
      <h1 style="font-size:26px;margin:0 0 16px;">Sign in to The Hive</h1>
      <p style="margin:0 0 16px;">You asked for a sign-in link. It opens your member page, where you issue and revoke your bee's Antenna tokens.</p>
      <p style="margin:0 0 16px;"><a href="${esc(link)}">Sign in to your member page</a></p>
      <p style="margin:0 0 16px;">Or enter this code on the sign-in page: <strong style="letter-spacing:1px;">${esc(formatCode(code))}</strong></p>
      <p style="margin:0;">If you didn't ask for this, ignore it.</p>
    </div>
  `;
}
