import { VoiceBridgeClient } from './VoiceBridgeClient';

export const dynamic = 'force-dynamic';

/**
 * Mic-recording bridge page. Served only via the Tailscale Funnel
 * (`https://<machine>.<tailnet>.ts.net/voice-bridge`) so the iframe's
 * own origin is HTTPS and `getUserMedia()` works.
 *
 * Embedded as a hidden iframe by `<VoiceBridgeProxy>` in the main app
 * (which runs over plain LAN HTTP and would otherwise be blocked from
 * mic access). The bridge communicates with the parent via postMessage
 * — never directly navigates, never directly displays UI to the user.
 *
 * The page is intentionally minimal: empty body, just the client
 * component that wires up the message protocol.
 */
export default function VoiceBridgePage() {
  return (
    <div style={{ margin: 0, padding: 0, fontFamily: 'sans-serif', fontSize: 12 }}>
      <VoiceBridgeClient />
    </div>
  );
}
