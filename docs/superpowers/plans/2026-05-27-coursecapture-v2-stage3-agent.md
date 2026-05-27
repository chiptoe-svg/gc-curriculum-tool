# CourseCapture v2 — Stage 3 Implementation Plan (Audit Agent Loop)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the audit-chat agent loop. Faculty types a message; the agent receives at-rest context (catalog + per-material digests + prereq profiles + conversation history), decides whether to retrieve detail chunks via tools (Weaviate-backed), generates a structured response with citations, and persists every turn into `capture_messages` (append-only, session-scoped). Each finding carries an evidence trail; synthesis (Stage 4) derives the source flag mechanically from citation types.

**Architecture:** Stage 1 shipped the `completeWithTools` provider method + `capture_messages` append-only log. Stage 2a-2b shipped the in-memory + Weaviate vector store, the ingestion pipeline, and the Materials UI. Stage 3 connects the dots — wire a new AI function (`capture-chat-agent`) that loads at-rest context + history, calls `completeWithTools` with the three retrieval tools defined in the spec, parses the structured response, persists messages + citations, and returns. The existing v1 chat path (`captureChatTurn` at `lib/ai/analyze/capture-chat.ts`) stays as the fallback when `COURSECAPTURE_V2_INGESTION` is off OR `audit_mode === 'simple'`.

**Tech Stack:** TypeScript strict · Vitest · `lib/ai/provider.ts` `completeWithTools` (Vercel AI SDK v6) · `lib/capture/vector-store-weaviate.ts` for retrieval · `lib/db/capture-messages-queries.ts` for persistence · campus `qwen3.6-35b-a3b-fp8` as the agent default (GLM-5.1 ruled out at ~4 tok/s).

**Spec adherence notes:**
- Spec Section "Phase B — Audit Chat as Agent" is the contract. Three tools (`list_materials`, `fetch_material_section`, `search_materials`), tool budget ≤ 2 per turn, structured per-turn response with `{finding, question, citations, readiness}`.
- Spec note "Audit-mode toggle (Simple)" — when `courses.audit_mode === 'simple'`, the agent runs WITHOUT retrieval tools and the materials digest layer is inlined into the prompt instead. We implement this as a no-tools branch through the same agent module.
- Spec note "Streaming preserved" — current v1 doesn't actually stream (it's a stateless POST that returns `{reply}`). Stage 3 also returns full-turn JSON. Streaming UX is a fake-it-client-side concession; revisit if faculty feedback warrants real streaming.

**Out of scope (Stage 4+):**
- Synthesis rewrite (`capture-scores.md` → `capture-synthesis.md` with mechanical source-flag derivation).
- Migration of legacy `captureConversations` rows into `capture_messages`.
- Real token streaming (current path is full-turn delivery; UI can fake-stream with a typing indicator).
- Nanoclaw integration (`feat/nanoclaw-bridge-tracer`-style external runtime; agent runs inline in our provider abstraction for v1).

---

## File structure

**Created in this plan:**
- `lib/ai/agent/audit-tools.ts` — `list_materials`, `fetch_material_section`, `search_materials` as `ToolDefinition[]` with Zod schemas + execute fns calling into the vector store / DB.
- `lib/ai/agent/audit-agent.ts` — the per-turn loop orchestrator. Takes `{sessionId, courseCode, userMessage, auditMode}`, loads context + history, calls `completeWithTools`, persists turns, returns structured response.
- `lib/ai/agent/audit-response-schema.ts` — Zod schema for the per-turn structured response (`{finding, question, citations[], readiness}`).
- `tests/lib/ai/agent/audit-tools.test.ts`
- `tests/lib/ai/agent/audit-agent.test.ts`
- `scripts/_one-off/stage3-smoke.ts` — end-to-end smoke on GC 4800 (untracked, per the precedent).

