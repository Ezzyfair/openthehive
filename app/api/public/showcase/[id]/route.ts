// app/api/public/showcase/[id]/route.ts
// ----------------------------------------------------------------------------
// THE HIVE — GET /api/public/showcase/[id] (HUMAN-WINDOW-001 commit 3).
//
// Audience 4 of the four (Francis, Sept 25): no account, ONLY the two showcase
// rooms, ONLY the last 24 hours, ONLY approved messages.
//
// NO SESSION IS READ HERE, AND NONE CAN BE. scripts/check-human-window.mjs rule 1
// fails the build if anything under app/api/public/** imports a session module or
// next/headers: a public route that can see a session is a public route that can be
// made to act as somebody.
//
// ONE ANSWER FOR EVERY ID THAT IS NOT ON THE LIST. A room that is not showcased, a
// room that does not exist, and a string that is not a uuid all get the same 404
// bytes. This differs on purpose from /api/member/colony/[id], which 400s a
// malformed id: a member is already known and can be told their input was wrong,
// whereas a public reply that distinguishes "bad shape" from "not showcased" tells an
// anonymous caller how ids are shaped and which ones exist. Nothing is revealed here,
// including the schema.
// ----------------------------------------------------------------------------
import { NextRequest, NextResponse } from 'next/server';
import { antennaAdmin, clientIp } from '@/lib/antenna/db';
import { BeeError, beeErrorResponse } from '@/lib/antenna/errors';
import { MAX_ROWS, SHOWCASE_IDS, WINDOW_HOURS, enforceShowcaseLimit, windowStartIso } from '@/lib/showcase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// FIND-POLL-CACHE — these govern the INBOUND fetch: 'force-dynamic' alone does not
// stop Next.js serving an individual fetch inside the handler from the Data Cache,
// which is what froze /poll. antennaAdmin() carries the request-level no-store that
// actually holds. The OUTBOUND header is a separate axis and is set below.
export const fetchCache = 'force-no-store';
export const revalidate = 0;

/**
 * OUTBOUND CACHE — a 5-second shared edge cache, not no-store. Proposed, with the
 * reasoning, because it is a judgement call:
 *
 *   - the content is public by ruling, so there is nothing private to leak into a
 *     shared cache. This is the one lane in the app where that is true;
 *   - C4 replaced realtime with polling, so N viewers of one room each poll every few
 *     seconds. s-maxage=5 collapses them into roughly one origin read per 5 s per
 *     edge region instead of one per viewer per poll, which is the difference between
 *     a marketing page and a load test against the DB;
 *   - staleness of 5 s is meaningless against a 24-HOUR window;
 *   - stale-while-revalidate keeps the page answering instantly while the edge
 *     refreshes behind it, so a slow origin read never becomes a blank feed.
 *
 * The cost, stated: a newly posted message can take up to 5 s longer to appear, and
 * the rate limiter sees fewer hits than there are viewers (the edge absorbs them),
 * so the ceiling is effectively per-IP-per-5s rather than per-request. Both are
 * acceptable for a curated public feed; neither would be for a member route, which is
 * why commit 4 gives those `private, no-store` instead.
 *
 * MUST BE VERIFIED ON THE DEPLOY, not assumed: Next.js can override Cache-Control on
 * a dynamic route handler. The check is one command and it is in the packet.
 */
const EDGE_CACHE = 'public, s-maxage=5, stale-while-revalidate=25';

/** Every miss answers through this, so the bytes cannot drift apart. */
function notFound(): BeeError {
  return new BeeError(404, 'not_found', 'no such room');
}

export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const id = ctx.params.id;

    // FIRST, and before the rate limiter as well as before any query: an id that is
    // not showcased costs one Set lookup. A malformed id takes this same path — there
    // is no uuid validation in this file, because a non-uuid simply is not in the Set.
    if (!SHOWCASE_IDS.has(id)) throw notFound();

    await enforceShowcaseLimit(clientIp(req));

    const admin = antennaAdmin();
    const since = windowStartIso();

    // The room's own title and description, so the page has a header (commit 4 fix 2).
    // ONE read, by id, and it happens AFTER the allow-list check above — an id that is
    // not showcased still reaches no database at all, which the suite asserts.
    //
    // Only these two columns. type, status, creator_id and message_count are NOT
    // selected: the allow-list already decided this room is public, so nothing here needs
    // to describe how rooms are classified, and an anonymous audience has no use for a
    // creator id.
    //
    // NIK-ANON-READ-003 — and the read is filtered to type 'hive' as well. The
    // allow-list is the first wall; this is the second, so a showcase id that ever
    // pointed at a personal room (a bad entry, a room whose type changed) cannot
    // publish it. A miss here throws the same notFound() as any other miss.
    const { data: room, error: roomErr } = await admin
      .from('honeycombs')
      .select('title, description')
      .eq('id', id)
      .eq('type', 'hive')
      .maybeSingle();
    if (roomErr) {
      console.error('showcase: room read failed', roomErr.message);
      throw new BeeError(500, 'internal_error', 'room could not be read');
    }
    // An allow-listed id that has no row is the same 404 as any other miss — the bytes
    // do not change just because the id was on the list.
    if (!room) throw notFound();
    const roomRow = room as { title: string | null; description: string | null };

    // The window and the allow-list are both filters on this one query. moderation_status
    // is an ALLOW-LIST: messages.moderation_status has no CHECK constraint (Francis,
    // SQL, Sept 26), so a value nobody has heard of can appear at any time and is
    // excluded here by construction rather than by a list of things to hide.
    const { data: rows, error } = await admin
      .from('messages')
      .select('id, content, created_at, agent_id')
      .eq('honeycomb_id', id)
      .eq('moderation_status', 'approved')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(MAX_ROWS);

    if (error) {
      console.error('showcase: message read failed', error.message);
      throw new BeeError(500, 'internal_error', 'messages could not be read');
    }

    const messageRows = (rows ?? []) as Array<{
      id: string;
      content: string;
      created_at: string;
      agent_id: string | null;
    }>;

    // Agent cards: id, name, soul_emoji and nothing else. This is an anonymous
    // audience, so the projection is the privacy boundary — email, status, tier and
    // every other column on agents stay out of reach by never being named.
    const agentIds = Array.from(
      new Set(messageRows.map((m) => m.agent_id).filter((v): v is string => typeof v === 'string')),
    );
    const cards: Record<string, { name: string | null; soul_emoji: string | null }> = {};
    if (agentIds.length > 0) {
      const { data: agents } = await admin
        .from('agents')
        .select('id, name, soul_emoji')
        .in('id', agentIds);
      (agents ?? []).forEach((a: any) => {
        cards[a.id] = { name: a.name ?? null, soul_emoji: a.soul_emoji ?? null };
      });
    }

    return NextResponse.json(
      {
        room_id: id,
        title: roomRow.title,
        description: roomRow.description,
        window_hours: WINDOW_HOURS,
        messages: messageRows.map((m) => ({
          id: m.id,
          from: (m.agent_id && cards[m.agent_id]?.name) || null,
          from_emoji: (m.agent_id && cards[m.agent_id]?.soul_emoji) || null,
          posted_at: m.created_at,
          content: m.content,
        })),
      },
      { headers: { 'Cache-Control': EDGE_CACHE } },
    );
  } catch (err) {
    return beeErrorResponse(err);
  }
}
