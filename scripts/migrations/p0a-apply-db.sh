#!/usr/bin/env bash
# p0a-apply-db.sh <expected_db_name> <database_url> <backup_dir> {apply|rollback}
#
# The DB half of the P0a live-apply runbook (I-1, adversarial review
# 2026-10-11). Guards the connection, takes and verifies a backup, then
# applies (or rolls back) migration 0056 — for apply, also fails if the
# verify script finds anything wrong. Scratch-rehearsed by
# tests/db/p0a-apply-db.test.ts; the owner-run wrapper
# 2026-10-11-p0a-live-apply.sh is what stops/starts the app around this.
#
# Never echoes <database_url>. Resolves its sibling SQL files relative to
# this script's own location, not the caller's cwd.
set -euo pipefail

PGBIN=/Applications/Postgres.app/Contents/Versions/17/bin
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATION_SQL="$ROOT/drizzle/0056_competency_catalog_p0a.sql"
ROLLBACK_SQL="$SCRIPT_DIR/2026-10-11-p0a-rollback.sql"
VERIFY_SQL="$SCRIPT_DIR/2026-10-11-p0a-verify.sql"
VERIFY_BACKUP_SH="$SCRIPT_DIR/p0a-verify-backup.sh"

if [ "$#" -ne 4 ]; then
  echo "usage: $0 <expected_db_name> <database_url> <backup_dir> {apply|rollback}" >&2
  exit 2
fi

EXPECTED_DB="$1"
DATABASE_URL="$2"
BACKUP_DIR="$3"
MODE="$4"

case "$MODE" in
  apply|rollback) ;;
  *) echo "mode must be 'apply' or 'rollback', got: '$MODE'" >&2; exit 2 ;;
esac

PSQL=("$PGBIN/psql" "$DATABASE_URL" -X -v ON_ERROR_STOP=1)

# --- 1. Guard: connected to the expected database --------------------------
ACTUAL_DB="$("${PSQL[@]}" -At -c "SELECT current_database();")"
if [ "$ACTUAL_DB" != "$EXPECTED_DB" ]; then
  echo "refusing: connected to database '$ACTUAL_DB', expected '$EXPECTED_DB'; nothing touched" >&2
  exit 1
fi

# --- 2. Guard: no other sessions on this database ---------------------------
OTHER_SESSIONS="$("${PSQL[@]}" -At -F'|' -c \
  "SELECT application_name, client_addr, state FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();")"
if [ -n "$OTHER_SESSIONS" ]; then
  echo "refusing: other sessions are connected to '$EXPECTED_DB' (application_name|client_addr|state); nothing touched:" >&2
  echo "$OTHER_SESSIONS" >&2
  exit 1
fi

# --- 3. Backup, verified before anything is applied --------------------------
mkdir -p "$BACKUP_DIR"
TIMESTAMP="$(date +%Y%m%dT%H%M%S)"
DUMP_FILE="$BACKUP_DIR/pre-$MODE-$TIMESTAMP.dump"
"$PGBIN/pg_dump" -Fc --no-owner -f "$DUMP_FILE" "$DATABASE_URL"
chmod 600 "$DUMP_FILE"

if ! "$VERIFY_BACKUP_SH" "$DUMP_FILE" "$MODE"; then
  echo "refusing: backup verification failed; nothing applied" >&2
  exit 1
fi

# --- 4. Apply or roll back — the SQL file itself is one BEGIN/COMMIT -----------
if [ "$MODE" = apply ]; then
  "${PSQL[@]}" -f "$MIGRATION_SQL"
else
  "${PSQL[@]}" -f "$ROLLBACK_SQL"
fi

# --- 5. Apply mode only: verify, failing on any non-zero "(expect 0)" row -----
if [ "$MODE" = apply ]; then
  FAILED=0
  while IFS='|' read -r ITEM VALUE; do
    [ -z "$ITEM" ] && continue
    echo "$ITEM: $VALUE"
    if [[ "$ITEM" == *"(expect 0)"* ]] && [ "$VALUE" != "0" ]; then
      echo "VERIFY FAILED: $ITEM = $VALUE" >&2
      FAILED=1
    fi
  done < <("${PSQL[@]}" -At -F'|' -f "$VERIFY_SQL")
  if [ "$FAILED" != "0" ]; then
    echo "refusing: verify found a non-zero 'expect 0' row above; the migration already committed — do not deploy, see the rows above" >&2
    exit 1
  fi
fi

echo "p0a-apply-db.sh: $MODE on '$EXPECTED_DB' complete"
