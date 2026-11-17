'use client';

/**
 * Judging draft skills against a map, shared by the plan map (/build/[id]) and the course cluster map: a queue of
 * judge jobs sent one at a time to POST /api/build/match (action 'judge'), with "Matching…", the error and Try again.
 * Moved unchanged out of Builder.tsx; what a job is compared with (`othersFor`) and its own course (`anchorOf`) come
 * from the map.
 *
 * The caller owns the judgments (`setDrafts`): its statuses read them and its jobs come from those statuses, so they
 * must exist before the jobs do. A failed call stores nothing; the key is left absent (pending) and `judging` holds
 * the error.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DraftJudgments } from '@/lib/builder/threads';

/** `sig` decides whether a job was already asked: the key, plus (for a captured required skill) the courses that could supply it. */
export type JudgeJob = { key: string; sig: string; courseRef: string; side: 'required' | 'supplied'; ref: string; text: string };
export type JudgeOther = { ref: string; text: string; course: string; title: string };
export const JUDGE_OTHERS_MAX = 400; // the server's limit (app/api/build/match/route.ts)
export const CAMPUS_DOWN = 'The campus model did not answer; try again.';
export const SERVER_DOWN = 'Could not reach the server; try again.';

export function useThreadJudging(args: {
  jobs: JudgeJob[];
  /** The skills a job is compared with: for a required skill, those developed upstream; for a developed one, those required downstream. */
  othersFor: (job: JudgeJob) => JudgeOther[];
  /** The job's own course (code and title), or null when it is no longer on the map. */
  anchorOf: (job: JudgeJob) => { course: string; title: string } | null;
  owner: { planId: string } | { clusterId: string };
  setDrafts: (fn: (d: DraftJudgments) => DraftJudgments) => void;
}): { judging: Record<string, string>; unasked: Set<string>; retryJudge: (key: string) => void } {
  const { jobs: judgeJobs } = args;
  const [judging, setJudging] = useState<Record<string, string>>({});
  // Read when a job is sent, so a job queued earlier is compared with the map as it is then.
  const latest = useRef(args);
  latest.current = args;

  const requested = useRef(new Set<string>());
  const queue = useRef<JudgeJob[]>([]);
  const pumping = useRef(false);
  const pump = useCallback(async () => {
    if (pumping.current) return;
    pumping.current = true;
    try {
      for (let job = queue.current.shift(); job; job = queue.current.shift()) {
        const { othersFor, anchorOf, owner, setDrafts } = latest.current;
        const me = anchorOf(job);
        const others = me ? othersFor(job) : [];
        const list = others.filter(o => o.text.trim()).slice(0, JUDGE_OTHERS_MAX);
        if (!me || !list.length) { setJudging(j => { const n = { ...j }; delete n[job.key]; return n; }); continue; }
        let error: string | null = null;
        try {
          const res = await fetch('/api/build/match', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'judge', ...owner, anchor: { text: job.text, course: me.course.slice(0, 40), title: me.title.slice(0, 200), side: job.side }, others: list.map(o => ({ ...o, course: o.course.slice(0, 40), title: o.title.slice(0, 200) })) }),
          });
          const body = await res.json().catch(() => null);
          if (res.status === 502) error = CAMPUS_DOWN;
          else if (!res.ok) error = typeof body?.error === 'string' ? body.error : 'Matching failed; try again.';
          else if (!Array.isArray(body?.results)) error = SERVER_DOWN;
          else {
            const found = body.results as Array<{ ref: string; pFully: number; pPartly: number }>;
            const j = job;
            setDrafts(d => {
              const n = { ...d };
              for (const r of found) n[j.side === 'required' ? `${j.ref}|${r.ref}` : `${r.ref}|${j.ref}`] = { pFully: r.pFully, pPartly: r.pPartly };
              return n;
            });
          }
        } catch { error = SERVER_DOWN; }
        const k = job.key;
        setJudging(j => { const n = { ...j }; if (error) n[k] = error; else delete n[k]; return n; });
      }
    } finally { pumping.current = false; }
  }, []);
  const enqueue = useCallback((jobs: JudgeJob[]) => {
    for (const j of jobs) requested.current.add(j.sig);
    queue.current.push(...jobs);
    setJudging(s => ({ ...s, ...Object.fromEntries(jobs.map(j => [j.key, 'matching'])) }));
    void pump();
  }, [pump]);
  useEffect(() => {
    const fresh = judgeJobs.filter(j => !requested.current.has(j.sig));
    if (fresh.length) enqueue(fresh);
  }, [judgeJobs, enqueue]);
  // Read during render: the effect above sends these right after this render, which then re-renders through `judging`.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `judging` changes when a job is sent: re-read the ref then
  const unasked = useMemo(() => new Set(judgeJobs.filter(j => !requested.current.has(j.sig)).map(j => j.key)), [judgeJobs, judging]);
  const retryJudge = useCallback((key: string) => {
    const job = judgeJobs.find(j => j.key === key);
    if (job) enqueue([job]);
  }, [judgeJobs, enqueue]);

  return { judging, unasked, retryJudge };
}
