#!/usr/bin/env bash
# P0a scratch database: a throwaway clone of the live DB on the same Postgres
# server, for migration rehearsal and characterization tests. The live DB is
# only READ (pg_dump). The URL is printed only by `url`, for use inside $(...);
# never run `url` bare.
#   create  drop + recreate gc_curriculum_p0a_scratch from a pg_dump of live
#   url     print the scratch DATABASE_URL (same credentials, scratch db name)
#   drop    drop the scratch database
set -euo pipefail
APP=/Users/admin/projects/curriculum_developer
PGBIN=/Applications/Postgres.app/Contents/Versions/17/bin
SCRATCH=gc_curriculum_p0a_scratch

live_url() { node "$HOME/.claude/dashboard/read-env.mjs" "$APP" DATABASE_URL; }
with_db() {
  node -e 'const u = new URL(process.argv[1]); u.pathname = "/" + process.argv[2]; process.stdout.write(u.toString());' "$1" "$2"
}

case "${1:-}" in
  create)
    LIVE="$(live_url)"
    "$PGBIN/psql" "$(with_db "$LIVE" postgres)" -X -q -v ON_ERROR_STOP=1 \
      -c "DROP DATABASE IF EXISTS $SCRATCH" -c "CREATE DATABASE $SCRATCH"
    "$PGBIN/pg_dump" --no-owner --no-privileges "$LIVE" \
      | "$PGBIN/psql" "$(with_db "$LIVE" "$SCRATCH")" -X -q -v ON_ERROR_STOP=1 >/dev/null
    echo "created $SCRATCH from a read-only dump of the live DB"
    ;;
  url)
    with_db "$(live_url)" "$SCRATCH"
    ;;
  drop)
    LIVE="$(live_url)"
    "$PGBIN/psql" "$(with_db "$LIVE" postgres)" -X -q -c "DROP DATABASE IF EXISTS $SCRATCH"
    echo "dropped $SCRATCH"
    ;;
  *)
    echo "usage: $0 create|url|drop" >&2
    exit 2
    ;;
esac
