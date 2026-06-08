# Major Projects, Class Structure & Syllabus — First-Class Profile Fields

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make class structure and major projects first-class, source-grounded fields in `CaptureProfile` (JSONB additive, nullable for legacy), and render them as three new sections (Class structure, Major projects, Syllabus) on wiki course pages by pulling the live Google Sheet.

**Architecture:** Two new Zod schemas (`classStructureSchema`, `majorProjectItemSchema`) and two new nullable fields on `captureProfileSchema` in `lib/ai/capture/schema.ts`; matching additions to the strict-mode `captureProfileJsonSchemaV2` in `lib/ai/analyze/capture-scores.ts`; extraction rules in `lib/ai/prompts/capture-synthesis.md`; editable review sections in `ProfileReviewPanel.tsx`; and `loadCourseInfo` in `lib/ai/wiki/update.ts` extended to call `fetchLiveCourseFromSheet` so the `updateWikiForSnapshot` user-message carries sheet fields that the `wiki-update.md` prompt renders into the three new course-page sections. No DB migration — fields live entirely in the `profile` JSONB column.

**Tech stack:** Next.js 15 App Router, TypeScript strict, Zod 3, Drizzle ORM, local Postgres 17, Vitest, Tailwind + shadcn, existing `fetchLiveCourseFromSheet` / `parseCourseTab`, OpenAI strict structured-output discipline.

**Design spec:** [`docs/superpowers/specs/2026-06-08-projects-first-class-design.md`](../specs/2026-06-08-projects-first-class-design.md). Read it first; the wikilink-resolution rule, the `assessment`-stub rule, and the sheet-fallback behavior are load-bearing.

**Deferred (do not implement in this plan):**
- Capture-chat priming: no new Audit Area probe for class structure / major projects. Synthesis relies on materials + thin-materials `null` fallback only.

---

## Open-question resolutions baked into this plan

1. **Project → competency wikilinks:** `major_projects[].competencies` stores the competency *statement* text (matching the `profile.competencies[].statement` field), not a slug. The wiki-update prompt receives the `profile.competencies` array and may emit `[[sub-competency-slug]]` only when a `sub_competencies` row whose `name` matches or is closely paraphrased by the statement can be confirmed from the substrate — otherwise it renders plain text. The plan does not add DB-lookup logic; the instruction is in the wiki-update prompt template.

2. **`assessment` stub vs. null:** When materials show that a course is clearly graded (rubrics exist, point totals are stated) but the breakdown is not documented, the synthesis emits a short stub such as `"Graded; breakdown not documented."` rather than `null`. `null` is reserved for courses where no graded structure is in evidence at all (e.g., pure studio-judgment with no rubric artifacts).

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `lib/ai/capture/schema.ts` | **Modify** | Add `classStructureSchema`, `majorProjectItemSchema`, `CaptureClassStructure`, `CaptureProjectItem` exports; add `class_structure` and `major_projects` nullable optional fields to `captureProfileSchema`. |
| `lib/ai/analyze/capture-scores.ts` | **Modify** | Append `class_structure` and `major_projects` to `captureProfileJsonSchemaV2` `required` + `properties` following the nullable-union strict-mode pattern. (`captureProfileJsonSchema` v1 does NOT get the new fields — v1 is frozen for legacy-snapshot compatibility; v2 synthesis uses `captureProfileJsonSchemaV2`.) |
| `tests/lib/ai/capture/projects-schema.test.ts` | **Create** | Zod acceptance + rejection tests for the two new schemas; `captureProfileSchema.parse` succeeds on profiles with and without the new fields. |
| `tests/lib/ai/capture/projects-json-schema.test.ts` | **Create** | Strict-mode walker test for `captureProfileJsonSchemaV2` (every property in `required`, recursively). |
| `lib/ai/prompts/capture-synthesis.md` | **Modify** | Add `# Class structure and major projects` extraction section; append new fields to the `# Output schema` illustration. |
| `app/capture/[code]/ClassStructureSection.tsx` | **Create** | Editable Class-structure section component (topics list, cadence input, assessment textarea, source badge, "not yet captured" notice). |
| `app/capture/[code]/MajorProjectsSection.tsx` | **Create** | Editable Major-projects section component (project cards with title/description/competency tag list, add/remove, "not yet captured" notice). |
| `app/capture/[code]/ProfileReviewPanel.tsx` | **Modify** | Import and render `ClassStructureSection` and `MajorProjectsSection` after `CourseOverview`, wired to `setWorking` / `onProfileChange`. |
| `lib/ai/wiki/update.ts` | **Modify** | Extend `CourseInfo` interface; rewrite `loadCourseInfo` to call `fetchLiveCourseFromSheet` and merge results; extend `userMessage` assembly to include new sheet fields. |
| `lib/ai/prompts/wiki-update.md` | **Modify** | Add Class structure (§8a), Major projects (§8b), and Syllabus (§8c) sections to the course-page template; update `## Inputs you receive` block; renumber Source snapshots to §9, Cross-references to §10. |
| `tests/lib/ai/wiki/loadCourseInfo.test.ts` | **Create** | Unit tests for `loadCourseInfo` merge logic and the `fetchLiveCourseFromSheet` null/fallback path. |

---

## Increment 1 — Zod schema + types (no behavior change)

### Task 1: Add `classStructureSchema` and `majorProjectItemSchema` to `lib/ai/capture/schema.ts`

**Files:**
- Modify: `lib/ai/capture/schema.ts`
- Create: `tests/lib/ai/capture/projects-schema.test.ts`

