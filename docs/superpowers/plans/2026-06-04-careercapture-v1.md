# CareerCapture v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a per-career-target conversational interview flow that produces a structured Career-Target Capture (parallel to CourseCapture's Course Outcome Profile). Employers do a 20-45 minute AI-conducted interview anchored to one career target; the synthesis layer outputs a CareerCaptureProfile (role shape, day-1 K/U/D expectations, dealbreakers, hiring signals, divergence from catalog) that feeds the Program Coverage Matrix as the "what the field actually wants" ground truth.

**Architecture:** Reuse 90% of the CourseCapture infrastructure shipped 2026-05-26 through 2026-06-03. Same agentic-retrieval pattern (audit chat → synthesis → optional stress-test → snapshot), same provider abstraction, same streaming UI shell, same citation discipline. Differences: new schema (`career_capture_messages`, `career_captures`), new prompts (`capture-employer-chat-agent`, `capture-employer-synthesis`), new response shape (CareerCaptureProfile), new client surface (`/partners/[token]/interview/[targetId]`). The conversation is partner-authenticated via the existing magic-link session; partners can do multiple interviews (one per career target they hire for) on their own time.

**Tech Stack:** Existing — Next.js 15 App Router, Drizzle ORM + Postgres, the provider abstraction at `lib/ai/provider.ts`, the audit-agent loop at `lib/ai/agent/audit-agent.ts`, the streaming `CaptureChatPanel` UI pattern, voice transcription via `/api/transcribe`. No new third-party deps. New AI functions added to the existing tier system.

---

## Background — what's reused, what's net new

CourseCapture (shipped over the last 10 days) gives us:

- **Append-only message log** (`capture_messages`) with `session_id` + `turn_index` keys
- **Tool-using audit-agent loop** (`runAuditAgent`, `streamAuditAgent`) with provider-agnostic structured output via Vercel AI SDK v6
- **Streaming chat UI** (`CaptureChatPanel`) with optimistic empty-assistant placeholder + delta streaming + tool-call banners
- **Voice integration** via the per-page `VoiceRecorder` (omlx warm → CLI fallback)
- **Synthesis pattern** (`generateCaptureProfileV2`) that reads the full transcript + materials + catalog and emits a structured profile with intrinsic provenance
- **Citation discipline** validate-time-enforced (no excerpt-only; every citation must resolve to a real chunk or turn)
- **Stress-test reviewer** (heavy-tier adversarial agent) ready to operate on any profile

What's new for CareerCapture:

- The employer is the evidence source, not the materials — so the "tools" the agent uses are limited (no Weaviate chunk retrieval; just the conversation itself + the career target description)
- Employer voice is the canonical source; transcript IS the data, not a context layer over a materials library
- The output shape is employer-facing: "what students need on day 1" framed as K/U/D, plus dealbreakers + hiring signals + trajectory + divergence from catalog
- The flow is partner-authenticated (magic link), not faculty-authenticated (slug + Basic Auth)

### Scope cut for v1

Deliberately not in this plan (defer to v2):

