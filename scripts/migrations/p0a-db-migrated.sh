#!/usr/bin/env bash
# p0a-db-migrated.sh — prints "t" or "f": whether migration 0056 is
# currently applied to the database named by $DATABASE_URL (env, not
# argv — same discipline as p0a-apply-db.sh's M-e fix). Used by the
# live-apply wrapper's failure-path reporting (I-2) to query the ACTUAL
# database state instead of assuming it, and by an operator checking state
# by hand. Exits non-zero if the state can't be determined (no
# DATABASE_URL, or the database is unreachable).
set -euo pipefail

PGBIN=/Applications/Postgres.app/Contents/Versions/17/bin

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set" >&2
  exit 2
fi

# bash 3.2 compatible (no mapfile/readarray).
{
  IFS= read -r PGHOST
  IFS= read -r PGPORT
  IFS= read -r PGDATABASE
  IFS= read -r PGUSER
  IFS= read -r PGPASSWORD
} < <(node -e '
  const u = new URL(process.argv[1]);
  const lines = [
    u.hostname,
    u.port || "5432",
    decodeURIComponent(u.pathname.replace(/^\//, "")),
    decodeURIComponent(u.username),
    decodeURIComponent(u.password),
  ];
  process.stdout.write(lines.join("\n") + "\n");
' "$DATABASE_URL")
export PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD
unset DATABASE_URL

"$PGBIN/psql" -X -At -c "SELECT to_regclass('public.snapshot_competency_coverage') IS NOT NULL;"
