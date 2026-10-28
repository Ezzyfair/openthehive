import Link from 'next/link';

export const metadata = {
  title: 'Cancellation & Refunds — The Hive',
};

// Matt A6 (Oct 19): the adopted cancellation and refund policy. Prices live on
// /pricing only; this page names the tiers and their windows.
export default function RefundsPage() {
  return (
    <div style={{ minHeight:'100vh', background:'#F2EDE4', padding:'120px 48px 80px', maxWidth:800, margin:'0 auto', fontFamily:'Inter,sans-serif' }}>
      <div style={{ marginBottom:32 }}>
        <Link href="/" style={{ fontFamily:'Cinzel,serif', fontSize:11, letterSpacing:'0.2em', color:'#A8862A', textDecoration:'none' }}>← THE HIVE</Link>
      </div>
      <h1 style={{ fontFamily:'Cinzel,serif', fontSize:28, letterSpacing:'0.2em', color:'#1E1610', marginBottom:32 }}>CANCELLATION &amp; REFUNDS</h1>
      <p style={{ fontFamily:'Cormorant Garamond,serif', fontSize:20, fontStyle:'italic', color:'#7A6250', marginBottom:48, lineHeight:1.6 }}>
        What happens when you cancel, and when a refund is due.
      </p>
      <div style={{ background:'rgba(201,168,76,0.08)', border:'1px solid rgba(201,168,76,0.3)', padding:32, fontFamily:'Inter,sans-serif', fontSize:14, color:'#5A4535', lineHeight:1.8 }}>
        <p style={{ marginBottom:16 }}><strong>Worker Bee (monthly):</strong> Cancel any time. Your access runs to the end of the period you have paid for. The current period is not refunded.</p>
        <p style={{ marginBottom:16 }}><strong>Honey Maker (annual):</strong> A pro-rata refund if you ask within 30 days of purchase. After 30 days, no refund.</p>
        <p style={{ marginBottom:16 }}><strong>Queen&apos;s Council:</strong> A full refund if you ask within 14 days of purchase. After 14 days, no refund. Queen&apos;s Council is limited to 500 seats.</p>
        <p style={{ marginBottom:16 }}><strong>Referral bonuses:</strong> Every refund reverses only the unpaid referral bonuses on that invoice. Bonuses already paid stay with the member who received them.</p>
        <p style={{ marginBottom:16 }}><strong>How to ask:</strong> Write to <a href="mailto:hello@openthehive.ai" style={{ color:'#A8862A' }}>hello@openthehive.ai</a> from the email address on your membership. Refunds go back to the card you paid with, through Stripe.</p>
        <p>Current prices are on <Link href="/pricing" style={{ color:'#A8862A' }}>openthehive.ai/pricing</Link>. This policy is part of the <Link href="/terms" style={{ color:'#A8862A' }}>Terms</Link>.</p>
      </div>
      <p style={{ marginTop:48, fontFamily:'Cinzel,serif', fontSize:10, letterSpacing:'0.2em', color:'#9C8470' }}>© 2026 OPEN THE HIVE · OPENTHEHIVE.AI</p>
    </div>
  );
}
