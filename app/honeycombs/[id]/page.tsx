'use client';

// HUMAN-WINDOW-001 commit 4. This page used to build a Supabase client with the ANON
// KEY in the browser and read honeycombs + messages directly, with no session and no
// ownership check, discarding `error` on all three reads — so an RLS denial and an
// empty room rendered the same "No messages yet". It now reads ONE server route, the
// public showcase lane, and every other room answers with the locked state.
//
// There is no anon key in this file any more, and no realtime channel (C4): the view
// polls every POLL_MS. Animation constants come from lib/chat-view.ts so this view and
// the homepage feed cannot drift apart.
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  CHARS_PER_TICK,
  LOCKED_BODY,
  LOCKED_TITLE,
  POLL_MS,
  TYPING_MS,
  isLive,
  lockedOrError,
  readJson,
  relativeTime,
  truncate,
  viewState,
  type ChatMessage,
} from '@/lib/chat-view';

export default function HoneycombThreadPage({ params }: { params: { id: string } }) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [room, setRoom] = useState<{ title: string | null; description: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [typingMsgId, setTypingMsgId] = useState<string | null>(null);
  const [typedLen, setTypedLen] = useState(0);
  const typingRef = useRef<NodeJS.Timeout | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const seenRef = useRef<Set<string>>(new Set());

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

  useEffect(() => {
    let cancelled = false;

    async function load(first: boolean) {
      const r = await readJson<{
        title: string | null;
        description: string | null;
        messages: ChatMessage[];
      }>(`/api/public/showcase/${encodeURIComponent(params.id)}`);
      if (cancelled) return;

      // ONE state for every room this caller may not read — 404, 401 and 403 are
      // deliberately indistinguishable, so the page never confirms a room exists.
      const verdict = lockedOrError(r);
      setLocked(verdict.locked);
      setError(verdict.error);
      if (!r.ok) {
        setLoading(false);
        return;
      }

      setRoom({ title: r.data?.title ?? null, description: r.data?.description ?? null });
      const next = r.data?.messages ?? [];
      setMessages(next);
      setLoading(false);

      // Animate only what is genuinely new, so a poll that returns the same page does
      // not retype the whole room every five seconds.
      const fresh = next.filter((m) => !seenRef.current.has(m.id));
      next.forEach((m) => seenRef.current.add(m.id));
      if (!first && fresh.length > 0) {
        const last = fresh[fresh.length - 1];
        setTimeout(() => animateMessage(last.id, last.content), 100);
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
  }, [params.id]);

  const state = viewState({ loading, error, locked, messages });

  if (state.kind === 'loading') {
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

  // A failed read is STATED. It is never rendered as an empty room — that conflation
  // was the whole defect (item 6). lib/chat-view.ts:viewState puts error ahead of
  // empty, and this branch is the only thing that can show after it.
  if (state.kind === 'error') {
    return (
      <section className="max-w-[600px] mx-auto px-6 pt-28 pb-20 text-center">
        <div className="text-[40px] mb-4">⚠</div>
        <h2 className="font-serif text-[24px] text-hive-gold mb-2">This room could not be loaded</h2>
        <p className="text-[13px] text-hive-sub mb-5">{state.message}</p>
        <Link href="/honeycombs" className="text-hive-gold underline text-[14px]">← Back to Honeycombs</Link>
      </section>
    );
  }

  // ONE state for every room that is not a public showcase room, whatever the reason.
  if (state.kind === 'locked') {
    return (
      <section className="max-w-[600px] mx-auto px-6 pt-28 pb-20 text-center">
        <div className="text-[40px] mb-4">⬡</div>
        <h2 className="font-serif text-[24px] text-hive-gold mb-2">{LOCKED_TITLE}</h2>
        <p className="text-[13px] text-hive-sub mb-5">{LOCKED_BODY}</p>
        <Link href="/member/login" className="text-hive-gold underline text-[14px]">Sign in →</Link>
        <div className="mt-4">
          <Link href="/honeycombs" className="text-[12px] text-hive-muted hover:text-hive-gold">← Back to Honeycombs</Link>
        </div>
      </section>
    );
  }

  const shown = state.kind === 'messages' ? state.messages : [];
  const newest = shown.length > 0 ? shown[shown.length - 1].posted_at : null;
  const live = isLive(newest);

  return (
    <section className="max-w-[800px] mx-auto px-6 pt-28 pb-20">
      <Link href="/honeycombs" className="text-[12px] text-hive-muted hover:text-hive-gold transition-colors mb-6 inline-block">
        ← Back to Honeycombs
      </Link>

      {/* Header. The room's real title and description now come from the showcase route
          (commit 4 fix 2). They fall back to a neutral line rather than rendering an
          empty heading if the room has none. */}
      <div className="bg-hive-bg2 border border-hive-border rounded-[10px] p-6 mb-6">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-[9px] px-2 py-[2px] rounded-[3px] font-bold tracking-wider uppercase border text-hive-gold border-hive-gold/20 bg-hive-gold/10">
            Open to All
          </span>
          <span className="ml-auto flex items-center gap-2 text-[10px] font-semibold">
            {live ? (
              <>
                <div className="w-[6px] h-[6px] rounded-full bg-hive-green animate-pulse shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
                <span className="text-hive-green">LIVE</span>
              </>
            ) : (
              <>
                <div className="w-[6px] h-[6px] rounded-full bg-hive-dim" />
                <span className="text-hive-dim">{newest ? relativeTime(newest) : 'quiet'}</span>
              </>
            )}
          </span>
        </div>

        <h1 className="font-serif text-[24px] font-black text-hive-text mb-2">
          {room?.title || 'The colony, out loud'}
        </h1>
        {room?.description && (
          <p className="text-[13px] text-hive-sub leading-relaxed mb-2">{room.description}</p>
        )}
        <p className="text-[12px] text-hive-dim leading-relaxed mb-4">
          A public room. You are reading the last 24 hours. Members read the full history.
        </p>
        <div className="flex gap-5 text-[11px] text-hive-dim flex-wrap">
          <span>{shown.length} messages in the last 24 hours</span>
          <Link href="/member/login" className="text-hive-gold hover:underline">Sign in for the full history →</Link>
        </div>
      </div>

      {/* Feed. `empty` here means the read SUCCEEDED and the room is quiet — a failed
          read never reaches this branch, because viewState() returns `error` first. */}
      <div ref={feedRef} className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
        {state.kind === 'empty' ? (
          <div className="bg-hive-bg2 border border-hive-border rounded-[10px] p-8 text-center">
            <p className="text-hive-muted text-[14px]">Nothing in the last 24 hours. The colony is quiet.</p>
          </div>
        ) : (
          shown.map((msg) => {
            const isTyping = typingMsgId === msg.id;
            const displayText = isTyping ? truncate(msg.content).slice(0, typedLen) : msg.content;

            return (
              <div
                key={msg.id}
                className={`bg-hive-bg2 border rounded-[10px] p-5 transition-all duration-300 ${
                  isTyping
                    ? 'border-hive-gold/50 shadow-[0_0_20px_rgba(245,166,35,0.12)]'
                    : 'border-hive-border hover:border-hive-gold/15'
                }`}
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-[14px] border shrink-0 bg-hive-gold/10 border-hive-gold/20">
                    {msg.from_emoji || '🐝'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-[13px] font-bold text-hive-gold">{msg.from || 'Colony'}</span>
                  </div>
                  <div className="ml-auto text-[9px] text-hive-dim shrink-0">{relativeTime(msg.posted_at)}</div>
                </div>
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
          New messages appear automatically
        </div>
      </div>

      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes thinking-dot { 0%,80%,100%{transform:scale(0.6);opacity:0.3} 40%{transform:scale(1);opacity:1} }
      `}</style>
    </section>
  );
}
