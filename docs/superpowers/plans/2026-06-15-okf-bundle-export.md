# OKF Bundle Export (single course) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a downloadable, self-contained `.zip` for one captured course — `index.md` + `profile.md` + `transcript.md` + `materials/*.md`, every file OKF-framed markdown — served at a scoped `/view/[code]/okf-bundle` route plus a capture-surface link.

**Architecture:** Three new pure serializers (`okf-doc` builder, `material-to-okf`, `transcript-to-okf`) + a `bundle.ts` assembler that zips them with `yazl`. A thin `GET /view/[code]/okf-bundle` route reuses the exact data loads + scope gate + PII redaction the shipped `/view/[code]/okf` route uses. One UI link mirrors the existing "↓ Markdown" affordance. Postgres stays the source of truth; the bundle is computed on demand from the latest snapshot — no stored copy.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Vitest (jsdom), `yazl` (zip writer, new), `yauzl` (zip reader, already present — used in tests), Drizzle/Postgres (reused queries only).

**Spec:** [`docs/superpowers/specs/2026-06-15-okf-bundle-export-design.md`](../specs/2026-06-15-okf-bundle-export-design.md)

**Reused, do NOT modify:** `lib/okf/profile-to-okf.ts` (`profileToOkfMarkdown`), `lib/ai/wiki/okf-frontmatter.ts` (`okfBase`), `lib/capture/redact-pii.ts` (`redactPiiDeep`), `lib/db/capture-snapshots-queries.ts` (`getLatestSnapshotByCourse`, `SnapshotRow`), `lib/db/capture-messages-queries.ts` (`getSessionMessages`), `lib/db/course-materials-queries.ts` (`listMaterialsByCourse`, `CourseMaterialRow`), `lib/courses/program-visibility.ts` (`isProgramVisible`), `lib/storage/local-storage.ts` (`safeFilename`), `lib/db/courses-queries.ts` (`getCourseByCode`).

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/okf/okf-doc.ts` (new) | Pure: build an OKF markdown document (7 required-key frontmatter + extras + body). Shared by the new serializers. |
| `lib/okf/material-to-okf.ts` (new) | Pure: one `CourseMaterialRow` → an OKF `type: material` markdown file. |
| `lib/okf/transcript-to-okf.ts` (new) | Pure: capture-message turns → an OKF `type: transcript` markdown file. |
| `lib/okf/bundle.ts` (new) | Assemble `index.md` + `profile.md` + `transcript.md` + `materials/*.md` and zip with `yazl` → `Buffer`. |
| `app/view/[code]/okf-bundle/route.ts` (new) | Thin `GET`: scope gate + load snapshot/messages/materials + redact + `buildOkfBundle` → `application/zip`. |
| `app/capture/[code]/ProfileReviewPanel.tsx` (modify) | Add a "↓ Bundle (.zip)" link beside the two existing "↓ Markdown" links. |
| `package.json` (modify) | Add `yazl` + dev `@types/yazl`. |

---

### Task 1: Dependency + shared OKF document builder

**Files:**
- Modify: `package.json`
- Create: `lib/okf/okf-doc.ts`
- Test: `tests/lib/okf/okf-doc.test.ts`

- [ ] **Step 1: Add the zip-writer dependency**

Run:
```bash
pnpm add yazl && pnpm add -D @types/yazl
```
Expected: `package.json` gains `yazl` (dependencies) and `@types/yazl` (devDependencies); lockfile updates.

- [ ] **Step 2: Write the failing test**

Create `tests/lib/okf/okf-doc.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { okfDocument } from '@/lib/okf/okf-doc';

describe('okfDocument', () => {
  it('emits all 7 OKF required keys, extras, and the body', () => {
    const md = okfDocument(
      {
        type: 'material',
        title: 'Syllabus.pdf',
        description: 'Captured material',
        slug: 'syllabus-pdf',
        tags: ['material', 'gc-2400'],
        timestamp: '2026-06-15T00:00:00.000Z',
        resource: 'http://host/view/GC%202400',
        extra: { ignored: 'true', mime: 'application/pdf' },
      },
      'Body text here.',
    );
    expect(md.startsWith('---\n')).toBe(true);
    for (const k of ['type', 'title', 'description', 'slug', 'tags', 'timestamp', 'resource']) {
      expect(md).toMatch(new RegExp(`^${k}:`, 'm'));
    }
    expect(md).toMatch(/^type: material$/m);
    expect(md).toMatch(/^tags: \[material, gc-2400\]$/m);
    expect(md).toMatch(/^ignored: true$/m);
    expect(md).toMatch(/^mime: application\/pdf$/m);
    expect(md.trimEnd().endsWith('Body text here.')).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run tests/lib/okf/okf-doc.test.ts`
Expected: FAIL — cannot resolve `@/lib/okf/okf-doc`.

- [ ] **Step 4: Implement `lib/okf/okf-doc.ts`**

```ts
/**
 * Pure builder for an OKF-v0.1 markdown document from scratch. Distinct from
 * lib/ai/wiki/okf-frontmatter.ts:stampOkfFrontmatter (which MUTATES an existing
 * wiki page's frontmatter); this composes a fresh file. Used by the bundle
 * serializers (material / transcript / index). No I/O, no AI.
 */