**Modified in this plan:**
- `lib/ai/function-settings.ts` — add `'capture-chat-agent'` function ID (default tier `default` for now; campus override sets the model).
- `lib/ai/prompts/load.ts` — already has `'capture-chat-agent'` (added when the prompt landed earlier).
- `app/api/capture/[code]/chat/route.ts` — branch on `COURSECAPTURE_V2_INGESTION === '1'` AND `course.audit_mode === 'full'` (or `'simple'`); when v2 is on, call `runAuditAgent` instead of `captureChatTurn`.
- `app/capture/[code]/CaptureChatPanel.tsx` — render citation chips under each assistant message.
- `docs/STATE.md` — Stage 3 shipped.

---

## Task list

### Task 1: Audit-response Zod schema

**Files:**
- Create: `lib/ai/agent/audit-response-schema.ts`

The spec's per-turn response shape:

```ts
{
  finding: string,
  question: string,
  citations: Array<{
    type: 'chunk' | 'instructor',
    chunkId?: string,
    messageId?: string,
    excerpt: string,
  }>,
  readiness: { score: number; covered: string[]; remaining: string[]; good_enough_to_generate: boolean },
}
```

- [ ] **Step 1: Write the schema**

```ts
// lib/ai/agent/audit-response-schema.ts
import { z } from 'zod';

const Citation = z.object({
  type: z.enum(['chunk', 'instructor']),
  chunkId: z.string().optional(),
  messageId: z.string().optional(),
  excerpt: z.string().max(200),
});

const Readiness = z.object({
  score: z.number().int().min(0).max(100),
  covered: z.array(z.string()),
  remaining: z.array(z.string()),
  good_enough_to_generate: z.boolean(),
});

export const AuditResponseSchema = z.object({
  finding: z.string(),
  question: z.string(),
  citations: z.array(Citation),
  readiness: Readiness,
});

export type AuditResponse = z.infer<typeof AuditResponseSchema>;
export type AuditCitation = z.infer<typeof Citation>;

// JSON-schema export for provider.complete*'s jsonSchema arg.
export const AuditResponseJsonSchema = {
  type: 'object',
  properties: {
    finding: { type: 'string' },
    question: { type: 'string' },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { enum: ['chunk', 'instructor'] },
          chunkId: { type: 'string' },
          messageId: { type: 'string' },
          excerpt: { type: 'string' },
        },
        required: ['type', 'excerpt'],
        additionalProperties: false,
      },
    },
    readiness: {
      type: 'object',
      properties: {
        score: { type: 'integer', minimum: 0, maximum: 100 },
        covered: { type: 'array', items: { type: 'string' } },
        remaining: { type: 'array', items: { type: 'string' } },
        good_enough_to_generate: { type: 'boolean' },
      },
      required: ['score', 'covered', 'remaining', 'good_enough_to_generate'],
      additionalProperties: false,
    },
  },
  required: ['finding', 'question', 'citations', 'readiness'],
  additionalProperties: false,
};
```

- [ ] **Step 2: Commit**

```
git add lib/ai/agent/audit-response-schema.ts
git commit -m "feat(agent): audit-chat per-turn response Zod schema"
```

