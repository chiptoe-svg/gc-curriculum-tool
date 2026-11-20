#!/usr/bin/env bash
# Apply migration 0075 (course_materials.added_in_session) to the LIVE database.
# Plan: docs/superpowers/plans/2026-11-20-interview-add-file.md
#
#   (no argument)  READ-ONLY preflight: says what it would do, changes nothing.
#   --apply        backup (pg_dump v17, gzip, checked) -> apply 0075 (its own BEGIN/COMMIT) -> verify the column.
#
# 0075 adds one nullable column; no data changes. The running (old) build ignores the column, so applying before
# deploying the new build is safe. Undo: ALTER TABLE course_materials DROP COLUMN added_in_session;
set -uo pipefail
APP=/Users/admin/projects/curriculum_developer-deploy
PGBIN=/Applications/Postgres.app/Contents/Versions/17/bin
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
SQL="$HERE/drizzle/0075_material_added_in_session.sql"
BACKUPS="$HOME/Library/Application Support/gc-curriculum-tool/backups"

fail() { echo "STOP: $*" >&2; exit 1; }
[ -f "$SQL" ] || fail "$SQL not found"
URL="$(node "$HOME/.claude/dashboard/read-env.mjs" "$APP" DATABASE_URL)" || fail "could not read the live DATABASE_URL"
[ -n "$URL" ] || fail "empty DATABASE_URL"
EXPECT=gc_curriculum
q() { "$PGBIN/psql" "$URL" -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }
COLQ="select count(*) from information_schema.columns where table_schema='public' and table_name='course_materials' and column_name='added_in_session'"

DB="$(q "select current_database()")" || fail "cannot connect to the live database"
[ "$DB" = "$EXPECT" ] || fail "connected to '$DB', expected $EXPECT"
HAS_COL="$(q "$COLQ")" || fail "could not check for the column"
ROWS="$(q "select count(*) from course_materials")" || fail "could not count course_materials"
# Comments and the FK clause "ON DELETE SET NULL" are not destructive statements.
DROPS="$(grep -v '^[[:space:]]*--' "$SQL" | sed -E 's/ON DELETE SET NULL//gI' | grep -ciE '\b(UPDATE|DELETE|DROP|TRUNCATE)\b')"

echo "live database:                 $DB"
echo "added_in_session present:      $HAS_COL"
echo "course_materials rows:         $ROWS"
echo "destructive statements in 0075: $DROPS"

if [ "${1:-}" != "--apply" ]; then
  echo "preflight only: nothing changed. Re-run with --apply to back up and apply."
  exit 0
fi

[ "$HAS_COL" = "0" ] || fail "added_in_session already exists; 0075 is applied"
[ "$DROPS" = "0" ] || fail "0075 now contains a destructive statement"
mkdir -p "$BACKUPS" || exit 1
BACKUP="$BACKUPS/dump-pre-0075-$(date +%Y%m%d-%H%M%S).sql.gz"
"$PGBIN/pg_dump" --no-owner --no-privileges "$URL" | gzip > "$BACKUP" || fail "backup failed"
gzip -t "$BACKUP" || fail "backup $BACKUP is not a valid gzip file"
[ "$(stat -f %z "$BACKUP")" -gt 1000000 ] || fail "backup $BACKUP is too small to be a full dump"
echo "backup: $BACKUP"

"$PGBIN/psql" "$URL" -X -q -v ON_ERROR_STOP=1 -f "$SQL" || fail "apply failed; the migration's transaction rolled back, nothing changed"
[ "$(q "$COLQ")" = "1" ] || fail "verification: added_in_session is missing after apply"
[ "$(q "select count(*) from course_materials")" = "$ROWS" ] || fail "verification: course_materials row count changed"
echo "verified: added_in_session present, $ROWS rows unchanged. Next: deploy the build."
