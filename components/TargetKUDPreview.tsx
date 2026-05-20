'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { CareerTarget } from '@/lib/domain/types';

interface Props {
  slug: string;
  target: CareerTarget | null;
}

export function TargetKUDPreview({ slug, target }: Props) {
  const [open, setOpen] = useState(false);

  // Auto-collapse when the target changes so we don't show stale content.
  useEffect(() => {
    setOpen(false);
  }, [target?.id]);

  if (!target) return null;

  return (
    <div className="rounded-md border border-border bg-card/60 text-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-accent/40"
        aria-expanded={open}
      >
        <span className="text-muted-foreground">
          Current Know / Understand / Do descriptors for <strong className="text-foreground">{target.name}</strong>
        </span>
        <span className="text-muted-foreground">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="border-t border-border px-4 py-4 space-y-4">
          <div className="flex justify-end">
            <Link
              href={`/preview/${slug}/targets/${target.id}`}
              className="text-xs text-blue-700 hover:underline"
            >
              Edit this target →
            </Link>
          </div>
          {target.subCompetencies.length === 0 ? (
            <p className="text-xs text-muted-foreground">No sub-competencies defined.</p>
          ) : (
            <ul className="space-y-3">
              {target.subCompetencies.map(sc => (
                <li key={sc.id} className="rounded border border-border p-3">
                  <div className="font-medium">{sc.name}</div>
                  <dl className="mt-2 grid gap-2 sm:grid-cols-3 text-xs">
                    <div>
                      <dt className="font-medium uppercase tracking-wide text-muted-foreground">Know</dt>
                      <dd>{sc.knowDescriptor}</dd>
                    </div>
                    <div>
                      <dt className="font-medium uppercase tracking-wide text-muted-foreground">Understand</dt>
                      <dd>{sc.understandDescriptor}</dd>
                    </div>
                    <div>
                      <dt className="font-medium uppercase tracking-wide text-muted-foreground">Do</dt>
                      <dd>{sc.doDescriptor}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