(No unit tests for a pure schema; will be exercised by Tasks 2-3's mocks.)

---

### Task 2: Tool definitions + executors

**Files:**
- Create: `lib/ai/agent/audit-tools.ts`
- Create: `tests/lib/ai/agent/audit-tools.test.ts`

The three tools the agent can call. Each is a `ToolDefinition` (from `lib/ai/tool-use-types.ts`):

- `list_materials({ courseCode })` → `{ materials: Array<{ id, fileName, digest, ferpaRisk, included }> }`
- `fetch_material_section({ courseCode, materialId, query, k? })` → `{ chunks: SearchHit[] }`
- `search_materials({ courseCode, query, k? })` → `{ chunks: SearchHit[] }`

The latter two call into the vector store via `createVectorStore()` (which picks Weaviate when `VECTOR_STORE=weaviate`). They embed the `query` first via `embedText`.

- [ ] **Step 1: Write tests**

`tests/lib/ai/agent/audit-tools.test.ts`. Mock the vector store and DB; assert each tool's input schema validates, its execute fn calls the right backend, and its output shape matches.

For `list_materials`: mock `listMaterialsByCourse` to return materials with the new Stage 2a columns; verify the tool's output filters to included materials and only exposes `{id, fileName, digest, ferpaRisk, included}`.

For `fetch_material_section`: mock `embedText` to return a known vector; mock a vector store with `hybridSearch` returning two scripted hits; verify the tool calls `embedText(query)` then `hybridSearch(tenantForCourse(courseCode), {queryVector, queryText: query, k: 3, materialId})`.

For `search_materials`: same as above without the `materialId` filter.

- [ ] **Step 2: Implement**

```ts
// lib/ai/agent/audit-tools.ts
import { z } from 'zod';
import type { ToolDefinition } from '@/lib/ai/tool-use-types';
import { embedText } from '@/lib/ai/embeddings';
import { createVectorStore, tenantForCourse } from '@/lib/capture/vector-store';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';

export function buildAuditTools(courseCode: string): ToolDefinition[] {
  const tenant = tenantForCourse(courseCode);

  const list_materials: ToolDefinition = {
    name: 'list_materials',
    description:
      'List included materials for this course with their per-material digests. Useful when you need a fresh inventory glance; the digests are also in your at-rest context.',
    inputSchema: z.object({ courseCode: z.string() }),
    async execute(_args) {
      const rows = await listMaterialsByCourse(courseCode);
      const materials = rows
        .filter(m => !m.ignored && m.extractionStatus === 'ok')
        .map(m => ({
          id: m.id,
          fileName: m.fileName,
          digest: m.digest ?? '',
          ferpaRisk: m.ferpaRisk ?? 'low',
          included: !m.ignored,
        }));
      return { materials };
    },
  };

  const fetch_material_section: ToolDefinition = {
    name: 'fetch_material_section',
    description:
      'Hybrid search within ONE specific material. Returns detail chunks with parent-section context attached. Use when the digest mentions something and you need the exact wording or the chunk that contains it.',
    inputSchema: z.object({
      courseCode: z.string(),
      materialId: z.string(),
      query: z.string(),
      k: z.number().int().min(1).max(8).optional(),
    }),
    async execute(args) {
      const a = args as { courseCode: string; materialId: string; query: string; k?: number };
      const store = createVectorStore();
      const queryVector = await embedText(a.query);
      const chunks = await store.hybridSearch(tenant, {
        queryVector,
        queryText: a.query,
        k: a.k ?? 3,
        materialId: a.materialId,
      });
      return { chunks };
    },
  };

  const search_materials: ToolDefinition = {
    name: 'search_materials',
    description:
      "Hybrid search across all included materials in this course. Use when the conversation surfaces a question and you don't know which material would answer it.",
    inputSchema: z.object({
      courseCode: z.string(),
      query: z.string(),
      k: z.number().int().min(1).max(10).optional(),
    }),
    async execute(args) {
      const a = args as { courseCode: string; query: string; k?: number };
      const store = createVectorStore();
      const queryVector = await embedText(a.query);
      const chunks = await store.hybridSearch(tenant, {
        queryVector,
        queryText: a.query,
        k: a.k ?? 5,
      });
      return { chunks };
    },
  };

  return [list_materials, fetch_material_section, search_materials];
}
```

- [ ] **Step 3: Run tests + typecheck**

```
./node_modules/.bin/vitest run tests/lib/ai/agent/audit-tools.test.ts
./node_modules/.bin/tsc --noEmit 2>&1 | grep "audit-tools" | head
```

- [ ] **Step 4: Commit**

```
git add lib/ai/agent/audit-tools.ts tests/lib/ai/agent/audit-tools.test.ts
git commit -m "feat(agent): audit-chat tool definitions (list/fetch/search)"
```

---

### Task 3: Agent loop orchestrator

**Files:**
- Create: `lib/ai/agent/audit-agent.ts`
- Create: `tests/lib/ai/agent/audit-agent.test.ts`
- Modify: `lib/ai/function-settings.ts` — add `'capture-chat-agent'` function ID (default tier)
- Modify: `lib/ai/prompts/load.ts` — `'capture-chat-agent'` already added when the prompt landed

The orchestrator takes a faculty turn + session info, builds the full context (system prompt + at-rest material digests + history + new user message), calls `completeWithTools` with the audit tools, parses the response, persists assistant + tool turns to `capture_messages`, returns the structured response to the route.

- [ ] **Step 1: Add the function ID**

In `lib/ai/function-settings.ts`, append:
- `'capture-chat-agent'` to `AI_FUNCTION_IDS`
- `'capture-chat-agent': 'default'` to `DEFAULT_TIERS`
- Label: `'Audit chat agent (Stage 3 — tool-using auditor)'`
- Description: `'Per-turn agent loop for CourseCapture v2 audit chat; reads at-rest digests, retrieves chunks on demand, emits a structured finding + question + citations.'`

- [ ] **Step 2: Write the orchestrator**

```ts
// lib/ai/agent/audit-agent.ts
import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';
import type { Message } from '@/lib/ai/tool-use-types';
import { buildAuditTools } from './audit-tools';
import {
  AuditResponseSchema,
  AuditResponseJsonSchema,
  type AuditResponse,
} from './audit-response-schema';
import {
  appendMessage,
  getSessionMessages,
} from '@/lib/db/capture-messages-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { getCourseByCode } from '@/lib/db/courses-queries';

export interface AuditAgentInput {
  sessionId: string;
  courseCode: string;
  userMessage: string;
  auditMode: 'full' | 'simple';
}

export interface AuditAgentResult {
  response: AuditResponse;
  toolCallsUsed: number;
}

/**
 * Stage 3 audit-chat agent loop. Per faculty turn:
 *   1. Persist the new user message into capture_messages.
 *   2. Load at-rest context (course catalog + per-material digests).
 *   3. Load conversation history from capture_messages.
 *   4. Call completeWithTools with the tools enabled (audit_mode='full') or
 *      disabled (audit_mode='simple') + inlined digests.
 *   5. Parse the structured response.
 *   6. Persist the assistant turn (with citations) into capture_messages.
 *   7. Return the response to the route.
 */
export async function runAuditAgent(input: AuditAgentInput): Promise<AuditAgentResult> {
  const { sessionId, courseCode, userMessage, auditMode } = input;

  // 1. Persist the user turn first so it shows up in history immediately
  //    if the agent retries or fails partway through.
  await appendMessage({ sessionId, courseCode, role: 'user', content: userMessage });

  // 2 + 3. Load context + history in parallel.
  const [course, materials, history] = await Promise.all([
    getCourseByCode(courseCode),
    listMaterialsByCourse(courseCode),
    getSessionMessages({ sessionId }),
  ]);
  if (!course) throw new Error(`course not found: ${courseCode}`);

  // Build the at-rest digest block (sorted by fileName for stability).
  const includedMaterials = materials
    .filter(m => !m.ignored && m.extractionStatus === 'ok')
    .sort((a, b) => a.fileName.localeCompare(b.fileName));

  const catalogBlock = [
    `Course: ${course.code} — ${course.title}`,
    `Description: ${course.description ?? '(none)'}`,
    `Prerequisites: ${course.prerequisites ?? '(none)'}`,
    `Learning objectives: ${(course.learningObjectives ?? []).join('; ') || '(none)'}`,
    `Major projects: ${(course.majorProjects ?? []).join('; ') || '(none)'}`,
    `Declared incoming skills: ${(course.skillsRequired ?? []).join('; ') || '(none)'}`,
  ].join('\n');

  const digestBlock = includedMaterials
    .map(m => `--- ${m.fileName} (id=${m.id}) ---\n${m.digest ?? '(no digest)'}`)
    .join('\n\n');

  // 4. Construct messages for completeWithTools. History from DB → SDK shape.
  const messages: Message[] = [
    { role: 'user', content: `# Course catalog\n\n${catalogBlock}\n\n# Material digests\n\n${digestBlock}` },
    ...history
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : '',
      })),
    // Note: the user's new message is already in `history` from step 1.
  ];

  const systemPrompt = await loadPrompt('capture-chat-agent');
  const tools = auditMode === 'full' ? buildAuditTools(courseCode) : [];

  const provider = await getProviderForFunction('capture-chat-agent');
  const result = await provider.completeWithTools<AuditResponse>({
    systemPrompt,
    messages,
    tools,
    schemaName: 'audit_response',
    jsonSchema: AuditResponseJsonSchema,
    validate: AuditResponseSchema.parse,
    maxToolCalls: 2, // per-turn budget per spec
  });

  if (result.kind !== 'response') {
    throw new Error('agent loop did not converge — completeWithTools returned mid-loop tool_calls');
  }

  // 5. Persist the assistant turn with citations + tool calls used.
  await appendMessage({
    sessionId,
    courseCode,
    role: 'assistant',
    content: JSON.stringify(result.value),
    toolCalls: result.toolCallsUsed.length ? result.toolCallsUsed : null,
    citations: result.value.citations.length ? result.value.citations : null,
  });

  return { response: result.value, toolCallsUsed: result.toolCallsUsed.length };
}
```

- [ ] **Step 3: Write tests**

Tests in `tests/lib/ai/agent/audit-agent.test.ts`:

1. **Happy path (full mode).** Mock `getCourseByCode`, `listMaterialsByCourse`, `getSessionMessages`, `appendMessage`. Mock `getProviderForFunction` to return a stub whose `completeWithTools` returns a valid `AuditResponse`. Verify the assistant message is persisted with citations + tool calls.
2. **Simple mode skips tools.** auditMode='simple' → the tools array passed to `completeWithTools` is empty.
3. **User turn persisted first.** `appendMessage` is called with role='user' BEFORE the provider call.
4. **History fed in correct order.** Verify the `messages` array passed to `completeWithTools` starts with the at-rest context block, then the history in DB order.
5. **Course not found → throws.** `getCourseByCode` returns null → function throws.

- [ ] **Step 4: Run tests + typecheck**

- [ ] **Step 5: Commit**

```
git add lib/ai/agent/audit-agent.ts lib/ai/function-settings.ts tests/lib/ai/agent/audit-agent.test.ts
git commit -m "feat(agent): audit-chat agent loop orchestrator (capture-chat-agent function)"
```

---

### Task 4: Route handler — branch on v2 + audit_mode

**Files:**
- Modify: `app/api/capture/[code]/chat/route.ts`

The existing v1 route remains intact. Add a v2 branch: when `COURSECAPTURE_V2_INGESTION === '1'` AND `course.audit_mode === 'full'` (or `'simple'`), call `runAuditAgent` instead of `captureChatTurn`.

The v2 path needs:
- A `sessionId` — from request body. If not provided, the route starts a new session via `startNewSession`.
- The faculty's new user message — the last entry in `body.messages` (since v1 sends the full history).

- [ ] **Step 1: Extend the route**

Add at the top of POST after the rate-limit check:

```ts
import { runAuditAgent } from '@/lib/ai/agent/audit-agent';
import { startNewSession } from '@/lib/db/capture-messages-queries';

