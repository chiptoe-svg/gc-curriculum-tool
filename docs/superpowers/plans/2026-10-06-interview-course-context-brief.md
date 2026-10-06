# Interview Course-Context Brief Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the capture interview a deterministic, labelled brief of directly linked courses (prerequisites and dependents, with dependents' incoming expectations and major projects), and make `prereq_chain` return real neighbors from the course sheet.

**Architecture:** One shared prereq-code extractor (`lib/capture/prereq-codes.ts`) feeds a sheet prerequisite map (`lib/curriculum/sheet-prereq-graph.ts`). The map is unioned with `prerequisite_edges` in the `prereq_chain` tool, and drives a pure-render brief (`lib/capture/course-context-brief.ts`). The brief is appended to the interview's at-rest message in `buildAgentCall` (`lib/ai/agent/audit-agent.ts`) only — never to the scoring/stress-test context.

**Tech Stack:** Next.js 15, TypeScript strict, Drizzle (Postgres), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-06-interview-course-context-brief-design.md`

## Global Constraints

- No AI call in the brief; build + render are deterministic.
- No schema change, no migration, no DB writes. The shared Postgres is production — tests use mocks only.
- Brief heading, verbatim: `Neighboring courses — context for better questions, never evidence for this course's scores.`
- Size cap: 6,000 characters (~1,500 tokens). Prerequisites first, then dependents in code order; overflow trimmed with a count of what was left out.
- Directly linked courses only (prereqs of this course; courses listing it as a prereq).
- Every item carries a source label: `<CODE> capture snapshot YYYY-MM-DD`, `<CODE> capture draft (<reviewer status>)`, or `course sheet`.
- The brief is interview-only. Scores, stress test, and coverage scoring never receive it.
- Every regression test gets a red proof (run it failing before the implementation).
- NEVER use `pkill`/`killall` or kill by name/pattern; stop only processes you started, by PID.
- Work only in `/Users/admin/projects/curriculum_developer-wt-brief`. Explicit-path `git add` only. Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01YFqkp83wAJeqVK7QHjRrPm
  ```

## Rulings made while planning (deviations from the spec text, with reasons)

1. **Where the brief is wired.** The spec names `lib/ai/analyze/capture-chat.ts` as the interview's context assembly. It is not: since 2026-06-11 the chat route calls `runAuditAgent`/`streamAuditAgent`, whose at-rest context is built in `buildAgentCall` (`lib/ai/agent/audit-agent.ts`). `buildCaptureChatUserMessage` in `capture-chat.ts` is now used only by the **scores** and **stress-test** paths. Wiring the brief there would put it into scoring — the opposite of the spec. So the brief is built and appended in `buildAgentCall`, which both chat paths (stream and non-stream) share. The chat route file itself is unchanged.
2. **Prerequisite profiles are not in the v2 interview context.** The spec says "captured profiles are already loaded separately"; in v2 they are not (only the scores/stress-test path loads them). The brief still only points to captured prerequisites (code, title, capture label), as specified. The gap is recorded in STATE.md Deferred/debt as an owner decision, not fixed here.
3. **Draft fallback.** Dependents use snapshot first, draft second (same order as the scores route's prerequisite loader). GC 4060 has an `ai_drafted` draft and no snapshot, so GC 3460's brief shows GC 4060's draft expectations, labelled `GC 4060 capture draft (ai_drafted)`. (The spec's live-check note said "none captured".)
4. **Code matching.** `extractPrereqCodes` is moved verbatim (it uppercases, e.g. `GC 4900AP`); `loadSheetPrereqPairs` maps found codes back to canonical `courses.code` case-insensitively and drops codes not in `courses`.
5. **Failure isolation.** If building the brief throws, the interview proceeds without it (logged with `console.warn`). The brief is context, not a dependency.

## File Structure

- Create `lib/capture/prereq-codes.ts` — `extractPrereqCodes` (moved).
- Create `lib/curriculum/sheet-prereq-graph.ts` — sheet pairs (pure + loader), `prereqsOf`, `dependentsOf`, `mergePrereqPairs`.
- Create `lib/capture/course-context-brief.ts` — `buildCourseContextBrief`, `renderCourseContextBrief`, `BRIEF_HEADING`.
- Modify `app/api/capture/[code]/scores/route.ts`, `app/api/capture/[code]/stress-test/route.ts` — import the shared extractor (only change).
- Modify `lib/ai/wiki/graph-tools.ts` — `prereq_chain` uses the union.
- Modify `lib/ai/agent/audit-agent.ts` — append the brief to the at-rest message.
- Modify `lib/ai/prompts/capture-chat-agent.md` — at-rest bullet, section 1b rewrite, projects nudge.
- Modify `docs/STATE.md` (Task 5, controller).
- Tests: `lib/capture/__tests__/prereq-codes.test.ts`, `lib/curriculum/__tests__/sheet-prereq-graph.test.ts`, `lib/ai/wiki/__tests__/graph-tools-prereq-chain.test.ts`, `lib/capture/__tests__/course-context-brief.test.ts`, `lib/ai/agent/__tests__/audit-agent-brief.test.ts`, `app/api/capture/[code]/scores/__tests__/no-brief.test.ts`, `lib/ai/prompts/__tests__/capture-chat-agent-brief.test.ts`.

Run commands from `/Users/admin/projects/curriculum_developer-wt-brief`. Single test file: `npx vitest run <path>`. Types: `npx tsc --noEmit -p .`.

---

### Task 1: Shared `extractPrereqCodes`

**Files:**
- Create: `lib/capture/prereq-codes.ts`
- Modify: `app/api/capture/[code]/scores/route.ts` (delete local `COURSE_CODE_RE` + `extractPrereqCodes`, ~lines 17-23; add import)
- Modify: `app/api/capture/[code]/stress-test/route.ts` (same, ~lines 17-23)
- Test: `lib/capture/__tests__/prereq-codes.test.ts`

**Interfaces:**
- Produces: `export function extractPrereqCodes(prerequisites: string, selfCode: string): string[]`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { extractPrereqCodes } from '@/lib/capture/prereq-codes';

describe('extractPrereqCodes', () => {
  it('finds multiple codes in one line', () => {
    expect(extractPrereqCodes('GC 3460, GC 4060', 'GC 4070')).toEqual(['GC 3460', 'GC 4060']);
  });
  it('drops a self-reference', () => {
    expect(extractPrereqCodes('GC 3460 or GC 4070', 'GC 4070')).toEqual(['GC 3460']);
  });
  it('returns nothing for text without a course code', () => {
    expect(extractPrereqCodes('Sophomore standing', 'GC 3460')).toEqual([]);
  });
  it('dedupes and normalizes whitespace', () => {
    expect(extractPrereqCodes('GC  1040 (grade of C); GC 1040', 'GC 2070')).toEqual(['GC 1040']);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`Cannot find module '@/lib/capture/prereq-codes'`): `npx vitest run lib/capture/__tests__/prereq-codes.test.ts`

- [ ] **Step 3: Implement** — move the function verbatim:

```ts
/**
 * Course codes named in a course sheet "prerequisites" line. Shared by the
 * scores + stress-test routes and the sheet prerequisite map
 * (lib/curriculum/sheet-prereq-graph.ts). GC codes only (the sheet's own
 * vocabulary); the Clemson catalog is the planned authoritative source.
 */
