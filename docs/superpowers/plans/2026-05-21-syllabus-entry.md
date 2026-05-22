# Syllabus Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two syllabus-attachment flows: (1) a "Parse from syllabus" button in the Course Builder Profile tab that AI-extracts learning objectives, major projects, and required skills from an uploaded PDF/DOCX; (2) an "External course" mode in the prereq analyzer's Prior Coursework slots that lets faculty attach a syllabus for any non-GC course.

**Architecture:** Two new API routes share the existing `extractText` utility. `/api/extract-syllabus` returns raw text (used by the prereq form). `/api/courses/[code]/parse-profile` extracts text then makes a focused AI call (new prompt + schema) and returns structured fields. Both features are purely additive UI changes — no DB schema changes needed.

**Tech Stack:** Next.js route handlers, existing `extractText` (mammoth/pdf-parse/vision), AI provider `complete()`, Zod schemas, React client components.

---

## File map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `app/api/extract-syllabus/route.ts` | Extract raw text from uploaded file; returns `{ text }` |
| Create | `app/api/extract-syllabus/__tests__/route.test.ts` | Tests for extract-syllabus route |
| Create | `lib/ai/prompts/parse-profile-fields.md` | Prompt: extract structured profile fields from syllabus text |
| Modify | `lib/ai/schemas.ts` | Add `profileFieldsSchema` and `profileFieldsJsonSchema` |
| Modify | `lib/ai/prompts/load.ts` | Add `'parse-profile-fields'` to `PromptName` union |
| Create | `lib/ai/analyze/parse-profile-fields.ts` | AI helper wrapping the new prompt |
| Create | `app/api/courses/[code]/parse-profile/route.ts` | Extract text + AI parse; returns structured profile fields |
| Create | `app/api/courses/[code]/parse-profile/__tests__/route.test.ts` | Tests for parse-profile route |
| Modify | `app/preview/[slug]/courses/[code]/BuilderProfileTab.tsx` | Add "Parse from syllabus" button + pre-fill logic |
| Modify | `components/PrototypeForm.tsx` | Add gc/external mode toggle to prior course slots |

---

### Task 1: `/api/extract-syllabus` route

**Files:**
- Create: `app/api/extract-syllabus/route.ts`
- Create: `app/api/extract-syllabus/__tests__/route.test.ts`

This route accepts a multipart form with `file` (PDF or DOCX) and `slug`, extracts plain text using the existing `extractText` utility, and returns `{ text: string }`. It is intentionally tiny — no DB writes, no AI call.

- [ ] **Step 1: Write the failing test**

Create `app/api/extract-syllabus/__tests__/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'valid-slug' }));
vi.mock('@/lib/courses/extract-text', () => ({ extractText: vi.fn() }));

import { POST } from '@/app/api/extract-syllabus/route';
import { extractText } from '@/lib/courses/extract-text';

const mockExtract = extractText as ReturnType<typeof vi.fn>;

function makeReq(slug: string, hasFile: boolean, mimeType = 'application/pdf') {
  const form = new FormData();
  form.set('slug', slug);
  if (hasFile) {
    form.set('file', new Blob(['%PDF-content'], { type: mimeType }), 'syllabus.pdf');
  }
  return new Request('http://x/api/extract-syllabus', { method: 'POST', body: form });
}

beforeEach(() => { vi.resetAllMocks(); });

describe('POST /api/extract-syllabus', () => {
  it('returns 401 for invalid slug', async () => {
    const res = await POST(makeReq('bad', true));
    expect(res.status).toBe(401);
  });

  it('returns 400 when no file provided', async () => {
    const res = await POST(makeReq('valid-slug', false));
    expect(res.status).toBe(400);
  });

  it('returns 400 for unsupported mime type', async () => {
    const res = await POST(makeReq('valid-slug', true, 'text/plain'));
    expect(res.status).toBe(400);
  });

  it('returns 422 when extraction fails', async () => {
    mockExtract.mockResolvedValue({ status: 'failed' });
    const res = await POST(makeReq('valid-slug', true));
    expect(res.status).toBe(422);
  });

  it('returns extracted text on success', async () => {
    mockExtract.mockResolvedValue({ status: 'ok', text: 'Syllabus content here.' });
    const res = await POST(makeReq('valid-slug', true));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.text).toBe('Syllabus content here.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run app/api/extract-syllabus
```

