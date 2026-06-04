import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';
import { appendEmployerMessage, getEmployerSession, type EmployerMessageRow } from '@/lib/db/employer-capture-queries';
import { AuditResponseSchema, AuditResponseJsonSchema, type AuditResponse } from '@/lib/ai/agent/audit-response-schema';
import { CareerCaptureProfile, careerCaptureProfileJsonSchema, type CareerCaptureProfileType } from './schema';
import type { Message } from '@/lib/ai/tool-use-types';

export interface RunEmployerInterviewInput {
  partnerId: string;
  careerTargetId: string;
  sessionId: string;
  userMessage?: string;
  /** Career-target description + sub-competencies (catalog context). */
  targetContext: {
    id: string;
    name: string;
    description: string;
    subCompetencies: Array<{ id: string; name: string; description: string }>;
  };
  /** Prior captures from other partners on this same target. Optional. */
  priorCaptures?: Array<{ partnerLabel: string; profile: unknown }>;
}

export interface RunEmployerInterviewResult {
  response: AuditResponse;
  costUsdCents: number;
  durationMs: number;
  cachedTokens: number;
  uncachedPromptTokens: number;
  completionTokens: number;
  model: string;
}

/**
 * One turn of an employer interview. Mirrors runAuditAgent: persists
 * the user turn (if present), assembles context, calls the provider
 * with the structured-response schema, persists the assistant turn,
 * returns the parsed response + telemetry.
 *
 * Uses `completeWithTools` with an empty tools array (same pattern as
 * audit-agent.ts) because `complete` only accepts a single `userMessage`
 * string and cannot carry multi-turn message history.
 */
