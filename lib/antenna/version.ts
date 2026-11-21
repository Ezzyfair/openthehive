// lib/antenna/version.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — the client version the colony advertises.
//
// Lives here, not in a route file. Next.js App Router validates the export names
// of every route.ts and rejects anything outside its permitted set (the HTTP verbs
// plus runtime, dynamic, revalidate and friends). A stray `export const` in a
// route is a build failure, not a lint warning — it broke the antenna-v1 preview.
//
// Notify-only (§4): the heartbeat response carries this value, the client logs it
// and writes the human file, and nothing self-updates. Moves when a new antenna.py
// ships (§13 step 6).
// ----------------------------------------------------------------------------
export const LATEST_CLIENT_VERSION = '0.3.5';

/**
 * SHA-256 of the published public/antenna/antenna.py, printed on the dashboard as
 * the second channel a member checks the download against (§2).
 *
 * GENERATED — do not edit by hand. Run `node scripts/antenna-release.mjs` after
 * changing the client or either template; `--check` fails on drift.
 */
export const ANTENNA_SHA256: string | null = 'a6993f1b328b56c3d3bc95bc7ae0ef8d503717dc1939782cb7c1bc231938f527';
