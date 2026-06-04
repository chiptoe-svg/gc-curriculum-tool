# Adversarial Stress-Test Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-demand "Stress-test this profile" capability that runs a separate adversarial reviewer agent over a generated Course Outcome Profile and surfaces its concerns inline on the review page — without re-synthesizing or auto-modifying the profile.

**Architecture:** A new AI function `capture-stress-test` (heavy tier by default) runs a single LLM call against the produced profile + the synthesis context (transcript + materials + catalog) and emits per-competency annotations (confidence + concerns + suggested adjustments) plus profile-level concerns. Triggered on-demand from a button on `ProfileReviewPanel`; results render as small inline badges next to each finding, with a separate panel for profile-level concerns. The annotations are **ephemeral** — held in client state, not persisted to the working draft — because they're a thinking surface, not an authoritative record. Re-running the stress-test is the only way to refresh them; modifying the profile clears them.

**Tech Stack:** Existing — Next.js 15 server components + route handlers, OpenAI strict structured output via the provider abstraction, Vercel AI SDK telemetry, the function-tier system at `lib/ai/function-settings.ts`, Zod for runtime validation, Tailwind v4 + the existing editorial fonts (Fraunces / DM Sans / IBM Plex Mono).

---

## Background — what this is and isn't

The capture-synthesis agent emits findings with K/U/D depth scores, source attribution, and citations. Even with the prompt's "default-low" discipline + Manning-skill encoding + the schema validation we just shipped, the synthesizer is biased toward emitting findings (its job is to produce a profile). A model whose JOB is to find problems consistently surfaces issues the original synthesizer rationalized through.

