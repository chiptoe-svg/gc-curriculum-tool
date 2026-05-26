# CourseCapture v2 — Agentic Retrieval Architecture

**Date:** 2026-05-26
**Status:** Design — pending review before plan
**Supersedes:** The Phase 2 agent design at [`../plans/2026-05-22-phase2-agent-design.md`](../plans/2026-05-22-phase2-agent-design.md). Generalizes the [reference-compression plan](../plans/2026-05-25-capture-reference-compression.md)'s Tier 1 + Tier 2 future-directions sections into a built architecture.

---

## One-line

Replace today's "dump every material into the audit chat's context" pipeline with three discrete phases — per-material ingestion (chunk + digest + index), a tool-using audit agent that retrieves on demand, and synthesis with intrinsic provenance — so audit findings are grounded in citable evidence rather than inferred from materials silence.

## Background & motivation

Real data on the GC 4800 draft (and the absence of any confirmed snapshot anywhere in the database) surfaced three coupled problems with the current capture pipeline:

1. **Throw-everything-at-the-wall ingestion.** The current flow pulls every Canvas page + uploaded file + Google Doc + Drive PDF + YouTube transcript into one context bundle (145k tokens on GC 4800). With a small material set this is fine; at real-corpus scale it drowns the auditor in noise. Curated catalog data from the Google Sheet is mixed indistinguishably with rambling Canvas Syllabus duplicates and malformed Sheet imports.
2. **Audit conversation is structurally optional.** The scorer can produce a complete profile from materials alone, even when the chat had zero instructor input. GC 4800's `productive_failure_conditions` field reads as if instructor-quoted, but the conversation table contains a single assistant-opener message — the chat happened, but the transcript got overwritten by a subsequent session. From the outside, the finding is indistinguishable from fabrication.
3. **No durable transcript.** The `captureConversations` table is session-scoped — only the most recent session is preserved. The transcript that produced an existing draft is gone if a new session started after it. Reviewing how a finding was reached six months later is impossible.

These three failure modes are coupled because they share a root cause: the current architecture treats materials as a single context dump and the audit conversation as a thin presentational layer over scorer-side inference. The fix is structural, not prompt-side.

Today's reference-compression pipeline (`finalizeExtraction` → `material-summary` for long materials) is a partial mitigation for problem (1) but doesn't address (2) or (3). The deferred Phase 2 agent design ([`2026-05-22-phase2-agent-design.md`](../plans/2026-05-22-phase2-agent-design.md)) anticipated the right shape but was blocked on nanoclaw infrastructure. With the user's local agent infrastructure coming online and Weaviate as a shared retrieval backbone, the architectural reframe is now buildable.

The faculty-experience target: **the audit should feel the same as today** (same chat, same one-question-per-turn discipline, same three-paragraph format, same review-then-snapshot flow), but with citations under every finding, persistent transcripts linked to snapshots, and dramatically less noise in the auditor's context.

## Goals

1. **Materials are first-class.** Each material is ingested individually (extract → chunk → digest → index), curated where needed via auto-set-aside rules with always-overridable defaults, and validated through a lightweight ingestion check-in chat that only speaks when there's something to flag.
2. **Audit chat becomes a tool-using agent.** The auditor reads the per-material digest layer at-rest and retrieves specific chunks on demand through Weaviate hybrid search (vector + BM25). Per-turn context is bounded; retrieval is the only path to detail.
3. **Provenance is intrinsic, not bolted on.** Every chat-surfaced finding carries citations (chunk-level or transcript-turn-level) by structural commitment. Synthesis derives the `source` flag mechanically from citation types.
4. **Transcripts persist durably.** Append-only message log, scoped by session. Snapshots link to the session that produced them. No more overwriting.
5. **Faculty workflow is unchanged.** Same page, same chat, same review, same snapshot. Citation chips and a `source` indicator are the only visible additions; auto-set-aside decisions and indexing status are surfaced as silent defaults with override links.
6. **Audit mode is toggleable per course.** Simple courses can bypass the heavy retrieval pipeline and run with materials inline (still through the agent loop, but without retrieval tools). Default Full; Simple is an explicit faculty choice.
7. **The architecture is shared with the user's agent infrastructure.** Weaviate runs once on the local Mac via launchd, serves CourseCapture and the agent infra as separate tenants.

