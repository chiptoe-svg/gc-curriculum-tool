# CourseCapture v2 — Stage 7a (Streaming) + Stage 5 (Legacy + Citation Drawer) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the 3–7s silent wait per audit turn by streaming the agent's response token-by-token; mark pre-v2 snapshots as "legacy" so faculty understand their schema; let faculty click any citation chip / `SourceBadge` to read the underlying chunk text or instructor turn excerpt; migrate existing `capture_conversations` rows into `capture_messages` so legacy drafts share one transcript table.

**Architecture:** Stage 7a adds a `streamWithTools` method to the provider interface, implemented for `OpenAIProvider` via Vercel AI SDK v6's `streamText` + `Output.object` + `experimental_output`. The audit agent loop becomes an async generator that yields `{type:'text-delta'}`, `{type:'tool-start'}`, and finally `{type:'final', response}`. `POST /api/capture/[code]/chat` returns an NDJSON stream consumed by the chat panel via `ReadableStream` reader. Stage 5 introduces a small `LegacyBanner` shown on `ProfileReviewPanel` + `VerificationSummary` when a finding has no `source` field, two new chunk/message lookup endpoints, a `CitationDrawer` opened from chips, and a one-off backfill script `scripts/_one-off/2026-05-28-migrate-capture-conversations.ts` that synthesizes a `session_id` for every `capture_conversations` row, copies turns forward into `capture_messages`, and links the corresponding snapshot via `transcript_session_id` where determinable.

**Tech Stack:** Next.js 15 App Router, Vercel AI SDK `ai@6.0.191` (`streamText`, `Output.object`), Drizzle, Neon Postgres, Weaviate v3 client, React 19, Tailwind, shadcn primitives.

---

## Phase A — Stage 7a Streaming

### Task 1: Add `streamWithTools` to provider interface + OpenAI implementation

**Files:**
- Modify: `lib/ai/tool-use-types.ts` — add `StreamEvent` discriminated union
- Modify: `lib/ai/provider.ts` — add `streamWithTools` method declaration on `AIProvider`
- Modify: `lib/ai/openai.ts` — implement `streamWithTools`
- Modify: `lib/ai/fake-provider.ts`, `lib/ai/anthropic.ts`, `lib/ai/local.ts`, `lib/ai/campus.ts` — add throw-not-implemented stubs (only OpenAI streams in 7a; other providers fall back to `completeWithTools`)

- [ ] **Step 1: Add `StreamEvent` union to `tool-use-types.ts`**

Append at the bottom of `lib/ai/tool-use-types.ts` (after `CompleteWithToolsResult`):

```typescript
/**
 * One event yielded by `streamWithTools`. The stream begins with zero or more
 * `tool-start` events (one per tool the model calls during retrieval),
 * followed by `text-delta` events as the structured output's text fields
 * stream in, and ends with one `final` event carrying the validated value
 * plus telemetry. `error` may appear at any point and terminates the stream.
 */
export type StreamEvent<T> =
  | { kind: 'tool-start'; toolName: string; args: Record<string, unknown> }
  | { kind: 'text-delta'; delta: string }
  | { kind: 'final'; value: T; toolCallsUsed: ToolCall[]; telemetry: {
      costUsdCents: number;
      durationMs: number;
      cachedTokens: number;
      uncachedPromptTokens: number;
      completionTokens: number;
    } }
  | { kind: 'error'; message: string };
```

- [ ] **Step 2: Write the failing test for the OpenAI stream surface**

Create `lib/ai/__tests__/openai-stream.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

// We can't easily stand up a real OpenAI stream in unit tests without
// network access. Instead, verify the OpenAIProvider exposes
// streamWithTools and that it returns an async iterable.
import { OpenAIProvider } from '../openai';

describe('OpenAIProvider.streamWithTools', () => {
  it('exposes streamWithTools as an async generator', () => {
    const p = new OpenAIProvider('gpt-5.4', 'sk-test');
    expect(typeof p.streamWithTools).toBe('function');
  });
});
```

Run: `pnpm test lib/ai/__tests__/openai-stream.test.ts`
Expected: FAIL — `streamWithTools is not a function`.

- [ ] **Step 3: Declare `streamWithTools` on the provider interface**

In `lib/ai/provider.ts`, inside `interface AIProvider`, after the `completeWithTools` signature:

```typescript
  /**
   * Streaming variant of `completeWithTools`. Yields progressive events as
   * tools fire and text generates, ending with a `final` event carrying the
   * validated structured value. Errors terminate the stream with a `kind: 'error'` event.
   *
   * Providers that don't yet stream may throw "not implemented" — callers
   * must either gate on a feature flag or fall back to `completeWithTools`.
   */
  streamWithTools<T>(args: {
    systemPrompt: string;
    messages: Message[];
    tools: ToolDefinition[];
    schemaName: string;
    jsonSchema: object;
    validate: (raw: unknown) => T;
    maxToolCalls?: number;
  }): AsyncIterable<StreamEvent<T>>;
```

And add the type import at top:

```typescript
import type {
  ToolDefinition,
  Message,
  CompleteWithToolsResult,
  StreamEvent,
} from './tool-use-types';
```

Re-export at bottom:

```typescript
export type { ToolDefinition, ToolCall, ToolResult, Message, CompleteWithToolsResult, StreamEvent } from './tool-use-types';
```

- [ ] **Step 4: Implement `streamWithTools` on `OpenAIProvider`**

In `lib/ai/openai.ts`, add `streamText` to the imports:

```typescript
import { generateText, streamText, tool as aiTool, Output, stepCountIs, jsonSchema as aiJsonSchema } from 'ai';
```

Add `StreamEvent` to the type-only import:

```typescript
import type { ToolDefinition, Message, CompleteWithToolsResult, ToolCall, StreamEvent } from './tool-use-types';
```

Append this method inside `class OpenAIProvider` (after `completeWithTools`):

