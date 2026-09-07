#!/usr/bin/env bash
# Watchdog for the curriculum-tool production server + its TLS ingress.
#
# Two independent responsibilities, both idempotent and safe to run every cycle:
#
#   1. Caddy / TLS ingress. gcworkflow.clemson.edu:8443 is the ONLY way in for
#      a user once cleartext :3000 is closed off, and it can be down while the
#      app itself is perfectly healthy — the loopback probe below cannot see it.
#      Checked first. (Replaced a Tailscale reconnect block, removed 2026-09-07
#      when Tailscale was retired.)
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
# NOTE (2026-09-07): do NOT write this as `curl … || echo "000"`. On a transport
# failure curl BOTH prints "000" (from -w) AND exits non-zero, so the `||` used
# to append a second one — yielding "000000", which matches neither branch of
# is_unhealthy. A fully-down server therefore read as HEALTHY, defeating this
# script's main purpose; only 5xx was ever detected. Capture, then default.
probe() {
  local out
  out=$(curl -sS -o /dev/null -m "$TIMEOUT_SECS" -w '%{http_code}' "$HEALTH_URL" 2>/dev/null)
  printf '%s' "${out:-000}"
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

# Caddy is the ONLY network ingress once cleartext :3000 is closed off, so its
# health is now as load-bearing as the app's. Probe the real TLS path (SNI +
# cert validation, no -k) and kickstart com.gc.caddy-tls if it's down. Also warn
# well before the InCommon cert expires — it is MANUAL-renewal (2027-01-21), and
# after the loopback cutover an expired cert is a total outage, not a degraded
# path. Silent when healthy.
CADDY_URL="https://gcworkflow.clemson.edu:8443/"
CADDY_IP="130.127.162.67"
CERT_WARN_DAYS=30

caddy_probe() {
  local out
  out=$(curl -sS -o /dev/null -m "$TIMEOUT_SECS" -w '%{http_code}' \
    --resolve "gcworkflow.clemson.edu:8443:$CADDY_IP" "$CADDY_URL" 2>/dev/null)
  printf '%s' "${out:-000}"   # see the probe() note — never `|| echo "000"`
}

check_caddy() {
  local code
  code=$(caddy_probe)
  if is_unhealthy "$code"; then
    echo "$(TS) CADDY UNHEALTHY code=$code — kickstarting com.gc.caddy-tls" >> "$LOG_FILE"
    launchctl kickstart -k "gui/$(id -u)/com.gc.caddy-tls" >> "$LOG_FILE" 2>&1
    sleep "$PROBE_SLEEP"
    code=$(caddy_probe)
    if is_unhealthy "$code"; then
      echo "$(TS)   CADDY STILL DOWN (code=$code) — manual intervention needed" >> "$LOG_FILE"
    else
      echo "$(TS)   CADDY RECOVERED (code=$code)" >> "$LOG_FILE"
    fi
  fi

  # Cert expiry — once daily (FIRST_RUN_TODAY is captured BEFORE the heartbeat
  # file is created; guarding on the file itself would never fire).
  if [ "$FIRST_RUN_TODAY" = "1" ]; then
    local end_date end_epoch now_epoch days
    end_date=$(echo | openssl s_client -connect "$CADDY_IP:8443" -servername gcworkflow.clemson.edu 2>/dev/null \
      | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
    if [ -n "$end_date" ]; then
      end_epoch=$(date -j -f "%b %e %H:%M:%S %Y %Z" "$end_date" +%s 2>/dev/null || echo "")
      now_epoch=$(date +%s)
      if [ -n "$end_epoch" ]; then
        days=$(( (end_epoch - now_epoch) / 86400 ))
        if [ "$days" -le "$CERT_WARN_DAYS" ]; then
          echo "$(TS) CERT EXPIRING in ${days}d ($end_date) — MANUAL renewal; see STATE.md" >> "$LOG_FILE"
        fi
      fi
    fi
  fi
}

# Daily heartbeat — proves the cron itself is firing.
HEARTBEAT_TODAY="$HEARTBEAT_DIR/$(date -u +%Y-%m-%d).txt"
FIRST_RUN_TODAY=0
[ -f "$HEARTBEAT_TODAY" ] || FIRST_RUN_TODAY=1
if [ "$FIRST_RUN_TODAY" = "1" ]; then
  echo "$(TS) heartbeat — watchdog cron is running" >> "$LOG_FILE"
  touch "$HEARTBEAT_TODAY"
  find "$HEARTBEAT_DIR" -type f -mtime +14 -delete 2>/dev/null
fi

# === 1. Caddy / TLS ingress ===
check_caddy

# === 2. App health check ===

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
