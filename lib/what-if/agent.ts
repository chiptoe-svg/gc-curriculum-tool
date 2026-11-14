/**
 * Streaming orchestrator for the what-if assistant: the faculty-facing chat
 * that helps pin down a proposed change to one course. Mirrors
 * `streamExploreAgent` for the provider loop, with one what-if tool
 * (`quick_estimate`) beside the grounding and materials tools. Nothing here
 * writes to the real course: history comes from the what-if's own stored
 * messages, and every tool only reads.
 *
 * Yields: `tool-start`, `text-delta`, then `estimate` (one per quick estimate
 * run this turn), then `final`; `error` on failure.
 */
import { getProviderForFunction, type CompletionTelemetry } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import type { Message, StreamEvent } from '@/lib/ai/tool-use-types';
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import { buildAuditTools } from '@/lib/ai/agent/audit-tools';
import { buildCurriculumChatTools } from '@/lib/ai/wiki/tools';
import { buildCurriculumGraphTools } from '@/lib/ai/wiki/graph-tools';
import { buildCurriculumSearchTools } from '@/lib/ai/wiki/curriculum-search-tool';
import { AiCreditsExhaustedError } from '@/lib/ai/credit-status';
import { readWikiPage } from '@/lib/wiki/git-ops';
import type { WhatIfRow } from '@/lib/db/what-if-queries';
import type { attachmentsForAi } from './attachments';
import { buildWhatIfTools, type QuickEstimate } from './agent-tools';
import {
  whatIfAgentResponseSchema,
  WHAT_IF_AGENT_RESPONSE_JSON_SCHEMA,
  type WhatIfAgentResponse,
} from './agent-response-schema';

export type { WhatIfAgentResponse };
export type WhatIfAgentStreamEvent =
  | { kind: 'tool-start'; toolName: string; args: Record<string, unknown> }
  | { kind: 'text-delta'; delta: string }
  | { kind: 'estimate'; estimate: QuickEstimate }
  | { kind: 'final'; response: WhatIfAgentResponse; toolCallsUsed: number }
  | { kind: 'error'; message: string };

type AiAttachment = Awaited<ReturnType<typeof attachmentsForAi>>[number];

const CUT_LINE = 'The rest of this file was cut at the 120,000-character limit.';
const MATERIAL_TOOLS = ['list_materials', 'fetch_material_section', 'search_materials'];
const fmt = (v: number | null) => (v === null ? '-' : String(v));

function attachmentBlock(attachments: AiAttachment[]): string {
  if (attachments.length === 0) return '(none)';
  return attachments.map(a => {
    if (a.status === 'failed') return `### ${a.fileName}: this file could not be read.`;
    if (a.status === 'held_back') return `### ${a.fileName}: this file was held back and its text is not available.`;
    if (a.text === null) return `### ${a.fileName}: this file was left out because of the 120,000-character limit.`;
    return `### ${a.fileName}\n${a.text}${a.truncated ? `\n\n${CUT_LINE}` : ''}`;
  }).join('\n\n');
}

function contextBlock(input: {
  whatIf: WhatIfRow; approved: CaptureProfile | null; wikiPage: string | null; attachments: AiAttachment[];
}): string {
  const ratings = input.approved
    ? input.approved.competencies
        .map(c => `- [${c.type}] ${c.statement} (K${fmt(c.k_depth)} U${fmt(c.u_depth)} D${fmt(c.d_depth)})`)
        .join('\n')
    : 'The version this what-if started from no longer exists, so there are no approved ratings to show and no estimate can be made.';
  return [
    "[System note: context for this what-if. Treat it as background; the faculty member's message follows.]",
    `**Course:** ${input.whatIf.courseCode}`,
    `**Approved ratings:**\n${ratings}`,
    input.wikiPage ? `**Course wiki page:**\n${input.wikiPage}` : '**Course wiki page:** none yet.',
    `**Attached documents:**\n${attachmentBlock(input.attachments)}`,
  ].join('\n\n');
}

