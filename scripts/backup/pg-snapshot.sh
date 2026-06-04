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

# 4. Monthly Neon-branch checkpoint (1st of month, first run of day).
# Stays entirely inside Neon. Free tier allows 10 branches; we keep up to
# 9 rolling monthly checkpoints (the 10th slot leaves headroom for ad-hoc
# dev branches). Requires NEON_API_KEY + NEON_PROJECT_ID in .env.local
# (see chiptoe-svg/gc-curriculum-backups README for setup instructions).
DOM=$(date -u +%d)
MONTHLY_MARKER="$WEEKLY_MARKER_DIR/last-monthly-checkpoint.txt"
LAST_MONTHLY=$(cat "$MONTHLY_MARKER" 2>/dev/null || echo "")
THIS_MONTH=$(date -u +%Y-%m)
NEON_API_KEY=$(grep '^NEON_API_KEY=' .env.local 2>/dev/null | head -1 | cut -d= -f2- | sed 's/^"//;s/"$//' | awk '{print $1}')
NEON_PROJECT_ID=$(grep '^NEON_PROJECT_ID=' .env.local 2>/dev/null | head -1 | cut -d= -f2- | sed 's/^"//;s/"$//' | awk '{print $1}')

if [ "$DOM" = "01" ] && [ "$LAST_MONTHLY" != "$THIS_MONTH" ]; then
  if [ -z "$NEON_API_KEY" ] || [ -z "$NEON_PROJECT_ID" ]; then
    echo "monthly checkpoint skipped: NEON_API_KEY or NEON_PROJECT_ID not set in .env.local"
  else
    BRANCH_NAME="monthly-$THIS_MONTH"
    echo "monthly checkpoint: creating Neon branch $BRANCH_NAME"
    CREATE_RESP=$(curl -sS -w '\n%{http_code}' \
      -X POST "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches" \
      -H "Authorization: Bearer $NEON_API_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"branch\":{\"name\":\"$BRANCH_NAME\"}}")
    CREATE_STATUS=$(echo "$CREATE_RESP" | tail -1)
    if [ "$CREATE_STATUS" = "201" ] || [ "$CREATE_STATUS" = "200" ]; then
      echo "  → branch $BRANCH_NAME created (HTTP $CREATE_STATUS)"
      echo "$THIS_MONTH" > "$MONTHLY_MARKER"

      # Prune oldest monthly-* branches if count > 9.
      BRANCHES_JSON=$(curl -sS \
        "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches" \
        -H "Authorization: Bearer $NEON_API_KEY")
      OLDEST=$(echo "$BRANCHES_JSON" | jq -r '.branches | map(select(.name | startswith("monthly-"))) | sort_by(.created_at) | .[0:(length - 9)] | .[] | .id' 2>/dev/null)
      if [ -n "$OLDEST" ]; then
        echo "$OLDEST" | while read -r BID; do
          [ -z "$BID" ] && continue
          DEL_STATUS=$(curl -sS -o /dev/null -w '%{http_code}' \
            -X DELETE "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches/$BID" \
            -H "Authorization: Bearer $NEON_API_KEY")
          echo "  pruned old monthly branch $BID (HTTP $DEL_STATUS)"
        done
      fi
    else
      echo "  ⚠ branch creation failed (HTTP $CREATE_STATUS): $(echo "$CREATE_RESP" | head -1)"
    fi
  fi
fi

echo "--- $(date -u +%Y-%m-%dT%H:%M:%SZ) pg-backup end ---"
