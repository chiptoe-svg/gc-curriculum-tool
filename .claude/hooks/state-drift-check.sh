#!/usr/bin/env bash
# Stop-hook: warn when tracked-surface files have been committed since
# docs/STATE.md's "Last verified" SHA without STATE.md itself being updated.
#
# Emits a JSON {"systemMessage": "..."} when drift is detected; silent otherwise.
# Triggered by .claude/settings.json hooks.Stop entry. Read by both the user
# (in the terminal) and the model (as a system reminder on the next turn).
#
# The tracked-surface list mirrors docs/STATE.md "What this file tracks"
# (routes, schema, AI function IDs, env vars, deployment surface, plan/spec
# status). Keep them in sync if STATE.md's list changes.

set -u

cd_to_repo_root() {
  local root
  root=$(git rev-parse --show-toplevel 2>/dev/null) || return 1
  cd "$root" || return 1
}

cd_to_repo_root || exit 0  # not in a git repo — nothing to check

STATE_FILE="docs/STATE.md"
[ -f "$STATE_FILE" ] || exit 0

# Extract "Last verified" SHA. Line format:
#   > **Last verified:** `<hash>` · <date>
SHA=$(grep -m1 -E 'Last verified' "$STATE_FILE" \
  | sed -nE 's/.*`([a-f0-9]{7,40})`.*/\1/p')
[ -n "$SHA" ] || exit 0

# Skip silently when the SHA can't be resolved (rewritten history, fresh clone, etc.)
git rev-parse "$SHA" >/dev/null 2>&1 || exit 0

CHANGED=$(git log "${SHA}..HEAD" --name-only --pretty=format: 2>/dev/null \
  | sort -u | grep -v '^$' || true)
[ -n "$CHANGED" ] || exit 0

# Tracked surfaces per docs/STATE.md "What this file tracks".
TRACKED=$(echo "$CHANGED" | grep -E \
  -e '^app/.+/page\.tsx$' \
  -e '^app/api/.+/route\.ts$' \
  -e '^lib/db/schema\.ts$' \
  -e '^drizzle/' \
  -e '^lib/ai/function-settings\.ts$' \
  -e '^\.env\.example$' \
  -e '^docs/superpowers/(plans|specs)/' \
  -e '^middleware\.ts$' \
  || true)
[ -n "$TRACKED" ] || exit 0

# If STATE.md was updated in this range, the developer already reflected the change.
if echo "$CHANGED" | grep -qx "$STATE_FILE"; then
  exit 0
fi

COUNT=$(echo "$TRACKED" | wc -l | tr -d ' ')
LIST=$(echo "$TRACKED" | head -8 | sed 's/^/  • /')
MORE=""
[ "$COUNT" -gt 8 ] && MORE=$'\n  • …'

MSG="STATE.md drift: ${COUNT} tracked-surface file(s) committed since \`${SHA}\` without STATE.md update.
${LIST}${MORE}

Run /refresh-state, or update docs/STATE.md and bump the 'Last verified' SHA."

jq -n --arg msg "$MSG" '{systemMessage: $msg}'