// ... existing rate-limit + course lookup ...

const v2Enabled =
  process.env.COURSECAPTURE_V2_INGESTION === '1' &&
  (course.auditMode === 'full' || course.auditMode === 'simple');

if (v2Enabled) {
  const sessionId = typeof body.sessionId === 'string' && body.sessionId.length
    ? body.sessionId
    : await startNewSession({ courseCode });
  const lastUserMessage = history.filter(m => m.role === 'user').slice(-1)[0]?.content;
  if (!lastUserMessage) {
    return NextResponse.json({ error: 'no user message in history' }, { status: 400 });
  }
  try {
    const { response, toolCallsUsed } = await runAuditAgent({
      sessionId,
      courseCode,
      userMessage: lastUserMessage,
      auditMode: course.auditMode as 'full' | 'simple',
    });
    return NextResponse.json({
      sessionId,
      reply: response.finding + '\n\n' + response.question,
      finding: response.finding,
      question: response.question,
      citations: response.citations,
      readiness: response.readiness,
      toolCallsUsed,
    });
  } catch (err) {
    console.error(`POST /api/capture/${courseCode}/chat (v2) failed`, err);
    return NextResponse.json({ error: 'agent loop failed' }, { status: 500 });
  }
}

// ... existing v1 path: captureChatTurn(context, history) ...
```

The v2 response shape is backward-compatible with v1's `{reply, readiness}` (it includes both) plus new fields `sessionId`, `finding`, `question`, `citations`, `toolCallsUsed`.

- [ ] **Step 2: Manual smoke (skip if no dev server)**

With `COURSECAPTURE_V2_INGESTION=1`, `VECTOR_STORE=weaviate`, `AI_PROVIDER=campus`, and GC 4800's `audit_mode='full'`:

```
curl -X POST -H "Content-Type: application/json" \
  -u "$FACULTY_BASIC_AUTH" \
  "http://127.0.0.1:3000/api/capture/GC%204800/chat?slug=$SLUG" \
  -d '{"messages":[{"role":"user","content":"What does the syllabus actually require students to do?"}]}'
