#!/usr/bin/env bash
# 2026-10-19-ca-live-apply.sh
#
# OWNER-RUN. Live-apply runbook for migration 0060 (catalog foundationals,
# derived scoring) and the data steps that follow it. Every step prints what
# it will do and waits for `type yes`. Never echoes DATABASE_URL.
#
# Order (global-constraints Review Focus 5 — the schema must be in place
# BEFORE the code that names the new columns is deployed):
#   1 backup -> 1b preflight (read-only: free ids, prior-text drift)
#   -> 2 apply 0060 -> 3 verify -> 4 reliability decision
#   -> 5 deploy build -> 6 insert additions (dry run, then apply)
#   -> 7 card apply (only after the owner sets _approval)
#   -> 8 problem-solving page -> 9 rescoring note
#
# Usage: 2026-10-19-ca-live-apply.sh [--from <step 1..9>]
#   --from N resumes at step N (default 1); earlier steps are skipped with a
#   one-line note. The backup (step 1) and preflight (1b) run whenever N <= 2.
#   Step 2 also skips itself, with a message, when 0060 is already applied
#   (the foundational column exists AND the verify file passes).
#
# Run this script from the BRANCH checkout (the one that holds the new
# scripts and additions file): step 1b runs before step 5 deploys, so the
# deploy checkout does not have them yet. Steps 6-8 use the deploy checkout.
#
# 0060 is additive (defaults on the new columns; a dropped NOT NULL is
# invisible to old readers), so the OLD build keeps working on the migrated
# database until step 5. The app is NOT stopped by this script.
#
# DATABASE_URL handling matches 2026-10-12-p0b-live-apply.sh: read through
# the app's own loader (read-env.mjs -> @next/env), never sourced or grepped
# by hand, never put on argv. psql/pg_dump get libpq PG* variables from
# p0a-lib.sh inside a subshell; the TypeScript scripts get DATABASE_URL in
# their environment only. Every script call passes --expect-db gc_curriculum.
#
# Rollback of 0060 (only if no foundational/derived rows exist yet):
#   psql -f scripts/migrations/2026-10-19-ca-rollback.sql  (it refuses otherwise)
# If the additions are already inserted, first run the forward fix
#   scripts/migrations/2026-10-19-ca-remove-additions.sql
# (removes the 11 additions and their rows; refuses if reviewed bundle_members
# or golden picks exist; does NOT restore the two revised descriptors - their
# prior texts are in its header), or restore the step-1 dump.
#
# Rehearsal hooks (never set for a live run): EXPECTED_DB (default
# gc_curriculum), CA_REHEARSAL_URL_CMD (a command whose stdout is the DB URL,
# used instead of read-env), DEPLOY_DIR (default: the live deploy checkout).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEPLOY_DIR="${DEPLOY_DIR:-${CA_LIVE_APPLY_DEPLOY_DIR:-/Users/admin/projects/curriculum_developer-deploy}}"
READ_ENV_MJS="${CA_LIVE_APPLY_READ_ENV_MJS:-$HOME/.claude/dashboard/read-env.mjs}"
BACKUP_DIR="${CA_LIVE_APPLY_BACKUP_DIR:-$HOME/.local/share/gc-curriculum-tool/ca}"
EXPECTED_DB="${EXPECTED_DB:-gc_curriculum}"
CA_REHEARSAL_URL_CMD="${CA_REHEARSAL_URL_CMD:-}"
PGBIN=/Applications/Postgres.app/Contents/Versions/17/bin
MIGRATION_SQL="$SCRIPT_DIR/../../drizzle/0060_catalog_foundationals.sql"
VERIFY_SQL="$SCRIPT_DIR/2026-10-19-ca-verify.sql"
ADDITIONS_FILE="$DEPLOY_DIR/docs/superpowers/specs/2026-10-19-catalog-additions.json"
REPO_ADDITIONS_FILE="$REPO_DIR/docs/superpowers/specs/2026-10-19-catalog-additions.json"
CARDS_FILE="$DEPLOY_DIR/docs/superpowers/specs/2026-10-15-bundle-cards.json"
# shellcheck source=./p0a-lib.sh
. "$SCRIPT_DIR/p0a-lib.sh"

