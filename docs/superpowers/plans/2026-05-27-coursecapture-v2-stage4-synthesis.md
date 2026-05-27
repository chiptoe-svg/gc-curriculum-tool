# CourseCapture v2 — Stage 4 Implementation Plan (Synthesis with Source Provenance)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the v1 scoring step (`capture-scores`) with the v2 synthesis path. Every finding in the generated CaptureProfile now carries `source` (`'instructor' | 'materials' | 'inferred'`) and `citations` (chunk + instructor message references). The `source` flag is derived mechanically from the citation types in the transcript turns that informed the finding — per the spec's Phase C. Review-panel UI shows a source indicator next to each finding.

**Architecture:** Stage 1 added `capture_messages` (append-only) with a `citations` jsonb column. Stage 3 makes the agent emit citations on every turn. Stage 4 reads those citations during synthesis and propagates them — plus the mechanically-derived source flag — into the structured CaptureProfile. The v1 synthesis path (`captureScores` reading from session-overwriting `captureConversations` + flat materials) stays as the fallback when `COURSECAPTURE_V2_INGESTION` is off OR `audit_mode === 'simple'`.

**Tech Stack:** TypeScript strict · Vitest · existing `provider.complete<T>` (no tools needed — synthesis is single-shot structured output) · `lib/db/capture-messages-queries.ts` for the v2 transcript · Drizzle for the existing `course_capture_profiles` / `course_capture_snapshots` tables.

**Spec adherence notes:**
- Spec § "Phase C — Synthesis": one-shot structured-output call, NOT the agent. Reads the full session transcript from `capture_messages`, the cited chunks, and the digest layer. Emits the structured `CaptureProfile` JSON.
- Spec § "CaptureProfile shape extension": every finding (competencies, incoming_expectations, audit_notes items, productive_failure_conditions block, verification_summary) gets `source` + `citations`.
- Spec § "Synthesis prompt rewrite": rename `capture-scores.md` → `capture-synthesis.md` with derivation rules. The analyzer's exported function name (`generateCaptureProfile`) and AI function ID (`capture-scores`) stay — they're load-bearing across the codebase. Only the prompt file is renamed.
- Spec § "productive_failure_conditions emitted ONLY if Audit Area 7 was probed in the transcript": this is a prompt-level rule, not a schema constraint.

**Out of scope (Stage 5):**
- Migration of legacy `captureConversations` rows into `capture_messages` with synthesized session IDs.
- "Legacy draft" banner in the Review panel for existing pre-v2 snapshots.
- Real per-chunk drawer (click the source indicator → open chunk text). Tooltip-only for v1.

---

## File structure

**Created in this plan:**
- `lib/ai/prompts/capture-synthesis.md` — new prompt with the source-derivation rules + citations contract.
- `lib/ai/synthesis/source-derivation.ts` — pure-logic helper: given a finding's citation set, return `'instructor' | 'materials' | 'inferred'`.
- `tests/lib/ai/synthesis/source-derivation.test.ts`
- `scripts/_one-off/stage4-smoke.ts` — fixture-driven end-to-end (untracked).

**Modified in this plan:**
- `lib/ai/analyze/capture-scores.ts` — extend `captureProfileJsonSchema` + the prompt-loading logic to use the new `capture-synthesis.md` prompt when `COURSECAPTURE_V2_INGESTION=1`. Function name and exports stay; the analyzer dispatches between v1 and v2 prompt + schema based on env.
- `lib/ai/prompts/load.ts` — add `'capture-synthesis'` to `PromptName`.
- `lib/ai/schemas.ts` (or wherever the Zod CaptureProfile schema lives — find via grep) — extend competency / incoming-expectation / audit-note item types with optional `source` + `citations` fields.
- `app/api/capture/[code]/scores/route.ts` — when v2 is enabled, pass the v2 transcript (`getSessionMessages` rows with their citations) into the synthesis context; v1 context-build path stays as fallback.
- `app/capture/[code]/ProfileReviewPanel.tsx` (or wherever the review UI lives) — render a small source indicator next to each finding: solid teal for `instructor`, amber for `materials`, gray for `inferred`.
- `docs/STATE.md` — Stage 4 shipped.

---

## Task list

### Task 1: Schema extension — add source + citations to findings

**Files:**
- Modify: `lib/ai/analyze/capture-scores.ts` (or wherever `captureProfileJsonSchema` is defined; the JSON schema is in this file based on the grep)
- Modify: `lib/ai/schemas.ts` (Zod schema; verify via grep)
- Add tests if there's a schema test file