Expected: all 5 tests FAIL (module not found).

- [ ] **Step 3: Write the route**

Create `app/api/extract-syllabus/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { extractText } from '@/lib/courses/extract-text';
import type { ExtractedMimeType } from '@/lib/courses/extract-text';

export const maxDuration = 60;

const ALLOWED_MIME_TYPES = new Set<string>([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export async function POST(req: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'invalid multipart body' }, { status: 400 });
  }

  const slug = typeof form.get('slug') === 'string' ? (form.get('slug') as string) : '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const file = form.get('file') as File | null;
  if (!file || typeof file !== 'object' || typeof (file as File).arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'file field is required' }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: 'unsupported file type — upload a PDF or DOCX' },
      { status: 400 },
    );
  }

  const fileBytes = Buffer.from(await file.arrayBuffer());
  const result = await extractText({ fileBytes, mimeType: file.type as ExtractedMimeType, fileName: file.name });

  if (result.status === 'failed' || !result.text) {
    return NextResponse.json({ error: 'could not extract text from this file' }, { status: 422 });
  }

  return NextResponse.json({ text: result.text });
}
```

- [ ] **Step 4: Run tests and verify all pass**

```bash
pnpm vitest run app/api/extract-syllabus
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/extract-syllabus/route.ts app/api/extract-syllabus/__tests__/route.test.ts
git commit -m "feat(extract): add /api/extract-syllabus text extraction endpoint"
```

---

### Task 2: AI schema and prompt for profile-field parsing

**Files:**
- Create: `lib/ai/prompts/parse-profile-fields.md`
- Modify: `lib/ai/schemas.ts`
- Modify: `lib/ai/prompts/load.ts`
- Create: `lib/ai/analyze/parse-profile-fields.ts`

- [ ] **Step 1: Write the prompt**

Create `lib/ai/prompts/parse-profile-fields.md`:

```markdown
---
name: parse-profile-fields
---

# Task

You are reading a course syllabus and extracting three structured lists. Return ONLY what the syllabus explicitly states — do not infer, generalize, or invent.

# Fields to extract

- **learningObjectives**: Learning objective or student learning outcome statements. Typically labeled "Learning Objectives," "Course Objectives," "Student Learning Outcomes," or "Goals." Each item is one complete statement.
- **majorProjects**: Major assignments, projects, or assessments. Include the name and a very brief description if provided. Each item is one assignment or project.
- **skillsRequired**: Prerequisites, required prior knowledge, or required incoming skills. Typically labeled "Prerequisites," "Required Background," or "Students should already know/be able to." Each item is one skill or prerequisite.

# Constraints

- Extract verbatim or lightly paraphrased text from the syllabus.
- If a field is not present in the syllabus, return an empty array for it.
- Each array item is a single string — do not use sub-bullets or nested structure.
- Do not include course description, instructor info, grading policies, schedule, or contact information.
```

- [ ] **Step 2: Add Zod schema and JSON schema to `lib/ai/schemas.ts`**

Open `lib/ai/schemas.ts` and append at the end:

```typescript
export const profileFieldsSchema = z.object({
  learningObjectives: z.array(z.string().min(1)).max(20),
  majorProjects: z.array(z.string().min(1)).max(20),
  skillsRequired: z.array(z.string().min(1)).max(20),
});

export type ProfileFields = z.infer<typeof profileFieldsSchema>;

export const profileFieldsJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['learningObjectives', 'majorProjects', 'skillsRequired'],
  properties: {
    learningObjectives: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1 } },
    majorProjects: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1 } },
    skillsRequired: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1 } },
  },
} as const;
```

- [ ] **Step 3: Add `'parse-profile-fields'` to the `PromptName` union in `lib/ai/prompts/load.ts`**

