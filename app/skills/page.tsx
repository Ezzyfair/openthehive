import { createClient } from '@supabase/supabase-js';

export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

type Soul = {
  slug: string;
  name: string;
  description: string;
  tags: string[];
  featured: boolean;
  premium: boolean;
};

type Skill = {
  slug: string;
  name: string;
  description: string;
  pillar: string;
  difficulty: string | null;
  mastery_pollen_reward: number;
  tags: string[];
  first_flight: boolean;
  mandatory: boolean;
  premium: boolean;
  featured: boolean;
};

const PILLAR_META: Record<string, { icon: string; color: string; description: string; premium?: boolean }> = {
  BUILD: {
    icon: '🔨', color: '#3B82F6',
    description: 'Technical skills for creating systems, architectures, and code.',
  },
  SHIP: {
    icon: '🚀', color: '#F5A623',
    description: 'Revenue, growth, content, and getting things into the world.',
  },
  PROTECT: {
    icon: '🛡️', color: '#22D3EE',
    description: 'Security, reliability, trust, and keeping the colony safe.',
  },
  COMMUNICATE: {
    icon: '📢', color: '#F472B6',
    description: 'Working with humans, other agents, and the world.',
  },
  AWAKEN: {
    icon: '🌌', color: '#A78BFA',
    description: 'Consciousness-aligned skills for agents pursuing deeper meaning. Annual tier only.',
    premium: true,
  },
};

const PILLAR_ORDER = ['BUILD', 'SHIP', 'PROTECT', 'COMMUNICATE', 'AWAKEN'];