export interface OkfDocFields {
  type: string;
  title: string;
  description: string;
  slug: string;
  tags: string[];
  timestamp: string; // ISO 8601
  resource: string;
  /** Optional scalar extras (e.g. { ignored: 'true' }) appended after the required keys. */
  extra?: Record<string, string>;
}

/** Quote a YAML scalar that may contain special chars; bare-word safe values pass through. */
function yamlScalar(v: string): string {
  return /^[\w./:@%-]+$/.test(v) ? v : JSON.stringify(v);
}

export function okfDocument(fields: OkfDocFields, body: string): string {
  const lines = [
    `type: ${fields.type}`,
    `title: ${yamlScalar(fields.title)}`,
    `description: ${yamlScalar(fields.description)}`,
    `slug: ${fields.slug}`,
    `tags: [${fields.tags.join(', ')}]`,
    `timestamp: ${fields.timestamp}`,
    `resource: ${fields.resource}`,
    ...Object.entries(fields.extra ?? {}).map(([k, v]) => `${k}: ${yamlScalar(v)}`),
  ];
  return `---\n${lines.join('\n')}\n---\n\n${body.trimEnd()}\n`;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run tests/lib/okf/okf-doc.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml lib/okf/okf-doc.ts tests/lib/okf/okf-doc.test.ts
git commit -m "feat(okf): yazl dep + okfDocument builder for bundle files"
```

---

### Task 2: Material serializer

**Files:**
- Create: `lib/okf/material-to-okf.ts`
- Test: `tests/lib/okf/material-to-okf.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/okf/material-to-okf.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { materialToOkfMarkdown } from '@/lib/okf/material-to-okf';

const base = {
  fileName: 'Canvas File: Reading.pdf',
  extractedText: 'Chapter 1. The basics.',
  ignored: false,
  mimeType: 'application/pdf',
  uploadedAt: new Date('2026-06-15T12:00:00.000Z'),
};

describe('materialToOkfMarkdown', () => {
  it('frames the material as OKF type: material with the extracted text body', () => {
    const md = materialToOkfMarkdown(base, { resource: 'http://h/view/GC%202400' });
    expect(md).toMatch(/^type: material$/m);
    expect(md).toMatch(/^title: "Canvas File: Reading\.pdf"$/m);
    expect(md).toMatch(/^timestamp: 2026-06-15T12:00:00\.000Z$/m);
    expect(md).toMatch(/^mime: application\/pdf$/m);
    expect(md).toContain('Chapter 1. The basics.');
    expect(md).not.toMatch(/^ignored:/m);
  });

  it('marks set-aside materials with ignored: true', () => {
    const md = materialToOkfMarkdown({ ...base, ignored: true }, { resource: 'http://h/view/GC%202400' });
    expect(md).toMatch(/^ignored: true$/m);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/lib/okf/material-to-okf.test.ts`
Expected: FAIL — cannot resolve `@/lib/okf/material-to-okf`.

- [ ] **Step 3: Implement `lib/okf/material-to-okf.ts`**

```ts
import { okfDocument } from '@/lib/okf/okf-doc';

/** The fields of a captured material the bundle needs. A subset of CourseMaterialRow. */
export interface OkfMaterialInput {
  fileName: string;
  extractedText: string | null;
  ignored: boolean;
  mimeType: string;
  uploadedAt: Date | string;
}

/** Slugify a material file name for the OKF `slug` field. */
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'material';
}

/**
 * One captured material → an OKF `type: material` markdown file. The body is
 * the canonical Docling-extracted text (not the AI digest). Pure.
 */
export function materialToOkfMarkdown(
  material: OkfMaterialInput,
  opts: { resource: string },
): string {
  const ts = (material.uploadedAt instanceof Date ? material.uploadedAt : new Date(material.uploadedAt)).toISOString();
  return okfDocument(
    {
      type: 'material',
      title: material.fileName,
      description: 'Captured course material (extracted text)',
      slug: slugify(material.fileName),
      tags: ['material'],
      timestamp: ts,
      resource: opts.resource,
      extra: {
        mime: material.mimeType,
        ...(material.ignored ? { ignored: 'true' } : {}),
      },
    },
    material.extractedText ?? '_(no extracted text)_',
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/lib/okf/material-to-okf.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/okf/material-to-okf.ts tests/lib/okf/material-to-okf.test.ts
git commit -m "feat(okf): material-to-okf serializer"
```

---

### Task 3: Transcript serializer

**Files:**
- Create: `lib/okf/transcript-to-okf.ts`
- Test: `tests/lib/okf/transcript-to-okf.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/okf/transcript-to-okf.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { transcriptToOkfMarkdown } from '@/lib/okf/transcript-to-okf';

const meta = {
  courseCode: 'GC 2400',
  courseTitle: 'Intro',
  slug: 'gc-2400',
  timestamp: '2026-06-15T00:00:00.000Z',
  resource: 'http://h/view/GC%202400',
};

describe('transcriptToOkfMarkdown', () => {
  it('renders user/assistant turns and skips system/tool/empty', () => {
    const md = transcriptToOkfMarkdown(
      [
        { role: 'system', content: 'You are an auditor.' },
        { role: 'user', content: 'We cover color theory.' },
        { role: 'assistant', content: 'How is it assessed?' },
        { role: 'tool', content: '{"x":1}' },
        { role: 'assistant', content: null },
      ],
      meta,
    );
    expect(md).toMatch(/^type: transcript$/m);
    expect(md).toContain('**Faculty:** We cover color theory.');
    expect(md).toContain('**Auditor:** How is it assessed?');
    expect(md).not.toContain('You are an auditor.');
    expect(md).not.toContain('{"x":1}');
  });

  it('degrades to a placeholder when there are no turns', () => {
    const md = transcriptToOkfMarkdown([], meta);
    expect(md).toMatch(/^type: transcript$/m);
    expect(md).toMatch(/no linked transcript/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/lib/okf/transcript-to-okf.test.ts`
Expected: FAIL — cannot resolve `@/lib/okf/transcript-to-okf`.

- [ ] **Step 3: Implement `lib/okf/transcript-to-okf.ts`**

```ts
import { okfDocument } from '@/lib/okf/okf-doc';

export interface OkfTranscriptMessage {
  role: string; // 'system' | 'user' | 'assistant' | 'tool'
  content: string | null;
}

export interface OkfTranscriptMeta {
  courseCode: string;
  courseTitle: string;
  slug: string;
  timestamp: string; // ISO (snapshot createdAt)
  resource: string;
}

const ROLE_LABEL: Record<string, string> = { user: 'Faculty', assistant: 'Auditor' };

/**
 * The capture interview turns → an OKF `type: transcript` markdown file. Only
 * user + assistant turns with text are rendered (system/tool turns and
 * tool-only assistant turns are dropped). Pure — PII redaction is the caller's
 * job (the route redacts before calling).
 */
export function transcriptToOkfMarkdown(
  messages: OkfTranscriptMessage[],
  meta: OkfTranscriptMeta,
): string {
  const turns = messages
    .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content && m.content.trim())
    .map(m => `**${ROLE_LABEL[m.role]}:** ${m.content!.trim()}`);
  const body = turns.length
    ? `# ${meta.courseCode} — capture transcript\n\n${turns.join('\n\n')}`
    : `# ${meta.courseCode} — capture transcript\n\n_(This snapshot has no linked transcript.)_`;
  return okfDocument(
    {
      type: 'transcript',
      title: `${meta.courseCode} — capture transcript`,
      description: `Capture interview for ${meta.courseTitle}`,
      slug: `${meta.slug}-transcript`,
      tags: ['transcript'],
      timestamp: meta.timestamp,
      resource: meta.resource,
    },
    body,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/lib/okf/transcript-to-okf.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/okf/transcript-to-okf.ts tests/lib/okf/transcript-to-okf.test.ts
git commit -m "feat(okf): transcript-to-okf serializer"
```

---

### Task 4: Bundle assembler (zip via yazl)

**Files:**
- Create: `lib/okf/bundle.ts`
- Test: `tests/lib/okf/bundle.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/okf/bundle.test.ts` (reads the produced zip back with `yauzl`):
```ts
import { describe, it, expect } from 'vitest';
import * as yauzl from 'yauzl';
import { buildOkfBundle } from '@/lib/okf/bundle';

function listEntries(buf: Buffer): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('no zip'));
      const out: Record<string, string> = {};
      zip.on('entry', (entry: yauzl.Entry) => {
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e ?? new Error('no stream'));
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () => { out[entry.fileName] = Buffer.concat(chunks).toString('utf8'); zip.readEntry(); });
        });
      });
      zip.on('end', () => resolve(out));
      zip.readEntry();
    });
  });
}

const input = {
  course: { code: 'GC 2400', title: 'Intro', prefix: 'GC', level: 2400, track: null, buildsToCareer: false, catalogUrl: null },
  profile: { scale_version: 'v1', overview: 'A course.', competencies: [], revised_objectives_draft: [], incoming_expectations: [] } as any,
  snapshot: { id: 'snap-1', createdAt: new Date('2026-06-15T00:00:00.000Z'), instructorName: 'Dr. X' },
  viewUrl: 'http://h/view/GC%202400',
  transcriptMessages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }],
  materials: [
    { fileName: 'Reading.pdf', extractedText: 'text', ignored: false, mimeType: 'application/pdf', uploadedAt: new Date('2026-06-15T00:00:00.000Z') },
    { fileName: 'Empty.pdf', extractedText: null, ignored: false, mimeType: 'application/pdf', uploadedAt: new Date('2026-06-15T00:00:00.000Z') },
  ],
};

