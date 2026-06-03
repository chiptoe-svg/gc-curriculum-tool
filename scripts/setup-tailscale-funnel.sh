#!/usr/bin/env bash
# Set up Tailscale Funnel on this Mac to expose ONLY the voice-bridge
# paths over HTTPS. Everything else stays LAN-only HTTP.
#
# Prerequisites:
#   1. Tailscale.app installed + signed in. Install with:
#        brew install --cask tailscale-app   (needs sudo for the .pkg)
#      Then launch the app once and sign in.
#   2. In the Tailscale admin web UI:
#        - DNS panel → click "Enable HTTPS..." (provisions Let's Encrypt cert)
#        - Access Controls panel → add a top-level nodeAttrs block granting
#          this machine the "funnel" attribute. (See setup-tailscale.md for
#          the exact JSON snippet, or the chat history with Claude.)
#   3. Verify with: tailscale funnel status (should not say "no permission")
#
# Then run this script. Idempotent — re-runnable after Tailscale upgrades
# or after a reboot. The funnel config is persistent across reboots.
#
# History: this previously used `tailscale serve set-config <json-file>`,
# which broke in Tailscale v1.98 (requires --all/--service AND a versioned
# JSON schema). Switched to per-handler `tailscale funnel` invocations,
# which match the stable CLI surface and mount each path with its full
# upstream URL (so Next.js sees the original path, not "/" — otherwise
# Basic Auth middleware gates the funnel-side request).

set -euo pipefail

if ! command -v tailscale > /dev/null 2>&1; then
  echo "ERROR: tailscale CLI not found. Install Tailscale.app first."
  echo "  brew install --cask tailscale-app"
  echo "  open /Applications/Tailscale.app"
  exit 1
fi

# Confirm Tailscale is up + signed in. Extract the machine's tailnet
# DNS name so we can build the funnel URL the rest of the app expects.
STATUS_JSON=$(tailscale status --json 2>/dev/null || echo '{}')
SELF_DNS=$(echo "$STATUS_JSON" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('Self', {}).get('DNSName','').rstrip('.'))" 2>/dev/null || echo "")
if [[ -z "$SELF_DNS" ]]; then
  echo "ERROR: Tailscale is not running or not signed in. Open Tailscale.app and sign in."
  exit 1
fi

FUNNEL_ORIGIN="https://${SELF_DNS}"
echo "Tailscale Self DNS: ${SELF_DNS}"
echo "Funnel origin will be: ${FUNNEL_ORIGIN}"
echo

# Wipe any prior serve/funnel state so reruns are deterministic. The
# config is persistent across reboots, so leaving stale entries during
# a re-run would mean accidentally exposing extra paths.
echo "Resetting any prior funnel config..."
tailscale serve reset

# Mount each path independently. CRITICAL: target URL must include the
# path (e.g. http://127.0.0.1:3000/voice-bridge, NOT just :3000).
# Without the trailing path on the upstream URL, Tailscale strips
# --set-path before forwarding and Next.js sees the request as "/" —
# which the Basic Auth middleware then 401s, even though /voice-bridge
# itself is on the public-prefix allowlist.
PATHS=(
  /voice-bridge
  /api/transcribe
  /api/voice-session
)
for P in "${PATHS[@]}"; do
  echo "Mounting funnel: ${P}"
  tailscale funnel --bg --https=443 --set-path="$P" "http://127.0.0.1:3000${P}"
done

echo
echo "✓ Funnel is up. Verify with:"
echo "  curl -I ${FUNNEL_ORIGIN}/voice-bridge       # expect 200"
echo "  curl -I ${FUNNEL_ORIGIN}/capture/test       # expect 404 (NOT exposed)"
echo
echo "Add to .env.local:"
echo "  TAILSCALE_FUNNEL_ORIGIN=${FUNNEL_ORIGIN}"
echo "  NEXT_PUBLIC_TAILSCALE_FUNNEL_ORIGIN=${FUNNEL_ORIGIN}"
echo
echo "Then restart Next.js: launchctl kickstart -k gui/501/com.gc.curriculum-tool"
