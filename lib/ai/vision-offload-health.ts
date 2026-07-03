/**
 * Vision-offload canary — makes SILENT degradation of the DGX offload visible.
 *
 * The offload path (image-PDF OCR, slide description, Docling captions → the DGX
 * Spark, via the loopback forwarder) is designed to fall back to local omlx on any
 * failure. That graceful fallback is the problem for observability: when the DGX is
 * down, the forwarder is dead, or a wrong model is deployed, everything keeps
 * "working" on the slower/lower-quality local path and NOBODY notices — the only
 * trace is a log line no one reads. (Same species of footgun as the omlx mlx-vlm
 * knob that silently reverts on reinstall.)
 *
 * This module gives that failure a voice two ways:
 *   1. ACTIVE PROBE (authoritative for status): every N minutes + at boot, hit the
 *      offload `/models` endpoint and confirm the CONFIGURED model is actually being
 *      served. Reachable + right model → `ok`; unreachable / wrong model → `down`.
 *      Status transitions log LOUDLY, and `since` records when the current state
 *      began, so "offload has been down since 14:07 (23 min)" is answerable.
 *   2. PASSIVE SIGNAL: real production requests report their outcome
 *      (`recordRealSuccess` / `recordRealFallback`). A real fallback doesn't flip
 *      status directly (a single bad input image shouldn't read as an outage) — it
 *      bumps an informational counter AND triggers an off-cycle probe, so a genuine
 *      outage is confirmed within seconds instead of up-to-N-minutes later, while a
 *      one-off bad image just gets a probe that comes back `ok`.
 *
 * State is process-local (the server is a single launchd node process). The snapshot
 * is exposed on `/api/health` so it's queryable without reading logs.
 */

import { visionOffloadConfig } from './vision-offload';

export type OffloadStatus = 'unknown' | 'ok' | 'down' | 'disabled';

interface HealthState {
  status: OffloadStatus;
  /** ISO — when the CURRENT status began (for "down for N minutes"). */
  since: string | null;
  /** ISO — last probe completion. */
  lastCheckedAt: string | null;
  /** ISO — last time the offload was confirmed healthy (probe or real success). */
  lastOkAt: string | null;
  /** Reason for the current/last `down`. */
  lastError: string | null;
  /** Model ids served at the last successful probe. */
  servedModels: string[] | null;
  /** Real production requests that fell back (informational — does not set status). */
  realFallbacks: { count: number; lastAt: string | null; lastReason: string | null };
}

interface Registry {
  state: HealthState;
  loopStarted: boolean;
  debounce: ReturnType<typeof setTimeout> | null;
}

/**
 * Stored on `globalThis`, NOT a plain module const. Next.js can hand `instrumentation.ts`
 * (which arms the probe loop) and the route handlers (which read/record) SEPARATE module
 * instances, so a module-level singleton would be split-brained — the loop mutates one
 * copy, `/api/health` reads another and shows `unknown` forever. A global registry is the
 * one object all instances share.
 */
const g = globalThis as unknown as { __gcVisionOffloadHealth?: Registry };
const reg: Registry = (g.__gcVisionOffloadHealth ??= {
  state: {
    status: 'unknown',
    since: null,
    lastCheckedAt: null,
    lastOkAt: null,
    lastError: null,
    servedModels: null,
    realFallbacks: { count: 0, lastAt: null, lastReason: null },
  },
  loopStarted: false,
  debounce: null,
});
const state = reg.state;

function nowIso(): string {
  return new Date().toISOString();
}

/** Move to a new status, logging loudly on transition and stamping `since`. */
function transition(next: OffloadStatus, error: string | null): void {
  if (state.status !== next) {
    state.since = nowIso();
    if (next === 'down') {
      console.warn(`[vision-offload-health] DOWN — offload unavailable, using local fallback. reason: ${error ?? 'unknown'}`);
    } else if (next === 'ok') {
      console.log('[vision-offload-health] recovered — offload reachable again.');
    } else if (next === 'disabled') {
      console.log('[vision-offload-health] disabled — VISION_OFFLOAD_* unset; local-only, no offload expected.');
    }
  }
  state.status = next;
  state.lastError = next === 'ok' || next === 'disabled' ? null : error;
}

/**
 * Active probe: is the offload reachable AND serving the configured model?
 * Authoritative for `status`. Never throws.
 */
export async function probeVisionOffload(): Promise<void> {
  state.lastCheckedAt = nowIso();
  const off = visionOffloadConfig();
  if (!off) {
    transition('disabled', null);
    state.servedModels = null;
    return;
  }
  const url = `${off.baseURL.replace(/\/$/, '')}/models`;
  try {
    const res = await fetch(url, {
      headers: off.apiKey ? { Authorization: `Bearer ${off.apiKey}` } : {},
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      transition('down', `/models HTTP ${res.status}`);
      return;
    }
    const body = (await res.json()) as { data?: Array<{ id?: string }> };
    const served = (body.data ?? []).map((m) => m.id).filter((id): id is string => !!id);
    if (!served.includes(off.model)) {
      state.servedModels = served;
      transition('down', `reachable but model "${off.model}" not served (got: ${served.join(', ') || 'none'})`);
      return;
    }
    state.servedModels = served;
    state.lastOkAt = nowIso();
    transition('ok', null);
  } catch (e) {
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    const detail = cause?.code ?? cause?.message ?? (e as Error).message;
    transition('down', `${(e as Error).message}${cause ? ` (${detail})` : ''}`);
  }
}

/** Debounced off-cycle probe trigger (so a real signal confirms within seconds). */
function triggerProbeSoon(): void {
  if (reg.debounce) return;
  reg.debounce = setTimeout(() => {
    reg.debounce = null;
    void probeVisionOffload();
  }, 2_000);
  reg.debounce.unref?.();
}

/**
 * A real production offload request fell back to local. Informational (does not flip
 * status — a single bad input image isn't an outage) but triggers a confirming probe.
 */
export function recordRealFallback(reason: string): void {
  state.realFallbacks.count += 1;
  state.realFallbacks.lastAt = nowIso();
  state.realFallbacks.lastReason = reason;
  triggerProbeSoon();
}

/** A real production offload request SUCCEEDED — strong liveness signal. */
export function recordRealSuccess(): void {
  state.lastOkAt = nowIso();
  // Clear a stale `down` fast rather than waiting for the next scheduled probe.
  if (state.status === 'down') triggerProbeSoon();
}

/** Read-only snapshot for `/api/health` (adds derived `downForSeconds`). */
export function getOffloadHealthSnapshot(): HealthState & { downForSeconds: number | null } {
  const downForSeconds =
    state.status === 'down' && state.since
      ? Math.round((Date.now() - new Date(state.since).getTime()) / 1000)
      : null;
  return { ...state, realFallbacks: { ...state.realFallbacks }, downForSeconds };
}

/**
 * Arm the periodic canary (idempotent). Runs one probe ~3s after boot (let the
 * server settle), then every `VISION_OFFLOAD_HEALTHCHECK_INTERVAL_MS` (default 5 min).
 */
export function startVisionOffloadHealthLoop(): void {
  if (reg.loopStarted) return;
  reg.loopStarted = true;
  const intervalMs = Math.max(
    30_000,
    Number.parseInt(process.env.VISION_OFFLOAD_HEALTHCHECK_INTERVAL_MS ?? '300000', 10) || 300_000,
  );
  const boot = setTimeout(() => void probeVisionOffload(), 3_000);
  boot.unref?.();
  const timer = setInterval(() => void probeVisionOffload(), intervalMs);
  timer.unref?.();
}
