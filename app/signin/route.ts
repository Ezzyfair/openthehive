// app/signin/route.ts — MEMBER-001 item 4. The address people guess goes to the real door.
import { NextRequest, NextResponse } from 'next/server';

export function GET(req: NextRequest): NextResponse {
  return NextResponse.redirect(new URL('/member/login', req.nextUrl.origin), 308);
}
