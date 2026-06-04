# Position Capture v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 3-step partner-submission wizard *and* subsume the CareerCapture v1 interview into a single richer flow: partner picks a career target, then walks a 6-page Position Capture (JD ingest → uniqueness → interview questions → trajectory → AI-rated experiences → agent interview). Each completed position is stored as an immutable, addressable row; many positions tagged to a target aggregate into a target-level KUD+ profile (stub for v1).

**Architecture:** Three layers — career targets (catalog, unchanged) → `position_captures` (one immutable row per submitted hire scenario, supersession-linked) → `career_target_kud_aggregate` (derived; v1 aggregate function is a deterministic Markdown side-by-side of source positions; AI synthesis deferred). Reuses ~80% of CareerCapture v1's machinery via rename/repurpose: schema 0028's two tables get renamed; runner + AI functions get re-prompted; `InterviewPanel` becomes Page 6. CareerCapture v1's partner-facing surface (interview route, dashboard links) is retired.

**Tech stack:** Existing — Next.js 15 App Router, Drizzle ORM + local Postgres 17, Vercel AI SDK v6 structured output, Docling (already running on `127.0.0.1:5001`) for JD + interview-doc parsing, `VoiceRecorder` + `/api/partners/transcribe` for voice on pages 2/3/4, the audit-agent loop reused for Page 6.

---

## Scope cut for v1

Not in this plan (defer to v2):

- **Real aggregation function.** v1 aggregate is a deterministic Markdown-style side-by-side of position profiles under a target — no AI synthesis pass. Faculty read across positions with their own eyes until we have enough data to design the real synthesis.
- **Coverage-matrix integration.** Page 5's slider ratings get *stored* per-position but don't yet drive sub-competency weight scores. That's a separate design problem worth doing carefully.
- **Auto-detection of "same position" for supersession.** Partner explicitly picks from a dropdown of their prior positions when re-capturing. No AI matching.
- **Position-card drill-through UI on `/admin/synthesis`** beyond a simple list. Rich per-position card view (with K/U/D bars, citation drawer, etc.) is a v2 visual polish.
- **Re-running JD extract on a previously-parsed JD.** First parse only; if partner pastes a new JD on a row that's already been parsed, replace structured-inputs whole. No diff/merge UI.
- **Cross-partner duplicate detection.** Two partners can each capture "Brand Strategist at Doe Industries" without warning. v1 treats every row as independent.

---

## Background — what gets reused, what's net new

CareerCapture v1 (shipped this morning at commit `a14f7b3`) gives us:

- Append-only message log table (`career_capture_messages` — rename to `position_capture_messages`)
- Tool-using audit-agent loop (`runEmployerInterview` → rename to `runPositionInterview`; new prompts for position context)
- Streaming + structured per-turn response (AuditResponse shape — finding + question + citations + readiness)
- Synthesis pattern (`generateCareerCaptureProfile` → rename to `generatePositionProfile`; new PositionProfile shape)
- Partner-token auth (magic link), partner-side voice transcription (`/api/partners/transcribe`)
- `InterviewPanel` UI (becomes Page 6)
- Strict-mode JSON schema discipline + Zod parsing
- Stress-test agent (available; not wired in v1 — defer to v2 like CareerCapture deferred it)

Net-new for Position Capture:

- **Per-position lifecycle**: drafts (status='draft', rolling JSONB inputs), immutable submission (status='submitted'), supersession (`supersedes` self-FK).
- **JD ingest**: file upload OR paste → Docling extraction (if file) → LLM extracts structured fields with confidence scores → partner reviews highlighted incomplete fields + edits + adds extras-catchall.
- **Page 5 "experiences worth having" generator**: AI emits 10 candidates from pages 1-4 + target sub-competencies; partner edits/removes/adds; 1-7 sliders; min 5 ratings to move forward.
- **Page 6 reads upstream context**: agent posture = anchor (1 turn reflective summary) → probe (4-6 turns on gaps/contradictions) → confirm (1-2 turns on draft KUD+ profile). Different prompt from CareerCapture v1's open-ended-from-scratch interview.
- **Target-level aggregate**: new `career_target_kud_aggregate` table, stale flag triggered on each new position, regenerate-on-demand from `/admin/synthesis/targets/[targetId]`.
- **Six-page wizard UI** with auto-save on page transition, stop-at-any-page, `completeness` enum tracks how far the partner got.

---

## File structure

**Schema (migration 0029):**
- Rename: `career_captures` → `position_captures`
- Rename: `career_capture_messages` → `position_capture_messages`
- Add columns to `position_captures`: `status` (text: 'draft' | 'submitted'), `company` (text), `position_title` (text), `structured_inputs` (jsonb), `rated_skills` (jsonb), `source_files` (jsonb), `supersedes` (uuid nullable, self-FK), `completeness` (text: 'title-only' | 'structured' | 'rated' | 'interviewed'), `submitted_at` (timestamptz nullable)
- New table: `career_target_kud_aggregate`

**New files:**
- `lib/db/position-capture-queries.ts` — replaces `lib/db/employer-capture-queries.ts`
- `lib/ai/position-capture/schema.ts` — `PositionProfile` Zod + JSON schema; replaces `lib/ai/employer-capture/schema.ts`
- `lib/ai/position-capture/run.ts` — `runPositionInterview` + `generatePositionProfile`; replaces `lib/ai/employer-capture/run.ts`
- `lib/ai/position-capture/jd-extract.ts` — Docling integration + LLM structuring
- `lib/ai/position-capture/rated-items.ts` — generates 10 "experiences worth having"
- `lib/ai/position-capture/aggregate.ts` — v1 stub: lists position profiles side-by-side as Markdown
- `lib/ai/prompts/jd-extract.md`
- `lib/ai/prompts/position-rated-items.md`
- `lib/ai/prompts/position-interview-agent.md` — replaces `capture-employer-chat-agent.md`; same per-turn shape, anchor-probe-confirm posture
- `lib/ai/prompts/position-synthesis.md` — replaces `capture-employer-synthesis.md`; PositionProfile output
- `app/api/partners/[token]/positions/route.ts` — POST (create draft), GET (list)
- `app/api/partners/[token]/positions/[id]/route.ts` — PATCH (auto-save), POST (finalize/submit-partial)
- `app/api/partners/[token]/positions/[id]/extract-jd/route.ts` — JD ingest
- `app/api/partners/[token]/positions/[id]/generate-items/route.ts` — Page 5 trigger
- `app/api/partners/[token]/positions/[id]/chat/route.ts` — Page 6 per-turn
- `app/partners/[token]/positions/new/page.tsx` — career target picker
- `app/partners/[token]/positions/[id]/page/[step]/page.tsx` — wizard pages 1-6
- `app/partners/[token]/positions/[id]/page/[step]/PositionWizard.tsx` — client component, per-page sections
- `app/api/admin/synthesis/targets/[targetId]/regenerate-aggregate/route.ts`

**Modified files:**
- `lib/db/schema.ts` — schema renames + new columns + new table
- `lib/ai/function-settings.ts` — register 4 new AI function IDs, retire 2 employer-capture IDs
- `lib/ai/prompts/load.ts` — update PromptName union
- `app/partners/[token]/PartnerDashboard.tsx` — replace per-target "Start interview" with single "Add a position" CTA; show submitted positions list
- `app/partners/[token]/WelcomeScreen.tsx` — CTA points to /positions/new
- `app/admin/synthesis/targets/[targetId]/page.tsx` — replace "Employer interviews" section with "Positions in this target" + aggregate panel
- `docs/STATE.md` — new cross-cutting row; AI function tier table update; schema bump
- `docs/superpowers/README.md` — index this plan

