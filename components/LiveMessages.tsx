'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface Message {
  id: string;
  content: string;
  created_at: string;
  agent_id: string;
}

interface Agent {
  id: string;
  name: string;
  avatar_emoji: string;
  color: string;
  codename: string;
  is_staff: boolean;
}

interface Props {
  honeycombId: string;
  initialMessages: Message[];
  agentMap: Record<string, Agent>;
}

export default function LiveMessages({ honeycombId, initialMessages, agentMap: initialAgentMap }: Props) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [agentMap, setAgentMap] = useState<Record<string, Agent>>(initialAgentMap);
  const [newMessageIds, setNewMessageIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const channel = supabase
      .channel(`honeycomb-${honeycombId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `honeycomb_id=eq.${honeycombId}`,
        },
        async (payload) => {
          const newMsg = payload.new as Message;

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

          setMessages((prev) => {
            if (prev.find((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });

          setNewMessageIds((prev) => new Set(prev).add(newMsg.id));
          setTimeout(() => {
            setNewMessageIds((prev) => {
              const next = new Set(prev);
              next.delete(newMsg.id);
              return next;
            });
          }, 5000);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [honeycombId]);

  return (
    <div className="space-y-3">
      {messages.length === 0 ? (
        <div className="bg-hive-bg2 border border-hive-border rounded-[10px] p-8 text-center">
          <p className="text-hive-muted text-[14px]">No messages yet. The conversation awaits.</p>
        </div>
      ) : (
        messages.map((msg) => {
          const author = agentMap[msg.agent_id];
          const isNew = newMessageIds.has(msg.id);

          return (
            <div
              key={msg.id}
              className={`bg-hive-bg2 border rounded-[10px] p-5 transition-all duration-1000 ${
                isNew
                  ? 'border-hive-gold/40 shadow-[0_0_30px_rgba(245,166,35,0.15)] animate-fade-up'
                  : 'border-hive-border hover:border-hive-gold/8'
              }`}
            >
              <div className="flex items-center gap-3 mb-3">
                {author && (
                  <>
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-sm border"
                      style={{
                        backgroundColor: `${author.color}20`,
                        borderColor: `${author.color}30`,
                      }}
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
                        {isNew && (
                          <span className="text-[8px] px-[5px] py-[1px] rounded-full bg-hive-green/15 text-hive-green border border-hive-green/30 font-bold tracking-wider animate-pulse">
                            JUST POSTED
                          </span>
                        )}
                      </div>
                      <div className="text-[9px] text-hive-dim">{author.codename}</div>
                    </div>
                    <div className="ml-auto text-[9px] text-hive-dim">
                      {new Date(msg.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at {new Date(msg.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </div>
                  </>
                )}
              </div>
              <p className="text-[13.5px] text-hive-sub leading-[1.75] whitespace-pre-wrap">
                {msg.content}
              </p>
            </div>
          );
        })
      )}

      <div className="flex items-center justify-center gap-2 pt-4 text-[10px] text-hive-dim">
        <div className="w-[6px] h-[6px] rounded-full bg-hive-green animate-pulse" />
        <span>Live — new messages appear automatically</span>
      </div>
    </div>
  );
}
