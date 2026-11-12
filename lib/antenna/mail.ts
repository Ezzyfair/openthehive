// lib/antenna/mail.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — the mail lane: mail.read and mail.send (XI-1 v0.4 §3;
// ANTENNA-006 items 4–7).
//
// The bee never holds the mail key. Everything here is resolved from the agent id
// the verifier returned: the sending inbox by deriveInbox(), the human's address
// by members.agent_id, the staff flag by agents.is_staff. No body field names a
// sender, an inbox, an agent or a human.
//
// The two route files are thin: verifyBeeToken first, then mailSend / mailRead
// here. The handlers take their collaborators as an argument (MailDeps) so the
// self-test runs them with the provider and the database mocked; the routes pass
// liveMailDeps(). Refusals are 422 with a reason (§7.21: no 403 on /api/bee/).
// ----------------------------------------------------------------------------
import { createHash, randomUUID } from 'node:crypto';
import { getMail, listMail, MailProviderError, sendMail, type ProviderMessage } from './agentmail';
import { deriveInbox } from './chamber';
import { antennaAdmin } from './db';
import { BeeError } from './errors';
import { writeBeeEvent, type BeeEventInput } from './events';
import { BEE_MAIL_FOOTER_TEMPLATE } from './mail-footer';
import { isPublicSilenceActive, PUBLIC_SILENCE_REASON } from './public-silence';
import { enforceRateLimitTimes, type EnforceInput } from './rate-limit';
import { mailSendSchema, validateClosed } from './schemas';

// ─── the recipient rule (R2, R8, R19) ────────────────────────────────────────

export const MAIL_MAX_RECIPIENTS = 5;
export const COLONY_MAIL_DOMAINS: readonly string[] = ['openthehive.ai', 'bees.openthehive.ai'];

export type RecipientCheck = 'ok' | { reason: string; address: string | null };

