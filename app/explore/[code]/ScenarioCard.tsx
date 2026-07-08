'use client';

import type { Scenario, PredictedDelta, RippleLine } from '@/lib/ai/explore/scenario';

interface ScenarioCardProps {
  scenario: Scenario;
  onSave: (id: string) => void;
  onCompare: (id: string) => void;
}

const RIPPLE_GLYPH: Record<RippleLine['kind'], string> = {
  downstream_gap: '↓',
  upstream_gap: '↑',
  career_fit: '→',
};

function DeltaLine({ delta }: { delta: PredictedDelta }) {
  const { competency, from, to, confidence } = delta;

  const parts: string[] = [];

  // K — show only if both non-null and changed
  if (from.k !== null && to.k !== null && from.k !== to.k) {
    parts.push(`K${from.k} → ${to.k}`);
  }
  // U — show only if both non-null and changed
  if (from.u !== null && to.u !== null && from.u !== to.u) {
    parts.push(`U${from.u} → ${to.u}`);
  }
  // D — always shown
  parts.push(`D${from.d} → ${to.d}`);

  return (
    <div className="flex gap-2 text-xs">
      <span className="font-medium">{competency}</span>
      <span className="text-muted-foreground">{parts.join(' · ')}</span>
      <span className="text-muted-foreground">({confidence})</span>
    </div>
  );
}

function RippleEntry({ line }: { line: RippleLine }) {
  const glyph = RIPPLE_GLYPH[line.kind];
  return (
    <div className="flex gap-1 text-xs">
      <span className="text-muted-foreground">{glyph}</span>
      {line.courseCode && <span className="font-medium">{line.courseCode}</span>}
      <span>{line.label}: {line.before} → {line.after}</span>
    </div>
  );
}

export function ScenarioCard({ scenario, onSave, onCompare }: ScenarioCardProps) {
  const { id, change, predictedDeltas, computedRipple, caption } = scenario;
  // When caption is null, activity is used as the title; when caption is set,
  // the header shows caption and the change line shows the activity.
  const title = caption ?? change.activity;

  return (
    <div className="rounded-md border bg-card p-3 text-sm space-y-2">
      {/* Header — title is a direct text node so getByText finds it */}
      <div className="font-semibold">
        {`Scenario · “${title}”`}
      </div>

      {/* Change line — only show activity when caption is non-null (to avoid
          duplicate text nodes that break getByText uniqueness); always show artifact */}
      <div className="text-xs">
        {caption !== null && caption !== undefined
          ? <>{change.activity}<span className="text-muted-foreground"> · </span></>
          : null}
        <span className="text-muted-foreground">{change.artifact}</span>
      </div>

      {/* Predicted block */}
      {predictedDeltas.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Predicted</div>
          {predictedDeltas.map((delta, i) => (
            <DeltaLine key={i} delta={delta} />
          ))}
        </div>
      )}

      {/* Ripple block */}
      {computedRipple.length > 0 && (
        <div className="space-y-1" data-testid="scenario-ripple">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ripple</div>
          {computedRipple.map((line, i) => (
            <RippleEntry key={i} line={line} />
          ))}
        </div>
      )}

      {/* Footer buttons */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          className="rounded border px-2 py-0.5 text-xs hover:bg-muted"
          onClick={() => onSave(id)}
        >
          Save
        </button>
        <button
          type="button"
          className="rounded border px-2 py-0.5 text-xs hover:bg-muted"
          onClick={() => onCompare(id)}
        >
          Compare
        </button>
        <button
          type="button"
          className="rounded border px-2 py-0.5 text-xs opacity-40 cursor-not-allowed"
          disabled
          title="Coming soon — adopt this scenario as the course's next planned version"
        >
          Adopt · soon
        </button>
      </div>
    </div>
  );
}
