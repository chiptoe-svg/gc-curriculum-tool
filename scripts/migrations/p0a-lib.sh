#!/usr/bin/env bash
# p0a-lib.sh — sourced (not executed) by p0a-apply-db.sh and
# p0a-db-migrated.sh. Not runnable on its own.
#
# p0a_url_to_pg_env parses $DATABASE_URL (read from the environment, never
# argv) into libpq's standard PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD,
# exports them into the CALLING shell (this must be sourced, not exec'd,
# for that to work), and unsets DATABASE_URL.
#
# M-j (adversarial review round 3): round 2's M-e fix moved the URL off
# this script's own argv and off psql/pg_dump's argv, but the one-line
# `node -e '... new URL(process.argv[1]) ...' "$DATABASE_URL"` still put it
# on node's argv — visible in `ps -ww` for node's short lifetime. node now
# reads `process.env.DATABASE_URL` directly, so the URL never appears as a
# command-line argument to ANY process. This logic used to be duplicated
# verbatim in both callers (a round-2 debt note); factored out here so a
# future fix only has one copy to change.
p0a_url_to_pg_env() {
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "refusing: DATABASE_URL is not set in the environment; nothing touched" >&2
    return 2
  fi
  # bash 3.2 compatible (no mapfile/readarray): one `read` per line, in the
  # fixed order node prints them.
  {
    IFS= read -r PGHOST
    IFS= read -r PGPORT
    IFS= read -r PGDATABASE
    IFS= read -r PGUSER
    IFS= read -r PGPASSWORD
  } < <(node -e '
    const u = new URL(process.env.DATABASE_URL);
    const lines = [
      u.hostname,
      u.port || "5432",
      decodeURIComponent(u.pathname.replace(/^\//, "")),
      decodeURIComponent(u.username),
      decodeURIComponent(u.password),
    ];
    process.stdout.write(lines.join("\n") + "\n");
  ')
  export PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD
  unset DATABASE_URL
}
