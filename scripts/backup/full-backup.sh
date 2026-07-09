#!/usr/bin/env bash
# ============================================================================
# GC Curriculum Tool — full disaster-recovery backup
# ============================================================================
# Writes ONE self-contained, timestamped backup to the gc-pks network share.
# Pairs with restore.sh (same dir) for one-command recovery from a bare Mac.
#
# What a backup contains (everything NOT already in GitHub):
#   db.sql.gz          pg_dump of the gc_curriculum Postgres DB
#   materials.tar.gz   uploaded material blobs (~/.local/share/.../materials)
#   weaviate.tar.gz    Weaviate vector store (~/.weaviate/data)
#   secrets.env.enc    .env.local, AES-256 encrypted (openssl, passphrase)
#   wiki.bundle        git bundle of the gc-curriculum-wiki repo (self-contained)
#   launchd/*.plist    the com.gc.* + com.weaviate service definitions
#   dev-ports.yaml     the local port registry
#   manifest.json      code commit SHA + git remotes + sizes + timestamps
#   SHA256SUMS         checksums of every artifact (restore verifies these)
#   RESTORE.md         the recovery runbook
#
# The code itself is NOT copied — it lives in GitHub and restore.sh clones it
# at the exact commit recorded in manifest.json.
#
# Independent second line of defence (unchanged): pg-snapshot.sh still dumps
# the DB every 6h locally + weekly to GitHub chiptoe-svg/gc-curriculum-backups.
#
# Scheduled daily by launchd (com.gc.full-backup). Safe to run by hand.
# ----------------------------------------------------------------------------
set -uo pipefail

REPO_DIR="/Users/admin/projects/curriculum_developer"
WIKI_DIR="/Users/admin/projects/gc-curriculum-wiki"
BLOB_DIR="$HOME/.local/share/gc-curriculum-tool/materials"
WEAVIATE_DIR="$HOME/.weaviate/data"
BACKUP_ROOT="/Volumes/gc-pks/gc_backups"
PASSPHRASE_FILE="$HOME/.config/gc-backup/passphrase"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/.local/state/gc-curriculum-tool"
LOG_FILE="$LOG_DIR/full-backup.log"
RETENTION_KEEP=30   # keep the newest N backups on the share

# Postgres.app bundles a pg_dump matched to the local server; keep brew + system on PATH too.
export PATH="/Applications/Postgres.app/Contents/Versions/17/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

mkdir -p "$LOG_DIR"
# When run by launchd, keep a log. When run by hand, also echo to the terminal.
if [ -t 1 ]; then :; else exec >> "$LOG_FILE" 2>&1; fi
echo "=== $(date -u +%FT%TZ) full-backup start ==="

fail() { echo "FATAL: $*"; [ -n "${TMP:-}" ] && rm -rf "$TMP"; exit 1; }

# --- Preconditions -----------------------------------------------------------
# Volume not mounted is NOT an error (the share may be detached) — log + exit 0
# so launchd doesn't treat it as a crash and back off.
[ -d "$BACKUP_ROOT" ] || { echo "backup volume $BACKUP_ROOT not mounted — skipping this run"; exit 0; }
[ -f "$PASSPHRASE_FILE" ] || fail "passphrase file missing at $PASSPHRASE_FILE (see scripts/backup/RESTORE.md)"
[ -d "$REPO_DIR/.git" ] || fail "repo not found at $REPO_DIR"
command -v pg_dump >/dev/null || fail "pg_dump not on PATH"
command -v openssl >/dev/null || fail "openssl not on PATH"
cd "$REPO_DIR" || fail "cd $REPO_DIR"

DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | head -1 | cut -d= -f2- | sed 's/^"//;s/"$//' | awk '{print $1}')
[ -n "$DATABASE_URL" ] || fail "DATABASE_URL not readable from .env.local"

TS=$(date -u +%Y-%m-%d_%H%M%SZ)
DEST="$BACKUP_ROOT/gc_curriculum_$TS"
TMP="$DEST.partial"
rm -rf "$TMP"; mkdir -p "$TMP/launchd" || fail "cannot create $TMP"

# --- 1. Database -------------------------------------------------------------
echo "[1/8] pg_dump…"
pg_dump "$DATABASE_URL" --no-owner --no-acl --clean --if-exists | gzip > "$TMP/db.sql.gz" \
  || fail "pg_dump failed"

# --- 2. Material blobs -------------------------------------------------------
echo "[2/8] materials…"
if [ -d "$BLOB_DIR" ]; then
  tar -czf "$TMP/materials.tar.gz" -C "$(dirname "$BLOB_DIR")" "$(basename "$BLOB_DIR")" || fail "materials tar failed"