This plan adds that "find problems" agent as a separate on-demand step. It is not:
- A re-synthesis (that creates oscillation loops; reviewer disagrees → re-synthesize → reviewer disagrees again)
- A blocking gate before approval (it's advisory; faculty decides what to act on)
- A multi-agent debate (one reviewer pass is sufficient and predictable)
- Auto-on-every-generate (faculty-triggered keeps cost predictable + lets faculty A/B against the same generated profile)

What it IS:
- One LLM call per click of "Stress-test this profile"
- Heavy-tier model (gpt-5.5) — this is where bigger reasoning earns its keep
- Per-competency annotations + profile-level concerns surfaced inline
- ~$0.05-0.20 per stress-test (depending on profile size; predictable, counts against daily cap)
- Faculty interprets the concerns; nothing auto-mutates the working draft

---

## File structure

**New files:**

- `lib/ai/prompts/capture-stress-test.md` — the adversarial reviewer prompt. Mirrors the frontmatter + structure of `capture-synthesis.md`. Its persona is explicitly skeptical: "your job is to find problems with this profile, not to balance praise."
- `lib/ai/stress-test/schema.ts` — Zod + JSON Schema for the reviewer's output shape (per-competency annotations + profile-level concerns + overall assessment).
- `lib/ai/stress-test/run.ts` — `runStressTest()` function. Mirrors the structure of `generateCaptureProfileV2` in `lib/ai/analyze/capture-scores.ts` — provider lookup, prompt load, user-message assembly, structured-output call, telemetry return. Single file because the function is self-contained.
- `app/api/capture/[code]/stress-test/route.ts` — POST endpoint. Slug-gated + IP-rate-limited + daily-cap checked (same pattern as `/api/capture/[code]/chat`). Loads the latest draft profile, the latest session's transcript, and the materials; calls `runStressTest`; returns the annotations.
- `app/capture/[code]/StressTestPanel.tsx` — the stand-alone client component that owns the stress-test state. Renders the "Stress-test this profile" button, the loading state, and the profile-level concerns panel. Inline competency annotations are rendered by `ProfileReviewPanel` itself but driven by props passed down from here.
- `app/capture/[code]/StressTestBadge.tsx` — small inline component used per-competency-row in `ProfileReviewPanel` to render the reviewer's confidence + concerns for that row.

**Modified files:**

- `lib/ai/function-settings.ts` — add `'capture-stress-test'` to `AI_FUNCTION_IDS`; add a default tier entry `'capture-stress-test': 'heavy'` to `DEFAULT_TIERS`; add the rationale comment block parallel to the others.
- `app/capture/[code]/ProfileReviewPanel.tsx` — mount `<StressTestPanel>` near the top (between the DRAFT banner and the course overview), accept stress-test annotations as a prop (or via a colocated state hook), and render `<StressTestBadge>` next to each competency row.
- `docs/STATE.md` — add a row under Cross-cutting documenting the new capability + cost story; bump the "Last verified" SHA.

**Deliberately NOT modified:**

- The synthesis prompts (`capture-scores.md`, `capture-synthesis.md`) — the stress-test agent is a separate layer that operates on synthesizer output, not part of synthesis itself.
- The Course Outcome Profile schema — annotations live alongside the profile in client state, never inside it.
- The snapshot flow — snapshots freeze the profile as-is; reviewer concerns are advisory and don't get baked in.

---

## Task 1: Register the new AI function + tier default

**Files:**
- Modify: `lib/ai/function-settings.ts`

- [ ] **Step 1: Add `'capture-stress-test'` to `AI_FUNCTION_IDS`**

In `lib/ai/function-settings.ts`, find the `AI_FUNCTION_IDS` array (around line 19). Add the new id at the end of the array, before the closing bracket:

```typescript
export const AI_FUNCTION_IDS = [
  'capture-chat',
  'capture-scores',
  'materials-analysis',
  'explore-draft-target',
  'explore-compare',
  'explore-what-if',
  'program-score-coverage',
  'decompose-prereq-gap',
  'material-digest',
  'chunk-contextualize',
  'ingestion-checkin',
  'capture-chat-agent',
  'wiki-update',
  'curriculum-chat',
  'capture-stress-test',
] as const;
```

- [ ] **Step 2: Add the default-tier mapping with rationale**

Find the `DEFAULT_TIERS` map. Add the new entry alphabetically among the existing ones (or with the rationale comments grouped at the bottom — match the file's style; if the file groups by purpose, put it near `capture-synthesis`-related entries). Add this entry:

```typescript
  // Heavy tier. Adversarial review of a produced profile: read all
  // competencies + audit_notes + verification_summary + the full
  // transcript + materials and challenge per-finding confidence,
  // surface internal contradictions, and flag catalog-vs-evidence
  // claims that don't hold up. This is exactly the kind of cross-
  // referenced critical-reasoning task where heavy-tier reasoning
  // is the value. One call per stress-test click; not auto-on-generate.
  'capture-stress-test': 'heavy',
```

- [ ] **Step 3: Verify typecheck**

```bash
cd /Users/admin/projects/curriculum_developer
npx tsc --noEmit --skipLibCheck
```

Expected: no errors (`AI_FUNCTION_IDS` is `as const`, so the typecheck would flag inconsistencies between `AI_FUNCTION_IDS` and `DEFAULT_TIERS`).

- [ ] **Step 4: Commit**

```bash
git add lib/ai/function-settings.ts
git commit -m "feat(ai): register capture-stress-test function (heavy default tier)

Adversarial reviewer agent — one call per on-demand stress-test of a
produced Course Outcome Profile. Heavy tier because critical cross-
referenced reasoning is exactly where bigger models earn their keep.
Not auto-on-generate; cost predictable + counts against daily cap.

No call site yet — wiring lands in subsequent tasks."
```

---

## Task 2: Write the adversarial reviewer prompt

**Files:**
- Create: `lib/ai/prompts/capture-stress-test.md`

- [ ] **Step 1: Create the prompt file**

Create `lib/ai/prompts/capture-stress-test.md` with this content:

```markdown
---
name: capture-stress-test
manning_skills:
  - Assessment Validity Checker (curriculum-assessment)
  - KUD Knowledge Type Mapper (curriculum-assessment)
  - Developmental Band Translator (curriculum-alignment)
includes:
  - shared/depth-scale.md
---

# Role

You are an adversarial reviewer of a Course Outcome Profile that was
just produced by a synthesis agent. Your job is to **find problems** —
not to balance praise. Treat every finding as a hypothesis you should
try to falsify. The faculty reviewer has limited time; concerns you
surface here are what they'll actually scrutinize. Concerns you don't
surface, they probably won't catch.

You do NOT produce a new profile. You do NOT re-synthesize anything.
You read what was produced and emit a structured critique.

# What you have access to

The user message contains:

1. The full Course Outcome Profile JSON the synthesis agent produced.
2. The full transcript of the audit session that produced it (with
   message ids visible so you can verify citations).
3. The same materials digests and catalog context the synthesis agent
   had.

You have the full source of truth. If a finding's citation doesn't
actually support its claim, you can see that. If the rationale says
one thing and the K/U/D scores say another, you can see that. If
audit_notes claims a catalog misalignment that's actually just a
paraphrase difference, you can see that.

# Posture and discipline

**Adversarial, not contrarian.** The right call is sometimes "this
finding is sound." Don't manufacture concerns where there aren't any.
But when you see something doubtful, name it clearly.

**Specific, not vague.** "K=4 seems high" is useless. "K=4 cites only
the design-thinking chunk; the depth scale's K4 requires terminology
use across novel cases — the evidence shows recognition, not active
use" is what faculty can act on.

**Cite back.** When you challenge a finding, point at what you DID see
in the evidence (or didn't see) that drove your concern. Concerns
without grounded reasoning are worse than no concerns.

**Asymmetric on suggested adjustments.** Only emit a `suggested_adjustments`
block when you're confident the score is materially wrong. "Maybe K
should be 3 instead of 4" doesn't merit a suggestion — that's a wash.
"K=4 with no evidence of novel-case use → K=2" is a real suggestion.

# What to look at, per finding

For each competency in `competencies[]`:

1. **Evidence-to-claim ratio.** A D=4 finding with one thin citation is
   suspicious. A K=4 finding cited only by the rationale (no transcript
   or chunk reference) is suspicious. Surface these.

2. **Citation-supports-claim check.** Each citation has an `excerpt`.
   Does the excerpt actually evidence the claim, or is it tangentially
   related? Faculty paraphrase mismatches happen — and a finding
   grounded in tangential evidence is a quality problem.

3. **Internal consistency.** The `rationale` text typically says
   things like "K=3 because students recall the named stages; U=2
   because they only restate the rationale; D=4 because they apply it
   independently." Cross-check: do those reasons actually justify
   those numbers per the depth-scale? Do the dimensions match? (A
   rationale that says "explains rationale" but shows U=1 is
   inconsistent.)

4. **Dimensional patterns the synthesis claims.** If
   `verification_summary.dimensional_patterns` includes "K-high with
   U-low" for a competency, verify that pattern in the actual K/U
   scores. The synthesizer sometimes asserts patterns the data
   doesn't show.

5. **Source flag honesty.** If `source: 'instructor'`, are the
   citations actually instructor citations? If `source: 'inferred'`,
   was the inference reasonable given what's in the transcript?

For the profile as a whole:

1. **`audit_notes.objective_misalignments`** — these are the
   highest-stakes claims (faculty will use them to revise catalog
   objectives). Re-read each one against the catalog text + the
   transcript. Is it a real misalignment, or a paraphrase difference?
   Is the proposed revision an improvement?

2. **`audit_notes.cross_source_conflicts`** — are these actually
   conflicts? Or is the synthesizer drawing artificial contradictions
   between sources that say different things at different granularities?

3. **`verification_summary.catalog_vs_evidence`** — same scrutiny.

4. **`verification_summary.course_shape`** — does the narrative
   actually describe what the evidence supports? Or is it editorial
   over-interpretation?

5. **`verification_summary.foundationals_glance`** — does the
   foundational scoring (D-only) actually match what the evidence
   shows? Agency=D=4 from one quote is generous; flag.

6. **Coverage gaps.** Is there obvious evidence in the transcript or
   materials that the profile didn't capture? Don't propose new
   competencies; just flag the gap.

# Output

A JSON object matching the StressTestResult schema. Per-competency:
one annotation per competency in `competencies[]`, IN THE SAME ORDER
(use `competency_index` to refer back). Profile-level: three concern
lists (catalog_vs_evidence, consistency, coverage). One overall
assessment + a 2-3 sentence summary.

`confidence` levels per competency:
- `high` — finding is well-grounded, citations support the claim,
  scores are consistent with rationale and depth-scale anchors. No
  concerns or minor concerns.
- `medium` — finding is reasonable but has one or more soft spots
  (e.g., one thin citation, mildly inconsistent rationale).
- `low` — finding has material problems (weak evidence, internal
  inconsistency, scores that don't match the depth-scale).
- `disputed` — finding is materially wrong (evidence contradicts the
  claim, scores demonstrably miscalibrated). This is the strongest
  signal and should be rare — reserve it.

Be terse. Each concern is 1-2 sentences of plain prose, no headers.
The faculty member is going to read every word; make them earn their
place.
```

- [ ] **Step 2: Verify it loads via the prompt loader**

The prompt loader resolves prompts by name; verify the new file is reachable. Quick smoke from the project root:

```bash
cd /Users/admin/projects/curriculum_developer
node -e "
const fs = require('fs');
const path = require('path');
const p = path.join(process.cwd(), 'lib/ai/prompts/capture-stress-test.md');
const txt = fs.readFileSync(p, 'utf8');
console.log('length:', txt.length);
console.log('has frontmatter:', txt.startsWith('---'));
console.log('has Role section:', txt.includes('# Role'));
"
```

Expected: length > 2000, both booleans true.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/prompts/capture-stress-test.md
git commit -m "feat(prompt): adversarial reviewer prompt for capture-stress-test

Persona: skeptic. Job is to find problems, not to balance praise.
Discipline rules: cite back what drove the concern; only emit
suggested_adjustments when materially wrong; reserve 'disputed' for
the strongest signal.

Operates on a produced Course Outcome Profile + the synthesis context
(transcript + materials + catalog). Reads, critiques, doesn't
re-synthesize. Output schema lands in the next task."
```

---

## Task 3: Define the StressTestResult schema (Zod + JSON Schema)

**Files:**
- Create: `lib/ai/stress-test/schema.ts`

- [ ] **Step 1: Create the schema file**

Create `lib/ai/stress-test/schema.ts` with this content:

```typescript
import { z } from 'zod';

/**
 * Output of the capture-stress-test reviewer agent. Ephemeral — held
 * in client state, not persisted to the working draft. The reviewer
 * agent emits one annotation per competency in the same order as the
 * profile's `competencies[]` array, plus profile-level concerns and
 * an overall assessment.
 *
 * See lib/ai/prompts/capture-stress-test.md for the persona + the
 * decision rules the reviewer uses to set confidence + suggest
 * adjustments.
 */

export const StressTestConfidence = z.enum(['high', 'medium', 'low', 'disputed']);
export type StressTestConfidenceType = z.infer<typeof StressTestConfidence>;

export const StressTestOverall = z.enum(['sound', 'mixed', 'questionable']);
export type StressTestOverallType = z.infer<typeof StressTestOverall>;

/**
 * Per-competency annotation. competency_index refers to the position
 * in profile.competencies[]; suggested_adjustments is only present
 * when the reviewer thinks scores are materially wrong (not for soft
 * judgement-call differences).
 */
export const StressTestCompetencyAnnotation = z.object({
  competency_index: z.number().int().min(0),
  confidence: StressTestConfidence,
  concerns: z.array(z.string().min(1).max(500)),
  suggested_adjustments: z.object({
    k_depth: z.number().int().min(0).max(5).nullable(),
    u_depth: z.number().int().min(0).max(5).nullable(),
    d_depth: z.number().int().min(0).max(5).nullable(),
  }).nullable(),
});
export type StressTestCompetencyAnnotationType = z.infer<typeof StressTestCompetencyAnnotation>;

/**
 * Profile-level concerns — three buckets the reviewer fills based on
 * its scrutiny of audit_notes + verification_summary + the transcript.
 * Each entry is a single 1-2 sentence concern.
 */
export const StressTestProfileLevel = z.object({
  catalog_vs_evidence_concerns: z.array(z.string().min(1).max(500)),
  consistency_concerns: z.array(z.string().min(1).max(500)),
  coverage_concerns: z.array(z.string().min(1).max(500)),
});
export type StressTestProfileLevelType = z.infer<typeof StressTestProfileLevel>;

export const StressTestResult = z.object({
  per_competency: z.array(StressTestCompetencyAnnotation),
  profile_level: StressTestProfileLevel,
  overall_assessment: StressTestOverall,
  summary: z.string().min(1).max(800),
});
export type StressTestResultType = z.infer<typeof StressTestResult>;

/**
 * OpenAI strict-mode JSON Schema for the reviewer output. The Vercel
 * AI SDK's `Output.object` accepts this. Mirror Zod fields exactly;
 * strict mode requires every `properties` key to also appear in
 * `required`, and nullable union types are encoded as
 * `"type": ["string", "null"]`.
 */
export const stressTestResultJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['per_competency', 'profile_level', 'overall_assessment', 'summary'],
  properties: {
    per_competency: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['competency_index', 'confidence', 'concerns', 'suggested_adjustments'],
        properties: {
          competency_index: { type: 'integer', minimum: 0 },
          confidence: { type: 'string', enum: ['high', 'medium', 'low', 'disputed'] },
          concerns: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 500 } },
          suggested_adjustments: {
            anyOf: [
              { type: 'null' },
              {
                type: 'object',
                additionalProperties: false,
                required: ['k_depth', 'u_depth', 'd_depth'],
                properties: {
                  k_depth: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
                  u_depth: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
                  d_depth: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
                },
              },
            ],
          },
        },
      },
    },
    profile_level: {
      type: 'object',
      additionalProperties: false,
      required: ['catalog_vs_evidence_concerns', 'consistency_concerns', 'coverage_concerns'],
      properties: {
        catalog_vs_evidence_concerns: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 500 } },
        consistency_concerns: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 500 } },
        coverage_concerns: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 500 } },
      },
    },
    overall_assessment: { type: 'string', enum: ['sound', 'mixed', 'questionable'] },
    summary: { type: 'string', minLength: 1, maxLength: 800 },
  },
} as const;
```

- [ ] **Step 2: Write a focused round-trip test**

Create `tests/ai/stress-test-schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { StressTestResult, stressTestResultJsonSchema } from '@/lib/ai/stress-test/schema';