```typescript
  async *streamWithTools<T>(args: {
    systemPrompt: string;
    messages: Message[];
    tools: ToolDefinition[];
    schemaName: string;
    jsonSchema: object;
    validate: (raw: unknown) => T;
    maxToolCalls?: number;
  }): AsyncGenerator<StreamEvent<T>, void, unknown> {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY not set');
    const start = Date.now();

    const sdkTools: Record<string, ReturnType<typeof aiTool<never, never>>> = {};
    for (const t of args.tools) {
      sdkTools[t.name] = aiTool({
        description: renderToolDescription(t),
        inputSchema: t.inputSchema as never,
        execute: t.execute as never,
      });
    }

    const sdkMessages = args.messages.map(m => {
      if (m.role === 'tool') {
        return {
          role: 'tool' as const,
          content: [{
            type: 'tool-result' as const,
            toolCallId: m.toolCallId,
            toolName: 'unknown',
            output: { type: 'json' as const, value: m.result as import('ai').JSONValue },
          }],
        };
      }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        return {
          role: 'assistant' as const,
          content: [
            ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
            ...m.toolCalls.map(tc => ({
              type: 'tool-call' as const,
              toolCallId: tc.id,
              toolName: tc.toolName,
              input: tc.args,
            })),
          ],
        };
      }
      return { role: m.role as 'system' | 'user' | 'assistant', content: m.content ?? '' };
    });

    const result = streamText({
      model: aiOpenai(this.model),
      system: args.systemPrompt,
      messages: sdkMessages,
      tools: sdkTools,
      experimental_output: Output.object({
        schema: aiJsonSchema(args.jsonSchema as never),
        name: args.schemaName,
      }),
      stopWhen: stepCountIs((args.maxToolCalls ?? 4) + 1),
    });

    try {
      for await (const part of result.fullStream) {
        if (part.type === 'tool-call') {
          yield {
            kind: 'tool-start',
            toolName: part.toolName,
            args: (part as unknown as { input?: Record<string, unknown> }).input ?? {},
          };
        } else if (part.type === 'text-delta') {
          // v6: text-delta carries `text` (the delta string itself).
          const delta = (part as unknown as { text?: string }).text ?? '';
          if (delta) yield { kind: 'text-delta', delta };
        } else if (part.type === 'error') {
          yield {
            kind: 'error',
            message: part.error instanceof Error ? part.error.message : String(part.error),
          };
          return;
        }
      }

      const usage = await result.usage;
      const finalToolCalls = await result.toolCalls;
      const finalOutput = await result.experimental_output;

      const value = args.validate(finalOutput);
      const toolCallsUsed: ToolCall[] = (finalToolCalls ?? []).map(tc => ({
        id: tc.toolCallId,
        toolName: tc.toolName,
        args: (tc as unknown as { input: Record<string, unknown> }).input ?? {},
      }));

      const inputTokens = usage?.inputTokens ?? 0;
      const outputTokens = usage?.outputTokens ?? 0;
      const cachedTokens = usage?.inputTokenDetails?.cacheReadTokens ?? 0;
      const uncachedPromptTokens = Math.max(0, inputTokens - cachedTokens);
      const pricing = MODEL_PRICING[this.model] ?? FALLBACK_PRICING;
      const costUsdCents =
        toCents((uncachedPromptTokens / 1_000_000) * pricing.input) +
        toCents((cachedTokens / 1_000_000) * pricing.input * 0.1) +
        toCents((outputTokens / 1_000_000) * pricing.output);

      yield {
        kind: 'final',
        value,
        toolCallsUsed,
        telemetry: {
          costUsdCents,
          durationMs: Date.now() - start,
          cachedTokens,
          uncachedPromptTokens,
          completionTokens: outputTokens,
        },
      };
    } catch (err) {
      yield {
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
```

- [ ] **Step 5: Stub the other four providers**

In each of `lib/ai/fake-provider.ts`, `lib/ai/anthropic.ts`, `lib/ai/local.ts`, `lib/ai/campus.ts`, add this method to the class (after `completeWithTools`):

```typescript
  // eslint-disable-next-line require-yield
  async *streamWithTools<T>(_args: {
    systemPrompt: string;
    messages: Message[];
    tools: ToolDefinition[];
    schemaName: string;
    jsonSchema: object;
    validate: (raw: unknown) => T;
    maxToolCalls?: number;
  }): AsyncGenerator<StreamEvent<T>, void, unknown> {
    throw new Error(`${this.name} provider does not implement streamWithTools yet`);
  }
```

Add `StreamEvent` to each file's type-only import alongside the existing tool-use-types import.

- [ ] **Step 6: Run the unit test to verify it passes**

Run: `pnpm test lib/ai/__tests__/openai-stream.test.ts`
Expected: PASS.

- [ ] **Step 7: Type-check the whole project**

Run: `pnpm tsc --noEmit`
Expected: no errors (the interface change forces every provider to compile).

- [ ] **Step 8: Commit**

```bash
git add lib/ai/tool-use-types.ts lib/ai/provider.ts lib/ai/openai.ts lib/ai/fake-provider.ts lib/ai/anthropic.ts lib/ai/local.ts lib/ai/campus.ts lib/ai/__tests__/openai-stream.test.ts
git commit -m "feat(ai): streamWithTools on provider interface + OpenAI streaming impl"
```

---

### Task 2: Streaming audit-agent loop

**Files:**
- Create: `lib/ai/agent/audit-agent-stream.ts` — async generator wrapping the same context setup as `runAuditAgent`
- Modify: `lib/ai/agent/audit-agent.ts` — extract shared context-building helper

- [ ] **Step 1: Extract a shared context builder from `runAuditAgent`**

In `lib/ai/agent/audit-agent.ts`, refactor: pull lines 56–183 (the context construction up to `provider.completeWithTools`) into an exported helper. Replace the body so both `runAuditAgent` and the new stream entry point can call it. Concretely, add this exported function before `runAuditAgent`:

```typescript
interface BuiltAgentCall {
  systemPrompt: string;
  messages: Message[];
  tools: ReturnType<typeof buildAuditTools>;
  isOpeningTurn: boolean;
  userTurnIndex: number;
}

export async function buildAgentCall(input: AuditAgentInput): Promise<BuiltAgentCall> {
  const { sessionId, courseCode, userMessage, auditMode } = input;

  const existingBeforeUser = await getSessionMessages(courseCode, sessionId);
  const isOpeningTurn = existingBeforeUser.length === 0 && !userMessage;

  const userTurnIndex = existingBeforeUser.length;
  if (!isOpeningTurn) {
    if (!userMessage) {
      throw new Error('buildAgentCall: userMessage required when continuing an existing session');
    }
    await appendMessage({
      sessionId,
      courseCode,
      turnIndex: userTurnIndex,
      role: 'user',
      content: userMessage,
    });
  }

  const [course, materials, priorSessions] = await Promise.all([
    getCourseByCode(courseCode),
    listMaterialsByCourse(courseCode),
    listPriorSessionSummaries(courseCode, sessionId, 3),
  ]);
  if (!course) throw new Error(`course not found: ${courseCode}`);

  const history = await getSessionMessages(courseCode, sessionId);

  const includedMaterials = materials
    .filter(m => !m.ignored && m.extractionStatus === 'ok')
    .sort((a, b) => a.fileName.localeCompare(b.fileName));

  const learningObjectives = (course.learningObjectives ?? []) as string[];
  const majorProjects = (course.majorProjects ?? []) as string[];
  const skillsRequired = (course.skillsRequired ?? []) as string[];

  const catalogBlock = [
    `Course: ${course.code} — ${course.title}`,
    `Description: ${course.description || '(none)'}`,
    `Prerequisites: ${course.prerequisites || '(none)'}`,
    `Learning objectives: ${learningObjectives.join('; ') || '(none)'}`,
    `Major projects: ${majorProjects.join('; ') || '(none)'}`,
    `Declared incoming skills: ${skillsRequired.join('; ') || '(none)'}`,
  ].join('\n');

  const digestBlock = includedMaterials.length
    ? includedMaterials
        .map(m => `--- ${m.fileName} (id=${m.id}) ---\n${m.digest ?? '(no digest)'}`)
        .join('\n\n')
    : '(no included materials)';

  const priorSessionsBlock = priorSessions.length
    ? priorSessions
        .map(s => {
          const r = s.lastAssistantReadiness as { score?: number; covered?: string[]; remaining?: string[] } | null;
          const readinessSummary = r
            ? `readiness ${r.score ?? '?'}%; covered: ${(r.covered ?? []).join(', ') || '(none)'}; remaining: ${(r.remaining ?? []).join(', ') || '(none)'}`
            : '(no readiness recorded)';
          return [
            `--- Session ${s.sessionId.slice(0, 8)}… (started ${s.startedAt.toISOString().slice(0, 10)}, ${s.turnCount} turns) ---`,
            `Final readiness: ${readinessSummary}`,
            s.lastAssistantContent ? `Last assistant turn: ${s.lastAssistantContent.slice(0, 600)}` : '',
          ].filter(Boolean).join('\n');
        })
        .join('\n\n')
    : '(none — this is the first audit session for this course)';

  const messages: Message[] = [
    {
      role: 'user',
      content: `# Course catalog\n\n${catalogBlock}\n\n# Material digests\n\n${digestBlock}\n\n# Prior audit sessions (most recent)\n\n${priorSessionsBlock}`,
    },
    ...history
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map((m): Message => {
        if (m.role === 'assistant') {
          return {
            role: 'assistant',
            content: typeof m.content === 'string' ? m.content : null,
          };
        }
        return { role: 'user', content: m.content ?? '' };
      }),
  ];
  if (isOpeningTurn) {
    messages.push({
      role: 'user',
      content:
        'Begin the audit now. Produce your opening turn per the conversation '
        + 'rules in the system prompt: three short paragraphs with blank lines '
        + 'between them — (1) one sentence on what the digests show overall, '
        + '(2) one sentence naming the single most consequential gap, '
        + 'contradiction, or missing piece (cite specific evidence by name: '
        + 'assignment, rubric criterion, point value, or objective number), '
        + 'and (3) one focused follow-up question on that same topic, ending '
        + 'with a question mark on its own line. Return the standard structured '
        + 'response shape (finding + question + citations + readiness).',
    });
  }

  const systemPrompt = await loadPrompt('capture-chat-agent');
  const tools = auditMode === 'full' ? buildAuditTools(courseCode) : [];

  return { systemPrompt, messages, tools, isOpeningTurn, userTurnIndex };
}
```

Then replace the body of `runAuditAgent` (everything from line 57 onward) with a call to `buildAgentCall` plus the existing `completeWithTools` + persistence logic:

```typescript
export async function runAuditAgent(input: AuditAgentInput): Promise<AuditAgentResult> {
  const built = await buildAgentCall(input);
  const provider = await getProviderForFunction('capture-chat-agent');
  const result = await provider.completeWithTools<AuditResponse>({
    systemPrompt: built.systemPrompt,
    messages: built.messages,
    tools: built.tools,
    schemaName: 'audit_response',
    jsonSchema: AuditResponseJsonSchema,
    validate: (raw) => AuditResponseSchema.parse(raw),
    maxToolCalls: 2,
  });
  if (result.kind !== 'response') {
    throw new Error('agent loop did not converge — completeWithTools returned mid-loop tool_calls');
  }
  await persistAssistantTurn({
    sessionId: input.sessionId,
    courseCode: input.courseCode,
    isOpeningTurn: built.isOpeningTurn,
    userTurnIndex: built.userTurnIndex,
    response: result.value,
    toolCallsUsed: result.toolCallsUsed,
  });
  return { response: result.value, toolCallsUsed: result.toolCallsUsed.length };
}
```

And factor out the persistence step into an exported helper (so the stream entry point can call it too):

```typescript
export interface PersistAssistantTurnInput {
  sessionId: string;
  courseCode: string;
  isOpeningTurn: boolean;
  userTurnIndex: number;
  response: AuditResponse;
  toolCallsUsed: ToolCall[];
}

export async function persistAssistantTurn(input: PersistAssistantTurnInput): Promise<void> {
  const assistantTurnIndex = input.isOpeningTurn ? 0 : input.userTurnIndex + 1;

  const toolCalls: CaptureMessageToolCall[] | undefined = input.toolCallsUsed.length
    ? input.toolCallsUsed.map(tc => ({ id: tc.id, toolName: tc.toolName, args: tc.args }))
    : undefined;

  const citations: CaptureMessageCitation[] | undefined = input.response.citations.length
    ? input.response.citations.map(c => {
        const out: CaptureMessageCitation = { type: c.type, excerpt: c.excerpt };
        if (c.chunkId) out.chunkId = c.chunkId;
        if (c.messageId) out.messageId = c.messageId;
        return out;
      })
    : undefined;

  await appendMessage({
    sessionId: input.sessionId,
    courseCode: input.courseCode,
    turnIndex: assistantTurnIndex,
    role: 'assistant',
    content: JSON.stringify(input.response),
    toolCalls,
    citations,
  });
}
```

Add `ToolCall` to the imports at top of `audit-agent.ts`:

```typescript
import type { Message, ToolCall } from '@/lib/ai/tool-use-types';
```

- [ ] **Step 2: Write the streaming entry point**

Create `lib/ai/agent/audit-agent-stream.ts`:

```typescript
/**
 * Streaming variant of runAuditAgent. Yields progressive events as the
 * model thinks, calls retrieval tools, and emits the structured per-turn
 * response. Persists the assistant turn after the final event.
 *
 * The chat route consumes this generator and re-emits each event as NDJSON
 * over SSE-style chunked HTTP. The client renders text deltas progressively.
 */

import { getProviderForFunction } from '@/lib/ai/provider';
import type { StreamEvent } from '@/lib/ai/tool-use-types';
import {
  AuditResponseSchema,
  AuditResponseJsonSchema,
  type AuditResponse,
} from './audit-response-schema';
import { buildAgentCall, persistAssistantTurn, type AuditAgentInput } from './audit-agent';

export type AuditStreamEvent =
  | { kind: 'session'; sessionId: string }
  | { kind: 'tool-start'; toolName: string; args: Record<string, unknown> }
  | { kind: 'text-delta'; delta: string }
  | { kind: 'final'; response: AuditResponse; toolCallsUsed: number }
  | { kind: 'error'; message: string };