The `PromptName` type is defined around line 8. Add `'parse-profile-fields'` to the union:

```typescript
type PromptName =
  | 'draft-outcomes'
  | 'score-coverage'
  | 'suggest-prerequisites'
  | 'analyze-prerequisite-gaps'
  | 'evaluate-scaffolding'
  | 'synthesize-target'
  | 'analyze-material'
  | 'synthesize-course-profile'
  | 'draft-course-outcomes'
  | 'extract-course-prereqs'
  | 'score-prior-coverage'
  | 'analyze-course-gaps'
  | 'evaluate-course-scaffolding'
  | 'extract-course-kud'
  | 'parse-profile-fields';
```

- [ ] **Step 4: Write the AI helper**

Create `lib/ai/analyze/parse-profile-fields.ts`:

```typescript
import { getProvider } from '@/lib/ai/provider';
import { loadPrompt } from '@/lib/ai/prompts/load';
import { profileFieldsSchema, profileFieldsJsonSchema } from '@/lib/ai/schemas';
import type { ProfileFields } from '@/lib/ai/schemas';

export async function parseProfileFields(syllabusText: string): Promise<ProfileFields> {
  const systemPrompt = await loadPrompt('parse-profile-fields');
  const provider = getProvider();
  const result = await provider.complete({
    systemPrompt,
    userMessage: `Syllabus text:\n${syllabusText}`,
    schemaName: 'profile_fields',
    jsonSchema: profileFieldsJsonSchema,
    validate: (raw) => profileFieldsSchema.parse(raw),
  });
  return result.data;
}
```

- [ ] **Step 5: Run the full test suite to confirm no regressions**

```bash
pnpm vitest run
```

Expected: all existing tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/prompts/parse-profile-fields.md lib/ai/schemas.ts lib/ai/prompts/load.ts lib/ai/analyze/parse-profile-fields.ts
git commit -m "feat(ai): add parse-profile-fields prompt, schema, and helper"
```

---

### Task 3: `/api/courses/[code]/parse-profile` route

**Files:**
- Create: `app/api/courses/[code]/parse-profile/route.ts`
- Create: `app/api/courses/[code]/parse-profile/__tests__/route.test.ts`

Accepts a multipart form with `file` + `slug`. Extracts text, sends to AI, returns `{ learningObjectives, majorProjects, skillsRequired }`.

- [ ] **Step 1: Write the failing test**

Create `app/api/courses/[code]/parse-profile/__tests__/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/slug', () => ({ isValidSlug: (s: string) => s === 'valid-slug' }));
vi.mock('@/lib/courses/extract-text', () => ({ extractText: vi.fn() }));
vi.mock('@/lib/ai/analyze/parse-profile-fields', () => ({ parseProfileFields: vi.fn() }));

import { POST } from '@/app/api/courses/[code]/parse-profile/route';
import { extractText } from '@/lib/courses/extract-text';
import { parseProfileFields } from '@/lib/ai/analyze/parse-profile-fields';

const mockExtract = extractText as ReturnType<typeof vi.fn>;
const mockParse = parseProfileFields as ReturnType<typeof vi.fn>;

const FAKE_FIELDS = {
  learningObjectives: ['Operate a press', 'Mix ink'],
  majorProjects: ['Final press run'],
  skillsRequired: ['Basic color theory'],
};

function makeReq(slug: string, hasFile: boolean, code = 'GC 3460') {
  const form = new FormData();
  form.set('slug', slug);
  if (hasFile) {
    form.set('file', new Blob(['%PDF-content'], { type: 'application/pdf' }), 'syllabus.pdf');
  }
  return [
    new Request('http://x/api/courses/GC%203460/parse-profile', { method: 'POST', body: form }),
    { params: Promise.resolve({ code }) },
  ] as const;
}

beforeEach(() => { vi.resetAllMocks(); });

