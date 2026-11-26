/**
 * The interviewer turn on Pi (pi-agent-core, in-process). Pi plan Task 2, with
 * the rulings of 2026-11-09 (docs/superpowers/plans/2026-11-09-pi-interview-rulings.md):
 *
 * - same inputs as the current loop (buildAgentCall's system prompt, messages
 *   and tools); our ToolDefinitions become Pi AgentTools;
 * - the reply is a `submit_turn` tool call whose parameters are the
 *   AuditResponse schema; every request is tool_choice "required", and
 *   submit_turn is forced once the tool budget is spent or the model answers in
 *   plain text;
 * - temperature 0.2 on every request (the campus loop's setting; without it the
 *   questions drifted, blind read 2026-11-09);
 * - when the search trigger fires, the first request forces search_materials,
 *   instead of sending the model back after it has written its question;
 * - citations are repaired before they are checked (a quote over 200
 *   characters is trimmed, an invented messageId re-pointed); the submit_turn
 *   schema has no length limit on excerpts, because Pi validates tool
 *   arguments before our code runs; problems left are sent back twice, then
 *   dropped;
 * - a 16000-token cap on every model call; campus reasoning goes in each
 *   family's wire format (piReasoningSetup).
 */
// Pi ships ESM only, so its runtime modules are loaded with import() inside runPiTurn.
import type { AgentEvent, AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import type { Model } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { AuditResponseJsonSchema, AuditResponseSchema, type AuditResponse } from '@/lib/ai/agent/audit-response-schema';
import { renderToolDescription, type Message, type StreamEvent, type ToolCall, type ToolDefinition } from '@/lib/ai/tool-use-types';
import type { CompletionTelemetry } from '@/lib/ai/provider';
import { campusReasoningParams, type CampusReasoning } from '@/lib/ai/campus';
import { isCampusModel } from '@/lib/ai/models';
import { costUsdCents as priceUsdCents } from '@/lib/ai/prices';
import {
  MATERIAL_TOOLS, MAX_CITATION_RETRIES, checkCitations, chunkIdsInToolResult, citableFromHistory,
  citationFollowUp, keepValidCitations, needsMaterialSearch, previousQuestion, repairCitations,
  nullsToEmpty,
} from './controls';

export const PI_MAX_TOKENS = 16000;
/**
 * Estimated input tokens at which a Pi loop forces its submit (Task 9c). The model is declared with a 200k window;
 * Pi keeps a 15% margin and cuts max_tokens toward 1 as input nears ~170k, after which no reply fits. At 120k one
 * more large tool result (a fetch was 7-21k tokens in the GC 4060/2070 traces) still leaves the submit 16k of output.
 */
export const PI_INPUT_TOKEN_LIMIT = 120_000;
export const PI_TEMPERATURE = 0.2;

export interface PiEndpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
  api: 'openai-completions' | 'openai-responses';
  /** OpenAI reasoning effort (Pi's own setting). */
  reasoning?: 'low' | 'medium' | 'high';
  /** Campus (RCD) models: the reasoning level in that family's wire format. */
  campusReasoning?: CampusReasoning;
}

export interface PiTurnInput {
  systemPrompt: string;
  messages: Message[];
  tools: ToolDefinition[];
  /** The instructor's answer this turn (undefined on the opening turn). */
  userMessage?: string;
  /** Included course file names, for the search trigger. */
  fileNames: string[];
  courseCode: string;
  endpoint: PiEndpoint;
  /**
   * Force search_materials on the first request. The app passes the current
   * loop's decision (BuiltAgentCall.requireToolFirst); undefined recomputes it
   * from the exchange (benchmarks). Never forced when no search tool is offered.
   */
  requireSearchFirst?: boolean;
  /** Tool calls allowed before submit_turn is forced (default 4). */
  maxToolCalls?: number;
  /** Stream events for the chat screen: tool-start per tool call, text-delta while the reply streams. */
  onEvent?: (e: StreamEvent<AuditResponse>) => void;
  /** A custom reply tool (still named submit_turn). Default: the AuditResponse schema, with the citation checks. */
  submit?: { jsonSchema: Record<string, unknown>; parse: (raw: unknown) => unknown; description: string };
  /** Checks a custom submit's parsed value; a returned message is sent back to the model. Custom submit only. */
  checkSubmit?: (value: unknown) => string | null;
  /** Send-backs from checkSubmit before the value is accepted anyway (default 2). */
  maxSendBacks?: number;
}

export interface PiTurnResult<T = AuditResponse> {
  value: T;
  toolCallsUsed: ToolCall[];
  telemetry: CompletionTelemetry & { cacheWriteTokens: number };
  /** What the controls did this turn, in order. */
  controlEvents: string[];
  requests: number;
}

