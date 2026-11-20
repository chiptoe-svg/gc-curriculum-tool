#!/usr/bin/env bash
# Apply migration 0074 (skill tree: tables + backfill of masters, leaves, depths) to the LIVE database.
# Plan: docs/superpowers/plans/2026-11-20-skill-tree-phase1.md. DO NOT RUN without the owner's yes at deploy time.
#
#   (no argument)  READ-ONLY preflight: says what it would do, changes nothing.
#   --apply        backup (pg_dump, gzip, checked) -> save competency_levels -> apply 0074 (its own BEGIN/COMMIT)
#                  -> print counts -> verify competency_levels is unchanged (must print 0).
#
# 0074 creates four tables, adds four string_points columns and backfills; it deletes and rewrites nothing, so the
# running (old) build is unaffected. The destructive-statement grep refuses DROP TABLE, DELETE, TRUNCATE, DROP COLUMN.
# Rehearsal: SKILLTREE_SCRATCH=1 runs every step against gc_curriculum_builder_scratch (backup goes to TMPDIR).
set -uo pipefail
APP=/Users/admin/projects/curriculum_developer-deploy
PGBIN=/Applications/Postgres.app/Contents/Versions/17/bin
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
SQL="$HERE/drizzle/0074_skill_tree.sql"
BACKUPS="$HOME/Library/Application Support/gc-curriculum-tool/backups"

fail() { echo "STOP: $*" >&2; exit 1; }
[ -f "$SQL" ] || fail "$SQL not found"
URL="$(node "$HOME/.claude/dashboard/read-env.mjs" "$APP" DATABASE_URL)" || fail "could not read the live DATABASE_URL"
[ -n "$URL" ] || fail "empty DATABASE_URL"
EXPECT=gc_curriculum
if [ "${SKILLTREE_SCRATCH:-}" = "1" ]; then
  URL="${URL%/*}/gc_curriculum_builder_scratch"; EXPECT=gc_curriculum_builder_scratch
  BACKUPS="${TMPDIR:-/tmp}/skilltree-rehearsal-backups"
fi
q() { "$PGBIN/psql" "$URL" -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }

DB="$(q "select current_database()")" || fail "cannot connect to the database"
[ "$DB" = "$EXPECT" ] || fail "connected to '$DB', expected $EXPECT"
HAS_NODES="$(q "select count(*) from information_schema.tables where table_name='skill_nodes'")" || fail "could not check for skill_nodes"
HAS_0073="$(q "select count(*) from information_schema.tables where table_name='app_settings'")" || fail "could not check for app_settings"
HAS_VIEW="$(q "select count(*) from pg_views where schemaname='public' and viewname='competency_levels'")" || fail "could not check for competency_levels"
COMPS="$(q "select count(*) from sub_competencies")" || fail "could not count sub_competencies"
LEAVES="$(q "select count(*) from (select distinct s.course_code, l.skill_ref, l.competency_id from skill_competency_links l join course_capture_snapshots s on s.id = l.snapshot_id where s.retired_at is null) x")" || fail "could not count leaves"
ROLLUPS="$(q "select count(*) from competency_rollups r join course_capture_snapshots s on s.id = r.snapshot_id where s.retired_at is null")" || fail "could not count rollups"
DROPS="$(grep -ciE '^(DROP TABLE|DELETE|TRUNCATE)|DROP COLUMN' "$SQL")"

echo "database:                      $DB"
echo "skill_nodes already present:   $HAS_NODES"
echo "0073 applied (app_settings):   $HAS_0073"
echo "competency_levels present:     $HAS_VIEW"
echo "would create: masters=$COMPS leaves=$LEAVES depths<=$ROLLUPS"
echo "destructive statements in 0074: $DROPS"

if [ "${1:-}" != "--apply" ]; then
  echo "preflight only: nothing changed. Re-run with --apply to back up and apply."
  exit 0
fi

[ "$HAS_NODES" = "0" ] || fail "skill_nodes already exists; 0074 is applied"
[ "$HAS_0073" != "0" ] || fail "0073 is not applied"
[ "$HAS_VIEW" != "0" ] || fail "0072 is not applied (competency_levels missing)"
[ "$DROPS" = "0" ] || fail "0074 now contains a destructive statement"
mkdir -p "$BACKUPS" || fail "could not create $BACKUPS"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$BACKUPS/dump-pre-0074-$STAMP.sql.gz"
"$PGBIN/pg_dump" --no-owner --no-privileges "$URL" | gzip > "$BACKUP" || fail "backup failed"
gzip -t "$BACKUP" || fail "backup $BACKUP is not a valid gzip file"
[ "$(stat -f %z "$BACKUP")" -gt 1000000 ] || fail "backup $BACKUP is too small to be a full dump"
echo "backup: $BACKUP"

BEFORE="$BACKUPS/competency-levels-pre-0074-$STAMP.tsv"
"$PGBIN/psql" "$URL" -X -q -At -F $'\t' -c "select * from competency_levels order by 1,2" > "$BEFORE" || fail "could not save competency_levels"

"$PGBIN/psql" "$URL" -X -q -v ON_ERROR_STOP=1 -f "$SQL" || fail "apply failed; the migration's transaction rolled back, nothing changed"

echo "masters: $(q "select count(*) from skill_nodes where competency_id is not null") (expected $COMPS)"
echo "leaves:  $(q "select count(*) from skill_leaves") (expected $LEAVES)"
echo "depths:  $(q "select count(*) from node_depths") (at most $ROLLUPS)"

# competency_levels is a view over tables 0074 does not touch, so the output must be byte-identical (0 differing lines).
DIFF="$("$PGBIN/psql" "$URL" -X -q -At -F $'\t' -c "select * from competency_levels order by 1,2" | diff "$BEFORE" - | grep -c '^[<>]')"
echo "competency_levels differing lines: $DIFF (must be 0; saved before: $BEFORE)"
[ "$DIFF" = "0" ] || fail "verification: competency_levels changed after 0074. A scorer or /build write by the running app during the apply can also change it; re-check before acting."
echo "verified. Next: deploy the build."
