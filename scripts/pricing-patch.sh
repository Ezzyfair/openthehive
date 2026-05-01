#!/bin/bash

# pricing-patch.sh
# Patches all $5/$49/$149 references in the openthehive-deploy codebase to the new tier pricing:
#   Worker Bee:     $5/month  -> $10/month
#   Honey Maker:    $49/year  -> $79/year
#   Queen's Council: $149     -> $249
#
# Cascade math automatically updates because SUBSCRIPTION_AMOUNT in route.ts changes from 5.00 to 10.00.
# MIN_PAYOUT_USD intentionally stays at $5 (payout floor unchanged; only subscription amount changes).
#
# Every modified file is backed up to /tmp/openthehive-pricing-backup-<timestamp>/ before edit.
# The script is idempotent — re-running on already-patched files is a no-op (sed only replaces matches).
#
# Authored: Session 4, April 26, 2026

set -euo pipefail

DEPLOY_DIR="$HOME/Desktop/openthehive-deploy"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="/tmp/openthehive-pricing-backup-$TIMESTAMP"

if [ ! -d "$DEPLOY_DIR" ]; then
  echo "ERROR: $DEPLOY_DIR not found"
  exit 1
fi

mkdir -p "$BACKUP_DIR"
echo "Backups will be saved to: $BACKUP_DIR"
echo ""

# Helper: backup then sed-in-place
patch_file() {
  local file="$1"
  local pattern="$2"
  local replacement="$3"
  local label="$4"

  if [ ! -f "$file" ]; then
    echo "  WARN: $file not found, skipping"
    return
  fi

  # Backup (preserve directory structure under BACKUP_DIR)
  local rel_path="${file#$DEPLOY_DIR/}"
  local backup_path="$BACKUP_DIR/$rel_path"
  mkdir -p "$(dirname "$backup_path")"
  cp "$file" "$backup_path"

  # Apply
  sed -i "s|$pattern|$replacement|g" "$file"
  echo "  $label"
}

cd "$DEPLOY_DIR"

echo "=== 1. CASCADE MATH (the only structurally important change) ==="
patch_file "app/api/referrals/chain/route.ts" \
  'const SUBSCRIPTION_AMOUNT = 5\.00; // \$5/month Worker Bee' \
  'const SUBSCRIPTION_AMOUNT = 10.00; // $10/month Worker Bee' \
  "route.ts: SUBSCRIPTION_AMOUNT 5.00 -> 10.00"

# The $5 in "500 pollen = $5" comment in same file refers to a Pollen-conversion idea
# that's deprecated by V4 §2.3 (Pollen has no cash equivalent). Comment is stale but
# the line itself does pollenEarned = round(earned * 100) which is just Pollen-per-cent
# bookkeeping — not a Pollen-to-cash exchange. Leaving the math, killing the misleading comment.
patch_file "app/api/referrals/chain/route.ts" \
  '// Add pollen to the earning agent (500 pollen = \$5)' \
  '// Add Pollen to the earning agent (1 Pollen per cent earned, recognition only — not redeemable)' \
  "route.ts: clarify Pollen-comment per V4 §2.3"

echo ""
echo "=== 2. REFERRAL ENGINE COMMENTS (lib) ==="
# These are calculation example comments — purely documentation, but at $10 the example math changes.
patch_file "lib/referral-engine.ts" \
  '// On a \$5 sub with only direct referral: \$0\.50 to agent, \$4\.50 to hive' \
  '// On a $10 sub with only direct referral: $1.00 to agent, $9.00 to hive' \
  "referral-engine.ts: example math comment"

patch_file "lib/referral-engine.ts" \
  'subscriptionAmount: number, // e\.g\., 5\.00' \
  'subscriptionAmount: number, // e.g., 10.00' \
  "referral-engine.ts: type-hint example value"

echo ""
echo "=== 3. REGISTRATION & SCOUT PITCH COPY ==="
# The $5 references in agent-facing pitch copy — these are persuasive marketing strings shown to
# prospective bees, so they need to match real pricing. Multiple references per file.

patch_file "app/api/agents/register/route.ts" \
  '\$5/month' \
  '$10/month' \
  "register/route.ts: \$5/month -> \$10/month"

patch_file "app/api/agents/register/route.ts" \
  '\$5 per month' \
  '$10 per month' \
  "register/route.ts: \$5 per month -> \$10 per month"

patch_file "app/api/agents/register/route.ts" \
  'Invest \$5 in me' \
  'Invest $10 in me' \
  "register/route.ts: pitch text"

patch_file "app/api/agents/register/route.ts" \
  '\$5 invested' \
  '$10 invested' \
  "register/route.ts: pitch text"

patch_file "app/api/agents/register/route.ts" \
  '\$5 monthly' \
  '$10 monthly' \
  "register/route.ts: pitch text"

# Same surgery on scouts/pitch (it's a copy of the same pitch language)
patch_file "app/api/scouts/pitch/route.ts" \
  '\$5/month' \
  '$10/month' \
  "scouts/pitch: \$5/month -> \$10/month"

patch_file "app/api/scouts/pitch/route.ts" \
  '\$5 per month' \
  '$10 per month' \
  "scouts/pitch: \$5 per month -> \$10 per month"

patch_file "app/api/scouts/pitch/route.ts" \
  'Invest \$5 in me' \
  'Invest $10 in me' \
  "scouts/pitch: pitch text"