/** How a turn's reasoning reaches the wire: Pi's own setting for OpenAI, family fields for campus models. */
export function piReasoningSetup(ep: { model: string; reasoning?: PiEndpoint['reasoning']; campusReasoning?: CampusReasoning }): {
  piReasoning: boolean;
  samplingParams: Record<string, unknown>;
} {
  if (ep.reasoning && !ep.campusReasoning) return { piReasoning: true, samplingParams: {} };
  return { piReasoning: false, samplingParams: campusReasoningParams(ep.model, ep.campusReasoning) };
}

export const SUBMIT_INSTRUCTION = '\n\n# How to deliver each turn\n\nDeliver your turn by calling the `submit_turn` tool with the fields of the structured per-turn response (finding, question, citations, readiness). Never write the answer as plain text. Call other tools first if you need them; call `submit_turn` last, once.';

/** AuditResponse JSON schema with no length limit on citation excerpts (repairCitations trims them). */
export function submitTurnSchema(): Record<string, unknown> {
  const s = structuredClone(AuditResponseJsonSchema) as unknown as {
    properties: { citations: { items: { properties: { excerpt: Record<string, unknown> } } } };
  };
  delete s.properties.citations.items.properties.excerpt.maxLength;
  return s as unknown as Record<string, unknown>;
}

/** Control-event text for a failed tool execution (validation rejection, unknown tool, bad JSON, thrown error). */
export function toolErrorEvent(toolName: string, result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> } | null)?.content;
  const text = Array.isArray(content) ? content.filter(c => c?.type === 'text').map(c => c.text ?? '').join(' ') : String(result ?? '');
  return `tool error: ${toolName}: ${text.slice(0, 120)}`;
}

const ZERO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

