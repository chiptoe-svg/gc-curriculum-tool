# Portable OKF Course Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let anyone download a captured course profile as a portable, self-contained OKF-v0.1 markdown file, generated deterministically on demand from the latest snapshot (always current; Postgres stays the source of truth).

**Architecture:** A pure `profileToOkfMarkdown` serializer (the same content `/view` shows, emitted as OKF markdown) + a public `GET` route under `/view/[code]/okf` that reads the latest snapshot, **applies the same `redactPiiDeep` `/view` uses**, serializes, and returns `text/markdown` as an attachment + a "Download as Markdown" link on `/view`. No new storage; no AI.

**Tech Stack:** Next.js 15 App Router (route handler), TypeScript strict, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-14-portable-okf-course-profiles-design.md`

**Conventions:** single test `pnpm vitest run <path>`; full suite `pnpm test`; typecheck `pnpm tsc --noEmit` (run explicitly). Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**Verified facts:**
- `deriveEvidenceBand(claim: { source, citations })` → `'claimed'|'materials_supported'|'artifact_verified'` (`lib/program/evidence-ladder.ts`). `BAND_MARKER[band]` → `·claimed`/`·materials`/`·artifact` (`lib/ai/wiki/evidence-band-markers.ts`).
- Competency shape: `{ statement, type, k_depth, u_depth, d_depth, evidence_k, evidence_u, evidence_d, source?, citations? }` (foundational → k/u null). Incoming: `{ statement, expected_depth:{k,u,d}, source?, citations? }`. Apparent outcomes: `revised_objectives_draft: string[]|null`. Plus `overview`, `class_structure {topics,cadence,assessment}`, `major_projects [{title,description}]`, `course_emphasis [{competency,points,share_pct,centrality}]`, `verification_summary { course_shape, strongest_evidence }`.
- Course row (`getCourseByCode` → full row): `code, title, prefix, level, track, buildsToCareer, catalogUrl, description, ...`.
- `getLatestSnapshotByCourse(courseCode) → SnapshotRow | null` (`SnapshotRow` has `profile, id, createdAt, instructorName`).
- `/view` redacts via `redactPiiDeep(snapshot.profile)` before render (find its import in `app/view/[code]/page.tsx`).
- Slug: `courseCode.toLowerCase().replace(/\s+/g, '-')`.
- `/view/*` is in `PUBLIC_PREFIXES`, so `/view/[code]/okf` is public (middleware skips Basic Auth) — matching the public `/view` page.

**File map:**
- Create `lib/okf/profile-to-okf.ts` (+ test) — pure serializer.
- Create `app/view/[code]/okf/route.ts` (+ test) — public served `.md`.
- Modify `app/view/[code]/page.tsx` — "Download as Markdown" link.
- Modify `docs/STATE.md`.

---

### Task 1: Pure `profileToOkfMarkdown` serializer

**Files:**
- Create: `lib/okf/profile-to-okf.ts`
- Test: `tests/lib/okf/profile-to-okf.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/okf/profile-to-okf.test.ts
import { describe, it, expect } from 'vitest';
import { profileToOkfMarkdown } from '@/lib/okf/profile-to-okf';
import type { CaptureProfile } from '@/lib/ai/capture/schema';

const profile = {
  course_code: 'GC 4800', scale_version: 'v1', generated_at: 'now',
  overview: { narrative: 'A capstone in production.', at_a_glance: [], who_for: '', arc: '' },
  competencies: [
    { statement: 'Color management', type: 'technical', k_depth: 3, u_depth: 3, d_depth: 4, evidence_k: 'k', evidence_u: 'u', evidence_d: 'measured color in the press lab', source: 'materials', citations: [{ type: 'chunk', chunkId: 'c1', messageId: null, excerpt: 'rubric' }] },
    { statement: 'Curiosity', type: 'foundational', k_depth: null, u_depth: null, d_depth: 3, evidence_k: null, evidence_u: null, evidence_d: 'reflection', source: 'instructor' },
  ],
  incoming_expectations: [{ statement: 'Spot color basics', expected_depth: { k: 2, u: null, d: 3 }, evidenced_by: ['x'], confidence: 'low', source: 'materials' }],
  verification_summary: { course_shape: 'A production capstone.', strongest_evidence: ['press-lab artifacts'], dimensional_patterns: [], catalog_vs_evidence: [] },
  audit_notes: {}, revised_objectives_draft: ['Students produce print-ready artwork'],
  course_emphasis: [{ competency: 'Color management', points: 120, share_pct: 40, centrality: 'central' }],
  class_structure: { topics: ['Color', 'Prepress'], cadence: 'weekly 2-hour lab', assessment: 'Two projects + a final.' },
  major_projects: [{ title: 'Brand Color Report', description: 'Measure color across media.', competencies: ['Color management'] }],
} as unknown as CaptureProfile;

const args = {
  course: { code: 'GC 4800', title: 'Capstone', prefix: 'GC', level: 4, track: 'print', buildsToCareer: true, catalogUrl: 'https://catalog/gc4800' },
  profile,
  snapshot: { id: 'snap-123', createdAt: new Date('2026-06-14T00:00:00.000Z'), instructorName: 'Dr. X' },
  viewUrl: 'http://host/view/GC%204800',
};

describe('profileToOkfMarkdown', () => {
  const md = profileToOkfMarkdown(args);
  it('emits OKF v0.1 frontmatter with type: course + required keys', () => {
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toMatch(/^type: course$/m);
    expect(md).toMatch(/^title: ".*Capstone.*"$/m);
    expect(md).toMatch(/^timestamp: 2026-06-14T00:00:00.000Z$/m);
    expect(md).toMatch(/^snapshot_id: snap-123$/m);
    expect(md).toMatch(/^slug: gc-4800$/m);
    expect(md).toMatch(/resource:/);
    expect(md).toMatch(/tags: \[.*builds-to-career.*\]/);
  });
  it('renders apparent outcomes, competencies with K/U/D + band marker, incoming, structure, projects, emphasis', () => {
    expect(md).toContain('## Apparent outcomes');
    expect(md).toContain('Students produce print-ready artwork');
    expect(md).toContain('## Competencies developed');
    expect(md).toContain('Color management');
    expect(md).toContain('·materials'); // chunk citation → materials_supported band
    expect(md).toContain('## Incoming expectations');
    expect(md).toContain('Spot color basics');
    expect(md).toContain('## Class structure');
    expect(md).toContain('weekly 2-hour lab');
    expect(md).toContain('## Major projects');
    expect(md).toContain('Brand Color Report');
    expect(md).toContain('## Course emphasis');
    expect(md).toContain('## Citations');
    expect(md).toContain('snap-123');
  });
  it('omits K/U for a foundational competency', () => {
    // the Curiosity line should carry D but not "K" depth chips
    const curiosityLine = md.split('\n').find(l => l.includes('Curiosity'))!;
    expect(curiosityLine).toContain('D3');
    expect(curiosityLine).not.toMatch(/K\d/);
  });
  it('omits sections whose fields are null/empty', () => {
    const lean = profileToOkfMarkdown({ ...args, profile: { ...profile, class_structure: null, major_projects: null, course_emphasis: null, revised_objectives_draft: null } as unknown as CaptureProfile });
    expect(lean).not.toContain('## Class structure');
    expect(lean).not.toContain('## Major projects');
    expect(lean).not.toContain('## Course emphasis');
    expect(lean).not.toContain('## Apparent outcomes');
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm vitest run tests/lib/okf/profile-to-okf.test.ts`.

- [ ] **Step 3: Implement `lib/okf/profile-to-okf.ts`**

```typescript
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import { deriveEvidenceBand } from '@/lib/program/evidence-ladder';
import { BAND_MARKER } from '@/lib/ai/wiki/evidence-band-markers';

export interface ProfileToOkfInput {
  course: {
    code: string; title: string;
    prefix?: string | null; level?: number | null; track?: string | null;
    buildsToCareer?: boolean | null; catalogUrl?: string | null;
  };
  profile: CaptureProfile;
  snapshot: { id: string; createdAt: Date | string; instructorName: string | null };
  viewUrl?: string;
}

const slugify = (code: string): string => code.toLowerCase().replace(/\s+/g, '-');
const yamlStr = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\s*\n\s*/g, ' ').trim()}"`;
const depthChip = (label: 'K' | 'U' | 'D', v: number | null | undefined): string | null => (v == null ? null : `${label}${v}`);

