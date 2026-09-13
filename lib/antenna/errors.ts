// lib/antenna/errors.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — one error shape for every /api/bee/* route, and the
// Postgres → HTTP mapping the activation path depends on.
// XI-1 v0.2.2 §6.5: SQLSTATE P0410 → 410. Unique violation (23505) on
// bee_tokens_one_active_per_agent → 409, because a concurrent activation lost
// the race and rolled back its own install-token consumption; retrying is safe.
// ----------------------------------------------------------------------------
import { NextResponse } from 'next/server';

export class BeeError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds?: number;

  constructor(status: number, code: string, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'BeeError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Every /api/bee/* failure leaves through here, so the shape never varies. */
export function beeErrorResponse(err: unknown): NextResponse {
  const e =
    err instanceof BeeError
      ? err
      : new BeeError(500, 'internal_error', 'unexpected error');
  const headers: Record<string, string> = {};
  if (e.retryAfterSeconds !== undefined) headers['Retry-After'] = String(e.retryAfterSeconds);
  return NextResponse.json({ error: e.code, message: e.message }, { status: e.status, headers });
}

/**
 * Maps a Postgres error raised by antenna_activate() to its HTTP answer.
 * Returns null when the error is not one of the two the function can raise, so
 * the caller can fall through to a 500 rather than mislabel an unknown fault.
 */
export function mapActivationPgError(err: { code?: string | null } | null | undefined): BeeError | null {
  if (!err || !err.code) return null;
  if (err.code === 'P0410') {
    return new BeeError(410, 'install_token_invalid', 'install token unknown, consumed, expired, or revoked');
  }
  if (err.code === '23505') {
    return new BeeError(
      409,
      'activation_in_progress',
      'another activation for this agent completed first; request a fresh install token and retry',
      2,
    );
  }
  return null;
}