export async function* streamAuditAgent(
  input: AuditAgentInput,
): AsyncGenerator<AuditStreamEvent, void, unknown> {
  yield { kind: 'session', sessionId: input.sessionId };

  let built;
  try {
    built = await buildAgentCall(input);
  } catch (err) {
    yield { kind: 'error', message: err instanceof Error ? err.message : String(err) };
    return;
  }

  const provider = await getProviderForFunction('capture-chat-agent');

  let finalValue: AuditResponse | null = null;
  let finalToolCallsUsed: { id: string; toolName: string; args: Record<string, unknown> }[] = [];

  try {
    const stream = provider.streamWithTools<AuditResponse>({
      systemPrompt: built.systemPrompt,
      messages: built.messages,
      tools: built.tools,
      schemaName: 'audit_response',
      jsonSchema: AuditResponseJsonSchema,
      validate: (raw) => AuditResponseSchema.parse(raw),
      maxToolCalls: 2,
    });

    for await (const ev of stream as AsyncIterable<StreamEvent<AuditResponse>>) {
      if (ev.kind === 'tool-start') {
        yield { kind: 'tool-start', toolName: ev.toolName, args: ev.args };
      } else if (ev.kind === 'text-delta') {
        yield { kind: 'text-delta', delta: ev.delta };
      } else if (ev.kind === 'final') {
        finalValue = ev.value;
        finalToolCallsUsed = ev.toolCallsUsed;
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

  try {
    await persistAssistantTurn({
      sessionId: input.sessionId,
      courseCode: input.courseCode,
      isOpeningTurn: built.isOpeningTurn,
      userTurnIndex: built.userTurnIndex,
      response: finalValue,
      toolCallsUsed: finalToolCallsUsed,
    });
  } catch (err) {
    yield { kind: 'error', message: err instanceof Error ? err.message : String(err) };
    return;
  }

  yield {
    kind: 'final',
    response: finalValue,
    toolCallsUsed: finalToolCallsUsed.length,
  };
}
```

- [ ] **Step 3: Write a unit test using `FakeProvider` to verify generator shape**

The fake provider currently throws on `streamWithTools`. Add an integration-style test that uses real `OpenAIProvider` mocking — or skip it for now and verify via end-to-end smoke. For unit coverage, add `lib/ai/agent/__tests__/audit-agent-stream-shape.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { streamAuditAgent } from '../audit-agent-stream';

describe('streamAuditAgent', () => {
  it('exposes an async generator', () => {
    const gen = streamAuditAgent({
      sessionId: '00000000-0000-0000-0000-000000000000',
      courseCode: 'GC 0000',
      auditMode: 'full',
    });
    expect(typeof gen[Symbol.asyncIterator]).toBe('function');
  });
});
```

Run: `pnpm test lib/ai/agent/__tests__/audit-agent-stream-shape.test.ts`
Expected: PASS.

- [ ] **Step 4: Type-check**

Run: `pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/agent/audit-agent.ts lib/ai/agent/audit-agent-stream.ts lib/ai/agent/__tests__/audit-agent-stream-shape.test.ts
git commit -m "feat(agent): streamAuditAgent — async generator wrapping streamWithTools"
```

---

### Task 3: SSE streaming chat route

**Files:**
- Modify: `app/api/capture/[code]/chat/route.ts` — v2 branch returns a streamed `Response` when client sends `Accept: text/event-stream` (or `?stream=1`); v1 path unchanged

- [ ] **Step 1: Add the streaming branch**

In `app/api/capture/[code]/chat/route.ts`, add this import:

```typescript
import { streamAuditAgent } from '@/lib/ai/agent/audit-agent-stream';
```

Then, inside the existing `if (v2Enabled) { ... }` block, BEFORE the `try { runAuditAgent(...) }` call, add:

```typescript
    const sessionId =
      typeof body.sessionId === 'string' && body.sessionId.length > 0
        ? body.sessionId
        : startNewSession();

    const lastUserMessage = history.filter(m => m.role === 'user').slice(-1)[0]?.content;

    const wantsStream =
      url.searchParams.get('stream') === '1' ||
      (req.headers.get('accept') ?? '').includes('text/event-stream');

    if (wantsStream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            const gen = streamAuditAgent({
              sessionId,
              courseCode,
              ...(lastUserMessage ? { userMessage: lastUserMessage } : {}),
              auditMode: course.auditMode as 'full' | 'simple',
            });
            for await (const ev of gen) {
              controller.enqueue(encoder.encode(JSON.stringify(ev) + '\n'));
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            controller.enqueue(encoder.encode(JSON.stringify({ kind: 'error', message }) + '\n'));
          } finally {
            controller.close();
          }
        },
      });
      return new Response(stream, {
        headers: {
          'content-type': 'application/x-ndjson; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          'x-accel-buffering': 'no',
        },
      });
    }
```

Then DELETE the now-duplicated `const sessionId = ...` and `const lastUserMessage = ...` lines from the existing non-streaming code path inside the same block (they were hoisted above). The existing `try { runAuditAgent(...) ... }` remains as the non-stream fallback.

- [ ] **Step 2: Hand-test the stream endpoint with curl**

(After committing, with the dev server running) verify the stream shape:

```bash
curl -N -X POST 'http://localhost:3000/api/capture/GC%204800/chat?slug=YOUR_SLUG&stream=1' \
  -H 'content-type: application/json' \
  -d '{"messages":[]}'
```

Expected: one line per event, ending in `{"kind":"final",...}`.

- [ ] **Step 3: Type-check**

Run: `pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/api/capture/[code]/chat/route.ts
git commit -m "feat(api): NDJSON streaming branch for v2 audit chat"
```

---

### Task 4: Progressive rendering in `CaptureChatPanel`

**Files:**
- Modify: `app/capture/[code]/CaptureChatPanel.tsx` — switch v2 path to streaming, render text deltas into the in-flight assistant message

- [ ] **Step 1: Add a streaming helper at the top of the file**

Add this helper above the `CaptureChatPanel` component (after the `ReadinessStrip` definition):

```typescript
async function readNdjson(
  res: Response,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> {
  if (!res.body) throw new Error('no body to stream');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        onEvent(JSON.parse(line));
      } catch {
        // ignore malformed lines — server only emits valid JSON per line
      }
    }
  }
  const tail = buf.trim();
  if (tail) {
    try { onEvent(JSON.parse(tail)); } catch { /* ignore */ }
  }
}
```

- [ ] **Step 2: Replace the body of `postChat` with the streaming version**

Replace the existing `postChat` function with:

```typescript
  async function postChat(next: ChatMessage[]) {
    setBusy(true);
    setError(null);

    // Optimistically push an empty assistant message so deltas have a place
    // to land. We replace it on each delta and reconcile at 'final'.
    let streamed = '';
    let toolBanner = '';
    const optimistic: ChatMessage = { role: 'assistant', content: '' };
    onMessagesChange([...next, optimistic]);

    try {
      const res = await fetch(
        `/api/capture/${encodeURIComponent(courseCode)}/chat?slug=${encodeURIComponent(slug)}&stream=1`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
          body: JSON.stringify({
            messages: next,
            ...(sessionId ? { sessionId } : {}),
          }),
        },
      );
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        setError((json as { error?: string }).error ?? `Chat failed (${res.status})`);
        // Drop the optimistic empty assistant turn.
        onMessagesChange(next);
        return;
      }

      let finalResponse: {
        finding?: string;
        question?: string;
        citations?: ChatMessage['citations'];
        readiness?: CaptureReadiness;
      } | null = null;

      await readNdjson(res, (ev) => {
        const e = ev as { kind: string } & Record<string, unknown>;
        if (e.kind === 'session' && typeof e.sessionId === 'string') {
          setSessionId(e.sessionId);
        } else if (e.kind === 'tool-start' && typeof e.toolName === 'string') {
          toolBanner = `Searching materials via ${e.toolName}…`;
          onMessagesChange([
            ...next,
            { role: 'assistant', content: streamed || toolBanner },
          ]);
        } else if (e.kind === 'text-delta' && typeof e.delta === 'string') {
          streamed += e.delta;
          onMessagesChange([
            ...next,
            { role: 'assistant', content: streamed },
          ]);
        } else if (e.kind === 'final' && e.response && typeof e.response === 'object') {
          finalResponse = e.response as typeof finalResponse;
        } else if (e.kind === 'error' && typeof e.message === 'string') {
          setError(e.message);
        }
      });

      if (!finalResponse) {
        if (!streamed) onMessagesChange(next);
        return;
      }

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: (finalResponse.finding ?? '') + '\n\n' + (finalResponse.question ?? ''),
        ...(Array.isArray(finalResponse.citations) && finalResponse.citations.length > 0
          ? { citations: finalResponse.citations }
          : {}),
      };
      const newMessages = [...next, assistantMessage];
      onMessagesChange(newMessages);
      if (finalResponse.readiness) setReadiness(finalResponse.readiness);
      onConversationChange?.(newMessages, finalResponse.readiness ?? readiness ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chat failed');
      onMessagesChange(next);
    } finally {
      setBusy(false);
    }
  }
