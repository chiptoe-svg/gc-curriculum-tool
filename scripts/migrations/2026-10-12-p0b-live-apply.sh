#!/usr/bin/env bash
# 2026-10-12-p0b-live-apply.sh <deploy_sha> apply [<previous_sha>]
# 2026-10-12-p0b-live-apply.sh <pre-P0b-sha> rollback <dump-path>
#
# OWNER-RUN. Live-apply runbook for migration 0057 (P0b) — sibling to
# 2026-10-11-p0a-live-apply.sh, same order of operations: verify the
# deploy checkout and that its commit actually matches the requested mode
# → build the new code while the OLD app still serves → stop the
# watchdog and the app → apply (or restore) against the LIVE gc_curriculum
# database through p0b-apply-db.sh → restart only on success.
#
# Differences from the P0a wrapper (task-8 brief):
#   - migration is 0057 (drizzle/0057_competency_catalog_p0b.sql), verify
#     script is 2026-10-12-p0b-verify.sql, DB-state probe is
#     p0b-db-migrated.sh (sub_competency_map exists == 0057 applied).
#   - rollback mode = RESTORE, not a rollback SQL file: the 3rd argument
#     is a dump path (produced by a previous apply's pre-apply-*.dump
#     backup), handed through to p0b-apply-db.sh, which validates it
#     (basename pattern + p0a-verify-backup.sh) before ever opening a
#     connection. There is therefore no PREVIOUS_SHA override slot in
#     rollback mode — the previously-deployed SHA for recovery messages is
#     always derived from `git -C "$DEPLOY_DIR" rev-parse 'HEAD@{1}'`.
#   - after every `launchctl bootstrap`, this wrapper also runs
#     `launchctl kickstart` for that same job (2026-10-11 bootstrap-
#     without-spawn finding: bootstrap alone left the app job at runs=0,
#     never actually spawning it; `launchctl kickstart` is what starts it).
#     This applies to the main restart path AND every recovery suggestion
#     the EXIT trap prints, since "just bootstrap it" is not, in fact,
#     sufficient on this host.
#
# Everything else — the state-aware EXIT trap, the SHA ↔ migration
# consistency check, fail-closed verify, never touching DATABASE_URL on
# argv — is unchanged in spirit from the P0a wrapper. See that script's
# header for the full rationale (I-1/I-2/M-a through M-j, adversarial
# review 2026-10-11) — none of that reasoning is repeated here.
#
# Testability: every external path below has an environment-variable
# override, used only by tests/scripts/p0b-live-apply-wrapper.test.ts to
# point at a throwaway git repo and stubbed launchctl/lsof/pnpm/
# p0b-apply-db.sh/p0b-db-migrated.sh on PATH or by override — same
# methodology as the P0a wrapper test, distinct env-var prefix
# (P0B_LIVE_APPLY_*) so the two test suites can never cross-talk even if
# both happened to export overrides into the same environment. Setting
# none of them reproduces today's exact production path.
set -euo pipefail

DEPLOY_SHA="${1:-}"
MODE="${2:-}"
THIRD_ARG="${3:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="${P0B_LIVE_APPLY_DEPLOY_DIR:-/Users/admin/projects/curriculum_developer-deploy}"
APPLY_DB_SH="${P0B_LIVE_APPLY_APPLY_DB_SH:-$SCRIPT_DIR/p0b-apply-db.sh}"
DB_MIGRATED_SH="${P0B_LIVE_APPLY_DB_MIGRATED_SH:-$SCRIPT_DIR/p0b-db-migrated.sh}"
EXPECTED_DB="${P0B_LIVE_APPLY_EXPECTED_DB:-gc_curriculum}"
BACKUP_DIR="${P0B_LIVE_APPLY_BACKUP_DIR:-$HOME/.local/share/gc-curriculum-tool/p0b}"
PLIST_APP="${P0B_LIVE_APPLY_PLIST_APP:-$HOME/Library/LaunchAgents/com.gc.curriculum-tool.plist}"
PLIST_WATCHDOG="${P0B_LIVE_APPLY_PLIST_WATCHDOG:-$HOME/Library/LaunchAgents/com.gc.dev-watchdog.plist}"
READ_ENV_MJS="${P0B_LIVE_APPLY_READ_ENV_MJS:-$HOME/.claude/dashboard/read-env.mjs}"
MIGRATION_SQL_LOCAL="$SCRIPT_DIR/../../drizzle/0057_competency_catalog_p0b.sql"
WAIT_SLEEP="${P0B_LIVE_APPLY_WAIT_SLEEP:-1}"
UID_NUM="$(id -u)"
LABEL_APP="com.gc.curriculum-tool"
LABEL_WATCHDOG="com.gc.dev-watchdog"
# shellcheck source=./p0a-lib.sh
. "$SCRIPT_DIR/p0a-lib.sh"

