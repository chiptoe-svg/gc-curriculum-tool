/**
 * Streaming orchestrator for the explore thinking-partner agent.
 *
 * Faculty-facing chat that lets professors explore hypothetical curriculum
 * changes for a specific course. The agent reads wiki pages, graph
 * structure, and search results via grounding tools, and runs impact
 * estimates + comparisons via the explore-specific tools. It emits
 * `scenario` and `comparison` stream events (rendered as cards in the UI)
 * just before the structured final response each turn.
 *
 * Mirrors `streamCurriculumChat` (`lib/ai/wiki/chat.ts`) exactly for the
 * provider loop. Three differences:
 *   1. Different prompt / function-id / tools.
 *   2. Adds `buildExploreTools` with an emit-closure that buffers
 *      `Scenario` / comparison payloads.
 *   3. Yields `scenario` / `comparison` stream events (draining the buffer
 *      at end-of-turn) so the future UI can render cards.
 *
 * Yields (in order):
 *   - `tool-start`    when the model invokes a tool
 *   - `text-delta`    as response text streams in
 *   - `scenario`      for each scenario estimated during this turn (after loop)
 *   - `comparison`    for each comparison run during this turn (after loop)
 *   - `final`         when the structured response validates
 *   - `error`         on failure
 */

import { getProviderForFunction } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import type { Message, StreamEvent } from '@/lib/ai/tool-use-types';
import { buildCurriculumChatTools } from '@/lib/ai/wiki/tools';
import { buildCurriculumGraphTools } from '@/lib/ai/wiki/graph-tools';
import { buildCurriculumSearchTools } from '@/lib/ai/wiki/curriculum-search-tool';
import { buildExploreTools, type ExploreEmit } from './agent-tools';
import type { Scenario } from './scenario';
import type { ScenarioComparison } from './compare';
import {
  ExploreAgentResponseSchema,
  ExploreAgentResponseJsonSchema,
  type ExploreAgentResponse,
} from './agent-response-schema';

export interface ExploreAgentInput {
  courseCode: string;
  anchorContext?: string;
  messages: Message[];
}

export type ExploreAgentStreamEvent =
  | { kind: 'tool-start'; toolName: string; args: Record<string, unknown> }
  | { kind: 'text-delta'; delta: string }
  | { kind: 'scenario'; scenario: Scenario }
  | { kind: 'comparison'; a: Scenario; b: Scenario; diff: ScenarioComparison }
  | { kind: 'final'; response: ExploreAgentResponse; toolCallsUsed: number }
  | { kind: 'error'; message: string };

/**
 * Pure helper: convert an array of ExploreEmit objects (buffered during the
 * provider turn) into ExploreAgentStreamEvents. Exported for unit testing.
 */
export function emittedToEvents(emitted: ExploreEmit[]): ExploreAgentStreamEvent[] {
  return emitted.map(e =>
    e.kind === 'scenario'
      ? { kind: 'scenario', scenario: e.scenario }
      : { kind: 'comparison', a: e.a, b: e.b, diff: e.diff }
  );
}

export async function* streamExploreAgent(
  input: ExploreAgentInput,
): AsyncGenerator<ExploreAgentStreamEvent, void, unknown> {
  let systemPrompt: string;
  try {
    systemPrompt = await loadPrompt('explore-agent');
  } catch (err) {
    yield { kind: 'error', message: err instanceof Error ? err.message : String(err) };
    return;
  }

  // Anchor context is prepended to the user's first message as an at-rest
  // note rather than to the system prompt. This keeps the system prompt
  // stable across surfaces — only the per-session anchor varies.
  const messages: Message[] = input.anchorContext
    ? prependAnchorContext(input.messages, input.anchorContext)
    : input.messages;

  // Buffer for scenario/comparison payloads emitted by explore tools during
  // the turn. Drained into stream events after the provider loop completes,
  // just before yielding the final structured response.
  const emitted: ExploreEmit[] = [];

  const tools = [
    ...buildCurriculumChatTools(),
    ...buildCurriculumGraphTools(),
    ...buildCurriculumSearchTools(),
    ...buildExploreTools(input.courseCode, e => emitted.push(e)),
  ];

  const provider = await getProviderForFunction('explore-agent');

  let finalValue: ExploreAgentResponse | null = null;
  let finalToolCallsUsed = 0;

  try {
    const stream = provider.streamWithTools<ExploreAgentResponse>({
      systemPrompt,
      messages,
      tools,
      schemaName: 'explore_agent_response',
      jsonSchema: ExploreAgentResponseJsonSchema as unknown as object,
      validate: raw => ExploreAgentResponseSchema.parse(raw),
      maxToolCalls: 8,
    });

    for await (const ev of stream as AsyncIterable<StreamEvent<ExploreAgentResponse>>) {
      if (ev.kind === 'tool-start') {
        yield { kind: 'tool-start', toolName: ev.toolName, args: ev.args };
      } else if (ev.kind === 'text-delta') {
        yield { kind: 'text-delta', delta: ev.delta };
      } else if (ev.kind === 'final') {
        finalValue = ev.value;
        finalToolCallsUsed = ev.toolCallsUsed.length;
      } else if (ev.kind === 'error') {
        yield { kind: 'error', message: ev.message };
        return;
      }
    }
  } catch (err) {
    yield { kind: 'error', message: err instanceof Error ? err.message : String(err) };
    return;
  }

  if (!finalValue) {
    yield { kind: 'error', message: 'stream ended without a final response' };
    return;
  }

  // Drain the emit buffer — scenario/comparison cards arrive just before the
  // turn's final response so the UI can render them before the prose answer.
  for (const ev of emittedToEvents(emitted)) {
    yield ev;
  }

  yield { kind: 'final', response: finalValue, toolCallsUsed: finalToolCallsUsed };
}

/**
 * Prepend the anchor context as a system-style preface to the first user
 * message in the conversation. Done this way (rather than as a separate
 * system message) so older providers that only accept one system message
 * still see the context.
 */
function prependAnchorContext(messages: Message[], context: string): Message[] {
  if (messages.length === 0) return messages;
  const first = messages[0]!;
  if (first.role !== 'user') return messages;
  const preface =
    `[System note — context the user is currently viewing. Treat this as background; ` +
    `the user's question follows.]\n\n${context}\n\n---\n\n`;
  return [
    { ...first, content: preface + first.content },
    ...messages.slice(1),
  ];
}
