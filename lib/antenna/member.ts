// lib/antenna/member.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — member-session resolution and the §5.2 ownership check.
//
// ─── HOW A MEMBER IS IDENTIFIED ──────────────────────────────────────────────
//
// Supabase Auth magic link (Francis's ruling, Sept 13). The authenticated user's
// EMAIL is the join key: auth user -> email -> members.email -> members.id. No new
// column, no backfill, no owner_member_id — members.email is already the unique
// key the Stripe webhook upserts on.
//
// §5.2's check is written the other way round (agents.owner_member_id), which does
// not exist in this schema. The rule enforced here is the same one: ownership is
// resolved server-side from the session, never from the request.
//
// Bees never hold member sessions. This module reads cookies; /api/bee/* must not
// import it, and scripts/check-bee-routes.mjs fails the build if one does.
// ----------------------------------------------------------------------------
import { createReadOnlySessionClient } from '../supabase/server';
import { antennaAdmin } from './db';
import { BeeError } from './errors';

export interface MemberSession {
  member_id: string;
}

/**
 * Resolves the acting member from the request cookies.
 *
 * getUser() is deliberate: it revalidates the JWT with Supabase rather than
 * trusting whatever the cookie decodes to, which getSession() would.
 *
 * A signed-in user with no matching members row is 403, not 500 — someone can
 * hold a valid Supabase identity without being a paying member, and that is a
 * refusal, not a fault.
 */
export async function resolveMemberSession(_req?: {
  headers: { get(name: string): string | null };
}): Promise<MemberSession> {
  const supabase = createReadOnlySessionClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data?.user) {
    throw new BeeError(401, 'not_signed_in', 'sign in at /member/login');
  }
  const email = data.user.email;
  if (!email) {
    throw new BeeError(401, 'not_signed_in', 'this account has no email address');
  }

  const { data: member, error: memberErr } = await antennaAdmin()
    .from('members')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (memberErr) {
    console.error('antenna: member lookup by email failed', memberErr.message);
    throw new BeeError(500, 'internal_error', 'member lookup failed');
  }
  const row = member as { id: string } | null;
  if (!row) {
    throw new BeeError(403, 'not_a_member', 'this account is not linked to a Hive membership');
  }

  return { member_id: row.id };
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
