import { z } from 'zod';
import type { ToolDefinition } from '@/lib/ai/tool-use-types';
import type { CompletionTelemetry } from '@/lib/ai/provider';
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import { listActiveSubCompetencies, type WhatIfRow } from '@/lib/db/what-if-queries';
import { estimateWhatIf } from './estimate';
import { buildWhatIfProfile } from './profile';
import { loadWhatIfNeighborContext } from './neighbors';
import { computeKnockOn } from './knock-on';
import type { KnockOn, WhatIfEstimate, WhatIfProfile } from './types';

export interface QuickEstimate {
  candidate: string;
  estimate: WhatIfEstimate;
  profile: WhatIfProfile;
  knockOn: KnockOn;
}

const BASE_GONE_MESSAGE =
  'The approved version this what-if started from no longer exists, so no estimate can be made. Tell the author plainly and keep helping them think the change through, without numbers.';

const kudText = (k: { k: number | null; u: number | null; d: number | null }) =>
  `K${k.k ?? '-'} U${k.u ?? '-'} D${k.d ?? '-'}`;

/** What the model sees of one quick estimate: moved and new ratings and the effect lines, nothing else. */
function summarize(q: QuickEstimate) {
  return {
    note: 'Predictions, not measurements. Say they are predicted when you relay them.',
    changes: q.profile.ratings.filter(r => r.status !== 'approved').map(r => ({
      statement: r.statement,
      status: r.status === 'new' ? 'new (predicted)' : 'moved (predicted)',
      before: r.before ? kudText(r.before) : null,
      after: kudText(r.kud),
      confidence: r.confidence,
      reason: r.reason,
    })),
    laterCourses: q.knockOn.laterCourses.map(l =>
      `${l.courseCode}: ${l.label} ${l.effect === 'closed' ? 'would no longer be a gap' : 'would become a gap'}`),
    earlierCourses: q.knockOn.earlierCourses.map(e =>
      `${e.statement}${e.label ? ` (${e.label})` : ''}: ${e.status.replace('_', ' ')}${e.deliveredBy.length ? `; delivered by ${e.deliveredBy.join(', ')}` : ''}`),
    careerTargets: q.knockOn.careerTargets.map(c => `${c.targetName}: ${c.label} ${c.before} to ${c.after} (${c.direction})`),
    notComputed: q.knockOn.notComputed,
  };
}

export function buildWhatIfTools(ctx: {
  whatIf: WhatIfRow;
  /** Null when the version this what-if started from has been deleted. */
  approved: CaptureProfile | null;
  /** The conversation so far, for the estimate. */
  conversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Attachment text for the estimate: ok files with text only. */
  attachments?: Array<{ fileName: string; text: string }>;
  onEstimate: (q: QuickEstimate, telemetry: CompletionTelemetry) => Promise<void>;
}): ToolDefinition[] {
  const quick_estimate: ToolDefinition = {
    name: 'quick_estimate',
    description:
      "Estimate how ONE candidate change would move this course's ratings, and what that does to later courses, earlier courses and career targets. The faculty member sees the result as a card. Predictions, not measurements. This is the only source of numbers you may state.",
    usagePolicy:
      'Pass `candidate`: the change in one or two plain sentences. One candidate per call. Use it when the faculty member asks for a read on an idea, or to size a candidate you offered.',
    inputSchema: z.object({ candidate: z.string().min(1) }),
    async execute(args) {
      const { candidate } = args as { candidate: string };
      const baseSnapshotId = ctx.whatIf.baseSnapshotId;
      if (!baseSnapshotId || !ctx.approved) return { message: BASE_GONE_MESSAGE };

      const catalog = await listActiveSubCompetencies();
      const neighborContext = await loadWhatIfNeighborContext(ctx.whatIf.courseCode, baseSnapshotId);
      const { estimate, telemetry } = await estimateWhatIf({
        courseCode: ctx.whatIf.courseCode,
        approved: ctx.approved,
        conversation: ctx.conversation ?? [],
        attachments: ctx.attachments ?? [],
        neighborContext,
        catalog,
        candidate,
      });
      const profile = buildWhatIfProfile(ctx.approved, estimate, new Set(catalog.map(c => c.id)));
      const knockOn = await computeKnockOn({ courseCode: ctx.whatIf.courseCode, baseSnapshotId }, profile);
      const q: QuickEstimate = { candidate, estimate, profile, knockOn };
      await ctx.onEstimate(q, telemetry);
      return summarize(q);
    },
  };
  return [quick_estimate];
}