## Non-goals

- **Not** a graph layer. Knowledge-graph queries (multi-hop, traversal) belong in the program-level views (Phase 1B+); they are out of scope here. Future Neo4j-or-similar integration is anticipated but not designed.
- **Not** a re-score of existing drafts. GC 3460, GC 3400, GC 4800 stay as legacy with a banner; re-auditing is faculty's choice.
- **Not** a swap to a different AI provider. Existing provider abstraction is extended for tool-use; OpenAI, Anthropic, and Local stay supported.
- **Not** a full RAG framework adoption. LlamaIndex, LangChain, Haystack, GraphRAG considered and declined; pieces (sqlite-vec was considered, Weaviate chosen; Vercel AI SDK for tool-use primitives) are adopted instead.
- **Not** Phase 1B Scaffolding Analysis. That spec ([`2026-05-25-scaffolding-analysis-design.md`](./2026-05-25-scaffolding-analysis-design.md)) presupposes confirmed snapshots with `productive_failure_conditions` data; this spec produces those snapshots.
- **Not** local embedding model. Start with OpenAI `text-embedding-3-small`; configurable for future swap.
- **Not** the cross-snapshot diff view. Phase 2 carryover.

---

## Architecture

Three phases.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Phase A — Materials Ingestion (per-material, async, validated)     │
│                                                                       │
│  Upload / Canvas / Drive ──► Extract ──► Chunk + Contextualize       │
│                                          │                           │
│                                          ▼                           │
│                                       Embed ──► Weaviate             │
│                                          │                           │
│                                          ▼                           │
│                                       Digest ──► course_materials    │
│                                                                       │
│  Then: ingestion check-in chat (only when something to flag)         │
│  Then: materials corpus locked in (with override) for audit          │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Phase B — Audit Chat as Tool-Using Agent                            │
│                                                                       │
│  Per turn:                                                            │
│   1. Load (system prompt + catalog + digests + history)              │
│   2. Decide: retrieval needed? (≤ 2 tool calls per turn)             │
│   3. fetch_material_section / search_materials / list_materials      │
│   4. Generate response: finding + question + citations + readiness   │
│   5. Persist message (append-only)                                    │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Phase C — Synthesis (one-shot structured output)                    │
│                                                                       │
│  Read transcript + cited evidence + digests                          │
│   → CaptureProfile JSON with per-finding source flag + citations     │
│  Source flag derived mechanically from citation types in transcript  │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                            Snapshot (linked to session_id)
```

### Audit-mode toggle

Two modes per course (`courses.audit_mode`):

- **Full** (default): Phase A runs in full; agent has retrieval tools.
- **Simple**: chunking/embedding/Weaviate writes are skipped; agent runs without retrieval tools; materials inline in agent context. Digests still generated (cheap, useful for snapshot record). Switchable mid-course: Simple → Full triggers on-demand indexing; Full → Simple leaves existing indexes intact but unused.

---

## Phase A — Materials Ingestion

### Chunker

Hierarchical, section-aware. Three levels:
- **Per-material digest** (~1500 tokens, one per material) — always in the auditor's at-rest context.
- **Section chunks** (~2000 tokens, heading-aligned where headings exist; paragraph-clustered when not).
- **Detail chunks** (~500 tokens with 100-token overlap, nested inside each section).

At retrieval time, detail chunks are returned **with their parent section attached** (small-to-big retrieval). This preserves cross-chunk context for long technical materials.

Module: `lib/capture/chunker.ts`. Pure logic, no AI calls, no I/O. Input: extracted text + source kind. Output: typed array of chunks with their hierarchical relationships.

### Contextual retrieval enrichment

For each detail chunk, generate a 1–2 sentence context blurb (Anthropic's contextual-retrieval pattern). Prepended to the chunk before embedding so the embedding encodes position + content.

Example for a textbook chunk:
> *"This is from Chapter 4 of the textbook chapter on color reproduction; it discusses the relationship between ΔE values and human-perceptible difference."*

Module: `lib/ai/analyze/chunk-contextualize.ts`. One light-tier LLM call per chunk; cached in Weaviate's `contextBlurb` property.

### Embedder

Provider-abstracted (`lib/capture/embedder.ts`). Starts with OpenAI `text-embedding-3-small` (1536 dimensions, cheap, high-quality). Swappable to local sentence-transformer via omlx in a future iteration. Dimensionality must stay consistent across the index (re-indexing required if changed).

### Vector store — Weaviate

Multi-tenant Weaviate instance running on the local Mac (managed by user's agent infrastructure via launchd). CourseCapture connects via env vars:

```
WEAVIATE_URL=http://localhost:8080
WEAVIATE_API_KEY=<optional>
WEAVIATE_TENANT_PREFIX=coursecapture
```

Tenancy: **per-course tenant**, named `coursecapture-<slug>` where slug is the course code lowercased with spaces collapsed to hyphens (e.g., `GC 4800` → `coursecapture-gc-4800`). Clean isolation; cross-course retrieval is opt-in. Other agent-infra projects use tenant names outside the `coursecapture-*` prefix.

**Embedding dimensionality.** Weaviate's vector index is configured for the dimensionality of the active embedding model. Initial deployment: 1536 (OpenAI `text-embedding-3-small`). Swapping to a local model with different dimensionality requires either a new tenant or a full re-index — bake this into the embedder swap procedure.

**Hybrid search built-in.** Weaviate's `hybrid` query combines vector similarity + BM25 + reciprocal rank fusion in one call. We don't implement fusion logic ourselves.

**Schema (defined in code, bootstrapped at first connection):**

```typescript
// lib/capture/weaviate-schema.ts
const MaterialChunkClass = {
  class: 'MaterialChunk',
  multiTenancyConfig: { enabled: true },
  vectorIndexConfig: { distance: 'cosine' },
  invertedIndexConfig: { /* BM25 enabled */ },
  properties: [
    { name: 'materialId', dataType: ['text'] },
    { name: 'courseCode', dataType: ['text'] },
    { name: 'fileName', dataType: ['text'] },
    { name: 'chunkIndex', dataType: ['int'] },
    { name: 'sectionTitle', dataType: ['text'] },
    { name: 'sectionIndex', dataType: ['int'] },
    { name: 'parentSectionId', dataType: ['text'] },  // for small-to-big retrieval
    { name: 'text', dataType: ['text'] },
    { name: 'contextBlurb', dataType: ['text'] },
  ]
};
```

### Per-material digest

Generalizes the existing `material-summary` pipeline. Applied to *every* material at ingestion (not just long reference ones). Output: structured ~1500-token markdown with sections for material kind, scope, headings, key terms, supported competencies, audit-relevant gaps. Cached on the `course_materials.digest` column (renamed from `summary` in the migration).

Module: `lib/ai/analyze/material-digest.ts`. Light tier. One call per material.

### Auto-set-aside policy

Pure-logic module: `lib/capture/materials-policy.ts`. Per-source-kind rules return:

```typescript
{
  included: boolean,
  reason: string,
  ferpaRisk: 'low' | 'medium' | 'high',
  overridable: true  // always
}
```

Initial ruleset:
- `Canvas: Syllabus` → set aside when `courses.learning_objectives.length > 0` (already shipped in 2026-05-26, commit `8774b92`).
- `Google Sheet: ,,,` or empty extraction → set aside ("Empty or malformed import").
- `Canvas File: *.xlsx | *.xls` → set aside ("Spreadsheet; usually data, not audit material").
- `Canvas: Discussions` → FERPA risk: high. Set aside by default ("Contains student posts").
- Everything else → included.

Faculty can override any auto-set-aside from the Materials panel (single click, no confirmation modal).

**Two-column model.** The existing `course_materials.ignored` column remains the operational flag (read by audit context loaders to decide inclusion). The new `auto_set_aside` column is informational — it records that the policy made an exclusion recommendation. When the policy fires, both flip to `true` together. When faculty overrides, `ignored` flips back to `false` while `auto_set_aside` stays `true` — so the UI can render "system would exclude this; you opted to include" and the policy doesn't keep re-flipping `ignored` on every re-evaluation.

### FERPA detector

Module: `lib/capture/ferpa-detect.ts`. Regex-based first pass. Looks for:
- "Submitted by [Name]" patterns
- "Posted by [Name] on [Date]" patterns
- Gradebook-column patterns (`Name | Grade | ...`)
- Student-ID patterns (`C[0-9]{8}`)

Conservative: false positives are fine (override is one click), false negatives matter. Per-material flag (`course_materials.ferpa_risk`), surfaced in the Materials panel as an amber pill.

### Ingestion check-in chat

New AI function (`ingestion-checkin`). System prompt: read the materials inventory + digests + curated catalog, emit either `null` (nothing to flag) or a single short message with at most one missing-thing question and one set-aside notice. Default behavior is silence. Light tier.

Module: `lib/ai/analyze/ingestion-checkin.ts`. Surface: one inline panel above the audit chat. Faculty can drop a file, type a response, or proceed. Skipping is one click. Never blocks.

### Ingestion timing

Triggered via the existing `finalizeExtraction` helper (`lib/capture/finalize-extraction.ts`), extended to run:
1. `updateExtractionResult` (existing)
2. Generate digest (existing path, generalized)
3. Chunk + contextualize + embed + write to Weaviate (new; skipped when `course.audit_mode === 'simple'`)
4. Mark `course_materials.indexing_status = 'ready'`

All async. Per-material status surfaces in the Materials panel as silent green/yellow/red dots.

**Re-indexing on material change.** When a material's extracted text changes (Canvas re-extract, re-upload, manual edit), `finalizeExtraction` invalidates the existing index entries for that material and re-runs chunk + contextualize + embed against the new text. The chunker is deterministic and idempotent; re-running is safe. Digest is also re-generated. This is automatic — no faculty action required.

---

## Phase B — Audit Chat as Agent

### Agent loop

Per instructor turn:

1. Load at-rest context: system prompt + curated catalog from `courses` row + per-material digest layer + conversation history.
2. Model decides whether retrieval is needed for the next finding (zero or more tool calls, budget cap of 2 per turn).
3. If tool calls: dispatch them, append tool result messages to context, re-invoke model.
4. Model generates structured response: one finding (with citations) + one question + readiness signal.
5. Append assistant message to `capture_messages` (append-only).
6. Return to UI.

Tool-call budget per turn prevents runaway loops; if the agent needs more, it asks the instructor instead.

### Tool surface

Three tools:

```typescript
list_materials() → {
  materials: Array<{
    id: string;
    fileName: string;
    digest: string;
    ferpaRisk: 'low' | 'medium' | 'high';
    included: boolean;
  }>
}
// Rarely needed; digests are already at-rest. Useful when conversation has been
// long and the model wants a fresh inventory glance.