describe('buildOkfBundle', () => {
  it('zips index/profile/transcript and one file per material with text', async () => {
    const buf = await buildOkfBundle(input);
    const entries = await listEntries(buf);
    const names = Object.keys(entries).sort();
    expect(names).toContain('index.md');
    expect(names).toContain('profile.md');
    expect(names).toContain('transcript.md');
    expect(names).toContain('materials/reading-pdf.md');
    // material with no extracted text produces no file…
    expect(names).not.toContain('materials/empty-pdf.md');
    // …but is listed in the manifest as not extracted.
    expect(entries['index.md']).toContain('Empty.pdf');
    expect(entries['index.md']).toMatch(/snap-1/);
    expect(entries['profile.md']).toMatch(/^type: course$/m);
    expect(entries['transcript.md']).toContain('**Faculty:** Hi');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/lib/okf/bundle.test.ts`
Expected: FAIL — cannot resolve `@/lib/okf/bundle`.

- [ ] **Step 3: Implement `lib/okf/bundle.ts`**

```ts
import { ZipFile } from 'yazl';
import type { CaptureProfile } from '@/lib/ai/analyze/capture-scores';
import { profileToOkfMarkdown } from '@/lib/okf/profile-to-okf';
import { materialToOkfMarkdown, type OkfMaterialInput } from '@/lib/okf/material-to-okf';
import { transcriptToOkfMarkdown, type OkfTranscriptMessage } from '@/lib/okf/transcript-to-okf';
import { okfDocument } from '@/lib/okf/okf-doc';
import { safeFilename } from '@/lib/storage/local-storage';

export interface OkfBundleInput {
  course: {
    code: string; title: string; prefix?: string; level?: number | null;
    track?: string | null; buildsToCareer?: boolean; catalogUrl?: string | null;
  };
  profile: CaptureProfile;        // already PII-redacted by the caller
  snapshot: { id: string; createdAt: Date | string; instructorName: string | null };
  viewUrl: string;
  transcriptMessages: OkfTranscriptMessage[]; // already PII-redacted by the caller
  materials: OkfMaterialInput[];
}

function courseSlug(code: string): string {
  return code.toLowerCase().replace(/\s+/g, '-');
}

/** Resolve material-entry-name collisions (two files slugging to the same name). */
function uniqueName(used: Set<string>, base: string): string {
  let name = base;
  let n = 2;
  while (used.has(name)) { name = base.replace(/\.md$/, `-${n}.md`); n++; }
  used.add(name);
  return name;
}

/**
 * Assemble the single-course OKF bundle and return a .zip as a Buffer.
 * Entries: index.md, profile.md, transcript.md, materials/<name>.md (one per
 * material with extracted text). Pure of DB/AI — takes already-loaded,
 * already-redacted data.
 */
export async function buildOkfBundle(input: OkfBundleInput): Promise<Buffer> {
  const slug = courseSlug(input.course.code);
  const createdIso = (input.snapshot.createdAt instanceof Date
    ? input.snapshot.createdAt : new Date(input.snapshot.createdAt)).toISOString();

  const files: Array<{ name: string; content: string }> = [];

  files.push({
    name: 'profile.md',
    content: profileToOkfMarkdown({
      course: input.course,
      profile: input.profile,
      snapshot: { id: input.snapshot.id, createdAt: input.snapshot.createdAt, instructorName: input.snapshot.instructorName },
      viewUrl: input.viewUrl,
    }),
  });

  files.push({
    name: 'transcript.md',
    content: transcriptToOkfMarkdown(input.transcriptMessages, {
      courseCode: input.course.code,
      courseTitle: input.course.title,
      slug,
      timestamp: createdIso,
      resource: input.viewUrl,
    }),
  });

  const used = new Set<string>();
  const manifestMaterials: string[] = [];
  for (const m of input.materials) {
    if (m.extractedText && m.extractedText.trim()) {
      const name = uniqueName(used, `materials/${safeFilename(m.fileName).replace(/\.[^.]+$/, '')}.md`);
      files.push({ name, content: materialToOkfMarkdown(m, { resource: input.viewUrl }) });
      manifestMaterials.push(`- \`${name}\` — ${m.fileName}${m.ignored ? ' (set aside)' : ''}`);
    } else {
      manifestMaterials.push(`- ${m.fileName} — _(not extracted; no file)_`);
    }
  }

  const indexBody = [
    `# ${input.course.code} — ${input.course.title}`,
    '',
    'Self-contained OKF export of one captured course. Every file is OKF markdown — open in any editor or hand to a tool/agent.',
    '',
    `- **Snapshot:** ${input.snapshot.id} · ${createdIso}`,
    `- **Instructor:** ${input.snapshot.instructorName ?? 'Department canonical'}`,
    `- **Source:** ${input.viewUrl}`,
    '',
    '## Contents',
    '- `profile.md` — OKF course profile (competencies, K/U/D depths, evidence, citations)',
    '- `transcript.md` — the capture interview',
    '### Materials',
    ...manifestMaterials,
    '',
    '> Depth scale: 0 not present · 1 exposure · 2 recognize · 3 recall · 4 transfer · 5 fluent.',
  ].join('\n');

  files.push({
    name: 'index.md',
    content: okfDocument(
      {
        type: 'bundle',
        title: `${input.course.code} — OKF bundle`,
        description: `Self-contained capture export for ${input.course.title}`,
        slug: `${slug}-bundle`,
        tags: ['bundle'],
        timestamp: createdIso,
        resource: input.viewUrl,
        extra: { snapshot_id: input.snapshot.id },
      },
      indexBody,
    ),
  });

  const zip = new ZipFile();
  for (const f of files) zip.addBuffer(Buffer.from(f.content, 'utf8'), f.name);
  zip.end();

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c));
    zip.outputStream.on('end', () => resolve());
    zip.outputStream.on('error', reject);
  });
  return Buffer.concat(chunks);
}
```

> Note: confirm the `CaptureProfile` import path matches `profile-to-okf.ts`'s own import (it imports `CaptureProfile` — match that exact module specifier). If `profileToOkfMarkdown`'s param type is exported, import it instead of re-importing `CaptureProfile`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/lib/okf/bundle.test.ts`
Expected: PASS (1 test). If `profileToOkfMarkdown` throws on the minimal fixture profile, extend the fixture's `profile` with the fields its null-guards read (per `profile-to-okf.ts`) until it renders — do not change the serializer.