describe('POST /api/courses/[code]/parse-profile', () => {
  it('returns 401 for invalid slug', async () => {
    const [req, ctx] = makeReq('bad', true);
    const res = await POST(req, ctx);
    expect(res.status).toBe(401);
  });

  it('returns 400 when no file provided', async () => {
    const [req, ctx] = makeReq('valid-slug', false);
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
  });

  it('returns 422 when extraction fails', async () => {
    mockExtract.mockResolvedValue({ status: 'failed' });
    const [req, ctx] = makeReq('valid-slug', true);
    const res = await POST(req, ctx);
    expect(res.status).toBe(422);
  });

  it('returns structured fields on success', async () => {
    mockExtract.mockResolvedValue({ status: 'ok', text: 'Syllabus content here.' });
    mockParse.mockResolvedValue(FAKE_FIELDS);
    const [req, ctx] = makeReq('valid-slug', true);
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.learningObjectives).toEqual(['Operate a press', 'Mix ink']);
    expect(json.majorProjects).toEqual(['Final press run']);
    expect(json.skillsRequired).toEqual(['Basic color theory']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run app/api/courses/\\[code\\]/parse-profile
```

Expected: all 4 tests FAIL (module not found).

- [ ] **Step 3: Write the route**

Create `app/api/courses/[code]/parse-profile/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { extractText } from '@/lib/courses/extract-text';
import { parseProfileFields } from '@/lib/ai/analyze/parse-profile-fields';
import type { ExtractedMimeType } from '@/lib/courses/extract-text';

export const maxDuration = 60;

interface Ctx { params: Promise<{ code: string }> }

const ALLOWED_MIME_TYPES = new Set<string>([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export async function POST(req: Request, { params: _params }: Ctx): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'invalid multipart body' }, { status: 400 });
  }

  const slug = typeof form.get('slug') === 'string' ? (form.get('slug') as string) : '';
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  }

  const file = form.get('file') as File | null;
  if (!file || typeof file !== 'object' || typeof (file as File).arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'file field is required' }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'unsupported file type — upload a PDF or DOCX' }, { status: 400 });
  }

  const fileBytes = Buffer.from(await file.arrayBuffer());
  const extracted = await extractText({ fileBytes, mimeType: file.type as ExtractedMimeType, fileName: file.name });

  if (extracted.status === 'failed' || !extracted.text) {
    return NextResponse.json({ error: 'could not extract text from this file' }, { status: 422 });
  }

  const fields = await parseProfileFields(extracted.text);
  return NextResponse.json(fields);
}
```

- [ ] **Step 4: Run tests and verify all pass**

```bash
pnpm vitest run app/api/courses/\\[code\\]/parse-profile
```

Expected: 4 tests PASS.

- [ ] **Step 5: Run the full test suite**

```bash
pnpm vitest run
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/courses/\[code\]/parse-profile/route.ts "app/api/courses/[code]/parse-profile/__tests__/route.test.ts"
git commit -m "feat(profile): add /api/courses/[code]/parse-profile AI extraction route"
```

---

### Task 4: Profile tab — "Parse from syllabus" button

**Files:**
- Modify: `app/preview/[slug]/courses/[code]/BuilderProfileTab.tsx`

Add a "Parse from syllabus" button above the editable lists. When clicked, opens a file picker. On file selection, calls `/api/courses/[code]/parse-profile` and pre-fills the three lists. Faculty review and adjust, then save as normal.

- [ ] **Step 1: Rewrite `BuilderProfileTab.tsx`**

Replace the entire file content with:

```tsx
'use client';

import { useRef, useState } from 'react';

interface Props {
  courseCode: string;
  slug: string;
  initialObjectives: string[];
  initialProjects: string[];
  initialSkills: string[];
  builderStatus: string;
  onSaved: (newStatus: string) => void;
}

function EditableList({
  label,
  description,
  items,
  onChange,
}: {
  label: string;
  description: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  function update(i: number, value: string) {
    const next = [...items];
    next[i] = value;
    onChange(next);
  }
  function remove(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...items, '']);
  }

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex gap-2">
            <input
              type="text"
              value={item}
              onChange={(e) => update(i, e.target.value)}
              className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-muted-foreground hover:text-destructive text-sm px-2"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={add}
        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
      >
        + Add item
      </button>
    </div>
  );
}

