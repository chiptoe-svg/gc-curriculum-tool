/**
 * A generic tool-using task on Pi: the model may call the given tools, then must
 * deliver its result by calling `submit` (parameters = submitSchema). Built for the
 * agents-vs-single-calls benchmark; runPiTurn (the live interview) is untouched.
 * Setup, streaming and the 16000-token cap follow runPiTurn.
 */
import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import type { Model } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { renderToolDescription, type ToolDefinition } from '@/lib/ai/tool-use-types';
import { isCampusModel } from '@/lib/ai/models';
import { costCredits, costUsdCents, type TokenCounts } from '@/lib/ai/prices';
import { PI_MAX_TOKENS, PI_TEMPERATURE, piReasoningSetup, type PiEndpoint } from './turn';
import { nullsToEmpty } from './controls';

export interface PiTaskInput {
  systemPrompt: string;
  userMessage: string;
  tools: ToolDefinition[];
  submitSchema: Record<string, unknown>;
  submitDescription: string;
  endpoint: PiEndpoint;
  /** Tool calls allowed before submit is forced (default 6). */
  maxToolCalls?: number;
  /** Aborts the run (the agent stops; runPiTask then throws). */
  signal?: AbortSignal;
}

export interface PiTaskResult<T> {
  value: T;
  toolCalls: Array<{ name: string; args: unknown }>;
  forcedSubmit: boolean;
  requests: number;
  tokens: TokenCounts;
  usdUnits: number;
  credits: number | null;
  ms: number;
}

const SUBMIT_INSTRUCTION = '\n\n# How to deliver\n\nDeliver your result by calling the `submit` tool. Never write the result as plain text. Call other tools first if you need them; call `submit` last, once.';

