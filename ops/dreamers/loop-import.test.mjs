// ops/dreamers/loop-import.test.mjs — FIND-LOOP-IMPORT, DREAMERS-006.
// Run: node --test ops/dreamers/*.test.mjs
//
// THE SUITE FINISHING IS THE ASSERTION. Before the entry-point guard, importing loop.mjs
// started the service: it read the live chamber, called Ollama, attempted a post, then
// slept 420 s and looped — so this file would have hung until the runner's timeout rather
// than failing cleanly. A green, prompt result is the proof that importing the module now
// does nothing but define functions.
//
// It deliberately does NOT stub fetch or the filesystem. A stub would hide the very
// behaviour under test: the point is that nothing reaches for the network or the disk at
// all. If the guard regresses, this test hangs, and that is the signal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const RUNTIME = join(homedir(), '.openclaw', 'dreamers');

/** mtime in ms, or null when the file does not exist. */
async function mtime(p) {
  try {
    return (await stat(p)).mtimeMs;
  } catch {
    return null;
  }
}

test('importing loop.mjs resolves and has no side effects', async () => {
  const watched = ['turns.log', 'rejects.log', 'state.json', 'service.log'].map((f) => join(RUNTIME, f));
  const before = await Promise.all(watched.map(mtime));

  const mod = await import('./loop.mjs');
  assert.ok(mod, 'import did not resolve');

  // The module defines things; it must not have started anything. `main` is not exported,
  // so the observable contract is that the import returned and the disk did not move.
  const after = await Promise.all(watched.map(mtime));
  for (let i = 0; i < watched.length; i++) {
    assert.equal(after[i], before[i], `${watched[i]} was written during import`);
  }
});

test('a second import is also inert (module cache, still no writes)', async () => {
  const p = join(RUNTIME, 'turns.log');
  const before = await mtime(p);
  await import('./loop.mjs');
  assert.equal(await mtime(p), before, 'turns.log moved on re-import');
});

test('importing loop.mjs does not read argv — a bad --speaker cannot exit the process', async () => {
  // DREAMERS-007. The --speaker parser was an IIFE at module scope that called
  // process.exit(2) on a value it did not like, so importing loop.mjs from a process
  // whose argv carried a bad --speaker killed that process before the importer ran a
  // line. THE SUITE SURVIVING IS THE ASSERTION, exactly as above: if the parser moves
  // back to module scope, this test takes the whole runner down with exit code 2.
  //
  // The query string is load-bearing — it is a different module-cache key, so the body
  // of loop.mjs is EVALUATED again, this time with the poisoned argv in place. Without
  // it the earlier import would be served from cache and nothing would be re-tested.
  const saved = process.argv.slice();
  process.argv = [saved[0], saved[1] ?? 'not-loop.mjs', '--speaker', 'nonsense', '--dry-run'];
  try {
    const mod = await import('./loop.mjs?argv-probe');
    assert.ok(mod, 'import did not resolve');
  } finally {
    process.argv = saved;
  }
});