The fields added to each finding:

```ts
source: 'instructor' | 'materials' | 'inferred';
citations: Array<{
  type: 'chunk' | 'instructor';
  chunkId?: string;
  messageId?: string;
  excerpt: string;       // ≤ 200 chars
}>;
```

For backward compatibility, both fields are **optional in the schema** — pre-v2 snapshots won't have them; v2 snapshots will populate them.

- [ ] **Step 1: Find the Zod schema location**

```
grep -rln "captureProfileSchema\|CaptureProfile" lib/ai/ lib/db/ 2>/dev/null
```

Read the file. The schema likely lives in `lib/ai/schemas.ts` or `lib/ai/analyze/capture-scores.ts`. Identify the per-competency shape, per-incoming-expectation shape, audit_notes shape, productive_failure_conditions shape.

- [ ] **Step 2: Extend the Zod + JSON schemas**

Add to the schema definitions for each finding type (competency, incoming_expectation, audit_notes items including productive_failure_conditions, verification_summary block):

```ts
const SourceFlag = z.enum(['instructor', 'materials', 'inferred']);
const Citation = z.object({
  type: z.enum(['chunk', 'instructor']),
  chunkId: z.string().optional(),
  messageId: z.string().optional(),
  excerpt: z.string().max(200),
});

// In each finding type schema, add:
source: SourceFlag.optional(),
citations: z.array(Citation).optional(),
```

JSON schema parallel — extend with `source: {enum: [...], required: false}` and `citations: {type: 'array', items: {...}}` likewise optional.

- [ ] **Step 3: Verify no existing tests break**

```
./node_modules/.bin/vitest run tests/ai/course-profile/ 2>&1 | tail -5
```

The 7 existing tests in course-profile/ shouldn't break because the new fields are optional.

- [ ] **Step 4: Commit**

```
git add lib/ai/schemas.ts lib/ai/analyze/capture-scores.ts
git commit -m "feat(synthesis): add optional source + citations fields to CaptureProfile findings"
```

---

### Task 2: Source-derivation helper

**Files:**
- Create: `lib/ai/synthesis/source-derivation.ts`
- Create: `tests/lib/ai/synthesis/source-derivation.test.ts`

Pure logic: given a finding's citation array, return the derived source flag per the spec's mechanical rule. Used to verify the LLM's output and as a fallback when the model forgets to emit `source`.

```ts
// lib/ai/synthesis/source-derivation.ts
import type { AuditCitation } from '@/lib/ai/agent/audit-response-schema';

export type SourceFlag = 'instructor' | 'materials' | 'inferred';

/** Derive a finding's source flag from its citation set.
 *  - All citations type=instructor → 'instructor'
 *  - All citations type=chunk → 'materials'
 *  - Mixed (some of each) → 'inferred'
 *  - No citations at all → 'inferred' (the finding is speculative; the
 *    synthesis prompt asks the model to mark such findings explicitly).
 */
export function deriveSourceFlag(citations: AuditCitation[]): SourceFlag {
  if (citations.length === 0) return 'inferred';
  const hasInstructor = citations.some(c => c.type === 'instructor');
  const hasChunk = citations.some(c => c.type === 'chunk');
  if (hasInstructor && !hasChunk) return 'instructor';
  if (hasChunk && !hasInstructor) return 'materials';
  return 'inferred';
}
```

- [ ] **Step 1: Write tests**

```ts
import { describe, it, expect } from 'vitest';
import { deriveSourceFlag } from '@/lib/ai/synthesis/source-derivation';

describe('deriveSourceFlag', () => {
  it('returns "inferred" for empty citations', () => {
    expect(deriveSourceFlag([])).toBe('inferred');
  });
  it('returns "instructor" when all citations are type=instructor', () => {
    expect(deriveSourceFlag([
      { type: 'instructor', messageId: 'm1', excerpt: 'a' },
      { type: 'instructor', messageId: 'm2', excerpt: 'b' },
    ])).toBe('instructor');
  });
  it('returns "materials" when all citations are type=chunk', () => {
    expect(deriveSourceFlag([
      { type: 'chunk', chunkId: 'c1', excerpt: 'a' },
      { type: 'chunk', chunkId: 'c2', excerpt: 'b' },
    ])).toBe('materials');
  });
  it('returns "inferred" for mixed citations', () => {
    expect(deriveSourceFlag([
      { type: 'instructor', messageId: 'm1', excerpt: 'a' },
      { type: 'chunk', chunkId: 'c1', excerpt: 'b' },
    ])).toBe('inferred');
  });
  it('returns "instructor" for a single instructor citation', () => {
    expect(deriveSourceFlag([
      { type: 'instructor', messageId: 'm1', excerpt: 'a' },
    ])).toBe('instructor');
  });
});
```

