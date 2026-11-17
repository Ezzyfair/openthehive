export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// §11 · the no-cache posture, the same four every bee route declares. A memoized
// balance read on a money route is the FIND-POLL-CACHE bug with money attached.
// Both methods now answer 410 and read nothing; the four stay because RULE A of
// scripts/check-rail-routes.mjs requires them on every route in this tree.
export const fetchCache = 'force-no-store';
export const revalidate = 0;
import { NextResponse } from 'next/server';

/**
 * GET /api/referrals/chain — REFERRALS-CHAIN-001 DEFUSED, Nov 16, 2026.
 *
 * What it was: it took an agent_id from the query string and nothing else. With the
 * action parameter set to the money-rows view it returned, through the service-role
 * rail client, up to 50 full `referral_earnings` money rows for that agent with
 * pending and paid totals; otherwise it returned that agent's referral chain, each
 * entry carrying the agent's id, name, level, rate and wallet address.
 *
 * Why it is gone: it identified nobody. No session, token or key stood before the
 * read, so anyone who knew or guessed a bee's id could read its `referral_earnings`
 * money rows and its chain's wallets. No caller in the tree used it. The member's own
 * view of its money rows arrives with the payout tickets, behind the member session.
 *
 * Same rule as the POST below: no auth check before the 410, no database call, and the
 * request is not read at all (no query parameter, header or body), because a refusal
 * that first validates anything is an oracle. The handler takes no argument.
 */
export async function GET() {
  return NextResponse.json(
    { error: 'gone', detail: 'replaced by the member page' },
    { status: 410 },
  );
}

/**
 * POST /api/referrals/chain — NIK-RAIL-000 DEFUSED.
 * Ruled by Francis Oct 12 (RAIL-DESIGN-v1.1 §15 row 0, ruling R-G).
 *
 * BOTH actions this method carried wrote money, so the whole method is gone — and the
 * api_key check and the service-role client went with it, because rule 1 is "no auth
 * check before it, no database call": a 410 that first validates a key is an oracle for
 * whether that key is still live.
 *
 *   action='process_payment' — called the legacy accrual writer, CREATING accruals
 *     in referral_earnings and hive_revenue. Amount DEFAULTED to $10 and the month
 *     defaulted to now, so a caller holding the key could mint a cascade for any agent
 *     id with two fields and no invoice behind it. The Stripe webhook does this
 *     properly, keyed to a real invoice (app/api/stripe/webhook/route.ts:170).
 *
 *   action='run_monthly_payouts' — swept every pending row and ran
 *     UPDATE referral_earnings SET status='ready_for_payout' for any agent over $5
 *     WITH A NON-NULL eth_wallet, i.e. it gated real money on a crypto column that the
 *     Stripe Connect rail does not use. Its one caller was the monthly cron at
 *     /api/payouts/monthly, whose vercel.json entry is removed in this commit.
 *
 * The GET handlers above were left live by this ticket. They were defused later by
 * REFERRALS-CHAIN-001 (Nov 16, 2026): they identified nobody and returned any agent's
 * `referral_earnings` money rows and its chain with wallets. See the GET's comment.
 */
export async function POST() {
  return NextResponse.json(
    { error: 'gone', detail: 'replaced by the payout rail' },
    { status: 410 },
  );
}