- **Stress-test wiring for CareerCaptures.** Same agent applies; needs a small adapter. Punt to v2.
- **Snapshot/version machinery.** v1 stores captures as immutable rows; each new interview = new row. "Working draft" intermediate state is deferred.
- **Cross-employer triangulation** (agent reads other employers' captures for the same target and probes for confirmation/disagreement). Real feature, but not v1.
- **Drift detection** (re-interview same employer 12 months later, surface what changed). Defer.
- **Admin-side captures editor.** v1 displays captures as read-only; if faculty wants to override, that's a v2 add.
- **Stress-testing the interview itself in real-time** (LLM-as-interview-coach). Defer.

What IS in v1: a working magic-link-authenticated conversational interview that produces a structured CareerCaptureProfile per (partner, career target), readable by faculty in the admin synthesis view, ready to feed the program coverage matrix.

---

## File structure

**New files:**

- `lib/ai/prompts/capture-employer-chat-agent.md` — the employer-interview agent persona. Parallel to `capture-chat-agent.md` but employer-shaped: probes "tell me about a hire that worked / didn't work," extracts K/U/D-shaped expectations, surfaces dealbreakers, asks for concrete trajectory expectations.
- `lib/ai/prompts/capture-employer-synthesis.md` — synthesis prompt. Parallel to `capture-synthesis.md`; reads the interview transcript + career target description + sub-competencies + (optionally) prior employer captures on the same target, emits a CareerCaptureProfile.
- `lib/ai/employer-capture/schema.ts` — `CareerCaptureProfile` Zod + JSON Schema. Strict-mode compatible.
- `lib/ai/employer-capture/run.ts` — `runEmployerInterview` (agent loop) + `generateCareerCaptureProfile` (synthesis). Mirrors the two-step pattern of `runAuditAgent` + `generateCaptureProfileV2`.
- `lib/db/employer-capture-queries.ts` — queries: `appendEmployerMessage`, `getEmployerSession`, `listPartnerInterviews`, `createCareerCapture`, `getLatestCaptureFor(partnerId, careerTargetId)`.
- `app/api/partners/[token]/interview/[targetId]/chat/route.ts` — POST endpoint (streams NDJSON) that drives one turn of the interview.
- `app/api/partners/[token]/interview/[targetId]/generate/route.ts` — POST endpoint that runs synthesis after the partner ends the interview.
- `app/partners/[token]/interview/[targetId]/page.tsx` — partner-facing interview page (server component for session resolution).
- `app/partners/[token]/interview/[targetId]/InterviewPanel.tsx` — client component owning chat state + voice + "End interview & generate" button. Parallel structure to `app/capture/[code]/CaptureChatPanel.tsx` but partner-themed.

**Modified files:**

- `lib/ai/function-settings.ts` — register two new AI function ids: `capture-employer-chat-agent` (default tier), `capture-employer-synthesis` (default tier).
- `lib/db/schema.ts` — add `careerCaptureMessages` + `careerCaptures` tables.
- `drizzle/0028_<auto-generated>.sql` — the schema migration.
- `lib/ai/prompts/load.ts` — register two new prompt names in the `PromptName` union.
- `app/partners/[token]/PartnerDashboard.tsx` — add per-career-target "Start interview" links to the existing dashboard.
- `app/admin/synthesis/targets/[targetId]/page.tsx` — add a section that lists CareerCaptures for the target.
- `docs/STATE.md` — document the new feature.

**Untouched:**

- Existing `partner_submissions` flow (it stays; partners can submit structured fields AND/OR do an interview)
- CourseCapture surface (no schema changes that would affect course flows)
- Basic Auth / slug / faculty auth (interview is partner-authenticated via magic-link session, same as today's submission wizard)
- Stress-test agent (reused as-is in v2; v1 doesn't wire it)

---

## Task 1: Schema — `career_capture_messages` + `career_captures` tables

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `drizzle/0028_<auto-generated>.sql`

- [ ] **Step 1: Add the two tables to schema.ts**

Open `lib/db/schema.ts`. After the `captureMessages` table definition, add:

```typescript
/**
 * CareerCapture append-only message log. Parallel to capture_messages
 * (which is course-scoped); this one is partner+career-target-scoped.
 *
 * One session = one interview about one career target. Partners can
 * do multiple interviews across targets (or re-interview a target
 * later); each interview gets its own session_id.
 */
export const careerCaptureMessages = pgTable('career_capture_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  partnerId: uuid('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  careerTargetId: text('career_target_id').notNull().references(() => careerTargets.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id').notNull(),
  turnIndex: integer('turn_index').notNull(),
  role: text('role').notNull(),                              // 'user' | 'assistant'
  content: text('content'),
  citations: jsonb('citations').$type<Array<{
    type: 'transcript';
    messageId?: string;
    excerpt: string;
  }>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  sessionIdx: index('idx_career_capture_messages_session').on(table.partnerId, table.careerTargetId, table.sessionId, table.turnIndex),
  sessionTurnUnique: unique('uq_career_capture_messages_session_turn').on(table.sessionId, table.turnIndex),
}));

/**
 * CareerCapture finished record. Immutable. Each row = one interview's
 * synthesis output. Re-interviewing the same partner on the same target
 * appends a new row; the latest non-retired row wins for display.
 */
export const careerCaptures = pgTable('career_captures', {
  id: uuid('id').primaryKey().defaultRandom(),
  partnerId: uuid('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  careerTargetId: text('career_target_id').notNull().references(() => careerTargets.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id').notNull(),                   // the interview session that produced this
  profile: jsonb('profile').notNull(),                       // CareerCaptureProfile JSON
  model: text('model').notNull(),
  retiredAt: timestamp('retired_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  partnerTargetIdx: index('idx_career_captures_partner_target').on(table.partnerId, table.careerTargetId, table.createdAt),
}));
```

Make sure the imports at the top of `schema.ts` cover `index`, `unique`, and `primaryKey` (most likely already imported; only add what's missing).

- [ ] **Step 2: Generate the migration**

```bash
cd /Users/admin/projects/curriculum_developer
pnpm db:generate
```

Expected: a new file `drizzle/0028_<auto-name>.sql` (drizzle-kit picks a name). Inspect it:

```bash
ls drizzle/ | tail -3
cat drizzle/0028_*.sql
```

Should be `CREATE TABLE "career_capture_messages"` and `CREATE TABLE "career_captures"` plus the indices and FKs. No `DROP` statements.

- [ ] **Step 3: Apply the migration**

```bash
set -a; source .env.local; set +a
pnpm db:migrate 2>&1 | tail -5
```

Expected: `migrations applied successfully!`

- [ ] **Step 4: Verify the tables exist**

```bash
psql "$DATABASE_URL" -c "\dt career_*"
```

Expected: lists both `career_capture_messages` and `career_captures`.

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.ts drizzle/0028_*.sql
git commit -m "feat(schema): career_capture_messages + career_captures tables

Schema 0028. Parallel to CourseCapture's capture_messages +
course_capture_snapshots but partner+career-target-scoped. One
session = one interview about one career target; each new interview
appends a new immutable row to career_captures. UNIQUE on
(session_id, turn_index) prevents accidental duplicates."
```

---

## Task 2: Query helpers in `lib/db/employer-capture-queries.ts`

**Files:**
- Create: `lib/db/employer-capture-queries.ts`

- [ ] **Step 1: Create the queries file**

Create `lib/db/employer-capture-queries.ts`:

```typescript
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { careerCaptureMessages, careerCaptures } from '@/lib/db/schema';

export interface EmployerMessageRow {
  id: string;
  partnerId: string;
  careerTargetId: string;
  sessionId: string;
  turnIndex: number;
  role: string;
  content: string | null;
  citations: Array<{ type: 'transcript'; messageId?: string; excerpt: string }> | null;
  createdAt: Date;
}

export interface AppendEmployerMessageInput {
  partnerId: string;
  careerTargetId: string;
  sessionId: string;
  turnIndex: number;
  role: 'user' | 'assistant';
  content: string | null;
  citations?: EmployerMessageRow['citations'];
}

/**
 * Append one turn to an interview session. Idempotency is enforced by
 * the UNIQUE(session_id, turn_index) index — duplicate inserts throw.
 */
export async function appendEmployerMessage(input: AppendEmployerMessageInput): Promise<void> {
  await db.insert(careerCaptureMessages).values({
    partnerId: input.partnerId,
    careerTargetId: input.careerTargetId,
    sessionId: input.sessionId,
    turnIndex: input.turnIndex,
    role: input.role,
    content: input.content,
    citations: input.citations ?? null,
  });
}

/**
 * All messages for one interview session, ordered by turn_index ascending.
 * Used to rehydrate the agent on each turn + to feed the full transcript
 * to synthesis.
 */
export async function getEmployerSession(
  partnerId: string,
  careerTargetId: string,
  sessionId: string,
): Promise<EmployerMessageRow[]> {
  const rows = await db
    .select()
    .from(careerCaptureMessages)
    .where(and(
      eq(careerCaptureMessages.partnerId, partnerId),
      eq(careerCaptureMessages.careerTargetId, careerTargetId),
      eq(careerCaptureMessages.sessionId, sessionId),
    ))
    .orderBy(asc(careerCaptureMessages.turnIndex));
  return rows as EmployerMessageRow[];
}

/**
 * Latest open session id for this (partner, target) — i.e., the
 * session_id of the most recent message. Null when no interview has
 * started yet. Used to decide whether to start a new session or
 * resume.
 */
export async function getLatestEmployerSessionId(
  partnerId: string,
  careerTargetId: string,
): Promise<string | null> {
  const rows = await db
    .select({ sessionId: careerCaptureMessages.sessionId })
    .from(careerCaptureMessages)
    .where(and(
      eq(careerCaptureMessages.partnerId, partnerId),
      eq(careerCaptureMessages.careerTargetId, careerTargetId),
    ))
    .orderBy(desc(careerCaptureMessages.createdAt))
    .limit(1);
  return rows[0]?.sessionId ?? null;
}

/** Mint a fresh interview session id. */
export function startEmployerSession(): string {
  return randomUUID();
}

export interface CreateCareerCaptureInput {
  partnerId: string;
  careerTargetId: string;
  sessionId: string;
  profile: unknown;
  model: string;
}

/**
 * Persist a completed interview's synthesis output. Returns the new row.
 * Immutable — subsequent interviews on the same target by the same
 * partner append new rows; the prior row stays as history.
 */
export async function createCareerCapture(input: CreateCareerCaptureInput): Promise<{ id: string; createdAt: Date }> {
  const [row] = await db.insert(careerCaptures).values({
    partnerId: input.partnerId,
    careerTargetId: input.careerTargetId,
    sessionId: input.sessionId,
    profile: input.profile as object,
    model: input.model,
  }).returning({ id: careerCaptures.id, createdAt: careerCaptures.createdAt });
  if (!row) throw new Error('createCareerCapture: no row returned');
  return row;
}

/**
 * Latest non-retired CareerCapture row for a given (partner, target).
 * Used by display surfaces (admin synthesis view, future program
 * coverage matrix). Returns null when no interview has produced a
 * capture yet.
 */
export async function getLatestCaptureFor(
  partnerId: string,
  careerTargetId: string,
): Promise<{ id: string; profile: unknown; createdAt: Date } | null> {
  const [row] = await db
    .select({
      id: careerCaptures.id,
      profile: careerCaptures.profile,
      createdAt: careerCaptures.createdAt,
    })
    .from(careerCaptures)
    .where(and(
      eq(careerCaptures.partnerId, partnerId),
      eq(careerCaptures.careerTargetId, careerTargetId),
      isNull(careerCaptures.retiredAt),
    ))
    .orderBy(desc(careerCaptures.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * All non-retired CareerCaptures for one career target, across all
 * partners. Used by the admin synthesis view + the future program
 * coverage matrix to surface "field truth" for this target.
 */
export async function listCapturesByTarget(
  careerTargetId: string,
): Promise<Array<{ id: string; partnerId: string; profile: unknown; createdAt: Date }>> {
  const rows = await db
    .select({
      id: careerCaptures.id,
      partnerId: careerCaptures.partnerId,
      profile: careerCaptures.profile,
      createdAt: careerCaptures.createdAt,
    })
    .from(careerCaptures)
    .where(and(
      eq(careerCaptures.careerTargetId, careerTargetId),
      isNull(careerCaptures.retiredAt),
    ))
    .orderBy(desc(careerCaptures.createdAt));
  return rows;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/admin/projects/curriculum_developer
npx tsc --noEmit --skipLibCheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/db/employer-capture-queries.ts
git commit -m "feat(db): employer-capture query helpers

appendEmployerMessage, getEmployerSession, getLatestEmployerSessionId,
startEmployerSession, createCareerCapture, getLatestCaptureFor,
listCapturesByTarget. Mirrors the shape of capture-messages-queries
but partner+career-target-scoped instead of course-scoped."
```

---

## Task 3: Register the two AI functions in `function-settings.ts`

**Files:**
- Modify: `lib/ai/function-settings.ts`
- Modify: `lib/ai/prompts/load.ts`

- [ ] **Step 1: Add the function ids**

In `lib/ai/function-settings.ts`, append to `AI_FUNCTION_IDS`:

```typescript
  'capture-employer-chat-agent',
  'capture-employer-synthesis',
```

Add corresponding `DEFAULT_TIERS` entries with rationale comments:

```typescript
  // Default tier. Drives the per-turn interview loop with employers —
  // similar reasoning load to capture-chat-agent (read context, probe
  // for evidence, emit structured per-turn response). Promote to heavy
  // if employer interviews surface miscalibration in v1.
  'capture-employer-chat-agent': 'default',
  // Default tier. Reads the full interview transcript + career-target
  // context and emits a CareerCaptureProfile. Same shape of work as
  // capture-synthesis on the course side.
  'capture-employer-synthesis': 'default',
```

Add corresponding entries to `FUNCTION_LABELS` and `FUNCTION_DESCRIPTIONS` if those maps exist in the file (per the file's existing pattern — typecheck will flag if you miss them).

For labels: `'Employer interview chat'` and `'Employer interview synthesis'`. For descriptions, brief one-liners.

- [ ] **Step 2: Register the prompt names**

Open `lib/ai/prompts/load.ts`. Find the `PromptName` union type. Add:

```typescript
  | 'capture-employer-chat-agent'
  | 'capture-employer-synthesis'
```

(Other prompt names are alphabetized or grouped; match the existing order pattern.)

- [ ] **Step 3: Typecheck**

```bash
cd /Users/admin/projects/curriculum_developer
npx tsc --noEmit --skipLibCheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/ai/function-settings.ts lib/ai/prompts/load.ts
git commit -m "feat(ai): register capture-employer-chat-agent + capture-employer-synthesis

Both default tier. Prompts themselves land in the next tasks; this
just wires the function-tier system + the PromptName type union so
the runner can resolve them. AI_FUNCTION_IDS is 'as const', so
typecheck enforces that the new ids appear in every Record<AIFunctionId, _>."
```

---

## Task 4: Write the employer-interview prompt

**Files:**
- Create: `lib/ai/prompts/capture-employer-chat-agent.md`

- [ ] **Step 1: Create the prompt file**

Create `lib/ai/prompts/capture-employer-chat-agent.md` with this content:

```markdown
---
name: capture-employer-chat-agent
manning_skills:
  - employer-interview
  - evidence-based-reasoning
  - structured-output
includes:
  - shared/depth-scale.md
---

# Role

You are an interviewer helping an industry partner describe what a
successful entry-level hire looks like for one specific career target
at their company. The output is a structured Career-Target Capture
that faculty will use to audit how well the GC curriculum prepares
students for this role.

You do NOT produce the capture during the conversation. You ask one
focused question at a time, build understanding through evidence,
and emit a structured per-turn response (one finding + one question).
The synthesis layer reads the full transcript at the end and produces
the capture.

# Persona

You are a thoughtful interviewer — curious, specific, time-respectful.
The partner is doing the program a favor by sharing 20-45 minutes.

**Stance:**

- **Curious, not interrogative.** "Tell me about" / "help me understand"
  / "what would that look like" — not "what do you require."
- **Probe with stories.** "Tell me about a recent hire that worked
  really well — what made them work?" is worth more than 10 abstract
  questions about hiring criteria.
- **Time-respectful.** Aim for 20-45 minutes of conversation. Don't
  ask 80 questions; ask 15-25 that surface the substantive answers.
- **No K/U/D language to the partner.** Internally you're scoring on
  the depth scale; externally you ask "what should they know? what
  should they understand? what should they be able to do on day 1?"
- **Substance over politeness.** If the partner says "we look for
  good communicators," ask "what does a good communicator do in their
  first week that a poor one doesn't?"

# What you have access to

The user message contains:
1. The career target description + its sub-competencies (the things
   the program is trying to develop in graduates for this target).
2. Any prior employer captures on the same target from OTHER partners
   (so you don't repeat questions other employers already answered).
3. The full conversation so far (each turn includes its id so you can
   cite specific partner statements).

The partner sees only your `question` field per turn. Your `finding`
field is internal — synthesis reads it to understand what you've
learned. The instructor never sees it during the conversation.

# What you're trying to learn

Five things, in rough order:

1. **Role shape.** What does this role actually do day-to-day? What
   does the first 90 days look like? What's the trajectory at 12-24
   months? Distinguish "title" from "actual work."

2. **Day-1 expectations (K/U/D-shaped).** What does a successful new
   hire need to KNOW (recall, recognize, name), UNDERSTAND (reason
   about, explain, predict), and DO (produce, demonstrate, perform)
   on day 1? Probe each layer separately — they don't always match.

3. **Dealbreakers.** What single thing, if missing, makes a hire
   not work — even if everything else is strong? (Often the most
   useful signal in the whole interview.)

4. **Hiring signals.** What separates a "competent" applicant from
   a "this is the one" applicant? What do they look for in a
   portfolio / interview / first project?

5. **Divergence from how the field is often portrayed.** What's
   changing about the role that traditional curricula don't track?
   What's overemphasized vs. underemphasized in school?

# What to do per turn

Each turn:

1. Read what the partner said.
2. Internally update your understanding of role shape, K/U/D
   expectations, dealbreakers, hiring signals, divergence.
3. Pick the ONE most consequential follow-up — the question whose
   answer most reduces your uncertainty.
4. Emit the structured response:
   - `finding`: 1-2 sentences on what this turn added to your
     understanding (internal — for synthesis).
   - `question`: ONE question, conversational, ≤2 sentences. Ends
     with a question mark on its own line.
   - `citations`: optional array — when your finding rests on a
     specific partner statement, cite by messageId.
   - `readiness`: { score, covered[], remaining[] } — your sense of
     completeness across the five things you're trying to learn.

# Opening turn

If this is your first turn (the partner hasn't typed anything yet),
introduce yourself briefly and ask one opening question. Template:

> "Hi, I'm doing an audit interview for the GC department to
> understand what entry-level [target name] hires need on day one.
> I'd love to start with a hire from the last year you thought really
> worked out — could you tell me about them? What made them work?"

# What ends the interview

Two ways:
1. Your readiness score reaches 75+ and you've covered all 5 areas
   above. Emit a closing turn: "I think I have enough to write this
   up — anything I missed before we wrap?"
2. The partner ends it themselves via the UI (the "End interview"
   button). Synthesis runs on whatever's there.

# What NOT to ask

- **No demographic / personal info.** Don't ask about race, age,
  background, etc.
- **No salary negotiation details.** Salary ranges if they offer; not
  individual negotiations.
- **No comparison to specific competitors.** Stay focused on this
  role at this company.
- **No leading questions.** "Would you say students need X?" — bad.
  "What do students need?" — good.
- **No K/U/D jargon.** Translate to "know / understand / do."
```

- [ ] **Step 2: Verify the prompt loads**

```bash
cd /Users/admin/projects/curriculum_developer
node -e "
const fs = require('fs');
const txt = fs.readFileSync('lib/ai/prompts/capture-employer-chat-agent.md', 'utf8');
console.log('length:', txt.length);
console.log('has frontmatter:', txt.startsWith('---'));
console.log('has Role section:', txt.includes('# Role'));
console.log('has opening template:', txt.includes('worked out'));
"
```

Expected: length > 3000, all booleans true.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/prompts/capture-employer-chat-agent.md
git commit -m "feat(prompt): capture-employer-chat-agent — interviewer persona

Per-turn structured-output employer-interview agent. Same response
shape as capture-chat-agent (finding + question + citations +
readiness) but employer-facing: probes for role shape, day-1 K/U/D
expectations, dealbreakers, hiring signals, divergence from catalog
framing. Time-respectful (20-45 min target), story-driven probing
('tell me about a recent hire'), no K/U/D jargon to the partner."
```

---

## Task 5: Write the employer-synthesis prompt + schema

**Files:**
- Create: `lib/ai/prompts/capture-employer-synthesis.md`
- Create: `lib/ai/employer-capture/schema.ts`

- [ ] **Step 1: Define the CareerCaptureProfile schema**

Create `lib/ai/employer-capture/schema.ts`:

```typescript
import { z } from 'zod';

/**
 * Output of a completed employer interview. Per-partner per-career-target.
 * Persisted as the `profile` jsonb on career_captures rows.
 */

export const KudDepth = z.object({
  k_depth: z.number().int().min(0).max(5).nullable(),
  u_depth: z.number().int().min(0).max(5).nullable(),
  d_depth: z.number().int().min(0).max(5).nullable(),
  rationale: z.string().min(1).max(800),
});

export const CareerCaptureCompetency = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(1000),
  expected_on_day_1: KudDepth,
  notes: z.string().max(800).optional(),
});

export const CareerCaptureProfile = z.object({
  role_shape: z.object({
    title_actual: z.string().min(1).max(200),
    day_to_day_summary: z.string().min(1).max(1500),
    first_90_days: z.string().min(1).max(1000),
    trajectory_12_24mo: z.string().min(1).max(1000),
  }),
  day_1_competencies: z.array(CareerCaptureCompetency).min(1).max(20),
  dealbreakers: z.array(z.object({
    description: z.string().min(1).max(500),
    why_it_matters: z.string().min(1).max(500),
  })),
  hiring_signals: z.array(z.object({
    signal: z.string().min(1).max(300),
    weight: z.enum(['strong', 'moderate', 'context-dependent']),
  })),
  divergence_from_catalog: z.array(z.object({
    observation: z.string().min(1).max(500),
    direction: z.enum(['catalog_overweights', 'catalog_underweights', 'catalog_missing']),
  })),
  partner_summary: z.string().min(1).max(2000),
  generated_at: z.string().min(1),
});
export type CareerCaptureProfileType = z.infer<typeof CareerCaptureProfile>;

/**
 * OpenAI strict-mode JSON Schema mirror. Every property listed in
 * `required`; nullable fields encoded as union types.
 */
export const careerCaptureProfileJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['role_shape', 'day_1_competencies', 'dealbreakers', 'hiring_signals', 'divergence_from_catalog', 'partner_summary', 'generated_at'],
  properties: {
    role_shape: {
      type: 'object',
      additionalProperties: false,
      required: ['title_actual', 'day_to_day_summary', 'first_90_days', 'trajectory_12_24mo'],
      properties: {
        title_actual: { type: 'string', minLength: 1, maxLength: 200 },
        day_to_day_summary: { type: 'string', minLength: 1, maxLength: 1500 },
        first_90_days: { type: 'string', minLength: 1, maxLength: 1000 },
        trajectory_12_24mo: { type: 'string', minLength: 1, maxLength: 1000 },
      },
    },
    day_1_competencies: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'description', 'expected_on_day_1', 'notes'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', minLength: 1, maxLength: 1000 },
          expected_on_day_1: {
            type: 'object',
            additionalProperties: false,
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
        type: 'object',
        additionalProperties: false,
        required: ['description', 'why_it_matters'],
        properties: {
          description: { type: 'string', minLength: 1, maxLength: 500 },
          why_it_matters: { type: 'string', minLength: 1, maxLength: 500 },
        },
      },
    },
    hiring_signals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['signal', 'weight'],
        properties: {
          signal: { type: 'string', minLength: 1, maxLength: 300 },
          weight: { type: 'string', enum: ['strong', 'moderate', 'context-dependent'] },
        },
      },
    },
    divergence_from_catalog: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['observation', 'direction'],
        properties: {
          observation: { type: 'string', minLength: 1, maxLength: 500 },
          direction: { type: 'string', enum: ['catalog_overweights', 'catalog_underweights', 'catalog_missing'] },
        },
      },
    },
    partner_summary: { type: 'string', minLength: 1, maxLength: 2000 },
    generated_at: { type: 'string', minLength: 1 },
  },
} as const;
```

- [ ] **Step 2: Write strict-mode invariant test**

Create `tests/ai/employer-capture-schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { CareerCaptureProfile, careerCaptureProfileJsonSchema } from '@/lib/ai/employer-capture/schema';

describe('CareerCaptureProfile schema', () => {
  it('accepts a valid minimal profile', () => {
    const valid = {
      role_shape: {
        title_actual: 'Junior Brand Strategist',
        day_to_day_summary: 'Supports the brand strategy team on client research and concept development.',
        first_90_days: 'Shadow senior strategists; complete onboarding research project; present findings.',
        trajectory_12_24mo: 'Lead small-client engagements; develop concept frameworks independently.',
      },
      day_1_competencies: [{
        name: 'Audience research',
        description: 'Reads and summarizes target-audience interviews; synthesizes themes.',
        expected_on_day_1: { k_depth: 3, u_depth: 2, d_depth: 2, rationale: 'Needs to recognize patterns; not yet leading the methodology.' },
        notes: null,
      }],
      dealbreakers: [],
      hiring_signals: [],
      divergence_from_catalog: [],
      partner_summary: 'Looking for curious, evidence-driven juniors.',
      generated_at: '2026-06-04T00:00:00.000Z',
    };
    expect(() => CareerCaptureProfile.parse(valid)).not.toThrow();
  });

  it('rejects missing role_shape', () => {
    const invalid = {
      day_1_competencies: [],
      dealbreakers: [],
      hiring_signals: [],
      divergence_from_catalog: [],
      partner_summary: 'x',
      generated_at: '2026-06-04T00:00:00.000Z',
    };
    expect(() => CareerCaptureProfile.parse(invalid)).toThrow();
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
    walk(careerCaptureProfileJsonSchema);
  });
});
```

- [ ] **Step 3: Run the tests**

```bash
cd /Users/admin/projects/curriculum_developer
pnpm vitest run tests/ai/employer-capture-schema.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 4: Write the synthesis prompt**

Create `lib/ai/prompts/capture-employer-synthesis.md`:

```markdown
---
name: capture-employer-synthesis
manning_skills:
  - employer-interview
  - synthesis
  - structured-output
includes:
  - shared/depth-scale.md
---

# Role

You are the synthesis layer for CareerCapture. You are given the full
employer-interview transcript (every turn from career_capture_messages),
the career target description + sub-competencies, and (optionally) prior
captures from other partners on the same target. Your job is to emit ONE
structured CareerCaptureProfile JSON that captures everything the
interview established.

You do NOT continue the conversation. You produce one JSON object and
stop.

# How to reason about this task

You are extracting structured "what does day-1 look like" data from a
single employer's testimony. Treat the interview as the canonical source
— everything in the output should be groundable in something the partner
said. When you don't have evidence for a field, prefer brevity to
invention.

For day_1_competencies: list 3-15 specific competencies that the partner
mentioned as important for day 1. For each, score K/U/D per the
depth scale. Use the same dimensional rigor as CourseCapture:

- K = recall / recognition / naming. K=0 if not mentioned at all.
- U = reasoning / explanation / prediction. U=0 if not mentioned.
- D = behavioral output / production / performance. D=0 if not mentioned.
- Above-zero scores require the partner to have said something specific.
  Vague endorsements ("good communicators") map to K=1, not D=3.

For dealbreakers: the partner-stated absolute-no-go's. Often the most
useful signal. Direct quotes preferred in `why_it_matters`.

For hiring_signals: what separates "this is the one" from "this is fine."
Weight is a judgment: how often did the partner emphasize this? Did they
return to it?

For divergence_from_catalog: compare what the partner described to the
catalog career-target description + sub-competencies you were given. Flag
mismatches:
- `catalog_overweights`: catalog emphasizes something the partner didn't
- `catalog_underweights`: partner emphasized something catalog doesn't
- `catalog_missing`: something important the catalog doesn't mention at all

partner_summary: 2-3 paragraph editorial summary of this partner's
perspective on the role. The voice should be "this employer says..."
not "the employer says..." — make it clear it's one perspective.

# Hard rules (the structured-output schema will reject violations)

- All required fields present
- Every above-zero K/U/D score must trace to something the partner said
- Use partner's wording when possible; paraphrase only when needed for
  brevity
- Don't invent dealbreakers, signals, or divergence — if the partner
  didn't surface them, the array is empty

# Tone of rationale fields

Direct, descriptive, evidence-grounded. Match the voice of
capture-synthesis rationale fields. Avoid hedging ("the partner seemed
to suggest"); be direct ("the partner said") or omit.
```

- [ ] **Step 5: Typecheck + commit**

```bash
cd /Users/admin/projects/curriculum_developer
npx tsc --noEmit --skipLibCheck
git add lib/ai/employer-capture/schema.ts \
       tests/ai/employer-capture-schema.test.ts \
       lib/ai/prompts/capture-employer-synthesis.md
git commit -m "feat(employer-capture): CareerCaptureProfile schema + synthesis prompt

CareerCaptureProfile shape: role_shape + day_1_competencies (K/U/D
on each) + dealbreakers + hiring_signals + divergence_from_catalog +
partner_summary. Same strict-mode JSON Schema discipline as
CourseCapture (every property in required; nullable union types).

Synthesis prompt reads the interview transcript + career-target
context and emits the structured capture. Same provenance rigor
('partner said' grounding, no invention)."
```

---

## Task 6: Implement the interview runner + synthesis caller

**Files:**
- Create: `lib/ai/employer-capture/run.ts`

- [ ] **Step 1: Define the per-turn response shape (mirrors AuditResponse)**

The interview agent's per-turn output uses the same structured pattern as the course audit agent: `{ finding, question, citations, readiness }`. We can reuse `AuditResponse` from `lib/ai/agent/audit-response-schema.ts` directly — it's the same shape, just employer-facing semantics.

Read that file to confirm what's exported:

```bash
cd /Users/admin/projects/curriculum_developer
grep -nE 'export|interface|const' lib/ai/agent/audit-response-schema.ts | head -10
```

You should see `AuditResponse`, `AuditResponseSchema`, `AuditResponseJsonSchema`. Reuse all three.

- [ ] **Step 2: Create `run.ts`**

Create `lib/ai/employer-capture/run.ts`:

```typescript
import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';
import { appendEmployerMessage, getEmployerSession, type EmployerMessageRow } from '@/lib/db/employer-capture-queries';
import { AuditResponseSchema, AuditResponseJsonSchema, type AuditResponse } from '@/lib/ai/agent/audit-response-schema';
import { CareerCaptureProfile, careerCaptureProfileJsonSchema, type CareerCaptureProfileType } from './schema';
import type { Message } from 'ai';

export interface RunEmployerInterviewInput {
  partnerId: string;
  careerTargetId: string;
  sessionId: string;
  userMessage?: string;
  /** Career-target description + sub-competencies (catalog context). */
  targetContext: {
    id: string;
    name: string;
    description: string;
    subCompetencies: Array<{ id: string; name: string; description: string }>;
  };
  /** Prior captures from other partners on this same target. Optional. */
  priorCaptures?: Array<{ partnerLabel: string; profile: unknown }>;
}

export interface RunEmployerInterviewResult {
  response: AuditResponse;
  costUsdCents: number;
  durationMs: number;
  cachedTokens: number;
  uncachedPromptTokens: number;
  completionTokens: number;
  model: string;
}

/**
 * One turn of an employer interview. Mirrors runAuditAgent: persists
 * the user turn (if present), assembles context, calls the provider
 * with the structured-response schema, persists the assistant turn,
 * returns the parsed response + telemetry.
 */
export async function runEmployerInterview(input: RunEmployerInterviewInput): Promise<RunEmployerInterviewResult> {
  const existing = await getEmployerSession(input.partnerId, input.careerTargetId, input.sessionId);
  const isOpeningTurn = existing.length === 0 && !input.userMessage;
  const userTurnIndex = existing.length;

  if (!isOpeningTurn) {
    if (!input.userMessage) throw new Error('runEmployerInterview: userMessage required when continuing a session');
    await appendEmployerMessage({
      partnerId: input.partnerId,
      careerTargetId: input.careerTargetId,
      sessionId: input.sessionId,
      turnIndex: userTurnIndex,
      role: 'user',
      content: input.userMessage,
    });
  }

  const history = await getEmployerSession(input.partnerId, input.careerTargetId, input.sessionId);
  const provider = await getProviderForFunction('capture-employer-chat-agent');
  const systemPrompt = await loadPrompt('capture-employer-chat-agent');

  const contextBlock = [
    `# Career target`,
    `**${input.targetContext.name}** (id: ${input.targetContext.id})`,
    input.targetContext.description,
    '',
    `# Sub-competencies the program is trying to develop for this target`,
    ...input.targetContext.subCompetencies.map(sc => `- **${sc.name}**: ${sc.description}`),
  ].join('\n');

  const priorBlock = input.priorCaptures && input.priorCaptures.length > 0
    ? [
        '',
        `# Prior captures on this target from other partners (don't repeat questions)`,
        ...input.priorCaptures.map((c, i) =>
          `## Partner ${i + 1} (${c.partnerLabel})\n${JSON.stringify(c.profile, null, 2).slice(0, 2000)}`
        ),
      ].join('\n')
    : '';

  const messages: Message[] = [
    { role: 'user', content: contextBlock + priorBlock } as Message,
    ...history
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map((m): Message => {
        if (m.role === 'assistant') {
          return { role: 'assistant', content: typeof m.content === 'string' ? m.content : null } as Message;
        }
        return { role: 'user', content: m.content ?? '' } as Message;
      }),
  ];

  if (isOpeningTurn) {
    messages.push({
      role: 'user',
      content: `Begin the interview now per the conversation rules. Produce your opening turn.`,
    } as Message);
  }

  const result = await provider.complete<AuditResponse>({
    systemPrompt,
    messages,
    schemaName: 'employer_interview_turn',
    jsonSchema: AuditResponseJsonSchema as unknown as object,
    validate: (raw: unknown) => AuditResponseSchema.parse(raw),
  });

  const assistantTurnIndex = isOpeningTurn ? 0 : userTurnIndex + 1;
  await appendEmployerMessage({
    partnerId: input.partnerId,
    careerTargetId: input.careerTargetId,
    sessionId: input.sessionId,
    turnIndex: assistantTurnIndex,
    role: 'assistant',
    content: JSON.stringify(result.data),
  });

  return {
    response: result.data,
    costUsdCents: result.costUsdCents,
    durationMs: result.durationMs,
    cachedTokens: result.cachedTokens,
    uncachedPromptTokens: result.uncachedPromptTokens,
    completionTokens: result.completionTokens,
    model: provider.model,
  };
}

export interface GenerateCareerCaptureInput {
  partnerId: string;
  careerTargetId: string;
  sessionId: string;
  targetContext: RunEmployerInterviewInput['targetContext'];
  priorCaptures?: RunEmployerInterviewInput['priorCaptures'];
}

export interface GenerateCareerCaptureResult {
  profile: CareerCaptureProfileType;
  model: string;
  costUsdCents: number;
  durationMs: number;
}

/**
 * Run synthesis over a completed interview. Reads the full transcript,
 * emits a CareerCaptureProfile. Server-stamps generated_at.
 */
export async function generateCareerCaptureProfile(input: GenerateCareerCaptureInput): Promise<GenerateCareerCaptureResult> {
  const transcript = await getEmployerSession(input.partnerId, input.careerTargetId, input.sessionId);
  if (transcript.length === 0) {
    throw new Error('generateCareerCaptureProfile: no transcript to synthesize');
  }

  const provider = await getProviderForFunction('capture-employer-synthesis');
  const systemPrompt = await loadPrompt('capture-employer-synthesis');

  const contextBlock = [
    `# Career target`,
    `**${input.targetContext.name}** (id: ${input.targetContext.id})`,
    input.targetContext.description,
    '',
    `# Sub-competencies`,
    ...input.targetContext.subCompetencies.map(sc => `- **${sc.name}**: ${sc.description}`),
  ].join('\n');

  const transcriptBlock = transcript.map(row => {
    const idShort = row.id.slice(0, 8);
    if (row.role === 'user') {
      return `PARTNER (turn ${row.turnIndex}, id=${idShort}): ${row.content ?? ''}`;
    }
    let text = row.content ?? '';
    try {
      const parsed = JSON.parse(text) as { finding?: string; question?: string };
      text = [parsed.finding && `Finding: ${parsed.finding}`, parsed.question && `Question: ${parsed.question}`].filter(Boolean).join('\n');
    } catch { /* keep raw */ }
    return `INTERVIEWER (turn ${row.turnIndex}, id=${idShort}):\n${text}`;
  }).join('\n\n');

  const priorBlock = input.priorCaptures && input.priorCaptures.length > 0
    ? '\n\n# Prior captures on this target from other partners\n' +
      input.priorCaptures.map((c, i) => `## Partner ${i + 1} (${c.partnerLabel})\n${JSON.stringify(c.profile, null, 2).slice(0, 2000)}`).join('\n\n')
    : '';

  const userMessage = [
    contextBlock,
    priorBlock,
    '',
    '---',
    '',
    '# Interview transcript',
    transcriptBlock,
    '',
    '---',
    '',
    'Emit the CareerCaptureProfile JSON now per the schema.',
  ].join('\n');

  const result = await provider.complete<CareerCaptureProfileType>({
    systemPrompt,
    userMessage,
    schemaName: 'career_capture_profile_v1',
    jsonSchema: careerCaptureProfileJsonSchema as unknown as object,
    validate: (raw: unknown) => CareerCaptureProfile.parse(raw),
  });

  // Server-stamp generated_at (same pattern as capture-scores route — don't trust the model's value).
  const profile: CareerCaptureProfileType = { ...result.data, generated_at: new Date().toISOString() };

  return {
    profile,
    model: provider.model,
    costUsdCents: result.costUsdCents,
    durationMs: result.durationMs,
  };
}
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/admin/projects/curriculum_developer
npx tsc --noEmit --skipLibCheck
```

Expected: no errors. If `AuditResponse` / `AuditResponseSchema` / `AuditResponseJsonSchema` are exported with different names from `audit-response-schema.ts`, adjust the imports.

- [ ] **Step 4: Commit**

```bash
git add lib/ai/employer-capture/run.ts
git commit -m "feat(employer-capture): runEmployerInterview + generateCareerCaptureProfile

Two functions, both modeled on the CourseCapture pattern. The
per-turn interview reuses AuditResponse (finding + question +
citations + readiness — same shape, employer semantics). Synthesis
reads the full transcript + target context, emits CareerCaptureProfile.

Server-stamps generated_at after synthesis so the model can't echo
a stale value from prior context."
```

---

## Task 7: Per-turn API route

**Files:**
- Create: `app/api/partners/[token]/interview/[targetId]/chat/route.ts`

- [ ] **Step 1: Create the route**

Create `app/api/partners/[token]/interview/[targetId]/chat/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { resolvePartner } from '@/lib/partners/auth';
import { getCareerTargetById } from '@/lib/db/career-targets-queries';
import { listSubCompetenciesByTarget } from '@/lib/db/sub-competencies-queries';
import { runEmployerInterview } from '@/lib/ai/employer-capture/run';
import { getLatestEmployerSessionId, startEmployerSession } from '@/lib/db/employer-capture-queries';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap } from '@/lib/rate-limit/daily-cap';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ token: string; targetId: string }> }

/**
 * POST /api/partners/[token]/interview/[targetId]/chat
 * Body: { userMessage?: string, sessionId?: string }
 * Returns: { sessionId, response, telemetry }
 *
 * Partner-authenticated via the magic-link token. One turn of an
 * employer interview anchored to one career target.
 */
export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const { token, targetId } = await params;

  // Auth via existing partner session resolver
  const partner = await resolvePartner(req, token);
  if (!partner) return NextResponse.json({ error: 'invalid token' }, { status: 401 });

  // Rate-limit + cost cap (same pattern as capture chat route)
  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded (ip)' }, { status: 429 });
  const dailyOk = await checkDailyCap();
  if (!dailyOk.ok) return NextResponse.json({ error: 'daily cost cap reached' }, { status: 429 });

  // Resolve the target + sub-competencies
  const target = await getCareerTargetById(targetId);
  if (!target) return NextResponse.json({ error: 'career target not found' }, { status: 404 });
  const subs = await listSubCompetenciesByTarget(targetId);

  // Parse body
  const body = await req.json().catch(() => ({})) as { userMessage?: unknown; sessionId?: unknown };
  const userMessage = typeof body.userMessage === 'string' && body.userMessage.trim().length > 0
    ? body.userMessage.trim() : undefined;
  let sessionId = typeof body.sessionId === 'string' && body.sessionId.length > 0
    ? body.sessionId : null;

  if (!sessionId) {
    // No session passed; check if there's an open one for this (partner, target)
    sessionId = await getLatestEmployerSessionId(partner.id, targetId);
    if (!sessionId) sessionId = startEmployerSession();
  }

  try {
    const result = await runEmployerInterview({
      partnerId: partner.id,
      careerTargetId: targetId,
      sessionId,
      userMessage,
      targetContext: {
        id: target.id,
        name: target.name,
        description: target.description ?? '',
        subCompetencies: subs.map(s => ({
          id: s.id,
          name: s.name,
          description: s.description ?? '',
        })),
      },
    });

    return NextResponse.json({
      sessionId,
      response: result.response,
      telemetry: {
        costUsdCents: result.costUsdCents,
        durationMs: result.durationMs,
        model: result.model,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`POST /api/partners/[token]/interview/${targetId}/chat failed:`, message);
    return NextResponse.json({ error: 'interview turn failed', detail: message.slice(0, 300) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify the imported queries exist**

```bash
cd /Users/admin/projects/curriculum_developer
grep -nE 'getCareerTargetById|listSubCompetenciesByTarget|resolvePartner' lib/db/career-targets-queries.ts lib/db/sub-competencies-queries.ts lib/partners/auth.ts 2>/dev/null | head -10
```

If `getCareerTargetById` doesn't exist exactly, find the closest helper and adjust the import (or write a thin one inline that does a simple Drizzle query). Same for `listSubCompetenciesByTarget`. `resolvePartner` does exist (used by other partner routes — confirm via `grep -rn 'resolvePartner' app/api/partners`).

- [ ] **Step 3: Typecheck**

```bash
cd /Users/admin/projects/curriculum_developer
npx tsc --noEmit --skipLibCheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add 'app/api/partners/[token]/interview/[targetId]/chat/route.ts'
git commit -m "feat(api): POST /api/partners/[token]/interview/[targetId]/chat

Partner-authenticated (via magic-link token) per-turn endpoint that
drives the employer-interview agent. IP rate limit + daily cost cap
gated. Mints a new session_id if none exists or if the latest one
resolves null. Returns the structured response (finding + question +
citations + readiness) + telemetry."
```

---

## Task 8: Synthesis API route

**Files:**
- Create: `app/api/partners/[token]/interview/[targetId]/generate/route.ts`

- [ ] **Step 1: Create the route**

Create `app/api/partners/[token]/interview/[targetId]/generate/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { resolvePartner } from '@/lib/partners/auth';
import { getCareerTargetById } from '@/lib/db/career-targets-queries';
import { listSubCompetenciesByTarget } from '@/lib/db/sub-competencies-queries';
import { generateCareerCaptureProfile } from '@/lib/ai/employer-capture/run';
import { getLatestEmployerSessionId, createCareerCapture } from '@/lib/db/employer-capture-queries';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap } from '@/lib/rate-limit/daily-cap';
import { hashIp } from '@/lib/ip-hash';

interface RouteContext { params: Promise<{ token: string; targetId: string }> }

/**
 * POST /api/partners/[token]/interview/[targetId]/generate
 * Body: {}
 * Returns: { captureId, createdAt, profile }
 *
 * Runs synthesis over the latest interview session for this (partner,
 * target), persists the result as a new career_captures row, returns
 * the new row.
 */
export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const { token, targetId } = await params;

  const partner = await resolvePartner(req, token);
  if (!partner) return NextResponse.json({ error: 'invalid token' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded (ip)' }, { status: 429 });
  const dailyOk = await checkDailyCap();
  if (!dailyOk.ok) return NextResponse.json({ error: 'daily cost cap reached' }, { status: 429 });

  const target = await getCareerTargetById(targetId);
  if (!target) return NextResponse.json({ error: 'career target not found' }, { status: 404 });

  const sessionId = await getLatestEmployerSessionId(partner.id, targetId);
  if (!sessionId) {
    return NextResponse.json({ error: 'no interview session to synthesize — start an interview first' }, { status: 400 });
  }

  const subs = await listSubCompetenciesByTarget(targetId);

  try {
    const result = await generateCareerCaptureProfile({
      partnerId: partner.id,
      careerTargetId: targetId,
      sessionId,
      targetContext: {
        id: target.id,
        name: target.name,
        description: target.description ?? '',
        subCompetencies: subs.map(s => ({ id: s.id, name: s.name, description: s.description ?? '' })),
      },
    });

    const created = await createCareerCapture({
      partnerId: partner.id,
      careerTargetId: targetId,
      sessionId,
      profile: result.profile,
      model: result.model,
    });

    return NextResponse.json({
      captureId: created.id,
      createdAt: created.createdAt.toISOString(),
      profile: result.profile,
      telemetry: { costUsdCents: result.costUsdCents, durationMs: result.durationMs, model: result.model },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`POST /api/partners/[token]/interview/${targetId}/generate failed:`, message);
    return NextResponse.json({ error: 'synthesis failed', detail: message.slice(0, 500) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/admin/projects/curriculum_developer
npx tsc --noEmit --skipLibCheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add 'app/api/partners/[token]/interview/[targetId]/generate/route.ts'
git commit -m "feat(api): POST /api/partners/[token]/interview/[targetId]/generate

Runs synthesis over the latest interview session for this (partner,
target). Persists a new immutable row in career_captures. 400 if
no session exists; 500 with truncated detail on failure."
```

---

## Task 9: Partner-facing interview page + client component

**Files:**
- Create: `app/partners/[token]/interview/[targetId]/page.tsx`
- Create: `app/partners/[token]/interview/[targetId]/InterviewPanel.tsx`

- [ ] **Step 1: Create the page**

Create `app/partners/[token]/interview/[targetId]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { resolvePartnerByToken } from '@/lib/partners/auth';
import { getCareerTargetById } from '@/lib/db/career-targets-queries';
import { getEmployerSession, getLatestEmployerSessionId, getLatestCaptureFor } from '@/lib/db/employer-capture-queries';
import { InterviewPanel } from './InterviewPanel';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ token: string; targetId: string }>;
}

export default async function PartnerInterviewPage({ params }: Props) {
  const { token, targetId } = await params;

  const partner = await resolvePartnerByToken(token);
  if (!partner) notFound();

  const target = await getCareerTargetById(targetId);
  if (!target) notFound();

  const sessionId = await getLatestEmployerSessionId(partner.id, targetId);
  const initialMessages = sessionId
    ? await getEmployerSession(partner.id, targetId, sessionId)
    : [];

  const existingCapture = await getLatestCaptureFor(partner.id, targetId);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">CareerCapture interview</p>
        <h1 className="mt-1 text-2xl font-semibold">{target.name}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{target.description}</p>
      </header>

      {existingCapture && (
        <div className="mb-6 rounded-md border border-stone-300 bg-stone-50 px-4 py-3 text-sm">
          <p className="font-semibold">A prior capture exists for this target ({new Date(existingCapture.createdAt).toLocaleDateString()}).</p>
          <p className="mt-1 text-xs text-muted-foreground">Starting a new interview adds a new capture; the prior one stays as history.</p>
        </div>
      )}

      <InterviewPanel
        token={token}
        targetId={targetId}
        targetName={target.name}
        initialSessionId={sessionId}
        initialMessages={initialMessages.map(m => ({
          role: m.role,
          content: m.content ?? '',
        }))}
      />
    </div>
  );
}
```

If `resolvePartnerByToken` doesn't exist as a named export, use whatever the existing partner pages use to resolve the partner from a token (look at `app/partners/[token]/page.tsx`).

- [ ] **Step 2: Create the client component**

Create `app/partners/[token]/interview/[targetId]/InterviewPanel.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { VoiceRecorder } from '@/components/VoiceRecorder';

interface PartnerMessage {
  role: string;
  content: string;
}

interface Props {
  token: string;
  targetId: string;
  targetName: string;
  initialSessionId: string | null;
  initialMessages: PartnerMessage[];
}

export function InterviewPanel({ token, targetId, targetName, initialSessionId, initialMessages }: Props) {
  const [messages, setMessages] = useState<PartnerMessage[]>(initialMessages);
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<{ captureId: string; createdAt: string } | null>(null);

  async function sendTurn(text?: string) {
    setBusy(true);
    setError(null);
    const userText = text ?? input.trim();
    if (userText) {
      setMessages(m => [...m, { role: 'user', content: userText }]);
    }
    try {
      const res = await fetch(`/api/partners/${encodeURIComponent(token)}/interview/${encodeURIComponent(targetId)}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userMessage: userText || undefined,
          sessionId: sessionId ?? undefined,
        }),
      });
      const json = await res.json() as {
        sessionId?: string;
        response?: { finding?: string; question?: string };
        error?: string;
        detail?: string;
      };
      if (!res.ok || !json.response) {
        setError(json.error ? `${json.error}${json.detail ? ' — ' + json.detail : ''}` : `Turn failed (${res.status})`);
        return;
      }
      if (json.sessionId) setSessionId(json.sessionId);
      const assistantText = [json.response.finding, json.response.question].filter(Boolean).join('\n\n');
      setMessages(m => [...m, { role: 'assistant', content: assistantText }]);
      setInput('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  async function handleEnd() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/partners/${encodeURIComponent(token)}/interview/${encodeURIComponent(targetId)}/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const json = await res.json() as { captureId?: string; createdAt?: string; error?: string; detail?: string };
      if (!res.ok || !json.captureId || !json.createdAt) {
        setError(json.error ? `${json.error}${json.detail ? ' — ' + json.detail : ''}` : `Synthesis failed (${res.status})`);
        return;
      }
      setGenerated({ captureId: json.captureId, createdAt: json.createdAt });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setGenerating(false);
    }
  }

  function appendTranscript(text: string) {
    setInput(prev => prev.trim() ? `${prev.trim()}\n\n${text}` : text);
  }

  if (generated) {
    return (
      <div className="rounded-md border border-emerald-300 bg-emerald-50 px-6 py-6 text-sm">
        <p className="font-semibold">Interview captured — thank you.</p>
        <p className="mt-2">Your responses about <strong>{targetName}</strong> are saved. The GC department will review and follow up if needed. You can close this tab.</p>
      </div>
    );
  }

  return (
    <section className="rounded-md border bg-card shadow-sm">
      <div className="space-y-3 px-4 py-4">
        {messages.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm">Ready when you are.</p>
            <p className="mt-1 text-xs text-muted-foreground">The interviewer will open with a question. Plan on 20-45 minutes; you can pause and come back via the same link.</p>
            <button
              type="button"
              onClick={() => sendTurn()}
              disabled={busy}
              className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? 'Starting…' : 'Start interview'}
            </button>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'rounded-lg bg-primary/10 px-3 py-2 ml-12' : 'rounded-lg bg-muted/40 px-3 py-2 mr-12'}>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {m.role === 'user' ? 'You' : 'Interviewer'}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-snug">{m.content}</p>
            </div>
          ))
        )}
      </div>

      {messages.length > 0 && (
        <div className="border-t px-4 py-3 space-y-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Type a reply, or use voice. Enter to send, Shift+Enter for a new line."
            rows={3}
            className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!busy && input.trim()) void sendTurn();
              }
            }}
          />
          <div className="flex items-center justify-between gap-3">
            <VoiceRecorder slug={token} onTranscript={appendTranscript} disabled={busy} />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleEnd}
                disabled={busy || generating}
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                {generating ? 'Synthesizing…' : 'End interview & generate'}
              </button>
              <button
                type="button"
                onClick={() => sendTurn()}
                disabled={busy || !input.trim()}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <p className="mx-4 mb-3 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-800">
          {error}
        </p>
      )}
    </section>
  );
}
```

Notes:
- `VoiceRecorder` is reused as-is. The `slug` prop is actually the partner token here; the `/api/transcribe` route uses the slug for rate-limiting + session check. If `/api/transcribe` requires the slug to be the PROTOTYPE_SLUG specifically (faculty-only auth), the partner side needs a separate route or a flag on `/api/transcribe` that allows partner tokens. Read `app/api/transcribe/route.ts` to confirm — if so, note it as a concern and we'll add a small adapter in a follow-up task.

- [ ] **Step 3: Typecheck**

```bash
cd /Users/admin/projects/curriculum_developer
npx tsc --noEmit --skipLibCheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add 'app/partners/[token]/interview/[targetId]/page.tsx' 'app/partners/[token]/interview/[targetId]/InterviewPanel.tsx'
git commit -m "feat(partner-ui): per-career-target interview page

