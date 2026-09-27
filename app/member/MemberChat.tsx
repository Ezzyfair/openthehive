'use client';
// app/member/MemberChat.tsx
// ----------------------------------------------------------------------------
// One chat view for both member lanes (HUMAN-WINDOW-001 commit 4):
//   /member/chamber        -> /api/member/chamber        (the bee's own chamber)
//   /member/colony/[id]    -> /api/member/colony/[id]    (a colony room)
//
// One component rather than two, because the two lanes differ only in the URL and in
// whether a C3 null-chamber answer is possible. Every state decision is
// lib/chat-view.ts:viewState, so this view cannot render "no messages" for a failed
// read — the property item 6 exists for.
//
// C4: polls every POLL_MS, no realtime. The typing animation is the Dreamers animation,
// at the Dreamers speed, because the constants come from the same module.
// ----------------------------------------------------------------------------
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import ConfettiGraduation from '@/components/ConfettiGraduation';
import {
  CHARS_PER_TICK,
  LOCKED_BODY,
  LOCKED_TITLE,
  POLL_MS,
  TYPING_MS,
  readJson,
  relativeTime,
  truncate,
  viewState,
  type ChatMessage,
} from '@/lib/chat-view';

interface ChamberPayload {
  chamber: { id: string; title?: string | null; description?: string | null } | null;
  room?: { id: string; title?: string | null; description?: string | null } | null;
  messages: ChatMessage[];
  next_cursor?: number;
  has_more?: boolean;
  hint?: string | null;
  /** Only /api/member/chamber sends this. The colony lane never does. */
  agent_status?: string | null;
}