export function BuilderProfileTab({
  courseCode,
  slug,
  initialObjectives,
  initialProjects,
  initialSkills,
  builderStatus,
  onSaved,
}: Props) {
  const [objectives, setObjectives] = useState<string[]>(initialObjectives);
  const [projects, setProjects] = useState<string[]>(initialProjects);
  const [skills, setSkills] = useState<string[]>(initialSkills);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedNote, setParsedNote] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const wasApproved = builderStatus === 'approved' || builderStatus === 'kuds_generated';

  async function handleParseSyllabus(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!fileInputRef.current) return;
    fileInputRef.current.value = '';
    if (!file) return;

    setParsing(true);
    setParseError(null);
    setParsedNote(false);

    const form = new FormData();
    form.set('slug', slug);
    form.set('file', file);

    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(courseCode)}/parse-profile`, {
        method: 'POST',
        body: form,
      });
      const json = await res.json();
      if (!res.ok) {
        setParseError((json as { error?: string }).error ?? `Parse failed (${res.status})`);
        return;
      }
      const fields = json as { learningObjectives: string[]; majorProjects: string[]; skillsRequired: string[] };
      if (fields.learningObjectives.length > 0) setObjectives(fields.learningObjectives);
      if (fields.majorProjects.length > 0) setProjects(fields.majorProjects);
      if (fields.skillsRequired.length > 0) setSkills(fields.skillsRequired);
      setParsedNote(true);
    } catch {
      setParseError('Parse failed. Please try again.');
    } finally {
      setParsing(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(courseCode)}/profile?slug=${encodeURIComponent(slug)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            learningObjectives: objectives.filter(Boolean),
            majorProjects: projects.filter(Boolean),
            skillsRequired: skills.filter(Boolean),
          }),
        },
      );
      if (!res.ok) throw new Error('Save failed');
      setSaved(true);
      const allHaveContent =
        objectives.some(Boolean) && projects.some(Boolean) && skills.some(Boolean);
      onSaved(allHaveContent ? 'profile_complete' : builderStatus);
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      {wasApproved && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Saving profile changes will reset your KUD approval — you will need to regenerate and re-accept KUDs.
        </div>
      )}

      {/* Syllabus parse */}
      <div className="rounded-md border border-dashed border-muted-foreground/30 px-4 py-3 space-y-2">
        <p className="text-sm font-medium">Parse from syllabus</p>
        <p className="text-xs text-muted-foreground">
          Upload a PDF or DOCX syllabus and AI will pre-fill the fields below. Review and adjust before saving.
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={parsing}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {parsing ? 'Parsing…' : 'Attach syllabus'}
          </button>
          {parsedNote && (
            <span className="text-sm text-green-700">Fields pre-filled — review before saving.</span>
          )}
          {parseError && (
            <span className="text-sm text-destructive">{parseError}</span>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
          className="sr-only"
          onChange={handleParseSyllabus}
        />
      </div>

      <EditableList
        label="Learning objectives"
        description="What students will achieve — pre-populated from catalog or syllabus, edit to match reality."
        items={objectives}
        onChange={setObjectives}
      />

      <EditableList
        label="Major projects"
        description="Highest-stakes assignments. First item carries the most weight in KUD generation."
        items={projects}
        onChange={setProjects}
      />

      <EditableList
        label="Required incoming skills"
        description="What students need to arrive knowing — the course's own prereq statement."
        items={skills}
        onChange={setSkills}
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save profile'}
        </button>
        {saved && <span className="text-sm text-green-600">Saved</span>}
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>

      <p className="text-xs text-muted-foreground">
        After saving, go to the KUDs tab to generate outcomes from this profile.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Run the full test suite to confirm no regressions**

```bash
pnpm vitest run
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add "app/preview/[slug]/courses/[code]/BuilderProfileTab.tsx"
git commit -m "feat(profile): add parse-from-syllabus button to Profile tab"
```

---

### Task 5: Prereq form — external course entry

**Files:**
- Modify: `components/PrototypeForm.tsx`

Add a GC/External mode toggle to each prior course slot. External mode shows a course label text input and a syllabus file attachment button. The file is uploaded to `/api/extract-syllabus` and the returned text is used as `syllabusText` in the analyze request.

The main "Course being analyzed" card stays GC-only (requires approved course). Only prior coursework slots get the external option.

- [ ] **Step 1: Rewrite `components/PrototypeForm.tsx`**

Replace the entire file with:

```tsx
'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CourseSelector } from './CourseSelector';
import { CourseDetails, type CourseDetailFields } from './CourseDetails';
import { formatCourseSyllabus } from '@/lib/courses/formatCourseSyllabus';