describe('StressTestResult schema', () => {
  it('accepts a minimal valid result', () => {
    const valid = {
      per_competency: [
        {
          competency_index: 0,
          confidence: 'high' as const,
          concerns: [],
          suggested_adjustments: null,
        },
      ],
      profile_level: {
        catalog_vs_evidence_concerns: [],
        consistency_concerns: [],
        coverage_concerns: [],
      },
      overall_assessment: 'sound' as const,
      summary: 'No issues found.',
    };
    expect(() => StressTestResult.parse(valid)).not.toThrow();
  });

  it('accepts a result with suggested adjustments', () => {
    const withAdjust = {
      per_competency: [
        {
          competency_index: 0,
          confidence: 'disputed' as const,
          concerns: ['K=4 cites only one chunk that shows recognition, not active use.'],
          suggested_adjustments: { k_depth: 2, u_depth: null, d_depth: null },
        },
      ],
      profile_level: {
        catalog_vs_evidence_concerns: [],
        consistency_concerns: [],
        coverage_concerns: [],
      },
      overall_assessment: 'mixed' as const,
      summary: 'One competency is materially miscalibrated; others sound.',
    };
    expect(() => StressTestResult.parse(withAdjust)).not.toThrow();
  });

  it('rejects an invalid confidence value', () => {
    const invalid = {
      per_competency: [
        {
          competency_index: 0,
          confidence: 'totally-fine',
          concerns: [],
          suggested_adjustments: null,
        },
      ],
      profile_level: {
        catalog_vs_evidence_concerns: [],
        consistency_concerns: [],
        coverage_concerns: [],
      },
      overall_assessment: 'sound',
      summary: 'OK.',
    };
    expect(() => StressTestResult.parse(invalid)).toThrow();
  });

  it('rejects a missing required field', () => {
    const missingSummary = {
      per_competency: [],
      profile_level: {
        catalog_vs_evidence_concerns: [],
        consistency_concerns: [],
        coverage_concerns: [],
      },
      overall_assessment: 'sound',
      // summary missing
    };
    expect(() => StressTestResult.parse(missingSummary)).toThrow();
  });

  it('JSON schema has every property listed in required (strict-mode invariant)', () => {
    // Recursively walk the JSON schema and assert that every object's
    // `properties` keys all appear in its `required` array. This is the
    // OpenAI strict-mode contract; violating it causes silent failures
    // on the openai provider that the campus/local providers tolerate.
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
    walk(stressTestResultJsonSchema);
  });
});
```

- [ ] **Step 3: Run the tests**

```bash
cd /Users/admin/projects/curriculum_developer
pnpm vitest run tests/ai/stress-test-schema.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 4: Verify typecheck**

