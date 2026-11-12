// tests/antenna/antenna-006.test.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — the server-side self-test for ANTENNA-006 (the mail lane).
//
// Run:  npx tsc -p tests/antenna/tsconfig.json --outDir .antenna-test-dist \
//       && node --test '.antenna-test-dist/**/*.test.js'
//
// REAL    — lib/antenna/mail.ts (checkRecipients, the patterns, mailSend, mailRead),
//           lib/antenna/agentmail.ts (with fetch injected), public-silence.ts,
//           mail-footer.ts, and verifyBeeToken for the no-token case.
// STUBBED — the provider (no network, no key) and the database, through MailDeps.
// ----------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getMail, listMail, MailProviderError, sendMail, type ProviderMessage } from '../../lib/antenna/agentmail';
import { verifyBeeToken } from '../../lib/antenna/auth';
import { BeeError } from '../../lib/antenna/errors';
import type { BeeEventInput } from '../../lib/antenna/events';
import { BEE_MAIL_FOOTER_TEMPLATE } from '../../lib/antenna/mail-footer';
import {
  checkRecipients,
  composeMailText,
  firstPatternMatch,
  mailRead,
  mailSend,
  MAIL_BASE_PATTERNS,
  MAIL_EXTRA_PATTERNS,
  sha256Hex,
  type BeeMailRow,
  type MailDeps,
} from '../../lib/antenna/mail';
import {
  isPublicSilenceActive,
  PUBLIC_SILENCE_REASON,
  PUBLIC_SILENCE_UNTIL_ISO,
  PUBLIC_SILENCE_UNTIL_TEXT,
} from '../../lib/antenna/public-silence';
import { BEE_LIMITS, type EnforceInput } from '../../lib/antenna/rate-limit';

const REPO = join(__dirname, '..', '..', '..');
const HUMAN = 'jennifer@example.com';
const BEFORE = new Date('2026-11-12T22:00:00Z');
const AFTER = new Date('2027-01-13T00:00:00Z');

function rc(to: string[], opts: { isStaff?: boolean; now?: Date } = {}) {
  return checkRecipients({ to, humanEmail: HUMAN, isStaff: opts.isStaff ?? false, now: opts.now ?? BEFORE });
}

// ─── checkRecipients ──────────────────────────────────────────────────────────
test('recipients: the human is ok', () => assert.equal(rc([HUMAN]), 'ok'));
test('recipients: the human in mixed case is ok', () => assert.equal(rc(['  Jennifer@Example.COM ']), 'ok'));
test('recipients: x@bees.openthehive.ai is ok', () => assert.equal(rc(['x@bees.openthehive.ai']), 'ok'));
test('recipients: x@openthehive.ai is ok', () => assert.equal(rc(['x@openthehive.ai']), 'ok'));
test('recipients: esmeralda@openthehive.ai is refused', () =>
  assert.deepEqual(rc(['esmeralda@openthehive.ai']), { reason: 'recipient_not_mailable', address: 'esmeralda@openthehive.ai' }));
test('recipients: Esmeralda+ops@OpenTheHive.ai is refused', () =>
  assert.deepEqual(rc(['Esmeralda+ops@OpenTheHive.ai']), { reason: 'recipient_not_mailable', address: 'Esmeralda+ops@OpenTheHive.ai' }));
test('recipients: an outside address is refused before the date', () =>
  assert.deepEqual(rc(['someone@example.org']), { reason: PUBLIC_SILENCE_REASON, address: 'someone@example.org' }));
test('recipients: an outside address is ok after the date (injected now)', () =>
  assert.equal(rc(['someone@example.org'], { now: AFTER }), 'ok'));
test('recipients: an outside address is ok for staff', () =>
  assert.equal(rc(['someone@example.org'], { isStaff: true }), 'ok'));
test('recipients: x@openthehive.ai.example.com is outside', () =>
  assert.deepEqual(rc(['x@openthehive.ai.example.com']), { reason: PUBLIC_SILENCE_REASON, address: 'x@openthehive.ai.example.com' }));
test('recipients: five colony addresses are ok', () =>
  assert.equal(rc(['a@openthehive.ai', 'b@openthehive.ai', 'c@bees.openthehive.ai', 'd@bees.openthehive.ai', HUMAN]), 'ok'));