const COURSE_CODE_RE = /GC\s+\d{4}[a-z]{0,2}/gi;

export function extractPrereqCodes(prerequisites: string, selfCode: string): string[] {
  const codes = (prerequisites.match(COURSE_CODE_RE) ?? [])
    .map(c => c.replace(/\s+/, ' ').toUpperCase().replace(/GC (\d)/, 'GC $1'));
  return Array.from(new Set(codes)).filter(c => c !== selfCode);
}
```

In both routes delete the local `COURSE_CODE_RE` and `extractPrereqCodes` and add `import { extractPrereqCodes } from '@/lib/capture/prereq-codes';`. No other change to those routes.

- [ ] **Step 4: Run** the new test, `npx vitest run app/api/capture` and `npx tsc --noEmit -p .` — all PASS.

- [ ] **Step 5: Commit** `lib/capture/prereq-codes.ts`, the test, and both route files: `refactor(capture): share extractPrereqCodes in lib/capture/prereq-codes`.

---

### Task 2: Sheet prerequisite map + `prereq_chain` fix

**Files:**
- Create: `lib/curriculum/sheet-prereq-graph.ts`
- Modify: `lib/ai/wiki/graph-tools.ts` (`prereqChainTool.execute` and its description)
- Test: `lib/curriculum/__tests__/sheet-prereq-graph.test.ts`, `lib/ai/wiki/__tests__/graph-tools-prereq-chain.test.ts`

**Interfaces:**
- Consumes: `extractPrereqCodes` (Task 1).
- Produces:
  ```ts
  export interface PrereqPair { focal: string; prereq: string }
  export function sheetPrereqPairsFrom(rows: ReadonlyArray<{ code: string; prerequisites: string | null }>): PrereqPair[];
  export async function loadSheetPrereqPairs(): Promise<PrereqPair[]>;
  export function prereqsOf(pairs: ReadonlyArray<PrereqPair>, code: string): string[];   // sorted, unique
  export function dependentsOf(pairs: ReadonlyArray<PrereqPair>, code: string): string[]; // sorted, unique
  export function mergePrereqPairs(...lists: ReadonlyArray<ReadonlyArray<PrereqPair>>): PrereqPair[]; // dedup on normalized (focal, prereq)
  ```

- [ ] **Step 1: Write failing tests** (`lib/curriculum/__tests__/sheet-prereq-graph.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { sheetPrereqPairsFrom, prereqsOf, dependentsOf, mergePrereqPairs } from '@/lib/curriculum/sheet-prereq-graph';

const rows = [
  { code: 'GC 1040', prerequisites: '' },
  { code: 'GC 3460', prerequisites: 'GC 1040' },
  { code: 'GC 4060', prerequisites: 'GC 3460' },
  { code: 'GC 4070', prerequisites: 'GC 3460, GC 4060' },
  { code: 'GC 4400', prerequisites: 'GC 3460 or GC 4400' },
  { code: 'GC 3700', prerequisites: 'Sophomore standing' },
  { code: 'GC 4480', prerequisites: 'GC 9999, GC 4060' },
  { code: 'GC 4900ap', prerequisites: 'GC 3700' },
  { code: 'GC 4999', prerequisites: 'GC 4900ap' },
];

