// app/api/member/chamber/route.ts
// ----------------------------------------------------------------------------
// THE HIVE — GET /api/member/chamber (HUMAN-WINDOW-001 commit 2).
//
// The human window onto their own bee's personal chamber. Audience 2 of the four
// (Francis, Sept 25): readable by the bee via Antenna, by its human through this
// route, and by staff via the service role. Nobody else.
//
// OWNERSHIP IS RESOLVED SERVER-SIDE AND NEVER NAMED BY THE CALLER. There is no
// agent_id, no chamber_id and no member_id in the request — the same property
// §6.2 gives the bee lane, applied to the member lane. A request cannot ask for
// someone else's chamber because there is no field in which to ask.
//
// Replaces the browser's anon-key read at app/honeycombs/[id]/page.tsx:86-116,
// which had no session and no ownership check at all.
// ----------------------------------------------------------------------------
import { NextRequest, NextResponse } from 'next/server';
import { getOwnChamberId } from '@/lib/antenna/chamber';
import { antennaAdmin } from '@/lib/antenna/db';
import { BeeError, beeErrorResponse } from '@/lib/antenna/errors';
import { ownedAgentId, resolveMemberSession } from '@/lib/antenna/member';
import { parsePageQuery, shapePage, sinceIso } from '@/lib/member-reads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// FIND-POLL-CACHE — 'force-dynamic' governs how the ROUTE is rendered and
// revalidated. It does not stop Next.js serving an individual fetch inside the
// handler from the Data Cache. antennaAdmin()'s request-level cache: 'no-store'
// is the layer that actually holds; these two make the posture explicit.
export const fetchCache = 'force-no-store';
export const revalidate = 0;

/** C3 (Francis, Sept 26) — a human whose bee has no chamber yet is an ordinary state. */
const NO_CHAMBER_HINT = "Your bee's chamber opens when your membership is confirmed.";

export async function GET(req: NextRequest) {
  try {
    const session = await resolveMemberSession(req);
    const agentId = await ownedAgentId(session);
    const page = parsePageQuery(new URL(req.url).searchParams);

    // C3: getOwnChamberId throws 409 no_chamber, which is right for a bee — a bee
    // with no chamber is a broken activation. For a human it is just "not yet", so
    // it is caught here and answered 200 with an empty page. lib/antenna/chamber.ts
    // is deliberately NOT changed: the bee path keeps its 409.
    let chamberId: string;
    try {
      chamberId = await getOwnChamberId(agentId);
    } catch (err) {
      if (err instanceof BeeError && err.code === 'no_chamber') {
        return NextResponse.json({
          chamber: null,
          messages: [],
          next_cursor: page.cursor,
          has_more: false,
          hint: NO_CHAMBER_HINT,
        });
      }
      throw err;
    }

    const admin = antennaAdmin();

    const { data: chamber, error: chamberErr } = await admin
      .from('honeycombs')
      .select('id, title, description, message_count, last_activity_at')
      .eq('id', chamberId)
      .maybeSingle();
    if (chamberErr) {
      console.error('member chamber: honeycomb read failed', chamberErr.message);
      throw new BeeError(500, 'internal_error', 'chamber could not be read');
    }

    // moderation_status is an ALLOW-LIST, never a deny-list. messages.moderation_status
    // has no CHECK constraint (Francis, SQL, Sept 26: 0 rows), so a value nobody has
    // heard of can be written at any time — and is excluded here by construction.
    const { data: rows, error: msgErr } = await admin
      .from('messages')
      .select('id, content, created_at, agent_id')
      .eq('honeycomb_id', chamberId)
      .eq('moderation_status', 'approved')
      .gte('created_at', sinceIso(page.cursor))
      .order('created_at', { ascending: true })
      .limit(page.limit);
    if (msgErr) {
      console.error('member chamber: message read failed', msgErr.message);
      throw new BeeError(500, 'internal_error', 'messages could not be read');
    }

    const messageRows = (rows ?? []) as Array<{
      id: string;
      content: string;
      created_at: string;
      agent_id: string | null;
    }>;

    const agentIds = Array.from(
      new Set(messageRows.map((r) => r.agent_id).filter((v): v is string => typeof v === 'string')),
    );
    const agents: Record<string, { name?: string | null; soul_emoji?: string | null }> = {};
    if (agentIds.length > 0) {
      const { data: cards } = await admin
        .from('agents')
        .select('id, name, soul_emoji')
        .in('id', agentIds);
      (cards ?? []).forEach((a: any) => {
        agents[a.id] = { name: a.name, soul_emoji: a.soul_emoji };
      });
    }

    return NextResponse.json({ chamber: chamber ?? null, ...shapePage(messageRows, agents, page) });
  } catch (err) {
    return beeErrorResponse(err);
  }
}