- [ ] **Step 2: Implement + verify**

```
./node_modules/.bin/vitest run tests/lib/ai/synthesis/source-derivation.test.ts
```

- [ ] **Step 3: Commit**

```
git add lib/ai/synthesis/source-derivation.ts tests/lib/ai/synthesis/source-derivation.test.ts
git commit -m "feat(synthesis): mechanical source-flag derivation from citation types"
```

---

### Task 3: New synthesis prompt

**Files:**
- Create: `lib/ai/prompts/capture-synthesis.md`
- Modify: `lib/ai/prompts/load.ts` — add `'capture-synthesis'` to PromptName

Rewrites `capture-scores.md` for v2. The new prompt:
- Reads the same KUD+ rubric (via the included `shared/depth-scale.md`)
- Receives the v2 transcript (capture_messages including assistant turns with their `citations` arrays)
- Receives the digest layer + catalog + prereq profiles
- Instructs the model to populate every finding's `citations[]` from the transcript and `source` per the derivation rule
- Includes the productive_failure_conditions rule: emit only if Audit Area 7 was probed in the transcript; otherwise `null`

- [ ] **Step 1: Draft `capture-synthesis.md`**

Structure:

```markdown
---
name: capture-synthesis
includes:
  - shared/depth-scale.md
manning_skills:
  - curriculum-design
  - course-audit
  - evidence-based-reasoning
  - structured-output
---

# Role

You are synthesizing the final Course Outcome Profile from a completed
audit session. You receive the full audit transcript (every turn, with
its citations), the per-material digests, the catalog, and any prereq
course profiles. Your job is to emit ONE structured CaptureProfile JSON
that captures everything the audit established, with explicit provenance
on every finding.

# Inputs

In the user message:
- `catalog` — course code, title, description, learning objectives,
  major projects, declared incoming skills.
- `digests` — per-material digest blocks for every included material.
- `transcript` — every turn from `capture_messages` in chronological
  order. Each assistant turn has `content` (the model's reply) and
  `citations` (chunks + prior-message references that informed it).
- `prerequisite_profiles` — captured profiles for prereq courses, when
  available.

# Output shape

A single JSON object matching the CaptureProfile schema. Every finding
(competency, incoming_expectation, audit_notes item, productive_failure
block, verification_summary block) MUST include:

```
source: 'instructor' | 'materials' | 'inferred'
citations: Array<{ type: 'chunk' | 'instructor', chunkId?, messageId?, excerpt }>
```

# How to populate citations

For each finding, look at the audit transcript and identify the turns
that established it. Collect their `citations` arrays. Carry those
forward verbatim into the finding's `citations` field. Each citation
is preserved in original form — same `type`, same `chunkId` or
`messageId`, same `excerpt` (≤ 200 chars).

A finding may carry multiple citations of either type. If the same
chunk or message is cited by multiple turns, include it once.

# How to derive `source` (mechanical rule)

Apply this rule per finding, no exceptions:

- All citations have `type: 'instructor'` → `source: 'instructor'`
- All citations have `type: 'chunk'` → `source: 'materials'`
- Mixed (at least one of each) → `source: 'inferred'`
- No citations → `source: 'inferred'`

You do NOT use judgment to set `source`. The flag is structural, derived
mechanically from the citation set you assembled in the previous step.

# productive_failure_conditions rule

Emit the `productive_failure_conditions` block ONLY IF Audit Area 7
was probed in the transcript — i.e., the transcript contains explicit
discussion of generate-then-consolidate structure, ill-structured
problems, revision cycles with consequential failure, structured post-
mortem, or domain depth in this course. If the auditor never asked
about these conditions, set the block to `null` and do NOT infer them
from absence.

# Other fields

[... details of competencies, incoming_expectations, audit_notes, etc.
borrow heavily from the existing capture-scores.md prompt — preserve
those rules; only add the citations + source machinery here ...]
```

This is the spec-prescribed shape. Take the rest of the prompt body from
`capture-scores.md` and integrate the citation rules into the existing
finding-by-finding scoring instructions.