export async function runPiTask<T>(input: PiTaskInput): Promise<PiTaskResult<T>> {
  const started = Date.now();
  const { Agent } = await import('@earendil-works/pi-agent-core');
  const { createModels, createProvider, envApiKeyAuth } = await import('@earendil-works/pi-ai');
  const { openAICompletionsApi } = await import('@earendil-works/pi-ai/api/openai-completions.lazy');
  const { openAIResponsesApi } = await import('@earendil-works/pi-ai/api/openai-responses.lazy');
  const { Type } = await import('typebox');
  const maxToolCalls = input.maxToolCalls ?? 6;
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

  const temperature = ep.campusReasoning !== undefined || isCampusModel(ep.model) ? PI_TEMPERATURE : undefined;
  const toolCalls: Array<{ name: string; args: unknown }> = [];
  let final: { value: T } | undefined;
  let requests = 0;
  let forceSubmit = false;
  let lastRequestForced = false;
  const trace: string[] = [];

  const tools: AgentTool[] = input.tools.map(def => ({
    name: def.name,
    label: def.name,
    description: renderToolDescription(def),
    parameters: Type.Unsafe(z.toJSONSchema(def.inputSchema as z.ZodType) as Record<string, unknown>),
    executionMode: 'sequential',
    async execute(_id: string, params: unknown) {
      const args = def.inputSchema.parse(params) as Record<string, unknown>;
      toolCalls.push({ name: def.name, args });
      const result = await def.execute(args);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: {} };
    },
  }));
  tools.push({
    name: 'submit',
    label: 'submit',
    description: input.submitDescription,
    parameters: Type.Unsafe(input.submitSchema),
    // Pi 1.6 turns a null string into the text "null" before validation; keep 1.4's "" (and [] for arrays).
    prepareArguments: (args: unknown) => nullsToEmpty(args, input.submitSchema) as never,
    executionMode: 'sequential',
    async execute(_id: string, params: unknown) {
      final = { value: params as T };
      return { content: [{ type: 'text' as const, text: 'Delivered.' }], details: {}, terminate: true };
    },
  });

  const toolChoice = (name?: string) => ep.api === 'openai-completions'
    ? (name ? { type: 'function', function: { name } } : 'required')
    : (name ? { type: 'function', name } : 'required');

  const agent = new Agent({
    initialState: {
      systemPrompt: input.systemPrompt + SUBMIT_INSTRUCTION,
      model,
      thinkingLevel: reasoningSetup.piReasoning ? (ep.reasoning ?? 'off') : 'off',
      tools,
      messages: [],
    },
    toolExecution: 'sequential',
    streamFn: (m, ctx, opts) => {
      requests++;
      // Requests also bound the loop: calls that fail validation (or a submit that fails its schema) never reach toolCalls.
      if (toolCalls.length >= maxToolCalls || requests > maxToolCalls + 2) forceSubmit = true;
      lastRequestForced = forceSubmit;
      const samplingParams = {
        ...(opts?.samplingParams ?? {}),
        ...reasoningSetup.samplingParams,
        ...(temperature !== undefined ? { temperature } : {}),
        tool_choice: toolChoice(forceSubmit ? 'submit' : undefined),
        parallel_tool_calls: false,
      };
      return models.streamSimple(m, ctx, { ...opts, maxTokens: PI_MAX_TOKENS, ...(temperature !== undefined ? { temperature } : {}), samplingParams } as never);
    },
    finishTurn: async ({ message }) => {
      trace.push(`req${requests}: ${message.stopReason}${message.errorMessage ? ' ' + message.errorMessage.slice(0, 160) : ''}`);
      if (message.stopReason === 'error' || message.stopReason === 'aborted') return;
      if (final) return { action: 'end' };
      // A request that already forced submit and still produced no submit is the last one.
      if (lastRequestForced) return { action: 'end' };
      // Answered in plain text instead of calling a tool: ask again and force submit.
      if (!message.content.some(c => c.type === 'toolCall')) {
        forceSubmit = true;
        agent.followUp({ role: 'user', content: 'Deliver your result now by calling submit.', timestamp: Date.now() } as AgentMessage);
        return { action: 'continue' };
      }
      return undefined;
    },
  });

  // Pi's usage.input already excludes cache reads and writes, so the four counts are disjoint, as TokenCounts expects.
  const usageSoFar = () => {
    const tokens: TokenCounts = { freshInput: 0, cachedInput: 0, output: 0, cacheWrite: 0 };
    for (const m of agent.state.messages) {
      if ((m as { role: string }).role !== 'assistant') continue;
      const u = (m as { usage?: { input: number; output: number; cacheRead: number; cacheWrite: number } }).usage;
      if (!u) continue;
      tokens.freshInput += u.input; tokens.cachedInput += u.cacheRead; tokens.output += u.output; tokens.cacheWrite! += u.cacheWrite;
    }
    return { tokens, usdUnits: costUsdCents(ep.model, tokens) };
  };
  // A failed run still spent tokens; the caller records them from err.usage.
  const withUsage = (err: unknown): Error => {
    const e = err instanceof Error ? err : new Error(String(err));
    (e as Error & { usage?: ReturnType<typeof usageSoFar> }).usage = usageSoFar();
    return e;
  };

  const onAbort = () => agent.abort();
  if (input.signal?.aborted) onAbort(); else input.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await agent.prompt({ role: 'user', content: input.userMessage, timestamp: Date.now() } as AgentMessage);
  } catch (err) {
    throw withUsage(err);
  } finally {
    input.signal?.removeEventListener('abort', onAbort);
  }
  if (input.signal?.aborted) throw withUsage(new Error('pi: aborted'));
  if (agent.state.errorMessage) throw withUsage(new Error(`pi: ${agent.state.errorMessage} | ${trace.join(' | ')}`));
  if (!final) throw withUsage(new Error(`pi: no submit after ${requests} request(s) | ${trace.join(' | ')}`));

  const { tokens, usdUnits } = usageSoFar();
  return {
    value: final.value,
    toolCalls,
    forcedSubmit: forceSubmit,
    requests,
    tokens,
    usdUnits,
    credits: isCampusModel(ep.model) ? 0 : costCredits(ep.model, tokens),
    ms: Date.now() - started,
  };
}