FROM=1
while [ $# -gt 0 ]; do
  case "$1" in
    --from)
      FROM="${2:-}"
      shift 2 || { echo "usage: --from <step 1..9>" >&2; exit 2; } ;;
    *) echo "usage: $0 [--from <step 1..9>]" >&2; exit 2 ;;
  esac
done
case "$FROM" in
  1|2|3|4|5|6|7|8|9) ;;
  *) echo "usage: --from must be a step number 1..9 (got '$FROM')" >&2; exit 2 ;;
esac
# run_step N: true when step N should run; otherwise prints a one-line skip note.
run_step() {
  if [ "$1" -ge "$FROM" ]; then return 0; fi
  echo "skipping step $1 (--from $FROM)"
  return 1
}

# Print the DB URL (callers capture it inside $(...); never echo it).
db_url() {
  if [ -n "$CA_REHEARSAL_URL_CMD" ]; then
    bash -c "$CA_REHEARSAL_URL_CMD"
  else
    node "$READ_ENV_MJS" "$DEPLOY_DIR" DATABASE_URL
  fi
}

confirm() {
  echo
  echo "=== $1 ==="
  echo "$2"
  local answer
  read -r -p "type yes: " answer
  if [ "$answer" != "yes" ]; then
    echo "stopped before: $1 (nothing further was run)" >&2
    exit 1
  fi
}

# Run a command with libpq PG* env for the live DB inside a subshell, so the
# URL and password never reach this shell, argv, or the terminal.
with_pg_env() {
  (
    export DATABASE_URL="$(db_url)"
    p0a_url_to_pg_env
    ACTUAL_DB="$("$PGBIN/psql" -X -At -v ON_ERROR_STOP=1 -c "SELECT current_database();")"
    if [ "$ACTUAL_DB" != "$EXPECTED_DB" ]; then
      echo "refusing: connected to database '$ACTUAL_DB', expected '$EXPECTED_DB'" >&2
      exit 1
    fi
    "$@"
  )
}

# Run a TypeScript script from <dir> with DATABASE_URL in its environment only
# (never argv). --expect-db is supplied by the caller. Names listed in
# RUN_TS_ENV (space-separated) are read through read-env.mjs from the deploy
# env and exported ONLY if set there; values are never echoed.
run_ts_in() {
  local dir="$1"; shift
  (
    cd "$dir"
    # Assign first (plain assignment, so set -e trips if the read fails).
    u="$(db_url)"
    if [ -z "$u" ]; then
      echo "refusing: DATABASE_URL came back empty" >&2
      exit 1
    fi
    for name in ${RUN_TS_ENV:-}; do
      if v="$(node "$READ_ENV_MJS" "$DEPLOY_DIR" "$name" 2>/dev/null)"; then
        export "$name=$v"
      fi
    done
    # tsx: the checkout's .bin shim if present, else the pnpm store copy (a
    # branch worktree may not have the shim; tsx is not a direct dependency).
    if [ -x "$dir/node_modules/.bin/tsx" ]; then
      DATABASE_URL="$u" "$dir/node_modules/.bin/tsx" "$@"
    else
      cli="$(ls -d "$dir"/node_modules/.pnpm/tsx@*/node_modules/tsx/dist/cli.mjs 2>/dev/null | head -1)"
      if [ -z "$cli" ]; then
        echo "refusing: tsx not found under $dir/node_modules (run pnpm install there)" >&2
        exit 1
      fi
      DATABASE_URL="$u" node "$cli" "$@"
    fi
  )
}
run_ts() { run_ts_in "$DEPLOY_DIR" "$@"; }

# --- 1. backup + 1b preflight (any start at or before step 2) --------------
DUMP_FILE=""
if [ "$FROM" -le 2 ]; then
confirm "1. backup" "pg_dump -Fc of $EXPECTED_DB to $BACKUP_DIR/pre-apply-<UTC>.dump, then pg_restore --list to confirm it carries sub_competencies TABLE DATA."
umask 077
mkdir -p "$BACKUP_DIR"
DUMP_FILE="$BACKUP_DIR/pre-apply-$(date -u +%Y%m%dT%H%M%SZ).dump"
with_pg_env "$PGBIN/pg_dump" -Fc --no-owner -f "$DUMP_FILE"
chmod 600 "$DUMP_FILE"
if [ ! -s "$DUMP_FILE" ]; then
  echo "refusing: backup is empty: $DUMP_FILE" >&2
  exit 1
