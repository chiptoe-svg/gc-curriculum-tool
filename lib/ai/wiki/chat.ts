/**
 * Streaming orchestrator for the curriculum-chat agent.
 *
 * Faculty-facing chat over the curriculum wiki. The agent reads pages via
 * the three navigation tools (`read_wiki` / `list_wiki` / `search_wiki`),
 * synthesizes an answer, and emits a structured `{ response, citations }`
 * value the UI renders.
 *
 * Mirror of `streamAuditAgent` shape so the route + UI can reuse the same
 * NDJSON event protocol. Yields:
 *   - `tool-start` when the model invokes a tool
 *   - `text-delta` as response text streams in
 *   - `final` when the structured response validates
 *   - `error` on failure
 *
 * No DB persistence — curriculum-chat conversations are ephemeral (the UI
 * holds the message list in client state). A future surface could persist
 * if needed, but the audit-chat persistence path is a separate concern.
 */

import { getProviderForFunction } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import type { Message, StreamEvent } from '@/lib/ai/tool-use-types';
import { buildCurriculumChatTools } from './tools';
import { buildCurriculumGraphTools } from './graph-tools';
import {
  CurriculumChatResponseSchema,
  CurriculumChatResponseJsonSchema,
  type CurriculumChatResponse,
} from './response-schema';

export interface CurriculumChatInput {
  /**
   * Optional starting context to prepend as a system note. Used by the
   * Explore "Ask" tab to anchor the agent on a specific course (the focused
   * course's wiki page + immediate neighbors). The /ask standalone surface
   * passes nothing.
   */
  anchorContext?: string;
  /** The conversation history. The final entry must be the user's latest turn. */
  messages: Message[];
}

export type CurriculumChatStreamEvent =
  | { kind: 'tool-start'; toolName: string; args: Record<string, unknown> }
  | { kind: 'text-delta'; delta: string }
  | { kind: 'final'; response: CurriculumChatResponse; toolCallsUsed: number }
  | { kind: 'error'; message: string };

export async function* streamCurriculumChat(
  input: CurriculumChatInput,
): AsyncGenerator<CurriculumChatStreamEvent, void, unknown> {
  let systemPrompt: string;
  try {
    systemPrompt = await loadPrompt('curriculum-chat');
  } catch (err) {
    yield { kind: 'error', message: err instanceof Error ? err.message : String(err) };
    return;
  }

  // Anchor context is prepended to the user's first message as an at-rest
  // note rather than to the system prompt. This keeps the system prompt
  // stable across surfaces (Explore tab vs future /ask) — only the
  // per-session anchor varies, and the model treats it as session metadata.
  const messages: Message[] = input.anchorContext
    ? prependAnchorContext(input.messages, input.anchorContext)
    : input.messages;

  const tools = [...buildCurriculumChatTools(), ...buildCurriculumGraphTools()];
  const provider = await getProviderForFunction('curriculum-chat');

  let finalValue: CurriculumChatResponse | null = null;
  let finalToolCallsUsed = 0;

  try {
    const stream = provider.streamWithTools<CurriculumChatResponse>({
      systemPrompt,
      messages,
      tools,
      schemaName: 'curriculum_chat_response',
      jsonSchema: CurriculumChatResponseJsonSchema as unknown as object,
      validate: raw => CurriculumChatResponseSchema.parse(raw),
      maxToolCalls: 6,
    });

    for await (const ev of stream as AsyncIterable<StreamEvent<CurriculumChatResponse>>) {
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
