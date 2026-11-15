'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function DeletePlan({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function remove() {
    if (!window.confirm(`Delete the plan “${name}”? This cannot be undone.`)) return;
    setBusy(true);
    const res = await fetch(`/api/build/plans/${id}`, { method: 'DELETE' });
    setBusy(false);
    if (res.ok) router.refresh();
    else window.alert('The plan could not be deleted.');
  }
  return <button type="button" className="cb-linkbtn" onClick={remove} disabled={busy}>{busy ? 'Deleting…' : 'Delete'}</button>;
}