export async function runEmployerInterview(input: RunEmployerInterviewInput): Promise<RunEmployerInterviewResult> {
  const existing = await getEmployerSession(input.partnerId, input.careerTargetId, input.sessionId);
  const isOpeningTurn = existing.length === 0 && !input.userMessage;
  const userTurnIndex = existing.length;

  if (!isOpeningTurn) {
    if (!input.userMessage) throw new Error('runEmployerInterview: userMessage required when continuing a session');
    await appendEmployerMessage({
      partnerId: input.partnerId,
      careerTargetId: input.careerTargetId,
      sessionId: input.sessionId,
      turnIndex: userTurnIndex,
      role: 'user',
      content: input.userMessage,
    });
  }

  const history = await getEmployerSession(input.partnerId, input.careerTargetId, input.sessionId);
  const provider = await getProviderForFunction('capture-employer-chat-agent');
  const systemPrompt = await loadPrompt('capture-employer-chat-agent');

  const contextBlock = [
    `# Career target`,
    `**${input.targetContext.name}** (id: ${input.targetContext.id})`,
    input.targetContext.description,
    '',
    `# Sub-competencies the program is trying to develop for this target`,
    ...input.targetContext.subCompetencies.map(sc => `- **${sc.name}**: ${sc.description}`),
  ].join('\n');

  const priorBlock = input.priorCaptures && input.priorCaptures.length > 0
    ? [
        '',
        `# Prior captures on this target from other partners (don't repeat questions)`,
        ...input.priorCaptures.map((c, i) =>
          `## Partner ${i + 1} (${c.partnerLabel})\n${JSON.stringify(c.profile, null, 2).slice(0, 2000)}`
        ),
      ].join('\n')
    : '';

  const messages: Message[] = [
    { role: 'user', content: contextBlock + priorBlock },
    ...history
      .filter((m: EmployerMessageRow) => m.role === 'user' || m.role === 'assistant')
      .map((m: EmployerMessageRow): Message => {
        if (m.role === 'assistant') {
          return { role: 'assistant', content: typeof m.content === 'string' ? m.content : null };
        }
        return { role: 'user', content: m.content ?? '' };
      }),
  ];

  if (isOpeningTurn) {
    messages.push({
      role: 'user',
      content: `Begin the interview now per the conversation rules. Produce your opening turn.`,
    });
  }

  const result = await provider.completeWithTools<AuditResponse>({
    systemPrompt,
    messages,
    tools: [],
    schemaName: 'employer_interview_turn',
    jsonSchema: AuditResponseJsonSchema as unknown as object,
    validate: (raw: unknown) => AuditResponseSchema.parse(raw),
  });

  if (result.kind !== 'response') {
    throw new Error('runEmployerInterview: completeWithTools did not return a response');
  }

  const assistantTurnIndex = isOpeningTurn ? 0 : userTurnIndex + 1;
  await appendEmployerMessage({
    partnerId: input.partnerId,
    careerTargetId: input.careerTargetId,
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

export interface GenerateCareerCaptureInput {
  partnerId: string;
  careerTargetId: string;
  sessionId: string;
  targetContext: RunEmployerInterviewInput['targetContext'];
  priorCaptures?: RunEmployerInterviewInput['priorCaptures'];
}

export interface GenerateCareerCaptureResult {
  profile: CareerCaptureProfileType;
  model: string;
  costUsdCents: number;
  durationMs: number;
}

/**
 * Run synthesis over a completed interview. Reads the full transcript,
 * emits a CareerCaptureProfile. Server-stamps generated_at.
 */
export async function generateCareerCaptureProfile(input: GenerateCareerCaptureInput): Promise<GenerateCareerCaptureResult> {
  const transcript = await getEmployerSession(input.partnerId, input.careerTargetId, input.sessionId);
  if (transcript.length === 0) {
    throw new Error('generateCareerCaptureProfile: no transcript to synthesize');
  }

  const provider = await getProviderForFunction('capture-employer-synthesis');
  const systemPrompt = await loadPrompt('capture-employer-synthesis');

  const contextBlock = [
    `# Career target`,
    `**${input.targetContext.name}** (id: ${input.targetContext.id})`,
    input.targetContext.description,
    '',
    `# Sub-competencies`,
    ...input.targetContext.subCompetencies.map(sc => `- **${sc.name}**: ${sc.description}`),
  ].join('\n');

  const transcriptBlock = transcript.map((row: EmployerMessageRow) => {
    const idShort = row.id.slice(0, 8);
    if (row.role === 'user') {
      return `PARTNER (turn ${row.turnIndex}, id=${idShort}): ${row.content ?? ''}`;
    }
    let text = row.content ?? '';
    try {
      const parsed = JSON.parse(text) as { finding?: string; question?: string };
      text = [parsed.finding && `Finding: ${parsed.finding}`, parsed.question && `Question: ${parsed.question}`].filter(Boolean).join('\n');
    } catch { /* keep raw */ }
    return `INTERVIEWER (turn ${row.turnIndex}, id=${idShort}):\n${text}`;
  }).join('\n\n');

  const priorBlock = input.priorCaptures && input.priorCaptures.length > 0
    ? '\n\n# Prior captures on this target from other partners\n' +
      input.priorCaptures.map((c, i) => `## Partner ${i + 1} (${c.partnerLabel})\n${JSON.stringify(c.profile, null, 2).slice(0, 2000)}`).join('\n\n')
    : '';

  const userMessage = [
    contextBlock,
    priorBlock,
    '',
    '---',
    '',
    '# Interview transcript',
    transcriptBlock,
    '',
    '---',
    '',
    'Emit the CareerCaptureProfile JSON now per the schema.',
  ].join('\n');

  const result = await provider.complete<CareerCaptureProfileType>({
    systemPrompt,
    userMessage,
    schemaName: 'career_capture_profile_v1',
    jsonSchema: careerCaptureProfileJsonSchema as unknown as object,
    validate: (raw: unknown) => CareerCaptureProfile.parse(raw),
  });

  // Server-stamp generated_at (same pattern as capture-scores route — don't trust the model's value).
  const profile: CareerCaptureProfileType = { ...result.data, generated_at: new Date().toISOString() };

  return {
    profile,
    model: provider.model,
    costUsdCents: result.costUsdCents,
    durationMs: result.durationMs,
  };
}