/** A bare local@domain, already trimmed and lowercased. No name, no brackets, no comma, no space. */
const BARE_ADDRESS =
  /^[a-z0-9._%+-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * Every address is checked; the first refused one (as given) is named, and the
 * whole send is refused. Pure: `now` is injected, nothing is read or written.
 */
export function checkRecipients(input: {
  to: string[];
  humanEmail: string | null;
  isStaff: boolean;
  now: Date;
}): RecipientCheck {
  const { to } = input;
  if (to.length < 1 || to.length > MAIL_MAX_RECIPIENTS) {
    return { reason: 'too_many_recipients', address: null };
  }

  const seen: string[] = [];
  for (const raw of to) {
    const n = normalizeAddress(raw);
    if (seen.indexOf(n) !== -1) return { reason: 'duplicate_recipient', address: raw };
    seen.push(n);
  }

  const human = input.humanEmail ? normalizeAddress(input.humanEmail) : null;

  for (const raw of to) {
    // CR/LF anywhere, including at the ends that trim() would have removed.
    if (/[\r\n]/.test(raw)) return { reason: 'invalid_recipient', address: raw };
    const addr = normalizeAddress(raw);
    if (!BARE_ADDRESS.test(addr)) return { reason: 'invalid_recipient', address: raw };

    if (human && addr === human) continue;

    const at = addr.lastIndexOf('@');
    const local = addr.slice(0, at);
    const domain = addr.slice(at + 1);
    if (COLONY_MAIL_DOMAINS.indexOf(domain) !== -1) {
      const base = local.split('+')[0];
      if (domain === 'openthehive.ai' && base === 'esmeralda') {
        return { reason: 'recipient_not_mailable', address: raw };
      }
      continue;
    }

    if (input.isStaff) continue;
    if (isPublicSilenceActive(input.now)) return { reason: PUBLIC_SILENCE_REASON, address: raw };
  }
  return 'ok';
}

// ─── patterns ─────────────────────────────────────────────────────────────────

/**
 * F3 — a copy of the ten CREDENTIAL_PATTERNS inline in app/api/bee/reply/route.ts,
 * which this ticket may not touch. tests/antenna/antenna-006.test.ts reads that
 * route file and fails if the two lists differ.
 */
export const MAIL_BASE_PATTERNS: Array<[string, RegExp]> = [
  ['bee_token', /hive_bee_[A-Za-z0-9_-]{8,}/],
  ['install_token', /hive_join_[A-Za-z0-9_-]{8,}/],
  ['stripe_live', /sk_live_[A-Za-z0-9]{8,}/],
  ['stripe_test', /sk_test_[A-Za-z0-9]{8,}/],
  ['stripe_webhook', /whsec_[A-Za-z0-9]{8,}/],
  ['stripe_restricted', /rk_live_[A-Za-z0-9]{8,}/],
  ['anthropic', /sk-ant-[A-Za-z0-9_-]{8,}/],
  ['jwt', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['pem_block', /-----BEGIN /],
  ['aws_key', /AKIA[0-9A-Z]{16}/],
];

/**
 * M8 — three more, for outgoing mail only. /reply does not get them: a sha256 in a
 * chamber reply must keep working. A 64-hex token (an unencrypted private key), a
 * line of exactly 12 or 24 lowercase words and nothing else (a recovery word list),
 * and a path ending in wallet.json.
 */
export const MAIL_EXTRA_PATTERNS: Array<[string, RegExp]> = [
  ['hex64', /\b[0-9a-fA-F]{64}\b/],
  ['word_list', /^[ \t]*(?:[a-z]+[ \t]+){11}(?:(?:[a-z]+[ \t]+){12})?[a-z]+[ \t]*\r?$/m],
  ['wallet_path', /wallet\.json\b/i],
];

export function firstPatternMatch(text: string, patterns: Array<[string, RegExp]>): string | null {
  for (const [name, re] of patterns) if (re.test(text)) return name;
  return null;
}

export const MAIL_REDACTION = '[credential removed by Antenna]';

/** Replaces, never refuses — the read side. */
export function redactPatterns(text: string, patterns: Array<[string, RegExp]>): string {
  let out = text;
  for (const [, re] of patterns) {
    const flags = re.flags.indexOf('g') === -1 ? re.flags + 'g' : re.flags;
    out = out.replace(new RegExp(re.source, flags), MAIL_REDACTION);
  }
  return out;
}

// ─── caps, footer ─────────────────────────────────────────────────────────────

export const MAIL_SUBJECT_MAX = 200;
/** R6 — 32 KB of UTF-8, both ways. */
export const MAIL_BODY_MAX_BYTES = 32 * 1024;
export const MAIL_READ_MAX = 10;

/** The sent text: the bee's words, the signature separator, the footer — once. */
export function composeMailText(bodyText: string, beeName: string): string {
  return bodyText + '\n\n-- \n' + BEE_MAIL_FOOTER_TEMPLATE.replace('{bee}', beeName);
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

/** Cuts to at most `maxBytes` of UTF-8 without leaving half a character behind. */
export function capUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return { text, truncated: false };
  let cut = buf.subarray(0, maxBytes).toString('utf8');
  while (cut.endsWith('�')) cut = cut.slice(0, -1);
  return { text: cut, truncated: true };
}

// ─── collaborators ────────────────────────────────────────────────────────────

export interface BeeMailRow {
  id?: string;
  agent_id: string;
  direction: 'in' | 'out';
  to_json: unknown;
  subject: string | null;
  body_sha256: string | null;
  provider_id: string | null;
  at?: string;
  refused_reason: string | null;
}

export interface MailSender {
  name: string;
  is_staff: boolean;
  human_email: string | null;
}

export interface MailDeps {
  now(): Date;
  newId(): string;
  enforce(input: EnforceInput, times: number): Promise<void>;
  loadSender(agentId: string): Promise<MailSender>;
  /** 'failed' is returned, not thrown; the caller decides whether it matters. */
  insertMail(row: BeeMailRow): Promise<'inserted' | 'duplicate' | 'failed'>;
  updateMail(id: string, patch: Partial<BeeMailRow>): Promise<void>;
  writeEvent(input: BeeEventInput): Promise<void>;
  sendMail: typeof sendMail;
  listMail: typeof listMail;
  getMail: typeof getMail;
}

export interface MailResult {
  status: number;
  body: Record<string, unknown>;
}

export interface MailCaller {
  agentId: string;
  tokenId: string;
  ip: string | null;
}

// ─── mail.send ────────────────────────────────────────────────────────────────

interface MailSendBody {
  to: string[];
  subject: string;
  body_text: string;
}

export async function mailSend(caller: MailCaller, raw: unknown, deps: MailDeps): Promise<MailResult> {
  // 1 · schema. Closed; an extra field is 400, as on every other bee route. An
  // absurdly long body_text is 413, as /reply does for its content.
  const parsed = validateClosed<MailSendBody>(raw, mailSendSchema);
  if (!parsed.ok) {
    const status = parsed.code === 'too_long' && parsed.field === 'body_text' ? 413 : 400;
    return { status, body: { error: parsed.code, message: parsed.message } };
  }
  const body = parsed.value;

  // 2 · rate limits (R9). Each recipient counts as one against the token buckets.
  const hits = Math.max(1, body.to.length);
  const tokenScope = { tokenId: caller.tokenId, agentId: caller.agentId, ip: caller.ip };
  await deps.enforce({ scope: 'mail_send_hour', ...tokenScope }, hits);
  await deps.enforce({ scope: 'mail_send_day', ...tokenScope }, hits);
  await deps.enforce({ scope: 'mail_send_ip', ip: caller.ip, agentId: caller.agentId }, 1);

  // 3 · everything about the sender comes from the token's agent.
  const sender = await deps.loadSender(caller.agentId);
  const inbox = deriveInbox(sender.name);
  const bodySha = sha256Hex(body.body_text);

  const refuse = async (reason: string, status = 422, extra: Record<string, unknown> = {}): Promise<MailResult> => {
    await deps.insertMail({
      id: deps.newId(),
      agent_id: caller.agentId,
      direction: 'out',
      to_json: body.to,
      // A refused subject may carry the very credential it was refused for; the
      // row keeps it only after the same thirteen patterns have been replaced.
      subject: redactPatterns(redactPatterns(body.subject, MAIL_BASE_PATTERNS), MAIL_EXTRA_PATTERNS),
      body_sha256: bodySha,
      provider_id: null,
      refused_reason: reason,
    });
    await deps.writeEvent({
      event: 'mail_refused',
      agentId: caller.agentId,
      ip: caller.ip,
      detail: { reason, recipients: body.to.length },
    });
    return { status, body: { reason, ...extra } };
  };

  // 4 · the recipient rule.
  const check = checkRecipients({
    to: body.to,
    humanEmail: sender.human_email,
    isStaff: sender.is_staff,
    now: deps.now(),
  });
  if (check !== 'ok') return refuse(check.reason, 422, { address: check.address });

  // 5 · subject: one line, at most 200 characters.
  if (/[\r\n]/.test(body.subject)) return refuse('subject_not_one_line');
  if (body.subject.length > MAIL_SUBJECT_MAX) return refuse('subject_too_long');

  // 6 · body: 32 KB of UTF-8 (R6). Over is 413, as /reply does.
  if (Buffer.byteLength(body.body_text, 'utf8') > MAIL_BODY_MAX_BYTES) return refuse('body_too_large', 413);

  // 7 · the base ten plus the extra three, over subject and body.
  const scanned = body.subject + '\n' + body.body_text;
  if (firstPatternMatch(scanned, MAIL_BASE_PATTERNS) || firstPatternMatch(scanned, MAIL_EXTRA_PATTERNS)) {
    return refuse('credential_pattern');
  }

  // 8 · the row first, so a send is never made that the colony cannot record.
  const id = deps.newId();
  const sentAt = deps.now().toISOString();
  const to = body.to.map(normalizeAddress);
  const logged = await deps.insertMail({
    id,
    agent_id: caller.agentId,
    direction: 'out',
    to_json: to,
    subject: body.subject,
    body_sha256: bodySha,
    provider_id: null,
    at: sentAt,
    refused_reason: null,
  });
  if (logged !== 'inserted') {
    throw new BeeError(503, 'mail_log_unavailable', 'mail could not be recorded; nothing was sent');
  }

  // 9 · send, from the bee's own inbox, text only, footer appended once.
  let providerId: string;
  try {
    const sent = await deps.sendMail({ inbox, to, subject: body.subject, text: composeMailText(body.body_text, sender.name) });
    providerId = sent.message_id;
  } catch (e) {
    if (!(e instanceof MailProviderError)) throw e;
    await deps.updateMail(id, { refused_reason: e.reason });
    await deps.writeEvent({
      event: 'mail_refused',
      agentId: caller.agentId,
      ip: caller.ip,
      detail: { reason: e.reason, recipients: to.length },
    });
    return { status: e.reason === 'no_inbox' ? 404 : 502, body: { reason: e.reason } };
  }

  await deps.updateMail(id, { provider_id: providerId });
  await deps.writeEvent({
    event: 'mail_sent',
    agentId: caller.agentId,
    ip: caller.ip,
    detail: { bee_mail_id: id, recipients: to.length },
  });
  return { status: 200, body: { id, sent_at: sentAt } };
}

// ─── mail.read ────────────────────────────────────────────────────────────────

export interface MailItem {
  id: string;
  from: string;
  to: string[];
  subject: string;
  received_at: string;
  body_text: string;
  attachments: Array<{ name: string; size: number }>;
  truncated?: true;
  html_only?: true;
}

/** `?cursor=<ISO timestamp>`, optional. Any other key, or an unparseable value, is 400. */
export function parseMailCursor(params: URLSearchParams): { ok: true; cursor: string | null } | { ok: false; message: string } {
  const keys: string[] = [];
  params.forEach((_v, k) => {
    keys.push(k);
  });
  const unknown = keys.find((k) => k !== 'cursor');
  if (unknown !== undefined) return { ok: false, message: `unknown query parameter "${unknown}"` };
  const raw = params.get('cursor');
  if (raw === null || raw === '') return { ok: true, cursor: null };
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw) || Number.isNaN(Date.parse(raw))) {
    return { ok: false, message: '"cursor" must be an ISO timestamp' };
  }
  return { ok: true, cursor: raw };
}

