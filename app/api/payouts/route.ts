export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

// ----------------------------------------------------------------------------
// NIK-RAIL-000 — DEFUSED. Ruled by Francis Oct 12 (RAIL-DESIGN-v1.1 §15 row 0,
// ruling R-G). Both handlers are gone; this file reaches no database, no Stripe,
// and no credential.
//
// WHAT WAS HERE, and why it could not stay while the real rail is built:
//   POST  authenticated on a Bearer HIVE_API_KEY, then swept every agent with a
//         non-null eth_wallet and ran
//           UPDATE referral_earnings SET status='paid', paid_at=now()
//         for any agent whose pending total cleared $5 — marking money PAID with
//         no transfer behind it. Its own closing note admitted the transfer was
//         still pending an unbuilt crypto integration. A row marked paid that
//         nobody paid is worse than no row at all, and that rail was never ours.
//   GET   took the agent's API key in the QUERY STRING (?agent_key=), so the
//         credential landed in every proxy log, browser history and referrer
//         header between the caller and here. It is removed with the writer
//         rather than kept, because a reader that teaches callers to put a key
//         in a URL is a reader that has to be unlearned later.
//
// Both now answer 410 Gone with an identical body. 410 and not 404: the path
// existed, the client is not wrong to remember it, and it will not come back in
// this shape. Nothing is checked before the return — no auth, no database, no
// Stripe — so a stale caller holding a real key cannot make this file do work,
// and a 410 is not an oracle for whether the key is still valid.
//
// The replacement is the Stripe Connect rail (checklist C). /api/stripe/webhook
// remains the ONLY writer of accruals; see lib/referral-engine.ts.
// ----------------------------------------------------------------------------

const GONE = { error: 'gone', detail: 'replaced by the payout rail' } as const;

export async function GET() {
  return NextResponse.json(GONE, { status: 410 });
}

export async function POST() {
  return NextResponse.json(GONE, { status: 410 });
}
