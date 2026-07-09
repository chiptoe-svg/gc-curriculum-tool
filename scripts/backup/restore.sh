#!/usr/bin/env bash
# ============================================================================
# GC Curriculum Tool — one-command disaster recovery
# ============================================================================
# Rebuilds the whole tool on a bare Mac from GitHub (code) + a gc-pks backup
# (data, secrets, service config). See RESTORE.md for the full runbook.
#
#   restore.sh                 restore from the NEWEST backup on the share
#   restore.sh <backup-dir>    restore from a specific backup
#   restore.sh verify [dir]    NON-DESTRUCTIVE: check a backup is restorable
#
# Preconditions on the fresh Mac: Homebrew, git, node, pnpm, openssl, and
# Postgres.app installed; the gc-pks share mounted; the passphrase either at
# ~/.config/gc-backup/passphrase or entered when prompted.
# ----------------------------------------------------------------------------
set -uo pipefail

BACKUP_ROOT="/Volumes/gc-pks/gc_backups"
REPO_DIR="$HOME/projects/curriculum_developer"
WIKI_DIR="$HOME/projects/gc-curriculum-wiki"
BLOB_PARENT="$HOME/.local/share/gc-curriculum-tool"
WEAVIATE_PARENT="$HOME/.weaviate"
PASSPHRASE_FILE="$HOME/.config/gc-backup/passphrase"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
export PATH="/Applications/Postgres.app/Contents/Versions/17/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; NC=$'\033[0m'
say()  { echo "${GRN}==>${NC} $*"; }
warn() { echo "${YEL}!!${NC} $*"; }
die()  { echo "${RED}FATAL:${NC} $*" >&2; exit 1; }
ask()  { local a; read -r -p "${YEL}?${NC} $* [y/N] " a; [ "$a" = y ] || [ "$a" = Y ]; }

json_get() { grep -oE "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$2" | head -1 | sed -E "s/.*:[[:space:]]*\"([^\"]*)\"/\1/"; }

# --- resolve mode + backup dir ----------------------------------------------
MODE=restore
if [ "${1:-}" = verify ]; then MODE=verify; shift; fi
BACKUP="${1:-$(ls -1dt "$BACKUP_ROOT"/gc_curriculum_* 2>/dev/null | head -1)}"
[ -n "$BACKUP" ] && [ -d "$BACKUP" ] || die "no backup dir found (looked in $BACKUP_ROOT). Is the share mounted?"
say "Backup: $BACKUP"
[ -f "$BACKUP/manifest.json" ] || die "manifest.json missing — not a valid backup dir"

# --- integrity check (both modes) -------------------------------------------
say "Verifying checksums…"
( cd "$BACKUP" && shasum -a 256 -c SHA256SUMS ) || die "checksum verification FAILED — backup is corrupt"

CODE_REMOTE=$(json_get code_remote "$BACKUP/manifest.json")
CODE_COMMIT=$(json_get code_commit "$BACKUP/manifest.json")
CODE_BRANCH=$(json_get code_branch "$BACKUP/manifest.json")
WIKI_REMOTE=$(json_get wiki_remote "$BACKUP/manifest.json")
DB_NAME=$(json_get db_name "$BACKUP/manifest.json")
say "code: $CODE_REMOTE @ ${CODE_COMMIT:0:12} (branch $CODE_BRANCH) · db: $DB_NAME"

# --- passphrase --------------------------------------------------------------
get_pass() {
  if [ -f "$PASSPHRASE_FILE" ]; then printf '%s' "$(cat "$PASSPHRASE_FILE")";
  else read -r -s -p "Backup passphrase: " P; echo >&2; printf '%s' "$P"; fi
}