# Fix round 2 (task 8): refuse a P0B_LIVE_APPLY_EXPECTED_DB override that
# isn't on the allowlist (p0b_check_allowed_db_name, p0a-lib.sh) — exactly
# "gc_curriculum" (the unconditional live default above) or
# gc_curriculum_p0b_rbtest* (the disposable real-DB test fixture family).
# Checked before anything else runs, same discipline as the DB scripts.
if ! p0b_check_allowed_db_name "$EXPECTED_DB"; then
  exit 1
fi

# --- state the trap handler reads; always defined (set -u) --------------
PHASE="start"
PREVIOUS_SHA=""
ROLLBACK_DUMP=""
DB_WAS_QUERIED=0
DB_IS_MIGRATED=""
DB_RC=""
DATABASE_URL=""

if [[ ! "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "usage: $0 <40-char-deploy-sha> apply [<previous_sha>]" >&2
  echo "       $0 <40-char-pre-P0b-sha> rollback <dump-path>" >&2
  echo "got sha: '$DEPLOY_SHA' — must be a full 40-character lowercase hex git SHA, not an abbreviation" >&2
  exit 2
fi
case "$MODE" in
  apply|rollback) ;;
  *) echo "usage: $0 <40-char-deploy-sha> apply [<previous_sha>] | $0 <40-char-pre-P0b-sha> rollback <dump-path>" >&2; exit 2 ;;
esac

if [ "$MODE" = rollback ]; then
  ROLLBACK_DUMP="$THIRD_ARG"
  if [ -z "$ROLLBACK_DUMP" ]; then
    echo "usage: $0 <40-char-pre-P0b-sha> rollback <dump-path>" >&2
    exit 2
  fi
  PREVIOUS_SHA_OVERRIDE=""
else
  PREVIOUS_SHA_OVERRIDE="$THIRD_ARG"
fi

# --- shared: query the actual DB state and print the matching recovery.
# Never used unless $DATABASE_URL is non-empty. Sets
# DB_WAS_QUERIED/DB_IS_MIGRATED as a side effect. p0b-db-migrated.sh
# refuses unless it's actually connected to $EXPECTED_DB, so "could not be
# queried" also covers "DATABASE_URL pointed at the wrong database" — both
# are reported identically, as UNKNOWN, never as a guess.
report_db_state_and_recovery() {
  if DB_IS_MIGRATED="$(DATABASE_URL="$DATABASE_URL" "$DB_MIGRATED_SH" "$EXPECTED_DB" 2>/dev/null)"; then
    DB_WAS_QUERIED=1
  fi
  if [ "$DB_WAS_QUERIED" != 1 ]; then
    echo "DB state UNKNOWN — do not bootstrap; inspect manually." >&2
    echo "(p0b-db-migrated.sh could not confirm the database's state — unreachable, or DATABASE_URL did not point at '$EXPECTED_DB')" >&2
    return
  fi
  echo "Queried database state: migrated=$DB_IS_MIGRATED." >&2
  local expected_migrated="f"; [ "$MODE" = apply ] && expected_migrated="t"
  if [ "$DB_IS_MIGRATED" = "$expected_migrated" ]; then
    echo "That matches what $MODE's build ($DEPLOY_SHA, already built at $DEPLOY_DIR) expects — it should be SAFE to bootstrap the current build:" >&2
    echo "  launchctl bootstrap gui/$UID_NUM \"$PLIST_APP\"" >&2
    echo "  launchctl kickstart \"gui/$UID_NUM/$LABEL_APP\"" >&2
    echo "  launchctl bootstrap gui/$UID_NUM \"$PLIST_WATCHDOG\"" >&2
    echo "  launchctl kickstart \"gui/$UID_NUM/$LABEL_WATCHDOG\"" >&2
  else
    echo "The build on disk at $DEPLOY_DIR (for $DEPLOY_SHA, expects migrated=$expected_migrated) does NOT match the database. Do not bootstrap that build. Investigate the database state by hand before doing anything, for example by re-running p0b-apply-db.sh's guards, or restore the previous build first:" >&2
    echo "  git -C \"$DEPLOY_DIR\" checkout ${PREVIOUS_SHA:-<the previously deployed SHA>} && (cd \"$DEPLOY_DIR\" && pnpm build)" >&2
    echo "  launchctl bootstrap gui/$UID_NUM \"$PLIST_APP\"" >&2
    echo "  launchctl kickstart \"gui/$UID_NUM/$LABEL_APP\"" >&2
    echo "  launchctl bootstrap gui/$UID_NUM \"$PLIST_WATCHDOG\"" >&2
    echo "  launchctl kickstart \"gui/$UID_NUM/$LABEL_WATCHDOG\"" >&2
  fi
}

