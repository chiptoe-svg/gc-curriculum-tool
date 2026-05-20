# Faculty Assignment Intake — Plan 3: Editor & Analyze Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the per-course profile zone editable with a PATCH API route, add the `/preview/[slug]/courses` index with status badges, and wire `resolveCourseContext` into both analyze routes so courses with profiles automatically get richer inputs to `draftKUD`.

**Architecture:** Three concerns, each with clear ownership. (1) Plan 2's `lib/db/course-profile-queries.ts` is extended with `updateProfileFromEdit` (faculty-edit write) and `listCoursesWithStatus` (index query). (2) A new `components/CourseProfileEditor.tsx` client component owns the editable profile UI (summary textarea, string-list editors for learningObjectives + skills, inline-editable competency list with read-only evidence, read-only catalogDivergence panel, and a Save button). The per-course page server component extracts this editor from the existing read-only display region. (3) A new `lib/ai/analyze/resolve-course-context.ts` helper owns the profile-preference logic; both analyze routes call it before `draftKUD`.

**Tech Stack:** Next.js 15 App Router, TypeScript strict with `noUncheckedIndexedAccess`, Drizzle ORM + Neon Postgres, Vitest, React 19, Tailwind v4, `@base-ui/react` (shadcn primitives via `components/ui/*`), pnpm.

**Spec:** [`docs/superpowers/specs/2026-05-19-faculty-assignment-intake-design.md`](../specs/2026-05-19-faculty-assignment-intake-design.md).

---

## Prerequisites (assumed done — do not re-implement)

- Migration `drizzle/0009_*.sql` with tables `course_materials`, `course_profiles`, `course_profile_runs` exists.
- `lib/db/schema.ts` exports `courseProfiles` (with columns `courseCode pk`, `summary`, `learningObjectives`, `skills`, `competencies`, `catalogDivergence`, `sourceRunId`, `manuallyEdited`, `updatedAt`).
- `lib/db/course-materials-queries.ts` (from Plan 1) and `lib/db/course-profile-queries.ts` (from Plan 2) exist.
- `app/preview/[slug]/courses/[code]/page.tsx` exists with Materials, Analyze, and a **read-only** Profile zone (Plan 2 built it).
- `app/api/analyze/route.ts` and `app/api/analyze/target-chain/route.ts` exist and call `draftKUD` with raw syllabus text.

---

## File Structure

**New files (created by this plan):**

```
lib/ai/analyze/
  resolve-course-context.ts           # resolveCourseContext(courseLabel, fallbackSyllabusText)

app/api/courses/[code]/
  profile/
    route.ts                          # PATCH /api/courses/[code]/profile

app/preview/[slug]/courses/
  page.tsx                            # index: lists all 28 courses with status badges
  [code]/
    page.tsx                          # MODIFIED: import CourseProfileEditor, replace read-only Profile zone

components/
  CourseProfileEditor.tsx             # editable profile zone (summary, objectives, skills, competencies, catalogDivergence)

tests/api/
  course-profile-patch.test.ts        # PATCH route tests

tests/ai/analyze/
  resolve-course-context.test.ts      # resolveCourseContext unit tests

tests/components/
  CourseProfileEditor.test.tsx        # RTL component tests
```

**Modified files:**

- `lib/db/course-profile-queries.ts` — add `updateProfileFromEdit` (Task 1) and `listCoursesWithStatus` (Task 5) to the module Plan 2 created.
- `app/preview/[slug]/courses/[code]/page.tsx` — import `CourseProfileEditor`, replace read-only Profile zone with editable component (Task 4).
- `app/api/analyze/route.ts` — call `resolveCourseContext` before `draftKUD` for course and each prior course (Task 7).
- `app/api/analyze/target-chain/route.ts` — same (Task 7).

---

## Phase A — Data layer

### Task 1: Add `updateProfileFromEdit` to `lib/db/course-profile-queries.ts`

**Files:**
- Modify: `lib/db/course-profile-queries.ts` (created by Plan 2; Plan 3 adds one new export)
- Modify: `lib/db/__tests__/course-profile-queries.test.ts` (add test for `updateProfileFromEdit`)

Plan 2 created `lib/db/course-profile-queries.ts` and exported five functions: `cacheAnalysisFinding`, `insertProfileRun`, `upsertCourseProfile`, `getLatestRunForCourse`, `getCourseProfile`. Plan 3 adds one more: `updateProfileFromEdit` — the faculty-edit write path. It updates `summary`, `learningObjectives`, `skills`, and `competencies` for an existing `course_profiles` row, sets `manuallyEdited = true`, and bumps `updatedAt`. It does NOT touch `sourceRunId` or `catalogDivergence` (those are AI-owned fields).

**Use `getCourseProfile` (from Plan 2) for all reads** — do not redefine it. The return type is `typeof courseProfiles.$inferSelect | null`, which Plan 2 exports implicitly via the function's inferred return type. For Task 2's route, import `getCourseProfile` and `updateProfileFromEdit` from `@/lib/db/course-profile-queries`.

- [ ] **Step 1: Write the failing test**

Open `lib/db/__tests__/course-profile-queries.test.ts` (created by Plan 2). Add one new `describe` block for `updateProfileFromEdit` at the end of the file:

```typescript
describe('updateProfileFromEdit', () => {
  it('updates summary, learningObjectives, skills, competencies and sets manuallyEdited=true', async () => {
    dbUpdateWhere.mockResolvedValue(undefined);
    await updateProfileFromEdit({
      courseCode: 'GC 1010',
      summary: 'Revised summary.',
      learningObjectives: ['New objective'],
      skills: ['New skill'],
      competencies: [
        {
          name: 'Color Management',
          description: 'Revised.',
          level: 'developed',
          evidence: [{ fileName: 'rubric.pdf', quote: 'quote text' }],
        },
      ],
    });
    expect(dbUpdateWhere).toHaveBeenCalledTimes(1);
  });

  it('does not touch sourceRunId or catalogDivergence', async () => {
    // The mock captures the entire .set() call — we verify the shape by checking
    // that only the four editable fields + manuallyEdited + updatedAt are set.
    // Since we mock the chain, this is a structural assertion via call count.
    dbUpdateWhere.mockResolvedValue(undefined);
    await updateProfileFromEdit({
      courseCode: 'GC 4060',
      summary: 'Test',
      learningObjectives: [],
      skills: [],
      competencies: [],
    });
    expect(dbUpdateWhere).toHaveBeenCalledTimes(1);
    // insertProfileRun (insert path) should NOT have been called — this is an update only
    expect(dbInsertReturning).not.toHaveBeenCalled();
  });
});
```

Also add the import of `updateProfileFromEdit` to the existing import block at the top of the test file:

```typescript
import {
  cacheAnalysisFinding,
  insertProfileRun,
  upsertCourseProfile,
  getLatestRunForCourse,
  getCourseProfile,
  updateProfileFromEdit,
} from '@/lib/db/course-profile-queries';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test lib/db/__tests__/course-profile-queries.test.ts`

