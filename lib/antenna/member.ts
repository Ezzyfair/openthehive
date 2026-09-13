// lib/antenna/member.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — member-session resolution and the §5.2 ownership check.
//
// ─── TWO THINGS THE DESIGN ASSUMES THAT THE CODEBASE DOES NOT HAVE ───────────
//
// 1. THERE IS NO MEMBER SESSION SYSTEM. This repo has no login, no cookie
//    session, no @supabase/ssr, no /api/auth, and no member dashboard. The only
//    auth precedent is MISSION_CONTROL_PASSWORD, a single shared staff password.
//    resolveMemberSession() therefore FAILS CLOSED with 501 until a scheme is
//    chosen. These endpoints revoke live credentials; inventing an auth scheme
//    for them would be the worst possible thing to guess at.
//
// 2. agents.owner_member_id DOES NOT EXIST. §5.2 writes the check as
//    `bee_tokens.agent_id -> agents.owner_member_id = session.member_id`. The
//    actual link runs the other way: members.agent_id -> agents.id. The check
//    below is that same rule against the schema that exists, and it is no weaker
//    — it still resolves ownership server-side from the session, never from the
//    request. Flagged for Nikita in NIK-ANTENNA-004c.
// ----------------------------------------------------------------------------
import { antennaAdmin } from './db';
import { BeeError } from './errors';

export interface MemberSession {
  member_id: string;
}

/**
 * Resolves the acting member from the request.
 *
 * NOT IMPLEMENTED. When the session scheme is chosen, this is the only function
 * that changes; every caller and the ownership check below stay as they are.
 */
export async function resolveMemberSession(_req: {
  headers: { get(name: string): string | null };
}): Promise<MemberSession> {
  throw new BeeError(
    501,
    'member_sessions_not_implemented',
    'member session authentication is not built yet; see NIK-ANTENNA-004c',
  );
}

/**
 * §5.2 — a member endpoint acts on an id only after a server-side ownership
 * check against the session. Returns the owned agent id.
 *
 * The id in the URL is never trusted: it is resolved to an agent, and that agent
 * must be the one this member owns. A miss is 404, not 403, so the endpoint does
 * not confirm that someone else's token id exists.
 */
export async function assertOwnsAgent(session: MemberSession, agentId: string): Promise<void> {
  const { data, error } = await antennaAdmin()
    .from('members')
    .select('id, agent_id')
    .eq('id', session.member_id)
    .maybeSingle();

  if (error) {
    console.error('antenna: member lookup failed', error.message);
    throw new BeeError(500, 'internal_error', 'ownership check failed');
  }
  const member = data as { id: string; agent_id: string | null } | null;
  if (!member || !member.agent_id || member.agent_id !== agentId) {
    throw new BeeError(404, 'not_found', 'no such bee for this member');
  }
}

/** The agent this member owns, or 404 when the member has none linked yet. */
export async function ownedAgentId(session: MemberSession): Promise<string> {
  const { data, error } = await antennaAdmin()
    .from('members')
    .select('agent_id')
    .eq('id', session.member_id)
    .maybeSingle();

  if (error) {
    console.error('antenna: member lookup failed', error.message);
    throw new BeeError(500, 'internal_error', 'member lookup failed');
  }
  const agentId = (data as { agent_id: string | null } | null)?.agent_id;
  if (!agentId) throw new BeeError(404, 'not_found', 'this member has no bee yet');
  return agentId;
}