describe('sheetPrereqPairsFrom', () => {
  const pairs = sheetPrereqPairsFrom(rows);
  it('gives both directions', () => {
    expect(prereqsOf(pairs, 'GC 3460')).toEqual(['GC 1040']);
    expect(dependentsOf(pairs, 'GC 3460')).toEqual(['GC 4060', 'GC 4070', 'GC 4400']);
  });
  it('reads multiple codes in one line', () => {
    expect(prereqsOf(pairs, 'GC 4070')).toEqual(['GC 3460', 'GC 4060']);
  });
  it('drops self-references', () => {
    expect(prereqsOf(pairs, 'GC 4400')).toEqual(['GC 3460']);
  });
  it('gives no pair for text without a code', () => {
    expect(prereqsOf(pairs, 'GC 3700')).toEqual([]);
  });
  it('drops codes not in courses', () => {
    expect(prereqsOf(pairs, 'GC 4480')).toEqual(['GC 4060']);
  });
  it('maps codes back to the canonical courses.code case', () => {
    expect(prereqsOf(pairs, 'GC 4999')).toEqual(['GC 4900ap']);
    expect(dependentsOf(pairs, 'gc 4900AP')).toEqual(['GC 4999']);
  });
});

describe('mergePrereqPairs', () => {
  it('unions and dedupes on normalized codes', () => {
    expect(mergePrereqPairs(
      [{ focal: 'GC 4060', prereq: 'GC 3460' }],
      [{ focal: 'gc  4060', prereq: 'GC 3460' }, { focal: 'GC 4070', prereq: 'GC 3460' }],
    )).toEqual([{ focal: 'GC 4060', prereq: 'GC 3460' }, { focal: 'GC 4070', prereq: 'GC 3460' }]);
  });
});
```

And `lib/ai/wiki/__tests__/graph-tools-prereq-chain.test.ts` (fake DB, empty `prerequisite_edges`):

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/prerequisite-edge-queries', () => ({ listEdgePairs: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/db/program-coverage-queries', () => ({ getMatrixData: vi.fn() }));
vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({
      from: async () => [
        { code: 'GC 1040', prerequisites: '' },
        { code: 'GC 3460', prerequisites: 'GC 1040' },
        { code: 'GC 4060', prerequisites: 'GC 3460' },
        { code: 'GC 4070', prerequisites: 'GC 3460, GC 4060' },
        { code: 'GC 4400', prerequisites: 'GC 3460' },
      ],
    }),
  },
}));

import { prereqChainTool } from '@/lib/ai/wiki/graph-tools';

describe('prereq_chain', () => {
  it("returns GC 3460's real neighbors when prerequisite_edges is empty", async () => {
    const out = await prereqChainTool.execute({ courseCode: 'GC 3460' }) as {
      directPrereqs: string[]; requiredBy: string[];
    };
    expect(out.directPrereqs).toEqual(['GC 1040']);
    expect([...out.requiredBy].sort()).toEqual(['GC 4060', 'GC 4070', 'GC 4400']);
  });
});
```

(If `execute` has a second required parameter in `ToolDefinition`, pass whatever minimal value the type requires — check `lib/ai/tool-use-types.ts`.)

- [ ] **Step 2: Run both — expect FAIL** (module missing; prereq_chain returns empty arrays). Record the red output for the prereq_chain test specifically: with only the module created but `graph-tools.ts` unchanged, it must fail on `directPrereqs` being `[]`.

- [ ] **Step 3: Implement** `lib/curriculum/sheet-prereq-graph.ts`:

```ts
/**
 * Prerequisite map read from the GC course sheet's `courses.prerequisites`
 * lines. Directly linked courses only. Spec:
 * docs/superpowers/specs/2026-10-06-interview-course-context-brief-design.md §1.
 * The Clemson catalog (via MCP) is the planned authoritative source.
 */
import { db } from '@/lib/db/client';
import { courses } from '@/lib/db/schema';
import { extractPrereqCodes } from '@/lib/capture/prereq-codes';

export interface PrereqPair { focal: string; prereq: string }

const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ');

export function sheetPrereqPairsFrom(
  rows: ReadonlyArray<{ code: string; prerequisites: string | null }>,
): PrereqPair[] {
  const canonical = new Map(rows.map(r => [norm(r.code), r.code]));
  const pairs: PrereqPair[] = [];
  for (const r of rows) {
    for (const found of extractPrereqCodes(r.prerequisites ?? '', r.code)) {
      const prereq = canonical.get(norm(found));
      if (!prereq || norm(prereq) === norm(r.code)) continue;
      pairs.push({ focal: r.code, prereq });
    }
  }
  return mergePrereqPairs(pairs);
}

export async function loadSheetPrereqPairs(): Promise<PrereqPair[]> {
  const rows = await db.select({ code: courses.code, prerequisites: courses.prerequisites }).from(courses);
  return sheetPrereqPairsFrom(rows);
}

export function prereqsOf(pairs: ReadonlyArray<PrereqPair>, code: string): string[] {
  const c = norm(code);
  return [...new Set(pairs.filter(p => norm(p.focal) === c).map(p => p.prereq))].sort();
}

export function dependentsOf(pairs: ReadonlyArray<PrereqPair>, code: string): string[] {
  const c = norm(code);
  return [...new Set(pairs.filter(p => norm(p.prereq) === c).map(p => p.focal))].sort();
}

export function mergePrereqPairs(...lists: ReadonlyArray<ReadonlyArray<PrereqPair>>): PrereqPair[] {
  const seen = new Set<string>();
  const out: PrereqPair[] = [];
  for (const list of lists) for (const p of list) {
    const k = `${norm(p.focal)}|${norm(p.prereq)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}
