#!/usr/bin/env bash
# 2026-10-11-p0a-live-apply.sh <deploy_sha> {apply|rollback} [<previous_sha>]
#
# OWNER-RUN. Live-apply runbook for migration 0056 (I-1, adversarial review
# 2026-10-11; M-b and I-2 fixed in round 2) — supersedes plan Task 10 Steps
# 1-4 (see STATE.md Deferred/debt). Order: verify the deploy checkout and
# that its commit actually matches the requested mode (M-b) → build the new
# code while the OLD app still serves → stop the watchdog and the app →
# apply (or roll back) against the LIVE gc_curriculum database through
# p0a-apply-db.sh → restart only on success.
#
# I-2 (round 2): every exit path — success, any guard refusal, Ctrl-C, a
# stuck :3000 wait, a failed bootout, read-env failing, the DB step itself
# failing — runs through one EXIT trap that knows which phase was reached
# and prints the ACTUAL state (queried from the database once it's
# reachable, never assumed) plus the recovery that matches it. This is the
# fix for I-2: round 1's fixed success/failure messages were wrong once a
# failure happened after step (a)'s build — the build on disk could stop
# matching the database, and "restart" alone would recreate round-1's I-1
# data-loss hazard (old code running against a database shaped for new
# code, or vice versa).
#
# This script does NOT merge, fetch, or push, and never echoes
# DATABASE_URL (M-e: the URL is handed to p0a-apply-db.sh via the
# environment, never as a command-line argument). The owner checks
# out/merges the deploy commit beforehand; this script only verifies the
# deploy checkout is clean and at the expected 40-character commit SHA (a
# short/abbreviated SHA is refused).
#
# Where to run this FROM (final review, Minor 5): run it from a checkout of
# THIS repo at (or past) the P0a merge commit — for example the main
# checkout at the merge — not from -deploy, which is just the thing being
# built and restarted. This matters most for `rollback` mode, because the
# pre-P0a SHA you check out IN -deploy has no copy of this script at all
# (it predates P0a) — the script you actually run, and the rollback SQL it
# reads (2026-10-11-p0a-rollback.sql, resolved relative to ITS OWN
# location), both come from wherever THIS script lives, never from
# -deploy's tree.
#
# Testability (round 2): every external path below has an environment-
# variable override, used only by tests/scripts/p0a-live-apply-wrapper.test.ts
# to point at a throwaway git repo and stubbed launchctl/lsof/pnpm/
# p0a-apply-db.sh/p0a-db-migrated.sh on PATH or by override. Every override
# is OPT-IN with the real production path as its default — setting none of
# them reproduces today's exact hardcoded behavior, and no override changes
# *what* is checked, only *where* it looks. WAIT_SLEEP only controls the
# poll interval of the two :3000 wait loops (default 1s, matching the
# previous hardcoded behavior exactly); tests shorten it so a 30-iteration
# timeout doesn't cost 30 real seconds — the iteration CAP (30) is
# unchanged either way, so the override makes tests faster, not laxer.
set -euo pipefail

DEPLOY_SHA="${1:-}"
MODE="${2:-}"
PREVIOUS_SHA_OVERRIDE="${3:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="${P0A_LIVE_APPLY_DEPLOY_DIR:-/Users/admin/projects/curriculum_developer-deploy}"
APPLY_DB_SH="${P0A_LIVE_APPLY_APPLY_DB_SH:-$SCRIPT_DIR/p0a-apply-db.sh}"
DB_MIGRATED_SH="${P0A_LIVE_APPLY_DB_MIGRATED_SH:-$SCRIPT_DIR/p0a-db-migrated.sh}"
EXPECTED_DB="${P0A_LIVE_APPLY_EXPECTED_DB:-gc_curriculum}"
BACKUP_DIR="${P0A_LIVE_APPLY_BACKUP_DIR:-$HOME/.local/share/gc-curriculum-tool/p0a}"
PLIST_APP="${P0A_LIVE_APPLY_PLIST_APP:-$HOME/Library/LaunchAgents/com.gc.curriculum-tool.plist}"
PLIST_WATCHDOG="${P0A_LIVE_APPLY_PLIST_WATCHDOG:-$HOME/Library/LaunchAgents/com.gc.dev-watchdog.plist}"
READ_ENV_MJS="${P0A_LIVE_APPLY_READ_ENV_MJS:-$HOME/.claude/dashboard/read-env.mjs}"
MIGRATION_SQL_LOCAL="$SCRIPT_DIR/../../drizzle/0056_competency_catalog_p0a.sql"
ROLLBACK_SQL_LOCAL="$SCRIPT_DIR/2026-10-11-p0a-rollback.sql"
WAIT_SLEEP="${P0A_LIVE_APPLY_WAIT_SLEEP:-1}"
UID_NUM="$(id -u)"