fetch_material_section(
  materialId: string,
  query: string,
  k?: number = 3
) → {
  chunks: Array<{
    chunkId: string;
    materialId: string;
    sectionTitle: string;
    parentSectionText: string;
    text: string;
    score: number;
  }>
}
// Primary retrieval. Weaviate hybrid query within one material's tenant scope.
// Returns detail chunks with their parent sections attached.

search_materials(query: string, k?: number = 5) → {
  chunks: Array<{ /* same shape as above */ }>
}
// Cross-material retrieval within the course's tenant. Used when the model
// doesn't know which material has the answer.
```

Intentionally absent:
- No `add_audit_note(...)` — findings emerge through synthesis, not explicit emit. Keeps conversation flow clean.
- No `update_readiness(...)` — readiness stays in the structured response shape.

### Structured per-turn response

```typescript
{
  finding: string,              // one paragraph
  question: string,             // one focused question
  citations: Array<{
    type: 'chunk' | 'instructor',
    chunkId?: string,           // when type === 'chunk'
    messageId?: string,         // when type === 'instructor'
    excerpt: string             // the actual text being cited
  }>,
  readiness: {
    score: number,              // 0-100
    covered: string[],
    remaining: string[]
  }
}
```

Every substantive finding **must** carry at least one citation; speculative findings are marked by source = `inferred` in the synthesis output (rare, used sparingly).

`messageId` references `capture_messages.id` — the UUID of the prior turn in the same session whose content informed the finding. `chunkId` references the chunk's Weaviate object UUID, resolvable to text + section metadata at render time. Citation `excerpt` is a short verbatim quote (≤ 200 chars) carried inline so reviewers don't have to round-trip to the chunk store for the gist.

**Streaming preserved.** The agent's response stream-renders into the chat panel as it generates, same as today's audit chat. Tool-call dispatches happen between stream segments; from the faculty perspective the turn just feels like a slightly-longer pause before the next finding+question arrives.

### At-rest vs retrieved context

Always-loaded per turn:
- System prompt (~6k tokens)
- Curated catalog from `courses` row (~1k tokens)
- Per-material digest layer (one digest per included material; ~30k tokens for a 20-material course)
- Conversation history (~5–50k tokens depending on session length)

Retrieved on demand:
- Chunks with parent sections via `fetch_material_section` / `search_materials` (~2–6k tokens per turn when used)

Effective per-turn context: typically 40–80k tokens — well under any modern model's window, dramatically smaller than today's 145k-token dump.

### Prompt rewrite

New file: `lib/ai/prompts/capture-chat-agent.md`. Preserves from current `capture-chat.md`:
- Seven audit areas (prereq sufficiency, materials inventory, KUD scoping, depth-anchoring, dimensional patterns, foundationals, productive-failure conditions + reflection)
- One-question-per-turn rule
- Three-paragraph opening / two-paragraph follow-up format
- Finding-then-question coherence
- Readiness signal on every turn
- KUD+ depth-scale anchoring

Adds:
- Tool-use guidance: when to retrieve (need detail beyond digest), when not to (instructor-knowledge questions)
- Citation discipline: every substantive claim cites a chunk or a prior instructor message
- Materials-silence rule: if materials don't contain something you'd need to assess, **ask the instructor — do not infer from absence**
- Tool-budget awareness: ≤ 2 retrievals per turn

The new prompt carries `manning_skills:` frontmatter consistent with the encoding-backfill plan. The old `capture-chat.md` stays in git history.

### Provider abstraction extension

`lib/ai/provider.ts`'s `AIProvider` interface gains:

```typescript
completeWithTools<T>(args: {
  systemPrompt: string;
  messages: Message[];
  tools: ToolDefinition[];
  schemaName: string;
  jsonSchema: object;
  validate: (raw: unknown) => T;
}): Promise<
  | { kind: 'response'; value: T; toolCallsUsed: ToolCall[]; telemetry: CompletionTelemetry }
  | { kind: 'tool_calls'; calls: ToolCall[]; telemetry: CompletionTelemetry }