# --- the state-aware failure/success reporter ----------------------------
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
      echo "        launchctl kickstart \"gui/$UID_NUM/$LABEL_APP\"" >&2
      echo "        launchctl bootstrap gui/$UID_NUM \"$PLIST_WATCHDOG\"" >&2
      echo "        launchctl kickstart \"gui/$UID_NUM/$LABEL_WATCHDOG\"" >&2
      ;;
    db-attempt)
      # If DATABASE_URL was never obtained (read-env itself failed or
      # hasn't run yet), the database genuinely cannot have been touched.
      # Otherwise query for real rather than assuming UNTOUCHED — the DB
      # step may have been interrupted after it already committed.
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
        echo "        launchctl kickstart \"gui/$UID_NUM/$LABEL_APP\"" >&2
        echo "        launchctl bootstrap gui/$UID_NUM \"$PLIST_WATCHDOG\"" >&2
        echo "        launchctl kickstart \"gui/$UID_NUM/$LABEL_WATCHDOG\"" >&2
      fi
      ;;
    db-done)
      case "$DB_RC" in
        4)
          # apply-only: the migration committed, but verify found a problem
          # afterward — the schema DID change, so this must never say SAFE.
          echo "The database $MODE committed, but verification failed afterward (p0b-apply-db.sh exit 4)." >&2
          echo "migration committed but verification failed — do not bootstrap; run rollback or inspect" >&2
          ;;
        5)
          # rollback-only (fix round 1): the first rename (live -> aside)
          # succeeded, the second (restore -> live) failed, and
          # p0b-apply-db.sh's own automatic fallback successfully renamed
          # the migrated database back into the live name. Live is
          # UNTOUCHED under its original name — still the migrated
          # (post-P0b) database — but the verified restore is now parked
          # under a separate name instead of being dropped. Do NOT
          # reconstruct that parked name here: p0b-apply-db.sh already
          # printed it above, since the wrapper never captures its
          # stdout/stderr.
          #
          # Fix round 2 (Important): round 1's message here said "Do NOT
          # bootstrap a pre-P0b build against this still-migrated
          # database:" and then printed exactly the bootstrap/kickstart
          # commands that DO bootstrap a pre-P0b build — in rollback mode
          # $DEPLOY_DIR already holds the pre-P0b build this invocation
          # was rolling back TO, so following those lines did precisely
          # what the sentence in front of them forbade. The database that
          # matches what's actually live right now (still migrated) is
          # whatever was deployed BEFORE this rollback attempt —
          # $PREVIOUS_SHA — not $DEPLOY_SHA. Reusing
          # report_db_state_and_recovery here gets that right for free:
          # it queries the real state (migrated=t is expected), compares
          # against what rollback mode expects (migrated=f), finds the
          # mismatch, and prints the checkout-$PREVIOUS_SHA-then-build
          # step BEFORE any bootstrap/kickstart line — never bootstrap
          # commands on their own.
          echo "The rollback's database swap failed partway, but p0b-apply-db.sh's automatic fallback already renamed the live database back — '$EXPECTED_DB' should be UNTOUCHED under its original name. The attempted restore was not dropped; see the output above from p0b-apply-db.sh for its exact parked name if you want to retry it. Querying the real state to confirm which build actually matches live right now:" >&2
          report_db_state_and_recovery
          ;;
        6)
          # rollback-only (fix round 1): BOTH renames failed — the live
          # database name does not currently exist on the server under ANY
          # name's worth of guessing from here. p0b-apply-db.sh already
          # printed the exact `ALTER DATABASE ... RENAME TO` fix on stderr
          # (it alone knows the generated names); this is a pointer to it,
          # not a reconstruction, since reconstructing it wrong here would
          # be worse than saying nothing.
          echo "CRITICAL: the rollback's database swap failed catastrophically — '$EXPECTED_DB' does not currently exist on this server under its own name (both the swap and its automatic fallback failed). Scroll up to p0b-apply-db.sh's own output for the exact 'ALTER DATABASE ... RENAME TO ...;' command and run it by hand on the 'postgres' maintenance database immediately. Do not bootstrap anything until '$EXPECTED_DB' exists again and its state has been confirmed by hand." >&2
          ;;
        *)
          echo "The database step returned failure (exit ${DB_RC:-unknown})." >&2
          report_db_state_and_recovery
          ;;
      esac
      ;;
    restarting-app)
      echo "The database $MODE SUCCEEDED and matches the build now on disk ($DEPLOY_SHA), but the app did not come up on :3000 within the timeout (bootstrap + kickstart were both run). The watchdog has NOT been bootstrapped. Check the app log, then:" >&2
      echo "  launchctl bootstrap gui/$UID_NUM \"$PLIST_APP\"" >&2
      echo "  launchctl kickstart \"gui/$UID_NUM/$LABEL_APP\"" >&2
      echo "  launchctl bootstrap gui/$UID_NUM \"$PLIST_WATCHDOG\"" >&2
      echo "  launchctl kickstart \"gui/$UID_NUM/$LABEL_WATCHDOG\"" >&2
      ;;
    restarting-watchdog)
      echo "The database $MODE SUCCEEDED and the app IS up on :3000, but bootstrapping (or kickstarting) the watchdog failed. Retry:" >&2
      echo "  launchctl bootstrap gui/$UID_NUM \"$PLIST_WATCHDOG\"" >&2
      echo "  launchctl kickstart \"gui/$UID_NUM/$LABEL_WATCHDOG\"" >&2
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
echo "previously deployed SHA (for recovery, if needed): ${PREVIOUS_SHA:-unknown — pass it as a 3rd argument next time (apply mode), or check \`git -C \"$DEPLOY_DIR\" reflog\`}"