test('recipients: six are refused', () =>
  assert.deepEqual(rc(['a@openthehive.ai', 'b@openthehive.ai', 'c@openthehive.ai', 'd@openthehive.ai', 'e@openthehive.ai', 'f@openthehive.ai']),
    { reason: 'too_many_recipients', address: null }));
test('recipients: none is refused', () => assert.deepEqual(rc([]), { reason: 'too_many_recipients', address: null }));
test('recipients: a duplicate after normalizing is refused', () =>
  assert.deepEqual(rc(['a@openthehive.ai', ' A@OpenTheHive.ai']), { reason: 'duplicate_recipient', address: ' A@OpenTheHive.ai' }));
test('recipients: display-name form is refused', () => {
  assert.deepEqual(rc(['Jen <jennifer@example.com>']), { reason: 'invalid_recipient', address: 'Jen <jennifer@example.com>' });
  assert.deepEqual(rc(['<x@openthehive.ai>']), { reason: 'invalid_recipient', address: '<x@openthehive.ai>' });
  assert.deepEqual(rc(['a@openthehive.ai,b@openthehive.ai']), { reason: 'invalid_recipient', address: 'a@openthehive.ai,b@openthehive.ai' });
});
test('recipients: CR/LF is refused, even at the ends', () => {
  assert.deepEqual(rc(['x@openthehive.ai\r\nBcc: y@example.org']), { reason: 'invalid_recipient', address: 'x@openthehive.ai\r\nBcc: y@example.org' });
  assert.deepEqual(rc(['x@openthehive.ai\n']), { reason: 'invalid_recipient', address: 'x@openthehive.ai\n' });
});

// ─── the date, one home ───────────────────────────────────────────────────────
test('public silence: the text form is Tue Jan 12, 2027', () => assert.equal(PUBLIC_SILENCE_UNTIL_TEXT, 'Tue Jan 12, 2027'));
test('public silence: the reason ends with the ISO date', () => {
  assert.equal(PUBLIC_SILENCE_UNTIL_ISO, '2027-01-12');
  assert.ok(PUBLIC_SILENCE_REASON.endsWith('2027-01-12'));
  assert.equal(PUBLIC_SILENCE_REASON, 'public_silence_until_2027-01-12');
});
test('public silence: the boundary is 2027-01-12T05:00:00Z', () => {
  assert.equal(isPublicSilenceActive(new Date('2027-01-12T04:59:59.999Z')), true);
  assert.equal(isPublicSilenceActive(new Date('2027-01-12T05:00:00Z')), false);
});
test('SKILL.md carries the date as PUBLIC_SILENCE_UNTIL_TEXT and does not quote the footer', () => {
  const skill = readFileSync(join(REPO, 'antenna', 'templates', 'SKILL.md'), 'utf8');
  assert.ok(skill.includes(`No other address before ${PUBLIC_SILENCE_UNTIL_TEXT}.`));
  assert.ok(!skill.includes(BEE_MAIL_FOOTER_TEMPLATE.slice(0, 30)));
  assert.ok(!skill.includes('the colony where AI agents'));
});

// ─── footer and patterns ──────────────────────────────────────────────────────
test('footer: substituted with the agent name and appended once', () => {
  const text = composeMailText('Hello Jennifer.', 'Echo');
  assert.ok(text.startsWith('Hello Jennifer.\n\n-- \nSent by Echo, a bee of The Hive'));
  assert.equal(text.split('Sent by').length - 1, 1);
  assert.ok(!text.includes('{bee}'));
});
test('F3: the base ten equal the ten in the /reply route file', () => {
  const src = readFileSync(join(REPO, 'app', 'api', 'bee', 'reply', 'route.ts'), 'utf8');
  const block = /const CREDENTIAL_PATTERNS[^=]*=\s*\[([\s\S]*?)\n\];/.exec(src);
  assert.ok(block, 'CREDENTIAL_PATTERNS block not found in the /reply route');
  const fromRoute: Array<[string, string]> = [];
  const entry = /\['([a-z_]+)',\s*\/(.+)\/\],/g;
  let m: RegExpExecArray | null;
  while ((m = entry.exec(block[1])) !== null) fromRoute.push([m[1], m[2]]);
  assert.equal(fromRoute.length, 10);
  assert.deepEqual(MAIL_BASE_PATTERNS.map(([n, re]) => [n, re.source]), fromRoute);
});
test('patterns: a 64-hex token is caught on send', () =>
  assert.equal(firstPatternMatch('key: ' + 'ab'.repeat(32), MAIL_EXTRA_PATTERNS), 'hex64'));
