'use client';

import { useState } from 'react';
import type { SynthesisResult } from '@/lib/ai/synthesis/schema';

interface Props {
  target: {
    knowDescriptors: string[];
    understandDescriptors: string[];
    doDescriptors: string[];
  };
  edits: SynthesisResult['proposedKUDEdits'];
}

const DESCRIPTOR_LABEL = { know: 'Know', understand: 'Understand', do: 'Do' } as const;

export function ProposedKUDEditsPanel({ target, edits }: Props) {
  if (edits.length === 0) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold">Proposed KUD edits</h2>
        <p className="mt-2 text-sm text-slate-500">
          No proposed edits this run. The data either supports the current descriptors or doesn&apos;t surface a strong-enough signal yet.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
      <header>
        <h2 className="text-lg font-semibold">Proposed KUD edits</h2>
        <p className="text-sm text-slate-500">
          Each card is a suggestion grounded in partner submissions. Faculty curate: copy the text and paste into the curriculum tool&apos;s career-target editor.
        </p>
      </header>
      <ul className="space-y-3">
        {edits.map((e, i) => (
          <EditCard key={i} edit={e} target={target} />
        ))}
      </ul>
    </section>
  );
}

function EditCard({ edit, target }: { edit: SynthesisResult['proposedKUDEdits'][number]; target: Props['target'] }) {
  const [copied, setCopied] = useState(false);
  const existing = edit.type === 'edit' && edit.targetDescriptorIndex != null
    ? descriptorAt(target, edit.descriptor, edit.targetDescriptorIndex)
    : null;

  async function onCopy() {
    await navigator.clipboard.writeText(edit.proposedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <li className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded bg-slate-800 px-2 py-0.5 text-xs uppercase tracking-wide text-white">
            {DESCRIPTOR_LABEL[edit.descriptor]}
          </span>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs uppercase tracking-wide text-slate-700">
            {edit.type}
          </span>
          <span className="text-xs text-slate-500">
            supported by {edit.supportingPartnerIds.length} partner{edit.supportingPartnerIds.length === 1 ? '' : 's'}
          </span>
        </div>
        <button
          type="button"
          onClick={onCopy}
          className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
        >
          {copied ? 'Copied ✓' : 'Copy text'}
        </button>
      </div>

      {existing != null && (
        <div className="mt-3 rounded bg-slate-50 p-3 text-sm text-slate-600">
          <div className="text-xs uppercase tracking-wide text-slate-400">Replaces (index {edit.targetDescriptorIndex})</div>
          <div className="line-through">{existing}</div>
        </div>
      )}

      <div className="mt-3 rounded bg-amber-50 p-3 text-sm">
        <div className="text-xs uppercase tracking-wide text-amber-700">Proposed</div>
        <div className="mt-1">{edit.proposedText}</div>
      </div>

      <div className="mt-3 text-xs text-slate-600">
        <strong className="text-slate-800">Why:</strong> {edit.rationale}
      </div>
    </li>
  );
}

function descriptorAt(target: Props['target'], descriptor: 'know' | 'understand' | 'do', idx: number): string | null {
  const arr =
    descriptor === 'know' ? target.knowDescriptors :
    descriptor === 'understand' ? target.understandDescriptors :
    target.doDescriptors;
  return arr[idx] ?? null;
}
