#!/usr/bin/env bash
# Backup-age monitor — alerts on RESULT, not on scheduler exit status.
#
# Why: CCIT's 2026-09-22 posture assessment found weeks of silently skipped
# off-host backups; launchd's "last exit 0" said nothing. This checks the
# off-host copies themselves and opens a GitHub issue (the one alert channel this
# box already has — the feedback widget uses the same token/repo) when any of the
# three is older than MAX_AGE_H hours or the share is not mounted. It closes the
# issue with a comment once every backup is fresh again, so the issue's open/closed
# state IS the alert state.
#
# Runs from launchd (com.gc.backup-age-check, daily 09:00) under /bin/bash — bash
# holds the macOS "Network Volumes" grant that lets a background job read the
# SMB share; zsh does not (that gap was the cob-advisor backup's root cause).
#
# Usage: backup-age-check.sh [--dry-run]     env: MAX_AGE_H (default 36)
set -euo pipefail
cd "$(dirname "$0")/../.."
DRY=0; [ "${1:-}" = --dry-run ] && DRY=1
MAX_AGE_H="${MAX_AGE_H:-36}"
SHARE=/Volumes/gc-pks/gc_backups
LABEL=backup-alert
LOG="$HOME/.local/state/gc-curriculum-tool/backup-age.log"; mkdir -p "$(dirname "$LOG")"
ENV_FILE="${ENV_FILE:-$HOME/projects/curriculum_developer-deploy/.env.local}"
stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { echo "$(stamp) $*" | tee -a "$LOG"; }

# --- measure ---------------------------------------------------------------
now=$(date +%s)
age_h() { local t="$1"; [ -n "$t" ] || { echo 999999; return; }; echo $(( (now - t) / 3600 )); }
newest_dir_mtime() { ls -td "$SHARE"/$1_* 2>/dev/null | head -1 | xargs -I{} stat -f %m {} 2>/dev/null || true; }

stale=(); report=()
# Absolute path: /sbin is NOT on the launchd job's PATH, so a bare `mount` is
# "command not found" there — which read as "NOT MOUNTED" and opened issue #6.
mounts=$(/sbin/mount)
if [[ "$mounts" != *" on ${SHARE%/*} ("* ]]; then
  stale+=("share"); report+=("share: NOT MOUNTED ($SHARE)")
else
  for name in gc_curriculum gc_alumni; do
    t=$(newest_dir_mtime "$name"); a=$(age_h "$t")
    report+=("$name: ${a}h (newest $(ls -td "$SHARE"/${name}_* 2>/dev/null | head -1 | xargs basename 2>/dev/null || echo none))")
    [ "$a" -gt "$MAX_AGE_H" ] && stale+=("$name")
  done
  m="$SHARE/cob-advisor/$(hostname -s)/.last-ok"
  t=$([ -f "$m" ] && stat -f %m "$m" || true); a=$(age_h "$t")
  report+=("cob-advisor: ${a}h (marker $( [ -f "$m" ] && cat "$m" || echo missing))")
  [ "$a" -gt "$MAX_AGE_H" ] && stale+=("cob-advisor")
fi
summary=$(printf '%s\n' "${report[@]}")
log "check max=${MAX_AGE_H}h stale=[${stale[*]:-}] :: $(echo "$summary" | tr '\n' ';')"

# --- alert via GitHub issue ---------------------------------------------------
[ -f "$ENV_FILE" ] || { log "no env file $ENV_FILE — cannot alert"; exit 2; }
GH_TOKEN=$(grep -E '^GITHUB_TOKEN=' "$ENV_FILE" | cut -d= -f2- | tr -d '"'"'"' '); export GH_TOKEN
REPO=$(grep -E '^GITHUB_FEEDBACK_REPO=' "$ENV_FILE" | cut -d= -f2- | tr -d '"'"'"' ')
[ -n "$GH_TOKEN" ] && [ -n "$REPO" ] || { log "GITHUB_TOKEN/GITHUB_FEEDBACK_REPO unset — cannot alert"; exit 2; }
gh label create "$LABEL" -R "$REPO" -c B60205 -d "Off-host backup older than threshold" >/dev/null 2>&1 || true
open_issue=$(gh issue list -R "$REPO" -l "$LABEL" -s open --json number -q '.[0].number' 2>/dev/null || true)

if [ ${#stale[@]} -gt 0 ]; then
  title="Backup stale: ${stale[*]} (>${MAX_AGE_H}h)"
  body="Backup-age check on $(hostname -s) at $(stamp) found off-host copies older than ${MAX_AGE_H}h.

\`\`\`
$summary
\`\`\`
Share: $SHARE. Check the producing job's log (\`launchctl list\` last-exit, ~/.local/state/gc-curriculum-tool/*.log, ~/Library/Logs/cuassistant.backup-offbox.log, the alumni backup log). This issue closes automatically when all three are fresh again."
  if [ $DRY = 1 ]; then log "DRY: would $( [ -n "$open_issue" ] && echo "comment on #$open_issue" || echo 'open issue') — $title"; exit 1; fi
  if [ -n "$open_issue" ]; then
    gh issue comment "$open_issue" -R "$REPO" -b "Still stale at $(stamp):
\`\`\`
$summary
\`\`\`" >/dev/null && log "commented on #$open_issue"
  else
    n=$(gh issue create -R "$REPO" -t "$title" -l "$LABEL" -b "$body" 2>/dev/null | grep -oE '[0-9]+$') && log "opened issue #$n: $title"
  fi
  exit 1
else
  if [ -n "$open_issue" ]; then
    if [ $DRY = 1 ]; then log "DRY: would close #$open_issue (recovered)"; exit 0; fi
    gh issue close "$open_issue" -R "$REPO" -c "Recovered at $(stamp) — all backups within ${MAX_AGE_H}h:
\`\`\`
$summary
\`\`\`" >/dev/null && log "closed #$open_issue (recovered)"
  fi
  exit 0
fi
