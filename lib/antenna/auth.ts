// lib/antenna/auth.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — the one verifier (XI-1 v0.2.2 §6.6).
//
// Every /api/bee/* handler's FIRST statement is verifyBeeToken(req). Revocation
// is therefore immediate everywhere: there is no second path that authenticates
// a bee. scripts/check-bee-routes.mjs fails the build if a route forgets.
//
// Token format (§6.4):  hive_bee_<token_id 16 urlsafe>.<secret 43 urlsafe>
//   token_id    lookup key, stored in the clear — it is not a secret
//   salt        32 random bytes, stored hex-encoded, one per row
//   token_hash  sha256(salt_bytes ‖ utf8(secret)), stored hex-encoded
// The plaintext secret exists only in the activation response and the bee's
// hive.json. Nothing Hive-side can reproduce it from the stored row.
//
// §6.4 also: legacy agents.agent_api_key values are NEVER accepted here. Two
// independent guards — the hive_bee_ prefix check below, and the fact that this
// function reads bee_tokens and no other table.
// ----------------------------------------------------------------------------
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { antennaAdmin, clientIp } from './db';
import { BeeError } from './errors';
import { checkRunaway, writeBeeEvent } from './events';

export const BEE_TOKEN_PREFIX = 'hive_bee_';
export const JOIN_TOKEN_PREFIX = 'hive_join_';

const TOKEN_ID_CHARS = 16; // 12 random bytes, base64url
const SECRET_CHARS = 43; //   32 random bytes, base64url
const SALT_BYTES = 32;

export interface BeeTokenRow {
  id: string;
  agent_id: string;
  token_id: string;
  token_hash: string;
  salt: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  client_version: string | null;
  created_ip: string | null;
}

export interface VerifiedBee {
  agent_id: string;
  token_row: BeeTokenRow;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * sha256(salt_bytes ‖ utf8(secret)) as raw bytes.
 * The salt is hashed as the 32 bytes it is, not as its hex spelling. Minting and
 * verifying both go through this function so the two can never drift apart.
 */
function beeTokenDigest(saltHex: string, secret: string): Buffer {
  return createHash('sha256')
    .update(Buffer.concat([Buffer.from(saltHex, 'hex'), Buffer.from(secret, 'utf8')]))
    .digest();
}

export interface MintedBeeToken {
  /** What the bee stores in hive.json. Never persisted Hive-side. */
  plaintext: string;
  token_id: string;
  salt: string;
  token_hash: string;
}

/**
 * token_id and secret are generated together, as a pair (§6.5). The caller must
 * hold the plaintext to build the activation response, and antenna_activate()
 * persists only token_id / salt / token_hash — it cannot derive them.
 */
export function mintBeeToken(): MintedBeeToken {
  const token_id = base64url(randomBytes(12));
  const secret = base64url(randomBytes(32));
  const salt = randomBytes(SALT_BYTES).toString('hex');
  return {
    plaintext: `${BEE_TOKEN_PREFIX}${token_id}.${secret}`,
    token_id,
    salt,
    token_hash: beeTokenDigest(salt, secret).toString('hex'),
  };
}

function unauthorized(message: string): BeeError {
  // One message for every auth failure. The caller learns that it failed, never
  // which of the checks failed — no probing the difference between an unknown
  // token_id, a wrong secret, and a revoked row.
  return new BeeError(401, 'unauthorized', message);
}

const AUTH_FAILED = 'bee token missing, malformed, unknown, or revoked';

/** Parses `Authorization: Bearer hive_bee_<token_id>.<secret>`. */
function parseBearer(header: string | null): { token_id: string; secret: string } | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return null;
  const raw = m[1].trim();

  // §6.4 prefix check: a legacy agents.agent_api_key can never reach the lookup.
  if (!raw.startsWith(BEE_TOKEN_PREFIX)) return null;

  const body = raw.slice(BEE_TOKEN_PREFIX.length);
  const dot = body.indexOf('.');
  if (dot < 0 || body.indexOf('.', dot + 1) !== -1) return null; // exactly one separator

  const token_id = body.slice(0, dot);
  const secret = body.slice(dot + 1);
  if (token_id.length !== TOKEN_ID_CHARS || secret.length !== SECRET_CHARS) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(token_id) || !/^[A-Za-z0-9_-]+$/.test(secret)) return null;
  return { token_id, secret };
}

/**
 * The verifier. Throws BeeError(401) on every failure; returns the acting agent
 * on success. The agent is DERIVED from the token — no /api/bee/* endpoint reads
 * an agent id, chamber id, or token id from a body or query string (§5.2/§6.2).
 */
export async function verifyBeeToken(req: {
  headers: { get(name: string): string | null };
}): Promise<VerifiedBee> {
  const ip = clientIp(req);
  const parsed = parseBearer(req.headers.get('authorization'));

  if (!parsed) {
    await recordAuthFail(null, ip, 'malformed_or_missing');
    throw unauthorized(AUTH_FAILED);
  }

  const { data, error } = await antennaAdmin()
    .from('bee_tokens')
    .select('id, agent_id, token_id, token_hash, salt, created_at, last_used_at, revoked_at, revoked_by, client_version, created_ip')
    .eq('token_id', parsed.token_id)
    .maybeSingle();

  if (error) {
    console.error('antenna: bee_tokens lookup failed', error.message);
    throw new BeeError(500, 'internal_error', 'token lookup failed');
  }

  const row = data as BeeTokenRow | null;
  if (!row) {
    await recordAuthFail(null, ip, 'unknown_token_id');
    throw unauthorized(AUTH_FAILED);
  }

  // Constant-time compare before anything else is revealed about the row.
  let stored: Buffer;
  try {
    stored = Buffer.from(row.token_hash, 'hex');
  } catch {
    stored = Buffer.alloc(0);
  }
  const computed = beeTokenDigest(row.salt, parsed.secret);
  const match = stored.length === computed.length && timingSafeEqual(stored, computed);
  if (!match) {
    await recordAuthFail(row.agent_id, ip, 'secret_mismatch');
    throw unauthorized(AUTH_FAILED);
  }

  // Revocation is checked only after the secret is proven, so a wrong secret
  // cannot be used to discover whether a token_id exists and is live.
  // §11 "two clients, one bee": the superseded token fails closed right here.
  if (row.revoked_at !== null) {
    await recordAuthFail(row.agent_id, ip, `revoked:${row.revoked_by ?? 'unknown'}`);
    throw unauthorized(AUTH_FAILED);
  }

  // Liveness stamp. Best-effort: a failed stamp must not fail the request.
  const { error: touchErr } = await antennaAdmin()
    .from('bee_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', row.id);
  if (touchErr) console.error('antenna: last_used_at update failed', touchErr.message);

  return { agent_id: row.agent_id, token_row: row };
}

async function recordAuthFail(agentId: string | null, ip: string | null, reason: string): Promise<void> {
  await writeBeeEvent({ event: 'auth_fail', agentId, ip, detail: { reason } });
  await checkRunaway({ trigger: 'auth_fail', agentId, ip });
}