fi
RESTORE_LIST="$("$PGBIN/pg_restore" --list "$DUMP_FILE")"
if ! grep -q "TABLE DATA public sub_competencies " <<<"$RESTORE_LIST"; then
  echo "refusing: backup does not list TABLE DATA for sub_competencies: $DUMP_FILE" >&2
  exit 1
fi
echo "backup verified: $DUMP_FILE"

confirm "1b. preflight" "READ-ONLY. insert-catalog-additions.ts --preflight from the branch checkout $REPO_DIR: confirms none of the 11 ids exists yet and the two revised descriptors still hold the file's prior text. Catches drift BEFORE any change. Exit 5 = would refuse (stop and read the message)."
if [ ! -f "$REPO_ADDITIONS_FILE" ] || [ ! -f "$REPO_DIR/scripts/catalog/insert-catalog-additions.ts" ]; then
  echo "refusing: run this script from the branch checkout (additions file or script missing under $REPO_DIR)" >&2
  exit 1
fi
PF_RC=0
run_ts_in "$REPO_DIR" scripts/catalog/insert-catalog-additions.ts --file "$REPO_ADDITIONS_FILE" --expect-db "$EXPECTED_DB" --preflight || PF_RC=$?
if [ "$PF_RC" -ne 0 ]; then
  echo "refusing: preflight exited $PF_RC (5 = would refuse; see the message above). Nothing has been changed." >&2
  exit 1
fi
else
echo "skipping steps 1 and 1b (--from $FROM)"
fi

# --- 2. apply 0060 ----------------------------------------------------------
if run_step 2; then
HAS_COL="$(with_pg_env "$PGBIN/psql" -X -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM information_schema.columns WHERE table_name = 'sub_competencies' AND column_name = 'foundational';")"
if [ "$HAS_COL" = "1" ]; then
  if with_pg_env "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -f "$VERIFY_SQL" >/dev/null 2>&1; then
    echo "step 2 skipped: 0060 is already applied (foundational column exists and the verify file passes)"
  else
    echo "refusing: the foundational column exists but the verify file does not pass - 0060 is partly or wrongly applied. Run step 3's verify output by hand (psql -f $VERIFY_SQL) and decide; nothing was changed." >&2
    exit 1
  fi
else
  confirm "2. apply migration 0060" "Apply drizzle/0060_catalog_foundationals.sql to $EXPECTED_DB (one transaction, 5s lock timeout, refuses if already applied). The running app is not stopped; the old build keeps working."
  with_pg_env "$PGBIN/psql" -X -v ON_ERROR_STOP=1 -f "$MIGRATION_SQL"
fi
fi

# --- 3. verify --------------------------------------------------------------
if run_step 3; then
confirm "3. verify 0060" "Run 2026-10-19-ca-verify.sql (read-only, fails closed on the first wrong check)."
with_pg_env "$PGBIN/psql" -X -v ON_ERROR_STOP=1 -f "$VERIFY_SQL"
fi

# --- 4. reliability decision (owner) ----------------------------------------
if run_step 4; then
confirm "4. OWNER DECISION: reliability check" "The coverage and capture prompts changed. Run \`pnpm reliability:check\` (paid; it calls the real provider) before deploying, or record why it was skipped. This script does NOT run it. Run it yourself in another terminal now if you want it, or note the reason for skipping; then answer yes to continue."
fi