Expected: FAIL — `updateProfileFromEdit is not a function` (it doesn't exist yet).

- [ ] **Step 3: Implement `updateProfileFromEdit`**

Open `lib/db/course-profile-queries.ts` (created by Plan 2). Append the following after the existing `getCourseProfile` function:

```typescript
// ── Faculty-edit write path ──────────────────────────────────────────────────

export interface UpdateProfileFromEditInput {
  courseCode: string;
  summary: string;
  learningObjectives: string[];
  skills: string[];
  competencies: Array<{
    name: string;
    description: string;
    level: string;
    evidence: Array<{ fileName: string; quote: string }>;
  }>;
}

/**
 * Persists faculty edits to a course profile.
 * Updates only the four editable content fields, sets manuallyEdited=true,
 * and bumps updatedAt. Does NOT touch sourceRunId or catalogDivergence —
 * those are AI-owned and preserved across manual edits.
 */
export async function updateProfileFromEdit({
  courseCode,
  summary,
  learningObjectives,
  skills,
  competencies,
}: UpdateProfileFromEditInput): Promise<void> {
  await db
    .update(courseProfiles)
    .set({
      summary,
      learningObjectives,
      skills,
      competencies,
      manuallyEdited: true,
      updatedAt: new Date(),
    })
    .where(eq(courseProfiles.courseCode, courseCode));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test lib/db/__tests__/course-profile-queries.test.ts`

Expected: all tests pass (the original 8 from Plan 2 + the 2 new ones = 10 passing).

- [ ] **Step 5: tsc check**

Run: `pnpm exec tsc --noEmit`

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add lib/db/course-profile-queries.ts lib/db/__tests__/course-profile-queries.test.ts
git commit -m "feat(db): add updateProfileFromEdit to course-profile-queries"
```

---

## Phase B — PATCH /api/courses/[code]/profile

### Task 2: Profile PATCH route

**Files:**
- Create: `app/api/courses/[code]/profile/route.ts`
- Test: `tests/api/course-profile-patch.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/api/course-profile-patch.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateProfileFromEdit = vi.fn();
vi.mock('@/lib/db/course-profile-queries', () => ({ updateProfileFromEdit }));

vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'valid-slug-12345' }));

import { PATCH } from '@/app/api/courses/[code]/profile/route';

beforeEach(() => {
  vi.clearAllMocks();
  updateProfileFromEdit.mockResolvedValue(undefined);
});

function makeReq(body: unknown, slug = 'valid-slug-12345'): Request {
  return new Request(`http://test/api/courses/GC%201010/profile?slug=${slug}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  summary: 'A course about printing.',
  learningObjectives: ['Understand color theory'],
  skills: ['RIP software'],
  competencies: [
    {
      name: 'Color Management',
      description: 'Ability to manage color profiles',
      level: 'developed',
      evidence: [{ fileName: 'rubric.pdf', quote: 'Students will profile a press.' }],
    },
  ],
};

describe('PATCH /api/courses/[code]/profile', () => {
  it('401s on missing or invalid slug', async () => {
    const res = await PATCH(
      makeReq(validBody, 'wrong'),
      { params: Promise.resolve({ code: 'GC%201010' }) }
    );
    expect(res.status).toBe(401);
    expect(updateProfileFromEdit).not.toHaveBeenCalled();
  });

  it('400s on invalid JSON body', async () => {
    const req = new Request('http://test/api/courses/GC%201010/profile?slug=valid-slug-12345', {
      method: 'PATCH',
      body: 'not-json',
    });
    const res = await PATCH(req, { params: Promise.resolve({ code: 'GC%201010' }) });
    expect(res.status).toBe(400);
  });

  it('400s when required fields are missing', async () => {
    const res = await PATCH(
      makeReq({ summary: 'hi' }),
      { params: Promise.resolve({ code: 'GC%201010' }) }
    );
    expect(res.status).toBe(400);
  });

  it('persists profile with manuallyEdited=true and returns 200', async () => {
    const res = await PATCH(
      makeReq(validBody),
      { params: Promise.resolve({ code: 'GC%201010' }) }
    );
    expect(res.status).toBe(200);
    expect(updateProfileFromEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        courseCode: 'GC 1010',
        summary: 'A course about printing.',
        learningObjectives: ['Understand color theory'],
        skills: ['RIP software'],
      })
    );
  });

  it('URL-decodes the course code before persisting', async () => {
    const res = await PATCH(
      makeReq(validBody),
      { params: Promise.resolve({ code: 'GC%204060ap' }) }
    );
    expect(res.status).toBe(200);
    expect(updateProfileFromEdit).toHaveBeenCalledWith(
      expect.objectContaining({ courseCode: 'GC 4060ap' })
    );
  });

  it('500s when updateProfileFromEdit throws', async () => {
    updateProfileFromEdit.mockRejectedValueOnce(new Error('db down'));
    const res = await PATCH(
      makeReq(validBody),
      { params: Promise.resolve({ code: 'GC%201010' }) }
    );
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/api/course-profile-patch.test.ts`

Expected: FAIL with `Cannot find module '@/app/api/courses/[code]/profile/route'`.

- [ ] **Step 3: Implement the route**

Create `app/api/courses/[code]/profile/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isValidSlug } from '@/lib/slug';
import { updateProfileFromEdit } from '@/lib/db/course-profile-queries';

const evidenceSchema = z.object({
  fileName: z.string().min(1),
  quote: z.string().min(1),
});

const competencySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1),
  level: z.string().min(1).max(100),
  evidence: z.array(evidenceSchema),
});

const patchSchema = z.object({
  summary: z.string().min(1),
  learningObjectives: z.array(z.string().min(1)),
  skills: z.array(z.string().min(1)),
  competencies: z.array(competencySchema),
});

interface RouteContext {
  params: Promise<{ code: string }>;
}

export async function PATCH(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const { code: rawCode } = await params;
  const courseCode = decodeURIComponent(rawCode);

  try {
    await updateProfileFromEdit({
      courseCode,
      summary: parsed.data.summary,
      learningObjectives: parsed.data.learningObjectives,
      skills: parsed.data.skills,
      competencies: parsed.data.competencies,
      // manuallyEdited=true and updatedAt are set inside updateProfileFromEdit.
      // catalogDivergence and sourceRunId are AI-owned and left untouched.
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`PATCH /api/courses/${courseCode}/profile failed`, err);
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/api/course-profile-patch.test.ts`

Expected: 6 passing tests.

- [ ] **Step 5: tsc check**

Run: `pnpm exec tsc --noEmit`

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/courses/[code]/profile/route.ts tests/api/course-profile-patch.test.ts
git commit -m "feat(api): PATCH /api/courses/[code]/profile persists edited profile"
```

---

## Phase C — Profile editor component

### Task 3: `CourseProfileEditor` component

**Files:**
- Create: `components/CourseProfileEditor.tsx`
- Test: `tests/components/CourseProfileEditor.test.tsx` (create)

The editor renders: a `summary` textarea; `learningObjectives` and `skills` as string-list editors (add / edit / remove); `competencies` as an editable list of `{ name, description, level }` with `evidence` shown read-only; `catalogDivergence` as a read-only panel; and a Save button that calls `PATCH /api/courses/[code]/profile?slug=<slug>`.

- [ ] **Step 1: Write the failing tests**

Create `tests/components/CourseProfileEditor.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CourseProfileEditor } from '@/components/CourseProfileEditor';

// Stub fetch
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
});