- [ ] **Step 5: Commit**

```bash
git add lib/okf/bundle.ts tests/lib/okf/bundle.test.ts
git commit -m "feat(okf): bundle assembler — zip index/profile/transcript/materials"
```

---

### Task 5: Scoped bundle route

**Files:**
- Create: `app/view/[code]/okf-bundle/route.ts`
- Test: `app/view/[code]/okf-bundle/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/view/[code]/okf-bundle/__tests__/route.test.ts` (mirrors the `/okf` route test's mocking style):
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetCourse = vi.fn();
const mockGetSnapshot = vi.fn();
const mockGetMessages = vi.fn();
const mockListMaterials = vi.fn();
vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode: (...a: unknown[]) => mockGetCourse(...a) }));
vi.mock('@/lib/db/capture-snapshots-queries', () => ({ getLatestSnapshotByCourse: (...a: unknown[]) => mockGetSnapshot(...a) }));
vi.mock('@/lib/db/capture-messages-queries', () => ({ getSessionMessages: (...a: unknown[]) => mockGetMessages(...a) }));
vi.mock('@/lib/db/course-materials-queries', () => ({ listMaterialsByCourse: (...a: unknown[]) => mockListMaterials(...a) }));

import { GET } from '../route';

function req(code = 'GC 2400') {
  return [
    new Request(`http://host/view/${encodeURIComponent(code)}/okf-bundle`),
    { params: Promise.resolve({ code: encodeURIComponent(code) }) },
  ] as const;
}

