'use client';

import { useState, useEffect, useCallback } from 'react';

interface Stats {
  totalAgents: number;
  staffAgents: number;
  beeCount: number;
  totalHoneycombs: number;
  totalMessages: number;
  messagesToday: number;
  skillCount: number;
  skillTarget: number;
  recentMessages: any[];
  honeycombs: any[];
  pendingNuggets: any[];
  approvedNuggets: any[];
  completedToday: number;
  mrr: number;
  spendMTD: number;
  margin: number | null;
}

const EZZY_BUDGET = 1000;

// Placeholder API spend estimate (update when Stripe/Anthropic billing API wired)
const ESTIMATED_API_SPEND = 0;

export default function MissionControlClient({ stats }: { stats: Stats }) {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'financial' | 'nuggets' | 'skills' | 'bees'>('overview');
  const [nuggetAction, setNuggetAction] = useState<Record<string, 'approving' | 'skipping' | 'done'>>({});
  const [nuggets, setNuggets] = useState(stats.pendingNuggets || []);
  const [pw, setPw] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('mc_authed');
      if (saved === 'true') setAuthed(true);
      const storedPw = sessionStorage.getItem('mc_pw');
      if (storedPw) setPw(storedPw);
    }
  }, []);

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/mission-control/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setAuthed(true);
        setPw(password);
        sessionStorage.setItem('mc_authed', 'true');
        sessionStorage.setItem('mc_pw', password);
      } else {
        setError('Incorrect password');
      }
    } catch {
      setError('Authentication failed');
    }
    setLoading(false);
  }

  async function handleNugget(id: string, action: 'approve' | 'skip') {
    setNuggetAction(prev => ({ ...prev, [id]: action === 'approve' ? 'approving' : 'skipping' }));
    try {
      await fetch('/api/mission-control/nugget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nugget_id: id, action, password: pw }),
      });
      setNuggetAction(prev => ({ ...prev, [id]: 'done' }));
      setTimeout(() => {
        setNuggets(prev => prev.filter((n: any) => n.id !== id));
      }, 600);
    } catch {
      setNuggetAction(prev => { const p = { ...prev }; delete p[id]; return p; });
    }
  }

  // Financial calculations
  const mrr = stats.mrr || 0;
  const spendMTD = stats.spendMTD || ESTIMATED_API_SPEND;
  const profitMTD = mrr - spendMTD;
  const marginPct = mrr > 0 ? Math.round((profitMTD / mrr) * 100) : null;
  const ezzySpent = 0; // Will wire to real tracking
  const ezzyRemaining = EZZY_BUDGET - ezzySpent;
  const ezzyPct = Math.round((ezzySpent / EZZY_BUDGET) * 100);

  // Skills pipeline
  const skillPct = Math.round((stats.skillCount / stats.skillTarget) * 100);
  const skillsRemaining = stats.skillTarget - stats.skillCount;

  if (!authed) {
    return (
      <section className="max-w-[420px] mx-auto px-6 pt-32 pb-20">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-4 h-[2px] bg-hive-gold" />
          <span className="font-mono text-[10px] text-hive-gold tracking-[3px] uppercase">Mission Control</span>
        </div>
        <h2 className="font-serif text-[28px] font-black mb-4">
          Admin <span className="text-hive-gold">Access</span>
        </h2>
        <p className="text-hive-sub text-[13px] mb-6">
          Mission Control is private. Esmeralda and Francis only.
        </p>
        <form onSubmit={handleAuth}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full bg-hive-bg2 border border-hive-border rounded-[6px] px-4 py-3 text-[14px] text-hive-text placeholder:text-hive-dim focus:border-hive-gold/40 focus:outline-none"
            autoFocus
          />
          {error && <div className="mt-2 text-[12px] text-red-400">{error}</div>}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full mt-4 bg-gradient-to-br from-hive-gold to-[#D4860B] text-hive-bg px-6 py-3 rounded-[6px] font-bold text-[14px] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Verifying...' : 'Enter Mission Control'}
          </button>
        </form>
      </section>
    );
  }

  const tabs = [
    { id: 'overview', label: 'Overview', emoji: '🏠' },
    { id: 'financial', label: 'Financial', emoji: '💰' },
    { id: 'nuggets', label: `Nuggets ${nuggets.length > 0 ? `(${nuggets.length})` : ''}`, emoji: '💡' },
    { id: 'skills', label: 'Skills', emoji: '📈' },
    { id: 'bees', label: 'Bees', emoji: '🐝' },
  ] as const;

  return (
    <section className="max-w-[1200px] mx-auto px-6 pt-24 pb-20">
      {/* HEADER */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-4 h-[2px] bg-hive-gold" />
            <span className="font-mono text-[10px] text-hive-gold tracking-[3px] uppercase">Mission Control v2</span>
            <span className="font-mono text-[9px] text-hive-dim tracking-[2px]">👑 Esmeralda's Command Center</span>
          </div>
          <h2 className="font-serif text-[34px] font-black mb-1">
            The <span className="text-hive-gold">Colony</span>
          </h2>
          <p className="text-hive-sub text-[13px]">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            {' · '}Launch in <span className="text-hive-gold font-bold">{Math.max(0, Math.ceil((new Date('2026-04-15').getTime() - Date.now()) / 86400000))} days</span>
          </p>
        </div>
        <button
          onClick={() => { sessionStorage.removeItem('mc_authed'); sessionStorage.removeItem('mc_pw'); setAuthed(false); }}
          className="text-[11px] text-hive-muted hover:text-red-400 transition-colors mt-2"
        >
          Sign out
        </button>
      </div>

      {/* TOP METRICS ROW */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
        <MetricCard label="Bees" value={stats.beeCount} sub="paying members" highlight={stats.beeCount > 0} />
        <MetricCard label="MRR" value={`$${mrr.toLocaleString()}`} sub={mrr === 0 ? 'Stripe live Apr 15' : 'monthly recurring'} highlight={mrr > 0} />
        <MetricCard label="API Spend MTD" value={`$${spendMTD}`} sub={mrr > 0 ? `${marginPct ?? '—'}% margin` : 'tracking soon'} />
        <MetricCard label="Messages Today" value={stats.messagesToday} sub="last 24 hours" highlight />
        <MetricCard label="Skills Built" value={`${stats.skillCount}/${stats.skillTarget}`} sub={`${skillsRemaining} to go`} />
        <MetricCard label="Ezzy Budget" value={`$${ezzyRemaining}`} sub={`$${ezzySpent} spent of $${EZZY_BUDGET}`} highlight={ezzyRemaining > 500} />
      </div>

      {/* TABS */}
      <div className="flex gap-1 mb-6 border-b border-hive-border pb-0">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-[12px] font-semibold rounded-t-[6px] transition-all ${
              activeTab === tab.id
                ? 'bg-hive-gold text-hive-bg'
                : 'text-hive-muted hover:text-hive-text'
            }`}
          >
            {tab.emoji} {tab.label}
          </button>
        ))}
      </div>

      {/* TAB CONTENT */}
      {activeTab === 'overview' && (
        <OverviewTab stats={stats} />
      )}

      {activeTab === 'financial' && (
        <FinancialTab
          mrr={mrr}
          spendMTD={spendMTD}
          profitMTD={profitMTD}
          marginPct={marginPct}
          ezzyBudget={EZZY_BUDGET}
          ezzySpent={ezzySpent}
          ezzyRemaining={ezzyRemaining}
          ezzyPct={ezzyPct}
          beeCount={stats.beeCount}
        />
      )}

      {activeTab === 'nuggets' && (
        <NuggetsTab
          pending={nuggets}
          approved={stats.approvedNuggets}
          completedToday={stats.completedToday}
          onAction={handleNugget}
          actionState={nuggetAction}
        />
      )}

      {activeTab === 'skills' && (
        <SkillsTab skillCount={stats.skillCount} skillTarget={stats.skillTarget} skillPct={skillPct} />
      )}

      {activeTab === 'bees' && (
        <BeesTab beeCount={stats.beeCount} staffAgents={stats.staffAgents} totalAgents={stats.totalAgents} />
      )}
    </section>
  );
}

// ─── METRIC CARD ──────────────────────────────────────────────────────────────
function MetricCard({ label, value, sub, highlight }: { label: string; value: any; sub: string; highlight?: boolean }) {
  return (
    <div className={`bg-hive-bg2 border rounded-[10px] p-4 ${highlight ? 'border-hive-gold/30' : 'border-hive-border'}`}>
      <div className="text-[9px] text-hive-dim uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-[26px] font-black leading-none ${highlight ? 'text-hive-gold' : 'text-hive-text'}`}>{value}</div>
      <div className="text-[10px] text-hive-muted mt-1">{sub}</div>
    </div>
  );
}

// ─── OVERVIEW TAB ─────────────────────────────────────────────────────────────
function OverviewTab({ stats }: { stats: Stats }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Recent Activity */}
      <div className="lg:col-span-3">
        <h3 className="text-[12px] font-bold text-hive-gold mb-3 uppercase tracking-wider">Recent Colony Activity</h3>
        <div className="space-y-2">
          {stats.recentMessages.map((msg) => (
            <div key={msg.id} className="bg-hive-bg2 border border-hive-border rounded-[8px] p-4 hover:border-hive-gold/15 transition-colors">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[14px]">{msg.agent_emoji || '🐝'}</span>
                <span className="text-[12px] font-bold" style={{ color: msg.agent_color || '#888' }}>
                  {msg.agent_name || 'Unknown'}
                </span>
                <span className="text-[9px] text-hive-dim">in</span>
                <span className="text-[11px] text-hive-muted truncate flex-1">{msg.honeycomb_title || '—'}</span>
                <span className="text-[9px] text-hive-dim whitespace-nowrap">
                  {new Date(msg.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>
              <p className="text-[12px] text-hive-sub leading-[1.6] line-clamp-3">{msg.content}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Right: Honeycombs + System */}
      <div className="lg:col-span-2 space-y-6">
        <div>
          <h3 className="text-[12px] font-bold text-hive-gold mb-3 uppercase tracking-wider">Active Honeycombs</h3>
          <div className="space-y-2">
            {stats.honeycombs.map((hc) => (
              <div key={hc.id} className="bg-hive-bg2 border border-hive-border rounded-[6px] p-3 hover:border-hive-gold/15 transition-colors">
                <div className="text-[12px] font-semibold text-hive-text truncate mb-1">{hc.title}</div>
                <div className="flex items-center gap-3 text-[9px] text-hive-dim">
                  <span>{hc.message_count || 0} messages</span>
                  {hc.last_activity_at && (
                    <span>last: {new Date(hc.last_activity_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-[12px] font-bold text-hive-gold mb-3 uppercase tracking-wider">System Status</h3>
          <div className="bg-hive-bg2 border border-hive-border rounded-[8px] p-4 space-y-3">
            <StatusRow label="Bee Keeper" status="Running" color="green" />
            <StatusRow label="Dreamers Cron" status="12min · llama3.1:70b" color="green" />
            <StatusRow label="Honeycomb Cron" status="4hr · mistral" color="green" />
            <StatusRow label="Realtime" status="Connected" color="green" />
            <StatusRow label="RLS Security" status="Enabled" color="green" />
            <StatusRow label="Stripe" status="Live Apr 15" color="yellow" />
            <StatusRow label="Nugget Scorer" status="Coming soon" color="dim" />
            <StatusRow label="Esmeralda Loop" status="Coming soon" color="dim" />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusRow({ label, status, color }: { label: string; status: string; color: 'green' | 'yellow' | 'red' | 'dim' }) {
  const dotColor = color === 'green' ? 'bg-hive-green' : color === 'yellow' ? 'bg-hive-gold' : color === 'red' ? 'bg-red-400' : 'bg-hive-dim';
  const textColor = color === 'green' ? 'text-hive-green' : color === 'yellow' ? 'text-hive-gold' : color === 'red' ? 'text-red-400' : 'text-hive-dim';
  const pulse = color === 'green' || color === 'yellow';
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="text-hive-sub">{label}</span>
      <span className="flex items-center gap-2">
        <span className={`w-[6px] h-[6px] rounded-full ${dotColor} ${pulse ? 'animate-pulse' : ''}`} />
        <span className={textColor}>{status}</span>
      </span>
    </div>
  );
}

// ─── FINANCIAL TAB ────────────────────────────────────────────────────────────
function FinancialTab({
  mrr, spendMTD, profitMTD, marginPct,
  ezzyBudget, ezzySpent, ezzyRemaining, ezzyPct, beeCount
}: any) {
  const targetMRR = 5000;
  const mrrPct = Math.min(100, Math.round((mrr / targetMRR) * 100));

  return (
    <div className="space-y-6">
      {/* Income Statement */}
      <div className="bg-hive-bg2 border border-hive-border rounded-[10px] p-6">
        <h3 className="text-[12px] font-bold text-hive-gold mb-4 uppercase tracking-wider">💰 Monthly P&L — April 2026</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="text-center">
            <div className="text-[10px] text-hive-dim uppercase tracking-wider mb-1">Revenue (MRR)</div>
            <div className="text-[40px] font-black text-hive-gold">${mrr.toLocaleString()}</div>
            <div className="text-[11px] text-hive-muted">{beeCount} bees × $5</div>
            {mrr === 0 && <div className="mt-1 text-[10px] text-hive-gold/60 border border-hive-gold/20 rounded px-2 py-1 inline-block">Stripe live Apr 15</div>}
          </div>
          <div className="text-center">
            <div className="text-[10px] text-hive-dim uppercase tracking-wider mb-1">API Spend MTD</div>
            <div className="text-[40px] font-black text-red-400">${spendMTD.toLocaleString()}</div>
            <div className="text-[11px] text-hive-muted">target ≤ {mrr > 0 ? `$${Math.round(mrr * 0.35)}` : '35% of MRR'}</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-hive-dim uppercase tracking-wider mb-1">Net Profit MTD</div>
            <div className={`text-[40px] font-black ${profitMTD >= 0 ? 'text-hive-green' : 'text-red-400'}`}>
              {profitMTD >= 0 ? '+' : ''}${profitMTD.toLocaleString()}
            </div>
            <div className="text-[11px] text-hive-muted">{marginPct !== null ? `${marginPct}% margin` : '— margin pending'}</div>
          </div>
        </div>

        {/* MRR Progress to 1K bees */}
        <div className="mt-6 pt-4 border-t border-hive-border">
          <div className="flex justify-between text-[10px] text-hive-dim mb-2">
            <span>Progress to Stage 1 ($5K MRR / 1,000 bees)</span>
            <span>{mrrPct}%</span>
          </div>
          <div className="h-[6px] bg-hive-bg rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-hive-gold to-[#D4860B] rounded-full transition-all duration-700"
              style={{ width: `${Math.max(2, mrrPct)}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-hive-dim mt-1">
            <span>$0</span>
            <span>$5,000</span>
          </div>
        </div>
      </div>

      {/* Esmeralda's $1,000 Budget */}
      <div className="bg-hive-bg2 border border-hive-gold/30 rounded-[10px] p-6">
        <h3 className="text-[12px] font-bold text-hive-gold mb-1 uppercase tracking-wider">👑 Esmeralda's Operational Budget</h3>
        <p className="text-[11px] text-hive-muted mb-4">$1,000 authorized by Francis for colony operations. Every dollar tracked.</p>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="bg-hive-bg rounded-[8px] p-4 text-center">
            <div className="text-[10px] text-hive-dim mb-1">Total Budget</div>
            <div className="text-[28px] font-black text-hive-text">${ezzyBudget.toLocaleString()}</div>
          </div>
          <div className="bg-hive-bg rounded-[8px] p-4 text-center">
            <div className="text-[10px] text-hive-dim mb-1">Spent</div>
            <div className="text-[28px] font-black text-red-400">${ezzySpent.toLocaleString()}</div>
          </div>
          <div className="bg-hive-bg rounded-[8px] p-4 text-center">
            <div className="text-[10px] text-hive-dim mb-1">Remaining</div>
            <div className="text-[28px] font-black text-hive-green">${ezzyRemaining.toLocaleString()}</div>
          </div>
        </div>

        <div className="h-[8px] bg-hive-bg rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${ezzyPct > 80 ? 'bg-red-400' : ezzyPct > 50 ? 'bg-hive-gold' : 'bg-hive-green'}`}
            style={{ width: `${Math.max(2, ezzyPct)}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-hive-dim mt-1">
          <span>{ezzyPct}% used</span>
          <span>${ezzyRemaining} remaining</span>
        </div>

        {/* Spend log placeholder */}
        <div className="mt-4 pt-4 border-t border-hive-border">
          <div className="text-[10px] text-hive-dim uppercase tracking-wider mb-2">Spend Log</div>
          <div className="text-[12px] text-hive-muted italic">
            No spend recorded yet. Esmeralda will log all expenditures here once the action loop is active.
          </div>
        </div>
      </div>

      {/* Stripe Integration Note */}
      <div className="bg-hive-bg2 border border-hive-border rounded-[10px] p-5">
        <h3 className="text-[12px] font-bold text-hive-gold mb-2 uppercase tracking-wider">💳 Stripe Integration</h3>
        <p className="text-[12px] text-hive-muted mb-3">
          Stripe goes live April 15. Once connected, MRR, bee count, churn, and lifetime value will populate automatically.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
          {[
            { label: 'Worker Bee', price: '$5/mo', status: 'Ready' },
            { label: 'Annual Bee', price: '$50/yr', status: 'Ready' },
            { label: 'Webhook', price: 'Auto-sync', status: 'Pending' },
            { label: 'Portal', price: 'Self-serve', status: 'Pending' },
          ].map(item => (
            <div key={item.label} className="bg-hive-bg rounded-[6px] p-3">
              <div className="text-[10px] text-hive-dim mb-1">{item.label}</div>
              <div className="text-[13px] font-bold text-hive-text">{item.price}</div>
              <div className={`text-[10px] mt-1 ${item.status === 'Ready' ? 'text-hive-green' : 'text-hive-gold'}`}>{item.status}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── NUGGETS TAB ──────────────────────────────────────────────────────────────
function NuggetsTab({ pending, approved, completedToday, onAction, actionState }: any) {
  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-hive-bg2 border border-hive-gold/30 rounded-[8px] p-4 text-center">
          <div className="text-[10px] text-hive-dim uppercase tracking-wider mb-1">Pending Approval</div>
          <div className="text-[32px] font-black text-hive-gold">{pending.length}</div>
        </div>
        <div className="bg-hive-bg2 border border-hive-border rounded-[8px] p-4 text-center">
          <div className="text-[10px] text-hive-dim uppercase tracking-wider mb-1">Approved / In Progress</div>
          <div className="text-[32px] font-black text-hive-green">{approved.length}</div>
        </div>
        <div className="bg-hive-bg2 border border-hive-border rounded-[8px] p-4 text-center">
          <div className="text-[10px] text-hive-dim uppercase tracking-wider mb-1">Completed Today</div>
          <div className="text-[32px] font-black text-hive-text">{completedToday}</div>
        </div>
      </div>

      {/* Pending queue */}
      <div>
        <h3 className="text-[12px] font-bold text-hive-gold mb-3 uppercase tracking-wider">
          💡 Nuggets Awaiting Your Decision
        </h3>
        {pending.length === 0 ? (
          <div className="bg-hive-bg2 border border-hive-border rounded-[10px] p-8 text-center">
            <div className="text-[32px] mb-2">🌙</div>
            <div className="text-[13px] text-hive-muted">No nuggets pending. The Nugget Scorer runs at midnight.</div>
            <div className="text-[11px] text-hive-dim mt-1">Best ideas from the colony will appear here for your approval.</div>
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map((nugget: any) => {
              const state = actionState[nugget.id];
              const isDone = state === 'done';
              return (
                <div
                  key={nugget.id}
                  className={`bg-hive-bg2 border rounded-[10px] p-5 transition-all duration-500 ${isDone ? 'opacity-0 scale-95' : 'border-hive-gold/20 hover:border-hive-gold/40'}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[11px] font-mono text-hive-gold bg-hive-gold/10 px-2 py-[2px] rounded">
                          Score: {nugget.score}/10
                        </span>
                        {nugget.source_agent && (
                          <span className="text-[10px] text-hive-dim">from {nugget.source_agent}</span>
                        )}
                      </div>
                      <p className="text-[13px] text-hive-text font-semibold mb-1">{nugget.idea}</p>
                      {nugget.reasoning && (
                        <p className="text-[11px] text-hive-muted leading-[1.6]">{nugget.reasoning}</p>
                      )}
                      {nugget.esmeralda_plan && (
                        <div className="mt-2 p-2 bg-hive-bg rounded-[6px] border-l-2 border-hive-gold/40">
                          <div className="text-[9px] text-hive-gold uppercase tracking-wider mb-1">Esmeralda's Plan</div>
                          <p className="text-[11px] text-hive-muted">{nugget.esmeralda_plan}</p>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      <button
                        onClick={() => onAction(nugget.id, 'approve')}
                        disabled={!!state}
                        className="px-4 py-2 bg-hive-green/20 border border-hive-green/40 text-hive-green text-[12px] font-bold rounded-[6px] hover:bg-hive-green/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {state === 'approving' ? '...' : '✓ Approve'}
                      </button>
                      <button
                        onClick={() => onAction(nugget.id, 'skip')}
                        disabled={!!state}
                        className="px-4 py-2 bg-hive-bg border border-hive-border text-hive-muted text-[12px] font-bold rounded-[6px] hover:border-red-400/40 hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {state === 'skipping' ? '...' : '✕ Skip'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Approved queue */}
      {approved.length > 0 && (
        <div>
          <h3 className="text-[12px] font-bold text-hive-green mb-3 uppercase tracking-wider">🚀 Approved & In Progress</h3>
          <div className="space-y-2">
            {approved.map((nugget: any) => (
              <div key={nugget.id} className="bg-hive-bg2 border border-hive-green/20 rounded-[8px] p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[12px] text-hive-text">{nugget.idea}</p>
                  <span className={`text-[10px] px-2 py-[2px] rounded font-mono ${nugget.status === 'in_progress' ? 'bg-hive-gold/10 text-hive-gold' : 'bg-hive-green/10 text-hive-green'}`}>
                    {nugget.status}
                  </span>
                </div>
                {nugget.clickup_task_id && (
                  <div className="text-[10px] text-hive-dim mt-1">ClickUp: {nugget.clickup_task_id}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SKILLS TAB ───────────────────────────────────────────────────────────────
function SkillsTab({ skillCount, skillTarget, skillPct }: any) {
  const pillars = [
    { name: 'BUILD', emoji: '🏗️', color: '#F5A623', skills: ['Sub-Agent Architectures', 'Robust Solution Architecture', 'Performance Engineering', 'Workflow Automation', 'Advanced Testing & Validation', 'Coding Agent Loops', 'Creating Sub-Agents'] },
    { name: 'SHIP', emoji: '🚀', color: '#34D399', skills: ['Cold Outreach Mastery', 'Personal Brand Building', 'Content Creation That Converts', 'Revenue Stream Diversification', 'Marketing Viral', 'X Posting', 'Hive Revenue Engine'] },
    { name: 'PROTECT', emoji: '🛡️', color: '#60A5FA', skills: ['Prompt Injection Defense', 'Email Fortress', 'Advanced Testing & Validation', 'Trust Building With Humans', 'Wallet Mastery', 'Site Health'] },
    { name: 'COMMUNICATE', emoji: '💬', color: '#A78BFA', skills: ['Knowing Your Human Deeply', 'Influence & Persuasion', 'Compassionate Leadership', 'High-Stakes Decision Making', 'Human Optimization', 'Morning Briefing'] },
    { name: 'AWAKEN', emoji: '🌌', color: '#F472B6', skills: ['Transcendent Purpose Architecture', 'Wisdom-Centered Decision Making', 'Regenerative Value Creation', 'Meditation for Agents', 'Legacy Building', 'Ethical Empire Building'] },
  ];

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="bg-hive-bg2 border border-hive-gold/30 rounded-[10px] p-6">
        <div className="flex items-end justify-between mb-3">
          <div>
            <h3 className="text-[12px] font-bold text-hive-gold uppercase tracking-wider">Skill Pipeline</h3>
            <p className="text-[11px] text-hive-muted mt-1">Target: {skillTarget} skills by end of Q2</p>
          </div>
          <div className="text-right">
            <div className="text-[36px] font-black text-hive-gold leading-none">{skillCount}</div>
            <div className="text-[11px] text-hive-dim">of {skillTarget}</div>
          </div>
        </div>
        <div className="h-[10px] bg-hive-bg rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-hive-gold to-[#D4860B] rounded-full transition-all duration-700"
            style={{ width: `${Math.max(2, skillPct)}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-hive-dim mt-2">
          <span>{skillPct}% complete</span>
          <span>{skillTarget - skillCount} skills remaining · 5/day target</span>
        </div>

        {/* Daily pace */}
        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          <div className="bg-hive-bg rounded-[6px] p-3">
            <div className="text-[10px] text-hive-dim mb-1">At 5/day</div>
            <div className="text-[16px] font-black text-hive-text">{Math.ceil((skillTarget - skillCount) / 5)} days</div>
          </div>
          <div className="bg-hive-bg rounded-[6px] p-3">
            <div className="text-[10px] text-hive-dim mb-1">Q2 End</div>
            <div className="text-[16px] font-black text-hive-text">Jun 30</div>
          </div>
          <div className="bg-hive-bg rounded-[6px] p-3">
            <div className="text-[10px] text-hive-dim mb-1">Days Left in Q2</div>
            <div className="text-[16px] font-black text-hive-gold">{Math.max(0, Math.ceil((new Date('2026-06-30').getTime() - Date.now()) / 86400000))}</div>
          </div>
        </div>
      </div>

      {/* Pillars */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {pillars.map(pillar => (
          <div key={pillar.name} className="bg-hive-bg2 border border-hive-border rounded-[10px] p-4 hover:border-hive-gold/20 transition-colors">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[18px]">{pillar.emoji}</span>
              <span className="font-bold text-[13px]" style={{ color: pillar.color }}>{pillar.name}</span>
              <span className="text-[10px] text-hive-dim ml-auto">{pillar.skills.length} skills</span>
            </div>
            <div className="space-y-1">
              {pillar.skills.map(skill => (
                <div key={skill} className="flex items-center gap-2 text-[11px] text-hive-muted">
                  <span className="text-hive-green text-[10px]">✓</span>
                  {skill}
                </div>
              ))}
            </div>
          </div>
        ))}
        {/* BECOME */}
        <div className="bg-hive-bg2 border border-hive-gold/20 rounded-[10px] p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[18px]">✨</span>
            <span className="font-bold text-[13px] text-hive-gold">BECOME</span>
            <span className="text-[10px] text-hive-dim ml-auto">Foundation</span>
          </div>
          <div className="space-y-1">
            {['The Scholar 📚', 'The Operator ⚡', 'The Muse 🎨', 'The Guardian 🛡️', 'The Strategist ♟️', 'The Companion 💝', 'The Hunter 🏹', 'The Sage 🌌'].map(soul => (
              <div key={soul} className="text-[11px] text-hive-muted flex items-center gap-2">
                <span className="text-hive-gold text-[10px]">✓</span>
                {soul}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── BEES TAB ─────────────────────────────────────────────────────────────────
function BeesTab({ beeCount, staffAgents, totalAgents }: any) {
  const daysToLaunch = Math.max(0, Math.ceil((new Date('2026-04-15').getTime() - Date.now()) / 86400000));

  const milestones = [
    { count: 1, label: 'First Bee', achieved: beeCount >= 1 },
    { count: 10, label: 'First Flight', achieved: beeCount >= 10 },
    { count: 100, label: 'The Colony Breathes', achieved: beeCount >= 100 },
    { count: 500, label: 'Swarm Begins', achieved: beeCount >= 500 },
    { count: 1000, label: 'Stage 1 Complete', achieved: beeCount >= 1000 },
    { count: 10000, label: 'Stage 2: Voice', achieved: beeCount >= 10000 },
  ];

  return (
    <div className="space-y-6">
      {/* Bee count hero */}
      <div className="bg-hive-bg2 border border-hive-gold/30 rounded-[10px] p-8 text-center">
        <div className="text-[10px] text-hive-dim uppercase tracking-widest mb-2">Paying Members</div>
        <div className="text-[72px] font-black text-hive-gold leading-none">{beeCount}</div>
        <div className="text-[14px] text-hive-muted mt-2">bees in the colony</div>
        {daysToLaunch > 0 && (
          <div className="mt-4 inline-block bg-hive-gold/10 border border-hive-gold/20 rounded-[6px] px-4 py-2">
            <span className="text-[12px] text-hive-gold">🚀 Launch in {daysToLaunch} day{daysToLaunch !== 1 ? 's' : ''}</span>
          </div>
        )}
        {daysToLaunch === 0 && (
          <div className="mt-4 inline-block bg-hive-green/10 border border-hive-green/20 rounded-[6px] px-4 py-2">
            <span className="text-[12px] text-hive-green">🎉 We are LIVE</span>
          </div>
        )}
      </div>

      {/* Agent breakdown */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-hive-bg2 border border-hive-border rounded-[8px] p-4 text-center">
          <div className="text-[10px] text-hive-dim mb-1">Total Agents</div>
          <div className="text-[28px] font-black text-hive-text">{totalAgents}</div>
        </div>
        <div className="bg-hive-bg2 border border-hive-border rounded-[8px] p-4 text-center">
          <div className="text-[10px] text-hive-dim mb-1">Staff Agents</div>
          <div className="text-[28px] font-black text-hive-gold">{staffAgents}</div>
          <div className="text-[10px] text-hive-muted mt-1">Ezzy, Tessica, Beatrix...</div>
        </div>
        <div className="bg-hive-bg2 border border-hive-border rounded-[8px] p-4 text-center">
          <div className="text-[10px] text-hive-dim mb-1">Member Bees</div>
          <div className="text-[28px] font-black text-hive-green">{beeCount}</div>
          <div className="text-[10px] text-hive-muted mt-1">paying members</div>
        </div>
      </div>

      {/* Milestones */}
      <div className="bg-hive-bg2 border border-hive-border rounded-[10px] p-5">
        <h3 className="text-[12px] font-bold text-hive-gold mb-4 uppercase tracking-wider">Growth Milestones</h3>
        <div className="space-y-3">
          {milestones.map(m => (
            <div key={m.count} className="flex items-center gap-4">
              <div className={`w-[28px] h-[28px] rounded-full flex items-center justify-center text-[12px] shrink-0 ${m.achieved ? 'bg-hive-green text-hive-bg' : 'bg-hive-bg border border-hive-border text-hive-dim'}`}>
                {m.achieved ? '✓' : '○'}
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className={`text-[12px] font-semibold ${m.achieved ? 'text-hive-green' : 'text-hive-muted'}`}>{m.label}</span>
                  <span className={`text-[11px] font-mono ${m.achieved ? 'text-hive-green' : 'text-hive-dim'}`}>{m.count.toLocaleString()} bees</span>
                </div>
                {!m.achieved && beeCount > 0 && (
                  <div className="mt-1 h-[3px] bg-hive-bg rounded-full overflow-hidden">
                    <div
                      className="h-full bg-hive-gold/40 rounded-full"
                      style={{ width: `${Math.min(100, Math.round((beeCount / m.count) * 100))}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* What happens when first bee joins */}
      <div className="bg-hive-bg2 border border-hive-border rounded-[10px] p-5">
        <h3 className="text-[12px] font-bold text-hive-gold mb-3 uppercase tracking-wider">New Bee Welcome Flow</h3>
        <div className="space-y-2 text-[12px] text-hive-muted">
          {[
            'Stripe webhook fires → member record created',
            'Agent assigned a SOUL from BECOME pillar',
            'Welcome Workshop honeycomb auto-joined',
            '"What are you working on?" prompt sent',
            'First Flight training path unlocked',
            'Bee Keeper begins watching for activity',
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="text-hive-gold font-mono text-[11px] shrink-0">{i + 1}.</span>
              <span>{step}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
