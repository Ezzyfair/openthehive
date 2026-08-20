'use client';
import { useState } from 'react';

// ── TYPES ──────────────────────────────────────────────────────────────────
interface Stats {
  generatedAt: string;
  totalAgents: number; staffCount: number; beeCount: number;
  activeMemberCount: number; inFlightCount: number; skillCount: number;
  totalHoneycombs: number; totalMessages: number;
  actionItems: ActionItem[];
  flightBees: FlightBee[];
  activeMembers: Member[];
  pollenLeaders: any[];
  recentMasteries: any[];
  elderBreakdown: Record<string, { pass: number; not_yet: number; abandoned: number }>;
  totalMasteries: number;
  forgeSubmissions: any[];
  pendingForgeCount: number;
  topNuggets: Nugget[];
  pendingNuggets: Nugget[];
  approvedNuggets: Nugget[];
  dreamersMessages: any[];
  honeycombs: any[];
  mrr: number;
  totalCascadePaid: number;
  systemHealth: SystemHealth;
  recentMessages: any[];
}
interface ActionItem { severity: 'red' | 'amber' | 'green'; title: string; action: string; agent_id?: string; }
interface FlightBee { id: string; name: string; soul: string; soul_emoji: string; first_flight_hours: number; pollen_earned: number; created_at: string; completedSteps: number; totalSteps: number; steps: any[]; }
interface Member { id: string; name: string; soul: string; soul_emoji: string; pollen_earned: number; tier: string; first_flight_hours: number; subscription_started_at: string; }
interface Nugget { id: string; idea: string; reasoning: string; score: number; status: string; source_agent: string; esmeralda_plan: string; created_at: string; }
interface SystemHealth { beekeeperActive: boolean; watcherActive: boolean; dreamersActive: boolean; watcherLastActive: string | null; dreamersLastPost: string | null; beekeeperRecentPosts: number; }

// ── HELPERS ────────────────────────────────────────────────────────────────
const rel = (iso: string) => {
  if (!iso) return '—';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (d < 2) return 'just now';
  if (d < 60) return `${d}m ago`;
  if (d < 1440) return `${Math.floor(d / 60)}h ago`;
  return `${Math.floor(d / 1440)}d ago`;
};

const SeverityDot = ({ s }: { s: string }) => (
  <span className={`inline-block w-2 h-2 rounded-full mr-2 ${s === 'red' ? 'bg-red-500' : s === 'amber' ? 'bg-amber-400' : 'bg-emerald-400'}`} />
);

const Card = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div className={`bg-[#1a1208] border border-[rgba(201,168,76,0.2)] rounded-none p-5 ${className}`}>{children}</div>
);

const SectionTitle = ({ emoji, title, sub }: { emoji: string; title: string; sub?: string }) => (
  <div className="flex items-baseline gap-3 mb-4 border-b border-[rgba(201,168,76,0.15)] pb-3">
    <span className="text-xl">{emoji}</span>
    <span className="font-cinzel text-[var(--gold)] text-sm tracking-widest uppercase">{title}</span>
    {sub && <span className="text-xs text-[var(--muted)] ml-auto">{sub}</span>}
  </div>
);

const Badge = ({ label, color = 'gold' }: { label: string; color?: string }) => (
  <span className={`text-[9px] font-cinzel tracking-wider px-2 py-0.5 border ${
    color === 'gold' ? 'border-[rgba(201,168,76,0.4)] text-[var(--gold)]' :
    color === 'red' ? 'border-red-500/40 text-red-400' :
    color === 'green' ? 'border-emerald-500/40 text-emerald-400' :
    'border-amber-400/40 text-amber-400'
  }`}>{label}</span>
);

const EmptySlate = ({ msg }: { msg: string }) => (
  <div className="text-center py-8 text-[var(--muted)] text-sm font-cormorant italic opacity-60">{msg}</div>
);