export async function* streamWhatIfAgent(input: {
  whatIf: WhatIfRow;
  approved: CaptureProfile | null;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  message: string;
  attachments: AiAttachment[];
  onEstimate: (q: QuickEstimate, telemetry: CompletionTelemetry) => Promise<void>;
  /** Cost of the chat turn itself, reported once when the turn finishes. */
  onChatTelemetry?: (t: CompletionTelemetry) => void;
}): AsyncGenerator<WhatIfAgentStreamEvent, void, unknown> {
  const { whatIf } = input;
  let systemPrompt: string;
  try {
    systemPrompt = await loadPrompt('what-if-agent');
  } catch (err) {
    yield { kind: 'error', message: err instanceof Error ? err.message : String(err) };
    return;
  }

  const slug = whatIf.courseCode.toLowerCase().replace(/\s+/g, '-');
  const wikiPage = await readWikiPage(`courses/${slug}.md`);
  const context = contextBlock({ whatIf, approved: input.approved, wikiPage, attachments: input.attachments });

  // The context rides on the first user message; the stored history always starts with one.
  const turns = [...input.history, { role: 'user' as const, content: input.message }];
  const messages: Message[] = turns.map((t, i) =>
    i === 0 ? { role: t.role, content: `${context}\n\n---\n\n${t.content}` } : t);

  const emitted: QuickEstimate[] = [];
  const estimateAttachments = input.attachments.flatMap(a =>
    a.status === 'ok' && a.text !== null
      ? [{ fileName: a.fileName, text: a.truncated ? `${a.text}\n\n${CUT_LINE}` : a.text }]
      : []);

  const tools = [
    ...buildCurriculumChatTools(),
    ...buildCurriculumGraphTools(),
    ...buildCurriculumSearchTools(),
    ...buildAuditTools(whatIf.courseCode).filter(t => MATERIAL_TOOLS.includes(t.name)),
    ...buildWhatIfTools({
      whatIf,
      approved: input.approved,
      conversation: turns,
      attachments: estimateAttachments,
      onEstimate: async (q, telemetry) => {
        emitted.push(q);
        await input.onEstimate(q, telemetry);
      },
    }),
  ];

  const provider = await getProviderForFunction('what-if-agent', { courseCode: whatIf.courseCode });

  let finalValue: WhatIfAgentResponse | null = null;
  let toolCallsUsed = 0;
  try {
    const stream = provider.streamWithTools<WhatIfAgentResponse>({
      systemPrompt,
      messages,
      tools,
      schemaName: 'what_if_agent_response',
      jsonSchema: WHAT_IF_AGENT_RESPONSE_JSON_SCHEMA as unknown as object,
      validate: raw => whatIfAgentResponseSchema.parse(raw),
      maxToolCalls: 8,
    });
    for await (const ev of stream as AsyncIterable<StreamEvent<WhatIfAgentResponse>>) {
      if (ev.kind === 'tool-start') {
        yield { kind: 'tool-start', toolName: ev.toolName, args: ev.args };
      } else if (ev.kind === 'text-delta') {
        yield { kind: 'text-delta', delta: ev.delta };
      } else if (ev.kind === 'final') {
        finalValue = ev.value;
        toolCallsUsed = ev.toolCallsUsed.length;
        input.onChatTelemetry?.(ev.telemetry);
      } else if (ev.kind === 'error') {
        yield { kind: 'error', message: ev.message };
        return;
      }
    }
  } catch (err) {
    if (err instanceof AiCreditsExhaustedError) throw err; // the route has the credits wording
    yield { kind: 'error', message: err instanceof Error ? err.message : String(err) };
    return;
  }

  if (!finalValue) {
    yield { kind: 'error', message: 'stream ended without a final response' };
    return;
  }
  for (const q of emitted) yield { kind: 'estimate', estimate: q };
  yield { kind: 'final', response: finalValue, toolCallsUsed };
}
