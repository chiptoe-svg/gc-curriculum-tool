import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';
import {
  appendPositionMessage,
  getPositionSession,
  type PositionMessageRow,
} from '@/lib/db/position-capture-queries';
import {
  AuditResponseSchema,
  AuditResponseJsonSchema,
  type AuditResponse,
} from '@/lib/ai/agent/audit-response-schema';
import { PositionProfile, positionProfileJsonSchema, type PositionProfileType } from './schema';
import type { Message } from '@/lib/ai/tool-use-types';

export interface PositionContextBundle {
  positionTitle: string;
  company: string;
  targetContext: {
    id: string;
    name: string;
    description: string;
    subCompetencies: Array<{ id: string; name: string; description: string }>;
  };
  structuredInputs: Record<string, unknown> | null;
  ratedSkills: { items: Array<{ name: string; description?: string; sub_competency_id?: string | null; evidence_source?: string; rating: number }>; generatedAt: string } | null;
}

export interface RunPositionInterviewInput extends PositionContextBundle {
  partnerId: string;
  positionCaptureId: string;
  sessionId: string;
  userMessage?: string;
}

export interface RunPositionInterviewResult {
  response: AuditResponse;
  costUsdCents: number;
  durationMs: number;
  cachedTokens: number;
  uncachedPromptTokens: number;
  completionTokens: number;
  model: string;
}

function buildContextBlock(input: PositionContextBundle): string {
  const lines = [
    `# Position`,
    `**${input.positionTitle}** at ${input.company}`,
    '',
    `# Career target`,
    `**${input.targetContext.name}** — ${input.targetContext.description}`,
    '',
    `# Sub-competencies`,
    ...input.targetContext.subCompetencies.map(sc => `- [${sc.id}] ${sc.name}: ${sc.description}`),
  ];
  if (input.structuredInputs) {
    lines.push('', `# Pages 1-4 input`, '```json', JSON.stringify(input.structuredInputs, null, 2), '```');
  }
  if (input.ratedSkills) {
    lines.push('', `# Page 5 rated items`);
    for (const item of input.ratedSkills.items) {
      lines.push(`- (${item.rating}/7) [${item.sub_competency_id ?? 'no-id'}] **${item.name}** — ${item.description ?? ''}`);
    }
  }
  return lines.join('\n');
}

export async function runPositionInterview(input: RunPositionInterviewInput): Promise<RunPositionInterviewResult> {
  const existing = await getPositionSession(input.positionCaptureId, input.sessionId);
  const isOpeningTurn = existing.length === 0 && !input.userMessage;
  const userTurnIndex = existing.length;

  if (!isOpeningTurn) {
    if (!input.userMessage) throw new Error('runPositionInterview: userMessage required for non-opening turn');
    await appendPositionMessage({
      partnerId: input.partnerId,
      positionCaptureId: input.positionCaptureId,
      sessionId: input.sessionId,
      turnIndex: userTurnIndex,
      role: 'user',
      content: input.userMessage,
    });
  }

  const history = await getPositionSession(input.positionCaptureId, input.sessionId);
  const provider = await getProviderForFunction('position-interview-agent');
  const systemPrompt = await loadPrompt('position-interview-agent');

  const contextBlock = buildContextBlock(input);

  const messages: Message[] = [
    { role: 'user', content: contextBlock },
    ...history
      .filter((m: PositionMessageRow) => m.role === 'user' || m.role === 'assistant')
      .map((m: PositionMessageRow): Message => {
        if (m.role === 'assistant') {
          return { role: 'assistant', content: typeof m.content === 'string' ? m.content : null };
        }
        return { role: 'user', content: m.content ?? '' };
      }),
  ];

  if (isOpeningTurn) {
    messages.push({ role: 'user', content: `Begin the interview now per the conversation rules. Produce your opening (anchor) turn.` });
  }

  const result = await provider.completeWithTools<AuditResponse>({
    systemPrompt,
    messages,
    tools: [],
    schemaName: 'position_interview_turn',
    jsonSchema: AuditResponseJsonSchema as unknown as object,
    validate: (raw: unknown) => AuditResponseSchema.parse(raw),
  });

  if (result.kind !== 'response') {
    throw new Error('runPositionInterview: completeWithTools did not return a response');
  }

  const assistantTurnIndex = isOpeningTurn ? 0 : userTurnIndex + 1;
  await appendPositionMessage({
    partnerId: input.partnerId,
    positionCaptureId: input.positionCaptureId,
    sessionId: input.sessionId,
    turnIndex: assistantTurnIndex,
    role: 'assistant',
    content: JSON.stringify(result.value),
  });

  return {
    response: result.value,
    costUsdCents: result.telemetry.costUsdCents,
    durationMs: result.telemetry.durationMs,
    cachedTokens: result.telemetry.cachedTokens,
    uncachedPromptTokens: result.telemetry.uncachedPromptTokens,
    completionTokens: result.telemetry.completionTokens,
    model: provider.model,
  };
}

export interface GeneratePositionProfileInput extends PositionContextBundle {
  partnerId: string;
  positionCaptureId: string;
  sessionId: string;
}

export interface GeneratePositionProfileResult {
  profile: PositionProfileType;
  model: string;
  costUsdCents: number;
  durationMs: number;
}

export async function generatePositionProfile(input: GeneratePositionProfileInput): Promise<GeneratePositionProfileResult> {
  const transcript = await getPositionSession(input.positionCaptureId, input.sessionId);
  if (transcript.length === 0) throw new Error('generatePositionProfile: no transcript to synthesize');

  const provider = await getProviderForFunction('position-synthesis');
  const systemPrompt = await loadPrompt('position-synthesis');

  const contextBlock = buildContextBlock(input);
  const transcriptBlock = transcript.map((row: PositionMessageRow) => {
    const idShort = row.id.slice(0, 8);
    if (row.role === 'user') return `PARTNER (turn ${row.turnIndex}, id=${idShort}): ${row.content ?? ''}`;
    let text = row.content ?? '';
    try {
      const parsed = JSON.parse(text) as { finding?: string; question?: string };
      text = [parsed.finding && `Finding: ${parsed.finding}`, parsed.question && `Question: ${parsed.question}`].filter(Boolean).join('\n');
    } catch { /* keep raw */ }
    return `INTERVIEWER (turn ${row.turnIndex}, id=${idShort}):\n${text}`;
  }).join('\n\n');

  const userMessage = [
    contextBlock,
    '',
    '---',
    '',
    '# Page 6 transcript',
    transcriptBlock,
    '',
    '---',
    '',
    'Emit the PositionProfile JSON now per the schema.',
  ].join('\n');

  const result = await provider.complete<PositionProfileType>({
    systemPrompt,
    userMessage,
    schemaName: 'position_profile_v1',
    jsonSchema: positionProfileJsonSchema as unknown as object,
    validate: (raw: unknown) => PositionProfile.parse(raw),
  });

  // Server-stamp generated_at (same pattern as capture-scores route — don't trust the model's value).
  const profile: PositionProfileType = { ...result.data, generated_at: new Date().toISOString() };

  return {
    profile,
    model: provider.model,
    costUsdCents: result.costUsdCents,
    durationMs: result.durationMs,
  };
}