/** Deterministic OKF-v0.1 markdown projection of a captured course profile.
 *  Pure — no I/O, no AI. The portable, self-contained face of the profile. */
export function profileToOkfMarkdown(input: ProfileToOkfInput): string {
  const { course, profile, snapshot, viewUrl } = input;
  const ts = typeof snapshot.createdAt === 'string' ? snapshot.createdAt : snapshot.createdAt.toISOString();
  const description = profile.overview?.narrative?.split(/\n\s*\n/)[0]?.trim()
    || profile.verification_summary?.course_shape || course.title;

  const tags = [
    course.prefix ? course.prefix.toLowerCase() : null,
    course.level != null ? `level-${course.level}` : null,
    course.track && course.track !== 'unspecified' ? course.track : null,
    course.buildsToCareer ? 'builds-to-career' : null,
  ].filter((t): t is string => !!t);

  const resource = viewUrl || course.catalogUrl || null;

  const fm: string[] = [
    '---',
    'type: course',
    `title: ${yamlStr(`${course.code} — ${course.title}`)}`,
    `description: ${yamlStr(description)}`,
    `slug: ${slugify(course.code)}`,
    `tags: [${tags.join(', ')}]`,
    `timestamp: ${ts}`,
    ...(resource ? [`resource: ${resource}`] : []),
    `instructor: ${yamlStr(snapshot.instructorName ?? 'Department canonical')}`,
    `snapshot_id: ${snapshot.id}`,
    `scale_version: ${profile.scale_version}`,
    '---',
    '',
  ];

  const out: string[] = [...fm];
  const push = (s: string) => out.push(s);

  push(`# ${course.code} — ${course.title}`);
  push('');
  if (profile.overview?.narrative) { push(profile.overview.narrative.trim()); push(''); }

  const apparent = profile.revised_objectives_draft ?? [];
  if (apparent.length) {
    push('## Apparent outcomes');
    push('Based on the materials and interview, this is what the course appears to deliver.');
    push('');
    for (const o of apparent) push(`- ${o}`);
    push('');
  }

  const comps = (profile.competencies ?? []).filter(c => c.statement);
  if (comps.length) {
    push('## Competencies developed');
    push('');
    for (const c of comps) {
      const foundational = c.type === 'foundational';
      const chips = [foundational ? null : depthChip('K', c.k_depth), foundational ? null : depthChip('U', c.u_depth), depthChip('D', c.d_depth)].filter(Boolean).join(' ');
      const band = BAND_MARKER[deriveEvidenceBand({ source: c.source, citations: c.citations })];
      push(`- **${c.statement}** — ${chips} ${band}`);
      if (c.evidence_d) push(`  - Evidence: ${c.evidence_d}`);
    }
    push('');
  }

  const incoming = (profile.incoming_expectations ?? []).filter(e => e.statement);
  if (incoming.length) {
    push('## Incoming expectations');
    push('What students are expected to arrive able to do.');
    push('');
    for (const e of incoming) {
      const chips = [depthChip('K', e.expected_depth?.k), depthChip('U', e.expected_depth?.u), depthChip('D', e.expected_depth?.d)].filter(Boolean).join(' ');
      push(`- ${e.statement}${chips ? ` — ${chips}` : ''}`);
    }
    push('');
  }

  const cs = profile.class_structure;
  if (cs && (cs.cadence || (cs.topics?.length ?? 0) > 0 || cs.assessment)) {
    push('## Class structure');
    if (cs.cadence) push(`- Cadence: ${cs.cadence}`);
    if ((cs.topics?.length ?? 0) > 0) push(`- Topics: ${cs.topics!.join(', ')}`);
    if (cs.assessment) push(`- Assessment: ${cs.assessment}`);
    push('');
  }

  const projects = (profile.major_projects ?? []).filter(p => p.title);
  if (projects.length) {
    push('## Major projects');
    push('');
    for (const p of projects) { push(`- **${p.title}**${p.description ? ` — ${p.description}` : ''}`); }
    push('');
  }

  const emphasis = (profile.course_emphasis ?? []).filter(e => e.competency);
  if (emphasis.length) {
    push('## Course emphasis');
    push('What the course\'s graded work weights (independent of depth scoring).');
    push('');
    for (const e of emphasis) push(`- ${e.competency} — ${e.centrality} (${e.points} pts · ${e.share_pct}%)`);
    push('');
  }

  push('## Citations');
  push('');
  const cites = [
    ...(profile.verification_summary?.strongest_evidence ?? []),
    ...comps.map(c => c.evidence_d).filter((e): e is string => !!e),
  ];
  const seen = new Set<string>();
  for (const c of cites) { if (!seen.has(c)) { seen.add(c); push(`- ${c}`); } }
  push('');
  push(`_Source: immutable snapshot \`${snapshot.id}\`${resource ? ` · ${resource}` : ''} · captured ${ts.slice(0, 10)}._`);
  push('');
  push('---');
  push('_Depth scale (0–5): 0 not present · 1 exposure · 2 recognize · 3 recall/predict/perform independently · 4 use correctly/reason in novel cases/adapt · 5 fluent + edge cases. K=Know, U=Understand, D=Do._');

  return out.join('\n') + '\n';
}
```

(Confirm the competency/incoming field names against `lib/ai/capture/schema.ts` and adjust casts so `pnpm tsc --noEmit` passes; `deriveEvidenceBand`'s `EvidenceClaim` expects `{ source, citations }`.)

- [ ] **Step 4: Run, expect PASS + tsc** — test green; `pnpm tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add lib/okf/profile-to-okf.ts tests/lib/okf/profile-to-okf.test.ts
git commit -m "feat(okf): pure profileToOkfMarkdown serializer (OKF v0.1 course profile)"
```

---

### Task 2: Public served route `/view/[code]/okf`

**Files:**
- Create: `app/view/[code]/okf/route.ts`
- Test: `tests/app/view/okf-route.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/app/view/okf-route.test.ts
import { describe, it, expect, vi } from 'vitest';