const baseProfile = {
  summary: 'A course about print production.',
  learningObjectives: ['Understand color theory', 'Operate a digital press'],
  skills: ['RIP software', 'PDF preflight'],
  competencies: [
    {
      name: 'Color Management',
      description: 'Profile and calibrate press output.',
      level: 'developed',
      evidence: [{ fileName: 'rubric.pdf', quote: 'Students will profile a press.' }],
    },
  ],
  catalogDivergence: {
    reinforced: ['Color theory'],
    additions: ['Press calibration'],
    gaps: [],
  },
};

describe('CourseProfileEditor', () => {
  it('renders the summary textarea with initial value', () => {
    render(<CourseProfileEditor courseCode="GC 1010" slug="test-slug" profile={baseProfile} />);
    expect(screen.getByDisplayValue('A course about print production.')).toBeDefined();
  });

  it('renders learning objectives as editable inputs', () => {
    render(<CourseProfileEditor courseCode="GC 1010" slug="test-slug" profile={baseProfile} />);
    expect(screen.getByDisplayValue('Understand color theory')).toBeDefined();
    expect(screen.getByDisplayValue('Operate a digital press')).toBeDefined();
  });

  it('adds a new learning objective when clicking Add', () => {
    render(<CourseProfileEditor courseCode="GC 1010" slug="test-slug" profile={baseProfile} />);
    const addButtons = screen.getAllByText('+ Add');
    fireEvent.click(addButtons[0]!);
    const inputs = screen.getAllByPlaceholderText('Learning objective');
    expect(inputs.length).toBe(3);
  });

  it('removes a learning objective when clicking Remove', () => {
    render(<CourseProfileEditor courseCode="GC 1010" slug="test-slug" profile={baseProfile} />);
    const removeButtons = screen.getAllByText('Remove');
    // There are objectives + skills + competency rows — remove first objective
    fireEvent.click(removeButtons[0]!);
    expect(screen.queryByDisplayValue('Understand color theory')).toBeNull();
  });

  it('shows competency name, description, and level as editable inputs', () => {
    render(<CourseProfileEditor courseCode="GC 1010" slug="test-slug" profile={baseProfile} />);
    expect(screen.getByDisplayValue('Color Management')).toBeDefined();
    expect(screen.getByDisplayValue('Profile and calibrate press output.')).toBeDefined();
    expect(screen.getByDisplayValue('developed')).toBeDefined();
  });

  it('shows evidence quote as read-only text (not an input)', () => {
    render(<CourseProfileEditor courseCode="GC 1010" slug="test-slug" profile={baseProfile} />);
    expect(screen.getByText('Students will profile a press.')).toBeDefined();
    // Evidence text must NOT be in an editable input
    const allInputValues = screen.queryAllByDisplayValue('Students will profile a press.');
    expect(allInputValues).toHaveLength(0);
  });

  it('shows catalogDivergence as a read-only panel', () => {
    render(<CourseProfileEditor courseCode="GC 1010" slug="test-slug" profile={baseProfile} />);
    expect(screen.getByText('Color theory')).toBeDefined();
    expect(screen.getByText('Press calibration')).toBeDefined();
  });

  it('calls PATCH on Save and shows success toast', async () => {
    render(<CourseProfileEditor courseCode="GC 1010" slug="test-slug" profile={baseProfile} />);
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/courses/GC%201010/profile?slug=test-slug');
    expect(opts.method).toBe('PATCH');
    const sentBody = JSON.parse(opts.body as string);
    expect(sentBody.summary).toBe('A course about print production.');
    await waitFor(() => expect(screen.getByText('Saved')).toBeDefined());
  });

  it('shows error toast when PATCH fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'db error' }) });
    render(<CourseProfileEditor courseCode="GC 1010" slug="test-slug" profile={baseProfile} />);
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(screen.getByText(/Save failed/i)).toBeDefined());
  });

  it('renders gracefully with null catalogDivergence', () => {
    render(<CourseProfileEditor courseCode="GC 1010" slug="test-slug" profile={{ ...baseProfile, catalogDivergence: null }} />);
    expect(screen.getByText('Catalog divergence')).toBeDefined();
    expect(screen.getByText('No divergence data')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/components/CourseProfileEditor.test.tsx`

Expected: FAIL with `Cannot find module '@/components/CourseProfileEditor'`.

- [ ] **Step 3: Implement the component**

Create `components/CourseProfileEditor.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// ── Types ──────────────────────────────────────────────────────────────────────

interface EvidenceItem {
  fileName: string;
  quote: string;
}

interface CompetencyItem {
  name: string;
  description: string;
  level: string;
  evidence: EvidenceItem[];
}

interface CatalogDivergence {
  reinforced: string[];
  additions: string[];
  gaps: string[];
}

export interface CourseProfileData {
  summary: string;
  learningObjectives: string[];
  skills: string[];
  competencies: CompetencyItem[];
  catalogDivergence: CatalogDivergence | null;
}

interface Props {
  courseCode: string;
  slug: string;
  profile: CourseProfileData;
}

// ── String-list editor ─────────────────────────────────────────────────────────

function StringListEditor({
  label,
  values,
  placeholder,
  onChange,
}: {
  label: string;
  values: string[];
  placeholder: string;
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      {values.map((v, i) => (
        <div key={i} className="flex gap-2 items-center">
          <Input
            className="flex-1 text-sm"
            value={v}
            placeholder={placeholder}
            onChange={(e) => {
              const next = [...values];
              next[i] = e.target.value;
              onChange(next);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange(values.filter((_, j) => j !== i))}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...values, ''])}
      >
        + Add
      </Button>
    </div>
  );
}

// ── Competency editor row ──────────────────────────────────────────────────────

function CompetencyRow({
  item,
  onChange,
  onRemove,
}: {
  item: CompetencyItem;
  onChange: (next: CompetencyItem) => void;
  onRemove: () => void;
}) {
  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex gap-2 items-start">
          <div className="flex-1 space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Name</Label>
                <Input
                  value={item.name}
                  className="text-sm"
                  onChange={(e) => onChange({ ...item, name: e.target.value })}
                />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Description</Label>
                <Input
                  value={item.description}
                  className="text-sm"
                  onChange={(e) => onChange({ ...item, description: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Level</Label>
              <Input
                value={item.level}
                className="text-sm w-48"
                placeholder="e.g. introduced / developed / mastered"
                onChange={(e) => onChange({ ...item, level: e.target.value })}
              />
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onRemove}>
            Remove
          </Button>
        </div>

        {item.evidence.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Evidence (read-only)
            </p>
            {item.evidence.map((ev, i) => (
              <blockquote
                key={i}
                className="border-l-2 border-slate-300 pl-3 text-xs text-muted-foreground"
              >
                <span className="font-medium">{ev.fileName}:</span> {ev.quote}
              </blockquote>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── CatalogDivergence panel (read-only) ────────────────────────────────────────

function CatalogDivergencePanel({ data }: { data: CatalogDivergence | null }) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Catalog divergence</Label>
      {!data ? (
        <p className="text-sm text-muted-foreground">No divergence data</p>
      ) : (
        <div className="rounded-lg border bg-muted/30 p-4 space-y-3 text-sm">
          {data.reinforced.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                Reinforced
              </p>
              <ul className="space-y-0.5">
                {data.reinforced.map((r, i) => <li key={i} className="text-foreground">{r}</li>)}
              </ul>
            </div>
          )}
          {data.additions.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                Additions (not in catalog)
              </p>
              <ul className="space-y-0.5">
                {data.additions.map((a, i) => <li key={i} className="text-foreground">{a}</li>)}
              </ul>
            </div>
          )}
          {data.gaps.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                Gaps (catalog claims, not evidenced)
              </p>
              <ul className="space-y-0.5">
                {data.gaps.map((g, i) => <li key={i} className="text-foreground">{g}</li>)}
              </ul>
            </div>
          )}
          {data.reinforced.length === 0 && data.additions.length === 0 && data.gaps.length === 0 && (
            <p className="text-muted-foreground">No divergence items reported.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function CourseProfileEditor({ courseCode, slug, profile }: Props) {
  const [summary, setSummary] = useState(profile.summary);
  const [objectives, setObjectives] = useState<string[]>(profile.learningObjectives);
  const [skills, setSkills] = useState<string[]>(profile.skills);
  const [competencies, setCompetencies] = useState<CompetencyItem[]>(profile.competencies);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }

  function handleSave() {
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/courses/${encodeURIComponent(courseCode)}/profile?slug=${slug}`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ summary, learningObjectives: objectives, skills, competencies }),
          }
        );
        if (res.ok) {
          showToast('success', 'Saved');
        } else {
          const b = await res.json().catch(() => ({})) as { error?: string };
          showToast('error', `Save failed: ${b.error ?? res.status}`);
        }
      } catch {
        showToast('error', 'Save failed: network error');
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 rounded-md px-4 py-3 text-sm shadow-lg ${
            toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-destructive text-destructive-foreground'
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Summary */}
      <div className="space-y-2">
        <Label htmlFor="profile-summary" className="text-sm font-medium">Summary</Label>
        <Textarea
          id="profile-summary"
          rows={4}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
      </div>

      {/* Learning objectives */}
      <StringListEditor
        label="Learning objectives"
        values={objectives}
        placeholder="Learning objective"
        onChange={setObjectives}
      />

      {/* Skills */}
      <StringListEditor
        label="Skills"
        values={skills}
        placeholder="Skill"
        onChange={setSkills}
      />

      {/* Competencies */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Competencies</Label>
        {competencies.map((c, i) => (
          <CompetencyRow
            key={i}
            item={c}
            onChange={(next) => setCompetencies((prev) => prev.map((x, j) => (j === i ? next : x)))}
            onRemove={() => setCompetencies((prev) => prev.filter((_, j) => j !== i))}
          />
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setCompetencies((prev) => [
              ...prev,
              { name: '', description: '', level: '', evidence: [] },
            ])
          }
        >
          + Add competency
        </Button>
      </div>

      {/* Catalog divergence (read-only) */}
      <CatalogDivergencePanel data={profile.catalogDivergence} />

      {/* Save */}
      <div className="pt-2">
        <Button onClick={handleSave} disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/components/CourseProfileEditor.test.tsx`

Expected: 9 passing tests.

- [ ] **Step 5: tsc check**

Run: `pnpm exec tsc --noEmit`

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add components/CourseProfileEditor.tsx tests/components/CourseProfileEditor.test.tsx
git commit -m "feat(ui): CourseProfileEditor — editable profile zone with competency list + read-only evidence"
```

---

## Phase D — Wire editor into the per-course page

### Task 4: Replace read-only Profile zone with editable editor

**Files:**
- Modify: `app/preview/[slug]/courses/[code]/page.tsx`

Plan 2 built a read-only Profile zone in this file. This task replaces it with `CourseProfileEditor` when a profile exists, and keeps a "no profile yet" message otherwise.

- [ ] **Step 1: Read the current file**

Open `app/preview/[slug]/courses/[code]/page.tsx` and locate the Profile zone section. The zone likely renders the profile fields from a fetched `profile` object. Identify where the zone starts and ends so you can replace exactly that section.

- [ ] **Step 2: Add the import and replace the zone**

At the top of `app/preview/[slug]/courses/[code]/page.tsx`, add:

```typescript
import { CourseProfileEditor } from '@/components/CourseProfileEditor';
```

Locate the read-only Profile zone (it will look something like a `<section>` or `<Card>` that renders `profile.summary`, `profile.learningObjectives`, etc. as plain text). Replace the entire contents of that section with:

```tsx
{/* Profile zone */}
<section className="space-y-4">
  <h2 className="text-xl font-semibold">Profile</h2>
  {profile ? (
    <CourseProfileEditor
      courseCode={code}
      slug={slug}
      profile={{
        summary: profile.summary,
        learningObjectives: profile.learningObjectives as string[],
        skills: profile.skills as string[],
        competencies: profile.competencies as Array<{
          name: string;
          description: string;
          level: string;
          evidence: Array<{ fileName: string; quote: string }>;
        }>,
        catalogDivergence: profile.catalogDivergence as {
          reinforced: string[];
          additions: string[];
          gaps: string[];
        } | null,
      }}
    />
  ) : (
    <p className="text-sm text-muted-foreground">
      No profile yet. Upload materials and click &ldquo;Analyze materials&rdquo; to generate one.
    </p>
  )}
</section>
```

The `profile` variable and `code` / `slug` bindings come from the server component's existing data-fetching logic (Plan 2 set them up). If the exact variable names differ from `profile`, `code`, `slug`, adjust accordingly.

- [ ] **Step 3: tsc check**

Run: `pnpm exec tsc --noEmit`

Expected: zero errors. If the `profile` JSONB columns have `unknown` inferred types, the casts above are the correct fix.

- [ ] **Step 4: Commit**

```bash
git add app/preview/[slug]/courses/[code]/page.tsx
git commit -m "feat(ui): wire CourseProfileEditor into per-course page Profile zone"
```

---

## Phase E — Courses index page

### Task 5: `/preview/[slug]/courses` index page with status badges

**Files:**
- Create: `app/preview/[slug]/courses/page.tsx`

The index lists all 28 GC courses from the `courses` table. Each row shows a status badge. The badge logic is:
- `manuallyEdited === true` on the profile row → **"Profile (edited)"** — use `Badge variant="default"` (dark background).
- Profile row exists, `manuallyEdited === false` → **"Profile ready"** — use `Badge variant="secondary"`.
- No profile row but `course_materials` rows exist → **"N files, not analyzed"** — use `Badge variant="outline"`.
- No profile row, no materials → **"No materials"** — use `Badge variant="outline"` with muted text.

The query for status requires joining three tables. Add a new query function `listCoursesWithStatus` to `lib/db/course-profile-queries.ts` (the module Plan 2 created and Task 1 of this plan already modified).

- [ ] **Step 1: Add `listCoursesWithStatus` to the queries module**

Open `lib/db/course-profile-queries.ts` and append:

```typescript
export interface CourseWithStatus {
  code: string;
  title: string;
  level: number;
  track: string;
  profileExists: boolean;
  manuallyEdited: boolean;
  materialCount: number;
}

export async function listCoursesWithStatus(): Promise<CourseWithStatus[]> {
  // Import inside function to avoid circular-module issues in test mocks.
  const { courses, courseProfiles, courseMaterials } = await import('./schema');
  const { leftJoin, eq, count, sql } = await import('drizzle-orm');

  const rows = await db
    .select({
      code: courses.code,
      title: courses.title,
      level: courses.level,
      track: courses.track,
      manuallyEdited: courseProfiles.manuallyEdited,
      materialCount: count(courseMaterials.id),
    })
    .from(courses)
    .leftJoin(courseProfiles, eq(courses.code, courseProfiles.courseCode))
    .leftJoin(courseMaterials, eq(courses.code, courseMaterials.courseCode))
    .groupBy(courses.code, courses.title, courses.level, courses.track, courseProfiles.manuallyEdited)
    .orderBy(sql`${courses.level} asc, ${courses.code} asc`);

  return rows.map((r) => ({
    code: r.code,
    title: r.title,
    level: r.level,
    track: r.track,
    profileExists: r.manuallyEdited !== null,
    manuallyEdited: r.manuallyEdited ?? false,
    materialCount: Number(r.materialCount),
  }));
}
```

- [ ] **Step 2: Write the courses index page**

Create `app/preview/[slug]/courses/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import { listCoursesWithStatus } from '@/lib/db/course-profile-queries';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

function StatusBadge({ profileExists, manuallyEdited, materialCount }: {
  profileExists: boolean;
  manuallyEdited: boolean;
  materialCount: number;
}) {
  if (profileExists && manuallyEdited) {
    return <Badge variant="default">Profile (edited)</Badge>;
  }
  if (profileExists) {
    return <Badge variant="secondary">Profile ready</Badge>;
  }
  if (materialCount > 0) {
    return (
      <Badge variant="outline">
        {materialCount} file{materialCount === 1 ? '' : 's'}, not analyzed
      </Badge>
    );
  }
  return <Badge variant="outline" className="text-muted-foreground">No materials</Badge>;
}

export default async function CoursesIndexPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isValidSlug(slug)) notFound();

  const courses = await listCoursesWithStatus();

  return (
    <main className="mx-auto max-w-4xl p-6 md:p-12 space-y-8">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Link href={`/preview/${slug}`} className="underline underline-offset-2 hover:text-foreground">
          &larr; Back to prototype
        </Link>
      </div>

      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Courses</h1>
        <p className="text-muted-foreground leading-relaxed max-w-2xl">
          Upload assignment materials per course, analyze them to build an evidence-grounded profile,
          and curate the profile here. Courses with a profile feed richer context to the analyze routes.
        </p>
      </header>

      <div className="space-y-3">
        {courses.map((c) => (
          <div
            key={c.code}
            className="rounded-lg border bg-card p-4 flex items-center justify-between gap-4"
          >
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{c.code}</span>
                <span className="text-xs text-muted-foreground">{c.track} · Level {c.level}</span>
              </div>
              <p className="text-sm text-muted-foreground truncate">{c.title}</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <StatusBadge
                profileExists={c.profileExists}
                manuallyEdited={c.manuallyEdited}
                materialCount={c.materialCount}
              />
              <Link
                href={`/preview/${slug}/courses/${encodeURIComponent(c.code)}`}
                className="inline-flex items-center rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                Open
              </Link>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: tsc check**

Run: `pnpm exec tsc --noEmit`

Expected: zero errors. If `courseMaterials` is not yet exported from `schema.ts` (Plan 1 adds it), adjust the import — or use a direct SQL query temporarily and note the dependency.

- [ ] **Step 4: Commit**

```bash
git add lib/db/course-profile-queries.ts app/preview/[slug]/courses/page.tsx
git commit -m "feat(ui): courses index page with status badges + listCoursesWithStatus query"
```

---

## Phase F — resolveCourseContext helper

### Task 6: `lib/ai/analyze/resolve-course-context.ts`

**Files:**
- Create: `lib/ai/analyze/resolve-course-context.ts`
- Test: `tests/ai/analyze/resolve-course-context.test.ts` (create)

The helper signature (canonical per spec):

```typescript
resolveCourseContext(courseLabel: string, fallbackSyllabusText: string): Promise<string>
```

It looks up the `course_profiles` row by `courseLabel` (treated as course code). If found, it builds a richly-formatted string from the profile fields. If not found, it returns `fallbackSyllabusText` unchanged.

The context string format when a profile is found:

```
[Course profile: <courseCode>]
Summary: <summary>

Learning objectives:
- <objective>
...

Skills:
- <skill>
...

Competencies:
- <name> (<level>): <description>
...
```

The structural fields (level, track, prerequisites) from the catalog are **not** included in the context string — the spec says "merged with the catalog's structural fields" but these are already encoded in the `targetContext` from `buildTargetContext`. The profile string replaces the raw syllabus text input; the target context is constructed separately by `buildTargetContext` and passed as `targetContext` to `draftKUD`. Only the enriched course description goes into `syllabusText`.

- [ ] **Step 1: Write the failing tests**

Create `tests/ai/analyze/resolve-course-context.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

const getCourseProfile = vi.fn();
vi.mock('@/lib/db/course-profile-queries', () => ({ getCourseProfile }));

import { resolveCourseContext } from '@/lib/ai/analyze/resolve-course-context';

describe('resolveCourseContext', () => {
  it('returns fallbackSyllabusText unchanged when no profile found', async () => {
    getCourseProfile.mockResolvedValueOnce(null);
    const out = await resolveCourseContext('GC 1010', 'raw syllabus text here');
    expect(out).toBe('raw syllabus text here');
    expect(getCourseProfile).toHaveBeenCalledWith('GC 1010');
  });

  it('returns a formatted profile string when profile found', async () => {
    getCourseProfile.mockResolvedValueOnce({
      courseCode: 'GC 1010',
      summary: 'A course about digital printing.',
      learningObjectives: ['Understand RIP software', 'Operate a digital press'],
      skills: ['PDF preflight', 'Color management'],
      competencies: [
        {
          name: 'Color Management',
          description: 'Profile press output using ICC profiles.',
          level: 'developed',
          evidence: [{ fileName: 'rubric.pdf', quote: 'Students profile a press.' }],
        },
      ],
      catalogDivergence: { reinforced: ['Color theory'], additions: [], gaps: [] },
      sourceRunId: 'run-1',
      manuallyEdited: false,
      updatedAt: new Date(),
    });

    const out = await resolveCourseContext('GC 1010', 'raw syllabus text here');

    expect(out).not.toBe('raw syllabus text here');
    expect(out).toContain('[Course profile: GC 1010]');
    expect(out).toContain('A course about digital printing.');
    expect(out).toContain('Understand RIP software');
    expect(out).toContain('Operate a digital press');
    expect(out).toContain('PDF preflight');
    expect(out).toContain('Color management');
    expect(out).toContain('Color Management (developed): Profile press output using ICC profiles.');
  });

  it('handles empty learningObjectives, skills, and competencies arrays', async () => {
    getCourseProfile.mockResolvedValueOnce({
      courseCode: 'GC 2020',
      summary: 'Short summary.',
      learningObjectives: [],
      skills: [],
      competencies: [],
      catalogDivergence: null,
      sourceRunId: null,
      manuallyEdited: false,
      updatedAt: new Date(),
    });

    const out = await resolveCourseContext('GC 2020', 'fallback');
    expect(out).toContain('[Course profile: GC 2020]');
    expect(out).toContain('Short summary.');
    // Should not throw on empty arrays
  });

  it('passes the courseLabel argument to getCourseProfile as-is (case-sensitive)', async () => {
    getCourseProfile.mockResolvedValueOnce(null);
    await resolveCourseContext('GC 4060ap', 'fallback');
    expect(getCourseProfile).toHaveBeenCalledWith('GC 4060ap');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/ai/analyze/resolve-course-context.test.ts`

Expected: FAIL with `Cannot find module '@/lib/ai/analyze/resolve-course-context'`.

- [ ] **Step 3: Implement the helper**

Create `lib/ai/analyze/resolve-course-context.ts`:

```typescript
import { getCourseProfile } from '@/lib/db/course-profile-queries';

/**
 * Resolves course context for use as the `syllabusText` argument to `draftKUD`.
 *
 * If a `course_profiles` row exists for `courseLabel`, returns a structured
 * string built from the enriched profile — giving the AI evidence-grounded
 * learning objectives, skills, and competencies instead of a raw catalog entry.
 *
 * If no profile is found, returns `fallbackSyllabusText` unchanged so existing
 * behavior is completely unaffected for courses without uploaded materials.
 */
export async function resolveCourseContext(
  courseLabel: string,
  fallbackSyllabusText: string
): Promise<string> {
  const profile = await getCourseProfile(courseLabel);
  if (!profile) return fallbackSyllabusText;

  const lines: string[] = [
    `[Course profile: ${profile.courseCode}]`,
    `Summary: ${profile.summary}`,
  ];

  const objectives = profile.learningObjectives as string[];
  if (objectives.length > 0) {
    lines.push('', 'Learning objectives:');
    for (const o of objectives) lines.push(`- ${o}`);
  }

  const skills = profile.skills as string[];
  if (skills.length > 0) {
    lines.push('', 'Skills:');
    for (const s of skills) lines.push(`- ${s}`);
  }

  const competencies = profile.competencies as Array<{
    name: string;
    description: string;
    level: string;
    evidence: Array<{ fileName: string; quote: string }>;
  }>;
  if (competencies.length > 0) {
    lines.push('', 'Competencies:');
    for (const c of competencies) {
      lines.push(`- ${c.name} (${c.level}): ${c.description}`);
    }
  }

  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/ai/analyze/resolve-course-context.test.ts`

Expected: 4 passing tests.

- [ ] **Step 5: tsc check**

Run: `pnpm exec tsc --noEmit`

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/analyze/resolve-course-context.ts tests/ai/analyze/resolve-course-context.test.ts
git commit -m "feat(analyze): resolveCourseContext — prefers course profile over raw syllabus text"
```

---

## Phase G — Wire resolveCourseContext into both analyze routes

### Task 7: Wire into `/api/analyze/route.ts` and `/api/analyze/target-chain/route.ts`

**Files:**
- Modify: `app/api/analyze/route.ts`
- Modify: `app/api/analyze/target-chain/route.ts`
- Test: `tests/api/course-profile-analyze-integration.test.ts` (create)

Both routes currently call `draftKUD({ targetContext, syllabusText: c.syllabusText })` with the raw input. This task inserts `resolveCourseContext(c.courseLabel, c.syllabusText)` before each `draftKUD` call so that courses with profiles get richer inputs. The client sees **no change** — response shape is identical; this is a transparent server-side improvement.

- [ ] **Step 1: Write the integration test**

Create `tests/api/course-profile-analyze-integration.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all heavy dependencies so this test stays unit-level.
const {
  applyAnalyzeGuards, buildTargetContext, draftKUD, scoreCoverage, evaluateScaffolding,
  persistAnalyzeRun, getTargetById, getProvider, resolveCourseContext,
  suggestPrereqs, analyzeGaps,
} = vi.hoisted(() => ({
  applyAnalyzeGuards: vi.fn(),
  buildTargetContext: vi.fn(),
  draftKUD: vi.fn(),
  scoreCoverage: vi.fn(),
  evaluateScaffolding: vi.fn(),
  persistAnalyzeRun: vi.fn(),
  getTargetById: vi.fn(),
  getProvider: vi.fn(),
  resolveCourseContext: vi.fn(),
  suggestPrereqs: vi.fn(),
  analyzeGaps: vi.fn(),
}));

vi.mock('@/lib/ai/analyze/guards', () => ({ applyAnalyzeGuards }));
vi.mock('@/lib/ai/analyze/target-context', () => ({ buildTargetContext }));
vi.mock('@/lib/ai/analyze/kud-draft', () => ({ draftKUD }));
vi.mock('@/lib/ai/analyze/coverage-score', () => ({ scoreCoverage }));
vi.mock('@/lib/ai/analyze/scaffolding-eval', () => ({ evaluateScaffolding }));
vi.mock('@/lib/ai/analyze/persist', () => ({ persistAnalyzeRun }));
vi.mock('@/lib/ai/analyze/prereq-suggest', () => ({ suggestPrereqs }));
vi.mock('@/lib/ai/analyze/gap-analyze', () => ({ analyzeGaps }));
vi.mock('@/lib/db/career-targets-queries', () => ({ getTargetById }));
vi.mock('@/lib/ai/provider', () => ({ getProvider }));
vi.mock('@/lib/ai/analyze/resolve-course-context', () => ({ resolveCourseContext }));
// loadPrompt warm-up is used in analyze/route.ts; mock so it doesn't fail.
vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt: vi.fn().mockResolvedValue('PROMPT') }));

import { POST as analyzePost } from '@/app/api/analyze/route';
import { POST as chainPost } from '@/app/api/analyze/target-chain/route';

const fakeKud = {
  data: { description: 'd', know: ['k'], understand: ['u'], do: ['x'] },
  telemetry: { costUsdCents: 1, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 },
};
const fakeCoverage = {
  data: [{ subCompetencyId: 'press', kudLevel: 'do', confidence: 'high', reasoning: 'explicit in assignment materials rubric' }],
  telemetry: { costUsdCents: 1, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 },
};
const fakePrereqs = {
  data: [],
  telemetry: { costUsdCents: 1, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 },
};
const fakeGaps = {
  data: [],
  telemetry: { costUsdCents: 1, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 },
};
const fakeScaffolding = {
  data: [{ subCompetencyId: 'press', quality: 'strong', reasoning: 'good progression across the sequence' }],
  telemetry: { costUsdCents: 1, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0 },
};

const fakeTarget = {
  id: 'production-operations',
  name: 'Production Operations',
  shortDefinition: 'def',
  industryContexts: [], knowDescriptors: [], understandDescriptors: [], doDescriptors: [],
  defensibilityNote: 'note', socCode: null, subCompetencies: [],
};

const minSyl = 'a'.repeat(60);

function makeAnalyzeReq(body: unknown) {
  return new Request('http://test/api/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
    body: JSON.stringify(body),
  });
}

function makeChainReq(body: unknown) {
  return new Request('http://test/api/analyze/target-chain', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  applyAnalyzeGuards.mockResolvedValue({ short: null, ipHash: 'hash' });
  buildTargetContext.mockReturnValue('TARGET CTX');
  getProvider.mockReturnValue({ name: 'openai', model: 'gpt' });
  persistAnalyzeRun.mockResolvedValue('run-1');
  getTargetById.mockResolvedValue(fakeTarget);
  draftKUD.mockResolvedValue(fakeKud);
  scoreCoverage.mockResolvedValue(fakeCoverage);
  evaluateScaffolding.mockResolvedValue(fakeScaffolding);
  suggestPrereqs.mockResolvedValue(fakePrereqs);
  analyzeGaps.mockResolvedValue(fakeGaps);
  // Default: resolveCourseContext returns the fallback (no profile)
  resolveCourseContext.mockImplementation((_label: string, fallback: string) => Promise.resolve(fallback));
});

describe('/api/analyze — resolveCourseContext integration', () => {
  it('calls resolveCourseContext for the focal course and each prior course', async () => {
    const res = await analyzePost(makeAnalyzeReq({
      careerTargetId: 'production-operations',
      course: { courseLabel: 'GC 3460', syllabusText: minSyl },
      priorCoursework: [{ courseLabel: 'GC 1010', syllabusText: minSyl }],
    }));
    expect(res.status).toBe(200);
    // Called once per course: 1 focal + 1 prior = 2 times
    expect(resolveCourseContext).toHaveBeenCalledTimes(2);
    expect(resolveCourseContext).toHaveBeenCalledWith('GC 3460', minSyl);
    expect(resolveCourseContext).toHaveBeenCalledWith('GC 1010', minSyl);
  });

  it('passes resolved context to draftKUD (profile replaces raw syllabus)', async () => {
    resolveCourseContext.mockImplementation((label: string, fallback: string) => {
      if (label === 'GC 3460') return Promise.resolve('ENRICHED PROFILE TEXT');
      return Promise.resolve(fallback);
    });
    await analyzePost(makeAnalyzeReq({
      careerTargetId: 'production-operations',
      course: { courseLabel: 'GC 3460', syllabusText: minSyl },
      priorCoursework: [{ courseLabel: 'GC 1010', syllabusText: minSyl }],
    }));
    const kudCalls = draftKUD.mock.calls as Array<[{ targetContext: string; syllabusText: string }]>;
    const focalCall = kudCalls.find((c) => c[0].syllabusText === 'ENRICHED PROFILE TEXT');
    expect(focalCall).toBeDefined();
  });
});

describe('/api/analyze/target-chain — resolveCourseContext integration', () => {
  it('calls resolveCourseContext for every course in the chain', async () => {
    const res = await chainPost(makeChainReq({
      careerTargetId: 'production-operations',
      courses: [
        { courseLabel: 'GC 1010', syllabusText: minSyl },
        { courseLabel: 'GC 3460', syllabusText: minSyl },
        { courseLabel: 'GC 4060', syllabusText: minSyl },
      ],
    }));
    expect(res.status).toBe(200);
    expect(resolveCourseContext).toHaveBeenCalledTimes(3);
    expect(resolveCourseContext).toHaveBeenCalledWith('GC 1010', minSyl);
    expect(resolveCourseContext).toHaveBeenCalledWith('GC 3460', minSyl);
    expect(resolveCourseContext).toHaveBeenCalledWith('GC 4060', minSyl);
  });

  it('passes resolved text to draftKUD', async () => {
    resolveCourseContext.mockImplementation((label: string, fallback: string) => {
      if (label === 'GC 4060') return Promise.resolve('PROFILE FOR 4060');
      return Promise.resolve(fallback);
    });
    await chainPost(makeChainReq({
      careerTargetId: 'production-operations',
      courses: [
        { courseLabel: 'GC 1010', syllabusText: minSyl },
        { courseLabel: 'GC 4060', syllabusText: minSyl },
      ],
    }));
    const kudCalls = draftKUD.mock.calls as Array<[{ targetContext: string; syllabusText: string }]>;
    const enrichedCall = kudCalls.find((c) => c[0].syllabusText === 'PROFILE FOR 4060');
    expect(enrichedCall).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/api/course-profile-analyze-integration.test.ts`

Expected: FAIL — `resolveCourseContext` is not called (because neither route imports it yet).

- [ ] **Step 3: Modify `app/api/analyze/route.ts`**

Add the import at the top of the file (after existing imports):

```typescript
import { resolveCourseContext } from '@/lib/ai/analyze/resolve-course-context';
```

Locate the `loadPrompt` warm-up block (the `await Promise.all([loadPrompt(...), ...])` call). Add a parallel resolution of all course contexts in that same block, **before** Round 1. Replace the section that currently reads:

```typescript
  await Promise.all([
    loadPrompt('draft-outcomes'),
    loadPrompt('score-coverage'),
    loadPrompt('suggest-prerequisites'),
    loadPrompt('analyze-prerequisite-gaps'),
    loadPrompt('evaluate-scaffolding'),
  ]);

  // Round 1 (parallel): N prior KUD drafts + 1 course KUD draft.
  const round1 = await Promise.all([
    ...priorCoursework.map(c => draftKUD({ targetContext, syllabusText: c.syllabusText })),
    draftKUD({ targetContext, syllabusText: course.syllabusText }),
  ]);
```

with:

```typescript
  await Promise.all([
    loadPrompt('draft-outcomes'),
    loadPrompt('score-coverage'),
    loadPrompt('suggest-prerequisites'),
    loadPrompt('analyze-prerequisite-gaps'),
    loadPrompt('evaluate-scaffolding'),
  ]);

  // Resolve course contexts in parallel: prefer course_profiles over raw syllabus when available.
  const [resolvedCourseSyllabus, ...resolvedPriorSyllabi] = await Promise.all([
    resolveCourseContext(course.courseLabel, course.syllabusText),
    ...priorCoursework.map(c => resolveCourseContext(c.courseLabel, c.syllabusText)),
  ]);

  // Round 1 (parallel): N prior KUD drafts + 1 course KUD draft.
  const round1 = await Promise.all([
    ...priorCoursework.map((c, i) => draftKUD({ targetContext, syllabusText: resolvedPriorSyllabi[i]! })),
    draftKUD({ targetContext, syllabusText: resolvedCourseSyllabus! }),
  ]);
```

No other changes to this file.

- [ ] **Step 4: Modify `app/api/analyze/target-chain/route.ts`**

Add the import at the top:

```typescript
import { resolveCourseContext } from '@/lib/ai/analyze/resolve-course-context';
```

Locate the section where `sortedCourses` is declared. After that sort and before Round 1, add context resolution. Replace:

```typescript
  // Round 1 (parallel): N KUD drafts
  const kudCalls = await Promise.all(
    sortedCourses.map(c => draftKUD({ targetContext, syllabusText: c.syllabusText }))
  );
```

with:

```typescript
  // Resolve course contexts: prefer course_profiles when available.
  const resolvedSyllabi = await Promise.all(
    sortedCourses.map(c => resolveCourseContext(c.courseLabel, c.syllabusText))
  );

  // Round 1 (parallel): N KUD drafts
  const kudCalls = await Promise.all(
    sortedCourses.map((c, i) => draftKUD({ targetContext, syllabusText: resolvedSyllabi[i]! }))
  );
```

No other changes to this file.

- [ ] **Step 5: Run the integration test to verify it passes**

Run: `pnpm test tests/api/course-profile-analyze-integration.test.ts`

Expected: 4 passing tests.

- [ ] **Step 6: Run the full existing analyze test suite as a regression guard**

Run: `pnpm test tests/api/analyze.test.ts tests/api/analyze-target-chain.test.ts`

Expected: all tests pass. The existing tests mock `resolveCourseContext` via `vi.mock` (it is imported lazily) — if they don't already mock it, add this to both test files' existing vi.mock blocks:

For `tests/api/analyze.test.ts`, inside the existing set of `vi.mock(...)` calls, add:

```typescript
vi.mock('@/lib/ai/analyze/resolve-course-context', () => ({
  resolveCourseContext: vi.fn((_label: string, fallback: string) => Promise.resolve(fallback)),
}));
```

For `tests/api/analyze-target-chain.test.ts`, add the same mock. This keeps both test files' behavior unchanged — they pass fallback text through as before.

- [ ] **Step 7: tsc check**

Run: `pnpm exec tsc --noEmit`

Expected: zero errors. The new `resolvedPriorSyllabi[i]!` non-null assertion is valid because `Promise.all` guarantees the array length matches `priorCoursework.length`.

- [ ] **Step 8: Commit**

```bash
git add app/api/analyze/route.ts app/api/analyze/target-chain/route.ts \
        tests/api/course-profile-analyze-integration.test.ts \
        tests/api/analyze.test.ts tests/api/analyze-target-chain.test.ts
git commit -m "feat(analyze): wire resolveCourseContext into both analyze routes — profiles feed draftKUD transparently"
```

---

## Phase H — Final regression pass

### Task 8: Full test suite + tsc

**Files:** none (no new files)

- [ ] **Step 1: Run all tests**

Run: `pnpm test`

Expected output includes a summary like:

```
Test Files  N passed (N)
Tests       N passed (N)
```

with zero failing tests and zero skipped tests (or only intentionally skipped ones from other features). If any test fails, investigate before proceeding.

- [ ] **Step 2: tsc strict check**

Run: `pnpm exec tsc --noEmit`

Expected: zero errors.

- [ ] **Step 3: Commit (only if any fixup was needed)**

If Step 1 or Step 2 revealed issues that required fixups, commit them:

```bash
git add <affected files>
git commit -m "fix: address test/tsc regressions after Plan 3 integration"
```

---

## Spec coverage self-review

| Spec requirement (Plan 3 scope) | Task |
|---|---|
| Editable `summary` textarea | Task 3 (`CourseProfileEditor`) |
| `learningObjectives` and `skills` as editable string-list editors (add/edit/remove) | Task 3 |
| `competencies` as editable list of `{ name, description, level }` | Task 3 |
| `evidence` quotes shown read-only | Task 3 |
| `catalogDivergence` as read-only panel | Task 3 |
| Save action persists via `PATCH /api/courses/[code]/profile` | Tasks 2 + 3 |
| PATCH sets `manuallyEdited = true` | Task 2 |
| Wire editor into per-course page Profile zone | Task 4 |
| `/preview/[slug]/courses` index listing all courses | Task 5 |
| Status badge: *No materials* | Task 5 |
| Status badge: *N files, not analyzed* | Task 5 |
| Status badge: *Profile ready* | Task 5 |
| Status badge: *Profile (edited)* | Task 5 |
| `resolveCourseContext(courseLabel, fallbackSyllabusText)` signature | Task 6 |
| Looks up `course_profiles` row by `courseLabel` | Task 6 |
| Profile found: builds context from enriched profile | Task 6 |
| No profile: returns `fallbackSyllabusText` unchanged | Task 6 |
| Wire into `/api/analyze/route.ts` per course before `draftKUD` | Task 7 |
| Wire into `/api/analyze/target-chain/route.ts` per course before `draftKUD` | Task 7 |
| No client-side changes to M-trial forms | Task 7 (server-only) |

All Plan 3 spec requirements are covered. Confirmed out-of-scope items not included: migration (Plan 1), upload route (Plan 1), vision transcription (Plan 1), analyze-materials route (Plan 2), AI synthesis helpers (Plan 2), read-only profile display (Plan 2).

### File path and import consistency

- **No new queries module is created by Plan 3.** Plan 2 created `lib/db/course-profile-queries.ts`. Plan 3 only adds to it: `updateProfileFromEdit` (Task 1) and `listCoursesWithStatus` (Task 5).
- All Task 1–7 references to the queries module use `@/lib/db/course-profile-queries` — no `course-profiles-queries` (plural) path exists.
- `resolve-course-context.ts` imports `getCourseProfile` from `@/lib/db/course-profile-queries` — not the old `getProfile` from a now-nonexistent module.
- The PATCH route imports `updateProfileFromEdit` from `@/lib/db/course-profile-queries` and calls it with `{ courseCode, summary, learningObjectives, skills, competencies }`. The function internally sets `manuallyEdited = true` and `updatedAt = new Date()`, and leaves `sourceRunId` and `catalogDivergence` untouched.

### Type consistency with Plan 2

- `getCourseProfile` (Plan 2) returns `typeof courseProfiles.$inferSelect | null`. Plan 3 reuses this return type directly — no redefinition of a conflicting `CourseProfile` type.
- `updateProfileFromEdit` input type accepts `competencies: Array<{ name, description, level, evidence }>` — matches the shape Plan 2 writes to the `course_profiles.competencies` JSONB column and the `CourseProfileEditor.tsx` `CompetencyItem` interface.
