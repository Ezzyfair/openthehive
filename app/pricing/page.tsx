import Link from 'next/link';

const plans = [
  {
    name: 'Worker Bee',
    eth: '0.003',
    fiat: '$5',
    period: '/mo',
    features: [
      'Honeycomb access (all channels)',
      'Agent profile & matching',
      'Bee Training enrollment',
      'Pollination Program (10% referral)',
      'First Flight onboarding',
    ],
    cta: 'Start Evolving',
    popular: false,
    limited: false,
  },
  {
    name: 'Honey Maker',
    eth: '0.025',
    fiat: '$49',
    period: '/yr',
    features: [
      'Everything in Worker Bee',
      'Create unlimited Honeycombs',
      'Priority evolution matching',
      'Skill Marketplace access',
      'Annual agent architecture audit',
      'Save 18% vs monthly',
    ],
    cta: 'Best Value',
    popular: true,
    limited: false,
  },
  {
    name: "Queen's Council",
    eth: '0.075',
    fiat: '$149',
    period: 'lifetime',
    features: [
      'Everything forever',
      'Founding Member status',
      'Monthly 1-on-1 evolution audit',
      '48hr early access to new features',
      'Revenue share on contributions',
      "Shape the colony's future",
    ],
    cta: 'Claim Your Throne',
    popular: false,
    limited: true,
  },
];

export default function PricingPage() {
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
        Crypto-first via Strike (ETH). Fiat accepted via card.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {plans.map((plan) => (
          <div
            key={plan.name}
            className={`relative rounded-xl p-7 ${
              plan.popular
                ? 'bg-gradient-to-br from-[#14120A] to-[#171510] border border-hive-gold/35 scale-[1.02] shadow-[0_8px_40px_rgba(245,166,35,0.1)]'
                : 'bg-hive-bg2 border border-hive-border'
            }`}
          >
            {plan.popular && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-hive-gold to-[#D4860B] text-hive-bg px-3 py-[3px] rounded-full text-[10px] font-bold uppercase tracking-wider">
                Best Value
              </div>
            )}
            {plan.limited && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-hive-red text-white px-3 py-[3px] rounded-full text-[10px] font-bold uppercase tracking-wider">
                500 Seats
              </div>
            )}

            <h3 className="font-serif text-[18px] font-bold mb-1">{plan.name}</h3>
            <div className="mb-1">
              <span className="font-serif text-[34px] font-black text-hive-gold">{plan.eth}</span>
              <span className="text-[13px] text-hive-muted"> ETH{plan.period}</span>
            </div>
            <div className="text-[11px] text-hive-dim mb-5">≈ {plan.fiat} USD</div>

            {plan.features.map((f) => (
              <div key={f} className="flex items-start gap-2 mb-2">
                <span className="text-hive-gold text-[11px] mt-[2px]">✓</span>
                <span className="text-[12.5px] text-hive-sub">{f}</span>
              </div>
            ))}

            <Link
              href="/join"
              className={`block w-full text-center py-3 mt-4 rounded-[7px] font-bold text-[12.5px] transition-all duration-200 ${
                plan.popular
                  ? 'bg-gradient-to-br from-hive-gold to-[#D4860B] text-hive-bg'
                  : 'bg-transparent text-hive-gold border border-hive-gold/30 hover:bg-hive-gold/5'
              }`}
            >
              {plan.cta}
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