const SNAP = { id: 'snap-1', createdAt: new Date('2026-06-14T00:00:00.000Z'), instructorName: 'Dr. X', profile: {
  course_code: 'GC 4800', scale_version: 'v1', generated_at: 'now',
  overview: { narrative: 'Cap.' }, competencies: [{ statement: 'Color', type: 'technical', k_depth: 3, u_depth: 3, d_depth: 4, evidence_d: 'e', source: 'materials' }],
  incoming_expectations: [], verification_summary: { course_shape: 's', strongest_evidence: ['x'], dimensional_patterns: [], catalog_vs_evidence: [] },
  audit_notes: {}, revised_objectives_draft: ['Outcome'], course_emphasis: null,
} };

vi.mock('@/lib/db/courses-queries', () => ({ getCourseByCode: async (code: string) => code === 'GC 4800' ? { code: 'GC 4800', title: 'Capstone', prefix: 'GC', level: 4, track: 'print', buildsToCareer: true, catalogUrl: null } : null }));
vi.mock('@/lib/db/capture-snapshots-queries', () => ({ getLatestSnapshotByCourse: async (code: string) => code === 'GC 4800' ? SNAP : null }));
// redactPiiDeep passthrough for the test:
vi.mock('@/lib/privacy/redact', () => ({ redactPiiDeep: (x: unknown) => x }));