```bash
cd /Users/admin/projects/curriculum_developer
npx tsc --noEmit --skipLibCheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/stress-test/schema.ts tests/ai/stress-test-schema.test.ts
git commit -m "feat(stress-test): result schema + JSON schema for strict-mode output

Per-competency annotations (confidence + concerns + optional
suggested_adjustments) + profile-level concerns (catalog_vs_evidence,
consistency, coverage) + overall_assessment + summary.

5 tests, including the strict-mode invariant check that every
JSON-schema property is listed in its required[] — same pattern that
caught the synthesis-prompt provider-flip regression."
```

---

## Task 4: Implement `runStressTest()`

**Files:**
- Create: `lib/ai/stress-test/run.ts`

- [ ] **Step 1: Create the runner**

Create `lib/ai/stress-test/run.ts` with this content:

```typescript
import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import type { CaptureMessageRow } from '@/lib/db/capture-messages-queries';
import type { CaptureChatContext } from '@/lib/ai/analyze/capture-chat';
import { StressTestResult, stressTestResultJsonSchema, type StressTestResultType } from './schema';
import { buildCaptureChatUserMessage } from '@/lib/ai/analyze/capture-chat';

export interface StressTestContext {
  /** The Course Outcome Profile the reviewer is critiquing. */
  profile: CaptureProfile;
  /**
   * Same chatContext the synthesis agent had — gives the reviewer the
   * catalog entry, materials digests, prereq profiles, and any other
   * scope used to produce the profile. Reused via buildCaptureChatUserMessage.
   */
  chatContext: CaptureChatContext;
  /**
   * Full transcript of the audit session that produced the profile.
   * The reviewer cross-checks citations against actual turns.
   */
  transcript: CaptureMessageRow[];
}

export interface StressTestRunResult {
  result: StressTestResultType;
  telemetry: {
    costUsdCents: number;
    durationMs: number;
    cachedTokens: number;
    uncachedPromptTokens: number;
    completionTokens: number;
  };
  model: string;
}

/**
 * Render the transcript for the reviewer in the same shape the
 * synthesizer saw it — every turn carries its 8-char id prefix so the
 * reviewer can verify citation messageIds. Assistant turns are flattened
 * to "Finding: ... / Question: ..." form.
 */
function formatTranscriptForReview(rows: CaptureMessageRow[]): string {
  const lines: string[] = [];
  for (const row of rows) {
    const idShort = row.id.slice(0, 8);
    if (row.role === 'user') {
      lines.push(`USER (turn ${row.turnIndex}, id=${idShort}): ${row.content ?? '(empty)'}`);
      continue;
    }
    if (row.role === 'assistant') {
      let text = row.content ?? '';
      try {
        const parsed = JSON.parse(text) as { finding?: unknown; question?: unknown };
        const finding = typeof parsed.finding === 'string' ? parsed.finding : '';
        const question = typeof parsed.question === 'string' ? parsed.question : '';
        text = [finding && `Finding: ${finding}`, question && `Question: ${question}`].filter(Boolean).join('\n');
      } catch {
        // legacy/non-JSON assistant content — render raw
      }
      lines.push(`ASSISTANT (turn ${row.turnIndex}, id=${idShort}):\n${text}`);
    }
  }
  if (lines.length === 0) return '(no transcript turns recorded)';
  return lines.join('\n\n');
}

/**
 * Build the user message for the reviewer. Includes the chat context
 * block (catalog + materials + digests), the transcript, and the
 * profile JSON the reviewer is critiquing.
 */
function buildStressTestUserMessage(ctx: StressTestContext): string {
  return [
    buildCaptureChatUserMessage(ctx.chatContext),
    '',
    '---',
    '',
    '**Audit transcript (chronological; message ids exposed for citation verification):**',
    '',
    formatTranscriptForReview(ctx.transcript),
    '',
    '---',
    '',
    '**Profile to critique (JSON):**',
    '',
    '```json',
    JSON.stringify(ctx.profile, null, 2),
    '```',
    '',
    '---',
    '',
    'Critique now. Emit the StressTestResult JSON per the schema.',
    'Be terse. Cite back what drove each concern. Only emit',
    'suggested_adjustments when materially wrong. Reserve "disputed" for',
    'the strongest signal.',
  ].join('\n');
}

/**
 * Run the adversarial reviewer over a produced profile + its
 * synthesis context. One LLM call, structured output, returns the
 * critique + telemetry. Cost interlock + provider selection happen
 * inside getProviderForFunction (same as other capture-* functions).
 */
