'use client';

/**
 * Page4Section — Career Trajectory.
 *
 * structuredInputs keys written here:
 *   structuredInputs.trajectory_freeform — string | null
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

export function Page4Section({ token, structuredInputs, onChange }: Props) {
  const [trajectory, setTrajectory] = useState<string>(
    typeof structuredInputs.trajectory_freeform === 'string' ? structuredInputs.trajectory_freeform : '',
  );

  const transcribeEndpoint = `/api/partners/transcribe?token=${encodeURIComponent(token)}`;

  function emitTrajectory(val: string) {
    setTrajectory(val);
    onChange({ structuredInputs: { ...structuredInputs, trajectory_freeform: val || null } });
  }

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-slate-200 bg-slate-50 px-5 py-4">
        <h2 className="mb-1 text-base font-semibold text-slate-800">Career trajectory</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Where does this role go? Describe the realistic growth path — lateral moves, advancement, skills
          a person would develop that open doors to other opportunities at your company or in the industry.
        </p>
        <textarea
          value={trajectory}
          onChange={e => emitTrajectory(e.target.value)}
          rows={8}
          placeholder="e.g., Strong performers often move into a Senior Designer role within 2-3 years, or transition into a Project Manager track once they've built vendor relationships. The production knowledge this role develops is transferable to press-side or agency account management…"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400"
        />
        <div className="mt-2">
          <VoiceRecorder
            endpoint={transcribeEndpoint}
            onTranscript={text => emitTrajectory((trajectory + ' ' + text).trim())}
          />
        </div>
      </section>
    </div>
  );
}
