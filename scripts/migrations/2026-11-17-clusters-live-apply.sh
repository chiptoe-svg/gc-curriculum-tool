#!/usr/bin/env bash
# Apply migration 0070 (course clusters) to the LIVE database.
# Spec: docs/superpowers/specs/2026-11-17-course-cluster-map-design.md
#
#   (no argument)  READ-ONLY preflight: says what it would do, changes nothing.
#   --apply        takes a fresh backup (pg_dump, gzip, checked), applies drizzle/0070_course_clusters.sql (its own
#                  BEGIN/COMMIT, refusing a second apply), then verifies the four changes.
#
# 0070 creates two tables (curriculum_clusters, skill_set_judgments), adds course_what_ifs.skills and
# plan_syllabus_drafts.cluster_id, relaxes plan_syllabus_drafts.plan_id to nullable, replaces one CHECK constraint
# (skill_match_decisions_source_check, widened to allow 'cluster') and adds one (plan_syllabus_drafts_owner_check).
# No row is changed or deleted. The destructive-statement grep below deliberately allows DROP CONSTRAINT (the replaced
# CHECK) and DROP NOT NULL (plan_id); it refuses DROP TABLE, DELETE, UPDATE, TRUNCATE, DROP COLUMN and SET DATA TYPE.
# The running build ignores all of it, so applying before the new build is deployed is safe; the new build needs it
# applied first (it selects course_what_ifs.skills).
# Undo: DROP TABLE skill_set_judgments; ALTER TABLE plan_syllabus_drafts DROP CONSTRAINT plan_syllabus_drafts_owner_check,
#   DROP COLUMN cluster_id (then SET NOT NULL on plan_id once no cluster-only rows exist); DROP TABLE curriculum_clusters;
#   ALTER TABLE course_what_ifs DROP COLUMN skills; restore skill_match_decisions_source_check to ('map','labeling_sheet').
set -uo pipefail
APP=/Users/admin/projects/curriculum_developer-deploy
PGBIN=/Applications/Postgres.app/Contents/Versions/17/bin
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
SQL="$HERE/drizzle/0070_course_clusters.sql"
BACKUPS="$HOME/Library/Application Support/gc-curriculum-tool/backups"

fail() { echo "STOP: $*" >&2; exit 1; }
[ -f "$SQL" ] || fail "$SQL not found"
URL="$(node "$HOME/.claude/dashboard/read-env.mjs" "$APP" DATABASE_URL)" || fail "could not read the live DATABASE_URL"
[ -n "$URL" ] || fail "empty DATABASE_URL"
q() { "$PGBIN/psql" "$URL" -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }

DB="$(q "select current_database()")" || fail "cannot connect to the live database"
[ "$DB" = "gc_curriculum" ] || fail "connected to '$DB', expected gc_curriculum"
EXISTS="$(q "select count(*) from information_schema.tables where table_schema='public' and table_name in ('curriculum_clusters','skill_set_judgments')")"
PRE="$(q "select count(*) from information_schema.tables where table_schema='public' and table_name in ('skill_match_decisions','plan_syllabus_drafts')")"
TABLES_BEFORE="$(q "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")"
DROPS="$(grep -ciE '^(DROP TABLE|DELETE|UPDATE|TRUNCATE)|DROP COLUMN|SET DATA TYPE' "$SQL")"

echo "live database:              $DB"
echo "0070 tables present:        $EXISTS of 2"
echo "base tables now:            $TABLES_BEFORE"
echo "statements in 0070:         $(grep -cE '^(CREATE TABLE|CREATE INDEX)' "$SQL") CREATE, $(grep -cE '^ALTER TABLE' "$SQL") ALTER, $DROPS DROP TABLE/DELETE/UPDATE/TRUNCATE"

if [ "${1:-}" != "--apply" ]; then
  echo "preflight only: nothing changed. Re-run with --apply to back up and apply."
  exit 0
fi

[ "$PRE" = "2" ] || fail "0069 is not applied (skill_match_decisions and plan_syllabus_drafts must exist)"
[ "$EXISTS" = "0" ] || fail "0070 tables already exist; nothing to do"
[ "$DROPS" = "0" ] || fail "0070 now drops, deletes or updates data"
mkdir -p "$BACKUPS"
BACKUP="$BACKUPS/dump-pre-0070-$(date +%Y%m%d-%H%M%S).sql.gz"
"$PGBIN/pg_dump" --no-owner --no-privileges "$URL" | gzip > "$BACKUP" || fail "backup failed"
gzip -t "$BACKUP" || fail "backup $BACKUP is not a valid gzip file"
[ "$(stat -f %z "$BACKUP")" -gt 1000000 ] || fail "backup $BACKUP is too small to be a full dump"
echo "backup: $BACKUP"

"$PGBIN/psql" "$URL" -X -q -v ON_ERROR_STOP=1 -f "$SQL" || fail "apply failed; the migration's transaction rolled back, nothing changed"

TABLES_AFTER="$(q "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")"
echo "applied. base tables: $TABLES_BEFORE -> $TABLES_AFTER"
[ "$TABLES_AFTER" = "$((TABLES_BEFORE + 2))" ] || fail "verification: expected two more tables"
[ "$(q "select count(*) from pg_constraint where conname='plan_syllabus_drafts_owner_check' and conrelid='public.plan_syllabus_drafts'::regclass")" = "1" ] || fail "verification: plan_syllabus_drafts_owner_check missing"
[ "$(q "select count(*) from information_schema.tables where table_schema='public' and table_name in ('curriculum_clusters','skill_set_judgments')")" = "2" ] || fail "verification: curriculum_clusters / skill_set_judgments missing"
[ "$(q "select count(*) from information_schema.columns where table_schema='public' and table_name='course_what_ifs' and column_name='skills'")" = "1" ] || fail "verification: course_what_ifs.skills missing"
[ "$(q "select count(*) from information_schema.columns where table_schema='public' and table_name='plan_syllabus_drafts' and column_name='cluster_id'")" = "1" ] || fail "verification: plan_syllabus_drafts.cluster_id missing"
[ "$(q "select is_nullable from information_schema.columns where table_schema='public' and table_name='plan_syllabus_drafts' and column_name='plan_id'")" = "YES" ] || fail "verification: plan_syllabus_drafts.plan_id still NOT NULL"
q "select pg_get_constraintdef(oid) from pg_constraint where conname='skill_match_decisions_source_check'" | grep -q cluster || fail "verification: source check does not allow 'cluster'"
echo "verified. Next: deploy the build."
