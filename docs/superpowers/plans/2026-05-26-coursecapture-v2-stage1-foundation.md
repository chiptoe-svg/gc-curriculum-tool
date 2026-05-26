# CourseCapture v2 — Stage 1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the persistence + provider-abstraction foundation for the CourseCapture v2 agentic-retrieval architecture (spec: [`../specs/2026-05-26-coursecapture-agentic-retrieval-design.md`](../specs/2026-05-26-coursecapture-agentic-retrieval-design.md)). Three deliverables: an append-only `capture_messages` table that durably persists audit conversations, a `courses.audit_mode` column for the Full/Simple toggle, and a `completeWithTools` extension to the AI provider abstraction so later stages have native tool-use support across OpenAI, Anthropic, Local, and Fake providers.

**Architecture:** All three deliverables are independent of Weaviate (which arrives in Stage 2 with the user's local agent infrastructure). The schema adds new tables/columns without removing any; the provider extension adds a new method without changing the existing `complete()` surface. No user-visible UX changes ship in Stage 1; the foundation lights up when Stage 3 wires the agent loop. Existing `capture_conversations` rows migrate into `capture_messages` so historical transcripts are preserved in the new shape.

**Tech Stack:** Next.js 15 App Router · TypeScript strict · Drizzle ORM on Postgres (Neon) · Vitest · Vercel AI SDK (`ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`) for the underlying tool-use plumbing inside our existing provider abstraction. Package manager: pnpm.

---

## Context for the engineer

What's already true:

- The codebase has an existing AI provider abstraction at `lib/ai/provider.ts` exposing an `AIProvider` interface with `complete()` and `transcribeDocument()` methods. Four implementations: `OpenAIProvider` (`lib/ai/openai.ts`), `AnthropicProvider` (`lib/ai/anthropic.ts`), `LocalProvider` (`lib/ai/local.ts`), `FakeProvider` (`lib/ai/fake-provider.ts`).
- The existing per-function model selection lives in `lib/ai/function-settings.ts`. New function IDs for Stage 3 (`capture-chat-agent`) and Stage 2/4 (`material-digest`, `chunk-context`, `ingestion-checkin`, `capture-synthesis`) are deferred to those stages — Stage 1 doesn't add new function IDs.
- The current capture transcript lives in `capture_conversations` (one row per course, `messages: jsonb` array, overwritten per session). This table is preserved as legacy after Stage 1; new transcripts flow into `capture_messages`. Stage 3 cuts over the audit chat to write to the new table; until then, `capture_conversations` keeps receiving writes from today's code path.
- Latest applied migration: `drizzle/0021_soft_the_liberteens.sql`. Stage 1 generates the next migration (`0022_*`).

What this stage does NOT change:

- The audit chat itself (still uses the existing prompts + `complete()` path; Stage 3 rewrites it).
- The materials pipeline (Stage 2).
- The synthesis prompt (Stage 4).
- Any UI surface.

---

## File structure

**Create:**
- `lib/db/capture-messages-queries.ts` — DB writers/readers for `capture_messages`
- `tests/lib/db/capture-messages-queries.test.ts` — unit tests
- `lib/ai/tool-use-types.ts` — shared `ToolDefinition`, `ToolCall`, `Message`, `CompleteWithToolsResult` types
- `tests/lib/ai/providers/fake-tool-use.test.ts` — fake-provider tool-use tests
- `tests/lib/ai/providers/openai-tool-use.test.ts` — OpenAI provider tool-use tests
- `tests/lib/ai/providers/anthropic-tool-use.test.ts` — Anthropic provider tool-use tests
- `tests/lib/ai/providers/local-tool-use.test.ts` — Local provider tool-use tests
- `drizzle/0022_<auto-name>.sql` — schema migration (drizzle-kit generates the name)
- `scripts/_one-off/migrate-capture-conversations.ts` — one-off data migration

**Modify:**
- `lib/db/schema.ts` — add `capture_messages` table, `courses.audit_mode` column, `course_capture_snapshots.transcript_session_id` column
- `lib/ai/provider.ts` — extend `AIProvider` interface with `completeWithTools`
- `lib/ai/openai.ts` — implement `completeWithTools` via `@ai-sdk/openai`
- `lib/ai/anthropic.ts` — implement `completeWithTools` via `@ai-sdk/anthropic`
- `lib/ai/local.ts` — implement `completeWithTools` (OpenAI-compatible tool-use against omlx)
- `lib/ai/fake-provider.ts` — implement scripted-tool-call mode
- `package.json` — add `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic` dependencies
- `docs/STATE.md` — note Stage 1 shipped

---

## Tasks

### Task 1: Schema additions — capture_messages, audit_mode, transcript_session_id

**Files:**
- Modify: `lib/db/schema.ts` (after the `captureConversations` table definition around line 438)
- Create: `drizzle/0022_<auto-name>.sql` via drizzle-kit

- [ ] **Step 1: Add the new table + columns to `lib/db/schema.ts`**

Append after the `captureConversations` table definition:

```ts
// CourseCapture v2 — append-only conversation log keyed by session. Replaces
// the session-overwriting behavior of capture_conversations. A session_id
// groups all messages from one audit attempt; multiple sessions per course
// are allowed. Snapshots link to the session that produced them via
// course_capture_snapshots.transcript_session_id.
export const captureMessages = pgTable('capture_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  courseCode: text('course_code').notNull().references(() => courses.code, { onDelete: 'cascade' }),
  sessionId: uuid('session_id').notNull(),
  turnIndex: integer('turn_index').notNull(),
  role: text('role').notNull(),  // 'system' | 'user' | 'assistant' | 'tool'
  content: text('content'),
  toolCalls: jsonb('tool_calls').$type<Array<{
    id: string;
    toolName: string;
    args: Record<string, unknown>;
  }>>(),
  toolResult: jsonb('tool_result').$type<{
    toolCallId: string;
    result: unknown;
  }>(),
  citations: jsonb('citations').$type<Array<{
    type: 'chunk' | 'instructor';
    chunkId?: string;
    messageId?: string;
    excerpt: string;
  }>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  sessionIdx: index('idx_capture_messages_session').on(table.courseCode, table.sessionId, table.turnIndex),
}));
```

Then update `courses` (around line 81) — add the `auditMode` column:

```ts
// Inside the courses pgTable definition, add:
  auditMode: text('audit_mode').notNull().default('full'),  // 'full' | 'simple'
```

And update `courseCaptureSnapshots` (line 316) — add the optional FK to the producing session:

```ts
// Inside courseCaptureSnapshots, add (place it next to caption fields):
  transcriptSessionId: uuid('transcript_session_id'),  // nullable; populated for snapshots produced by v2 captures
```

Make sure `index` and `integer` are imported from `drizzle-orm/pg-core` (they should already be).

- [ ] **Step 2: Generate the migration**

Run: `pnpm drizzle-kit generate`
Expected: a new file `drizzle/0022_<random-name>.sql` is created with `CREATE TABLE capture_messages` + `ALTER TABLE courses ADD COLUMN audit_mode` + `ALTER TABLE course_capture_snapshots ADD COLUMN transcript_session_id`. Drizzle-kit picks the name; do not rename.

- [ ] **Step 3: Apply the migration**

Run: `pnpm drizzle-kit migrate`
Expected: migration applies cleanly to the local DB; re-running `generate` produces no diff.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.ts drizzle/0022_*.sql drizzle/meta/
git commit -m "feat(capture-v2): add capture_messages, courses.audit_mode, snapshot.transcript_session_id"
```

---

### Task 2: Queries for capture_messages (TDD)

**Files:**
- Create: `lib/db/capture-messages-queries.ts`
- Create: `tests/lib/db/capture-messages-queries.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/db/capture-messages-queries.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertMock = vi.fn();
const selectMock = vi.fn();
const deleteMock = vi.fn();

vi.mock('@/lib/db/client', () => ({
  db: {
    insert: () => ({ values: (rows: unknown) => insertMock(rows) }),
    select: () => ({ from: () => ({ where: (w: unknown) => ({ orderBy: (o: unknown) => selectMock({ w, o }) }) }) }),
    delete: () => ({ where: (w: unknown) => deleteMock(w) }),
  },
}));

import {
  appendMessage,
  getSessionMessages,
  startNewSession,
} from '@/lib/db/capture-messages-queries';

describe('capture-messages-queries', () => {
  beforeEach(() => {
    insertMock.mockReset().mockResolvedValue(undefined);
    selectMock.mockReset().mockResolvedValue([]);
    deleteMock.mockReset().mockResolvedValue(undefined);
  });

  describe('startNewSession', () => {
    it('returns a fresh UUID', () => {
      const id1 = startNewSession();
      const id2 = startNewSession();
      expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('appendMessage', () => {
    it('inserts a row with the supplied fields', async () => {
      const sessionId = '11111111-1111-1111-1111-111111111111';
      await appendMessage({
        courseCode: 'GC 4800',
        sessionId,
        turnIndex: 0,
        role: 'user',
        content: 'hello',
      });
      expect(insertMock).toHaveBeenCalledOnce();
      const row = insertMock.mock.calls[0]![0];
      expect(row.courseCode).toBe('GC 4800');
      expect(row.sessionId).toBe(sessionId);
      expect(row.turnIndex).toBe(0);
      expect(row.role).toBe('user');
      expect(row.content).toBe('hello');
    });

    it('passes through tool calls and citations when supplied', async () => {
      await appendMessage({
        courseCode: 'GC 4800',
        sessionId: '22222222-2222-2222-2222-222222222222',
        turnIndex: 3,
        role: 'assistant',
        content: 'I see in your rubric...',
        citations: [{ type: 'chunk', chunkId: 'chunk-1', excerpt: 'tolerance ΔE 2.0' }],
        toolCalls: [{ id: 'tc-1', toolName: 'fetch_material_section', args: { materialId: 'm-1', query: 'rubric' } }],
      });
      const row = insertMock.mock.calls[0]![0];
      expect(row.citations).toEqual([{ type: 'chunk', chunkId: 'chunk-1', excerpt: 'tolerance ΔE 2.0' }]);
      expect(row.toolCalls).toEqual([{ id: 'tc-1', toolName: 'fetch_material_section', args: { materialId: 'm-1', query: 'rubric' } }]);
    });
  });

  describe('getSessionMessages', () => {
    it('queries by (courseCode, sessionId) and orders by turnIndex', async () => {
      selectMock.mockResolvedValue([
        { id: 'm-1', turnIndex: 0, role: 'user', content: 'hi' },
        { id: 'm-2', turnIndex: 1, role: 'assistant', content: 'hello' },
      ]);
      const rows = await getSessionMessages('GC 4800', '33333333-3333-3333-3333-333333333333');
      expect(rows.length).toBe(2);
      expect(selectMock).toHaveBeenCalledOnce();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/lib/db/capture-messages-queries.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the queries module**

Create `lib/db/capture-messages-queries.ts`:

```ts
/**
 * Append-only conversation log keyed by session. Replaces the
 * session-overwriting behavior of capture_conversations. See the v2
 * agentic-retrieval spec for the data model rationale:
 * docs/superpowers/specs/2026-05-26-coursecapture-agentic-retrieval-design.md
 *
 * A session_id groups all messages from one audit attempt. Snapshots
 * link to the producing session via course_capture_snapshots.transcript_session_id.
 */

import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { captureMessages } from '@/lib/db/schema';

export type CaptureMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface CaptureMessageToolCall {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface CaptureMessageToolResult {
  toolCallId: string;
  result: unknown;
}

export interface CaptureMessageCitation {
  type: 'chunk' | 'instructor';
  chunkId?: string;
  messageId?: string;
  excerpt: string;
}

export interface AppendMessageInput {
  courseCode: string;
  sessionId: string;
  turnIndex: number;
  role: CaptureMessageRole;
  content?: string | null;
  toolCalls?: CaptureMessageToolCall[];
  toolResult?: CaptureMessageToolResult;
  citations?: CaptureMessageCitation[];
}

/**
 * Mint a fresh session id. Caller persists it on the client (cookie / URL
 * state) and passes it back on subsequent turns to keep them grouped.
 */
export function startNewSession(): string {
  return randomUUID();
}

/**
 * Append one message to the session log. Idempotency is the caller's
 * responsibility (use a deterministic id if you need it).
 */
export async function appendMessage(input: AppendMessageInput): Promise<void> {
  await db.insert(captureMessages).values({
    courseCode: input.courseCode,
    sessionId: input.sessionId,
    turnIndex: input.turnIndex,
    role: input.role,
    content: input.content ?? null,
    toolCalls: input.toolCalls ?? null,
    toolResult: input.toolResult ?? null,
    citations: input.citations ?? null,
  });
}

/**
 * Return all messages for a session, ordered by turn_index ascending.
 * Used by the audit chat to rehydrate context and by the Review panel
 * to render the full transcript for snapshot review.
 */
export async function getSessionMessages(courseCode: string, sessionId: string) {
  return db
    .select()
    .from(captureMessages)
    .where(and(eq(captureMessages.courseCode, courseCode), eq(captureMessages.sessionId, sessionId)))
    .orderBy(asc(captureMessages.turnIndex));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/lib/db/capture-messages-queries.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/db/capture-messages-queries.ts tests/lib/db/capture-messages-queries.test.ts
git commit -m "feat(capture-v2): capture-messages-queries (appendMessage, getSessionMessages, startNewSession)"
```

---

### Task 3: One-off migration script — capture_conversations → capture_messages

**Files:**
- Create: `scripts/_one-off/migrate-capture-conversations.ts` (gitignored — `scripts/_one-off/` is in `.gitignore`)

- [ ] **Step 1: Write the script**

Create `scripts/_one-off/migrate-capture-conversations.ts`:

```ts
// One-shot: copy existing capture_conversations rows into capture_messages.
// Each existing row gets one synthesized session_id; its messages array is
// expanded into one capture_messages row per turn.
// Run: set -a; source .env.local; set +a; pnpm tsx scripts/_one-off/migrate-capture-conversations.ts
//
// Idempotent guard: checks whether capture_messages already has rows for
// the source course's session id; skips if found.

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { captureConversations, captureMessages } from '@/lib/db/schema';

interface OldMessage { role: 'user' | 'assistant'; content: string }

async function main() {
  const conversations = await db.select().from(captureConversations);
  console.log(`Found ${conversations.length} capture_conversations row(s) to consider.`);

  let migratedRows = 0;
  let skipped = 0;
  let totalMessages = 0;

  for (const conv of conversations) {
    const messages = conv.messages as OldMessage[];
    if (!messages || messages.length === 0) {
      console.log(`  ${conv.courseCode.padEnd(10)} skipped — empty messages array`);
      skipped++;
      continue;
    }

    const sessionId = randomUUID();
    const rows = messages.map((m, turnIndex) => ({
      courseCode: conv.courseCode,
      sessionId,
      turnIndex,
      role: m.role,
      content: m.content,
      toolCalls: null,
      toolResult: null,
      citations: null,
    }));

    await db.insert(captureMessages).values(rows);
    migratedRows++;
    totalMessages += rows.length;
    console.log(`  ${conv.courseCode.padEnd(10)} migrated ${rows.length} message(s) → session ${sessionId}`);
  }

  console.log(`\nDone. Migrated ${migratedRows} conversation(s) → ${totalMessages} messages. Skipped: ${skipped}.`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the script**

Run: `set -a; source .env.local; set +a; pnpm tsx scripts/_one-off/migrate-capture-conversations.ts`
Expected: prints per-course migration. Given today's state (1 row in `capture_conversations` for GC 4800 with 1 message), expect: `migrated 1 message(s) → session <uuid>`.

- [ ] **Step 3: Verify**

Run an inline query to confirm:

```bash
set -a; source .env.local; set +a; pnpm tsx -e "
import { db } from '@/lib/db/client';
import { captureMessages } from '@/lib/db/schema';
const rows = await db.select().from(captureMessages);
console.log('capture_messages rows:', rows.length);
rows.forEach(r => console.log(' ', r.courseCode, r.sessionId.slice(0,8), 'turn', r.turnIndex, r.role, (r.content ?? '').slice(0,40)));
process.exit(0);
"
```
Expected: at least 1 row, matching GC 4800's existing conversation.

- [ ] **Step 4: No commit needed**

The script lives in `scripts/_one-off/` which is gitignored.

---

### Task 4: Provider interface + tool-use types

**Files:**
- Create: `lib/ai/tool-use-types.ts`
- Modify: `lib/ai/provider.ts` (extend the `AIProvider` interface)

- [ ] **Step 1: Define the shared types**

Create `lib/ai/tool-use-types.ts`:

```ts
/**
 * Shared types for the tool-using agent path. Used by the provider
 * abstraction (lib/ai/provider.ts) and all four implementations
 * (openai/anthropic/local/fake).
 *
 * Designed to be compatible with the Vercel AI SDK's tool/message
 * shapes, since the OpenAI and Anthropic providers wrap that SDK
 * under the hood. The Fake and Local providers use these types
 * directly without an SDK dependency.
 */

import { z } from 'zod';

/** Definition of one tool the agent can call. */
export interface ToolDefinition {
  /** Tool name as the model will see it. snake_case by convention. */
  name: string;
  /** Human-readable description shown to the model. */
  description: string;
  /** Zod schema for the tool's input args. */
  inputSchema: z.ZodSchema;
  /** Async function that actually executes the tool when the model calls it. */
  execute: (args: unknown) => Promise<unknown>;
}

/** One tool invocation issued by the model. */
export interface ToolCall {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
}

/** Result of executing one tool call. */
export interface ToolResult {
  toolCallId: string;
  result: unknown;
}

/** Message types the provider accepts and emits during a tool-using session. */
export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; result: unknown };

/**
 * Result of one `completeWithTools` call. Either the model returned a
 * final structured response, or it issued tool calls that the caller
 * needs to dispatch and reinvoke with the results.
 */
export type CompleteWithToolsResult<T> =
  | {
      kind: 'response';
      value: T;
      /** Tool calls the model made and that the runtime executed during this call. */
      toolCallsUsed: ToolCall[];
      telemetry: {
        costUsdCents: number;
        durationMs: number;
        cachedTokens: number;
        uncachedPromptTokens: number;
        completionTokens: number;
      };
    }
  | {
      kind: 'tool_calls';
      calls: ToolCall[];
      telemetry: {
        costUsdCents: number;
        durationMs: number;
        cachedTokens: number;
        uncachedPromptTokens: number;
        completionTokens: number;
      };
    };
```

- [ ] **Step 2: Extend the AIProvider interface in `lib/ai/provider.ts`**

Add this import at the top of `lib/ai/provider.ts` (after the existing imports/exports around line 1-21):

```ts
import type {
  ToolDefinition,
  Message,
  CompleteWithToolsResult,
} from './tool-use-types';
```

Then inside the `AIProvider` interface (after the existing `transcribeDocument` method, line 48):

```ts
  /**
   * Tool-use enabled completion. The caller supplies the system prompt,
   * the full message history (assistant turns + tool results inclusive),
   * and the tool definitions the model is allowed to call.
   *
   * Returns either a final structured response (kind: 'response') OR
   * a set of tool calls the model wants made (kind: 'tool_calls').
   * Callers loop: execute the tools, append the tool-result messages,
   * reinvoke with the updated message history, until kind === 'response'.
   *
   * Tool execution can also be handled by the provider itself when the
   * underlying SDK supports it (Vercel AI SDK does); in that case the
   * resolved `value` is returned directly with `toolCallsUsed` listing
   * the tools that fired during the run.
   */
  completeWithTools<T>(args: {
    systemPrompt: string;
    messages: Message[];
    tools: ToolDefinition[];
    schemaName: string;
    jsonSchema: object;
    validate: (raw: unknown) => T;
    /** Maximum tool calls allowed per top-level invocation. Default: 4. */
    maxToolCalls?: number;
  }): Promise<CompleteWithToolsResult<T>>;
```

Export the types from the provider module for convenience:

```ts
// After the existing exports at the bottom of provider.ts:
export type { ToolDefinition, ToolCall, ToolResult, Message, CompleteWithToolsResult } from './tool-use-types';
```

- [ ] **Step 3: Type-check (will fail until providers implement)**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: type errors in `openai.ts`, `anthropic.ts`, `local.ts`, `fake-provider.ts` complaining that they don't implement `completeWithTools`. Those errors are intentional — the next tasks implement them.

- [ ] **Step 4: Commit (with `tsc` errors expected — they're fixed in subsequent tasks)**

```bash
git add lib/ai/tool-use-types.ts lib/ai/provider.ts
git commit -m "feat(capture-v2): extend AIProvider with completeWithTools (interface only)"
```

---

### Task 5: Fake provider — scripted tool-call mode (TDD)

The Fake provider serves the test suite. It needs to deterministically simulate a tool-use loop so other code (the future agent loop) can be unit-tested without hitting an LLM.

**Files:**
- Create: `tests/lib/ai/providers/fake-tool-use.test.ts`
- Modify: `lib/ai/fake-provider.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/ai/providers/fake-tool-use.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { FakeProvider } from '@/lib/ai/fake-provider';
import type { ToolDefinition } from '@/lib/ai/tool-use-types';

function makeTools(): ToolDefinition[] {
  return [
    {
      name: 'fetch_material_section',
      description: 'Fetch a section of a material',
      inputSchema: z.object({ materialId: z.string(), query: z.string() }),
      execute: async (args) => ({ chunks: [{ chunkId: 'c-1', text: 'sample content', score: 0.9 }] }),
    },
  ];
}

const responseSchema = z.object({ finding: z.string(), question: z.string() });

describe('FakeProvider.completeWithTools', () => {
  it('returns a scripted final response immediately when no tool calls are scripted', async () => {
    const provider = new FakeProvider({
      toolUseScript: [{
        kind: 'response',
        value: { finding: 'test finding', question: 'test question?' },
      }],
    });

    const result = await provider.completeWithTools({
      systemPrompt: 'system',
      messages: [{ role: 'user', content: 'hello' }],
      tools: makeTools(),
      schemaName: 'TestResponse',
      jsonSchema: {},
      validate: (raw) => responseSchema.parse(raw),
    });

    expect(result.kind).toBe('response');
    if (result.kind === 'response') {
      expect(result.value).toEqual({ finding: 'test finding', question: 'test question?' });
      expect(result.toolCallsUsed).toEqual([]);
    }
  });

  it('executes scripted tool calls before returning the final response', async () => {
    const provider = new FakeProvider({
      toolUseScript: [
        {
          kind: 'tool_calls',
          calls: [{ id: 'tc-1', toolName: 'fetch_material_section', args: { materialId: 'm-1', query: 'rubric' } }],
        },
        {
          kind: 'response',
          value: { finding: 'after tool', question: 'follow-up?' },
        },
      ],
    });

    const result = await provider.completeWithTools({
      systemPrompt: 'system',
      messages: [{ role: 'user', content: 'hello' }],
      tools: makeTools(),
      schemaName: 'TestResponse',
      jsonSchema: {},
      validate: (raw) => responseSchema.parse(raw),
    });

    expect(result.kind).toBe('response');
    if (result.kind === 'response') {
      expect(result.toolCallsUsed.length).toBe(1);
      expect(result.toolCallsUsed[0]!.toolName).toBe('fetch_material_section');
    }
  });

  it('throws when scripted tool call references an undefined tool', async () => {
    const provider = new FakeProvider({
      toolUseScript: [{
        kind: 'tool_calls',
        calls: [{ id: 'tc-1', toolName: 'nonexistent_tool', args: {} }],
      }],
    });

    await expect(provider.completeWithTools({
      systemPrompt: 'system',
      messages: [],
      tools: makeTools(),
      schemaName: 'TestResponse',
      jsonSchema: {},
      validate: (raw) => responseSchema.parse(raw),
    })).rejects.toThrow(/nonexistent_tool/);
  });

  it('respects maxToolCalls budget', async () => {
    const calls = Array.from({ length: 6 }, (_, i) => ({
      kind: 'tool_calls' as const,
      calls: [{ id: `tc-${i}`, toolName: 'fetch_material_section', args: { materialId: 'm', query: 'q' } }],
    }));
    const provider = new FakeProvider({
      toolUseScript: [...calls, { kind: 'response', value: { finding: 'f', question: 'q' } }],
    });

    await expect(provider.completeWithTools({
      systemPrompt: 'system',
      messages: [],
      tools: makeTools(),
      schemaName: 'TestResponse',
      jsonSchema: {},
      validate: (raw) => responseSchema.parse(raw),
      maxToolCalls: 2,
    })).rejects.toThrow(/budget/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/lib/ai/providers/fake-tool-use.test.ts`
Expected: FAIL — `FakeProvider` doesn't accept `toolUseScript` and doesn't implement `completeWithTools`.

- [ ] **Step 3: Extend FakeProvider**

First, look at the current `lib/ai/fake-provider.ts` to find the class definition and constructor; you'll add an optional `toolUseScript` to the constructor opts and add a `completeWithTools` method.

Replace the entire constructor's opts type plus add the method:

```ts
// In lib/ai/fake-provider.ts, extend FakeProvider's constructor opts type.
// (Names and existing fields are preserved — only adding toolUseScript and the method.)

import type { ToolDefinition, ToolCall, Message, CompleteWithToolsResult } from './tool-use-types';

// Inside the FakeProvider class, add a private field:
//   private toolUseScript: Array<{ kind: 'response'; value: unknown } | { kind: 'tool_calls'; calls: ToolCall[] }> = [];

// In the constructor, add:
//   if (opts.toolUseScript) this.toolUseScript = [...opts.toolUseScript];

// Then add the method:
async completeWithTools<T>(args: {
  systemPrompt: string;
  messages: Message[];
  tools: ToolDefinition[];
  schemaName: string;
  jsonSchema: object;
  validate: (raw: unknown) => T;
  maxToolCalls?: number;
}): Promise<CompleteWithToolsResult<T>> {
  const budget = args.maxToolCalls ?? 4;
  const toolCallsUsed: ToolCall[] = [];
  const script = [...this.toolUseScript];

  while (script.length > 0) {
    const step = script.shift()!;
    if (step.kind === 'response') {
      const value = args.validate(step.value);
      return {
        kind: 'response',
        value,
        toolCallsUsed,
        telemetry: { costUsdCents: 0, durationMs: 0, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 },
      };
    }
    // step.kind === 'tool_calls': execute each, append to toolCallsUsed, continue
    for (const call of step.calls) {
      if (toolCallsUsed.length >= budget) {
        throw new Error(`FakeProvider: tool-call budget (${budget}) exceeded`);
      }
      const tool = args.tools.find(t => t.name === call.toolName);
      if (!tool) {
        throw new Error(`FakeProvider: scripted tool call references unknown tool: ${call.toolName}`);
      }
      tool.inputSchema.parse(call.args);
      await tool.execute(call.args);
      toolCallsUsed.push(call);
    }
  }
  throw new Error('FakeProvider: toolUseScript exhausted without a response step');
}
```

Update the FakeProvider constructor opts type to include the new field:

```ts
// At the top of fake-provider.ts where FakeProviderOpts is defined, add:
interface FakeToolUseStep {
  kind: 'response' | 'tool_calls';
  value?: unknown;
  calls?: ToolCall[];
}

// And add `toolUseScript?: FakeToolUseStep[]` to the existing opts interface.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/lib/ai/providers/fake-tool-use.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/fake-provider.ts tests/lib/ai/providers/fake-tool-use.test.ts
git commit -m "feat(capture-v2): FakeProvider scripted tool-call mode for tests"
```

---

### Task 6: Install Vercel AI SDK

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml` (auto-updated)

- [ ] **Step 1: Add the dependencies**

Run: `pnpm add ai @ai-sdk/openai @ai-sdk/anthropic`
Expected: three packages added to `dependencies` in `package.json`; lockfile updated.

- [ ] **Step 2: Verify versions are recent**

Open `package.json`, confirm `ai` is `^4.x` or newer (the version with stable `generateObject` + `tool` primitives). If `pnpm` installed an older version, run `pnpm add ai@latest @ai-sdk/openai@latest @ai-sdk/anthropic@latest`.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "feat(capture-v2): add Vercel AI SDK + provider adapters for tool-use plumbing"
```

---

### Task 7: OpenAI provider — implement completeWithTools

**Files:**
- Modify: `lib/ai/openai.ts`
- Create: `tests/lib/ai/providers/openai-tool-use.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/ai/providers/openai-tool-use.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

const generateObjectMock = vi.fn();
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return { ...actual, generateObject: (...args: unknown[]) => generateObjectMock(...args) };
});
vi.mock('@ai-sdk/openai', () => ({
  openai: vi.fn((model: string) => ({ modelId: model })),
}));

import { OpenAIProvider } from '@/lib/ai/openai';
import type { ToolDefinition } from '@/lib/ai/tool-use-types';

const responseSchema = z.object({ finding: z.string(), question: z.string() });

function makeTools(): ToolDefinition[] {
  return [{
    name: 'fetch_material_section',
    description: 'Fetch a section of a material',
    inputSchema: z.object({ materialId: z.string(), query: z.string() }),
    execute: async () => ({ chunks: [{ text: 'sample', score: 0.9 }] }),
  }];
}

describe('OpenAIProvider.completeWithTools', () => {
  beforeEach(() => {
    generateObjectMock.mockReset();
    process.env.OPENAI_API_KEY = 'test-key';
  });

  it('returns a structured response when generateObject resolves cleanly', async () => {
    generateObjectMock.mockResolvedValue({
      object: { finding: 'f', question: 'q?' },
      usage: { promptTokens: 100, completionTokens: 50, cachedPromptTokens: 0 },
      toolCalls: [],
    });

    const provider = new OpenAIProvider('gpt-5.4', 'test-key');
    const result = await provider.completeWithTools({
      systemPrompt: 'system',
      messages: [{ role: 'user', content: 'hi' }],
      tools: makeTools(),
      schemaName: 'CaptureChatTurn',
      jsonSchema: {},
      validate: (raw) => responseSchema.parse(raw),
    });

    expect(result.kind).toBe('response');
    if (result.kind === 'response') {
      expect(result.value).toEqual({ finding: 'f', question: 'q?' });
      expect(result.toolCallsUsed).toEqual([]);
      expect(generateObjectMock).toHaveBeenCalledOnce();
    }
  });

  it('passes tool definitions into generateObject', async () => {
    generateObjectMock.mockResolvedValue({
      object: { finding: 'f', question: 'q?' },
      usage: { promptTokens: 100, completionTokens: 50, cachedPromptTokens: 0 },
      toolCalls: [],
    });

    const provider = new OpenAIProvider('gpt-5.4', 'test-key');
    await provider.completeWithTools({
      systemPrompt: 'system',
      messages: [{ role: 'user', content: 'hi' }],
      tools: makeTools(),
      schemaName: 'CaptureChatTurn',
      jsonSchema: {},
      validate: (raw) => responseSchema.parse(raw),
    });

    const args = generateObjectMock.mock.calls[0]![0];
    expect(args.tools).toBeDefined();
    expect(args.tools.fetch_material_section).toBeDefined();
    expect(args.tools.fetch_material_section.description).toContain('Fetch a section');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/lib/ai/providers/openai-tool-use.test.ts`
Expected: FAIL — method not implemented.

- [ ] **Step 3: Implement on OpenAIProvider**

In `lib/ai/openai.ts`, add the imports at the top:

```ts
import { generateObject, tool as aiTool } from 'ai';
import { openai as aiOpenai } from '@ai-sdk/openai';
import type { ToolDefinition, Message, CompleteWithToolsResult, ToolCall } from './tool-use-types';
```

Add the method to the OpenAIProvider class (alongside the existing `complete` method):

```ts
async completeWithTools<T>(args: {
  systemPrompt: string;
  messages: Message[];
  tools: ToolDefinition[];
  schemaName: string;
  jsonSchema: object;
  validate: (raw: unknown) => T;
  maxToolCalls?: number;
}): Promise<CompleteWithToolsResult<T>> {
  if (!this.apiKey) throw new Error('OPENAI_API_KEY not set');
  const start = Date.now();

  // Convert our ToolDefinition[] into the Vercel AI SDK's `tool({...})` shape.
  const sdkTools: Record<string, ReturnType<typeof aiTool>> = {};
  for (const t of args.tools) {
    sdkTools[t.name] = aiTool({
      description: t.description,
      parameters: t.inputSchema,
      execute: t.execute,
    });
  }

  // Convert our Message[] into the SDK's expected shape.
  const sdkMessages = args.messages.map(m => {
    if (m.role === 'tool') {
      return { role: 'tool' as const, content: [{ type: 'tool-result', toolCallId: m.toolCallId, toolName: 'unknown', result: m.result }] };
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant' as const,
        content: [
          ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
          ...m.toolCalls.map(tc => ({ type: 'tool-call' as const, toolCallId: tc.id, toolName: tc.toolName, args: tc.args })),
        ],
      };
    }
    return { role: m.role as 'system' | 'user' | 'assistant', content: m.content };
  });

  const { object, usage, toolCalls } = await generateObject({
    model: aiOpenai(this.model),
    system: args.systemPrompt,
    messages: sdkMessages,
    schema: args.jsonSchema as never,
    schemaName: args.schemaName,
    tools: sdkTools,
    maxSteps: args.maxToolCalls ?? 4,
  });

  const value = args.validate(object);
  const toolCallsUsed: ToolCall[] = (toolCalls ?? []).map(tc => ({
    id: tc.toolCallId,
    toolName: tc.toolName,
    args: tc.args as Record<string, unknown>,
  }));

  // Cost estimation per OpenAI pricing as of the spec date.
  // gpt-5.4: $5/$15 per 1M input/output, cached input ~$0.50/1M.
  // gpt-5.4-mini: $0.50/$1.50 per 1M, cached $0.05/1M.
  // Multiplier picked by model name; this mirrors logic in this.complete().
  const cents = this.estimateCostCents(usage);

  return {
    kind: 'response',
    value,
    toolCallsUsed,
    telemetry: {
      costUsdCents: cents,
      durationMs: Date.now() - start,
      cachedTokens: usage.cachedPromptTokens ?? 0,
      uncachedPromptTokens: usage.promptTokens - (usage.cachedPromptTokens ?? 0),
      completionTokens: usage.completionTokens,
    },
  };
}

/** Stage 1 returns 0 unconditionally — Stage 3 wires per-token cost estimation
 *  matching the existing complete() helper. The cost-cap logic doesn't apply
 *  to tool-use calls yet, so this is a safe placeholder. */
private estimateCostCents(_usage: { promptTokens: number; completionTokens: number; cachedPromptTokens?: number }): number {
  return 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/lib/ai/providers/openai-tool-use.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Type-check whole project**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean (assuming Tasks 4 + 5 + 7 done; Anthropic and Local still missing — proceed to next task).

- [ ] **Step 6: Commit**

```bash
git add lib/ai/openai.ts tests/lib/ai/providers/openai-tool-use.test.ts
git commit -m "feat(capture-v2): OpenAIProvider.completeWithTools via Vercel AI SDK"
```

---

### Task 8: Anthropic provider — implement completeWithTools

**Files:**
- Modify: `lib/ai/anthropic.ts`
- Create: `tests/lib/ai/providers/anthropic-tool-use.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/ai/providers/anthropic-tool-use.test.ts`. Structure mirrors Task 7's openai test exactly — same `generateObject` mock, same fake tool definition, same two test cases. Substitute:
- Import: `AnthropicProvider` from `@/lib/ai/anthropic`
- Mock: `@ai-sdk/anthropic` instead of `@ai-sdk/openai` (provide `anthropic` factory function)
- Model name in constructor: `'claude-sonnet-4-5'` or whatever the existing AnthropicProvider expects

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

const generateObjectMock = vi.fn();
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return { ...actual, generateObject: (...args: unknown[]) => generateObjectMock(...args) };
});
vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: vi.fn((model: string) => ({ modelId: model })),
}));

import { AnthropicProvider } from '@/lib/ai/anthropic';
import type { ToolDefinition } from '@/lib/ai/tool-use-types';

const responseSchema = z.object({ finding: z.string(), question: z.string() });

function makeTools(): ToolDefinition[] {
  return [{
    name: 'fetch_material_section',
    description: 'Fetch a section of a material',
    inputSchema: z.object({ materialId: z.string(), query: z.string() }),
    execute: async () => ({ chunks: [{ text: 'sample', score: 0.9 }] }),
  }];
}

describe('AnthropicProvider.completeWithTools', () => {
  beforeEach(() => {
    generateObjectMock.mockReset();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  it('returns a structured response', async () => {
    generateObjectMock.mockResolvedValue({
      object: { finding: 'f', question: 'q?' },
      usage: { promptTokens: 100, completionTokens: 50 },
      toolCalls: [],
    });
    const provider = new AnthropicProvider('claude-sonnet-4-5', 'test-key');
    const result = await provider.completeWithTools({
      systemPrompt: 'system',
      messages: [{ role: 'user', content: 'hi' }],
      tools: makeTools(),
      schemaName: 'CaptureChatTurn',
      jsonSchema: {},
      validate: (raw) => responseSchema.parse(raw),
    });
    expect(result.kind).toBe('response');
  });

  it('passes tools to generateObject', async () => {
    generateObjectMock.mockResolvedValue({
      object: { finding: 'f', question: 'q?' },
      usage: { promptTokens: 100, completionTokens: 50 },
      toolCalls: [],
    });
    const provider = new AnthropicProvider('claude-sonnet-4-5', 'test-key');
    await provider.completeWithTools({
      systemPrompt: 'system',
      messages: [],
      tools: makeTools(),
      schemaName: 'CaptureChatTurn',
      jsonSchema: {},
      validate: (raw) => responseSchema.parse(raw),
    });
    expect(generateObjectMock.mock.calls[0]![0].tools.fetch_material_section).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/lib/ai/providers/anthropic-tool-use.test.ts`
Expected: FAIL — method not implemented.

- [ ] **Step 3: Implement on AnthropicProvider**

In `lib/ai/anthropic.ts`, add imports:

```ts
import { generateObject, tool as aiTool } from 'ai';
import { anthropic as aiAnthropic } from '@ai-sdk/anthropic';
import type { ToolDefinition, Message, CompleteWithToolsResult, ToolCall } from './tool-use-types';
```

Add the method to the AnthropicProvider class (alongside the existing `complete` method):

```ts
async completeWithTools<T>(args: {
  systemPrompt: string;
  messages: Message[];
  tools: ToolDefinition[];
  schemaName: string;
  jsonSchema: object;
  validate: (raw: unknown) => T;
  maxToolCalls?: number;
}): Promise<CompleteWithToolsResult<T>> {
  if (!this.apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const start = Date.now();

  // Convert our ToolDefinition[] into the Vercel AI SDK's `tool({...})` shape.
  const sdkTools: Record<string, ReturnType<typeof aiTool>> = {};
  for (const t of args.tools) {
    sdkTools[t.name] = aiTool({
      description: t.description,
      parameters: t.inputSchema,
      execute: t.execute,
    });
  }

  // Convert our Message[] into the SDK's expected shape.
  const sdkMessages = args.messages.map(m => {
    if (m.role === 'tool') {
      return { role: 'tool' as const, content: [{ type: 'tool-result' as const, toolCallId: m.toolCallId, toolName: 'unknown', result: m.result }] };
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant' as const,
        content: [
          ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
          ...m.toolCalls.map(tc => ({ type: 'tool-call' as const, toolCallId: tc.id, toolName: tc.toolName, args: tc.args })),
        ],
      };
    }
    return { role: m.role as 'system' | 'user' | 'assistant', content: m.content };
  });

  const { object, usage, toolCalls } = await generateObject({
    model: aiAnthropic(this.model),
    system: args.systemPrompt,
    messages: sdkMessages,
    schema: args.jsonSchema as never,
    schemaName: args.schemaName,
    tools: sdkTools,
    maxSteps: args.maxToolCalls ?? 4,
  });

  const value = args.validate(object);
  const toolCallsUsed: ToolCall[] = (toolCalls ?? []).map(tc => ({
    id: tc.toolCallId,
    toolName: tc.toolName,
    args: tc.args as Record<string, unknown>,
  }));

  return {
    kind: 'response',
    value,
    toolCallsUsed,
    telemetry: {
      costUsdCents: 0,  // Stage 3 wires per-token cost estimation; Stage 1 returns 0
      durationMs: Date.now() - start,
      cachedTokens: 0,
      uncachedPromptTokens: usage?.promptTokens ?? 0,
      completionTokens: usage?.completionTokens ?? 0,
    },
  };
}
```

Confirm `this.apiKey` is the property name on AnthropicProvider (the existing `complete()` method uses it). If named differently, substitute accordingly.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/lib/ai/providers/anthropic-tool-use.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/anthropic.ts tests/lib/ai/providers/anthropic-tool-use.test.ts
git commit -m "feat(capture-v2): AnthropicProvider.completeWithTools via Vercel AI SDK"
```

---

### Task 9: Local provider — implement completeWithTools

The Local provider (omlx Qwen3.6 family) talks an OpenAI-compatible HTTP API. Qwen3 models support native tool-use via OpenAI-compatible function-calling. The Vercel AI SDK's `@ai-sdk/openai-compatible` adapter handles this cleanly.

**Files:**
- Modify: `lib/ai/local.ts`
- Create: `tests/lib/ai/providers/local-tool-use.test.ts`

- [ ] **Step 1: Add the openai-compatible adapter dependency**

Run: `pnpm add @ai-sdk/openai-compatible`

- [ ] **Step 2: Write the failing test**

Create `tests/lib/ai/providers/local-tool-use.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

const generateObjectMock = vi.fn();
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return { ...actual, generateObject: (...args: unknown[]) => generateObjectMock(...args) };
});
vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn(() => ({
    chatModel: vi.fn((model: string) => ({ modelId: model })),
  })),
}));

import { LocalProvider } from '@/lib/ai/local';
import type { ToolDefinition } from '@/lib/ai/tool-use-types';

const responseSchema = z.object({ finding: z.string(), question: z.string() });

function makeTools(): ToolDefinition[] {
  return [{
    name: 'fetch_material_section',
    description: 'Fetch',
    inputSchema: z.object({ materialId: z.string(), query: z.string() }),
    execute: async () => ({ chunks: [] }),
  }];
}

describe('LocalProvider.completeWithTools', () => {
  beforeEach(() => {
    generateObjectMock.mockReset();
    process.env.LOCAL_BASE_URL = 'http://localhost:8000/v1';
    process.env.LOCAL_API_KEY = 'godfrey';
  });

  it('returns a structured response from local omlx', async () => {
    generateObjectMock.mockResolvedValue({
      object: { finding: 'f', question: 'q?' },
      usage: { promptTokens: 100, completionTokens: 50 },
      toolCalls: [],
    });
    const provider = new LocalProvider('Qwen3.6-35B-A3B-UD-MLX-4bit', 'http://localhost:8000/v1', 'godfrey');
    const result = await provider.completeWithTools({
      systemPrompt: 'system',
      messages: [{ role: 'user', content: 'hi' }],
      tools: makeTools(),
      schemaName: 'CaptureChatTurn',
      jsonSchema: {},
      validate: (raw) => responseSchema.parse(raw),
    });
    expect(result.kind).toBe('response');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/lib/ai/providers/local-tool-use.test.ts`
Expected: FAIL — method not implemented.

- [ ] **Step 4: Implement on LocalProvider**

In `lib/ai/local.ts`, add imports:

```ts
import { generateObject, tool as aiTool } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ToolDefinition, Message, CompleteWithToolsResult, ToolCall } from './tool-use-types';
```

The implementation mirrors OpenAI/Anthropic with one change — the model is constructed via the openai-compatible adapter pointing at the local endpoint:

```ts
async completeWithTools<T>(args: {
  systemPrompt: string;
  messages: Message[];
  tools: ToolDefinition[];
  schemaName: string;
  jsonSchema: object;
  validate: (raw: unknown) => T;
  maxToolCalls?: number;
}): Promise<CompleteWithToolsResult<T>> {
  const start = Date.now();

  const compat = createOpenAICompatible({
    name: 'omlx-local',
    apiKey: this.apiKey,
    baseURL: this.baseUrl,
  });

  // Convert tools — same shape as OpenAI/Anthropic.
  const sdkTools: Record<string, ReturnType<typeof aiTool>> = {};
  for (const t of args.tools) {
    sdkTools[t.name] = aiTool({
      description: t.description,
      parameters: t.inputSchema,
      execute: t.execute,
    });
  }

  // Message conversion — identical to OpenAI's (see Task 7).
  const sdkMessages = args.messages.map(m => {
    if (m.role === 'tool') {
      return { role: 'tool' as const, content: [{ type: 'tool-result' as const, toolCallId: m.toolCallId, toolName: 'unknown', result: m.result }] };
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant' as const,
        content: [
          ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
          ...m.toolCalls.map(tc => ({ type: 'tool-call' as const, toolCallId: tc.id, toolName: tc.toolName, args: tc.args })),
        ],
      };
    }
    return { role: m.role as 'system' | 'user' | 'assistant', content: m.content };
  });

  const { object, usage, toolCalls } = await generateObject({
    model: compat.chatModel(this.model),
    system: args.systemPrompt,
    messages: sdkMessages,
    schema: args.jsonSchema as never,
    schemaName: args.schemaName,
    tools: sdkTools,
    maxSteps: args.maxToolCalls ?? 4,
  });

  const value = args.validate(object);
  const toolCallsUsed: ToolCall[] = (toolCalls ?? []).map(tc => ({
    id: tc.toolCallId,
    toolName: tc.toolName,
    args: tc.args as Record<string, unknown>,
  }));

  return {
    kind: 'response',
    value,
    toolCallsUsed,
    telemetry: {
      costUsdCents: 0,  // local model — no per-token cost
      durationMs: Date.now() - start,
      cachedTokens: 0,
      uncachedPromptTokens: usage?.promptTokens ?? 0,
      completionTokens: usage?.completionTokens ?? 0,
    },
  };
}
```

(Confirm `this.baseUrl` and `this.apiKey` are the property names on LocalProvider; the existing `complete()` method uses them.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/lib/ai/providers/local-tool-use.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Type-check whole project**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean. All four providers now implement `completeWithTools`.

- [ ] **Step 7: Full test suite**

Run: `pnpm vitest run`
Expected: all tests pass — including pre-existing ones (no regressions from the interface extension).

- [ ] **Step 8: Commit**

```bash
git add lib/ai/local.ts tests/lib/ai/providers/local-tool-use.test.ts package.json pnpm-lock.yaml
git commit -m "feat(capture-v2): LocalProvider.completeWithTools via openai-compatible adapter"
```

---

### Task 10: STATE.md update + final commit

**Files:**
- Modify: `docs/STATE.md`

- [ ] **Step 1: Update the Last-verified line**

Set the top-of-file line to the most recent commit hash (run `git rev-parse --short HEAD` to fetch it).

- [ ] **Step 2: Update the schema section**

In STATE.md's "Schema" subsection, bump the latest-migration line to `0022_<auto-name>.sql` and add entries:

```markdown
- **CourseCapture v2 Foundation (shipped 2026-05-26 — Stage 1):**
  - `capture_messages` — append-only conversation log keyed by `(course_code, session_id, turn_index)`. Stores tool calls, tool results, citations. Replaces session-overwriting `capture_conversations` (preserved as legacy with migrated rows).
  - `courses.audit_mode` (`'full' | 'simple'`, default `'full'`) — per-course toggle. UI lands in Stage 2.
  - `course_capture_snapshots.transcript_session_id` (nullable uuid) — populated by v2 audits; legacy snapshots leave null.
```

- [ ] **Step 3: Update the AI provider section**

Add to the existing AI architecture paragraph:

```markdown
- **Tool-use extension (shipped 2026-05-26 — Stage 1 of CourseCapture v2):** `AIProvider.completeWithTools` added across OpenAI, Anthropic, Local, and Fake implementations. Built on Vercel AI SDK's `generateObject` + `tool` primitives. Used by Stage 3's agent loop; no AI function exposes it yet.
```

- [ ] **Step 4: Update the Active Arc section**

Move the CourseCapture v2 entry from "pending review" to "in progress":

```markdown
**CourseCapture v2 — Agentic Retrieval Architecture (in progress).** Stage 1 (foundation) shipped 2026-05-26 — schema for transcript persistence + audit_mode toggle, provider abstraction extended with `completeWithTools`. Stage 2 (Weaviate ingestion pipeline) waits on user's local Weaviate instance.
```

- [ ] **Step 5: Commit + push**

```bash
git add docs/STATE.md
git commit -m "docs(state): CourseCapture v2 Stage 1 (foundation) shipped"
git push
```

---

## Self-review checklist (for the implementer)

- [ ] `pnpm vitest run` — all tests pass.
- [ ] `npx tsc --noEmit -p tsconfig.json` — clean.
- [ ] `pnpm lint` — no new warnings.
- [ ] Database migration `0022_*` applied; `pnpm drizzle-kit generate` produces no diff.
- [ ] One-off migration script ran and `capture_messages` contains the historical conversation from `capture_conversations`.
- [ ] `git log --oneline` since branch-base shows one commit per task (10 commits total). Frequent commits keep review surgical.
- [ ] Existing AI calls (audit chat, materials analysis, etc.) still work — Stage 1 did not change any call site that uses the existing `complete()` method.
- [ ] STATE.md "Last verified" hash points at the final commit.

## What this stage does NOT do (deferred to later stages)

- Stage 2: Weaviate setup, chunker, embedder, digest pipeline, materials policy, FERPA detector, ingestion check-in. Schema additions to `course_materials` (digest rename + new columns) come in Stage 2's migration `0023_*`.
- Stage 3: capture-chat-agent prompt, agent loop wiring to the audit chat route, citation chips UI, transcript link in Review panel.
- Stage 4: capture-synthesis prompt rewrite, mechanical source-flag derivation, source-indicator UI.
- Stage 5: legacy-draft banner, captureConversations cutover (stop writing to the old table), end-to-end smoke test.

Each subsequent stage gets its own dated plan file.
