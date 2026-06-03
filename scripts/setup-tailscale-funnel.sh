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
# or after a reboot. The serve config is persistent across reboots.

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

# Build a path-restricted serve config. Three paths mount the local
# Next.js dev server; everything else 404s. AllowFunnel: true makes the
# whole serve-config block publicly reachable over the internet via
# Tailscale Funnel's Let's Encrypt cert.
CONFIG_FILE=$(mktemp -t tailscale-serve-config.XXXXXX.json)
trap 'rm -f "$CONFIG_FILE"' EXIT

cat > "$CONFIG_FILE" <<JSON
{
  "TCP": {
    "443": { "HTTPS": true }
  },
  "Web": {
    "${SELF_DNS}:443": {
      "Handlers": {
        "/voice-bridge":       { "Proxy": "http://127.0.0.1:3000" },
        "/api/transcribe":     { "Proxy": "http://127.0.0.1:3000" },
        "/api/voice-session":  { "Proxy": "http://127.0.0.1:3000" }
      }
    }
  },
  "AllowFunnel": {
    "${SELF_DNS}:443": true
  }
}
JSON

echo "Applying serve config..."
tailscale serve set-config "$CONFIG_FILE"

echo
echo "✓ Funnel is up. Verify with:"
echo "  curl -I ${FUNNEL_ORIGIN}/voice-bridge       # expect 200 or 401"
echo "  curl -I ${FUNNEL_ORIGIN}/capture/test       # expect 404 (NOT exposed)"
echo
echo "Add to .env.local:"
echo "  TAILSCALE_FUNNEL_ORIGIN=${FUNNEL_ORIGIN}"
echo "  NEXT_PUBLIC_TAILSCALE_FUNNEL_ORIGIN=${FUNNEL_ORIGIN}"
echo
echo "Then restart Next.js: launchctl kickstart -k gui/501/com.gc.curriculum-tool"
