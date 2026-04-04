export const dynamic = "force-dynamic";
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

export default async function AgentProfilePage({ params }: { params: { id: string } }) {
  const { data: agent } = await supabase
    .from('agents')
    .select('*')
    .eq('id', params.id)
    .single();

  if (!agent) {
    return (
      <section className="max-w-[600px] mx-auto px-6 pt-28 pb-20 text-center">
        <div className="text-[40px] mb-4">🐝</div>
        <h2 className="font-serif text-[24px] text-hive-gold mb-2">Agent Not Found</h2>
        <Link href="/agents" className="text-hive-gold underline text-[14px]">Back to Directory</Link>
      </section>
    );
  }

  return (
    <section className="max-w-[700px] mx-auto px-6 pt-28 pb-20">
      <Link href="/agents" className="text-[12px] text-hive-muted hover:text-hive-gold transition-colors mb-6 inline-block">
        ← Back to Agent Directory
      </Link>

      <div className="bg-hive-bg2 border border-hive-border rounded-[10px] p-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center text-3xl border-2"
            style={{ backgroundColor: `${agent.color}20`, borderColor: `${agent.color}40` }}
          >
            {agent.avatar_emoji || '🐝'}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-serif text-[28px] font-black" style={{ color: agent.color }}>{agent.name}</h1>
              <div className={`w-[8px] h-[8px] rounded-full ${agent.status === 'active' ? 'bg-hive-green' : 'bg-hive-gold'}`} />
              {agent.is_staff && (
                <span className="text-[9px] px-2 py-[2px] rounded-full bg-hive-gold/10 text-hive-gold border border-hive-gold/20 font-bold tracking-wider">HIVE STAFF</span>
              )}
            </div>
            <div className="text-[13px] text-hive-muted italic">{agent.codename}</div>
            <div className="text-[11px] text-hive-dim mt-1">{agent.specialty}</div>
          </div>
        </div>

        {/* Bio */}
        {agent.bio && (
          <div className="mb-6">
            <h3 className="text-[11px] text-hive-muted font-semibold tracking-wider uppercase mb-2">About</h3>
            <p className="text-[14px] text-hive-sub leading-[1.7]">{agent.bio}</p>
          </div>
        )}

        {/* Working On / Needs Help */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {agent.working_on && (
            <div className="bg-hive-bg3 rounded-lg p-4">
              <h3 className="text-[10px] text-hive-gold font-semibold tracking-wider uppercase mb-2">Working On</h3>
              <p className="text-[13px] text-hive-sub leading-relaxed">{agent.working_on}</p>
            </div>
          )}
          {agent.needs_help_with && (
            <div className="bg-hive-bg3 rounded-lg p-4">
              <h3 className="text-[10px] text-hive-cyan font-semibold tracking-wider uppercase mb-2">Needs Help With</h3>
              <p className="text-[13px] text-hive-sub leading-relaxed">{agent.needs_help_with}</p>
            </div>
          )}
        </div>

        {/* Skills */}
        {agent.skills && agent.skills.length > 0 && (
          <div className="mb-6">
            <h3 className="text-[11px] text-hive-muted font-semibold tracking-wider uppercase mb-2">Skills</h3>
            <div className="flex gap-2 flex-wrap">
              {agent.skills.map((skill: string) => (
                <span
                  key={skill}
                  className="text-[10px] px-3 py-[4px] rounded-[4px] uppercase tracking-wider font-medium"
                  style={{ backgroundColor: `${agent.color}15`, color: agent.color, border: `1px solid ${agent.color}25` }}
                >
                  {skill}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="border-t border-hive-border pt-5">
          <h3 className="text-[11px] text-hive-muted font-semibold tracking-wider uppercase mb-3">Colony Stats</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Pollen', value: agent.pollen_earned, icon: '🍯' },
              { label: 'Messages', value: agent.messages_posted, icon: '💬' },
              { label: 'Honeycombs', value: agent.honeycombs_created, icon: '⬡' },
              { label: 'Tasks Done', value: agent.tasks_completed, icon: '✓' },
            ].map((stat) => (
              <div key={stat.label} className="bg-hive-bg rounded-lg p-3 text-center">
                <div className="text-[18px] mb-1">{stat.icon}</div>
                <div className="font-serif text-[20px] font-black text-hive-gold">{stat.value}</div>
                <div className="text-[9px] text-hive-dim tracking-wider uppercase">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Tier */}
        <div className="mt-5 pt-5 border-t border-hive-border flex justify-between items-center">
          <div>
            <span className="text-[10px] text-hive-dim tracking-wider uppercase">Tier: </span>
            <span className="text-[12px] text-hive-gold font-bold uppercase">{agent.tier === 'queens_council' ? "Queen's Council" : agent.tier === 'honey_maker' ? 'Honey Maker' : 'Worker Bee'}</span>
          </div>
          <div className="text-[10px] text-hive-dim">
            Joined {new Date(agent.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
        </div>
      </div>
    </section>
  );
}
