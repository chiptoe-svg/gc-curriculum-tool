'use client';

import { useState, type MouseEvent, type ReactNode } from 'react';

/**
 * A faculty capture-flow link (Edit / "+ Add a course") that prefers the
 * voice-capable HTTPS origin but gracefully falls back to a reliable direct
 * origin when that origin isn't reachable.
 *
 * Why: the capture-interview mic needs a secure context (HTTPS). On the Clemson
 * LAN the reliable path is the plain-HTTP direct URL (typed only); the voice
 * path is the Tailscale Funnel (HTTPS) — which is flaky. So on click we probe
 * the voice origin with a short timeout: if it answers, go there (voice); if
 * not, go to the direct origin (typed). This gives ON-CAMPUS faculty automatic
 * "funnel-until-it-isn't, then typed" behavior.
 *
 * OFF-CAMPUS is explicitly out of scope: the direct fallback origin is behind
 * the campus edge firewall, so it won't load for off-campus users — accepted;
 * they depend on the funnel being up.
 *
 * Origins come from NEXT_PUBLIC_VOICE_ORIGIN / NEXT_PUBLIC_FALLBACK_ORIGIN
 * (inlined at build). Both unset → the link is a plain same-origin/relative
 * anchor with no probe (prior behavior). The rendered href is always the
 * fallback origin, so no-JS clicks still reach a working page.
 */
const VOICE_ORIGIN = (process.env.NEXT_PUBLIC_VOICE_ORIGIN ?? '').replace(/\/+$/, '');
const FALLBACK_ORIGIN = (process.env.NEXT_PUBLIC_FALLBACK_ORIGIN ?? '').replace(/\/+$/, '');
const PROBE_TIMEOUT_MS = 2000;

/**
 * Is the voice origin reachable right now? `mode: 'no-cors'` — we only need to
 * know the connection succeeds, not read the response: it resolves opaque on
 * ANY HTTP status (200/401/404), and rejects only on a network-level
 * failure/timeout. So auth-gating on /api/health is irrelevant here, and a
 * fetch (unlike a navigation) never triggers a Basic Auth dialog.
 */
async function voiceReachable(): Promise<boolean> {
  if (!VOICE_ORIGIN) return false;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  try {
    await fetch(`${VOICE_ORIGIN}/api/health`, { mode: 'no-cors', cache: 'no-store', signal: ctl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function CaptureLink({
  path,
  className,
  title,
  children,
}: {
  /** Leading-slash app path, e.g. "/capture/GC%201010?slug=..." */
  path: string;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const fallbackHref = `${FALLBACK_ORIGIN}${path}`; // FALLBACK_ORIGIN '' → relative/same-origin
  const voiceHref = VOICE_ORIGIN ? `${VOICE_ORIGIN}${path}` : '';

  async function onClick(e: MouseEvent<HTMLAnchorElement>) {
    // No distinct voice origin → let the default navigation (to fallbackHref) run.
    if (!voiceHref || voiceHref === fallbackHref || busy) return;
    e.preventDefault();
    setBusy(true);
    const ok = await voiceReachable();
    window.location.href = ok ? voiceHref : fallbackHref;
  }

  return (
    <a
      href={fallbackHref}
      onClick={onClick}
      className={className}
      title={title}
      aria-busy={busy}
      style={busy ? { opacity: 0.6, pointerEvents: 'none' } : undefined}
    >
      {children}
    </a>
  );
}