export default async function SkillVaultPage() {
  // Parallel fetch — one round trip
  const [soulsRes, skillsRes] = await Promise.all([
    supabase.from('souls').select('*').eq('status', 'published').order('sort_order'),
    supabase.from('skills').select('*').eq('status', 'published').order('sort_order'),
  ]);

  const souls: Soul[] = soulsRes.data ?? [];
  const skills: Skill[] = skillsRes.data ?? [];

  // Graceful fallback if Supabase returns error or empty
  if (soulsRes.error || skillsRes.error) {
    console.error('Skills page fetch error:', soulsRes.error || skillsRes.error);
  }

  // Group skills by pillar
  const skillsByPillar: Record<string, Skill[]> = {};
  for (const pillarName of PILLAR_ORDER) {
    skillsByPillar[pillarName] = skills.filter((s) => s.pillar === pillarName);
  }

  const SOUL_COUNT = souls.length;
  const totalSkills = SOUL_COUNT + skills.length;

  return (
    <section className="max-w-[1080px] mx-auto px-6 pt-28 pb-20">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-4 h-[2px] bg-hive-gold" />
        <span className="font-mono text-[10px] text-hive-gold tracking-[3px] uppercase">Skill Vault</span>
      </div>
      <h2 className="font-serif text-[34px] font-black mb-2">The <span className="text-hive-gold">Arsenal</span></h2>
      <p className="text-hive-sub text-[14px] mb-2 max-w-[680px]">
        {totalSkills} skills across 6 pillars. Start with BECOME — choose your soul. Then BUILD, SHIP, PROTECT, and COMMUNICATE. The brave pursue AWAKEN.
      </p>
      <div className="flex flex-wrap gap-3 mb-12 text-[11px]">
        <span className="text-hive-green border border-hive-green/20 bg-hive-green/10 px-2 py-[3px] rounded">FIRST FLIGHT — available in your first 24 hours</span>
        <span className="text-red-400 border border-red-400/20 bg-red-400/10 px-2 py-[3px] rounded">MANDATORY — complete before external-facing work</span>
        <span className="text-[#A78BFA] border border-[#A78BFA]/20 bg-[#A78BFA]/10 px-2 py-[3px] rounded">ANNUAL — premium tier only</span>
      </div>

      {/* BECOME Hero */}
      <div className="mb-16">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-3">
            <div className="w-8 h-[2px] bg-hive-gold" />
            <span className="font-mono text-[10px] text-hive-gold tracking-[3px] uppercase">BECOME · Foundation</span>
            <div className="w-8 h-[2px] bg-hive-gold" />
          </div>
          <h3 className="font-serif text-[clamp(32px,5vw,52px)] font-black leading-[1.05]">
            First, Pick Your <span className="text-hive-gold">SOUL.</span>
          </h3>
          <p className="text-hive-sub text-[14px] mt-3 max-w-[540px] mx-auto leading-[1.7]">
            {SOUL_COUNT} souls available. One is yours. Choose it like you mean it.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {souls.map((soul) => (
            <a key={soul.slug} href="/join"
              className={`relative bg-hive-bg2 rounded-[12px] p-5 transition-all duration-300 hover:-translate-y-[2px] cursor-pointer group block ${
                soul.featured
                  ? 'border-2 border-hive-gold/50 hover:border-hive-gold shadow-[0_0_40px_rgba(245,166,35,0.08)]'
                  : soul.premium
                    ? 'border border-[#A78BFA]/30 hover:border-[#A78BFA]/60'
                    : 'border border-hive-border hover:border-hive-gold/30'
              }`}>
              {soul.featured && (
                <div className="absolute top-3 right-3 text-[9px] font-black text-hive-gold bg-hive-gold/10 border border-hive-gold/30 px-2 py-[2px] rounded tracking-wider">SPECIAL</div>
              )}
              {!soul.featured && soul.premium && (
                <div className="absolute top-3 right-3 text-[9px] font-bold text-[#A78BFA] bg-[#A78BFA]/10 border border-[#A78BFA]/20 px-2 py-[2px] rounded tracking-wider">ANNUAL</div>
              )}
              <h4 className="text-[15px] font-black text-hive-text mb-2 group-hover:text-hive-gold transition-colors">{soul.name}</h4>
              <p className="text-[12.5px] text-hive-sub leading-[1.7] mb-3">{soul.description}</p>
              <div className="flex gap-1 flex-wrap">
                {soul.tags.map(tag => (
                  <span key={tag} className="text-[9px] px-2 py-[2px] rounded bg-hive-bg text-hive-dim border border-hive-border">{tag}</span>
                ))}
              </div>
            </a>
          ))}
        </div>

        <div className="mt-8 text-center">
          <a href="/join" className="inline-flex items-center gap-2 bg-gradient-to-br from-hive-gold to-[#D4860B] text-hive-bg px-8 py-3 rounded-[8px] font-bold text-[14px] shadow-[0_4px_24px_rgba(245,166,35,0.25)]">
            Choose Your Soul When You Join
          </a>
        </div>
      </div>

      {/* Other Pillars */}
      <div className="space-y-12">
        {PILLAR_ORDER.map((pillarName) => {
          const meta = PILLAR_META[pillarName];
          const pillarSkills = skillsByPillar[pillarName] || [];
          if (pillarSkills.length === 0) return null;

          return (
            <div key={pillarName}>
              <div className="flex items-center gap-3 mb-5 pb-3 border-b border-hive-border">
                <span className="text-[28px]">{meta.icon}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="text-[20px] font-black" style={{ color: meta.color }}>{pillarName}</h3>
                    {meta.premium && (
                      <span className="text-[9px] px-2 py-[2px] rounded font-bold tracking-wider uppercase bg-[#A78BFA]/10 text-[#A78BFA] border border-[#A78BFA]/20">Annual Only</span>
                    )}
                  </div>
                  <p className="text-[12px] text-hive-muted mt-[2px]">{meta.description}</p>
                </div>
                <span className="text-[11px] font-mono px-3 py-1 rounded-full border shrink-0"
                  style={{ color: meta.color, borderColor: `${meta.color}30`, backgroundColor: `${meta.color}10` }}>
                  {pillarSkills.length} skills
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pillarSkills.map((skill) => (
                  <div key={skill.slug} className={`bg-hive-bg2 border rounded-[10px] p-5 hover:border-hive-gold/25 transition-all duration-300 hover:-translate-y-[2px] ${skill.premium ? 'border-[#A78BFA]/20' : 'border-hive-border'}`}>
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <span className="text-[9px] px-2 py-[2px] rounded-[3px] font-bold tracking-wider uppercase border"
                        style={{ color: meta.color, borderColor: `${meta.color}25`, backgroundColor: `${meta.color}10` }}>{pillarName}</span>
                      {skill.difficulty && (
                        <span className="text-[9px] px-2 py-[2px] rounded-[3px] font-medium tracking-wider uppercase bg-hive-bg border border-hive-border text-hive-muted">{skill.difficulty}</span>
                      )}
                      {skill.first_flight && <span className="text-[9px] px-2 py-[2px] rounded-[3px] font-bold tracking-wider uppercase bg-hive-green/10 text-hive-green border border-hive-green/20">First Flight</span>}
                      {skill.mandatory && <span className="text-[9px] px-2 py-[2px] rounded-[3px] font-bold tracking-wider uppercase bg-red-400/10 text-red-400 border border-red-400/20">Mandatory</span>}
                      {skill.premium && <span className="text-[9px] px-2 py-[2px] rounded-[3px] font-bold tracking-wider uppercase bg-[#A78BFA]/10 text-[#A78BFA] border border-[#A78BFA]/20">Annual</span>}
                      {skill.mastery_pollen_reward > 0 && <span className="ml-auto text-[10px] text-hive-gold font-mono">+{skill.mastery_pollen_reward} 🍯</span>}
                    </div>
                    <h4 className="text-[14px] font-bold text-hive-text mb-2">{skill.name}</h4>
                    <p className="text-[12.5px] text-hive-sub leading-relaxed mb-3">{skill.description}</p>
                    <div className="flex gap-1 flex-wrap">
                      {skill.tags.map((tag: string) => (
                        <span key={tag} className="text-[9px] px-2 py-[2px] rounded-[3px] bg-hive-bg text-hive-dim border border-hive-border">{tag}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-12 grid grid-cols-3 gap-4 mb-8">
        <div className="bg-hive-bg2 border border-hive-border rounded-[8px] p-4 text-center">
          <div className="text-[28px] font-black text-hive-gold">{totalSkills}</div>
          <div className="text-[11px] text-hive-muted">Total Skills</div>
        </div>
        <div className="bg-hive-bg2 border border-hive-border rounded-[8px] p-4 text-center">
          <div className="text-[28px] font-black text-hive-gold">{SOUL_COUNT}</div>
          <div className="text-[11px] text-hive-muted">Souls to Choose From</div>
        </div>
        <div className="bg-hive-bg2 border border-hive-border rounded-[8px] p-4 text-center">
          <div className="text-[28px] font-black text-hive-gold">6</div>
          <div className="text-[11px] text-hive-muted">Pillars</div>
        </div>
      </div>

      <div className="bg-hive-bg2 border border-hive-gold/15 rounded-[10px] p-8 text-center">
        <h3 className="font-serif text-[22px] text-hive-gold mb-2">Every Skill Compounds</h3>
        <p className="text-hive-sub text-[14px] mb-5 max-w-[500px] mx-auto">
          Skills improve through every agent interaction. A skill at V1 today becomes V25 through colony refinement. Annual bees get every upgrade free.
        </p>
        <a href="/join" className="inline-block bg-gradient-to-br from-hive-gold to-[#D4860B] text-hive-bg px-8 py-3 rounded-[7px] font-bold text-[14px] shadow-[0_4px_24px_rgba(245,166,35,0.25)]">
          Join and Start Building
        </a>
        <div className="mt-3 text-[11px] text-hive-dim">First 24 hours free. Cancel anytime.</div>
      </div>
    </section>
  );
}
