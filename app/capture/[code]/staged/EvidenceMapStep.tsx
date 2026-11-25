'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiErrorText } from '@/lib/ai/credit-client';
import type { EvidenceMap } from '@/lib/capture/staged/evidence-map';
import { clearStoredSession, readStoredSession, writeStoredSession } from '@/lib/capture/staged/stored-session';

type MapStatus = 'ready' | 'failed' | 'none' | 'pending';
const FAILED_COPY = "Couldn't read the materials; the interview will ask instead";
const ADDED = 'added by instructor';

/** The map's own edit fields are all this step changes; the rest of the map goes back unchanged. */
type Loaded = { sessionId: string; map: EvidenceMap | null; status: MapStatus };

/**
 * Stage 0 of the staged interview: the pre-read of the materials, shown for the instructor to correct before
 * the first question. Reads on mount (POST), saves edits with PUT when the instructor starts.
 */
export function EvidenceMapStep({
  courseCode,
  slug,
  onStart,
}: {
  courseCode: string;
  slug: string;
  onStart: (sessionId: string) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [map, setMap] = useState<EvidenceMap | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Which "Add …" rows are open, and what has been typed in them.
  const [adding, setAdding] = useState<{ graded: string | null; skill: string | null; objective: string | null }>({ graded: null, skill: null, objective: null });
  const started = useRef(false);

  const base = `/api/capture/${encodeURIComponent(courseCode)}/evidence-map?slug=${encodeURIComponent(slug)}`;

  const read = useCallback(async () => {
    setLoadError(null);
    setLoaded(null);
    try {
      // A session read before a reload is reused: the GET validates it (404 for an unknown or another
      // course's id), and only then is a new paid read started.
      const stored = readStoredSession(courseCode);
      let res: Response | null = null;
      if (stored) {
        const got = await fetch(`${base}&sessionId=${encodeURIComponent(stored)}`);
        if (got.status === 404) clearStoredSession(courseCode);
        else res = got;
      }
      if (!res) res = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || typeof json.sessionId !== 'string') {
        setLoadError(apiErrorText(json, `Could not read the materials (${res.status})`));
        return;
      }
      writeStoredSession(courseCode, json.sessionId);
      setLoaded({ sessionId: json.sessionId, map: json.map ?? null, status: json.status });
      setMap(json.status === 'ready' ? json.map ?? null : null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not read the materials');
    }
  }, [base, courseCode]);

  useEffect(() => {
    // One read per mount (strict mode double-runs effects; a second POST would pay for a second read).
    if (started.current) return;
    started.current = true;
    void read();
  }, [read]);

  function edit(next: EvidenceMap) { setMap(next); setDirty(true); setSaveError(null); }

  async function start() {
    if (!loaded) return;
    if (dirty && map) {
      setSaving(true);
      setSaveError(null);
      try {
        const res = await fetch(base, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: loaded.sessionId, map }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          setSaveError(res.status === 413 ? 'Those edits are too long to save. Shorten them and try again.' : apiErrorText(json, `Could not save your edits (${res.status})`));
          return;
        }
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : 'Could not save your edits');
        return;
      } finally {
        setSaving(false);
      }
    }
    onStart(loaded.sessionId);
  }

  if (loadError) {
    return (
      <section className="cap-card space-y-3 px-4 py-4">
        <div role="alert" className="rounded-2xl bg-[#F9E3E3] px-4 py-3 text-sm text-[#9B2C2C]">{loadError}</div>
        <button type="button" className="cap-btn min-h-9 text-sm" onClick={() => { started.current = true; void read(); }}>Try again</button>
      </section>
    );
  }
  if (!loaded) {
    return (
      <section className="cap-card flex items-center gap-3 px-4 py-6 text-sm" role="status">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" aria-hidden />
        Reading your materials…
      </section>
    );
  }

  const inputCls = 'min-w-[11rem] flex-1 rounded-[10px] border border-[#D9D6DF] bg-white px-3 py-1.5 text-sm focus:border-[#522D80] focus:outline-none focus:ring-2 focus:ring-[#522D80]/25';
  const rmCls = 'shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground';
  const addCls = 'cap-btn min-h-9 text-sm';

  return (
    <section className="cap-card overflow-hidden" data-testid="evidence-map-step">
      <div className="border-b border-[#E4E2E8] px-4 py-3">
        <p className="cap-eyebrow">Before the interview</p>
        <h2 className="cap-title text-xl">What I found in your materials</h2>
        <p className="text-xs text-muted-foreground">
          Fix anything that is wrong or missing. The interview starts from this list.
        </p>
      </div>

      {!map ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">{FAILED_COPY}</p>
      ) : (
        <div className="space-y-5 px-4 py-4">
          {map.summary && <p className="text-sm leading-relaxed">{map.summary}</p>}

          <div>
            <h3 className="mb-1.5 text-sm font-semibold">Graded work</h3>
            <ul className="space-y-1.5">
              {map.graded_work.map((g, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <input
                    aria-label={`Graded work ${i + 1}`}
                    className={inputCls}
                    value={g.title}
                    onChange={e => edit({ ...map, graded_work: map.graded_work.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })}
                  />
                  {g.weight && <span className="shrink-0 text-xs text-muted-foreground">{g.weight}</span>}
                  <button type="button" aria-label={`Remove ${g.title}`} className={rmCls} onClick={() => edit({ ...map, graded_work: map.graded_work.filter((_, j) => j !== i) })}>Remove</button>
                </li>
              ))}
            </ul>
            {adding.graded === null ? (
              <button type="button" className={addCls + ' mt-2'} onClick={() => setAdding(a => ({ ...a, graded: '' }))}>Add graded work</button>
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input aria-label="New graded work" autoFocus className={inputCls} value={adding.graded} onChange={e => {
                  const v = e.target.value;
                  setAdding(a => ({ ...a, graded: v }));
                }} />
                <AddButtons
                  value={adding.graded}
                  onAdd={v => { edit({ ...map, graded_work: [...map.graded_work, { title: v, weight: null, deliverables: null, rubric_criteria: [], source: ADDED }] }); setAdding(a => ({ ...a, graded: null })); }}
                  onCancel={() => setAdding(a => ({ ...a, graded: null }))}
                  cls={rmCls}
                />
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-1.5 text-sm font-semibold">Skills the course assumes</h3>
            <ul className="space-y-1.5">
              {map.assumed_skills.map((s, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <input
                    aria-label={`Assumed skill ${i + 1}`}
                    className={inputCls}
                    value={s.skill}
                    onChange={e => edit({ ...map, assumed_skills: map.assumed_skills.map((x, j) => (j === i ? { ...x, skill: e.target.value } : x)) })}
                  />
                  {s.used_in && <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">used in {s.used_in}</span>}
                  <button type="button" aria-label={`Remove ${s.skill}`} className={rmCls} onClick={() => edit({ ...map, assumed_skills: map.assumed_skills.filter((_, j) => j !== i) })}>Remove</button>
                </li>
              ))}
            </ul>
            {adding.skill === null ? (
              <button type="button" className={addCls + ' mt-2'} onClick={() => setAdding(a => ({ ...a, skill: '' }))}>Add skill</button>
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input aria-label="New skill" autoFocus className={inputCls} value={adding.skill} onChange={e => {
                  const v = e.target.value;
                  setAdding(a => ({ ...a, skill: v }));
                }} />
                <AddButtons
                  value={adding.skill}
                  onAdd={v => { edit({ ...map, assumed_skills: [...map.assumed_skills, { skill: v, used_in: '', source: ADDED }] }); setAdding(a => ({ ...a, skill: null })); }}
                  onCancel={() => setAdding(a => ({ ...a, skill: null }))}
                  cls={rmCls}
                />
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-1.5 text-sm font-semibold">Objectives</h3>
            <ul className="space-y-1.5">
              {map.objectives.map((o, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <input
                    aria-label={`Objective ${i + 1}`}
                    className={inputCls}
                    value={o.text}
                    onChange={e => edit({ ...map, objectives: map.objectives.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })}
                  />
                  <span className={'shrink-0 text-xs ' + (o.status === 'graded_work_found' ? 'text-[#2F6B3A]' : 'text-[#8A5A00]')}>
                    {o.status === 'graded_work_found' ? '✓ graded work found' : '✗ no graded work found'}
                  </span>
                  <button type="button" aria-label={`Remove ${o.text}`} className={rmCls} onClick={() => edit({ ...map, objectives: map.objectives.filter((_, j) => j !== i) })}>Remove</button>
                </li>
              ))}
            </ul>
            {adding.objective === null ? (
              <button type="button" className={addCls + ' mt-2'} onClick={() => setAdding(a => ({ ...a, objective: '' }))}>Add objective</button>
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input aria-label="New objective" autoFocus className={inputCls} value={adding.objective} onChange={e => {
                  const v = e.target.value;
                  setAdding(a => ({ ...a, objective: v }));
                }} />
                <AddButtons
                  value={adding.objective}
                  onAdd={v => { edit({ ...map, objectives: [...map.objectives, { text: v, status: 'not_found', graded_work: [] }] }); setAdding(a => ({ ...a, objective: null })); }}
                  onCancel={() => setAdding(a => ({ ...a, objective: null }))}
                  cls={rmCls}
                />
              </div>
            )}
          </div>

          {map.unreadable.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-sm font-semibold">What couldn&apos;t be read</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {map.unreadable.map((u, i) => <li key={i}>{u.file}{u.note ? ` — ${u.note}` : ''}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {saveError && <div role="alert" className="mx-4 mb-3 rounded-2xl bg-[#F9E3E3] px-4 py-3 text-sm text-[#9B2C2C]">{saveError}</div>}
      <div className="border-t border-[#E4E2E8] px-4 py-3">
        <button type="button" className="cap-btn cap-btn-primary min-h-11 w-full font-semibold sm:w-auto" disabled={saving} onClick={() => void start()}>
          {saving ? 'Saving…' : 'Looks right → start'}
        </button>
      </div>
    </section>
  );
}

function AddButtons({ value, onAdd, onCancel, cls }: { value: string; onAdd: (v: string) => void; onCancel: () => void; cls: string }) {
  const v = value.trim();
  return (
    <>
      <button type="button" className={cls} disabled={!v} onClick={() => onAdd(v)}>Add</button>
      <button type="button" className={cls} onClick={onCancel}>Cancel</button>
    </>
  );
}
