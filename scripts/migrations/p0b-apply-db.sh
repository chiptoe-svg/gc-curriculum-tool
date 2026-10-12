#!/usr/bin/env bash
# p0b-apply-db.sh <expected_db_name> <backup_dir> apply
# p0b-apply-db.sh <expected_db_name> <backup_dir> rollback <pre-apply-dump-path>
#
# The DB half of the P0b live-apply runbook (task-8 brief,
# competency-catalog P0b plan) — sibling to p0a-apply-db.sh. Guards the
# connection, takes and verifies a backup, then either applies migration
# 0057 (apply) or restores a previously-taken pre-0057 dump via pg_restore
# (rollback). P0b has no hand-written rollback SQL: 0057 drops P0a's
# scaffolding tables (snapshot_target_coverage, coverage_scores) outright,
# so a reverse migration would have to resynthesize data it never kept —
# restoring the pre-apply backup instead is both simpler and exact
# (task-8 brief Resolution 3).
#
# DATABASE_URL is read from the ENVIRONMENT, not argv — same discipline as
# p0a-apply-db.sh (M-e/M-j): a URL on argv is visible to any local user via
# `ps -ww` for as long as this process runs. It is parsed once via the
# shared p0a-lib.sh into the standard libpq PG* environment variables and
# then unset; every psql/pg_dump/pg_restore call below takes no connection
# argument, so neither this script's own argv, nor any child's, ever
# carries the URL or the password. `umask 077` is set before anything is
# created, so the backup directory and dump files are private from the
# moment they exist (chmod 600 below is defense in depth).
#
# Resolves its sibling SQL files relative to this script's own location,
# not the caller's cwd.
set -euo pipefail
umask 077

PGBIN=/Applications/Postgres.app/Contents/Versions/17/bin
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATION_SQL="$ROOT/drizzle/0057_competency_catalog_p0b.sql"
VERIFY_SQL="$SCRIPT_DIR/2026-10-12-p0b-verify.sql"
VERIFY_BACKUP_SH="${P0B_APPLY_DB_VERIFY_BACKUP_SH:-$SCRIPT_DIR/p0a-verify-backup.sh}"
# shellcheck source=./p0a-lib.sh
. "$SCRIPT_DIR/p0a-lib.sh"

if [ "$#" -lt 3 ] || [ "$#" -gt 4 ]; then
  echo "usage: DATABASE_URL=postgres://... $0 <expected_db_name> <backup_dir> apply" >&2
  echo "       DATABASE_URL=postgres://... $0 <expected_db_name> <backup_dir> rollback <pre-apply-dump-path>" >&2
  exit 2
fi

EXPECTED_DB="$1"
BACKUP_DIR="$2"
MODE="$3"
ROLLBACK_DUMP="${4:-}"

case "$MODE" in
  apply)
    if [ -n "$ROLLBACK_DUMP" ]; then
      echo "usage: apply mode takes no 4th argument (got '$ROLLBACK_DUMP')" >&2
      exit 2
    fi
    ;;
  rollback)
    if [ -z "$ROLLBACK_DUMP" ]; then
      echo "usage: rollback mode requires <pre-apply-dump-path> as the 4th argument" >&2
      exit 2
    fi
    ;;
  *) echo "mode must be 'apply' or 'rollback', got: '$MODE'" >&2; exit 2 ;;
esac

# --- rollback mode: validate the ROLLBACK TARGET dump FIRST, before this
# script ever touches DATABASE_URL or opens a connection (task-8 brief
# Resolution 3). These are pure filesystem/subprocess checks, so a bad dump
# is rejected before any session guard or backup is even attempted —
# nothing about the live database needs to be true for these to run, and
# nothing about the live database is touched if they fail.
if [ "$MODE" = rollback ]; then
  DUMP_BASENAME="$(basename "$ROLLBACK_DUMP")"
  case "$DUMP_BASENAME" in
    pre-apply-*.dump) ;;
    *)
      echo "refusing: rollback dump '$ROLLBACK_DUMP' (basename '$DUMP_BASENAME') does not match pre-apply-*.dump — refusing to restore a dump that wasn't produced by this runbook's own apply-mode backup step; nothing touched" >&2
      exit 1
      ;;
  esac
  # p0a-verify-backup.sh's unconditional REQUIRED_TABLES (sub_competencies,
  # snapshot_target_coverage) are exactly the pre-0057 shape: both exist
  # before 0057 runs, and snapshot_target_coverage is DROPPED by 0057 — so
  # a dump with real TABLE DATA for both is necessarily pre-0057. Called
  # with mode "apply" (not "rollback"): p0a-verify-backup.sh's rollback
  # mode additionally requires career_target_requirements and
  # snapshot_competency_coverage, which is P0a's own rollback-shape check
  # and not what distinguishes pre/post-0057.
  if ! "$VERIFY_BACKUP_SH" "$ROLLBACK_DUMP" apply; then
    echo "refusing: rollback dump '$ROLLBACK_DUMP' failed backup verification — must carry real TABLE DATA for sub_competencies and snapshot_target_coverage (i.e. be a genuine pre-0057 dump); nothing touched" >&2
    exit 1
  fi
  echo "confirmed: rollback dump '$ROLLBACK_DUMP' matches pre-apply-*.dump and passes backup verification (pre-0057 shape)"
