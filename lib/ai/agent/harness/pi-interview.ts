/**
 * Interviewer turn on Pi (pi-agent-core, in-process), harness spike 2026-10-28.
 *
 * Same inputs as the live loop (buildAgentCall's system prompt, messages and
 * tools), different engine:
 *   - our ToolDefinitions become Pi AgentTools (in-process functions, no MCP);
 *   - the reply is a submit_turn tool call whose parameters are the
 *     AuditResponse schema, so the fixed format does not depend on a JSON mode;
 *   - tool_choice is "required" on every request, and submit_turn is forced
 *     once the tool budget is spent (via pi-ai samplingParams, merged into the
 *     request body);
 *   - controls (controls.ts) run inside submit_turn: a failed check throws, Pi
 *     reports it to the model as a tool error, and the loop continues.
 */
// Pi ships ESM only ("import" export condition), so its runtime modules are
// loaded with import() inside runPiTurn; scripts run under tsx as CommonJS.
import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import type { Model } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { AuditResponseJsonSchema, AuditResponseSchema, type AuditResponse } from '@/lib/ai/agent/audit-response-schema';
import { renderToolDescription, type Message, type ToolCall, type ToolDefinition } from '@/lib/ai/tool-use-types';
import type { CompletionTelemetry } from '@/lib/ai/provider';
import {
  MATERIAL_TOOLS, MAX_CONTROL_RETRIES, MAX_CITATION_RETRIES, MAX_SEARCH_RETRIES, checkCitations, keepValidCitations, chunkIdsInToolResult, citableFromHistory,
  controlFollowUp, needsMaterialSearch, previousQuestion,
} from './controls';

export interface LoopEndpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
  api: 'openai-completions' | 'openai-responses';
  reasoning?: 'low' | 'medium' | 'high';
}

export interface LoopTurnInput {
  systemPrompt: string;
  messages: Message[];
  tools: ToolDefinition[];
  /** The instructor's answer this turn (undefined on the opening turn). */
  userMessage?: string;
  /** Course code (the Codex loop starts its MCP tool server for this course). */
  courseCode?: string;
  /** Included course file names, for the search trigger. */
  fileNames: string[];
  endpoint: LoopEndpoint;
  maxToolCalls?: number;
  controls: boolean;
}

export interface LoopTurnResult {
  value: AuditResponse;
  toolCallsUsed: ToolCall[];
  telemetry: CompletionTelemetry;
  /** What the controls did this turn, in order. */
  controlEvents: string[];
  requests: number;
}

export const SUBMIT_INSTRUCTION = '\n\n# How to deliver each turn\n\nDeliver your turn by calling the `submit_turn` tool with the fields of the structured per-turn response (finding, question, citations, readiness). Never write the answer as plain text. Call other tools first if you need them; call `submit_turn` last, once.';

const ZERO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