# --- the SHA must actually match the mode, and the SQL that will be
# applied must be the SQL that sits at that SHA — not whatever happens to
# be checked out wherever this script itself lives.
if [ "$MODE" = apply ]; then
  if ! git -C "$DEPLOY_DIR" cat-file -e "$DEPLOY_SHA:drizzle/0057_competency_catalog_p0b.sql" 2>/dev/null; then
    echo "refusing: $DEPLOY_SHA has no drizzle/0057_competency_catalog_p0b.sql — apply mode requires a post-P0b commit; nothing stopped, nothing touched" >&2
    exit 1
  fi
  if ! diff -q <(git -C "$DEPLOY_DIR" show "$DEPLOY_SHA:drizzle/0057_competency_catalog_p0b.sql") "$MIGRATION_SQL_LOCAL" >/dev/null 2>&1; then
    echo "refusing: drizzle/0057_competency_catalog_p0b.sql at $DEPLOY_SHA differs byte-for-byte from $MIGRATION_SQL_LOCAL, which is what p0b-apply-db.sh will actually apply; nothing stopped, nothing touched" >&2
    exit 1
  fi
  echo "confirmed: $DEPLOY_SHA's drizzle/0057_competency_catalog_p0b.sql matches $MIGRATION_SQL_LOCAL byte-for-byte"
