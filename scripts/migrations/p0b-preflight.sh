#!/usr/bin/env bash
# p0b-preflight.sh <expected_db_name>
#
# m1 (hostile review round 2, 2026-10-12): a READ-ONLY check of migration
# 0057's preconditions (including M-6's career_target_demand check) and its
# count computation (pre_count/merged_away_count/new_insert_count — see the
# comment above pre_counts in drizzle/0057_competency_catalog_p0b.sql),
# run inside BEGIN READ ONLY so it is provably incapable of writing
# anything. Exists so the live-apply wrapper can refuse BEFORE stopping the
# app (building, bootout) when 0057 would refuse anyway — the round-1 cost
# this closes: a precondition or count mismatch used to surface only after
# the app was already down, for no reason, since nothing about an apply's
# eventual refusal depends on the app being stopped first.
#
# The precondition logic and the pre_counts formula below are a
# byte-for-byte PARALLEL of 0057's own (drizzle/0057_competency_catalog_p0b.sql:
# the `DO $$` precondition block, and the `pre_counts` comment/formula just
# after it) — NOT an extraction of that file's literal text, because 0057's
# own version uses `CREATE TEMP TABLE merge_plan/merge_group/pre_counts`,
# and Postgres refuses `CREATE TABLE` (even a TEMP one — it still writes to
# the system catalogs) inside a `READ ONLY` transaction ("cannot execute
# CREATE TABLE in a read-only transaction", confirmed by running it). This
# version uses a `WITH merge_plan (...) AS (VALUES ...)` CTE instead, which
# is pure read. If 0057's merge_plan, precondition checks, or
# new_insert_count formula ever change, update BOTH copies.
#
# DATABASE_URL is read from the ENVIRONMENT, not argv — same discipline as
# p0b-apply-db.sh/p0a-lib.sh: parsed once into libpq's PG* environment
# variables (p0a_url_to_pg_env) so neither this script's own argv, nor any
# child's, ever carries the URL or the password.
set -euo pipefail

PGBIN=/Applications/Postgres.app/Contents/Versions/17/bin
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./p0a-lib.sh
. "$SCRIPT_DIR/p0a-lib.sh"

if [ "$#" -ne 1 ]; then
  echo "usage: DATABASE_URL=postgres://... $0 <expected_db_name>" >&2
  exit 2
fi
EXPECTED_DB="$1"

if ! p0b_check_allowed_db_name "$EXPECTED_DB"; then
  exit 1
fi

p0a_url_to_pg_env

ACTUAL_DB="$("$PGBIN/psql" -X -At -c "SELECT current_database();")"
if [ "$ACTUAL_DB" != "$EXPECTED_DB" ]; then
  echo "refusing: connected to database '$ACTUAL_DB', expected '$EXPECTED_DB'; nothing checked" >&2
  exit 1
fi

OTHER_SESSIONS="$("$PGBIN/psql" -X -At -F'|' -c \
  "SELECT application_name, client_addr, state FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();")"
if [ -n "$OTHER_SESSIONS" ]; then
  echo "note: other sessions are connected to '$EXPECTED_DB' (application_name|client_addr|state) — this is informational only, the preflight is read-only and does not refuse on it:" >&2
  echo "$OTHER_SESSIONS" >&2
fi

SQL='BEGIN READ ONLY;

DO $PREFLIGHT$
BEGIN
  IF to_regclass('"'"'public.sub_competency_map'"'"') IS NOT NULL THEN
    RAISE EXCEPTION '"'"'0057: already applied (sub_competency_map exists)'"'"';
  END IF;
  IF to_regclass('"'"'public.snapshot_target_coverage'"'"') IS NULL OR to_regclass('"'"'public.target_coverage'"'"') IS NULL THEN
    RAISE EXCEPTION '"'"'0057: precondition — P0a (0056) is not applied'"'"';
  END IF;
  IF (SELECT count(*) FROM sub_competencies
      WHERE id IN ('"'"'domain-knowledge'"'"','"'"'project-management'"'"','"'"'gc-production-literacy'"'"','"'"'domain-grounding'"'"','"'"'timeline-management'"'"')
        AND NOT retired) <> 5 THEN
    RAISE EXCEPTION '"'"'0057: precondition — a merge competency is missing or already retired'"'"';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('"'"'gc-production-literacy'"'"','"'"'account-management'"'"'), ('"'"'domain-grounding'"'"','"'"'ai-workflow'"'"'),
      ('"'"'timeline-management'"'"','"'"'production-operations'"'"'), ('"'"'domain-knowledge'"'"','"'"'production-operations'"'"'),
      ('"'"'project-management'"'"','"'"'production-operations'"'"')) e(cid, tid)
    WHERE (SELECT array_agg(DISTINCT career_target_id) FROM career_target_requirements WHERE competency_id = e.cid)
          IS DISTINCT FROM ARRAY[e.tid]) THEN
    RAISE EXCEPTION '"'"'0057: precondition — a merge competency is not in exactly its expected target'"'"';
  END IF;
  IF EXISTS (SELECT 1 FROM career_target_demand
             WHERE sub_competency_id IN ('"'"'domain-knowledge'"'"','"'"'project-management'"'"','"'"'gc-production-literacy'"'"','"'"'domain-grounding'"'"','"'"'timeline-management'"'"')) THEN
    RAISE EXCEPTION '"'"'0057: precondition — career_target_demand has a row on a merge competency (table drops in P1; re-point or clear it first)'"'"';
  END IF;
END $PREFLIGHT$;

WITH merge_plan (old_id, survivor) AS (
  VALUES
    ('"'"'gc-production-literacy'"'"', '"'"'domain-knowledge'"'"'),
    ('"'"'domain-grounding'"'"',       '"'"'domain-knowledge'"'"'),
    ('"'"'timeline-management'"'"',    '"'"'project-management'"'"')
),
pre_counts AS (
  SELECT
    (SELECT count(*) FROM career_target_requirements) AS pre_count,
    (SELECT count(*) FROM career_target_requirements WHERE competency_id IN (SELECT old_id FROM merge_plan)) AS merged_away_count,
    (SELECT count(*) FROM (
       SELECT DISTINCT r.career_target_id, m.survivor, r.horizon, r.weight_source
       FROM career_target_requirements r JOIN merge_plan m ON m.old_id = r.competency_id
       WHERE NOT EXISTS (
         SELECT 1 FROM career_target_requirements r2
         WHERE r2.career_target_id = r.career_target_id AND r2.competency_id = m.survivor
           AND r2.horizon = r.horizon AND r2.weight_source = r.weight_source
       )
     ) new_rows) AS new_insert_count
)
SELECT '"'"'preflight: pre_count='"'"' || pre_count
    || '"'"' merged_away_count='"'"' || merged_away_count
    || '"'"' new_insert_count='"'"' || new_insert_count
    || '"'"' expected_final_count='"'"' || (pre_count - merged_away_count + new_insert_count)
  FROM pre_counts;

ROLLBACK;'

if ! echo "$SQL" | "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -f -; then
  echo "refusing: 0057 would refuse — see the error above; nothing touched (read-only check, nothing was ever at risk)" >&2
  exit 1
fi

echo "p0b-preflight.sh: 0057's preconditions and count computation passed against '$EXPECTED_DB' (read-only)"