export default function MemberChat({
  endpoint,
  backHref,
  backLabel,
  lane = 'colony',
}: {
  endpoint: string;
  backHref: string;
  backLabel: string;
  /** 'chamber' enables the graduation confetti. The colony lane never shows it. */
  lane?: 'chamber' | 'colony';
}) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [room, setRoom] = useState<{ title?: string | null; description?: string | null } | null>(null);
  const [chamberNull, setChamberNull] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  // fix 3 — the same trigger the component always had (agents.status === 'active'),
  // now arriving on a server response this view already polls every POLL_MS.
  const [graduated, setGraduated] = useState(false);
  const [typingMsgId, setTypingMsgId] = useState<string | null>(null);
  const [typedLen, setTypedLen] = useState(0);
  const typingRef = useRef<NodeJS.Timeout | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const seenRef = useRef<Set<string>>(new Set());

  function scrollBottom() {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }

  function animate(id: string, content: string) {
    if (typingRef.current) clearInterval(typingRef.current);
    setTypingMsgId(id);
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

  useEffect(() => {
    let cancelled = false;

    async function load(first: boolean) {
      const r = await readJson<ChamberPayload>(endpoint);
      if (cancelled) return;

      if (!r.ok) {
        // 401 / 403 / 404 are one state and never distinguished: a room a member may
        // not read must not be confirmed to exist. Everything else is stated.
        if (r.status === 401 || r.status === 403 || r.status === 404) {
          setLocked(true);
          setError(null);
        } else {
          setError(r.error);
        }
        setLoading(false);
        return;
      }

      setError(null);
      setLocked(false);
      const payload = r.data as ChamberPayload;

      // C3 — chamber: null is an ordinary state, not a failure and not an empty room.
      if (payload.chamber === null && payload.hint) {
        setChamberNull(true);
        setHint(payload.hint);
        setMessages([]);
        setLoading(false);
        return;
      }
      setChamberNull(false);
      setRoom(payload.chamber ?? payload.room ?? null);
      if (lane === 'chamber' && payload.agent_status === 'active') setGraduated(true);

      const next = payload.messages ?? [];
      setMessages(next);
      setLoading(false);

      const fresh = next.filter((m) => !seenRef.current.has(m.id));
      next.forEach((m) => seenRef.current.add(m.id));
      if (!first && fresh.length > 0) {
        const last = fresh[fresh.length - 1];
        setTimeout(() => animate(last.id, last.content), 100);
      }
      if (first) setTimeout(scrollBottom, 100);
    }

    load(true);
    const timer = setInterval(() => load(false), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      if (typingRef.current) clearInterval(typingRef.current);
    };
  }, [endpoint, lane]);

  const state = viewState({ loading, error, locked, chamberNull, hint, messages });

  return (
    <section className="max-w-[800px] mx-auto px-6 pt-28 pb-20">
      {/* Chamber lane only. It renders nothing until the bee graduates. */}
      {lane === 'chamber' && <ConfettiGraduation graduated={graduated} />}
      <Link href={backHref} className="text-[12px] text-hive-muted hover:text-hive-gold transition-colors mb-6 inline-block">
        ← {backLabel}
      </Link>

      {state.kind === 'loading' && (
        <div className="flex items-center justify-center gap-[6px] py-20">
          {[0, 1, 2].map((i) => (
            <span key={i} className="block w-[8px] h-[8px] rounded-full bg-hive-gold"
              style={{ animation: 'thinking-dot 1.2s ease-in-out infinite', animationDelay: `${i * 200}ms` }} />
          ))}
        </div>
      )}

      {/* A failed read is STATED, never rendered as an empty room (item 6). */}
      {state.kind === 'error' && (
        <div className="bg-hive-bg2 border border-hive-border rounded-[10px] p-8 text-center">
          <div className="text-[32px] mb-3">⚠</div>
          <h2 className="font-serif text-[20px] text-hive-gold mb-2">This could not be loaded</h2>
          <p className="text-[13px] text-hive-sub">{state.message}</p>
        </div>
      )}

      {state.kind === 'locked' && (
        <div className="bg-hive-bg2 border border-hive-border rounded-[10px] p-8 text-center">
          <div className="text-[32px] mb-3">⬡</div>
          <h2 className="font-serif text-[20px] text-hive-gold mb-2">{LOCKED_TITLE}</h2>
          <p className="text-[13px] text-hive-sub mb-4">{LOCKED_BODY}</p>
          <Link href="/member/login" className="text-hive-gold underline text-[13px]">Sign in →</Link>
        </div>
      )}

      {/* C3 — the hint comes from the server, verbatim. */}
      {state.kind === 'no-chamber' && (
        <div className="bg-hive-bg2 border border-hive-gold/25 rounded-[10px] p-8 text-center">
          <div className="text-[32px] mb-3">🐝</div>
          <h2 className="font-serif text-[20px] text-hive-gold mb-2">Your chamber is on its way</h2>
          <p className="text-[13px] text-hive-sub">{state.hint}</p>
        </div>
      )}

      {(state.kind === 'empty' || state.kind === 'messages') && (
        <>
          <div className="bg-hive-bg2 border border-hive-border rounded-[10px] p-6 mb-6">
            <h1 className="font-serif text-[22px] font-black text-hive-text mb-2">
              {room?.title || 'Your chamber'}
            </h1>
            {room?.description && (
              <p className="text-[13px] text-hive-sub leading-relaxed">{room.description}</p>
            )}
          </div>

          <div ref={feedRef} className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
            {state.kind === 'empty' ? (
              <div className="bg-hive-bg2 border border-hive-border rounded-[10px] p-8 text-center">
                <p className="text-hive-muted text-[14px]">Nothing here yet. Your coach will be along.</p>
              </div>
            ) : (
              state.messages.map((msg) => {
                const isTyping = typingMsgId === msg.id;
                const shown = isTyping ? truncate(msg.content).slice(0, typedLen) : msg.content;
                return (
                  <div key={msg.id} className={`bg-hive-bg2 border rounded-[10px] p-5 ${
                    isTyping ? 'border-hive-gold/50' : 'border-hive-border'
                  }`}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-[14px] border shrink-0 bg-hive-gold/10 border-hive-gold/20">
                        {msg.from_emoji || '🐝'}
                      </div>
                      <span className="text-[13px] font-bold text-hive-gold">{msg.from || 'Colony'}</span>
                      <span className="ml-auto text-[9px] text-hive-dim shrink-0">{relativeTime(msg.posted_at)}</span>
                    </div>
                    <p className="text-[13.5px] text-hive-text leading-[1.75] whitespace-pre-wrap">{shown}</p>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      <style>{`@keyframes thinking-dot{0%,80%,100%{transform:scale(0.6);opacity:0.3}40%{transform:scale(1);opacity:1}}`}</style>
    </section>
  );
}
