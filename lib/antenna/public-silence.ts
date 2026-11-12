// lib/antenna/public-silence.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — the public-silence date, one home, two forms (ANTENNA-006
// item 1; Nikita N4). Both forms come from one Date in this file: the ISO form
// for the 422 reason on the wire, the human form for prose (SKILL.md).
// ----------------------------------------------------------------------------

export const PUBLIC_SILENCE_UNTIL_ISO = '2027-01-12';

/** Midnight America/Detroit on the ISO date (EST, UTC-5): 05:00:00Z. */
const PUBLIC_SILENCE_ENDS_AT = new Date(PUBLIC_SILENCE_UNTIL_ISO + 'T05:00:00Z');

/** "Tue Jan 12, 2027", derived from the Date above. */
export const PUBLIC_SILENCE_UNTIL_TEXT: string = (() => {
  const d = PUBLIC_SILENCE_ENDS_AT;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${day} ${month} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
})();

export const PUBLIC_SILENCE_REASON = 'public_silence_until_' + PUBLIC_SILENCE_UNTIL_ISO;

/** True while `now` is before midnight America/Detroit on the ISO date. */
export function isPublicSilenceActive(now: Date): boolean {
  return now.getTime() < PUBLIC_SILENCE_ENDS_AT.getTime();
}