else
  echo "  (no blob dir — writing empty marker)"; : | gzip > "$TMP/materials.tar.gz"
fi

# --- 3. Weaviate vectors -----------------------------------------------------
echo "[3/8] weaviate…"
if [ -d "$WEAVIATE_DIR" ]; then
  tar -czf "$TMP/weaviate.tar.gz" -C "$(dirname "$WEAVIATE_DIR")" "$(basename "$WEAVIATE_DIR")" || fail "weaviate tar failed"
else
  echo "  (no weaviate dir — writing empty marker)"; : | gzip > "$TMP/weaviate.tar.gz"
fi

# --- 4. Secrets (encrypted) --------------------------------------------------
echo "[4/8] secrets (encrypted)…"
openssl enc -aes-256-cbc -pbkdf2 -salt -in .env.local -out "$TMP/secrets.env.enc" -pass file:"$PASSPHRASE_FILE" \
  || fail "openssl encrypt failed"

# --- 5. Wiki bundle (self-contained; restorable even if GitHub is gone) ------
echo "[5/8] wiki bundle…"
if [ -d "$WIKI_DIR/.git" ]; then
  git -C "$WIKI_DIR" bundle create "$TMP/wiki.bundle" --all || fail "wiki bundle failed"
else
  echo "  (no wiki repo at $WIKI_DIR — skipping)"
fi

# --- 6. Service config -------------------------------------------------------
echo "[6/8] launchd plists + port registry…"
cp "$LAUNCH_AGENTS"/com.gc.*.plist "$TMP/launchd/" 2>/dev/null || true
cp "$LAUNCH_AGENTS"/com.weaviate.plist "$TMP/launchd/" 2>/dev/null || true
cp "$HOME/.dev-ports.yaml" "$TMP/dev-ports.yaml" 2>/dev/null || true

# --- 7. Manifest + checksums -------------------------------------------------
echo "[7/8] manifest + checksums…"
CODE_SHA=$(git -C "$REPO_DIR" rev-parse HEAD)
CODE_BRANCH=$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo detached)
CODE_REMOTE=$(git -C "$REPO_DIR" remote get-url origin 2>/dev/null || echo "")
WIKI_REMOTE=$(git -C "$WIKI_DIR" remote get-url origin 2>/dev/null || echo "")
DB_NAME=$(printf '%s' "$DATABASE_URL" | sed -E 's|.*/([^/?]+).*|\1|')
cat > "$TMP/manifest.json" <<JSON
{
  "tool": "gc-curriculum-tool",
  "created_utc": "$(date -u +%FT%TZ)",
  "host": "$(hostname)",
  "code_remote": "$CODE_REMOTE",
  "code_branch": "$CODE_BRANCH",
  "code_commit": "$CODE_SHA",
  "wiki_remote": "$WIKI_REMOTE",
  "db_name": "$DB_NAME",
  "storage_root": "$BLOB_DIR",
  "weaviate_dir": "$WEAVIATE_DIR",
  "secrets_cipher": "openssl aes-256-cbc -pbkdf2 (passphrase)",
  "artifacts": ["db.sql.gz","materials.tar.gz","weaviate.tar.gz","secrets.env.enc","wiki.bundle"]
}
JSON
( cd "$TMP" && shasum -a 256 db.sql.gz materials.tar.gz weaviate.tar.gz secrets.env.enc $( [ -f wiki.bundle ] && echo wiki.bundle ) manifest.json > SHA256SUMS ) \
  || fail "checksum failed"

# --- 8. Runbook + atomic finalize -------------------------------------------
echo "[8/8] runbook + finalize…"
cp "$REPO_DIR/scripts/backup/RESTORE.md" "$TMP/RESTORE.md" 2>/dev/null || true
rm -rf "$DEST"
mv "$TMP" "$DEST" || fail "finalize mv failed"
SIZE=$(du -sh "$DEST" | awk '{print $1}')
echo "backup complete → $DEST ($SIZE)"

# --- Retention: keep the newest N backups (bash 3.2-safe, no mapfile) --------
ls -1dt "$BACKUP_ROOT"/gc_curriculum_* 2>/dev/null | tail -n +$((RETENTION_KEEP + 1)) | while read -r d; do
  [ -n "$d" ] && { echo "pruning old backup: $d"; rm -rf "$d"; }
done

echo "=== $(date -u +%FT%TZ) full-backup end ==="
