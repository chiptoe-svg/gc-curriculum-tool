#!/usr/bin/env bash
# Apply migration 0067 (curriculum_plans, one additive table) to the LIVE
# database, the way the owner approved on 2026-11-15: backup -> apply ->
# verify -> then (separately) deploy the build.
#
#   (no argument)  READ-ONLY preflight: says what it would do, changes nothing.
#   --apply        requires a pre-0067 backup made in the last 2 hours, applies
#                  drizzle/0067_curriculum_plans.sql (its own BEGIN/COMMIT, with
#                  a guard that refuses a second apply), then verifies.
#
# The migration only CREATEs one new table and one index. It alters and drops
# nothing, and nothing in the running build reads the table, so applying it
# before the new build is deployed is safe. Undo: DROP TABLE curriculum_plans;
set -uo pipefail
APP=/Users/admin/projects/curriculum_developer-deploy
PGBIN=/Applications/Postgres.app/Contents/Versions/17/bin
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
SQL="$HERE/drizzle/0067_curriculum_plans.sql"
BACKUPS="$HOME/Library/Application Support/gc-curriculum-tool/backups"

fail() { echo "STOP: $*" >&2; exit 1; }
[ -f "$SQL" ] || fail "$SQL not found"
URL="$(node "$HOME/.claude/dashboard/read-env.mjs" "$APP" DATABASE_URL)" || fail "could not read the live DATABASE_URL"
[ -n "$URL" ] || fail "empty DATABASE_URL"
q() { "$PGBIN/psql" "$URL" -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }

DB="$(q "select current_database()")" || fail "cannot connect to the live database"
[ "$DB" = "gc_curriculum" ] || fail "connected to '$DB', expected gc_curriculum"
EXISTS="$(q "select count(*) from information_schema.tables where table_schema='public' and table_name='curriculum_plans'")"
TABLES_BEFORE="$(q "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")"
BACKUP="$(find "$BACKUPS" -name 'dump-pre-0067-*.sql.gz' -mmin -120 -size +1M 2>/dev/null | sort | tail -1)"

echo "live database:            $DB"
echo "curriculum_plans exists:  $([ "$EXISTS" = "1" ] && echo yes || echo no)"
echo "base tables now:          $TABLES_BEFORE"
echo "recent pre-0067 backup:   ${BACKUP:-none in the last 2 hours}"
echo "statements in 0067:       $(grep -cE '^(CREATE TABLE|CREATE INDEX)' "$SQL") CREATE, $(grep -ciE '^(DROP|ALTER|DELETE|UPDATE|TRUNCATE)' "$SQL") DROP/ALTER/DELETE/UPDATE/TRUNCATE"

if [ "${1:-}" != "--apply" ]; then
  echo "preflight only: nothing changed. Re-run with --apply to apply."
  exit 0
fi

[ "$EXISTS" = "0" ] || fail "curriculum_plans already exists; nothing to do"
[ -n "$BACKUP" ] || fail "no pre-0067 backup from the last 2 hours; take one first"
gzip -t "$BACKUP" || fail "backup $BACKUP is not a valid gzip file"
[ "$(grep -ciE '^(DROP|ALTER|DELETE|UPDATE|TRUNCATE)' "$SQL")" = "0" ] || fail "0067 is no longer purely additive"

"$PGBIN/psql" "$URL" -X -q -v ON_ERROR_STOP=1 -f "$SQL" || fail "apply failed; the migration's transaction rolled back, nothing changed"

COLS="$(q "select count(*) from information_schema.columns where table_name='curriculum_plans'")"
ROWS="$(q "select count(*) from curriculum_plans")"
TABLES_AFTER="$(q "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")"
echo "applied. curriculum_plans: $COLS columns, $ROWS rows. base tables: $TABLES_BEFORE -> $TABLES_AFTER"
[ "$COLS" = "10" ] && [ "$ROWS" = "0" ] && [ "$TABLES_AFTER" = "$((TABLES_BEFORE + 1))" ] || fail "verification did not match (expected 10 columns, 0 rows, one more table)"
echo "verified."
