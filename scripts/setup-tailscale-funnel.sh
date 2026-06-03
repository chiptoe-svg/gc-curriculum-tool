#!/usr/bin/env bash
# Set up Tailscale Funnel on this Mac to expose ONLY the voice-bridge
# paths over HTTPS. Everything else stays LAN-only HTTP.
#
# Prerequisite: Tailscale.app installed + signed in. Install with:
#   brew install --cask tailscale-app    # requires sudo for the .pkg
# Then launch the app once and sign in with a Tailscale account.
# (Free for personal use.)
#
# Then run this script. Idempotent — re-run safely after Tailscale upgrades
# or after a reboot.

set -euo pipefail

if ! command -v tailscale > /dev/null 2>&1; then
  echo "ERROR: tailscale CLI not found. Install Tailscale.app first."
  echo "  brew install --cask tailscale-app"
  echo "  open /Applications/Tailscale.app"
  exit 1
fi

# Confirm Tailscale is up + logged in
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

# Clear any default '/'-rooted serve config so we don't accidentally expose
# the whole app.
tailscale serve --https=443 --bg / off 2>/dev/null || true

# Mount only the three voice-related paths on HTTPS, proxying to localhost:3000.
echo "Configuring path-restricted Funnel..."
tailscale serve --https=443 --bg /voice-bridge       http://localhost:3000
tailscale serve --https=443 --bg /api/transcribe     http://localhost:3000
tailscale serve --https=443 --bg /api/voice-session  http://localhost:3000

# Promote to Funnel (public reachability over the internet, with Tailscale's
# real Let's Encrypt cert).
echo "Enabling Funnel..."
tailscale funnel --https=443 --bg on

echo
echo "✓ Funnel up. Verify:"
echo "  curl -I ${FUNNEL_ORIGIN}/voice-bridge       # expect 200 or 401"
echo "  curl -I ${FUNNEL_ORIGIN}/capture/test       # expect 404 (NOT exposed)"
echo
echo "Add to .env.local:"
echo "  TAILSCALE_FUNNEL_ORIGIN=${FUNNEL_ORIGIN}"
echo "  NEXT_PUBLIC_TAILSCALE_FUNNEL_ORIGIN=${FUNNEL_ORIGIN}"
