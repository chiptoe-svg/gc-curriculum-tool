#!/usr/bin/env bash
# p0b-apply-db.sh <expected_db_name> <backup_dir> apply
# p0b-apply-db.sh <expected_db_name> <backup_dir> rollback <pre-apply-dump-path>
#
# The DB half of the P0b live-apply runbook (task-8 brief,
# competency-catalog P0b plan) — sibling to p0a-apply-db.sh. Guards the
# connection, takes and verifies a backup, then either applies migration
# 0057 (apply) or restores a previously-taken pre-0057 dump by swapping in
# a freshly-restored database (rollback — fix round 1, see below).
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
#
# --- Fix round 1 (task-8 adversarial review): rollback no longer uses
# `pg_restore --clean` against the live database. A pre-0057 dump
# restored with --clean onto a POST-0057 database cannot work: 0057
# creates sub_competency_map with an FK to sub_competencies, and the
# pre-0057 dump has never heard of that table, so --clean's DROP of
# sub_competencies fails on the FK, the subsequent CREATE then says
# "already exists", COPY hits duplicate keys, and the database is left
# half-restored and inconsistent — reviewer-reproduced, Critical. Fixed
# per controller ruling: restore the dump into a brand-new, empty
# database (no FK conflicts possible — nothing exists yet), verify THAT
# database is genuinely the pre-0057 shape, then swap it into the live
# name by renaming two whole databases. The live database is never
# dropped or `--clean`ed; it is renamed aside (`<expected>_pre_rollback_
# <ts>`) and kept intact as the rollback's own undo path — renaming it
# back undoes the rollback. This also means the separate pre-restore
# safety dump this script used to take for rollback mode is redundant (a
# live, intact migrated database is a strictly better fallback than a
# dump file) and has been removed.
#
# --- Fix round 2 (task-8 adversarial re-review):
#   1. <expected_db_name> is checked against the allowlist in p0a-lib.sh
#      (p0b_check_allowed_db_name) BEFORE any connection is opened —
#      exactly "gc_curriculum", or the disposable
#      gc_curriculum_p0b_rbtest* real-DB-test fixture family. Nothing
#      else. This makes every SQL interpolation of $EXPECTED_DB below
#      provably safe even before the belt-and-braces psql `:"var"` /
#      `:'var'` quoting added in this round.
#   2. The three verification queries against the newly-restored database
#      (sub_competency_map / sub_competencies / snapshot_target_coverage)
#      now explicitly check for a query failure (a dropped connection, a
#      permissions problem, anything) and drop the new database before
#      exiting — round 1 let a query failure propagate through `set -e`
#      silently, with no message and no cleanup, leaking the
#      `_rollback_<ts>` database.
#   3. The "other sessions reconnected right before the rename" refusal
#      used to say the verified restore was "intact ... if you want to
#      retry" while also dropping it — fixed by actually keeping it (it
#      is still fully verified; there is no reason to throw it away over
#      a transient reconnect), matching the sibling rename-failure
#      message below, which was already consistent.
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
# BACKUP_DIR is only used by apply mode (the pre-apply-*.dump backup it
# takes before migrating). Rollback mode no longer needs a backup
# directory — see the fix-round-1 note above — but the argument stays
# positional and required in both modes for a uniform, simple call shape.
BACKUP_DIR="$2"
MODE="$3"
ROLLBACK_DUMP="${4:-}"

# --- fix round 2: the database-name allowlist lives HERE, not only in
# the TS test helpers that happen to call this script — checked before
# any connection, before even the mode-specific argument validation.
if ! p0b_check_allowed_db_name "$EXPECTED_DB"; then
  exit 1
fi

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
# is rejected before any session guard or restore is even attempted —
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

if [ "$MODE" = apply ]; then
  # --- 3. Backup the CURRENT (pre-0057) state, verified before anything is
  # applied ------------------------------------------------------------------
  mkdir -p "$BACKUP_DIR"
  TIMESTAMP="$(date +%Y%m%dT%H%M%S)"
  DUMP_FILE="$BACKUP_DIR/pre-$MODE-$TIMESTAMP.dump"
  "$PGBIN/pg_dump" -Fc --no-owner -f "$DUMP_FILE"
  chmod 600 "$DUMP_FILE"
  # Pre-0057: still carries snapshot_target_coverage (P0a scaffolding) — the
  # exact shape p0a-verify-backup.sh's "apply" check expects, and the dump
  # a later rollback would restore FROM (hence pre-apply-*.dump).
  if ! "$VERIFY_BACKUP_SH" "$DUMP_FILE" apply; then
    echo "refusing: backup verification failed; nothing applied" >&2
    exit 1
  fi
  echo "pre-apply backup of current state verified: $DUMP_FILE"

  # --- 4. Apply -----------------------------------------------------------
  "${PSQL[@]}" -f "$MIGRATION_SQL"

  # --- 5. Verify, FAILING CLOSED -------------------------------------------
  # 2026-10-12-p0b-verify.sql (unlike P0a's 2026-10-11-p0a-verify.sql) fails
  # closed on its own: `\set ON_ERROR_STOP on` plus a DO block that RAISEs
  # on the first failed check, inside BEGIN READ ONLY ... ROLLBACK — a
  # failure makes psql itself exit non-zero. There is no 18-row parsing to
  # replicate here (that was P0a's M-a fix, round 2, for a verify script
  # that only printed numbers); just distinguish "committed but verify
  # failed" (exit 4, matching p0a-apply-db.sh's M-i convention so the
  # wrapper's existing reporting logic — which already special-cases exit 4
  # as "never say SAFE" — keeps working unchanged) from a pre-commit guard
  # failure (exit 1).
  if ! "${PSQL[@]}" -f "$VERIFY_SQL"; then
    echo "refusing: verify found a problem above; the migration already committed — do not deploy, see above" >&2
    exit 4
  fi
