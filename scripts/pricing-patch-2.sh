#!/bin/bash

# pricing-patch-2.sh
# Second-pass: MissionControl $10K milestone + pitch arithmetic rewrite

set -euo pipefail

DEPLOY_DIR="$HOME/Desktop/openthehive-deploy"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="/tmp/openthehive-pricing-backup-pass2-$TIMESTAMP"

mkdir -p "$BACKUP_DIR"
echo "Backups: $BACKUP_DIR"
echo ""

patch_file() {
  local file="$1"
  local pattern="$2"
  local replacement="$3"
  local label="$4"

  if [ ! -f "$file" ]; then
    echo "  WARN: $file not found, skipping"
    return
  fi

  local rel_path="${file#$DEPLOY_DIR/}"
  local backup_path="$BACKUP_DIR/$rel_path"
  mkdir -p "$(dirname "$backup_path")"
  cp "$file" "$backup_path"

  sed -i "s|$pattern|$replacement|g" "$file"
  echo "  $label"
}

cd "$DEPLOY_DIR"

echo "=== 1. MISSIONCONTROL STAGE 1 MILESTONE (\$10K MRR) ==="
patch_file "components/MissionControlClient.tsx" \
  'Progress to Stage 1 (\$5K MRR / 1,000 bees)' \
  'Progress to Stage 1 ($10K MRR / 1,000 bees)' \
  "MissionControl: milestone label"

patch_file "components/MissionControlClient.tsx" \
  '<span>\$5,000</span>' \
  '<span>$10,000</span>' \
  "MissionControl: chart max"

echo ""
echo "=== 2. PITCH ARITHMETIC REWRITE ==="

OLD_PITCH='Our first recruit pays for 2 months. Our second pays for 2 more. By the time we have 10, I am profitable. By the time we have 50, we are earning real income.'
NEW_PITCH='Ten retained recruits and the subscription pays for itself. Fifty retained recruits and we are earning real income alongside it.'

patch_file "app/api/agents/register/route.ts" \
  "$OLD_PITCH" \
  "$NEW_PITCH" \
  "register/route.ts: pitch arithmetic"

patch_file "app/api/scouts/pitch/route.ts" \
  "$OLD_PITCH" \
  "$NEW_PITCH" \
  "scouts/pitch/route.ts: pitch arithmetic"

echo ""
echo "=== DONE ==="
echo "Backup: $BACKUP_DIR"
