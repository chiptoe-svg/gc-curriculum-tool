# Objective Assessment Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For every captured course with a usable syllabus, build a plain-language guide that tells the instructor which Canvas items show each syllabus objective was met and what class-level numbers to gather, and show it on the public wiki course page; and make a syllabus a required, explicitly flagged material at ingest.

**Architecture:** A new `lib/objective-guide/` module holds pure parsing and checking (Canvas names, verbatim-objective check, drop rules), one strict-schema AI call (`objective-evidence-guide`, default tier) with one corrective retry, and an orchestrator that runs as its own fire-and-forget task after each snapshot. Results live in one row per course in `course_objective_guides`. The wiki course page reads that row at request time and renders it with a deterministic plain-text twin. At ingest, `course_materials.is_syllabus` marks the syllabus, the Canvas importer stops hiding it, and Step 1 of capture cannot be passed without one.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Drizzle ORM on Postgres 17, Zod, Vitest + Testing Library (jsdom).

**Spec:** [`docs/superpowers/specs/2026-10-05-objective-evidence-guide-design.md`](../specs/2026-10-05-objective-evidence-guide-design.md) (owner-approved 2026-10-05). Read it before starting any task.

## Global Constraints

- **AI function:** ID `objective-evidence-guide`, default tier `default`, prompt `lib/ai/prompts/objective-evidence-guide.md`. No new model choices.
- **Strict schema:** every property in every `properties` object is listed in `required`; optional values are nullable unions (`type: ['string', 'null']`); `additionalProperties: false` on every object (CLAUDE.md, OpenAI strict mode).
- **Objectives come only from the syllabus.** The guide quotes them verbatim from the course's syllabus material(s). It never reads `courses.learning_objectives`, and nothing in this plan changes that column or its other uses.
- **Verbatim check:** an objective passes when, after removing leading bullets/numbering from each line and collapsing all whitespace, it appears as a substring of the equally normalised syllabus text. Otherwise exact (case-sensitive).
- **No invented Canvas items:** every `evidence` item (and therefore every `checklist` item, which is derived from evidence) must match an assignment name from a `## ` header of the course's `Canvas: Assignments` text (points and `[unpublished]` suffixes stripped), and a rubric row must be a `- ` line under a `Rubric:` / `Rubric — Title:` header *of that same assignment*. Matching is case- and whitespace-insensitive, otherwise exact. On any miss: one retry naming the misses; then drop, set `measure` to `none` where no evidence remains, and record the drops in `dropped_names`.
- **Usable syllabus (constraint added by the coordinator, not in the spec):** a material is a usable syllabus only if `is_syllabus = true`, `ignored = false`, `retired_at IS NULL`, and `extracted_text` is non-empty. A syllabus that is ignored or set aside (e.g. FERPA auto set-aside, `auto_set_aside = true, ignored = true`) is **never sent to the AI**. Such a course gets no guide, and the wiki section says the syllabus is set aside and should be included on the capture page. A set-aside syllabus that faculty have included (`ignored = false`, `auto_set_aside` still `true`) is usable — `ignored` is the operational "don't send to AI" flag throughout the app.
- **Same rule for assignments:** only `Canvas: Assignments` rows with `ignored = false` and `retired_at IS NULL` are used, with per-item `ignored_items` removed via `filterCanvasBlob` before the text is sent or parsed.
- **Class-level numbers only.** The guide never names or implies an individual student and never asks for one person's grade.
- **Exact copy:** section title `Assessing the course objectives`; measure labels `Clearly measured` / `Partly measured` / `No graded measure yet`; Syllabus-box notice `Add the course syllabus: import it from Canvas or upload it here.`; copy button `Copy as text`.
- **Migration:** `drizzle/0051_objective_guides.sql` is hand-written. Do **not** run `pnpm db:generate` or `pnpm db:migrate`: `drizzle/meta/` is git-ignored and this checkout's journal stops at 0049, so generate would re-emit `access_grants` and migrate would skip 0050/0051. Apply with `psql` only, and only after the owner says go: there is one shared database (`127.0.0.1:5433/gc_curriculum`) and it is production.
- **Tests:** `pnpm vitest run <path>`; typecheck `npx tsc --noEmit -p .`. Every new or changed test is run and seen failing before the code that makes it pass (red proof), and the failure message is checked to be the expected one, not an import error.
- **Branch and commits:** work on `feat/objective-assessment-guide` cut from `dev`. Stage files by explicit path (never `git add -a` / `git add .`). Every commit message ends with these two lines:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01YFqkp83wAJeqVK7QHjRrPm
  ```
- **STATE.md:** update `docs/STATE.md` in the same commit as the AI function ID, the table and migration, the snapshot-route behaviour, the capture Step-1 change, the wiki section, and the backfill (see "What this file tracks" at the bottom of STATE.md).

## File structure

| File | Responsibility |
|---|---|
| `lib/objective-guide/schema.ts` (new) | Zod schemas + strict JSON schema for the model output; stored `ObjectiveGuide` type |
| `lib/objective-guide/canvas-names.ts` (new) | Parse known assignment / rubric-row names from `Canvas: Assignments` text; name matching |
| `lib/objective-guide/check.ts` (new) | Verbatim-objective check, problem listing for the retry, final drop/canonicalise/checklist |
| `lib/objective-guide/generate.ts` (new) | The `objective-evidence-guide` AI call with one corrective retry |
| `lib/objective-guide/inputs.ts` (new) | Pick usable syllabus / assignments text from material rows (pure) |
| `lib/objective-guide/run.ts` (new) | Orchestrator for one snapshot: load, gate, generate, store |
| `lib/objective-guide/render.ts` (new) | `renderGuideText` plain-text rendering + shared labels |
| `lib/ai/prompts/objective-evidence-guide.md` (new) | System prompt |
| `lib/db/objective-guides-queries.ts` (new) | Upsert / read `course_objective_guides` |
| `lib/wiki/objective-guide-section.ts` (new) | Decide what the wiki section shows; DB loader |
| `app/wiki/ObjectiveGuidePanel.tsx`, `app/wiki/CopyGuideButton.tsx` (new) | Wiki section UI |
| `scripts/backfill-objective-guides.ts` (new) | One-time backfill with `--dry-run` |
| `drizzle/0051_objective_guides.sql` (new) | Column, table, one-time `is_syllabus` backfill |
| Modified | `lib/db/schema.ts`, `lib/db/course-materials-queries.ts`, `lib/ai/function-settings.ts`, `lib/ai/prompts/load.ts`, `app/api/capture/[code]/snapshots/route.ts`, `lib/canvas/assemble-canvas-materials.ts` + its 3 callers, `lib/capture/materials-policy.ts`, `app/capture/[code]/HelpPanel.tsx`, `app/api/courses/[code]/materials/route.ts`, `lib/capture/upload-with-progress.ts`, `lib/capture/material-display.ts`, `app/capture/[code]/boxes/SyllabusBox.tsx`, `app/capture/[code]/CaptureMaterialsStep.tsx`, `app/capture/[code]/MaterialsPanel.tsx`, `lib/capture/fetch-course-materials.ts`, `app/api/capture/[code]/context/route.ts`, `app/capture/[code]/page.tsx`, `app/wiki/[type]/[slug]/page.tsx`, `app/globals.css`, `docs/STATE.md` |

---

### Task 1: Guide core — schema, Canvas name parsing, and the check

Pure code, no I/O. Everything later builds on these names and types.

**Files:**
- Create: `lib/objective-guide/schema.ts`
- Create: `lib/objective-guide/canvas-names.ts`
- Create: `lib/objective-guide/check.ts`
- Create: `lib/objective-guide/__tests__/fixtures.ts`
- Test: `lib/objective-guide/__tests__/schema.test.ts`, `lib/objective-guide/__tests__/canvas-names.test.ts`, `lib/objective-guide/__tests__/check.test.ts`

**Interfaces:**
- Consumes: `parseCanvasBlob(text: string): CanvasItem[]` from `lib/canvas/parseCanvasBlob.ts` (existing; `CanvasItem = { title: string; body: string; ordinalIndex: number }`).
- Produces:
  - `schema.ts`: `MEASURES`, `type GuideMeasure = 'clear' | 'partial' | 'none'`, `GuideEvidenceSchema`, `type GuideEvidence = { assignment: string; rubric_row: string | null }`, `ModelGuideSchema`, `type ModelGuide = { intro: string; objectives: Array<{ objective: string; measure: GuideMeasure; evidence: GuideEvidence[]; gather: string; suggestion: string | null }> }`, `ObjectiveGuideSchema`, `type ObjectiveGuide = ModelGuide & { checklist: GuideEvidence[] }`, `modelGuideJsonSchema`.
  - `canvas-names.ts`: `type KnownAssignment = { name: string; rubricRows: string[] }`, `type KnownNames = { assignments: KnownAssignment[] }`, `normalizeName(s: string): string`, `assignmentNameFromTitle(title: string): string`, `rubricRowName(body: string): string`, `parseCanvasAssignmentNames(text: string): KnownNames`, `findAssignment(known: KnownNames, name: string): KnownAssignment | null`, `findRubricRow(a: KnownAssignment, row: string): string | null`.
  - `check.ts`: `stripLeadingMarker(s: string): string`, `normalizeForQuote(s: string): string`, `objectiveInSyllabus(objective: string, syllabusText: string): boolean`, `findGuideProblems(draft: ModelGuide, known: KnownNames, syllabusText: string): string[]`, `finalizeGuide(draft: ModelGuide, known: KnownNames, syllabusText: string): { guide: ObjectiveGuide; dropped: string[] }`. Problem/drop labels are exactly `assignment: <name>`, `rubric row: <row> (under <assignment>)`, `objective: <text>`.

- [ ] **Step 1: Write the shared test fixtures**

`lib/objective-guide/__tests__/fixtures.ts`:

```ts
/** Shared fixtures for the objective-guide tests. Mirrors the exact format
 *  lib/canvas/assemble-canvas-materials.ts writes for `Canvas: Assignments`. */
export const ASSIGNMENTS_TEXT = [
  '## Brand Audit (50 pts)',
  'Analyze an existing brand.',
  '',
  'Rubric — Brand Audit Rubric:',
  '- Research depth (20 pts) — Uses at least three sources',
  '  ratings: 20 pts: Full / 10 pts: Partial',
  '- Strategic rationale (30 pts)',
  '',
  '## Final Brand Playbook (100 pts) [unpublished]',
  'Build a playbook.',
  '- this bullet is description, not a rubric row',
  '',
  'Rubric:',
  '- Visual system — Consistent use of the identity',
  '- Strategic   Rationale (40 pts)',
  '',
  '## Reading Quiz 1',
  'No points listed.',
].join('\n');

export const SYLLABUS_TEXT = [
  'MKT 4320 Brand Management — Fall 2026',
  'COURSE LEARNING OBJECTIVES',
  'By the end of this course, students will be able to:',
  '• Develop a brand strategy grounded in audience research.',
  '• Build a visual identity system',
  '  that holds across media.',
  '3. Present a strategic rationale to a client.',
].join('\n');
```

- [ ] **Step 2: Write the failing tests**

`lib/objective-guide/__tests__/schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { modelGuideJsonSchema, ModelGuideSchema, ObjectiveGuideSchema } from '../schema';

// Invariant (OpenAI strict mode, CLAUDE.md): every key in `properties` is in
// `required`, and every object node forbids additional properties.
function assertStrictMode(node: unknown, path = '$'): void {
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (obj.type === 'object') {
    expect(obj.additionalProperties, `${path}: additionalProperties must be false`).toBe(false);
    const props = (obj.properties ?? {}) as Record<string, unknown>;
    const required = (obj.required as string[] | undefined) ?? [];
    for (const key of Object.keys(props)) {
      expect(required, `${path}.${key} must appear in required`).toContain(key);
      assertStrictMode(props[key], `${path}.${key}`);
    }
  }
  if (obj.items) assertStrictMode(obj.items, `${path}[]`);
}

describe('modelGuideJsonSchema', () => {
  it('passes the strict-mode walker', () => {
    assertStrictMode(modelGuideJsonSchema);
  });

  it('encodes the optional fields as nullable unions', () => {
    const objective = modelGuideJsonSchema.properties.objectives.items;
    expect(objective.properties.suggestion.type).toEqual(['string', 'null']);
    expect(objective.properties.evidence.items.properties.rubric_row.type).toEqual(['string', 'null']);
  });
});

describe('ModelGuideSchema / ObjectiveGuideSchema', () => {
  const valid = {
    intro: 'Intro.',
    objectives: [
      { objective: 'O', measure: 'partial', evidence: [{ assignment: 'A', rubric_row: null }], gather: 'G', suggestion: 'S' },
    ],
  };

  it('accepts a valid model guide', () => {
    expect(() => ModelGuideSchema.parse(valid)).not.toThrow();
  });

  it('rejects an unknown measure', () => {
    const bad = { ...valid, objectives: [{ ...valid.objectives[0], measure: 'mostly' }] };
    expect(() => ModelGuideSchema.parse(bad)).toThrow();
  });

  it('the stored guide adds a checklist', () => {
    expect(() => ObjectiveGuideSchema.parse({ ...valid, checklist: [{ assignment: 'A', rubric_row: null }] })).not.toThrow();
    expect(() => ObjectiveGuideSchema.parse(valid)).toThrow();
  });
});
```

`lib/objective-guide/__tests__/canvas-names.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  parseCanvasAssignmentNames, assignmentNameFromTitle, rubricRowName,
  findAssignment, findRubricRow, normalizeName,
} from '../canvas-names';
import { ASSIGNMENTS_TEXT } from './fixtures';

describe('assignmentNameFromTitle', () => {
  it('strips the points and [unpublished] suffixes', () => {
    expect(assignmentNameFromTitle('Final Brand Playbook (100 pts) [unpublished]')).toBe('Final Brand Playbook');
    expect(assignmentNameFromTitle('Brand Audit (50 pts)')).toBe('Brand Audit');
    expect(assignmentNameFromTitle('Lab 2 (2.5 pts)')).toBe('Lab 2');
    expect(assignmentNameFromTitle('Reading Quiz 1')).toBe('Reading Quiz 1');
  });
});

describe('rubricRowName', () => {
  it('takes the criterion before the points label', () => {
    expect(rubricRowName('Research depth (20 pts) — Uses at least three sources')).toBe('Research depth');
  });
  it('takes the criterion before the long description when there are no points', () => {
    expect(rubricRowName('Visual system — Consistent use of the identity')).toBe('Visual system');
  });
  it('returns the whole text when there is neither', () => {
    expect(rubricRowName('Craft')).toBe('Craft');
  });
});

describe('parseCanvasAssignmentNames', () => {
  it('lists every assignment with only the rubric rows under its own Rubric header', () => {
    expect(parseCanvasAssignmentNames(ASSIGNMENTS_TEXT)).toEqual({
      assignments: [
        { name: 'Brand Audit', rubricRows: ['Research depth', 'Strategic rationale'] },
        { name: 'Final Brand Playbook', rubricRows: ['Visual system', 'Strategic   Rationale'] },
        { name: 'Reading Quiz 1', rubricRows: [] },
      ],
    });
  });

  it('merges two assignments that share a name', () => {
    const text = '## Lab (5 pts)\nRubric:\n- Setup (5 pts)\n\n## Lab (5 pts) [unpublished]\nRubric:\n- Cleanup (5 pts)';
    expect(parseCanvasAssignmentNames(text).assignments).toEqual([{ name: 'Lab', rubricRows: ['Setup', 'Cleanup'] }]);
  });

  it('returns no assignments for empty text', () => {
    expect(parseCanvasAssignmentNames('')).toEqual({ assignments: [] });
  });
});

describe('matching', () => {
  const known = parseCanvasAssignmentNames(ASSIGNMENTS_TEXT);

  it('normalizeName folds case and whitespace only', () => {
    expect(normalizeName('  Strategic   RATIONALE ')).toBe('strategic rationale');
  });

  it('finds assignments case- and whitespace-insensitively', () => {
    expect(findAssignment(known, 'final  brand playbook')?.name).toBe('Final Brand Playbook');
    expect(findAssignment(known, 'Final Brand Playbooks')).toBeNull();
  });

  it('finds a rubric row only under its own assignment', () => {
    const audit = findAssignment(known, 'Brand Audit')!;
    const playbook = findAssignment(known, 'Final Brand Playbook')!;
    expect(findRubricRow(playbook, 'strategic rationale')).toBe('Strategic   Rationale');
    expect(findRubricRow(audit, 'Visual system')).toBeNull();
  });
});
```

`lib/objective-guide/__tests__/check.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { objectiveInSyllabus, normalizeForQuote, findGuideProblems, finalizeGuide } from '../check';
import { parseCanvasAssignmentNames } from '../canvas-names';
import type { ModelGuide } from '../schema';
import { ASSIGNMENTS_TEXT, SYLLABUS_TEXT } from './fixtures';

const known = parseCanvasAssignmentNames(ASSIGNMENTS_TEXT);

describe('objectiveInSyllabus', () => {
  it('ignores bullets, numbering and line wrapping', () => {
    expect(objectiveInSyllabus('Develop a brand strategy grounded in audience research.', SYLLABUS_TEXT)).toBe(true);
    expect(objectiveInSyllabus('Build a visual identity system that holds across media.', SYLLABUS_TEXT)).toBe(true);
    expect(objectiveInSyllabus('Present a strategic rationale to a client.', SYLLABUS_TEXT)).toBe(true);
    expect(objectiveInSyllabus('•  Develop a brand   strategy grounded in audience research.', SYLLABUS_TEXT)).toBe(true);
  });

  it('rejects paraphrase, other casing and text that is not there', () => {
    expect(objectiveInSyllabus('Develop a brand strategy based on audience research.', SYLLABUS_TEXT)).toBe(false);
    expect(objectiveInSyllabus('develop a brand strategy grounded in audience research.', SYLLABUS_TEXT)).toBe(false);
    expect(objectiveInSyllabus('Measure brand equity over time.', SYLLABUS_TEXT)).toBe(false);
    expect(objectiveInSyllabus('   ', SYLLABUS_TEXT)).toBe(false);
  });

  it('normalizeForQuote joins wrapped lines with single spaces', () => {
    expect(normalizeForQuote('• Build a visual identity system\n  that holds across media.')).toBe('Build a visual identity system that holds across media.');
  });
});

const DRAFT: ModelGuide = {
  intro: '  Intro.  ',
  objectives: [
    { objective: 'Develop a brand strategy grounded in audience research.', measure: 'clear', evidence: [{ assignment: 'brand  audit', rubric_row: 'RESEARCH DEPTH' }], gather: 'g1', suggestion: null },
    { objective: 'Build a visual identity system that holds across media.', measure: 'partial', evidence: [{ assignment: 'Brand Audit', rubric_row: 'Visual system' }, { assignment: 'Capstone Pitch', rubric_row: null }], gather: 'g2', suggestion: 's2' },
    { objective: 'Measure brand equity over time.', measure: 'none', evidence: [], gather: 'g3', suggestion: 's3' },
  ],
};

describe('findGuideProblems', () => {
  it('lists unknown assignments, rubric rows under the wrong assignment, and unquoted objectives', () => {
    expect(findGuideProblems(DRAFT, known, SYLLABUS_TEXT)).toEqual([
      'rubric row: Visual system (under Brand Audit)',
      'assignment: Capstone Pitch',
      'objective: Measure brand equity over time.',
    ]);
  });

  it('returns nothing for a clean draft', () => {
    expect(findGuideProblems({ intro: 'x', objectives: [DRAFT.objectives[0]!] }, known, SYLLABUS_TEXT)).toEqual([]);
  });
});