const MAX_PRIOR_COURSES = 8;

export interface CourseInput {
  courseLabel: string;
  syllabusText: string;
}

export interface AnalyzeInput {
  course: CourseInput;
  priorCoursework: CourseInput[];
}

interface CourseFullData {
  code: string;
  title: string;
  level: number;
  track: string;
  description: string;
  prerequisites: string;
  learningObjectives: string[];
  majorProjects: string[];
  skillsRequired: string[];
}

interface GcSlot {
  mode: 'gc';
  selectedCode: string;
  original: CourseFullData | null;
  current: CourseFullData | null;
}

interface ExternalSlot {
  mode: 'external';
  label: string;
  syllabusText: string | null;
  fileName: string | null;
  extracting: boolean;
  extractError: string | null;
}

type PriorSlot = GcSlot | ExternalSlot;

interface Props {
  slug: string;
  onAnalyze: (input: AnalyzeInput) => void;
  isAnalyzing: boolean;
}

// API response shape from /api/courses/[code] mirrors the Drizzle row.
interface CourseApiResponse {
  code: string;
  title: string;
  level: number;
  track: string;
  description: string | null;
  prerequisites: string | null;
  syllabusUrl: string | null;
  learningObjectives: string[] | null;
  majorProjects: string[] | null;
  skillsRequired: string[] | null;
}

function toCourseFullData(r: CourseApiResponse): CourseFullData {
  return {
    code: r.code,
    title: r.title,
    level: r.level,
    track: r.track,
    description: r.description ?? '',
    prerequisites: r.prerequisites ?? '',
    learningObjectives: r.learningObjectives ?? [],
    majorProjects: r.majorProjects ?? [],
    skillsRequired: r.skillsRequired ?? [],
  };
}

function emptyGcSlot(): GcSlot {
  return { mode: 'gc', selectedCode: '', original: null, current: null };
}

function emptyExternalSlot(): ExternalSlot {
  return { mode: 'external', label: '', syllabusText: null, fileName: null, extracting: false, extractError: null };
}

function isSlotReady(slot: PriorSlot): boolean {
  if (slot.mode === 'gc') return slot.current !== null;
  return slot.label.trim().length > 0 && slot.syllabusText !== null;
}