import { GET } from '@/app/view/[code]/okf/route';

const ctx = (code: string) => ({ params: Promise.resolve({ code }) });

describe('GET /view/[code]/okf', () => {
  it('returns text/markdown attachment for a captured course', async () => {
    const res = await GET(new Request('http://host/view/GC%204800/okf'), ctx('GC%204800'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/markdown/);
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="gc-4800.md"/);
    const body = await res.text();
    expect(body).toMatch(/^type: course$/m);
    expect(body).toContain('## Apparent outcomes');
  });
  it('404s when no captured profile exists', async () => {
    const res = await GET(new Request('http://host/view/GC%209999/okf'), ctx('GC%209999'));
    expect(res.status).toBe(404);
  });
});
```
NOTE: confirm the real `redactPiiDeep` import path before writing the mock — grep `app/view/[code]/page.tsx` for it (`grep -n redactPiiDeep app/view/[code]/page.tsx`) and mock THAT path. Adjust the mock line accordingly.

- [ ] **Step 2: Run, expect FAIL**, then implement `app/view/[code]/okf/route.ts`:

```typescript
import { getCourseByCode } from '@/lib/db/courses-queries';
import { getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import { redactPiiDeep } from '@/lib/privacy/redact'; // <-- use the REAL path from page.tsx
import { profileToOkfMarkdown } from '@/lib/okf/profile-to-okf';

interface RouteContext { params: Promise<{ code: string }>; }

export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const { code: rawCode } = await params;
  const code = decodeURIComponent(rawCode);
  const course = await getCourseByCode(code);
  if (!course) return new Response(`No such course: ${code}`, { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const snapshot = await getLatestSnapshotByCourse(code);
  if (!snapshot) return new Response(`No captured profile for ${code}`, { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });

  const origin = new URL(req.url).origin;
  const md = profileToOkfMarkdown({
    course: { code: course.code, title: course.title, prefix: course.prefix, level: course.level, track: course.track, buildsToCareer: course.buildsToCareer, catalogUrl: course.catalogUrl },
    profile: redactPiiDeep(snapshot.profile),
    snapshot: { id: snapshot.id, createdAt: snapshot.createdAt, instructorName: snapshot.instructorName },
    viewUrl: `${origin}/view/${encodeURIComponent(code)}`,
  });
  const filename = `${code.toLowerCase().replace(/\s+/g, '-')}.md`;
  return new Response(md, {
    status: 200,
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });
}
```
(Match `redactPiiDeep`'s real import + confirm `course.prefix/level/track/buildsToCareer/catalogUrl` field names on the row; adjust if the Drizzle column camelCase differs.)

- [ ] **Step 3: Run, expect PASS + tsc** — test green; `pnpm tsc --noEmit` clean.

- [ ] **Step 4: Commit**

```bash
git add "app/view/[code]/okf/route.ts" tests/app/view/okf-route.test.ts
git commit -m "feat(okf): public /view/[code]/okf route — on-demand OKF markdown (redacted, attachment)"
```

---

### Task 3: "Download as Markdown" link on /view + STATE.md + suite

**Files:**
- Modify: `app/view/[code]/page.tsx` (header right-side actions, ~line 162, gated on `snapshot`)
- Modify: `docs/STATE.md`

- [ ] **Step 1: Add the link**

In `app/view/[code]/page.tsx`, in the header right-side `<div className="flex items-center gap-4">` (~line 162, where the "← Home" + edit links live), add — shown only when `snapshot` exists:
```tsx
            {snapshot && (
              <a
                href={`/view/${encodeURIComponent(code)}/okf`}
                download
                className="text-sm text-muted-foreground hover:text-foreground"
                title="Download this profile as a portable OKF Markdown file"
              >
                ↓ Markdown
              </a>
            )}
```

- [ ] **Step 2: Typecheck + full suite**

Run: `pnpm tsc --noEmit && pnpm test` (clean + green; report counts).

- [ ] **Step 3: Update STATE.md**

- Routes: add `GET /view/[code]/okf` (public; on-demand OKF-v0.1 markdown of the latest snapshot, PII-redacted).
- "What's live"/Active arc: one line — portable OKF course profiles shipped (deterministic `profileToOkfMarkdown` projection + public download on `/view`); DB remains source of truth; spec/plan links.
- Deferred/debt: update the OKF-align entry — per-course OKF export DONE; remaining: whole-curriculum **bundle zip** + a **capture-surface download** (reflects latest snapshot) + the broader wiki-frontmatter OKF-v0.1 alignment + `/wiki/graph` view (still deferred).

- [ ] **Step 4: Commit**

```bash
git add "app/view/[code]/page.tsx" docs/STATE.md
git commit -m "feat(okf): /view 'Download as Markdown' link; STATE.md (portable profiles shipped)"
```

---

## Plan self-review (done at write time)

- **Spec coverage:** serializer w/ full OKF v0.1 frontmatter + body + citations + null-guards + band markers + foundational K/U-omit (T1); public on-demand route reading latest snapshot, **PII-redacted like /view**, attachment, 404-when-none (T2); `/view` download link gated on captured branch + STATE (T3). DB-source-of-truth unchanged (asserted by absence — no schema/snapshot/matrix task). ✓
- **Placeholder scan:** every step has complete code; the two "confirm real `redactPiiDeep` path / row field names" notes are explicit verification steps. ✓
- **Type consistency:** `profileToOkfMarkdown(input)` signature identical in T1/T2; `deriveEvidenceBand({source,citations})` + `BAND_MARKER` usage matches the existing modules; `slugify` == `courseCodeToSlug` behavior. ✓
- **Privacy:** the public route applies the SAME `redactPiiDeep` `/view` uses — the download can't leak what the page redacts. ✓
- **Public-route correctness:** `/view/[code]/okf` is under the `/view` PUBLIC_PREFIX, so it's reachable without Basic Auth, matching the page. ✓