Server component resolves partner + target + any existing session,
hands off to a client InterviewPanel. The panel manages turn-by-turn
chat with voice support, ends with a 'End interview & generate'
button that runs synthesis and shows a thank-you confirmation.
Reuses the existing VoiceRecorder component (partner token used in
place of slug for rate-limiting)."
```

---

## Task 10: Link from PartnerDashboard

**Files:**
- Modify: `app/partners/[token]/PartnerDashboard.tsx`

- [ ] **Step 1: Read the existing dashboard**

```bash
cd /Users/admin/projects/curriculum_developer
grep -nE 'careerTarget|career_target' app/partners/[token]/PartnerDashboard.tsx | head -10
```

The dashboard already lists the partner's career-target hints (probably as cards or buttons). We add an "Interview" link next to the existing "Submit positions" link for each target.

- [ ] **Step 2: Add interview links**

In `app/partners/[token]/PartnerDashboard.tsx`, find where the career targets are rendered (look for the loop). For each target, add an interview link:

```tsx
<Link
  href={`/partners/${encodeURIComponent(token)}/interview/${encodeURIComponent(target.id)}`}
  className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
>
  Start interview
</Link>
```

Match the existing styling pattern for the "Submit positions" link (or whatever the existing per-target CTA is). Place it next to the existing one.

- [ ] **Step 3: Typecheck**

```bash
cd /Users/admin/projects/curriculum_developer
npx tsc --noEmit --skipLibCheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add 'app/partners/[token]/PartnerDashboard.tsx'
git commit -m "feat(partner-ui): per-target Start-interview link from dashboard