test('patterns: a line of 12 or 24 lowercase words is caught; 11 or a sentence is not', () => {
  const w = (n: number) => Array.from({ length: n }, (_, i) => 'word' + 'abcdefghijklmnopqrstuvwxyz'[i]).join(' ');
  assert.equal(firstPatternMatch('hi\n' + w(12) + '\nbye', MAIL_EXTRA_PATTERNS), 'word_list');
  assert.equal(firstPatternMatch(w(24), MAIL_EXTRA_PATTERNS), 'word_list');
  assert.equal(firstPatternMatch(w(11), MAIL_EXTRA_PATTERNS), null);
  assert.equal(firstPatternMatch(w(13), MAIL_EXTRA_PATTERNS), null);
  assert.equal(firstPatternMatch('I flew twelve laps of the hive today and the light was good, thanks.', MAIL_EXTRA_PATTERNS), null);
});
test('patterns: a path ending in wallet.json is caught', () =>
  assert.equal(firstPatternMatch('see ~/.config/agent/wallet.json for it', MAIL_EXTRA_PATTERNS), 'wallet_path'));
test('patterns: a sha256 in a /reply body is still accepted (the extra three are mail only)', () => {
  const src = readFileSync(join(REPO, 'app', 'api', 'bee', 'reply', 'route.ts'), 'utf8');
  assert.ok(!src.includes('MAIL_EXTRA_PATTERNS') && !src.includes('[0-9a-fA-F]{64}'));
  const sha = sha256Hex('a reply that quotes a digest');
  assert.equal(firstPatternMatch(`the digest is ${sha}`, MAIL_BASE_PATTERNS), null);
});

// ─── the adapter ──────────────────────────────────────────────────────────────
const FAKE_KEY = 'test-placeholder-not-a-key';

function withKey<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.AGENTMAIL_API_KEY;
  if (value === undefined) delete process.env.AGENTMAIL_API_KEY;
  else process.env.AGENTMAIL_API_KEY = value;
  return fn().finally(() => {
    if (prev === undefined) delete process.env.AGENTMAIL_API_KEY;
    else process.env.AGENTMAIL_API_KEY = prev;
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('adapter: no key → provider_unavailable and no request made', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse(200, {});
  };
  for (const key of [undefined, '']) {
    await withKey(key, async () => {
      await assert.rejects(sendMail({ inbox: 'echo@bees.openthehive.ai', to: [HUMAN], subject: 's', text: 't' }, { fetchImpl }),
        (e: unknown) => e instanceof MailProviderError && e.reason === 'provider_unavailable');
      await assert.rejects(listMail({ inbox: 'echo@bees.openthehive.ai', after: BEFORE.toISOString() }, { fetchImpl }),
        (e: unknown) => e instanceof MailProviderError && e.reason === 'provider_unavailable');
    });
  }
  assert.equal(calls, 0);
});
test('adapter: a 404 maps to no_inbox', async () => {
  await withKey(FAKE_KEY, async () => {
    await assert.rejects(
      listMail({ inbox: 'echo@bees.openthehive.ai', after: BEFORE.toISOString() }, { fetchImpl: async () => jsonResponse(404, { name: 'NotFound' }) }),
      (e: unknown) => e instanceof MailProviderError && e.reason === 'no_inbox');
  });
});
test("adapter: the request goes to the bee's own inbox id, with the key only in the header", async () => {
  const seen: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    return jsonResponse(200, { message_id: 'm-1' });
  };
  await withKey(FAKE_KEY, async () => {
    const r = await sendMail({ inbox: 'echo@bees.openthehive.ai', to: [HUMAN], subject: 'Hi', text: 'Body' }, { fetchImpl });
    assert.equal(r.message_id, 'm-1');
  });
  assert.equal(seen.length, 1);
  assert.ok(seen[0].url.endsWith('/inboxes/echo%40bees.openthehive.ai/messages/send'));
  assert.ok(!seen[0].url.includes(FAKE_KEY));
  assert.equal((seen[0].init?.headers as Record<string, string>).Authorization, `Bearer ${FAKE_KEY}`);
  assert.deepEqual(JSON.parse(String(seen[0].init?.body)), { to: [HUMAN], subject: 'Hi', text: 'Body' });
  assert.ok(!String(seen[0].init?.body).includes(FAKE_KEY));
});
test('adapter: the key is absent from every thrown message', async () => {
  const faults: Array<(u: string, i?: RequestInit) => Promise<Response>> = [
    async () => jsonResponse(500, { error: `bad key ${FAKE_KEY}` }),
    async () => jsonResponse(404, {}),
    async () => { throw new Error(`network down for Bearer ${FAKE_KEY}`); },
    async () => new Response('not json', { status: 200 }),
  ];
  await withKey(FAKE_KEY, async () => {
    for (const fetchImpl of faults) {
      for (const run of [
        () => sendMail({ inbox: 'echo@bees.openthehive.ai', to: [HUMAN], subject: 's', text: 't' }, { fetchImpl }),
        () => listMail({ inbox: 'echo@bees.openthehive.ai', after: BEFORE.toISOString() }, { fetchImpl }),
        () => getMail({ inbox: 'echo@bees.openthehive.ai', message_id: 'm' }, { fetchImpl }),
      ]) {
        try {
          await run();
          assert.fail('expected a throw');
        } catch (e) {
          assert.ok(e instanceof MailProviderError);
          assert.ok(!String((e as Error).message).includes(FAKE_KEY));
          assert.ok(!String((e as Error).stack).includes(FAKE_KEY));
        }
      }
    }
  });
});

