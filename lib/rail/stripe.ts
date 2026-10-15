// lib/rail/stripe.ts
// ----------------------------------------------------------------------------
// THE HIVE · payout rail — the ONE Stripe client factory.
// RAIL-DESIGN-v1.1 §5.1, §5.5b, predicate R18.
//
// R18: the API version is pinned in exactly one factory, used by every money
// route. This file is that one place. scripts/check-rail-routes.mjs fails the
// build if a Stripe constructor appears anywhere under the money trees, and the
// commit-3 proof greps app and lib for the pin and expects EXACTLY ONE hit — the
// one code line below. That is why no comment in this repo spells the option name:
// a second mention would make a one-hit proof impossible to state.
// An unpinned client silently follows whatever version Stripe defaults the account
// to, so the shape of an event object could change under a deployed handler
// without a single line of our code moving.
//
// WHY LAZY, PER CALL. There is no module-scope client. A module-scope
// `new Stripe(process.env.STRIPE_SECRET_KEY as string)` is constructed when the
// module is first imported, which during `next build` is the build machine — and
// Vercel previews build without STRIPE_SECRET_KEY. The existing routes already
// learned this (app/api/stripe/checkout/route.ts:7-9 says so in its own comment);
// this factory keeps that property rather than regressing it.
//
// Unlike railAdmin() below it, this client is NOT cached across calls. Stripe's
// client holds per-instance state (telemetry, the request counter), and a webhook
// handler that must answer inside Stripe's delivery timeout is not a place to
// share mutable state between concurrent invocations for the sake of one object
// allocation.
// ----------------------------------------------------------------------------
import Stripe from 'stripe';

/**
 * The API version every money route speaks.
 *
 * §5.1 pins this to the version the webhook endpoints are registered at —
 * `2026-03-25.dahlia`, per LAUNCH-CHECKLIST line 106, which recorded the staging
 * test endpoint created Sept 25 with "6 events matching live, API
 * 2026-03-25.dahlia".
 *
 * NOT YET CONFIRMED AGAINST THE DASHBOARD. §5.1 says "Claude Code confirms
 * against the dashboard before pinning" and §5 adds the version proof (closes M6):
 * Francis reads the version shown on each webhook endpoint and pastes it, and that
 * paste is an artifact of this packet. This session cannot see the Stripe
 * dashboard. The value below is the checklist's, and it is the one thing in this
 * commit that a human has to verify before it is merged.
 */
export const RAIL_STRIPE_API_VERSION = '2026-03-25.dahlia';

/** §5.5b — bounded, so no handler outlasts Stripe's own delivery timeout. */
const RAIL_STRIPE_TIMEOUT_MS = 10_000;
const RAIL_STRIPE_MAX_RETRIES = 1;

/**
 * The money-path Stripe client. Built per call; throws by NAME, never by value,
 * when the secret is absent.
 */
export function railStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('rail: STRIPE_SECRET_KEY is not configured');
  }
  return new Stripe(key, {
    apiVersion: RAIL_STRIPE_API_VERSION,
    timeout: RAIL_STRIPE_TIMEOUT_MS,
    maxNetworkRetries: RAIL_STRIPE_MAX_RETRIES,
  });
}