# --- state the trap handler reads; always defined (set -u) --------------
PHASE="start"
PREVIOUS_SHA=""
DB_WAS_QUERIED=0
DB_IS_MIGRATED=""
DB_RC=""
DATABASE_URL=""

if [[ ! "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "usage: $0 <40-char-deploy-sha> {apply|rollback} [<previous_sha>]" >&2
  echo "got sha: '$DEPLOY_SHA' — must be a full 40-character lowercase hex git SHA, not an abbreviation" >&2
  exit 2
fi
case "$MODE" in
  apply|rollback) ;;
  *) echo "usage: $0 <40-char-deploy-sha> {apply|rollback} [<previous_sha>]" >&2; exit 2 ;;
esac

# --- shared: query the actual DB state (M-g, M-h) and print the matching
# recovery. Never used unless $DATABASE_URL is non-empty. Sets
# DB_WAS_QUERIED/DB_IS_MIGRATED as a side effect. M-h: p0a-db-migrated.sh
# now refuses unless it's actually connected to $EXPECTED_DB, so "could not
# be queried" also covers "DATABASE_URL pointed at the wrong database" —
# both are reported identically, as UNKNOWN, never as a guess.
report_db_state_and_recovery() {
  if DB_IS_MIGRATED="$(DATABASE_URL="$DATABASE_URL" "$DB_MIGRATED_SH" "$EXPECTED_DB" 2>/dev/null)"; then
    DB_WAS_QUERIED=1
  fi
  if [ "$DB_WAS_QUERIED" != 1 ]; then
    echo "DB state UNKNOWN — do not bootstrap; inspect manually." >&2
    echo "(p0a-db-migrated.sh could not confirm the database's state — unreachable, or DATABASE_URL did not point at '$EXPECTED_DB')" >&2
    return
  fi
  echo "Queried database state: migrated=$DB_IS_MIGRATED." >&2
  local expected_migrated="f"; [ "$MODE" = apply ] && expected_migrated="t"
  if [ "$DB_IS_MIGRATED" = "$expected_migrated" ]; then
    echo "That matches what $MODE's build ($DEPLOY_SHA, already built at $DEPLOY_DIR) expects — it should be SAFE to bootstrap the current build:" >&2
    echo "  launchctl bootstrap gui/$UID_NUM \"$PLIST_APP\"" >&2
    echo "  launchctl bootstrap gui/$UID_NUM \"$PLIST_WATCHDOG\"" >&2
  else
    echo "The build on disk at $DEPLOY_DIR (for $DEPLOY_SHA, expects migrated=$expected_migrated) does NOT match the database. Do not bootstrap that build. Investigate the database state by hand before doing anything, for example by re-running p0a-apply-db.sh's guards, or restore the previous build first:" >&2
    echo "  git -C \"$DEPLOY_DIR\" checkout ${PREVIOUS_SHA:-<the previously deployed SHA>} && (cd \"$DEPLOY_DIR\" && pnpm build)" >&2
    echo "  launchctl bootstrap gui/$UID_NUM \"$PLIST_APP\"" >&2
    echo "  launchctl bootstrap gui/$UID_NUM \"$PLIST_WATCHDOG\"" >&2
  fi
}

