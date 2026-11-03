// app/auth/member/send/route.ts
// ----------------------------------------------------------------------------
// THE HIVE — POST: mail a member their sign-in link and code (MEMBER-001 items 1, 2, 8).
//
// Same answer whether or not the address is a member: this route must not become a
// way to test which emails exist. Only a real member gets mail and an auth user;
// signInWithOtp from the browser would have created one for any address.
//
// Not under app/api/member/: nobody calling this has a session yet.
// ----------------------------------------------------------------------------
import { NextRequest, NextResponse } from 'next/server';
import { antennaAdmin, clientIp } from '@/lib/antenna/db';
import { BeeError } from '@/lib/antenna/errors';
import { enforceRateLimit } from '@/lib/antenna/rate-limit';
import { sendEmail } from '@/lib/mail/sendEmail';
import { SIGNIN_SUBJECT, SIGNIN_TEMPLATE, emailBucket, normalizeEmail, sameOrigin, signinHtml } from '@/lib/member-auth';
import { memberErrorResponse, memberJson } from '@/lib/member-reads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    if (!sameOrigin(req)) throw new BeeError(403, 'bad_origin', 'request refused');
    const body = await req.json().catch(() => null);
    const email = normalizeEmail(body?.email);
    if (!email) throw new BeeError(400, 'invalid_email', 'Please enter the email address on your membership.');

    await enforceRateLimit({ scope: 'signin_ip', ip: clientIp(req) });
    await enforceRateLimit({ scope: 'signin_email', tokenId: emailBucket(email), ip: clientIp(req) });

    const admin = antennaAdmin();
    const { data: member, error: memberErr } = await admin.from('members').select('id').eq('email', email).maybeSingle();
    if (memberErr) {
      console.error('member sign-in: member lookup failed', memberErr.message);
      throw new BeeError(500, 'internal_error', 'Could not send the link. Try again in a moment.');
    }

    if (member) {
      const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
      const hashed = data?.properties?.hashed_token;
      const code = data?.properties?.email_otp;
      if (error || !hashed || !code) {
        console.error('member sign-in: generateLink failed', error?.message ?? 'no token returned');
        throw new BeeError(500, 'internal_error', 'Could not send the link. Try again in a moment.');
      }
      const link = `${req.nextUrl.origin}/member/login/confirm?token=${encodeURIComponent(hashed)}`;
      const sent = await sendEmail({
        supabase: admin,
        to: email,
        category: 'operational',
        template: SIGNIN_TEMPLATE,
        subject: SIGNIN_SUBJECT,
        html: signinHtml(link, code),
      });
      if (!sent.sent) console.error('member sign-in: mail not sent', sent.reason ?? 'provider error');
    }

    return memberJson({ ok: true });
  } catch (err) {
    return memberErrorResponse(err);
  }
}
