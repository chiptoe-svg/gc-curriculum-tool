#!/usr/bin/env bash
# p1-backup.sh — verified pg_dump backup for migration 0058 (P1).
#
# Final whole-branch review, I-2: the runbook's prose backup step failed
# as written (the output directory ~/.local/share/gc-curriculum-tool/p1
# was never created) and had no verification step at all. A small checked
# script beats more prose.
#
# Usage: DATABASE_URL=postgres://... ./p1-backup.sh --expect-db <name>
#   - DATABASE_URL is read from the environment only, never argv (see
#     p0a-lib.sh's p0a_url_to_pg_env — this is also why the dump/restore
#     calls below never need a connection string on their own argv).
#   - --expect-db is REQUIRED and checked twice: against a fixed allowlist
#     in THIS script (p0b_check_allowed_db_name's pattern — the allowlist
#     must live in the script itself, not only in a caller), and against
#     current_database() after connecting. Refuses — writes nothing — on
#     either mismatch.
#   - mkdir -p's the backup directory, pg_dump -Fc --no-owner's a
#     timestamped file, chmod 600's it, then verifies it with
#     `pg_restore --list` (file-only, no DB connection) for the 3 expected
#     TABLE DATA entries (sub_competencies, career_target_requirements,
#     snapshot_competency_coverage).
#   - On success, prints ONLY the dump path on stdout (so a caller can do
#     D=$(DATABASE_URL=... ./p1-backup.sh --expect-db gc_curriculum));
#     every other message goes to stderr.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./p0a-lib.sh
source "$HERE/p0a-lib.sh"

PGBIN=/Applications/Postgres.app/Contents/Versions/17/bin
BACKUP_DIR="$HOME/.local/share/gc-curriculum-tool/p1"
REQUIRED_TABLES=(sub_competencies career_target_requirements snapshot_competency_coverage)

# Allowlist lives here, not only in a caller — same reasoning as P0b's
# p0b_check_allowed_db_name (p0a-lib.sh). 'gc_curriculum' is the only live
# value; the two scratch clones let this script be tested and used for
# rehearsal without touching live.
p1_check_allowed_db_name() {
  local name="$1"
  case "$name" in
    gc_curriculum|gc_curriculum_p1_scratch|gc_curriculum_p1_pre) return 0 ;;
  esac
  echo "refusing: '$name' is not on the allowed database-name list (gc_curriculum, gc_curriculum_p1_scratch, gc_curriculum_p1_pre); nothing touched" >&2
  return 1
}

if [ "${1:-}" != "--expect-db" ] || [ -z "${2:-}" ]; then
  echo "usage: DATABASE_URL=postgres://... $0 --expect-db <name>" >&2
  exit 2
fi
EXPECT_DB="$2"

if ! p1_check_allowed_db_name "$EXPECT_DB"; then
  exit 1
fi

p0a_url_to_pg_env   # exports PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD; unsets DATABASE_URL; URL never touches any argv.

if [ "$PGDATABASE" != "$EXPECT_DB" ]; then
  echo "refusing: connected database '$PGDATABASE' does not match --expect-db '$EXPECT_DB'; nothing touched" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
DUMP="$BACKUP_DIR/pre-apply-$(date +%Y%m%dT%H%M%S).dump"

"$PGBIN/pg_dump" -Fc --no-owner -f "$DUMP"
chmod 600 "$DUMP"

if [ ! -s "$DUMP" ]; then
  echo "refusing: backup file is empty or missing: $DUMP" >&2
  exit 3
fi

FOUND=0
for t in "${REQUIRED_TABLES[@]}"; do
  if "$PGBIN/pg_restore" --list "$DUMP" | grep -qE "TABLE DATA public ${t} "; then
    FOUND=$((FOUND + 1))
  else
    echo "warning: no TABLE DATA entry for '${t}' in $DUMP" >&2
  fi
done

if [ "$FOUND" -ne "${#REQUIRED_TABLES[@]}" ]; then
  echo "refusing: backup verify found ${FOUND}/${#REQUIRED_TABLES[@]} expected TABLE DATA entries; the dump may be incomplete: $DUMP" >&2
  exit 4
fi

echo "backup verified: $DUMP (${FOUND}/${#REQUIRED_TABLES[@]} expected tables present, chmod 600)" >&2
echo "$DUMP"
