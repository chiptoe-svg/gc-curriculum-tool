#!/usr/bin/env bash
# Set up Tailscale Funnel on this Mac to expose the whole app over HTTPS.
# Basic Auth in middleware (middleware.ts) is the only gate.
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
# which broke in Tailscale v1.98. Switched to `tailscale funnel`
# invocations. Originally exposed only four narrow voice-bridge paths;
# re-scoped to root when the architecture moved from an iframe bridge
# to whole-app HTTPS so mic works natively in a top-level secure context.
# See docs/superpowers/plans/2026-06-03-hybrid-http-https-mic-architecture.md.

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

# Mount root — the funnel now proxies the whole app, with Basic Auth in
# middleware as the gate. The new HTTP landing at the LAN IP (which has
# a small allowlist for public read-only paths) is reachable separately
# at http://<lan-ip>:3000.
#
# Why root and not a path allowlist: the architecture moved from "narrow
# iframe bridge for mic" to "whole faculty app on HTTPS so mic works
# natively in a top-level secure context." See plan
# docs/superpowers/plans/2026-06-03-hybrid-http-https-mic-architecture.md.
echo "Mounting funnel: /"
tailscale funnel --bg --https=443 http://127.0.0.1:3000

echo
echo "✓ Funnel is up. Verify with:"
echo "  curl -I ${FUNNEL_ORIGIN}/capture/test   # expect 401 (Basic Auth challenge)"
echo "  curl -I ${FUNNEL_ORIGIN}/_next/static/  # expect 401 (Basic Auth challenge)"
echo
echo ".env.local should already have:"
echo "  TAILSCALE_FUNNEL_ORIGIN=${FUNNEL_ORIGIN}"
echo "  NEXT_PUBLIC_TAILSCALE_FUNNEL_ORIGIN=${FUNNEL_ORIGIN}"
echo "(These are no longer used by app code post-cleanup, but kept for"
echo " the landing page to know where to link Edit buttons.)"