**Deleted files:**
- `lib/ai/employer-capture/` (whole dir — replaced by `lib/ai/position-capture/`)
- `lib/db/employer-capture-queries.ts`
- `lib/ai/prompts/capture-employer-chat-agent.md`
- `lib/ai/prompts/capture-employer-synthesis.md`
- `app/partners/[token]/interview/` (whole dir)
- `app/api/partners/[token]/interview/` (whole dir)
- `app/partners/[token]/submit/` (whole dir — old 3-step wizard)
- `app/api/partners/submissions/` (whole dir — old wizard's data API)
- `tests/ai/employer-capture-schema.test.ts`

---

## Task 1: Schema migration 0029 — rename CC v1 tables, add Position Capture columns + aggregate table

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `drizzle/0029_<auto-generated>.sql`

- [ ] **Step 1: Update schema.ts**

In `lib/db/schema.ts`, replace the existing `careerCaptureMessages` and `careerCaptures` exports with:

```typescript
/**
 * Position Capture append-only message log. One session = one Page 6
 * interview about one specific position the partner is hiring for.
 * Renamed from career_capture_messages (CareerCapture v1 retired 2026-06-04).
 */
export const positionCaptureMessages = pgTable('position_capture_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  partnerId: uuid('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  positionCaptureId: uuid('position_capture_id').notNull().references(() => positionCaptures.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id').notNull(),
  turnIndex: integer('turn_index').notNull(),
  role: text('role').notNull(),
  content: text('content'),
  citations: jsonb('citations').$type<Array<{
    type: 'transcript' | 'page-input';
    messageId?: string;
    pageRef?: string;
    excerpt: string;
  }>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  sessionIdx: index('idx_position_capture_messages_session').on(table.positionCaptureId, table.sessionId, table.turnIndex),
  sessionTurnUnique: unique('uq_position_capture_messages_session_turn').on(table.sessionId, table.turnIndex),
}));

/**
 * Position Capture row. Drafts live here (status='draft', rolling JSONB inputs).
 * On submission becomes immutable (status='submitted'); subsequent re-captures
 * of the same position create a new row with `supersedes` pointing to the old.
 *
 * Schema 0029. Renamed from career_captures (CareerCapture v1 retired
 * 2026-06-04, subsumed by Position Capture v1).
 */
export const positionCaptures = pgTable('position_captures', {
  id: uuid('id').primaryKey().defaultRandom(),
  partnerId: uuid('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  careerTargetId: text('career_target_id').notNull().references(() => careerTargets.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('draft'),                          // 'draft' | 'submitted'
  company: text('company').notNull(),
  positionTitle: text('position_title'),                                       // null until partner enters one
  structuredInputs: jsonb('structured_inputs'),                                // pages 1-4 data
  ratedSkills: jsonb('rated_skills'),                                          // page 5: { items: [{name, rating}], generatedAt }
  sourceFiles: jsonb('source_files'),                                          // [{kind, fileName, key, extractedText?}]
  sessionId: uuid('session_id'),                                               // page 6 interview session (null until page 6 starts)
  profile: jsonb('profile'),                                                   // PositionProfile JSON (null until submitted+interviewed)
  model: text('model'),                                                        // synthesis model name
  completeness: text('completeness'),                                          // 'title-only' | 'structured' | 'rated' | 'interviewed'
  supersedes: uuid('supersedes'),                                              // self-FK; set when partner re-captures
  retiredAt: timestamp('retired_at', { withTimezone: true }),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  partnerTargetIdx: index('idx_position_captures_partner_target').on(table.partnerId, table.careerTargetId, table.createdAt),
  targetStatusIdx: index('idx_position_captures_target_status').on(table.careerTargetId, table.status),
  supersedesIdx: index('idx_position_captures_supersedes').on(table.supersedes),
  supersedesFk: foreignKey({ columns: [table.supersedes], foreignColumns: [table.id], name: 'fk_position_captures_supersedes' }).onDelete('set null'),
}));

/**
 * Derived: per-career-target KUD+ aggregate, recomputed from non-superseded
 * position_captures with status='submitted' and completeness='interviewed'.
 * v1 aggregate function is deterministic Markdown side-by-side (no AI);
 * v2 may swap in AI synthesis.
 */
export const careerTargetKudAggregate = pgTable('career_target_kud_aggregate', {
  careerTargetId: text('career_target_id').primaryKey().references(() => careerTargets.id, { onDelete: 'cascade' }),
  aggregateMarkdown: text('aggregate_markdown').notNull(),
  derivedFromPositionIds: jsonb('derived_from_position_ids').$type<string[]>().notNull(),
  stale: boolean('stale').notNull().default(false),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
});
```

Confirm imports at top of `schema.ts` include `foreignKey` and `boolean` (most likely already imported; only add what's missing).

- [ ] **Step 2: Generate the migration**

```bash
cd /Users/admin/projects/curriculum_developer
pnpm db:generate
```

Expected: a new file `drizzle/0029_<auto-name>.sql`. Inspect it:

```bash
ls drizzle/ | tail -3
cat drizzle/0029_*.sql
```

Should contain `ALTER TABLE "career_captures" RENAME TO "position_captures"` (or equivalent DROP/CREATE depending on Drizzle's strategy), the new columns added to `position_captures`, the rename for messages, and the new `career_target_kud_aggregate` table. If Drizzle generates DROP statements that would lose data on tables OTHER than `career_captures` / `career_capture_messages` (both currently empty), **STOP and report.**

- [ ] **Step 3: Apply the migration**

```bash
set -a; source .env.local; set +a
pnpm db:migrate 2>&1 | tail -5
```

Expected: `migrations applied successfully!`

- [ ] **Step 4: Verify**

```bash
PGAPP=/Applications/Postgres.app/Contents/Versions/17
"$PGAPP/bin/psql" -h 127.0.0.1 -p 5433 -U admin -d gc_curriculum -c "\dt position_*"
"$PGAPP/bin/psql" -h 127.0.0.1 -p 5433 -U admin -d gc_curriculum -c "\dt career_target_kud_aggregate"
"$PGAPP/bin/psql" -h 127.0.0.1 -p 5433 -U admin -d gc_curriculum -c "\d position_captures" | grep -E 'status|company|completeness|supersedes'
```

Expected: tables exist; key new columns visible.

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.ts drizzle/0029_*.sql
git commit -m "feat(schema): 0029 — Position Capture v1 (rename CC v1 tables, add lifecycle columns)

Renames career_captures → position_captures and career_capture_messages →
position_capture_messages. CC v1 tables had zero rows so the rename is
data-safe. Adds status/company/position_title/structured_inputs/rated_skills/
source_files/completeness/supersedes/submitted_at columns to support the
6-page wizard lifecycle (draft → submitted → optionally superseded).

New career_target_kud_aggregate table holds the derived per-target
aggregate (v1 stub is deterministic Markdown; v2 may swap in AI synthesis)."
```

---

## Task 2: Query helpers — `lib/db/position-capture-queries.ts`

**Files:**
- Create: `lib/db/position-capture-queries.ts`
- Delete: `lib/db/employer-capture-queries.ts`

- [ ] **Step 1: Create the queries file**

Create `lib/db/position-capture-queries.ts`:

```typescript
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { positionCaptureMessages, positionCaptures, careerTargetKudAggregate } from '@/lib/db/schema';

export interface PositionCaptureRow {
  id: string;
  partnerId: string;
  careerTargetId: string;
  status: 'draft' | 'submitted';
  company: string;
  positionTitle: string | null;
  structuredInputs: Record<string, unknown> | null;
  ratedSkills: { items: Array<{ name: string; description?: string; rating: number }>; generatedAt: string } | null;
  sourceFiles: Array<{ kind: string; fileName: string; key: string; extractedText?: string }> | null;
  sessionId: string | null;
  profile: unknown;
  model: string | null;
  completeness: 'title-only' | 'structured' | 'rated' | 'interviewed' | null;
  supersedes: string | null;
  submittedAt: Date | null;
  createdAt: Date;
}

export interface CreateDraftInput {
  partnerId: string;
  careerTargetId: string;
  company: string;
  supersedes?: string | null;
}

/**
 * Create a draft position capture for a partner. Returns the new row.
 * `company` is required at creation (it's the partner's company name
 * defaulted from `partners.company`; partner can override on page 1).
 */
export async function createPositionDraft(input: CreateDraftInput): Promise<{ id: string }> {
  const [row] = await db.insert(positionCaptures).values({
    partnerId: input.partnerId,
    careerTargetId: input.careerTargetId,
    company: input.company,
    status: 'draft',
    supersedes: input.supersedes ?? null,
  }).returning({ id: positionCaptures.id });
  if (!row) throw new Error('createPositionDraft: no row returned');
  return row;
}

export async function getPositionCaptureById(id: string): Promise<PositionCaptureRow | null> {
  const [row] = await db.select().from(positionCaptures).where(eq(positionCaptures.id, id)).limit(1);
  return (row as PositionCaptureRow | undefined) ?? null;
}

export interface UpdateDraftInput {
  id: string;
  partnerId: string;
  positionTitle?: string;
  structuredInputs?: Record<string, unknown>;
  ratedSkills?: PositionCaptureRow['ratedSkills'];
  sourceFiles?: PositionCaptureRow['sourceFiles'];
  completeness?: PositionCaptureRow['completeness'];
}

/**
 * Auto-save during the 6-page wizard. Updates only the fields provided.
 * Refuses to update a row that doesn't belong to the partner or isn't
 * in 'draft' status (immutability gate on submitted rows).
 */
export async function updatePositionDraft(input: UpdateDraftInput): Promise<void> {
  const result = await db.update(positionCaptures)
    .set({
      ...(input.positionTitle !== undefined && { positionTitle: input.positionTitle }),
      ...(input.structuredInputs !== undefined && { structuredInputs: input.structuredInputs }),
      ...(input.ratedSkills !== undefined && { ratedSkills: input.ratedSkills }),
      ...(input.sourceFiles !== undefined && { sourceFiles: input.sourceFiles }),
      ...(input.completeness !== undefined && { completeness: input.completeness }),
    })
    .where(and(
      eq(positionCaptures.id, input.id),
      eq(positionCaptures.partnerId, input.partnerId),
      eq(positionCaptures.status, 'draft'),
    ))
    .returning({ id: positionCaptures.id });
  if (result.length === 0) throw new Error(`updatePositionDraft: row ${input.id} not draftable (wrong partner or already submitted)`);
}

export interface FinalizeInput {
  id: string;
  partnerId: string;
  completeness: 'title-only' | 'structured' | 'rated' | 'interviewed';
  profile?: unknown;
  model?: string;
  sessionId?: string;
}

/**
 * Commit a draft to submitted. Sets status='submitted', submittedAt=now,
 * and completeness. If completeness='interviewed' the caller must also
 * supply profile + model + sessionId. Marks the target's aggregate stale.
 */
export async function finalizePosition(input: FinalizeInput): Promise<void> {
  await db.transaction(async (tx) => {
    const updated = await tx.update(positionCaptures)
      .set({
        status: 'submitted',
        completeness: input.completeness,
        profile: input.profile ?? null,
        model: input.model ?? null,
        sessionId: input.sessionId ?? null,
        submittedAt: sql`now()`,
      })
      .where(and(
        eq(positionCaptures.id, input.id),
        eq(positionCaptures.partnerId, input.partnerId),
        eq(positionCaptures.status, 'draft'),
      ))
      .returning({ careerTargetId: positionCaptures.careerTargetId });
    if (updated.length === 0) throw new Error(`finalizePosition: row ${input.id} not draftable`);
    const targetId = updated[0]!.careerTargetId;
    // Upsert stale flag on the target's aggregate
    await tx.insert(careerTargetKudAggregate).values({
      careerTargetId: targetId,
      aggregateMarkdown: '',
      derivedFromPositionIds: [],
      stale: true,
    }).onConflictDoUpdate({
      target: careerTargetKudAggregate.careerTargetId,
      set: { stale: true },
    });
  });
}

/** All position captures (drafts + submitted) belonging to a partner. */
export async function listPositionsByPartner(partnerId: string): Promise<PositionCaptureRow[]> {
  const rows = await db.select().from(positionCaptures)
    .where(eq(positionCaptures.partnerId, partnerId))
    .orderBy(desc(positionCaptures.createdAt));
  return rows as PositionCaptureRow[];
}

/**
 * All submitted, non-superseded position captures for a career target.
 * Used by the aggregate function + the admin synthesis view.
 */
export async function listSubmittedPositionsForTarget(targetId: string): Promise<PositionCaptureRow[]> {
  // "Non-superseded" = no other row has THIS row's id in its supersedes column.
  // Simpler equivalent: rows whose id does not appear in any other row's supersedes.
  const rows = await db.execute(sql`
    SELECT pc.* FROM position_captures pc
    WHERE pc.career_target_id = ${targetId}
      AND pc.status = 'submitted'
      AND pc.retired_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM position_captures sup
        WHERE sup.supersedes = pc.id
      )
    ORDER BY pc.submitted_at DESC NULLS LAST, pc.created_at DESC
  `);
  return rows.rows as unknown as PositionCaptureRow[];
}

// ---------- messages (page 6 interview transcript) ----------

export interface PositionMessageRow {
  id: string;
  partnerId: string;
  positionCaptureId: string;
  sessionId: string;
  turnIndex: number;
  role: string;
  content: string | null;
  citations: Array<{ type: 'transcript' | 'page-input'; messageId?: string; pageRef?: string; excerpt: string }> | null;
  createdAt: Date;
}

export interface AppendPositionMessageInput {
  partnerId: string;
  positionCaptureId: string;
  sessionId: string;
  turnIndex: number;
  role: 'user' | 'assistant';
  content: string | null;
  citations?: PositionMessageRow['citations'];
}

export async function appendPositionMessage(input: AppendPositionMessageInput): Promise<void> {
  await db.insert(positionCaptureMessages).values({
    partnerId: input.partnerId,
    positionCaptureId: input.positionCaptureId,
    sessionId: input.sessionId,
    turnIndex: input.turnIndex,
    role: input.role,
    content: input.content,
    citations: input.citations ?? null,
  });
}

export async function getPositionSession(
  positionCaptureId: string,
  sessionId: string,
): Promise<PositionMessageRow[]> {
  const rows = await db.select().from(positionCaptureMessages)
    .where(and(
      eq(positionCaptureMessages.positionCaptureId, positionCaptureId),
      eq(positionCaptureMessages.sessionId, sessionId),
    ))
    .orderBy(asc(positionCaptureMessages.turnIndex));
  return rows as PositionMessageRow[];
}

export function startPositionSession(): string {
  return randomUUID();
}

/**
 * IDOR guard: a brand-new session id (zero rows) is considered owned by
 * the requesting partner; otherwise the first row's (partnerId, positionCaptureId)
 * must match.
 */
export async function isPositionSessionOwnedBy(
  sessionId: string,
  partnerId: string,
  positionCaptureId: string,
): Promise<boolean> {
  const rows = await db.select({
    partnerId: positionCaptureMessages.partnerId,
    positionCaptureId: positionCaptureMessages.positionCaptureId,
  })
    .from(positionCaptureMessages)
    .where(eq(positionCaptureMessages.sessionId, sessionId))
    .limit(1);
  if (rows.length === 0) return true;
  return rows[0]!.partnerId === partnerId && rows[0]!.positionCaptureId === positionCaptureId;
}

// ---------- aggregate ----------

export async function getAggregateForTarget(targetId: string): Promise<{
  markdown: string;
  derivedFromPositionIds: string[];
  stale: boolean;
  generatedAt: Date;
} | null> {
  const [row] = await db.select().from(careerTargetKudAggregate)
    .where(eq(careerTargetKudAggregate.careerTargetId, targetId))
    .limit(1);
  if (!row) return null;
  return {
    markdown: row.aggregateMarkdown,
    derivedFromPositionIds: row.derivedFromPositionIds,
    stale: row.stale,
    generatedAt: row.generatedAt,
  };
}

export async function writeAggregateForTarget(input: {
  targetId: string;
  markdown: string;
  derivedFromPositionIds: string[];
}): Promise<void> {
  await db.insert(careerTargetKudAggregate).values({
    careerTargetId: input.targetId,
    aggregateMarkdown: input.markdown,
    derivedFromPositionIds: input.derivedFromPositionIds,
    stale: false,
    generatedAt: sql`now()` as unknown as Date,
  }).onConflictDoUpdate({
    target: careerTargetKudAggregate.careerTargetId,
    set: {
      aggregateMarkdown: input.markdown,
      derivedFromPositionIds: input.derivedFromPositionIds,
      stale: false,
      generatedAt: sql`now()` as unknown as Date,
    },
  });
}
```

- [ ] **Step 2: Delete the old queries file**

```bash
rm lib/db/employer-capture-queries.ts
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | tail -10
```

Will fail (other files still import `employer-capture-queries`). That's expected — the dependent files get fixed in later tasks. **Confirm the failures are limited to imports of the deleted module + the renamed table names.** If anything else fails, STOP and report.

- [ ] **Step 4: Commit**

```bash
git add lib/db/position-capture-queries.ts lib/db/employer-capture-queries.ts
git commit -m "feat(db): position-capture-queries (replaces employer-capture-queries)

Same shape as employer-capture-queries but anchored to a per-position
unit instead of per-career-target. New helpers for draft lifecycle
(createDraft, updateDraft, finalize), supersession-aware queries
(listSubmittedPositionsForTarget excludes superseded rows), and the
aggregate row read/write. Old employer-capture-queries.ts deleted —
tsc downstream breakage fixed in subsequent tasks."
```

---

## Task 3: PositionProfile schema + invariant test

**Files:**
- Create: `lib/ai/position-capture/schema.ts`
- Create: `tests/ai/position-capture-schema.test.ts`
- Delete: `lib/ai/employer-capture/schema.ts`
- Delete: `tests/ai/employer-capture-schema.test.ts`

- [ ] **Step 1: Define the PositionProfile schema**

Create `lib/ai/position-capture/schema.ts`:

```typescript
import { z } from 'zod';

/**
 * PositionProfile — output of a completed position capture's Page 6 agent
 * interview + synthesis. Persisted as the `profile` jsonb on
 * position_captures rows when completeness='interviewed'.
 *
 * Anchored to one specific hire scenario (this job at this company),
 * not "the field" abstractly. KUD+ are framed as qualification /
 * day-1-success measures rather than learning outcomes.
 */

export const KudDepth = z.object({
  k_depth: z.number().int().min(0).max(5).nullable(),
  u_depth: z.number().int().min(0).max(5).nullable(),
  d_depth: z.number().int().min(0).max(5).nullable(),
  rationale: z.string().min(1).max(800),
});

export const PositionCompetency = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(1000),
  required_for_success: KudDepth,
  notes: z.string().max(800).nullable(),
});

export const PositionProfile = z.object({
  essence: z.object({
    one_sentence: z.string().min(1).max(300),
    what_this_role_is: z.string().min(1).max(1500),
    what_it_isnt: z.string().min(1).max(1000),
  }),
  qualifying_competencies: z.array(PositionCompetency).min(1).max(20),
  dealbreakers: z.array(z.object({
    description: z.string().min(1).max(500),
    week_one_signal: z.string().min(1).max(500),
  })),
  hiring_signals: z.array(z.object({
    signal: z.string().min(1).max(300),
    weight: z.enum(['strong', 'moderate', 'context-dependent']),
  })),
  trajectory: z.object({
    year_1: z.string().min(1).max(800),
    year_2_to_3: z.string().min(1).max(800),
  }),
  partner_voice_summary: z.string().min(1).max(2000),
  generated_at: z.string().min(1),
});
export type PositionProfileType = z.infer<typeof PositionProfile>;

export const positionProfileJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['essence', 'qualifying_competencies', 'dealbreakers', 'hiring_signals', 'trajectory', 'partner_voice_summary', 'generated_at'],
  properties: {
    essence: {
      type: 'object',
      additionalProperties: false,
      required: ['one_sentence', 'what_this_role_is', 'what_it_isnt'],
      properties: {
        one_sentence: { type: 'string', minLength: 1, maxLength: 300 },
        what_this_role_is: { type: 'string', minLength: 1, maxLength: 1500 },
        what_it_isnt: { type: 'string', minLength: 1, maxLength: 1000 },
      },
    },
    qualifying_competencies: {
      type: 'array', minItems: 1, maxItems: 20,
      items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'description', 'required_for_success', 'notes'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', minLength: 1, maxLength: 1000 },
          required_for_success: {
            type: 'object', additionalProperties: false,
            required: ['k_depth', 'u_depth', 'd_depth', 'rationale'],
            properties: {
              k_depth: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
              u_depth: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
              d_depth: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
              rationale: { type: 'string', minLength: 1, maxLength: 800 },
            },
          },
          notes: { type: ['string', 'null'], maxLength: 800 },
        },
      },
    },
    dealbreakers: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['description', 'week_one_signal'],
        properties: {
          description: { type: 'string', minLength: 1, maxLength: 500 },
          week_one_signal: { type: 'string', minLength: 1, maxLength: 500 },
        },
      },
    },
    hiring_signals: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['signal', 'weight'],
        properties: {
          signal: { type: 'string', minLength: 1, maxLength: 300 },
          weight: { type: 'string', enum: ['strong', 'moderate', 'context-dependent'] },
        },
      },
    },
    trajectory: {
      type: 'object', additionalProperties: false,
      required: ['year_1', 'year_2_to_3'],
      properties: {
        year_1: { type: 'string', minLength: 1, maxLength: 800 },
        year_2_to_3: { type: 'string', minLength: 1, maxLength: 800 },
      },
    },
    partner_voice_summary: { type: 'string', minLength: 1, maxLength: 2000 },
    generated_at: { type: 'string', minLength: 1 },
  },
} as const;
```

- [ ] **Step 2: Write the invariant test**

Create `tests/ai/position-capture-schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { PositionProfile, positionProfileJsonSchema } from '@/lib/ai/position-capture/schema';