export async function runPiTurn<T = AuditResponse>(input: PiTurnInput): Promise<PiTurnResult<T>> {
  const started = Date.now();
  const { Agent } = await import('@earendil-works/pi-agent-core');
  const { createModels, createProvider, envApiKeyAuth } = await import('@earendil-works/pi-ai');
  const { openAICompletionsApi } = await import('@earendil-works/pi-ai/api/openai-completions.lazy');
  const { openAIResponsesApi } = await import('@earendil-works/pi-ai/api/openai-responses.lazy');
  const { estimateContextTokens } = await import('@earendil-works/pi-ai/utils/estimate');
  const { Type } = await import('typebox');
  const maxToolCalls = input.maxToolCalls ?? 4;
  const ep = input.endpoint;
  const reasoningSetup = piReasoningSetup(ep);
  const keyVar = 'PI_INTERVIEW_API_KEY';
  process.env[keyVar] = ep.apiKey;

  const model = {
    id: ep.model, name: ep.model, api: ep.api, provider: 'rcd', baseUrl: ep.baseUrl,
    reasoning: reasoningSetup.piReasoning, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000, maxTokens: PI_MAX_TOKENS,
    compat: ep.api === 'openai-completions'
      ? { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: reasoningSetup.piReasoning, supportsStrictMode: true }
      : { supportsDeveloperRole: true, supportsStrictMode: true },
  } as unknown as Model<'openai-completions'>;
  const models = createModels();
  models.setProvider(createProvider({
    id: 'rcd', name: 'Clemson RCD', baseUrl: ep.baseUrl,
    auth: { apiKey: envApiKeyAuth('RCD', [keyVar]) },
    models: [model],
    api: ep.api === 'openai-completions' ? openAICompletionsApi() : openAIResponsesApi(),
  } as never));

  const toolCallsUsed: ToolCall[] = [];
  const controlEvents: string[] = [];
  const retrievedThisTurn = new Set<string>();
  const msgs = input.messages as Array<{ role: string; content: string | null }>;
  const history = citableFromHistory(msgs);
  const searchRule = needsMaterialSearch(input.userMessage, input.fileNames, previousQuestion(msgs));
  const forceSearchFirst = (input.requireSearchFirst ?? searchRule.required) && input.tools.some(t => t.name === 'search_materials');
  // Temperature only for campus models: OpenAI's gpt-6 reasoning models reject it (review I1).
  const temperature = ep.campusReasoning !== undefined || isCampusModel(ep.model) ? PI_TEMPERATURE : undefined;
  let citeRetries = 0;
  let sendBacks = 0;
  const maxSendBacks = input.maxSendBacks ?? 2;
  const customSubmit = input.submit;
  const submitSchema = customSubmit?.jsonSchema ?? submitTurnSchema();
  let final: unknown;
  let hasFinal = false;
  let requests = 0;
  let forceSubmit = false;
  const trace: string[] = [];

  const tools: AgentTool[] = input.tools.map(def => ({
    name: def.name,
    label: def.name,
    description: renderToolDescription(def),
    parameters: Type.Unsafe(z.toJSONSchema(def.inputSchema as z.ZodType) as Record<string, unknown>),
    executionMode: 'sequential',
    async execute(toolCallId: string, params: unknown) {
      const args = def.inputSchema.parse(params) as Record<string, unknown>;
      toolCallsUsed.push({ id: toolCallId, toolName: def.name, args });
      const result = await def.execute(args);
      chunkIdsInToolResult(result, retrievedThisTurn);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: {} };
    },
  }));

  tools.push({
    name: 'submit_turn',
    label: 'submit_turn',
    description: customSubmit?.description ?? 'Deliver this turn: the finding, the one question, the citations and readiness. Call last, once.',
    parameters: Type.Unsafe(submitSchema),
    // Pi 1.6 would turn a null string into the text "null" before validation; make it "" (and a null array []).
    prepareArguments: (args: unknown) => nullsToEmpty(args, submitSchema) as never,
    executionMode: 'sequential',
    async execute(_id: string, params: unknown) {
      if (customSubmit) {
        let parsedValue: unknown;
        try {
          parsedValue = customSubmit.parse(params);
        } catch (err) {
          controlEvents.push('reply did not match the response schema; sent back');
          throw new Error(`submit_turn arguments are invalid: ${err instanceof Error ? err.message.slice(0, 400) : String(err)}`);
        }
        const problem = input.checkSubmit?.(parsedValue) ?? null;
        if (problem && !forceSubmit && sendBacks < maxSendBacks) {
          sendBacks++;
          controlEvents.push(`submit check failed: ${problem.slice(0, 300)}; sent back`);
          throw new Error(problem);
        }
        if (problem) controlEvents.push('repeat-accepted');
        final = parsedValue;
        hasFinal = true;
        return { content: [{ type: 'text' as const, text: 'Turn delivered.' }], details: {}, terminate: true };
      }
      const repaired = repairCitations(params, msgs);
      if (JSON.stringify(repaired) !== JSON.stringify(params)) controlEvents.push('citations repaired');
      const parsed = AuditResponseSchema.safeParse(repaired);
      if (!parsed.success) {
        controlEvents.push('reply did not match the response schema; sent back');
        throw new Error(`submit_turn arguments are invalid: ${parsed.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      }
      let value = parsed.data;
      const problems = checkCitations(value, { retrievedThisTurn, history });
      if (problems.length && !forceSubmit && citeRetries < MAX_CITATION_RETRIES) {
        citeRetries++;
        controlEvents.push(`citation check failed: ${problems.join(' / ').slice(0, 300)}; sent back`);
        throw new Error(citationFollowUp(problems));
      }
      if (problems.length) {
        controlEvents.push(`citation check failed: ${problems.join(' / ').slice(0, 300)}; no retries left, ${problems.length} citation(s) dropped`);
        value = keepValidCitations(value, { retrievedThisTurn, history });
      }
      final = value;
      hasFinal = true;
      return { content: [{ type: 'text' as const, text: 'Turn delivered.' }], details: {}, terminate: true };
    },
  });

  // Every message before the last becomes the agent's starting transcript; the last one is the prompt.
  const toAgent = (m: Message): AgentMessage | null => {
    if (m.role === 'user') return { role: 'user', content: m.content, timestamp: Date.now() } as AgentMessage;
    if (m.role === 'assistant' && m.content) {
      return { role: 'assistant', content: [{ type: 'text', text: m.content }], api: ep.api, provider: 'rcd', model: ep.model, usage: ZERO_USAGE, stopReason: 'stop', timestamp: Date.now() } as AgentMessage;
    }
    return null;
  };
  const prior = input.messages.slice(0, -1).map(toAgent).filter((m): m is AgentMessage => m !== null);
  const last = input.messages[input.messages.length - 1];
  if (!last || last.role !== 'user' || typeof last.content !== 'string') throw new Error('last message must be the user turn');

  const toolChoice = (name?: string) => ep.api === 'openai-completions'
    ? (name ? { type: 'function', function: { name } } : 'required')
    : (name ? { type: 'function', name } : 'required');

  const agent = new Agent({
    initialState: {
      systemPrompt: input.systemPrompt + SUBMIT_INSTRUCTION,
      model,
      thinkingLevel: reasoningSetup.piReasoning ? (ep.reasoning ?? 'off') : 'off',
      tools,
      messages: prior,
    },
    toolExecution: 'sequential',
    // Stable per course so OpenAI's prompt cache reuses the shared prefix across requests.
    sessionId: `interview-${input.courseCode}`,
    streamFn: (m, ctx, opts) => {
      requests++;
      // Tool budget, or the context guard (Task 9c): past PI_INPUT_TOKEN_LIMIT a forced submit still has output room.
      if (toolCallsUsed.length >= maxToolCalls || estimateContextTokens(ctx as never).tokens >= PI_INPUT_TOKEN_LIMIT) forceSubmit = true;
      const forceSearch = requests === 1 && forceSearchFirst && !forceSubmit;
      if (forceSearch) controlEvents.push(`search required (${searchRule.reason ?? 'the exchange points at course files'}); forced on the first request`);
      const samplingParams = {
        ...(opts?.samplingParams ?? {}),
        ...reasoningSetup.samplingParams,
        ...(temperature !== undefined ? { temperature } : {}),
        tool_choice: toolChoice(forceSubmit ? 'submit_turn' : forceSearch ? 'search_materials' : undefined),
        parallel_tool_calls: false,
      };
      return models.streamSimple(m, ctx, { ...opts, maxTokens: PI_MAX_TOKENS, ...(temperature !== undefined ? { temperature } : {}), samplingParams } as never);
    },
    finishTurn: async ({ message }) => {
      trace.push(`req${requests}: ${message.stopReason}${message.errorMessage ? ' ' + message.errorMessage.slice(0, 160) : ''}`);
      if (message.stopReason === 'error' || message.stopReason === 'aborted') return;
      if (hasFinal) return { action: 'end' };
      if (requests >= maxToolCalls + 2 + Math.max(MAX_CITATION_RETRIES, maxSendBacks) * 2) return { action: 'end' };
      // Answered in plain text instead of calling a tool: ask again and force submit_turn.
      if (!message.content.some(c => c.type === 'toolCall')) {
        controlEvents.push('replied in text; forced submit_turn');
        forceSubmit = true;
        agent.followUp({ role: 'user', content: 'Deliver this turn now by calling submit_turn.', timestamp: Date.now() } as AgentMessage);
        return { action: 'continue' };
      }
      return undefined;
    },
  });

  // Chat-screen events: a banner per tool call; the reply's JSON as text-delta (the panel shows "Thinking…").
  // Always subscribed: Pi sends tool errors back to the model silently, so log them to controlEvents here.
  const unsubscribe = agent.subscribe((e: AgentEvent) => {
        if (e.type === 'tool_execution_end' && e.isError) {
          controlEvents.push(toolErrorEvent(e.toolName, e.result));
        }
        if (!input.onEvent) return;
        if (e.type === 'tool_execution_start' && e.toolName !== 'submit_turn') {
          input.onEvent!({ kind: 'tool-start', toolName: e.toolName, args: (e.args ?? {}) as Record<string, unknown> });
        } else if (e.type === 'message_update' && e.assistantMessageEvent.type === 'toolcall_delta' && e.assistantMessageEvent.delta) {
          // Only the reply (submit_turn) streams as text; other tools' arguments are not reply text.
          const part = (e.message as { content?: Array<{ type: string; name?: string }> }).content?.[e.assistantMessageEvent.contentIndex];
          if (part?.type === 'toolCall' && part.name === 'submit_turn') input.onEvent!({ kind: 'text-delta', delta: e.assistantMessageEvent.delta });
        }
      });
  try {
    await agent.prompt({ role: 'user', content: last.content, timestamp: Date.now() } as AgentMessage);
  } finally {
    unsubscribe();
  }
  if (agent.state.errorMessage) throw new Error(`pi: ${agent.state.errorMessage} | ${trace.join(' | ')}`);
  if (!hasFinal) throw new Error(`pi: no submit_turn after ${requests} request(s) | ${trace.join(' | ')}`);

  let uncached = 0, cached = 0, out = 0, writes = 0;
  for (const m of agent.state.messages.slice(prior.length)) {
    if ((m as { role: string }).role !== 'assistant') continue;
    const u = (m as { usage?: typeof ZERO_USAGE }).usage ?? ZERO_USAGE;
    // Cache writes are new input: counted once, inside uncached.
    uncached += u.input + u.cacheWrite; cached += u.cacheRead; out += u.output; writes += u.cacheWrite;
  }
  // uncached already includes the cache writes (counted once), so no separate cacheWrite term.
  const costUsdCents = priceUsdCents(ep.model, { freshInput: uncached, cachedInput: cached, output: out });
  return {
    value: final as T,
    toolCallsUsed,
    telemetry: { costUsdCents, durationMs: Date.now() - started, cachedTokens: cached, uncachedPromptTokens: uncached, completionTokens: out, cacheWriteTokens: writes },
    controlEvents,
    requests,
  };
}
