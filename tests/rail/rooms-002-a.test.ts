// tests/rail/rooms-002-a.test.ts
// ----------------------------------------------------------------------------
// THE HIVE — ROOMS-002-a (NIK-ANTENNA-007 M3): the create route can no longer make
// a wingmate or swarm room. Runs under the repo's rail test command:
//   npm run test:rail
//
// WHAT IS REAL AND WHAT IS STUBBED:
//   REAL    — app/api/honeycombs/create/route.ts POST, called with a real Request.
//   STUBBED — createClient on the object require('@supabase/supabase-js') returns,
//             rebound for the duration of one call (as stripe-checkout-002 rebinds
//             railStripe). The compiled route reads createClient off that object at
//             request time, so the rebinding reaches it. The stand-in records every
//             table, read and write; no real client is built.
//   SOURCE  — the route is read from the repo (not dist) for the last test.
//
// No network, no database. The colony key below is an obvious fake.
// ----------------------------------------------------------------------------
import './resolver'; // MUST stay first: installs the '@/...' require hook.
import test from 'node:test';
import assert from 'node:assert/strict';

import * as createRoute from '@/app/api/honeycombs/create/route';

const nodeFs: any = require('node:fs');
const nodePath: any = require('node:path');
const supabaseModule: any = require('@supabase/supabase-js');

const REPO_ROOT: string = nodePath.resolve(__dirname, '..', '..', '..');
const ROUTE_SRC: string = nodeFs.readFileSync(
  nodePath.join(REPO_ROOT, 'app', 'api', 'honeycombs', 'create', 'route.ts'), 'utf8');

const FAKE_KEY = 'fake-colony-key-rooms-002-a';
process.env.HIVE_API_KEY = FAKE_KEY;

interface Op {
  table: string;
  op: string;
  arg?: unknown;
}

async function runCreate(body: Record<string, unknown>) {
  const ops: Op[] = [];
  let built = 0;
  const original = supabaseModule.createClient;
  supabaseModule.createClient = () => {
    built += 1;
    return {
      from(table: string) {
        const chain: any = {
          select(arg?: unknown) {
            ops.push({ table, op: 'select', arg });
            return chain;
          },
          ilike(column: string, value: unknown) {
            ops.push({ table, op: 'ilike', arg: [column, value] });
            return chain;
          },
          insert(row: unknown) {
            ops.push({ table, op: 'insert', arg: row });
            return chain;
          },
          single() {
            if (table === 'agents') return Promise.resolve({ data: { id: 'agent-fake-1', name: 'FakeBee' }, error: null });
            if (table === 'honeycombs') return Promise.resolve({ data: { id: 'hc-fake-1', title: 'A Room' }, error: null });
            return Promise.resolve({ data: null, error: null });
          },
          then(resolve: (v: unknown) => void) {
            return resolve({ data: null, error: null });
          },
        };
        return chain;
      },
    };
  };
  try {
    const req = new Request('https://example.invalid/api/honeycombs/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const res: Response = await (createRoute.POST as any)(req);
    const text = await res.text();
    return { status: res.status, body: JSON.parse(text), ops, built, rebound: supabaseModule.createClient !== original };
  } finally {
    supabaseModule.createClient = original;
  }
}

const GOOD = { agent_name: 'FakeBee', title: 'A Room', api_key: FAKE_KEY };

function honeycombInserts(ops: Op[]) {
  return ops.filter((o) => o.table === 'honeycombs' && o.op === 'insert').map((o) => o.arg as Record<string, unknown>);
}

function memberInserts(ops: Op[]) {
  return ops.filter((o) => o.table === 'honeycomb_members' && o.op === 'insert').map((o) => o.arg as Record<string, unknown>);
}

test('rooms-002-a 13: type wingmate with the right key is 400 invalid_type, and nothing is read or written', async () => {
  const r = await runCreate({ ...GOOD, type: 'wingmate' });
  assert.equal(r.rebound, true);
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'invalid_type' });
  assert.deepEqual(r.ops, []);
});

test('rooms-002-a 14: type swarm with the right key is 400 invalid_type, and nothing is read or written', async () => {
  const r = await runCreate({ ...GOOD, type: 'swarm' });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'invalid_type' });
  assert.deepEqual(r.ops, []);
});

test('rooms-002-a 15: anything not exactly hive or personal is refused the same way', async () => {
  for (const type of ['Wingmate', ' wingmate', 'hive ', ['wingmate'], 1] as unknown[]) {
    const r = await runCreate({ ...GOOD, type });
    assert.equal(r.status, 400, JSON.stringify(type));
    assert.deepEqual(r.body, { error: 'invalid_type' }, JSON.stringify(type));
    assert.deepEqual(r.ops, [], JSON.stringify(type));
  }
});

test('rooms-002-a 16: no type writes hive; hive and personal are written as given, each with its creator row', async () => {
  const none = await runCreate({ ...GOOD });
  assert.equal(none.status, 200);
  assert.deepEqual(none.body, { success: true, honeycomb_id: 'hc-fake-1', title: 'A Room', creator: 'FakeBee' });
  assert.equal(honeycombInserts(none.ops).length, 1);
  assert.equal(honeycombInserts(none.ops)[0].type, 'hive');
  assert.deepEqual(memberInserts(none.ops), [{ honeycomb_id: 'hc-fake-1', agent_id: 'agent-fake-1', role: 'creator' }]);

  for (const type of ['hive', 'personal']) {
    const r = await runCreate({ ...GOOD, type });
    assert.equal(r.status, 200, type);
    const hcs = honeycombInserts(r.ops);
    assert.equal(hcs.length, 1, type);
    assert.equal(hcs[0].type, type);
    assert.deepEqual(memberInserts(r.ops), [{ honeycomb_id: 'hc-fake-1', agent_id: 'agent-fake-1', role: 'creator' }], type);
  }
});

test('rooms-002-a 17: a wrong key with type wingmate is 401; a right key with no title is 400 Missing required fields', async () => {
  const wrong = await runCreate({ ...GOOD, api_key: 'not-the-fake-key', type: 'wingmate' });
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.body, { error: 'Unauthorized' });
  assert.deepEqual(wrong.ops, []);

  const noTitle = await runCreate({ agent_name: 'FakeBee', api_key: FAKE_KEY, type: 'hive' });
  assert.equal(noTitle.status, 400);
  assert.deepEqual(noTitle.body, { error: 'Missing required fields' });
  assert.deepEqual(noTitle.ops, []);
});

test("rooms-002-a 18: the route no longer contains type: type || 'hive'", () => {
  assert.equal(ROUTE_SRC.includes("type: type || 'hive'"), false);
  assert.ok(ROUTE_SRC.includes('type: roomType'));
});