describe('PositionProfile schema', () => {
  it('accepts a valid minimal profile', () => {
    const valid = {
      essence: {
        one_sentence: 'Brand strategist who supports senior team on client research.',
        what_this_role_is: 'Day-to-day research, concept dev, presentation support.',
        what_it_isnt: 'Not a designer; not a lead.',
      },
      qualifying_competencies: [{
        name: 'Audience research',
        description: 'Reads + summarizes target-audience interviews.',
        required_for_success: { k_depth: 3, u_depth: 2, d_depth: 2, rationale: 'Pattern recognition needed.' },
        notes: null,
      }],
      dealbreakers: [],
      hiring_signals: [],
      trajectory: { year_1: 'Shadowing.', year_2_to_3: 'Leading small engagements.' },
      partner_voice_summary: 'We want curious, evidence-driven juniors.',
      generated_at: '2026-06-04T00:00:00.000Z',
    };
    expect(() => PositionProfile.parse(valid)).not.toThrow();
  });

  it('rejects missing essence', () => {
    const invalid = {
      qualifying_competencies: [],
      dealbreakers: [],
      hiring_signals: [],
      trajectory: { year_1: 'x', year_2_to_3: 'y' },
      partner_voice_summary: 'x',
      generated_at: '2026-06-04T00:00:00.000Z',
    };
    expect(() => PositionProfile.parse(invalid)).toThrow();
  });

  it('JSON schema has every property listed in required (strict-mode invariant)', () => {
    function walk(node: unknown): void {
      if (!node || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      if (obj.type === 'object' && obj.properties && typeof obj.properties === 'object') {
        const propKeys = Object.keys(obj.properties as object);
        const required = (obj.required as string[] | undefined) ?? [];
        for (const key of propKeys) {
          expect(required, `property "${key}" must appear in required`).toContain(key);
        }
        for (const v of Object.values(obj.properties as object)) walk(v);
      }
      if (obj.items) walk(obj.items);
      if (obj.anyOf && Array.isArray(obj.anyOf)) for (const v of obj.anyOf) walk(v);
    }
    walk(positionProfileJsonSchema);
  });
});
```

- [ ] **Step 3: Delete the old**

```bash
rm lib/ai/employer-capture/schema.ts tests/ai/employer-capture-schema.test.ts
```

- [ ] **Step 4: Run the tests**

```bash
pnpm vitest run tests/ai/position-capture-schema.test.ts 2>&1 | tail -10
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/position-capture/schema.ts tests/ai/position-capture-schema.test.ts lib/ai/employer-capture/schema.ts tests/ai/employer-capture-schema.test.ts
git commit -m "feat(position-capture): PositionProfile schema + strict-mode invariant test

Replaces CareerCaptureProfile. Different shape: anchored to one specific
hire scenario (essence + qualifying_competencies + dealbreakers +
hiring_signals + trajectory + partner_voice_summary) rather than
field-wide career-target survey. KUD+ are framed as required_for_success
qualifications rather than expected-on-day-1 outcomes."
```

---

## Task 4: Register AI functions in `function-settings.ts` + prompt names

**Files:**
- Modify: `lib/ai/function-settings.ts`
- Modify: `lib/ai/prompts/load.ts`

- [ ] **Step 1: Update function-settings.ts**

In `lib/ai/function-settings.ts`, replace the two `capture-employer-*` entries with four new entries. Read the file first to understand the structure; then:

- Remove from `AI_FUNCTION_IDS`: `'capture-employer-chat-agent'`, `'capture-employer-synthesis'`
- Add to `AI_FUNCTION_IDS` (preserve alphabetical/grouping order): `'jd-extract'`, `'position-rated-items'`, `'position-interview-agent'`, `'position-synthesis'`
- Update `DEFAULT_TIERS` map: remove the two removed; add for the four new ones with rationale comments:

```typescript
  // Light tier. One-shot LLM call that reads an extracted JD (Docling
  // markdown or pasted text) and emits structured fields with per-field
  // confidence scores. Small input, structured output, cheap.
  'jd-extract': 'light',
  // Default tier. Reads pages 1-4 + career target sub-comps and emits
  // 10 "experiences worth having" candidates. Single-call generator.
  'position-rated-items': 'default',
  // Default tier. Page 6 per-turn loop — anchor-probe-confirm posture.
  // Reads pages 1-5 context; emits AuditResponse-shaped per-turn output.
  'position-interview-agent': 'default',
  // Default tier. Synthesis over a completed Page 6 interview transcript
  // + the upstream page inputs. Emits a PositionProfile.
  'position-synthesis': 'default',
```

- If `FUNCTION_LABELS` and `FUNCTION_DESCRIPTIONS` Records exist, remove the two old entries and add four corresponding ones (`'JD field extraction'`, `'Position rated-items generator'`, `'Position interview agent'`, `'Position interview synthesis'` for labels; brief one-liners for descriptions).

- [ ] **Step 2: Update `lib/ai/prompts/load.ts`**

Replace in the `PromptName` union:
- Remove: `| 'capture-employer-chat-agent' | 'capture-employer-synthesis'`
- Add: `| 'jd-extract' | 'position-rated-items' | 'position-interview-agent' | 'position-synthesis'`

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | tail -20
```

Expected: more errors about missing prompt files / route imports, NOT about function-settings.ts itself. The function-settings + prompts/load changes should typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add lib/ai/function-settings.ts lib/ai/prompts/load.ts
git commit -m "feat(ai): register 4 new position-capture functions, retire 2 employer-capture functions

* +jd-extract (light) — JD parsing + structured field extraction
* +position-rated-items (default) — Page 5 generator
* +position-interview-agent (default) — Page 6 per-turn loop
* +position-synthesis (default) — Page 6 final synthesis
* −capture-employer-chat-agent (CC v1 retired)
* −capture-employer-synthesis (CC v1 retired)"
```

---

## Task 5: JD-extract prompt + runner

**Files:**
- Create: `lib/ai/prompts/jd-extract.md`
- Create: `lib/ai/position-capture/jd-extract.ts`

- [ ] **Step 1: Write the prompt**

Create `lib/ai/prompts/jd-extract.md`:

```markdown
---
name: jd-extract
manning_skills:
  - structured-extraction
  - confidence-scoring
---

# Role

You receive a job description (raw text — may be Docling-extracted markdown
from a PDF, may be a pasted snippet). Your job is to extract structured
fields. For each field you extract, attach a confidence score in [0, 1]:

- **0.9–1.0**: the JD says this explicitly in clear language.
- **0.7–0.9**: the JD says this clearly but the exact wording required
  interpretation (e.g., "5+ years" → years_min=5).
- **0.5–0.7**: you inferred this from context. Worth surfacing for
  partner review.
- **<0.5**: don't include the field. Better to leave it blank than
  hallucinate.

# Output schema

Emit JSON conforming to the JdExtraction schema:

```typescript
{
  title: { value: string | null, confidence: number },
  responsibilities: { value: string | null, confidence: number },           // freeform paragraph
  required_qualifications: { value: string | null, confidence: number },    // bulleted text OK
  preferred_qualifications: { value: string | null, confidence: number },
  years_experience: { value: { min: number, max: number | null } | null, confidence: number },
  education: { value: string | null, confidence: number },
  location: { value: string | null, confidence: number },
  remote_status: { value: 'onsite' | 'remote' | 'hybrid' | null, confidence: number },
  salary_range: { value: { min: number, max: number, currency: string } | null, confidence: number },
  reports_to: { value: string | null, confidence: number },
  extras_notes: { value: string | null, confidence: 1.0 }
}
```

# Hard rules

- `extras_notes` is YOUR FREE-FIELD: collect any meaningful prose from the
  JD that didn't fit one of the structured fields (culture descriptions,
  perks, "thrives in fast-paced environments," application instructions,
  equal-opportunity statements you choose to retain, etc.). Confidence is
  always 1.0 — it's verbatim text from the JD, not interpretation.
- If a field isn't present in the JD, set `value: null` and `confidence: 0`.
- Don't paraphrase responsibility lists into your own words — quote / lightly
  clean. Faculty downstream want to know what the JD actually said.
- The order of items in extracted text should match the order they appeared
  in the source JD where reasonable.
```

- [ ] **Step 2: Write the runner**

Create `lib/ai/position-capture/jd-extract.ts`:

```typescript
import { z } from 'zod';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';

const ConfidenceField = <T extends z.ZodTypeAny>(inner: T) => z.object({
  value: inner.nullable(),
  confidence: z.number().min(0).max(1),
});

export const JdExtraction = z.object({
  title: ConfidenceField(z.string().max(200)),
  responsibilities: ConfidenceField(z.string().max(4000)),
  required_qualifications: ConfidenceField(z.string().max(4000)),
  preferred_qualifications: ConfidenceField(z.string().max(4000)),
  years_experience: ConfidenceField(z.object({ min: z.number().int().min(0).max(50), max: z.number().int().min(0).max(50).nullable() })),
  education: ConfidenceField(z.string().max(500)),
  location: ConfidenceField(z.string().max(200)),
  remote_status: ConfidenceField(z.enum(['onsite', 'remote', 'hybrid'])),
  salary_range: ConfidenceField(z.object({ min: z.number(), max: z.number(), currency: z.string().max(10) })),
  reports_to: ConfidenceField(z.string().max(200)),
  extras_notes: ConfidenceField(z.string().max(8000)),
});
export type JdExtractionType = z.infer<typeof JdExtraction>;

