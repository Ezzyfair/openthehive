// lib/email/welcome.ts
// ----------------------------------------------------------------------------
// THE HIVE — the member welcome (MEMBER-002 item 1, ruling R4: every member is
// welcomed, paid or Scout).
//
// Two creation paths call this: the Scout path (app/api/agents/register) and the
// paid path (the Stripe webhook, after checkout.session.completed is handled). The
// mail leaves through the one door, lib/mail/sendEmail.ts, which keeps its loud log
// line and writes every attempt to email_sends.
//
// ONCE PER MEMBER, WITHOUT A MIGRATION. No welcome_sent_at column (ruled out). The
// email log is the record: before sending, email_sends is asked whether this address
// has already been sent this template with status 'sent'. A paid member who signed up
// as a Scout first is therefore welcomed at signup and NOT again at checkout. A
// suppressed or skipped (no mail env) attempt is not a welcome, so it does not count.
// A failed log read refuses to send: "never twice" wins over "at least once", and the
// refusal is logged loud.
// ----------------------------------------------------------------------------
import { sendEmail } from '@/lib/mail/sendEmail';

export const WELCOME_SUBJECT = 'Welcome to The Hive';
export const WELCOME_TEMPLATE = 'member_welcome_v1';

/** Used only when a caller has no request origin to pass. */
export const DEFAULT_SITE = 'https://openthehive.ai';

export const AI_PERSONA_LINE = 'Coaches, Elders and the Oracle are AI personas operated by The Hive.';
export const NOT_YOU_LINE = "If you didn't join The Hive, ignore this email.";

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function siteRoot(site: string | null | undefined): string {
  return (site || DEFAULT_SITE).replace(/\/+$/, '');
}

/** The body as six plain lines, in the ruled order. The HTML is built from these. */
export function welcomeLines(site: string, to: string): string[] {
  const login = `${siteRoot(site)}/member/login`;
  return [
    "Your bee has a chamber waiting.",
    `Sign in at ${login} with this address: ${to}.`,
    'There is no password. A one-time link or code arrives each time you sign in.',
    "The first thing to do is open your bee's chamber.",
    AI_PERSONA_LINE,
    NOT_YOU_LINE,
  ];
}

export function welcomeText(site: string, to: string): string {
  return welcomeLines(site, to).join('\n\n');
}

export function welcomeHtml(site: string, to: string): string {
  const login = `${siteRoot(site)}/member/login`;
  const [chamber, , password, first, persona, notYou] = welcomeLines(site, to).map(esc);
  return `
    <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:32px 24px;font-size:16px;line-height:1.6;">
      <h1 style="font-size:26px;margin:0 0 16px;">Welcome to The Hive</h1>
      <p style="margin:0 0 16px;">${chamber}</p>
      <p style="margin:0 0 16px;">Sign in at <a href="${esc(login)}">${esc(login)}</a> with this address: <strong>${esc(to)}</strong>.</p>
      <p style="margin:0 0 16px;">${password}</p>
      <p style="margin:0 0 16px;">${first}</p>
      <p style="margin:0 0 16px;font-size:14px;">${persona}</p>
      <p style="margin:0;">${notYou}</p>
    </div>
  `;
}

type Send = typeof sendEmail;

export interface WelcomeArgs {
  supabase: any;
  to: string | null | undefined;
  site?: string | null;
  agentId?: string | null;
}

export type WelcomeResult =
  | { sent: true }
  | { sent: false; reason: 'no_address' | 'already_welcomed' | 'log_unreadable' | string };

/** The one way a welcome is sent. `send` is injectable so the tests can mock it. */
export async function sendWelcomeOnce(args: WelcomeArgs, send: Send = sendEmail): Promise<WelcomeResult> {
  const to = typeof args.to === 'string' ? args.to.trim().toLowerCase() : '';
  if (!to) return { sent: false, reason: 'no_address' };

  const { data: prior, error } = await args.supabase
    .from('email_sends')
    .select('id')
    .eq('to_email', to)
    .eq('template', WELCOME_TEMPLATE)
    .eq('status', 'sent')
    .limit(1);
  if (error) {
    console.error('welcome: email log unreadable — welcome NOT sent, so it cannot be sent twice', error.message);
    return { sent: false, reason: 'log_unreadable' };
  }
  if (Array.isArray(prior) && prior.length > 0) return { sent: false, reason: 'already_welcomed' };

  const site = siteRoot(args.site);
  const r = await send({
    supabase: args.supabase,
    to,
    agentId: args.agentId ?? null,
    category: 'operational',
    template: WELCOME_TEMPLATE,
    subject: WELCOME_SUBJECT,
    html: welcomeHtml(site, to),
  });
  if (r.sent) return { sent: true };
  console.error('welcome: mail not sent', (r as { reason?: string }).reason ?? 'provider error');
  return { sent: false, reason: (r as { reason?: string }).reason ?? 'provider_error' };
}

/**
 * The paid path. Called by the Stripe webhook route AFTER handleStripeEvent, with its
 * result, so the money handling is untouched: only a handled (200, not quarantined)
 * checkout.session.completed that carries an address welcomes anyone. Never throws —
 * a mail problem must not turn a processed payment into a failed webhook.
 */
export async function welcomeAfterCheckout(
  supabase: any,
  event: { type: string; data: { object: any } },
  result: { status: number; body: Record<string, unknown> },
  site?: string | null,
  send: Send = sendEmail,
): Promise<WelcomeResult | null> {
  if (event.type !== 'checkout.session.completed') return null;
  if (result.status !== 200 || result.body?.quarantined) return null;
  const session = event.data.object ?? {};
  const to = session.customer_email || session.customer_details?.email || null;
  try {
    // agentId null: metadata.agent_id is the caller's word, and a value that is not a
    // real agent would make the email_sends insert fail — losing the very row that
    // keeps this welcome from being sent twice.
    return await sendWelcomeOnce({ supabase, to, site, agentId: null }, send);
  } catch (e: any) {
    console.error('welcome: paid-path welcome failed', String(e?.message || e));
    return { sent: false, reason: 'error' };
  }
}