# --- the state-aware failure/success reporter (I-2) --------------------------
on_exit() {
  local rc=$?
  trap - EXIT INT TERM
  if [ "$rc" -eq 0 ] && [ "$PHASE" = done ]; then
    return 0
  fi

  echo >&2
  echo "=== $0 did not finish normally (exit $rc), at phase: $PHASE ===" >&2

  case "$PHASE" in
    start|pre-stop)
      echo "Nothing was stopped and nothing was touched. The app and watchdog are still running whatever they were running before this invocation." >&2
      ;;
    stopped)
      echo "The app and watchdog are STOPPED. The database step was never reached, so the database is UNTOUCHED — it still matches the code that was running before (previously-deployed SHA: ${PREVIOUS_SHA:-unknown; check \`git -C \"$DEPLOY_DIR\" reflog\`})." >&2
      echo "The deploy checkout at $DEPLOY_DIR now holds a BUILD for $DEPLOY_SHA, which does NOT match the (untouched) database." >&2
      echo >&2
      echo "To restore service, either:" >&2
      echo "  (a) re-run this script to retry $MODE for $DEPLOY_SHA, or" >&2
      echo "  (b) restore the previous build first, then start it:" >&2
      echo "        git -C \"$DEPLOY_DIR\" checkout ${PREVIOUS_SHA:-<the previously deployed SHA>} && (cd \"$DEPLOY_DIR\" && pnpm build)" >&2
      echo "        launchctl bootstrap gui/$UID_NUM \"$PLIST_APP\"" >&2
      echo "        launchctl bootstrap gui/$UID_NUM \"$PLIST_WATCHDOG\"" >&2
      ;;
    db-attempt)
      # M-g (round 3): round 2 asserted UNTOUCHED here unconditionally, but
      # by the time this phase starts, DATABASE_URL may already be in hand
      # and p0a-apply-db.sh may already have committed — a signal landing
      # right after its COMMIT (while verify is still running, for example)
      # used to print a false UNTOUCHED state and the I-1-recreating
      # "restore previous build" recovery. If DATABASE_URL was never
      # obtained (read-env itself failed or hasn't run yet), the database
      # genuinely cannot have been touched, so that assertion is still
      # correct in that specific case — otherwise, query for real.
      if [ -n "$DATABASE_URL" ]; then
        echo "The database step was interrupted or did not return — querying its actual state rather than assuming UNTOUCHED." >&2
        report_db_state_and_recovery
      else
        echo "The app and watchdog are STOPPED. DATABASE_URL was never obtained, so the database step cannot have run — the database is UNTOUCHED (previously-deployed SHA: ${PREVIOUS_SHA:-unknown; check \`git -C \"$DEPLOY_DIR\" reflog\`})." >&2
        echo "The deploy checkout at $DEPLOY_DIR now holds a BUILD for $DEPLOY_SHA, which does NOT match the (untouched) database." >&2
        echo >&2
        echo "To restore service, either:" >&2
        echo "  (a) re-run this script to retry $MODE for $DEPLOY_SHA, or" >&2
        echo "  (b) restore the previous build first, then start it:" >&2
        echo "        git -C \"$DEPLOY_DIR\" checkout ${PREVIOUS_SHA:-<the previously deployed SHA>} && (cd \"$DEPLOY_DIR\" && pnpm build)" >&2
        echo "        launchctl bootstrap gui/$UID_NUM \"$PLIST_APP\"" >&2
        echo "        launchctl bootstrap gui/$UID_NUM \"$PLIST_WATCHDOG\"" >&2
      fi
      ;;
    db-done)
      if [ "$DB_RC" = "4" ]; then
        # M-i (round 3): p0a-apply-db.sh's distinct exit code for "the
        # migration committed, but verify found a problem afterward" — the
        # schema DID change, so this must never say SAFE.
        echo "The database $MODE committed, but verification failed afterward (p0a-apply-db.sh exit 4)." >&2
        echo "migration committed but verification failed — do not bootstrap; run rollback or inspect" >&2
      else
        echo "The database step returned failure (exit ${DB_RC:-unknown})." >&2
        report_db_state_and_recovery
      fi
      ;;
    restarting-app)
      echo "The database $MODE SUCCEEDED and matches the build now on disk ($DEPLOY_SHA), but the app did not come up on :3000 within the timeout. The watchdog has NOT been bootstrapped. Check the app log, then:" >&2
      echo "  launchctl bootstrap gui/$UID_NUM \"$PLIST_APP\"" >&2
      echo "  launchctl bootstrap gui/$UID_NUM \"$PLIST_WATCHDOG\"" >&2
      ;;
    restarting-watchdog)
      echo "The database $MODE SUCCEEDED and the app IS up on :3000, but bootstrapping the watchdog failed. Retry:" >&2
      echo "  launchctl bootstrap gui/$UID_NUM \"$PLIST_WATCHDOG\"" >&2
      ;;
    *)
      echo "Unrecognized phase — treat the database state as unknown and investigate by hand before restarting anything." >&2
      ;;
  esac
  exit "$rc"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "=== (a) verify the deploy checkout and that $DEPLOY_SHA matches '$MODE' ==="
PHASE="pre-stop"
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
PREVIOUS_SHA="$PREVIOUS_SHA_OVERRIDE"
if [ -z "$PREVIOUS_SHA" ]; then
  PREVIOUS_SHA="$(git -C "$DEPLOY_DIR" rev-parse 'HEAD@{1}' 2>/dev/null || true)"
fi
echo "previously deployed SHA (for recovery, if needed): ${PREVIOUS_SHA:-unknown — pass it as a 3rd argument next time, or check \`git -C \"$DEPLOY_DIR\" reflog\`}"

