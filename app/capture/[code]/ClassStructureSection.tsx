'use client';

import { useState } from 'react';
import type { CaptureClassStructure, CaptureProfileCitationType } from '@/lib/ai/capture/schema';
import { SourceBadge } from './ProfileReviewPanel';

interface ClassStructureSectionProps {
  classStructure: CaptureClassStructure | null | undefined;
  editable: boolean;
  onChange: (next: CaptureClassStructure | null) => void;
  onCitationClick?: (c: CaptureProfileCitationType) => void;
}

export function ClassStructureSection({
  classStructure,
  editable,
  onChange,
  onCitationClick,
}: ClassStructureSectionProps) {
  const [editingTopicIndex, setEditingTopicIndex] = useState<number | null>(null);

  if (!classStructure) {
    return (
      <section className="rounded-md border bg-card px-4 py-3 text-sm">
        <h3 className="font-semibold text-sm">Class structure</h3>
        <p className="mt-1 text-xs italic text-muted-foreground">
          Not yet captured — re-audit to extract class structure from course materials.
        </p>
      </section>
    );
  }

  function handleTopicChange(i: number, val: string) {
    const next = classStructure!.topics.slice();
    next[i] = val;
    onChange({ ...classStructure!, topics: next });
  }

  function handleTopicBlur(i: number) {
    if (classStructure!.topics[i] === '') {
      const next = classStructure!.topics.filter((_, idx) => idx !== i);
      onChange({ ...classStructure!, topics: next });
    }
    setEditingTopicIndex(null);
  }

  function handleTopicKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const next = [
        ...classStructure!.topics.slice(0, i + 1),
        '',
        ...classStructure!.topics.slice(i + 1),
      ];
      onChange({ ...classStructure!, topics: next });
      setEditingTopicIndex(i + 1);
    } else if (e.key === 'Backspace' && classStructure!.topics[i] === '') {
      e.preventDefault();
      const next = classStructure!.topics.filter((_, idx) => idx !== i);
      onChange({ ...classStructure!, topics: next });
      setEditingTopicIndex(Math.max(0, i - 1));
    }
  }

  function handleAddTopic() {
    const next = [...classStructure!.topics, ''];
    onChange({ ...classStructure!, topics: next });
    setEditingTopicIndex(next.length - 1);
  }

  return (
    <section className="rounded-md border bg-card px-4 py-3 space-y-3">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold">Class structure</h3>
        <SourceBadge
          source={classStructure.source}
          citations={classStructure.citations}
          onCitationClick={onCitationClick}
        />
      </div>

      {/* Topics */}
      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Topics covered (in order)
        </p>
        <ol className="space-y-1 list-decimal list-inside">
          {classStructure.topics.map((topic, i) => (
            <li key={i} className="flex items-baseline gap-1">
              <span className="text-xs tabular-nums text-muted-foreground select-none mr-1">
                {i + 1}.
              </span>
              {editable && editingTopicIndex === i ? (
                <input
                  autoFocus
                  type="text"
                  value={topic}
                  onChange={e => handleTopicChange(i, e.target.value)}
                  onBlur={() => handleTopicBlur(i)}
                  onKeyDown={e => handleTopicKeyDown(i, e)}
                  className="flex-1 text-xs bg-muted/40 rounded-sm px-1 focus:outline-none focus:ring-1 focus:ring-ring border-0"
                />
              ) : (
                <span
                  onClick={() => editable && setEditingTopicIndex(i)}
                  className={
                    'flex-1 text-xs leading-snug' +
                    (editable ? ' cursor-text hover:bg-muted/40 rounded-sm px-1' : '')
                  }
                >
                  {topic}
                </span>
              )}
            </li>
          ))}
        </ol>
        {editable && (
          <button
            type="button"
            onClick={handleAddTopic}
            className="mt-1 text-[11px] text-muted-foreground hover:text-foreground border border-dashed border-muted-foreground/40 rounded px-2 py-0.5"
          >
            + Add topic
          </button>
        )}
      </div>

      {/* Cadence */}
      <div className="space-y-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Cadence
        </p>
        {editable ? (
          <input
            type="text"
            value={classStructure.cadence}
            onChange={e => onChange({ ...classStructure!, cadence: e.target.value })}
            className="w-full text-xs bg-muted/40 rounded-sm px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring border border-input"
          />
        ) : (
          <p className="text-xs">{classStructure.cadence}</p>
        )}
      </div>

      {/* Assessment */}
      <div className="space-y-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Assessment overview
        </p>
        {editable ? (
          <textarea
            value={classStructure.assessment}
            onChange={e => onChange({ ...classStructure!, assessment: e.target.value })}
            rows={2}
            className="w-full resize-none text-xs bg-muted/40 rounded-sm px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring border border-input"
          />
        ) : (
          <p className="text-xs">{classStructure.assessment}</p>
        )}
      </div>
    </section>
  );
}