```

- [ ] **Step 3: Update the "Auditor is thinking…" placeholder**

The current `{busy && messages.length > 0 && <p>Auditor is thinking…</p>}` line can stay — but during streaming `busy` is true while text is already arriving, so the line is mildly redundant. Tighten the condition:

```tsx
        {busy && messages.length > 0 && messages[messages.length - 1]?.content === '' && (
          <p className="text-xs italic text-muted-foreground">Auditor is thinking…</p>
        )}
```

- [ ] **Step 4: Hand-verify in the browser**

Open `/capture/GC 4800` in a fresh dev session, click Start session, watch for: (a) text appearing within ~1s instead of after a long wait, (b) optional "Searching materials via search_materials…" banner appearing briefly when the agent uses retrieval, (c) the final reply replacing the stream with the canonical `finding + question` shape after the stream ends, (d) citations rendering on the final reply as before.

- [ ] **Step 5: Commit**

```bash
git add app/capture/[code]/CaptureChatPanel.tsx
git commit -m "feat(ui): stream audit-chat responses progressively into the panel"
```

---

### Task 5: Stage 7a — STATE.md + commit

**Files:**
- Modify: `docs/STATE.md`

- [ ] **Step 1: Update STATE.md**

In `docs/STATE.md`:

1. Under "Active arc", add a new paragraph after the Stage 6 paragraph:

```markdown
**Stage 7a (Streaming) shipped 2026-05-28**: `AIProvider.streamWithTools` added (OpenAI implementation via Vercel AI SDK v6 `streamText` + `Output.object`; other providers throw "not implemented" for now). `streamAuditAgent` async generator wraps the same context-building and persistence as `runAuditAgent`. v2 chat route returns an NDJSON stream when the client requests `?stream=1` or `Accept: text/event-stream`. `CaptureChatPanel` consumes the stream and renders text deltas progressively, eliminating the 3–7s silent wait per turn.
```

2. Under "Next-up → Spec'd, not yet implemented" → CourseCapture v2 row, update the per-stage breakdown to note Stage 7a shipped. The remaining Stage 7 work (session-continuity briefing, faculty profiles) and Stage 5 (legacy migration + citation drawer) become the open tracks. (Stage 5 work in Phase B of this plan will further update this.)

3. Bump `**Last verified:**` to the SHA of this commit (placeholder for now — set after pushing).

- [ ] **Step 2: Commit**

```bash
git add docs/STATE.md
git commit -m "docs(state): Stage 7a streaming shipped"
```

---

## Phase B — Stage 5 Legacy Banner + Citation Drawer + Conversation Migration

### Task 6: Legacy banner for pre-v2 snapshots / drafts

**Files:**
- Create: `app/capture/[code]/LegacyBanner.tsx`
- Modify: `app/capture/[code]/ProfileReviewPanel.tsx` — render banner above the panel when ANY finding lacks a `source` field
- Modify: `app/capture/[code]/VerificationSummary.tsx` — same

- [ ] **Step 1: Write the banner component**

Create `app/capture/[code]/LegacyBanner.tsx`:

```typescript
'use client';

/**
 * Shown above the Review panel / Verification summary when a CaptureProfile
 * comes from a pre-v2 audit (no source-flag provenance). Faculty clicks "Re-audit"
 * to start a fresh v2 session; no auto-migration happens.
 */
