'use client';

/**
 * Page2Section — Uniqueness + Success Criteria.
 *
 * structuredInputs keys written here:
 *   structuredInputs.uniqueness       — string | null
 *   structuredInputs.success_criteria — string | null
 */

import { useState } from 'react';
import { VoiceRecorder } from '@/components/VoiceRecorder';

interface Patch {
  structuredInputs?: Record<string, unknown>;
}

interface Props {
  token: string;
  captureId: string;
  structuredInputs: Record<string, unknown>;
  positionTitle: string | null;
  onChange: (patch: Patch) => void;
}

export function Page2Section({ token, structuredInputs, onChange }: Props) {
  const [uniqueness, setUniqueness] = useState<string>(
    typeof structuredInputs.uniqueness === 'string' ? structuredInputs.uniqueness : '',
  );
  const [successCriteria, setSuccessCriteria] = useState<string>(
    typeof structuredInputs.success_criteria === 'string' ? structuredInputs.success_criteria : '',
  );

  const transcribeEndpoint = `/api/partners/transcribe?token=${encodeURIComponent(token)}`;

  function emitUniqueness(val: string) {
    setUniqueness(val);
    onChange({ structuredInputs: { ...structuredInputs, uniqueness: val || null } });
  }

  function emitSuccessCriteria(val: string) {
    setSuccessCriteria(val);
    onChange({ structuredInputs: { ...structuredInputs, success_criteria: val || null } });
  }

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-slate-200 bg-slate-50 px-5 py-4">
        <h2 className="mb-1 text-base font-semibold text-slate-800">What makes this role unique?</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Describe what sets this position apart — the team culture, the growth opportunity, the technology,
          the impact. What would a great candidate be excited about?
        </p>
        <textarea
          value={uniqueness}
          onChange={e => emitUniqueness(e.target.value)}
          rows={6}
          placeholder="e.g., This role sits at the intersection of brand and production — the designer owns the project from concept to press check, which is rare at this scale…"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400"
        />
        <div className="mt-2">
          <VoiceRecorder
            endpoint={transcribeEndpoint}
            onTranscript={text => emitUniqueness((uniqueness + ' ' + text).trim())}
          />
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-slate-50 px-5 py-4">
        <h2 className="mb-1 text-base font-semibold text-slate-800">What does success look like?</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          What would a highly successful hire accomplish in the first year? What knowledge, behaviours, or
          outputs would mark them as exceptional?
        </p>
        <textarea
          value={successCriteria}
          onChange={e => emitSuccessCriteria(e.target.value)}
          rows={6}
          placeholder="e.g., Within 6 months they've shipped two major packaging projects independently, built relationships with the production vendors, and caught a prepress error before it went to print…"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400"
        />
        <div className="mt-2">
          <VoiceRecorder
            endpoint={transcribeEndpoint}
            onTranscript={text => emitSuccessCriteria((successCriteria + ' ' + text).trim())}
          />
        </div>
      </section>
    </div>
  );
}