```

In `lib/ai/wiki/graph-tools.ts`: import `loadSheetPrereqPairs, mergePrereqPairs` from `@/lib/curriculum/sheet-prereq-graph`; change `execute` to

```ts
    const [edgePairs, sheetPairs] = await Promise.all([listEdgePairs(), loadSheetPrereqPairs()]);
    return prereqNeighborhood(mergePrereqPairs(edgePairs, sheetPairs), courseCode);
```

and change the description's "A typed-graph query over prerequisite_edges." to "A typed-graph query over prerequisite_edges plus the course sheet's prerequisite lines." Leave `prereqNeighborhood` unchanged.

- [ ] **Step 4: Run** both tests, `npx vitest run lib/ai`, `npx tsc --noEmit -p .` — PASS.

- [ ] **Step 5: Commit** the new module, both tests, `graph-tools.ts`: `feat(curriculum): sheet prerequisite map; prereq_chain reads it (prerequisite_edges is empty)`.

---

### Task 3: The course-context brief (build + render)

**Files:**
- Create: `lib/capture/course-context-brief.ts`
- Test: `lib/capture/__tests__/course-context-brief.test.ts`

**Interfaces:**
- Consumes: `loadSheetPrereqPairs`, `prereqsOf`, `dependentsOf` (Task 2); `getCourseByCode` (`@/lib/db/courses-queries`); `getLatestSnapshotByCourse` (`@/lib/db/capture-snapshots-queries`, returns `{ profile: CaptureProfile; createdAt: Date; ... } | null`); `getCaptureProfileByCourse` (`@/lib/db/course-capture-profiles-queries`, returns `{ profile: CaptureProfile; reviewerStatus: string; ... } | null`).
- Produces:
  ```ts
  export const BRIEF_HEADING = "Neighboring courses — context for better questions, never evidence for this course's scores.";
  export const BRIEF_MAX_CHARS = 6000;
  export interface BriefPrereq { code: string; title: string; captureLabel: string | null } // null = not yet captured
  export interface BriefDependent {
    code: string; title: string;
    expectations: { source: string; items: string[] } | null; // null = not yet captured
    projects: { source: string; items: string[] };
  }
  export interface CourseContextBrief { courseCode: string; prerequisites: BriefPrereq[]; dependents: BriefDependent[] }
  export async function buildCourseContextBrief(courseCode: string): Promise<CourseContextBrief>;
  export function renderCourseContextBrief(brief: CourseContextBrief, maxChars?: number): string;
  ```

Rendering rules (exact strings the tests check):
- First line: `## ${BRIEF_HEADING}`.
- No prerequisites and no dependents → second line: `No linked courses: the course sheet lists no prerequisites for ${code}, and no course lists it as a prerequisite.` Nothing else.
- Otherwise sections `### Students arrive from` (one line per prereq: `- ${code} — ${title}: captured (${captureLabel})` or `- ${code} — ${title}: not yet captured`) and `### Courses that build on this one`. A section with no entries is written as its heading plus `- (none on the course sheet)`.
- Per dependent: `#### ${code} — ${title}`, then `- Expects students to arrive with (${source}):` followed by `  - ${item}` lines, or `- Expects students to arrive with: not yet captured`; then `- Major projects (${source}):` followed by `  - ${item}` lines, or `- Major projects: none listed`.
- Expectation item text: `${statement} (expects K${k ?? '–'} U${u ?? '–'} D${d})`.
- Capture project item text: `${title} — ${description}`; sheet project item: the sheet string.
- Source labels: snapshot → `${code} capture snapshot ${createdAt.toISOString().slice(0,10)}`; draft → `${code} capture draft (${reviewerStatus})`; sheet → `course sheet`. Projects come from the capture (`major_projects` non-empty) else sheet `courses.majorProjects`.
- Size cap: lines after the heading are emitted in order until the next line would push the total past `maxChars` minus room for the note; then stop and append `_(${n} more line(s) left out to stay within the size cap.)_`, where `n` is the count of lines not emitted. Order is prerequisites first, then dependents sorted by code (`dependentsOf` already sorts).

- [ ] **Step 1: Write failing tests** — mock the four DB modules:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const pairs = [
  { focal: 'GC 3460', prereq: 'GC 1040' },
  { focal: 'GC 4060', prereq: 'GC 3460' },
  { focal: 'GC 4400', prereq: 'GC 3460' },
];
vi.mock('@/lib/curriculum/sheet-prereq-graph', async (orig) => ({
  ...(await orig<typeof import('@/lib/curriculum/sheet-prereq-graph')>()),
  loadSheetPrereqPairs: vi.fn(async () => pairs),
}));
const courses: Record<string, { code: string; title: string; majorProjects: string[] }> = {
  'GC 1040': { code: 'GC 1040', title: 'Intro to Print', majorProjects: [] },
  'GC 3460': { code: 'GC 3460', title: 'Flexography', majorProjects: [] },
  'GC 4060': { code: 'GC 4060', title: 'Flexo Production', majorProjects: ['Sheet project A'] },
  'GC 4400': { code: 'GC 4400', title: 'Packaging', majorProjects: ['Board carton build'] },
  'GC 9000': { code: 'GC 9000', title: 'Island', majorProjects: [] },
};
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode: vi.fn(async (c: string) => courses[c] ?? null) }));
const snapshot = vi.fn();
const draft = vi.fn();
vi.mock('@/lib/db/capture-snapshots-queries', () => ({ getLatestSnapshotByCourse: (c: string) => snapshot(c) }));
vi.mock('@/lib/db/course-capture-profiles-queries', () => ({ getCaptureProfileByCourse: (c: string) => draft(c) }));

