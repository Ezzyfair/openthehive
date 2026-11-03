// app/member/login/confirm/page.tsx
// ----------------------------------------------------------------------------
// THE HIVE — where the emailed link lands (MEMBER-001 item 1).
//
// One button and nothing else. Mail apps pre-open links; rendering this page does
// not touch the token, so only a person pressing the button spends it. A plain form
// POST, so it works with no script running and no script can press it by loading.
// ----------------------------------------------------------------------------
import type { Metadata } from 'next';
import Link from 'next/link';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The token is in this page's URL: keep it out of other sites' Referer headers and out
// of indexes. same-origin, not no-referrer: no-referrer makes the browser send
// `Origin: null` on the form POST, and the button would be refused as cross-site.
export const metadata: Metadata = {
  title: 'Sign in — The Hive',
  referrer: 'same-origin',
  robots: { index: false, follow: false },
};

export default function MemberLoginConfirmPage({ searchParams }: { searchParams: { token?: string | string[] } }) {
  const token = typeof searchParams.token === 'string' ? searchParams.token : '';

  return (
    <main style={{ maxWidth: 460, margin: '0 auto', padding: '96px 24px' }}>
      <h1 style={{ fontFamily: 'Cormorant Garamond,serif', fontSize: 34, marginBottom: 28 }}>Sign in to The Hive</h1>
      {token ? (
        <form method="post" action="/auth/member/confirm">
          <input type="hidden" name="token" value={token} />
          <button type="submit" style={{ width: '100%', padding: '12px 16px', fontSize: 15, borderRadius: 8, cursor: 'pointer' }}>
            Sign me in
          </button>
        </form>
      ) : (
        <Link href="/member/login" style={{ fontSize: 15, textDecoration: 'underline' }}>
          Send me a sign-in link
        </Link>
      )}
    </main>
  );
}