# --- M-b (round 2): the SHA must actually match the mode, and the SQL that
# will be applied must be the SQL that sits at that SHA — not whatever
# happens to be checked out wherever this script itself lives.
if [ "$MODE" = apply ]; then
  if ! git -C "$DEPLOY_DIR" cat-file -e "$DEPLOY_SHA:drizzle/0056_competency_catalog_p0a.sql" 2>/dev/null; then
    echo "refusing: $DEPLOY_SHA has no drizzle/0056_competency_catalog_p0a.sql — apply mode requires a post-P0a commit; nothing stopped, nothing touched" >&2
    exit 1
  fi
  if ! diff -q <(git -C "$DEPLOY_DIR" show "$DEPLOY_SHA:drizzle/0056_competency_catalog_p0a.sql") "$MIGRATION_SQL_LOCAL" >/dev/null 2>&1; then
    echo "refusing: drizzle/0056_competency_catalog_p0a.sql at $DEPLOY_SHA differs byte-for-byte from $MIGRATION_SQL_LOCAL, which is what p0a-apply-db.sh will actually apply; nothing stopped, nothing touched" >&2
    exit 1
  fi
  echo "confirmed: $DEPLOY_SHA's drizzle/0056_competency_catalog_p0a.sql matches $MIGRATION_SQL_LOCAL byte-for-byte"
else
  if git -C "$DEPLOY_DIR" cat-file -e "$DEPLOY_SHA:drizzle/0056_competency_catalog_p0a.sql" 2>/dev/null; then
    echo "refusing: $DEPLOY_SHA DOES have drizzle/0056_competency_catalog_p0a.sql — rollback mode requires a pre-P0a commit (the target you are rolling back TO); nothing stopped, nothing touched" >&2
    exit 1
  fi
  echo "confirmed: $DEPLOY_SHA predates P0a (no drizzle/0056_competency_catalog_p0a.sql). The rollback SQL will be read from $ROLLBACK_SQL_LOCAL — the P0a commit's copy, since $DEPLOY_SHA's own tree has none."
fi

echo "=== building the new code while the OLD app still serves ==="
(cd "$DEPLOY_DIR" && pnpm build)
echo "build OK at $DEPLOY_SHA"

echo "=== (b) stop the watchdog, then the app; wait for :3000 to close ==="
PHASE="stopped"
launchctl bootout "gui/$UID_NUM/com.gc.dev-watchdog" 2>/dev/null || true
launchctl bootout "gui/$UID_NUM/com.gc.curriculum-tool" 2>/dev/null || true
WAITED=0
while lsof -iTCP:3000 -sTCP:LISTEN -t >/dev/null 2>&1; do
  sleep "$WAIT_SLEEP"
  WAITED=$((WAITED + 1))
  if [ "$WAITED" -ge 30 ]; then
    echo "refusing: something is still listening on :3000 after 30 checks; the database was NOT touched" >&2
    exit 1
  fi
done
echo "confirmed: nothing listens on :3000"

echo "=== (c) $MODE against the LIVE database ==="
PHASE="db-attempt"
DATABASE_URL="$(node "$READ_ENV_MJS" "$DEPLOY_DIR" DATABASE_URL)"
DB_RC=0
DATABASE_URL="$DATABASE_URL" "$APPLY_DB_SH" "$EXPECTED_DB" "$BACKUP_DIR" "$MODE" || DB_RC=$?
PHASE="db-done"

# DATABASE_URL stays set until here on purpose: if DB_RC != 0, the EXIT
# trap's db-done branch (report_db_state_and_recovery) needs it to query
# the real state (M-g). Only unset it once we know we won't need it again.
if [ "$DB_RC" -ne 0 ]; then
  exit "$DB_RC"
fi
unset DATABASE_URL

echo "=== (e) DB $MODE succeeded — restarting the app, then the watchdog ==="
PHASE="restarting-app"
launchctl bootstrap "gui/$UID_NUM" "$PLIST_APP"
WAITED=0
while ! lsof -iTCP:3000 -sTCP:LISTEN -t >/dev/null 2>&1; do
  sleep "$WAIT_SLEEP"
  WAITED=$((WAITED + 1))
  if [ "$WAITED" -ge 30 ]; then
    exit 1
  fi
done
PHASE="restarting-watchdog"
launchctl bootstrap "gui/$UID_NUM" "$PLIST_WATCHDOG"
PHASE="done"
cat <<SMOKE

DB $MODE applied. App and watchdog restarted. Smoke test (plan Task 10 Step 3) at
https://gcworkflow.clemson.edu:8443:
  - /program — each target tab
  - a course page's prerequisite panel
  - /wiki — a target page and a competency page
  - /explore — one course

Then update docs/STATE.md: P0a applied to production (date, owner go-ahead) — see plan Task 10 Step 3.
SMOKE
exit 0