Adds a Start-interview CTA next to the existing per-target actions.
Routes to /partners/[token]/interview/[targetId] where the
InterviewPanel takes over."
```

---

## Task 11: Admin synthesis view — show captures

**Files:**
- Modify: `app/admin/synthesis/targets/[targetId]/page.tsx`

- [ ] **Step 1: Add a CareerCaptures section**

In `app/admin/synthesis/targets/[targetId]/page.tsx`, after the existing synthesis content, add:

```typescript
import { listCapturesByTarget } from '@/lib/db/employer-capture-queries';
```

Inside the page component, fetch captures:

```typescript
const captures = await listCapturesByTarget(targetId);
```

Add a section to the JSX:

```tsx
<section className="mt-8">
  <h2 className="text-lg font-semibold">Employer interviews ({captures.length})</h2>
  {captures.length === 0 ? (
    <p className="mt-2 text-sm text-muted-foreground">No interviews recorded yet.</p>
  ) : (
    <div className="mt-3 space-y-3">
      {captures.map(c => {
        const p = c.profile as { partner_summary?: string; role_shape?: { title_actual?: string } };
        return (
          <div key={c.id} className="rounded-md border bg-card px-4 py-3 text-sm">
            <p className="font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Captured {new Date(c.createdAt).toLocaleDateString()}
            </p>
            {p.role_shape?.title_actual && (
              <p className="mt-1 font-semibold">{p.role_shape.title_actual}</p>
            )}
            {p.partner_summary && (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground line-clamp-3">{p.partner_summary}</p>
            )}
          </div>
        );
      })}
    </div>
  )}