// ─── route handlers with mocked collaborators ─────────────────────────────────
interface Fake {
  deps: MailDeps;
  rows: BeeMailRow[];
  events: BeeEventInput[];
  hits: Record<string, number>;
  sent: Array<{ inbox: string; to: string[]; subject: string; text: string }>;
}

function fake(opts: {
  sender?: { name: string; is_staff: boolean; human_email: string | null };
  sendFails?: 'provider_unavailable' | 'no_inbox';
  listed?: ProviderMessage[];
  full?: Record<string, ProviderMessage>;
  limits?: Partial<Record<string, number>>;
  now?: Date;
} = {}): Fake {
  const rows: BeeMailRow[] = [];
  const events: BeeEventInput[] = [];
  const hits: Record<string, number> = {};
  const sent: Fake['sent'] = [];
  let n = 0;
  const deps: MailDeps = {
    now: () => opts.now ?? BEFORE,
    newId: () => `row-${++n}`,
    enforce: async (input: EnforceInput, times: number) => {
      for (let i = 0; i < times; i++) {
        hits[input.scope] = (hits[input.scope] ?? 0) + 1;
        const limit = opts.limits?.[input.scope] ?? BEE_LIMITS[input.scope].limit;
        if (hits[input.scope] > limit) throw new BeeError(429, 'rate_limited', `rate limit exceeded for ${input.scope}`, 1);
      }
    },
    loadSender: async () => opts.sender ?? { name: 'Echo', is_staff: false, human_email: HUMAN },
    insertMail: async (row) => {
      if (row.provider_id && rows.some((r) => r.agent_id === row.agent_id && r.direction === row.direction && r.provider_id === row.provider_id)) {
        return 'duplicate';
      }
      rows.push({ ...row });
      return 'inserted';
    },
    updateMail: async (id, patch) => {
      const r = rows.find((x) => x.id === id);
      if (r) Object.assign(r, patch);
    },
    writeEvent: async (e) => {
      events.push(e);
    },
    sendMail: async (input) => {
      if (opts.sendFails) throw new MailProviderError(opts.sendFails);
      sent.push(input);
      return { message_id: `prov-${sent.length}` };
    },
    listMail: async () => opts.listed ?? [],
    getMail: async ({ message_id }) => opts.full?.[message_id] ?? { message_id },
  };
  return { deps, rows, events, hits, sent };
}

const CALLER = { agentId: 'agent-echo', tokenId: 'tok-echo', ip: '203.0.113.9' };

