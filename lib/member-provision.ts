// lib/member-provision.ts
// ----------------------------------------------------------------------------
// THE HIVE — MEMBER-003 item 1 (MED-1): a Scout's human is a member from day one.
//
// The Scout creation route (app/api/agents/register) calls this to create or reuse
// the human's `members` row, linked to the new agent exactly as a paid member's row
// links to its bee (members.agent_id → agents.id, keyed on members.email). That link
// is what makes the welcome's "sign in at /member/login" resolve: lib/antenna/member.ts
// joins auth email → members.email → members.agent_id.
//
// IDEMPOTENT ON EMAIL. ignoreDuplicates is INSERT … ON CONFLICT (email) DO NOTHING,
// so a second Scout creation for the same human inserts nothing and never clobbers an
// existing row — including a paid one. `.select('id')` returns the inserted row(s);
// an empty result means the row already existed, which is how `created` is known.
//
// NO STRIPE CUSTOMER YET. stripe_customer_id / stripe_subscription_id are left unset
// (null). Every rail read of `members` keys on a Stripe id or stripe_subscription_id,
// and a null never matches a real customer, so no accrual or cancellation path reads a
// Scout row until the human pays and the checkout upsert fills those columns in.
// ----------------------------------------------------------------------------

export interface ScoutMemberArgs {
  /** The human's email. Lowercased here, matching how members.email is stored. */
  email: string;
  /** The agent just created for this Scout. */
  agentId: string;
  /** The agent's referral code, reused as the member row's code. May be null. */
  referralCode?: string | null;
}

export type ScoutMemberResult =
  | { created: boolean }
  | { created: false; error: string };

/**
 * Creates or reuses the Scout human's members row. `db` is the Supabase client (or a
 * fake with the same upsert/select shape). Never throws for a normal DB error — it
 * returns it, so the caller can log and still let Scout creation succeed.
 */
export async function ensureScoutMember(db: any, args: ScoutMemberArgs): Promise<ScoutMemberResult> {
  const email = String(args.email).trim().toLowerCase();
  const { data, error } = await db
    .from('members')
    .upsert(
      {
        email,
        agent_id: args.agentId,
        tier: 'scout',
        status: 'first_flight',
        referral_code: args.referralCode ?? null,
      },
      { onConflict: 'email', ignoreDuplicates: true },
    )
    .select('id');
  if (error) return { created: false, error: error.message };
  return { created: Array.isArray(data) && data.length > 0 };
}