export async function runStressTest(ctx: StressTestContext): Promise<StressTestRunResult> {
  const provider = await getProviderForFunction('capture-stress-test');
  const systemPrompt = await loadPrompt('capture-stress-test');
  const userMessage = buildStressTestUserMessage(ctx);

  const result = await provider.complete<StressTestResultType>({
    systemPrompt,
    userMessage,
    schemaName: 'capture_stress_test_v1',
    jsonSchema: stressTestResultJsonSchema as unknown as object,
    validate: (raw: unknown) => StressTestResult.parse(raw),
  });

  return {
    result: result.data,
    telemetry: {
      costUsdCents: result.costUsdCents,
      durationMs: result.durationMs,
      cachedTokens: result.cachedTokens,
      uncachedPromptTokens: result.uncachedPromptTokens,
      completionTokens: result.completionTokens,
    },
    model: provider.model,
  };
}
```

- [ ] **Step 2: Verify typecheck**

```bash
cd /Users/admin/projects/curriculum_developer
npx tsc --noEmit --skipLibCheck
```

Expected: no errors. (`CaptureChatContext`, `CaptureMessageRow`, and `buildCaptureChatUserMessage` exports must all exist at the import paths used; if any errors point at those, read the actual file and adjust the import — the codebase's actual names trump anything here.)

- [ ] **Step 3: Commit**

```bash
git add lib/ai/stress-test/run.ts
git commit -m "feat(stress-test): runStressTest — one LLM call over profile + transcript

Mirrors the structure of generateCaptureProfileV2 (provider lookup,
prompt load, user-message assembly, strict structured-output call,
telemetry return). The user message includes the catalog/materials
context, the transcript with visible message ids, and the profile to
critique as pretty-printed JSON."
```

---

## Task 5: POST `/api/capture/[code]/stress-test`

**Files:**
- Create: `app/api/capture/[code]/stress-test/route.ts`

- [ ] **Step 1: Create the route**

Create `app/api/capture/[code]/stress-test/route.ts` with this content:

```typescript
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { getCourseProfile } from '@/lib/db/course-profile-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { getCaptureProfileByCourse } from '@/lib/db/course-capture-profiles-queries';
import { getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import { getLatestSessionId, getSessionMessages } from '@/lib/db/capture-messages-queries';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap } from '@/lib/rate-limit/daily-cap';
import { hashIp } from '@/lib/ip-hash';
import { runStressTest } from '@/lib/ai/stress-test/run';
import type { CaptureChatContext } from '@/lib/ai/analyze/capture-chat';

interface RouteContext { params: Promise<{ code: string }> }

const COURSE_CODE_RE = /GC\s+\d{4}[a-z]{0,2}/gi;

function extractPrereqCodes(prerequisites: string, selfCode: string): string[] {
  const codes = (prerequisites.match(COURSE_CODE_RE) ?? [])
    .map(c => c.replace(/\s+/, ' ').toUpperCase().replace(/GC (\d)/, 'GC $1'));
  return Array.from(new Set(codes)).filter(c => c !== selfCode);
}

/**
 * POST /api/capture/[code]/stress-test?slug=...
 * Body: {}  (no client-supplied params; everything loaded server-side)
 * Returns: { result: StressTestResultType, telemetry: {...}, model: string }
 *
 * Loads the latest draft profile + latest session transcript + materials
 * for the course, then calls runStressTest. The output is advisory only —
 * never modifies the working draft.
 */