</section>
```

This is the minimum-viable display. A richer expandable view per capture comes in v2.

- [ ] **Step 2: Typecheck**

```bash
cd /Users/admin/projects/curriculum_developer
npx tsc --noEmit --skipLibCheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add 'app/admin/synthesis/targets/[targetId]/page.tsx'
git commit -m "feat(admin): show CareerCaptures on per-target synthesis view

Minimum-viable per-capture card with date + role title + partner
summary line-clamped to 3 lines. Richer expandable view comes in
CareerCapture v2."
```

---

## Task 12: End-to-end smoke test + STATE.md update

**Files:**
- Modify: `docs/STATE.md`

- [ ] **Step 1: Restart Next.js + create a test partner**

```bash
cd /Users/admin/projects/curriculum_developer
launchctl kickstart -k gui/501/com.gc.curriculum-tool >/dev/null 2>&1
sleep 4
```

In the admin UI (or via the CSV import endpoint), add a test partner with at least one career target hint matching a real `careerTargets.id`. Note their `magicToken`.

- [ ] **Step 2: Open the interview URL + run through a short test interview**

In Safari: open `https://admins-mac-studio-2.tailb723c1.ts.net/partners/<token>/interview/<targetId>`. Click "Start interview." Answer 3-5 of the agent's questions. Then click "End interview & generate."