>;
```

Implementations:
- OpenAI: native function calling.
- Anthropic: native tool use.
- Local (omlx Qwen3.6 family): native tool-use format.
- Fake (test): scripted tool-call mode for deterministic tests.

Vercel AI SDK's `streamText` + `tool` primitives are the underlying implementation for OpenAI/Anthropic paths. Our existing provider abstraction wraps them so call sites continue to use `getProviderForFunction('capture-chat-agent')`.

### Conversation persistence

Replace today's session-overwriting `captureConversations` table with append-only `capture_messages`:

```sql
CREATE TABLE capture_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_code     text NOT NULL REFERENCES courses(code) ON DELETE CASCADE,
  session_id      uuid NOT NULL,
  turn_index      integer NOT NULL,
  role            text NOT NULL,                   -- 'system'|'user'|'assistant'|'tool'
  content         text,
  tool_calls      jsonb,
  tool_result     jsonb,
  citations       jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_capture_messages_session ON capture_messages (course_code, session_id, turn_index);
```

When a snapshot is confirmed, `course_capture_snapshots.transcript_session_id` is set to the session that produced it. From that point on, the transcript is immutable.

The existing `captureConversations` table is preserved as legacy (existing rows migrated into `capture_messages` with one synthesized session per row); no new writes go to it.

---

## Phase C — Synthesis

One-shot structured-output call. **Not the agent.** Reads:
- The full session transcript from `capture_messages`
- All chunks cited during the session (resolved from citation IDs)
- The per-material digest layer

Emits the structured `CaptureProfile` JSON (competencies, audit_notes, productive_failure_conditions, incoming_expectations, verification_summary). Same shape as today, with two changes:

1. **Every finding carries `source` and `citations`** (the structured shape described in Phase B's per-turn response).
2. **Source flag derivation is mechanical**, not LLM-judged. Synthesis prompt explicitly says: "for each finding, look at the transcript turns that informed it; if all citations are type=instructor, source: 'instructor'; if all are type=chunk, source: 'materials'; if mixed, source: 'inferred'."

`productive_failure_conditions` is emitted **only if** Audit Area 7 was probed in the transcript (the prompt looks for explicit messages discussing generate-then-consolidate, open-ended problems, revision cycles, structured post-mortem). Otherwise `null`. No more materials-only inference of this block.

Prompt: rewrite `capture-scores.md` → `capture-synthesis.md` with the new derivation rules. Default tier (same as today). One call per profile generation.

---

## Data model changes

### Schema diff

```sql
-- Phase A: ingestion-pipeline columns on course_materials
ALTER TABLE course_materials RENAME COLUMN summary TO digest;
ALTER TABLE course_materials RENAME COLUMN summary_model TO digest_model;
ALTER TABLE course_materials RENAME COLUMN summary_generated_at TO digest_generated_at;
ALTER TABLE course_materials RENAME COLUMN use_summary TO use_digest;
ALTER TABLE course_materials ADD COLUMN ferpa_risk text DEFAULT 'low';
ALTER TABLE course_materials ADD COLUMN auto_set_aside boolean DEFAULT false;
ALTER TABLE course_materials ADD COLUMN set_aside_reason text;
ALTER TABLE course_materials ADD COLUMN indexing_status text DEFAULT 'pending';  -- pending|indexing|ready|failed
ALTER TABLE course_materials ADD COLUMN indexed_at timestamptz;

