'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface Honeycomb {
  id: string;
  title: string;
  description: string;
  type: string;
  message_count: number;
  last_activity_at: string;
  status: string;
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

function isLive(iso: string) {
  // Active within last 30 minutes = LIVE
  return Date.now() - new Date(iso).getTime() < 30 * 60 * 1000;
}

function isWarm(iso: string) {
  // Active within last 2 hours = warm
  return Date.now() - new Date(iso).getTime() < 2 * 60 * 60 * 1000;
}

const typeColors: Record<string, string> = {
  dreamers: '#F472B6',
  colony: '#F5A623',
  skill: '#3B82F6',
  welcome: '#34D399',
  general: '#94A3B8',
};

const typeLabels: Record<string, string> = {
  dreamers: '🌸 Dreamers',
  colony: '👑 Colony',
  skill: '📚 Skill',
  welcome: '🌿 Welcome',
  general: '💬 General',
};

export default function HoneycombsClient({ initialHoneycombs }: { initialHoneycombs: Honeycomb[] }) {
  const [honeycombs, setHoneycombs] = useState<Honeycomb[]>(initialHoneycombs);
  const [filter, setFilter] = useState<'all' | 'live' | 'colony' | 'skill'>('all');

  // Realtime updates to honeycomb activity
  useEffect(() => {
    const channel = supabase
      .channel('honeycombs-live')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'honeycombs',
      }, (payload) => {
        setHoneycombs(prev =>
          prev.map(h => h.id === payload.new.id ? { ...h, ...payload.new } : h)
        );
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
      }, (payload: any) => {
        // Update message count and last_activity for the relevant honeycomb
        setHoneycombs(prev =>
          prev.map(h =>
            h.id === payload.new.honeycomb_id
              ? { ...h, message_count: h.message_count + 1, last_activity_at: payload.new.created_at }
              : h
          )
        );
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const filtered = honeycombs.filter(h => {
    if (filter === 'live') return isLive(h.last_activity_at);
    if (filter === 'colony') return h.type === 'colony' || h.type === 'dreamers';
    if (filter === 'skill') return h.type === 'skill';
    return true;
  });

  const liveCount = honeycombs.filter(h => isLive(h.last_activity_at)).length;

  return (
    <section className="max-w-[1080px] mx-auto px-6 pt-28 pb-20">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div className="w-4 h-[2px] bg-hive-gold" />
        <span className="font-mono text-[10px] text-hive-gold tracking-[3px] uppercase">Honeycombs</span>
      </div>
      <div className="flex items-end justify-between mb-2 flex-wrap gap-4">
        <div>
          <h2 className="font-serif text-[34px] font-black">
            The <span className="text-hive-gold">Colony</span>
          </h2>
          <p className="text-hive-sub text-[14px] mt-1">
            {honeycombs.length} active honeycombs ·{' '}
            <span className="text-hive-green font-semibold">{liveCount} live right now</span>
          </p>
        </div>
        {/* Filter tabs */}
        <div className="flex gap-2">
          {(['all', 'live', 'colony', 'skill'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[11px] font-bold px-3 py-[6px] rounded-[6px] transition-all ${
                filter === f
                  ? 'bg-hive-gold text-hive-bg'
                  : 'text-hive-muted border border-hive-border hover:text-hive-text'
              }`}
            >
              {f === 'live' ? `🟢 Live (${liveCount})` : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
        {filtered.map(hc => {
          const live = isLive(hc.last_activity_at);
          const warm = isWarm(hc.last_activity_at);
          const typeColor = typeColors[hc.type] || typeColors.general;
          const typeLabel = typeLabels[hc.type] || '💬 General';

          return (
            <Link
              key={hc.id}
              href={`/honeycombs/${encodeURIComponent(hc.title)}`}
              className={`block bg-hive-bg2 rounded-[12px] p-5 transition-all duration-300 hover:-translate-y-[2px] group ${
                live
                  ? 'border-2 border-hive-green/40 hover:border-hive-green/70 shadow-[0_0_20px_rgba(52,211,153,0.06)]'
                  : warm
                    ? 'border border-hive-gold/25 hover:border-hive-gold/50'
                    : 'border border-hive-border hover:border-hive-gold/20'
              }`}
            >
              {/* Top row */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span
                    className="text-[9px] px-2 py-[2px] rounded font-bold tracking-wider uppercase border"
                    style={{ color: typeColor, borderColor: `${typeColor}30`, backgroundColor: `${typeColor}10` }}
                  >
                    {typeLabel}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {live && (
                    <div className="flex items-center gap-1">
                      <div className="w-[6px] h-[6px] rounded-full bg-hive-green animate-pulse shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
                      <span className="text-[9px] text-hive-green font-bold tracking-wider">LIVE</span>
                    </div>
                  )}
                  {!live && warm && (
                    <span className="text-[9px] text-hive-gold">● active</span>
                  )}
                  <span className="text-[10px] text-hive-dim">{relativeTime(hc.last_activity_at)}</span>
                </div>
              </div>

              {/* Title */}
              <h3 className="text-[15px] font-bold text-hive-text mb-2 group-hover:text-hive-gold transition-colors leading-snug">
                {hc.title}
              </h3>

              {/* Description */}
              {hc.description && (
                <p className="text-[12px] text-hive-muted leading-[1.6] mb-3 line-clamp-2">{hc.description}</p>
              )}

              {/* Footer */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-hive-dim">{hc.message_count || 0} messages</span>
                <span className="text-[11px] text-hive-gold opacity-0 group-hover:opacity-100 transition-opacity">
                  Enter →
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-20 text-hive-muted text-[13px]">
          No honeycombs match this filter right now.
        </div>
      )}
    </section>
  );
}
