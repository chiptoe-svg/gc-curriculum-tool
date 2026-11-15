'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Start a plan: a name, and whether to begin from today's GC core or from nothing. */
export function NewPlan({ slug, knownName }: { slug: string; knownName: string | null }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [author, setAuthor] = useState('');
  const [start, setStart] = useState<'core' | 'blank'>('core');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/build/plans', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, start, authorName: author }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'The plan could not be created.');
      if (!knownName) try { localStorage.setItem('cb-author', author); } catch { /* private window */ }
      router.push(`/build/${body.id}?slug=${encodeURIComponent(slug)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The plan could not be created.');
      setBusy(false);
    }
  }

  return (
    <form className="cb-new" onSubmit={create}>
      <label>
        <span>Plan name</span>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Production track, fall 2027 revision" maxLength={120} required />
      </label>
      {!knownName && (
        <label>
          <span>Your name</span>
          <input value={author} onChange={e => setAuthor(e.target.value)} maxLength={120} required />
        </label>
      )}
      <fieldset>
        <legend>Start from</legend>
        <label><input type="radio" checked={start === 'core'} onChange={() => setStart('core')} /> Today&rsquo;s GC core, placed in acts by level</label>
        <label><input type="radio" checked={start === 'blank'} onChange={() => setStart('blank')} /> An empty map</label>
      </fieldset>
      <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create plan'}</button>
      {error && <p className="cb-error" role="alert">{error}</p>}
    </form>
  );
}
