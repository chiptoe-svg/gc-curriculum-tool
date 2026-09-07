#!/usr/bin/env bash
# Watchdog for the curriculum-tool production server + its remote-access path.
#
# Two independent responsibilities, both idempotent and safe to run every cycle:
#
#   1. Tailscale reachability. The serve/Funnel URL is the only way in for a
#      headless operator, and it can be down while the app itself is perfectly
#      healthy — so the loopback probe below cannot see it. Checked first.
#   2. App health. launchd already restarts the process if it CRASHES (KeepAlive
#      in com.gc.curriculum-tool.plist). This handles the OTHER failure mode:
#      process alive but returning 5xx. Faculty hit Internal Server Error with
#      no obvious fix.
#
# App recovery is two-escalation:
#   1. launchctl kickstart -k (gentle restart)
#   2. give up + log "manual intervention needed"
#
# There used to be a middle tier that ran `rm -rf <dev-checkout>/.next` before
# kickstarting. It was dead code and was removed 2026-08-21: it pointed at the DEV
# checkout, but com.gc.curriculum-tool serves the DEPLOY worktree
# (~/projects/curriculum_developer-deploy), so it deleted a directory that does
# not exist. Repointing it at the deploy worktree would have been worse, not
# better — that service runs `next start` over a COMPILED build, so clearing its
# .next leaves production serving nothing until someone runs `pnpm build` by
# hand. A cache-corruption tier would have to rebuild, not delete; until there
# is an observed failure that needs it, kickstart-or-escalate is the honest set.
#
# Runs every 5 minutes via com.gc.dev-watchdog.plist. Logs only on unhealthy
# detection + recovery actions + a once-daily heartbeat. Healthy checks are
# silent (no log noise).

set -uo pipefail

LOG_DIR="$HOME/.local/state/gc-curriculum-tool"
LOG_FILE="$LOG_DIR/watchdog.log"
HEARTBEAT_DIR="$LOG_DIR/watchdog-heartbeats"
HEALTH_URL="http://127.0.0.1:3000/"
TIMEOUT_SECS=10
PROBE_SLEEP=12     # after kickstart, time for Next to start serving

mkdir -p "$LOG_DIR" "$HEARTBEAT_DIR"
TS() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Returns the HTTP status code (or "000" on transport error).
# Use `curl -k` and switch HEALTH_URL to https when running `pnpm dev:lan-https`.
probe() {
  curl -sS -o /dev/null -m "$TIMEOUT_SECS" -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || echo "000"
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

# === 1. App health check ===
# (A Tailscale reconnect block lived here 2026-08-21 → 09-07. Removed when
# Tailscale was retired: gcworkflow.clemson.edu:8443 via Caddy is now the only
# HTTPS path, and Caddy is a launchd service with KeepAlive. Left in place it
# would have logged "needs manual login" every 5 minutes forever once the node
# was logged out. Caddy/TLS health is not yet watched — see STATE Deferred/debt.)

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

# Tier 2: give up
echo "$(TS)   GAVE UP — manual intervention needed (final code=$CODE_AFTER_KICKSTART)" >> "$LOG_FILE"
exit 1