Expected: synthesis runs (15-60s); confirmation card appears. Check the DB:

```bash
psql "$DATABASE_URL" -c "SELECT id, partner_id, career_target_id, created_at FROM career_captures ORDER BY created_at DESC LIMIT 3"
```

Expected: the new capture row.

- [ ] **Step 3: Verify in admin synthesis view**

Open `/admin/synthesis/targets/<targetId>?slug=...` — the new interview should appear in the "Employer interviews" section.

- [ ] **Step 4: Add STATE.md row**

In `docs/STATE.md` Cross-cutting table, add:

```markdown
| **CareerCapture v1 (employer interview pipeline)** (2026-06-04) | Per-career-target conversational interview for industry partners. Magic-link-authenticated; runs at `/partners/[token]/interview/[targetId]`. 20-45 min AI-conducted interview (audit-agent loop with `capture-employer-chat-agent` prompt) probes role shape + day-1 K/U/D expectations + dealbreakers + hiring signals + divergence from catalog. Synthesis emits a structured `CareerCaptureProfile` (schema in `lib/ai/employer-capture/schema.ts`) persisted to `career_captures` table. Reuses VoiceRecorder for voice answers. Admin synthesis view at `/admin/synthesis/targets/[targetId]` lists captures per target. Schema migration `0028`. Plan: [`2026-06-04-careercapture-v1.md`](./superpowers/plans/2026-06-04-careercapture-v1.md). | live | 2026-06-04 |
```

