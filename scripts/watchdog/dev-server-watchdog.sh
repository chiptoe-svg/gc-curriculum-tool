#!/usr/bin/env bash
# Watchdog for the curriculum-tool dev server.
#
# launchd already restarts the process if it CRASHES (KeepAlive in
# com.gc.curriculum-tool.plist). This watchdog handles the OTHER failure
# mode: process is alive but returning 5xx (Turbopack cache corruption,
# half-applied schema changes, etc.). Faculty hit Internal Server Error
# with no obvious fix.
#
# Three-escalation recovery:
#   1. launchctl kickstart -k (gentle restart)
#   2. rm -rf .next + kickstart (cache clear + restart)
#   3. give up + log "manual intervention needed"
#
# Runs every 5 minutes via com.gc.dev-watchdog.plist. Logs only on
# unhealthy detection + recovery actions + a once-daily heartbeat.
# Healthy checks are silent (no log noise).

set -uo pipefail

REPO_DIR="/Users/admin/projects/curriculum_developer"
LOG_DIR="$HOME/.local/state/gc-curriculum-tool"
LOG_FILE="$LOG_DIR/watchdog.log"
HEARTBEAT_DIR="$LOG_DIR/watchdog-heartbeats"
HEALTH_URL="https://127.0.0.1:3000/"
TIMEOUT_SECS=10
PROBE_SLEEP=12     # after kickstart, time for Next to start serving
REBUILD_SLEEP=25   # after .next clear + kickstart, longer compile cycle

mkdir -p "$LOG_DIR" "$HEARTBEAT_DIR"
TS() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Returns the HTTP status code (or "000" on transport error).
# -k accepts the self-signed cert (mkcert root isn't installed system-wide).
probe() {
  curl -sS -k -o /dev/null -m "$TIMEOUT_SECS" -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || echo "000"
}

# Unhealthy: 5xx code OR "000" (curl error / timeout).
# Healthy: anything else, including 401 (Basic Auth WWW-Authenticate
# challenge — server is up, just needs creds).
is_unhealthy() {
  local code="$1"
  [[ "$code" == "000" ]] && return 0
  [[ "$code" =~ ^5[0-9][0-9]$ ]] && return 0
  return 1
}

kickstart() {
  launchctl kickstart -k "gui/$(id -u)/com.gc.curriculum-tool" 2>&1 | head -1
}

# Daily heartbeat — proves the cron itself is firing.
HEARTBEAT_TODAY="$HEARTBEAT_DIR/$(date -u +%Y-%m-%d).txt"
if [ ! -f "$HEARTBEAT_TODAY" ]; then
  echo "$(TS) heartbeat — watchdog cron is running" >> "$LOG_FILE"
  touch "$HEARTBEAT_TODAY"
  find "$HEARTBEAT_DIR" -type f -mtime +14 -delete 2>/dev/null
fi

# === Health check ===
INITIAL_CODE=$(probe)

if ! is_unhealthy "$INITIAL_CODE"; then
  # Healthy. Silent exit.
  exit 0
fi

# === Recovery cascade ===
echo "$(TS) UNHEALTHY initial-code=$INITIAL_CODE" >> "$LOG_FILE"

# Tier 1: kickstart
echo "$(TS)   action=kickstart" >> "$LOG_FILE"
kickstart >> "$LOG_FILE" 2>&1
sleep "$PROBE_SLEEP"

CODE_AFTER_KICKSTART=$(probe)
if ! is_unhealthy "$CODE_AFTER_KICKSTART"; then
  echo "$(TS)   RECOVERED after kickstart (code=$CODE_AFTER_KICKSTART)" >> "$LOG_FILE"
  exit 0
fi

# Tier 2: clear .next + kickstart
echo "$(TS)   still-unhealthy code=$CODE_AFTER_KICKSTART, clearing .next + kickstart" >> "$LOG_FILE"
rm -rf "$REPO_DIR/.next" 2>>"$LOG_FILE"
kickstart >> "$LOG_FILE" 2>&1
sleep "$REBUILD_SLEEP"

CODE_AFTER_REBUILD=$(probe)
if ! is_unhealthy "$CODE_AFTER_REBUILD"; then
  echo "$(TS)   RECOVERED after .next clear (code=$CODE_AFTER_REBUILD)" >> "$LOG_FILE"
  exit 0
fi

# Tier 3: give up
echo "$(TS)   GAVE UP — manual intervention needed (final code=$CODE_AFTER_REBUILD)" >> "$LOG_FILE"
exit 1
