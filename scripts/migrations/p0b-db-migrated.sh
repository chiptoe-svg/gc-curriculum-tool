#!/usr/bin/env bash
# p0b-db-migrated.sh <expected_db_name> — prints "t" or "f": whether
# migration 0057 is currently applied to the database named by
# $DATABASE_URL (env, not argv — see p0a-lib.sh). Sibling to
# p0a-db-migrated.sh (same contract, different probe table) — used by the
# P0b live-apply wrapper's failure-path reporting to query the ACTUAL
# database state instead of assuming it, and by an operator checking state
# by hand.
#
# Probe (task-8 brief, Resolution 2): sub_competency_map exists only once
# 0057 has run (it is created and populated by that migration and never
# dropped by it), so its presence means "0057 applied".
#
# Mirrors p0a-db-migrated.sh's M-h guard: refuses (non-zero exit, no
# "t"/"f" printed) unless `current_database()` actually equals
# <expected_db_name>. The caller is expected to treat any non-zero exit
# (missing DATABASE_URL, wrong database, or unreachable database)
# identically: state UNKNOWN, don't bootstrap.
#
# Fix round 2 (task 8): <expected_db_name> itself is checked against the
# allowlist in p0a-lib.sh (p0b_check_allowed_db_name) BEFORE opening any
# connection — exactly "gc_curriculum" or gc_curriculum_p0b_rbtest*.
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
  echo "refusing: connected to database '$ACTUAL_DB', expected '$EXPECTED_DB' — state UNKNOWN" >&2
  exit 1
fi

"$PGBIN/psql" -X -At -c "SELECT to_regclass('public.sub_competency_map') IS NOT NULL;"