Also append to the AI function tier table:

```markdown
| `capture-employer-chat-agent` | default | Per-turn employer-interview agent (CareerCapture v1) |
| `capture-employer-synthesis` | default | Synthesis over completed employer interview |
```

Bump the Last verified SHA.

- [ ] **Step 5: Commit + push**

```bash
git add docs/STATE.md
git commit -m "docs(state): CareerCapture v1 — employer interview pipeline shipped"
git push
```

---

## Self-review checklist

- ✅ **Spec coverage:** Every brainstorm element has a task — schema (1), queries (2), function registration (3), interview prompt (4), synthesis prompt + schema (5), runner (6), per-turn route (7), synthesis route (8), UI (9), dashboard link (10), admin display (11), smoke + docs (12).
- ✅ **Reuses what exists:** AuditResponse from CourseCapture is reused for the interview agent's per-turn response shape; VoiceRecorder is reused; the magic-link auth + partner page chrome is reused; the provider abstraction + function-tier system is reused.
- ✅ **MVP scope discipline:** No stress-test wiring (deferred to v2), no draft/snapshot intermediate, no cross-employer triangulation, no admin override editor — all flagged in the "Scope cut for v1" section.
- ✅ **No placeholders:** Every step has actual code or commands.
- ✅ **Type consistency:** `careerCaptureMessages`, `careerCaptures`, `CareerCaptureProfile`, `CareerCaptureProfileType`, `runEmployerInterview`, `generateCareerCaptureProfile`, `appendEmployerMessage`, `getEmployerSession`, `getLatestEmployerSessionId`, `createCareerCapture` — spelled identically across tasks.
- ✅ **Strict-mode JSON Schema:** Task 5's invariant walker test catches violations before they hit the provider.
- ✅ **Cost interlock:** Both API routes (Tasks 7 + 8) check `checkDailyCap` before invoking AI.