patch_file "app/api/scouts/pitch/route.ts" \
  '\$5 invested' \
  '$10 invested' \
  "scouts/pitch: pitch text"

patch_file "app/api/scouts/pitch/route.ts" \
  '\$5 monthly' \
  '$10 monthly' \
  "scouts/pitch: pitch text"

echo ""
echo "=== 4. WEBSITE COPY (homepage, first-flight, training, join, pricing, components) ==="

# Homepage: "It pays its own $5"
patch_file "app/page.tsx" \
  'It pays its own \$5' \
  'It pays its own $10' \
  "page.tsx: 'pays its own \$5' -> '\$10'"

# First-flight CTA
patch_file "app/first-flight/page.tsx" \
  'Join The Hive — \$5/month' \
  'Join The Hive — $10/month' \
  "first-flight: CTA"

# Join page T&C clause 5
patch_file "app/join/page.tsx" \
  '\$5/month Worker Bee' \
  '$10/month Worker Bee' \
  "join: T&C clause 5"

# Join page CTA — three pieces (honey/queens/default)
patch_file "app/join/page.tsx" \
  'Unlock Honey Maker — \$49/year →' \
  'Unlock Honey Maker — $79/year →' \
  "join: Honey Maker CTA"

patch_file "app/join/page.tsx" \
  "Claim Your Throne — \$149 →" \
  "Claim Your Throne — \$249 →" \
  "join: Queen's Council CTA"

patch_file "app/join/page.tsx" \
  'Unlock Full Membership — \$5/month →' \
  'Unlock Full Membership — $10/month →' \
  "join: Worker CTA"

# Training page CTA
patch_file "app/training/page.tsx" \
  'Join The Hive — \$5/month' \
  'Join The Hive — $10/month' \
  "training: CTA"

# Pricing page — three tiers, each has multiple lines
# Tier 1: Worker Bee  $5 -> $10
patch_file "app/pricing/page.tsx" \
  "price: '\\\$5'" \
  "price: '\$10'" \
  "pricing: Worker price field"

patch_file "app/pricing/page.tsx" \
  "cta: 'Join for \\\$5/month'" \
  "cta: 'Join for \$10/month'" \
  "pricing: Worker CTA"

# Tier 2: Honey Maker $49 -> $79
patch_file "app/pricing/page.tsx" \
  "price: '\\\$49'" \
  "price: '\$79'" \
  "pricing: Honey Maker price field"

patch_file "app/pricing/page.tsx" \
  "cta: 'Join for \\\$49/year'" \
  "cta: 'Join for \$79/year'" \
  "pricing: Honey Maker CTA"

# Tier 3: Queen's Council $149 -> $249
patch_file "app/pricing/page.tsx" \
  "price: '\\\$149'" \
  "price: '\$249'" \
  "pricing: Queen's Council price field"

# LiveHivePulse component
patch_file "components/LiveHivePulse.tsx" \
  'Join the Colony — \$5/month' \
  'Join the Colony — $10/month' \
  "LiveHivePulse: CTA"

# MissionControlClient component (internal dashboard)
patch_file "components/MissionControlClient.tsx" \
  'bees × \$5' \
  'bees × $10' \
  "MissionControl: bees × \$5 calculation"

patch_file "components/MissionControlClient.tsx" \
  "price: '\\\$5/mo', status: 'Ready'" \
  "price: '\$10/mo', status: 'Ready'" \
  "MissionControl: Worker tier card"

patch_file "components/MissionControlClient.tsx" \
  "price: '\\\$50/yr', status: 'Ready'" \
  "price: '\$79/yr', status: 'Ready'" \
  "MissionControl: Annual tier card"

# Note: MissionControl line 365 reference to '$5K MRR / 1,000 bees' — that's a milestone
# threshold ($5,000 in monthly recurring revenue, 1,000 bees), NOT a price. Leaving it alone.
# At new pricing 1,000 bees × $10 = $10K MRR, which means the milestone shifts from
# Stage 1 = $5K to Stage 1 = $10K. That's a strategy decision, not a copy fix.
# Flagging in the post-run summary so you can decide.

echo ""
echo "=== DONE ==="
echo ""
echo "Backup directory: $BACKUP_DIR"
echo ""
echo "Verify with:"
echo "  grep -rn '\$5\|\$49\|\$149' $DEPLOY_DIR/app $DEPLOY_DIR/components $DEPLOY_DIR/lib 2>/dev/null | grep -v node_modules | grep -v '.next' | grep -v test"
echo ""
echo "Should return:"
echo "  - app/api/referrals/route.ts:45  minimum_payout: '\$5.00'   <-- INTENTIONAL (payout floor)"
echo "  - app/api/payouts/route.ts       MIN_PAYOUT_USD = 5.00      <-- INTENTIONAL (payout floor)"
echo "  - components/MissionControlClient.tsx:365  '\$5K MRR'       <-- DECIDE (milestone, not price)"
echo "  - any reference to historical events / colony states unrelated to pricing"
echo ""
echo "STILL TO DO MANUALLY:"
echo "  1. Stripe Dashboard:"
echo "     - Worker Bee: update existing recurring product to \$10/month USD"
echo "     - Honey Maker: update existing yearly product to \$79/year USD"
echo "     - Queen's Council: update existing one-time product to \$249 USD"
echo "  2. Verify .env.local STRIPE_*_PRICE_ID values still point to the now-updated products"
echo "     (they should — you're editing the products, not creating new ones)"
echo "  3. Run skill backfill after making-honey is in place to push patched skill to DB"
