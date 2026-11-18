'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/** Creates a cluster holding the given courses and opens it. A login that names nobody is asked for a name first. */
export function StartStringCluster({ slug, codes, knownName }: { slug: string; codes: string[]; knownName: string | null }) {
  const router = useRouter();
  const [author, setAuthor] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const lastBy = useRef<string | null>(null);
  const name = `Strings: ${codes[0] ?? 'courses'}${codes.length > 1 ? ` and ${codes.length - 1} more` : ''}`;

  async function create(by: string) {
    if (started.current) return;
    started.current = true;
    lastBy.current = by;
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/build/clusters', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, courses: codes, authorName: by }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'The cluster could not be created.');
      if (!knownName) try { localStorage.setItem('cb-author', by); } catch { /* private window */ }
      router.replace(`/build/clusters/${body.id}?slug=${encodeURIComponent(slug)}`);
    } catch (err) {
      started.current = false;
      setError(err instanceof Error ? err.message : 'The cluster could not be created.');
      setBusy(false);
    }
  }

  useEffect(() => {
    let saved = '';
    try { saved = localStorage.getItem('cb-author') ?? ''; } catch { /* private window */ }
    const by = knownName ?? saved.trim();
    if (by) void create(by); else setReady(true);
    // Runs once: the courses and name come from the address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="cb cb-index">
      <header className="cb-index__head"><h1>{name}</h1></header>
      {busy && <p className="cb-muted">Opening a cluster with these courses…</p>}
      {ready && !busy && (
        <form className="cb-new" onSubmit={e => { e.preventDefault(); void create(author.trim()); }}>
          <label><span>Your name</span><input value={author} onChange={e => setAuthor(e.target.value)} maxLength={120} required /></label>
          <button type="submit">Create cluster</button>
        </form>
      )}
      {error && (
        <p className="cb-error" role="alert">
          {error}{' '}
          {lastBy.current && !ready && <button type="button" className="cb-linkbtn" onClick={() => void create(lastBy.current!)}>Try again</button>}
        </p>
      )}
    </div>
  );
}
