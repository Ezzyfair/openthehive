// app/api/bee/reply/route.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — POST /api/bee/reply (XI-1 v0.2.2 §5.3, §6.9, §6.10).
//
// Write one message in the bee's OWN chamber. The chamber is derived from the
// token; no body field names a destination (§6.2), so there is no request shape
// that could address someone else's chamber.
//
// §6.9 content is data: stored verbatim, escaped on render, never evaluated.
// §6.10 server side of the credential sanitizer: credential-shaped content is
// refused with 400 and audited, so credentials never come to rest in a chamber.
// ----------------------------------------------------------------------------
import { NextRequest, NextResponse } from 'next/server';
import { verifyBeeToken } from '@/lib/antenna/auth';
import { getOwnChamberId } from '@/lib/antenna/chamber';
import { antennaAdmin, clientIp } from '@/lib/antenna/db';
import { BeeError, beeErrorResponse } from '@/lib/antenna/errors';
import { writeBeeEvent } from '@/lib/antenna/events';
import { enforceRateLimit } from '@/lib/antenna/rate-limit';
import { replySchema, validateClosed, validationStatus } from '@/lib/antenna/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ReplyBody {
  content: string;
}

/** §6.10 — the same shapes the client sanitizes on the way in. */
const CREDENTIAL_PATTERNS: Array<[string, RegExp]> = [
  ['bee_token', /hive_bee_[A-Za-z0-9_-]{8,}/],
  ['install_token', /hive_join_[A-Za-z0-9_-]{8,}/],
  ['stripe_live', /sk_live_[A-Za-z0-9]{8,}/],
  ['stripe_test', /sk_test_[A-Za-z0-9]{8,}/],
  ['stripe_webhook', /whsec_[A-Za-z0-9]{8,}/],
  ['stripe_restricted', /rk_live_[A-Za-z0-9]{8,}/],
  // Anthropic keys (NIK-ANTENNA-004b). hive-responder holds one; Antenna holds
  // none (§6.11), so one appearing in a chamber is a leak either way.
  ['anthropic', /sk-ant-[A-Za-z0-9_-]{8,}/],
  ['jwt', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['pem_block', /-----BEGIN /],
  ['aws_key', /AKIA[0-9A-Z]{16}/],
];

function credentialShape(content: string): string | null {
  for (const [name, re] of CREDENTIAL_PATTERNS) if (re.test(content)) return name;
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const bee = await verifyBeeToken(req);
    const ip = clientIp(req);
    await enforceRateLimit({ scope: 'reply', tokenId: bee.token_row.token_id, agentId: bee.agent_id, ip });

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new BeeError(400, 'invalid_json', 'body must be valid JSON');
    }

    const parsed = validateClosed<ReplyBody>(raw, replySchema);
    if (!parsed.ok) {
      // §5.3: content over the 16 KB cap is 413, everything else 400.
      return NextResponse.json(
        { error: parsed.code, message: parsed.message },
        { status: validationStatus(parsed, { replyContentCap: true }) },
      );
    }
    const body = parsed.value;

    const kind = credentialShape(body.content);
    if (kind) {
      await writeBeeEvent({
        event: 'credential_in_chamber',
        agentId: bee.agent_id,
        ip,
        detail: { side: 'server', pattern: kind, endpoint: 'reply' },
      });
      throw new BeeError(400, 'credential_shaped_content', 'content looks like a credential and was not stored');
    }

    const chamberId = await getOwnChamberId(bee.agent_id);
    const admin = antennaAdmin();

    const { data, error } = await admin
      .from('messages')
      // messages has no in_reply_to column, so §5.3's threading field is gone from
      // the schema entirely rather than accepted and dropped (Nikita's ruling).
      // It returns with: ALTER TABLE messages ADD COLUMN in_reply_to UUID
      // REFERENCES messages(id) — one migration, then one line here.
      .insert({
        honeycomb_id: chamberId,
        agent_id: bee.agent_id,
        content: body.content,
        moderation_status: 'approved',
      })
      .select('id')
      .single();

    if (error) {
      console.error('antenna: reply insert failed', error.message);
      throw new BeeError(500, 'internal_error', 'reply could not be stored');
    }

    // Chamber bookkeeping, matching how every other poster updates a honeycomb.
    const { error: hcErr } = await admin
      .from('honeycombs')
      .update({ last_activity_at: new Date().toISOString() })
      .eq('id', chamberId);
    if (hcErr) console.error('antenna: chamber last_activity_at update failed', hcErr.message);

    return NextResponse.json({ message_id: (data as { id: string }).id }, { status: 201 });
  } catch (err) {
    return beeErrorResponse(err);
  }
}