/** The bare address in `Name <addr>` or `addr`, lowercased. */
export function senderAddress(from: string | undefined): string {
  if (!from) return '';
  const m = /<([^>]+)>/.exec(from);
  return normalizeAddress(m ? m[1] : from);
}

function textOf(m: ProviderMessage): string | null {
  if (typeof m.extracted_text === 'string') return m.extracted_text;
  if (typeof m.text === 'string') return m.text;
  return null;
}

export async function mailRead(caller: MailCaller, params: URLSearchParams, deps: MailDeps): Promise<MailResult> {
  await deps.enforce({ scope: 'mail_read', tokenId: caller.tokenId, agentId: caller.agentId, ip: caller.ip }, 1);
  await deps.enforce({ scope: 'mail_read_ip', ip: caller.ip, agentId: caller.agentId }, 1);

  const q = parseMailCursor(params);
  if (!q.ok) return { status: 400, body: { error: 'invalid_cursor', message: q.message } };
  // Absent = now: a first read returns nothing old.
  const cursor = q.cursor ?? deps.now().toISOString();
  const cursorMs = Date.parse(cursor);

  const sender = await deps.loadSender(caller.agentId);
  const inbox = deriveInbox(sender.name);

  let listed: ProviderMessage[];
  try {
    listed = await deps.listMail({ inbox, after: cursor });
  } catch (e) {
    if (!(e instanceof MailProviderError)) throw e;
    return { status: e.reason === 'no_inbox' ? 404 : 502, body: { reason: e.reason } };
  }

  const seen: string[] = [];
  const fresh = listed.filter((m) => {
    if (typeof m.message_id !== 'string' || typeof m.timestamp !== 'string') return false;
    if (seen.indexOf(m.message_id) !== -1) return false;
    seen.push(m.message_id);
    const t = Date.parse(m.timestamp);
    if (Number.isNaN(t) || t <= cursorMs) return false;
    // The bee's own sent mail is never handed back to it.
    return senderAddress(m.from) !== inbox;
  });
  fresh.sort((a, b) => Date.parse(a.timestamp as string) - Date.parse(b.timestamp as string));
  const page = fresh.slice(0, MAIL_READ_MAX);

  const items: MailItem[] = [];
  for (const m of page) {
    let text = textOf(m);
    if (text === null) {
      try {
        text = textOf(await deps.getMail({ inbox, message_id: m.message_id as string }));
      } catch (e) {
        if (!(e instanceof MailProviderError)) throw e;
        return { status: 502, body: { reason: 'provider_unavailable' } };
      }
    }
    const to = Array.isArray(m.to) ? m.to.map(String) : typeof m.to === 'string' ? [m.to] : [];
    const item: MailItem = {
      id: m.message_id as string,
      from: String(m.from ?? ''),
      to,
      subject: String(m.subject ?? ''),
      received_at: m.timestamp as string,
      body_text: '',
      attachments: (Array.isArray(m.attachments) ? m.attachments : []).map((a) => ({
        name: String(a?.filename ?? 'attachment'),
        size: typeof a?.size === 'number' ? a.size : 0,
      })),
    };
    if (text === null) {
      item.html_only = true;
    } else {
      const capped = capUtf8(redactPatterns(text, MAIL_BASE_PATTERNS), MAIL_BODY_MAX_BYTES);
      item.body_text = capped.text;
      if (capped.truncated) item.truncated = true;
    }
    items.push(item);

    // One row per provider message on first delivery; the unique index turns a
    // second delivery into 'duplicate', which is not an error.
    await deps.insertMail({
      agent_id: caller.agentId,
      direction: 'in',
      to_json: to,
      subject: item.subject,
      body_sha256: sha256Hex(text ?? ''),
      provider_id: item.id,
      at: item.received_at,
      refused_reason: null,
    });
  }

  const nextCursor = items.length > 0 ? items[items.length - 1].received_at : cursor;
  return { status: 200, body: { messages: items, next_cursor: nextCursor } };
}

