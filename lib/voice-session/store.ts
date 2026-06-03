/**
 * Voice-session token store for the mic bridge.
 *
 * One token per audit-chat page session. Issued from the main app
 * (`POST /api/voice-session`); validated by `/api/transcribe` calls
 * arriving via the Tailscale Funnel iframe.
 *
 * In-memory only — when Next.js restarts, all live tokens are lost and
 * the next mic click in any open tab transparently fetches a fresh one.
 * Acceptable: the only user-visible impact is one extra ~50ms round-trip
 * after a restart.
 *
 * Bound to slug + ipHash so a token leak (e.g., via a screenshot of
 * window.__VOICE_TOKEN) doesn't grant usage from a different network
 * location.
 */

import { randomBytes } from 'node:crypto';

interface SessionTokenEntry {
  slug: string;
  ipHash: string;
  issuedAt: number;
}

const TTL_MS = 24 * 60 * 60 * 1000;  // 24 hours absolute
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// Module-level Map. In Next.js dev mode with HMR, this may reset on
// hot reload — that's fine, see file header note.
const store = new Map<string, SessionTokenEntry>();

// Sweep expired entries every 5 min so the map doesn't grow unboundedly
// on a long-running server. Only registers once per module load.
let cleanupHandle: NodeJS.Timeout | null = null;
function ensureCleanup(): void {
  if (cleanupHandle !== null) return;
  cleanupHandle = setInterval(() => {
    const now = Date.now();
    for (const [token, entry] of store) {
      if (now - entry.issuedAt > TTL_MS) store.delete(token);
    }
  }, CLEANUP_INTERVAL_MS);
  // Don't keep the process alive just for this cleanup.
  cleanupHandle.unref();
}

export function issueVoiceToken(slug: string, ipHash: string): string {
  ensureCleanup();
  const token = randomBytes(24).toString('hex');  // 48 hex chars, 192 bits of entropy
  store.set(token, { slug, ipHash, issuedAt: Date.now() });
  return token;
}

/**
 * Returns true when the token exists, isn't expired, and was issued for
 * exactly this slug + ipHash. Sliding window NOT used; the 24h TTL is
 * absolute from issue time.
 */
export function validateVoiceToken(token: string, slug: string, ipHash: string): boolean {
  const entry = store.get(token);
  if (!entry) return false;
  if (Date.now() - entry.issuedAt > TTL_MS) {
    store.delete(token);
    return false;
  }
  return entry.slug === slug && entry.ipHash === ipHash;
}

/** For tests / diagnostics. */
export function _voiceTokenStoreSize(): number {
  return store.size;
}