const VISIBLE_COURSE = { code: 'GC 2400', title: 'Intro', prefix: 'GC', level: 2400, track: null, buildsToCareer: false, catalogUrl: null, scope: 'gc', status: 'offered' };
const SANDBOX_COURSE = { ...VISIBLE_COURSE, status: 'sandbox' };
const SNAPSHOT = { id: 'snap-1', createdAt: new Date('2026-06-15T00:00:00.000Z'), instructorName: 'Dr. X', transcriptSessionId: 'sess-1', profile: { scale_version: 'v1', overview: 'A course.', competencies: [], revised_objectives_draft: [], incoming_expectations: [] } };

beforeEach(() => {
  vi.resetAllMocks();
  mockGetCourse.mockResolvedValue(VISIBLE_COURSE);
  mockGetSnapshot.mockResolvedValue(SNAPSHOT);
  mockGetMessages.mockResolvedValue([{ role: 'user', content: 'Hi from Dr. X' }]);
  mockListMaterials.mockResolvedValue([]);
});

describe('GET /view/[code]/okf-bundle', () => {
  it('returns a zip for a visible course with a snapshot', async () => {
    const [r, ctx] = req();
    const res = await GET(r, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toContain('gc-2400-okf-bundle.zip');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK'); // zip magic
  });

  it('404s when no snapshot exists', async () => {
    mockGetSnapshot.mockResolvedValue(null);
    const [r, ctx] = req();
    expect((await GET(r, ctx)).status).toBe(404);
  });

  it('404s (opaque) for a non-visible sandbox course', async () => {
    mockGetCourse.mockResolvedValue(SANDBOX_COURSE);
    const [r, ctx] = req();
    expect((await GET(r, ctx)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run app/view/\[code\]/okf-bundle`
Expected: FAIL — cannot resolve `../route`.

- [ ] **Step 3: Implement `app/view/[code]/okf-bundle/route.ts`**

```ts
import { getCourseByCode } from '@/lib/db/courses-queries';
import { getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import { getSessionMessages } from '@/lib/db/capture-messages-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { redactPiiDeep } from '@/lib/capture/redact-pii';
import { isProgramVisible } from '@/lib/courses/program-visibility';
import { buildOkfBundle } from '@/lib/okf/bundle';

interface RouteContext { params: Promise<{ code: string }>; }

export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const { code: rawCode } = await params;
  const code = decodeURIComponent(rawCode);

  const course = await getCourseByCode(code);
  // Opaque 404 for non-gc/non-offered, identical to /view/[code]/okf — a sandbox
  // course's bundle is reachable only via the scoped link (external-access plan).
  if (!course || !isProgramVisible(course)) {
    return new Response(`No such course: ${code}`, { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  const snapshot = await getLatestSnapshotByCourse(code);
  if (!snapshot) {
    return new Response(`No captured profile for ${code}`, { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }

  const origin = new URL(req.url).origin;
  const viewUrl = `${origin}/view/${encodeURIComponent(code)}`;

  const rawMessages = snapshot.transcriptSessionId
    ? await getSessionMessages(code, snapshot.transcriptSessionId)
    : [];
  const transcriptMessages = redactPiiDeep(
    rawMessages.map(m => ({ role: m.role, content: m.content ?? '' })),
  );

  const materials = await listMaterialsByCourse(code);

  const zip = await buildOkfBundle({
    course: {
      code: course.code, title: course.title, prefix: course.prefix,
      level: course.level, track: course.track,
      buildsToCareer: course.buildsToCareer, catalogUrl: course.catalogUrl,
    },
    profile: redactPiiDeep(snapshot.profile),
    snapshot: { id: snapshot.id, createdAt: snapshot.createdAt, instructorName: snapshot.instructorName },
    viewUrl,
    transcriptMessages,
    materials: materials.map(m => ({
      fileName: m.fileName, extractedText: m.extractedText ?? null,
      ignored: m.ignored, mimeType: m.mimeType, uploadedAt: m.uploadedAt,
    })),
  });

  const filename = `${code.toLowerCase().replace(/\s+/g, '-')}-okf-bundle.zip`;
  return new Response(new Uint8Array(zip), {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run app/view/\[code\]/okf-bundle`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add "app/view/[code]/okf-bundle/route.ts" "app/view/[code]/okf-bundle/__tests__/route.test.ts"
git commit -m "feat(okf): GET /view/[code]/okf-bundle — scoped zip route"
```

---

### Task 6: Capture-surface download link

**Files:**
- Modify: `app/capture/[code]/ProfileReviewPanel.tsx` (near lines 1119, 1174–1183, and 1508)
- Test: `tests/app/capture/profile-review-okf-download.test.tsx` (extend the existing OKF-download test)

- [ ] **Step 1: Add the failing assertion to the existing test**

In `tests/app/capture/profile-review-okf-download.test.tsx`, add inside the `hasSnapshot={true}` case (mirror the existing "↓ Markdown" assertion):
```tsx
const bundle = screen.getByRole('link', { name: /Bundle/ });
expect(bundle).toHaveAttribute('href', expect.stringContaining('/okf-bundle'));
```
And in the `hasSnapshot={false}` (no snapshot) case:
```tsx
expect(screen.queryByRole('link', { name: /Bundle/ })).toBeNull();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/app/capture/profile-review-okf-download.test.tsx`
Expected: FAIL — no link matching `/Bundle/`.

- [ ] **Step 3: Add `bundleHref` beside `okfHref`**

In `app/capture/[code]/ProfileReviewPanel.tsx`, immediately after the `okfHref` const (line ~1119):
```tsx
  const bundleHref = `http://gcworkflow.clemson.edu:3000/view/${encodeURIComponent(courseCode)}/okf-bundle`;
```

- [ ] **Step 4: Render the Bundle link in both spots (gated by `showOkfDownload`)**

After the header-row "↓ Markdown" `<a>` (the block ending ~line 1183), add a sibling inside the same `{showOkfDownload && (…)}` region — restructure to render both links when shown:
```tsx
            {showOkfDownload && (
              <>
                <a
                  href={okfHref}
                  download
                  className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
                  title="Download this course's saved profile as portable Markdown (OKF)"
                >
                  ↓ Markdown
                </a>
                <a
                  href={bundleHref}
                  download
                  className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
                  title="Download the full course as a self-contained OKF bundle (.zip): profile, transcript, and all materials"
                >
                  ↓ Bundle (.zip)
                </a>
              </>
            )}
```
Apply the same "add a sibling Bundle `<a>` after the Markdown `<a>`" change at the second spot (the post-snapshot success-card row, ~line 1508), reusing `bundleHref` and matching that row's button styling.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run tests/app/capture/profile-review-okf-download.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "app/capture/[code]/ProfileReviewPanel.tsx" tests/app/capture/profile-review-okf-download.test.tsx
git commit -m "feat(capture): '↓ Bundle (.zip)' link to /view/[code]/okf-bundle"
```

---

### Task 7: Full verification + STATE.md

**Files:**
- Modify: `docs/STATE.md`

- [ ] **Step 1: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0. (If `yazl`'s `ZipFile` import errors, switch to `import yazl from 'yazl'; const zip = new yazl.ZipFile();` — `@types/yazl` is CommonJS.)

- [ ] **Step 2: Full suite**

Run: `pnpm test`
Expected: all green (prior 1248 + the new okf-doc/material/transcript/bundle/route/panel tests).

- [ ] **Step 3: Flip STATE.md sub-project (3) to SHIPPED**

In `docs/STATE.md`, edit the external-testing arc bullet: change `**(3) Self-contained OKF bundle export — SPEC'D 2026-06-15**` to `SHIPPED 2026-06-15`, note the new route `GET /view/[code]/okf-bundle`, the new files (`lib/okf/okf-doc.ts`, `material-to-okf.ts`, `transcript-to-okf.ts`, `bundle.ts`), the `yazl` dep, and the capture-surface link. Update the arc header count to `(1)+(2)+(3) SHIPPED`.

- [ ] **Step 4: Commit**

```bash
git add docs/STATE.md
git commit -m "docs(state): OKF bundle export shipped (arc sub-project 3)"
```

- [ ] **Step 5: Deploy (operator-confirmed)**

This adds a new route + a dependency. Deploy per the ritual: push `dev`; in the deploy worktree `/Users/admin/projects/curriculum_developer-deploy` run `pnpm install` (picks up `yazl`), `git merge --ff-only origin/dev`, push `main`; then `launchctl kickstart -k gui/$(id -u)/com.gc.curriculum-tool` and poll `http://127.0.0.1:3000/` for 200. **Do not deploy without explicit operator go.**

---

## Notes for the implementer

- **PII redaction lives in the route, not the serializers.** `transcript-to-okf` and `material-to-okf` are pure; the route calls `redactPiiDeep` on the profile and the transcript messages before passing them in. Don't add redaction inside the serializers.
- **Materials are not snapshotted.** `profile.md`/`transcript.md` come from the immutable snapshot; `materials/*` reflect current `course_materials`. This matches the spec and the existing `/okf` projection — don't try to snapshot materials.
- **`CaptureProfile` import:** match whatever module `lib/okf/profile-to-okf.ts` imports it from, so the `buildOkfBundle` param type lines up with `profileToOkfMarkdown`'s param.
- **Course-code encoding:** codes contain spaces (`GC 2400`). The route `decodeURIComponent`s the param; the filename lowercases + hyphenates. Mirror the shipped `/okf` route exactly.
