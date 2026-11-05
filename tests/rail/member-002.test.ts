// tests/rail/member-002.test.ts
// ----------------------------------------------------------------------------
// THE HIVE — MEMBER-002 item 7. Runs under the repo's one test command:
//   npm run test:rail
// It lives in tests/rail/ because that is the only test layout the repo has; it
// uses the same resolver and the same tsc → node --test pipeline, and touches no
// rail code.
//
// WHAT IS REAL AND WHAT IS STUBBED:
//   REAL    — lib/email/welcome.ts (sendWelcomeOnce, welcomeAfterCheckout, the body),
//             lib/member-auth.ts (formatCode, normalizeCode), lib/member-copy.ts, and
//             the server render of app/member/MemberDashboard.tsx and
//             app/member/login/page.tsx through react-dom/server.
//   STUBBED — sendEmail (a mock that records each call and writes the email_sends
//             row the real one writes) and the database (email_sends only).
//   SOURCE  — MemberChat's reply-box line is checked in the source, because the
//             view reaches the reply box only after a client-side fetch, which a
//             server render does not run.
// ----------------------------------------------------------------------------
import './resolver'; // MUST stay first: installs the '@/...' require hook.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';

import {
  WELCOME_SUBJECT,
  WELCOME_TEMPLATE,
  sendWelcomeOnce,
  welcomeAfterCheckout,
  welcomeHtml,
  welcomeText,
} from '@/lib/email/welcome';
import { formatCode, normalizeCode } from '@/lib/member-auth';
import { INBOX_LINE, REPLY_BOX_NOTE, personalChamberView } from '@/lib/member-copy';
import MemberDashboard from '@/app/member/MemberDashboard';
import MemberLoginPage from '@/app/member/login/page';

const nodeFs: any = require('node:fs');
const nodePath: any = require('node:path');
const { renderToStaticMarkup }: any = require('react-dom/server');

/** The repo root, from <dist>/tests/rail/. Source files are read from there, not from dist. */
const REPO_ROOT: string = nodePath.resolve(__dirname, '..', '..', '..');

// ── fakes ───────────────────────────────────────────────────────────────────

interface SendRow { to_email: string; template: string; status: string }

/** email_sends only: the select chain sendWelcomeOnce uses, and nothing else. */
function fakeDb(rows: SendRow[] = []) {
  return {
    rows,
    from(table: string) {
      assert.equal(table, 'email_sends');
      const filters: Record<string, string> = {};
      const q: any = {
        select: () => q,
        eq: (col: string, val: string) => {
          filters[col] = val;
          return q;
        },
        limit: async () => ({
          data: rows.filter((r) => Object.keys(filters).every((k) => (r as any)[k] === filters[k])).map(() => ({ id: 'x' })),
          error: null,
        }),
      };
      return q;
    },
  };
}

/** Mocked sendEmail: records the call and writes the log row the real door writes. */
function mockSend() {
  const calls: any[] = [];
  const fn: any = async (a: any) => {
    calls.push(a);
    a.supabase.rows.push({ to_email: a.to, template: a.template, status: 'sent' });
    return { sent: true };
  };
  return { fn, calls };
}

const checkoutEvent = (email: string | null) => ({
  type: 'checkout.session.completed',
  data: { object: { customer_email: email, metadata: { tier: 'worker' } } },
});

// ── item 1 · the welcome ────────────────────────────────────────────────────

test('MEMBER-002 · paid path: one handled checkout sends exactly one welcome', async () => {
  const db = fakeDb();
  const send = mockSend();
  const r = await welcomeAfterCheckout(db, checkoutEvent('Paid@Example.com'), { status: 200, body: { received: true } }, 'https://site.test', send.fn);
  assert.deepEqual(r, { sent: true });
  assert.equal(send.calls.length, 1);
  assert.equal(send.calls[0].to, 'paid@example.com');
  assert.equal(send.calls[0].subject, WELCOME_SUBJECT);
  assert.equal(send.calls[0].template, WELCOME_TEMPLATE);
});

