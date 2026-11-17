// lib/mission-control-access.ts
// ----------------------------------------------------------------------------
// THE HIVE — who may open Mission Control (MISSION-CONTROL-001 item 1).
//
// Pure: no env, no session, no network. The caller reads MISSION_CONTROL_EMAILS and
// the signed-in user's email and hands both in.
//
// The allowlist is the raw setting: addresses separated by commas. Every entry and
// the email are trimmed and lower-cased, and the match is on the whole address.
// It fails closed: no email, or no usable allowlist, means nobody.
// ----------------------------------------------------------------------------

export function missionControlAllowed(
  email: string | null | undefined,
  allowlist: string | null | undefined,
): boolean {
  if (typeof email !== 'string' || typeof allowlist !== 'string') return false;
  const who = email.trim().toLowerCase();
  if (!who) return false;
  const allowed = allowlist
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return allowed.includes(who);
}