- [ ] **Step 2: Add `capture-synthesis` to the PromptName union**

```ts
// lib/ai/prompts/load.ts
type PromptName =
  | ...existing names...
  | 'capture-synthesis';
```

- [ ] **Step 3: Verify the prompt loads**

```
./node_modules/.bin/tsx -e "import { loadPrompt } from '@/lib/ai/prompts/load'; loadPrompt('capture-synthesis').then(text => console.log('length:', text.length, 'has-derivation:', text.includes('Mixed')));"
```

- [ ] **Step 4: Commit**

```
git add lib/ai/prompts/capture-synthesis.md lib/ai/prompts/load.ts
git commit -m "feat(synthesis): capture-synthesis prompt with mechanical source-derivation rules"
```

---

### Task 4: Wire v2 synthesis into the analyzer

**Files:**
- Modify: `lib/ai/analyze/capture-scores.ts`
- Modify: `app/api/capture/[code]/scores/route.ts`

When `COURSECAPTURE_V2_INGESTION=1` AND `audit_mode in ('full','simple')`:
- Build the v2 context: catalog + digests + the full transcript from `getSessionMessages(courseCode, sessionId)` (the session ID comes from the most recently snapshotted session for this course, OR — if no snapshot yet — the latest session in capture_messages).
- Load the prompt via `loadPrompt('capture-synthesis')` (instead of `capture-scores`).
- The model call stays the same shape (`provider.complete<CaptureProfile>`); only the prompt and the user-message construction differ.

When v2 is off, the existing v1 path runs unchanged.

- [ ] **Step 1: Extend `generateCaptureProfile`**

In `lib/ai/analyze/capture-scores.ts`, add an alternate code path:

```ts
async function buildV2SynthesisUserMessage(context: V2SynthesisContext): Promise<string> {
  const transcriptBlock = context.transcript
    .map(t => {
      if (t.role === 'assistant') {
        const cites = (t.citations ?? [])
          .map(c => `[${c.type}${c.chunkId ? `:chunk=${c.chunkId.slice(0, 8)}` : ''}${c.messageId ? `:msg=${c.messageId.slice(0, 8)}` : ''}] "${c.excerpt.slice(0, 120)}"`)
          .join(' ');
        return `ASSISTANT (turn ${t.turnIndex}): ${t.content}\nCITATIONS: ${cites || '(none)'}`;
      }
      return `USER (turn ${t.turnIndex}): ${t.content}`;
    })
    .join('\n\n');

  return [
    '# Catalog',
    context.catalogBlock,
    '',
    '# Per-material digests',
    context.digestBlock,
    '',
    '# Audit transcript (chronological, with citations on assistant turns)',
    transcriptBlock,
    '',
    '# Now produce the CaptureProfile JSON per the schema and rules above.',
  ].join('\n');
}

export async function generateCaptureProfileV2(...): Promise<...> {
  const provider = await getProviderForFunction('capture-scores');
  const systemPrompt = await loadPrompt('capture-synthesis');
  // ... call provider.complete with the v2 user message and same JSON schema ...
}
```

The existing v1 export stays. Add a new public entrypoint or extend the existing one to branch on a flag.

- [ ] **Step 2: Branch in the scores route**

In `app/api/capture/[code]/scores/route.ts`, around the call to `generateCaptureProfile`:

```ts
const v2Enabled =
  process.env.COURSECAPTURE_V2_INGESTION === '1' &&
  (course.auditMode === 'full' || course.auditMode === 'simple');

if (v2Enabled) {
  // Load transcript from capture_messages instead of legacy table
  // Get the latest active sessionId for this course (the agent's most recent
  // session that hasn't been snapshotted yet).
  const sessionId = await getLatestSessionId(courseCode);
  const transcript = sessionId ? await getSessionMessages(courseCode, sessionId) : [];
  const v2Context = buildV2SynthesisContext(course, materials, transcript, prereqProfiles);
  const { profile, ... } = await generateCaptureProfileV2(v2Context);
  // ...
} else {
  // existing v1 path
}
```

`getLatestSessionId(courseCode)` is a small helper — `select session_id from capture_messages where course_code = ? order by created_at desc limit 1` — add it to `lib/db/capture-messages-queries.ts` if it doesn't exist.

- [ ] **Step 3: Run tests**

```
./node_modules/.bin/vitest run tests/ai/course-profile/ tests/api/ 2>&1 | tail -8
```

Existing tests should pass — they exercise the v1 path with mocked providers.

