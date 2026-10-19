#!/usr/bin/env bash
# 2026-10-19-ca-live-apply.sh
#
# OWNER-RUN. Live-apply runbook for migration 0060 (catalog foundationals,
# derived scoring) and the data steps that follow it. Every step prints what
# it will do and waits for `type yes`. Never echoes DATABASE_URL.
#
# Order (global-constraints Review Focus 5 — the schema must be in place
# BEFORE the code that names the new columns is deployed):
#   1 backup -> 2 apply 0060 -> 3 verify -> 4 reliability decision
#   -> 5 deploy build -> 6 insert additions (dry run, then apply)
#   -> 7 card apply (only after the owner sets _approval)
#   -> 8 problem-solving page -> 9 rescoring note
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
# otherwise restore the step-1 dump.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="${CA_LIVE_APPLY_DEPLOY_DIR:-/Users/admin/projects/curriculum_developer-deploy}"
READ_ENV_MJS="${CA_LIVE_APPLY_READ_ENV_MJS:-$HOME/.claude/dashboard/read-env.mjs}"
BACKUP_DIR="${CA_LIVE_APPLY_BACKUP_DIR:-$HOME/.local/share/gc-curriculum-tool/ca}"
EXPECTED_DB="gc_curriculum"
PGBIN=/Applications/Postgres.app/Contents/Versions/17/bin
MIGRATION_SQL="$SCRIPT_DIR/../../drizzle/0060_catalog_foundationals.sql"
VERIFY_SQL="$SCRIPT_DIR/2026-10-19-ca-verify.sql"
ADDITIONS_FILE="$DEPLOY_DIR/docs/superpowers/specs/2026-10-19-catalog-additions.json"
CARDS_FILE="$DEPLOY_DIR/docs/superpowers/specs/2026-10-15-bundle-cards.json"
# shellcheck source=./p0a-lib.sh
. "$SCRIPT_DIR/p0a-lib.sh"

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
    DATABASE_URL="$(node "$READ_ENV_MJS" "$DEPLOY_DIR" DATABASE_URL)"
    p0a_url_to_pg_env
    ACTUAL_DB="$("$PGBIN/psql" -X -At -v ON_ERROR_STOP=1 -c "SELECT current_database();")"
    if [ "$ACTUAL_DB" != "$EXPECTED_DB" ]; then
      echo "refusing: connected to database '$ACTUAL_DB', expected '$EXPECTED_DB'" >&2
      exit 1
    fi
    "$@"
  )
}

# Run a TypeScript script from the deploy checkout with DATABASE_URL in its
# environment only (never argv). --expect-db is supplied by the caller.
run_ts() {
  (
    cd "$DEPLOY_DIR"
    # Assign first (plain assignment, so set -e trips if read-env fails).
    u="$(node "$READ_ENV_MJS" "$DEPLOY_DIR" DATABASE_URL)"
    if [ -z "$u" ]; then
      echo "refusing: DATABASE_URL came back empty" >&2
      exit 1
    fi
    DATABASE_URL="$u" pnpm exec tsx "$@"
  )
}

# --- 1. backup -------------------------------------------------------------
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

# --- 2. apply 0060 ----------------------------------------------------------
confirm "2. apply migration 0060" "Apply drizzle/0060_catalog_foundationals.sql to $EXPECTED_DB (one transaction, 5s lock timeout, refuses if already applied). The running app is not stopped; the old build keeps working."
with_pg_env "$PGBIN/psql" -X -v ON_ERROR_STOP=1 -f "$MIGRATION_SQL"

# --- 3. verify --------------------------------------------------------------
confirm "3. verify 0060" "Run 2026-10-19-ca-verify.sql (read-only, fails closed on the first wrong check)."
with_pg_env "$PGBIN/psql" -X -v ON_ERROR_STOP=1 -f "$VERIFY_SQL"

# --- 4. reliability decision (owner) ----------------------------------------
confirm "4. OWNER DECISION: reliability check" "The coverage and capture prompts changed. Run \`pnpm reliability:check\` (paid; it calls the real provider) before deploying, or record why it was skipped. This script does NOT run it. Run it yourself in another terminal now if you want it, or note the reason for skipping; then answer yes to continue."

# --- 5. deploy --------------------------------------------------------------
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

# --- 6. insert catalog additions --------------------------------------------
confirm "6a. insert additions - DRY RUN" "insert-catalog-additions.ts --file $ADDITIONS_FILE --expect-db $EXPECTED_DB (dry run, writes nothing). Read the output before approving the apply."
run_ts scripts/catalog/insert-catalog-additions.ts --file "$ADDITIONS_FILE" --expect-db "$EXPECTED_DB"
confirm "6b. insert additions - APPLY" "Same command with --apply (one transaction)."
run_ts scripts/catalog/insert-catalog-additions.ts --file "$ADDITIONS_FILE" --expect-db "$EXPECTED_DB" --apply

# --- 7. cards (only after the owner sets _approval) -------------------------
confirm "7. apply the bundle cards" "Only after YOU have approved the drafted problem-solving card. Set _approval in the DEPLOY checkout copy of the cards file: $CARDS_FILE (or merge a commit carrying it and redeploy). draft-bundle-cards.ts refuses an empty _approval."
read -r -p "Your name for --confirmed-by: " CONFIRMED_BY
if [ -z "$CONFIRMED_BY" ]; then
  echo "refusing: --confirmed-by name is empty" >&2
  exit 1
fi
run_ts scripts/catalog/draft-bundle-cards.ts --apply --file "$CARDS_FILE" --confirmed-by "$CONFIRMED_BY" --expect-db "$EXPECTED_DB"

# --- 8. problem-solving wiki page -------------------------------------------
confirm "8. problem-solving wiki page" "write-problem-solving-page.ts --apply --expect-db $EXPECTED_DB: renders competencies/problem-solving.md and commits and pushes it to the wiki repo."
run_ts scripts/wiki/write-problem-solving-page.ts --expect-db "$EXPECTED_DB" --apply

# --- 9. note ----------------------------------------------------------------
echo
echo "Done. Coverage rescoring for the new competencies is a separate paid step — estimate first."
echo "Then update docs/STATE.md: catalog foundationals applied (date, owner go-ahead, backup path: $DUMP_FILE)."
