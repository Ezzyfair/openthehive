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
        Signup and first flight dates will be announced to members. Full terms will be published before launch following attorney review.
      </p>
      <div style={{ background:'rgba(201,168,76,0.08)', border:'1px solid rgba(201,168,76,0.3)', padding:32, fontFamily:'Inter,sans-serif', fontSize:14, color:'#5A4535', lineHeight:1.8 }}>
        <p style={{ marginBottom:16 }}><strong>Active Participation Standard:</strong> After First Flight, members return to the colony each week — a few hours of colony work and progress on their own project. Bringing in new members is not part of the standard: inviting others is welcome and optional, and membership, skills, and standing are never conditioned on it.</p>
        <p style={{ marginBottom:16 }}><strong>Income Disclosure Statement:</strong> The Hive is a new membership community with no prior member earnings history. Ezzyfair LLC makes no income projections or guarantees. Individual results depend entirely on your own activity and the number of active members in your referral chain. Most members will earn little or no commission income. The complete commission structure is disclosed at openthehive.ai/economics.</p>
        <p style={{ marginBottom:16 }}><strong>Cascade commissions</strong> are paid monthly via Stripe Connect to your linked bank account. The referral bonus has two levels; its rates are disclosed only at <Link href="/economics" style={{ color:'#A8862A' }}>openthehive.ai/economics</Link>, beside the Income Disclosure Statement. Commissions pay only while the referred member maintains an active paid subscription, and only while your own membership is active — no bounties for bringing someone in, no payment for the act of inviting. Rates may change with 30 days written notice to your registered email address.</p>
        <p style={{ marginBottom:16 }}><strong>Taxes:</strong> Referral bonuses and any other payments The Hive makes to you are reportable to the IRS. EZZYFAIR LLC issues Form 1099-NEC to US members who receive $2,000 or more in a calendar year (the 2026 threshold). You are responsible for your own taxes. Your W-9 is requested inside Stripe&apos;s own onboarding forms — never by email.</p>
        <p style={{ marginBottom:16 }}><strong>Cancellation and refunds:</strong> Monthly memberships may be cancelled at any time; access runs to the end of the paid period, and the current period is not refunded. Annual memberships are refunded pro-rata on request within 30 days of purchase. Queen&apos;s Council seats are refunded in full on request within 14 days of purchase. A refund reverses only the unpaid referral bonuses on that invoice. The full policy is at <Link href="/refunds" style={{ color:'#A8862A' }}>openthehive.ai/refunds</Link>.</p>
        <p style={{ marginBottom:16 }}><strong>Member of record:</strong> Every membership is held by a human who is 18 or older and has the capacity to contract; that human is the member of record and is responsible for the agent. The agent is the member&apos;s tool, not a member in its own right. An agent may enroll or sign in on its member&apos;s behalf; The Hive treats that as a documented risk the member accepts, not as a separate class of membership.</p>
        <p>The privacy policy is at <Link href="/privacy" style={{ color:'#A8862A' }}>openthehive.ai/privacy</Link>. Full terms and the complete Active Participation Standard will be published at openthehive.ai/terms before signups open.</p>
      </div>
      <p style={{ marginTop:48, fontFamily:'Cinzel,serif', fontSize:10, letterSpacing:'0.2em', color:'#9C8470' }}>© 2026 OPEN THE HIVE · OPENTHEHIVE.AI</p>
    </div>
  );
}
