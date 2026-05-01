#!/usr/bin/env -S npx ts-node
/**
 * scripts/scout-engagement-worker.ts
 *
 * Long-running TDC1272-side process that drives Scout-trial chamber engagement.
 *
 * Lifecycle:
 *   1. Start (via pm2 or systemd)
 *   2. Every POLL_INTERVAL_MS, fetch active Scouts and call processScout on each
 *   3. Log results to stdout (pm2 captures these)
 *   4. On SIGTERM or SIGINT, finish current cycle and exit cleanly
 *
 * Why this lives on TDC1272 instead of Vercel:
 *   The model router calls Ollama at localhost:11434 (qwen3-nothink). Vercel
 *   serverless functions can't reach localhost on a different machine. TDC1272
 *   has Ollama loaded and stays online, so the worker runs here.
 *
 * Required environment variables (load from .env or pm2 ecosystem config):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   OLLAMA_URL                  (default: http://localhost:11434)
 *   OLLAMA_MODEL                (default: qwen3-nothink:latest)
 *   ANTHROPIC_API_KEY           (only needed if any premium calls escape, defensive)
 *
 * Run with pm2:
 *   pm2 start scripts/scout-engagement-worker.ts \
 *     --name scout-engagement \
 *     --interpreter ts-node \
 *     --update-env
 *   pm2 logs scout-engagement
 *
 * Stop:
 *   pm2 stop scout-engagement
 *   pm2 delete scout-engagement
 */

import { createClient } from '@supabase/supabase-js';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load .env.local from the project root (script lives in scripts/, parent is repo root)
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

import {
  fetchActiveScouts,
  processScout,
  type ScoutProcessResult,
} from '../lib/scout-engagement-logic';

// ============================================================
// CONFIG
// ============================================================
const POLL_INTERVAL_MS = parseInt(process.env.SCOUT_POLL_INTERVAL_MS || '300000', 10); // 5 min default
const STARTUP_DELAY_MS = 3000;

// ============================================================
// VALIDATION
// ============================================================
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[fatal] missing required env var: ${name}`);
    console.error(
      '  expected to find it in .env.local at project root, ' +
      'or set explicitly via pm2 ecosystem config'
    );
    process.exit(1);
  }
  return value;
}

const SUPABASE_URL = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
const SUPABASE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================
// STATE
// ============================================================
let isShuttingDown = false;
let cycleInProgress = false;
let cycleCount = 0;

// ============================================================
// MAIN LOOP
// ============================================================
async function runOneCycle(): Promise<void> {
  cycleInProgress = true;
  cycleCount++;
  const cycleStartedAt = new Date();
  const cycleLabel = `[cycle ${cycleCount} @ ${cycleStartedAt.toISOString()}]`;

  try {
    const scouts = await fetchActiveScouts(supabase);

    if (scouts.length === 0) {
      console.log(`${cycleLabel} no active scouts in trial window`);
      cycleInProgress = false;
      return;
    }

    console.log(`${cycleLabel} found ${scouts.length} active scout(s) in trial window`);

    let engaged = 0;
    let skipped = 0;
    let errored = 0;

    for (const scout of scouts) {
      // Bail mid-cycle if shutdown requested
      if (isShuttingDown) {
        console.log(`${cycleLabel} shutdown requested mid-cycle, draining...`);
        break;
      }

      try {
        const result = await processScout(supabase, scout);
        if (result.action === 'engaged') {
          engaged++;
          console.log(
            `  ✓ ${scout.name}: ${result.coach} ${result.engagement_type} ` +
            `(cost $${(result.cost_usd || 0).toFixed(6)})`
          );
        } else {
          skipped++;
          // Only log skips when verbose; otherwise too noisy
          if (process.env.VERBOSE_SKIPS === '1') {
            console.log(`  - ${scout.name}: skipped (${result.reason})`);
          }
        }
      } catch (e: any) {
        errored++;
        console.error(`  ✗ ${scout.name}: error: ${e.message}`);
        // Don't rethrow — one Scout's failure shouldn't break the cycle
      }
    }

    console.log(
      `${cycleLabel} done — engaged: ${engaged}, skipped: ${skipped}, errored: ${errored}`
    );
  } catch (e: any) {
    console.error(`${cycleLabel} cycle-level error: ${e.message}`);
    console.error(e.stack);
  } finally {
    cycleInProgress = false;
  }
}

async function main(): Promise<void> {
  console.log('==========================================');
  console.log('  Scout Engagement Worker');
  console.log('==========================================');
  console.log(`  Supabase: ${SUPABASE_URL}`);
  console.log(`  Ollama:   ${process.env.OLLAMA_URL || 'http://localhost:11434'}`);
  console.log(`  Model:    ${process.env.OLLAMA_MODEL || 'qwen3-nothink:latest'}`);
  console.log(`  Poll:     every ${POLL_INTERVAL_MS / 1000}s`);
  console.log('==========================================');

  // Brief startup delay so logs are clean if pm2 is also booting
  await new Promise((r) => setTimeout(r, STARTUP_DELAY_MS));

  // First cycle immediately, then on interval
  await runOneCycle();

  const interval = setInterval(async () => {
    if (isShuttingDown) {
      clearInterval(interval);
      return;
    }
    if (cycleInProgress) {
      console.log(
        `[skip] previous cycle still in progress, deferring this tick`
      );
      return;
    }
    await runOneCycle();
  }, POLL_INTERVAL_MS);

  // Wait for shutdown
  await new Promise<void>((resolve) => {
    const checkShutdown = setInterval(() => {
      if (isShuttingDown && !cycleInProgress) {
        clearInterval(checkShutdown);
        clearInterval(interval);
        resolve();
      }
    }, 1000);
  });

  console.log('[shutdown] worker exited cleanly');
  process.exit(0);
}

// ============================================================
// SIGNAL HANDLING
// ============================================================
function handleShutdown(signal: string): void {
  console.log(`\n[shutdown] received ${signal}, draining current cycle...`);
  isShuttingDown = true;
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

// ============================================================
// LAUNCH
// ============================================================
main().catch((e) => {
  console.error('[fatal] uncaught error in main:', e);
  process.exit(1);
});
