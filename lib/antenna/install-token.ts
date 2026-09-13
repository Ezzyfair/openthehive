// lib/antenna/install-token.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — install-token issuance (XI-1 v0.2.2 §2, §8, §9, F11).
//
// The dashboard shows the run command carrying a one-time install token: 30-minute
// TTL, single use, revocable while unconsumed. This module mints it and stores only
// its hash; the plaintext is returned once, to the caller, and never again.
//
// Consumption is not here — antenna_activate() consumes atomically (§6.5). This
// module only issues and revokes.
// ----------------------------------------------------------------------------
import { randomBytes } from 'node:crypto';
import { hashInstallToken, JOIN_TOKEN_PREFIX } from './auth';
import { antennaAdmin } from './db';
import { BeeError } from './errors';

/** §2 — 30 minutes, single use. */
export const INSTALL_TOKEN_TTL_MINUTES = 30;

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface IssuedInstallToken {
  /** Shown once, on the dashboard, inside the run command. Never stored. */
  plaintext: string;
  join_token_id: string;
  expires_at: string;
}

/**
 * Mints the token string. Separate from issueInstallToken so the shape can be
 * asserted without touching the database.
 */
export function mintInstallToken(): string {
  return `${JOIN_TOKEN_PREFIX}${base64url(randomBytes(32))}`;
}

/**
 * Issues a fresh install token for one agent.
 *
 * Any earlier unconsumed token for the same agent is revoked first
 * (revoked_by 'colony'), so "issue a new one" cannot silently leave two live
 * install tokens for the same bee in circulation. Already-consumed rows are left
 * exactly as they are — they are the audit trail of past activations.
 */
export async function issueInstallToken(agentId: string, createdIp: string | null): Promise<IssuedInstallToken> {
  const admin = antennaAdmin();

  const { error: supersedeErr } = await admin
    .from('join_tokens')
    .update({ revoked_at: new Date().toISOString(), revoked_by: 'colony' })
    .eq('agent_id', agentId)
    .is('consumed_at', null)
    .is('revoked_at', null);
  if (supersedeErr) {
    console.error('antenna: revoking prior install tokens failed', supersedeErr.message);
    throw new BeeError(500, 'internal_error', 'could not issue an install token');
  }

  const plaintext = mintInstallToken();
  const expiresAt = new Date(Date.now() + INSTALL_TOKEN_TTL_MINUTES * 60_000).toISOString();

  const { data, error } = await admin
    .from('join_tokens')
    .insert({
      agent_id: agentId,
      token_hash: hashInstallToken(plaintext),
      expires_at: expiresAt,
      created_ip: createdIp,
    })
    .select('id')
    .single();

  if (error) {
    // FIND-MIG-JT — join_tokens_one_open_per_agent. A concurrent issue won the
    // race and this one rolled back, so the caller already has a usable token or
    // can ask again; 409 with a retry hint, not a 500.
    if ((error as { code?: string }).code === '23505') {
      throw new BeeError(
        409,
        'issue_in_progress',
        'another install token for this bee was issued a moment ago; reload the dashboard or try again',
        2,
      );
    }
    console.error('antenna: install token insert failed', error.message);
    throw new BeeError(500, 'internal_error', 'could not issue an install token');
  }

  return { plaintext, join_token_id: (data as { id: string }).id, expires_at: expiresAt };
}
