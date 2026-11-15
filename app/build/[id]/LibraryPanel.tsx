'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Library, LibraryCourse, PlanState } from '@/lib/builder/types';
import type { CatalogHit } from '@/lib/builder/library';

const sourceNote = (c: LibraryCourse): { text: string; mark: string } => {
  const scored = c.versions.some(v => v.depths.length > 0);
  if (c.versions.length > 0 && !scored) {
    return { text: `Captured, but not yet scored against the competency catalog${c.stated.length ? '; stated objectives available' : ''}`, mark: c.stated.length ? 'stated' : 'none' };
  }
  return c.versions.length > 0 && c.stated.length > 0 ? { text: 'Stated objectives and discovered outcomes', mark: 'both' }
    : c.versions.length > 0 ? { text: 'Discovered outcomes only', mark: 'discovered' }
    : c.stated.length > 0 ? { text: 'Stated objectives only', mark: 'stated' }
    : { text: 'No reading yet', mark: 'none' };
};

/** Every course that can go on the map: the tool's own courses, the rest of the Clemson catalog, and new ones. */
export function LibraryPanel(props: {
  library: Library; plan: PlanState; placed: Set<string>; open: boolean; onToggle: () => void;
  onAdd: (code: string) => void; onAddCatalog: (hit: CatalogHit) => void; onAddNew: () => void; onSelect: (ref: string) => void;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);

  const term = q.trim().toLowerCase();
  const tracked = useMemo(() => props.library.courses.filter(c =>
    !term || c.code.toLowerCase().includes(term) || c.title.toLowerCase().includes(term)), [props.library.courses, term]);

  useEffect(() => {
    if (term.length < 2) { setHits([]); setFailed(false); return; }
    let live = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/build/catalog?q=${encodeURIComponent(term)}`);
        if (!res.ok) throw new Error('search failed');
        const body = await res.json();
        if (live) { setHits(body.courses ?? []); setFailed(false); }
      } catch { if (live) { setHits([]); setFailed(true); } }
      finally { if (live) setSearching(false); }
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [term]);

  if (!props.open) {
    return <aside className="cb-lib cb-lib--closed"><button type="button" className="cb-lib__toggle" onClick={props.onToggle} title="Show the course library">Courses</button></aside>;
  }
  const inPlanCatalog = new Set(props.plan.proposed.filter(p => p.source === 'catalog' && props.placed.has(p.id)).map(p => p.code));

  return (
    <aside className="cb-lib" aria-label="Course library">
      <div className="cb-lib__head">
        <h2>Courses</h2>
        <button type="button" className="cb-linkbtn" onClick={props.onToggle}>Hide</button>
      </div>
      <input className="cb-lib__search" type="search" value={q} onChange={e => setQ(e.target.value)}
        placeholder="Search by code or title, e.g. MKT or packaging" aria-label="Search courses" />
      <button type="button" className="cb-btn cb-btn--wide" onClick={props.onAddNew}>Add a new course</button>
      <p className="cb-lib__hint">Drag a course onto an act, or use Add.</p>

      <div className="cb-lib__scroll">
        <h3>In the tool <span>{tracked.length}</span></h3>
        <ul>
          {tracked.map(c => {
            const s = sourceNote(c);
            const placed = props.placed.has(c.code);
            return (
              <li key={c.code} className={`cb-libitem${placed ? ' is-placed' : ''}`} draggable
                onDragStart={e => { e.dataTransfer.setData('text/plain', c.code); e.dataTransfer.effectAllowed = 'move'; }}>
                <button type="button" className="cb-libitem__main" onClick={() => (placed ? props.onSelect(c.code) : props.onAdd(c.code))}
                  title={`${c.title}. ${s.text}.${c.whatIfs.length ? ` ${c.whatIfs.length} what-if${c.whatIfs.length > 1 ? 's' : ''}.` : ''}`}>
                  <span className={`cb-src cb-src--${s.mark}`} aria-hidden />
                  <span className="cb-libitem__code">{c.code}</span>
                  <span className="cb-libitem__title">{c.title}</span>
                </button>
                <span className="cb-libitem__act">{placed ? 'On the map' : 'Add'}</span>
              </li>
            );
          })}
          {tracked.length === 0 && <li className="cb-empty">No tracked course matches.</li>}
        </ul>

        {term.length >= 2 && (
          <>
            <h3>Rest of the Clemson catalog {searching ? <span>searching…</span> : <span>{hits.length}</span>}</h3>
            <ul>
              {hits.map(h => (
                <li key={h.code} className={`cb-libitem${inPlanCatalog.has(h.code) ? ' is-placed' : ''}`} draggable
                  onDragStart={e => { e.dataTransfer.setData('text/plain', `catalog:${JSON.stringify(h)}`); e.dataTransfer.effectAllowed = 'copy'; }}>
                  <button type="button" className="cb-libitem__main" onClick={() => props.onAddCatalog(h)}
                    title={`${h.title}${h.credits ? `, ${h.credits} credits` : ''}. Not captured: it adds nothing to the map until you give it competency levels.`}>
                    <span className="cb-src cb-src--none" aria-hidden />
                    <span className="cb-libitem__code">{h.code}</span>
                    <span className="cb-libitem__title">{h.title}</span>
                  </button>
                  <span className="cb-libitem__act">{inPlanCatalog.has(h.code) ? 'On the map' : 'Add'}</span>
                </li>
              ))}
              {!searching && hits.length === 0 && (
                <li className="cb-empty">{failed ? 'The catalog search did not answer. Try again in a moment.' : 'No other catalog course matches.'}</li>
              )}
            </ul>
          </>
        )}
        {term.length < 2 && <p className="cb-lib__hint">Type two or more letters to also search the rest of the Clemson catalog.</p>}
      </div>

      <ul className="cb-lib__key">
        <li><span className="cb-src cb-src--both" /> Stated and discovered</li>
        <li><span className="cb-src cb-src--discovered" /> Discovered only</li>
        <li><span className="cb-src cb-src--stated" /> Stated only</li>
        <li><span className="cb-src cb-src--none" /> No reading yet</li>
      </ul>
    </aside>
  );
}