# --- 5. deploy --------------------------------------------------------------
if run_step 5; then
confirm "5. deploy the build" "This script does NOT deploy. The owner (or the controller with the owner's yes) runs these commands, in order, in another terminal:
  SHA=<the 40-character SHA of the commit to deploy>
  [ \${#SHA} -eq 40 ] || { echo 'SHA must be 40 characters'; exit 1; }
  git push origin \"\$SHA:main\"
  cd $DEPLOY_DIR && git pull -q --ff-only origin main
  [ \"\$(git rev-parse HEAD)\" = \"\$SHA\" ] || echo 'HEAD does not equal SHA - STOP'
  pnpm -s build
  launchctl kickstart -k gui/\$(id -u)/com.gc.curriculum-tool
Answer yes when they have all run; step 5b verifies the result."
read -r -p "Deployed SHA (40 characters): " EXPECTED_SHA
if [ "${#EXPECTED_SHA}" -ne 40 ]; then
  echo "refusing: SHA must be 40 characters" >&2
  exit 1
fi
ACTUAL_SHA="$(git -C "$DEPLOY_DIR" rev-parse HEAD)"
if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
  echo "refusing: $DEPLOY_DIR HEAD is $ACTUAL_SHA, expected $EXPECTED_SHA" >&2
  exit 1
fi
for f in drizzle/0060_catalog_foundationals.sql scripts/catalog/insert-catalog-additions.ts \
  docs/superpowers/specs/2026-10-19-catalog-additions.json docs/superpowers/specs/2026-10-15-bundle-cards.json; do
  if [ ! -f "$DEPLOY_DIR/$f" ]; then
    echo "refusing: $DEPLOY_DIR/$f is missing - the new build is not deployed" >&2
    exit 1
  fi
done
CODE=""
for _try in 1 2 3 4 5 6; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/ || true)"
  [ "$CODE" = "200" ] && break
  sleep 5
done
if [ "$CODE" != "200" ]; then
  echo "refusing: app did not answer 200 on :3000 within ~30 s (last: ${CODE:-none})" >&2
  exit 1
fi
echo "deploy verified: HEAD=$ACTUAL_SHA, files present, app answers 200"
fi

# --- 6. insert catalog additions --------------------------------------------
if run_step 6; then
confirm "6a. insert additions - DRY RUN" "insert-catalog-additions.ts --file $ADDITIONS_FILE --expect-db $EXPECTED_DB (dry run, writes nothing). Read the output before approving the apply."
DRY_RC=0
run_ts scripts/catalog/insert-catalog-additions.ts --file "$ADDITIONS_FILE" --expect-db "$EXPECTED_DB" || DRY_RC=$?
if [ "$DRY_RC" -ne 0 ]; then
  echo "refusing: the dry run exited $DRY_RC (5 = WOULD REFUSE, see the message above; the apply would fail the same way). Nothing was written." >&2
  exit 1
fi
confirm "6b. insert additions - APPLY" "Same command with --apply (one transaction)."
run_ts scripts/catalog/insert-catalog-additions.ts --file "$ADDITIONS_FILE" --expect-db "$EXPECTED_DB" --apply
echo
echo "NOTE: from this point EVERY capture snapshot shows as stale on /program (the new"
echo "competencies are unscored). The /program \"Score N stale snapshots\" button would"
echo "start the PAID rescoring. Run the cost estimate first and do NOT press that button"
echo "until you have."
fi

# --- 7. cards (only after the owner sets _approval) -------------------------
if run_step 7; then
confirm "7. apply the bundle cards" "Only after YOU have approved the drafted problem-solving card. Set _approval in the DEPLOY checkout copy of the cards file: $CARDS_FILE (or merge a commit carrying it and redeploy). draft-bundle-cards.ts refuses an empty _approval."
read -r -p "Your name for --confirmed-by: " CONFIRMED_BY
if [ -z "$CONFIRMED_BY" ]; then
  echo "refusing: --confirmed-by name is empty" >&2
  exit 1
fi
run_ts scripts/catalog/draft-bundle-cards.ts --apply --file "$CARDS_FILE" --confirmed-by "$CONFIRMED_BY" --expect-db "$EXPECTED_DB"
fi

# --- 8. problem-solving wiki page -------------------------------------------
if run_step 8; then
confirm "8. problem-solving wiki page" "write-problem-solving-page.ts --apply --expect-db $EXPECTED_DB: renders competencies/problem-solving.md and commits and pushes it to the wiki repo."
# The page writer loads no app env: pass the wiki settings from the deploy env (each only if set).
RUN_TS_ENV="WIKI_REPO_PATH WIKI_REMOTE WIKI_BRANCH" run_ts scripts/wiki/write-problem-solving-page.ts --expect-db "$EXPECTED_DB" --apply
fi

# --- 9. note ----------------------------------------------------------------
echo
echo "Done. Coverage rescoring for the new competencies is a separate paid step — estimate first."
echo "WARNING: every snapshot shows as stale on /program from step 6 on, and the"
echo "\"Score N stale snapshots\" button there would start the paid rescoring. Run the"
echo "cost estimate first and avoid that button until then."
echo "Then update docs/STATE.md: catalog foundationals applied (date, owner go-ahead, backup path: ${DUMP_FILE:-<no backup taken this run; see the earlier run>})."
