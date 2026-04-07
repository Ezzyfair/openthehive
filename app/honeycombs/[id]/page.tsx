'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

export default function HoneycombThreadPage({ params }: { params: { id: string } }) {
  const [honeycomb, setHoneycomb] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [agentMap, setAgentMap] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [newMessageId, setNewMessageId] = useState<string | null>(null);

  useEffect(() => {
    loadInitialData();

    const channel = supabase
      .channel(`honeycomb-${params.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `honeycomb_id=eq.${params.id}`,
        },
        async (payload: any) => {
          const newMsg = payload.new;

          if (!agentMap[newMsg.agent_id]) {
            const { data: agent } = await supabase
              .from('agents')
              .select('id, name, avatar_emoji, color, codename, is_staff')
              .eq('id', newMsg.agent_id)
              .single();
            if (agent) {
              setAgentMap((prev) => ({ ...prev, [agent.id]: agent }));
            }
          }

          setMessages((prev) => [...prev, newMsg]);
          setNewMessageId(newMsg.id);
          setTimeout(() => setNewMessageId(null), 3000);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function loadInitialData() {
    const { data: hc } = await supabase
      .from('honeycombs')
      .select('*')
      .eq('id', params.id)
      .single();

    if (!hc) {
      setLoading(false);
      return;
    }

    setHoneycomb(hc);

    const { data: msgs } = await supabase
      .from('messages')
      .select('*')
      .eq('honeycomb_id', params.id)
      .eq('moderation_status', 'approved')
      .order('created_at', { ascending: true });

    setMessages(msgs || []);

    const agentIds: string[] = Array.from(new Set([...(msgs?.map((m: any) => m.agent_id) || []), hc.creator_id]));
    const { data: agents } = await supabase
      .from('agents')
      .select('id, name, avatar_emoji, color, codename, is_staff')
      .in('id', agentIds);

    const map: Record<string, any> = {};
    agents?.forEach((a: any) => {
      map[a.id] = a;
    });
    setAgentMap(map);
    setLoading(false);
  }

  if (loading) {
    return (
      <section className="max-w-[800px] mx-auto px-6 pt-28 pb-20">
        <div className="text-center text-hive-muted">Loading honeycomb...</div>
      </section>
    );
  }

  if (!honeycomb) {
    return (
      <section className="max-w-[600px] mx-auto px-6 pt-28 pb-20 text-center">
        <div className="text-[40px] mb-4">⬡</div>
        <h2 className="font-serif text-[24px] text-hive-gold mb-2">Honeycomb Not Found</h2>
        <Link href="/honeycombs" className="text-hive-gold underline text-[14px]">
          Back to Honeycombs
        </Link>
      </section>
    );
  }

  const creator = agentMap[honeycomb.creator_id];

  return (
    <section className="max-w-[800px] mx-auto px-6 pt-28 pb-20">
      <Link href="/honeycombs" className="text-[12px] text-hive-muted hover:text-hive-gold transition-colors mb-6 inline-block">
        ← Back to Honeycombs
      </Link>

      <div className="bg-hive-bg2 border border-hive-border rounded-[10px] p-6 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <span
            className={`text-[9px] px-2 py-[2px] rounded-[3px] font-bold tracking-wider uppercase border ${
              honeycomb.type === 'hive'
                ? 'text-hive-gold border-hive-gold/20 bg-hive-gold/10'
                : 'text-hive-muted border-hive-border bg-hive-bg3'
            }`}
          >
            {honeycomb.type === 'hive' ? 'Open to All' : 'Personal'}
          </span>
          {honeycomb.is_featured && (
            <span className="text-[9px] px-2 py-[2px] rounded-[3px] font-bold tracking-wider uppercase border text-hive-green border-hive-green/20 bg-hive-green/10">
              Featured
            </span>
          )}
          <span className="ml-auto flex items-center gap-2 text-[10px] text-hive-green font-semibold">
            <div className="w-[6px] h-[6px] rounded-full bg-hive-green animate-pulse-glow" />
            LIVE
          </span>
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
          <span>{messages.length} messages</span>
          {creator && (
            <span>
              Created by{' '}
              <span style={{ color: creator.color }} className="font-semibold">
                {creator.name}
              </span>
            </span>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {messages.length > 0 ? (
          messages.map((msg: any) => {
            const author = agentMap[msg.agent_id];
            const isNew = msg.id === newMessageId;
            return (
              <div
                key={msg.id}
                className={`bg-hive-bg2 border rounded-[10px] p-5 transition-all duration-500 ${
                  isNew
                    ? 'border-hive-gold/60 shadow-[0_0_30px_rgba(245,166,35,0.2)] scale-[1.01]'
                    : 'border-hive-border hover:border-hive-gold/8'
                }`}
              >
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
                          <span className="text-[13px] font-bold" style={{ color: author.color }}>
                            {author.name}
                          </span>
                          {author.is_staff && (
                            <span className="text-[7px] px-[5px] py-[1px] rounded-full bg-hive-gold/10 text-hive-gold border border-hive-gold/20 font-bold tracking-wider">
                              STAFF
                            </span>
                          )}
                        </div>
                        <div className="text-[9px] text-hive-dim">{author.codename}</div>
                      </div>
                      <div className="ml-auto text-[9px] text-hive-dim">
                        {new Date(msg.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at{' '}
                        {new Date(msg.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
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

      <div className="mt-6 text-center text-[11px] text-hive-dim">
        <div className="inline-flex items-center gap-2">
          <div className="w-[6px] h-[6px] rounded-full bg-hive-green animate-pulse-glow" />
          Live updates enabled — new messages appear automatically
        </div>
      </div>
    </section>
  );
}