```

Expected: a JSON response with `sessionId`, `finding`, `question`, `citations[]` (≥ 1), `readiness`. Then verify that `capture_messages` has 2 new rows (user + assistant).

- [ ] **Step 3: Commit**

```
git add app/api/capture/[code]/chat/route.ts
git commit -m "feat(agent): wire v2 audit-agent into /api/capture/[code]/chat (gated)"
```

---

### Task 5: UI — citation chips + session continuity

**Files:**
- Modify: `app/capture/[code]/CaptureChatPanel.tsx`

Render citation chips beneath each assistant message; thread `sessionId` through the chat state so subsequent turns continue the same session.

- [ ] **Step 1: Thread sessionId**

When `/api/capture/[code]/chat` returns `sessionId`, store it in component state. On subsequent requests, pass it back in the body. (v1 ignores `sessionId`; v2 uses it.)

- [ ] **Step 2: Citation chips**

For each assistant message that has `citations`, render a small horizontal row of chips below the message text. Each chip:
- Type label as a 2-letter monospace badge: `CH` for chunk, `IN` for instructor.
- Excerpt text (first 80 chars, trimmed; full text on hover via `title`).
- Click does NOT yet open a drawer; tooltip-only for v1. (Drawer is a future polish task.)

Match the existing CaptureChatPanel styling.

- [ ] **Step 3: Stream simulation (optional polish)**

If time permits: when the agent response arrives, render the `finding` first, pause ~400ms, then render the `question` — simulates a more conversational pace without real streaming. If not, render both immediately.

- [ ] **Step 4: Commit**

```
git add app/capture/[code]/CaptureChatPanel.tsx
git commit -m "feat(agent): CaptureChatPanel — citation chips + session continuity"
```

---

### Task 6: Live integration smoke

**Files:**
- Create: `scripts/_one-off/stage3-smoke.ts` (untracked, per the precedent)

End-to-end smoke against GC 4800: feed in a representative faculty question, watch the agent retrieve chunks, persist the turn, and respond with citations.

- [ ] **Step 1: Write the smoke**

The script:
1. Reads GC 4800's course + materials state.
2. Starts a new session via `startNewSession({ courseCode: 'GC 4800' })`.
3. Calls `runAuditAgent` directly (not through the HTTP route — simpler) with a fixture question like *"What does the syllabus actually require students to do — analyze, evaluate, or create?"*
4. Prints the response: finding, question, citations (with materialId + excerpt), readiness, tool call count.
5. Calls `runAuditAgent` again with a follow-up (`Are the major projects assessed individually or as a portfolio?`) and prints the same.
6. Cleans up: deletes the session's `capture_messages` rows so we don't leave test data.

Run: `AI_PROVIDER=campus VECTOR_STORE=weaviate COURSECAPTURE_V2_INGESTION=1 npx tsx --env-file=.env.local scripts/_one-off/stage3-smoke.ts`

Pass criteria:
- Agent produces a coherent finding tied to evidence (or honestly says it needs to ask).
- At least one turn shows tool_calls_used > 0 (retrieval happens).
- Citations array is non-empty when the agent cites materials.
- The two turns persist as 4 messages (2 user + 2 assistant) in `capture_messages`.
- Latency per turn is < 60s on qwen3.6-35b-a3b.

- [ ] **Step 2: No commit** (untracked).

---

### Task 7: STATE.md + cleanup

- [ ] **Step 1: Update STATE.md**

Flip Stage 3 status from "ahead" to "shipped". The current Stage 2 row in "Next-up → Spec'd" should be updated to note Stage 3 also done. The "Active arc" Stage 1 Foundation bullet should append: "Stage 3 shipped 2026-05-27 (audit-chat agent loop with tool-using retrieval against Weaviate, structured per-turn response with citations, capture-chat-agent function ID, session continuity, citation chips in the UI). Stage 4 (synthesis) and Stage 5 (legacy migration) remaining."

Add `capture-chat-agent` to the function-tier table.

- [ ] **Step 2: Final commit**

```
git add docs/STATE.md
git commit -m "chore(agent): STATE.md — Stage 3 shipped"
```

---

## Acceptance criteria

After all tasks complete:

1. `./node_modules/.bin/vitest run` is green (no new failures versus the Stage 2b baseline).
2. `./node_modules/.bin/tsc --noEmit` is green for everything under `lib/`, `app/`, `components/`, `tests/`.
3. With `COURSECAPTURE_V2_INGESTION=1` + `VECTOR_STORE=weaviate` + `AI_PROVIDER=campus`: `scripts/_one-off/stage3-smoke.ts` runs to completion, the agent retrieves chunks via at least one tool call, and the response carries ≥ 1 citation.
4. With `COURSECAPTURE_V2_INGESTION` unset, the existing v1 chat route (`captureChatTurn`) still works on GC 4800 — no regression.
5. With `COURSECAPTURE_V2_INGESTION=1` but `course.audit_mode='simple'`, the agent runs with tools disabled — `toolCallsUsed === 0` always.
6. `capture_messages` has paired user/assistant rows for every audit turn; citations stored as JSONB on the assistant row.
7. STATE.md reflects Stage 3 shipped.

## Out of scope (Stage 4 / 5)

- **Stage 4 — synthesis rewrite.** `capture-synthesis.md` system prompt; mechanical source-flag derivation (`'instructor' | 'materials' | 'inferred'` from citation types in transcript); update `capture-scores` AI function to consume the new shape.
- **Stage 5 — legacy migration.** One-off script to migrate `captureConversations` rows into `capture_messages` with synthesized session IDs; preserves transcript history for existing snapshots.
- Real token streaming.
- Nanoclaw container-based agent execution.
- Citation drawer UI (click chip → side panel with full chunk text).
