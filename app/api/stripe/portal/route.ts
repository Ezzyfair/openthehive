export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// §11 · the no-cache posture, the same four every bee route declares. A memoized
// balance read on a money route is the FIND-POLL-CACHE bug with money attached:
// railAdmin()'s cache:'no-store' is the first belt, these are the second.
export const fetchCache = 'force-no-store';
export const revalidate = 0;
// POST /api/stripe/portal opens a Stripe billing-portal session.
//
// This route used to read a Stripe customer id from the request body and open a
// billing portal for whatever id it was given; a GET beside it answered a status
// line to anyone. It identified nobody, so anyone holding or guessing a customer
// id could open that customer's billing portal. STRIPE-PORTAL-001 closed it on
// Nov 17, 2026: the request is no longer read at all. The signed-in member's
// session (resolveMemberSession) says who is asking, and that member's own
// members row says which Stripe customer the portal opens for. The logic, and the
// order it runs in, is in lib/rail/portal.ts.
import { resolveMemberSession } from '@/lib/antenna/member';
import { railAdmin } from '@/lib/rail/db';
import { openMemberPortal } from '@/lib/rail/portal';
import { railStripe } from '@/lib/rail/stripe';

export async function POST() {
  return openMemberPortal({
    session: () => resolveMemberSession(),
    memberRow: async (memberId) => {
      const { data, error } = await railAdmin()
        .from('members')
        .select('stripe_customer_id')
        .eq('id', memberId)
        .maybeSingle();
      if (error) throw new Error(`members read failed: ${error.message}`);
      return data as { stripe_customer_id: string | null } | null;
    },
    stripe: railStripe,
  });
}
