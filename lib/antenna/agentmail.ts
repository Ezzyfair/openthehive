// lib/antenna/agentmail.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — the mail provider adapter (ANTENNA-006 item 3, F1).
//
// The ONLY file that names the provider's host. Plain REST over fetch, no package.
// If the first real call shows a field named differently from the provider's
// public reference, the fix is in this file alone.
//
//   send   POST /inboxes/<inbox_id>/messages/send   { to: [..], subject, text }
//   list   GET  /inboxes/<inbox_id>/messages?limit&page_token&after
//   get    GET  /inboxes/<inbox_id>/messages/<message_id>
//
// An inbox's id is its address. The caller passes the address deriveInbox()
// returned for the token's own agent; nothing here reads an address from a body.
//
// The key is read from process.env at CALL time, never at module scope. Absent
// or empty, every function fails closed with `provider_unavailable` before any
// request is made. The key never appears in a log line, a thrown message or a row.
// 10-second timeout per request, no retry.
// ----------------------------------------------------------------------------

const PROVIDER_BASE = 'https://api.agentmail.to/v0';
const TIMEOUT_MS = 10_000;
/** Page size asked of the provider, and how many pages one listMail may walk. */
const LIST_PAGE_SIZE = 50;
const LIST_MAX_PAGES = 5;

export type MailProviderReason = 'provider_unavailable' | 'no_inbox';

export class MailProviderError extends Error {
  readonly reason: MailProviderReason;
  constructor(reason: MailProviderReason) {
    // The message is the reason and nothing else: no URL, no header, no key.
    super(reason);
    this.name = 'MailProviderError';
    this.reason = reason;
  }
}

/** One message as the provider lists it. Every field is optional on purpose. */
export interface ProviderMessage {
  message_id?: string;
  timestamp?: string;
  from?: string;
  to?: string[] | string;
  subject?: string;
  extracted_text?: string | null;
  text?: string | null;
  attachments?: Array<{ filename?: string; size?: number }>;
  [k: string]: unknown;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AdapterOptions {
  /** Test seam. Defaults to the global fetch, read at call time. */
  fetchImpl?: FetchLike;
}

function apiKey(): string {
  const key = process.env.AGENTMAIL_API_KEY;
  if (!key) throw new MailProviderError('provider_unavailable');
  return key;
}

function inboxPath(inbox: string): string {
  return `${PROVIDER_BASE}/inboxes/${encodeURIComponent(inbox)}`;
}

async function call(
  url: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
  opts?: AdapterOptions,
): Promise<Record<string, unknown>> {
  const key = apiKey();
  const doFetch: FetchLike = opts?.fetchImpl ?? ((i, n) => fetch(i, n));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await doFetch(url, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch {
    // Network fault or the 10 s timeout. The caught error is not logged: it can
    // carry the request, and the request carries the key.
    throw new MailProviderError('provider_unavailable');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404) throw new MailProviderError('no_inbox');
  if (!res.ok) {
    console.error('antenna: mail provider answered', res.status);
    throw new MailProviderError('provider_unavailable');
  }
  try {
    const body = (await res.json()) as unknown;
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    throw new MailProviderError('provider_unavailable');
  }
}

/** Sends a text-only message from `inbox`. Returns the provider's message id. */
export async function sendMail(
  input: { inbox: string; to: string[]; subject: string; text: string },
  opts?: AdapterOptions,
): Promise<{ message_id: string }> {
  const body = await call(
    `${inboxPath(input.inbox)}/messages/send`,
    { method: 'POST', body: { to: input.to, subject: input.subject, text: input.text } },
    opts,
  );
  const id = body.message_id;
  if (typeof id !== 'string' || !id) throw new MailProviderError('provider_unavailable');
  return { message_id: id };
}

/**
 * Lists messages in `inbox` after `after` (an ISO timestamp). The provider pages
 * newest first; this walks at most LIST_MAX_PAGES pages and returns everything it
 * saw, in the provider's order. The caller sorts and caps.
 */
export async function listMail(
  input: { inbox: string; after: string; limit?: number },
  opts?: AdapterOptions,
): Promise<ProviderMessage[]> {
  const out: ProviderMessage[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < LIST_MAX_PAGES; page++) {
    const q = new URLSearchParams();
    q.set('limit', String(input.limit ?? LIST_PAGE_SIZE));
    q.set('after', input.after);
    if (pageToken) q.set('page_token', pageToken);
    const body = await call(`${inboxPath(input.inbox)}/messages?${q.toString()}`, { method: 'GET' }, opts);
    const msgs = Array.isArray(body.messages) ? (body.messages as ProviderMessage[]) : [];
    out.push(...msgs);
    const next = body.next_page_token;
    if (typeof next !== 'string' || !next) break;
    pageToken = next;
  }
  return out;
}

/** Fetches one message, for a listed message that carried no text. */
export async function getMail(
  input: { inbox: string; message_id: string },
  opts?: AdapterOptions,
): Promise<ProviderMessage> {
  return (await call(
    `${inboxPath(input.inbox)}/messages/${encodeURIComponent(input.message_id)}`,
    { method: 'GET' },
    opts,
  )) as ProviderMessage;
}