function ExternalSlotUI({
  slot,
  slug,
  onUpdate,
}: {
  slot: ExternalSlot;
  slug: string;
  onUpdate: (next: ExternalSlot) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;

    onUpdate({ ...slot, extracting: true, extractError: null, syllabusText: null, fileName: null });

    const form = new FormData();
    form.set('slug', slug);
    form.set('file', file);

    try {
      const res = await fetch('/api/extract-syllabus', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok) {
        onUpdate({ ...slot, extracting: false, extractError: (json as { error?: string }).error ?? `Failed (${res.status})` });
        return;
      }
      onUpdate({ ...slot, extracting: false, syllabusText: (json as { text: string }).text, fileName: file.name, extractError: null });
    } catch {
      onUpdate({ ...slot, extracting: false, extractError: 'Failed to extract text. Try a different file.' });
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Course label (e.g. "ENGL 101 — Composition")</label>
        <input
          type="text"
          value={slot.label}
          onChange={(e) => onUpdate({ ...slot, label: e.target.value })}
          placeholder="Course name or code"
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Syllabus (PDF or DOCX)</label>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={slot.extracting}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            {slot.extracting ? 'Extracting…' : 'Attach syllabus'}
          </button>
          {slot.fileName && !slot.extracting && (
            <span className="text-xs text-green-700">{slot.fileName} — ready</span>
          )}
          {slot.extractError && (
            <span className="text-xs text-destructive">{slot.extractError}</span>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
          className="sr-only"
          onChange={handleFile}
        />
      </div>
    </div>
  );
}

export function PrototypeForm({ slug, onAnalyze, isAnalyzing }: Props) {
  const [mainCourse, setMainCourse] = useState<GcSlot>(emptyGcSlot());
  const [priorCoursework, setPriorCoursework] = useState<PriorSlot[]>([emptyGcSlot()]);

  async function fetchCourse(code: string): Promise<CourseFullData | null> {
    try {
      const resp = await fetch(`/api/courses/${encodeURIComponent(code)}?slug=${encodeURIComponent(slug)}`);
      if (!resp.ok) return null;
      const body = (await resp.json()) as CourseApiResponse;
      return toCourseFullData(body);
    } catch {
      return null;
    }
  }

  async function handleSelectCourse(code: string) {
    setMainCourse({ mode: 'gc', selectedCode: code, original: null, current: null });
    const data = await fetchCourse(code);
    if (data) setMainCourse({ mode: 'gc', selectedCode: code, original: data, current: data });
  }

  async function handleSelectPrior(index: number, code: string) {
    setPriorCoursework(prev => prev.map((slot, i) =>
      i === index ? { mode: 'gc' as const, selectedCode: code, original: null, current: null } : slot
    ));
    const data = await fetchCourse(code);
    if (data) {
      setPriorCoursework(prev => prev.map((slot, i) =>
        i === index ? { mode: 'gc' as const, selectedCode: code, original: data, current: data } : slot
      ));
    }
  }

  function handleCourseChange(next: CourseDetailFields) {
    setMainCourse(prev => prev.current ? { ...prev, current: { ...prev.current, ...next } } : prev);
  }

  function handleCourseReset() {
    setMainCourse(prev => prev.original ? { ...prev, current: prev.original } : prev);
  }

  function handlePriorChange(index: number, next: CourseDetailFields) {
    setPriorCoursework(prev => prev.map((slot, i) => {
      if (i !== index || slot.mode !== 'gc' || !slot.current) return slot;
      return { ...slot, current: { ...slot.current, ...next } };
    }));
  }

  function handlePriorReset(index: number) {
    setPriorCoursework(prev => prev.map((slot, i) => {
      if (i !== index || slot.mode !== 'gc' || !slot.original) return slot;
      return { ...slot, current: slot.original };
    }));
  }

  function switchPriorMode(index: number, mode: 'gc' | 'external') {
    setPriorCoursework(prev => prev.map((slot, i) => {
      if (i !== index) return slot;
      return mode === 'gc' ? emptyGcSlot() : emptyExternalSlot();
    }));
  }

  function updateExternalSlot(index: number, next: ExternalSlot) {
    setPriorCoursework(prev => prev.map((slot, i) => i === index ? next : slot));
  }

  function addPriorCourse() {
    if (priorCoursework.length < MAX_PRIOR_COURSES) {
      setPriorCoursework(prev => [...prev, emptyGcSlot()]);
    }
  }

  function removePriorCourse(index: number) {
    if (priorCoursework.length <= 1) return;
    setPriorCoursework(prev => prev.filter((_, i) => i !== index));
  }

  const canSubmit =
    !isAnalyzing &&
    mainCourse.current !== null &&
    priorCoursework.length >= 1 &&
    priorCoursework.every(isSlotReady);

  function handleSubmit() {
    if (!mainCourse.current) return;
    const priors: CourseInput[] = [];
    for (const slot of priorCoursework) {
      if (slot.mode === 'gc') {
        if (!slot.current) return;
        priors.push({ courseLabel: slot.current.code, syllabusText: formatCourseSyllabus(slot.current) });
      } else {
        if (!slot.syllabusText) return;
        priors.push({ courseLabel: slot.label, syllabusText: slot.syllabusText });
      }
    }
    onAnalyze({
      course: { courseLabel: mainCourse.current.code, syllabusText: formatCourseSyllabus(mainCourse.current) },
      priorCoursework: priors,
    });
  }

  return (
    <div className="space-y-6">
      {/* Course being analyzed card */}
      <Card>
        <CardHeader>
          <CardTitle>Course being analyzed</CardTitle>
          <p className="text-sm text-muted-foreground">Only courses approved in the Course Builder are available for selection.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <CourseSelector
            slug={slug}
            selectedCode={mainCourse.selectedCode}
            onSelect={handleSelectCourse}
            label="Course being analyzed (by code)"
            inputId="course-selector"
            requireApproved
          />
          {mainCourse.original && mainCourse.current && (
            <CourseDetails
              original={mainCourse.original}
              current={mainCourse.current}
              onChange={handleCourseChange}
              onReset={handleCourseReset}
            />
          )}
        </CardContent>
      </Card>

      {/* Prior coursework card */}
      <Card>
        <CardHeader>
          <CardTitle>Prior coursework</CardTitle>
          <p className="text-sm text-muted-foreground">
            Any prerequisite or expected prior coursework. Order doesn&apos;t matter. Only approved GC courses or external courses with an attached syllabus are accepted.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {priorCoursework.map((slot, index) => (
            <div key={index} className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between gap-2">
                {/* Mode toggle */}
                <div className="flex rounded-md border text-sm overflow-hidden">
                  <button
                    type="button"
                    onClick={() => switchPriorMode(index, 'gc')}
                    className={`px-3 py-1 ${slot.mode === 'gc' ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted'}`}
                  >
                    GC course
                  </button>
                  <button
                    type="button"
                    onClick={() => switchPriorMode(index, 'external')}
                    className={`px-3 py-1 ${slot.mode === 'external' ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted'}`}
                  >
                    External course
                  </button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => removePriorCourse(index)}
                  disabled={priorCoursework.length <= 1}
                  aria-label={`Remove prior course ${index + 1}`}
                >
                  Remove
                </Button>
              </div>

              {slot.mode === 'gc' ? (
                <>
                  <CourseSelector
                    slug={slug}
                    selectedCode={slot.selectedCode}
                    onSelect={(code) => handleSelectPrior(index, code)}
                    label={`Prior course ${index + 1}`}
                    excludeCode={mainCourse.selectedCode || undefined}
                    inputId={`prior-selector-${index}`}
                    requireApproved
                  />
                  {slot.original && slot.current && (
                    <CourseDetails
                      original={slot.original}
                      current={slot.current}
                      onChange={(next) => handlePriorChange(index, next)}
                      onReset={() => handlePriorReset(index)}
                    />
                  )}
                </>
              ) : (
                <ExternalSlotUI
                  slot={slot}
                  slug={slug}
                  onUpdate={(next) => updateExternalSlot(index, next)}
                />
              )}
            </div>
          ))}

          <Button
            variant="outline"
            type="button"
            onClick={addPriorCourse}
            disabled={priorCoursework.length >= MAX_PRIOR_COURSES}
          >
            + Add prior course
          </Button>
        </CardContent>
      </Card>

      <Button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full"
      >
        {isAnalyzing ? 'Analyzing…' : 'Analyze prerequisite alignment'}
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Run the full test suite**

```bash
pnpm vitest run
```

Expected: all tests PASS (PrototypeForm has no dedicated unit tests; the component is tested via integration).

- [ ] **Step 3: Commit**

```bash
git add components/PrototypeForm.tsx
git commit -m "feat(prereq): add external course mode with syllabus attachment to prior coursework slots"
```

---

### Task 6: Final check and push

- [ ] **Step 1: Run the full test suite one last time**

```bash
pnpm vitest run
```

Expected: all tests PASS.

- [ ] **Step 2: Push**

```bash
git push
```
