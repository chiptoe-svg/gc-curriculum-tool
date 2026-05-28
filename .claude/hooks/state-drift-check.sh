#!/usr/bin/env bash
# Stop-hook: warn when tracked-surface files have been committed since
# docs/STATE.md's "Last verified" SHA without STATE.md being updated in the
# SAME commit. Per-commit pairing — not range-pairing — so a STATE.md tweak
# in commit A doesn't silently absolve a tracked-surface change in commit B.
#
# Emits a JSON {"systemMessage": "..."} when drift is detected; silent otherwise.
# Triggered by .claude/settings.json hooks.Stop entry. Read by both the user
# (in the terminal) and the model (as a system reminder on the next turn).
#
# The tracked-surface list mirrors docs/STATE.md "What this file tracks"
# (routes, schema, AI function IDs, env vars, deployment surface, plan/spec
# status). Keep them in sync if STATE.md's list changes.

set -u

STATE_FILE="docs/STATE.md"
# Patterns for the tracked-surface check. Keep in sync with docs/STATE.md
# "What this file tracks". Used as one extended-grep expression.
TRACKED_PATTERNS='^app/.+/page\.tsx$|^app/api/.+/route\.ts$|^lib/db/schema\.ts$|^drizzle/|^lib/ai/function-settings\.ts$|^\.env\.example$|^docs/superpowers/(plans|specs)/|^middleware\.ts$'

cd_to_repo_root() {
  local root
  root=$(git rev-parse --show-toplevel 2>/dev/null) || return 1
  cd "$root" || return 1
}

cd_to_repo_root || exit 0  # not in a git repo — nothing to check
[ -f "$STATE_FILE" ] || exit 0

# Extract "Last verified" SHA. Line format:
#   > **Last verified:** `<hash>` · <date>
SHA=$(grep -m1 -E 'Last verified' "$STATE_FILE" \
  | sed -nE 's/.*`([a-f0-9]{7,40})`.*/\1/p')
[ -n "$SHA" ] || exit 0

# Skip silently when the SHA can't be resolved (rewritten history, fresh clone, etc.)
git rev-parse "$SHA" >/dev/null 2>&1 || exit 0

# Walk each commit in SHA..HEAD individually. Per-commit pairing — a commit
# that touches a tracked surface must also touch STATE.md in the same commit
# to clear the drift check. A STATE.md tweak in a different commit doesn't
# absolve a separate tracked-surface change.
DRIFT_LINES=""
DRIFT_COMMITS=0
for commit in $(git rev-list --reverse "${SHA}..HEAD" 2>/dev/null); do
  # Skip merge commits — their tracked-surface diff is the union of the
  # merged commits, all of which were already checked individually.
  [ "$(git rev-list --parents -n 1 "$commit" | wc -w)" -gt 2 ] && continue

  files=$(git show --name-only --pretty=format: "$commit" 2>/dev/null | grep -v '^$' || true)
  [ -z "$files" ] && continue

  tracked=$(echo "$files" | grep -E "$TRACKED_PATTERNS" || true)
  [ -z "$tracked" ] && continue

  # State.md updated in THIS commit? Then it's paired — no drift.
  echo "$files" | grep -qx "$STATE_FILE" && continue

  subject=$(git log -1 --format='%h %s' "$commit")
  while IFS= read -r f; do
    DRIFT_LINES="${DRIFT_LINES}  • ${f}  (${subject})"$'\n'
  done <<< "$tracked"
  DRIFT_COMMITS=$((DRIFT_COMMITS + 1))
done

[ "$DRIFT_COMMITS" -eq 0 ] && exit 0

# Cap output so a long unaddressed history doesn't flood the reminder.
LINE_COUNT=$(printf '%s' "$DRIFT_LINES" | grep -c '^' || true)
DISPLAYED=$(printf '%s' "$DRIFT_LINES" | head -12)
MORE=""
[ "$LINE_COUNT" -gt 12 ] && MORE=$'\n  • … '"$((LINE_COUNT - 12))"' more'

MSG="STATE.md drift: ${DRIFT_COMMITS} commit(s) since \`${SHA}\` touched tracked-surface files without updating STATE.md in the same commit.
${DISPLAYED}${MORE}
Update docs/STATE.md (and bump 'Last verified' to the new HEAD) or run /refresh-state."

jq -n --arg msg "$MSG" '{systemMessage: $msg}'