- [ ] **Step 1: Write the failing test** — create `tests/lib/ai/capture/projects-schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  classStructureSchema,
  majorProjectItemSchema,
  captureProfileSchema,
} from '@/lib/ai/capture/schema';

// ---------------------------------------------------------------------------
// classStructureSchema
// ---------------------------------------------------------------------------
describe('classStructureSchema', () => {
  const validStructure = {
    topics: ['Color theory', 'Press operations', 'Prepress workflow'],
    cadence: 'Two 75-minute studio sessions per week.',
    assessment: 'Three tests, two major projects, and weekly graded labs.',
    source: 'materials' as const,
    citations: [],
  };

  it('accepts a valid class structure', () => {
    expect(() => classStructureSchema.parse(validStructure)).not.toThrow();
  });

  it('accepts source and citations as absent (optional)', () => {
    const { source: _s, citations: _c, ...noAttrib } = validStructure;
    expect(() => classStructureSchema.parse(noAttrib)).not.toThrow();
  });

  it('rejects empty topics array', () => {
    expect(() =>
      classStructureSchema.parse({ ...validStructure, topics: [] })
    ).toThrow();
  });

  it('rejects topics containing empty strings', () => {
    expect(() =>
      classStructureSchema.parse({ ...validStructure, topics: [''] })
    ).toThrow();
  });

  it('rejects cadence shorter than 5 chars', () => {
    expect(() =>
      classStructureSchema.parse({ ...validStructure, cadence: 'Hi' })
    ).toThrow();
  });

  it('rejects assessment shorter than 10 chars', () => {
    expect(() =>
      classStructureSchema.parse({ ...validStructure, assessment: 'Graded.' })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// majorProjectItemSchema
// ---------------------------------------------------------------------------
describe('majorProjectItemSchema', () => {
  const validProject = {
    title: 'Brand Color Report',
    description: 'Students produce a 12-page press-ready specification document.',
    competencies: ['Students prepare production-ready package artwork'],
    source: 'materials' as const,
    citations: [],
  };

  it('accepts a valid project item', () => {
    expect(() => majorProjectItemSchema.parse(validProject)).not.toThrow();
  });

  it('accepts source and citations as absent', () => {
    const { source: _s, citations: _c, ...noAttrib } = validProject;
    expect(() => majorProjectItemSchema.parse(noAttrib)).not.toThrow();
  });

  it('rejects empty title', () => {
    expect(() =>
      majorProjectItemSchema.parse({ ...validProject, title: '' })
    ).toThrow();
  });

  it('rejects description shorter than 10 chars', () => {
    expect(() =>
      majorProjectItemSchema.parse({ ...validProject, description: 'Short.' })
    ).toThrow();
  });

  it('rejects empty competencies array', () => {
    expect(() =>
      majorProjectItemSchema.parse({ ...validProject, competencies: [] })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// captureProfileSchema — backward compat
// ---------------------------------------------------------------------------
describe('captureProfileSchema — new fields are nullable/optional', () => {
  // Minimal profile without the new fields (simulates a legacy snapshot)
  const legacyProfile = {
    course_code: 'GC 3460',
    scale_version: 'v1' as const,
    generated_at: new Date().toISOString(),
    overview: null,
    competencies: [
      {
        statement: 'Students operate color measurement devices.',
        type: 'technical' as const,
        k_depth: 2,
        u_depth: 2,
        d_depth: 3,
        evidence_k: 'Lab 3 requires spectrophotometer readings.',
        evidence_u: 'Quiz asks why delta-E matters.',
        evidence_d: 'Project 1 rubric includes a press check item.',
        rationale: 'Evidence from rubric and labs.',
        source: 'materials' as const,
        citations: [],
      },
    ],
    incoming_expectations: [],
    verification_summary: {
      course_shape: 'Studio-heavy color course.',
      strongest_evidence: ['Project 1 rubric'],
      dimensional_patterns: [],
      catalog_vs_evidence: [],
      foundationals_glance: 'Agency developed through independent press checks.',
      source: 'materials' as const,
      citations: [],
    },
    audit_notes: {
      prereq_gaps: [],
      objective_misalignments: [],
      cross_source_conflicts: [],
      suggested_objective_revisions: [],
      productive_failure_conditions: null,
      source: 'materials' as const,
      citations: [],
    },
    revised_objectives_draft: null,
    course_emphasis: null,
    // class_structure and major_projects deliberately absent
  };

  it('parses a legacy profile without class_structure or major_projects', () => {
    const result = captureProfileSchema.parse(legacyProfile);
    expect(result.class_structure).toBeUndefined();
    expect(result.major_projects).toBeUndefined();
  });

  it('parses a profile with class_structure: null', () => {
    const result = captureProfileSchema.parse({ ...legacyProfile, class_structure: null });
    expect(result.class_structure).toBeNull();
  });

  it('parses a profile with major_projects: null', () => {
    const result = captureProfileSchema.parse({ ...legacyProfile, major_projects: null });
    expect(result.major_projects).toBeNull();
  });

  it('parses a profile with both fields populated', () => {
    const result = captureProfileSchema.parse({
      ...legacyProfile,
      class_structure: {
        topics: ['Color theory', 'Press ops'],
        cadence: 'Two 75-min sessions per week.',
        assessment: 'Three tests and two major projects.',
      },
      major_projects: [
        {
          title: 'Brand Color Report',
          description: 'Students produce a 12-page press-ready spec.',
          competencies: ['Students prepare production-ready package artwork'],
        },
      ],
    });
    expect(result.class_structure?.topics).toHaveLength(2);
    expect(result.major_projects).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
cd /Users/admin/projects/curriculum_developer
pnpm test tests/lib/ai/capture/projects-schema.test.ts 2>&1 | tail -20
```

Expected: FAIL — `classStructureSchema`, `majorProjectItemSchema` not exported from schema.ts.

- [ ] **Step 3: Add `classStructureSchema` and `majorProjectItemSchema` to `lib/ai/capture/schema.ts`**

Insert immediately before the `captureProfileSchema` block (after `verificationSummarySchema`). Add to `lib/ai/capture/schema.ts`:

```typescript
// ---------------------------------------------------------------------------
// Class structure — weekly rhythm, topic list, grading overview
// Added 2026-06-08. Nullable/optional for backward-compat: pre-2026-06-08
// snapshots won't have it. Populated by v3+ synthesis; null means "not yet
// captured" — falls back to sheet/catalog data at wiki-render time.
// ---------------------------------------------------------------------------
export const classStructureSchema = z.object({
  /** Ordered list of the units / topic areas / lab subjects covered. */
  topics: z.array(z.string().min(1)).min(1),
  /**
   * The weekly rhythm / meeting format, e.g.
   * "weekly 2-hour lab + 1-hour lecture" or "twice-weekly studio sessions".
   */
  cadence: z.string().min(5),
  /**
   * Plain-prose grading overview, e.g.
   * "Three tests, two major projects, a cumulative final, plus weekly graded labs."
   * Prose only — no numeric sub-object. Emit "Graded; breakdown not documented."
   * rather than null when the course is clearly graded but breakdown is absent.
   */
  assessment: z.string().min(10),
  source: CaptureProfileSource.optional(),
  citations: z.array(CaptureProfileCitation).optional(),
});
export type CaptureClassStructure = z.infer<typeof classStructureSchema>;

// ---------------------------------------------------------------------------
// Major project item — one major graded project in the course
// ---------------------------------------------------------------------------
export const majorProjectItemSchema = z.object({
  /** Short human-readable title, e.g. "Brand Color Report" or "Prepress Packaging Spec". */
  title: z.string().min(1),
  /** 1-3 sentences describing what students produce and what they decide. */
  description: z.string().min(10),
  /**
   * The competency statements this project develops.
   * Must match or paraphrase entries in the profile's `competencies` array.
   * Projects ARE the evidence for K/U/D scores; linking them closes the loop.
   */
  competencies: z.array(z.string().min(1)).min(1),
  source: CaptureProfileSource.optional(),
  citations: z.array(CaptureProfileCitation).optional(),
});
export type CaptureProjectItem = z.infer<typeof majorProjectItemSchema>;
```

Then add to `captureProfileSchema` (after the `course_emphasis` field, before the closing `}`):

```typescript
  /**
   * Weekly rhythm, topic list, and grading overview.
   * Nullable: pre-2026-06-08 snapshots won't have it.
   * Populated by v3+ synthesis; null means "not yet captured" — falls back to
   * sheet/catalog data at wiki-render time.
   */
  class_structure: classStructureSchema.nullable().optional(),
  /**
   * Major graded projects in the course.
   * Nullable: pre-2026-06-08 snapshots won't have it.
   * When null at wiki-render time, falls back to sheet `majorProjects[]` list
   * labeled "from the course sheet — not yet captured."
   */
  major_projects: z.array(majorProjectItemSchema).nullable().optional(),
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/admin/projects/curriculum_developer
pnpm test tests/lib/ai/capture/projects-schema.test.ts 2>&1 | tail -20
```

Expected: All PASS.

- [ ] **Step 5: Run the full suite to confirm no regressions**

```bash
cd /Users/admin/projects/curriculum_developer
pnpm test 2>&1 | tail -10
```

Expected: Same pass count as before (632/632 or current baseline), 0 new failures.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/capture/schema.ts tests/lib/ai/capture/projects-schema.test.ts
git commit -m "feat(schema): add classStructureSchema + majorProjectItemSchema — nullable optional fields on captureProfileSchema"
```

---

### Task 2: Extend `captureProfileJsonSchemaV2` in `lib/ai/analyze/capture-scores.ts`

**Files:**
- Modify: `lib/ai/analyze/capture-scores.ts`
- Create: `tests/lib/ai/capture/projects-json-schema.test.ts`

**Context:** `captureProfileJsonSchemaV2` is derived by cloning `captureProfileJsonSchema` and widening one field. The two new fields go into the **V2** schema only — `captureProfileJsonSchema` (v1) is frozen. The synthesis path (`generateCaptureProfileV2`) already uses `captureProfileJsonSchemaV2`. OpenAI strict discipline: every property in `properties` must be in `required`; optional fields use `type: ['T', 'null']`.

- [ ] **Step 1: Write the failing walker test** — create `tests/lib/ai/capture/projects-json-schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { captureProfileJsonSchemaV2 } from '@/lib/ai/analyze/capture-scores';

