'use client';

import { useCallback, useRef, useState } from 'react';
import type { StressTestResultType } from '@/lib/ai/stress-test/schema';

export interface StressTestTelemetry {
  costUsdCents: number;
  durationMs: number;
  model: string;
}

export interface StressTestState {
  status: 'idle' | 'running' | 'done' | 'error';
  result: StressTestResultType | null;
  error: string | null;
  telemetry: StressTestTelemetry | null;
  /** Start a run. A call while one is in flight is ignored. */
  run: () => void;
}

/**
 * Owns the stress-test request (POST /api/capture/[code]/stress-test). Held by
 * CaptureClient so the result survives the review panel unmounting (e.g. a
 * trip back to reconciliation), and so the client can start it automatically
 * right after a profile is generated. The result is advisory and never
 * modifies the draft; the route records its spend and respects the daily cap.
 */
export function useStressTest(courseCode: string, slug: string): StressTestState {
  const [status, setStatus] = useState<StressTestState['status']>('idle');
  const [result, setResult] = useState<StressTestResultType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<StressTestTelemetry | null>(null);
  const inFlight = useRef(false);

  const run = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setStatus('running');
    setError(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/capture/${encodeURIComponent(courseCode)}/stress-test?slug=${encodeURIComponent(slug)}`,
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
        );
        const json = (await res.json().catch(() => ({}))) as {
          result?: StressTestResultType;
          telemetry?: StressTestTelemetry;
          error?: string;
        };
        if (!res.ok || !json.result) {
          setResult(null);
          setError(json.error ?? `the check failed (${res.status})`);
          setStatus('error');
          return;
        }
        setResult(json.result);
        setTelemetry(json.telemetry ?? null);
        setStatus('done');
      } catch (e) {
        setResult(null);
        setError(e instanceof Error ? e.message : 'network error');
        setStatus('error');
      } finally {
        inFlight.current = false;
      }
    })();
  }, [courseCode, slug]);

  return { status, result, error, telemetry, run };
}
