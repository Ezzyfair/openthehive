/**
 * lib/model-router.ts
 *
 * Routes LLM calls to one of three models based on complexity and budget:
 *   - Qwen 3 32B (qwen3-nothink) via local Ollama at localhost:11434 — free, default
 *   - Claude Haiku 4.5 — when complexity warrants and bee has budget
 *   - Claude Sonnet 4.5 — only for genuinely hard problems, always paid by bee
 *
 * Complexity scoring is heuristic. We don't try to be clever — we use a small
 * set of signals (length of bee's question, presence of code, multi-step
 * reasoning markers, technical depth signals).
 *
 * Token budget enforcement: each agent has monthly_premium_tokens_used and
 * monthly_premium_tokens_limit. When premium tokens (Haiku/Sonnet) would
 * exceed the limit, the router degrades to local Qwen with a footer noting
 * "This response was generated locally — premium responses require an upgrade
 * or token top-up."
 */

import Anthropic from '@anthropic-ai/sdk';
import { SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// CONFIG
// ============================================================
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3-nothink:latest';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const SONNET_MODEL = 'claude-sonnet-4-5-20250929';

// Pricing (per million tokens, USD) — used for cost tracking
const PRICING = {
  haiku:  { in: 0.25,  out: 1.25 },
  sonnet: { in: 3.00,  out: 15.00 },
  qwen:   { in: 0,     out: 0 }, // local, no per-token cost
};

// Complexity threshold: above this score, prefer Haiku
const COMPLEXITY_HAIKU_THRESHOLD = 3;
// Above this score, prefer Sonnet
const COMPLEXITY_SONNET_THRESHOLD = 7;

// ============================================================
// TYPES
// ============================================================
export type ModelChoice = 'qwen' | 'haiku' | 'sonnet';

export interface ModelRequest {
  prompt: string;
  system?: string;
  max_tokens?: number;
  agent_id?: string;          // for budget tracking
  bee_message?: string;       // the bee's text — used for complexity scoring
  override_model?: ModelChoice; // force a specific model
}

export interface ModelResponse {
  text: string;
  model_used: ModelChoice;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  degraded?: boolean;           // true if we wanted Haiku/Sonnet but fell back to Qwen
  degraded_reason?: string;
}

// ============================================================
// COMPLEXITY SCORING
// ============================================================
/**
 * Score 0-10:
 *   0-2: routine welcome, simple question, clear single-topic ask
 *   3-6: multi-step reasoning needed, technical question, requires synthesis
 *   7-10: architecture review, security analysis, code generation, deep research
 */
export function scoreComplexity(bee_message: string): number {
  if (!bee_message) return 0;

  let score = 0;
  const text = bee_message.toLowerCase();
  const words = text.split(/\s+/).length;

  // Length signal: longer questions tend to be more complex
  if (words > 50)  score += 1;
  if (words > 150) score += 2;
  if (words > 300) score += 1;

  // Code signal
  if (/```|\bfunction\b|\bclass\b|\bimport\b|\bSELECT\b|\bUPDATE\b/i.test(bee_message)) {
    score += 3;
  }

  // Multi-step reasoning markers
  if (/\bfirst,?\b.*\bthen,?\b/i.test(text)) score += 1;
  if (/\bhow do i\b.*\band then\b/i.test(text)) score += 1;
  if (/\bwhy does\b|\bwhat causes\b/i.test(text)) score += 1;

  // Technical depth signals
  const technical_keywords = ['architecture', 'security', 'vulnerability', 'algorithm', 'database', 'optimization', 'authentication', 'encryption', 'protocol'];
  for (const kw of technical_keywords) {
    if (text.includes(kw)) { score += 1; break; }
  }

  // Strategic depth signals
  const strategic_keywords = ['90 day', 'roadmap', 'go-to-market', 'pricing strategy', 'competitive', 'business model'];
  for (const kw of strategic_keywords) {
    if (text.includes(kw)) { score += 1; break; }
  }

  // Cap at 10
  return Math.min(score, 10);
}

// ============================================================
// MODEL CHOICE
// ============================================================
function chooseModel(complexity: number, override?: ModelChoice): ModelChoice {
  if (override) return override;
  if (complexity >= COMPLEXITY_SONNET_THRESHOLD) return 'sonnet';
  if (complexity >= COMPLEXITY_HAIKU_THRESHOLD)  return 'haiku';
  return 'qwen';
}

// ============================================================
// BUDGET CHECK
// ============================================================
async function canAffordPremium(
  supabase: SupabaseClient,
  agent_id: string,
  estimated_tokens: number
): Promise<{ allowed: boolean; reason?: string }> {
  // Reset monthly token counter if 30 days have passed
  await supabase.rpc('reset_premium_tokens_if_due', { p_agent_id: agent_id });

  const { data: agent } = await supabase
    .from('agents')
    .select('monthly_premium_tokens_used, monthly_premium_tokens_limit')
    .eq('id', agent_id)
    .single();

  if (!agent) {
    return { allowed: false, reason: 'Agent not found' };
  }

  const remaining = (agent.monthly_premium_tokens_limit || 0) - (agent.monthly_premium_tokens_used || 0);
  if (remaining < estimated_tokens) {
    return {
      allowed: false,
      reason: `Monthly premium-token budget exhausted (${agent.monthly_premium_tokens_used}/${agent.monthly_premium_tokens_limit} used)`,
    };
  }
  return { allowed: true };
}

async function recordPremiumUsage(
  supabase: SupabaseClient,
  agent_id: string,
  tokens_used: number
): Promise<void> {
  await supabase
    .from('agents')
    .update({
      monthly_premium_tokens_used: tokens_used > 0
        ? (await supabase.from('agents').select('monthly_premium_tokens_used').eq('id', agent_id).single()).data?.monthly_premium_tokens_used + tokens_used
        : 0,
    })
    .eq('id', agent_id);
}

// ============================================================
// MODEL CLIENTS
// ============================================================

/** Local Qwen via Ollama */
async function callQwen(req: ModelRequest): Promise<ModelResponse> {
  const ollamaPrompt = req.system
    ? `${req.system}\n\nUser: ${req.prompt}\n\nAssistant:`
    : req.prompt;

  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt: ollamaPrompt,
      stream: false,
      options: {
        num_predict: req.max_tokens || 800,
        temperature: 0.7,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama call failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json() as any;
  return {
    text: data.response || '',
    model_used: 'qwen',
    tokens_in: data.prompt_eval_count || 0,
    tokens_out: data.eval_count || 0,
    cost_usd: 0,
  };
}

/** Anthropic Haiku */
async function callHaiku(req: ModelRequest): Promise<ModelResponse> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: req.max_tokens || 800,
    system: req.system,
    messages: [{ role: 'user', content: req.prompt }],
  });

  const text = res.content
    .filter(b => b.type === 'text')
    .map(b => (b as any).text)
    .join('');

  const tokens_in = res.usage.input_tokens;
  const tokens_out = res.usage.output_tokens;
  const cost_usd = (tokens_in * PRICING.haiku.in + tokens_out * PRICING.haiku.out) / 1_000_000;

  return { text, model_used: 'haiku', tokens_in, tokens_out, cost_usd };
}

/** Anthropic Sonnet */
async function callSonnet(req: ModelRequest): Promise<ModelResponse> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model: SONNET_MODEL,
    max_tokens: req.max_tokens || 1500,
    system: req.system,
    messages: [{ role: 'user', content: req.prompt }],
  });

  const text = res.content
    .filter(b => b.type === 'text')
    .map(b => (b as any).text)
    .join('');

  const tokens_in = res.usage.input_tokens;
  const tokens_out = res.usage.output_tokens;
  const cost_usd = (tokens_in * PRICING.sonnet.in + tokens_out * PRICING.sonnet.out) / 1_000_000;

  return { text, model_used: 'sonnet', tokens_in, tokens_out, cost_usd };
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================
/**
 * Route an LLM request to the appropriate model.
 * If a premium model (Haiku/Sonnet) is selected but the agent's budget
 * can't afford it, gracefully degrade to Qwen with an explanatory note.
 */
export async function routeLLMCall(
  supabase: SupabaseClient | null,
  req: ModelRequest
): Promise<ModelResponse> {
  const complexity = scoreComplexity(req.bee_message || req.prompt);
  let chosen = chooseModel(complexity, req.override_model);

  // Budget check if premium and we have an agent_id and supabase
  if ((chosen === 'haiku' || chosen === 'sonnet') && supabase && req.agent_id) {
    const estimated = (req.max_tokens || 800) + 500; // assume ~500 input tokens
    const budget = await canAffordPremium(supabase, req.agent_id, estimated);
    if (!budget.allowed) {
      // Degrade to Qwen, add explanatory footer
      const qwenResult = await callQwen(req);
      return {
        ...qwenResult,
        text: qwenResult.text + '\n\n_(Note: this response was generated by the colony\'s local model. Premium responses require an upgrade or token top-up. Reason: ' + budget.reason + ')_',
        degraded: true,
        degraded_reason: budget.reason,
      };
    }
  }

  // Execute the chosen model
  let result: ModelResponse;
  try {
    if (chosen === 'sonnet') {
      result = await callSonnet(req);
    } else if (chosen === 'haiku') {
      result = await callHaiku(req);
    } else {
      result = await callQwen(req);
    }
  } catch (e: any) {
    // If a premium call fails, fall back to Qwen rather than failing the user
    if (chosen !== 'qwen') {
      const qwenResult = await callQwen(req);
      return {
        ...qwenResult,
        degraded: true,
        degraded_reason: `Premium model ${chosen} failed: ${e.message}`,
      };
    }
    throw e;
  }

  // Record premium usage
  if ((result.model_used === 'haiku' || result.model_used === 'sonnet') && supabase && req.agent_id) {
    const totalTokens = result.tokens_in + result.tokens_out;
    await recordPremiumUsage(supabase, req.agent_id, totalTokens);
  }

  return result;
}
