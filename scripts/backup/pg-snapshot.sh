#!/usr/bin/env bash
# pg_dump of the curriculum DB, run every 6 hours by launchd (com.gc.pg-backup).
# Cutover 2026-06-04: Neon serverless → local Postgres.app on 127.0.0.1:5433.
# The DATABASE_URL in .env.local already points at the local DB; the only
# script-level change needed was the pg_dump binary path (Neon needed libpq;
# Postgres.app ships its own client tools).
#
# Three behaviors per invocation:
#   1. Always dump to ~/Documents/gc-curriculum-backups/dump-<ts>.sql.gz
#   2. On Sundays at the first run of the day, also push the latest dump
#      to chiptoe-svg/gc-curriculum-backups on GitHub.
#   3. Always prune local dumps older than 365 days.
#
# Logs to ~/.local/state/gc-curriculum-tool/pg-backup.log (rotates daily
# is not automated — `git log` on the github repo is the canonical timeline).

set -uo pipefail

REPO_DIR="/Users/admin/projects/curriculum_developer"
LOCAL_BACKUPS="$HOME/Library/Application Support/gc-curriculum-tool/backups"
GITHUB_REPO_DIR="$HOME/projects/gc-curriculum-backups"
LOG_DIR="$HOME/.local/state/gc-curriculum-tool"
LOG_FILE="$LOG_DIR/pg-backup.log"
WEEKLY_PUSH_DOW=0  # 0 = Sunday (date +%w)
WEEKLY_MARKER_DIR="$LOG_DIR/pg-backup-state"

# Postgres client (Postgres.app bundles a matched pg_dump for the local
# server). If you upgrade the bundled Postgres major version, update the
# path or use 'latest' (which Postgres.app symlinks).
export PATH="/Applications/Postgres.app/Contents/Versions/17/bin:$PATH"

mkdir -p "$LOCAL_BACKUPS" "$LOG_DIR" "$WEEKLY_MARKER_DIR"
exec >> "$LOG_FILE" 2>&1
echo "--- $(date -u +%Y-%m-%dT%H:%M:%SZ) pg-backup start ---"

cd "$REPO_DIR" || { echo "cd $REPO_DIR failed"; exit 1; }

# Load DATABASE_URL from .env.local. Tolerate optional surrounding quotes and
# inline comments (the FACULTY_BASIC_AUTH pattern bit us before).
DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | head -1 | cut -d= -f2- | sed 's/^"//;s/"$//' | awk '{print $1}')
if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL not set in .env.local — aborting"
  exit 1
fi

TS=$(date -u +%Y-%m-%dT%H%MZ)
LOCAL_FILE="$LOCAL_BACKUPS/dump-$TS.sql.gz"

# 1. Local dump
if pg_dump "$DATABASE_URL" --no-owner --no-acl --clean --if-exists | gzip > "$LOCAL_FILE"; then
  SIZE=$(du -h "$LOCAL_FILE" | awk '{print $1}')
  echo "local dump → $LOCAL_FILE ($SIZE)"
else
  echo "pg_dump failed; removing partial file"
  rm -f "$LOCAL_FILE"
  exit 1
fi

# 2. Weekly GitHub push (Sundays only, once per Sunday)
DOW=$(date -u +%w)
TODAY=$(date -u +%Y-%m-%d)
WEEKLY_MARKER="$WEEKLY_MARKER_DIR/last-weekly-push.txt"
LAST_PUSH=$(cat "$WEEKLY_MARKER" 2>/dev/null || echo "")

if [ "$DOW" = "$WEEKLY_PUSH_DOW" ] && [ "$LAST_PUSH" != "$TODAY" ]; then
  echo "weekly push: pushing $LOCAL_FILE to chiptoe-svg/gc-curriculum-backups"
  REMOTE_FILE="$GITHUB_REPO_DIR/dump-$(date -u +%Y-%m-%d).sql.gz"
  cp "$LOCAL_FILE" "$REMOTE_FILE"
  (
    cd "$GITHUB_REPO_DIR"
    # Pull first to minimize conflict surface; the repo should only ever be
    # written from this Mac, so this is belt-and-suspenders.
    git pull --ff-only origin main 2>&1 | tail -3
    git add "dump-$(date -u +%Y-%m-%d).sql.gz"
    git commit -m "backup: weekly dump $(date -u +%Y-%m-%d)" 2>&1 | tail -3
    git push origin main 2>&1 | tail -3
  )
  echo "$TODAY" > "$WEEKLY_MARKER"
fi

# 3. Prune local dumps older than 365 days
PRUNED=$(find "$LOCAL_BACKUPS" -name 'dump-*.sql.gz' -type f -mtime +365 -print -delete | wc -l | xargs)
if [ "$PRUNED" -gt 0 ]; then
  echo "pruned $PRUNED local dump(s) older than 365 days"
fi

echo "--- $(date -u +%Y-%m-%dT%H:%M:%SZ) pg-backup end ---"
