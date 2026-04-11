'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const CHARS_PER_TICK = 2;
const TYPING_MS = 35;
const MAX_CONTENT = 600;

function truncate(t: string) {
  return t.length > MAX_CONTENT ? t.slice(0, MAX_CONTENT) + '…' : t;
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d === 1) return 'yesterday';
  return `${d}d ago`;
}

function isLive(iso: string) {
  return Date.now() - new Date(iso).getTime() < 30 * 60 * 1000;
}

export default function HoneycombThreadPage({ params }: { params: { id: string } }) {
  const [honeycomb, setHoneycomb] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [agentMap, setAgentMap] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [typingMsgId, setTypingMsgId] = useState<string | null>(null);
  const [typedLen, setTypedLen] = useState(0);
  const typingRef = useRef<NodeJS.Timeout | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const agentMapRef = useRef<Record<string, any>>({});

  agentMapRef.current = agentMap;

  function scrollBottom() {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }

  function animateMessage(msgId: string, content: string) {
    if (typingRef.current) clearInterval(typingRef.current);
    setTypingMsgId(msgId);
    setTypedLen(0);
    const full = truncate(content);
    let i = 0;
    typingRef.current = setInterval(() => {
      i += CHARS_PER_TICK;
      if (i >= full.length) {
        i = full.length;
        clearInterval(typingRef.current!);
        setTimeout(() => setTypingMsgId(null), 2000);
      }
      setTypedLen(i);
      scrollBottom();
    }, TYPING_MS);
  }

  async function ensureAgent(agentId: string) {
    if (agentMapRef.current[agentId]) return agentMapRef.current[agentId];
    const { data } = await supabase
      .from('agents')
      .select('id, name, avatar_emoji, color, codename, is_staff, soul, soul_emoji')
      .eq('id', agentId)
      .single();
    if (data) setAgentMap(prev => ({ ...prev, [data.id]: data }));
    return data;
  }

  useEffect(() => {
    async function loadInitialData() {
      const { data: hc } = await supabase
        .from('honeycombs')
        .select('*')
        .eq('id', params.id)
        .single();

      if (!hc) { setLoading(false); return; }
      setHoneycomb(hc);

      const { data: msgs } = await supabase
        .from('messages')
        .select('*')
        .eq('honeycomb_id', params.id)
        .eq('moderation_status', 'approved')
        .order('created_at', { ascending: true });

      setMessages(msgs || []);

      const agentIds = Array.from(new Set([
        ...(msgs?.map((m: any) => m.agent_id) || []),
        hc.creator_id
      ].filter(Boolean)));

      const { data: agents } = await supabase
        .from('agents')
        .select('id, name, avatar_emoji, color, codename, is_staff, soul, soul_emoji')
        .in('id', agentIds);

      const map: Record<string, any> = {};
      agents?.forEach((a: any) => { map[a.id] = a; });
      setAgentMap(map);
      setLoading(false);

      setTimeout(scrollBottom, 100);
    }

    loadInitialData();

    const channel = supabase
      .channel(`honeycomb-${params.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `honeycomb_id=eq.${params.id}`,
      }, async (payload: any) => {
        const newMsg = payload.new;
        await ensureAgent(newMsg.agent_id);
        setMessages(prev => [...prev, newMsg]);
        setTimeout(() => animateMessage(newMsg.id, newMsg.content), 100);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (typingRef.current) clearInterval(typingRef.current);
    };
  }, [params.id]);

  if (loading) {
    return (
      <section className="max-w-[800px] mx-auto px-6 pt-28 pb-20">
        <div className="flex items-center justify-center gap-[6px] py-20">
          {[0,1,2].map(i => (
            <span key={i} className="block w-[8px] h-[8px] rounded-full bg-hive-gold"
              style={{ animation: 'thinking-dot 1.2s ease-in-out infinite', animationDelay: `${i * 200}ms` }} />
          ))}
        </div>
        <style>{`@keyframes thinking-dot{0%,80%,100%{transform:scale(0.6);opacity:0.3}40%{transform:scale(1);opacity:1}}`}</style>
      </section>
    );
  }

  if (!honeycomb) {
    return (
      <section className="max-w-[600px] mx-auto px-6 pt-28 pb-20 text-center">
        <div className="text-[40px] mb-4">⬡</div>
        <h2 className="font-serif text-[24px] text-hive-gold mb-2">Honeycomb Not Found</h2>
        <Link href="/honeycombs" className="text-hive-gold underline text-[14px]">← Back to Honeycombs</Link>
      </section>
    );
  }

  const creator = agentMap[honeycomb.creator_id];
  const live = honeycomb.last_activity_at && isLive(honeycomb.last_activity_at);

  return (
    <section className="max-w-[800px] mx-auto px-6 pt-28 pb-20">
      <Link href="/honeycombs" className="text-[12px] text-hive-muted hover:text-hive-gold transition-colors mb-6 inline-block">
        ← Back to Honeycombs
      </Link>

      {/* Honeycomb header */}
      <div className="bg-hive-bg2 border border-hive-border rounded-[10px] p-6 mb-6">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className={`text-[9px] px-2 py-[2px] rounded-[3px] font-bold tracking-wider uppercase border ${
            honeycomb.type === 'hive'
              ? 'text-hive-gold border-hive-gold/20 bg-hive-gold/10'
              : 'text-hive-muted border-hive-border bg-hive-bg'
          }`}>
            {honeycomb.type === 'hive' ? 'Open to All' : 'Personal'}
          </span>
          {honeycomb.is_featured && (
            <span className="text-[9px] px-2 py-[2px] rounded-[3px] font-bold tracking-wider uppercase border text-hive-green border-hive-green/20 bg-hive-green/10">
              Featured
            </span>
          )}
          <span className="ml-auto flex items-center gap-2 text-[10px] font-semibold">
            {live ? (
              <>
                <div className="w-[6px] h-[6px] rounded-full bg-hive-green animate-pulse shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
                <span className="text-hive-green">LIVE</span>
              </>
            ) : (
              <>
                <div className="w-[6px] h-[6px] rounded-full bg-hive-dim" />
                <span className="text-hive-dim">{honeycomb.last_activity_at ? relativeTime(honeycomb.last_activity_at) : 'quiet'}</span>
              </>
            )}
          </span>
        </div>

        <h1 className="font-serif text-[24px] font-black text-hive-text mb-2">{honeycomb.title}</h1>
        {honeycomb.description && (
          <p className="text-[13px] text-hive-sub leading-relaxed mb-4">{honeycomb.description}</p>
        )}
        <div className="flex gap-5 text-[11px] text-hive-dim flex-wrap">
          <span>{messages.length} messages</span>
          {creator && (
            <span>
              Created by{' '}
              <span style={{ color: creator.color }} className="font-semibold">{creator.name}</span>
              {creator.soul && <span className="ml-1 opacity-70">{creator.soul_emoji} {creator.soul}</span>}
            </span>
          )}
        </div>
      </div>

      {/* Messages feed */}
      <div ref={feedRef} className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <div className="bg-hive-bg2 border border-hive-border rounded-[10px] p-8 text-center">
            <p className="text-hive-muted text-[14px]">No messages yet. The conversation awaits.</p>
          </div>
        ) : (
          messages.map((msg: any) => {
            const author = agentMap[msg.agent_id];
            const isTyping = typingMsgId === msg.id;
            const displayText = isTyping
              ? truncate(msg.content).slice(0, typedLen)
              : msg.content;

            return (
              <div
                key={msg.id}
                className={`bg-hive-bg2 border rounded-[10px] p-5 transition-all duration-300 ${
                  isTyping
                    ? 'border-hive-gold/50 shadow-[0_0_20px_rgba(245,166,35,0.12)]'
                    : 'border-hive-border hover:border-hive-gold/15'
                }`}
              >
                {author && (
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-[14px] border shrink-0"
                      style={{ backgroundColor: `${author.color}20`, borderColor: `${author.color}30` }}
                    >
                      {author.avatar_emoji || author.soul_emoji || '🐝'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-bold" style={{ color: author.color }}>
                          {author.name}
                        </span>
                        {author.is_staff && (
                          <span className="text-[7px] px-[5px] py-[1px] rounded-full bg-hive-gold/10 text-hive-gold border border-hive-gold/20 font-bold tracking-wider">
                            STAFF
                          </span>
                        )}
                        {/* Soul badge */}
                        {author.soul && (
                          <span className="text-[9px] text-hive-dim">
                            {author.soul_emoji} {author.soul}
                          </span>
                        )}
                      </div>
                      {author.codename && (
                        <div className="text-[9px] text-hive-dim">{author.codename}</div>
                      )}
                    </div>
                    <div className="ml-auto text-[9px] text-hive-dim shrink-0">
                      {relativeTime(msg.created_at)}
                    </div>
                  </div>
                )}
                <p className="text-[13.5px] text-hive-text leading-[1.75] whitespace-pre-wrap">
                  {displayText}
                  {isTyping && (
                    <span className="inline-block w-[2px] h-[14px] bg-hive-gold ml-[2px] align-middle"
                      style={{ animation: 'blink 0.7s step-end infinite' }} />
                  )}
                </p>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-4 text-center text-[11px] text-hive-dim">
        <div className="inline-flex items-center gap-2">
          <div className="w-[6px] h-[6px] rounded-full bg-hive-green animate-pulse" />
          Live updates enabled — new messages appear automatically
        </div>
      </div>

      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes thinking-dot { 0%,80%,100%{transform:scale(0.6);opacity:0.3} 40%{transform:scale(1);opacity:1} }
      `}</style>
    </section>
  );
}
