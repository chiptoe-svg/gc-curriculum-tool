'use client';

/**
 * Saving a map, shared by the plan map (/build/[id]) and the course cluster map: the state and name, undo, a debounced
 * PUT with an optimistic version, and the conflict / refusal / error states. Moved unchanged out of Builder.tsx; only the
 * URL, the starting values, the author and the word for the map ('plan' or 'cluster') are parameters.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error' | 'refused';

export function useAutosave<S>(args: {
  /** Where the map is saved (PUT). */
  url: string; initialState: S; initialName: string; initialVersion: number;
  /** The author name sent with each save. */
  author: () => string;
  /** The map in messages: "This plan has been deleted…". */
  noun: 'plan' | 'cluster';
}) {
  const { url, author, noun } = args;
  const [state, setState] = useState(args.initialState);
  const [name, setName] = useState(args.initialName);
  const [undo, setUndo] = useState<S[]>([]);
  const [save, setSaveState] = useState<SaveState>('saved');
  const saveRef = useRef<SaveState>('saved');
  const setSave = useCallback((s: SaveState) => { saveRef.current = s; setSaveState(s); }, []);
  const [notice, setNotice] = useState('');
  const version = useRef(args.initialVersion);
  /** The version someone else saved, learned from a conflict. Used only if the person chooses to overwrite. */
  const theirs = useRef<number | null>(null);
  const inFlight = useRef(false);
  const unsaved = useRef(false);
  const latest = useRef({ state, name });
  latest.current = { state, name };

  /** An edit happened. It never clears a conflict or a refusal: those stay until the person chooses what to do. */
  const touch = useCallback(() => {
    unsaved.current = true;
    if (saveRef.current !== 'conflict' && saveRef.current !== 'refused') setSave('dirty');
  }, [setSave]);

  const update = useCallback((fn: (s: S) => S) => {
    const prev = latest.current.state;
    const next = fn(prev);
    if (next === prev) return;
    latest.current = { ...latest.current, state: next }; // so two updates in one event build on each other
    setUndo(u => [...u.slice(-40), prev]);
    setState(next);
    touch();
  }, [touch]);

  const rename = useCallback((v: string) => {
    setName(v);
    latest.current = { ...latest.current, name: v };
    touch();
  }, [touch]);

  const putBody = useCallback(() => JSON.stringify({
    name: latest.current.name, state: latest.current.state, version: version.current, authorName: author(),
  }), [author]);

  // One save at a time. A conflict or a refusal stops saving until the person chooses; nothing here overwrites
  // someone else's save unless overwrite() was called.
  const persist = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSave('saving');
    const sent = latest.current;
    try {
      const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: putBody() });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        theirs.current = typeof body.version === 'number' ? body.version : null;
        setNotice(body.updatedBy ?? 'Someone else');
        setSave('conflict');
        return;
      }
      if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) {
        setNotice(res.status === 404 ? `This ${noun} has been deleted, so it can no longer be saved.`
          : res.status === 400 ? `The server did not accept the ${noun}: ${body.error ?? 'it could not be read'} A blank name or a very large ${noun} can cause this.`
          : `This sign-in cannot save ${noun}s.`);
        setSave('refused');
        return;
      }
      if (!res.ok) throw new Error(body.error ?? 'save failed');
      version.current = body.version;
      const clean = latest.current.state === sent.state && latest.current.name === sent.name;
      unsaved.current = !clean;
      setSave(clean ? 'saved' : 'dirty');
    } catch {
      setSave('error');
    } finally {
      inFlight.current = false;
      // Edits made while the save was in flight: the state is already 'dirty', so the effect below will not re-run.
      if (unsaved.current && saveRef.current === 'dirty') setTimeout(() => { void persist(); }, 600);
    }
  }, [url, noun, putBody, setSave]);

  /** The person chose to keep their version: save over the one someone else saved. */
  const overwrite = useCallback(() => {
    if (theirs.current != null) version.current = theirs.current;
    theirs.current = null;
    void persist();
  }, [persist]);

  useEffect(() => {
    if (save !== 'dirty') return;
    const t = setTimeout(() => { void persist(); }, 1200);
    return () => clearTimeout(t);
  }, [save, state, name, persist]);

  // Leaving with unsaved edits: send them on the way out, and warn when they cannot be sent.
  useEffect(() => {
    const stuck = () => saveRef.current === 'conflict' || saveRef.current === 'refused' || saveRef.current === 'error';
    const flush = () => {
      if (!unsaved.current || stuck() || inFlight.current) return;
      unsaved.current = false;
      void fetch(url, { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: putBody() });
    };
    const warn = (e: BeforeUnloadEvent) => { if (unsaved.current && (stuck() || inFlight.current)) e.preventDefault(); };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('pagehide', flush); window.removeEventListener('beforeunload', warn); flush(); };
  }, [url, putBody]);

  function stepBack() {
    const prev = undo[undo.length - 1];
    if (!prev) return;
    latest.current = { ...latest.current, state: prev };
    setUndo(undo.slice(0, -1));
    setState(prev);
    touch();
  }

  /** The person chose to load the other version: drop the unsaved edits so leaving does not send them. */
  const discard = useCallback(() => { unsaved.current = false; }, []);
  /** The state as of the latest update, including one made earlier in the same event. */
  const current = useCallback(() => latest.current.state, []);

  return { state, name, rename, update, stepBack, canUndo: undo.length > 0, save, notice, persist, overwrite, discard, current };
}
