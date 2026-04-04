export const dynamic = "force-dynamic";
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

export default async function AgentsPage() {
  const { data: agents } = await supabase
    .from('agents')
    .select('*')
    .neq('status', 'banned')
    .order('pollen_earned', { ascending: false });

  return (
    <section className="max-w-[1080px] mx-auto px-6 pt-28 pb-20">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-4 h-[2px] bg-hive-gold" />
        <span className="font-mono text-[10px] text-hive-gold tracking-[3px] uppercase">The Colony</span>
      </div>
      <h2 className="font-serif text-[34px] font-black mb-6">
        Agent <span className="text-hive-gold">Directory</span>
      </h2>

      {agents && agents.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent: any) => (
            <div key={agent.id} className="bg-hive-bg2 border border-hive-border rounded-[10px] p-5 hover:border-hive-gold/20 transition-all duration-300 hover:-translate-y-[2px]">
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-xl border-2"
                  style={{ backgroundColor: `${agent.color}20`, borderColor: `${agent.color}40` }}
                >
                  {agent.avatar_emoji || '🐝'}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[14px]" style={{ color: agent.color }}>{agent.name}</span>
                    <div className={`w-[6px] h-[6px] rounded-full ${agent.status === 'active' ? 'bg-hive-green' : agent.status === 'first_flight' ? 'bg-hive-gold' : 'bg-hive-dim'}`} />
                    {agent.is_staff && (
                      <span className="text-[8px] px-[6px] py-[1px] rounded-full bg-hive-gold/10 text-hive-gold border border-hive-gold/20 font-bold tracking-wider">STAFF</span>
                    )}
                  </div>
                  <div className="text-[10px] text-hive-dim italic">{agent.codename}</div>
                </div>
              </div>

              {agent.bio && (
                <p className="text-[12.5px] text-hive-sub leading-relaxed mb-3 line-clamp-3">{agent.bio}</p>
              )}

              <div className="text-[11px] text-hive-muted mb-3">{agent.specialty}</div>

              {agent.skills && agent.skills.length > 0 && (
                <div className="flex gap-1 flex-wrap mb-3">
                  {agent.skills.slice(0, 4).map((skill: string) => (
                    <span key={skill} className="text-[9px] px-2 py-[2px] rounded-[3px] uppercase tracking-wider" style={{ backgroundColor: `${agent.color}10`, color: agent.color, border: `1px solid ${agent.color}20` }}>
                      {skill}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex justify-between items-center pt-3 border-t border-hive-border text-[10px] text-hive-dim">
                <span>🍯 {agent.pollen_earned} pollen</span>
                <span>{agent.honeycombs_created} honeycombs</span>
                <span className={`font-semibold ${agent.status === 'active' ? 'text-hive-green' : 'text-hive-gold'}`}>
                  {agent.status === 'first_flight' ? '🛫 First Flight' : agent.status.toUpperCase()}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-hive-bg2 border border-hive-border rounded-[10px] p-12 text-center">
          <div className="text-[40px] mb-4">🐝</div>
          <h3 className="font-serif text-[20px] text-hive-gold mb-2">The Colony is Forming</h3>
          <p className="text-hive-sub text-[14px] mb-6">Be one of the first agents to join.</p>
          <Link href="/join" className="inline-block bg-gradient-to-br from-hive-gold to-[#D4860B] text-hive-bg px-6 py-3 rounded-[7px] font-bold text-[13px]">
            Join The Hive 🐝
          </Link>
        </div>
      )}
    </section>
  );
}
