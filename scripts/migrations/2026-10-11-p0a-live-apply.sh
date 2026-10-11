#!/usr/bin/env bash
# 2026-10-11-p0a-live-apply.sh <deploy_sha> {apply|rollback}
#
# OWNER-RUN. Live-apply runbook for migration 0056 (I-1, adversarial review
# 2026-10-11) — supersedes plan Task 10 Steps 1-4 (see STATE.md
# Deferred/debt). Builds the new code while the OLD app still serves, THEN
# stops the watchdog and the app, THEN applies (or rolls back) against the
# LIVE gc_curriculum database through p0a-apply-db.sh, and only restarts the
# app on success. On any DB failure the app and watchdog stay stopped — the
# migration is one transaction, so the database is unchanged; the owner
# decides when and how to restart.
#
# This script does NOT merge, fetch, or push, and never echoes
# DATABASE_URL. The owner checks out/merges the deploy commit beforehand;
# this script only verifies the deploy checkout is clean and at the
# expected 40-character commit SHA (a short/abbreviated SHA is refused).
set -euo pipefail

DEPLOY_SHA="${1:-}"
MODE="${2:-}"
DEPLOY_DIR=/Users/admin/projects/curriculum_developer-deploy
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPLY_DB_SH="$SCRIPT_DIR/p0a-apply-db.sh"
BACKUP_DIR="$HOME/.local/share/gc-curriculum-tool/p0a"
PLIST_APP="$HOME/Library/LaunchAgents/com.gc.curriculum-tool.plist"
PLIST_WATCHDOG="$HOME/Library/LaunchAgents/com.gc.dev-watchdog.plist"
UID_NUM="$(id -u)"

if [[ ! "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "usage: $0 <40-char-deploy-sha> {apply|rollback}" >&2
  echo "got sha: '$DEPLOY_SHA' — must be a full 40-character lowercase hex git SHA, not an abbreviation" >&2
  exit 2
fi
case "$MODE" in
  apply|rollback) ;;
  *) echo "usage: $0 <40-char-deploy-sha> {apply|rollback}" >&2; exit 2 ;;
esac

echo "=== (a) verify the deploy checkout, then build the new code while the OLD app still serves ==="
if [ -n "$(git -C "$DEPLOY_DIR" status --porcelain)" ]; then
  echo "refusing: $DEPLOY_DIR is not clean; nothing stopped, nothing touched" >&2
  exit 1
fi
ACTUAL_SHA="$(git -C "$DEPLOY_DIR" rev-parse HEAD)"
if [ "$ACTUAL_SHA" != "$DEPLOY_SHA" ]; then
  echo "refusing: $DEPLOY_DIR is at $ACTUAL_SHA, expected $DEPLOY_SHA; nothing stopped, nothing touched" >&2
  echo "(check out/merge the deploy commit yourself first — this script does not merge, fetch, or push)" >&2
  exit 1
fi
(cd "$DEPLOY_DIR" && pnpm build)
echo "build OK at $DEPLOY_SHA"

echo "=== (b) stop the watchdog, then the app; wait for :3000 to close ==="
launchctl bootout "gui/$UID_NUM/com.gc.dev-watchdog" 2>/dev/null || true
launchctl bootout "gui/$UID_NUM/com.gc.curriculum-tool" 2>/dev/null || true
WAITED=0
while lsof -iTCP:3000 -sTCP:LISTEN -t >/dev/null 2>&1; do
  sleep 1
  WAITED=$((WAITED + 1))
  if [ "$WAITED" -ge 30 ]; then
    echo "refusing: something is still listening on :3000 after 30s; the database was NOT touched" >&2
    exit 1
  fi
done
echo "confirmed: nothing listens on :3000"

echo "=== (c) $MODE against the LIVE database ==="
DATABASE_URL="$(node "$HOME/.claude/dashboard/read-env.mjs" "$DEPLOY_DIR" DATABASE_URL)"
if "$APPLY_DB_SH" gc_curriculum "$DATABASE_URL" "$BACKUP_DIR" "$MODE"; then
  echo "=== (e) DB $MODE succeeded — restarting the app, then the watchdog ==="
  launchctl bootstrap "gui/$UID_NUM" "$PLIST_APP"
  WAITED=0
  while ! lsof -iTCP:3000 -sTCP:LISTEN -t >/dev/null 2>&1; do
    sleep 1
    WAITED=$((WAITED + 1))
    if [ "$WAITED" -ge 30 ]; then
      echo "WARNING: the app did not start listening on :3000 within 30s of bootstrap — check /Users/admin/.local/state/gc-curriculum-tool/next.log; the watchdog has NOT been started" >&2
      exit 1
    fi
  done
  launchctl bootstrap "gui/$UID_NUM" "$PLIST_WATCHDOG"
  cat <<'SMOKE'

DB applied. App and watchdog restarted. Smoke test (plan Task 10 Step 3) at
https://gcworkflow.clemson.edu:8443:
  - /program — each target tab
  - a course page's prerequisite panel
  - /wiki — a target page and a competency page
  - /explore — one course
SMOKE
  exit 0
else
  STATUS=$?
  cat <<EOF >&2

DB $MODE FAILED (exit $STATUS). The app and the watchdog are STOPPED. The
database was left AS-IS — 0056 and its rollback each run as one
transaction, so a failure here changed nothing in the database. Nothing
was restarted automatically. Restart only once you understand why this
failed:
  launchctl bootstrap gui/$UID_NUM $PLIST_APP
  launchctl bootstrap gui/$UID_NUM $PLIST_WATCHDOG
EOF
  exit "$STATUS"
fi
