#!/usr/bin/env bash
# Apply migration 0072 (competency_levels; target_coverage reads it) to the LIVE database, then backfill the
# scoring links. Plan: docs/superpowers/plans/2026-11-20-links-drive-coverage.md
#
#   (no argument)  READ-ONLY preflight: says what it would do, changes nothing.
#   --apply        backup (pg_dump, gzip, checked) -> save target_coverage -> apply 0072 (its own BEGIN/COMMIT)
#                  -> seed-skill-links --scoring-only --apply (inserts scoring links; a still-proposed embedding
#                  suggestion the scorer matched becomes source 'scoring'; no model calls) -> verify.
#
# 0072 creates or replaces two views; no table or row changes. The destructive-statement grep refuses DROP TABLE,
# DELETE, UPDATE, TRUNCATE and ALTER TABLE. The running (old) build reads the scorer table and target_coverage,
# which stays identical, so applying before deploying the new build is safe; the new build needs the view.
# Undo: psql -f scripts/migrations/2026-11-20-levels-rollback.sql (restores target_coverage over the table, drops
#   competency_levels); the backfilled links stay (proposed, source 'scoring') and the old build already used them.
set -uo pipefail
APP=/Users/admin/projects/curriculum_developer-deploy
PGBIN=/Applications/Postgres.app/Contents/Versions/17/bin
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
SQL="$HERE/drizzle/0072_competency_levels.sql"
BACKUPS="$HOME/Library/Application Support/gc-curriculum-tool/backups"
TSX="$HERE/node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs"

fail() { echo "STOP: $*" >&2; exit 1; }
[ -f "$SQL" ] || fail "$SQL not found"
URL="$(node "$HOME/.claude/dashboard/read-env.mjs" "$APP" DATABASE_URL)" || fail "could not read the live DATABASE_URL"
[ -n "$URL" ] || fail "empty DATABASE_URL"
EXPECT=gc_curriculum
# Rehearsal: LEVELS_SCRATCH=1 runs every step against the scratch restore instead (backup goes to the scratchpad).
if [ "${LEVELS_SCRATCH:-}" = "1" ]; then
  URL="${URL%/*}/gc_curriculum_links_scratch"; EXPECT=gc_curriculum_links_scratch
  BACKUPS="${TMPDIR:-/tmp}/levels-rehearsal-backups"
fi
ROLLBACK="$HERE/scripts/migrations/2026-11-20-levels-rollback.sql"
SEED_CMD="DATABASE_URL=<the $EXPECT url> node $TSX $HERE/scripts/catalog/seed-skill-links.ts --expect-db $EXPECT --scoring-only --apply"
q() { "$PGBIN/psql" "$URL" -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }

DB="$(q "select current_database()")" || fail "cannot connect to the live database"
[ "$DB" = "$EXPECT" ] || fail "connected to '$DB', expected $EXPECT"
HAS_VIEW="$(q "select count(*) from pg_views where schemaname='public' and viewname='competency_levels'")" || fail "could not check for competency_levels"
TC="$(q "select count(*) from target_coverage")" || fail "could not count target_coverage"
# Faculty or AI decisions change levels on purpose; with any, target_coverage is not expected to stay identical.
DECISIONS="$(q "select (select count(*) from competency_rollups) + (select count(*) from skill_competency_links where status <> 'proposed' or source in ('ai', 'faculty'))")" || fail "could not count decisions"
DROPS="$(grep -ciE '^(DROP TABLE|DELETE|UPDATE|TRUNCATE|ALTER TABLE)' "$SQL")"

echo "live database:                 $DB"
echo "competency_levels present:     $HAS_VIEW"
echo "target_coverage rows now:      $TC"
echo "faculty decisions (roll-ups + decided links): $DECISIONS"
echo "statements in 0072:            $(grep -c 'CREATE OR REPLACE VIEW' "$SQL") CREATE OR REPLACE VIEW, $DROPS destructive"
DATABASE_URL="$URL" node "$TSX" "$HERE/scripts/catalog/seed-skill-links.ts" --expect-db "$EXPECT" --scoring-only 2>&1 | tail -2 || fail "backfill dry run failed"

if [ "${1:-}" != "--apply" ]; then
  echo "preflight only: nothing changed. Re-run with --apply to back up, apply and backfill."
  exit 0
fi

[ "$HAS_VIEW" = "0" ] || fail "competency_levels already exists; 0072 is applied. If only the backfill is missing, run: $SEED_CMD"
[ "$DROPS" = "0" ] || fail "0072 now contains a destructive statement"
mkdir -p "$BACKUPS"
BACKUP="$BACKUPS/dump-pre-0072-$(date +%Y%m%d-%H%M%S).sql.gz"
"$PGBIN/pg_dump" --no-owner --no-privileges "$URL" | gzip > "$BACKUP" || fail "backup failed"
gzip -t "$BACKUP" || fail "backup $BACKUP is not a valid gzip file"
[ "$(stat -f %z "$BACKUP")" -gt 1000000 ] || fail "backup $BACKUP is too small to be a full dump"
echo "backup: $BACKUP"

BEFORE="$BACKUPS/target-coverage-pre-0072-$(date +%Y%m%d-%H%M%S).tsv"
"$PGBIN/psql" "$URL" -X -q -At -F $'\t' -c "select * from target_coverage order by 1,2,3" > "$BEFORE" || fail "could not save target_coverage"

"$PGBIN/psql" "$URL" -X -q -v ON_ERROR_STOP=1 -f "$SQL" || fail "apply failed; the migration's transaction rolled back, nothing changed"
DATABASE_URL="$URL" node "$TSX" "$HERE/scripts/catalog/seed-skill-links.ts" --expect-db "$EXPECT" --scoring-only --apply 2>&1 | tail -2 \
  || fail "backfill failed after 0072 was applied. Levels are still the scorer's (the view matches the table). Re-run only the backfill: $SEED_CMD"

AFTER_HINT="0072 and the backfill are applied. To undo the views: psql <url> -f $ROLLBACK (the backfilled links are proposed scoring links the old build already counted). A scorer or /build write by the running app during the apply also changes these numbers."
if [ "$DECISIONS" = "0" ]; then
  "$PGBIN/psql" "$URL" -X -q -At -F $'\t' -c "select * from target_coverage order by 1,2,3" | diff -q "$BEFORE" - >/dev/null \
    || fail "verification: target_coverage changed (saved before: $BEFORE). $AFTER_HINT"
  SAME="$(q "select count(*) from (select snapshot_id, competency_id, k_depth, u_depth, d_depth, matched_competency, evidence_excerpt, confidence, rationale, model, generated_at from competency_levels except select snapshot_id, competency_id, k_depth, u_depth, d_depth, matched_competency, evidence_excerpt, confidence, rationale, model, generated_at from snapshot_competency_coverage) x")" \
    || fail "verification query failed. $AFTER_HINT"
  [ "$SAME" = "0" ] || fail "verification: competency_levels differs from the scorer table with no faculty decisions. $AFTER_HINT"
  echo "verified: target_coverage identical ($TC rows); competency_levels matches the scorer table. Next: deploy the build."
else
  CHANGED="$("$PGBIN/psql" "$URL" -X -q -At -F $'\t' -c "select * from target_coverage order by 1,2,3" | diff "$BEFORE" - | grep -c '^[<>]')"
  echo "applied with $DECISIONS faculty/AI decision(s) in place: $CHANGED target_coverage line(s) differ, as those decisions intend (saved before: $BEFORE). Next: deploy the build."
fi
