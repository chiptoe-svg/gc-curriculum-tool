'use client';

import { useState } from 'react';

export interface TargetOption {
  id: string;
  name: string;
  shortDefinition: string;
  industryContexts: string[];
}

interface Props {
  targets: TargetOption[];
  selectedId: string | null;
  unmapped: string | null;
  onPick: (id: string) => void;
  onUnmapped: (label: string) => void;
  onContinue: () => void;
}

export function CareerTargetPicker({ targets, selectedId, unmapped, onPick, onUnmapped, onContinue }: Props) {
  const [unmappedDraft, setUnmappedDraft] = useState(unmapped ?? '');
  const [openUnmapped, setOpenUnmapped] = useState(Boolean(unmapped));

  const canContinue = Boolean(selectedId) || Boolean(unmapped && unmapped.trim());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Pick the closest match</h1>
        <p className="mt-1 text-slate-600">Which of these is closest to a role you hire GC graduates into?</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {targets.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => onPick(t.id)}
            className={`block rounded-lg border p-4 text-left transition ${
              selectedId === t.id ? 'border-slate-800 bg-slate-50' : 'border-slate-200 bg-white hover:border-slate-400'
            }`}
          >
            <div className="font-medium">{t.name}</div>
            <p className="mt-1 text-sm text-slate-600">{t.shortDefinition}</p>
            {t.industryContexts.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {t.industryContexts.map(c => (
                  <span key={c} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{c}</span>
                ))}
              </div>
            )}
          </button>
        ))}
      </div>

      <div className="border-t border-dashed border-slate-300 pt-4">
        {!openUnmapped ? (
          <button type="button" onClick={() => setOpenUnmapped(true)} className="text-sm text-blue-700 hover:underline">
            None of these quite fit — let me describe it
          </button>
        ) : (
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Tell us what to call this role</label>
            <input
              type="text"
              value={unmappedDraft}
              onChange={e => { setUnmappedDraft(e.target.value); onUnmapped(e.target.value); }}
              placeholder="e.g., Packaging design lead"
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onContinue}
          disabled={!canContinue}
          className="rounded bg-slate-800 px-5 py-2 text-sm text-white disabled:opacity-50"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