else
  # --- Rollback (fix round 1): restore into a brand-new database, verify
  # THAT database, then swap it in by renaming. Never touches the live
  # database's own tables directly — see the header note for why.
  #
  # Fix round 3: no literal "T" separator (unlike the apply-mode dump
  # filename's TIMESTAMP above) — these two generated names are DATABASE
  # names, and the test-side isP0bRollbackTestDb() guard that recognizes
  # this family now matches the production allowlist regex EXACTLY
  # (^gc_curriculum_p0b_rbtest[a-z0-9_]*$, case-sensitive, no uppercase
  # letters). An uppercase "T" here would make every real rollback-
  # generated database name invisible to that guard — discovered by
  # actually running the real-DB test after making that change, which
  # failed and leaked a database on the server, exactly the kind of gap
  # this fix round's own leak-sweep (Minor 4, round 2) exists to close.
  ROLLBACK_TS="$(date +%Y%m%d%H%M%S)"
  ROLLBACK_DB_NAME="${EXPECTED_DB}_rollback_${ROLLBACK_TS}"
  PRE_ROLLBACK_NAME="${EXPECTED_DB}_pre_rollback_${ROLLBACK_TS}"

  # Fix round 2: every identifier below goes through psql's own `:"var"`
  # (quoted identifier) or `:'var'` (quoted literal) substitution, via
  # `-v name=value`, instead of raw bash string interpolation into SQL
  # text — belt-and-braces on top of the allowlist check above, which
  # already makes injection structurally impossible ($EXPECTED_DB can
  # only be "gc_curriculum" or match ^gc_curriculum_p0b_rbtest[a-z0-9_]*$,
  # and $ROLLBACK_DB_NAME/$PRE_ROLLBACK_NAME are built from that plus a
  # fixed suffix and a numeric timestamp). psql only expands `:'var'`/
  # `:"var"` when reading SQL as a SCRIPT, not from `-c` — confirmed
  # empirically (a `-c` string with `:"var"` raises a syntax error) — so
  # every one of these goes through `-f -` with the SQL on a bash
  # here-string instead of `-c "...interpolated by bash..."`.
  drop_rollback_db() {
    "${PSQL[@]}" -d postgres -v dbname="$ROLLBACK_DB_NAME" -f - >/dev/null 2>&1 <<< 'DROP DATABASE IF EXISTS :"dbname"' || true
  }

  echo "=== 3. creating $ROLLBACK_DB_NAME and restoring $ROLLBACK_DUMP into it (no --clean: it's empty, so there is nothing for an FK to conflict with) ==="
  "${PSQL[@]}" -d postgres -v dbname="$ROLLBACK_DB_NAME" -f - <<< 'CREATE DATABASE :"dbname"'
  if ! "$PGBIN/pg_restore" --no-owner -d "$ROLLBACK_DB_NAME" "$ROLLBACK_DUMP"; then
    echo "refusing: restore into $ROLLBACK_DB_NAME failed; dropping it; live database '$EXPECTED_DB' was never touched" >&2
    drop_rollback_db
    exit 1
  fi

  echo "=== verifying $ROLLBACK_DB_NAME is genuinely pre-0057 before it goes anywhere near the live name ==="
  # Fix round 2 (Minor 5): round 1 let a query failure here (a dropped
  # connection, a permissions problem, anything) propagate through
  # `set -e` silently — no message, no cleanup — leaking the
  # just-created $ROLLBACK_DB_NAME. Each query is now checked explicitly;
  # a failure prints why, drops the new database, and exits 1. Live is
  # untouched in every case here — nothing has renamed anything yet.
  if ! HAS_MAP="$("${PSQL[@]}" -d "$ROLLBACK_DB_NAME" -At -c "SELECT to_regclass('public.sub_competency_map') IS NOT NULL;")"; then
    echo "refusing: could not query $ROLLBACK_DB_NAME to verify it (sub_competency_map check failed, or the connection dropped); dropping it; live database '$EXPECTED_DB' was never touched" >&2
    drop_rollback_db
    exit 1
  fi
  if ! SC_COUNT="$("${PSQL[@]}" -d "$ROLLBACK_DB_NAME" -At -c "SELECT count(*) FROM sub_competencies;")"; then
    echo "refusing: could not query $ROLLBACK_DB_NAME to verify it (sub_competencies count failed, or the connection dropped); dropping it; live database '$EXPECTED_DB' was never touched" >&2
    drop_rollback_db
    exit 1
  fi
  if ! STC_COUNT="$("${PSQL[@]}" -d "$ROLLBACK_DB_NAME" -At -c "SELECT count(*) FROM snapshot_target_coverage;")"; then
    echo "refusing: could not query $ROLLBACK_DB_NAME to verify it (snapshot_target_coverage count failed, or the connection dropped); dropping it; live database '$EXPECTED_DB' was never touched" >&2
    drop_rollback_db
    exit 1
  fi
  if [ "$HAS_MAP" != "f" ] || [ "$SC_COUNT" -eq 0 ] || [ "$STC_COUNT" -eq 0 ]; then
    echo "refusing: $ROLLBACK_DB_NAME failed verification (sub_competency_map exists=$HAS_MAP, sub_competencies=$SC_COUNT rows, snapshot_target_coverage=$STC_COUNT rows) — not a genuine pre-0057 restore; dropping it; live database '$EXPECTED_DB' was never touched" >&2
    drop_rollback_db
    exit 1
  fi
  echo "confirmed: $ROLLBACK_DB_NAME is pre-0057 (no sub_competency_map; $SC_COUNT sub_competencies rows; $STC_COUNT snapshot_target_coverage rows)"

  echo "=== 4. swapping '$EXPECTED_DB' <-> '$ROLLBACK_DB_NAME' ==="
  OTHER_SESSIONS2="$("${PSQL[@]}" -d postgres -v dbname="$EXPECTED_DB" -At -F'|' -f - <<< \
    "SELECT application_name, client_addr, state FROM pg_stat_activity WHERE datname = :'dbname' AND pid <> pg_backend_pid();")"
  if [ -n "$OTHER_SESSIONS2" ]; then
    # Fix round 2 (Minor 3): round 1 said the restore was "intact ... if
    # you want to retry" and then dropped it anyway. Fixed by actually
    # keeping it — it is already fully verified above, so there is no
    # reason to throw it away over a transient reconnect, matching the
    # sibling rename-failure message right below (which never dropped
    # anything and was already consistent).
    echo "refusing: other sessions reconnected to '$EXPECTED_DB' right before the rename (application_name|client_addr|state); nothing renamed, live database '$EXPECTED_DB' is untouched. The verified restore is intact at $ROLLBACK_DB_NAME if you want to retry:" >&2
    echo "$OTHER_SESSIONS2" >&2
    exit 1
  fi

  if ! "${PSQL[@]}" -d postgres -v old="$EXPECTED_DB" -v new="$PRE_ROLLBACK_NAME" -f - <<< 'ALTER DATABASE :"old" RENAME TO :"new"'; then
    echo "refusing: could not rename '$EXPECTED_DB' to '$PRE_ROLLBACK_NAME'; live database '$EXPECTED_DB' is untouched (still the migrated database, under its original name). The verified restore is intact at $ROLLBACK_DB_NAME if you want to retry." >&2
    exit 1
  fi

  if ! "${PSQL[@]}" -d postgres -v old="$ROLLBACK_DB_NAME" -v new="$EXPECTED_DB" -f - <<< 'ALTER DATABASE :"old" RENAME TO :"new"'; then
    echo "CRITICAL: renamed '$EXPECTED_DB' to '$PRE_ROLLBACK_NAME' but could NOT rename '$ROLLBACK_DB_NAME' to '$EXPECTED_DB' — '$EXPECTED_DB' does not currently exist on this server. Attempting the automatic fallback (rename the migrated database back)..." >&2
    if "${PSQL[@]}" -d postgres -v old="$PRE_ROLLBACK_NAME" -v new="$EXPECTED_DB" -f - <<< 'ALTER DATABASE :"old" RENAME TO :"new"'; then
      echo "fallback succeeded: '$PRE_ROLLBACK_NAME' renamed back to '$EXPECTED_DB' — live is untouched (still the migrated database). The verified restore remains intact at $ROLLBACK_DB_NAME; investigate by hand before retrying." >&2
      exit 5
    else
      echo "FALLBACK FAILED TOO: '$EXPECTED_DB' does not exist under ANY name right now. Fix this by hand immediately — connect to the 'postgres' maintenance database and run:" >&2
      echo "  ALTER DATABASE \"$PRE_ROLLBACK_NAME\" RENAME TO \"$EXPECTED_DB\";" >&2
      exit 6
    fi
  fi

  echo "swap complete: '$EXPECTED_DB' is now the restored pre-0057 database."
  echo "The previous (migrated) database was kept, not dropped, as '$PRE_ROLLBACK_NAME' — this rollback is itself reversible. To undo it, connect to the 'postgres' maintenance database and run:"
  echo "  ALTER DATABASE \"$EXPECTED_DB\" RENAME TO \"$ROLLBACK_DB_NAME\";"
  echo "  ALTER DATABASE \"$PRE_ROLLBACK_NAME\" RENAME TO \"$EXPECTED_DB\";"
fi

echo "p0b-apply-db.sh: $MODE on '$EXPECTED_DB' complete"