// ---------------------------------------------------------------------------
// Strict-mode walker (same pattern as tests/ai/prereq-edge-seed-schema.test.ts)
// Invariant: for every object node with `properties`, every key in `properties`
// must appear in `required`.  Recurse into nested objects and array items.
// ---------------------------------------------------------------------------
function assertStrictMode(node: unknown, path = ''): void {
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (
    (obj.type === 'object' || (Array.isArray(obj.type) && (obj.type as string[]).includes('object')))
    && obj.properties
    && typeof obj.properties === 'object'
  ) {
    const propKeys = Object.keys(obj.properties as object);
    const required = (obj.required as string[] | undefined) ?? [];
    for (const key of propKeys) {
      expect(required, `[${path || 'root'}] property "${key}" must appear in required`).toContain(key);
    }
    for (const [k, v] of Object.entries(obj.properties as object)) {
      assertStrictMode(v, `${path}.${k}`);
    }
  }
  if (obj.items) assertStrictMode(obj.items, `${path}[items]`);
  if (obj.anyOf && Array.isArray(obj.anyOf)) {
    for (const v of obj.anyOf) assertStrictMode(v, `${path}[anyOf]`);
  }
}

describe('captureProfileJsonSchemaV2 strict-mode discipline', () => {
  it('passes the walker (every property listed in required, recursively)', () => {
    assertStrictMode(captureProfileJsonSchemaV2);
  });

  it('has class_structure in required', () => {
    const required = (captureProfileJsonSchemaV2 as any).required as string[];
    expect(required).toContain('class_structure');
  });

  it('has major_projects in required', () => {
    const required = (captureProfileJsonSchemaV2 as any).required as string[];
    expect(required).toContain('major_projects');
  });

  it('class_structure is nullable (type: ["object", "null"])', () => {
    const cs = (captureProfileJsonSchemaV2 as any).properties.class_structure;
    expect(cs.type).toEqual(['object', 'null']);
  });

  it('major_projects is nullable (type: ["array", "null"])', () => {
    const mp = (captureProfileJsonSchemaV2 as any).properties.major_projects;
    expect(mp.type).toEqual(['array', 'null']);
  });

  it('class_structure sub-properties: topics is array, cadence/assessment are string', () => {
    const cs = (captureProfileJsonSchemaV2 as any).properties.class_structure;
    expect(cs.properties.topics.type).toBe('array');
    expect(cs.properties.cadence.type).toBe('string');
    expect(cs.properties.assessment.type).toBe('string');
  });

  it('class_structure.source is nullable enum', () => {
    const cs = (captureProfileJsonSchemaV2 as any).properties.class_structure;
    expect(cs.properties.source.type).toEqual(['string', 'null']);
  });

  it('major_projects items have required: [title, description, competencies, source, citations]', () => {
    const mp = (captureProfileJsonSchemaV2 as any).properties.major_projects;
    expect(mp.items.required).toContain('title');
    expect(mp.items.required).toContain('description');
    expect(mp.items.required).toContain('competencies');
    expect(mp.items.required).toContain('source');
    expect(mp.items.required).toContain('citations');
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
cd /Users/admin/projects/curriculum_developer
pnpm test tests/lib/ai/capture/projects-json-schema.test.ts 2>&1 | tail -20
```

Expected: FAIL — `class_structure` and `major_projects` not yet in `captureProfileJsonSchemaV2`.

- [ ] **Step 3: Extend `captureProfileJsonSchemaV2` in `lib/ai/analyze/capture-scores.ts`**

The `captureProfileJsonSchemaV2` is currently built by cloning `captureProfileJsonSchema` and patching one field. Change it to also append the two new fields. The full new block replaces the existing `captureProfileJsonSchemaV2` declaration:

```typescript
export const captureProfileJsonSchemaV2 = (() => {
  const cloned = JSON.parse(JSON.stringify(captureProfileJsonSchema)) as {
    required: string[];
    properties: Record<string, unknown> & {
      audit_notes: {
        properties: { productive_failure_conditions: { type?: string | string[] } };
      };
    };
  };

  // Widen PF block to nullable (safety net — v1 already has this).
  const pf = cloned.properties.audit_notes.properties.productive_failure_conditions;
  pf.type = ['object', 'null'];

  // -------------------------------------------------------------------------
  // New fields: class_structure + major_projects (2026-06-08).
  // Only in V2 — v1 schema is frozen for legacy-snapshot compatibility.
  // Strict-mode discipline: every property in `properties` must be in
  // `required`; optional fields use type: ['T', 'null'].
  // -------------------------------------------------------------------------
  cloned.required.push('class_structure', 'major_projects');

  (cloned.properties as Record<string, unknown>).class_structure = {
    type: ['object', 'null'],
    additionalProperties: false,
    required: ['topics', 'cadence', 'assessment', 'source', 'citations'],
    properties: {
      topics: {
        type: 'array',
        minItems: 1,
        items: { type: 'string', minLength: 1 },
      },
      cadence: { type: 'string', minLength: 5 },
      assessment: { type: 'string', minLength: 10 },
      source: { type: ['string', 'null'], enum: ['instructor', 'materials', 'inferred', null] },
      citations: CITATIONS_ARRAY,
    },
  };

  (cloned.properties as Record<string, unknown>).major_projects = {
    type: ['array', 'null'],
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'description', 'competencies', 'source', 'citations'],
      properties: {
        title: { type: 'string', minLength: 1 },
        description: { type: 'string', minLength: 10 },
        competencies: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', minLength: 1 },
        },
        source: { type: ['string', 'null'], enum: ['instructor', 'materials', 'inferred', null] },
        citations: CITATIONS_ARRAY,
      },
    },
  };

  return cloned;
})();
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/admin/projects/curriculum_developer
pnpm test tests/lib/ai/capture/projects-json-schema.test.ts 2>&1 | tail -20
```

Expected: All PASS.

- [ ] **Step 5: Run the existing PF schema test to confirm no regression**

```bash
cd /Users/admin/projects/curriculum_developer
pnpm test tests/lib/ai/capture/pf-json-schema.test.ts 2>&1 | tail -10
```

Expected: All PASS (the PF tests check `captureProfileJsonSchemaV2` — the clone must still carry the PF block correctly).

- [ ] **Step 6: Run the full suite**

```bash
cd /Users/admin/projects/curriculum_developer
pnpm test 2>&1 | tail -10
```

Expected: Same baseline pass count, 0 new failures.

- [ ] **Step 7: Commit**

```bash
git add lib/ai/analyze/capture-scores.ts tests/lib/ai/capture/projects-json-schema.test.ts
git commit -m "feat(schema): extend captureProfileJsonSchemaV2 with class_structure + major_projects (OpenAI strict-mode)"
```

---

## Increment 2 — Synthesis extraction

### Task 3: Update `lib/ai/prompts/capture-synthesis.md`

**Files:**
- Modify: `lib/ai/prompts/capture-synthesis.md`

**Note:** This is a prompt-only change. Unit testing an LLM prompt is not sensible. The acceptance criteria are manual: run synthesis against one course with rich materials and confirm the output structure. The steps below make the changes; the verification step describes exactly what to check.

- [ ] **Step 1: Add extraction section after the `course_emphasis` section in the prompt**

In `lib/ai/prompts/capture-synthesis.md`, locate the `## Hard rules` section (near the end). Insert the following block immediately **before** `## Hard rules`:

```markdown
# Class structure and major projects

## Extraction rules

Extract `class_structure` and `major_projects` from syllabus, Canvas module list, schedule/calendar, and assignment headers.

### `class_structure`

- **`topics`**: Ordered list of units / topic areas / lab subjects as they appear in the course schedule or Canvas module list. Preserve the order they are taught, not alphabetical. Each entry is a short phrase (e.g., "Color theory fundamentals", "ICC profile creation", "Flexographic press operations"). Extract from the schedule table, weekly topics column, or Canvas modules listing.
- **`cadence`**: The weekly meeting pattern from the course header or schedule (e.g., "Two 75-minute studio sessions per week" or "Weekly 2-hour lab plus 1-hour lecture"). If not stated, derive from the contact hours listed on the syllabus.
- **`assessment`**: A single plain-prose sentence summarising the graded components — e.g., "Three tests, two major projects, a cumulative final, and ten weekly graded labs." Read from the grading breakdown table or syllabus overview section. **Do NOT produce a numeric sub-object.** When a course is clearly graded (rubrics exist, point totals are stated) but the breakdown prose is absent, emit the stub: "Graded; breakdown not documented." Reserve `null` for when no graded structure is in evidence at all.
- `source` and `citations` follow the same derivation rules as competency citations (carry forward chunk IDs from the materials the extraction drew on; derive `source` mechanically from the citation set per the rule in `# How to derive source`).
- When materials are too thin to support `class_structure` reliably, emit `class_structure: null`. Do NOT invent a schedule from stated objectives alone.

### `major_projects`

- Identify major graded projects from assignment headers and rubric documents. Each must have a point value OR be explicitly labeled "major project", "project", "assignment" with a rubric and meaningful scope. Small in-class exercises, weekly practice labs, and quizzes are NOT major projects.
- Cap at **8 entries**. More than 8 signals the filter is too loose — re-apply the "rubric + meaningful scope" gate.
- **`title`**: Short human-readable title from the assignment header (e.g., "Brand Color Report", "Prepress Packaging Specification").
- **`description`**: 1-3 sentences describing what students produce and what decisions they make. Use source voice from the materials (rubric language preferred).
- **`competencies`**: The competency *statements* from the `competencies` array above that this project develops. Must match or closely paraphrase entries already emitted in `competencies`. These are the provenance link between projects and K/U/D scores — a project that evidences D=4 color measurement should list the color-measurement competency statement.
- `source` and `citations` follow the same rules as competency citations.
- When materials are too thin to identify major projects reliably, emit `major_projects: null`. Do NOT fabricate project titles from learning objectives.

### Null behavior (OpenAI strict mode)

Under OpenAI strict mode the model CANNOT omit a required field. Emit `class_structure: null` (not absent) and `major_projects: null` (not absent) when thin materials prevent reliable extraction. The schema requires both fields to be present.
```

- [ ] **Step 2: Append the new fields to the `# Output schema` section**

In `lib/ai/prompts/capture-synthesis.md`, locate the closing ```` ``` ```` of the output schema code fence (after the `course_emphasis` entry). Insert the following two entries before the closing fence:

```jsonc
  "class_structure": {
    "topics": ["<ordered unit/lab titles>", ...],
    "cadence": "<weekly rhythm, e.g. two 75-min sessions per week>",
    "assessment": "<plain prose, e.g. Three tests, two major projects, and weekly labs.>",
    "source": "materials" | "instructor" | "inferred" | null,
    "citations": [ { "type": "chunk", "chunkId": "...", "messageId": null, "excerpt": "≤200 chars" }, ... ]
  } | null,
  "major_projects": [
    {
      "title": "<project title>",
      "description": "<1-3 sentences on what students produce and decide>",
      "competencies": ["<competency statement matching profile.competencies[].statement>", ...],
      "source": "materials" | "instructor" | "inferred" | null,
      "citations": [ { "type": "chunk", "chunkId": "...", "messageId": null, "excerpt": "≤200 chars" }, ... ]
    }
  ] | null
```

- [ ] **Step 3: Manual verification — acceptance criteria**

Trigger synthesis for GC 3460 (or any course with a full materials set) via the capture UI:

1. Open `/capture/GC%203460` (or the appropriate code), resume chat if needed, and click "Generate Profile."
2. In the generated profile JSON (visible in the Review Panel's raw view or the snapshot JSON), confirm:
   a. `class_structure` is non-null and has `topics` (array of ≥1 strings), `cadence` (string ≥5 chars), `assessment` (string ≥10 chars).
   b. `major_projects` is non-null with ≥1 entry, each having `title`, `description`, and `competencies[]` that match statements in `competencies`.
   c. `captureProfileSchema.parse(profile)` succeeds (no Zod error in the server log).
3. For a course with thin materials (e.g., one with no rubrics), confirm `class_structure: null` and/or `major_projects: null` — not an empty object or empty array.

- [ ] **Step 4: Commit**

```bash
git add lib/ai/prompts/capture-synthesis.md
git commit -m "feat(prompt): add class_structure + major_projects extraction section to capture-synthesis"
```

---

## Increment 3 — Faculty review UI

### Task 4: Create `ClassStructureSection` component

**Files:**
- Create: `app/capture/[code]/ClassStructureSection.tsx`

No unit tests are sensible for a pure UI component of this kind. Acceptance criteria are in Step 3.

- [ ] **Step 1: Create `app/capture/[code]/ClassStructureSection.tsx`**

```typescript
'use client';

import { useState } from 'react';
import type { CaptureClassStructure, CaptureProfileCitationType } from '@/lib/ai/capture/schema';
import { SourceBadge } from './ProfileReviewPanel';

interface ClassStructureSectionProps {
  classStructure: CaptureClassStructure | null | undefined;
  editable: boolean;
  onChange: (next: CaptureClassStructure | null) => void;
  onCitationClick?: (c: CaptureProfileCitationType) => void;
}

export function ClassStructureSection({
  classStructure,
  editable,
  onChange,
  onCitationClick,
}: ClassStructureSectionProps) {
  const [editingTopicIndex, setEditingTopicIndex] = useState<number | null>(null);

  if (!classStructure) {
    return (
      <section className="rounded-md border bg-card px-4 py-3 text-sm">
        <h3 className="font-semibold text-sm">Class structure</h3>
        <p className="mt-1 text-xs italic text-muted-foreground">
          Not yet captured — re-audit to extract class structure from course materials.
        </p>
      </section>
    );
  }

  function handleTopicChange(i: number, val: string) {
    const next = classStructure!.topics.slice();
    next[i] = val;
    onChange({ ...classStructure!, topics: next });
  }

  function handleTopicBlur(i: number) {
    if (classStructure!.topics[i] === '') {
      const next = classStructure!.topics.filter((_, idx) => idx !== i);
      onChange({ ...classStructure!, topics: next });
    }
    setEditingTopicIndex(null);
  }

  function handleTopicKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const next = [
        ...classStructure!.topics.slice(0, i + 1),
        '',
        ...classStructure!.topics.slice(i + 1),
      ];
      onChange({ ...classStructure!, topics: next });
      setEditingTopicIndex(i + 1);
    } else if (e.key === 'Backspace' && classStructure!.topics[i] === '') {
      e.preventDefault();
      const next = classStructure!.topics.filter((_, idx) => idx !== i);
      onChange({ ...classStructure!, topics: next });
      setEditingTopicIndex(Math.max(0, i - 1));
    }
  }

  function handleAddTopic() {
    const next = [...classStructure!.topics, ''];
    onChange({ ...classStructure!, topics: next });
    setEditingTopicIndex(next.length - 1);
  }

  return (
    <section className="rounded-md border bg-card px-4 py-3 space-y-3">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold">Class structure</h3>
        <SourceBadge
          source={classStructure.source}
          citations={classStructure.citations}
          onCitationClick={onCitationClick}
        />
      </div>

      {/* Topics */}
      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Topics covered (in order)
        </p>
        <ol className="space-y-1 list-decimal list-inside">
          {classStructure.topics.map((topic, i) => (
            <li key={i} className="flex items-baseline gap-1">
              <span className="text-xs tabular-nums text-muted-foreground select-none mr-1">
                {i + 1}.
              </span>
              {editable && editingTopicIndex === i ? (
                <input
                  autoFocus
                  type="text"
                  value={topic}
                  onChange={e => handleTopicChange(i, e.target.value)}
                  onBlur={() => handleTopicBlur(i)}
                  onKeyDown={e => handleTopicKeyDown(i, e)}
                  className="flex-1 text-xs bg-muted/40 rounded-sm px-1 focus:outline-none focus:ring-1 focus:ring-ring border-0"
                />
              ) : (
                <span
                  onClick={() => editable && setEditingTopicIndex(i)}
                  className={
                    'flex-1 text-xs leading-snug' +
                    (editable ? ' cursor-text hover:bg-muted/40 rounded-sm px-1' : '')
                  }
                >
                  {topic}
                </span>
              )}
            </li>
          ))}
        </ol>
        {editable && (
          <button
            type="button"
            onClick={handleAddTopic}
            className="mt-1 text-[11px] text-muted-foreground hover:text-foreground border border-dashed border-muted-foreground/40 rounded px-2 py-0.5"
          >
            + Add topic
          </button>
        )}
      </div>

      {/* Cadence */}
      <div className="space-y-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Cadence
        </p>
        {editable ? (
          <input
            type="text"
            value={classStructure.cadence}
            onChange={e => onChange({ ...classStructure!, cadence: e.target.value })}
            className="w-full text-xs bg-muted/40 rounded-sm px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring border border-input"
          />
        ) : (
          <p className="text-xs">{classStructure.cadence}</p>
        )}
      </div>

      {/* Assessment */}
      <div className="space-y-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Assessment overview
        </p>
        {editable ? (
          <textarea
            value={classStructure.assessment}
            onChange={e => onChange({ ...classStructure!, assessment: e.target.value })}
            rows={2}
            className="w-full resize-none text-xs bg-muted/40 rounded-sm px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring border border-input"
          />
        ) : (
          <p className="text-xs">{classStructure.assessment}</p>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Create `app/capture/[code]/MajorProjectsSection.tsx`**

```typescript
'use client';

import { useState } from 'react';
import type {
  CaptureProjectItem,
  CaptureProfileCitationType,
  CaptureClassStructure,
} from '@/lib/ai/capture/schema';
import { SourceBadge } from './ProfileReviewPanel';

interface MajorProjectsSectionProps {
  majorProjects: CaptureProjectItem[] | null | undefined;
  editable: boolean;
  onChange: (next: CaptureProjectItem[] | null) => void;
  onCitationClick?: (c: CaptureProfileCitationType) => void;
}

function ProjectCard({
  project,
  index,
  editable,
  onChange,
  onRemove,
  onCitationClick,
}: {
  project: CaptureProjectItem;
  index: number;
  editable: boolean;
  onChange: (next: CaptureProjectItem) => void;
  onRemove: () => void;
  onCitationClick?: (c: CaptureProfileCitationType) => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);

  return (
    <div className="rounded border bg-background px-3 py-2.5 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-baseline gap-2 flex-1 min-w-0">
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {index + 1}.
          </span>
          {editable ? (
            <input
              type="text"
              value={project.title}
              onChange={e => onChange({ ...project, title: e.target.value })}
              placeholder="Project title"
              className="flex-1 text-sm font-medium bg-muted/40 rounded-sm px-1 focus:outline-none focus:ring-1 focus:ring-ring border-0"
            />
          ) : (
            <span className="text-sm font-medium">{project.title}</span>
          )}
          <SourceBadge
            source={project.source}
            citations={project.citations}
            onCitationClick={onCitationClick}
          />
        </div>
        {editable && (
          <div className="shrink-0">
            {confirmRemove ? (
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={onRemove}
                  className="text-[10px] text-destructive border border-destructive rounded px-1.5 py-0.5 hover:bg-destructive/10"
                >
                  Remove
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRemove(false)}
                  className="text-[10px] text-muted-foreground border rounded px-1.5 py-0.5 hover:bg-muted"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmRemove(true)}
                className="text-[10px] text-muted-foreground hover:text-foreground border rounded px-1.5 py-0.5"
              >
                ×
              </button>
            )}
          </div>
        )}
      </div>

      {/* Description */}
      {editable ? (
        <textarea
          value={project.description}
          onChange={e => onChange({ ...project, description: e.target.value })}
          placeholder="1-3 sentences describing what students produce…"
          rows={2}
          className="w-full resize-none text-xs bg-muted/40 rounded-sm px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring border border-input"
        />
      ) : (
        <p className="text-xs leading-snug">{project.description}</p>
      )}

      {/* Competency tags — read-only (derived from competencies array) */}
      {project.competencies.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide self-center mr-1">
            Develops:
          </span>
          {project.competencies.map((comp, ci) => (
            <span
              key={ci}
              className="inline-flex items-center rounded border bg-muted/60 px-1.5 py-0.5 text-[10px] leading-snug"
              title={comp}
            >
              {comp.length > 60 ? comp.slice(0, 57) + '…' : comp}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function MajorProjectsSection({
  majorProjects,
  editable,
  onChange,
  onCitationClick,
}: MajorProjectsSectionProps) {
  if (!majorProjects) {
    return (
      <section className="rounded-md border bg-card px-4 py-3 text-sm">
        <h3 className="font-semibold text-sm">Major projects</h3>
        <p className="mt-1 text-xs italic text-muted-foreground">
          Not yet captured — re-audit to extract major projects from course materials.
        </p>
      </section>
    );
  }

  function handleProjectChange(i: number, next: CaptureProjectItem) {
    const updated = majorProjects!.slice();
    updated[i] = next;
    onChange(updated);
  }

  function handleRemoveProject(i: number) {
    const next = majorProjects!.filter((_, idx) => idx !== i);
    onChange(next.length > 0 ? next : null);
  }

  function handleAddProject() {
    const blank: CaptureProjectItem = {
      title: '',
      description: '',
      competencies: [],
    };
    onChange([...majorProjects!, blank]);
  }

  return (
    <section className="rounded-md border bg-card px-4 py-3 space-y-3">
      <h3 className="text-sm font-semibold">Major projects</h3>

      {majorProjects.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">(none captured)</p>
      ) : (
        <div className="space-y-2">
          {majorProjects.map((proj, i) => (
            <ProjectCard
              key={i}
              project={proj}
              index={i}
              editable={editable}
              onChange={next => handleProjectChange(i, next)}
              onRemove={() => handleRemoveProject(i)}
              onCitationClick={onCitationClick}
            />
          ))}
        </div>
      )}

      {editable && (
        <button
          type="button"
          onClick={handleAddProject}
          className="text-[11px] text-muted-foreground hover:text-foreground border border-dashed border-muted-foreground/40 rounded px-2 py-0.5"
        >
          + Add project
        </button>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Wire both sections into `ProfileReviewPanel.tsx`**

In `ProfileReviewPanel.tsx`, add the two imports near the top (after the `CourseOverview` import):

```typescript
import { ClassStructureSection } from './ClassStructureSection';
import { MajorProjectsSection } from './MajorProjectsSection';
```

Add the two sections to the rendered JSX, immediately after the `CourseOverview` block (after `</div>` closing the `rounded-md border bg-card px-6 py-8` div for CourseOverview), and before the `{legacy && <LegacyBanner ... />}` line:

```tsx
{/* ── Class structure — editable structured section ── */}
<ClassStructureSection
  classStructure={working.class_structure ?? null}
  editable={true}
  onChange={(next) => {
    setWorking({ ...working, class_structure: next ?? undefined });
    setStressTestResult(null);
  }}
  onCitationClick={handleCitationClick}
/>

{/* ── Major projects — editable project cards ── */}
<MajorProjectsSection
  majorProjects={working.major_projects ?? null}
  editable={true}
  onChange={(next) => {
    setWorking({ ...working, major_projects: next ?? undefined });
    setStressTestResult(null);
  }}
  onCitationClick={handleCitationClick}
/>
```

- [ ] **Step 4: Manual acceptance criteria**

Build and open the capture UI:

```bash
cd /Users/admin/projects/curriculum_developer
pnpm dev
```

1. Navigate to `/capture/GC%203460` (a course with an existing snapshot). Confirm:
   - If the snapshot's profile has `class_structure: null` or it is absent: a "Not yet captured" notice renders for Class structure.
   - If `major_projects: null` or absent: same notice for Major projects.
2. If the snapshot has `class_structure` populated (after running synthesis per Increment 2): the topics list, cadence input, and assessment textarea are visible and editable.
3. Edit cadence → click "Save edits" → confirm the changed value appears in the saved draft (no TypeScript build error, no Zod validation error).
4. For a legacy snapshot (no new fields): no crash, both sections show "Not yet captured."

- [ ] **Step 5: Run the test suite**

```bash
cd /Users/admin/projects/curriculum_developer
pnpm test 2>&1 | tail -10
```

Expected: Same baseline pass count, 0 new failures.

- [ ] **Step 6: Commit**

```bash
git add app/capture/\[code\]/ClassStructureSection.tsx \
        app/capture/\[code\]/MajorProjectsSection.tsx \
        app/capture/\[code\]/ProfileReviewPanel.tsx
git commit -m "feat(ui): ClassStructureSection + MajorProjectsSection in ProfileReviewPanel"
```

---

## Increment 4 — wiki-update input expansion + course-page template

### Task 5: Extend `loadCourseInfo` and `updateWikiForSnapshot` in `lib/ai/wiki/update.ts`

**Files:**
- Modify: `lib/ai/wiki/update.ts`
- Create: `tests/lib/ai/wiki/loadCourseInfo.test.ts`

- [ ] **Step 1: Write the failing test** — create `tests/lib/ai/wiki/loadCourseInfo.test.ts`:

This test covers the pure merge logic by importing the *helper function* that merges sheet data onto the DB row. Because `loadCourseInfo` makes DB + network calls, we extract the pure merge step into a testable function `mergeCourseInfo`. The test imports it:

```typescript
import { describe, it, expect } from 'vitest';
import { mergeCourseInfo, type CourseDbRow, type CourseInfoExtended } from '@/lib/ai/wiki/update';
import type { ParsedCourse } from '@/lib/sheets/parseCourseTab';

// mergeCourseInfo is a named export of the pure merge function (no I/O).

const dbRow: CourseDbRow = {
  title: 'Color Science',
  level: 3460,
  prerequisites: 'GC 1010, GC 2050',
};

const sheetData: ParsedCourse = {
  code: 'GC 3460',
  title: 'Color Science & Management',
  level: 3460,
  track: 'Production',
  description: 'Studio-intensive course covering press-floor color science.',
  prerequisites: 'GC 1010',
  syllabusUrl: 'https://example.com/gc3460-syllabus.pdf',
  learningObjectives: ['Operate spectrophotometers', 'Generate ICC profiles'],
  majorProjects: ['Brand Color Report', 'Press Check Portfolio'],
  skillsRequired: ['Basic color theory'],
};

describe('mergeCourseInfo', () => {
  it('sheet title takes precedence over DB title', () => {
    const info = mergeCourseInfo(dbRow, sheetData);
    expect(info.title).toBe('Color Science & Management');
  });

  it('sheet description populates sheetDescription', () => {
    const info = mergeCourseInfo(dbRow, sheetData);
    expect(info.sheetDescription).toBe('Studio-intensive course covering press-floor color science.');
  });

  it('sheet majorProjects populates sheetMajorProjects', () => {
    const info = mergeCourseInfo(dbRow, sheetData);
    expect(info.sheetMajorProjects).toEqual(['Brand Color Report', 'Press Check Portfolio']);
  });

  it('sheet learningObjectives populates sheetLearningObjectives', () => {
    const info = mergeCourseInfo(dbRow, sheetData);
    expect(info.sheetLearningObjectives).toEqual(['Operate spectrophotometers', 'Generate ICC profiles']);
  });

  it('syllabusUrl comes from sheet', () => {
    const info = mergeCourseInfo(dbRow, sheetData);
    expect(info.syllabusUrl).toBe('https://example.com/gc3460-syllabus.pdf');
  });

  it('sheetSourceUrl is set when sheetData is provided and GOOGLE_SHEET_ID is set', () => {
    process.env.GOOGLE_SHEET_ID = 'ABC123';
    const info = mergeCourseInfo(dbRow, sheetData);
    expect(info.sheetSourceUrl).toBe('https://docs.google.com/spreadsheets/d/ABC123');
    delete process.env.GOOGLE_SHEET_ID;
  });

  it('falls back to DB title when sheetData is null', () => {
    const info = mergeCourseInfo(dbRow, null);
    expect(info.title).toBe('Color Science');
  });

  it('all sheet-derived fields are null/empty when sheetData is null', () => {
    const info = mergeCourseInfo(dbRow, null);
    expect(info.sheetDescription).toBeNull();
    expect(info.sheetMajorProjects).toEqual([]);
    expect(info.sheetLearningObjectives).toEqual([]);
    expect(info.sheetSkillsRequired).toEqual([]);
    expect(info.syllabusUrl).toBeNull();
    expect(info.sheetSourceUrl).toBeNull();
  });

  it('prerequisites are normalized from comma-separated string', () => {
    const info = mergeCourseInfo(dbRow, null);
    expect(info.prerequisites).toEqual(['gc-1010', 'gc-2050']);
  });

  it('prerequisites from DB array are preserved as slugs', () => {
    const info = mergeCourseInfo({ ...dbRow, prerequisites: ['GC 1010', 'GC 2050'] as unknown as string }, null);
    expect(info.prerequisites).toEqual(['gc-1010', 'gc-2050']);
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
cd /Users/admin/projects/curriculum_developer
pnpm test tests/lib/ai/wiki/loadCourseInfo.test.ts 2>&1 | tail -20
```

Expected: FAIL — `mergeCourseInfo`, `CourseDbRow`, `CourseInfoExtended` not exported from `update.ts`.

- [ ] **Step 3: Extend `lib/ai/wiki/update.ts`**

**(a) Expand imports** — add `fetchLiveCourseFromSheet` at the top of `update.ts`:

```typescript
import { fetchLiveCourseFromSheet } from '@/lib/sheets/fetchLiveCourse';
import type { ParsedCourse } from '@/lib/sheets/parseCourseTab';
```

**(b) Replace the `CourseInfo` interface** with the expanded version and export the `CourseDbRow` type and the pure `mergeCourseInfo` helper. Find the existing `interface CourseInfo` block and `loadCourseInfo` function and replace the entire block (lines ~546–580) with:

```typescript
// ---------------------------------------------------------------------------
// Course-info loader (extended 2026-06-08: sheet merge)
// ---------------------------------------------------------------------------

/** Shape of the DB columns we select from `courses`. */
export interface CourseDbRow {
  title: string | null;
  level: number | null;
  prerequisites: string | string[] | null;
}

interface CourseInfo {
  title: string;
  level: number;
  prerequisites: string[];
  sheetDescription: string | null;
  sheetLearningObjectives: string[];
  sheetMajorProjects: string[];
  sheetSkillsRequired: string[];
  syllabusUrl: string | null;
  sheetSourceUrl: string | null;
}

// Exported for unit tests — no I/O.
export type CourseInfoExtended = CourseInfo;

/**
 * Pure merge function — exported for tests.
 * Merges live sheet data (may be null) onto the DB row.
 * Sheet fields take precedence for live content.
 */
export function mergeCourseInfo(
  row: CourseDbRow,
  sheet: ParsedCourse | null,
): CourseInfo {
  const prereqRaw = row.prerequisites;
  const prerequisites: string[] = Array.isArray(prereqRaw)
    ? (prereqRaw as string[]).map(p => courseCodeToSlug(String(p)))
    : typeof prereqRaw === 'string' && prereqRaw.trim().length > 0
      ? prereqRaw.split(',').map(p => courseCodeToSlug(p.trim())).filter(Boolean)
      : [];

  const sheetId = process.env.GOOGLE_SHEET_ID?.trim() ?? null;

  return {
    title: sheet?.title ?? row.title ?? '',
    level: sheet?.level ?? row.level ?? 0,
    prerequisites,
    sheetDescription: sheet?.description ?? null,
    sheetLearningObjectives: sheet?.learningObjectives ?? [],
    sheetMajorProjects: sheet?.majorProjects ?? [],
    sheetSkillsRequired: sheet?.skillsRequired ?? [],
    syllabusUrl: sheet?.syllabusUrl ?? null,
    sheetSourceUrl: sheet && sheetId
      ? `https://docs.google.com/spreadsheets/d/${sheetId}`
      : null,
  };
}

async function loadCourseInfo(courseCode: string): Promise<CourseInfo> {
  // 1. Try the live sheet first (5s timeout, 60s in-process cache, fails silently).
  const sheetData = await fetchLiveCourseFromSheet(courseCode);

  // 2. Fall back to the DB courses row for fields the sheet didn't return.
  const rows = await db
    .select({
      title: courses.title,
      level: courses.level,
      prerequisites: courses.prerequisites,
    })
    .from(courses)
    .where(eq(courses.code, courseCode))
    .limit(1);

  const row = rows[0] ?? { title: courseCode, level: 0, prerequisites: null };
  return mergeCourseInfo(row, sheetData);
}
```

**(c) Extend the `userMessage` in `updateWikiForSnapshot`** — find the `userMessage` JSON assembly block (around line 735) and add the new fields under the `snapshot` key:

```typescript
const userMessage = JSON.stringify({
  snapshot: {
    id: snapshot.id,
    courseCode: snapshot.courseCode,
    courseSlug,
    courseTitle: courseInfo.title,
    courseLevel: courseInfo.level,
    coursePrerequisites: courseInfo.prerequisites,
    caption: snapshot.caption,
    reviewerNote: snapshot.reviewerNote,
    createdAt: snapshot.createdAt.toISOString(),
    profile: snapshot.profile,
    // New fields (2026-06-08): live sheet data — null/empty when sheet unavailable.
    courseDescription: courseInfo.sheetDescription,
    courseLearningObjectives: courseInfo.sheetLearningObjectives,
    courseMajorProjects: courseInfo.sheetMajorProjects,
    courseSkillsRequired: courseInfo.sheetSkillsRequired,
    syllabusUrl: courseInfo.syllabusUrl,
    sheetSourceUrl: courseInfo.sheetSourceUrl,
  },
  rawPaths,
  allSnapshotsForCourse: allSnapshots,
  affectedWikiPages: batch,
});
```

- [ ] **Step 4: Run the test**

```bash
cd /Users/admin/projects/curriculum_developer
pnpm test tests/lib/ai/wiki/loadCourseInfo.test.ts 2>&1 | tail -20
```

Expected: All PASS.

- [ ] **Step 5: Run the full suite**

```bash
cd /Users/admin/projects/curriculum_developer
pnpm test 2>&1 | tail -10
```

Expected: Same baseline pass count, 0 new failures.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/wiki/update.ts tests/lib/ai/wiki/loadCourseInfo.test.ts
git commit -m "feat(wiki): extend loadCourseInfo with sheet merge; pass courseDescription/majorProjects/syllabus to userMessage"
```

---

### Task 6: Update `lib/ai/prompts/wiki-update.md` — new course-page sections

**Files:**
- Modify: `lib/ai/prompts/wiki-update.md`

This is a prompt-only change. Acceptance criteria are manual (see Step 3).

- [ ] **Step 1: Update the `## Inputs you receive in the user message` JSON example**

In `lib/ai/prompts/wiki-update.md`, find the `"snapshot"` block in the Inputs section and add the new fields to it (after `"profile": { /* full CaptureProfile JSON */ }`):

```json
    "courseDescription": "<from the Google Sheet, or null>",
    "courseLearningObjectives": ["<objective>", ...],
    "courseMajorProjects": ["<project title from sheet>", ...],
    "courseSkillsRequired": ["<skill>", ...],
    "syllabusUrl": "<url or null>",
    "sheetSourceUrl": "<Google Sheet URL or null>"
```

- [ ] **Step 2: Add the three new sections to the course-page template**

In `lib/ai/prompts/wiki-update.md`, locate the **Body sections in order** list for the course page template. Currently it ends with:

```
8. **Source snapshots** — …
9. **Cross-references** — …
```

Replace with:

```
8. **Class structure** (new — see §8a below)
9. **Major projects** (new — see §8b below)
10. **Syllabus** (new — see §8c below)
11. **Source snapshots** — links to the JSON files in `raw/snapshots/<course-slug>/`. Most recent first. …
12. **Cross-references** — …
```

Then add the following three subsections after the course-page template's field-by-field description (before the `### Competency page` header):

```markdown
#### §8a — Class structure

Render this section **only** when `snapshot.profile.class_structure` is non-null.

```markdown
## Class structure

- **Topics covered:** {comma-separated ordered list from `profile.class_structure.topics`}
- **Cadence:** {`profile.class_structure.cadence`}
- **Assessment:** {`profile.class_structure.assessment`}
```

When `profile.class_structure` is null or absent, **omit the section entirely** (do not render a "not yet captured" placeholder — the absence is silent on the wiki page). There is no sheet fallback for class structure.

#### §8b — Major projects

Render from `profile.major_projects` when non-null and non-empty.

```markdown
## Major projects

- **{project.title}** — {project.description} Develops {competency references, one per listed competency in project.competencies}.
```

**Wikilink rule for competency references:** For each string in `project.competencies`, attempt to match it against the `sub_competencies` names you know from this snapshot's coverage substrate. If the string closely matches a sub-competency name that has a slug in the wiki (e.g., `"color-management"`), render `[[color-management|competency statement]]`. If no clear match exists, render the statement as plain text. Do NOT guess slugs; plain text is always the safe fallback.

**Sheet fallback:** If `profile.major_projects` is null or empty AND `snapshot.courseMajorProjects[]` is non-empty, render:

```markdown
## Major projects

*The following project list comes from the course sheet — not yet captured in a profile audit.*

- {project title from snapshot.courseMajorProjects}
```

If both `profile.major_projects` and `snapshot.courseMajorProjects` are null/empty, **omit the section**.

#### §8c — Syllabus

Render this section **only** when at least one of `snapshot.courseDescription`, `snapshot.courseLearningObjectives[]` (non-empty), `snapshot.courseSkillsRequired[]` (non-empty), `snapshot.syllabusUrl`, or `snapshot.sheetSourceUrl` is non-null/non-empty.

```markdown
## Syllabus

{snapshot.courseDescription — 1-3 sentences. Omit this paragraph if courseDescription is null.}

**Learning objectives:**

- {objective from snapshot.courseLearningObjectives}

**Skills students should arrive with:**

- {skill from snapshot.courseSkillsRequired}

**Major projects:** see [Major projects](#major-projects) above.

**Links:** [Syllabus PDF]({syllabusUrl}) · [Course sheet]({sheetSourceUrl})
```

Rules:
- The **Learning objectives** sublist is omitted when `snapshot.courseLearningObjectives` is empty.
- The **Skills students should arrive with** sublist is omitted when `snapshot.courseSkillsRequired` is empty.
- The **Major projects** cross-reference line is omitted when the Major projects section (§8b) is also absent.
- The **Links** line is omitted when both `snapshot.syllabusUrl` and `snapshot.sheetSourceUrl` are null.
- When none of these conditions are met, omit the entire section.
```

- [ ] **Step 3: Manual acceptance criteria**

Trigger wiki regeneration for GC 3460 (or any course with a non-null `class_structure` and a Google Sheet entry):

1. With `GOOGLE_SHEET_ID` set: regenerate the wiki for a course with a v2+ snapshot. Open `courses/gc-3460.md` in the wiki repo and confirm:
   - Section `## Class structure` is present with Topics, Cadence, and Assessment when `profile.class_structure` is non-null.
   - Section `## Major projects` lists the profile's projects or the sheet fallback with the "from the course sheet" label.
   - Section `## Syllabus` is present with the description paragraph and/or objective list.
   - Source snapshots now appears as §11, Cross-references as §12.

2. With `GOOGLE_SHEET_ID` unset (or set to empty): regenerate for a legacy snapshot (null new fields). Confirm:
   - `## Class structure` is absent (no placeholder text).
   - `## Major projects` is absent (no placeholder text).
   - `## Syllabus` is absent.
   - No exception in the server log.

- [ ] **Step 4: Commit**

```bash
git add lib/ai/prompts/wiki-update.md
git commit -m "feat(wiki-prompt): add Class structure / Major projects / Syllabus sections to course-page template"
```

---

## Increment 5 — Backward-compat + fallback verification

### Task 7: Backward-compat integration test for `updateWikiForSnapshot`

**Files:**
- Create: `tests/lib/ai/wiki/backward-compat.test.ts`

This test covers the merge logic and the `GOOGLE_SHEET_ID`-unset fallback using the pure `mergeCourseInfo` helper (no LLM call, no DB). It also exercises `captureProfileSchema.parse` on a legacy fixture to confirm no Zod crash.

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mergeCourseInfo } from '@/lib/ai/wiki/update';
import { captureProfileSchema } from '@/lib/ai/capture/schema';

// ---------------------------------------------------------------------------
// GOOGLE_SHEET_ID unset → all sheet-derived fields null/empty
// ---------------------------------------------------------------------------
describe('mergeCourseInfo — GOOGLE_SHEET_ID unset', () => {
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env.GOOGLE_SHEET_ID;
    delete process.env.GOOGLE_SHEET_ID;
  });

  afterEach(() => {
    if (prev !== undefined) process.env.GOOGLE_SHEET_ID = prev;
    else delete process.env.GOOGLE_SHEET_ID;
  });

  it('sheetSourceUrl is null when GOOGLE_SHEET_ID is unset', () => {
    // Even if sheetData were provided by some other mechanism, sheetSourceUrl
    // depends on GOOGLE_SHEET_ID being set.
    const info = mergeCourseInfo({ title: 'Test', level: 1000, prerequisites: null }, null);
    expect(info.sheetSourceUrl).toBeNull();
  });

  it('all sheet fields are null/empty when sheetData is null', () => {
    const info = mergeCourseInfo({ title: 'Test', level: 1000, prerequisites: null }, null);
    expect(info.sheetDescription).toBeNull();
    expect(info.sheetLearningObjectives).toEqual([]);
    expect(info.sheetMajorProjects).toEqual([]);
    expect(info.sheetSkillsRequired).toEqual([]);
    expect(info.syllabusUrl).toBeNull();
    expect(info.sheetSourceUrl).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// captureProfileSchema backward compat — legacy snapshots parse cleanly
// ---------------------------------------------------------------------------
describe('captureProfileSchema — legacy snapshot backward compat', () => {
  // Minimal pre-2026-06-08 snapshot: no class_structure, no major_projects.
  const legacyProfile = {
    course_code: 'GC 1010',
    scale_version: 'v1' as const,
    generated_at: '2026-05-15T12:00:00Z',
    overview: null,
    competencies: [
      {
        statement: 'Students identify primary print processes.',
        type: 'technical' as const,
        k_depth: 2,
        u_depth: 1,
        d_depth: 1,
        evidence_k: 'Quiz 1 asks to identify letterpress.',
        evidence_u: null,
        evidence_d: 'Lab 1 tour report.',
        rationale: 'Exposure-level course.',
      },
    ],
    incoming_expectations: [],
    verification_summary: {
      course_shape: 'Survey course.',
      strongest_evidence: ['Quiz 1'],
      dimensional_patterns: [],
      catalog_vs_evidence: [],
      foundationals_glance: 'Agency observed.',
    },
    audit_notes: {
      prereq_gaps: [],
      objective_misalignments: [],
      cross_source_conflicts: [],
      suggested_objective_revisions: [],
      productive_failure_conditions: null,
    },
    revised_objectives_draft: null,
    course_emphasis: null,
    // Explicitly omit class_structure and major_projects
  };

  it('parses a legacy profile with no class_structure or major_projects', () => {
    expect(() => captureProfileSchema.parse(legacyProfile)).not.toThrow();
  });

  it('parsed legacy profile has undefined (not null) for new fields', () => {
    const result = captureProfileSchema.parse(legacyProfile);
    expect(result.class_structure).toBeUndefined();
    expect(result.major_projects).toBeUndefined();
  });

  it('parses when class_structure is explicitly null', () => {
    expect(() =>
      captureProfileSchema.parse({ ...legacyProfile, class_structure: null })
    ).not.toThrow();
  });

  it('parses when major_projects is explicitly null', () => {
    expect(() =>
      captureProfileSchema.parse({ ...legacyProfile, major_projects: null })
    ).not.toThrow();
  });

  it('parses when both new fields are null', () => {
    expect(() =>
      captureProfileSchema.parse({
        ...legacyProfile,
        class_structure: null,
        major_projects: null,
      })
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
cd /Users/admin/projects/curriculum_developer
pnpm test tests/lib/ai/wiki/backward-compat.test.ts 2>&1 | tail -20
```

Expected: All PASS (the Zod schema and `mergeCourseInfo` are already in place from Tasks 1–5; this is a regression guard).

- [ ] **Step 3: Run the full test suite one final time**

```bash
cd /Users/admin/projects/curriculum_developer
pnpm test 2>&1 | tail -10
```

Expected: Same baseline pass count (or higher with the new tests), 0 failures.

- [ ] **Step 4: Final manual verification — end-to-end acceptance**

The feature is complete when all five conditions hold:

1. A fresh audit of GC 3460 produces `class_structure` (non-null with topics, cadence, assessment) and `major_projects` (≥1 entry) in the saved snapshot profile.
2. The Review Panel for that snapshot shows the Class structure section (topics list, cadence, assessment editable) and Major projects section (project cards).
3. The wiki course page for GC 3460 (`courses/gc-3460.md`) contains `## Class structure`, `## Major projects`, and `## Syllabus` sections.
4. `/ask` can answer "What are the major projects in GC 3460?" using the wiki page text (confirm via the chat UI).
5. A legacy snapshot (one without `class_structure` / `major_projects`) renders "Not yet captured" notices in the Review Panel and silently omits the new sections from the wiki page.

- [ ] **Step 5: Commit**

```bash
git add tests/lib/ai/wiki/backward-compat.test.ts
git commit -m "test(backward-compat): legacy snapshot + GOOGLE_SHEET_ID-unset guards for projects-first-class"
```

---

## State.md update

After all increments pass, update `docs/STATE.md` in the same session:

- Under **What's live**: add "Major projects, class structure, and syllabus are first-class in `CaptureProfile` (v3+ synthesis); Class structure and Major projects sections in Review Panel; Class structure, Major projects, Syllabus sections on wiki course pages."
- Under **Deferred / debt**: add "Capture-chat priming for class_structure / major_projects deferred (no Audit Area probe added; synthesis relies on materials + null fallback)."

```bash
git add docs/STATE.md
git commit -m "chore(state): update STATE.md for projects-first-class feature"
```

---

## Self-review checklist

**Spec coverage:**
- [x] `classStructureSchema` + `majorProjectItemSchema` + `CaptureClassStructure` + `CaptureProjectItem` → Task 1
- [x] `captureProfileSchema` fields `class_structure`, `major_projects` nullable/optional → Task 1
- [x] `captureProfileJsonSchemaV2` extended with strict-mode encoding → Task 2
- [x] Walker test for strict-mode compliance → Task 2
- [x] Synthesis prompt extraction rules + output-schema illustration → Task 3
- [x] `assessment` stub-over-null rule → Task 3 Step 1 (in the prompt)
- [x] Class Structure section in ProfileReviewPanel → Task 4
- [x] Major Projects section in ProfileReviewPanel → Task 4
- [x] "Not yet captured" notices for null fields → Task 4 (both components)
- [x] `loadCourseInfo` sheet merge → Task 5
- [x] `updateWikiForSnapshot` userMessage extension → Task 5
- [x] `wiki-update.md` Inputs block updated → Task 6 Step 1
- [x] Course-page body order updated → Task 6 Step 2
- [x] `## Class structure` section → Task 6 Step 2
- [x] `## Major projects` section with sheet fallback → Task 6 Step 2
- [x] `## Syllabus` section with all conditional render rules → Task 6 Step 2
- [x] Competency wikilink resolution rule (match vs. plain text) → Task 6 Step 2
- [x] `GOOGLE_SHEET_ID` unset → graceful omit → Task 7
- [x] Legacy snapshot backward compat → Task 7
- [x] Scale version NOT bumped (additive optional fields) → confirmed: plan does not touch `captureScaleVersion`
- [x] `captureProfileJsonSchema` v1 frozen → confirmed: only v2 gets the new fields
- [x] Deferred item noted in plan → yes (capture-chat priming at top)
- [x] STATE.md update step → yes (final step after increments)

**Placeholder scan:** No TBD, TODO, "implement later", "similar to above", or steps without code. Verification steps name exact files and expected outcomes.

**Type-name consistency:**
- `classStructureSchema` / `CaptureClassStructure` — consistent across Tasks 1, 2, 4, 5.
- `majorProjectItemSchema` / `CaptureProjectItem` — consistent across Tasks 1, 2, 4, 5.
- `class_structure` / `major_projects` — consistent camelCase/snake_case throughout.
- `mergeCourseInfo` / `CourseDbRow` / `CourseInfoExtended` — exported from `update.ts` and imported by test in Task 5.
- `CourseInfo` remains the internal `update.ts` interface; `CourseInfoExtended` is its exported type alias for tests — identical shape.
