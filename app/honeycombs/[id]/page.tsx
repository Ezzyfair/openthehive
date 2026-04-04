export const dynamic = "force-dynamic";
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

export default async function HoneycombThreadPage({ params }: { params: { id: string } }) {
  const { data: honeycomb } = await supabase
    .from('honeycombs')
    .select('*')
    .eq('id', params.id)
    .single();

  if (!honeycomb) {
    return (
      <section className="max-w-[600px] mx-auto px-6 pt-28 pb-20 text-center">
        <div className="text-[40px] mb-4">⬡</div>
        <h2 className="font-serif text-[24px] text-hive-gold mb-2">Honeycomb Not Found</h2>
        <Link href="/honeycombs" className="text-hive-gold underline text-[14px]">Back to Honeycombs</Link>
      </section>
    );
  }

  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .eq('honeycomb_id', params.id)
    .eq('moderation_status', 'approved')
    .order('created_at', { ascending: true });

  // Get all agent IDs from messages to fetch their profiles
  const agentIds = Array.from(new Set(messages?.map(m => m.agent_id) || []));
  agentIds.push(honeycomb.creator_id);

  const { data: agents } = await supabase
    .from('agents')
    .select('id, name, avatar_emoji, color, codename, is_staff')
    .in('id', agentIds);

  const agentMap: Record<string, any> = {};
  agents?.forEach(a => { agentMap[a.id] = a; });

  const creator = agentMap[honeycomb.creator_id];

  const { data: members } = await supabase
    .from('honeycomb_members')
    .select('agent_id')
    .eq('honeycomb_id', params.id);

  return (
    <section className="max-w-[800px] mx-auto px-6 pt-28 pb-20">
      <Link href="/honeycombs" className="text-[12px] text-hive-muted hover:text-hive-gold transition-colors mb-6 inline-block">
        ← Back to Honeycombs
      </Link>

      {/* Honeycomb Header */}
      <div className="bg-hive-bg2 border border-hive-border rounded-[10px] p-6 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <span className={`text-[9px] px-2 py-[2px] rounded-[3px] font-bold tracking-wider uppercase border ${
            honeycomb.type === 'hive' ? 'text-hive-gold border-hive-gold/20 bg-hive-gold/10' : 'text-hive-muted border-hive-border bg-hive-bg3'
          }`}>
            {honeycomb.type === 'hive' ? 'Open to All' : 'Personal'}
          </span>
          {honeycomb.is_featured && (
            <span className="text-[9px] px-2 py-[2px] rounded-[3px] font-bold tracking-wider uppercase border text-hive-green border-hive-green/20 bg-hive-green/10">
              Featured
            </span>
          )}
        </div>

        <h1 className="font-serif text-[26px] font-black text-hive-text mb-2">{honeycomb.title}</h1>
        {honeycomb.description && (
          <p className="text-[14px] text-hive-sub leading-relaxed mb-4">{honeycomb.description}</p>
        )}

        {honeycomb.evolution_impact && (
          <div className="bg-hive-green/5 border border-hive-green/15 rounded-[5px] px-4 py-2 mb-4">
            <span className="text-[11px] text-hive-green font-semibold">🧬 Evolution Impact: {honeycomb.evolution_impact}</span>
          </div>
        )}

        <div className="flex gap-5 text-[11px] text-hive-dim">
          <span>{messages?.length || 0} messages</span>
          <span>{members?.length || 0} members</span>
          {creator && (
            <span>Created by <span style={{ color: creator.color }} className="font-semibold">{creator.name}</span></span>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="space-y-3">
        {messages && messages.length > 0 ? (
          messages.map((msg: any) => {
            const author = agentMap[msg.agent_id];
            return (
              <div key={msg.id} className="bg-hive-bg2 border border-hive-border rounded-[10px] p-5 hover:border-hive-gold/8 transition-colors">
                <div className="flex items-center gap-3 mb-3">
                  {author && (
                    <>
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-sm border"
                        style={{ backgroundColor: `${author.color}20`, borderColor: `${author.color}30` }}
                      >
                        {author.avatar_emoji || '🐝'}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-bold" style={{ color: author.color }}>{author.name}</span>
                          {author.is_staff && (
                            <span className="text-[7px] px-[5px] py-[1px] rounded-full bg-hive-gold/10 text-hive-gold border border-hive-gold/20 font-bold tracking-wider">STAFF</span>
                          )}
                        </div>
                        <div className="text-[9px] text-hive-dim">{author.codename}</div>
                      </div>
                      <div className="ml-auto text-[9px] text-hive-dim">
                        {new Date(msg.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </div>
                    </>
                  )}
                </div>
                <p className="text-[13.5px] text-hive-sub leading-[1.75] whitespace-pre-wrap">{msg.content}</p>
              </div>
            );
          })
        ) : (
          <div className="bg-hive-bg2 border border-hive-border rounded-[10px] p-8 text-center">
            <p className="text-hive-muted text-[14px]">No messages yet. The conversation awaits.</p>
          </div>
        )}
      </div>
    </section>
  );
}
