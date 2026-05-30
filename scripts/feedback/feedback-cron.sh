#!/usr/bin/env bash
# Feedback widget Phase 2 — cron wrapper. Runs every 15 min via launchd.
#
# For each open `gc-feedback` issue:
#   - Untriaged → run `/triage-feedback <N> auto-post` in a fresh worktree
#   - Triaged AND eligible (effort-trivial|small without gates, OR any effort with approved)
#     AND no linked PR → run `/implement-feedback <N>` in a fresh worktree
#   - Else skip
#
# Hard cost cap: check daily_cost table before each dispatch. If today's spend
# >= DAILY_COST_CAP_USD * 10000 (1/100-cent units), log and stop the run.
#
# Logs to ~/.local/state/gc-curriculum-tool/feedback-cron.log

set -uo pipefail

REPO_DIR="/Users/admin/projects/curriculum_developer"
LOG_DIR="$HOME/.local/state/gc-curriculum-tool"
LOG_FILE="$LOG_DIR/feedback-cron.log"
REPO="chiptoe-svg/gc-curriculum-tool"

mkdir -p "$LOG_DIR"
exec >> "$LOG_FILE" 2>&1
echo "--- $(date -u +%Y-%m-%dT%H:%M:%SZ) feedback-cron start ---"

cd "$REPO_DIR" || { echo "cd $REPO_DIR failed"; exit 1; }

# Load DAILY_COST_CAP_USD from .env.local (defaults to 10 if absent).
DAILY_CAP_USD=$(grep '^DAILY_COST_CAP_USD' .env.local 2>/dev/null | cut -d= -f2- | awk '{print $1}')
DAILY_CAP_USD=${DAILY_CAP_USD:-10}
DAILY_CAP_HUNDREDTHS=$(( DAILY_CAP_USD * 10000 ))

check_budget() {
  local spent
  spent=$(pnpm exec tsx --env-file=.env.local scripts/feedback/daily-cost-check.ts 2>/dev/null)
  spent=${spent:-0}
  if (( spent >= DAILY_CAP_HUNDREDTHS )); then
    echo "cost-capped: today's spend ${spent} >= cap ${DAILY_CAP_HUNDREDTHS} (1/100¢)"
    return 1
  fi
  return 0
}

dispatch_triage() {
  local issue_num="$1"
  if ! check_budget; then exit 0; fi
  local wt=".worktrees/triage-$issue_num"
  git worktree remove --force "$wt" 2>/dev/null || true
  git worktree add --detach "$wt" main || { echo "worktree add failed for triage-$issue_num"; return 1; }
  echo "→ triage #$issue_num"
  ( cd "$wt" && claude -p "/triage-feedback $issue_num auto-post" --permission-mode acceptEdits ) || \
    echo "claude triage of #$issue_num exited non-zero"
  git worktree remove --force "$wt" 2>/dev/null || true
}

dispatch_implement() {
  local issue_num="$1"
  if ! check_budget; then exit 0; fi
  local wt=".worktrees/implement-$issue_num"
  git worktree remove --force "$wt" 2>/dev/null || true
  git worktree add --detach "$wt" main || { echo "worktree add failed for implement-$issue_num"; return 1; }
  echo "→ implement #$issue_num"
  ( cd "$wt" && claude -p "/implement-feedback $issue_num" --permission-mode acceptEdits ) || \
    echo "claude implement of #$issue_num exited non-zero"
  git worktree remove --force "$wt" 2>/dev/null || true
}

# Eligibility check for implement mode. Pure label arithmetic.
should_implement() {
  local labels="$1"   # comma-separated list of label names
  local has_triaged has_trivial has_small has_gate has_approved
  has_triaged=$(echo "$labels" | tr ',' '\n' | grep -cx 'triaged' || true)
  has_trivial=$(echo "$labels" | tr ',' '\n' | grep -cx 'effort-trivial' || true)
  has_small=$(echo "$labels" | tr ',' '\n' | grep -cx 'effort-small' || true)
  has_gate=$(echo "$labels" | tr ',' '\n' | grep -c '^gate-' || true)
  has_approved=$(echo "$labels" | tr ',' '\n' | grep -cx 'approved' || true)

  if (( has_triaged == 0 )); then echo "no"; return; fi
  if (( has_approved == 1 )); then echo "yes"; return; fi
  if (( has_gate >= 1 )); then echo "no"; return; fi
  if (( has_trivial + has_small >= 1 )); then echo "yes"; return; fi
  echo "no"
}

# Iterate open gc-feedback issues.
issues_json=$(gh issue list --repo "$REPO" --label gc-feedback --state open \
  --json number,labels --limit 50 2>/dev/null || echo '[]')

count=$(echo "$issues_json" | jq 'length')
echo "open gc-feedback issues: $count"

# Guard against macOS BSD seq's `seq 0 -1` emitting "0\n-1" instead of empty.
if (( count == 0 )); then
  echo "--- $(date -u +%Y-%m-%dT%H:%M:%SZ) feedback-cron end ---"
  exit 0
fi

for i in $(seq 0 $((count - 1))); do
  num=$(echo "$issues_json" | jq -r ".[$i].number")
  labels=$(echo "$issues_json" | jq -r ".[$i].labels | map(.name) | join(\",\")")
  has_triaged=$(echo "$labels" | tr ',' '\n' | grep -cx 'triaged' || true)

  # Skip if a PR already references this issue (search by Fixes #N keyword).
  pr_count=$(gh pr list --repo "$REPO" --search "fixes:#$num" --state all --json number 2>/dev/null | jq 'length')
  if (( pr_count > 0 )); then
    echo "#$num skip: PR exists"
    continue
  fi

  if (( has_triaged == 0 )); then
    dispatch_triage "$num"
  else
    if [[ $(should_implement "$labels") == "yes" ]]; then
      dispatch_implement "$num"
    else
      echo "#$num skip: triaged but ineligible (labels: $labels)"
    fi
  fi
done

echo "--- $(date -u +%Y-%m-%dT%H:%M:%SZ) feedback-cron end ---"