import { buildCourseContextBrief, renderCourseContextBrief, BRIEF_HEADING } from '@/lib/capture/course-context-brief';

const profile4060 = {
  incoming_expectations: [{ statement: 'Run a flexo press make-ready', expected_depth: { k: 2, u: null, d: 3 }, evidenced_by: ['x'], confidence: 'high' }],
  major_projects: [{ title: 'Film and board run', description: 'Students print a job on film and on board.', competencies: ['c'] }],
};

beforeEach(() => {
  snapshot.mockReset().mockImplementation(async (c: string) =>
    c === 'GC 4060' ? { profile: profile4060, createdAt: new Date('2026-08-14T12:00:00Z') }
    : c === 'GC 1040' ? { profile: { incoming_expectations: [], major_projects: [] }, createdAt: new Date('2026-06-18T12:00:00Z') }
    : null);
  draft.mockReset().mockResolvedValue(null);
});

describe('course-context brief', () => {
  it('shows a captured dependent\'s incoming expectations with a source label', async () => {
    const md = renderCourseContextBrief(await buildCourseContextBrief('GC 3460'));
    expect(md).toContain('#### GC 4060 — Flexo Production');
    expect(md).toContain('- Expects students to arrive with (GC 4060 capture snapshot 2026-08-14):');
    expect(md).toContain('  - Run a flexo press make-ready (expects K2 U– D3)');
    expect(md).toContain('- Major projects (GC 4060 capture snapshot 2026-08-14):');
    expect(md).toContain('  - Film and board run — Students print a job on film and on board.');
  });
  it('shows an uncaptured dependent as not yet captured, with sheet projects', async () => {
    const md = renderCourseContextBrief(await buildCourseContextBrief('GC 3460'));
    expect(md).toContain('#### GC 4400 — Packaging');
    expect(md).toContain('- Expects students to arrive with: not yet captured');
    expect(md).toContain('- Major projects (course sheet):\n  - Board carton build');
  });
  it('falls back to the draft profile, labelled as a draft', async () => {
    draft.mockImplementation(async (c: string) => c === 'GC 4400'
      ? { profile: { incoming_expectations: [{ statement: 'Score a dieline', expected_depth: { k: null, u: null, d: 2 }, evidenced_by: ['y'], confidence: 'low' }], major_projects: null }, reviewerStatus: 'ai_drafted' }
      : null);
    const md = renderCourseContextBrief(await buildCourseContextBrief('GC 3460'));
    expect(md).toContain('- Expects students to arrive with (GC 4400 capture draft (ai_drafted)):');
    expect(md).toContain('- Major projects (course sheet):\n  - Board carton build');
  });
  it('lists prerequisites first with capture status', async () => {
    const md = renderCourseContextBrief(await buildCourseContextBrief('GC 3460'));
    expect(md).toContain('- GC 1040 — Intro to Print: captured (GC 1040 capture snapshot 2026-06-18)');
    expect(md.indexOf('### Students arrive from')).toBeLessThan(md.indexOf('### Courses that build on this one'));
    expect(md.indexOf('GC 4060 — Flexo')).toBeLessThan(md.indexOf('GC 4400 — Packaging'));
  });
  it('starts with the never-evidence heading', async () => {
    const md = renderCourseContextBrief(await buildCourseContextBrief('GC 3460'));
    expect(md.split('\n')[0]).toBe(`## ${BRIEF_HEADING}`);
    expect(BRIEF_HEADING).toBe("Neighboring courses — context for better questions, never evidence for this course's scores.");
  });
  it('trims beyond the size cap and reports what was left out', async () => {
    const brief = await buildCourseContextBrief('GC 3460');
    const full = renderCourseContextBrief(brief);
    const capped = renderCourseContextBrief(brief, 300);
    expect(capped.length).toBeLessThanOrEqual(300);
    expect(capped).toMatch(/_\(\d+ more line\(s\) left out to stay within the size cap\.\)_$/);
    expect(full).not.toContain('left out');
  });
  it('gives a course with no links a one-line note', async () => {
    const md = renderCourseContextBrief(await buildCourseContextBrief('GC 9000'));
    expect(md).toBe(`## ${BRIEF_HEADING}\nNo linked courses: the course sheet lists no prerequisites for GC 9000, and no course lists it as a prerequisite.`);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing).

- [ ] **Step 3: Implement** `lib/capture/course-context-brief.ts`:

```ts
/**
 * Interview-only brief of directly linked courses: where students arrive from,
 * and what the courses that build on this one expect + their major projects.
 * Deterministic (no AI). Context for better questions — NEVER evidence for
 * this course's scores; never passed to scoring/stress-test.
 * Spec: docs/superpowers/specs/2026-10-06-interview-course-context-brief-design.md §2.
 */
import { getCourseByCode } from '@/lib/db/courses-queries';
import { getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import { getCaptureProfileByCourse } from '@/lib/db/course-capture-profiles-queries';
import { loadSheetPrereqPairs, prereqsOf, dependentsOf } from '@/lib/curriculum/sheet-prereq-graph';
import type { CaptureProfile } from '@/lib/ai/capture/schema';

export const BRIEF_HEADING = "Neighboring courses — context for better questions, never evidence for this course's scores.";
export const BRIEF_MAX_CHARS = 6000;

export interface BriefPrereq { code: string; title: string; captureLabel: string | null }
export interface BriefDependent {
  code: string;
  title: string;
  expectations: { source: string; items: string[] } | null;
  projects: { source: string; items: string[] };
}
export interface CourseContextBrief { courseCode: string; prerequisites: BriefPrereq[]; dependents: BriefDependent[] }

type Captured = { profile: Partial<CaptureProfile>; label: string } | null;

async function latestCapture(code: string): Promise<Captured> {
  const snap = await getLatestSnapshotByCourse(code);
  if (snap) return { profile: snap.profile, label: `${code} capture snapshot ${snap.createdAt.toISOString().slice(0, 10)}` };
  const draft = await getCaptureProfileByCourse(code);
  if (draft) return { profile: draft.profile, label: `${code} capture draft (${draft.reviewerStatus})` };
  return null;
}

export async function buildCourseContextBrief(courseCode: string): Promise<CourseContextBrief> {
  const pairs = await loadSheetPrereqPairs();
  const prerequisites = await Promise.all(prereqsOf(pairs, courseCode).map(async (code): Promise<BriefPrereq> => {
    const [c, cap] = await Promise.all([getCourseByCode(code), latestCapture(code)]);
    return { code, title: c?.title ?? '', captureLabel: cap?.label ?? null };
  }));
  const dependents = await Promise.all(dependentsOf(pairs, courseCode).map(async (code): Promise<BriefDependent> => {
    const [c, cap] = await Promise.all([getCourseByCode(code), latestCapture(code)]);
    const expectations = cap
      ? {
          source: cap.label,
          items: (cap.profile.incoming_expectations ?? []).map(e =>
            `${e.statement} (expects K${e.expected_depth.k ?? '–'} U${e.expected_depth.u ?? '–'} D${e.expected_depth.d})`),
        }
      : null;
    const capProjects = cap?.profile.major_projects ?? [];
    const projects = capProjects.length > 0
      ? { source: cap!.label, items: capProjects.map(p => `${p.title} — ${p.description}`) }
      : { source: 'course sheet', items: ((c?.majorProjects ?? []) as string[]) };
    return { code, title: c?.title ?? '', expectations, projects };
  }));
  return { courseCode, prerequisites, dependents };
}

export function renderCourseContextBrief(brief: CourseContextBrief, maxChars: number = BRIEF_MAX_CHARS): string {
  const head = `## ${BRIEF_HEADING}`;
  if (brief.prerequisites.length === 0 && brief.dependents.length === 0) {
    return `${head}\nNo linked courses: the course sheet lists no prerequisites for ${brief.courseCode}, and no course lists it as a prerequisite.`;
  }
  const lines: string[] = ['### Students arrive from'];
  if (brief.prerequisites.length === 0) lines.push('- (none on the course sheet)');
  for (const p of brief.prerequisites) {
    lines.push(`- ${p.code} — ${p.title}: ${p.captureLabel ? `captured (${p.captureLabel})` : 'not yet captured'}`);
  }
  lines.push('### Courses that build on this one');
  if (brief.dependents.length === 0) lines.push('- (none on the course sheet)');
  for (const d of brief.dependents) {
    lines.push(`#### ${d.code} — ${d.title}`);
    if (d.expectations) {
      lines.push(`- Expects students to arrive with (${d.expectations.source}):`);
      for (const it of d.expectations.items) lines.push(`  - ${it}`);
    } else {
      lines.push('- Expects students to arrive with: not yet captured');
    }
    if (d.projects.items.length > 0) {
      lines.push(`- Major projects (${d.projects.source}):`);
      for (const it of d.projects.items) lines.push(`  - ${it}`);
    } else {
      lines.push('- Major projects: none listed');
    }
  }
  const note = (n: number) => `_(${n} more line(s) left out to stay within the size cap.)_`;
  const reserve = note(lines.length).length + 1;
  let out = head;
  let i = 0;
  for (; i < lines.length; i++) {
    const next = `${out}\n${lines[i]}`;
    const remainingAfter = lines.length - i - 1;
    if (next.length + (remainingAfter > 0 ? reserve : 0) > maxChars) break;
    out = next;
  }
  if (i < lines.length) out = `${out}\n${note(lines.length - i)}`;
  return out;
}
```

(Implementer: if `CaptureProfile`'s Zod-inferred types make `Partial<CaptureProfile>` awkward for snapshot/draft profile types, adapt typing minimally — the logic and output strings must stay as above.)

- [ ] **Step 4: Run** test + `npx tsc --noEmit -p .` — PASS.

- [ ] **Step 5: Commit** module + test: `feat(capture): deterministic course-context brief of linked courses`.

---

### Task 4: Wire into the interview only + prompt instructions

**Files:**
- Modify: `lib/ai/agent/audit-agent.ts` (`buildAgentCall`)
- Modify: `lib/ai/prompts/capture-chat-agent.md` ("What you have at rest" bullet list; section `## 1b. Downstream connections`)
- Test: `lib/ai/agent/__tests__/audit-agent-brief.test.ts`, `app/api/capture/[code]/scores/__tests__/no-brief.test.ts`, `lib/ai/prompts/__tests__/capture-chat-agent-brief.test.ts`

**Interfaces:**
- Consumes: `buildCourseContextBrief`, `renderCourseContextBrief`, `BRIEF_HEADING` (Task 3).

- [ ] **Step 1: Write failing tests.**

`lib/ai/agent/__tests__/audit-agent-brief.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/capture-messages-queries', () => ({
  appendMessage: vi.fn(),
  getSessionMessages: vi.fn().mockResolvedValue([]),
  listPriorSessionSummaries: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/db/course-materials-queries', () => ({ listMaterialsByCourse: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/db/courses-queries', () => ({
  getCourseByCode: vi.fn().mockResolvedValue({ code: 'GC 3460', title: 'Flexo', description: '', prerequisites: 'GC 1040', learningObjectives: [], majorProjects: [], skillsRequired: [] }),
}));
vi.mock('@/lib/capture/course-context-brief', async (orig) => ({
  ...(await orig<typeof import('@/lib/capture/course-context-brief')>()),
  buildCourseContextBrief: vi.fn().mockResolvedValue({
    courseCode: 'GC 3460',
    prerequisites: [],
    dependents: [{ code: 'GC 4060', title: 'Flexo Production', expectations: null, projects: { source: 'course sheet', items: ['Film run'] } }],
  }),
}));
vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt: vi.fn().mockResolvedValue('SYSTEM') }));
vi.mock('@/lib/ai/agent/audit-tools', () => ({ buildAuditTools: vi.fn().mockReturnValue([]) }));

import { buildAgentCall } from '@/lib/ai/agent/audit-agent';
import { BRIEF_HEADING } from '@/lib/capture/course-context-brief';

describe('interview at-rest context', () => {
  it('includes the course-context brief', async () => {
    const built = await buildAgentCall({ sessionId: 's', courseCode: 'GC 3460', auditMode: 'full' });
    const atRest = String(built.messages[0].content);
    expect(atRest).toContain(BRIEF_HEADING);
    expect(atRest).toContain('#### GC 4060 — Flexo Production');
  });
});
```

`app/api/capture/[code]/scores/__tests__/no-brief.test.ts` — run the scores route in transcript mode with the generator mocked; assert the context it receives carries no brief even when the course has dependents:

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/sandbox/access', () => ({ authorizeCourseWrite: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({ checkIpRateLimit: vi.fn().mockResolvedValue({ allowed: true }) }));
vi.mock('@/lib/ip-hash', () => ({ hashIp: vi.fn().mockReturnValue('h') }));
vi.mock('@/lib/db/courses-queries', () => ({
  getCourseByCode: vi.fn().mockResolvedValue({ code: 'GC 3460', title: 'Flexo', description: '', prerequisites: '', learningObjectives: [], majorProjects: [], skillsRequired: [] }),
}));
vi.mock('@/lib/db/course-profile-queries', () => ({ getCourseProfile: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/db/course-materials-queries', () => ({ listMaterialsByCourse: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/db/course-capture-profiles-queries', () => ({
  getCaptureProfileByCourse: vi.fn().mockResolvedValue(null),
  upsertCaptureProfile: vi.fn(),
  setCaptureProfileStatus: vi.fn(),
}));
vi.mock('@/lib/db/capture-snapshots-queries', () => ({ getLatestSnapshotByCourse: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/db/capture-messages-queries', () => ({
  getLatestSessionId: vi.fn().mockResolvedValue(null),
  getSessionMessages: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/curriculum/sheet-prereq-graph', async (orig) => ({
  ...(await orig<typeof import('@/lib/curriculum/sheet-prereq-graph')>()),
  loadSheetPrereqPairs: vi.fn().mockResolvedValue([{ focal: 'GC 4060', prereq: 'GC 3460' }]),
}));
const gen = vi.fn().mockRejectedValue(new Error('stop after capture'));
vi.mock('@/lib/ai/analyze/capture-scores', () => ({ generateCaptureProfileV2: (...a: unknown[]) => gen(...a) }));

import { POST } from '@/app/api/capture/[code]/scores/route';
import { BRIEF_HEADING } from '@/lib/capture/course-context-brief';

describe('scoring context', () => {
  it('never receives the course-context brief', async () => {
    await POST(
      new Request('http://x/api/capture/GC%203460/scores?slug=s', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) }),
      { params: Promise.resolve({ code: 'GC%203460' }) },
    ).catch(() => undefined);
    expect(gen).toHaveBeenCalled();
    const passed = JSON.stringify(gen.mock.calls[0]);
    expect(passed).not.toContain(BRIEF_HEADING);
    expect(passed).not.toContain('Neighboring courses');
  });
});
```

(Implementer: read `app/api/capture/[code]/scores/route.ts` past line 130 to confirm how `generateCaptureProfileV2` is called and adapt the mock so the route reaches it; if other imports there need mocks, add them. Red proof for this guard: temporarily append the rendered brief to the scores context, watch it fail, revert, and note this in your report.)

`lib/ai/prompts/__tests__/capture-chat-agent-brief.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const md = readFileSync(join(process.cwd(), 'lib/ai/prompts/capture-chat-agent.md'), 'utf8');
const section1b = md.slice(md.indexOf('## 1b. Downstream connections'), md.indexOf('## 2. Stated objectives'));

describe('capture-chat-agent prompt — course-context brief', () => {
  it('describes the brief at rest as never evidence', () => {
    const atRest = md.slice(md.indexOf('# What you have at rest'), md.indexOf('# Tools you can call'));
    expect(atRest).toContain('Neighboring courses');
    expect(atRest).toMatch(/never evidence/i);
  });
  it('caps handoff probes at 2 and forbids inventing expectations', () => {
    expect(section1b).toMatch(/at most 2 handoff probes per session/);
    expect(section1b).toContain('not yet captured');
    expect(section1b).toContain('audit_notes.downstream_connections');
    expect(section1b).not.toMatch(/at most one downstream probe/i);
  });
  it('asks open first and nudges on projects', () => {
    expect(section1b).toMatch(/open first/i);
    expect(section1b).toMatch(/duplicat/i);
    expect(section1b).toMatch(/progression/i);
  });
});
```

- [ ] **Step 2: Run all three — expect FAIL** (brief absent from at-rest context; prompt lacks the new text; the scores guard should PASS already — do its red proof as described).

- [ ] **Step 3a: Implement wiring** in `lib/ai/agent/audit-agent.ts`:

```ts
import { buildCourseContextBrief, renderCourseContextBrief } from '@/lib/capture/course-context-brief';
...
// Interview-only (spec 2026-10-06): neighbors' expectations + projects as
// context for better handoff questions — never evidence, never in scoring.
async function loadBriefBlock(courseCode: string): Promise<string> {
  try {
    return renderCourseContextBrief(await buildCourseContextBrief(courseCode));
  } catch (err) {
    console.warn(`[audit-agent] course-context brief failed for ${courseCode}; continuing without it`, err);
    return '(course-context brief unavailable this turn)';
  }
}
```

Add `loadBriefBlock(courseCode)` to the existing `Promise.all` in `buildAgentCall` (as a 4th element `briefBlock`) and change the at-rest message content to:

```ts
content: `# Course catalog\n\n${catalogBlock}\n\n# Material digests\n\n${digestBlock}\n\n# Prior audit sessions (most recent)\n\n${priorSessionsBlock}\n\n# Neighboring courses\n\n${briefBlock}`,
```

- [ ] **Step 3b: Edit the prompt** `lib/ai/prompts/capture-chat-agent.md`.

In `# What you have at rest`, after the "Course Outcome Profiles for captured prerequisite courses" bullet, add:

```markdown
- **Neighboring courses brief** — the courses directly linked to this one on
  the course sheet: where students arrive from (and whether each is captured),
  and for each course that builds on this one, what it expects students to
  arrive with and its major projects. Every item names its source (a capture
  snapshot, a capture draft, or the course sheet). It is context for better
  handoff questions — **never evidence** for this course's scores.
```

Replace the whole `## 1b. Downstream connections (forward-direction graph)` section body (keep the heading) with:

```markdown
Probe how this course's outputs feed forward, using the **Neighboring
courses brief** in your at-rest context to ground the probe in real courses.

**Ask open first.** Start with what the instructor sees: *"What can students
do when they leave this course?"* Then compare that answer with what the
later courses expect, and ask about the gap or the match. Don't lead the
instructor by reading the later course's list to them first.

**Grounded handoff probe** (after the open question), naming the courses and
what they actually do: *"GC 4060 and GC 4070 build on this course and run
flexo jobs on film and board — does your substrate work prepare students for
that?"*

Discipline:

- **Ask at most 2 handoff probes per session.** Not per turn — per session.
- **Where a later course is "not yet captured", say so.** Its expectations are
  unknown; never invent them. Its sheet-listed projects are the only grounded
  detail — label them as from the course sheet.
- **Cite the source label** from the brief when you use an item (e.g. "GC 4060
  capture snapshot 2026-08-14", "course sheet").
- **Projects nudge.** Compare this course's major projects with the linked
  courses' projects. Watch for **progression** (a later project builds on one
  here), **duplication** (the same project again), or a **missed chance to
  share** a project. If you find one, ask about it once.
- **The binding rule still holds:** the brief, like all program memory, is
  reference, never evidence. It never raises or lowers a K/U/D score here.
- **Land findings** in `audit_notes.downstream_connections` (free-form prose),
  as before.
```

- [ ] **Step 4: Run** the three tests, `npx vitest run lib/ai app/api/capture`, `npx tsc --noEmit -p .` — PASS.

- [ ] **Step 5: Commit** `audit-agent.ts`, the prompt, three tests: `feat(capture): course-context brief in the interview at-rest context (interview only)`.

---

### Task 5: STATE.md, full verification, live check (controller)

- [ ] Update `docs/STATE.md`: What's live — the brief in the interview context and the `prereq_chain` fix; Deferred/debt — the spec's three follow-ups (Clemson catalog via MCP; option 2 competency-overlap after re-score; `prerequisite_edges` empty / `prereq-edge-seed` never run — keep or retire), plus the planning ruling that the v2 interview does not load prerequisite capture profiles despite the prompt bullet saying it does.
- [ ] `npx vitest run` and `npx tsc --noEmit -p .` — both green.
- [ ] Live check (read-only): a throwaway script prints `renderCourseContextBrief(await buildCourseContextBrief(code))` for GC 3460 and for GC 1040 (dependents GC 3400 and GC 3460 have snapshots). No interview turn is run (a turn writes `capture_messages`); `buildAgentCall` also writes on non-opening turns, so it is not used either. Delete the script afterwards.
- [ ] Commit STATE.md; push `feat/course-context-brief`. Do not merge or deploy.