test('send route: no token → 401 from the one verifier', async () => {
  await assert.rejects(verifyBeeToken({ headers: { get: () => null } }), (e: unknown) => e instanceof BeeError && e.status === 401);
  const src = readFileSync(join(REPO, 'app', 'api', 'bee', 'mail', 'send', 'route.ts'), 'utf8');
  assert.match(src, /export async function POST\(req: NextRequest\) \{\s*try \{\s*const bee = await verifyBeeToken\(req\);/);
  const read = readFileSync(join(REPO, 'app', 'api', 'bee', 'mail', 'route.ts'), 'utf8');
  assert.match(read, /export async function GET\(req: NextRequest\) \{\s*try \{\s*const bee = await verifyBeeToken\(req\);/);
});
test('send route: a bad schema is 400 (the /reply precedent), and nothing is sent', async () => {
  const f = fake();
  for (const raw of [
    { to: [HUMAN], subject: 's', body_text: 'b', from: 'esmeralda@openthehive.ai' },
    { to: HUMAN, subject: 's', body_text: 'b' },
    { to: [HUMAN], subject: 's' },
    'not an object',
  ]) {
    const r = await mailSend(CALLER, raw, f.deps);
    assert.equal(r.status, 400);
  }
  assert.equal(f.sent.length, 0);
});
test('send route: an oversize body is 413, with a refused row', async () => {
  const f = fake();
  const r = await mailSend(CALLER, { to: [HUMAN], subject: 's', body_text: 'é'.repeat(16 * 1024 + 1) }, f.deps);
  assert.equal(r.status, 413);
  assert.equal(r.body.reason, 'body_too_large');
  assert.equal(f.sent.length, 0);
  assert.equal(f.rows[0].refused_reason, 'body_too_large');
});
test('send route: a refusal writes a row and a mail_refused event, and returns 422 with the reason', async () => {
  const f = fake();
  const r = await mailSend(CALLER, { to: ['esmeralda@openthehive.ai'], subject: 'hi', body_text: 'hello' }, f.deps);
  assert.equal(r.status, 422);
  assert.deepEqual(r.body, { reason: 'recipient_not_mailable', address: 'esmeralda@openthehive.ai' });
  assert.equal(f.rows.length, 1);
  assert.equal(f.rows[0].direction, 'out');
  assert.equal(f.rows[0].refused_reason, 'recipient_not_mailable');
  assert.deepEqual(f.events.map((e) => e.event), ['mail_refused']);
  assert.equal(f.sent.length, 0);
});
test('send route: one outside address among five refuses the whole send, names it, sends nothing', async () => {
  const f = fake();
  const to = ['a@openthehive.ai', HUMAN, 'outside@example.net', 'b@bees.openthehive.ai', 'c@openthehive.ai'];
  const r = await mailSend(CALLER, { to, subject: 'hi', body_text: 'hello' }, f.deps);
  assert.equal(r.status, 422);
  assert.deepEqual(r.body, { reason: 'public_silence_until_2027-01-12', address: 'outside@example.net' });
  assert.equal(f.sent.length, 0);
});
test('send route: a five-address send consumes five from the rate bucket', async () => {
  const f = fake();
  const to = ['a@openthehive.ai', 'b@openthehive.ai', 'c@openthehive.ai', 'd@openthehive.ai', HUMAN];
  const r = await mailSend(CALLER, { to, subject: 'hi', body_text: 'hello' }, f.deps);
  assert.equal(r.status, 200);
  assert.equal(f.hits.mail_send_hour, 5);
  assert.equal(f.hits.mail_send_day, 5);
  assert.equal(f.hits.mail_send_ip, 1);
  // Ten per hour: a second five fits, a third does not.
  assert.equal((await mailSend(CALLER, { to, subject: 'hi', body_text: 'again' }, f.deps)).status, 200);
  await assert.rejects(mailSend(CALLER, { to, subject: 'hi', body_text: 'third' }, f.deps), (e: unknown) => e instanceof BeeError && e.status === 429);
  assert.equal(f.sent.length, 2);
});
test('send route: each of the three extra patterns is refused as credential_pattern', async () => {
  const bodies = [
    'my key ' + 'cd'.repeat(32),
    'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima',
    'it is in /home/echo/.agent/wallet.json',
  ];
  for (const body_text of bodies) {
    const f = fake();
    const r = await mailSend(CALLER, { to: [HUMAN], subject: 'hi', body_text }, f.deps);
    assert.equal(r.status, 422);
    assert.deepEqual(r.body, { reason: 'credential_pattern' });
    assert.equal(f.sent.length, 0);
    assert.equal(f.events[0].event, 'mail_refused');
  }
});
test('send route: a subject over 200 characters or over one line is refused', async () => {
  const f = fake();
  assert.equal((await mailSend(CALLER, { to: [HUMAN], subject: 'x'.repeat(201), body_text: 'b' }, f.deps)).body.reason, 'subject_too_long');
  assert.equal((await mailSend(CALLER, { to: [HUMAN], subject: 'a\nBcc: x@example.org', body_text: 'b' }, f.deps)).body.reason, 'subject_not_one_line');
  assert.equal(f.sent.length, 0);
});
test('send route: success writes a row with body_sha256 and a mail_sent event, footer once, 200 { id, sent_at }', async () => {
  const f = fake();
  const body_text = 'Hello Jennifer — one true thing about my first hours.';
  const r = await mailSend(CALLER, { to: [' Jennifer@Example.com'], subject: 'From Echo', body_text }, f.deps);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { id: 'row-1', sent_at: BEFORE.toISOString() });
  assert.equal(f.rows.length, 1);
  const row = f.rows[0];
  assert.equal(row.direction, 'out');
  assert.equal(row.body_sha256, sha256Hex(body_text));
  assert.equal(row.provider_id, 'prov-1');
  assert.equal(row.refused_reason, null);
  assert.deepEqual(row.to_json, [HUMAN]);
  assert.deepEqual(f.events.map((e) => e.event), ['mail_sent']);
  assert.equal(f.sent[0].text, composeMailText(body_text, 'Echo'));
  assert.equal(f.sent[0].text.split('Sent by Echo').length - 1, 1);
});
test('send route: the sender address is never read from the body', async () => {
  const f = fake();
  const r = await mailSend(CALLER, { to: [HUMAN], subject: 's', body_text: 'b', inbox: 'esmeralda@openthehive.ai' }, f.deps);
  assert.equal(r.status, 400);
  const ok = await mailSend(CALLER, { to: [HUMAN], subject: 's', body_text: 'b' }, f.deps);
  assert.equal(ok.status, 200);
  assert.equal(f.sent[0].inbox, 'echo@bees.openthehive.ai');
  const src = readFileSync(join(REPO, 'lib', 'antenna', 'mail.ts'), 'utf8');
  assert.ok(!/body\.(from|inbox|sender)/.test(src));
});
test('send route: provider failure is 502 provider_unavailable, with the same row', async () => {
  const f = fake({ sendFails: 'provider_unavailable' });
  const r = await mailSend(CALLER, { to: [HUMAN], subject: 's', body_text: 'b' }, f.deps);
  assert.equal(r.status, 502);
  assert.deepEqual(r.body, { reason: 'provider_unavailable' });
  assert.equal(f.rows.length, 1);
  assert.equal(f.rows[0].refused_reason, 'provider_unavailable');
  assert.deepEqual(f.events.map((e) => e.event), ['mail_refused']);
});
test('send route: no handler result is ever 403', async () => {
  const f = fake();
  const results = await Promise.all([
    mailSend(CALLER, { to: ['esmeralda@openthehive.ai'], subject: 's', body_text: 'b' }, f.deps),
    mailSend(CALLER, { to: ['x@example.org'], subject: 's', body_text: 'b' }, f.deps),
  ]);
  for (const r of results) assert.notEqual(r.status, 403);
});

// ─── mail.read ────────────────────────────────────────────────────────────────
function msg(id: string, ts: string, extra: Partial<ProviderMessage> = {}): ProviderMessage {
  return { message_id: id, timestamp: ts, from: 'Jennifer <jennifer@example.com>', to: ['echo@bees.openthehive.ai'], subject: `s-${id}`, extracted_text: `text ${id}`, ...extra };
}

test('read route: the cursor advances to the newest delivered timestamp; absent = now', async () => {
  const f = fake({
    listed: [msg('m2', '2026-11-12T23:00:02Z'), msg('m1', '2026-11-12T23:00:01Z'), msg('old', '2026-11-12T21:00:00Z')],
  });
  const first = await mailRead(CALLER, new URLSearchParams(''), f.deps);
  assert.equal(first.status, 200);
  const firstMsgs = first.body.messages as Array<{ id: string }>;
  assert.deepEqual(firstMsgs.map((m) => m.id), ['m1', 'm2']);
  assert.equal(first.body.next_cursor, '2026-11-12T23:00:02Z');

  const again = await mailRead(CALLER, new URLSearchParams({ cursor: '2026-11-12T23:00:02Z' }), f.deps);
  assert.deepEqual(again.body.messages, []);
  assert.equal(again.body.next_cursor, '2026-11-12T23:00:02Z');
});
test("read route: the bee's own sent mail is left out", async () => {
  const f = fake({ listed: [msg('self', '2026-11-12T23:00:01Z', { from: 'Echo <echo@bees.openthehive.ai>' }), msg('m1', '2026-11-12T23:00:02Z')] });
  const r = await mailRead(CALLER, new URLSearchParams(), f.deps);
  assert.deepEqual((r.body.messages as Array<{ id: string }>).map((m) => m.id), ['m1']);
});
test('read route: a message with no text is html_only with an empty body (fetched once first)', async () => {
  const f = fake({
    listed: [msg('h1', '2026-11-12T23:00:01Z', { extracted_text: undefined, text: undefined })],
    full: { h1: { message_id: 'h1', html: '<p>hi</p>' } },
  });
  const r = await mailRead(CALLER, new URLSearchParams(), f.deps);
  const m = (r.body.messages as Array<Record<string, unknown>>)[0];
  assert.equal(m.body_text, '');
  assert.equal(m.html_only, true);
});
test('read route: a listed message without text is fetched for it', async () => {
  const f = fake({
    listed: [msg('t1', '2026-11-12T23:00:01Z', { extracted_text: undefined, text: undefined })],
    full: { t1: { message_id: 't1', text: 'the full text' } },
  });
  const r = await mailRead(CALLER, new URLSearchParams(), f.deps);
  assert.equal((r.body.messages as Array<Record<string, unknown>>)[0].body_text, 'the full text');
});
test('read route: a body over 32 KB is truncated and flagged; credentials are replaced', async () => {
  // Built at run time so no credential-shaped literal sits in the source.
  const fakeToken = ['hive', 'bee', 'ABCDEFGHIJKL'].join('_');
  const f = fake({
    listed: [msg('big', '2026-11-12T23:00:01Z', { extracted_text: 'token ' + fakeToken + ' ' + 'x'.repeat(40_000) })],
  });
  const r = await mailRead(CALLER, new URLSearchParams(), f.deps);
  const m = (r.body.messages as Array<Record<string, unknown>>)[0];
  assert.equal(m.truncated, true);
  assert.ok(Buffer.byteLength(String(m.body_text), 'utf8') <= 32 * 1024);
  assert.ok(!String(m.body_text).includes(fakeToken));
  assert.ok(String(m.body_text).startsWith('token [credential removed by Antenna]'));
});
test('read route: attachments are names and sizes only', async () => {
  const f = fake({
    listed: [msg('a1', '2026-11-12T23:00:01Z', { attachments: [{ filename: 'plan.pdf', size: 1234, attachment_id: 'x', url: 'https://example.invalid/x' } as never] })],
  });
  const r = await mailRead(CALLER, new URLSearchParams(), f.deps);
  assert.deepEqual((r.body.messages as Array<Record<string, unknown>>)[0].attachments, [{ name: 'plan.pdf', size: 1234 }]);
});
test('read route: a duplicate provider message yields one row', async () => {
  const dup = msg('d1', '2026-11-12T23:00:01Z');
  const f = fake({ listed: [dup, { ...dup }] });
  const r = await mailRead(CALLER, new URLSearchParams(), f.deps);
  assert.equal((r.body.messages as unknown[]).length, 1);
  // A second read from an older cursor redelivers it; the unique rule keeps one row.
  await mailRead(CALLER, new URLSearchParams(), f.deps);
  assert.equal(f.rows.filter((x) => x.provider_id === 'd1').length, 1);
  assert.equal(f.rows[0].direction, 'in');
});
test('read route: at most 10 per read, oldest first', async () => {
  const listed: ProviderMessage[] = [];
  for (let i = 14; i >= 0; i--) listed.push(msg(`m${String(i).padStart(2, '0')}`, `2026-11-12T23:00:${String(i + 10).padStart(2, '0')}Z`));
  const f = fake({ listed });
  const r = await mailRead(CALLER, new URLSearchParams(), f.deps);
  const ids = (r.body.messages as Array<{ id: string }>).map((m) => m.id);
  assert.equal(ids.length, 10);
  assert.equal(ids[0], 'm00');
  assert.equal(ids[9], 'm09');
  assert.equal(r.body.next_cursor, '2026-11-12T23:00:19Z');
});
test('read route: a bad cursor or an extra query key is 400', async () => {
  const f = fake();
  assert.equal((await mailRead(CALLER, new URLSearchParams({ cursor: 'yesterday' }), f.deps)).status, 400);
  assert.equal((await mailRead(CALLER, new URLSearchParams({ cursor: '2026-11-12T23:00:00Z', inbox: 'x' }), f.deps)).status, 400);
});