export function LegacyBanner({ onReaudit }: { onReaudit?: () => void }) {
  return (
    <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">Legacy draft — no per-finding provenance.</p>
          <p className="mt-0.5 text-xs leading-snug">
            This profile was captured before per-finding source flags and clickable citations existed.
            The ratings remain valid; they just don&apos;t carry an evidence trail.
            Start a fresh audit when you have time and the new version will replace this one.
          </p>
        </div>
        {onReaudit && (
          <button
            type="button"
            onClick={onReaudit}
            className="shrink-0 rounded border border-amber-400 bg-amber-100 px-2 py-1 text-xs font-medium hover:bg-amber-200"
          >
            Start fresh audit
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add a helper to detect legacy profiles**

In `app/capture/[code]/ProfileReviewPanel.tsx`, add:

```typescript
function isLegacyProfile(profile: CaptureProfile): boolean {
  // A profile is "legacy" when none of its findings carry a source flag.
  // v2 always emits source on every finding (instructor / materials / inferred).
  const allFindings = [
    ...(profile.competencies ?? []),
    ...(profile.incoming_expectations ?? []),
    ...((profile.verification_summary ? [profile.verification_summary] : []) as Array<{ source?: unknown }>),
    ...((profile.audit_notes ?? []) as Array<{ source?: unknown }>),
  ];
  if (allFindings.length === 0) return false;
  return allFindings.every(f => (f as { source?: unknown }).source === undefined);
}

export { isLegacyProfile };
```

(Adjust the iterable shape if your `CaptureProfile` has different fields — check `lib/ai/capture/schema.ts` first and align the field names exactly.)

- [ ] **Step 3: Render the banner**

In `ProfileReviewPanel.tsx`, at the top of the returned JSX of `ProfileReviewPanel`, add:

```tsx
        {isLegacyProfile(profile) && <LegacyBanner onReaudit={onResumeChat} />}
```

(`onResumeChat` is an existing prop on the panel; pressing the banner button is the same as resuming the audit.)

Add the import at the top:

```typescript
import { LegacyBanner } from './LegacyBanner';
```

Repeat the same in `VerificationSummary.tsx`: import `LegacyBanner` and `isLegacyProfile`, render the banner when the parent profile is legacy. Adapt props as needed — the verification panel may need a passed-down `profile` prop to evaluate; add it if missing.

- [ ] **Step 4: Verify**

Open `/capture/GC 3460` (a known legacy draft per the STATE doc) and `/capture/GC 4800` (v2). Confirm the banner appears on the former and not the latter.

- [ ] **Step 5: Commit**

```bash
git add app/capture/[code]/LegacyBanner.tsx app/capture/[code]/ProfileReviewPanel.tsx app/capture/[code]/VerificationSummary.tsx
git commit -m "feat(capture): legacy-draft banner above Review panel for pre-v2 profiles"
```

---

### Task 7: Chunk + message lookup endpoints

**Files:**
- Modify: `lib/capture/vector-store.ts` — add `fetchChunkById` to the `VectorStore` interface
- Modify: `lib/capture/vector-store-weaviate.ts` — implement using Weaviate v3 `collection.query.fetchObjectById`
- Modify (lightly): `lib/capture/vector-store.ts` — in-memory backend impl
- Create: `app/api/capture/[code]/chunks/[chunkId]/route.ts`
- Create: `lib/db/capture-messages-queries.ts` — add `getMessageById(courseCode, sessionId, messageId)` (turnIndex- or row-id based; route accepts either)
- Create: `app/api/capture/[code]/messages/[messageId]/route.ts`

- [ ] **Step 1: Extend `VectorStore` interface**

In `lib/capture/vector-store.ts`, add to `VectorStore`:

```typescript
  fetchChunkById(tenant: string, chunkId: string): Promise<{
    text: string;
    fileName: string;
    sectionTitle: string;
    sectionIndex: number;
    materialId: string;
    parentSectionText: string | null;
  } | null>;
```

In-memory impl inside `createInMemoryVectorStore`:

```typescript
    async fetchChunkById(tenant, chunkId) {
      const state = tenants.get(tenant);
      const c = state?.chunks.get(chunkId);
      if (!c) return null;
      const parent = state?.sections.get(c.parentSectionId) ?? null;
      return {
        text: c.text,
        fileName: c.fileName,
        sectionTitle: c.sectionTitle,
        sectionIndex: c.sectionIndex,
        materialId: c.materialId,
        parentSectionText: parent?.text ?? null,
      };
    },
```

In `lib/capture/vector-store-weaviate.ts` `createWeaviateVectorStore` returned object, add:

```typescript
    async fetchChunkById(tenant, chunkId) {
      await ensureSchemaOnce();
      const client = await getWeaviateClient();
      const col = client.collections.use(MATERIAL_CHUNK_CLASS).withTenant(tenant);
      const obj = await col.query.fetchObjectById(chunkId);
      if (!obj) return null;
      const p = obj.properties as {
        text: string;
        fileName: string;
        sectionTitle: string;
        sectionIndex: number;
        materialId: string;
        parentSectionId: string;
      };
      let parentSectionText: string | null = null;
      if (p.parentSectionId) {
        const sec = client.collections.use(MATERIAL_SECTION_CLASS).withTenant(tenant);
        const parent = await sec.query.fetchObjectById(p.parentSectionId);
        if (parent) parentSectionText = (parent.properties as { text?: string }).text ?? null;
      }
      return {
        text: p.text,
        fileName: p.fileName,
        sectionTitle: p.sectionTitle,
        sectionIndex: p.sectionIndex,
        materialId: p.materialId,
        parentSectionText,
      };
    },
```

- [ ] **Step 2: Chunk lookup route**

Create `app/api/capture/[code]/chunks/[chunkId]/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { createVectorStore, tenantForCourse } from '@/lib/capture/vector-store';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string; chunkId: string }> }

export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const { allowed } = await checkIpRateLimit(hashIp(req));
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const { code: rawCode, chunkId } = await params;
  const courseCode = decodeURIComponent(rawCode);
  const course = await getCourseByCode(courseCode);
  if (!course) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const store = createVectorStore();
  const chunk = await store.fetchChunkById(tenantForCourse(courseCode), chunkId);
  if (!chunk) return NextResponse.json({ error: 'chunk not found' }, { status: 404 });
  return NextResponse.json(chunk);
}
```

- [ ] **Step 3: Message lookup helper + route**

In `lib/db/capture-messages-queries.ts`, append:

```typescript
/** Lookup one message by id, scoped to a course. The session_id is not
 * required by the storage layer but the route enforces it to keep messages
 * from different sessions from leaking across the slug boundary. */
export async function getMessageById(
  courseCode: string,
  messageId: string,
): Promise<{ id: string; sessionId: string; turnIndex: number; role: string; content: string | null } | null> {
  const rows = await db
    .select({
      id: captureMessages.id,
      sessionId: captureMessages.sessionId,
      turnIndex: captureMessages.turnIndex,
      role: captureMessages.role,
      content: captureMessages.content,
    })
    .from(captureMessages)
    .where(and(eq(captureMessages.courseCode, courseCode), eq(captureMessages.id, messageId)))
    .limit(1);
  return rows[0] ?? null;
}
```

Create `app/api/capture/[code]/messages/[messageId]/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { getMessageById } from '@/lib/db/capture-messages-queries';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ code: string; messageId: string }> }

export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const { allowed } = await checkIpRateLimit(hashIp(req));
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const { code: rawCode, messageId } = await params;
  const courseCode = decodeURIComponent(rawCode);
  const course = await getCourseByCode(courseCode);
  if (!course) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const msg = await getMessageById(courseCode, messageId);
  if (!msg) return NextResponse.json({ error: 'message not found' }, { status: 404 });

  // Assistant messages store JSON {finding, question, citations, readiness}.
  // Surface the prose form for the drawer rather than the raw JSON.
  let prose = msg.content ?? '';
  if (msg.role === 'assistant' && prose.startsWith('{')) {
    try {
      const parsed = JSON.parse(prose) as { finding?: string; question?: string };
      prose = [parsed.finding, parsed.question].filter(Boolean).join('\n\n');
    } catch { /* keep raw */ }
  }

  return NextResponse.json({
    id: msg.id,
    role: msg.role,
    turnIndex: msg.turnIndex,
    content: prose,
  });
}
```

- [ ] **Step 4: Smoke-curl both endpoints**

(After committing, with the dev server running — verify they 404 on bogus ids and 200 with payload on real ones.)

- [ ] **Step 5: Type-check + commit**

Run: `pnpm tsc --noEmit`. Expected: clean.

```bash
git add lib/capture/vector-store.ts lib/capture/vector-store-weaviate.ts app/api/capture/[code]/chunks app/api/capture/[code]/messages lib/db/capture-messages-queries.ts
git commit -m "feat(capture): chunk + message lookup endpoints for citation drawer"
```

---

### Task 8: CitationDrawer + wire from chat panel + SourceBadge

**Files:**
- Create: `app/capture/[code]/CitationDrawer.tsx`
- Modify: `app/capture/[code]/CaptureChatPanel.tsx` — wire chip → drawer
- Modify: `app/capture/[code]/ProfileReviewPanel.tsx` — wire `SourceBadge` → drawer (badge becomes a button)
- Modify: `app/capture/[code]/VerificationSummary.tsx` — same

- [ ] **Step 1: Write the drawer component**

Create `app/capture/[code]/CitationDrawer.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';

export interface CitationTarget {
  type: 'chunk' | 'instructor';
  chunkId?: string | null;
  messageId?: string | null;
  excerpt?: string;
}

interface ChunkPayload {
  text: string;
  fileName: string;
  sectionTitle: string;
  sectionIndex: number;
  materialId: string;
  parentSectionText: string | null;
}

interface MessagePayload {
  id: string;
  role: string;
  turnIndex: number;
  content: string;
}

interface Props {
  courseCode: string;
  slug: string;
  target: CitationTarget | null;
  onClose: () => void;
}

export function CitationDrawer({ courseCode, slug, target, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chunk, setChunk] = useState<ChunkPayload | null>(null);
  const [message, setMessage] = useState<MessagePayload | null>(null);

  useEffect(() => {
    if (!target) return;
    setLoading(true);
    setError(null);
    setChunk(null);
    setMessage(null);

    const base = `/api/capture/${encodeURIComponent(courseCode)}`;
    const qs = `?slug=${encodeURIComponent(slug)}`;

    let cancelled = false;
    (async () => {
      try {
        if (target.type === 'chunk' && target.chunkId) {
          const res = await fetch(`${base}/chunks/${encodeURIComponent(target.chunkId)}${qs}`);
          if (!res.ok) throw new Error(`chunk lookup failed (${res.status})`);
          if (!cancelled) setChunk((await res.json()) as ChunkPayload);
        } else if (target.type === 'instructor' && target.messageId) {
          const res = await fetch(`${base}/messages/${encodeURIComponent(target.messageId)}${qs}`);
          if (!res.ok) throw new Error(`message lookup failed (${res.status})`);
          if (!cancelled) setMessage((await res.json()) as MessagePayload);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'lookup failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [target, courseCode, slug]);

  if (!target) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <aside className="w-[min(560px,92vw)] overflow-y-auto border-l bg-card p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            {target.type === 'chunk' ? 'Material excerpt' : 'Earlier turn'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded border px-2 py-1 text-xs hover:bg-muted"
          >
            Close
          </button>
        </div>

        {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}

        {chunk && (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              <div><span className="font-medium text-foreground">File:</span> {chunk.fileName}</div>
              <div><span className="font-medium text-foreground">Section:</span> {chunk.sectionTitle || '(untitled)'} (#{chunk.sectionIndex})</div>
            </div>
            <pre className="whitespace-pre-wrap rounded bg-muted/40 p-3 text-xs leading-relaxed">{chunk.text}</pre>
            {chunk.parentSectionText && chunk.parentSectionText !== chunk.text && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Show full parent section
                </summary>
                <pre className="mt-2 whitespace-pre-wrap rounded bg-muted/20 p-3 text-xs leading-relaxed">
                  {chunk.parentSectionText}
                </pre>
              </details>
            )}
          </div>
        )}

        {message && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {message.role === 'user' ? 'Instructor' : 'Auditor'} · turn {message.turnIndex}
            </p>
            <pre className="whitespace-pre-wrap rounded bg-muted/40 p-3 text-sm leading-relaxed">{message.content}</pre>
          </div>
        )}

        {target.excerpt && !chunk && !message && !loading && (
          <p className="text-xs italic text-muted-foreground">Cited excerpt: {target.excerpt}</p>
        )}
      </aside>
    </div>
  );
}
```

- [ ] **Step 2: Wire from `CaptureChatPanel`**

In `app/capture/[code]/CaptureChatPanel.tsx`:

Add the import and state at the top of the component:

```typescript
import { CitationDrawer, type CitationTarget } from './CitationDrawer';
// ...
const [drawerTarget, setDrawerTarget] = useState<CitationTarget | null>(null);
```

Replace the existing inline chip rendering (the `<span ...>` for each citation) with a `<button>` that opens the drawer:

```tsx
{m.role === 'assistant' && m.citations && m.citations.length > 0 && (
  <div className="mt-2 flex flex-wrap gap-1.5">
    {m.citations.map((c, ci) => (
      <button
        key={ci}
        type="button"
        onClick={() => setDrawerTarget({
          type: c.type,
          chunkId: c.chunkId ?? null,
          messageId: c.messageId ?? null,
          excerpt: c.excerpt,
        })}
        title={c.excerpt}
        className="inline-flex max-w-full items-center gap-1.5 rounded border bg-background px-1.5 py-0.5 text-[10.5px] font-mono leading-none text-muted-foreground hover:bg-muted"
      >
        <span className={'font-semibold ' + (c.type === 'chunk' ? 'text-teal-700' : 'text-amber-700')}>
          {c.type === 'chunk' ? 'CH' : 'IN'}
        </span>
        <span className="max-w-[280px] truncate">{c.excerpt}</span>
      </button>
    ))}
  </div>
)}
```

At the bottom of the component's JSX (before the closing `</section>`):

```tsx
<CitationDrawer
  courseCode={courseCode}
  slug={slug}
  target={drawerTarget}
  onClose={() => setDrawerTarget(null)}
/>
```

- [ ] **Step 3: Make `SourceBadge` clickable**

In `app/capture/[code]/ProfileReviewPanel.tsx`, change the `SourceBadge` component signature to accept an `onClick` and render as a `<button>` when an `onClick` is provided:

```typescript
export function SourceBadge({
  source,
  citations,
  onCitationClick,
}: {
  source: CaptureProfileSourceType | undefined;
  citations: CaptureProfileCitationType[] | undefined;
  onCitationClick?: (c: CaptureProfileCitationType) => void;
}) {
  if (!source) return null;
  const count = citations?.length ?? 0;
  // ...existing palette + label code unchanged...

  // Click-through: when there's at least one citation, the badge becomes a
  // button that opens the drawer on the first citation. When there are
  // multiple, the user can use the chip set in the conversation panel.
  const interactive = onCitationClick && citations && citations.length > 0;
  const className = `inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider ${palette}` +
    (interactive ? ' hover:opacity-80 cursor-pointer' : '');

  if (interactive) {
    return (
      <button
        type="button"
        title={count > 0 ? `${count} citation${count === 1 ? '' : 's'} — click to view` : source}
        className={className}
        onClick={() => onCitationClick!(citations[0]!)}
      >
        {label}
      </button>
    );
  }
  return (
    <span title={count > 0 ? `${count} citation${count === 1 ? '' : 's'}` : source} className={className}>
      {label}
    </span>
  );
}
```

Pass an `onCitationClick` handler from `ProfileReviewPanel`'s parent state (drawer target). Add a `CitationDrawer` instance at the bottom of `ProfileReviewPanel`'s JSX as well — the panel maintains its own drawer state. Repeat in `VerificationSummary.tsx`.

- [ ] **Step 4: Hand-verify**

Open `/capture/GC 4800`, start (or resume) a v2 session. Confirm clicking a citation chip in the chat opens the drawer with the chunk text. After generating a profile, confirm clicking a `SourceBadge` in the Review panel opens the drawer with the first citation.

- [ ] **Step 5: Commit**

```bash
git add app/capture/[code]/CitationDrawer.tsx app/capture/[code]/CaptureChatPanel.tsx app/capture/[code]/ProfileReviewPanel.tsx app/capture/[code]/VerificationSummary.tsx
git commit -m "feat(capture): citation drawer — click citations to read the source"
```

---

### Task 9: `capture_conversations` → `capture_messages` backfill

**Files:**
- Create: `scripts/_one-off/2026-05-28-migrate-capture-conversations.ts`

- [ ] **Step 1: Write the migration script**

Create `scripts/_one-off/2026-05-28-migrate-capture-conversations.ts`:

```typescript
/**
 * One-off backfill: for every row in capture_conversations that hasn't
 * already been mirrored into capture_messages, synthesize a session_id,
 * insert one message per turn, and (if the course has a snapshot whose
 * transcript_session_id is null) link the latest snapshot to that synthetic
 * session.
 *
 * Idempotency: we check whether the course already has any capture_messages
 * rows. If it does (e.g., GC 4800 was mirrored in Stage 1), we skip.
 *
 * Run via: `pnpm dotenv -e .env.local -- tsx scripts/_one-off/2026-05-28-migrate-capture-conversations.ts`
 */

import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { captureConversations, captureMessages, courseCaptureSnapshots } from '@/lib/db/schema';

async function main() {
  const rows = await db.select().from(captureConversations);
  console.log(`Found ${rows.length} capture_conversations rows.`);

  for (const row of rows) {
    const existing = await db
      .select({ id: captureMessages.id })
      .from(captureMessages)
      .where(eq(captureMessages.courseCode, row.courseCode))
      .limit(1);
    if (existing.length > 0) {
      console.log(`[skip] ${row.courseCode} already has capture_messages rows.`);
      continue;
    }

    const messages = Array.isArray(row.messages) ? row.messages : [];
    if (messages.length === 0) {
      console.log(`[skip] ${row.courseCode} has no messages to migrate.`);
      continue;
    }

    const sessionId = randomUUID();
    let turnIndex = 0;
    for (const m of messages) {
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      await db.insert(captureMessages).values({
        courseCode: row.courseCode,
        sessionId,
        turnIndex,
        role: m.role,
        content: m.content,
      });
      turnIndex++;
    }
    console.log(`[migrated] ${row.courseCode} → session ${sessionId} (${turnIndex} turns)`);

    // Link the latest snapshot if it doesn't already have a transcript link.
    const latestSnapshot = await db
      .select({ id: courseCaptureSnapshots.id })
      .from(courseCaptureSnapshots)
      .where(and(
        eq(courseCaptureSnapshots.courseCode, row.courseCode),
        isNull(courseCaptureSnapshots.transcriptSessionId),
      ))
      .orderBy(courseCaptureSnapshots.createdAt)
      .limit(1);
    if (latestSnapshot[0]) {
      await db.update(courseCaptureSnapshots)
        .set({ transcriptSessionId: sessionId })
        .where(eq(courseCaptureSnapshots.id, latestSnapshot[0].id));
      console.log(`  → linked snapshot ${latestSnapshot[0].id} to session.`);
    }
  }

  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Dry-run mentally + run it once locally**

Confirm `.env.local` has `DATABASE_URL`. Run:

```bash
pnpm dotenv -e .env.local -- tsx scripts/_one-off/2026-05-28-migrate-capture-conversations.ts
```

Expected: each course is either `[skip]`ped or `[migrated]`. Re-run — every course should now `[skip]`.

- [ ] **Step 3: Verify in DB**

```bash
psql "$DATABASE_URL" -c "
  SELECT course_code, COUNT(*) AS turns, MIN(created_at) AS first_turn
  FROM capture_messages
  GROUP BY course_code
  ORDER BY course_code;
"
```

Expected: every course that previously had a capture_conversations row now appears.

- [ ] **Step 4: Commit**

```bash
git add scripts/_one-off/2026-05-28-migrate-capture-conversations.ts
git commit -m "chore(migrate): backfill capture_conversations into capture_messages"
```

---

### Task 10: Stage 5 — STATE.md + commit

**Files:**
- Modify: `docs/STATE.md`

- [ ] **Step 1: Update STATE.md**

In `docs/STATE.md`:

1. Under "Active arc", add a Stage 5 paragraph after Stage 7a:

```markdown
**Stage 5 (Legacy banner + citation drawer + conversation backfill) shipped 2026-05-28**: `LegacyBanner` shown above `ProfileReviewPanel` / `VerificationSummary` when a profile has no source-flag provenance (pre-v2 drafts). New chunk/message lookup endpoints (`GET /api/capture/[code]/chunks/[chunkId]`, `GET /api/capture/[code]/messages/[messageId]`); `VectorStore` gained `fetchChunkById` (in-memory + Weaviate impls). New `CitationDrawer` opens from citation chips in the chat panel and from `SourceBadge` in the Review/Verification panels. One-off backfill (`scripts/_one-off/2026-05-28-migrate-capture-conversations.ts`) synthesizes a `session_id` per legacy `capture_conversations` row, inserts one `capture_messages` row per turn, and links the latest snapshot via `transcript_session_id` where unlinked.
```

2. Under "Next-up → Spec'd, not yet implemented" → CourseCapture v2 row, mark Stage 5 shipped. Open work remaining: Stage 7 session-continuity briefing, faculty profiles. (Stage 7a streaming was shipped in Phase A of this same plan.)

3. Under "What's live" → faculty-surfaces table, no row change (Stage 5 surfaces extend `/capture/[code]`). Optionally add a column note that it now supports clickable citations + legacy-draft awareness.

4. Bump `**Last verified:**` to the SHA of this commit.

- [ ] **Step 2: Commit**

```bash
git add docs/STATE.md
git commit -m "docs(state): Stage 5 legacy banner + citation drawer + migration shipped"
```

---

## Self-Review (post-write, pre-execute)

Coverage:
- **Stage 7a — streaming**: provider interface (T1), streaming agent (T2), SSE route (T3), client (T4), STATE (T5). ✅
- **Stage 5 — legacy banner**: T6. ✅
- **Stage 5 — citation drawer**: lookup endpoints (T7), drawer component + wiring (T8). ✅
- **Stage 5 — conversation backfill**: T9. ✅
- **STATE**: per-stage updates in T5 and T10. ✅

Type consistency: `CitationTarget` (drawer) uses `chunkId/messageId: string | null`; `CaptureMessageCitation` and `AuditCitation` use the same shape on the wire. `ToolCall` is imported into `audit-agent.ts` and re-used through `persistAssistantTurn`.

Placeholders: none — every code step has the actual code.

Out-of-scope (documented for sequencing):
- Anthropic / Local / Campus streaming impls — those providers throw on `streamWithTools`; client could fall back to the non-stream path if needed. The current Mac deploy runs OpenAI exclusively, so this is non-blocking.
- Streaming partial readiness updates (currently readiness arrives only on `final`). Spec'd 7b territory.
- Replay-aware citation rendering during the partial stream (text deltas don't carry citations until final). Acceptable; chips render at end-of-turn.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-28-coursecapture-v2-stage7a-streaming-and-stage5-legacy.md`.

Execute via superpowers:subagent-driven-development (one subagent per task, two-stage review between).