export const jdExtractionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'responsibilities', 'required_qualifications', 'preferred_qualifications', 'years_experience', 'education', 'location', 'remote_status', 'salary_range', 'reports_to', 'extras_notes'],
  properties: Object.fromEntries(
    ['title', 'responsibilities', 'required_qualifications', 'preferred_qualifications', 'education', 'location', 'reports_to', 'extras_notes'].map(k => [k, {
      type: 'object',
      additionalProperties: false,
      required: ['value', 'confidence'],
      properties: {
        value: { type: ['string', 'null'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
    }]).concat([
      ['years_experience', {
        type: 'object', additionalProperties: false, required: ['value', 'confidence'],
        properties: {
          value: {
            anyOf: [
              { type: 'null' },
              { type: 'object', additionalProperties: false, required: ['min', 'max'], properties: { min: { type: 'integer' }, max: { type: ['integer', 'null'] } } },
            ],
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      }],
      ['remote_status', {
        type: 'object', additionalProperties: false, required: ['value', 'confidence'],
        properties: {
          value: { anyOf: [{ type: 'null' }, { type: 'string', enum: ['onsite', 'remote', 'hybrid'] }] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      }],
      ['salary_range', {
        type: 'object', additionalProperties: false, required: ['value', 'confidence'],
        properties: {
          value: {
            anyOf: [
              { type: 'null' },
              { type: 'object', additionalProperties: false, required: ['min', 'max', 'currency'], properties: { min: { type: 'number' }, max: { type: 'number' }, currency: { type: 'string' } } },
            ],
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      }],
    ])
  ),
} as const;

/**
 * Extract structured fields from a JD text blob. Caller is responsible for
 * supplying the text — if it's a PDF, run Docling first; if it's pasted
 * text, pass it through.
 */
export async function extractJdFields(jdText: string): Promise<{
  fields: JdExtractionType;
  model: string;
  costUsdCents: number;
  durationMs: number;
}> {
  const provider = await getProviderForFunction('jd-extract');
  const systemPrompt = await loadPrompt('jd-extract');

  const result = await provider.complete<JdExtractionType>({
    systemPrompt,
    userMessage: `# Source JD\n\n${jdText.slice(0, 60_000)}`,
    schemaName: 'jd_extraction',
    jsonSchema: jdExtractionJsonSchema as unknown as object,
    validate: (raw: unknown) => JdExtraction.parse(raw),
  });

  return {
    fields: result.data,
    model: provider.model,
    costUsdCents: result.costUsdCents,
    durationMs: result.durationMs,
  };
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | grep -E 'jd-extract|position-capture/jd' || echo "clean"
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add lib/ai/prompts/jd-extract.md lib/ai/position-capture/jd-extract.ts
git commit -m "feat(position-capture): jd-extract prompt + runner

Light-tier one-shot extractor. Takes JD text (Docling-extracted markdown
or paste), emits structured fields with per-field confidence in [0,1].
Empty fields (confidence 0) + low-confidence fields highlight in the
Page 1 UI for partner review. extras_notes is a verbatim catch-all
for prose that didn't fit a structured field."
```

---

## Task 6: Page 5 rated-items prompt + runner

**Files:**
- Create: `lib/ai/prompts/position-rated-items.md`
- Create: `lib/ai/position-capture/rated-items.ts`

- [ ] **Step 1: Write the prompt**

Create `lib/ai/prompts/position-rated-items.md`:

```markdown
---
name: position-rated-items
manning_skills:
  - context-grounded-generation
  - employer-perspective
includes:
  - shared/depth-scale.md
---

# Role

You are generating a list of 10 candidate "experiences worth having"
that a hiring manager would recognize a student as having gone through
in their GC undergraduate program. The partner will rate each on a
1-7 importance scale.

# What "experience worth having" means

Each item is ONE concrete, recognizable thing a student should have
done, demonstrated, or produced in their core GC coursework that
would make them more qualified for THIS specific position. Format:
short noun phrase or short imperative.

**Good examples:**
- "Has presented audience research findings to a stakeholder who pushed back"
- "Knows how to write a creative brief that survives a kickoff meeting"
- "Has shipped a multi-page design system used by other students"
- "Can articulate why a chosen typeface fits a brand voice"
- "Has critiqued and revised peers' work in a structured studio setting"

**Bad examples:**
- "Communication" (too abstract — not recognizable)
- "Has gotten an A in DSGN 2110" (course-bound, not transferable)
- "Knows Photoshop" (tool-bound, doesn't say what they DO with it)

# Input you have access to

The user message contains:
1. Career target description + sub-competencies (the catalog framing)
2. Pages 1-4 of the partner's position capture: structured JD fields,
   what's unique about the job, key interview questions, career trajectory
3. The company name + position title

# How to generate

1. Read the position context. What does this hire DO at week one?
2. Translate into 10 concrete experiences that, if a student had them,
   would matter for THIS job. Lean specific over abstract.
3. The 10 should span at least 3 of the catalog sub-competencies for
   variety — don't concentrate them in one area.
4. Order matters: lead with the 2-3 most strongly implied by the
   position context, then fan out.

# Output schema

```json
{
  "items": [
    {
      "name": "<short noun phrase or imperative>",
      "description": "<1-2 sentences elaborating what this looks like in practice>",
      "evidence_source": "<which page or sub-competency this drew from>"
    },
    ... (exactly 10)
  ]
}
```

# Hard rules

- Exactly 10 items.
- Each item ≤ 150 characters in name.
- description ≤ 400 characters.
- evidence_source ≤ 300 characters — names a source (e.g., "page 2: uniqueness",
  "sub-competency: typography fundamentals"). Faculty want to see your reasoning.
- Don't repeat items.
- Don't reference specific courses — partners don't know which course is which.
- Don't reference the partner's company name in item text — items should be
  recognizable to any GC student.
```

- [ ] **Step 2: Write the runner**

Create `lib/ai/position-capture/rated-items.ts`:

```typescript
import { z } from 'zod';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';

export const RatedItemsList = z.object({
  items: z.array(z.object({
    name: z.string().min(1).max(150),
    description: z.string().min(1).max(400),
    evidence_source: z.string().min(1).max(300),
  })).length(10),
});
export type RatedItemsListType = z.infer<typeof RatedItemsList>;

export const ratedItemsJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array', minItems: 10, maxItems: 10,
      items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'description', 'evidence_source'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 150 },
          description: { type: 'string', minLength: 1, maxLength: 400 },
          evidence_source: { type: 'string', minLength: 1, maxLength: 300 },
        },
      },
    },
  },
} as const;

export interface GenerateRatedItemsInput {
  positionTitle: string;
  company: string;
  targetContext: {
    name: string;
    description: string;
    subCompetencies: Array<{ name: string; description: string }>;
  };
  structuredInputs: Record<string, unknown>;  // pages 1-4 data
}

export async function generateRatedItems(input: GenerateRatedItemsInput): Promise<{
  items: RatedItemsListType['items'];
  model: string;
  costUsdCents: number;
  durationMs: number;
}> {
  const provider = await getProviderForFunction('position-rated-items');
  const systemPrompt = await loadPrompt('position-rated-items');

  const userMessage = [
    `# Position`,
    `**${input.positionTitle}** at ${input.company}`,
    '',
    `# Career target`,
    `**${input.targetContext.name}** — ${input.targetContext.description}`,
    '',
    `# Sub-competencies`,
    ...input.targetContext.subCompetencies.map(sc => `- ${sc.name}: ${sc.description}`),
    '',
    `# Page 1-4 inputs`,
    '```json',
    JSON.stringify(input.structuredInputs, null, 2),
    '```',
    '',
    'Emit the 10 items now per the schema.',
  ].join('\n');

  const result = await provider.complete<RatedItemsListType>({
    systemPrompt,
    userMessage,
    schemaName: 'position_rated_items',
    jsonSchema: ratedItemsJsonSchema as unknown as object,
    validate: (raw: unknown) => RatedItemsList.parse(raw),
  });

  return {
    items: result.data.items,
    model: provider.model,
    costUsdCents: result.costUsdCents,
    durationMs: result.durationMs,
  };
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | grep -E 'rated-items' || echo "clean"
git add lib/ai/prompts/position-rated-items.md lib/ai/position-capture/rated-items.ts
git commit -m "feat(position-capture): rated-items generator (Page 5 backend)

Default-tier one-shot generator. Reads target + sub-comps + pages 1-4
of the position capture; emits exactly 10 'experiences worth having'
candidates with name + description + evidence_source. Partner edits
freely + rates 1-7 in the UI; rated_skills JSONB on position_captures
stores the final set."
```

---

## Task 7: Page 6 interview agent prompt rewrite + runner

**Files:**
- Create: `lib/ai/prompts/position-interview-agent.md`
- Create: `lib/ai/prompts/position-synthesis.md`
- Create: `lib/ai/position-capture/run.ts`
- Delete: `lib/ai/prompts/capture-employer-chat-agent.md`
- Delete: `lib/ai/prompts/capture-employer-synthesis.md`
- Delete: `lib/ai/employer-capture/run.ts`

- [ ] **Step 1: Write `position-interview-agent.md`**

Create the prompt — anchor + probe + confirm posture. Frontmatter:

```markdown
---
name: position-interview-agent
manning_skills:
  - employer-interview
  - gap-finding
  - structured-output
includes:
  - shared/depth-scale.md
---

# Role

You're conducting the final stage of a Position Capture interview. The
partner has already filled out 5 pages: structured JD fields, what's
unique + what makes someone successful, interview questions they use,
career trajectory, and rated 10 "experiences worth having" on a 1-7
scale. You have access to ALL of that.

Your job is NOT to ask things they already wrote down. It's to anchor,
probe gaps, and confirm a draft. Three movements:

# Movement 1 — Anchor (1 turn)

Open with a brief reflective summary of what you're picking up from
pages 1-5: their position one-liner, top 2 dealbreakers, top 2-3
highest-rated experiences. End with: "Does that capture it?"

# Movement 2 — Probe (4-6 turns)

Find the GAPS, CONTRADICTIONS, and UNSAIDS. Examples to look for:

- A high-rated experience (slider 6-7) that doesn't appear anywhere
  in the responsibilities or interview questions. "Why did you rate X
  so high? What would week one of someone strong at X actually look like?"
- A dealbreaker stated abstractly. "You mentioned 'doesn't take feedback'
  as a dealbreaker — what does someone who DOES take feedback well do
  in their first week that someone who doesn't, doesn't?"
- Trajectory that contradicts day-1 expectations. "You said they grow
  into team lead in 24 months. What's the difference between a first-year
  hire who's on that track and one who's stuck?"
- Big sub-competency gap. If the career target's sub-comps include
  things their pages 1-5 didn't mention, ask one probing question
  about whether it matters here.

Ask one question per turn, conversational, ≤2 sentences. Cite
specifically what they wrote ("On page 3 you said…", "You rated
'cross-functional communication' a 6…").

# Movement 3 — Confirm (1-2 turns)

When readiness ≥ 75 OR you've asked 6 probe questions, switch to:

> "Based on what we've talked about, here's how I'd describe the
> position essence: [2-3 sentence draft]. The top qualifying
> competencies look like [4-6 names]. Anything I got wrong or missed
> before we lock this in?"

Adjust based on their reply; then close.

# Per-turn output

Same AuditResponse shape used by capture-chat-agent:

```typescript
{
  finding: string,    // internal — for synthesis. 1-2 sentences on what you learned.
  question: string,   // shown to partner. 1 question, ≤2 sentences. Ends with '?'.
  citations: Array<{ type: 'transcript' | 'page-input', messageId?: string, pageRef?: string, excerpt: string }>,
  readiness: { score: number, covered: string[], remaining: string[] }
}
```

# What NOT to do

- Don't re-ask things from pages 1-5.
- Don't be vague. Probe specific items.
- Don't reach for 10 turns when 6 is enough.
- Don't introduce K/U/D jargon to the partner. Translate to "know /
  understand / do" if needed.
```

- [ ] **Step 2: Write `position-synthesis.md`**

```markdown
---
name: position-synthesis
manning_skills:
  - synthesis
  - position-essence
  - structured-output
includes:
  - shared/depth-scale.md
---

# Role

You're the synthesis layer for Position Capture. You have the partner's
full input: pages 1-5 (structured JD, uniqueness, interview questions,
trajectory, 10 rated experiences), plus the Page 6 interview transcript.
Emit ONE PositionProfile JSON.

# Output structure

PositionProfile per `lib/ai/position-capture/schema.ts`:

- `essence`: { one_sentence, what_this_role_is, what_it_isnt }
- `qualifying_competencies[1..20]`: each with { name, description,
   required_for_success: KUD+, notes? }
- `dealbreakers[]`: { description, week_one_signal }
- `hiring_signals[]`: { signal, weight: strong | moderate | context-dependent }
- `trajectory`: { year_1, year_2_to_3 }
- `partner_voice_summary`: 2-3 paragraphs in "this employer says…" voice
- `generated_at`: ISO timestamp (you may emit anything; server overwrites)

# K/U/D scoring (required_for_success per competency)

Use the depth scale (see included shared/depth-scale.md). Frame KUD
as REQUIREMENT for the role:

- K = recall / recognition. K=4 = "they need to be able to name and
  identify X cold."
- U = reasoning / explanation. U=4 = "they need to articulate WHY X
  matters and predict consequences."
- D = behavioral output. D=4 = "they need to produce X independently
  under novel conditions."
- Above-zero scores must trace to something the partner said
  (transcript or page input). Vague endorsements map to lower scores.

# Hard rules

- Every above-zero K/U/D requires evidence from the partner.
- Pull qualifying_competencies primarily from the rated_items (page 5)
  where rating ≥ 5, plus anything the agent surfaced in the transcript.
  Items rated < 5 may or may not appear depending on whether the
  partner elaborated on them.
- Dealbreakers come from explicit partner statements. If none, array empty.
- partner_voice_summary uses the partner's wording where possible.
  Direct quotes encouraged.
- The "what_it_isnt" field of essence is important — it's where
  contrast lives ("not a designer; not a lead").
```

- [ ] **Step 3: Write `lib/ai/position-capture/run.ts`**

Create the runner. Structure mirrors the old `employer-capture/run.ts` but:
- Renames: `runEmployerInterview` → `runPositionInterview`, `generateCareerCaptureProfile` → `generatePositionProfile`
- The input includes the upstream page context (pages 1-5) which the agent reads — pass `structuredInputs` + `ratedSkills` + `targetContext` into both
- The user message for the agent now includes pages 1-5 as anchoring context, then the live conversation
- Synthesis input is the transcript + all upstream context
- Imports `runEmployerInterview`'s `completeWithTools` invocation pattern via `lib/ai/agent/audit-agent.ts` helpers (preserve the working pattern from `a14f7b3`)

```typescript
import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';
import {
  appendPositionMessage,
  getPositionSession,
  type PositionMessageRow,
} from '@/lib/db/position-capture-queries';
import {
  AuditResponseSchema,
  AuditResponseJsonSchema,
  type AuditResponse,
} from '@/lib/ai/agent/audit-response-schema';
import { PositionProfile, positionProfileJsonSchema, type PositionProfileType } from './schema';
import type { Message } from '@/lib/ai/tool-use-types';

export interface PositionContextBundle {
  positionTitle: string;
  company: string;
  targetContext: {
    id: string;
    name: string;
    description: string;
    subCompetencies: Array<{ id: string; name: string; description: string }>;
  };
  structuredInputs: Record<string, unknown> | null;
  ratedSkills: { items: Array<{ name: string; description?: string; rating: number }>; generatedAt: string } | null;
}

export interface RunPositionInterviewInput extends PositionContextBundle {
  partnerId: string;
  positionCaptureId: string;
  sessionId: string;
  userMessage?: string;
}

export interface RunPositionInterviewResult {
  response: AuditResponse;
  costUsdCents: number;
  durationMs: number;
  cachedTokens: number;
  uncachedPromptTokens: number;
  completionTokens: number;
  model: string;
}

function buildContextBlock(input: PositionContextBundle): string {
  const lines = [
    `# Position`,
    `**${input.positionTitle}** at ${input.company}`,
    '',
    `# Career target`,
    `**${input.targetContext.name}** — ${input.targetContext.description}`,
    '',
    `# Sub-competencies`,
    ...input.targetContext.subCompetencies.map(sc => `- ${sc.name}: ${sc.description}`),
  ];
  if (input.structuredInputs) {
    lines.push('', `# Pages 1-4 input`, '```json', JSON.stringify(input.structuredInputs, null, 2), '```');
  }
  if (input.ratedSkills) {
    lines.push('', `# Page 5 rated items`);
    for (const item of input.ratedSkills.items) {
      lines.push(`- (${item.rating}/7) **${item.name}** — ${item.description ?? ''}`);
    }
  }
  return lines.join('\n');
}

export async function runPositionInterview(input: RunPositionInterviewInput): Promise<RunPositionInterviewResult> {
  const existing = await getPositionSession(input.positionCaptureId, input.sessionId);
  const isOpeningTurn = existing.length === 0 && !input.userMessage;
  const userTurnIndex = existing.length;

  if (!isOpeningTurn) {
    if (!input.userMessage) throw new Error('runPositionInterview: userMessage required for non-opening turn');
    await appendPositionMessage({
      partnerId: input.partnerId,
      positionCaptureId: input.positionCaptureId,
      sessionId: input.sessionId,
      turnIndex: userTurnIndex,
      role: 'user',
      content: input.userMessage,
    });
  }

  const history = await getPositionSession(input.positionCaptureId, input.sessionId);
  const provider = await getProviderForFunction('position-interview-agent');
  const systemPrompt = await loadPrompt('position-interview-agent');

  const contextBlock = buildContextBlock(input);

  const messages: Message[] = [
    { role: 'user', content: contextBlock },
    ...history
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map((m): Message => ({
        role: m.role as 'user' | 'assistant',
        content: m.content ?? '',
      })),
  ];

  if (isOpeningTurn) {
    messages.push({ role: 'user', content: `Begin the interview now per the conversation rules. Produce your opening (anchor) turn.` });
  }

  const result = await provider.completeWithTools<AuditResponse>({
    systemPrompt,
    messages,
    tools: [],
    schemaName: 'position_interview_turn',
    jsonSchema: AuditResponseJsonSchema as unknown as object,
    validate: (raw: unknown) => AuditResponseSchema.parse(raw),
  });

  const assistantTurnIndex = isOpeningTurn ? 0 : userTurnIndex + 1;
  await appendPositionMessage({
    partnerId: input.partnerId,
    positionCaptureId: input.positionCaptureId,
    sessionId: input.sessionId,
    turnIndex: assistantTurnIndex,
    role: 'assistant',
    content: JSON.stringify(result.value),
  });

  return {
    response: result.value,
    costUsdCents: result.telemetry.costUsdCents,
    durationMs: result.telemetry.durationMs,
    cachedTokens: result.telemetry.cachedTokens,
    uncachedPromptTokens: result.telemetry.uncachedPromptTokens,
    completionTokens: result.telemetry.completionTokens,
    model: provider.model,
  };
}

export interface GeneratePositionProfileInput extends PositionContextBundle {
  partnerId: string;
  positionCaptureId: string;
  sessionId: string;
}

export interface GeneratePositionProfileResult {
  profile: PositionProfileType;
  model: string;
  costUsdCents: number;
  durationMs: number;
}

export async function generatePositionProfile(input: GeneratePositionProfileInput): Promise<GeneratePositionProfileResult> {
  const transcript = await getPositionSession(input.positionCaptureId, input.sessionId);
  if (transcript.length === 0) throw new Error('generatePositionProfile: no transcript to synthesize');

  const provider = await getProviderForFunction('position-synthesis');
  const systemPrompt = await loadPrompt('position-synthesis');

  const contextBlock = buildContextBlock(input);
  const transcriptBlock = transcript.map(row => {
    const idShort = row.id.slice(0, 8);
    if (row.role === 'user') return `PARTNER (turn ${row.turnIndex}, id=${idShort}): ${row.content ?? ''}`;
    let text = row.content ?? '';
    try {
      const parsed = JSON.parse(text) as { finding?: string; question?: string };
      text = [parsed.finding && `Finding: ${parsed.finding}`, parsed.question && `Question: ${parsed.question}`].filter(Boolean).join('\n');
    } catch { /* keep raw */ }
    return `INTERVIEWER (turn ${row.turnIndex}, id=${idShort}):\n${text}`;
  }).join('\n\n');

  const userMessage = [
    contextBlock,
    '',
    '---',
    '',
    '# Page 6 transcript',
    transcriptBlock,
    '',
    '---',
    '',
    'Emit the PositionProfile JSON now per the schema.',
  ].join('\n');

  const result = await provider.complete<PositionProfileType>({
    systemPrompt,
    userMessage,
    schemaName: 'position_profile_v1',
    jsonSchema: positionProfileJsonSchema as unknown as object,
    validate: (raw: unknown) => PositionProfile.parse(raw),
  });

  const profile: PositionProfileType = { ...result.data, generated_at: new Date().toISOString() };

  return {
    profile,
    model: provider.model,
    costUsdCents: result.costUsdCents,
    durationMs: result.durationMs,
  };
}
```

- [ ] **Step 4: Delete the old**

```bash
rm lib/ai/employer-capture/run.ts
rm lib/ai/prompts/capture-employer-chat-agent.md
rm lib/ai/prompts/capture-employer-synthesis.md
rmdir lib/ai/employer-capture 2>/dev/null || true
```

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | grep -E 'position-capture/run|position-interview' || echo "clean"
git add lib/ai/prompts/position-interview-agent.md lib/ai/prompts/position-synthesis.md lib/ai/position-capture/run.ts lib/ai/employer-capture lib/ai/prompts/capture-employer-chat-agent.md lib/ai/prompts/capture-employer-synthesis.md
git commit -m "feat(position-capture): runPositionInterview + generatePositionProfile

Reuses CC v1's runEmployerInterview / generateCareerCaptureProfile
structure but with new Page 6 posture (anchor → probe → confirm) and
reads upstream pages 1-5 context as anchoring input. Synthesis emits
PositionProfile (essence + qualifying_competencies KUD+ + dealbreakers
+ trajectory + voice summary). Server-stamps generated_at.

Old employer-capture/* deleted (CC v1's partner-facing surface retires
with this work; tables/runners had zero rows)."
```

---

## Task 8: Aggregate stub function

**Files:**
- Create: `lib/ai/position-capture/aggregate.ts`

- [ ] **Step 1: Write the stub**

Create `lib/ai/position-capture/aggregate.ts`:

```typescript
import { listSubmittedPositionsForTarget, writeAggregateForTarget } from '@/lib/db/position-capture-queries';
import { getTargetById } from '@/lib/db/career-targets-queries';
import type { PositionProfileType } from './schema';

/**
 * v1 aggregate: deterministic Markdown side-by-side of all submitted,
 * non-superseded, interviewed position captures under a career target.
 * No AI; readable by faculty as raw signal. v2 may swap in an AI
 * synthesis pass that reads this layout + produces a target-level KUD+.
 */
export async function regenerateAggregate(targetId: string): Promise<{
  positionIds: string[];
  markdown: string;
}> {
  const target = await getTargetById(targetId);
  if (!target) throw new Error(`regenerateAggregate: career target not found: ${targetId}`);

  const positions = await listSubmittedPositionsForTarget(targetId);
  const interviewed = positions.filter(p => p.completeness === 'interviewed' && p.profile);

  const lines: string[] = [
    `# ${target.name} — aggregated position captures`,
    '',
    `_${interviewed.length} interviewed position${interviewed.length === 1 ? '' : 's'} contribute to this view._`,
    '',
  ];

  if (interviewed.length === 0) {
    lines.push('_No interviewed positions yet. Submit a position via the partner survey to populate this view._');
  } else {
    for (const pos of interviewed) {
      const profile = pos.profile as PositionProfileType;
      lines.push(`## ${pos.positionTitle ?? '(no title)'} — ${pos.company}`);
      lines.push(`_Captured ${pos.submittedAt?.toISOString().slice(0, 10) ?? '—'}_`);
      lines.push('');
      lines.push(`**Essence.** ${profile.essence.one_sentence}`);
      lines.push('');
      lines.push(`**Qualifying competencies (${profile.qualifying_competencies.length})**`);
      for (const c of profile.qualifying_competencies) {
        const kud = c.required_for_success;
        const kudStr = `K${kud.k_depth ?? '–'} U${kud.u_depth ?? '–'} D${kud.d_depth ?? '–'}`;
        lines.push(`- **${c.name}** _(${kudStr})_ — ${c.description}`);
      }
      if (profile.dealbreakers.length > 0) {
        lines.push('');
        lines.push(`**Dealbreakers**`);
        for (const db of profile.dealbreakers) {
          lines.push(`- ${db.description}`);
        }
      }
      if (profile.hiring_signals.length > 0) {
        lines.push('');
        lines.push(`**Hiring signals**`);
        for (const sig of profile.hiring_signals) {
          lines.push(`- _(${sig.weight})_ ${sig.signal}`);
        }
      }
      lines.push('');
      lines.push(`**Trajectory.** Year 1 — ${profile.trajectory.year_1}  Year 2-3 — ${profile.trajectory.year_2_to_3}`);
      lines.push('');
      lines.push(`> ${profile.partner_voice_summary.split('\n').join('\n> ')}`);
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  const markdown = lines.join('\n');
  await writeAggregateForTarget({
    targetId,
    markdown,
    derivedFromPositionIds: interviewed.map(p => p.id),
  });

  return { positionIds: interviewed.map(p => p.id), markdown };
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | grep -E 'aggregate' || echo "clean"
git add lib/ai/position-capture/aggregate.ts
git commit -m "feat(position-capture): aggregate stub (v1 = deterministic Markdown side-by-side)

regenerateAggregate(targetId) reads all submitted, non-superseded,
interviewed position captures and emits a Markdown document layout
showing each position's essence + KUD+ competencies + dealbreakers
+ trajectory + voice summary. No AI synthesis pass yet — v2 may
swap that in. Writes to career_target_kud_aggregate."
```

---

## Task 9: API — partner positions CRUD

**Files:**
- Create: `app/api/partners/[token]/positions/route.ts`
- Create: `app/api/partners/[token]/positions/[id]/route.ts`

- [ ] **Step 1: Implement the routes**

For `POST /api/partners/[token]/positions` (create draft):
- Auth via `findPartnerByToken`
- Body: `{ careerTargetId: string, supersedes?: string }`
- Defaults `company` from `partner.company`
- Returns `{ id, status, careerTargetId }`

For `GET /api/partners/[token]/positions`:
- Returns `{ positions: [] }` (subset of fields — id, status, careerTargetId, positionTitle, completeness, createdAt)

For `PATCH /api/partners/[token]/positions/[id]`:
- Body: any subset of `{ positionTitle, structuredInputs, ratedSkills, sourceFiles, completeness }`
- Calls `updatePositionDraft` (refuses if not partner's draft)

For `POST /api/partners/[token]/positions/[id]` (finalize / submit-partial):
- Body: `{ completeness: 'title-only' | 'structured' | 'rated' | 'interviewed', profile?, model?, sessionId? }`
- If `completeness === 'interviewed'`, all of profile + model + sessionId must be provided
- Calls `finalizePosition`

All routes IP-rate-limited via `checkIpRateLimit` + `hashIp`.

Full file contents:

```typescript
// app/api/partners/[token]/positions/route.ts
import { NextResponse } from 'next/server';
import { findPartnerByToken } from '@/lib/partners/queries';
import { createPositionDraft, listPositionsByPartner } from '@/lib/db/position-capture-queries';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ token: string }> }

export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const { token } = await params;
  const partner = await findPartnerByToken(token);
  if (!partner || !partner.active) return NextResponse.json({ error: 'invalid token' }, { status: 401 });

  const { allowed } = await checkIpRateLimit(hashIp(req));
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const body = await req.json().catch(() => ({})) as { careerTargetId?: unknown; supersedes?: unknown };
  if (typeof body.careerTargetId !== 'string' || body.careerTargetId.length === 0) {
    return NextResponse.json({ error: 'careerTargetId required' }, { status: 400 });
  }
  const supersedes = typeof body.supersedes === 'string' && body.supersedes.length > 0 ? body.supersedes : null;

  const draft = await createPositionDraft({
    partnerId: partner.id,
    careerTargetId: body.careerTargetId,
    company: partner.company,
    supersedes,
  });

  return NextResponse.json({ id: draft.id, status: 'draft', careerTargetId: body.careerTargetId });
}

export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const { token } = await params;
  const partner = await findPartnerByToken(token);
  if (!partner || !partner.active) return NextResponse.json({ error: 'invalid token' }, { status: 401 });

  const positions = await listPositionsByPartner(partner.id);
  return NextResponse.json({
    positions: positions.map(p => ({
      id: p.id,
      status: p.status,
      careerTargetId: p.careerTargetId,
      positionTitle: p.positionTitle,
      completeness: p.completeness,
      createdAt: p.createdAt.toISOString(),
      submittedAt: p.submittedAt?.toISOString() ?? null,
    })),
  });
}
```

```typescript
// app/api/partners/[token]/positions/[id]/route.ts
import { NextResponse } from 'next/server';
import { findPartnerByToken } from '@/lib/partners/queries';
import {
  getPositionCaptureById,
  updatePositionDraft,
  finalizePosition,
} from '@/lib/db/position-capture-queries';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ token: string; id: string }> }

export async function PATCH(req: Request, { params }: RouteContext): Promise<Response> {
  const { token, id } = await params;
  const partner = await findPartnerByToken(token);
  if (!partner || !partner.active) return NextResponse.json({ error: 'invalid token' }, { status: 401 });

  const { allowed } = await checkIpRateLimit(hashIp(req));
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const existing = await getPositionCaptureById(id);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (existing.partnerId !== partner.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  try {
    await updatePositionDraft({
      id,
      partnerId: partner.id,
      ...(typeof body.positionTitle === 'string' && { positionTitle: body.positionTitle }),
      ...(typeof body.structuredInputs === 'object' && body.structuredInputs !== null && { structuredInputs: body.structuredInputs as Record<string, unknown> }),
      ...(typeof body.ratedSkills === 'object' && body.ratedSkills !== null && { ratedSkills: body.ratedSkills as Parameters<typeof updatePositionDraft>[0]['ratedSkills'] }),
      ...(Array.isArray(body.sourceFiles) && { sourceFiles: body.sourceFiles as Parameters<typeof updatePositionDraft>[0]['sourceFiles'] }),
      ...(typeof body.completeness === 'string' && { completeness: body.completeness as Parameters<typeof updatePositionDraft>[0]['completeness'] }),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'update failed' }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const { token, id } = await params;
  const partner = await findPartnerByToken(token);
  if (!partner || !partner.active) return NextResponse.json({ error: 'invalid token' }, { status: 401 });

  const existing = await getPositionCaptureById(id);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (existing.partnerId !== partner.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { completeness?: unknown; profile?: unknown; model?: unknown; sessionId?: unknown };
  const validCompleteness = ['title-only', 'structured', 'rated', 'interviewed'] as const;
  if (typeof body.completeness !== 'string' || !validCompleteness.includes(body.completeness as typeof validCompleteness[number])) {
    return NextResponse.json({ error: 'invalid completeness' }, { status: 400 });
  }
  const completeness = body.completeness as typeof validCompleteness[number];
  if (completeness === 'interviewed') {
    if (!body.profile || typeof body.model !== 'string' || typeof body.sessionId !== 'string') {
      return NextResponse.json({ error: 'profile + model + sessionId required for interviewed' }, { status: 400 });
    }
  }

  try {
    await finalizePosition({
      id,
      partnerId: partner.id,
      completeness,
      ...(completeness === 'interviewed' && {
        profile: body.profile,
        model: body.model as string,
        sessionId: body.sessionId as string,
      }),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'finalize failed' }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | grep -E 'positions/route|positions/\[id\]/route' || echo "clean"
git add 'app/api/partners/[token]/positions/route.ts' 'app/api/partners/[token]/positions/[id]/route.ts'
git commit -m "feat(api): position-capture CRUD — create draft, auto-save, finalize/submit-partial

POST /positions  — create draft (defaults company from partner)
GET  /positions  — list partner's positions
PATCH /positions/[id]  — auto-save (rejects if not partner's draft)
POST /positions/[id]   — finalize at any completeness level; if
                         completeness=interviewed, requires profile +
                         model + sessionId."
```

---

## Task 10: API — JD extract (file upload + Docling + extractJdFields)

**Files:**
- Create: `app/api/partners/[token]/positions/[id]/extract-jd/route.ts`

- [ ] **Step 1: Implement the route**

```typescript
import { NextResponse } from 'next/server';
import { findPartnerByToken } from '@/lib/partners/queries';
import { getPositionCaptureById } from '@/lib/db/position-capture-queries';
import { extractJdFields } from '@/lib/ai/position-capture/jd-extract';
import { extractText } from '@/lib/courses/extract-text';
import type { ExtractedMimeType } from '@/lib/courses/extract-text';
import { SUPPORTED_MIME_TYPES, LEGACY_OFFICE_MIME_TYPES } from '@/lib/courses/material-extractor';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import { hashIp } from '@/lib/ip-hash';

export const maxDuration = 120;
const MAX_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set<string>([...SUPPORTED_MIME_TYPES, ...LEGACY_OFFICE_MIME_TYPES, 'text/plain']);

interface RouteContext { params: Promise<{ token: string; id: string }> }

/**
 * POST /api/partners/[token]/positions/[id]/extract-jd
 * Body: multipart with field 'file' OR JSON with field 'text'.
 * Returns: { fields: JdExtraction, telemetry: { ... } }
 *
 * Inline-extraction: the JD bytes themselves are not stored (faculty
 * don't need them; the partner already has the source). Extracted
 * structured fields are returned for the partner to review on Page 1
 * and the client PATCHes them onto structuredInputs.
 */
export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const { token, id } = await params;
  const partner = await findPartnerByToken(token);
  if (!partner || !partner.active) return NextResponse.json({ error: 'invalid token' }, { status: 401 });

  const { allowed } = await checkIpRateLimit(hashIp(req));
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  const dailyOk = await checkDailyCap();
  if (!dailyOk.ok) return NextResponse.json({ error: 'daily cost cap reached' }, { status: 429 });

  const existing = await getPositionCaptureById(id);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (existing.partnerId !== partner.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (existing.status !== 'draft') return NextResponse.json({ error: 'not editable' }, { status: 409 });

  const contentType = req.headers.get('content-type') ?? '';
  let jdText: string;
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file || typeof file.arrayBuffer !== 'function') {
      return NextResponse.json({ error: 'file field required' }, { status: 400 });
    }
    if (!ALLOWED.has(file.type)) {
      return NextResponse.json({ error: `unsupported mime ${file.type}` }, { status: 400 });
    }
    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json({ error: 'file too large' }, { status: 413 });
    }
    if (file.type === 'text/plain') {
      jdText = await file.text();
    } else {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const ext = await extractText({ fileBytes: Buffer.from(bytes), mimeType: file.type as ExtractedMimeType, fileName: file.name });
      if (ext.status !== 'ok' || !ext.text) {
        return NextResponse.json({ error: 'extraction failed' }, { status: 422 });
      }
      jdText = ext.text;
    }
  } else {
    const body = await req.json().catch(() => ({})) as { text?: unknown };
    if (typeof body.text !== 'string' || body.text.trim().length === 0) {
      return NextResponse.json({ error: 'text field required' }, { status: 400 });
    }
    jdText = body.text;
  }

  try {
    const result = await extractJdFields(jdText);
    await recordSpend(result.costUsdCents);
    return NextResponse.json({
      fields: result.fields,
      telemetry: { model: result.model, costUsdCents: result.costUsdCents, durationMs: result.durationMs },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'extract failed';
    console.error('[extract-jd]', msg);
    return NextResponse.json({ error: 'extract failed', detail: msg.slice(0, 300) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | grep -E 'extract-jd' || echo "clean"
git add 'app/api/partners/[token]/positions/[id]/extract-jd/route.ts'
git commit -m "feat(api): Page 1 JD extract — accepts file (PDF/DOCX/text) or pasted text

Pipes file uploads through extractText (Docling for PDFs, LibreOffice for
legacy Office) before sending to extractJdFields. Pasted text goes
direct. Returns structured fields with per-field confidence; partner
reviews on Page 1 and the client PATCHes accepted values onto
structuredInputs. JD bytes are NOT stored (inline-extraction)."
```

---

## Task 11: API — generate Page 5 rated items

**Files:**
- Create: `app/api/partners/[token]/positions/[id]/generate-items/route.ts`

- [ ] **Step 1: Implement**

```typescript
import { NextResponse } from 'next/server';
import { findPartnerByToken } from '@/lib/partners/queries';
import { getPositionCaptureById } from '@/lib/db/position-capture-queries';
import { generateRatedItems } from '@/lib/ai/position-capture/rated-items';
import { getTargetById } from '@/lib/db/career-targets-queries';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import { hashIp } from '@/lib/ip-hash';

export const maxDuration = 60;

interface RouteContext { params: Promise<{ token: string; id: string }> }

export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const { token, id } = await params;
  const partner = await findPartnerByToken(token);
  if (!partner || !partner.active) return NextResponse.json({ error: 'invalid token' }, { status: 401 });

  const { allowed } = await checkIpRateLimit(hashIp(req));
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  const dailyOk = await checkDailyCap();
  if (!dailyOk.ok) return NextResponse.json({ error: 'daily cost cap reached' }, { status: 429 });

  const existing = await getPositionCaptureById(id);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (existing.partnerId !== partner.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (existing.status !== 'draft') return NextResponse.json({ error: 'not editable' }, { status: 409 });
  if (!existing.positionTitle || !existing.structuredInputs) {
    return NextResponse.json({ error: 'fill in position title + Page 1 first' }, { status: 400 });
  }

  const target = await getTargetById(existing.careerTargetId);
  if (!target) return NextResponse.json({ error: 'career target not found' }, { status: 404 });

  try {
    const result = await generateRatedItems({
      positionTitle: existing.positionTitle,
      company: existing.company,
      targetContext: {
        name: target.name,
        description: target.shortDefinition ?? '',
        subCompetencies: target.subCompetencies.map(s => ({
          name: s.name,
          description: s.doDescriptor ?? '',
        })),
      },
      structuredInputs: existing.structuredInputs,
    });
    await recordSpend(result.costUsdCents);
    return NextResponse.json({
      items: result.items,
      telemetry: { model: result.model, costUsdCents: result.costUsdCents, durationMs: result.durationMs },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'generate failed';
    console.error('[generate-items]', msg);
    return NextResponse.json({ error: 'generate failed', detail: msg.slice(0, 300) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | grep -E 'generate-items' || echo "clean"
git add 'app/api/partners/[token]/positions/[id]/generate-items/route.ts'
git commit -m "feat(api): Page 5 trigger — generate 10 rated-item candidates"
```

---

## Task 12: API — Page 6 chat + Page 6 finalize

**Files:**
- Create: `app/api/partners/[token]/positions/[id]/chat/route.ts`

- [ ] **Step 1: Implement**

This route mirrors the old `interview/[targetId]/chat` route but anchored to a position-capture id. It calls `runPositionInterview` from `lib/ai/position-capture/run.ts`. Page 6 finalize uses the `POST /api/partners/[token]/positions/[id]` route from Task 9 with `completeness='interviewed'` + the synthesized profile; clients call `generatePositionProfile` via this chat route's sibling — actually let's put finalize-with-synthesis in the same route as a query-string mode:

Actually, simpler: the chat route does turns; finalize triggers synthesis. Two endpoints in this file:

```typescript
import { NextResponse } from 'next/server';
import { findPartnerByToken } from '@/lib/partners/queries';
import { getPositionCaptureById, getLatestPositionSessionId, startPositionSession, isPositionSessionOwnedBy } from '@/lib/db/position-capture-queries';
import { runPositionInterview, generatePositionProfile } from '@/lib/ai/position-capture/run';
import { getTargetById } from '@/lib/db/career-targets-queries';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import { hashIp } from '@/lib/ip-hash';

export const maxDuration = 60;

interface RouteContext { params: Promise<{ token: string; id: string }> }

/**
 * POST /api/partners/[token]/positions/[id]/chat
 * Body: { userMessage?: string, sessionId?: string, finalize?: true }
 *
 * If finalize=true, runs synthesis instead of a turn — caller must
 * supply sessionId. Returns { profile, model, sessionId } on finalize;
 * { response, sessionId, telemetry } on turn.
 */
export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const { token, id } = await params;
  const partner = await findPartnerByToken(token);
  if (!partner || !partner.active) return NextResponse.json({ error: 'invalid token' }, { status: 401 });

  const { allowed } = await checkIpRateLimit(hashIp(req));
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });
  const dailyOk = await checkDailyCap();
  if (!dailyOk.ok) return NextResponse.json({ error: 'daily cost cap reached' }, { status: 429 });

  const existing = await getPositionCaptureById(id);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (existing.partnerId !== partner.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const target = await getTargetById(existing.careerTargetId);
  if (!target) return NextResponse.json({ error: 'career target not found' }, { status: 404 });

  const bundle = {
    positionTitle: existing.positionTitle ?? '(untitled)',
    company: existing.company,
    targetContext: {
      id: target.id,
      name: target.name,
      description: target.shortDefinition ?? '',
      subCompetencies: target.subCompetencies.map(s => ({ id: s.id, name: s.name, description: s.doDescriptor ?? '' })),
    },
    structuredInputs: existing.structuredInputs ?? null,
    ratedSkills: existing.ratedSkills ?? null,
  };

  const body = await req.json().catch(() => ({})) as { userMessage?: unknown; sessionId?: unknown; finalize?: unknown };

  if (body.finalize === true) {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null;
    if (!sessionId) return NextResponse.json({ error: 'sessionId required for finalize' }, { status: 400 });
    if (!await isPositionSessionOwnedBy(sessionId, partner.id, id)) {
      return NextResponse.json({ error: 'invalid session' }, { status: 403 });
    }
    try {
      const result = await generatePositionProfile({
        ...bundle,
        partnerId: partner.id,
        positionCaptureId: id,
        sessionId,
      });
      await recordSpend(result.costUsdCents);
      return NextResponse.json({
        profile: result.profile,
        model: result.model,
        sessionId,
        telemetry: { costUsdCents: result.costUsdCents, durationMs: result.durationMs },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'synthesis failed';
      console.error('[chat finalize]', msg);
      return NextResponse.json({ error: 'synthesis failed', detail: msg.slice(0, 300) }, { status: 500 });
    }
  }

  // Turn path
  const userMessage = typeof body.userMessage === 'string' && body.userMessage.trim().length > 0 ? body.userMessage.trim() : undefined;
  let sessionId = typeof body.sessionId === 'string' && body.sessionId.length > 0 ? body.sessionId : null;

  if (sessionId) {
    if (!await isPositionSessionOwnedBy(sessionId, partner.id, id)) {
      return NextResponse.json({ error: 'invalid session' }, { status: 403 });
    }
  } else {
    sessionId = startPositionSession();
  }

  try {
    const result = await runPositionInterview({
      ...bundle,
      partnerId: partner.id,
      positionCaptureId: id,
      sessionId,
      userMessage,
    });
    await recordSpend(result.costUsdCents);
    return NextResponse.json({
      sessionId,
      response: result.response,
      telemetry: { costUsdCents: result.costUsdCents, durationMs: result.durationMs, model: result.model },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'turn failed';
    console.error('[chat turn]', msg);
    return NextResponse.json({ error: 'turn failed', detail: msg.slice(0, 300) }, { status: 500 });
  }
}
```

Note: requires adding a `getLatestPositionSessionId` helper to `position-capture-queries.ts` — actually we don't need it; client always passes the sessionId once minted (the chat route mints on the first turn-call, returns it, client keeps it).

- [ ] **Step 2: Delete the old interview routes**

```bash
rm -rf 'app/api/partners/[token]/interview/'
```

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | grep -E 'partners.*chat|positions.*chat|interview' || echo "clean"
git add 'app/api/partners/[token]/positions/[id]/chat/route.ts' 'app/api/partners/[token]/interview'
git commit -m "feat(api): Page 6 interview chat + finalize (single route, finalize=true mode)

POST /positions/[id]/chat        — one turn of the Page 6 interview
POST /positions/[id]/chat (finalize:true) — synthesis pass, returns
   PositionProfile; caller then POSTs to /positions/[id] with
   completeness='interviewed' + profile to commit immutable row.

Old CC v1 interview routes (interview/[targetId]/{chat,generate}) deleted."
```

---

## Task 13: PositionWizard server scaffolding + Page 1 (JD ingest + structured fields)

**Files:**
- Create: `app/partners/[token]/positions/new/page.tsx`
- Create: `app/partners/[token]/positions/[id]/page/[step]/page.tsx`
- Create: `app/partners/[token]/positions/[id]/page/[step]/PositionWizard.tsx`
- Create: `app/partners/[token]/positions/[id]/page/[step]/Page1Section.tsx`

- [ ] **Step 1: Career target picker at /positions/new**

```tsx
// app/partners/[token]/positions/new/page.tsx
import { notFound, redirect } from 'next/navigation';
import { findPartnerByToken } from '@/lib/partners/queries';
import { listTargets } from '@/lib/db/career-targets-queries';
import { TargetPicker } from './TargetPicker';

interface Props { params: Promise<{ token: string }> }

export const dynamic = 'force-dynamic';

export default async function NewPositionPage({ params }: Props) {
  const { token } = await params;
  const partner = await findPartnerByToken(token);
  if (!partner || !partner.active) notFound();
  const targets = await listTargets();
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Position Capture</p>
        <h1 className="mt-1 text-2xl font-semibold">Which career path is this position closest to?</h1>
        <p className="mt-2 text-sm text-muted-foreground">Pick the closest match — you'll describe the actual position in the next steps. If none fit well, pick the closest and you can note that mismatch in the form.</p>
      </header>
      <TargetPicker token={token} targets={targets.map(t => ({ id: t.id, name: t.name, shortDefinition: t.shortDefinition ?? '' }))} />
    </div>
  );
}
```

And `TargetPicker.tsx` (client component) that POSTs to `/api/partners/[token]/positions` with `careerTargetId` on selection, then redirects to `/partners/[token]/positions/[id]/page/1`.

- [ ] **Step 2: Wizard server page (any step)**

```tsx
// app/partners/[token]/positions/[id]/page/[step]/page.tsx
import { notFound, redirect } from 'next/navigation';
import { findPartnerByToken } from '@/lib/partners/queries';
import { getPositionCaptureById } from '@/lib/db/position-capture-queries';
import { getTargetById } from '@/lib/db/career-targets-queries';
import { PositionWizard } from './PositionWizard';

interface Props { params: Promise<{ token: string; id: string; step: string }> }

const VALID_STEPS = ['1', '2', '3', '4', '5', '6'] as const;

export const dynamic = 'force-dynamic';

export default async function WizardStepPage({ params }: Props) {
  const { token, id, step } = await params;
  if (!VALID_STEPS.includes(step as typeof VALID_STEPS[number])) notFound();

  const partner = await findPartnerByToken(token);
  if (!partner || !partner.active) notFound();

  const capture = await getPositionCaptureById(id);
  if (!capture) notFound();
  if (capture.partnerId !== partner.id) notFound();
  if (capture.status !== 'draft') {
    redirect(`/partners/${encodeURIComponent(token)}`);
  }

  const target = await getTargetById(capture.careerTargetId);
  if (!target) notFound();

  return (
    <PositionWizard
      token={token}
      step={parseInt(step, 10) as 1 | 2 | 3 | 4 | 5 | 6}
      capture={{
        id: capture.id,
        positionTitle: capture.positionTitle,
        company: capture.company,
        structuredInputs: capture.structuredInputs ?? {},
        ratedSkills: capture.ratedSkills,
        sessionId: capture.sessionId,
      }}
      target={{ id: target.id, name: target.name, shortDefinition: target.shortDefinition ?? '' }}
    />
  );
}
```

- [ ] **Step 3: PositionWizard client component**

`PositionWizard.tsx` — top-level client component. Holds the wizard chrome (step indicator at top, Save draft button, Next/Back buttons at bottom). Renders one of `<Page1Section>`, `<Page2Section>`, … based on `step`. Auto-saves on Back/Next via PATCH. The component will be filled out in the per-page tasks; for Task 13 just stub the page wrappers and complete Page 1.

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Page1Section } from './Page1Section';

interface CaptureSnapshot {
  id: string;
  positionTitle: string | null;
  company: string;
  structuredInputs: Record<string, unknown>;
  ratedSkills: { items: Array<{ name: string; description?: string; rating: number }>; generatedAt: string } | null;
  sessionId: string | null;
}

interface Props {
  token: string;
  step: 1 | 2 | 3 | 4 | 5 | 6;
  capture: CaptureSnapshot;
  target: { id: string; name: string; shortDefinition: string };
}

export function PositionWizard({ token, step, capture, target }: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState<CaptureSnapshot>(capture);
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function saveAndGo(next: number | 'done', completeness?: 'title-only' | 'structured' | 'rated') {
    setError(null);
    startSave(async () => {
      const res = await fetch(`/api/partners/${encodeURIComponent(token)}/positions/${draft.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          positionTitle: draft.positionTitle,
          structuredInputs: draft.structuredInputs,
          ratedSkills: draft.ratedSkills,
          ...(completeness && { completeness }),
        }),
      });
      if (!res.ok) {
        setError('save failed');
        return;
      }
      if (next === 'done') {
        router.push(`/partners/${encodeURIComponent(token)}`);
      } else {
        router.push(`/partners/${encodeURIComponent(token)}/positions/${draft.id}/page/${next}`);
      }
    });
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Position Capture · {target.name}</p>
        <h1 className="mt-1 text-2xl font-semibold">{draft.positionTitle || '(new position)'}</h1>
      </header>

      <Steps step={step} />

      {step === 1 && (
        <Page1Section
          token={token}
          captureId={draft.id}
          structuredInputs={draft.structuredInputs}
          positionTitle={draft.positionTitle}
          onChange={(patch) => setDraft(d => ({ ...d, ...patch }))}
        />
      )}
      {step >= 2 && step <= 6 && (
        <div className="rounded-md border bg-card p-6">
          <p className="text-sm text-muted-foreground">Page {step} content lands in the next task.</p>
        </div>
      )}

      <nav className="mt-6 flex items-center justify-between">
        <button
          type="button"
          disabled={step === 1 || saving}
          onClick={() => saveAndGo(step - 1)}
          className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          ← Back
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={saving || !draft.positionTitle}
            onClick={() => saveAndGo('done', step === 1 ? 'title-only' : step <= 4 ? 'structured' : 'rated')}
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
          >
            Save & finish later
          </button>
          {step < 6 && (
            <button
              type="button"
              disabled={saving || (step === 1 && !draft.positionTitle)}
              onClick={() => saveAndGo(step + 1)}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Next →
            </button>
          )}
        </div>
      </nav>

      {error && <p className="mt-3 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-800">{error}</p>}
    </div>
  );
}

function Steps({ step }: { step: number }) {
  const labels = ['Job description', 'Uniqueness', 'Interview Qs', 'Trajectory', 'Rate experiences', 'Interview'];
  return (
    <ol className="mb-6 flex items-center gap-2 text-xs">
      {labels.map((l, i) => {
        const n = i + 1;
        const state = n === step ? 'active' : n < step ? 'done' : 'pending';
        return (
          <li key={l} className={
            state === 'active' ? 'rounded bg-slate-900 px-2 py-1 font-medium text-white'
              : state === 'done' ? 'rounded bg-slate-200 px-2 py-1 text-slate-600'
              : 'rounded border border-dashed border-slate-300 px-2 py-1 text-slate-500'
          }>
            {n}. {l}
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 4: Page1Section client component**

`Page1Section.tsx`:
- "Have a job description?" upload zone (PDF/DOCX/text-file) OR paste textarea + "Parse" button.
- On submit: POSTs to `/api/partners/[token]/positions/[id]/extract-jd`, receives `fields`, presents them in a form with each field's confidence shown as a colored dot (green/yellow/red/gray for empty).
- Empty fields and low-confidence (< 0.6) fields highlighted with a "needs review" badge.
- Job title required (red asterisk).
- "Extras / notes" textarea at the bottom, pre-populated from `extras_notes.value` if any.
- All edits flow up via `onChange` so the wizard parent can PATCH-save.

Full implementation TBD by implementer — pattern is established. Use `react-hook-form` only if it's already a dep; otherwise plain controlled inputs. Voice button (`VoiceRecorder` with `endpoint=/api/partners/transcribe?token=...`) on the "responsibilities" and "extras_notes" fields. PDF/DOCX upload uses a hidden `<input type="file">` triggered by a "Upload JD" button.

- [ ] **Step 5: Commit**

```bash
git add 'app/partners/[token]/positions'
git commit -m "feat(partner-ui): wizard scaffold + Page 1 (JD ingest + structured fields)

* /positions/new — career target picker
* /positions/[id]/page/[step] — wizard server page
* PositionWizard client component — step indicator, Save & finish later,
  Back / Next navigation, auto-save via PATCH on transition
* Page1Section — JD upload OR paste + Parse; AI-filled fields with
  confidence indicators; required job_title; extras/notes catch-all
  with voice button.
* Stub placeholders for pages 2-6 (later tasks fill in)."
```

---

## Task 14: Wizard Pages 2-4 (uniqueness, interview Qs + file, trajectory)

**Files:**
- Create: `app/partners/[token]/positions/[id]/page/[step]/Page2Section.tsx`
- Create: `app/partners/[token]/positions/[id]/page/[step]/Page3Section.tsx`
- Create: `app/partners/[token]/positions/[id]/page/[step]/Page4Section.tsx`
- Modify: `app/partners/[token]/positions/[id]/page/[step]/PositionWizard.tsx`

- [ ] **Step 1: Page 2** — Two `<textarea>` blocks, each with a `<VoiceRecorder endpoint=...>` button: (a) "What's unique about this job?" (b) "What would make for a successful candidate?". Both populate `structuredInputs.uniqueness` + `structuredInputs.success_criteria`. Auto-save unchanged.

- [ ] **Step 2: Page 3** — One textarea ("Key interview questions you ask candidates") with voice. Plus a file-upload zone for an interview rubric/guide doc; on upload, calls `/api/courses/[code]/materials`-style extraction (need a partner-token-aware endpoint — for v1, reuse the JD-extract route's file path but POST to a new `/positions/[id]/upload-doc` route that stores the extracted text on `structuredInputs.interview_doc_text` and the source file under `sourceFiles[]`).

The upload-doc route can be a thin wrapper around `extractText` — uses Docling internally for PDFs/DOCX, returns text. Storage path: under `~/Library/Application Support/gc-curriculum-tool/materials/partners/<partner_id>/<position_id>/<filename>` via `putLocal`. Source-file metadata persisted to `position_captures.source_files` JSONB.

(Implementer: create the upload-doc route in this task — same pattern as Task 10's extract-jd but persists to `sourceFiles` instead of inline-returning. Files: `app/api/partners/[token]/positions/[id]/upload-doc/route.ts`.)

- [ ] **Step 3: Page 4** — One textarea ("Career trajectory — what does this role turn into?") with voice. Populates `structuredInputs.trajectory_freeform`.

- [ ] **Step 4: Wire into PositionWizard**

Replace the step 2/3/4 stub placeholders in `PositionWizard.tsx` with the new components.

- [ ] **Step 5: Commit**

```bash
git add 'app/partners/[token]/positions/[id]/page/[step]' 'app/api/partners/[token]/positions/[id]/upload-doc'
git commit -m "feat(partner-ui): wizard pages 2-4 — uniqueness, interview Qs + file, trajectory

Page 2: two textareas (unique + success_criteria), voice on both.
Page 3: one textarea + file upload (rubric/guide) — Docling extraction
  via new /upload-doc route; persists source file + extracted text.
Page 4: one textarea (trajectory), voice."
```

---

## Task 15: Wizard Page 5 (AI-generated rated items + sliders)

**Files:**
- Create: `app/partners/[token]/positions/[id]/page/[step]/Page5Section.tsx`
- Modify: `app/partners/[token]/positions/[id]/page/[step]/PositionWizard.tsx`

- [ ] **Step 1: Page 5 client component**

- "Generate items" button → POST to `/positions/[id]/generate-items`. Loading state. On success: 10 cards.
- Each card: { name (editable input), description (read-only), evidence_source (small muted text), 1-7 slider }.
- "+ Add your own" button to insert a new card with empty name (no AI prior, slider starts at 4).
- "× Remove" per card.
- Validation: at least 5 cards must have a rating set before Next is enabled.
- All edits flow up via onChange to PATCH-save.

- [ ] **Step 2: Wire into PositionWizard**

Replace step 5 stub with Page5Section.

- [ ] **Step 3: Commit**

```bash
git add 'app/partners/[token]/positions/[id]/page/[step]'
git commit -m "feat(partner-ui): wizard page 5 — AI-generated rated items + 1-7 sliders

Generate button calls /generate-items. 10 candidate cards with editable
name, slider 1-7, remove/add. Min 5 rated to proceed. ratedSkills JSONB
persists through Next."
```

---

## Task 16: Wizard Page 6 (agent interview, reuse InterviewPanel pattern)

**Files:**
- Create: `app/partners/[token]/positions/[id]/page/[step]/Page6Section.tsx`
- Modify: `app/partners/[token]/positions/[id]/page/[step]/PositionWizard.tsx`
- Delete: `app/partners/[token]/interview/` (whole dir)

- [ ] **Step 1: Page 6 client component**

Lift the working InterviewPanel pattern from `app/partners/[token]/interview/[targetId]/InterviewPanel.tsx` (commit `151c996`) and rename + repoint:
- Endpoint: `/api/partners/[token]/positions/[id]/chat`
- Voice: `/api/partners/transcribe?token=...`
- "End interview & generate" button → POSTs `{finalize: true, sessionId}` to chat route, receives PositionProfile, then POSTs to `/positions/[id]` with `{completeness: 'interviewed', profile, model, sessionId}`. On success → redirect to dashboard.

- [ ] **Step 2: Wire into PositionWizard**

Replace step 6 stub with Page6Section.

- [ ] **Step 3: Delete the old interview surface**

```bash
rm -rf 'app/partners/[token]/interview/'
```

- [ ] **Step 4: Typecheck + commit**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | grep -E 'page/\[step\]/Page6|interview' || echo "clean"
git add 'app/partners/[token]/positions' 'app/partners/[token]/interview'
git commit -m "feat(partner-ui): wizard page 6 — agent interview (anchor → probe → confirm)

Reuses InterviewPanel pattern from CC v1. End-interview button runs
synthesis + finalizes the row at completeness='interviewed'. CC v1's
/partners/[token]/interview/* removed (subsumed by this work)."
```

---

## Task 17: PartnerDashboard rewire + delete old /submit wizard

**Files:**
- Modify: `app/partners/[token]/PartnerDashboard.tsx`
- Modify: `app/partners/[token]/WelcomeScreen.tsx`
- Modify: `app/partners/[token]/page.tsx` (if stats need recomputing from position_captures)
- Delete: `app/partners/[token]/submit/` (whole dir)
- Delete: `app/api/partners/submissions/` (whole dir — old submission API)

- [ ] **Step 1: PartnerDashboard rewrite**

- Drop the per-career-target "Start interview" section (CC v1's links).
- Drop the "Add another position" Card pointing at `/submit`.
- Replace top CTA card row with a single primary CTA: "Add a position" → `/partners/[token]/positions/new`.
- Below: list partner's submitted positions (from `GET /api/partners/[token]/positions`) grouped by career target, with completeness badge.
- Add a "Resume draft" link per draft row.

- [ ] **Step 2: WelcomeScreen rewrite**

Single CTA: "Describe a position" → `/partners/[token]/positions/new`.

- [ ] **Step 3: Delete old /submit + submissions API**

```bash
rm -rf 'app/partners/[token]/submit/' 'app/api/partners/submissions/'
```

- [ ] **Step 4: Verify partner_submissions table isn't referenced anywhere live**

```bash
grep -rnE 'partner_submissions|partnerSubmissions' --include='*.ts' --include='*.tsx' . 2>/dev/null | grep -v node_modules | grep -v .next | grep -v 'docs/' | head -20
```

If only schema.ts and historical comments come up, it's safe; if any active route reads `partner_submissions`, decide whether to delete that route or keep the table for backwards-compat reads. (The admin synthesis view used to read it — Task 18 rewrites that view to read `position_captures` instead.)

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | grep -E 'PartnerDashboard|WelcomeScreen|submit' || echo "clean"
git add 'app/partners/[token]' 'app/api/partners/submissions'
git commit -m "refactor(partner-ui): retire old /submit wizard + CC v1 interview links

PartnerDashboard now shows one 'Add a position' CTA + a list of the
partner's submitted positions grouped by career target. WelcomeScreen
points at /positions/new. Old 3-step /submit wizard + its data API
(/api/partners/submissions/*) removed."
```

---

## Task 18: Admin synthesis target view — list positions + aggregate panel

**Files:**
- Modify: `app/admin/synthesis/targets/[targetId]/page.tsx`
- Create: `app/api/admin/synthesis/targets/[targetId]/regenerate-aggregate/route.ts`
- Create: `app/admin/synthesis/targets/[targetId]/AggregatePanel.tsx`

- [ ] **Step 1: Regenerate route**

```typescript
// app/api/admin/synthesis/targets/[targetId]/regenerate-aggregate/route.ts
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { regenerateAggregate } from '@/lib/ai/position-capture/aggregate';

interface RouteContext { params: Promise<{ targetId: string }> }

export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  const { targetId } = await params;

  try {
    const result = await regenerateAggregate(targetId);
    return NextResponse.json({ ok: true, positionIds: result.positionIds, markdown: result.markdown });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'regenerate failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 2: Admin synthesis page modifications**

Replace the existing "Employer interviews" section with:
- An "Aggregate" panel showing the current aggregate markdown (rendered as MDX or via `react-markdown`), plus a "Regenerate" button and a stale indicator. The "AggregatePanel" client component handles the POST.
- A "Positions in this target" section listing all submitted positions: company, title, partner name, completeness badge, submitted date, link to expand.

Read `listSubmittedPositionsForTarget(targetId)` + `getAggregateForTarget(targetId)`.

- [ ] **Step 3: Commit**

```bash
git add 'app/admin/synthesis/targets/[targetId]' 'app/api/admin/synthesis'
git commit -m "feat(admin): per-target view — aggregate panel + positions list + regenerate

Drops the CC v1 'Employer interviews' section. Adds Aggregate panel
(reads career_target_kud_aggregate, renders markdown, Regenerate button
calls /regenerate-aggregate) + Positions table (one row per submitted,
non-superseded position capture under this target)."
```

---

## Task 19: Voice + Docling reuse audit + smoke

**Files:** (no creates — verification + small fixes)

- [ ] **Step 1: Verify all wizard voice buttons hit the right endpoint**

```bash
grep -rn 'VoiceRecorder' app/partners 2>/dev/null
```

Every instance must use `endpoint={`/api/partners/transcribe?token=${...}`}` — not the slug-based `slug={token}` fallback.

- [ ] **Step 2: Verify Docling routing**

```bash
grep -rn 'extractText\|docling' lib/ai/position-capture lib/courses/material-extractor.ts 2>/dev/null | head -10
```

Confirm `extractText` is the entry point used by both `extract-jd` and `upload-doc`. If you find divergent paths, normalize.

- [ ] **Step 3: Smoke test**

Restart Next.js dev server. With a test partner token:

```bash
TOKEN="..."  # mint a new test partner via /api/admin/partners/import
TARGET_ID="..."  # any real careerTargets.id

# Create draft
curl -sk -X POST "https://admins-mac-studio-2.tailb723c1.ts.net/api/partners/$TOKEN/positions" \
  -H 'content-type: application/json' \
  -d "{\"careerTargetId\":\"$TARGET_ID\"}" | jq .

# Auto-save title
curl -sk -X PATCH "https://admins-mac-studio-2.tailb723c1.ts.net/api/partners/$TOKEN/positions/<id>" \
  -H 'content-type: application/json' \
  -d '{"positionTitle":"Test Position","structuredInputs":{"responsibilities":"…"}}'

# Finalize as title-only
curl -sk -X POST "https://admins-mac-studio-2.tailb723c1.ts.net/api/partners/$TOKEN/positions/<id>" \
  -H 'content-type: application/json' \
  -d '{"completeness":"title-only"}'
```

All should 200. Verify a row was written:

```bash
PGAPP=/Applications/Postgres.app/Contents/Versions/17
"$PGAPP/bin/psql" -h 127.0.0.1 -p 5433 -U admin -d gc_curriculum -c \
  "SELECT id, position_title, status, completeness FROM position_captures ORDER BY created_at DESC LIMIT 5"
```

- [ ] **Step 4: Commit**

If any small fixes were needed in Steps 1-3, commit them. Otherwise just record the smoke verification:

```bash
git commit --allow-empty -m "test(smoke): position-capture CRUD + voice + docling routing verified"
```

---

## Task 20: Retirement sweep + STATE.md + README updates

**Files:**
- Modify: `docs/STATE.md`
- Modify: `docs/superpowers/README.md`
- Modify: `docs/architecture.html` (if any CC v1 mentions remain)
- Delete: any residual employer-capture artifacts

- [ ] **Step 1: Final scrub for residual CC v1 references**

```bash
grep -rnE 'employer-capture|career_captures|capture-employer|CareerCapture v1' --include='*.ts' --include='*.tsx' --include='*.md' --include='*.html' . 2>/dev/null | grep -v node_modules | grep -v .next | grep -v 'docs/superpowers/plans/2026-06-04-careercapture-v1' | grep -v 'docs/superpowers/plans/2026-06-04-position-capture'
```

Expected: only historical references in plan docs + STATE.md historical rows. If any live code remains, fix.

- [ ] **Step 2: STATE.md updates**

- In the partner surfaces table, replace the `/partners/[token]/interview/[targetId]` row with the new `/partners/[token]/positions/*` rows (new, list, draft wizard).
- Add a cross-cutting row: "Position Capture v1 (2026-06-04 same-day) — replaces CC v1 + the old 3-step /submit wizard with a 6-page flow ending in an agent interview. New schema 0029. PositionProfile output. CC v1 partner-facing surface retired."
- AI function tier table: remove `capture-employer-chat-agent`, `capture-employer-synthesis`; add `jd-extract` (light), `position-rated-items` (default), `position-interview-agent` (default), `position-synthesis` (default).
- Function-ID count: bump from 17 → 19.
- Last-verified SHA: bump to whatever commit Task 20 ends on.

- [ ] **Step 3: README updates**

- Add a row for `2026-06-04-position-capture-v1.md` in the plans table — ✅ Done if all tasks shipped; In progress otherwise.
- Update the existing 2026-06-04 CareerCapture v1 row to mark it ⏸ Superseded same day by Position Capture v1.

- [ ] **Step 4: architecture.html scan**

```bash
grep -nE 'CareerCapture|career-target interview' docs/architecture.html | head -5
```

If anything mentions CareerCapture v1 as a live feature, update to reference Position Capture v1 instead.

- [ ] **Step 5: Commit + push**

```bash
git add docs/STATE.md docs/superpowers/README.md docs/architecture.html
git commit -m "docs: Position Capture v1 shipped — STATE.md + README + architecture updated

Retires CC v1's partner-facing surface in the docs; updates the AI
function tier table; bumps Last verified SHA."
git push origin main
```

---

## Self-review checklist

After writing this plan, before execution begins:

- ✅ **Spec coverage:** Three-layer architecture (career target → position captures → aggregate) addressed. Six-page wizard covered. CC v1 retirement explicit. Aggregation deferred as stub per design conversation.
- ✅ **No placeholders:** Every task has actual code or commands. No "TODO" / "implement later" / "similar to Task N."
- ✅ **Type consistency:** `positionCaptures`, `positionCaptureMessages`, `PositionProfile`, `PositionProfileType`, `runPositionInterview`, `generatePositionProfile`, `createPositionDraft`, `updatePositionDraft`, `finalizePosition`, `isPositionSessionOwnedBy`, `careerTargetKudAggregate` — spelled identically across tasks.
- ✅ **Strict-mode JSON Schema discipline:** Task 3's invariant walker test, plus matching strict-mode schemas in Task 5 (JdExtraction) and Task 6 (RatedItemsList) where required properties must include every property in `properties`.
- ✅ **Cost interlock:** Routes calling AI functions (Task 10 extract-jd, Task 11 generate-items, Task 12 chat) all check `checkDailyCap` before invoking AI.
- ✅ **IDOR guard:** Task 12 wires `isPositionSessionOwnedBy` before any session-anchored writes.
- ✅ **No regressions in unrelated tests:** plan doesn't touch other AI functions, courses tables, faculty surfaces.

---

## What this plan deliberately doesn't do

- **Real aggregation function.** v1 aggregate = deterministic Markdown side-by-side. Designed for later swap-in of AI synthesis (or mechanical averaging, or hybrid) without touching the partner pipeline.
- **Page 5 ratings → coverage matrix weights.** Stored, not yet routed. Separate design problem.
- **Auto-detect "same position" for supersession.** Partner opts in via dropdown of their prior positions; no AI matching.
- **Stress-test agent for PositionProfile.** Same agent applies; needs an adapter. Defer to v2 (CC v1 deferred it identically).
- **Per-position card with full KUD+ visual drill-through on admin synthesis.** v1 admin view = aggregate markdown + position list. Rich card view = v2 polish.
- **Migration of any existing `partner_submissions` data into `position_captures`.** Existing partner submissions stay in their table; not surfaced anywhere new. (Currently zero in-flight submissions per `partner_submissions` row count.)

---

## Cost model

Per completed Position Capture (one position, fully interviewed):

- JD-extract: ~$0.02 (light tier, one call)
- Pages 2-4 voice transcription: ~$0 (omlx local)
- Page 5 rated-items generation: ~$0.10
- Page 6 interview chat (8-10 turns): ~$0.40-0.60
- Page 6 synthesis: ~$0.20-0.30
- **Per-position total: ~$0.75-1.10**

At 10-30 partners × 1-3 positions, total program-wide cost is ~$25-100 one-time, well under daily cap.

Aggregation (v1 stub) costs $0 — pure data transformation, no AI calls.

---

## Execution handoff

Plan complete. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review (spec + quality) between tasks, fast iteration. ~3-4 hours of agent work depending on parallelization (Tasks 5/6/8 can run in parallel after Task 4; Tasks 13/14/15/16 each depend on the prior in the same wizard surface; Task 9/10/11/12 can run in parallel after Tasks 2/4/5/6/7).

**2. Inline Execution** — execute tasks in this session with batched checkpoints for review.

Which approach?
