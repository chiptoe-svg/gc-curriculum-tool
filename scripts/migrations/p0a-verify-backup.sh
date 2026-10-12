#!/usr/bin/env bash
# p0a-verify-backup.sh <dump_file> {apply|rollback}
#
# Verifies a pg_dump -Fc backup is real before p0a-apply-db.sh (I-1) applies
# or rolls back anything: the file must be non-empty, pg_restore --list must
# succeed on it, and it must list TABLE DATA (not just a schema entry — M-d,
# round 2: a schema-only `-s` dump lists the table but carries no rows, and
# the round-1 grep for "TABLE public <t>" passed it) for the tables the
# given mode needs to have existed beforehand. Exits non-zero (with a
# message on stderr) on any failure; this is the exact gap the round-1
# adversarial review reproduced — a `pg_dump | gzip > file` pipeline
# without pipefail can exit 0 with a valid, empty 20-byte gzip. Pure and
# side-effect-free (reads the file, nothing else), so it is unit-testable
# on its own against a crafted bad dump file, with no database connection
# required.
set -euo pipefail

PGBIN=/Applications/Postgres.app/Contents/Versions/17/bin

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <dump_file> {apply|rollback}" >&2
  exit 2
fi

DUMP_FILE="$1"
MODE="$2"

case "$MODE" in
  apply|rollback) ;;
  *) echo "mode must be 'apply' or 'rollback', got: '$MODE'" >&2; exit 2 ;;
esac

if [ ! -s "$DUMP_FILE" ]; then
  echo "refusing: backup $DUMP_FILE is missing or empty" >&2
  exit 1
fi

if ! DUMP_LIST="$("$PGBIN/pg_restore" --list "$DUMP_FILE" 2>&1)"; then
  echo "refusing: pg_restore --list could not read backup $DUMP_FILE:" >&2
  echo "$DUMP_LIST" >&2
  exit 1
fi

REQUIRED_TABLES=(sub_competencies snapshot_target_coverage)
if [ "$MODE" = rollback ]; then
  REQUIRED_TABLES+=(snapshot_competency_coverage career_target_requirements)
fi
for TBL in "${REQUIRED_TABLES[@]}"; do
  # A TABLE DATA entry exists for a table with 0 rows too (pg_dump always
  # emits one, confirmed against scratch's always-empty career_target_demand)
  # — missing here means a schema-only (-s) dump or the table not being in
  # the archive at all, never "the table happens to be empty" (M-l, round 3:
  # the previous wording implied the latter).
  if ! grep -Eq "TABLE DATA[[:space:]]+public[[:space:]]+$TBL([[:space:]]|\$)" <<<"$DUMP_LIST"; then
    echo "refusing: backup $DUMP_FILE has no TABLE DATA for '$TBL' (schema-only dump, or the table is missing from the archive)" >&2
    exit 1
  fi
done

echo "backup verified: $DUMP_FILE ($(wc -c <"$DUMP_FILE" | tr -d ' ') bytes, pg_restore --list lists TABLE DATA for ${REQUIRED_TABLES[*]})"