fi

# --- 0. Move the URL out of argv-visible territory into libpq's PG* env ----
p0a_url_to_pg_env

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

# --- 3. Backup the CURRENT state, verified before anything is applied -------
mkdir -p "$BACKUP_DIR"
TIMESTAMP="$(date +%Y%m%dT%H%M%S)"
DUMP_FILE="$BACKUP_DIR/pre-$MODE-$TIMESTAMP.dump"
"$PGBIN/pg_dump" -Fc --no-owner -f "$DUMP_FILE"
chmod 600 "$DUMP_FILE"

if [ "$MODE" = apply ]; then
  # Pre-0057: still carries snapshot_target_coverage (P0a scaffolding) — the
  # exact shape p0a-verify-backup.sh's "apply" check expects, and the dump
  # a later rollback would restore FROM (hence pre-apply-*.dump).
  if ! "$VERIFY_BACKUP_SH" "$DUMP_FILE" apply; then
    echo "refusing: backup verification failed; nothing applied" >&2
    exit 1
  fi
else
  # Pre-restore safety net (task-8 brief Resolution 3): this backup's only
  # job is to make the restore itself reversible, so it is NOT required to
  # match any particular pre/post-0057 shape — the live DB could genuinely
  # be in EITHER shape depending on what is being rolled back from.
  # p0a-verify-backup.sh unconditionally requires snapshot_target_coverage
  # TABLE DATA (a table 0057 drops), so it cannot validate a dump of a
  # post-0057 database; do the two schema-agnostic checks (non-empty, a
  # real pg_restore-readable archive) directly instead of calling it.
  if [ ! -s "$DUMP_FILE" ]; then
    echo "refusing: pre-restore safety backup $DUMP_FILE is missing or empty; nothing restored" >&2
    exit 1
  fi
  if ! "$PGBIN/pg_restore" --list "$DUMP_FILE" >/dev/null 2>&1; then
    echo "refusing: pre-restore safety backup $DUMP_FILE is not a readable pg_dump archive; nothing restored" >&2
    exit 1
  fi
fi
echo "pre-$MODE backup of current state verified: $DUMP_FILE"

# --- 4. Apply or roll back ---------------------------------------------------
if [ "$MODE" = apply ]; then
  "${PSQL[@]}" -f "$MIGRATION_SQL"
else
  "$PGBIN/pg_restore" --clean --if-exists --no-owner -d "$EXPECTED_DB" "$ROLLBACK_DUMP"
fi

# --- 5. Apply mode only: verify, FAILING CLOSED ------------------------------
# 2026-10-12-p0b-verify.sql (unlike P0a's 2026-10-11-p0a-verify.sql) fails
# closed on its own: `\set ON_ERROR_STOP on` plus a DO block that RAISEs on
# the first failed check, inside BEGIN READ ONLY ... ROLLBACK — a failure
# makes psql itself exit non-zero. There is no 18-row parsing to replicate
# here (that was P0a's M-a fix, round 2, for a verify script that only
# printed numbers); just distinguish "committed but verify failed" (exit 4,
# matching p0a-apply-db.sh's M-i convention so the wrapper's existing
# reporting logic — which already special-cases exit 4 as "never say SAFE"
# — keeps working unchanged) from a pre-commit guard failure (exit 1).
if [ "$MODE" = apply ]; then
  if ! "${PSQL[@]}" -f "$VERIFY_SQL"; then
    echo "refusing: verify found a problem above; the migration already committed — do not deploy, see above" >&2
    exit 4
  fi
fi

echo "p0b-apply-db.sh: $MODE on '$EXPECTED_DB' complete"
