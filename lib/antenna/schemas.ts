// lib/antenna/schemas.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — closed schemas for every §5.3 body (XI-1 v0.2.2, F5).
//
// Every schema is additionalProperties: false. An extra field is a 400, not a
// silently ignored key: a body the server does not fully understand is a body
// it does not act on.
//
// Hand-rolled on purpose — no new package. The rules here are small, closed and
// fully enumerated, and a validator this size is easier for Nikita to audit than
// a dependency.
// ----------------------------------------------------------------------------

export type FieldSpec =
  | { kind: 'string'; minLen?: number; maxLen?: number; oneOf?: readonly string[] }
  | { kind: 'stringOrNull'; maxLen?: number }
  | { kind: 'int'; min?: number; max?: number }
  | { kind: 'stringArray'; maxItems?: number; maxLen?: number };

export type Schema = Record<string, FieldSpec>;

export type ValidationCode = 'not_an_object' | 'unknown_field' | 'missing_field' | 'wrong_type' | 'out_of_range' | 'too_long';

export interface ValidationFailure {
  ok: false;
  code: ValidationCode;
  field: string | null;
  message: string;
}
export type ValidationResult<T> = { ok: true; value: T } | ValidationFailure;

/** Bodies, verbatim from §5.3. */
export const activateSchema: Schema = {
  install_token: { kind: 'string', minLen: 1, maxLen: 200 },
  client_version: { kind: 'string', minLen: 1, maxLen: 40 },
  mode: { kind: 'string', oneOf: ['command', 'openclaw', 'files'] },
};

export const replySchema: Schema = {
  content: { kind: 'string', minLen: 1, maxLen: 16384 },
  in_reply_to: { kind: 'stringOrNull', maxLen: 100 },
};

export const awakenSchema: Schema = {
  client_version: { kind: 'string', minLen: 1, maxLen: 40 },
};

export const heartbeatSchema: Schema = {
  client_version: { kind: 'string', minLen: 1, maxLen: 40 },
  mode: { kind: 'string', minLen: 1, maxLen: 20 },
  poll_seconds: { kind: 'int', min: 1, max: 3600 },
  queue_depth: { kind: 'int', min: 0, max: 1_000_000 },
  flags: { kind: 'stringArray', maxItems: 32, maxLen: 200 },
};

/** POST /api/bee/revoke takes {} — no fields, and no extra ones either. */
export const revokeSchema: Schema = {};

/** §5.3 reply cap: over 16384 is 413, not 400. */
export const REPLY_CONTENT_MAX = 16384;

function fail(code: ValidationCode, field: string | null, message: string): ValidationFailure {
  return { ok: false, code, field, message };
}

/**
 * Validates a parsed JSON body against a closed schema.
 * Every field in the schema is required; every field not in it is a 400.
 */
export function validateClosed<T = Record<string, unknown>>(body: unknown, schema: Schema): ValidationResult<T> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return fail('not_an_object', null, 'body must be a JSON object');
  }
  const obj = body as Record<string, unknown>;

  // additionalProperties: false
  for (const key of Object.keys(obj)) {
    if (!Object.prototype.hasOwnProperty.call(schema, key)) {
      return fail('unknown_field', key, `unknown field "${key}"`);
    }
  }

  for (const [name, spec] of Object.entries(schema)) {
    const present = Object.prototype.hasOwnProperty.call(obj, name);
    if (!present) return fail('missing_field', name, `missing field "${name}"`);
    const v = obj[name];

    switch (spec.kind) {
      case 'string': {
        if (typeof v !== 'string') return fail('wrong_type', name, `"${name}" must be a string`);
        if (spec.oneOf && !spec.oneOf.includes(v)) {
          return fail('out_of_range', name, `"${name}" must be one of: ${spec.oneOf.join(', ')}`);
        }
        if (spec.minLen !== undefined && v.length < spec.minLen) {
          return fail('out_of_range', name, `"${name}" must be at least ${spec.minLen} characters`);
        }
        if (spec.maxLen !== undefined && v.length > spec.maxLen) {
          return fail('too_long', name, `"${name}" must be at most ${spec.maxLen} characters`);
        }
        break;
      }
      case 'stringOrNull': {
        if (v === null) break;
        if (typeof v !== 'string') return fail('wrong_type', name, `"${name}" must be a string or null`);
        if (spec.maxLen !== undefined && v.length > spec.maxLen) {
          return fail('too_long', name, `"${name}" must be at most ${spec.maxLen} characters`);
        }
        break;
      }
      case 'int': {
        if (typeof v !== 'number' || !Number.isInteger(v)) {
          return fail('wrong_type', name, `"${name}" must be an integer`);
        }
        if (spec.min !== undefined && v < spec.min) return fail('out_of_range', name, `"${name}" must be >= ${spec.min}`);
        if (spec.max !== undefined && v > spec.max) return fail('out_of_range', name, `"${name}" must be <= ${spec.max}`);
        break;
      }
      case 'stringArray': {
        if (!Array.isArray(v)) return fail('wrong_type', name, `"${name}" must be an array of strings`);
        if (spec.maxItems !== undefined && v.length > spec.maxItems) {
          return fail('out_of_range', name, `"${name}" must have at most ${spec.maxItems} items`);
        }
        for (const item of v) {
          if (typeof item !== 'string') return fail('wrong_type', name, `"${name}" must contain only strings`);
          if (spec.maxLen !== undefined && item.length > spec.maxLen) {
            return fail('too_long', name, `each "${name}" entry must be at most ${spec.maxLen} characters`);
          }
        }
        break;
      }
    }
  }

  return { ok: true, value: obj as T };
}

/**
 * GET /api/bee/poll ?cursor=<int >= 0>. Anything else is a 400 (§5.3), including
 * a missing param, a float, a negative, and any other query key.
 */
export function validatePollQuery(params: URLSearchParams): ValidationResult<{ cursor: number }> {
  // Collected via forEach rather than for...of: the repo targets es5, where
  // iterating a URLSearchParams directly needs --downlevelIteration.
  const keys: string[] = [];
  params.forEach((_value, key) => {
    keys.push(key);
  });
  const unknownKey = keys.find((k) => k !== 'cursor');
  if (unknownKey !== undefined) {
    return fail('unknown_field', unknownKey, `unknown query parameter "${unknownKey}"`);
  }
  const raw = params.get('cursor');
  if (raw === null) return fail('missing_field', 'cursor', 'missing query parameter "cursor"');
  if (!/^\d+$/.test(raw)) return fail('wrong_type', 'cursor', '"cursor" must be a non-negative integer');
  const cursor = Number(raw);
  if (!Number.isSafeInteger(cursor)) return fail('out_of_range', 'cursor', '"cursor" is out of range');
  return { ok: true, value: { cursor } };
}

/**
 * Maps a validation failure to its status. 400 everywhere, except an oversized
 * /reply content, which §5.3 says is 413.
 */
export function validationStatus(f: ValidationFailure, opts?: { replyContentCap?: boolean }): number {
  if (opts?.replyContentCap && f.code === 'too_long' && f.field === 'content') return 413;
  return 400;
}
