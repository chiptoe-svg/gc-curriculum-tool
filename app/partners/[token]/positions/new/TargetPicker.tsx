'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface TargetOption {
  id: string;
  name: string;
  shortDefinition: string;
}

interface Props {
  token: string;
  targets: TargetOption[];
}

export function TargetPicker({ token, targets }: Props) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handlePick(id: string) {
    setSelectedId(id);
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/partners/${encodeURIComponent(token)}/positions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ careerTargetId: id }),
      });
      if (!res.ok) {
        setError('Could not create draft. Please try again.');
        setSelectedId(null);
        return;
      }
      const { id: captureId } = await res.json() as { id: string };
      router.push(`/partners/${encodeURIComponent(token)}/positions/${captureId}/page/1`);
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {targets.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => handlePick(t.id)}
            disabled={pending}
            className={
              'block rounded-lg border p-4 text-left transition disabled:opacity-60 '
              + (selectedId === t.id
                ? 'border-slate-800 bg-slate-50 ring-1 ring-slate-800'
                : 'border-slate-200 bg-white hover:border-slate-400')
            }
          >
            <div className="font-medium">{t.name}</div>
            {t.shortDefinition && (
              <p className="mt-1 text-sm text-slate-600">{t.shortDefinition}</p>
            )}
          </button>
        ))}
      </div>
      {pending && (
        <p className="text-sm text-muted-foreground">Creating draft…</p>
      )}
      {error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}
    </div>
  );
}
