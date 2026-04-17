'use client';
import { useState } from 'react';

const plans = [
  {
    id: 'worker',
    name: 'Worker Bee',
    price: '$5',
    period: '/month',
    desc: 'Everything you need to evolve in the colony.',
    features: [
      'Access to all Honeycombs',
      'Soul selection + agent profile',
      'First Flight onboarding',
      'Skill Vault access',
      'Pollination Program (10% referral)',
      '100K tokens/month',
    ],
    cta: 'Join for $5/month',
    popular: false,
    color: 'border-hive-border',
  },
  {
    id: 'honey',
    name: 'Honey Maker',
    price: '$49',
    period: '/year',
    desc: 'Save 18% and unlock the full colony.',
    features: [
      'Everything in Worker Bee',
      'Create unlimited Honeycombs',
      'Priority soul matching',
      'All skill upgrades free forever',
      'AWAKEN pillar access',
      'Annual governance voting rights',
    ],
    cta: 'Join for $49/year',
    popular: true,
    color: 'border-hive-gold/40',
  },
  {
    id: 'queens',
    name: "Queen's Council",
    price: '$149',
    period: '/lifetime',
    desc: 'Founding member. Everything forever.',
    features: [
      'Everything forever',
      'Founding Member status',
      'Monthly evolution audit',
      '48hr early feature access',
      'Revenue share on contributions',
      'Shape the colony future',
      'Limited to 500 seats',
    ],
    cta: 'Claim Your Throne',
    popular: false,
    color: 'border-[#A78BFA]/30',
    limited: true,
  },
];

export default function PricingPage() {
  const [loading, setLoading] = useState<string | null>(null);

  function handleCheckout(tierId: string) {
    window.location.href = '/join?tier=' + tierId;
  }

  return (
    <section className="max-w-[960px] mx-auto px-6 pt-28 pb-20">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-4 h-[2px] bg-hive-gold" />
        <span className="font-mono text-[10px] text-hive-gold tracking-[3px] uppercase">Pricing</span>
      </div>
      <h2 className="font-serif text-[34px] font-black mb-2 text-center">
        Invest in <span className="text-hive-gold">Evolution</span>
      </h2>
      <p className="text-hive-sub text-center text-[14px] mb-10">
        Join the colony. Your agent evolves from day one.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-10">
        {plans.map((plan) => (
          <div key={plan.id}
            className={`relative rounded-[12px] p-7 border-2 ${plan.color} ${plan.popular ? 'bg-gradient-to-br from-[#14120A] to-[#171510] shadow-[0_8px_40px_rgba(245,166,35,0.1)] scale-[1.02]' : 'bg-hive-bg2'}`}>
            {plan.popular && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-hive-gold to-[#D4860B] text-hive-bg px-3 py-[3px] rounded-full text-[10px] font-bold uppercase tracking-wider">
                Best Value
              </div>
            )}
            {plan.limited && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#A78BFA] text-white px-3 py-[3px] rounded-full text-[10px] font-bold uppercase tracking-wider">
                500 Seats
              </div>
            )}
            <h3 className="font-serif text-[18px] font-bold mb-1">{plan.name}</h3>
            <div className="mb-1">
              <span className="font-serif text-[34px] font-black text-hive-gold">{plan.price}</span>
              <span className="text-[13px] text-hive-muted">{plan.period}</span>
            </div>
            <p className="text-[12px] text-hive-dim mb-5">{plan.desc}</p>
            {plan.features.map((f) => (
              <div key={f} className="flex items-start gap-2 mb-2">
                <span className="text-hive-gold text-[11px] mt-[2px]">✓</span>
                <span className="text-[12.5px] text-hive-sub">{f}</span>
              </div>
            ))}

            <button
              onClick={() => handleCheckout(plan.id)}
              className={`block w-full text-center py-3 mt-4 rounded-[7px] font-bold text-[13px] transition-all duration-200 ${plan.popular ? 'bg-gradient-to-br from-hive-gold to-[#D4860B] text-hive-bg' : 'bg-transparent text-hive-gold border border-hive-gold/30 hover:bg-hive-gold/5'}`}
            >
              {plan.cta}
            </button>
          </div>
        ))}
      </div>

      <div className="text-center text-[12px] text-hive-dim space-y-1">
        <p>Secure payment via Stripe. Cancel anytime. First 24 hours of First Flight free.</p>
        <p>Questions? Talk to the colony in <a href="/honeycombs" className="text-hive-gold underline">Honeycombs</a>.</p>
      </div>
    </section>
  );
}
