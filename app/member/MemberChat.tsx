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
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

// useLayoutEffect warns during the server render of a client component.
const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const MAX_REPLY_CHARS = 2000;

/** Older pages kept by "Load earlier", then whatever the poll returned. One copy of each id. */
function joinPages(earlier: ChatMessage[], latest: ChatMessage[]): ChatMessage[] {
  const ids = new Set(latest.map((m) => m.id));
  return [...earlier.filter((m) => !ids.has(m.id)), ...latest];
}

interface ChamberPayload {
  chamber: { id: string; title?: string | null; description?: string | null } | null;
  room?: { id: string; title?: string | null; description?: string | null } | null;
  messages: ChatMessage[];
  next_cursor?: number;
  has_more?: boolean;
  hint?: string | null;
  /** Only /api/member/chamber sends this. The colony lane never does. */
  agent_status?: string | null;
  /** Only /api/member/chamber sends this. */
  bee_name?: string | null;
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
  // MEMBER-001 items 5, 6 — chamber lane only.
  const [beeName, setBeeName] = useState<string | null>(null);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const earlierRef = useRef<ChatMessage[]>([]);
  const latestRef = useRef<ChatMessage[]>([]);
  const openedRef = useRef(false);
  const heightBeforeRef = useRef<number | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);

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
      latestRef.current = next;
      if (lane === 'chamber') {
        setBeeName(payload.bee_name ?? null);
        if (first) setHasEarlier(payload.has_more === true);
      }
      setMessages(lane === 'chamber' ? joinPages(earlierRef.current, next) : next);
      setLoading(false);

      const fresh = next.filter((m) => !seenRef.current.has(m.id));
      next.forEach((m) => seenRef.current.add(m.id));
      if (!first && fresh.length > 0) {
        const last = fresh[fresh.length - 1];
        setTimeout(() => animate(last.id, last.content), 100);
      }
      if (first && lane !== 'chamber') setTimeout(scrollBottom, 100);
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

  // MEMBER-001 item 6 — before the first paint, so the chamber is never seen at the top
  // of its history. The page scrolls too: on a phone the feed and the reply box sit
  // below the header, and the newest message has to be on the screen, not just at the
  // end of the feed.
  useBeforePaint(() => {
    if (lane !== 'chamber' || openedRef.current) return;
    if (state.kind !== 'messages' && state.kind !== 'empty') return;
    openedRef.current = true;
    scrollBottom();
    composerRef.current?.scrollIntoView({ block: 'end' });
  });

  // "Load earlier" adds height above the reader. Hold their place.
  useBeforePaint(() => {
    if (heightBeforeRef.current === null || !feedRef.current) return;
    feedRef.current.scrollTop += feedRef.current.scrollHeight - heightBeforeRef.current;
    heightBeforeRef.current = null;
  });

  async function loadEarlier() {
    const oldest = (messages ?? [])[0];
    if (!oldest || loadingEarlier) return;
    setLoadingEarlier(true);
    // +1: posted_at is floored to the millisecond, so this re-reads the oldest row
    // rather than skipping a neighbour in the same millisecond. joinPages drops repeats.
    const r = await readJson<ChamberPayload>(`${endpoint}?before=${new Date(oldest.posted_at).getTime() + 1}`);
    setLoadingEarlier(false);
    if (!r.ok) {
      setSendError(r.error);
      return;
    }
    const page = (r.data as ChamberPayload).messages ?? [];
    page.forEach((m) => seenRef.current.add(m.id));
    earlierRef.current = joinPages(page, earlierRef.current);
    heightBeforeRef.current = feedRef.current?.scrollHeight ?? null;
    setHasEarlier((r.data as ChamberPayload).has_more === true);
    setMessages(joinPages(earlierRef.current, latestRef.current));
  }

  async function sendReply(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 401) {
        window.location.href = '/member/login';
        return;
      }
      if (!res.ok) throw new Error(json?.message || 'That did not send. Try again.');
      const sent = json.message as ChatMessage;
      seenRef.current.add(sent.id); // your own words do not type themselves out
      latestRef.current = [...latestRef.current, sent];
      setMessages(joinPages(earlierRef.current, latestRef.current));
      setDraft('');
      setTimeout(scrollBottom, 0);
    } catch (err: any) {
      setSendError(err?.message || 'That did not send. Try again.');
    }
    setSending(false);
  }

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
            {/* MEMBER-001 item 7 — its own band, in the flow. Nothing is painted over text. */}
            {lane === 'chamber' && graduated && (
              <div className="border-y border-hive-gold/30 py-2 my-3 text-center">
                <div className="text-[13px] font-bold tracking-[0.2em] text-hive-gold">🐝 GRADUATED 🐝</div>
                <div className="font-serif italic text-[13px] text-hive-sub mt-1">You are becoming an agent that builds.</div>
              </div>
            )}
            {/* Matt C15 (Oct 19) — the AI-persona disclosure, chamber lane only.
                MEMBER-001 item 7 — hive-sub on hive-bg2; hive-dim was 1.9:1. */}
            {lane === 'chamber' && (
              <p className="text-[12px] text-hive-sub mb-2">Coaches, Elders and the Oracle are AI personas operated by The Hive.</p>
            )}
            {room?.description && (
              <p className="text-[13px] text-hive-sub leading-relaxed">{room.description}</p>
            )}
          </div>

          <div ref={feedRef} className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
            {lane === 'chamber' && hasEarlier && (
              <button
                type="button"
                onClick={loadEarlier}
                disabled={loadingEarlier}
                className="block mx-auto text-[12px] text-hive-gold underline py-1"
              >
                {loadingEarlier ? 'Loading…' : 'Load earlier'}
              </button>
            )}
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
                        {msg.from_kind === 'human' ? '🧑' : msg.from_emoji || '🐝'}
                      </div>
                      <span className={`text-[13px] font-bold ${msg.from_kind === 'human' ? 'text-hive-cyan' : 'text-hive-gold'}`}>
                        {msg.from || 'Colony'}
                      </span>
                      <span className="ml-auto text-[9px] text-hive-dim shrink-0">{relativeTime(msg.posted_at)}</span>
                    </div>
                    <p className="text-[13.5px] text-hive-text leading-[1.75] whitespace-pre-wrap">{shown}</p>
                  </div>
                );
              })
            )}
          </div>

          {/* MEMBER-001 item 5 — the session is the credential. No key reaches this page. */}
          {lane === 'chamber' && (
            <form ref={composerRef} onSubmit={sendReply} className="mt-4">
              <textarea
                aria-label={`Write to ${beeName || 'your bee'}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={MAX_REPLY_CHARS}
                rows={3}
                className="w-full bg-hive-bg2 border border-hive-border rounded-[10px] p-3 text-[16px] text-hive-text leading-[1.5]"
              />
              {sendError && (
                <p role="alert" className="text-[13px] text-hive-red mt-2">
                  {sendError}
                </p>
              )}
              <button
                type="submit"
                disabled={sending || !draft.trim()}
                className="mt-2 w-full bg-hive-gold text-hive-bg font-bold text-[14px] rounded-[10px] py-3 disabled:opacity-50"
              >
                {sending ? 'Sending…' : `Send to ${beeName || 'your bee'}`}
              </button>
            </form>
          )}
        </>
      )}

      <style>{`@keyframes thinking-dot{0%,80%,100%{transform:scale(0.6);opacity:0.3}40%{transform:scale(1);opacity:1}}`}</style>
    </section>
  );
}
