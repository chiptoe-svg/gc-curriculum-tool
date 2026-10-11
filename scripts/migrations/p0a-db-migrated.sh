#!/usr/bin/env bash
# p0a-db-migrated.sh <expected_db_name> — prints "t" or "f": whether
# migration 0056 is currently applied to the database named by
# $DATABASE_URL (env, not argv — see p0a-lib.sh). Used by the live-apply
# wrapper's failure-path reporting (I-2) to query the ACTUAL database
# state instead of assuming it, and by an operator checking state by hand.
#
# M-h (adversarial review round 3): refuses (non-zero exit, no "t"/"f"
# printed) unless `current_database()` actually equals <expected_db_name>.
# Round 2's version printed the state of WHATEVER database the URL
# happened to point at — if read-env ever returned a non-live URL (for
# example because a shell-exported DATABASE_URL overrode .env.local), the
# wrapper could report a wrong database's state as if it were the real
# one, including a false "SAFE to bootstrap". The caller is expected to
# treat any non-zero exit (missing DATABASE_URL, wrong database, or
# unreachable database) identically: state UNKNOWN, don't bootstrap.
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

p0a_url_to_pg_env

ACTUAL_DB="$("$PGBIN/psql" -X -At -c "SELECT current_database();")"
if [ "$ACTUAL_DB" != "$EXPECTED_DB" ]; then
  echo "refusing: connected to database '$ACTUAL_DB', expected '$EXPECTED_DB' — state UNKNOWN" >&2
  exit 1
fi

"$PGBIN/psql" -X -At -c "SELECT to_regclass('public.snapshot_competency_coverage') IS NOT NULL;"
