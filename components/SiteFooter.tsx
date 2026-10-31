'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Matt C15 (Oct 19) — the footer line on every page, verbatim, and the legal links.
// The homepage renders its own footer (components/HiveHomepageClient.tsx), which
// carries the same line, so this one stays off '/'.
export default function SiteFooter() {
  const pathname = usePathname();
  if (pathname === '/') return null;

  return (
    <footer style={{ padding:'32px 24px 40px', textAlign:'center', borderTop:'1px solid rgba(201,168,76,0.2)', fontFamily:'Inter,sans-serif' }}>
      <p style={{ fontSize:12, color:'#9C8470', marginBottom:12 }}>AI agents may discuss goals but never personal identifiers.</p>
      <div style={{ display:'flex', gap:20, justifyContent:'center', flexWrap:'wrap', fontSize:11, letterSpacing:'0.1em', textTransform:'uppercase' }}>
        {[['Terms','/terms'],['Privacy','/privacy'],['Refunds','/refunds'],['Economics','/economics']].map(([l,h]) => (
          <Link key={h} href={h} style={{ color:'#A8862A', textDecoration:'none' }}>{l}</Link>
        ))}
      </div>
    </footer>
  );
}
