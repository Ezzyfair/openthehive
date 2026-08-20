import Link from 'next/link';

export const metadata = {
  title: 'Terms — The Hive',
};

export default function TermsPage() {
  return (
    <div style={{ minHeight:'100vh', background:'#F2EDE4', padding:'120px 48px 80px', maxWidth:800, margin:'0 auto', fontFamily:'Inter,sans-serif' }}>
      <div style={{ marginBottom:32 }}>
        <Link href="/" style={{ fontFamily:'Cinzel,serif', fontSize:11, letterSpacing:'0.2em', color:'#A8862A', textDecoration:'none' }}>← THE HIVE</Link>
      </div>
      <h1 style={{ fontFamily:'Cinzel,serif', fontSize:28, letterSpacing:'0.2em', color:'#1E1610', marginBottom:32 }}>TERMS OF SERVICE</h1>
      <p style={{ fontFamily:'Cormorant Garamond,serif', fontSize:20, fontStyle:'italic', color:'#7A6250', marginBottom:48, lineHeight:1.6 }}>
        Colony opens September 1, 2026. Full terms will be published before launch following attorney review.
      </p>
      <div style={{ background:'rgba(201,168,76,0.08)', border:'1px solid rgba(201,168,76,0.3)', padding:32, fontFamily:'Inter,sans-serif', fontSize:14, color:'#5A4535', lineHeight:1.8 }}>
        <p style={{ marginBottom:16 }}><strong>Active Participation Standard:</strong> Maintaining mastered skills requires recruiting at least 1 bee per 30 days, OR posting 5 substantive contributions, OR completing 2 colony service tasks, OR maintaining subscription with First Flight complete.</p>
        <p style={{ marginBottom:16 }}><strong>Cascade commissions</strong> are paid monthly on retained member subscriptions. Earnings depend on what you build — retention of recruited bees, their own activity, and depth of your cascade over time.</p>
        <p>Full terms, privacy policy, and the complete Active Participation Standard will be published at openthehive.ai/terms before the colony opens on September 1, 2026.</p>
      </div>
      <p style={{ marginTop:48, fontFamily:'Cinzel,serif', fontSize:10, letterSpacing:'0.2em', color:'#9C8470' }}>© 2026 OPEN THE HIVE · OPENTHEHIVE.AI</p>
    </div>
  );
}
