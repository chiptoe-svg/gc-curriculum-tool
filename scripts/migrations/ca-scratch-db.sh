#!/usr/bin/env bash
# Catalog-additions (CA) scratch databases: two throwaway clones of the live
# DB on the same Postgres server, for the catalog-foundationals work. The live
# DB is only READ (pg_dump). The URL is printed only by `url`/`url-pre`, for
# use inside $(...); never run those bare.
#
#   create      drop-refusing: create gc_curriculum_ca_scratch from a pg_dump
#               of live (fails if it already exists)
#   url         print the gc_curriculum_ca_scratch DATABASE_URL
#   drop        drop gc_curriculum_ca_scratch
#
#   create-pre  same, for gc_curriculum_ca_pre, kept in its pre-change state
#   url-pre     print the gc_curriculum_ca_pre DATABASE_URL
#   drop-pre    drop gc_curriculum_ca_pre
#
# Modeled on p2-scratch-db.sh: both `create` and `create-pre` REFUSE if the
# target database already exists, rather than silently dropping and
# recreating it; callers that want a fresh clone must `drop`/`drop-pre` first.
set -euo pipefail
APP=/Users/admin/projects/curriculum_developer
PGBIN=/Applications/Postgres.app/Contents/Versions/17/bin
SCRATCH=gc_curriculum_ca_scratch
SCRATCH_PRE=gc_curriculum_ca_pre

ca_check_allowed_db_name() {
  case "$1" in
    gc_curriculum_ca_scratch|gc_curriculum_ca_pre) return 0 ;;
  esac
  echo "refusing: '$1' is not a CA scratch database name; nothing touched" >&2
  exit 1
}

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
  ca_check_allowed_db_name "$NAME"
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
  ca_check_allowed_db_name "$NAME"
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
  create-pre)
    create_db "$SCRATCH_PRE"
    ;;
  url-pre)
    with_db "$(live_url)" "$SCRATCH_PRE"
    ;;
  drop-pre)
    drop_db "$SCRATCH_PRE"
    ;;
  *)
    echo "usage: $0 create|url|drop|create-pre|url-pre|drop-pre" >&2
    exit 2
    ;;
esac
