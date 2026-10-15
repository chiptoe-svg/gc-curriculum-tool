#!/bin/bash
# Refresh the owner's Clemson web copies (owner, 2026-10-15):
#   docs  -> https://tonkin.people.clemson.edu/pages/gc-curriculum/  (from origin/main)
#   wiki  -> https://tonkin.people.clemson.edu/pages/gc-wiki/        (snapshot of the running app's public /wiki)
#
# Runs nightly (launchd com.gc.clemson-publish) and after `pnpm wiki:publish`.
# Docs are published from a detached worktree at origin/main, so uncommitted or
# unpushed work in the dev checkout never goes out.
#
# Alerts on RESULT: a failure adds a "stuck" item to the curriculum dashboard
# (https://gcworkflow.clemson.edu:8443/board/curriculum/) and exits 1; the next
# success removes it.
set -uo pipefail

REPO=/Users/admin/projects/curriculum_developer
PUB="$HOME/.local/share/gc-curriculum-tool/publish-main"
SHARE="${CLEMSON_SHARE:-/Volumes/people}"  # override only to test the failure alert
SMB_URL="smb://tonkin@people.zfs.clemson.edu/people"
STATE="$REPO/.dashboard/state.json"
STUCK_KEY="Clemson web copies"

log() { echo "$(date '+%Y-%m-%dT%H:%M:%S%z') $*"; }

dashboard() { # dashboard ok | dashboard fail "<reason>"
  [ -f "$STATE" ] || return 0
  python3 - "$STATE" "$STUCK_KEY" "$1" "${2:-}" <<'PY'
import json, sys, datetime
path, key, mode, reason = sys.argv[1:5]
s = json.load(open(path))
stuck = [x for x in s.get('stuck', []) if not str(x.get('what', '')).startswith(key)]
prev = next((x for x in s.get('stuck', []) if str(x.get('what', '')).startswith(key)), None)
if mode == 'ok' and prev is None:
    sys.exit(0)  # nothing to clear; leave the dashboard untouched
now = datetime.datetime.now().astimezone().isoformat(timespec='seconds')
if mode == 'fail':
    stuck.append({'what': f'{key} not refreshed: {reason}',
                  'since': prev['since'] if prev else now,
                  'who': 'Chip: reconnect smb://people.zfs.clemson.edu/people in Finder (save the password in Keychain), then run pnpm publish:clemson'})
s['stuck'] = stuck
s['updated'] = now
json.dump(s, open(path, 'w'), indent=2, ensure_ascii=False)
PY
  "$HOME/.claude/dashboard/sync.sh" curriculum "$REPO" >/dev/null 2>&1 || true
}

fail() { log "FAILED: $1"; dashboard fail "$1"; exit 1; }

# --- share mounted? (SMB idle-disconnects overnight; same guard as full-backup.sh) ---
if [ ! -d "$SHARE" ]; then
  log "$SHARE not mounted; attempting remount of $SMB_URL"
  # Background + poll: without a Keychain credential osascript can hang on an
  # auth prompt nobody sees.
  osascript -e "mount volume \"$SMB_URL\"" >/dev/null 2>&1 &
  OSA_PID=$!
  WAITED=0
  while [ ! -d "$SHARE" ] && [ "$WAITED" -lt 45 ]; do sleep 5; WAITED=$((WAITED + 5)); done
  kill "$OSA_PID" 2>/dev/null; wait "$OSA_PID" 2>/dev/null
  [ -d "$SHARE" ] || fail "Clemson share not connected (remount failed)"
  log "remount succeeded after ${WAITED}s"
fi
[ -d "$SHARE/tonkin" ] || fail "Clemson share mounted but $SHARE/tonkin is missing"

# --- docs from origin/main ---
if [ ! -d "$PUB" ]; then
  mkdir -p "$(dirname "$PUB")"
  git -C "$REPO" worktree add --detach "$PUB" origin/main >/dev/null 2>&1 || fail "could not create publish worktree"
fi
git -C "$PUB" fetch -q origin main || fail "git fetch failed"
git -C "$PUB" checkout -q --detach origin/main || fail "git checkout of origin/main failed"
log "docs at $(git -C "$PUB" rev-parse --short HEAD)"
(cd "$PUB" && node scripts/docs/publish-clemson.mjs --apply | tail -1) || fail "docs publish failed"

# --- wiki snapshot from the running app ---
curl -s -o /dev/null -f --max-time 20 http://127.0.0.1:3000/wiki || fail "app not answering on :3000 (wiki snapshot skipped)"
(cd "$PUB" && node scripts/wiki/snapshot-public.mjs --apply | tail -1) || fail "wiki snapshot failed"

dashboard ok
log "ok"
