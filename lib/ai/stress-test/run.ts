import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import type { CaptureChatContext } from '@/lib/ai/analyze/capture-chat';
import { buildCaptureChatUserMessage } from '@/lib/ai/analyze/capture-chat';
import { StressTestResult, stressTestResultJsonSchema, type StressTestResultType } from './schema';

/**
 * Minimal shape of capture_messages rows the reviewer needs to see.
 * Mirrors the shape used by capture-scores.ts's V2SynthesisContext
 * (which uses Drizzle's $inferSelect). We retype it locally to avoid
 * coupling stress-test to that other file's internal type.
 */
export interface StressTestTranscriptRow {
  id: string;
  turnIndex: number;
  role: string;
  content: string | null;
}

export interface StressTestContext {
  /** The Course Outcome Profile the reviewer is critiquing. */
  profile: CaptureProfile;
  /**
   * Same chatContext the synthesis agent had — gives the reviewer the
   * catalog entry, materials digests, prereq profiles, and any other
   * scope used to produce the profile. Reused via buildCaptureChatUserMessage.
   */
  chatContext: CaptureChatContext;
  /**
   * Full transcript of the audit session that produced the profile.
   * The reviewer cross-checks citations against actual turns.
   */
  transcript: StressTestTranscriptRow[];
}

export interface StressTestRunResult {
  result: StressTestResultType;
  telemetry: {
    costUsdCents: number;
    durationMs: number;
    cachedTokens: number;
    uncachedPromptTokens: number;
    completionTokens: number;
  };
  model: string;
}

/**
 * Render the transcript for the reviewer in the same shape the
 * synthesizer saw it — every turn carries its 8-char id prefix so the
 * reviewer can verify citation messageIds. Assistant turns are flattened
 * to "Finding: ... / Question: ..." form.
 */
function formatTranscriptForReview(rows: StressTestTranscriptRow[]): string {
  const lines: string[] = [];
  for (const row of rows) {
    const idShort = row.id.slice(0, 8);
    if (row.role === 'user') {
      lines.push(`USER (turn ${row.turnIndex}, id=${idShort}): ${row.content ?? '(empty)'}`);
      continue;
    }
    if (row.role === 'assistant') {
      let text = row.content ?? '';
      try {
        const parsed = JSON.parse(text) as { finding?: unknown; question?: unknown };
        const finding = typeof parsed.finding === 'string' ? parsed.finding : '';
        const question = typeof parsed.question === 'string' ? parsed.question : '';
        text = [finding && `Finding: ${finding}`, question && `Question: ${question}`].filter(Boolean).join('\n');
      } catch {
        // legacy/non-JSON assistant content — render raw
      }
      lines.push(`ASSISTANT (turn ${row.turnIndex}, id=${idShort}):\n${text}`);
    }
  }
  if (lines.length === 0) return '(no transcript turns recorded)';
  return lines.join('\n\n');
}

/**
 * Build the user message for the reviewer. Includes the chat context
 * block (catalog + materials + digests), the transcript, and the
 * profile JSON the reviewer is critiquing.
 */
function buildStressTestUserMessage(ctx: StressTestContext): string {
  return [
    buildCaptureChatUserMessage(ctx.chatContext),
    '',
    '---',
    '',
    '**Audit transcript (chronological; message ids exposed for citation verification):**',
    '',
    formatTranscriptForReview(ctx.transcript),
    '',
    '---',
    '',
    '**Profile to critique (JSON):**',
    '',
    '```json',
    JSON.stringify(ctx.profile, null, 2),
    '```',
    '',
    '---',
    '',
    'Critique now. Emit the StressTestResult JSON per the schema.',
    'Be terse. Cite back what drove each concern. Only emit',
    'suggested_adjustments when materially wrong. Reserve "disputed" for',
    'the strongest signal.',
  ].join('\n');
}

/**
 * Run the adversarial reviewer over a produced profile + its
 * synthesis context. One LLM call, structured output, returns the
 * critique + telemetry. Cost interlock + provider selection happen
 * inside getProviderForFunction (same as other capture-* functions).
 */
export async function runStressTest(ctx: StressTestContext): Promise<StressTestRunResult> {
  const provider = await getProviderForFunction('capture-stress-test');
  const systemPrompt = await loadPrompt('capture-stress-test');
  const userMessage = buildStressTestUserMessage(ctx);

  const result = await provider.complete<StressTestResultType>({
    systemPrompt,
    userMessage,
    schemaName: 'capture_stress_test_v1',
    jsonSchema: stressTestResultJsonSchema as unknown as object,
    validate: (raw: unknown) => StressTestResult.parse(raw),
  });

  return {
    result: result.data,
    telemetry: {
      costUsdCents: result.costUsdCents,
      durationMs: result.durationMs,
      cachedTokens: result.cachedTokens,
      uncachedPromptTokens: result.uncachedPromptTokens,
      completionTokens: result.completionTokens,
    },
    model: provider.model,
  };
}
