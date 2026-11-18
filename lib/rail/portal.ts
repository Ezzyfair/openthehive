// lib/rail/portal.ts
// ----------------------------------------------------------------------------
// THE HIVE · payout rail — the billing-portal handler (STRIPE-PORTAL-001).
//
// POST /api/stripe/portal is a thin wrapper over openMemberPortal() below. The
// logic lives here, with its three dependencies passed in, so the rail tests can
// drive the real handler with a stubbed session, a stubbed members read and a
// stubbed Stripe — the same way handleStripeEvent takes its HandlerDeps.
//
// THE RULE: the request never says whose portal opens. The signed-in member's
// session says who is asking; that member's own members row says which Stripe
// customer it is. Nothing is read from the request body, the query or a header.
//
// ORDER: session, then the members row, then (and only then) the Stripe client is
// constructed and called. A refused request never constructs a Stripe client.
//
// ERRORS: rendered exactly as app/api/member/colony/route.ts renders them, through
// memberJson / memberErrorResponse — 401 not_signed_in and 403 not_a_member come
// straight from resolveMemberSession(). Anything that is not a deliberate refusal
// becomes 500 internal_error; the thrown message goes to console.error only and
// never into the response, so a Stripe error is never echoed to the caller.
// ----------------------------------------------------------------------------
import type { NextResponse } from 'next/server';
import { BeeError } from '@/lib/antenna/errors';
import type { MemberSession } from '@/lib/antenna/member';
import { memberErrorResponse, memberJson } from '@/lib/member-reads';

/** Where the portal sends the member back to: the member page. */
export const PORTAL_RETURN_URL = 'https://www.openthehive.ai/member';

/** The one Stripe call this handler makes, typed narrowly so a stub can satisfy it. */
export interface PortalStripe {
  billingPortal: {
    sessions: {
      create(params: { customer: string; return_url: string }): Promise<{ url: string }>;
    };
  };
}

export interface PortalDeps {
  /** Who is asking. Throws BeeError 401 / 403 exactly as resolveMemberSession does. */
  session: () => Promise<MemberSession>;
  /** That member's own row, read by members.id. null when no row has that id. */
  memberRow: (memberId: string) => Promise<{ stripe_customer_id: string | null } | null>;
  /** The Stripe client factory. Called only after both checks above have passed. */
  stripe: () => PortalStripe;
}

export async function openMemberPortal(deps: PortalDeps): Promise<NextResponse> {
  try {
    const { member_id } = await deps.session();

    const row = await deps.memberRow(member_id);
    if (!row) {
      throw new BeeError(403, 'not_a_member', 'this account is not linked to a Hive membership');
    }
    const customer = row.stripe_customer_id;
    if (!customer) {
      throw new BeeError(409, 'no_billing_account', 'this membership has no billing account');
    }

    const stripe = deps.stripe();
    const portal = await stripe.billingPortal.sessions.create({
      customer,
      return_url: PORTAL_RETURN_URL,
    });
    return memberJson({ url: portal.url });
  } catch (err) {
    if (err instanceof BeeError) return memberErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    console.error('stripe portal: failed', message);
    return memberErrorResponse(new BeeError(500, 'internal_error', 'billing portal could not be opened'));
  }
}