test('MEMBER-002 · paid path: a quarantined, failed or non-checkout event sends nothing', async () => {
  const db = fakeDb();
  const send = mockSend();
  await welcomeAfterCheckout(db, checkoutEvent('a@example.com'), { status: 200, body: { quarantined: true } }, null, send.fn);
  await welcomeAfterCheckout(db, checkoutEvent('a@example.com'), { status: 500, body: {} }, null, send.fn);
  await welcomeAfterCheckout(db, { type: 'invoice.payment_succeeded', data: { object: {} } }, { status: 200, body: {} }, null, send.fn);
  assert.equal(send.calls.length, 0);
});

test('MEMBER-002 · Scout path: one creation sends exactly one welcome', async () => {
  const db = fakeDb();
  const send = mockSend();
  const r = await sendWelcomeOnce({ supabase: db, to: 'scout@example.com', site: 'https://site.test', agentId: 'agent-1' }, send.fn);
  assert.deepEqual(r, { sent: true });
  assert.equal(send.calls.length, 1);
  assert.equal(send.calls[0].agentId, 'agent-1');
});

test('MEMBER-002 · never twice: the same member event again, and Scout-then-paid, send once', async () => {
  const db = fakeDb();
  const send = mockSend();
  await sendWelcomeOnce({ supabase: db, to: 'one@example.com' }, send.fn);
  const again = await sendWelcomeOnce({ supabase: db, to: 'one@example.com' }, send.fn);
  const paid = await welcomeAfterCheckout(db, checkoutEvent('ONE@example.com'), { status: 200, body: {} }, null, send.fn);
  assert.equal(send.calls.length, 1);
  assert.deepEqual(again, { sent: false, reason: 'already_welcomed' });
  assert.deepEqual(paid, { sent: false, reason: 'already_welcomed' });
});

test('MEMBER-002 · a suppressed or skipped attempt is not a welcome; an unreadable log refuses', async () => {
  const db = fakeDb([{ to_email: 'two@example.com', template: WELCOME_TEMPLATE, status: 'skipped_no_env' }]);
  const send = mockSend();
  await sendWelcomeOnce({ supabase: db, to: 'two@example.com' }, send.fn);
  assert.equal(send.calls.length, 1);

  const broken: any = { from: () => ({ select: () => broken.q }), q: null };
  broken.q = { eq: () => broken.q, limit: async () => ({ data: null, error: { message: 'down' } }) };
  const send2 = mockSend();
  const r = await sendWelcomeOnce({ supabase: broken, to: 'three@example.com' }, send2.fn);
  assert.deepEqual(r, { sent: false, reason: 'log_unreadable' });
  assert.equal(send2.calls.length, 0);
});

