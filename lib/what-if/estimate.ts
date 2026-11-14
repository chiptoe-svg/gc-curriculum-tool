import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction, type CompletionTelemetry } from '@/lib/ai/provider';
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import type { NeighborContext, NeighborProfile } from '@/lib/ai/explore/neighbor-context';
import type { WhatIfEstimate } from './types';
import { whatIfEstimateSchema, WHAT_IF_ESTIMATE_JSON_SCHEMA } from './estimate-schema';

export interface EstimateInput {
  courseCode: string;
  approved: CaptureProfile;
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
  attachments: Array<{ fileName: string; text: string }>;
  neighborContext: NeighborContext;
  catalog: Array<{ id: string; name: string }>;
  /** Quick estimate: one candidate change, one or two sentences. */
  candidate?: string;
}

const fmt = (v: number | null) => (v === null ? '–' : String(v));

function neighborLines(profiles: NeighborProfile[]): string {
  return profiles
    .map(p => {
      const comps = p.competencies.map(c => `    - ${c.statement} (D:${c.d_depth})`).join('\n');
      const incoming = p.incoming_expectations.map(e => `    - expects: ${e.statement}`).join('\n');
      return `  ${p.courseCode}:\n${comps}\n${incoming}`;
    })
    .join('\n');
}

export async function estimateWhatIf(
  input: EstimateInput,
): Promise<{ estimate: WhatIfEstimate; telemetry: CompletionTelemetry }> {
  const provider = await getProviderForFunction('what-if-estimate', { courseCode: input.courseCode });
  const systemPrompt = await loadPrompt('what-if-estimate');

  const ratings = input.approved.competencies
    .map(c => `  - [${c.type}] ${c.statement} (K${fmt(c.k_depth)} U${fmt(c.u_depth)} D${c.d_depth})`)
    .join('\n');
  const conversation = input.conversation
    .map(t => `${t.role === 'user' ? 'Faculty' : 'Assistant'}: ${t.content}`)
    .join('\n\n');
  const attachments = input.attachments.map(a => `### ${a.fileName}\n${a.text}`).join('\n\n');
  const catalog = input.catalog.map(c => `  - ${c.id}: ${c.name}`).join('\n');

  const userMessage = [
    `**Course:** ${input.courseCode}`,
    '',
    `**Approved ratings (${input.courseCode}):**`,
    ratings || '  (none)',
    '',
    '---',
    '',
    '**Conversation about the change:**',
    conversation || '  (none)',
    '',
    '---',
    '',
    '**Attached documents:**',
    attachments || '  (none)',
    '',
    '---',
    '',
    '**Earlier courses (what students bring in):**',
    neighborLines(input.neighborContext.upstream) || '  (none)',
    '',
    '**Later courses (what students go on to):**',
    neighborLines(input.neighborContext.downstream) || '  (none)',
    '',
    '---',
    '',
    '**Catalog sub-competencies (use an id from this list or null):**',
    catalog || '  (none)',
    '',
    '---',
    '',
    ...(input.candidate
      ? [
          '**Candidate change:**',
          input.candidate.trim(),
          '',
          'Estimate only that candidate change, not the rest of the conversation.',
        ]
      : ["Estimate how the change described above moves this course's ratings."]),
  ].join('\n');

  const result = await provider.complete<WhatIfEstimate>({
    systemPrompt,
    userMessage,
    schemaName: 'what_if_estimate_v1',
    jsonSchema: WHAT_IF_ESTIMATE_JSON_SCHEMA,
    validate: (raw: unknown) => whatIfEstimateSchema.parse(raw),
  });

  const { data, ...telemetry } = result;
  return { estimate: data, telemetry };
}