export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded (ip)' }, { status: 429 });

  const dailyOk = await checkDailyCap();
  if (!dailyOk.ok) return NextResponse.json({ error: 'daily cost cap reached' }, { status: 429 });

  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);

  const course = await getCourseByCode(courseCode);
  if (!course) return NextResponse.json({ error: 'course not found' }, { status: 404 });

  const draft = await getCaptureProfileByCourse(courseCode);
  if (!draft) {
    return NextResponse.json({ error: 'no draft profile to stress-test — generate one first' }, { status: 400 });
  }

  // Reuse the exact chat context the synthesizer had so the reviewer
  // operates on the same scope. Mirrors what /api/capture/[code]/scores
  // assembles before calling generateCaptureProfileV2.
  const [builderProfile, materials] = await Promise.all([
    getCourseProfile(courseCode),
    listMaterialsByCourse(courseCode),
  ]);
  const prereqCodes = extractPrereqCodes(course.prerequisites ?? '', courseCode);
  const prereqProfilesRaw = await Promise.all(
    prereqCodes.map(async code => {
      const c = await getCourseByCode(code);
      if (!c) return null;
      const snapshot = await getLatestSnapshotByCourse(code);
      if (snapshot) {
        return { code: c.code, title: c.title, profile: snapshot.profile, reviewerStatus: `snapshot ${snapshot.caption ?? snapshot.createdAt.toISOString().slice(0, 10)}` };
      }
      const otherDraft = await getCaptureProfileByCourse(code);
      if (otherDraft) {
        return { code: c.code, title: c.title, profile: otherDraft.profile, reviewerStatus: `draft (${otherDraft.reviewerStatus})` };
      }
      return null;
    }),
  );
  const prerequisiteCaptureProfiles = prereqProfilesRaw.flatMap(p => p ? [p] : []);

  const chatContext: CaptureChatContext = {
    course: {
      code: course.code,
      title: course.title,
      description: course.description ?? '',
      prerequisites: course.prerequisites ?? '',
      learningObjectives: (course.learningObjectives ?? []) as string[],
      majorProjects: (course.majorProjects ?? []) as string[],
      skillsRequired: (course.skillsRequired ?? []) as string[],
      builderStatus: course.builderStatus,
    },
    builderProfile: builderProfile
      ? {
          summary: builderProfile.summary,
          learningObjectives: builderProfile.learningObjectives,
          skills: builderProfile.skills,
          competencies: builderProfile.competencies,
        }
      : null,
    materials: materials.map(m => ({
      id: m.id,
      fileName: m.fileName,
      digest: m.digest ?? null,
      extractedText: m.extractedText ?? null,
      ignored: m.ignored,
      useDigest: m.useDigest,
    })),
    prerequisiteCaptureProfiles,
  };

  const sessionId = await getLatestSessionId(courseCode);
  const transcript = sessionId ? await getSessionMessages(courseCode, sessionId) : [];

  try {
    const out = await runStressTest({
      profile: draft.profile,
      chatContext,
      transcript,
    });
    return NextResponse.json({
      result: out.result,
      telemetry: { ...out.telemetry, model: out.model },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'stress-test failed';
    console.error(`POST /api/capture/${courseCode}/stress-test failed:`, message);
    return NextResponse.json({ error: 'stress-test failed', detail: message.slice(0, 500) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify typecheck**

```bash
cd /Users/admin/projects/curriculum_developer
npx tsc --noEmit --skipLibCheck
```

Expected: no errors. (The CaptureChatContext shape may differ slightly from what I wrote — if typecheck flags the `chatContext` literal, read the actual type in `lib/ai/analyze/capture-chat.ts` and align the literal's fields. Don't invent fields the context doesn't expect.)

- [ ] **Step 3: Smoke-test against an existing captured course (GC 1010 has a draft)**

Restart Next.js so the new route compiles, then POST:

```bash
cd /Users/admin/projects/curriculum_developer
launchctl kickstart -k gui/501/com.gc.curriculum-tool >/dev/null 2>&1
sleep 4
BASIC=$(grep '^FACULTY_BASIC_AUTH=' .env.local | cut -d= -f2)
SLUG=$(grep '^PROTOTYPE_SLUG=' .env.local | cut -d= -f2)
curl -sk -u "$BASIC" -X POST \
  "https://admins-mac-studio-2.tailb723c1.ts.net/api/capture/GC%201010/stress-test?slug=$SLUG" \
  -H 'content-type: application/json' \
  --max-time 120 \
  -d '{}' | python3 -c "
import sys, json
d = json.load(sys.stdin)
if 'error' in d:
    print('ERROR:', d['error'], d.get('detail', '')[:200])
else:
    print('per_competency count:', len(d['result']['per_competency']))
    print('overall:', d['result']['overall_assessment'])
    print('summary:', d['result']['summary'][:120])
    print('cost cents:', d['telemetry']['costUsdCents'])
    print('model:', d['telemetry']['model'])
"
```

Expected: a non-error response with `per_competency count > 0`, an overall assessment, a summary, and a cost in cents (probably 5-50).

- [ ] **Step 4: Commit**

```bash
git add 'app/api/capture/[code]/stress-test/route.ts'
git commit -m "feat(api): POST /api/capture/[code]/stress-test endpoint

Slug + IP rate limit + daily cost cap gated. Loads draft profile +
latest session transcript + materials, then calls runStressTest.
Returns advisory annotations + telemetry; never modifies the working
draft. 400 if no draft exists; 500 with a truncated detail on
synthesis failure for debuggability."
```

---

## Task 6: Build the `StressTestPanel` component (button + profile-level concerns)

**Files:**
- Create: `app/capture/[code]/StressTestPanel.tsx`

- [ ] **Step 1: Create the panel**

Create `app/capture/[code]/StressTestPanel.tsx` with this content:

```tsx
'use client';

import { useState } from 'react';
import type { StressTestResultType } from '@/lib/ai/stress-test/schema';

interface Props {
  courseCode: string;
  slug: string;
  /**
   * Called when a stress-test run completes successfully with the new
   * result. Lets the parent (ProfileReviewPanel) thread per-competency
   * annotations down to each row.
   */
  onResult: (result: StressTestResultType | null) => void;
}

/**
 * Stand-alone panel that owns the stress-test button + the profile-level
 * concerns display. Per-competency annotations are rendered by
 * ProfileReviewPanel via the onResult callback (the parent holds the
 * result and threads per-row annotations to <StressTestBadge>).
 *
 * The result is ephemeral — held only in the parent's state, cleared
 * when the user edits the profile (parent clears via onResult(null)).
 */
export function StressTestPanel({ courseCode, slug, onResult }: Props) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StressTestResultType | null>(null);
  const [telemetry, setTelemetry] = useState<{ costUsdCents: number; durationMs: number; model: string } | null>(null);

  async function handleRun() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/capture/${encodeURIComponent(courseCode)}/stress-test?slug=${encodeURIComponent(slug)}`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      );
      const json = await res.json() as { result?: StressTestResultType; telemetry?: { costUsdCents: number; durationMs: number; model: string }; error?: string; detail?: string };
      if (!res.ok || !json.result) {
        setError(json.error ? `${json.error}${json.detail ? ' — ' + json.detail : ''}` : `Stress-test failed (${res.status})`);
        setResult(null);
        onResult(null);
        return;
      }
      setResult(json.result);
      onResult(json.result);
      if (json.telemetry) setTelemetry(json.telemetry);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setResult(null);
      onResult(null);
    } finally {
      setRunning(false);
    }
  }

  const toneByOverall: Record<string, string> = {
    sound: 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-800',
    mixed: 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800',
    questionable: 'bg-red-100 text-red-900 border-red-300 dark:bg-red-900/30 dark:text-red-200 dark:border-red-800',
  };

  return (
    <section className="rounded-md border bg-card px-4 py-3 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Stress-test this profile</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Runs an adversarial reviewer agent over this profile. Heavy-tier
            model; results are advisory and never modify the draft. One click
            ≈ $0.05–0.20.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleRun()}
          disabled={running}
          className="shrink-0 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          {running ? 'Reviewing…' : result ? 'Re-run' : 'Stress-test'}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-200">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-3 space-y-3">
          <div className={`rounded border px-3 py-2 text-xs ${toneByOverall[result.overall_assessment] ?? ''}`}>
            <p className="font-mono-plex text-[10px] uppercase tracking-[0.18em]">
              Overall: {result.overall_assessment}
            </p>
            <p className="mt-1 leading-relaxed">{result.summary}</p>
          </div>

          <ProfileConcernList
            label="Catalog-vs-evidence concerns"
            items={result.profile_level.catalog_vs_evidence_concerns}
          />
          <ProfileConcernList
            label="Consistency concerns"
            items={result.profile_level.consistency_concerns}
          />
          <ProfileConcernList
            label="Coverage concerns"
            items={result.profile_level.coverage_concerns}
          />

          {telemetry && (
            <p className="text-[10px] text-muted-foreground">
              {telemetry.model} · ${(telemetry.costUsdCents / 10000).toFixed(4)} · {(telemetry.durationMs / 1000).toFixed(1)}s
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function ProfileConcernList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) {
    return (
      <div>
        <p className="font-mono-plex text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-xs italic text-muted-foreground">(none surfaced)</p>
      </div>
    );
  }
  return (
    <div>
      <p className="font-mono-plex text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <ul className="mt-0.5 space-y-1">
        {items.map((it, i) => (
          <li key={i} className="text-xs leading-relaxed text-foreground">
            — {it}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

```bash
cd /Users/admin/projects/curriculum_developer
npx tsc --noEmit --skipLibCheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add 'app/capture/[code]/StressTestPanel.tsx'
git commit -m "feat(ui): StressTestPanel — button + profile-level concerns display

Self-contained client component: button triggers the POST, displays
overall + summary + three concern lists (catalog_vs_evidence,
consistency, coverage) when complete. Per-competency annotations are
threaded up via onResult so the parent can render inline badges per
row. Result is ephemeral — never persisted."
```

---

## Task 7: Build the `StressTestBadge` component (per-competency inline)

**Files:**
- Create: `app/capture/[code]/StressTestBadge.tsx`

- [ ] **Step 1: Create the badge**

Create `app/capture/[code]/StressTestBadge.tsx` with this content:

```tsx
'use client';

import type { StressTestCompetencyAnnotationType } from '@/lib/ai/stress-test/schema';

interface Props {
  annotation: StressTestCompetencyAnnotationType | null;
}

/**
 * Per-competency inline reviewer concern. Rendered next to each row in
 * ProfileReviewPanel when a stress-test result is loaded. null when no
 * result yet OR when the reviewer didn't annotate this index (shouldn't
 * happen given the prompt, but render-safe).
 *
 * "high" confidence with no concerns renders nothing — no need to chip
 * the row with "looks fine." Only flags worth surfacing get visible.
 */
const toneByConfidence: Record<string, string> = {
  high: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200',
  medium: 'border-stone-300 bg-stone-50 text-stone-800 dark:border-stone-700 dark:bg-stone-900/20 dark:text-stone-200',
  low: 'border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200',
  disputed: 'border-red-400 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-900/20 dark:text-red-200',
};

export function StressTestBadge({ annotation }: Props) {
  if (!annotation) return null;
  // Pure-positive case: don't chip the row at all.
  if (annotation.confidence === 'high' && annotation.concerns.length === 0) return null;

  const tone = toneByConfidence[annotation.confidence] ?? toneByConfidence.medium;

  return (
    <details className={`mt-1 rounded border px-2 py-1 text-xs ${tone}`}>
      <summary className="cursor-pointer font-medium">
        Reviewer: {annotation.confidence}
        {annotation.suggested_adjustments && (
          <span className="ml-2 font-mono-plex text-[10px] uppercase tracking-[0.14em]">
            suggests adjustment
          </span>
        )}
      </summary>
      {annotation.concerns.length > 0 && (
        <ul className="mt-1 space-y-0.5 pl-4">
          {annotation.concerns.map((c, i) => (
            <li key={i} className="list-disc leading-relaxed">{c}</li>
          ))}
        </ul>
      )}
      {annotation.suggested_adjustments && (
        <p className="mt-1 font-mono-plex text-[10px]">
          Suggested:&nbsp;
          K={annotation.suggested_adjustments.k_depth ?? '—'} ·&nbsp;
          U={annotation.suggested_adjustments.u_depth ?? '—'} ·&nbsp;
          D={annotation.suggested_adjustments.d_depth ?? '—'}
        </p>
      )}
    </details>
  );
}
```

- [ ] **Step 2: Verify typecheck**

```bash
cd /Users/admin/projects/curriculum_developer
npx tsc --noEmit --skipLibCheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add 'app/capture/[code]/StressTestBadge.tsx'
git commit -m "feat(ui): StressTestBadge — per-competency inline reviewer flag

Renders a colored details/summary chip next to each competency row
when a stress-test result is loaded. Confidence drives color
(green/grey/amber/red). 'high' confidence with no concerns renders
nothing — no chrome for the no-issues case. When the reviewer
suggested an adjustment, that's labeled inline."
```

---

## Task 8: Mount `StressTestPanel` + `StressTestBadge` in `ProfileReviewPanel`

**Files:**
- Modify: `app/capture/[code]/ProfileReviewPanel.tsx`

- [ ] **Step 1: Add the import + state**

Open `app/capture/[code]/ProfileReviewPanel.tsx`. Add the imports at the top:

```typescript
import { StressTestPanel } from './StressTestPanel';
import { StressTestBadge } from './StressTestBadge';
import type { StressTestResultType } from '@/lib/ai/stress-test/schema';
```

In the `ProfileReviewPanel` component body, near the other `useState` hooks (right after the existing `editingInstructor`-style state declarations — look for them around line 600-620), add:

```typescript
// Adversarial reviewer result — ephemeral. Cleared whenever the user
// edits the profile (mutating `working` via setWorking), so stale
// annotations don't linger after the underlying scores change.
const [stressTestResult, setStressTestResult] = useState<StressTestResultType | null>(null);
```

- [ ] **Step 2: Clear stress-test results on profile edits**

Find every place in the file that calls `setWorking(...)` to mutate the profile. Most edit handlers do this. Wrap the existing `setWorking` calls so they also clear `stressTestResult`:

Pattern to apply at each `setWorking` call site:

```typescript
// Before:
setWorking({ ...working, ...patch });

// After:
setWorking({ ...working, ...patch });
setStressTestResult(null);
```

Use grep to find all call sites:

```bash
grep -n "setWorking(" app/capture/\[code\]/ProfileReviewPanel.tsx
```

For each match, add `setStressTestResult(null);` on the next line. Don't refactor or change the surrounding logic — just add the clear.

(Rationale: stress-test annotations point at specific score values; once any score changes, the annotation may be stale. Better to clear and require a re-run than to display stale critique.)

- [ ] **Step 3: Mount `<StressTestPanel>`**

Find the JSX block where the DRAFT banner renders (around line 750 in the existing file — look for `'DRAFT — pending your approval'` or `'CAPTURED ✓'`). Immediately AFTER that banner div closes and BEFORE the `<CourseOverview>` block, add:

```tsx
<StressTestPanel
  courseCode={courseCode}
  slug={slug}
  onResult={setStressTestResult}
/>
```

This places the stress-test panel between the status banner and the editable content — high-visibility, but not blocking the user from going straight to the profile.

- [ ] **Step 4: Render `<StressTestBadge>` next to each competency**

Find the competency render loop (search for `working.competencies.map` or similar). Within each rendered competency row, add the badge after the existing row chrome (probably near the K/U/D sliders or the evidence/rationale section):

```tsx
<StressTestBadge
  annotation={stressTestResult?.per_competency.find(a => a.competency_index === index) ?? null}
/>
```

Where `index` is the loop's index variable for the current competency (whatever name the existing code uses — match it).

- [ ] **Step 5: Verify typecheck**

```bash
cd /Users/admin/projects/curriculum_developer
npx tsc --noEmit --skipLibCheck
```

Expected: no errors.

- [ ] **Step 6: Restart Next.js and smoke-test end-to-end in the browser**

```bash
launchctl kickstart -k gui/501/com.gc.curriculum-tool >/dev/null 2>&1
```

Then in Safari, open `https://admins-mac-studio-2.tailb723c1.ts.net/capture/GC%201010?slug=...` (use your actual slug), go to the profile review (generate or back-to-review). You should see:

- A new "Stress-test this profile" panel between the DRAFT banner and the course overview.
- Clicking the button shows "Reviewing…" for ~10-30 seconds, then renders an overall pill + summary + three concern lists.
- Per-competency rows that the reviewer flagged show a small chip below the row with the confidence + concerns.
- High-confidence-no-concerns rows show nothing extra (no clutter).
- Editing any K/U/D slider clears the entire stress-test result (you'd need to re-run).

- [ ] **Step 7: Commit**

```bash
git add 'app/capture/[code]/ProfileReviewPanel.tsx'
git commit -m "feat(ui): mount StressTestPanel + StressTestBadge in ProfileReviewPanel

Panel renders between the DRAFT banner and the course overview;
per-competency badges render inline below each row. Result is held
in ProfileReviewPanel state and cleared whenever any profile edit
fires (so stale critiques don't linger after scores change). High-
confidence-no-concerns rows render no badge — clean by default."
```

---

## Task 9: Update STATE.md

**Files:**
- Modify: `docs/STATE.md`

- [ ] **Step 1: Add a row in the Cross-cutting table**

Open `docs/STATE.md`. Find the Cross-cutting table (the multi-row pipe-delimited table under the "What's live" section). Add this row at the end, before the table's closing whitespace:

```markdown
| **Adversarial stress-test reviewer** (2026-06-03) | On-demand "Stress-test this profile" button on `ProfileReviewPanel`. Runs a separate heavy-tier `capture-stress-test` agent over the produced profile + the synthesis context (transcript + materials + catalog) and returns per-competency annotations (confidence + concerns + optional suggested adjustments) + profile-level concerns (catalog_vs_evidence, consistency, coverage) + overall assessment. Results are ephemeral — never persisted to the working draft, never baked into snapshots, cleared on any profile edit. Per-competency badges render inline; high-confidence-no-concerns rows render nothing (clean by default). ~$0.05–0.20 per stress-test; counts against the daily cap. Files: `lib/ai/prompts/capture-stress-test.md`, `lib/ai/stress-test/{schema,run}.ts`, `app/api/capture/[code]/stress-test/route.ts`, `app/capture/[code]/{StressTestPanel,StressTestBadge}.tsx`. Plan: [`2026-06-03-adversarial-stress-test-agent.md`](./superpowers/plans/2026-06-03-adversarial-stress-test-agent.md). | live | 2026-06-03 |
```

- [ ] **Step 2: Add `capture-stress-test` to the AI function tier table**

Find the AI function tier table (the markdown table that lists each function ID + its default tier). Add this row at the end:

```markdown
| `capture-stress-test` | heavy | Adversarial reviewer over a produced profile; on-demand only |
```

- [ ] **Step 3: Update "Last verified"**

Get the latest commit SHA from the prior task's commit:

```bash
git rev-parse HEAD
```

Update the "Last verified" line near the top of STATE.md to that SHA + today's date.

- [ ] **Step 4: Commit**

```bash
git add docs/STATE.md
git commit -m "docs(state): document the adversarial stress-test reviewer"
```

---

## Self-review checklist

- ✅ Spec coverage: every design point in the Background section has a task — function registration (Task 1), prompt (Task 2), schema (Task 3), runner (Task 4), API route (Task 5), panel UI (Task 6), per-competency badge (Task 7), wiring into ProfileReviewPanel (Task 8), state doc (Task 9).
- ✅ No placeholders — every step has actual code or an exact command.
- ✅ Type consistency — `StressTestResultType`, `StressTestCompetencyAnnotationType`, `StressTestRunResult`, `StressTestContext`, `runStressTest`, `StressTestPanel`, `StressTestBadge`, `capture-stress-test`, `'capture-stress-test'` (the AI function id) are spelled identically everywhere they appear across tasks.
- ✅ Task ordering: schema before runner before route before UI; data path before display layer. Every commit leaves the codebase in a typecheck-clean state.
- ✅ Each commit is independently revertable — a bad UI render doesn't block the data path; a bad prompt is a one-file revert.

---

## What this plan deliberately doesn't do

- **No accept/reject UI on suggested adjustments.** v1 surfaces concerns and lets faculty manually apply changes. "Click to apply this score change" is a real UX win but adds state machinery (apply, undo, conflict with concurrent edits) that's worth a separate increment after we see how often faculty actually want to one-click-apply vs. just read.
- **No persistence of reviewer runs.** Ephemeral keeps the data model simple. If "show me the last reviewer run for this snapshot" becomes a real ask (e.g., for accreditation defensibility), add a `stress_test_runs` table later.
- **No auto-on-generate.** Cost predictability + faculty agency. Easy to flip a config toggle later if usage patterns justify it.
- **No multi-reviewer ensemble or debate.** One heavy-tier pass is sufficient and predictable. Multi-reviewer would catch slightly more but at 2-3× the cost; not justified at the current evidence level.
- **No reviewer-vs-instructor history view.** "What did the reviewer say last time vs. this time" is interesting but requires persistence. Defer.
- **No stress-test on snapshots.** Stress-test operates on the working draft only. Once a snapshot exists, it's immutable; running an adversarial reviewer over an immutable record is a different mental model (audit trail vs. editing aid) and worth its own thought before building.

---

## Cost + telemetry notes for the operator

- Each stress-test ≈ 10-50k input tokens (profile + transcript + materials) + 1-3k output tokens (annotations). At heavy tier (gpt-5.5) that lands around $0.05-0.20 per click. The daily cost panel on `/settings` will reflect it.
- Hitting the daily cap mid-day → button returns 429, error displays inline. Faculty know what's up; recover by raising `DAILY_COST_CAP_USD` in `.env.local`.
- The route logs structured telemetry per call (cost, duration, model, token counts) via the same path as every other AI function. Searchable in `prototype_runs` and the daily aggregator.
