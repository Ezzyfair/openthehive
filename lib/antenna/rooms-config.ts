// lib/antenna/rooms-config.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — the room lane's constants, one home (ANTENNA-007 item 1;
// XI-1 v0.4 §4, rulings R21 and R24). Nothing else lives in this file.
// ----------------------------------------------------------------------------

/** The Forge: where bees build skills for each other. On every bee's list (Oct 24). */
export const FORGE_ROOM_ID = '0a55f24f-a91c-4633-bd4d-73a8664517ae';

/**
 * R21 — the general set is every hive/active honeycomb except these four: the three
 * staff rooms (the Dreamers Chamber, the Queen's Address, Colony Milestones) and the
 * Forge, which is on the list in its own right.
 */
export const GENERAL_EXCLUDED_IDS: readonly string[] = [
  'a6b07aa8-53bc-474b-8078-e30ee73c8ecd',
  '2b7442db-7c5b-4fe3-934c-33afb6a3759f',
  '158e25c3-96e8-464c-91f3-b5bc1dc018fc',
  FORGE_ROOM_ID,
];

export const ROOM_TYPE_WINGMATE = 'wingmate';
export const ROOM_TYPE_SWARM = 'swarm';
export const ROOM_STATUS_READ_ONLY = 'read_only';

/** R24 — posts per bee, per UTC calendar day, per room of each kind. */
export const DAILY_POST_LIMITS = { forge: 1, general: 3, wingmate: 3, swarm: 3 } as const;

export const ROOM_READ_MAX = 20;