export async function runPiTurn(input: LoopTurnInput): Promise<LoopTurnResult> {
  const started = Date.now();
  const { Agent } = await import('@earendil-works/pi-agent-core');
  const { createModels, createProvider, envApiKeyAuth } = await import('@earendil-works/pi-ai');
  const { openAICompletionsApi } = await import('@earendil-works/pi-ai/api/openai-completions.lazy');
  const { openAIResponsesApi } = await import('@earendil-works/pi-ai/api/openai-responses.lazy');
  const { Type } = await import('typebox');
  const maxToolCalls = input.maxToolCalls ?? 4;
  const ep = input.endpoint;
  const keyVar = 'PI_SPIKE_API_KEY';
  process.env[keyVar] = ep.apiKey;

  const model = {
    id: ep.model, name: ep.model, api: ep.api, provider: 'rcd', baseUrl: ep.baseUrl,
    reasoning: Boolean(ep.reasoning), input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000, maxTokens: 16000,
    compat: ep.api === 'openai-completions'
      ? { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: Boolean(ep.reasoning), supportsStrictMode: process.env.HARNESS_STRICT !== '0' }
      : { supportsDeveloperRole: true, supportsStrictMode: process.env.HARNESS_STRICT !== '0' },
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
  const history = citableFromHistory(input.messages as Array<{ role: string; content: string | null }>);
  const searchRule = input.controls ? needsMaterialSearch(input.userMessage, input.fileNames, previousQuestion(input.messages as Array<{ role: string; content: string | null }>)) : { required: false };
  let searchRetries = 0;
  let citeRetries = 0;
  let final: AuditResponse | undefined;
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
    description: 'Deliver this turn: the finding, the one question, the citations and readiness. Call last, once.',
    parameters: Type.Unsafe(AuditResponseJsonSchema as unknown as Record<string, unknown>),
    executionMode: 'sequential',
    async execute(_id: string, params: unknown) {
      trace.push(`submit_turn called (final already set: ${Boolean(final)})`);
      const parsed = AuditResponseSchema.safeParse(params);
      if (!parsed.success) {
        controlEvents.push('reply did not match the response schema; sent back');
        throw new Error(`submit_turn arguments are invalid: ${parsed.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      }
      let value = parsed.data;
      if (input.controls && !forceSubmit && searchRetries < MAX_SEARCH_RETRIES && searchRule.required && !toolCallsUsed.some(t => MATERIAL_TOOLS.has(t.toolName))) {
        searchRetries++;
        controlEvents.push(`search required (${searchRule.reason}); sent back`);
        throw new Error(controlFollowUp('search', searchRule.reason!));
      }
      if (input.controls) {
        const problems = checkCitations(value, { retrievedThisTurn, history });
        if (problems.length && !forceSubmit && citeRetries < MAX_CITATION_RETRIES) {
          citeRetries++;
          controlEvents.push(`citation check failed: ${problems.join(' / ').slice(0, 300)}; sent back`);
          throw new Error(controlFollowUp('citations', problems));
        }
        if (problems.length) {
          controlEvents.push(`citation check failed: ${problems.join(' / ').slice(0, 300)}; no retries left, ${problems.length} citation(s) dropped`);
          value = keepValidCitations(value, { retrievedThisTurn, history });
        }
      }
      final = value;
      trace.push('submit_turn accepted');
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
  if (!last || last.role !== 'user') throw new Error('last message must be the user turn');

  const toolChoice = (name?: string) => ep.api === 'openai-completions'
    ? (name ? { type: 'function', function: { name } } : 'required')
    : (name ? { type: 'function', name } : 'required');

  const agent = new Agent({
    initialState: {
      systemPrompt: input.systemPrompt + SUBMIT_INSTRUCTION,
      model,
      thinkingLevel: ep.reasoning ?? 'off',
      tools,
      messages: prior,
    },
    toolExecution: 'sequential',
    // Stable per course so OpenAI's prompt cache (prompt_cache_key) reuses the shared prefix across requests.
    sessionId: `interview-${input.courseCode ?? 'course'}`,
    // Record tool calls Pi itself rejected (argument validation) — they cost a request but never reach our code.
    afterToolCall: async ({ toolCall, isError, result }) => {
      if (isError && toolCall.name === 'submit_turn' && !controlEvents.some(e => e.endsWith('sent back') && e.length && false)) {
        const text = (result.content?.[0] as { text?: string } | undefined)?.text ?? '';
        if (!/^Before answering|^Your answer has citation/.test(text) && !/submit_turn arguments are invalid/.test(text)) controlEvents.push(`submit_turn rejected by Pi: ${text.slice(0, 160)}`);
      }
      return undefined;
    },
    streamFn: (m, ctx, opts) => {
      requests++;
      // Budget spent (tool calls so far ≥ max): the next request must deliver.
      if (toolCallsUsed.length >= maxToolCalls) forceSubmit = true;
      const samplingParams = { ...(opts?.samplingParams ?? {}), tool_choice: toolChoice(forceSubmit ? 'submit_turn' : undefined), parallel_tool_calls: false };
      return models.streamSimple(m, ctx, { ...opts, samplingParams } as never);
    },
    finishTurn: async ({ message }) => {
      trace.push(`req${requests}: ${message.stopReason}${message.errorMessage ? ' ' + message.errorMessage.slice(0, 160) : ''} [${message.content.map(c => c.type === 'toolCall' ? 'call:' + c.name : c.type === 'text' ? 'text:' + c.text.slice(0, 60).replace(/\s+/g, ' ') : c.type).join(', ')}]`);
      if (message.stopReason === 'error' || message.stopReason === 'aborted') return;
      if (final) return { action: 'end' };
      if (requests >= maxToolCalls + 2 + MAX_CONTROL_RETRIES * 2) return { action: 'end' };
      // Answered in plain text instead of calling a tool: ask again and force submit_turn.
      if (!message.content.some(c => c.type === 'toolCall')) {
        // A search is still owed: say so instead of forcing submit_turn, which would skip the check.
        if (searchRule.required && !toolCallsUsed.some(t => MATERIAL_TOOLS.has(t.toolName)) && searchRetries < MAX_SEARCH_RETRIES) {
          searchRetries++;
          controlEvents.push(`replied in text; search required (${searchRule.reason}); sent back`);
          agent.followUp({ role: 'user', content: controlFollowUp('search', searchRule.reason!) + ' Then deliver the turn by calling submit_turn.', timestamp: Date.now() } as AgentMessage);
          return { action: 'continue' };
        }
        controlEvents.push('replied in text; forced submit_turn');
        forceSubmit = true;
        agent.followUp({ role: 'user', content: 'Deliver this turn now by calling submit_turn.', timestamp: Date.now() } as AgentMessage);
        return { action: 'continue' };
      }
      return undefined;
    },
  });

  await agent.prompt({ role: 'user', content: last.content, timestamp: Date.now() } as AgentMessage);
  if (agent.state.errorMessage) throw new Error(`pi: ${agent.state.errorMessage} | ${trace.join(' | ')}`);
  if (!final) throw new Error(`pi: no submit_turn after ${requests} request(s) | ${trace.join(' | ')}`);
  for (const m of agent.state.messages.slice(prior.length) as Array<{ role: string; isError?: boolean; toolName?: string; content?: Array<{ text?: string }> }>) {
    if (m.role === 'toolResult' && m.isError) trace.push(`tool error ${m.toolName}: ${(m.content?.[0]?.text ?? '').replace(/\s+/g, ' ').slice(0, 400)}`);
  }
  if (process.env.HARNESS_TRACE) controlEvents.push(...trace);

  let uncached = 0, cached = 0, out = 0;
  for (const m of agent.state.messages.slice(prior.length)) {
    if ((m as { role: string }).role === 'assistant') {
      const u = (m as { usage?: typeof ZERO_USAGE }).usage ?? ZERO_USAGE;
      uncached += u.input; cached += u.cacheRead; out += u.output;
    }
  }
  return {
    value: final,
    toolCallsUsed,
    telemetry: { costUsdCents: 0, durationMs: Date.now() - started, cachedTokens: cached, uncachedPromptTokens: uncached, completionTokens: out },
    controlEvents,
    requests,
  };
}
