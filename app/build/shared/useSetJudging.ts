'use client';

/**
 * The set test for the course cluster map: one POST /api/build/match (action 'judge-set') per request, sent one at a
 * time, with "Matching…", the error and Try again as in useThreadJudging.
 *
 * The caller owns the verdicts (`setSets`, by target key): its statuses read them and its requests come from those
 * statuses. A request is asked once per signature (target key and text, and the pool's refs in any order). When a
 * target's pool changes, its verdict is dropped at once and the new pool is asked (a verdict on the old pool says
 * nothing about the new one); a pool seen before gets its verdict back without a call. A failed call stores nothing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SetVerdict, SetVerdicts } from '@/lib/builder/cluster/status';
import { CAMPUS_DOWN, JUDGE_OTHERS_MAX, SERVER_DOWN, type JudgeOther } from './useThreadJudging';

/** `sig`: the target's set signature now (StatusResult.setSig); stored with the verdict so the statuses can tell it is current. */
export type SetRequest = { key: string; sig: string; target: { key: string; text: string; course: string; title: string }; pool: JudgeOther[] };

const sigOf = (r: SetRequest) => `${r.key}|${r.target.text}|${r.pool.map(p => p.ref).sort().join(',')}`;
const capped = <T extends { course: string; title: string }>(o: T): T => ({ ...o, course: o.course.slice(0, 40), title: o.title.slice(0, 200) });

export function useSetJudging(args: {
  requests: SetRequest[];
  clusterId: string;
  setSets: (fn: (s: SetVerdicts) => SetVerdicts) => void;
}): { judging: Record<string, string>; retry: (key: string) => void } {
  const { requests } = args;
  const [judging, setJudging] = useState<Record<string, string>>({});
  const latest = useRef(args);
  latest.current = args;

  /** Signatures sent (answered, failed or in flight). */
  const requested = useRef(new Set<string>());
  /** Verdicts by signature, so a pool seen before needs no second call. */
  const answered = useRef(new Map<string, SetVerdict>());
  /** The signature each target key currently stands for. */
  const current = useRef(new Map<string, string>());
  const queue = useRef<SetRequest[]>([]);
  /** The signature of the call in flight, if any. */
  const sending = useRef<string | null>(null);
  const pumping = useRef(false);

  const pump = useCallback(async () => {
    if (pumping.current) return;
    pumping.current = true;
    try {
      for (let r = queue.current.shift(); r; r = queue.current.shift()) {
        const { clusterId, setSets } = latest.current;
        const sig = sigOf(r), key = r.key;
        const live = () => current.current.get(key) === sig; // a newer pool for this target owns its state
        const pool = r.pool.filter(o => o.text.trim()).slice(0, JUDGE_OTHERS_MAX);
        if (!pool.length) { if (live()) setJudging(j => { const n = { ...j }; delete n[key]; return n; }); continue; }
        let error: string | null = null;
        sending.current = sig;
        try {
          const res = await fetch('/api/build/match', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'judge-set', clusterId, target: capped(r.target), pool: pool.map(capped) }),
          });
          const body = await res.json().catch(() => null);
          if (res.status === 502) error = CAMPUS_DOWN;
          else if (!res.ok) error = typeof body?.error === 'string' ? body.error : 'Matching failed; try again.';
          else if (!body?.verdict || typeof body.verdict !== 'object') error = SERVER_DOWN;
          else {
            const v: SetVerdict = { ...(body.verdict as SetVerdict), sig: r.sig };
            answered.current.set(sig, v);
            if (live()) setSets(s => ({ ...s, [key]: v }));
          }
        } catch { error = SERVER_DOWN; } finally { sending.current = null; }
        if (live()) setJudging(j => { const n = { ...j }; if (error) n[key] = error; else delete n[key]; return n; });
      }
    } finally { pumping.current = false; }
  }, []);

  const enqueue = useCallback((rs: SetRequest[]) => {
    for (const r of rs) requested.current.add(sigOf(r));
    queue.current.push(...rs);
    setJudging(s => ({ ...s, ...Object.fromEntries(rs.map(r => [r.key, 'matching'])) }));
    void pump();
  }, [pump]);

  useEffect(() => {
    const fresh: SetRequest[] = [];
    for (const r of requests) {
      const sig = sigOf(r);
      if (current.current.get(r.key) !== sig) {
        const had = current.current.has(r.key);
        current.current.set(r.key, sig);
        const known = answered.current.get(sig);
        if (had || known) latest.current.setSets(s => { const n = { ...s }; if (known) n[r.key] = known; else delete n[r.key]; return n; });
        const pending = sending.current === sig || queue.current.some(q => sigOf(q) === sig);
        // Asked before and failed: ask again rather than leave the target waiting with no message.
        if (!known && !pending) requested.current.delete(sig);
        if (had) setJudging(j => { const n = { ...j }; if (pending) n[r.key] = 'matching'; else delete n[r.key]; return n; });
      }
      if (!requested.current.has(sig)) fresh.push(r);
    }
    if (fresh.length) enqueue(fresh);
  }, [requests, enqueue]);

  const retry = useCallback((key: string) => {
    const r = requests.find(x => x.key === key);
    if (r) enqueue([r]);
  }, [requests, enqueue]);

  return { judging, retry };
}
