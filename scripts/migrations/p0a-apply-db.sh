#!/usr/bin/env bash
# p0a-apply-db.sh <expected_db_name> <backup_dir> {apply|rollback}
#
# The DB half of the P0a live-apply runbook (I-1, adversarial review
# 2026-10-11, round 2). Guards the connection, takes and verifies a backup,
# then applies (or rolls back) migration 0056 — for apply, also fails
# closed if the verify script finds anything wrong. Scratch-rehearsed by
# tests/db/p0a-apply-db.test.ts; the owner-run wrapper
# 2026-10-11-p0a-live-apply.sh is what stops/starts the app around this.
#
# DATABASE_URL is read from the ENVIRONMENT, not argv (M-e, round 2: a URL
# passed as a command-line argument is visible to any local user via
# `ps -ww` for as long as this process runs). It is parsed once into the
# standard libpq PG* environment variables (PGHOST/PGPORT/PGDATABASE/
# PGUSER/PGPASSWORD) and then unset; every psql/pg_dump call below takes no
# connection argument at all, so neither this script's own argv nor any
# child process's argv ever carries the URL or the password. `umask 077`
# is set before anything is created, so the backup directory and the dump
# file are private from the moment they exist (chmod 600 on the dump file
# below is defense in depth, not the only protection).
#
# Resolves its sibling SQL files relative to this script's own location,
# not the caller's cwd.
set -euo pipefail
umask 077

PGBIN=/Applications/Postgres.app/Contents/Versions/17/bin
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATION_SQL="$ROOT/drizzle/0056_competency_catalog_p0a.sql"
ROLLBACK_SQL="$SCRIPT_DIR/2026-10-11-p0a-rollback.sql"
VERIFY_SQL="$SCRIPT_DIR/2026-10-11-p0a-verify.sql"
VERIFY_BACKUP_SH="$SCRIPT_DIR/p0a-verify-backup.sh"

if [ "$#" -ne 3 ]; then
  echo "usage: DATABASE_URL=postgres://... $0 <expected_db_name> <backup_dir> {apply|rollback}" >&2
  exit 2
fi

EXPECTED_DB="$1"
BACKUP_DIR="$2"
MODE="$3"

case "$MODE" in
  apply|rollback) ;;
  *) echo "mode must be 'apply' or 'rollback', got: '$MODE'" >&2; exit 2 ;;
esac

if [ -z "${DATABASE_URL:-}" ]; then
  echo "refusing: DATABASE_URL is not set in the environment; nothing touched" >&2
  exit 2
fi

# --- 0. Move the URL out of argv-visible territory into libpq's PG* env ----
# bash 3.2 compatible (no mapfile/readarray): one `read` per line, in the
# fixed order node prints them.
{
  IFS= read -r PGHOST
  IFS= read -r PGPORT
  IFS= read -r PGDATABASE
  IFS= read -r PGUSER
  IFS= read -r PGPASSWORD
} < <(node -e '
  const u = new URL(process.argv[1]);
  const lines = [
    u.hostname,
    u.port || "5432",
    decodeURIComponent(u.pathname.replace(/^\//, "")),
    decodeURIComponent(u.username),
    decodeURIComponent(u.password),
  ];
  process.stdout.write(lines.join("\n") + "\n");
' "$DATABASE_URL")
export PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD
unset DATABASE_URL

PSQL=("$PGBIN/psql" -X -v ON_ERROR_STOP=1)

# --- 1. Guard: connected to the expected database ---------------------------
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
"$PGBIN/pg_dump" -Fc --no-owner -f "$DUMP_FILE"
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

# --- 5. Apply mode only: verify, FAILING CLOSED (M-a, round 2) ---------------
# Round-1 used `done < <(psql ...)` (process substitution): a failing psql
# inside it is invisible to `set -e`/pipefail, so a mid-script SQL error (or
# a dropped connection) silently produced zero parsed rows and exit 0 —
# reproduced by the round-2 reviewer. Capturing into a plain variable
# (`VERIFY_OUT="$(...)"`) makes a failing psql fail the whole script under
# `set -e`, same as every other step here. Also: (a) require exactly the 18
# rows the verify SQL prints, not "zero rows is fine"; (b) the "(expect 0"
# check (no trailing paren) so it also catches "(expect 0 right after
# apply)", which "(expect 0)" alone missed; (c) the three "(expect ="
# equality rows against the value they're supposed to equal, not just the
# literal "(expect 0" rows.
if [ "$MODE" = apply ]; then
  VERIFY_OUT="$("${PSQL[@]}" -At -F'|' -f "$VERIFY_SQL")"

  LINE_COUNT=0
  FAILED=0
  SUB_TOTAL=""
  STC_ROWS=""
  REQUIREMENTS_VAL=""
  SCC_ROWS_OLD_VAL=""
  TARGET_COV_ROWS_OLD_VAL=""
  while IFS='|' read -r ITEM VALUE; do
    # Skip psql's own command-tag lines (BEGIN/ROLLBACK from the verify SQL's
    # transaction control) — every real data row has a non-empty VALUE.
    [ -z "$ITEM" ] && continue
    [ -z "$VALUE" ] && continue
    LINE_COUNT=$((LINE_COUNT + 1))
    echo "$ITEM: $VALUE"
    case "$ITEM" in
      "sub_competencies total") SUB_TOTAL="$VALUE" ;;
      "snapshot_target_coverage rows") STC_ROWS="$VALUE" ;;
      "requirements (expect = sub_competencies total)") REQUIREMENTS_VAL="$VALUE" ;;
      "snapshot_competency_coverage rows (expect = old)") SCC_ROWS_OLD_VAL="$VALUE" ;;
      "target_coverage rows (expect = old)") TARGET_COV_ROWS_OLD_VAL="$VALUE" ;;
    esac
    if [[ "$ITEM" == *"(expect 0"* ]] && [ "$VALUE" != "0" ]; then
      echo "VERIFY FAILED: $ITEM = $VALUE" >&2
      FAILED=1
    fi
  done <<<"$VERIFY_OUT"

  if [ "$LINE_COUNT" -ne 18 ]; then
    echo "VERIFY FAILED: expected 18 verify rows, got $LINE_COUNT — psql may have failed partway or the connection dropped" >&2
    FAILED=1
  fi
  if [ -z "$SUB_TOTAL" ] || [ "$REQUIREMENTS_VAL" != "$SUB_TOTAL" ]; then
    echo "VERIFY FAILED: requirements ($REQUIREMENTS_VAL) != sub_competencies total ($SUB_TOTAL)" >&2
    FAILED=1
  fi
  if [ -z "$STC_ROWS" ] || [ "$SCC_ROWS_OLD_VAL" != "$STC_ROWS" ]; then
    echo "VERIFY FAILED: snapshot_competency_coverage rows ($SCC_ROWS_OLD_VAL) != snapshot_target_coverage rows ($STC_ROWS)" >&2
    FAILED=1
  fi
  if [ -z "$STC_ROWS" ] || [ "$TARGET_COV_ROWS_OLD_VAL" != "$STC_ROWS" ]; then
    echo "VERIFY FAILED: target_coverage rows ($TARGET_COV_ROWS_OLD_VAL) != snapshot_target_coverage rows ($STC_ROWS)" >&2
    FAILED=1
  fi

  if [ "$FAILED" != "0" ]; then
    echo "refusing: verify found a problem above; the migration already committed — do not deploy, see above" >&2
    exit 1
  fi
fi

echo "p0a-apply-db.sh: $MODE on '$EXPECTED_DB' complete"
