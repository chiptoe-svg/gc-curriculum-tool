#!/usr/bin/env bash
# Apply migration 0068 (skill -> competency links, roll-ups, and the Professional readiness competency) to the
# LIVE database, then seed proposed links. Spec: docs/superpowers/specs/2026-11-15-skill-competency-links-design.md
#
#   (no argument)  READ-ONLY preflight: says what it would do, changes nothing.
#   --apply        takes a fresh backup (pg_dump, gzip, checked), applies drizzle/0068_skill_links.sql (its own
#                  BEGIN/COMMIT, refusing a second apply), verifies, then seeds proposed links with
#                  scripts/catalog/seed-skill-links.ts (campus embeddings, no cost; inserts proposals only).
#
# 0068 creates two tables and inserts one competency (with its identity map row and its card). It drops, alters,
# deletes and updates nothing. The running build does not read the new tables, so applying before the new
# build is deployed is safe. Undo: DROP TABLE skill_competency_links, competency_rollups; then
# DELETE FROM bundle_cards / sub_competency_map / sub_competencies WHERE the id is 'professional-readiness'.
set -uo pipefail
APP=/Users/admin/projects/curriculum_developer-deploy
PGBIN=/Applications/Postgres.app/Contents/Versions/17/bin
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
SQL="$HERE/drizzle/0068_skill_links.sql"
BACKUPS="$HOME/Library/Application Support/gc-curriculum-tool/backups"

fail() { echo "STOP: $*" >&2; exit 1; }
[ -f "$SQL" ] || fail "$SQL not found"
URL="$(node "$HOME/.claude/dashboard/read-env.mjs" "$APP" DATABASE_URL)" || fail "could not read the live DATABASE_URL"
[ -n "$URL" ] || fail "empty DATABASE_URL"
q() { "$PGBIN/psql" "$URL" -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }

DB="$(q "select current_database()")" || fail "cannot connect to the live database"
[ "$DB" = "gc_curriculum" ] || fail "connected to '$DB', expected gc_curriculum"
EXISTS="$(q "select count(*) from information_schema.tables where table_schema='public' and table_name in ('skill_competency_links','competency_rollups')")"
TABLES_BEFORE="$(q "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")"
COMPS_BEFORE="$(q "select count(*) from sub_competencies")"
WRITES="$(grep -ciE '^(DROP|ALTER|DELETE|UPDATE|TRUNCATE)' "$SQL")"

echo "live database:              $DB"
echo "0068 tables present:        $EXISTS of 2"
echo "base tables now:            $TABLES_BEFORE"
echo "catalog competencies now:   $COMPS_BEFORE (professional-readiness: $(q "select count(*) from sub_competencies where id='professional-readiness'"))"
echo "statements in 0068:         $(grep -cE '^(CREATE TABLE|CREATE INDEX)' "$SQL") CREATE, $(grep -cE '^INSERT' "$SQL") INSERT, $WRITES DROP/ALTER/DELETE/UPDATE/TRUNCATE"

if [ "${1:-}" != "--apply" ]; then
  echo "preflight only: nothing changed. Re-run with --apply to back up, apply and seed."
  exit 0
fi

[ "$EXISTS" = "0" ] || fail "0068 tables already exist; nothing to do"
[ "$WRITES" = "0" ] || fail "0068 is no longer purely additive"
mkdir -p "$BACKUPS"
BACKUP="$BACKUPS/dump-pre-0068-$(date +%Y%m%d-%H%M%S).sql.gz"
"$PGBIN/pg_dump" --no-owner --no-privileges "$URL" | gzip > "$BACKUP" || fail "backup failed"
gzip -t "$BACKUP" || fail "backup $BACKUP is not a valid gzip file"
[ "$(stat -f %z "$BACKUP")" -gt 1000000 ] || fail "backup $BACKUP is too small to be a full dump"
echo "backup: $BACKUP"

"$PGBIN/psql" "$URL" -X -q -v ON_ERROR_STOP=1 -f "$SQL" || fail "apply failed; the migration's transaction rolled back, nothing changed"

TABLES_AFTER="$(q "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")"
COMPS_AFTER="$(q "select count(*) from sub_competencies")"
PR="$(q "select count(*) from sub_competencies s join bundle_cards b on b.competency_id = s.id join sub_competency_map m on m.old_sub_competency_id = s.id where s.id='professional-readiness' and b.status='confirmed'")"
echo "applied. base tables: $TABLES_BEFORE -> $TABLES_AFTER; competencies: $COMPS_BEFORE -> $COMPS_AFTER; professional-readiness with card and map row: $PR"
[ "$TABLES_AFTER" = "$((TABLES_BEFORE + 2))" ] && [ "$COMPS_AFTER" = "$((COMPS_BEFORE + 1))" ] && [ "$PR" = "1" ] || fail "verification did not match (expected two more tables, one more competency with its card)"
echo "verified."

cd "$HERE" && DATABASE_URL="$URL" pnpm exec tsx scripts/catalog/seed-skill-links.ts --expect-db gc_curriculum --apply || fail "seeding links failed; 0068 is applied and the tables are empty, which the old build ignores"
echo "links: $(q "select count(*) from skill_competency_links") proposed. Next: deploy the build."