else
  if git -C "$DEPLOY_DIR" cat-file -e "$DEPLOY_SHA:drizzle/0057_competency_catalog_p0b.sql" 2>/dev/null; then
    echo "refusing: $DEPLOY_SHA DOES have drizzle/0057_competency_catalog_p0b.sql — rollback mode requires a pre-P0b commit (the target you are rolling back TO); nothing stopped, nothing touched" >&2
    exit 1
  fi
  if [ ! -f "$ROLLBACK_DUMP" ]; then
    echo "refusing: rollback dump '$ROLLBACK_DUMP' does not exist; nothing stopped, nothing touched" >&2
    exit 1
  fi
  echo "confirmed: $DEPLOY_SHA predates P0b (no drizzle/0057_competency_catalog_p0b.sql). Will restore from $ROLLBACK_DUMP via p0b-apply-db.sh, which re-validates it before touching anything."
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
if [ "$MODE" = rollback ]; then
  DATABASE_URL="$DATABASE_URL" "$APPLY_DB_SH" "$EXPECTED_DB" "$BACKUP_DIR" "$MODE" "$ROLLBACK_DUMP" || DB_RC=$?
else
  DATABASE_URL="$DATABASE_URL" "$APPLY_DB_SH" "$EXPECTED_DB" "$BACKUP_DIR" "$MODE" || DB_RC=$?
fi
PHASE="db-done"

# DATABASE_URL stays set until here on purpose: if DB_RC != 0, the EXIT
# trap's db-done branch (report_db_state_and_recovery) needs it to query
# the real state.
if [ "$DB_RC" -ne 0 ]; then
  exit "$DB_RC"
fi
unset DATABASE_URL

echo "=== (e) DB $MODE succeeded — restarting the app, then the watchdog ==="
PHASE="restarting-app"
launchctl bootstrap "gui/$UID_NUM" "$PLIST_APP"
# 2026-10-11 bootstrap-without-spawn finding: bootstrap alone left the job
# registered at runs=0 and never actually started it; kickstart is what
# spawns it. Must run for both jobs, every time.
launchctl kickstart "gui/$UID_NUM/$LABEL_APP"
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
launchctl kickstart "gui/$UID_NUM/$LABEL_WATCHDOG"
PHASE="done"
if [ "$MODE" = rollback ]; then
  echo
  echo "'$EXPECTED_DB' is now the restored pre-0057 database (swap completed by p0b-apply-db.sh above). The previously-migrated database was kept, not dropped — see p0b-apply-db.sh's own output above for its exact name and the two 'ALTER DATABASE ... RENAME TO ...;' commands that would undo this rollback."
  # M-3 (hostile review 2026-10-12): this used to always print the APPLY
  # smoke test (merged competencies, new P0b faculty_flags) and "P0b
  # applied to production" even in rollback mode, where $DEPLOY_DIR is the
  # PRE-P0b build and none of that exists any more — wrong smoke test,
  # wrong STATE.md instruction.
  cat <<SMOKE

DB rollback applied. App and watchdog restarted on the pre-P0b build. Smoke test
(pre-P0b behavior) at https://gcworkflow.clemson.edu:8443:
  - /program — each target tab (domain-knowledge/project-management should
    NOT show the merged descriptors; gc-production-literacy, domain-grounding
    and timeline-management should be back as their own live competencies)
  - a course page's prerequisite panel
  - /wiki — a target page and a competency page
  - /explore — one course

Then update docs/STATE.md: P0b rolled back (date, owner go-ahead, reason).
SMOKE
else
  cat <<SMOKE

DB apply applied. App and watchdog restarted. Smoke test at
https://gcworkflow.clemson.edu:8443:
  - /program — each target tab
  - a course page's prerequisite panel
  - /wiki — a target page and a competency page
  - /explore — one course
  - a merged competency (domain-knowledge, project-management): confirm the
    merged descriptors and any new faculty_flags from the P0b merge read
    sensibly

Then update docs/STATE.md: P0b applied to production (date, owner go-ahead).
SMOKE
fi
exit 0
