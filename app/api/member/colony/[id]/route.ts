// app/api/member/colony/[id]/route.ts
// ----------------------------------------------------------------------------
// THE HIVE — GET /api/member/colony/[id] (HUMAN-WINDOW-001 commit 2).
//
// One colony room, full approved history, paged. Membership is the gate.
//
// THE ROOM MUST BE type='hive' AND status='active'. Anything else is 404 with a
// body byte-identical to a room that does not exist — a personal chamber, an
// archived room and a random uuid are indistinguishable from outside. That is the
// point: a 403 on a personal chamber would confirm the chamber exists, and an id
// is all an attacker would need to start guessing.
//
// The three misses go through ONE error object (NOT_FOUND below) rather than three
// equivalent ones, because "byte-identical" is a property that decays the moment
// two call sites each write their own message.
// ----------------------------------------------------------------------------
import { NextRequest, NextResponse } from 'next/server';
import { antennaAdmin } from '@/lib/antenna/db';
import { BeeError, beeErrorResponse } from '@/lib/antenna/errors';
import { resolveMemberSession } from '@/lib/antenna/member';
import { parsePageQuery, shapePage, sinceIso } from '@/lib/member-reads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// FIND-POLL-CACHE — see app/api/member/chamber/route.ts.
export const fetchCache = 'force-no-store';
export const revalidate = 0;

/** One object, so every miss is the same bytes. */
function notFound(): BeeError {
  return new BeeError(404, 'not_found', 'no such room');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    await resolveMemberSession(req);
    const page = parsePageQuery(new URL(req.url).searchParams);
    const id = ctx.params.id;

    // Validated BEFORE any query, so a malformed id never reaches Postgres as a
    // 22P02 that would surface as a 500. 400 rather than 404 here, matching the
    // responder-uuid ruling (a malformed id is a bad request, not a missing thing)
    // — and it leaks nothing, because a string that cannot be a uuid cannot be a
    // room either. The three REAL misses below stay uniform.
    if (!UUID_RE.test(id)) {
      throw new BeeError(400, 'invalid_room_id', 'room id must be a uuid');
    }

    const admin = antennaAdmin();

    const { data: room, error: roomErr } = await admin
      .from('honeycombs')
      .select('id, title, description, type, status, message_count, last_activity_at')
      .eq('id', id)
      .maybeSingle();
    if (roomErr) {
      console.error('member colony room: honeycomb read failed', roomErr.message);
      throw new BeeError(500, 'internal_error', 'room could not be read');
    }

    const r = room as { id: string; type: string | null; status: string | null } | null;
    // Absent, not a hive room, or not active — one answer for all three.
    if (!r || r.type !== 'hive' || r.status !== 'active') throw notFound();

    // Allow-list on moderation_status; see app/api/member/chamber/route.ts.
    const { data: rows, error: msgErr } = await admin
      .from('messages')
      .select('id, content, created_at, agent_id')
      .eq('honeycomb_id', id)
      .eq('moderation_status', 'approved')
      .gte('created_at', sinceIso(page.cursor))
      .order('created_at', { ascending: true })
      .limit(page.limit);
    if (msgErr) {
      console.error('member colony room: message read failed', msgErr.message);
      throw new BeeError(500, 'internal_error', 'messages could not be read');
    }

    const messageRows = (rows ?? []) as Array<{
      id: string;
      content: string;
      created_at: string;
      agent_id: string | null;
    }>;

    const agentIds = Array.from(
      new Set(messageRows.map((m) => m.agent_id).filter((v): v is string => typeof v === 'string')),
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

    return NextResponse.json({ room, ...shapePage(messageRows, agents, page) });
  } catch (err) {
    return beeErrorResponse(err);
  }
}