// ─── the live collaborators ──────────────────────────────────────────────────

export function liveMailDeps(): MailDeps {
  return {
    now: () => new Date(),
    newId: () => randomUUID(),
    enforce: (input, times) => enforceRateLimitTimes(input, times),
    loadSender: async (agentId) => {
      const admin = antennaAdmin();
      const { data: agent, error } = await admin.from('agents').select('name, is_staff').eq('id', agentId).maybeSingle();
      if (error) {
        console.error('antenna: mail sender lookup failed', error.message);
        throw new BeeError(500, 'internal_error', 'sender lookup failed');
      }
      const a = agent as { name: string | null; is_staff: boolean | null } | null;
      if (!a || !a.name) throw new BeeError(404, 'not_found', 'no such bee');
      const { data: member, error: memberErr } = await admin
        .from('members')
        .select('email')
        .eq('agent_id', agentId)
        .limit(1)
        .maybeSingle();
      if (memberErr) {
        console.error('antenna: mail human lookup failed', memberErr.message);
        throw new BeeError(500, 'internal_error', 'sender lookup failed');
      }
      const email = (member as { email: string | null } | null)?.email ?? null;
      return { name: a.name, is_staff: a.is_staff === true, human_email: email };
    },
    insertMail: async (row) => {
      try {
        const { error } = await antennaAdmin().from('bee_mail').insert(row);
        if (!error) return 'inserted';
        if ((error as { code?: string }).code === '23505') return 'duplicate';
        console.error('antenna: bee_mail insert failed', error.message);
        return 'failed';
      } catch (e) {
        console.error('antenna: bee_mail insert threw', e);
        return 'failed';
      }
    },
    updateMail: async (id, patch) => {
      try {
        const { error } = await antennaAdmin().from('bee_mail').update(patch).eq('id', id);
        if (error) console.error('antenna: bee_mail update failed', error.message);
      } catch (e) {
        console.error('antenna: bee_mail update threw', e);
      }
    },
    writeEvent: writeBeeEvent,
    sendMail,
    listMail,
    getMail,
  };
}
