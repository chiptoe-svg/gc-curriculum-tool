'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Start a course cluster: a name (and the author's, for a login that names nobody). It opens on an empty canvas. */
export function NewCluster({ slug, knownName }: { slug: string; knownName: string | null }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [author, setAuthor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/build/clusters', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, authorName: author }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'The cluster could not be created.');
      if (!knownName) try { localStorage.setItem('cb-author', author); } catch { /* private window */ }
      router.push(`/build/clusters/${body.id}?slug=${encodeURIComponent(slug)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The cluster could not be created.');
      setBusy(false);
    }
  }

  return (
    <form className="cb-new" onSubmit={create}>
      <label>
        <span>Cluster name</span>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Print production sequence" maxLength={120} required />
      </label>
      {!knownName && (
        <label>
          <span>Your name</span>
          <input value={author} onChange={e => setAuthor(e.target.value)} maxLength={120} required />
        </label>
      )}
      <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create cluster'}</button>
      {error && <p className="cb-error" role="alert">{error}</p>}
    </form>
  );
}