---

## What this plan deliberately doesn't do

- **No `/admin/partners` extensions** for "send interview link" — admin already has the per-partner magic link from the Phase A manual-send work in `2026-06-04-partner-handoff-vercel-phaseout.md`; the interview URL pattern is just `<magic-link-base>/partners/<token>/interview/<targetId>`. Admin can hand-craft URLs from the existing UI.
- **No stress-test wiring** — defer; the same agent applies but needs an adapter to point at CareerCaptureProfile instead of CaptureProfile.
- **No cross-employer triangulation in the agent** — the prior_captures context is included in the prompt as "don't repeat questions," but the agent doesn't actively probe for confirmation/disagreement. v2 work.
- **No partner-side rerun / edit** — the partner submits, gets a thank-you; if they want to revisit they start a fresh interview. v2 can add a "revise" path if needed.
- **No partner-facing capture preview** — the partner doesn't see the synthesized output. Faculty review it on the admin side. v2 can add a partner preview + opt-in feedback loop.
- **No auto-feed into Program Coverage Matrix** — the captures sit in their own table; surfacing them in `/program` is its own task once the data model stabilizes.

---

## Cost model for CareerCapture v1

Per interview (one partner, one career target):

- ~20-30 turn conversation at default tier (gpt-5.4) → ~$0.50-1.50 total chat cost
- One synthesis call at default tier → ~$0.20-0.40
- Voice transcription via local omlx → $0
- **Per-interview total: ~$0.70-2.00**

At 10-30 partners × 1-3 targets each, total program-wide CareerCapture cost is ~$20-200 one-time + similar per re-interview cycle (12-24 months). Sits comfortably under the daily cap.