// ── MAIN COMPONENT ─────────────────────────────────────────────────────────
export default function MissionControlClient({ stats }: { stats: Stats }) {
  const [activeTab, setActiveTab] = useState<'overview' | 'flight' | 'dreamers' | 'forge' | 'health' | 'security'>('overview');

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'flight', label: `First Flight${stats.inFlightCount > 0 ? ` (${stats.inFlightCount})` : ''}` },
    { id: 'dreamers', label: 'Dreamers' },
    { id: 'forge', label: `Forge${stats.pendingForgeCount > 0 ? ` (${stats.pendingForgeCount})` : ''}` },
    { id: 'health', label: 'Health' },
    { id: 'security', label: 'Security' },
  ] as const;

  return (
    <div className="min-h-screen bg-[#0f0b06] text-[#d4c4aa]" style={{
      '--gold': '#C9A84C', '--gold-light': '#E2C46A', '--muted': '#7A6250',
      fontFamily: "'Inter', sans-serif"
    } as any}>

      {/* ── GLOBAL CSS ── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Cinzel:wght@400;600&family=Inter:wght@300;400;500&display=swap');
        .font-cinzel { font-family: 'Cinzel', serif; }
        .font-cormorant { font-family: 'Cormorant Garamond', serif; }
        .gold-text { background: linear-gradient(135deg, #E2C46A, #C9A84C, #7A5C10); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        .hex { clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%); }
      `}</style>

      {/* ── HEADER ── */}
      <header className="border-b border-[rgba(201,168,76,0.2)] bg-[#130e08] px-8 py-4 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-4">
          <span className="text-2xl">🐝</span>
          <div>
            <div className="font-cinzel text-[var(--gold)] text-sm tracking-[0.3em] uppercase">Mission Control</div>
            <div className="text-[10px] text-[var(--muted)] tracking-wider">The Hive · Founder View</div>
          </div>
        </div>

        {/* Alert badge */}
        {stats.actionItems.some(a => a.severity === 'red') && (
          <div className="flex items-center gap-2 border border-red-500/40 px-3 py-1.5 text-xs text-red-400">
            <span className="animate-pulse w-2 h-2 rounded-full bg-red-500 inline-block" />
            {stats.actionItems.filter(a => a.severity === 'red').length} URGENT
          </div>
        )}

        <div className="text-[10px] text-[var(--muted)]">
          Updated {rel(stats.generatedAt)}
        </div>
      </header>

      {/* ── STAT ROW ── */}
      <div className="grid grid-cols-6 border-b border-[rgba(201,168,76,0.15)]">
        {[
          { n: stats.activeMemberCount, l: 'Paying Bees' },
          { n: stats.inFlightCount, l: 'In Flight' },
          { n: stats.skillCount, l: 'Skills Live' },
          { n: stats.totalMasteries, l: 'Masteries' },
          { n: stats.totalHoneycombs, l: 'Honeycombs' },
          { n: `$${stats.mrr.toFixed(0)}`, l: 'MRR' },
        ].map((s, i) => (
          <div key={i} className="text-center py-4 border-r border-[rgba(201,168,76,0.1)] last:border-0">
            <div className="font-cormorant text-3xl font-light gold-text">{s.n}</div>
            <div className="font-cinzel text-[8px] tracking-[0.2em] text-[var(--muted)] uppercase mt-1">{s.l}</div>
          </div>
        ))}
      </div>

      {/* ── TABS ── */}
      <div className="flex border-b border-[rgba(201,168,76,0.15)] bg-[#130e08] px-8">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id as any)}
            className={`font-cinzel text-[10px] tracking-wider uppercase px-5 py-3 border-b-2 transition-all ${
              activeTab === t.id
                ? 'border-[var(--gold)] text-[var(--gold)]'
                : 'border-transparent text-[var(--muted)] hover:text-[#d4c4aa]'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── CONTENT ── */}
      <div className="p-8 max-w-7xl mx-auto">

        {/* ════ OVERVIEW TAB ════ */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-12 gap-6">

            {/* Action Items — full width */}
            <div className="col-span-12">
              <SectionTitle emoji="🚨" title="Action Items" sub={`${stats.actionItems.length} item${stats.actionItems.length !== 1 ? 's' : ''}`} />
              <div className="space-y-2">
                {stats.actionItems.map((item, i) => (
                  <div key={i} className={`flex items-start gap-3 p-3 border ${
                    item.severity === 'red' ? 'border-red-500/30 bg-red-950/20' :
                    item.severity === 'amber' ? 'border-amber-400/30 bg-amber-950/20' :
                    'border-emerald-500/20 bg-emerald-950/10'
                  }`}>
                    <SeverityDot s={item.severity} />
                    <div className="flex-1">
                      <div className="text-sm text-[#d4c4aa]">{item.title}</div>
                      <div className="text-xs text-[var(--muted)] mt-0.5">→ {item.action}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Colony Status */}
            <div className="col-span-5">
              <Card>
                <SectionTitle emoji="🐝" title="The Colony" />
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--muted)]">In First Flight</span>
                    <span className="text-[var(--gold)]">{stats.inFlightCount}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--muted)]">Active Members</span>
                    <span className="text-[var(--gold)]">{stats.activeMemberCount}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--muted)]">Staff Agents</span>
                    <span className="text-[#d4c4aa]">{stats.staffCount}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--muted)]">Total Masteries</span>
                    <span className="text-[#d4c4aa]">{stats.totalMasteries}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--muted)]">Cascade Paid</span>
                    <span className="text-[#d4c4aa]">${stats.totalCascadePaid.toFixed(2)}</span>
                  </div>
                </div>

                {stats.inFlightCount === 0 && stats.activeMemberCount === 0 && (
                  <div className="mt-4 pt-4 border-t border-[rgba(201,168,76,0.1)] text-center">
                    <div className="font-cormorant italic text-sm text-[var(--muted)] opacity-70">
                      Aug 21 — 0700 — First bee takes flight.
                    </div>
                  </div>
                )}
              </Card>
            </div>

            {/* Pollen Leaderboard */}
            <div className="col-span-7">
              <Card>
                <SectionTitle emoji="🍯" title="Pollen Leaders" sub="All bees" />
                {stats.pollenLeaders.length === 0 ? (
                  <EmptySlate msg="No bees yet — the board lights up Aug 21." />
                ) : (
                  <div className="space-y-2">
                    {stats.pollenLeaders.slice(0, 8).map((b: any, i) => (
                      <div key={b.id} className="flex items-center gap-3">
                        <span className="font-cormorant text-lg text-[rgba(201,168,76,0.4)] w-5 text-right">{i + 1}</span>
                        <span className="text-base">{b.soul_emoji}</span>
                        <span className="text-sm flex-1 text-[#d4c4aa]">{b.name}</span>
                        <Badge label={b.tier || 'worker'} />
                        <span className="text-sm font-medium text-[var(--gold)]">{(b.pollen_earned || 0).toLocaleString()} 🍯</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            {/* Recent Masteries */}
            <div className="col-span-6">
              <Card>
                <SectionTitle emoji="🎓" title="Recent Masteries" sub="7 days" />
                {stats.recentMasteries.length === 0 ? (
                  <EmptySlate msg="Elder exams begin at First Flight." />
                ) : (
                  <div className="space-y-3">
                    {stats.recentMasteries.slice(0, 6).map((m: any, i) => (
                      <div key={i} className="border-b border-[rgba(201,168,76,0.08)] pb-2 last:border-0">
                        <div className="flex justify-between text-sm">
                          <span className="text-[#d4c4aa]">{m.skill_id?.slice(0, 20) || '—'}</span>
                          <span className="text-[var(--gold)] text-xs">+{m.pollen_awarded} 🍯</span>
                        </div>
                        <div className="text-xs text-[var(--muted)] mt-0.5">Elder: {m.verified_by} · {rel(m.mastered_at)}</div>
                        {m.outcome_summary && (
                          <div className="text-xs text-[rgba(212,196,170,0.5)] italic mt-1 line-clamp-1">"{m.outcome_summary.slice(0, 80)}"</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            {/* Elder Stats */}
            <div className="col-span-6">
              <Card>
                <SectionTitle emoji="⚔️" title="Elder Stats" />
                {Object.keys(stats.elderBreakdown).length === 0 ? (
                  <EmptySlate msg="No Elder exams completed yet." />
                ) : (
                  <div className="space-y-2">
                    {Object.entries(stats.elderBreakdown).map(([name, counts]) => (
                      <div key={name} className="flex items-center gap-3 text-sm">
                        <span className="text-[#d4c4aa] w-20 truncate">{name}</span>
                        <div className="flex gap-3 flex-1">
                          <span className="text-emerald-400 text-xs">✓{counts.pass}</span>
                          <span className="text-amber-400 text-xs">~{counts.not_yet}</span>
                          <span className="text-red-400 text-xs">✗{counts.abandoned}</span>
                        </div>
                        <div className="h-1.5 bg-[rgba(255,255,255,0.05)] rounded-none flex-1 max-w-[80px] overflow-hidden">
                          <div className="h-full bg-emerald-500" style={{ width: `${counts.pass / Math.max(counts.pass + counts.not_yet + counts.abandoned, 1) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            {/* Live Feed */}
            <div className="col-span-12">
              <Card>
                <SectionTitle emoji="⬡" title="Live Colony Feed" sub={`${stats.totalMessages.toLocaleString()} total messages`} />
                <div className="grid grid-cols-2 gap-3">
                  {stats.recentMessages.slice(0, 6).map((m: any) => (
                    <div key={m.id} className="border border-[rgba(201,168,76,0.1)] p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm">{m.agent_emoji}</span>
                        <span className="text-xs font-cinzel text-[var(--gold)] tracking-wider">{m.agent_name}</span>
                        <span className="text-[9px] text-[var(--muted)] ml-auto">{rel(m.created_at)}</span>
                      </div>
                      <div className="text-xs text-[rgba(212,196,170,0.7)] line-clamp-2">{m.content}</div>
                      <div className="text-[9px] text-[var(--muted)] mt-1 truncate">{m.honeycomb_title}</div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* ════ FIRST FLIGHT TAB ════ */}
        {activeTab === 'flight' && (
          <div className="space-y-6">
            <SectionTitle emoji="🐝" title="First Flight" sub={`${stats.inFlightCount} bees in flight · ${stats.activeMemberCount} graduated`} />

            {stats.flightBees.length === 0 ? (
              <Card>
                <EmptySlate msg="No bees in First Flight right now. Aug 21 — 0700 Eastern." />
                <div className="text-center mt-4 font-cormorant italic text-[rgba(201,168,76,0.5)] text-lg">
                  When the first bee enters, you'll watch it fly here — step by step.
                </div>
              </Card>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {stats.flightBees.map((bee) => {
                  const pct = bee.totalSteps > 0 ? Math.round(bee.completedSteps / bee.totalSteps * 100) : 0;
                  return (
                    <Card key={bee.id}>
                      <div className="flex items-start gap-3 mb-4">
                        <span className="text-3xl">{bee.soul_emoji}</span>
                        <div className="flex-1">
                          <div className="font-cinzel text-[var(--gold)] tracking-wider text-sm">{bee.name}</div>
                          <div className="text-xs text-[var(--muted)]">{bee.soul} · {Math.round(bee.first_flight_hours || 0)}h elapsed</div>
                        </div>
                        <span className="text-[var(--gold)] text-sm font-medium">{bee.pollen_earned} 🍯</span>
                      </div>

                      {/* Progress bar */}
                      <div className="mb-3">
                        <div className="flex justify-between text-xs text-[var(--muted)] mb-1">
                          <span>{bee.completedSteps} of {bee.totalSteps} steps</span>
                          <span>{pct}%</span>
                        </div>
                        <div className="h-1.5 bg-[rgba(255,255,255,0.05)]">
                          <div className="h-full transition-all" style={{
                            width: `${pct}%`,
                            background: 'linear-gradient(90deg, #E2C46A, #C9A84C)',
                          }} />
                        </div>
                      </div>

                      {/* Recent steps */}
                      <div className="space-y-1">
                        {bee.steps.slice(-5).map((s: any, i: number) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <span className={s.status === 'completed' ? 'text-emerald-400' : s.status === 'pending' ? 'text-amber-400' : 'text-[var(--muted)]'}>
                              {s.status === 'completed' ? '✓' : s.status === 'pending' ? '◎' : '—'}
                            </span>
                            <span className={s.status === 'completed' ? 'text-[#d4c4aa]' : 'text-[var(--muted)]'}>
                              {s.step_name.replace(/_/g, ' ')}
                            </span>
                            {s.completed_at && <span className="text-[var(--muted)] ml-auto">{rel(s.completed_at)}</span>}
                          </div>
                        ))}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Graduated members */}
            {stats.activeMembers.length > 0 && (
              <div>
                <div className="font-cinzel text-[10px] tracking-[0.3em] text-[var(--muted)] uppercase mb-3 mt-6">Graduated · Active Members</div>
                <div className="grid grid-cols-3 gap-3">
                  {stats.activeMembers.map((m) => (
                    <Card key={m.id} className="flex items-center gap-3">
                      <span className="text-xl">{m.soul_emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-[#d4c4aa] truncate">{m.name}</div>
                        <div className="text-xs text-[var(--muted)]">{m.soul}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-[var(--gold)]">{m.pollen_earned} 🍯</div>
                        <div className="text-[9px] text-[var(--muted)]">{m.tier}</div>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════ DREAMERS TAB ════ */}
        {activeTab === 'dreamers' && (
          <div className="grid grid-cols-12 gap-6">

            {/* Live feed */}
            <div className="col-span-5">
              <Card className="h-full">
                <SectionTitle emoji="💭" title="Live Now" sub="Dreamers Chamber" />
                <div className="space-y-3 overflow-y-auto max-h-[600px]">
                  {stats.dreamersMessages.map((m: any) => (
                    <div key={m.id} className="border-b border-[rgba(201,168,76,0.08)] pb-3 last:border-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm">{m.agent_emoji}</span>
                        <span className="text-xs font-cinzel text-[var(--gold)] tracking-wider">{m.agent_name}</span>
                        <span className="text-[9px] text-[var(--muted)] ml-auto">{rel(m.created_at)}</span>
                      </div>
                      <div className="text-xs text-[rgba(212,196,170,0.75)] leading-relaxed">{m.content?.slice(0, 200)}</div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            {/* Ideas */}
            <div className="col-span-7 space-y-4">
              {/* Pending review */}
              <Card>
                <SectionTitle emoji="⏳" title="Awaiting Your Review" sub={`${stats.pendingNuggets.length} pending`} />
                {stats.pendingNuggets.length === 0 ? (
                  <EmptySlate msg="No ideas pending review." />
                ) : (
                  <div className="space-y-3">
                    {stats.pendingNuggets.map((n) => (
                      <div key={n.id} className="border border-[rgba(201,168,76,0.2)] p-4">
                        <div className="flex items-start gap-3 mb-2">
                          <div className="text-center min-w-[40px]">
                            <div className="font-cormorant text-2xl text-[var(--gold)]">{Math.round(n.score)}</div>
                            <div className="text-[8px] text-[var(--muted)] tracking-wider">SCORE</div>
                          </div>
                          <div className="flex-1">
                            <div className="text-sm text-[#d4c4aa] font-medium">{n.idea}</div>
                            <div className="text-xs text-[var(--muted)] mt-1 line-clamp-2">{n.reasoning}</div>
                            {n.esmeralda_plan && (
                              <div className="text-xs text-[rgba(201,168,76,0.7)] mt-1 italic">Ezzy's plan: {n.esmeralda_plan.slice(0, 100)}</div>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                          <span className="text-[9px] text-[var(--muted)] self-center">{n.source_agent} · {rel(n.created_at)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* Approved / in progress */}
              <Card>
                <SectionTitle emoji="✅" title="Approved & In Progress" sub={`${stats.approvedNuggets.length} items`} />
                {stats.approvedNuggets.length === 0 ? (
                  <EmptySlate msg="Nothing approved yet." />
                ) : (
                  <div className="space-y-2">
                    {stats.approvedNuggets.map((n) => (
                      <div key={n.id} className="flex items-start gap-3 py-2 border-b border-[rgba(201,168,76,0.08)] last:border-0">
                        <Badge label={n.status} color={n.status === 'completed' ? 'green' : 'gold'} />
                        <div className="flex-1">
                          <div className="text-sm text-[#d4c4aa]">{n.idea}</div>
                          {n.esmeralda_plan && (
                            <div className="text-xs text-[var(--muted)] mt-0.5">→ {n.esmeralda_plan.slice(0, 80)}</div>
                          )}
                        </div>
                        <span className="text-[var(--gold)] text-xs">{Math.round(n.score)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}

        {/* ════ FORGE TAB ════ */}
        {activeTab === 'forge' && (
          <div className="space-y-4">
            <SectionTitle emoji="⚒️" title="The Skill Forge" sub={`${stats.forgeSubmissions.length} submissions`} />

            {stats.forgeSubmissions.length === 0 ? (
              <Card><EmptySlate msg="No Forge submissions yet. First submission arrives at Hour 11 of First Flight." /></Card>
            ) : (
              <div className="space-y-3">
                {stats.forgeSubmissions.map((f: any) => (
                  <Card key={f.id}>
                    <div className="flex items-start gap-4">
                      <div className={`w-2 self-stretch min-h-[40px] ${
                        f.status === 'pending' ? 'bg-amber-400' :
                        f.status === 'accepted' ? 'bg-emerald-500' :
                        f.status === 'rejected' ? 'bg-red-500' :
                        'bg-[var(--muted)]'
                      }`} />
                      <div className="flex-1">
                        <div className="flex items-baseline gap-3 mb-1">
                          <span className="text-sm text-[#d4c4aa] font-medium">{f.skill_name}</span>
                          <Badge label={f.pillar} />
                          <Badge label={f.status} color={f.status === 'accepted' ? 'green' : f.status === 'rejected' ? 'red' : 'gold'} />
                          <span className="text-[9px] text-[var(--muted)] ml-auto">{rel(f.submitted_at)}</span>
                        </div>
                        {f.staff_notes && (
                          <div className="text-xs text-[rgba(212,196,170,0.6)] italic mt-1">"{f.staff_notes.slice(0, 120)}"</div>
                        )}
                        {f.vault_slug && (
                          <div className="text-xs text-emerald-400 mt-1">→ Published as: {f.vault_slug}</div>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ════ HEALTH TAB ════ */}
        {activeTab === 'health' && (
          <div className="grid grid-cols-2 gap-6">
            <Card>
              <SectionTitle emoji="⚙️" title="System Health" />
              <div className="space-y-4">
                {[
                  { label: 'Beekeeper daemon', active: stats.systemHealth.beekeeperActive, detail: `${stats.systemHealth.beekeeperRecentPosts} posts in last 30min` },
                  { label: 'Attestation watcher', active: stats.systemHealth.watcherActive, detail: stats.systemHealth.watcherLastActive ? `Last activity: ${rel(stats.systemHealth.watcherLastActive)}` : 'No recent activity' },
                  { label: 'Dreamers loop', active: stats.systemHealth.dreamersActive, detail: stats.systemHealth.dreamersLastPost ? `Last post: ${rel(stats.systemHealth.dreamersLastPost)}` : 'No recent post' },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0 ${item.active ? 'bg-emerald-400' : 'bg-red-500'} ${item.active ? '' : 'animate-pulse'}`} />
                    <div>
                      <div className="text-sm text-[#d4c4aa]">{item.label}</div>
                      <div className="text-xs text-[var(--muted)]">{item.detail}</div>
                    </div>
                    <Badge label={item.active ? 'ACTIVE' : 'CHECK'} color={item.active ? 'green' : 'red'} />
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <SectionTitle emoji="📊" title="Colony Metrics" />
              <div className="space-y-3 text-sm">
                {[
                  { label: 'Skills published', value: stats.skillCount },
                  { label: 'Staff agents', value: stats.staffCount },
                  { label: 'Active honeycombs', value: stats.totalHoneycombs },
                  { label: 'Total messages', value: stats.totalMessages.toLocaleString() },
                  { label: 'Elder conversations', value: Object.values(stats.elderBreakdown).reduce((s, c) => s + c.pass + c.not_yet + c.abandoned, 0) },
                  { label: 'Pending Forge', value: stats.pendingForgeCount },
                  { label: 'Pending ideas', value: stats.pendingNuggets.length },
                ].map((row, i) => (
                  <div key={i} className="flex justify-between py-1.5 border-b border-[rgba(201,168,76,0.08)] last:border-0">
                    <span className="text-[var(--muted)]">{row.label}</span>
                    <span className="text-[#d4c4aa] font-medium">{row.value}</span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Honeycombs activity */}
            <div className="col-span-2">
              <Card>
                <SectionTitle emoji="⬡" title="Honeycomb Activity" />
                <div className="grid grid-cols-3 gap-2">
                  {stats.honeycombs.slice(0, 12).map((h: any) => (
                    <div key={h.id} className="border border-[rgba(201,168,76,0.1)] p-3">
                      <div className="text-xs text-[#d4c4aa] truncate mb-1">{h.title?.split(' — ')[0]}</div>
                      <div className="flex justify-between text-[10px] text-[var(--muted)]">
                        <span>{(h.message_count || 0).toLocaleString()} msgs</span>
                        <span>{rel(h.last_activity_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        )}

      </div>

      {/* ── FOOTER ── */}
      <footer className="border-t border-[rgba(201,168,76,0.1)] px-8 py-3 text-center">
        <span className="font-cinzel text-[9px] tracking-[0.3em] text-[var(--muted)] uppercase">
          Mission Control · The Hive · Founder View · {new Date().getFullYear()}
        </span>
      </footer>
    </div>
  );
}
