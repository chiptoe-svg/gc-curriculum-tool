#!/usr/bin/env bash
# Apply migration 0071 (locked skill strings) to the LIVE database.
# Plan: docs/superpowers/plans/2026-11-18-locked-skill-strings.md
#
#   (no argument)  READ-ONLY preflight: says what it would do, changes nothing.
#   --apply        takes a fresh backup (pg_dump, gzip, checked), applies drizzle/0071_skill_strings.sql (its own
#                  BEGIN/COMMIT, refusing a second apply), then verifies the seven tables and the partial unique index.
#
# 0071 creates seven new tables (string_points, string_links, curriculum_strings, curriculum_string_path,
# skill_orphan_notes, curriculum_string_events, string_point_resolutions) and two indexes. No existing table or row
# is touched. The destructive-statement grep below refuses DROP TABLE, DELETE, UPDATE, TRUNCATE, DROP COLUMN and SET DATA TYPE.
# The running build ignores the new tables, so applying before the new build is deployed is safe.
# Undo: DROP TABLE string_point_resolutions, curriculum_string_events, skill_orphan_notes, curriculum_string_path,
#   curriculum_strings, string_links, string_points (in that order; foreign keys restrict otherwise).
set -uo pipefail
APP=/Users/admin/projects/curriculum_developer-deploy
PGBIN=/Applications/Postgres.app/Contents/Versions/17/bin
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
SQL="$HERE/drizzle/0071_skill_strings.sql"
BACKUPS="$HOME/Library/Application Support/gc-curriculum-tool/backups"
NEW_TABLES="'string_points','string_links','curriculum_strings','curriculum_string_path','skill_orphan_notes','curriculum_string_events','string_point_resolutions'"

fail() { echo "STOP: $*" >&2; exit 1; }
[ -f "$SQL" ] || fail "$SQL not found"
URL="$(node "$HOME/.claude/dashboard/read-env.mjs" "$APP" DATABASE_URL)" || fail "could not read the live DATABASE_URL"
[ -n "$URL" ] || fail "empty DATABASE_URL"
q() { "$PGBIN/psql" "$URL" -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }

DB="$(q "select current_database()")" || fail "cannot connect to the live database"
[ "$DB" = "gc_curriculum" ] || fail "connected to '$DB', expected gc_curriculum"
EXISTS="$(q "select count(*) from information_schema.tables where table_schema='public' and table_name in ($NEW_TABLES)")"
PRE="$(q "select count(*) from information_schema.tables where table_schema='public' and table_name='curriculum_clusters'")"
TABLES_BEFORE="$(q "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")"
DROPS="$(grep -ciE '^(DROP TABLE|DELETE|UPDATE|TRUNCATE)|DROP COLUMN|SET DATA TYPE' "$SQL")"

echo "live database:              $DB"
echo "0071 tables present:        $EXISTS of 7"
echo "base tables now:            $TABLES_BEFORE"
echo "statements in 0071:         $(grep -cE '^(CREATE TABLE|CREATE UNIQUE INDEX|CREATE INDEX)' "$SQL") CREATE, $(grep -cE '^ALTER TABLE' "$SQL") ALTER, $DROPS DROP TABLE/DELETE/UPDATE/TRUNCATE"

if [ "${1:-}" != "--apply" ]; then
  echo "preflight only: nothing changed. Re-run with --apply to back up and apply."
  exit 0
fi

[ "$PRE" = "1" ] || fail "0070 is not applied (curriculum_clusters must exist)"
[ "$EXISTS" = "0" ] || fail "0071 tables already exist; nothing to do"
[ "$DROPS" = "0" ] || fail "0071 now drops, deletes or updates data"
mkdir -p "$BACKUPS"
BACKUP="$BACKUPS/dump-pre-0071-$(date +%Y%m%d-%H%M%S).sql.gz"
"$PGBIN/pg_dump" --no-owner --no-privileges "$URL" | gzip > "$BACKUP" || fail "backup failed"
gzip -t "$BACKUP" || fail "backup $BACKUP is not a valid gzip file"
[ "$(stat -f %z "$BACKUP")" -gt 1000000 ] || fail "backup $BACKUP is too small to be a full dump"
echo "backup: $BACKUP"

"$PGBIN/psql" "$URL" -X -q -v ON_ERROR_STOP=1 -f "$SQL" || fail "apply failed; the migration's transaction rolled back, nothing changed"

TABLES_AFTER="$(q "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")"
echo "applied. base tables: $TABLES_BEFORE -> $TABLES_AFTER"
[ "$TABLES_AFTER" = "$((TABLES_BEFORE + 7))" ] || fail "verification: expected seven more tables"
[ "$(q "select count(*) from information_schema.tables where table_schema='public' and table_name in ($NEW_TABLES)")" = "7" ] || fail "verification: the seven 0071 tables are not all present"
[ "$(q "select count(*) from pg_indexes where schemaname='public' and indexname='idx_curriculum_strings_active_name' and indexdef ilike '%UNIQUE%' and indexdef ilike '%WHERE%'")" = "1" ] || fail "verification: partial unique index idx_curriculum_strings_active_name missing"
echo "verified. Next: deploy the build."
