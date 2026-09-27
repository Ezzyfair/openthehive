// app/api/version/route.ts
// ----------------------------------------------------------------------------
// THE HIVE — GET /api/version (HUMAN-WINDOW-001 commit 6).
//
// WHY THIS EXISTS. Twice in this ticket a deploy could not be verified from outside.
// Pages that are client components ship a shell with none of their own strings in the
// HTML, so `curl | grep` proves nothing about which build is serving; the closest I could
// get was inferring it from a behaviour change (an empty dreamersMessages array), which
// depends on a database fact and is not an identity. This route replaces that chain of
// reasoning with a sha.
//
// A COMMIT SHA IS NOT A SECRET. It names a commit in a repository, which anyone with
// access to the repository already has, and it reveals nothing about the code to anyone
// without it. Nothing else is exposed: no env values, no branch-derived internals beyond
// the ref, no build metadata.
//
// NO DATABASE, NO SESSION, NO SECRET. This route reads two environment variables and
// returns them. It imports nothing — not antennaAdmin, not the session client, nothing
// from lib/ — so there is no path from here to any table and nothing to authenticate.
// ----------------------------------------------------------------------------
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// FIND-POLL-CACHE — the same four exports every route in this codebase declares. There is
// no fetch inside this handler to cache, but the posture is stated rather than assumed,
// and scripts/check-human-window.mjs would fail the build without them once /api/version
// falls under a guarded tree.
export const fetchCache = 'force-no-store';
export const revalidate = 0;

/**
 * A VERSION ANSWER MUST NEVER BE STALE. That is the whole point of the route: a cached
 * version response would report the build that was live when the cache filled, which is
 * precisely the question this route exists to answer and precisely the wrong answer to
 * give. `no-store` on the outbound response, not merely `no-cache`, so no shared cache
 * and no browser keeps a copy at all.
 */
const NO_STORE = 'no-store';

export async function GET() {
  // Vercel injects these into the function environment when the project's
  // "Automatically expose System Environment Variables" setting is on. They are undefined
  // everywhere else — a local `next start`, a self-hosted build, a preview with the
  // setting off — and `?? null` is what makes that a 200 with nulls rather than a 500 or a
  // response containing the string "undefined".
  //
  // Read inside the handler, not at module scope, so the value is the running
  // environment's rather than whatever was present when the module was first evaluated.
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? null;
  const ref = process.env.VERCEL_GIT_COMMIT_REF ?? null;

  // Exactly two keys. No timestamp (it would make every response differ and invite
  // caching questions), no build id, no env name — each of those is a separate decision
  // and none is needed to answer "which commit is serving".
  return NextResponse.json({ commit, ref }, { headers: { 'Cache-Control': NO_STORE } });
}