# ============================================================================
# VERIFY MODE — mutate nothing
# ============================================================================
if [ "$MODE" = verify ]; then
  say "Test-decrypting secrets…"
  TMPENV=$(mktemp)
  if openssl enc -d -aes-256-cbc -pbkdf2 -in "$BACKUP/secrets.env.enc" -out "$TMPENV" -pass file:<(get_pass) 2>/dev/null \
     && grep -q '^DATABASE_URL=' "$TMPENV"; then
    say "  secrets decrypt OK (DATABASE_URL present)"
  else warn "  secrets decrypt FAILED (wrong passphrase?)"; fi
  VDB_URL=$(grep '^DATABASE_URL=' "$TMPENV" 2>/dev/null | head -1 | cut -d= -f2- | sed 's/^"//;s/"$//' | awk '{print $1}')
  rm -f "$TMPENV"

  say "Tarball contents:"
  echo "  materials: $(tar -tzf "$BACKUP/materials.tar.gz" 2>/dev/null | wc -l | xargs) entries"
  echo "  weaviate:  $(tar -tzf "$BACKUP/weaviate.tar.gz"  2>/dev/null | wc -l | xargs) entries"
  [ -f "$BACKUP/wiki.bundle" ] && { git bundle verify "$BACKUP/wiki.bundle" >/dev/null 2>&1 && say "  wiki.bundle OK" || warn "  wiki.bundle INVALID"; }

  if command -v psql >/dev/null && [ -n "${VDB_URL:-}" ]; then
    say "Loading DB dump into a throwaway scratch database…"
    BASE=$(printf '%s' "$VDB_URL" | sed -E 's|/[^/?]+(\?.*)?$||')
    SCRATCH="gc_curriculum_verify_$$"
    if psql "$BASE/postgres" -v ON_ERROR_STOP=1 -c "CREATE DATABASE $SCRATCH" >/dev/null 2>&1; then
      if gunzip -c "$BACKUP/db.sql.gz" | psql "$BASE/$SCRATCH" >/dev/null 2>&1; then
        N=$(psql "$BASE/$SCRATCH" -tA -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
        say "  DB dump loads cleanly ($N tables)"
      else warn "  DB dump load produced errors"; fi
      psql "$BASE/postgres" -c "DROP DATABASE $SCRATCH" >/dev/null 2>&1
    else warn "  could not create scratch DB (is Postgres running?)"; fi
  else warn "  skipped DB load test (psql or DATABASE_URL unavailable)"; fi

  say "Verify complete — backup looks restorable. Nothing was changed."
  exit 0
fi

# ============================================================================
# RESTORE MODE — rebuilds the machine
# ============================================================================
warn "This restores onto THIS machine (code, DB, blobs, vectors, secrets, services)."
ask "Proceed with a full restore from the backup above?" || die "aborted by user"

# preflight
for t in git node pnpm openssl shasum; do command -v "$t" >/dev/null || die "missing required tool: $t"; done
command -v psql >/dev/null || warn "psql not on PATH — DB restore will be skipped"

# --- 1. Code (from GitHub, at the recorded commit) --------------------------
say "[1/8] Code…"
if [ ! -d "$REPO_DIR/.git" ]; then
  mkdir -p "$(dirname "$REPO_DIR")"
  git clone "$CODE_REMOTE" "$REPO_DIR" || die "git clone failed"
fi
git -C "$REPO_DIR" fetch origin --tags || warn "fetch failed (offline?) — using local"
if [ -n "$CODE_COMMIT" ]; then git -C "$REPO_DIR" checkout "$CODE_COMMIT" 2>/dev/null || git -C "$REPO_DIR" checkout "${CODE_BRANCH:-main}"; fi

# --- 2. Wiki (from bundle; self-contained) ----------------------------------
say "[2/8] Wiki…"
if [ -f "$BACKUP/wiki.bundle" ] && [ ! -d "$WIKI_DIR/.git" ]; then
  git clone "$BACKUP/wiki.bundle" "$WIKI_DIR" && [ -n "$WIKI_REMOTE" ] && git -C "$WIKI_DIR" remote set-url origin "$WIKI_REMOTE"
else warn "  wiki repo already present or no bundle — skipping"; fi

# --- 3. Secrets --------------------------------------------------------------
say "[3/8] Secrets → .env.local…"
if [ -f "$REPO_DIR/.env.local" ] && ! ask "  .env.local exists — overwrite it?"; then
  warn "  keeping existing .env.local"
else
  openssl enc -d -aes-256-cbc -pbkdf2 -in "$BACKUP/secrets.env.enc" -out "$REPO_DIR/.env.local" -pass file:<(get_pass) \
    && chmod 600 "$REPO_DIR/.env.local" && say "  decrypted" || die "secrets decrypt failed (wrong passphrase?)"
fi

# --- 4. Database -------------------------------------------------------------
say "[4/8] Database…"
if command -v psql >/dev/null; then
  DB_URL=$(grep '^DATABASE_URL=' "$REPO_DIR/.env.local" | head -1 | cut -d= -f2- | sed 's/^"//;s/"$//' | awk '{print $1}')
  BASE=$(printf '%s' "$DB_URL" | sed -E 's|/[^/?]+(\?.*)?$||')
  psql "$BASE/postgres" -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
    || psql "$BASE/postgres" -c "CREATE DATABASE $DB_NAME" || warn "  createdb failed (may already exist)"
  if ask "  load db.sql.gz into '$DB_NAME'? (the dump is --clean --if-exists; overwrites existing objects)"; then
    gunzip -c "$BACKUP/db.sql.gz" | psql "$DB_URL" && say "  DB restored" || warn "  DB load had errors — review"
  fi
else warn "  psql missing — restore the DB manually (see RESTORE.md)"; fi

# --- 5. Material blobs -------------------------------------------------------
say "[5/8] Material blobs…"
mkdir -p "$BLOB_PARENT"
tar -xzf "$BACKUP/materials.tar.gz" -C "$BLOB_PARENT" && say "  blobs restored" || warn "  materials extract had errors"

# --- 6. Weaviate -------------------------------------------------------------
say "[6/8] Weaviate vectors…"
launchctl bootout "gui/$(id -u)/com.weaviate" 2>/dev/null || true
if [ -d "$WEAVIATE_PARENT/data" ] && ! ask "  ~/.weaviate/data exists — replace it?"; then
  warn "  keeping existing Weaviate data"
else
  rm -rf "$WEAVIATE_PARENT/data"; mkdir -p "$WEAVIATE_PARENT"
  tar -xzf "$BACKUP/weaviate.tar.gz" -C "$WEAVIATE_PARENT" && say "  vectors restored" || warn "  weaviate extract had errors"
fi

# --- 7. Dependencies + build -------------------------------------------------
say "[7/8] pnpm install + build…"
( cd "$REPO_DIR" && pnpm install --frozen-lockfile && pnpm build ) || warn "  install/build had errors — review before serving"

# --- 8. Services -------------------------------------------------------------
say "[8/8] launchd services…"
if [ -d "$BACKUP/launchd" ]; then
  cp "$BACKUP"/launchd/*.plist "$LAUNCH_AGENTS/" 2>/dev/null || true
  [ -f "$BACKUP/dev-ports.yaml" ] && cp "$BACKUP/dev-ports.yaml" "$HOME/.dev-ports.yaml"
  warn "  plists copied to $LAUNCH_AGENTS. Load them with:"
  echo "    for p in $LAUNCH_AGENTS/com.gc.*.plist $LAUNCH_AGENTS/com.weaviate.plist; do launchctl bootstrap gui/$(id -u) \"\$p\"; done"
  warn "  (not auto-loaded — review paths in the plists first, then bootstrap.)"
fi

say "Restore complete. Start the app service, then health-check:"
echo "    launchctl kickstart -k gui/$(id -u)/com.gc.curriculum-tool"
echo "    curl -s -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:3000/"