test('MEMBER-002 · the welcome body names the recipient, in the ruled order, with no % and no $', () => {
  const to = 'member@example.com';
  for (const body of [welcomeText('https://openthehive.ai', to), welcomeHtml('https://openthehive.ai', to)]) {
    assert.ok(body.includes(to), 'recipient address present');
    assert.ok(body.includes('https://openthehive.ai/member/login'), 'login URL present');
    assert.doesNotMatch(body, /[0-9]\s*%/);
    assert.doesNotMatch(body, /\$/);
  }
  const text = welcomeText('https://openthehive.ai', to);
  const order = [
    'chamber waiting',
    'with this address',
    'no password',
    "open your bee's chamber",
    'AI personas operated by The Hive',
    "If you didn't join The Hive, ignore this email.",
  ].map((s) => text.indexOf(s));
  order.forEach((i) => assert.ok(i >= 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'lines in the ruled order');
});

// ── item 3 · 4+4 ────────────────────────────────────────────────────────────

test('MEMBER-002 · the code formatter prints an 8-digit code as NNNN NNNN', () => {
  assert.equal(formatCode('48291306'), '4829 1306');
  assert.match(formatCode('12345678'), /^\d{4} \d{4}$/);
});

test('MEMBER-002 · the code parser accepts NNNN NNNN, NNNNNNNN and " NNNN  NNNN "', () => {
  assert.equal(normalizeCode('4829 1306'), '48291306');
  assert.equal(normalizeCode('48291306'), '48291306');
  assert.equal(normalizeCode(' 4829  1306 '), '48291306');
  assert.equal(normalizeCode('4829 13a6'), null);
});

// ── item 2 · /member leads with the bee ─────────────────────────────────────

test('MEMBER-002 · rendered /member: bee-state card, then chamber, then colony rooms, then Antenna', () => {
  const html: string = renderToStaticMarkup(React.createElement(MemberDashboard, { email: 'member@example.com' }));
  const bee = html.indexOf('data-card="bee-state"');
  const chamber = html.indexOf('data-card="chamber"');
  const rooms = html.indexOf('data-card="colony-rooms"');
  const antenna = html.indexOf('Install Antenna');
  assert.ok(bee >= 0 && chamber >= 0 && rooms >= 0 && antenna >= 0);
  assert.ok(bee < chamber, 'bee-state card precedes the chamber card');
  assert.ok(chamber < rooms && rooms < antenna);
  assert.equal(html.indexOf('<section'), html.indexOf('<section data-card="bee-state"'), 'the bee card is the first card');
});

// ── item 6 · the soul from the row ──────────────────────────────────────────

test('MEMBER-002 · the personal chamber subtitle is built from agents.soul, not honeycombs.description', () => {
  const stale = {
    id: 'hc-1',
    title: 'Echos Chamber',
    description: 'Personal evolution space for Echo — The Alchemist. Your life coach meets you here.',
    message_count: 3,
  };
  const view = personalChamberView(stale, { name: 'Echo', soul: 'The Rebel' });
  assert.equal(view.subtitle, 'Personal evolution space for Echo — The Rebel.');
  assert.equal('description' in view, false, 'the stored description is not sent');
  assert.doesNotMatch(JSON.stringify(view), /Alchemist/);
  assert.equal(view.title, 'Echos Chamber');
});

test('MEMBER-002 · the chamber view renders the subtitle on the chamber lane, the description only on colony rooms', () => {
  const src: string = nodeFs.readFileSync(nodePath.join(REPO_ROOT, 'app/member/MemberChat.tsx'), 'utf8');
  assert.match(src, /lane === 'chamber' \? \(\s*room\?\.subtitle &&/);
  const route: string = nodeFs.readFileSync(nodePath.join(REPO_ROOT, 'app/api/member/chamber/route.ts'), 'utf8');
  assert.match(route, /chamber: personalChamberView\(chamber, agentInfo\)/);
  assert.match(route, /\.select\('status, name, human_name, soul'\)/);
});

// ── items 4, 5 · the words ──────────────────────────────────────────────────

test('MEMBER-002 · the reply-box line has the exact text and sits directly above the textarea', () => {
  assert.equal(
    REPLY_BOX_NOTE,
    'Your bee and its coaches read what you write here. Write to your bee about the project, not about your life.',
  );
  const src: string = nodeFs.readFileSync(nodePath.join(REPO_ROOT, 'app/member/MemberChat.tsx'), 'utf8');
  assert.match(src, /<p className="text-\[12px\] text-hive-sub mb-2">\{REPLY_BOX_NOTE\}<\/p>\s*<textarea/);
});

test('MEMBER-002 · rendered /member/login carries the MS3 line, under the one-time-link sentence', () => {
  assert.equal(INBOX_LINE, 'Anyone who can read this inbox can sign in and manage your bee. Keep that inbox yours.');
  const html: string = renderToStaticMarkup(React.createElement(MemberLoginPage));
  const link = html.indexOf('We send a one-time link');
  const ms3 = html.indexOf(INBOX_LINE);
  assert.ok(link >= 0 && ms3 > link, 'MS3 line present, after the one-time-link sentence');
});