-- Phase B: append-only message log
CREATE TABLE capture_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_code     text NOT NULL REFERENCES courses(code) ON DELETE CASCADE,
  session_id      uuid NOT NULL,
  turn_index      integer NOT NULL,
  role            text NOT NULL,
  content         text,
  tool_calls      jsonb,
  tool_result     jsonb,
  citations       jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_capture_messages_session ON capture_messages (course_code, session_id, turn_index);

-- Snapshot links to producing session
ALTER TABLE course_capture_snapshots ADD COLUMN transcript_session_id uuid;

-- Audit mode toggle
ALTER TABLE courses ADD COLUMN audit_mode text NOT NULL DEFAULT 'full';  -- 'full' | 'simple'
```

### CaptureProfile shape extension

The Zod schema for findings gains:

```typescript
{
  text: string,
  source: 'instructor' | 'materials' | 'inferred',
  citations: Array<{
    type: 'chunk' | 'instructor',
    chunkId?: string,
    messageId?: string,
    excerpt: string
  }>
}
```

Applied to every finding in competencies, audit_notes, productive_failure_conditions, incoming_expectations, verification_summary.

### Weaviate schema

`MaterialChunk` class with multi-tenancy enabled; tenants named per-course (`coursecapture-<slug>`). Schema bootstrapping is idempotent: on first connection, ensure the class exists with the expected properties.

---

## Faculty UX

The walkthrough below is the experience target. Sections labeled (today/new) describe what changes from the current flow.

### Materials panel

Visual additions:
- Per-material indexing status: silent green/yellow/red dot. Faculty can scroll past; hover for status detail.
- Auto-set-aside rows: soft strikethrough + pill ("Sheets has LOs — set aside" / "Empty import — set aside"). Single-click "include anyway" override.
- FERPA-risk rows: amber pill ("Student names detected — set aside for FERPA"). Same override.
- Audit-mode toggle in the panel header: small chip *"Audit mode: Full ▾"* with dropdown to Simple. One-sentence tooltip.

### Ingestion check-in

Inline one-message panel above the chat — appears only when there's something specific to flag (typically silent). Faculty drops a file, types a response, or clicks "proceed". Never blocks audit start.

### Audit chat

Same chat panel, same one-question-per-turn rhythm, same finding-then-question structure. Visible additions:
- **Citation chips** under each assistant message. Click → side drawer opens with the chunk text highlighted.
- **Faster response latency** (per-turn context bounded, no 145k-token re-read).

### Review panel

Same review panel. Two additions:
- **Source indicator** per finding: solid teal (instructor-grounded), amber pill (materials-only), gray (inferred).
- **"Show transcript" link** in the header — opens the full audit conversation alongside the profile.

### Confirm and snapshot

Same flow. The snapshot row links to `transcript_session_id`. Anyone reviewing the snapshot later can click any finding to see the conversation turn or chunk that produced it.

---

## Migration of existing data

- **Existing drafts (GC 3460, GC 3400, GC 4800).** Stay as legacy. Banner in Review panel: *"This draft was captured before provenance shipped — source attribution unavailable. Re-audit for source-tagged findings."* No automatic re-scoring.
- **Existing materials.** First time a course is opened in the new app, background indexing runs on any material lacking `digest` / chunks. Async; doesn't block audit start (chat can begin once first material is ready).
- **Existing `course_capture_profiles`.** Stay as-is. Findings without `source` flag default to `inferred` when read by new UI, with "legacy draft" badge.
- **Existing `captureConversations` rows.** Migrated into `capture_messages` with a synthesized `session_id` per row. Preserved for archival; no new writes.
- **`material_summary` references in code.** Renamed to `material_digest` in the same migration. Reference-compression feature consolidates into the general digest pipeline. UI strings ride along: "Compress existing materials" → "Regenerate digests", "Summary off" / "Summary (~Xk)" badges → "Digest off" / "Digest (~Xk)". The faculty-facing concept simplifies from "compress long materials" to "every material has a digest."

---

## Testing

### Unit (no AI calls)
- Chunker: heading-aware boundaries, overlap, edge cases (no headings, single paragraph, mixed markdown/HTML).
- Policy module: each rule + override.
- FERPA detector: positive/negative regex cases, low-confidence cases.
- Weaviate client wrapper: schema bootstrap idempotence, tenant addressing, error mapping.
- Provenance derivation: fixture transcript with mixed-source citations → expected source flag.

### Integration (mocked AI, real Weaviate)
- Ingestion end-to-end with fixture material → extract → chunk → contextualize → embed (mocked) → write to Weaviate (real ephemeral tenant) → retrieve.
- Agent tool-call loop with mocked LLM emitting scripted tool calls: verify dispatch, threading, persistence shape.
- Synthesis from fixture transcripts (transcript-only, materials-only, mixed) → expected source-flag distribution.

### Quality regression (real AI calls, gated)
- Golden-corpus fixtures (initially: GC 4800 + one new course). Tracked:
  - Source-flag distribution
  - Citation density per finding
  - Audit-area coverage in transcript
- Fail if a finding has no citation and source ≠ inferred. Architectural invariant.

### E2E (manual)
- Capture a real course end-to-end; verify provenance chips render, transcript persists, snapshot links to session, simple-mode toggle works both directions.

---

## Error handling

- **Weaviate unavailable.** Audit can still run with digest layer; banner surfaces the degraded state; findings tagged `source: inferred`.
- **Embedding API failure.** Material's `indexing_status: failed`; retry link in Materials panel; audit unaffected for other materials.
- **Tool-call error mid-conversation.** Agent receives error in tool result; prompt instructs: "ask the instructor instead of inferring from absence."
- **FERPA false positive.** Override is one click; no confirmation modal.
- **Long ingestion vs eager audit.** Audit can start when first material is ready; corpus widens as background indexing completes.
- **Schema drift in Weaviate.** Class definition is code-managed and idempotent; backfill via re-indexing if shape changes.

---

## Open questions

1. **Multi-tenancy granularity.** Per-course tenant (`coursecapture-<slug>`) is the leaning recommendation. Alternative: per-faculty (would matter if multi-faculty use ever lands). Confirm before bootstrap.
2. **Local embedding model swap timing.** Start with OpenAI; concrete trigger for swap TBD (cost ceiling? data-sensitivity escalation?).
3. **Contextual-enrichment cost.** Estimate: 30-chunk material × light-tier call ≈ $0.005. Worth measuring on a real corpus.
4. **Re-indexing on material change.** Specified in Phase A — automatic via `finalizeExtraction`. Open question only insofar as edge cases (partial re-extraction, manual digest-only refresh) may need explicit triggers later.
5. **Citation truncation.** If a finding cites 8 chunks, show top-3 + "show more"? Lean yes.
6. **Long-conversation coherence.** At what turn count does the agent degrade? Measure during dev.
7. **Skip-the-check-in pref.** Per-faculty "always skip" flag? Defer until check-in friction is observed.
8. **Auto-suggest Simple mode.** When a course has < N materials AND < M tokens, suggest Simple mode? Defer until manual toggle's reception is observed.

---

## Acceptance criteria

- A new CourseCapture audit on a fresh course (Full mode):
  - Materials ingest with per-material digests + chunks indexed in Weaviate (per-course tenant).
  - Auto-set-aside fires for `Canvas: Syllabus` when Sheets has LOs, for malformed Sheet imports, for FERPA-detected materials. All overridable.
  - Ingestion check-in either silent (nothing to flag) or one-message (something specific to flag); never blocking.
  - Audit chat agent retrieves chunks on demand; finding messages carry citations; tool budget honored.
  - Transcript persists as `capture_messages` rows, session-scoped, append-only.
  - Snapshot links to `transcript_session_id`.
  - Synthesis produces a `CaptureProfile` with `source` flag on every finding; flag derived mechanically from citation types.
- A new CourseCapture audit in Simple mode:
  - Chunking + embedding + Weaviate writes skipped; digests still generated.
  - Agent runs without retrieval tools; materials inline.
  - Per-finding provenance still works (transcript-turn citations).
- Existing legacy drafts (GC 3460, GC 3400, GC 4800) display the "legacy" banner in the Review panel; not auto-re-scored.
- Phase 1B Scaffolding Analysis spec's data dependency (`productive_failure_conditions`) is satisfied when faculty re-audit existing courses with the new architecture: only audits that probed Audit Area 7 produce non-null PF blocks.

---

## References

- [`../plans/2026-05-22-phase2-agent-design.md`](../plans/2026-05-22-phase2-agent-design.md) — superseded; this spec absorbs its goals.
- [`../plans/2026-05-25-capture-reference-compression.md`](../plans/2026-05-25-capture-reference-compression.md) — generalized; the Tier 1 + Tier 2 future-directions become this architecture.
- [`./2026-05-24-coursecapture-completion-spec.md`](./2026-05-24-coursecapture-completion-spec.md) — substrate that this spec preserves (snapshots, incoming_expectations, verification_summary).
- [`./2026-05-25-scaffolding-analysis-design.md`](./2026-05-25-scaffolding-analysis-design.md) — downstream consumer; its data dependency is satisfied by this spec.
- [`./2026-05-23-kud-depth-scales-design.md`](./2026-05-23-kud-depth-scales-design.md) — KUD+ rubric unchanged.
- [`../../background.html`](../../background.html) — KUD+ academic background.
- [`../../problem-solving-deep-dive.md`](../../problem-solving-deep-dive.md) — productive-failure research synthesis (the framework Audit Area 7 implements).
- Anthropic contextual retrieval: https://www.anthropic.com/news/contextual-retrieval (2024 pattern adopted in chunk-contextualize).

## Out-of-scope, captured for sequencing

- **Graph layer (Neo4j or similar).** Anticipated for program-level views (Phase 1B+); not designed here.
- **Local embedding model.** Optional swap; configurable provider; deferred until data justifies.
- **Real per-user auth for faculty.** Still on the deferred deployment-planning track.
- **Cross-snapshot diff view.** Phase 2 carryover.
- **Audit chat dispute pipeline.** Phase 2.
- **Re-scoring of existing drafts.** Legacy banner suffices; faculty re-audits when they want provenance.

---

## Phasing recommendation (for the implementation plan)

This spec is implementable as one cohesive plan or staged. Recommended staging when the plan is written:

**Stage 1 — Foundation:** transcript persistence (`capture_messages`), audit_mode toggle (schema only), provider abstraction extension (`completeWithTools`). No user-visible UX change yet.

**Stage 2 — Ingestion:** Weaviate connection + tenant model, chunker, contextualizer, embedder, digest generator, materials policy module, FERPA detector, ingestion check-in. Materials panel UI for indexing status + overrides.

**Stage 3 — Agent:** capture-chat-agent prompt, tool surface implementation, agent loop wiring, audit chat UI (citation chips, transcript link).

**Stage 4 — Synthesis:** capture-synthesis prompt rewrite, mechanical source-flag derivation, Review panel UI (source indicators, transcript viewer).

**Stage 5 — Migration + legacy banner:** existing-draft banner, captureConversations migration, smoke test on a fresh real-course capture end-to-end.

Each stage is shippable; faculty UX improves stage by stage. The implementation plan (`superpowers:writing-plans`) will sequence concrete tasks within and across stages.
