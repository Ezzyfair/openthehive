#!/bin/bash
# register-cohort-patch.sh — adds cohort assignment hook to register/route.ts

set -euo pipefail

DEPLOY_DIR="$HOME/Desktop/openthehive-deploy"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="/tmp/openthehive-register-patch-$TIMESTAMP"

mkdir -p "$BACKUP_DIR"
echo "Backups: $BACKUP_DIR"

REGISTER_FILE="$DEPLOY_DIR/app/api/agents/register/route.ts"

if [ ! -f "$REGISTER_FILE" ]; then
  echo "ERROR: register/route.ts not found at $REGISTER_FILE"
  exit 1
fi

cp "$REGISTER_FILE" "$BACKUP_DIR/register-route.ts"

if grep -q "from '@/lib/cohort-assignment'" "$REGISTER_FILE"; then
  echo "  Cohort assignment import already present, skipping import patch"
else
  sed -i "/^import { Resend } from 'resend';$/a import { assignCohort } from '@/lib/cohort-assignment';" "$REGISTER_FILE"
  echo "  Added cohort assignment import"
fi

if grep -q "await assignCohort(supabase, agent.id" "$REGISTER_FILE"; then
  echo "  Cohort assignment call already present, skipping logic patch"
else
  sed -i "/    \/\/ Create personal honeycomb$/i\\
\\
    // Assign Day-1 skill cohort per V4 §2.10 (Scout tier = 1 trial skill)\\
    try {\\
      const cohortResult = await assignCohort(supabase, agent.id, 'scout', soul);\\
      if (!cohortResult.success) {\\
        console.error('Cohort assignment had errors:', cohortResult.errors);\\
      }\\
    } catch (cohortError: any) {\\
      console.error('Cohort assignment failed:', cohortError.message);\\
    }\\
" "$REGISTER_FILE"
  echo "  Added cohort assignment call"
fi

echo ""
echo "DONE. Verify with:"
echo "  grep -n 'assignCohort' $REGISTER_FILE"