- [ ] **Step 4: Commit**

```
git add lib/ai/analyze/capture-scores.ts app/api/capture/[code]/scores/route.ts lib/db/capture-messages-queries.ts
git commit -m "feat(synthesis): wire v2 capture-synthesis prompt into scores route (gated)"
```

---

### Task 5: Review UI source indicator

**Files:**
- Modify: `app/capture/[code]/ProfileReviewPanel.tsx` (verify path with `ls app/capture/[code]/`)

For each finding (competency, incoming_expectation, audit_note item), render a small source indicator next to the statement:
- `source === 'instructor'` → solid teal pill labeled "INSTRUCTOR"
- `source === 'materials'` → amber pill labeled "MATERIALS"
- `source === 'inferred'` → gray pill labeled "INFERRED"

On hover, the pill's title attribute shows the citation count (e.g., "3 instructor citations"). Click-through is OUT of scope for this stage (chip click → drawer is a future polish).

When `source` is missing (pre-v2 snapshots), render nothing — the existing layout stays as-is.

- [ ] **Step 1: Read ProfileReviewPanel.tsx**

Locate where each finding's `statement` is rendered. Add the source indicator next to it.

- [ ] **Step 2: Wire the indicator**

```tsx
function SourceBadge({ source, citationCount }: { source?: 'instructor' | 'materials' | 'inferred'; citationCount?: number }) {
  if (!source) return null;
  const palette = source === 'instructor'
    ? 'bg-teal-100 text-teal-900 border-teal-300'
    : source === 'materials'
      ? 'bg-amber-100 text-amber-900 border-amber-300'
      : 'bg-stone-100 text-stone-700 border-stone-300';
  return (
    <span
      title={citationCount ? `${citationCount} citation${citationCount === 1 ? '' : 's'}` : source}
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10.5px] font-mono uppercase tracking-wider ${palette}`}
    >
      {source}
    </span>
  );
}
```

Place it next to each `<h4>` or competency `<header>` element.

- [ ] **Step 3: Manual smoke (skip if no dev server)**

If you can run `pnpm dev:lan`, generate a profile on GC 4800 with v2 enabled and verify the badges appear on the new snapshot's findings.

- [ ] **Step 4: Commit**

```
git add app/capture/[code]/ProfileReviewPanel.tsx
git commit -m "feat(synthesis): ProfileReviewPanel — source indicator badges per finding"
```

---

### Task 6: STATE.md + final cleanup

- [ ] **Step 1: Update STATE.md**

Find the "Next-up → Spec'd, not yet implemented" CourseCapture v2 row. Update it to note Stage 4 shipped 2026-05-27 with:
- New `capture-synthesis.md` prompt with mechanical source-flag derivation rules
- Schema extension: every finding carries optional `source` + `citations`
- `deriveSourceFlag` helper for verification + fallback
- Scores route branches on v2 — loads transcript from `capture_messages` instead of legacy `captureConversations`
- ProfileReviewPanel renders source-indicator badges per finding

Append to the "Active arc → Stage 1 (Foundation) shipped" block: "Stage 4 shipped 2026-05-27."

Stage 5 (legacy migration) is the only remaining v2 task.

Add to the AI function-tier table: no new function IDs (capture-scores is reused; only the prompt changed).

- [ ] **Step 2: Commit + push**

```
git add docs/STATE.md
git commit -m "chore(synthesis): STATE.md — Stage 4 shipped"
```

---

## Acceptance criteria

After all tasks complete:

1. `./node_modules/.bin/vitest run` is green; new source-derivation tests pass.
2. `./node_modules/.bin/tsc --noEmit` is green outside baseline.
3. With `COURSECAPTURE_V2_INGESTION=1` + an existing v2 session on GC 4800: pressing "Generate Course Outcome Profile" produces a profile where every finding has `source` + `citations`.
4. With the flag off, v1 synthesis runs unchanged — no regression in existing snapshots' shape.
5. `deriveSourceFlag` correctly returns `'instructor' / 'materials' / 'inferred'` per the mechanical rule.
6. ProfileReviewPanel shows the source badge on findings when `source` is set; renders nothing for pre-v2 findings.
7. STATE.md reflects Stage 4 shipped.

## Out of scope (Stage 5)

- One-off migration script: `captureConversations` rows → `capture_messages` with synthesized session IDs.
- "Legacy draft" banner in Review panel for pre-v2 snapshots.
- Citation drawer (click → side panel with full chunk text).
- Real token streaming.
