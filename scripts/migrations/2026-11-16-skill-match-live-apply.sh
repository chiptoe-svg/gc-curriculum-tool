#!/usr/bin/env bash
# Apply migration 0069 (skill-match judgments, decisions, plan syllabus drafts) to the LIVE database.
# Spec: docs/superpowers/specs/2026-11-16-map-course-edits-and-required-skills-design.md
#
#   (no argument)  READ-ONLY preflight: says what it would do, changes nothing.
#   --apply        takes a fresh backup (pg_dump, gzip, checked), applies drizzle/0069_skill_match.sql (its own
#                  BEGIN/COMMIT, refusing a second apply), then verifies three more base tables.
#
# 0069 creates three tables and drops, alters, deletes and updates nothing. The running build does not read the
# new tables, so applying before the new build is deployed is safe.
# Undo: DROP TABLE skill_match_judgments, skill_match_decisions, plan_syllabus_drafts;
set -uo pipefail
APP=/Users/admin/projects/curriculum_developer-deploy
PGBIN=/Applications/Postgres.app/Contents/Versions/17/bin
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
SQL="$HERE/drizzle/0069_skill_match.sql"
BACKUPS="$HOME/Library/Application Support/gc-curriculum-tool/backups"

fail() { echo "STOP: $*" >&2; exit 1; }
[ -f "$SQL" ] || fail "$SQL not found"
URL="$(node "$HOME/.claude/dashboard/read-env.mjs" "$APP" DATABASE_URL)" || fail "could not read the live DATABASE_URL"
[ -n "$URL" ] || fail "empty DATABASE_URL"
q() { "$PGBIN/psql" "$URL" -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }

DB="$(q "select current_database()")" || fail "cannot connect to the live database"
[ "$DB" = "gc_curriculum" ] || fail "connected to '$DB', expected gc_curriculum"
EXISTS="$(q "select count(*) from information_schema.tables where table_schema='public' and table_name in ('skill_match_judgments','skill_match_decisions','plan_syllabus_drafts')")"
TABLES_BEFORE="$(q "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")"
WRITES="$(grep -ciE '^(DROP|ALTER|DELETE|UPDATE|TRUNCATE)' "$SQL")"

echo "live database:              $DB"
echo "0069 tables present:        $EXISTS of 3"
echo "base tables now:            $TABLES_BEFORE"
echo "statements in 0069:         $(grep -cE '^(CREATE TABLE|CREATE INDEX)' "$SQL") CREATE, $WRITES DROP/ALTER/DELETE/UPDATE/TRUNCATE"

if [ "${1:-}" != "--apply" ]; then
  echo "preflight only: nothing changed. Re-run with --apply to back up and apply."
  exit 0
fi

[ "$EXISTS" = "0" ] || fail "0069 tables already exist; nothing to do"
[ "$WRITES" = "0" ] || fail "0069 is no longer purely additive"
mkdir -p "$BACKUPS"
BACKUP="$BACKUPS/dump-pre-0069-$(date +%Y%m%d-%H%M%S).sql.gz"
"$PGBIN/pg_dump" --no-owner --no-privileges "$URL" | gzip > "$BACKUP" || fail "backup failed"
gzip -t "$BACKUP" || fail "backup $BACKUP is not a valid gzip file"
[ "$(stat -f %z "$BACKUP")" -gt 1000000 ] || fail "backup $BACKUP is too small to be a full dump"
echo "backup: $BACKUP"

"$PGBIN/psql" "$URL" -X -q -v ON_ERROR_STOP=1 -f "$SQL" || fail "apply failed; the migration's transaction rolled back, nothing changed"

TABLES_AFTER="$(q "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")"
echo "applied. base tables: $TABLES_BEFORE -> $TABLES_AFTER"
[ "$TABLES_AFTER" = "$((TABLES_BEFORE + 3))" ] || fail "verification did not match (expected three more tables)"
echo "verified. Next: deploy the build."