describe('finalizeGuide', () => {
  it('drops unmatched items, canonicalises names, downgrades to none and records the drops', () => {
    const { guide, dropped } = finalizeGuide(DRAFT, known, SYLLABUS_TEXT);
    expect(guide).toEqual({
      intro: 'Intro.',
      objectives: [
        { objective: 'Develop a brand strategy grounded in audience research.', measure: 'clear', evidence: [{ assignment: 'Brand Audit', rubric_row: 'Research depth' }], gather: 'g1', suggestion: null },
        { objective: 'Build a visual identity system that holds across media.', measure: 'none', evidence: [], gather: 'g2', suggestion: 's2' },
      ],
      checklist: [{ assignment: 'Brand Audit', rubric_row: 'Research depth' }],
    });
    expect(dropped).toEqual([
      'rubric row: Visual system (under Brand Audit)',
      'assignment: Capstone Pitch',
      'objective: Measure brand equity over time.',
    ]);
  });

  it('dedups evidence, keeps at most three, clears the suggestion when clear, and dedups the checklist across objectives', () => {
    const draft: ModelGuide = {
      intro: 'x',
      objectives: [
        {
          objective: 'Develop a brand strategy grounded in audience research.', measure: 'clear', gather: 'g', suggestion: 'should vanish',
          evidence: [
            { assignment: 'Brand Audit', rubric_row: 'Research depth' },
            { assignment: 'brand audit', rubric_row: 'research depth' },
            { assignment: 'Final Brand Playbook', rubric_row: null },
            { assignment: 'Reading Quiz 1', rubric_row: null },
            { assignment: 'Brand Audit', rubric_row: 'Strategic rationale' },
          ],
        },
        {
          objective: '• Present a strategic rationale to a client.', measure: 'partial', gather: 'g', suggestion: 's',
          evidence: [{ assignment: 'Final Brand Playbook', rubric_row: 'strategic rationale' }, { assignment: 'Brand Audit', rubric_row: 'Research depth' }],
        },
      ],
    };
    const { guide, dropped } = finalizeGuide(draft, known, SYLLABUS_TEXT);
    expect(dropped).toEqual([]);
    expect(guide.objectives[0]).toEqual({
      objective: 'Develop a brand strategy grounded in audience research.', measure: 'clear', gather: 'g', suggestion: null,
      evidence: [
        { assignment: 'Brand Audit', rubric_row: 'Research depth' },
        { assignment: 'Final Brand Playbook', rubric_row: null },
        { assignment: 'Reading Quiz 1', rubric_row: null },
      ],
    });
    expect(guide.objectives[1]!.objective).toBe('Present a strategic rationale to a client.');
    expect(guide.checklist).toEqual([
      { assignment: 'Brand Audit', rubric_row: 'Research depth' },
      { assignment: 'Final Brand Playbook', rubric_row: null },
      { assignment: 'Reading Quiz 1', rubric_row: null },
      { assignment: 'Final Brand Playbook', rubric_row: 'Strategic   Rationale' },
    ]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run lib/objective-guide/__tests__`
Expected: FAIL — `Failed to resolve import "../schema"` (and `../canvas-names`, `../check`).

- [ ] **Step 4: Write `lib/objective-guide/schema.ts`**

```ts
import { z } from 'zod';

/**
 * Objective assessment guide (spec 2026-10-05). `ModelGuide` is what the
 * `objective-evidence-guide` model returns; `ObjectiveGuide` is what is stored
 * after the deterministic check — it adds a checklist derived from the
 * surviving evidence (never from the model), so the checklist can only name
 * items that already passed the Canvas name check.
 */
export const MEASURES = ['clear', 'partial', 'none'] as const;
export type GuideMeasure = (typeof MEASURES)[number];

export const GuideEvidenceSchema = z.object({
  assignment: z.string().min(1),
  rubric_row: z.string().min(1).nullable(),
});
export type GuideEvidence = z.infer<typeof GuideEvidenceSchema>;

const ModelObjectiveSchema = z.object({
  objective: z.string().min(1),
  measure: z.enum(MEASURES),
  evidence: z.array(GuideEvidenceSchema),
  gather: z.string().min(1),
  suggestion: z.string().min(1).nullable(),
});

export const ModelGuideSchema = z.object({
  intro: z.string().min(1),
  objectives: z.array(ModelObjectiveSchema),
});
export type ModelGuide = z.infer<typeof ModelGuideSchema>;

export const ObjectiveGuideSchema = ModelGuideSchema.extend({
  checklist: z.array(GuideEvidenceSchema),
});
export type ObjectiveGuide = z.infer<typeof ObjectiveGuideSchema>;

// Strict-mode JSON schema: every property required, optional values are
// nullable unions, no additional properties anywhere (CLAUDE.md).
const evidenceJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['assignment', 'rubric_row'],
  properties: {
    assignment: { type: 'string' },
    rubric_row: { type: ['string', 'null'] },
  },
} as const;

export const modelGuideJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['intro', 'objectives'],
  properties: {
    intro: { type: 'string' },
    objectives: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['objective', 'measure', 'evidence', 'gather', 'suggestion'],
        properties: {
          objective: { type: 'string' },
          measure: { type: 'string', enum: ['clear', 'partial', 'none'] },
          evidence: { type: 'array', items: evidenceJsonSchema },
          gather: { type: 'string' },
          suggestion: { type: ['string', 'null'] },
        },
      },
    },
  },
} as const;
```

- [ ] **Step 5: Write `lib/objective-guide/canvas-names.ts`**

```ts
import { parseCanvasBlob } from '@/lib/canvas/parseCanvasBlob';

/**
 * The names the guide may use, parsed from the course's `Canvas: Assignments`
 * text exactly as lib/canvas/assemble-canvas-materials.ts writes it:
 *   ## Name (N pts) [unpublished]
 *   <description>
 *   Rubric — Title:        (or "Rubric:")
 *   - Criterion (N pts) — long description
 *     ratings: ...
 */
export interface KnownAssignment { name: string; rubricRows: string[] }
export interface KnownNames { assignments: KnownAssignment[] }

const UNPUBLISHED_SUFFIX = /\s*\[unpublished\]\s*$/;
const POINTS_SUFFIX = /\s*\(-?\d+(?:\.\d+)?\s*pts\)\s*$/;
const RUBRIC_HEADER = /^Rubric(?: — .*)?:\s*$/;
const ROW_WITH_POINTS = /^(.*?)\s\(-?\d+(?:\.\d+)?\s*pts\)(?:\s—\s[\s\S]*)?$/;

/** Case- and whitespace-insensitive key; exact otherwise. */
export function normalizeName(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function assignmentNameFromTitle(title: string): string {
  return title.replace(UNPUBLISHED_SUFFIX, '').replace(POINTS_SUFFIX, '').trim();
}

/** `body` is a rubric line without its leading "- ". */
export function rubricRowName(body: string): string {
  const m = ROW_WITH_POINTS.exec(body);
  if (m && m[1]) return m[1].trim();
  const dash = body.indexOf(' — ');
  return (dash >= 0 ? body.slice(0, dash) : body).trim();
}

export function parseCanvasAssignmentNames(text: string): KnownNames {
  const assignments: KnownAssignment[] = [];
  for (const item of parseCanvasBlob(text)) {
    const name = assignmentNameFromTitle(item.title);
    if (!name) continue;
    const rubricRows: string[] = [];
    let inRubric = false;
    for (const raw of item.body.split('\n')) {
      const line = raw.trimEnd();
      if (RUBRIC_HEADER.test(line.trim())) { inRubric = true; continue; }
      if (inRubric && line.startsWith('- ')) {
        const row = rubricRowName(line.slice(2));
        if (row) rubricRows.push(row);
      }
    }
    const existing = assignments.find((a) => normalizeName(a.name) === normalizeName(name));
    if (existing) existing.rubricRows.push(...rubricRows);
    else assignments.push({ name, rubricRows });
  }
  return { assignments };
}

export function findAssignment(known: KnownNames, name: string): KnownAssignment | null {
  const key = normalizeName(name);
  return known.assignments.find((a) => normalizeName(a.name) === key) ?? null;
}

export function findRubricRow(assignment: KnownAssignment, row: string): string | null {
  const key = normalizeName(row);
  return assignment.rubricRows.find((r) => normalizeName(r) === key) ?? null;
}
```

- [ ] **Step 6: Write `lib/objective-guide/check.ts`**

```ts
import { normalizeName, findAssignment, findRubricRow, type KnownNames } from './canvas-names';
import type { GuideEvidence, ModelGuide, ObjectiveGuide } from './schema';

// A leading bullet glyph, "1." / "1)" / "(1)" numbering, or "a." / "a)" lettering.
const LEADING_MARKER = /^\s*(?:[•●▪◦·*–—-]|\(?\d{1,2}[.)]|\(?[a-zA-Z][.)])\s+/;

export function stripLeadingMarker(s: string): string {
  return s.replace(LEADING_MARKER, '').trim();
}

/** Bullet- and whitespace-insensitive form used for the verbatim check. */
export function normalizeForQuote(s: string): string {
  return s
    .split(/\r?\n/)
    .map((line) => line.replace(LEADING_MARKER, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function objectiveInSyllabus(objective: string, syllabusText: string): boolean {
  const needle = normalizeForQuote(objective);
  if (needle.length === 0) return false;
  return normalizeForQuote(syllabusText).includes(needle);
}

const objectiveLabel = (objective: string) => `objective: ${objective}`;

type Resolved = { ok: true; evidence: GuideEvidence } | { ok: false; label: string };

function resolveEvidence(e: GuideEvidence, known: KnownNames): Resolved {
  const assignment = findAssignment(known, e.assignment);
  if (!assignment) return { ok: false, label: `assignment: ${e.assignment}` };
  if (e.rubric_row === null) return { ok: true, evidence: { assignment: assignment.name, rubric_row: null } };
  const row = findRubricRow(assignment, e.rubric_row);
  if (!row) return { ok: false, label: `rubric row: ${e.rubric_row} (under ${e.assignment})` };
  return { ok: true, evidence: { assignment: assignment.name, rubric_row: row } };
}

/** Everything the retry must fix, in reading order, deduplicated. */
export function findGuideProblems(draft: ModelGuide, known: KnownNames, syllabusText: string): string[] {
  const problems = new Set<string>();
  for (const o of draft.objectives) {
    if (!objectiveInSyllabus(o.objective, syllabusText)) problems.add(objectiveLabel(o.objective));
    for (const e of o.evidence) {
      const r = resolveEvidence(e, known);
      if (!r.ok) problems.add(r.label);
    }
  }
  return [...problems];
}

const evidenceKey = (e: GuideEvidence) =>
  `${normalizeName(e.assignment)}\u0000${e.rubric_row === null ? '' : normalizeName(e.rubric_row)}`;

/**
 * The firm rule: the stored guide names only Canvas items that exist and only
 * objectives the syllabus states. Unmatched items are dropped (and recorded);
 * an objective left with no evidence becomes `none`; names take their Canvas
 * spelling; the checklist is derived from the surviving evidence.
 */
export function finalizeGuide(
  draft: ModelGuide,
  known: KnownNames,
  syllabusText: string,
): { guide: ObjectiveGuide; dropped: string[] } {
  const dropped = new Set<string>();
  const objectives: ObjectiveGuide['objectives'] = [];

  for (const o of draft.objectives) {
    if (!objectiveInSyllabus(o.objective, syllabusText)) {
      dropped.add(objectiveLabel(o.objective));
      continue;
    }
    const seen = new Set<string>();
    const evidence: GuideEvidence[] = [];
    for (const e of o.evidence) {
      const r = resolveEvidence(e, known);
      if (!r.ok) { dropped.add(r.label); continue; }
      const key = evidenceKey(r.evidence);
      if (seen.has(key)) continue;
      seen.add(key);
      evidence.push(r.evidence);
    }
    const kept = evidence.slice(0, 3);
    const measure = kept.length === 0 ? 'none' : o.measure;
    objectives.push({
      objective: stripLeadingMarker(o.objective),
      measure,
      evidence: kept,
      gather: o.gather.trim(),
      suggestion: measure === 'clear' ? null : (o.suggestion?.trim() || null),
    });
  }

  const checklist: GuideEvidence[] = [];
  const seenAll = new Set<string>();
  for (const o of objectives) {
    for (const e of o.evidence) {
      const key = evidenceKey(e);
      if (seenAll.has(key)) continue;
      seenAll.add(key);
      checklist.push(e);
    }
  }

  return { guide: { intro: draft.intro.trim(), objectives, checklist }, dropped: [...dropped] };
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm vitest run lib/objective-guide/__tests__`
Expected: PASS (all three files).

- [ ] **Step 8: Typecheck and commit**

Run: `npx tsc --noEmit -p .` — Expected: no errors.

```bash
git add lib/objective-guide/schema.ts lib/objective-guide/canvas-names.ts lib/objective-guide/check.ts \
  lib/objective-guide/__tests__/fixtures.ts lib/objective-guide/__tests__/schema.test.ts \
  lib/objective-guide/__tests__/canvas-names.test.ts lib/objective-guide/__tests__/check.test.ts
git commit -m "feat(objective-guide): guide schema, Canvas name parsing, and the no-invented-names check" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YFqkp83wAJeqVK7QHjRrPm"
```

---

### Task 2: Storage — migration 0051, `is_syllabus`, and guide queries

**Files:**
- Create: `drizzle/0051_objective_guides.sql`
- Modify: `lib/db/schema.ts` (courseMaterials — add `isSyllabus`; add `courseObjectiveGuides` after `courseCaptureSnapshots`)
- Modify: `lib/db/course-materials-queries.ts` (mapper, `InsertMaterialInput`, `insertMaterial`, new `isSyllabusInsert`, new `listSyllabusMaterials`)
- Create: `lib/db/objective-guides-queries.ts`
- Test: `lib/db/__tests__/course-materials-queries.test.ts` (extend)
- Modify: `docs/STATE.md`

**Interfaces:**
- Consumes: `ObjectiveGuide` from `lib/objective-guide/schema.ts` (Task 1).
- Produces:
  - `courseMaterials.isSyllabus` (`boolean`, not null, default false) → `CourseMaterialRow.isSyllabus: boolean`.
  - `courseObjectiveGuides` table.
  - `InsertMaterialInput.isSyllabus?: boolean`; `isSyllabusInsert(input: Pick<InsertMaterialInput, 'fileName' | 'isSyllabus'>): boolean` (explicit flag wins; otherwise true only for `fileName === 'Canvas: Syllabus'`).
  - `listSyllabusMaterials(courseCode: string): Promise<CourseMaterialRow[]>`.
  - `upsertObjectiveGuide(input: { courseCode: string; snapshotId: string; guide: ObjectiveGuide; droppedNames: string[]; model: string }): Promise<void>`.
  - `getObjectiveGuide(courseCode: string): Promise<StoredObjectiveGuide | null>` where `StoredObjectiveGuide = { courseCode: string; snapshotId: string; guide: ObjectiveGuide; droppedNames: string[]; model: string; generatedAt: Date; snapshotCreatedAt: Date | null }`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/db/__tests__/course-materials-queries.test.ts`. First change its import line to:

```ts
import { buildIndexableMaterialsWhere, __mapMaterialRowForTest, isSyllabusInsert } from '@/lib/db/course-materials-queries';
```

Then add at the end of the file:

```ts
describe('mapMaterialRow — is_syllabus', () => {
  const base = {
    id: 'a', course_code: 'GC 1010', file_name: 'f', blob_url: 'u', mime_type: 'application/pdf',
    size_bytes: 1, page_count: null, extraction_method: null, extraction_status: 'pending',
    extracted_text: null, analysis_finding: null, analysis_model: null, analysis_cost_usd_cents: null,
    uploaded_at: new Date(), ip_hash: 'h', digest: null, digest_model: null, digest_generated_at: null,
    use_digest: false, ferpa_risk: 'low', auto_set_aside: false, set_aside_reason: null,
    indexing_status: 'queued', tier: null, indexed_at: null, ignored: false, ignored_items: null,
    source_code: null, raw_cleared: false, retired_at: null, ingest_provider: null,
  };
  it('maps is_syllabus, defaulting a missing value to false', () => {
    expect(__mapMaterialRowForTest({ ...base, is_syllabus: true }).isSyllabus).toBe(true);
    expect(__mapMaterialRowForTest({ ...base, is_syllabus: false }).isSyllabus).toBe(false);
    expect(__mapMaterialRowForTest(base).isSyllabus).toBe(false);
  });
});

describe('isSyllabusInsert', () => {
  it('flags the Canvas syllabus page by default', () => {
    expect(isSyllabusInsert({ fileName: 'Canvas: Syllabus' })).toBe(true);
    expect(isSyllabusInsert({ fileName: 'Canvas: Assignments' })).toBe(false);
    expect(isSyllabusInsert({ fileName: 'my syllabus.pdf' })).toBe(false);
  });
  it('an explicit flag wins', () => {
    expect(isSyllabusInsert({ fileName: 'notes.pdf', isSyllabus: true })).toBe(true);
    expect(isSyllabusInsert({ fileName: 'Canvas: Syllabus', isSyllabus: false })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run lib/db/__tests__/course-materials-queries.test.ts`
Expected: FAIL — `isSyllabusInsert is not a function` and `expected undefined to be true` for `isSyllabus`.

- [ ] **Step 3: Write the migration `drizzle/0051_objective_guides.sql`**

```sql
-- 0051 — objective assessment guides (spec 2026-10-05).
-- HAND-WRITTEN, applied with psql: drizzle/meta is git-ignored and this
-- checkout's journal stops at 0049, so drizzle-kit generate/migrate are unsafe
-- here (see docs/STATE.md Deferred / debt). Idempotent; safe to re-run.
ALTER TABLE "course_materials" ADD COLUMN IF NOT EXISTS "is_syllabus" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "course_objective_guides" (
	"course_code" text PRIMARY KEY NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"guide" jsonb NOT NULL,
	"dropped_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_objective_guides_course_code_courses_code_fk" FOREIGN KEY ("course_code") REFERENCES "public"."courses"("code") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "course_objective_guides_snapshot_id_course_capture_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."course_capture_snapshots"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
-- One-time flag backfill: the Canvas syllabus page, and any material whose
-- name contains "syllabus" (case-insensitive).
UPDATE "course_materials" SET "is_syllabus" = true
WHERE "is_syllabus" = false
  AND ("file_name" = 'Canvas: Syllabus' OR "file_name" ILIKE '%syllabus%');
```

- [ ] **Step 4: Update `lib/db/schema.ts`**

Add the type import at the top, after the existing `import type { ReconciliationLogEntry } ...` line:

```ts
import type { ObjectiveGuide } from '@/lib/objective-guide/schema';
```

In `courseMaterials`, add after the `ingestProvider: text('ingest_provider'),` line (the last column):

```ts
  // True when this material is the course syllabus — the sole source of the
  // objectives quoted by the objective assessment guide (spec 2026-10-05).
  // Set by the Canvas import for `Canvas: Syllabus`, by uploads through the
  // Syllabus box (role=syllabus), and once by migration 0051's backfill.
  isSyllabus: boolean('is_syllabus').notNull().default(false),
```

Directly after the closing `});` of `courseCaptureSnapshots`, add:

```ts
// Objective assessment guide (spec 2026-10-05): one row per course, the latest
// guide only — overwritten on regeneration; history lives in the snapshots it
// is built from. Migration 0051 (hand-written).
export const courseObjectiveGuides = pgTable('course_objective_guides', {
  courseCode: text('course_code').primaryKey().references(() => courses.code, { onDelete: 'cascade' }),
  snapshotId: uuid('snapshot_id').notNull().references(() => courseCaptureSnapshots.id, { onDelete: 'cascade' }),
  guide: jsonb('guide').$type<ObjectiveGuide>().notNull(),
  droppedNames: jsonb('dropped_names').$type<string[]>().notNull().default([]),
  model: text('model').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 5: Update `lib/db/course-materials-queries.ts`**

In `mapMaterialRow`, after `ingestProvider: row['ingest_provider'] as string | null,` add:

```ts
    isSyllabus: (row['is_syllabus'] as boolean | null | undefined) ?? false,
```

Replace the `InsertMaterialInput` interface and `insertMaterial` function with:

```ts
export interface InsertMaterialInput {
  courseCode: string;
  fileName: string;
  blobUrl: string;
  mimeType: string;
  sizeBytes: number;
  ipHash: string;
  sourceCode?: string | null;
  /** Explicit syllabus flag (Syllabus-box uploads). Omitted ⇒ derived by isSyllabusInsert. */
  isSyllabus?: boolean;
}

/** The syllabus flag a new row gets: an explicit flag wins; otherwise only the
 *  Canvas syllabus page (written by every Canvas/IMSCC importer) is flagged. */
export function isSyllabusInsert(input: Pick<InsertMaterialInput, 'fileName' | 'isSyllabus'>): boolean {
  return input.isSyllabus ?? input.fileName === 'Canvas: Syllabus';
}

export async function insertMaterial(input: InsertMaterialInput): Promise<CourseMaterialRow> {
  const [row] = await db
    .insert(courseMaterials)
    .values({ ...input, isSyllabus: isSyllabusInsert(input), extractionStatus: 'pending' })
    .returning();
  if (!row) throw new Error('insertMaterial: no row returned');
  return row;
}
```

After `listMaterialsByCourse`, add:

```ts
/** Every material flagged as the course syllabus (any state), oldest first. */
export async function listSyllabusMaterials(courseCode: string): Promise<CourseMaterialRow[]> {
  return db
    .select()
    .from(courseMaterials)
    .where(and(eq(courseMaterials.courseCode, courseCode), eq(courseMaterials.isSyllabus, true)))
    .orderBy(asc(courseMaterials.uploadedAt));
}
```

- [ ] **Step 6: Create `lib/db/objective-guides-queries.ts`**

```ts
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseObjectiveGuides, courseCaptureSnapshots } from '@/lib/db/schema';
import type { ObjectiveGuide } from '@/lib/objective-guide/schema';

export interface StoredObjectiveGuide {
  courseCode: string;
  snapshotId: string;
  guide: ObjectiveGuide;
  droppedNames: string[];
  model: string;
  generatedAt: Date;
  /** When the capture the guide was built from was taken; null if that snapshot is gone. */
  snapshotCreatedAt: Date | null;
}

export async function upsertObjectiveGuide(input: {
  courseCode: string;
  snapshotId: string;
  guide: ObjectiveGuide;
  droppedNames: string[];
  model: string;
}): Promise<void> {
  const generatedAt = new Date();
  await db
    .insert(courseObjectiveGuides)
    .values({ ...input, generatedAt })
    .onConflictDoUpdate({
      target: courseObjectiveGuides.courseCode,
      set: {
        snapshotId: input.snapshotId,
        guide: input.guide,
        droppedNames: input.droppedNames,
        model: input.model,
        generatedAt,
      },
    });
}

export async function getObjectiveGuide(courseCode: string): Promise<StoredObjectiveGuide | null> {
  const rows = await db
    .select({
      courseCode: courseObjectiveGuides.courseCode,
      snapshotId: courseObjectiveGuides.snapshotId,
      guide: courseObjectiveGuides.guide,
      droppedNames: courseObjectiveGuides.droppedNames,
      model: courseObjectiveGuides.model,
      generatedAt: courseObjectiveGuides.generatedAt,
      snapshotCreatedAt: courseCaptureSnapshots.createdAt,
    })
    .from(courseObjectiveGuides)
    .leftJoin(courseCaptureSnapshots, eq(courseCaptureSnapshots.id, courseObjectiveGuides.snapshotId))
    .where(eq(courseObjectiveGuides.courseCode, courseCode))
    .limit(1);
  return rows[0] ?? null;
}
```

- [ ] **Step 7: Run the tests and typecheck**

Run: `pnpm vitest run lib/db/__tests__/course-materials-queries.test.ts` — Expected: PASS.
Run: `npx tsc --noEmit -p .` — Expected: no errors.

- [ ] **Step 8: Preview the backfill, then STOP for the owner's go-ahead**

Read-only preview of which rows the migration's UPDATE will flag:

```bash
PSQL=/Applications/Postgres.app/Contents/Versions/17/bin/psql
DB="$(node ~/.claude/dashboard/read-env.mjs /Users/admin/projects/curriculum_developer DATABASE_URL)"
"$PSQL" "$DB" -Atc "select course_code, file_name, ignored, auto_set_aside from course_materials where file_name = 'Canvas: Syllabus' or file_name ilike '%syllabus%' order by 1, 2"
```

Expected (2026-10-05 data): about 11 rows across GC 1010, GC 3020, GC 3620, GC 3800, GC 4440, GC 4800, GC 4900bl (×2), MKT 3310 (×2), MKT 4320. If any row is plainly not a syllabus, remove it by id after the migration (`UPDATE course_materials SET is_syllabus = false WHERE id = '<id>'`). Show the owner the list and ask: "Apply migration 0051 to the shared production database now?" Do not continue until they say yes.

- [ ] **Step 9: Apply the migration (owner-approved only) and verify**

```bash
"$PSQL" "$DB" -v ON_ERROR_STOP=1 --single-transaction -f drizzle/0051_objective_guides.sql
"$PSQL" "$DB" -Atc "select count(*) from course_materials where is_syllabus"
"$PSQL" "$DB" -Atc "select column_name from information_schema.columns where table_name = 'course_objective_guides' order by ordinal_position"
```

Expected: the count matches the preview; the columns are `course_code, snapshot_id, guide, dropped_names, model, generated_at`. The change is additive, so the deployed (older) app keeps working.

- [ ] **Step 10: Update `docs/STATE.md`**

In `### Schema (local Postgres 17 via Drizzle)`, directly after the bullet that starts `- **Access grants (scoped access links, 2026-09-30):**`, add:

```markdown
- **Objective assessment guides (2026-10-05):** `courseObjectiveGuides` — `course_code` (PK → `courses.code`, cascade; one row per course, latest guide only), `snapshot_id` (→ `course_capture_snapshots.id`, cascade), `guide` (jsonb, the checked `ObjectiveGuide`), `dropped_names` (jsonb `string[]`, names the check removed), `model`, `generated_at`. Plus **`course_materials.is_syllabus`** (boolean, default false): set by the Canvas/IMSCC import for `Canvas: Syllabus`, by Syllabus-box uploads (`role=syllabus`), and once by the migration for names containing "syllabus". Migration `0051_objective_guides.sql` — **hand-written and applied with psql**, not drizzle-kit (see Deferred / debt).
```

Directly under the `### Deferred / debt` heading, add as the first bullet:

```markdown
- **Drizzle meta journal is missing 0050 and 0051 in the dev checkout (2026-10-05).** `drizzle/meta/` is git-ignored and this checkout's `_journal.json` stops at 0049 (0050 was generated in a since-removed worktree). `pnpm db:generate` here would re-emit `access_grants`; `pnpm db:migrate` would never apply 0050/0051. 0051 was hand-written and applied with psql. Before the next drizzle-kit migration, rebuild the meta snapshot from the live schema (or keep hand-writing).
```

- [ ] **Step 11: Commit**

```bash
git add drizzle/0051_objective_guides.sql lib/db/schema.ts lib/db/course-materials-queries.ts \
  lib/db/objective-guides-queries.ts lib/db/__tests__/course-materials-queries.test.ts docs/STATE.md
git commit -m "feat(db): course_objective_guides table + course_materials.is_syllabus (migration 0051)" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YFqkp83wAJeqVK7QHjRrPm"
```

---

### Task 3: The `objective-evidence-guide` AI function

**Files:**
- Modify: `lib/ai/function-settings.ts`
- Modify: `lib/ai/prompts/load.ts`
- Create: `lib/ai/prompts/objective-evidence-guide.md`
- Create: `lib/objective-guide/generate.ts`
- Test: `lib/objective-guide/__tests__/generate.test.ts`
- Modify: `docs/STATE.md`

**Interfaces:**
- Consumes: Task 1 (`ModelGuideSchema`, `modelGuideJsonSchema`, `ModelGuide`, `ObjectiveGuide`, `parseCanvasAssignmentNames`, `KnownNames`, `findGuideProblems`, `finalizeGuide`); `getProviderForFunction(id)` (`lib/ai/provider.ts`) whose `complete<T>({ systemPrompt, userMessage, schemaName, jsonSchema, validate })` returns `{ data: T; costUsdCents; durationMs; cachedTokens; uncachedPromptTokens; completionTokens }`; `loadPrompt(name)`; `recordSpend(costCents)` (`lib/rate-limit/daily-cap.ts`; units are the provider's `costUsdCents`); `CaptureProfile` (`lib/ai/capture/schema.ts`).
- Produces:
  - `'objective-evidence-guide'` in `AI_FUNCTION_IDS` / `DEFAULT_TIERS` (`'default'`) / `FUNCTION_LABELS` / `FUNCTION_DESCRIPTIONS`, and in the `PromptName` union.
  - `interface GuideGenerationInput { courseCode: string; courseTitle: string; syllabi: Array<{ fileName: string; text: string }>; assignmentsText: string; profile: CaptureProfile }`
  - `interface GuideGenerationResult { guide: ObjectiveGuide; droppedNames: string[]; model: string; costUsdCents: number; attempts: 1 | 2 }`
  - `buildGuideUserMessage(input: GuideGenerationInput, known: KnownNames): string`, `buildRetryNote(problems: string[]): string`, `generateObjectiveGuide(input: GuideGenerationInput): Promise<GuideGenerationResult>`.

- [ ] **Step 1: Write the failing test**

`lib/objective-guide/__tests__/generate.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import { ASSIGNMENTS_TEXT, SYLLABUS_TEXT } from './fixtures';

const { complete, recordSpend } = vi.hoisted(() => ({ complete: vi.fn(), recordSpend: vi.fn() }));
vi.mock('@/lib/ai/provider', () => ({
  getProviderForFunction: vi.fn(async () => ({ name: 'fake', model: 'gpt-test', complete })),
}));
vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt: vi.fn(async () => 'SYSTEM PROMPT') }));
vi.mock('@/lib/rate-limit/daily-cap', () => ({ recordSpend }));

import { generateObjectiveGuide, buildGuideUserMessage } from '../generate';
import { parseCanvasAssignmentNames } from '../canvas-names';
import { getProviderForFunction } from '@/lib/ai/provider';

const PROFILE = {
  competencies: [
    { statement: 'Builds audience-grounded brand strategy', type: 'technical', k_depth: 3, u_depth: 2, d_depth: 3,
      evidence_k: null, evidence_u: 'Explains why the audience matters', evidence_d: 'Brand Audit research section',
      rationale: 'r', citations: [{ type: 'chunk', chunkId: 'c1', excerpt: 'cite three sources' }] },
  ],
  course_emphasis: [{ competency: 'Builds audience-grounded brand strategy', points: 50, share_pct: 100, centrality: 'central' }],
  audit_notes: { objective_misalignments: ['Objective 3 has no assessment.'] },
  verification_summary: { catalog_vs_evidence: ['Catalog overstates presentation work.'] },
} as unknown as CaptureProfile;

const INPUT = {
  courseCode: 'MKT 4320',
  courseTitle: 'Brand Management',
  syllabi: [{ fileName: 'MKT 4320 syllabus.pdf', text: SYLLABUS_TEXT }],
  assignmentsText: ASSIGNMENTS_TEXT,
  profile: PROFILE,
};

const reply = (data: unknown, cost = 500) => ({
  data, costUsdCents: cost, durationMs: 1, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0,
});

const GOOD = {
  intro: 'Intro.',
  objectives: [
    { objective: 'Develop a brand strategy grounded in audience research.', measure: 'clear',
      evidence: [{ assignment: 'Brand Audit', rubric_row: 'Research depth' }], gather: 'The distribution.', suggestion: null },
  ],
};
const BAD = {
  intro: 'Intro.',
  objectives: [
    { objective: 'Develop a brand strategy grounded in audience research.', measure: 'clear',
      evidence: [{ assignment: 'Capstone Pitch', rubric_row: null }], gather: 'The distribution.', suggestion: null },
  ],
};

beforeEach(() => {
  complete.mockReset();
  recordSpend.mockReset();
  recordSpend.mockResolvedValue(undefined);
});

describe('generateObjectiveGuide', () => {
  it('uses the objective-evidence-guide function and makes one call when the draft is clean', async () => {
    complete.mockResolvedValueOnce(reply(GOOD));
    const r = await generateObjectiveGuide(INPUT);
    expect(getProviderForFunction).toHaveBeenCalledWith('objective-evidence-guide');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]![0]).toMatchObject({ systemPrompt: 'SYSTEM PROMPT', schemaName: 'objective_evidence_guide' });
    expect(r.attempts).toBe(1);
    expect(r.droppedNames).toEqual([]);
    expect(r.model).toBe('gpt-test');
    expect(r.guide.checklist).toEqual([{ assignment: 'Brand Audit', rubric_row: 'Research depth' }]);
    expect(recordSpend).toHaveBeenCalledWith(500);
    expect(r.costUsdCents).toBe(500);
  });

  it('retries once with the misses and the valid names, and keeps the corrected draft', async () => {
    complete.mockResolvedValueOnce(reply(BAD)).mockResolvedValueOnce(reply(GOOD, 700));
    const r = await generateObjectiveGuide(INPUT);
    expect(complete).toHaveBeenCalledTimes(2);
    const retryMessage = complete.mock.calls[1]![0].userMessage as string;
    expect(retryMessage).toContain('Corrections needed');
    expect(retryMessage).toContain('- assignment: Capstone Pitch');
    expect(retryMessage).toContain('- Brand Audit');
    expect(r.attempts).toBe(2);
    expect(r.droppedNames).toEqual([]);
    expect(r.guide.objectives[0]!.measure).toBe('clear');
    expect(r.costUsdCents).toBe(1200);
    expect(recordSpend).toHaveBeenCalledTimes(2);
  });

  it('drops what is still unmatched after the retry and records it', async () => {
    complete.mockResolvedValueOnce(reply(BAD)).mockResolvedValueOnce(reply(BAD));
    const r = await generateObjectiveGuide(INPUT);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(r.droppedNames).toEqual(['assignment: Capstone Pitch']);
    expect(r.guide.objectives[0]).toMatchObject({ measure: 'none', evidence: [] });
    expect(r.guide.checklist).toEqual([]);
  });
});

describe('buildGuideUserMessage', () => {
  it('carries the syllabus, the assignments, the valid names and the capture findings', () => {
    const msg = buildGuideUserMessage(INPUT, parseCanvasAssignmentNames(ASSIGNMENTS_TEXT));
    expect(msg).toContain('# Course: MKT 4320 Brand Management');
    expect(msg).toContain('### MKT 4320 syllabus.pdf');
    expect(msg).toContain('• Develop a brand strategy grounded in audience research.');
    expect(msg).toContain('## Brand Audit (50 pts)');
    expect(msg).toContain('- Final Brand Playbook\n  - rubric row: Visual system');
    expect(msg).toContain('- Builds audience-grounded brand strategy (K3 U2 D3)');
    expect(msg).toContain('  cited: "cite three sources"');
    expect(msg).toContain('- Builds audience-grounded brand strategy: 50 pts (100%)');
    expect(msg).toContain('- Objective 3 has no assessment.');
    expect(msg).toContain('- Catalog overstates presentation work.');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run lib/objective-guide/__tests__/generate.test.ts`
Expected: FAIL — `Failed to resolve import "../generate"`.

- [ ] **Step 3: Register the AI function in `lib/ai/function-settings.ts`**

In `AI_FUNCTION_IDS`, after `'explore-agent',` add:

```ts
  'objective-evidence-guide',
```

In `DEFAULT_TIERS`, after the `'explore-agent': 'default',` entry add:

```ts
  // Default tier (owner decision 2026-10-05). One structured call per course
  // after each snapshot: reads the syllabus, the Canvas assignments text and the
  // snapshot findings, and writes the objective assessment guide. A deterministic
  // check (lib/objective-guide/check.ts) drops any name not in Canvas.
  'objective-evidence-guide': 'default',
```

In `FUNCTION_LABELS`, after the `'explore-agent'` entry add:

```ts
  'objective-evidence-guide': 'Objective assessment guide (wiki course page)',
```

In `FUNCTION_DESCRIPTIONS`, after the `'explore-agent'` entry add:

```ts
  'objective-evidence-guide': 'Writes the per-course guide on the public wiki page: each syllabus objective quoted verbatim, which Canvas assignments and rubric rows measure it, and what class-level numbers to gather at the end of the semester. Runs after each snapshot; names not found in Canvas are dropped by a deterministic check.',
```

- [ ] **Step 4: Add the prompt name in `lib/ai/prompts/load.ts`**

In the `PromptName` union, change the last member line `  | 'explore-agent';` to:

```ts
  | 'explore-agent'
  | 'objective-evidence-guide';
```

- [ ] **Step 5: Write the prompt `lib/ai/prompts/objective-evidence-guide.md`**

```markdown
---
name: objective-evidence-guide
---

# Role

You write a short, practical guide for the instructor of one college course. It tells them what to collect from their Canvas course at the end of a semester to show that each of the course's stated learning objectives was met.

You receive:

1. **The course syllabus.** It is the only source of the learning objectives.
2. **The Canvas assignments**: names, points, descriptions and rubric rows.
3. **Valid names**: every assignment name, and every rubric row under it, that you may use.
4. **What a recent review of the course found**: the competencies students show and the evidence for them, how graded points are spread across those competencies, and where the stated objectives and the evidence disagree.

# What to write

## intro

One paragraph addressed to the instructor as "you". Say what the guide is for: at the end of the semester, a few class-level numbers pulled from Canvas show how well students met each objective. Keep it plain and brief. Do not mention AI, models, prompts, reviews, or this tool.

## objectives

One entry for each learning objective the syllabus states, in the syllabus's order. If the syllabus has no list of learning objectives (they may be called outcomes, goals or competencies), return an empty list.

- **objective** — copy it word for word from the syllabus. Do not shorten, merge, split, reword or correct it. Leave out any leading bullet, number or letter.
- **measure**
  - `clear` — a graded assignment, or one rubric row, plainly measures this objective.
  - `partial` — graded work touches the objective but does not isolate it, for example one overall score that mixes this objective with others.
  - `none` — no graded item measures it. This is an acceptable, honest answer. Do not stretch a weak link into `partial`.
- **evidence** — up to three items, strongest first. Each names one assignment and, when a single rubric row does the measuring, that rubric row; otherwise `rubric_row` is null. Empty when `measure` is `none`.
- **gather** — one or two sentences on what to pull from Canvas at the end of the semester, in class-level numbers only: a score distribution, an average, or the share of students at or above a level. Example: "the score distribution on the Strategic rationale row of the Final Brand Playbook rubric, and the share of students scoring at proficient or above." When `measure` is `none`, say what could be gathered once a measure exists.
- **suggestion** — only when `measure` is `partial` or `none`: the smallest change that would create a clear measure, such as adding one rubric row to an existing assignment (name the assignment and the row you would add). `null` when `measure` is `clear`.

# Rules

- **Exact names.** Every assignment and rubric row in `evidence` must appear in the valid-names list, spelled exactly as listed. Never name anything that is not on the list. When you mention an existing item in `gather` or `suggestion`, use its exact name too.
- **Class-level numbers only.** Never ask for, name or imply any individual student, and never ask for one student's grade or work.
- **Plain advice voice**, as one colleague to another. Short sentences. No jargon, no markdown, no headings inside fields.
- Use the review findings to judge which graded items measure which objective. Points show what the course weights. Where the review says an objective is not assessed, accept that unless a graded item clearly measures it.
- Do not score anything. Do not use depth numbers or the terms know, understand and do.

# Output

Return JSON that matches the schema: `{ "intro": string, "objectives": [ { "objective": string, "measure": "clear" | "partial" | "none", "evidence": [ { "assignment": string, "rubric_row": string | null } ], "gather": string, "suggestion": string | null } ] }`.
```

- [ ] **Step 6: Write `lib/objective-guide/generate.ts`**

```ts
import { loadPrompt } from '@/lib/ai/prompts/load';
import { getProviderForFunction } from '@/lib/ai/provider';
import { recordSpend } from '@/lib/rate-limit/daily-cap';
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import { ModelGuideSchema, modelGuideJsonSchema, type ModelGuide, type ObjectiveGuide } from './schema';
import { parseCanvasAssignmentNames, type KnownNames } from './canvas-names';
import { findGuideProblems, finalizeGuide } from './check';

export interface GuideGenerationInput {
  courseCode: string;
  courseTitle: string;
  /** Usable syllabus materials only (never an ignored / set-aside one). */
  syllabi: Array<{ fileName: string; text: string }>;
  /** Usable `Canvas: Assignments` text, ignored items already removed. */
  assignmentsText: string;
  profile: CaptureProfile;
}

export interface GuideGenerationResult {
  guide: ObjectiveGuide;
  droppedNames: string[];
  model: string;
  costUsdCents: number;
  attempts: 1 | 2;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function buildGuideUserMessage(input: GuideGenerationInput, known: KnownNames): string {
  const syllabi = input.syllabi.map((s) => `### ${s.fileName}\n\n${s.text.trim()}`).join('\n\n');

  const validNames = known.assignments.length > 0
    ? known.assignments
        .map((a) => [`- ${a.name}`, ...a.rubricRows.map((r) => `  - rubric row: ${r}`)].join('\n'))
        .join('\n')
    : '(none)';

  const p = input.profile;
  const competencies = (p.competencies ?? []).map((c) => {
    const depth = c.type === 'foundational'
      ? `D${c.d_depth}`
      : `K${c.k_depth ?? '–'} U${c.u_depth ?? '–'} D${c.d_depth}`;
    const evidence = [c.evidence_k, c.evidence_u, c.evidence_d]
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .map((s) => `  evidence: ${clip(s.trim(), 300)}`);
    const cited = (c.citations ?? []).slice(0, 3).map((x) => `  cited: "${x.excerpt}"`);
    return [`- ${c.statement} (${depth})`, ...evidence, ...cited].join('\n');
  }).join('\n') || '(none)';

  const emphasis = (p.course_emphasis ?? [])
    .map((e) => `- ${e.competency}: ${e.points} pts (${e.share_pct}%)`)
    .join('\n') || '(none recorded)';
  const misalignments = (p.audit_notes?.objective_misalignments ?? []).map((s) => `- ${s}`).join('\n') || '(none)';
  const catalogVsEvidence = (p.verification_summary?.catalog_vs_evidence ?? []).map((s) => `- ${s}`).join('\n') || '(none)';

  return [
    `# Course: ${input.courseCode} ${input.courseTitle}`,
    '',
    '## Syllabus (the only source of the learning objectives)',
    '',
    syllabi,
    '',
    '## Canvas assignments',
    '',
    input.assignmentsText.trim(),
    '',
    '## Valid names (copy exactly; use no others)',
    '',
    validNames,
    '',
    '## What the review of the course found',
    '',
    '### Competencies students show',
    competencies,
    '',
    '### Graded points by competency',
    emphasis,
    '',
    '### Where the stated objectives and the evidence disagree',
    misalignments,
    '',
    '### Catalog claims against the evidence',
    catalogVsEvidence,
  ].join('\n');
}

export function buildRetryNote(problems: string[]): string {
  return [
    '## Corrections needed',
    '',
    'Your previous answer used names or objectives that are not in the inputs:',
    ...problems.map((p) => `- ${p}`),
    '',
    'Answer again in full. Use only names from "Valid names", copied exactly, and quote each objective exactly as the syllabus words it.',
  ].join('\n');
}

/**
 * One structured call, then the deterministic check. Any miss gets exactly one
 * corrective retry; whatever is still unmatched is dropped by finalizeGuide and
 * returned as droppedNames. Spend is recorded per call.
 */
export async function generateObjectiveGuide(input: GuideGenerationInput): Promise<GuideGenerationResult> {
  const known = parseCanvasAssignmentNames(input.assignmentsText);
  const syllabusText = input.syllabi.map((s) => s.text).join('\n\n');
  const [provider, systemPrompt] = await Promise.all([
    getProviderForFunction('objective-evidence-guide'),
    loadPrompt('objective-evidence-guide'),
  ]);
  const baseMessage = buildGuideUserMessage(input, known);

  let costUsdCents = 0;
  const call = async (userMessage: string): Promise<ModelGuide> => {
    const res = await provider.complete<ModelGuide>({
      systemPrompt,
      userMessage,
      schemaName: 'objective_evidence_guide',
      jsonSchema: modelGuideJsonSchema as unknown as object,
      validate: (raw) => ModelGuideSchema.parse(raw),
    });
    costUsdCents += res.costUsdCents;
    await recordSpend(res.costUsdCents);
    return res.data;
  };

  let draft = await call(baseMessage);
  let attempts: 1 | 2 = 1;
  const problems = findGuideProblems(draft, known, syllabusText);
  if (problems.length > 0) {
    draft = await call(`${baseMessage}\n\n${buildRetryNote(problems)}`);
    attempts = 2;
  }

  const { guide, dropped } = finalizeGuide(draft, known, syllabusText);
  return { guide, droppedNames: dropped, model: provider.model, costUsdCents, attempts };
}
```

- [ ] **Step 7: Run the tests and typecheck**

Run: `pnpm vitest run lib/objective-guide/__tests__` — Expected: PASS.
Run: `npx tsc --noEmit -p .` — Expected: no errors (the `Record<AIFunctionId, …>` maps force all four entries).

- [ ] **Step 8: Update `docs/STATE.md`**

In the `- **Function tier system** at ...` bullet, replace the words "24 named function IDs." with "26 named function IDs (objective-evidence-guide added 2026-10-05)." (the list had already drifted to 25 before this change).

In the AI function table, after the row that starts `| \`reconcile-feedback\` | default |`, add:

```markdown
| `objective-evidence-guide` | default | Objective assessment guide (spec 2026-10-05; owner chose default tier). Quotes each objective verbatim from the course's usable syllabus (never `courses.learning_objectives`; never an ignored/set-aside syllabus), names the Canvas assignments and rubric rows that measure it, and says which class-level numbers to gather. Deterministic check (`lib/objective-guide/check.ts`): one corrective retry, then any name not in `Canvas: Assignments` or objective not in the syllabus is dropped and logged in `dropped_names`. ~$0.05–0.20 per course. |
```

- [ ] **Step 9: Commit**

```bash
git add lib/ai/function-settings.ts lib/ai/prompts/load.ts lib/ai/prompts/objective-evidence-guide.md \
  lib/objective-guide/generate.ts lib/objective-guide/__tests__/generate.test.ts docs/STATE.md
git commit -m "feat(ai): objective-evidence-guide function (default tier) with one corrective retry" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YFqkp83wAJeqVK7QHjRrPm"
```

---

### Task 4: Orchestrator and the snapshot background task

**Files:**
- Create: `lib/objective-guide/inputs.ts`
- Create: `lib/objective-guide/run.ts`
- Modify: `app/api/capture/[code]/snapshots/route.ts`
- Test: `lib/objective-guide/__tests__/inputs.test.ts`, `lib/objective-guide/__tests__/run.test.ts`, `tests/app/api/snapshots-clear-raw.test.ts` (extend)
- Modify: `docs/STATE.md`

**Interfaces:**
- Consumes: `generateObjectiveGuide` (Task 3); `upsertObjectiveGuide` (Task 2); `CourseMaterialRow.isSyllabus` (Task 2); `getSnapshotById`, `getLatestSnapshotByCourse` (`lib/db/capture-snapshots-queries.ts`); `getCourseByCode` (`lib/db/courses-queries.ts`); `listMaterialsByCourse`; `checkDailyCap(): Promise<{ ok: boolean; … }>`; `filterCanvasBlob(text, ignoredTitles)`.
- Produces:
  - `type GuideMaterial = { id: string; fileName: string; isSyllabus: boolean; ignored: boolean; retiredAt: Date | string | null; extractedText: string | null; ignoredItems?: readonly string[] | null }`
  - `type SyllabusPick = { status: 'ok'; syllabi: Array<{ id: string; fileName: string; text: string }> } | { status: 'no-syllabus' } | { status: 'syllabus-set-aside' }`
  - `pickSyllabus(materials: GuideMaterial[]): SyllabusPick`, `usableAssignmentsText(materials: GuideMaterial[]): string | null`
  - `type GuideRunResult = { status: 'written'; courseCode: string; objectives: number; droppedNames: string[]; costUsdCents: number } | { status: 'skipped'; courseCode: string | null; reason: GuideSkipReason }`, `GuideSkipReason = 'snapshot-not-found' | 'course-not-found' | 'no-syllabus' | 'syllabus-set-aside' | 'no-assignments' | 'daily-cap' | 'superseded'`
  - `runObjectiveGuideForSnapshot(snapshotId: string): Promise<GuideRunResult>`

- [ ] **Step 1: Write the failing tests**

`lib/objective-guide/__tests__/inputs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pickSyllabus, usableAssignmentsText, type GuideMaterial } from '../inputs';

const mat = (o: Partial<GuideMaterial>): GuideMaterial => ({
  id: 'm', fileName: 'f.pdf', isSyllabus: false, ignored: false, retiredAt: null, extractedText: 'text', ignoredItems: [], ...o,
});

describe('pickSyllabus', () => {
  it('returns every usable flagged syllabus', () => {
    expect(pickSyllabus([mat({ id: 's', fileName: 'syl.pdf', isSyllabus: true, extractedText: 'OBJ' }), mat({ id: 'x' })]))
      .toEqual({ status: 'ok', syllabi: [{ id: 's', fileName: 'syl.pdf', text: 'OBJ' }] });
  });

  it('a FERPA set-aside syllabus is never usable', () => {
    expect(pickSyllabus([mat({ isSyllabus: true, ignored: true, extractedText: 'student emails' })]))
      .toEqual({ status: 'syllabus-set-aside' });
  });

  it('a set-aside syllabus that faculty included is usable', () => {
    const included = { ...mat({ id: 's', isSyllabus: true, ignored: false, extractedText: 'OBJ' }), autoSetAside: true };
    expect(pickSyllabus([included]).status).toBe('ok');
  });

  it('skips retired and empty syllabi', () => {
    expect(pickSyllabus([mat({ isSyllabus: true, retiredAt: new Date() })])).toEqual({ status: 'no-syllabus' });
    expect(pickSyllabus([mat({ isSyllabus: true, extractedText: '   ' })])).toEqual({ status: 'no-syllabus' });
    expect(pickSyllabus([mat({ isSyllabus: true, ignored: true, retiredAt: new Date() })])).toEqual({ status: 'no-syllabus' });
  });

  it('uses the usable one when another copy is set aside', () => {
    const r = pickSyllabus([
      mat({ id: 'a', isSyllabus: true, ignored: true, extractedText: 'SECRET' }),
      mat({ id: 'b', isSyllabus: true, extractedText: 'OBJ' }),
    ]);
    expect(r).toEqual({ status: 'ok', syllabi: [{ id: 'b', fileName: 'f.pdf', text: 'OBJ' }] });
  });
});

describe('usableAssignmentsText', () => {
  const text = '## A (5 pts)\nfirst\n\n## B (5 pts)\nsecond';

  it('removes per-item ignores', () => {
    const out = usableAssignmentsText([mat({ fileName: 'Canvas: Assignments', extractedText: text, ignoredItems: ['B (5 pts)'] })]);
    expect(out).toContain('## A (5 pts)');
    expect(out).not.toContain('second');
  });

  it('skips ignored and retired rows and joins the rest', () => {
    expect(usableAssignmentsText([mat({ fileName: 'Canvas: Assignments', ignored: true, extractedText: text })])).toBeNull();
    expect(usableAssignmentsText([mat({ fileName: 'Canvas: Assignments', retiredAt: '2026-10-01T00:00:00Z', extractedText: text })])).toBeNull();
    expect(usableAssignmentsText([
      mat({ fileName: 'Canvas: Assignments', extractedText: '## A\none' }),
      mat({ fileName: 'Canvas: Assignments', extractedText: '## B\ntwo' }),
    ])).toBe('## A\none\n\n## B\ntwo');
  });

  it('returns null when there is no assignments material', () => {
    expect(usableAssignmentsText([mat({ fileName: 'Canvas: Pages' })])).toBeNull();
  });
});
```

`lib/objective-guide/__tests__/run.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ASSIGNMENTS_TEXT, SYLLABUS_TEXT } from './fixtures';

const m = vi.hoisted(() => ({
  getSnapshotById: vi.fn(),
  getLatestSnapshotByCourse: vi.fn(),
  getCourseByCode: vi.fn(),
  listMaterialsByCourse: vi.fn(),
  upsertObjectiveGuide: vi.fn(),
  checkDailyCap: vi.fn(),
  generateObjectiveGuide: vi.fn(),
}));
vi.mock('@/lib/db/capture-snapshots-queries', () => ({
  getSnapshotById: m.getSnapshotById, getLatestSnapshotByCourse: m.getLatestSnapshotByCourse,
}));
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode: m.getCourseByCode }));
vi.mock('@/lib/db/course-materials-queries', () => ({ listMaterialsByCourse: m.listMaterialsByCourse }));
vi.mock('@/lib/db/objective-guides-queries', () => ({ upsertObjectiveGuide: m.upsertObjectiveGuide }));
vi.mock('@/lib/rate-limit/daily-cap', () => ({ checkDailyCap: m.checkDailyCap }));
vi.mock('../generate', () => ({ generateObjectiveGuide: m.generateObjectiveGuide }));

import { runObjectiveGuideForSnapshot } from '../run';

const row = (o: Record<string, unknown>) => ({
  id: 'm', fileName: 'f.pdf', isSyllabus: false, ignored: false, autoSetAside: false, retiredAt: null,
  extractedText: 'text', ignoredItems: [], ...o,
});
const GUIDE = { intro: 'i', objectives: [], checklist: [] };

beforeEach(() => {
  vi.clearAllMocks();
  m.getSnapshotById.mockResolvedValue({ id: 'snap-1', courseCode: 'MKT 4320', profile: { competencies: [] } });
  m.getLatestSnapshotByCourse.mockResolvedValue({ id: 'snap-1' });
  m.getCourseByCode.mockResolvedValue({ code: 'MKT 4320', title: 'Brand Management' });
  m.checkDailyCap.mockResolvedValue({ ok: true, spentCents: 0, overCap: false });
  m.upsertObjectiveGuide.mockResolvedValue(undefined);
  m.generateObjectiveGuide.mockResolvedValue({
    guide: GUIDE, droppedNames: ['assignment: Capstone Pitch'], model: 'gpt-test', costUsdCents: 900, attempts: 2,
  });
});

describe('runObjectiveGuideForSnapshot', () => {
  it('never sends a set-aside syllabus to the AI', async () => {
    m.listMaterialsByCourse.mockResolvedValue([
      row({ id: 's', fileName: 'MKT 4320 syllabus.pdf', isSyllabus: true, ignored: true, autoSetAside: true, extractedText: 'SECRET SYLLABUS' }),
      row({ fileName: 'Canvas: Assignments', extractedText: ASSIGNMENTS_TEXT }),
    ]);
    const r = await runObjectiveGuideForSnapshot('snap-1');
    expect(r).toEqual({ status: 'skipped', courseCode: 'MKT 4320', reason: 'syllabus-set-aside' });
    expect(m.generateObjectiveGuide).not.toHaveBeenCalled();
    expect(m.upsertObjectiveGuide).not.toHaveBeenCalled();
  });

  it('sends only the usable syllabus and unignored assignments, then stores the guide', async () => {
    m.listMaterialsByCourse.mockResolvedValue([
      row({ id: 's1', fileName: 'old syllabus.pdf', isSyllabus: true, ignored: true, extractedText: 'SECRET' }),
      row({ id: 's2', fileName: 'syllabus.pdf', isSyllabus: true, extractedText: SYLLABUS_TEXT }),
      row({ fileName: 'Canvas: Assignments', extractedText: ASSIGNMENTS_TEXT, ignoredItems: ['Reading Quiz 1'] }),
    ]);
    const r = await runObjectiveGuideForSnapshot('snap-1');
    expect(m.generateObjectiveGuide).toHaveBeenCalledTimes(1);
    const arg = m.generateObjectiveGuide.mock.calls[0]![0];
    expect(arg.syllabi).toEqual([{ id: 's2', fileName: 'syllabus.pdf', text: SYLLABUS_TEXT }]);
    expect(JSON.stringify(arg)).not.toContain('SECRET');
    expect(arg.assignmentsText).not.toContain('Reading Quiz 1');
    expect(arg).toMatchObject({ courseCode: 'MKT 4320', courseTitle: 'Brand Management' });
    expect(m.upsertObjectiveGuide).toHaveBeenCalledWith({
      courseCode: 'MKT 4320', snapshotId: 'snap-1', guide: GUIDE, droppedNames: ['assignment: Capstone Pitch'], model: 'gpt-test',
    });
    expect(r).toEqual({ status: 'written', courseCode: 'MKT 4320', objectives: 0, droppedNames: ['assignment: Capstone Pitch'], costUsdCents: 900 });
  });

  it('does not overwrite with a guide from a snapshot that is no longer the latest', async () => {
    m.listMaterialsByCourse.mockResolvedValue([
      row({ isSyllabus: true, extractedText: SYLLABUS_TEXT }),
      row({ fileName: 'Canvas: Assignments', extractedText: ASSIGNMENTS_TEXT }),
    ]);
    m.getLatestSnapshotByCourse.mockResolvedValue({ id: 'snap-2' });
    expect(await runObjectiveGuideForSnapshot('snap-1')).toEqual({ status: 'skipped', courseCode: 'MKT 4320', reason: 'superseded' });
    expect(m.upsertObjectiveGuide).not.toHaveBeenCalled();
  });

  it('skips without a call when over the daily cap, or with no assignments', async () => {
    m.listMaterialsByCourse.mockResolvedValue([
      row({ isSyllabus: true, extractedText: SYLLABUS_TEXT }),
      row({ fileName: 'Canvas: Assignments', extractedText: ASSIGNMENTS_TEXT }),
    ]);
    m.checkDailyCap.mockResolvedValue({ ok: false, spentCents: 1, overCap: true });
    expect((await runObjectiveGuideForSnapshot('snap-1')).status).toBe('skipped');
    m.listMaterialsByCourse.mockResolvedValue([row({ isSyllabus: true, extractedText: SYLLABUS_TEXT })]);
    m.checkDailyCap.mockResolvedValue({ ok: true, spentCents: 0, overCap: false });
    expect(await runObjectiveGuideForSnapshot('snap-1')).toEqual({ status: 'skipped', courseCode: 'MKT 4320', reason: 'no-assignments' });
    expect(m.generateObjectiveGuide).not.toHaveBeenCalled();
  });

  it('skips an unknown snapshot', async () => {
    m.getSnapshotById.mockResolvedValue(null);
    expect(await runObjectiveGuideForSnapshot('nope')).toEqual({ status: 'skipped', courseCode: null, reason: 'snapshot-not-found' });
  });
});
```

In `tests/app/api/snapshots-clear-raw.test.ts`, replace the wiki-update mock block:

```ts
vi.mock('@/lib/ai/wiki/update', () => ({
  updateWikiForSnapshot: async () => ({ raw: [], wiki: [], logEntry: null }),
}));
```

with:

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const updateWikiForSnapshot = vi.fn(async (_id?: any) => ({ raw: [], wiki: [], logEntry: null }));
vi.mock('@/lib/ai/wiki/update', () => ({
  updateWikiForSnapshot: (id: unknown) => updateWikiForSnapshot(id),
}));

// ── objective assessment guide (own fire-and-forget task) ───────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const runObjectiveGuideForSnapshot = vi.fn(async (_id?: any) => ({ status: 'written' }));
vi.mock('@/lib/objective-guide/run', () => ({
  runObjectiveGuideForSnapshot: (id: unknown) => runObjectiveGuideForSnapshot(id),
}));
```

and append at the end of the file:

```ts
describe('snapshots POST — objective assessment guide task', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTriageEnabled.mockReturnValue(false);
    runObjectiveGuideForSnapshot.mockResolvedValue({ status: 'written' });
  });

  it('fires the guide task with the new snapshot id', async () => {
    const res = await callPost();
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 0));
    expect(runObjectiveGuideForSnapshot).toHaveBeenCalledWith('snap-1');
  });

  it('a guide failure fails neither the response nor the wiki update', async () => {
    runObjectiveGuideForSnapshot.mockRejectedValueOnce(new Error('model down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await callPost();
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 0));
    expect(updateWikiForSnapshot).toHaveBeenCalledWith('snap-1');
    expect(errSpy).toHaveBeenCalledWith('[objective-guide] failed for', 'GC 4440', expect.any(Error));
    errSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run lib/objective-guide/__tests__/inputs.test.ts lib/objective-guide/__tests__/run.test.ts tests/app/api/snapshots-clear-raw.test.ts`
Expected: FAIL — unresolved `../inputs` / `../run` / `@/lib/objective-guide/run` imports.

- [ ] **Step 3: Write `lib/objective-guide/inputs.ts`**

```ts
import { filterCanvasBlob } from '@/lib/canvas/parseCanvasBlob';

/** The material fields the guide inputs depend on (a CourseMaterialRow fits). */
export interface GuideMaterial {
  id: string;
  fileName: string;
  isSyllabus: boolean;
  ignored: boolean;
  retiredAt: Date | string | null;
  extractedText: string | null;
  ignoredItems?: readonly string[] | null;
}

export type SyllabusPick =
  | { status: 'ok'; syllabi: Array<{ id: string; fileName: string; text: string }> }
  | { status: 'no-syllabus' }
  | { status: 'syllabus-set-aside' };

const hasText = (m: GuideMaterial) => (m.extractedText ?? '').trim().length > 0;

/**
 * The usable syllabus: flagged, not retired, not ignored, with text. `ignored`
 * is the app-wide "don't send to the AI" flag, so a FERPA auto-set-aside
 * syllabus is never used; once faculty include it (ignored=false) it is.
 */
export function pickSyllabus(materials: GuideMaterial[]): SyllabusPick {
  const flagged = materials.filter((m) => m.isSyllabus && !m.retiredAt);
  const usable = flagged.filter((m) => !m.ignored && hasText(m));
  if (usable.length > 0) {
    return { status: 'ok', syllabi: usable.map((m) => ({ id: m.id, fileName: m.fileName, text: m.extractedText as string })) };
  }
  if (flagged.some((m) => m.ignored)) return { status: 'syllabus-set-aside' };
  return { status: 'no-syllabus' };
}

/** Text of every usable `Canvas: Assignments` row, per-item ignores removed. */
export function usableAssignmentsText(materials: GuideMaterial[]): string | null {
  const parts = materials
    .filter((m) => m.fileName === 'Canvas: Assignments' && !m.ignored && !m.retiredAt && hasText(m))
    .map((m) => filterCanvasBlob(m.extractedText as string, m.ignoredItems ?? []).trim())
    .filter((t) => t.length > 0);
  return parts.length > 0 ? parts.join('\n\n') : null;
}
```

- [ ] **Step 4: Write `lib/objective-guide/run.ts`**

```ts
import { getSnapshotById, getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { upsertObjectiveGuide } from '@/lib/db/objective-guides-queries';
import { checkDailyCap } from '@/lib/rate-limit/daily-cap';
import { generateObjectiveGuide } from './generate';
import { pickSyllabus, usableAssignmentsText } from './inputs';

export type GuideSkipReason =
  | 'snapshot-not-found' | 'course-not-found' | 'no-syllabus' | 'syllabus-set-aside'
  | 'no-assignments' | 'daily-cap' | 'superseded';

export type GuideRunResult =
  | { status: 'written'; courseCode: string; objectives: number; droppedNames: string[]; costUsdCents: number }
  | { status: 'skipped'; courseCode: string | null; reason: GuideSkipReason };

/**
 * Build and store the objective assessment guide for one snapshot. Runs as its
 * own background task after snapshot creation (and from the backfill script).
 * A course with no usable syllabus — including one whose syllabus is set aside —
 * is skipped before any AI call.
 */
export async function runObjectiveGuideForSnapshot(snapshotId: string): Promise<GuideRunResult> {
  const snapshot = await getSnapshotById(snapshotId);
  if (!snapshot) return { status: 'skipped', courseCode: null, reason: 'snapshot-not-found' };
  const courseCode = snapshot.courseCode;

  const course = await getCourseByCode(courseCode);
  if (!course) return { status: 'skipped', courseCode, reason: 'course-not-found' };

  const materials = await listMaterialsByCourse(courseCode);
  const syllabus = pickSyllabus(materials);
  if (syllabus.status !== 'ok') return { status: 'skipped', courseCode, reason: syllabus.status };

  const assignmentsText = usableAssignmentsText(materials);
  if (assignmentsText === null) return { status: 'skipped', courseCode, reason: 'no-assignments' };

  const cap = await checkDailyCap();
  if (!cap.ok) return { status: 'skipped', courseCode, reason: 'daily-cap' };

  const result = await generateObjectiveGuide({
    courseCode,
    courseTitle: course.title,
    syllabi: syllabus.syllabi,
    assignmentsText,
    profile: snapshot.profile,
  });

  // A newer snapshot may have landed while the model was working; its own task
  // will write the guide, so never overwrite it with an older one.
  const latest = await getLatestSnapshotByCourse(courseCode);
  if (latest && latest.id !== snapshotId) return { status: 'skipped', courseCode, reason: 'superseded' };

  await upsertObjectiveGuide({
    courseCode,
    snapshotId,
    guide: result.guide,
    droppedNames: result.droppedNames,
    model: result.model,
  });
  if (result.droppedNames.length > 0) {
    console.warn(`[objective-guide] ${courseCode}: dropped ${result.droppedNames.length} unmatched item(s): ${result.droppedNames.join(' | ')}`);
  }
  return {
    status: 'written',
    courseCode,
    objectives: result.guide.objectives.length,
    droppedNames: result.droppedNames,
    costUsdCents: result.costUsdCents,
  };
}
```

- [ ] **Step 5: Wire the task into `app/api/capture/[code]/snapshots/route.ts`**

Add the import after `import { refreshProgramIndex } from '@/lib/capture/program-index';`:

```ts
import { runObjectiveGuideForSnapshot } from '@/lib/objective-guide/run';
```

Directly after the existing `void refreshProgramIndex(...).catch(...)` statement and before `return NextResponse.json({`, add:

```ts
  // Objective assessment guide (spec 2026-10-05) — its own task, independent
  // of the wiki update and the spine refresh, so a failure in one never skips
  // another. Fire-and-log; the next snapshot (or the backfill script) retries.
  void runObjectiveGuideForSnapshot(snapshot.id).catch(err =>
    console.error('[objective-guide] failed for', snapshot.courseCode, err),
  );
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `pnpm vitest run lib/objective-guide/__tests__ tests/app/api/snapshots-clear-raw.test.ts` — Expected: PASS (including the four pre-existing clear-raw tests).
Run: `npx tsc --noEmit -p .` — Expected: no errors.

- [ ] **Step 7: Update `docs/STATE.md`**

At the end of the `objective-evidence-guide` row's note cell (added in Task 3), before its closing ` |`, append:

```markdown
 **Fired on every snapshot POST** (`app/api/capture/[code]/snapshots/route.ts`) as its own fire-and-forget task beside wiki-update and the program-index refresh; skips (no AI call) when the course has no usable syllabus, no usable `Canvas: Assignments`, or is over the daily cap; never overwrites with a guide from a superseded snapshot.
```

- [ ] **Step 8: Commit**

```bash
git add lib/objective-guide/inputs.ts lib/objective-guide/run.ts app/api/capture/\[code\]/snapshots/route.ts \
  lib/objective-guide/__tests__/inputs.test.ts lib/objective-guide/__tests__/run.test.ts \
  tests/app/api/snapshots-clear-raw.test.ts docs/STATE.md
git commit -m "feat(objective-guide): build the guide after each snapshot as an independent background task" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YFqkp83wAJeqVK7QHjRrPm"
```

---

### Task 5: Ingest keeps and flags the syllabus

The Canvas importer stops skipping the syllabus page, the materials policy stops auto-setting it aside, and an upload can be flagged as the syllabus.

**Files:**
- Modify: `lib/canvas/assemble-canvas-materials.ts`
- Modify: `app/api/courses/[code]/canvas-import/route.ts`, `app/api/courses/[code]/imscc-import/route.ts`, `app/api/courses/[code]/canvas-import/list-import.ts`
- Modify: `lib/capture/materials-policy.ts`
- Modify: `app/capture/[code]/HelpPanel.tsx`
- Modify: `app/api/courses/[code]/materials/route.ts`
- Modify: `lib/capture/upload-with-progress.ts`
- Test: `tests/lib/canvas/assemble-canvas-materials.test.ts`, `app/api/courses/[code]/canvas-import/__tests__/route.test.ts`, `app/api/courses/[code]/imscc-import/__tests__/route.test.ts`, `tests/lib/capture/materials-policy.test.ts`, `tests/api/course-materials.test.ts`, `lib/capture/__tests__/upload-with-progress.test.ts`

**Interfaces:**
- Consumes: `InsertMaterialInput.isSyllabus` and `isSyllabusInsert` (Task 2) — `insertMaterial` already flags `Canvas: Syllabus`, so the importers need no flag code of their own.
- Produces: `assembleCanvasMaterials(data: CanvasCourseData): AssembledMaterial[]` (the `opts` argument is removed); `UploadOptions.role?: 'syllabus'` (sent as form field `role`); materials POST reads form field `role` and inserts with `isSyllabus: role === 'syllabus'`.

- [ ] **Step 1: Write the failing tests**

`tests/lib/canvas/assemble-canvas-materials.test.ts` — replace the whole file with:

```ts
import { describe, it, expect } from 'vitest';
import { assembleCanvasMaterials } from '@/lib/canvas/assemble-canvas-materials';
const EMPTY = { course: { id: '1', name: 'C', syllabusHtml: '' }, assignments: [], modules: [], pages: [], discussions: [], quizzes: [] } as any;
describe('assembleCanvasMaterials', () => {
  it('always emits Canvas: Syllabus when Canvas has a syllabus page (the syllabus is the objective source)', () => {
    const out = assembleCanvasMaterials({ ...EMPTY, course: { id: '1', name: 'C', syllabusHtml: '<p>Hi</p>' } });
    expect(out.map(m => m.fileName)).toContain('Canvas: Syllabus');
  });
  it('emits no syllabus material when the Canvas syllabus page is empty', () => {
    const out = assembleCanvasMaterials(EMPTY);
    expect(out.map(m => m.fileName)).not.toContain('Canvas: Syllabus');
  });
});
```

`app/api/courses/[code]/canvas-import/__tests__/route.test.ts` — replace the whole `it('suppresses Canvas: Syllabus when Sheets catalog has learning objectives', ...)` test with:

```ts
  it('imports Canvas: Syllabus even when the Sheets catalog has learning objectives', async () => {
    // Owner decision 2026-10-05: the syllabus is the sole source of the
    // objective assessment guide, so the importer no longer skips it.
    mockGetCourse.mockResolvedValue({
      ...FAKE_COURSE,
      learningObjectives: ['Understand color theory', 'Apply CMYK separations'],
    });
    mockFetch.mockResolvedValue(CANVAS_DATA);

    const [req, ctx] = makeReq({ slug: 'valid-slug', canvasUrl: 'https://clemson.instructure.com/courses/12345', canvasToken: 'tok' });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);

    const insertCalls = mockInsert.mock.calls.map(c => c[0].fileName);
    expect(insertCalls).toContain('Canvas: Syllabus');
  });
```

`app/api/courses/[code]/imscc-import/__tests__/route.test.ts` — replace the whole `it('suppresses Canvas: Syllabus when Sheets catalog has learning objectives', ...)` test with:

```ts
  it('imports Canvas: Syllabus even when the Sheets catalog has learning objectives', async () => {
    mockGetCourse.mockResolvedValue({
      ...FAKE_COURSE,
      learningObjectives: ['Understand color theory', 'Apply CMYK separations'],
    });
    mockInsert.mockResolvedValue({ id: 'mat-1' });

    const [req, ctx] = makeReq(makeSampleFile());
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);

    const insertedFileNames = mockInsert.mock.calls.map((c) => c[0].fileName as string);
    expect(insertedFileNames).toContain('Canvas: Syllabus');
  });
```

`tests/lib/capture/materials-policy.test.ts` — replace the two tests `it('sets aside Canvas: Syllabus when the course already has LOs', ...)` and `it('keeps Canvas: Syllabus when the course has no LOs', ...)` with:

```ts
  it('keeps Canvas: Syllabus even when the course already has LOs (the syllabus is the objective source)', () => {
    const r = evaluateMaterialsPolicy({ ...base, fileName: 'Canvas: Syllabus', courseHasLearningObjectives: true });
    expect(r.included).toBe(true);
    expect(r.ferpaRisk).toBe('low');
  });

  it('keeps Canvas: Syllabus when the course has no LOs', () => {
    const r = evaluateMaterialsPolicy({ ...base, fileName: 'Canvas: Syllabus', courseHasLearningObjectives: false });
    expect(r.included).toBe(true);
  });
```

`tests/api/course-materials.test.ts` — in `makeUploadReq`, add `role?: string;` to the `overrides` parameter type, and after `form.set('file', file);` add:

```ts
  if (overrides.role) form.set('role', overrides.role);
```

Then add these tests inside `describe('POST /api/courses/[code]/materials', ...)`:

```ts
  it('flags an upload sent with role=syllabus as the syllabus', async () => {
    const [req, ctx] = makeUploadReq({ fileName: 'course outline.pdf', role: 'syllabus' });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    expect(insertMaterial).toHaveBeenCalledWith(expect.objectContaining({ isSyllabus: true }));
  });

  it('does not flag an ordinary upload', async () => {
    const [req, ctx] = makeUploadReq({ fileName: 'syllabus.pdf' });
    await POST(req, ctx);
    expect(insertMaterial).toHaveBeenCalledWith(expect.objectContaining({ isSyllabus: false }));
  });
```

`lib/capture/__tests__/upload-with-progress.test.ts` — add inside `describe('uploadFileWithProgress', ...)`:

```ts
  it('sends role=syllabus only when asked', async () => {
    const withRole = makeFakeXhr({ status: 200, responseText: '{}' });
    await uploadFileWithProgress({ url: '/x', file: pdf(), slug: 's', role: 'syllabus', xhrFactory: () => withRole as unknown as XMLHttpRequest });
    expect((withRole.send.mock.calls[0]![0] as FormData).get('role')).toBe('syllabus');

    const without = makeFakeXhr({ status: 200, responseText: '{}' });
    await uploadFileWithProgress({ url: '/x', file: pdf(), slug: 's', xhrFactory: () => without as unknown as XMLHttpRequest });
    expect((without.send.mock.calls[0]![0] as FormData).get('role')).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/lib/canvas/assemble-canvas-materials.test.ts app/api/courses/\[code\]/canvas-import/__tests__/route.test.ts app/api/courses/\[code\]/imscc-import/__tests__/route.test.ts tests/lib/capture/materials-policy.test.ts tests/api/course-materials.test.ts lib/capture/__tests__/upload-with-progress.test.ts`
Expected: FAIL — the two "imports Canvas: Syllabus even when…" tests (`expected [...] to include 'Canvas: Syllabus'`), the first assemble test and the policy test (`expected false to be true`), the two upload-route tests (`isSyllabus` missing from the insert call), and the role test (`expected null to be 'syllabus'`).

- [ ] **Step 3: Stop skipping the syllabus in `lib/canvas/assemble-canvas-materials.ts`**

Replace the doc comment, signature and syllabus block at the top of the function:

```ts
/**
 * Turn fetched/parsed Canvas content into the `Canvas:` text materials. Shared by
 * the Canvas-API import and the IMSCC import so both produce identical materials.
 */
export function assembleCanvasMaterials(
  data: CanvasCourseData,
  opts: { sheetsHasCatalog: boolean },
): AssembledMaterial[] {
  const { sheetsHasCatalog } = opts;
  const toInsert: AssembledMaterial[] = [];

  const syllabusText = htmlToText(data.course.syllabusHtml);
  // Suppress Canvas: Syllabus when the curated Sheets catalog already has LOs.
  // The Sheets row is the structured source of truth; the Canvas Syllabus page
  // tends to be a rambling, often-stale duplicate. Faculty can re-include by
  // un-ignoring the row in the Materials panel if Sheets is missing structure.
  if (syllabusText && !sheetsHasCatalog) {
    toInsert.push({ fileName: 'Canvas: Syllabus', text: syllabusText, mimeType: 'text/html' });
  } else if (syllabusText && sheetsHasCatalog) {
    console.log(`[canvas-import] suppressed Canvas: Syllabus (Sheets has LOs)`);
  }
```

with:

```ts
/**
 * Turn fetched/parsed Canvas content into the `Canvas:` text materials. Shared by
 * the Canvas-API import and the IMSCC import so both produce identical materials.
 * The syllabus page is always kept (owner decision 2026-10-05): it is the sole
 * source of the objective assessment guide's objectives, and insertMaterial flags
 * `Canvas: Syllabus` as the syllabus.
 */
export function assembleCanvasMaterials(data: CanvasCourseData): AssembledMaterial[] {
  const toInsert: AssembledMaterial[] = [];

  const syllabusText = htmlToText(data.course.syllabusHtml);
  if (syllabusText) {
    toInsert.push({ fileName: 'Canvas: Syllabus', text: syllabusText, mimeType: 'text/html' });
  }
```

- [ ] **Step 4: Update the three callers**

In `app/api/courses/[code]/canvas-import/route.ts` and `app/api/courses/[code]/imscc-import/route.ts`, replace:

```ts
  const sheetsHasCatalog = (course.learningObjectives ?? []).length > 0;
  const toInsert = assembleCanvasMaterials(data, { sheetsHasCatalog });
```

with:

```ts
  const toInsert = assembleCanvasMaterials(data);
```

In `app/api/courses/[code]/canvas-import/list-import.ts`, replace:

```ts
  const sheetsHasCatalog = (course.learningObjectives ?? []).length > 0;
  const assembledItems = assembleCanvasMaterials(data, { sheetsHasCatalog });
```

with:

```ts
  const assembledItems = assembleCanvasMaterials(data);
```

- [ ] **Step 5: Stop auto-setting the Canvas syllabus aside in `lib/capture/materials-policy.ts`**

Replace:

```ts
  const { fileName, extractedText, courseHasLearningObjectives } = input;

  if (fileName === 'Canvas: Syllabus' && courseHasLearningObjectives) {
    return {
      included: false,
      reason: 'Sheets has LOs — Canvas syllabus duplicates them',
      ferpaRisk: 'low',
      overridable: true,
    };
  }
```

with:

```ts
  // `courseHasLearningObjectives` no longer sets the Canvas syllabus aside: the
  // syllabus is the objective source (owner decision 2026-10-05). The field
  // stays on PolicyInput for its callers.
  const { fileName, extractedText } = input;
```

- [ ] **Step 6: Correct the in-app help copy in `app/capture/[code]/HelpPanel.tsx`**

Replace:

```tsx
                  <em>Canvas: Syllabus</em> is auto-ignored when your Sheets catalog already lists learning objectives, projects, and skills — the syllabus content is redundant.
```

with:

```tsx
                  <em>Canvas: Syllabus</em> may be set aside on courses imported before October 2026, when the importer treated it as a duplicate of the Sheets catalog. Include it: the syllabus is now where the course objectives are read from.
```

- [ ] **Step 7: Send and read the upload role**

In `lib/capture/upload-with-progress.ts`, add to `UploadOptions` after `slug: string;`:

```ts
  /** Marks the upload as the course syllabus (sent as form field `role`). */
  role?: 'syllabus';
```

change `const { url, file, slug, onProgress, signal, xhrFactory } = opts;` to:

```ts
  const { url, file, slug, role, onProgress, signal, xhrFactory } = opts;
```

and after `form.set('file', file);` add:

```ts
    if (role) form.set('role', role);
```

In `app/api/courses/[code]/materials/route.ts` POST, replace the `insertMaterial({ ... })` call with:

```ts
  const material = await insertMaterial({
    courseCode: code,
    fileName: file.name,
    blobUrl: stored.url,
    mimeType: file.type,
    sizeBytes: file.size,
    ipHash,
    // The Syllabus box sends role=syllabus; any other upload is not the syllabus.
    isSyllabus: form.get('role') === 'syllabus',
  });
```

- [ ] **Step 8: Run the tests and typecheck**

Run the Step 2 command again — Expected: PASS.
Run: `npx tsc --noEmit -p .` — Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add lib/canvas/assemble-canvas-materials.ts app/api/courses/\[code\]/canvas-import/route.ts \
  app/api/courses/\[code\]/imscc-import/route.ts app/api/courses/\[code\]/canvas-import/list-import.ts \
  lib/capture/materials-policy.ts app/capture/\[code\]/HelpPanel.tsx app/api/courses/\[code\]/materials/route.ts \
  lib/capture/upload-with-progress.ts tests/lib/canvas/assemble-canvas-materials.test.ts \
  app/api/courses/\[code\]/canvas-import/__tests__/route.test.ts app/api/courses/\[code\]/imscc-import/__tests__/route.test.ts \
  tests/lib/capture/materials-policy.test.ts tests/api/course-materials.test.ts lib/capture/__tests__/upload-with-progress.test.ts
git commit -m "feat(ingest): keep the Canvas syllabus and flag Syllabus-box uploads (role=syllabus)" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YFqkp83wAJeqVK7QHjRrPm"
```

---

### Task 6: Syllabus box lists the syllabus and Step 1 requires one

The Syllabus box lists every flagged syllabus with its readiness, offers "Include anyway" on a set-aside one, uploads with `role=syllabus`, and shows the required notice. Step 1's Continue is disabled until a syllabus exists. This builds on the commit already on `dev` (`0bfa13b`: an attached syllabus outranks "not in the Google Sheet" in the status text) — keep that precedence.

**Files:**
- Modify: `lib/capture/material-display.ts`
- Modify: `app/capture/[code]/MaterialsPanel.tsx` (type only), `lib/capture/fetch-course-materials.ts`, `app/api/capture/[code]/context/route.ts`, `app/capture/[code]/page.tsx`
- Modify (full rewrite): `app/capture/[code]/boxes/SyllabusBox.tsx`
- Modify: `app/capture/[code]/CaptureMaterialsStep.tsx`
- Test: `tests/lib/capture/material-display-syllabus.test.ts` (new), `app/capture/[code]/__tests__/SyllabusBox.test.tsx`, `app/capture/[code]/__tests__/CaptureMaterialsStep.test.tsx`
- Modify: `docs/STATE.md`

**Interfaces:**
- Consumes: `CourseMaterialRow.isSyllabus` (Task 2); `UploadOptions.role` (Task 5); `materialReadability`, `materialProvenance`, `PROVENANCE_LABEL` (existing, `lib/capture/material-display.ts`); PATCH `/api/courses/[code]/materials/[id]?slug=` with `{ ignored: false }` (existing include-anyway endpoint).
- Produces: `CaptureMaterial.isSyllabus?: boolean`; `syllabusMaterials<T extends SyllabusLike>(materials: T[]): T[]`, `hasSyllabusMaterial(materials: SyllabusLike[]): boolean`, `syllabusReadinessLabel(m: { ignored: boolean; indexingStatus: string; setAsideReason?: string | null }, triageEnabled: boolean): string` where `SyllabusLike = { isSyllabus?: boolean; retiredAt?: string | Date | null }`; `SyllabusBox` prop `triageEnabled?: boolean`.

- [ ] **Step 1: Write the failing tests**

`tests/lib/capture/material-display-syllabus.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { syllabusMaterials, hasSyllabusMaterial, syllabusReadinessLabel } from '@/lib/capture/material-display';

describe('syllabusMaterials / hasSyllabusMaterial', () => {
  it('counts flagged, unretired materials — set-aside ones included', () => {
    const mats = [
      { id: 'a', isSyllabus: true, retiredAt: null },
      { id: 'b', isSyllabus: true, retiredAt: '2026-10-01T00:00:00Z' },
      { id: 'c', isSyllabus: false, retiredAt: null },
      { id: 'd' },
    ];
    expect(syllabusMaterials(mats).map((m) => m.id)).toEqual(['a']);
    expect(hasSyllabusMaterial(mats)).toBe(true);
    expect(hasSyllabusMaterial([{ isSyllabus: false }])).toBe(false);
  });
});

describe('syllabusReadinessLabel', () => {
  it('says plainly when the syllabus is set aside', () => {
    expect(syllabusReadinessLabel({ ignored: true, indexingStatus: 'ready' }, true)).toBe('set aside — not sent to the AI');
  });
  it('a pending upload in the triage flow waits for Ingest', () => {
    expect(syllabusReadinessLabel({ ignored: false, indexingStatus: 'pending' }, true)).toBe('attached — will be read when you ingest');
  });
  it('otherwise uses the usual readability label', () => {
    expect(syllabusReadinessLabel({ ignored: false, indexingStatus: 'pending' }, false)).toBe('not indexed yet');
    expect(syllabusReadinessLabel({ ignored: false, indexingStatus: 'ready' }, true)).toBe('ready');
  });
});
```

`app/capture/[code]/__tests__/SyllabusBox.test.tsx` — make these edits:

1. After the existing `vi.mock('@/lib/capture/fetch-course-materials', ...)` line, add:

```tsx
const { uploadFileWithProgress } = vi.hoisted(() => ({ uploadFileWithProgress: vi.fn() }));
vi.mock('@/lib/capture/upload-with-progress', () => ({ uploadFileWithProgress }));
```

2. In the `Harness` component, add a `triageEnabled = false` prop (type `triageEnabled?: boolean`) and pass `triageEnabled={triageEnabled}` to `<SyllabusBox>`.

3. Replace these existing tests:
   - `'collapsed status reflects an attached syllabus when no sheet sync'` → body:
     ```tsx
     render(<Harness materials={[M('syllabus.pdf', { isSyllabus: true })]} />);
     expect(screen.getByText(/syllabus\.pdf attached/i)).toBeTruthy();
     ```
   - In `'shows a differ-warning when both a sheet catalog and an attached syllabus are present'`, change `materials={[M('syllabus.pdf')]}` to `materials={[M('syllabus.pdf', { isSyllabus: true })]}`.
   - In `'names an attached syllabus even when the course is not in the sheet'`, change `materials={[M('MKT 4320 Simple Syllabus.pdf')]}` to `materials={[M('MKT 4320 Simple Syllabus.pdf', { isSyllabus: true })]}`.

4. Add these tests at the end of `describe('SyllabusBox', ...)`:

```tsx
  it('recognises the syllabus by its flag, not its file name', () => {
    render(<Harness materials={[M('syllabus.pdf'), M('course outline.pdf', { isSyllabus: true })]} />);
    expect(screen.getByText(/course outline\.pdf attached/i)).toBeTruthy();
    expect(screen.queryByText(/^— syllabus\.pdf attached/i)).toBeNull();
  });

  it('shows the required notice until a syllabus exists', () => {
    const { unmount } = render(<Harness catalogSyncedAt={new Date().toISOString()} />);
    expect(screen.getByText('Add the course syllabus: import it from Canvas or upload it here.')).toBeTruthy();
    unmount();
    render(<Harness materials={[M('Canvas: Syllabus', { isSyllabus: true })]} />);
    expect(screen.queryByText(/Add the course syllabus/)).toBeNull();
  });

  it('lists each recognised syllabus with its readiness', () => {
    render(
      <Harness
        triageEnabled
        materials={[
          M('outline.pdf', { isSyllabus: true, indexingStatus: 'pending' }),
          M('Canvas: Syllabus', { isSyllabus: true, indexingStatus: 'ready' }),
        ]}
      />,
    );
    const list = screen.getByRole('list', { name: /syllabus materials/i });
    expect(list.textContent).toContain('outline.pdf');
    expect(list.textContent).toContain('attached — will be read when you ingest');
    expect(list.textContent).toContain('Canvas: Syllabus');
    expect(list.textContent).toContain('ready');
  });

  it('offers Include anyway on a FERPA set-aside syllabus and PATCHes ignored:false', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    render(
      <Harness
        materials={[M('MKT 4320 syllabus.pdf', {
          id: 'syl-1', isSyllabus: true, ignored: true, autoSetAside: true, ferpaRisk: 'high',
          setAsideReason: 'FERPA risk detected (emails) — set aside automatically',
        })]}
      />,
    );
    expect(screen.getByText(/FERPA risk detected/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Include anyway' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/materials/syl-1?slug=s1');
    expect((init as RequestInit).method).toBe('PATCH');
    expect((init as RequestInit).body).toBe(JSON.stringify({ ignored: false }));
  });

  it('uploads through the box as the syllabus (role=syllabus)', async () => {
    uploadFileWithProgress.mockResolvedValue({ ok: true, status: 200, json: {} });
    const { container } = render(<Harness />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array(10)], 'outline.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(uploadFileWithProgress).toHaveBeenCalled());
    expect(uploadFileWithProgress.mock.calls[0]![0]).toMatchObject({ role: 'syllabus' });
  });
```

`app/capture/[code]/__tests__/CaptureMaterialsStep.test.tsx` — make these edits:

1. In `it('Continue calls onContinue', ...)`, change `materials={[mat({})]}` to `materials={[mat({ isSyllabus: true })]}`.
2. In `describe('CaptureMaterialsStep — triageEnabled flag', ...)`, change `materials: [mat({})],` in `baseProps` to `materials: [mat({ isSyllabus: true })],`.
3. Replace `it('offers a start-anyway path when there are no materials and no synced syllabus', ...)` with:

```tsx
  it('the start-anyway path is disabled until a syllabus exists', () => {
    const onContinue = vi.fn();
    render(<CaptureMaterialsStep course={course} materials={[]} slug="s" catalogSyncedAt={null} onMaterialsChange={noop} onCourseChange={noop} onContinue={onContinue} instructor={defaultInstructor} onInstructorChange={noop} />);
    const btn = screen.getByRole('button', { name: /start without/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(btn);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('cannot continue past Step 1 without a syllabus', () => {
    const onContinue = vi.fn();
    render(<CaptureMaterialsStep course={course} materials={[mat({})]} slug="s" catalogSyncedAt={null} onMaterialsChange={noop} onCourseChange={noop} onContinue={onContinue} instructor={defaultInstructor} onInstructorChange={noop} />);
    expect(screen.getByText('Add the course syllabus to continue.')).toBeTruthy();
    const btn = screen.getByRole('button', { name: /continue to interview/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(btn);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('a set-aside syllabus still counts as present for the gate', () => {
    render(<CaptureMaterialsStep course={course} materials={[mat({ isSyllabus: true, ignored: true })]} slug="s" catalogSyncedAt={null} onMaterialsChange={noop} onCourseChange={noop} onContinue={noop} instructor={defaultInstructor} onInstructorChange={noop} />);
    expect((screen.getByRole('button', { name: /continue to interview/i }) as HTMLButtonElement).disabled).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/lib/capture/material-display-syllabus.test.ts app/capture/\[code\]/__tests__/SyllabusBox.test.tsx app/capture/\[code\]/__tests__/CaptureMaterialsStep.test.tsx`
Expected: FAIL — `syllabusMaterials is not a function`; SyllabusBox tests fail on the missing notice/list/role (`Unable to find … Add the course syllabus`); the Step-1 tests fail because Continue is enabled.

- [ ] **Step 3: Add the helpers to `lib/capture/material-display.ts`**

After the `materialReadability` function, add:

```ts
// ---------------------------------------------------------------------------
// Syllabus (spec 2026-10-05): found by the is_syllabus flag, never by name.
// ---------------------------------------------------------------------------

export interface SyllabusLike { isSyllabus?: boolean; retiredAt?: string | Date | null }

/** Flagged, unretired syllabus materials — including set-aside ones. */
export function syllabusMaterials<T extends SyllabusLike>(materials: T[]): T[] {
  return materials.filter((m) => m.isSyllabus === true && !m.retiredAt);
}

/** True when the course has a syllabus (the Step-1 requirement). */
export function hasSyllabusMaterial(materials: SyllabusLike[]): boolean {
  return syllabusMaterials(materials).length > 0;
}

/** Readiness wording for a syllabus row in the Syllabus box. */
export function syllabusReadinessLabel(
  m: { ignored: boolean; indexingStatus: string; setAsideReason?: string | null },
  triageEnabled: boolean,
): string {
  if (m.ignored) return 'set aside — not sent to the AI';
  if (triageEnabled && m.indexingStatus === 'pending') return 'attached — will be read when you ingest';
  return materialReadability(m).label;
}
```

- [ ] **Step 4: Carry `isSyllabus` to the client**

`app/capture/[code]/MaterialsPanel.tsx` — in `interface CaptureMaterial`, after `retiredAt: string | null;` add:

```ts
  /** True when this material is the course syllabus (course_materials.is_syllabus). */
  isSyllabus?: boolean;
```

`app/api/capture/[code]/context/route.ts` — in the `materials: materials.map(m => ({ ... }))` object, after `retiredAt: m.retiredAt ? m.retiredAt.toISOString() : null,` add:

```ts
      isSyllabus: m.isSyllabus,
```

`app/capture/[code]/page.tsx` — in the `materialsView` map object, after `retiredAt: m.retiredAt ? m.retiredAt.toISOString() : null,` add:

```ts
    isSyllabus: m.isSyllabus,
```

`lib/capture/fetch-course-materials.ts` — in the `mapContextToMaterials` parameter type, after `retiredAt?: string | null;` add `isSyllabus?: boolean;`, and change the return line to:

```ts
  return json.materials.map(m => ({ ...m, sourceCode: m.sourceCode ?? null, tier: m.tier ?? null, rawCleared: m.rawCleared ?? false, retiredAt: m.retiredAt ?? null, isSyllabus: m.isSyllabus ?? false }));
```

- [ ] **Step 5: Rewrite `app/capture/[code]/boxes/SyllabusBox.tsx`**

Replace the whole file with:

```tsx
'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CatalogOverview } from '../CatalogOverview';
import type { CaptureMaterial, CourseCatalogView } from '../MaterialsPanel';
import { fetchCourseMaterials } from '@/lib/capture/fetch-course-materials';
import { uploadFileWithProgress } from '@/lib/capture/upload-with-progress';
import { UploadProgressBar, type UploadProgressState } from '../UploadProgressBar';
import {
  isSyllabusCanvasMaterial,
  materialProvenance,
  catalogContributionSummary,
  syllabusMaterials,
  syllabusReadinessLabel,
  PROVENANCE_LABEL,
} from '@/lib/capture/material-display';

interface Props {
  course: CourseCatalogView;
  /** When the GC-sheet catalog was last synced (ISO), or null if never. */
  catalogSyncedAt: string | null;
  materials: CaptureMaterial[];
  slug: string;
  onCourseChange: (next: CourseCatalogView) => void;
  onMaterialsChange: (next: CaptureMaterial[]) => void;
  /** Two-phase triage flow: uploads wait for the Ingest step, so "pending" is expected. */
  triageEnabled?: boolean;
}

const ALLOWED_UPLOAD_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/**
 * One recognised syllabus (flagged is_syllabus, uploaded or Canvas) with its
 * readiness, and — when it is set aside — the reason plus the include control.
 * Include mirrors OtherMaterialsBox's FERPA include-anyway: optimistic local
 * update, PATCH {ignored:false}, revert + error on failure.
 */
function SyllabusRow({
  m,
  courseCode,
  slug,
  triageEnabled,
  allMaterials,
  onMaterialsChange,
}: {
  m: CaptureMaterial;
  courseCode: string;
  slug: string;
  triageEnabled: boolean;
  allMaterials: CaptureMaterial[];
  onMaterialsChange: (next: CaptureMaterial[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function include(): Promise<void> {
    setBusy(true);
    setError(null);
    const previous = allMaterials;
    onMaterialsChange(allMaterials.map((x) => (x.id === m.id ? { ...x, ignored: false } : x)));
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(courseCode)}/materials/${encodeURIComponent(m.id)}?slug=${encodeURIComponent(slug)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ignored: false }),
        },
      );
      if (!res.ok) {
        onMaterialsChange(previous);
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Failed (${res.status})`);
      }
    } catch (e) {
      onMaterialsChange(previous);
      setError(e instanceof Error ? e.message : 'Failed to include');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-1 px-3 py-2">
      <div className="flex items-center gap-2">
        <span aria-hidden className="w-4 shrink-0 text-center text-sm">📄</span>
        <span className="min-w-0 flex-1 truncate text-sm">{m.fileName}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {PROVENANCE_LABEL[materialProvenance(m)]}
        </span>
        <span className={'shrink-0 text-[11px] ' + (m.ignored ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>
          {syllabusReadinessLabel(m, triageEnabled)}
        </span>
      </div>
      {m.ignored && (
        <div className="flex items-start justify-between gap-2 rounded border border-amber-200 bg-amber-50/50 px-2 py-1">
          <p className="text-[11px] leading-snug italic text-amber-800">
            {m.setAsideReason ?? (m.autoSetAside ? 'set aside automatically' : 'set aside by hand')}
          </p>
          <button
            type="button"
            onClick={() => void include()}
            disabled={busy}
            className="shrink-0 text-[11px] font-medium text-amber-900 underline hover:text-amber-700 disabled:opacity-50"
          >
            {busy ? 'Including…' : m.autoSetAside ? 'Include anyway' : 'Include'}
          </button>
        </div>
      )}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </li>
  );
}

/**
 * Box 1 of the three-source capture surface — the course's syllabus / catalog
 * context. The syllabus is required (owner decision 2026-10-05): it is found by
 * the is_syllabus flag, listed here whether uploaded or imported from Canvas,
 * and until one exists the box shows the required notice and Step 1 cannot be
 * passed. The synced GC-sheet catalog is still shown when unrolled; when it and
 * an uploaded syllabus both exist we surface a discrepancy note (never merge).
 */
export function SyllabusBox({
  course,
  catalogSyncedAt,
  materials,
  slug,
  onCourseChange,
  onMaterialsChange,
  triageEnabled = false,
}: Props) {
  useRouter();
  const [open, setOpen] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(catalogSyncedAt);
  const [resyncing, setResyncing] = useState(false);
  const [resyncError, setResyncError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgressState | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const syllabi = syllabusMaterials(materials);
  const hasSyllabus = syllabi.length > 0;
  // An attached syllabus = a flagged syllabus that faculty uploaded (not Canvas).
  const attachedSyllabus = syllabi.find((m) => materialProvenance(m) === 'uploaded');
  // A stamp alone isn't enough — Google returns non-errors for missing tabs,
  // so the sync-from-sheet route may have written a blank row in the past.
  // Require real catalog content (non-empty summary) in addition to a syncedAt
  // timestamp so legacy wrongly-stamped rows don't show as "synced".
  const hasCatalogContent = catalogContributionSummary(course) !== 'no catalog details synced yet';
  const hasSheetCatalog = syncedAt !== null && hasCatalogContent;
  const hasCanvasSyllabus = materials.some(isSyllabusCanvasMaterial);

  // Differ-warning: a sheet catalog AND a separately-attached syllabus are both
  // present — two syllabus sources that may disagree. Surface, never merge.
  const showDiffer = hasSheetCatalog && !!attachedSyllabus;

  const statusText = hasSheetCatalog
    ? `synced to Google Sheet on ${new Date(syncedAt!).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' })}`
    : attachedSyllabus
      ? `${attachedSyllabus.fileName} attached`
      : syncedAt !== null && !hasCatalogContent
        ? 'not in the Google Sheet — attach a syllabus'
        : 'add a syllabus';

  async function resync() {
    setResyncing(true);
    setResyncError(null);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(course.code)}/sync-from-sheet?slug=${encodeURIComponent(slug)}`,
        { method: 'POST' },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResyncError(
          res.status === 404 ? 'no sheet tab for this course' : ((json as { error?: string }).error ?? 'sync failed'),
        );
        return;
      }
      const c = (json as { course?: Record<string, unknown> }).course;
      if (c) {
        onCourseChange({
          ...course,
          description: (c.description as string) ?? course.description,
          prerequisites: (c.prerequisites as string) ?? course.prerequisites,
          learningObjectives: (c.learningObjectives as string[]) ?? course.learningObjectives,
          majorProjects: (c.majorProjects as string[]) ?? course.majorProjects,
          skillsRequired: (c.skillsRequired as string[]) ?? course.skillsRequired,
        });
        setSyncedAt((c.lastSyncedAt as string) ?? new Date().toISOString());
      }
    } catch {
      setResyncError('sync failed');
    } finally {
      setResyncing(false);
    }
  }

  async function handleFiles(files: FileList | null) {
    setUploadError(null);
    if (!files || files.length === 0) return;
    const file = files[0]!;
    if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
      setUploadError('Only PDF or DOCX files are accepted.');
      return;
    }
    setUploading(file.name);
    setProgress({ fileName: file.name, index: 1, total: 1, pct: 0 });
    try {
      const res = await uploadFileWithProgress({
        url: `/api/courses/${encodeURIComponent(course.code)}/materials`,
        file,
        slug,
        role: 'syllabus',
        onProgress: (p) => setProgress({ fileName: file.name, index: 1, total: 1, pct: p.pct }),
      });
      if (!res.ok) {
        setUploadError((res.json as { error?: string }).error ?? `Upload failed (${res.status})`);
        return;
      }
      const fresh = await fetchCourseMaterials(course.code, slug);
      if (fresh) onMaterialsChange(fresh);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(null);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <section className="rounded-md border bg-card">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
        >
          <span aria-hidden className="w-4 text-muted-foreground">
            {open ? '▾' : '▸'}
          </span>
          <span aria-hidden className="w-5 text-center">📋</span>
          <span className="text-sm font-medium">Syllabus &amp; course info</span>
          <span className="truncate text-xs text-muted-foreground">— {statusText}</span>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {(hasSheetCatalog || (syncedAt !== null && !hasCatalogContent)) && (
            <button
              type="button"
              onClick={resync}
              disabled={resyncing}
              className="rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              {resyncing ? 'Re-syncing…' : 'Re-sync'}
            </button>
          )}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading !== null}
            title={hasSheetCatalog
              ? 'Attach a syllabus document — it will be used alongside the synced Google-Sheet catalog; differences are surfaced, never merged'
              : undefined}
            className="rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {uploading ? 'Attaching…' : hasSheetCatalog ? 'Replace syllabus' : 'Attach a syllabus'}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      </div>

      {!hasSyllabus && (
        <p
          role="alert"
          className="mx-4 mb-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900 dark:bg-amber-900/20 dark:text-amber-200"
        >
          Add the course syllabus: import it from Canvas or upload it here.
        </p>
      )}

      {hasSyllabus && (
        <ul aria-label="Syllabus materials" className="mx-4 mb-2 divide-y rounded border">
          {syllabi.map((m) => (
            <SyllabusRow
              key={m.id}
              m={m}
              courseCode={course.code}
              slug={slug}
              triageEnabled={triageEnabled}
              allMaterials={materials}
              onMaterialsChange={onMaterialsChange}
            />
          ))}
        </ul>
      )}

      {progress && (
        <div className="px-4 pb-2">
          <UploadProgressBar state={progress} />
        </div>
      )}
      {resyncError && <p className="px-4 pb-1 text-[11px] text-amber-700 dark:text-amber-400">{resyncError}</p>}
      {uploadError && <p className="px-4 pb-1 text-[11px] text-amber-700 dark:text-amber-400">{uploadError}</p>}

      {showDiffer && (
        <p className="mx-4 mb-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          ⚠ a different syllabus is also attached — review
        </p>
      )}

      {open && (
        <div className="border-t px-4 py-3">
          <CatalogOverview
            description={course.description}
            prerequisites={course.prerequisites}
            learningObjectives={course.learningObjectives}
            majorProjects={course.majorProjects}
            skillsRequired={course.skillsRequired}
          />
          {hasCanvasSyllabus && (
            <p className="mt-2 text-[11px] italic text-muted-foreground">
              (a Canvas syllabus is also available — see Canvas)
            </p>
          )}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Gate Step 1 in `app/capture/[code]/CaptureMaterialsStep.tsx`**

Add the import after `import { CaptureWhyBlurb } from './CaptureWhyBlurb';`:

```tsx
import { hasSyllabusMaterial } from '@/lib/capture/material-display';
```

Replace:

```tsx
  // An instructor must be chosen before continuing — captures are attributed
  // per instructor, so an unselected (empty) name can't be allowed through.
  const needsInstructor = instructor.trim() === '';
```

with:

```tsx
  // An instructor must be chosen before continuing — captures are attributed
  // per instructor, so an unselected (empty) name can't be allowed through.
  const needsInstructor = instructor.trim() === '';
  // Every course must have a syllabus (owner decision 2026-10-05): it is the
  // source of the objectives in the objective assessment guide. A set-aside
  // syllabus still counts as present; the Syllabus box offers to include it.
  const needsSyllabus = !hasSyllabusMaterial(materials);
  const blocked = needsInstructor || needsSyllabus;
```

In both `<SyllabusBox ... />` usages, add the prop `triageEnabled={triageEnabled}` after `onMaterialsChange={onMaterialsChange}`.

Replace the footer block:

```tsx
      <div className="mt-6 flex items-center justify-end gap-4">
        {needsInstructor && (
          <span className="text-xs text-muted-foreground">Select an instructor to continue.</span>
        )}
        {isEmpty ? (
          <button type="button" onClick={onContinue} disabled={needsInstructor}
```

with:

```tsx
      <div className="mt-6 flex items-center justify-end gap-4">
        {needsSyllabus && (
          <span className="text-xs text-muted-foreground">Add the course syllabus to continue.</span>
        )}
        {needsInstructor && (
          <span className="text-xs text-muted-foreground">Select an instructor to continue.</span>
        )}
        {isEmpty ? (
          <button type="button" onClick={onContinue} disabled={blocked}
```

and in the `else` branch change `<button type="button" onClick={onContinue} disabled={needsInstructor}` to `<button type="button" onClick={onContinue} disabled={blocked}`.

- [ ] **Step 7: Run the tests and typecheck**

Run the Step 2 command again — Expected: PASS.
Run: `pnpm vitest run app/capture` — Expected: PASS (OtherMaterialsBox, CanvasBox, TriageStep, CaptureClientTriage unaffected).
Run: `npx tsc --noEmit -p .` — Expected: no errors.

- [ ] **Step 8: Update `docs/STATE.md`**

In the Faculty-surfaces row for `/capture/[code]`, replace the cell text `**CourseCapture v1** — audit conversation → confirmed Course Outcome Profile + immutable snapshots` with:

```markdown
**CourseCapture v1** — audit conversation → confirmed Course Outcome Profile + immutable snapshots. **Syllabus required at Step 1 (2026-10-05):** Continue is disabled until a material flagged `is_syllabus` exists; the Syllabus box lists every flagged syllabus (uploaded or `Canvas: Syllabus`) with its readiness ("attached — will be read when you ingest" in the triage flow), offers Include anyway / Include on a set-aside one, and uploads with `role=syllabus`. The Canvas importer no longer skips or auto-sets-aside the syllabus page.
```

- [ ] **Step 9: Commit**

```bash
git add lib/capture/material-display.ts app/capture/\[code\]/MaterialsPanel.tsx lib/capture/fetch-course-materials.ts \
  app/api/capture/\[code\]/context/route.ts app/capture/\[code\]/page.tsx app/capture/\[code\]/boxes/SyllabusBox.tsx \
  app/capture/\[code\]/CaptureMaterialsStep.tsx tests/lib/capture/material-display-syllabus.test.ts \
  app/capture/\[code\]/__tests__/SyllabusBox.test.tsx app/capture/\[code\]/__tests__/CaptureMaterialsStep.test.tsx docs/STATE.md
git commit -m "feat(capture): Syllabus box lists the syllabus with include-anyway; Step 1 requires one" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YFqkp83wAJeqVK7QHjRrPm"
```

---

### Task 7: The wiki section "Assessing the course objectives"

**Files:**
- Create: `lib/objective-guide/render.ts`
- Create: `lib/wiki/objective-guide-section.ts`
- Create: `app/wiki/ObjectiveGuidePanel.tsx`, `app/wiki/CopyGuideButton.tsx`
- Modify: `app/wiki/[type]/[slug]/page.tsx`
- Modify: `app/globals.css`
- Test: `lib/objective-guide/__tests__/render.test.ts`, `lib/wiki/__tests__/objective-guide-section.test.ts`, `app/wiki/__tests__/ObjectiveGuidePanel.test.tsx`
- Modify: `docs/STATE.md`

**Interfaces:**
- Consumes: `ObjectiveGuide`, `GuideEvidence`, `GuideMeasure` (Task 1); `getObjectiveGuide`, `StoredObjectiveGuide` (Task 2); `listSyllabusMaterials` (Task 2); `pickSyllabus`, `SyllabusPick` (Task 4); `getLatestSnapshotByCourse`; `courses` table.
- Produces:
  - `render.ts`: `MEASURE_LABEL: Record<GuideMeasure, string>`, `CLASS_LEVEL_NOTE: string`, `formatEvidence(e: GuideEvidence): string`, `renderGuideText(guide: ObjectiveGuide, course: { code: string; title: string }): string`.
  - `objective-guide-section.ts`: `type ObjectiveGuideSection = { kind: 'guide'; guide: ObjectiveGuide; text: string; capturedOn: string } | { kind: 'no-syllabus' } | { kind: 'syllabus-set-aside' }`, `decideGuideSection(args: { course: { code: string; title: string }; stored: StoredObjectiveGuide | null; hasSnapshot: boolean; syllabus: SyllabusPick }): ObjectiveGuideSection | null`, `loadObjectiveGuideSection(codeAnyCase: string): Promise<ObjectiveGuideSection | null>`.
  - `ObjectiveGuidePanel({ section })`, `NO_SYLLABUS_NOTICE`, `SET_ASIDE_NOTICE`; `CopyGuideButton({ text })`.

- [ ] **Step 1: Write the failing tests**

`lib/objective-guide/__tests__/render.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderGuideText, formatEvidence, MEASURE_LABEL } from '../render';
import type { ObjectiveGuide } from '../schema';

const GUIDE: ObjectiveGuide = {
  intro: 'At the end of the semester, a few class-level numbers from Canvas show how well students met each objective.',
  objectives: [
    { objective: 'Develop a brand strategy grounded in audience research.', measure: 'clear',
      evidence: [{ assignment: 'Brand Audit', rubric_row: 'Research depth' }], gather: 'The score distribution on the Research depth row.', suggestion: null },
    { objective: 'Present a strategic rationale to a client.', measure: 'none', evidence: [],
      gather: 'Nothing is graded on this yet.', suggestion: 'Add a Presentation row to the Final Brand Playbook rubric.' },
  ],
  checklist: [{ assignment: 'Brand Audit', rubric_row: 'Research depth' }],
};

describe('renderGuideText', () => {
  it('renders the guide as plain instructions to a person', () => {
    expect(renderGuideText(GUIDE, { code: 'MKT 4320', title: 'Brand Management' })).toBe([
      'Assessing the course objectives: MKT 4320 Brand Management',
      '',
      'At the end of the semester, a few class-level numbers from Canvas show how well students met each objective.',
      '',
      '1. Develop a brand strategy grounded in audience research.',
      '   How it is measured now: Clearly measured',
      '   Where the evidence is: Brand Audit, rubric row "Research depth"',
      '   What to gather: The score distribution on the Research depth row.',
      '',
      '2. Present a strategic rationale to a client.',
      '   How it is measured now: No graded measure yet',
      '   Where the evidence is: no graded item yet',
      '   What to gather: Nothing is graded on this yet.',
      '   Smallest change that would help: Add a Presentation row to the Final Brand Playbook rubric.',
      '',
      'Items to pull from Canvas at the end of the semester:',
      '- Brand Audit, rubric row "Research depth"',
      '',
      "Report class-level numbers only, such as score distributions and the share of students at each level. Do not include any student's name or individual grade.",
    ].join('\n'));
  });

  it('says so when no objective could be quoted', () => {
    const text = renderGuideText({ intro: 'Intro.', objectives: [], checklist: [] }, { code: 'GC 1010', title: 'Intro' });
    expect(text).toContain('No learning objectives could be quoted from the syllabus.');
    expect(text).not.toContain('Items to pull from Canvas');
  });

  it('labels and evidence formatting', () => {
    expect(MEASURE_LABEL).toEqual({ clear: 'Clearly measured', partial: 'Partly measured', none: 'No graded measure yet' });
    expect(formatEvidence({ assignment: 'Reading Quiz 1', rubric_row: null })).toBe('Reading Quiz 1');
  });
});
```

`lib/wiki/__tests__/objective-guide-section.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { decideGuideSection } from '../objective-guide-section';
import type { StoredObjectiveGuide } from '@/lib/db/objective-guides-queries';

const course = { code: 'MKT 4320', title: 'Brand Management' };
const guide = { intro: 'Intro.', objectives: [], checklist: [] };
const stored: StoredObjectiveGuide = {
  courseCode: 'MKT 4320', snapshotId: 'snap-1', guide, droppedNames: [], model: 'gpt-test',
  generatedAt: new Date('2026-10-06T12:00:00Z'), snapshotCreatedAt: new Date('2026-10-05T15:00:00Z'),
};

describe('decideGuideSection', () => {
  it('shows the stored guide with its capture date and plain text', () => {
    const s = decideGuideSection({ course, stored, hasSnapshot: true, syllabus: { status: 'no-syllabus' } });
    expect(s).toMatchObject({ kind: 'guide', guide, capturedOn: '2026-10-05' });
    expect(s && s.kind === 'guide' && s.text.startsWith('Assessing the course objectives: MKT 4320 Brand Management')).toBe(true);
  });

  it('falls back to the generation date when the snapshot is gone', () => {
    const s = decideGuideSection({ course, stored: { ...stored, snapshotCreatedAt: null }, hasSnapshot: true, syllabus: { status: 'no-syllabus' } });
    expect(s).toMatchObject({ kind: 'guide', capturedOn: '2026-10-06' });
  });

  it('tells a captured course with no syllabus to provide one', () => {
    expect(decideGuideSection({ course, stored: null, hasSnapshot: true, syllabus: { status: 'no-syllabus' } })).toEqual({ kind: 'no-syllabus' });
  });

  it('tells a captured course whose syllabus is set aside to include it', () => {
    expect(decideGuideSection({ course, stored: null, hasSnapshot: true, syllabus: { status: 'syllabus-set-aside' } })).toEqual({ kind: 'syllabus-set-aside' });
  });

  it('omits the section for uncaptured courses and for a guide not yet built', () => {
    expect(decideGuideSection({ course, stored: null, hasSnapshot: false, syllabus: { status: 'no-syllabus' } })).toBeNull();
    expect(decideGuideSection({ course, stored: null, hasSnapshot: true, syllabus: { status: 'ok', syllabi: [{ id: 's', fileName: 'f', text: 't' }] } })).toBeNull();
  });
});
```

`app/wiki/__tests__/ObjectiveGuidePanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ObjectiveGuidePanel, NO_SYLLABUS_NOTICE, SET_ASIDE_NOTICE } from '../ObjectiveGuidePanel';
import type { ObjectiveGuideSection } from '@/lib/wiki/objective-guide-section';

const SECTION: ObjectiveGuideSection = {
  kind: 'guide',
  capturedOn: '2026-10-05',
  text: 'PLAIN TEXT VERSION',
  guide: {
    intro: 'Pull a few class-level numbers at the end of term.',
    objectives: [
      { objective: 'Develop a brand strategy grounded in audience research.', measure: 'clear',
        evidence: [{ assignment: 'Brand Audit', rubric_row: 'Research depth' }], gather: 'The Research depth distribution.', suggestion: null },
      { objective: 'Present a strategic rationale to a client.', measure: 'partial',
        evidence: [{ assignment: 'Final Brand Playbook', rubric_row: null }], gather: 'The playbook score distribution.', suggestion: 'Add a Rationale row.' },
    ],
    checklist: [{ assignment: 'Brand Audit', rubric_row: 'Research depth' }, { assignment: 'Final Brand Playbook', rubric_row: null }],
  },
};

describe('ObjectiveGuidePanel', () => {
  it('renders the section title, each objective with its label, the checklist and the footnote', () => {
    render(<ObjectiveGuidePanel section={SECTION} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Assessing the course objectives' })).toBeTruthy();
    expect(screen.getByText('Develop a brand strategy grounded in audience research.')).toBeTruthy();
    expect(screen.getByText('Clearly measured')).toBeTruthy();
    expect(screen.getByText('Partly measured')).toBeTruthy();
    expect(screen.getByText('Add a Rationale row.')).toBeTruthy();
    const checklist = screen.getByRole('list', { name: /items to pull from canvas/i });
    expect(checklist.textContent).toContain('Brand Audit, rubric row "Research depth"');
    expect(checklist.textContent).toContain('Final Brand Playbook');
    expect(screen.getByText(/Built from the capture of Oct 5, 2026\./)).toBeTruthy();
  });

  it('Copy as text puts the plain-text rendering on the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<ObjectiveGuidePanel section={SECTION} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy as text' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('PLAIN TEXT VERSION'));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('shows the no-syllabus and set-aside notices', () => {
    const { unmount } = render(<ObjectiveGuidePanel section={{ kind: 'no-syllabus' }} />);
    expect(screen.getByText(NO_SYLLABUS_NOTICE)).toBeTruthy();
    unmount();
    render(<ObjectiveGuidePanel section={{ kind: 'syllabus-set-aside' }} />);
    expect(screen.getByText(SET_ASIDE_NOTICE)).toBeTruthy();
    expect(SET_ASIDE_NOTICE).toContain('the syllabus is set aside');
    expect(SET_ASIDE_NOTICE).toContain('include it on the capture page');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run lib/objective-guide/__tests__/render.test.ts lib/wiki/__tests__/objective-guide-section.test.ts app/wiki/__tests__/ObjectiveGuidePanel.test.tsx`
Expected: FAIL — unresolved `../render`, `../objective-guide-section`, `../ObjectiveGuidePanel`.

- [ ] **Step 3: Write `lib/objective-guide/render.ts`**

```ts
import type { GuideEvidence, GuideMeasure, ObjectiveGuide } from './schema';

export const MEASURE_LABEL: Record<GuideMeasure, string> = {
  clear: 'Clearly measured',
  partial: 'Partly measured',
  none: 'No graded measure yet',
};

export const CLASS_LEVEL_NOTE =
  "Report class-level numbers only, such as score distributions and the share of students at each level. Do not include any student's name or individual grade.";

export function formatEvidence(e: GuideEvidence): string {
  return e.rubric_row ? `${e.assignment}, rubric row "${e.rubric_row}"` : e.assignment;
}

/**
 * The plain-text guide: what the Copy-as-text button copies and what a faculty
 * member can hand, unchanged, to a Canvas-connected agent. It must read as
 * ordinary instructions to a person, not as an AI prompt.
 */
export function renderGuideText(guide: ObjectiveGuide, course: { code: string; title: string }): string {
  const lines: string[] = [
    `Assessing the course objectives: ${course.code} ${course.title}`,
    '',
    guide.intro.trim(),
    '',
  ];
  if (guide.objectives.length === 0) {
    lines.push('No learning objectives could be quoted from the syllabus.', '');
  }
  guide.objectives.forEach((o, i) => {
    lines.push(`${i + 1}. ${o.objective}`);
    lines.push(`   How it is measured now: ${MEASURE_LABEL[o.measure]}`);
    lines.push(`   Where the evidence is: ${o.evidence.length > 0 ? o.evidence.map(formatEvidence).join('; ') : 'no graded item yet'}`);
    lines.push(`   What to gather: ${o.gather.trim()}`);
    if (o.suggestion) lines.push(`   Smallest change that would help: ${o.suggestion.trim()}`);
    lines.push('');
  });
  if (guide.checklist.length > 0) {
    lines.push('Items to pull from Canvas at the end of the semester:');
    for (const c of guide.checklist) lines.push(`- ${formatEvidence(c)}`);
    lines.push('');
  }
  lines.push(CLASS_LEVEL_NOTE);
  return lines.join('\n');
}
```

- [ ] **Step 4: Write `lib/wiki/objective-guide-section.ts`**

```ts
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courses } from '@/lib/db/schema';
import { getObjectiveGuide, type StoredObjectiveGuide } from '@/lib/db/objective-guides-queries';
import { getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import { listSyllabusMaterials } from '@/lib/db/course-materials-queries';
import { pickSyllabus, type SyllabusPick } from '@/lib/objective-guide/inputs';
import { renderGuideText } from '@/lib/objective-guide/render';
import type { ObjectiveGuide } from '@/lib/objective-guide/schema';

export type ObjectiveGuideSection =
  | { kind: 'guide'; guide: ObjectiveGuide; text: string; capturedOn: string }
  | { kind: 'no-syllabus' }
  | { kind: 'syllabus-set-aside' };

/**
 * What the fourth course-page section shows. A stored guide always wins. With
 * no guide, a captured course is told why (no syllabus / syllabus set aside);
 * an uncaptured course, or one whose guide is simply not built yet, gets no
 * section.
 */
export function decideGuideSection(args: {
  course: { code: string; title: string };
  stored: StoredObjectiveGuide | null;
  hasSnapshot: boolean;
  syllabus: SyllabusPick;
}): ObjectiveGuideSection | null {
  const { course, stored, hasSnapshot, syllabus } = args;
  if (stored) {
    const capturedOn = (stored.snapshotCreatedAt ?? stored.generatedAt).toISOString().slice(0, 10);
    return { kind: 'guide', guide: stored.guide, text: renderGuideText(stored.guide, course), capturedOn };
  }
  if (!hasSnapshot) return null;
  if (syllabus.status === 'syllabus-set-aside') return { kind: 'syllabus-set-aside' };
  if (syllabus.status === 'no-syllabus') return { kind: 'no-syllabus' };
  return null;
}

export async function loadObjectiveGuideSection(codeAnyCase: string): Promise<ObjectiveGuideSection | null> {
  // Wiki slugs upper-case letter suffixes ("GC 4900AP"); the DB stores "GC 4900ap".
  const [course] = await db
    .select({ code: courses.code, title: courses.title })
    .from(courses)
    .where(sql`lower(${courses.code}) = lower(${codeAnyCase})`)
    .limit(1);
  if (!course) return null;
  const [stored, snapshot, syllabusRows] = await Promise.all([
    getObjectiveGuide(course.code),
    getLatestSnapshotByCourse(course.code),
    listSyllabusMaterials(course.code),
  ]);
  return decideGuideSection({ course, stored, hasSnapshot: snapshot !== null, syllabus: pickSyllabus(syllabusRows) });
}
```

- [ ] **Step 5: Write `app/wiki/CopyGuideButton.tsx`**

```tsx
'use client';

import { useState } from 'react';

/** Copies the plain-text guide. Clipboard needs a secure context (campus
 *  HTTPS); on plain HTTP it reports failure and the "Show as plain text"
 *  disclosure below is the fallback. */
export function CopyGuideButton({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  return (
    <button type="button" className="wiki-assess__copy" onClick={() => void copy()}>
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy as text'}
    </button>
  );
}
```

- [ ] **Step 6: Write `app/wiki/ObjectiveGuidePanel.tsx`**

```tsx
import type { ObjectiveGuideSection } from '@/lib/wiki/objective-guide-section';
import { MEASURE_LABEL, CLASS_LEVEL_NOTE, formatEvidence } from '@/lib/objective-guide/render';
import { CopyGuideButton } from './CopyGuideButton';

function fmt(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export const NO_SYLLABUS_NOTICE =
  'There is no guide for this course yet because no readable syllabus is on file, and the guide quotes its objectives from the syllabus. Instructors: add the course syllabus on the capture page, imported from Canvas or uploaded, and the guide is built with the next capture.';

export const SET_ASIDE_NOTICE =
  'There is no guide for this course yet: the syllabus is set aside, so it is not read. Instructors: include it on the capture page, and the guide is built with the next capture.';

/**
 * Fourth course-page section (spec 2026-10-05): for each syllabus objective,
 * how well it is measured, where the evidence is in Canvas, and what to gather
 * at the end of the semester. Public, read-only, from course_objective_guides.
 */
export function ObjectiveGuidePanel({ section }: { section: ObjectiveGuideSection }) {
  return (
    <section className="wiki-assess" aria-labelledby="assess-heading">
      <h2 id="assess-heading">Assessing the course objectives</h2>

      {section.kind === 'no-syllabus' && <p className="wiki-assess__notice">{NO_SYLLABUS_NOTICE}</p>}
      {section.kind === 'syllabus-set-aside' && <p className="wiki-assess__notice">{SET_ASIDE_NOTICE}</p>}

      {section.kind === 'guide' && (
        <>
          <div className="wiki-assess__head">
            <p className="wiki-assess__intro">{section.guide.intro}</p>
            <CopyGuideButton text={section.text} />
          </div>

          {section.guide.objectives.length === 0 ? (
            <p className="wiki-assess__notice">No learning objectives could be quoted from the syllabus.</p>
          ) : (
            <ol className="wiki-assess__list">
              {section.guide.objectives.map((o, i) => (
                <li key={i} className="wiki-assess__item">
                  <p className="wiki-assess__objective">{o.objective}</p>
                  <p className={`wiki-assess__measure is-${o.measure}`}>{MEASURE_LABEL[o.measure]}</p>
                  <dl className="wiki-assess__facts">
                    <dt>Where the evidence is</dt>
                    <dd>{o.evidence.length > 0 ? o.evidence.map(formatEvidence).join('; ') : 'No graded item yet'}</dd>
                    <dt>What to gather</dt>
                    <dd>{o.gather}</dd>
                    {o.suggestion && (
                      <>
                        <dt>Smallest change that would help</dt>
                        <dd>{o.suggestion}</dd>
                      </>
                    )}
                  </dl>
                </li>
              ))}
            </ol>
          )}

          {section.guide.checklist.length > 0 && (
            <div className="wiki-assess__checklist">
              <h3 id="assess-checklist">Items to pull from Canvas at the end of the semester</h3>
              <ul aria-labelledby="assess-checklist">
                {section.guide.checklist.map((c, i) => <li key={i}>{formatEvidence(c)}</li>)}
              </ul>
            </div>
          )}

          <p className="wiki-assess__note">{CLASS_LEVEL_NOTE}</p>
          <details className="wiki-assess__text">
            <summary>Show as plain text</summary>
            <pre>{section.text}</pre>
          </details>
          <p className="wiki-views__note">Built from the capture of {fmt(section.capturedOn)}.</p>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 7: Wire the section into `app/wiki/[type]/[slug]/page.tsx`**

Add imports after `import { loadCourseViews, loadTargetMap, type CourseViews } from '@/lib/wiki/course-views';`:

```tsx
import { ObjectiveGuidePanel } from '../../ObjectiveGuidePanel';
import { loadObjectiveGuideSection, type ObjectiveGuideSection } from '@/lib/wiki/objective-guide-section';
```

After `let views: CourseViews | null = null;` add:

```tsx
  let guideSection: ObjectiveGuideSection | null = null;
```

After `views = await loadCourseViews(codeFromSlug(pageSlug)).catch(() => null);` add:

```tsx
    guideSection = await loadObjectiveGuideSection(codeFromSlug(pageSlug)).catch(() => null);
```

After `{type === 'courses' && views && <CourseViewsPanel views={views} q={q} />}` add:

```tsx
      {type === 'courses' && guideSection && <ObjectiveGuidePanel section={guideSection} />}
```

- [ ] **Step 8: Add the styles to `app/globals.css`**

Directly after the `.wiki-views__note { ... }` rule, add:

```css
/* Assessing the course objectives — fourth course-page section (spec 2026-10-05). */
.wiki-assess { margin: 0 0 2.5rem; padding-top: 1.25rem; border-top: 1px solid var(--wiki-rule); }
.wiki-assess > h2 { font-family: var(--font-display); font-weight: 500; font-size: 1.5rem; margin: 0; letter-spacing: -0.01em; }
.wiki-assess__head { display: flex; gap: 1rem; align-items: flex-start; justify-content: space-between; margin-top: 0.5rem; }
.wiki-assess__intro { margin: 0; font-size: 0.9rem; line-height: 1.55; max-width: 46rem; }
.wiki-assess__copy { flex-shrink: 0; font-size: 0.8125rem; font-weight: 600; padding: 0.35rem 0.75rem; border: 1px solid var(--wiki-rule); border-radius: 4px; background: var(--background); color: var(--foreground); cursor: pointer; }
.wiki-assess__copy:hover { border-color: var(--wiki-accent); }
.wiki-assess__list { margin: 1.25rem 0 0; padding-left: 1.2rem; list-style: decimal; }
.wiki-assess__item + .wiki-assess__item { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--wiki-rule); }
.wiki-assess__objective { margin: 0; font-weight: 600; font-size: 0.9375rem; line-height: 1.45; }
.wiki-assess__measure { display: inline-block; margin: 0.35rem 0 0; font-size: 0.75rem; font-weight: 600; padding: 0.1rem 0.45rem; border-radius: 3px; background: color-mix(in srgb, var(--wiki-muted) 12%, transparent); color: var(--wiki-muted); }
.wiki-assess__measure.is-clear { background: color-mix(in srgb, var(--wiki-accent) 14%, transparent); color: var(--foreground); }
.wiki-assess__measure.is-partial { background: color-mix(in srgb, var(--wiki-accent) 7%, transparent); color: var(--foreground); }
.wiki-assess__facts { display: grid; grid-template-columns: 12rem 1fr; gap: 0.3rem 1rem; margin: 0.6rem 0 0; font-size: 0.8125rem; line-height: 1.5; }
.wiki-assess__facts dt { color: var(--wiki-muted); }
.wiki-assess__facts dd { margin: 0; }
.wiki-assess__checklist { margin-top: 1.5rem; padding: 0.75rem 0.9rem; background: color-mix(in srgb, var(--wiki-accent) 6%, transparent); border-left: 2px solid var(--wiki-accent); }
.wiki-assess__checklist h3 { font-size: 0.8125rem; font-weight: 600; margin: 0 0 0.4rem; }
.wiki-assess__checklist ul { margin: 0; padding-left: 1.1rem; font-size: 0.8125rem; line-height: 1.5; }
.wiki-assess__note, .wiki-assess__notice { font-size: 0.8125rem; color: var(--wiki-muted); line-height: 1.5; margin: 0.75rem 0 0; max-width: 46rem; }
.wiki-assess__text { margin-top: 0.75rem; font-size: 0.8125rem; }
.wiki-assess__text summary { cursor: pointer; color: var(--wiki-muted); }
.wiki-assess__text pre { white-space: pre-wrap; font-size: 0.75rem; line-height: 1.5; padding: 0.75rem; border: 1px solid var(--wiki-rule); margin: 0.5rem 0 0; }
@media (max-width: 640px) {
  .wiki-assess__head { flex-direction: column; }
  .wiki-assess__facts { grid-template-columns: 1fr; }
}
```

- [ ] **Step 9: Run the tests and typecheck**

Run the Step 2 command again — Expected: PASS.
Run: `pnpm vitest run lib/wiki app/wiki` — Expected: PASS.
Run: `npx tsc --noEmit -p .` — Expected: no errors.

- [ ] **Step 10: Update `docs/STATE.md`**

In the `/wiki/[type]/[slug]` row of "What's live", replace `` `type` ∈ `{courses,competencies,targets,concepts}` | live | 2026-06-01 | `` with:

```markdown
`type` ∈ `{courses,competencies,targets,concepts}`. **Course pages gain a fourth section, "Assessing the course objectives" (2026-10-05)**, below the three views: per syllabus objective a measure label (Clearly measured / Partly measured / No graded measure yet), the Canvas assignments and rubric rows that hold the evidence, what class-level numbers to gather, and the smallest fix where there is no clear measure; then a checklist, a **Copy as text** button (`renderGuideText`, `lib/objective-guide/render.ts`) with a "Show as plain text" fallback, and the capture date. Read at request time from `course_objective_guides` (`lib/wiki/objective-guide-section.ts`); a captured course without a guide says why (no syllabus / syllabus set aside). | live | 2026-06-01 |
```

- [ ] **Step 11: Commit**

```bash
git add lib/objective-guide/render.ts lib/wiki/objective-guide-section.ts app/wiki/ObjectiveGuidePanel.tsx \
  app/wiki/CopyGuideButton.tsx app/wiki/\[type\]/\[slug\]/page.tsx app/globals.css \
  lib/objective-guide/__tests__/render.test.ts lib/wiki/__tests__/objective-guide-section.test.ts \
  app/wiki/__tests__/ObjectiveGuidePanel.test.tsx docs/STATE.md
git commit -m "feat(wiki): 'Assessing the course objectives' section with Copy as text" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YFqkp83wAJeqVK7QHjRrPm"
```

---

### Task 8: Backfill script, STATE close-out, and the live check

**Files:**
- Create: `scripts/backfill-objective-guides.ts`
- Modify: `docs/STATE.md`

**Interfaces:**
- Consumes: `runObjectiveGuideForSnapshot`, `GuideRunResult` (Task 4); `pickSyllabus`, `usableAssignmentsText` (Task 4); `getLatestSnapshotByCourse`, `listMaterialsByCourse`; `courseCaptureSnapshots`.
- Produces: `pnpm exec tsx --env-file=.env.local scripts/backfill-objective-guides.ts [--dry-run] [--course "<code>"]...`

- [ ] **Step 1: Write `scripts/backfill-objective-guides.ts`**

```ts
/**
 * One-time backfill of objective assessment guides (spec 2026-10-05).
 *
 * For every course with a live (unretired) capture snapshot, reports whether it
 * has a usable syllabus and usable Canvas assignments, and — unless --dry-run —
 * builds the guide from the latest snapshot. A course whose syllabus is set
 * aside is never sent to the AI (lib/objective-guide/inputs.ts).
 *
 * Usage (run from the deploy checkout after merge + migration 0051):
 *   pnpm exec tsx --env-file=.env.local scripts/backfill-objective-guides.ts --dry-run
 *   pnpm exec tsx --env-file=.env.local scripts/backfill-objective-guides.ts
 *   pnpm exec tsx --env-file=.env.local scripts/backfill-objective-guides.ts --course "GC 4440"
 */
import { isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseCaptureSnapshots } from '@/lib/db/schema';
import { getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { pickSyllabus, usableAssignmentsText } from '@/lib/objective-guide/inputs';
import { runObjectiveGuideForSnapshot } from '@/lib/objective-guide/run';

function parseArgs(argv: string[]): { dryRun: boolean; courses: string[] } {
  const courses: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--course' && argv[i + 1]) courses.push(argv[++i]!);
  }
  return { dryRun: argv.includes('--dry-run'), courses };
}

async function main(): Promise<void> {
  const { dryRun, courses } = parseArgs(process.argv.slice(2));
  const rows = await db
    .selectDistinct({ courseCode: courseCaptureSnapshots.courseCode })
    .from(courseCaptureSnapshots)
    .where(isNull(courseCaptureSnapshots.retiredAt));
  const codes = rows
    .map((r) => r.courseCode)
    .filter((c) => courses.length === 0 || courses.includes(c))
    .sort();

  console.log(`${dryRun ? '[dry-run] ' : ''}${codes.length} captured course(s)\n`);
  let built = 0;
  let totalCost = 0;
  const allDropped: string[] = [];

  for (const code of codes) {
    const snap = await getLatestSnapshotByCourse(code);
    if (!snap) continue;
    const materials = await listMaterialsByCourse(code);
    const syllabus = pickSyllabus(materials);
    const hasAssignments = usableAssignmentsText(materials) !== null;
    const syllabusState = syllabus.status === 'ok'
      ? `syllabus ok (${syllabus.syllabi.map((s) => s.fileName).join(', ')})`
      : syllabus.status;
    const ready = syllabus.status === 'ok' && hasAssignments;

    if (dryRun || !ready) {
      console.log(`${code}: ${syllabusState}; assignments ${hasAssignments ? 'ok' : 'missing'} — ${ready ? 'would build' : 'skip'}`);
      continue;
    }

    try {
      const r = await runObjectiveGuideForSnapshot(snap.id);
      if (r.status === 'written') {
        built++;
        totalCost += r.costUsdCents;
        allDropped.push(...r.droppedNames.map((d) => `${code} — ${d}`));
        console.log(`${code}: built — ${r.objectives} objective(s), ${r.droppedNames.length} dropped, $${(r.costUsdCents / 10_000).toFixed(3)}`);
      } else {
        console.log(`${code}: skipped — ${r.reason}`);
      }
    } catch (err) {
      console.error(`${code}: FAILED —`, err instanceof Error ? err.message : err);
    }
  }

  if (!dryRun) {
    console.log(`\nBuilt ${built} guide(s); total $${(totalCost / 10_000).toFixed(2)}.`);
    console.log(allDropped.length === 0 ? 'No names dropped.' : `Dropped names:\n${allDropped.map((d) => `  ${d}`).join('\n')}`);
  }
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Typecheck and run the full suite**

Run: `npx tsc --noEmit -p .` — Expected: no errors.
Run: `pnpm test` — Expected: the whole suite passes.

- [ ] **Step 3: Close out `docs/STATE.md`**

Directly under `### Deferred / debt` (above the Task 2 bullet), add:

```markdown
- **Objective assessment guide — built, decisions held (2026-10-05).** Plan [`2026-10-05-objective-assessment-guide.md`](./superpowers/plans/2026-10-05-objective-assessment-guide.md); backfill `scripts/backfill-objective-guides.ts` (`--dry-run`, `--course`). Decisions: (1) a syllabus that is ignored/set aside is never sent to the AI — on 2026-10-05 that left **only GC 4440** with a usable syllabus: GC 1010/3800/4800's `Canvas: Syllabus` rows are ignored (set aside by the retired Sheets-LOs heuristic), and GC 3620, MKT 3310, MKT 4320 and GC 3400's course PDF are FERPA auto-set-aside; each needs an instructor to Include it on the capture page before its guide can be built. (2) The checklist is derived from the checked evidence, not written by the model. (3) Only `evidence` names are checked; assignment names mentioned inside the free-text `gather`/`suggestion` are not. (4) A guide is rebuilt only on the next snapshot or by re-running the backfill — including a syllabus does not trigger it. (5) The Step-1 gate counts a set-aside syllabus as present.
```

Under the `## Active arc` heading, add one line at the top of that section:

```markdown
- **Objective assessment guide (2026-10-05) — built on `feat/objective-assessment-guide`.** Spec [`2026-10-05-objective-evidence-guide-design.md`](./superpowers/specs/2026-10-05-objective-evidence-guide-design.md), plan [`2026-10-05-objective-assessment-guide.md`](./superpowers/plans/2026-10-05-objective-assessment-guide.md). Migration 0051 applied; merge + deploy + backfill pending the owner.
```

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-objective-guides.ts docs/STATE.md
git commit -m "feat(objective-guide): one-time backfill script; STATE close-out" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01YFqkp83wAJeqVK7QHjRrPm"
```

- [ ] **Step 5: STOP — owner decisions before anything goes live**

Ask the owner, in one message:
1. Merge `feat/objective-assessment-guide` into `dev` and `main`, and deploy (`git -C ~/projects/curriculum_developer-deploy pull`, `pnpm -C ~/projects/curriculum_developer-deploy build`, `launchctl kickstart -k gui/$(id -u)/com.gc.curriculum-tool`)?
2. Is GC 3400's `Summer-2026-GC-3400-001-GC3400-Digital-Imaging-Su26-50417.pdf` (id `1f49d6b8-ff90-46a0-b105-932fdc6e600e`) the syllabus? If yes: `"$PSQL" "$DB" -c "UPDATE course_materials SET is_syllabus = true WHERE id = '1f49d6b8-ff90-46a0-b105-932fdc6e600e'"`. (It is also FERPA set aside, so it still needs Include before a guide is built.)
3. Which set-aside syllabi (GC 1010, GC 3800, GC 4800 Canvas syllabus pages; GC 3620, MKT 3310, MKT 4320 FERPA) should be included? The owner does this on each course's capture page (Syllabus box → Include / Include anyway). Never flip `ignored` from a script.
4. Run the backfill (≈ $0.05–0.20 per course)?

Do not continue past an unanswered item that it gates.

- [ ] **Step 6: Run the backfill (owner-approved only)**

From the deploy checkout:

```bash
cd ~/projects/curriculum_developer-deploy
pnpm exec tsx --env-file=.env.local scripts/backfill-objective-guides.ts --dry-run
pnpm exec tsx --env-file=.env.local scripts/backfill-objective-guides.ts
```

Expected dry run: one line per captured course; `would build` only for courses with a usable syllabus and assignments; `syllabus-set-aside` / `no-syllabus` for the rest. Expected real run: a `built` line per ready course, the total cost, and every dropped name listed.

- [ ] **Step 7: Live check**

1. For three built courses (or every built course if fewer than three), read each guide in the DB (`"$PSQL" "$DB" -Atc "select guide from course_objective_guides where course_code = '<code>'"`) against that course's `Canvas: Assignments` text and its syllabus: every evidence name exists under the named assignment, every objective appears in the syllabus, measures are defensible, nothing names a student.
2. Report every `dropped_names` entry to the owner (`select course_code, dropped_names from course_objective_guides where dropped_names <> '[]'::jsonb`).
3. Public page on campus HTTPS: `curl -s https://gcworkflow.clemson.edu:8443/wiki/courses/gc-4440 | grep -c "Assessing the course objectives"` — Expected: `1` or more. Also load a course with a set-aside syllabus (e.g. `/wiki/courses/mkt-4320`) and confirm the set-aside notice.
4. Record the outcome (courses built, drops, cost) as a dated line in the Task 8 Deferred / debt bullet, update the Active-arc line to "deployed + backfilled", and commit `docs/STATE.md` (same trailer lines).
