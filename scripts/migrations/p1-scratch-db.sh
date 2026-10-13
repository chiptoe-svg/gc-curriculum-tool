#!/usr/bin/env bash
# P1 scratch database: one throwaway clone of the live DB on the same
# Postgres server, for competency-catalog P1 development. The live DB is
# only READ (pg_dump). The URL is printed only by `url`, for use inside
# $(...); never run that bare.
#
#   create      drop-refusing: create gc_curriculum_p1_scratch from a
#               pg_dump of live (fails if it already exists).
#   url         print the gc_curriculum_p1_scratch DATABASE_URL
#   drop        drop gc_curriculum_p1_scratch
#
# Modeled on p0b-scratch-db.sh: `create` REFUSES if the target database
# already exists, rather than silently dropping and recreating it —
# callers that want a fresh clone must `drop` first.
set -euo pipefail
APP=/Users/admin/projects/curriculum_developer
PGBIN=/Applications/Postgres.app/Contents/Versions/17/bin
SCRATCH=gc_curriculum_p1_scratch

live_url() { node "$HOME/.claude/dashboard/read-env.mjs" "$APP" DATABASE_URL; }
with_db() {
  node -e 'const u = new URL(process.argv[1]); u.pathname = "/" + process.argv[2]; process.stdout.write(u.toString());' "$1" "$2"
}

db_exists() {
  # $1 = live url, $2 = db name to check
  local EXISTS
  EXISTS="$("$PGBIN/psql" "$(with_db "$1" postgres)" -X -q -At -v ON_ERROR_STOP=1 \
    -c "SELECT 1 FROM pg_database WHERE datname = '$2'")"
  [ -n "$EXISTS" ]
}

create_db() {
  local NAME="$1"
  local LIVE
  LIVE="$(live_url)"
  if db_exists "$LIVE" "$NAME"; then
    echo "refusing: $NAME already exists (drop it first if you want a fresh clone)" >&2
    exit 1
  fi
  "$PGBIN/psql" "$(with_db "$LIVE" postgres)" -X -q -v ON_ERROR_STOP=1 \
    -c "CREATE DATABASE $NAME"
  "$PGBIN/pg_dump" --no-owner --no-privileges "$LIVE" \
    | "$PGBIN/psql" "$(with_db "$LIVE" "$NAME")" -X -q -v ON_ERROR_STOP=1 >/dev/null
  echo "created $NAME from a read-only dump of the live DB"
}

drop_db() {
  local NAME="$1"
  local LIVE
  LIVE="$(live_url)"
  "$PGBIN/psql" "$(with_db "$LIVE" postgres)" -X -q -c "DROP DATABASE IF EXISTS $NAME"
  echo "dropped $NAME"
}

case "${1:-}" in
  create)
    create_db "$SCRATCH"
    ;;
  url)
    with_db "$(live_url)" "$SCRATCH"
    ;;
  drop)
    drop_db "$SCRATCH"
    ;;
  *)
    echo "usage: $0 create|url|drop" >&2
    exit 2
    ;;
esac
