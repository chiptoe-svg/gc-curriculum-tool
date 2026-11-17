'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Delete a plan, or (`kind` 'cluster') a course cluster. */
export function DeletePlan({ id, name, kind = 'plan' }: { id: string; name: string; kind?: 'plan' | 'cluster' }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function remove() {
    if (!window.confirm(`Delete the ${kind} “${name}”? This cannot be undone.`)) return;
    setBusy(true);
    const res = await fetch(`/api/build/${kind === 'cluster' ? 'clusters' : 'plans'}/${id}`, { method: 'DELETE' });
    setBusy(false);
    if (res.ok) router.refresh();
    else window.alert(`The ${kind} could not be deleted.`);
  }
  return <button type="button" className="cb-linkbtn" onClick={remove} disabled={busy}>{busy ? 'Deleting…' : 'Delete'}</button>;
}
