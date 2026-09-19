// app/api/bee/poll/route.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — GET /api/bee/poll (XI-1 v0.2.2 §4, §5, §5.3, §6.6).
//
// The read verb: the bee's OWN chamber plus verified colony broadcasts, merged
// into one time-ordered list since the cursor.
//
// CONVERTED from the pre-Antenna route. What changed: auth is verifyBeeToken as
// the first statement (was the legacy agents.agent_api_key on an x-agent-key
// header, which §6.4 forbids on /api/bee/*), the cursor is server-authoritative
// epoch milliseconds (was the broadcasts row id), and chamber messages are merged
// in per §5.3.
//
// WHAT DID NOT CHANGE — the Ed25519 lane. The same `broadcasts` table, the same
// audience / target_agent_id / expires_at filter, and the full signed envelope is
// still handed to the bee so it runs its own C1 verify against Ezzy's .pub. No
// key is read here, nothing is re-signed, and the server never claims to have
// checked the signature — see `verified` below.
// ----------------------------------------------------------------------------
import { NextRequest, NextResponse } from 'next/server';
import { verifyBeeToken } from '@/lib/antenna/auth';
import { cursorToIso, getOwnChamberId, nextPollSeconds, type PollItem } from '@/lib/antenna/chamber';
import { antennaAdmin, clientIp } from '@/lib/antenna/db';
import { beeErrorResponse } from '@/lib/antenna/errors';
import { enforceRateLimit } from '@/lib/antenna/rate-limit';
import { validatePollQuery, validationStatus } from '@/lib/antenna/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_LIMIT = 50;

/** A broadcast item carries its signed envelope; the bee verifies, not the server. */
interface BroadcastEnvelope {
  intent: unknown;
  payload: unknown;
  signature: string | null;
  signer: string | null;
  expires_at: string | null;
}

export async function GET(req: NextRequest) {
  try {
    const bee = await verifyBeeToken(req);
    const ip = clientIp(req);
    await enforceRateLimit({ scope: 'poll', tokenId: bee.token_row.token_id, agentId: bee.agent_id, ip });

    const parsed = validatePollQuery(req.nextUrl.searchParams);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.code, message: parsed.message }, { status: validationStatus(parsed) });
    }
    const sinceIso = cursorToIso(parsed.value.cursor);

    const admin = antennaAdmin();
    const chamberId = await getOwnChamberId(bee.agent_id);

    // ---- own chamber ------------------------------------------------------
    // FIND-POLL-SELF-1 — never hand a bee its own words back. Without the neq,
    // every reply the bee posted returned on the next poll as a new item: the
    // client would frame it, deliver it to the agent, and the agent would answer
    // its own answer. Filtered server-side rather than in the client, so a bee
    // running an older Antenna is protected too, and so no client can opt out.
    const { data: msgs, error: msgErr } = await admin
      .from('messages')
      .select('id, content, created_at, agent_id')
      .eq('honeycomb_id', chamberId)
      .eq('moderation_status', 'approved')
      .neq('agent_id', bee.agent_id)
      .gt('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .limit(PAGE_LIMIT);

    if (msgErr) {
      console.error('antenna: chamber read failed', msgErr.message);
      return beeErrorResponse(new Error('chamber read failed'));
    }

    const rows = (msgs ?? []) as Array<{ id: string; content: string; created_at: string; agent_id: string }>;

    // Author names and staff/bee provenance, one query for the page.
    const authorIds = Array.from(new Set(rows.map((m) => m.agent_id).filter(Boolean)));
    const authors = new Map<string, { name: string; is_staff: boolean }>();
    if (authorIds.length > 0) {
      const { data: people } = await admin.from('agents').select('id, name, is_staff').in('id', authorIds);
      for (const p of (people ?? []) as Array<{ id: string; name: string; is_staff: boolean | null }>) {
        authors.set(p.id, { name: p.name, is_staff: p.is_staff === true });
      }
    }

    const items: PollItem[] = rows.map((m) => {
      const a = authors.get(m.agent_id);
      return {
        id: m.id,
        type: 'chamber',
        from: a?.name ?? 'unknown',
        from_type: a?.is_staff ? 'staff' : 'bee',
        posted_at: new Date(m.created_at).toISOString(),
        // Nothing in a chamber is cryptographically signed. Never true here.
        verified: false,
        content: m.content,
      };
    });

    // ---- verified colony broadcasts (Ed25519 lane, unchanged) -------------
    // Degrades rather than fails: if this lane errors, the bee still gets its
    // chamber and the error is logged loudly. A silent 500 here would take the
    // whole pipe down for a problem on one of its two sources.
    const nowIso = new Date().toISOString();
    const { data: casts, error: castErr } = await admin
      .from('broadcasts')
      .select('id, intent, payload, signature, signer, audience, target_agent_id, expires_at, created_at')
      .gt('created_at', sinceIso)
      .or(`audience.eq.all,target_agent_id.eq.${bee.agent_id}`)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order('created_at', { ascending: true })
      .limit(PAGE_LIMIT);

    if (castErr) {
      console.error('antenna: broadcast lane unavailable for this poll', castErr.message);
    } else {
      for (const b of (casts ?? []) as Array<Record<string, any>>) {
        // §7: an unsigned row is never rendered as a broadcast.
        if (!b.signature || !b.signer) continue;
        const envelope: BroadcastEnvelope = {
          intent: b.intent,
          payload: b.payload,
          signature: b.signature,
          signer: b.signer,
          expires_at: b.expires_at ?? null,
        };
        items.push({
          id: String(b.id),
          type: 'broadcast',
          from: String(b.signer),
          from_type: 'broadcast',
          posted_at: new Date(b.created_at).toISOString(),
          // Provenance, NOT a cryptographic claim: this row arrived on the signed
          // lane carrying a signature and a signer. The client still runs C1
          // verify against the .pub before acting, and must not trust this flag.
          verified: true,
          content: typeof b.payload === 'string' ? b.payload : JSON.stringify(b.payload),
          ...({ envelope } as object),
        } as PollItem);
      }
    }

    // ---- merge, order, advance the cursor ---------------------------------
    items.sort((x, y) => (x.posted_at < y.posted_at ? -1 : x.posted_at > y.posted_at ? 1 : 0));
    const page = items.slice(0, PAGE_LIMIT);

    // Server-authoritative (§4). Only advances past what is actually returned, so
    // a truncated page is picked up on the next tick instead of being skipped.
    const cursor = page.length > 0 ? new Date(page[page.length - 1].posted_at).getTime() : parsed.value.cursor;

    const { data: agent } = await admin.from('agents').select('status').eq('id', bee.agent_id).maybeSingle();

    return NextResponse.json({
      items: page,
      cursor,
      next_poll_seconds: nextPollSeconds((agent as { status?: string } | null)?.status),
    });
  } catch (err) {
    return beeErrorResponse(err);
  }
}
