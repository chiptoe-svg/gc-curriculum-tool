# Course Overview + Landing Page Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a faculty-facing, LLM-drafted, editable Course Overview at the top of every Course Outcome Profile (narrative + at-a-glance bullets + who-it's-for + semester arc), redesign the Review panel so the profile reads like a published document rather than an admin form, and add a `/courses` landing page that lists every course with its capture status and the right CTA.

**Architecture:** Three concentric changes, schema → prompt → UI. (1) `CaptureProfile.overview` becomes a new nullable section in `captureProfileSchema` and the strict-mode JSON schemas in `lib/ai/analyze/capture-scores.ts` (both v1 + v2 variants). (2) `capture-scores.md` is extended to instruct the LLM to draft the overview as part of synthesis. (3) A new `<CourseOverview>` component owns the editable document-style front matter; `ProfileReviewPanel` mounts it at top. A new `/courses` route loads all courses with a computed status (`'not-started' | 'in-audit' | 'ai-drafted' | 'reviewed' | 'captured'`) via a single `listCoursesWithStatus()` helper. The "Capture this profile" button is a rename + visual promotion of the existing "Confirm and snapshot" action — same semantics (immutable snapshot), clearer label.

**Aesthetic direction (from frontend-design skill):** editorial / archival document. Variable serif (Fraunces) for display + narrative; humanist sans (DM Sans) for UI/body; IBM Plex Mono for course codes and structured data; restrained motion (staggered entrance + subtle hover); generous typographic measure on prose. Fonts load via `next/font/google` at the root layout as CSS variables, scoped to the new surfaces via Tailwind utility classes — existing surfaces untouched.

**Tech:** Next.js 15 App Router, Drizzle, React 19, Tailwind, next/font (Google), shadcn primitives, Vitest. No new tables, no migration; just one new optional JSON sub-tree on `course_capture_profiles.profile` and `course_capture_snapshots.profile`.

---

## File structure

- **Modify:** `lib/ai/capture/schema.ts` — `courseOverviewSchema` Zod + add nullable `overview` to `captureProfileSchema`
- **Modify:** `lib/ai/analyze/capture-scores.ts` — extend strict-mode JSON schema (v1 + v2) with `overview` object (matching Zod)
- **Modify:** `lib/ai/prompts/capture-scores.md` — instructions for drafting overview at synthesis time
- **Modify:** `app/layout.tsx` — load Fraunces + DM Sans + IBM Plex Mono via `next/font/google`; expose as CSS variables on `<html>`
- **Modify:** `tailwind.config.ts` (or equivalent) — add `font-display`, `font-body-serif`, `font-mono-plex` utilities bound to those variables (don't replace existing `font-sans` defaults)
- **Create:** `app/capture/[code]/CourseOverview.tsx` — editable document-style component
- **Modify:** `app/capture/[code]/ProfileReviewPanel.tsx` — mount `<CourseOverview>` at top; rename snapshot CTA to "Capture this profile"
- **Create:** `lib/db/capture-status-queries.ts` — `getCaptureStatus(code)` + `listCoursesWithStatus()`
- **Create:** `app/courses/page.tsx` + `app/courses/CoursesIndex.tsx` — landing page
- **Modify:** `docs/STATE.md` — new route, schema field, overview substrate

---

## Task 1: Schema + prompt + JSON schema for `overview`

**Files:** `lib/ai/capture/schema.ts`, `lib/ai/analyze/capture-scores.ts`, `lib/ai/prompts/capture-scores.md`.

- [ ] **Step 1: Add `courseOverviewSchema` to Zod**

In `lib/ai/capture/schema.ts`, before `captureProfileSchema`:

```typescript
export const courseOverviewSchema = z.object({
  /** 2-3 paragraphs, conversational. "In this course, students…" voice. */
  narrative: z.string().min(40),
  /** 3-7 single-line bullets capturing course character (pedagogy, format, distinctive choices). */
  at_a_glance: z.array(z.string().min(3)).min(3).max(7),
  /** 1-line target student description. "Designed for juniors heading into the brand-strategy track." */
  who_for: z.string().min(10),
  /** 1-2 sentence semester trajectory. "Students start by X, then Y, finally Z." */
  arc: z.string().min(20),
  source: CaptureProfileSource.optional(),
  citations: z.array(CaptureProfileCitation).optional(),
});
export type CaptureCourseOverview = z.infer<typeof courseOverviewSchema>;
```

Then add to `captureProfileSchema` (line ~151):

```typescript
export const captureProfileSchema = z.object({
  course_code: z.string().min(1),
  scale_version: z.literal(captureScaleVersion),
  generated_at: z.string(),
  // Nullable for backward compat: snapshots taken before 2026-05-31 won't have it.
  // V2 captures always populate it; v1 captures get null and the Review panel
  // shows a "this is a legacy snapshot — re-audit to add an overview" hint.
  overview: courseOverviewSchema.nullable().optional(),
  competencies: z.array(captureCompetencySchema).min(1),
  // ... rest unchanged
});
```

- [ ] **Step 2: Extend the strict-mode JSON schema in `capture-scores.ts`**

In `lib/ai/analyze/capture-scores.ts` (line ~47 for `captureProfileJsonSchema`), add an `overview` property in `properties` and add it to `required`. Per the CLAUDE.md operational-notes pattern for OpenAI strict mode, optional fields must be nullable union types, every property in `properties` must appear in `required`:

```typescript
overview: {
  type: ['object', 'null'],
  additionalProperties: false,
  required: ['narrative', 'at_a_glance', 'who_for', 'arc', 'source', 'citations'],
  properties: {
    narrative: { type: 'string', minLength: 40 },
    at_a_glance: { type: 'array', items: { type: 'string', minLength: 3 }, minItems: 3, maxItems: 7 },
    who_for: { type: 'string', minLength: 10 },
    arc: { type: 'string', minLength: 20 },
    source: { type: ['string', 'null'], enum: ['instructor', 'materials', 'inferred', null] },
    citations: CITATIONS_ARRAY_NULLABLE, // see existing pattern; ensure null-safe
  },
},
```

Add `'overview'` to the top-level `required` array.

The v2 schema (line ~281, `captureProfileJsonSchemaV2`) clones from v1 — confirm the deep clone carries `overview` through, no patches needed there unless v2 derives differently.

- [ ] **Step 3: Update the prompt**

In `lib/ai/prompts/capture-scores.md`, add a new section before the existing `verification_summary` block instructing the LLM:

```markdown
## Course overview (draft for faculty review)

After scoring competencies and incoming expectations, draft a faculty-facing **overview** of the course that reads like a published catalog entry — not an audit report. Faculty will review and edit this; your draft is their starting point.

Produce:

- **`narrative`** — 2–3 short paragraphs, conversational. Start with what the course IS (not what it audits). Example voice: *"In this course, students take a brand identity from initial research through final client presentation. The first half is strategy and research; the second half is execution and critique. Heavily project-based — no exams."*
- **`at_a_glance`** — 3–7 single-line bullets capturing what makes the course distinctive (format, pedagogy, distinctive choices): *"One real client per semester, not case studies"*, *"Weekly critique format; minimal lecture"*, *"Heavy reliance on Adobe CC workflows"*. Avoid restating learning objectives — these are character notes.
- **`who_for`** — one sentence on the target student. *"Designed for juniors who've completed GC 3460 and are heading into the brand-strategy track."*
- **`arc`** — 1–2 sentence semester trajectory. *"Students begin with audience research and competitor analysis, build a strategic brief by midterm, then execute identity systems through final client critique."*
- **`source`** — derived mechanically per the same rules as other sections (`instructor` when grounded in the transcript, `materials` when grounded in extracted text, `inferred` when synthesized).
- **`citations`** — link to the chunks or instructor turns that ground the descriptive claims, when they exist.

**Voice discipline:** the overview is editorial, not audit-flavored. Avoid words like *"the course audits show…"*, *"evidence indicates…"*, K/U/D numbers, or matrix language. The faculty member is going to publish this — make it sound like something they'd be proud to have under their name. Make every sentence earn its place.

If you genuinely don't have enough signal to draft a defensible overview (skimpy materials AND skimpy transcript), emit `overview: null` rather than make things up.
```

Also add `overview` to the JSON-shape example near the top of the prompt (after `course_code` / `scale_version` / `generated_at`).

- [ ] **Step 4: Tests + type-check + commit**

Run: `pnpm test lib/ai/capture` (if Zod schema tests exist) and `pnpm tsc --noEmit` — clean.

```bash
git add lib/ai/capture/schema.ts lib/ai/analyze/capture-scores.ts lib/ai/prompts/capture-scores.md
git commit -m "feat(capture): CaptureProfile.overview — LLM-drafted course front matter

New optional overview section (narrative + at_a_glance + who_for + arc),
nullable for backward compat with pre-2026-05-31 snapshots. Prompt
extended to instruct editorial-voice drafting; strict-mode JSON schemas
(v1 + v2) updated per the CLAUDE.md operational-notes pattern."
```

---

## Task 2: Font loading (cross-cutting, restrained scope)

**Files:** `app/layout.tsx`, `tailwind.config.ts`.

Goal: make Fraunces + DM Sans + IBM Plex Mono available as CSS variables WITHOUT changing the default font on existing surfaces.

- [ ] **Step 1: Load fonts in root layout**

In `app/layout.tsx`, replace the imports + body className:

```typescript
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Fraunces, DM_Sans, IBM_Plex_Mono } from 'next/font/google';
import { FeedbackWidget } from './FeedbackWidget';
import './globals.css';

const serif = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
});
const sans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-mono-plex',
  weight: ['400', '500'],
  display: 'swap',
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
        <Suspense fallback={null}>
          <FeedbackWidget />
        </Suspense>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Add Tailwind utilities (don't replace defaults)**

In `tailwind.config.ts`, extend `theme.fontFamily`:

```typescript
fontFamily: {
  display: ['var(--font-display)', 'serif'],
  'body-serif': ['var(--font-display)', 'serif'],   // alias for prose passages
  'body-sans': ['var(--font-body)', 'sans-serif'],
  'mono-plex': ['var(--font-mono-plex)', 'monospace'],
}
```

(Or if `tailwind.config.ts` doesn't exist and the project uses Tailwind v4's CSS-first config, add equivalent `@theme` block to `app/globals.css`.)

- [ ] **Step 3: Smoke**

Run `pnpm build`. Confirm the fonts download and bundle without errors.

- [ ] **Step 4: Commit**

```bash
git add app/layout.tsx tailwind.config.ts
git commit -m "chore(ui): load Fraunces + DM Sans + IBM Plex Mono via next/font

Scoped utility classes (font-display / font-body-serif / font-body-sans /
font-mono-plex) for new editorial surfaces. Default body font on existing
surfaces unchanged."
```

---

## Task 3: `<CourseOverview>` component + restructured `ProfileReviewPanel`

**Files:** `app/capture/[code]/CourseOverview.tsx` (new), `app/capture/[code]/ProfileReviewPanel.tsx` (modify).

This is the load-bearing UX work. Use the frontend-design skill conventions: editorial document feel, restrained motion, generous typographic measure, small-caps marginalia, etched-in feel.

- [ ] **Step 1: Write `<CourseOverview>`**

Create `app/capture/[code]/CourseOverview.tsx`. Props:

```typescript
interface Props {
  courseCode: string;
  courseTitle: string;
  overview: CaptureCourseOverview | null;
  onOverviewChange: (next: CaptureCourseOverview) => void;
  /** When false, render read-only (used when displaying an older snapshot or before edit mode). */
  editable: boolean;
}
```

Layout (top-to-bottom):

1. **Title block.** Course code in IBM Plex Mono, small, all caps, letter-spacing wide. Course title below in Fraunces 600 weight at ~3rem on desktop, ~2rem on mobile. A thin horizontal rule below in a warm neutral (~1px, 60% opacity).

2. **Narrative.** Fraunces 400, ~1.125rem, line-height 1.7, max-width 65ch, justified text-align. Multiple paragraphs flow naturally. In edit mode, the whole narrative becomes a contenteditable region (or a textarea styled to match — simpler) that preserves typography. Drop-cap on first letter (CSS `::first-letter`) for a refined editorial touch.

3. **At-a-glance bullets.** A small-caps label *"At a glance"* in DM Sans 600 with letter-spacing. Bullets below as `<li>` styled with em-dash leaders instead of dots: `list-none` + `before:content-['—_']`. Each bullet in DM Sans, 0.95rem. In edit mode, each bullet is its own input; "+" button at end adds a new bullet; backspace on empty deletes.

4. **Two-column sidebar block.** Below the at-a-glance, a 2-col grid (1-col on mobile):
   - Left column: small-caps label *"Who it's for"* + the `who_for` text in Fraunces italic
   - Right column: small-caps label *"The arc"* + the `arc` text in Fraunces italic
   Both editable in place.

5. **Source badge.** Bottom-right of the overview block, the existing `SourceBadge` reused (teal/amber/gray pill) showing provenance. Click → existing CitationDrawer.

6. **Edit affordances.** Sections show a subtle hover state (background fill `bg-muted/40`) hinting they're editable. Click → enters edit mode. Blur → triggers `onOverviewChange`. No save button per-section; the parent's existing "Save edits" / "Capture this profile" buttons cover persistence.

Implementation hints:
- Use `font-display` for the title + narrative + sidebar prose.
- Use `font-body-sans` for the at-a-glance bullets and small-caps labels.
- Use `font-mono-plex` for the course code.
- For staggered entrance on first render, use Tailwind's `animate-in fade-in slide-in-from-bottom-1` with `animation-delay-*` (or a small CSS keyframe with `nth-child` delays).
- Drop-cap CSS: `[&_p:first-of-type]:first-letter:text-7xl [&_p:first-of-type]:first-letter:font-serif [&_p:first-of-type]:first-letter:float-left [&_p:first-of-type]:first-letter:leading-[0.85] [&_p:first-of-type]:first-letter:mr-3 [&_p:first-of-type]:first-letter:mt-1`.

When `overview === null`, render a placeholder card: *"No overview drafted yet. Re-audit this course to generate one — or write one from scratch."* with a "Write one" button that initializes an empty overview and enters edit mode.

- [ ] **Step 2: Mount in `ProfileReviewPanel`**

In `app/capture/[code]/ProfileReviewPanel.tsx`:
- Import `<CourseOverview>`.
- Render it at the TOP of the panel JSX (before `<header>` with telemetry, before legacy banner).
- Pass `overview={working.overview ?? null}` and `onOverviewChange={(next) => setWorking({ ...working, overview: next })}`.
- The panel will need `courseTitle` — add it as a prop (passed down from `CaptureClient` which already knows the course).
- `editable={true}` since this IS the review/edit surface.

- [ ] **Step 3: Rename + promote "Confirm and snapshot"**

In `ProfileReviewPanel.tsx`, find the existing "Confirm and snapshot" button. Rename to **"Capture this profile"**. Restyle as the primary visual call-to-action — larger, with a more decisive treatment (e.g., `bg-foreground text-background` for high contrast). The "Save edits" button stays as the secondary action.

Update the snapshot modal too: header "Confirm and snapshot" → "Capture this profile", and the explainer copy: *"This creates a permanent, dated record of the current draft. The draft stays editable; new edits create a new captured version when you capture again."*

- [ ] **Step 4: Thread `courseTitle` down**

In `CaptureClient.tsx`, pass `courseTitle={course.title}` to `<ProfileReviewPanel>`. Update the panel's `Props`.

- [ ] **Step 5: Type-check + verify in browser**

Run `pnpm tsc --noEmit` — clean. Run `pnpm build && launchctl kickstart -k gui/$(id -u)/com.gc.curriculum-tool`. Open `/capture/GC 4800?slug=…`:
- Pre-2026-05-31 snapshot → overview placeholder card.
- Take a fresh audit + capture → confirm the LLM-drafted overview appears.
- Click sections → edit, save, persists.

- [ ] **Step 6: Commit**

```bash
git add app/capture/[code]/CourseOverview.tsx app/capture/[code]/ProfileReviewPanel.tsx app/capture/[code]/CaptureClient.tsx
git commit -m "feat(capture): editable document-style CourseOverview + 'Capture this profile' CTA"
```

---

## Task 4: Status helper + `/courses` landing page

**Files:** `lib/db/capture-status-queries.ts` (new), `app/courses/page.tsx` (new), `app/courses/CoursesIndex.tsx` (new).

- [ ] **Step 1: Status helper**

Create `lib/db/capture-status-queries.ts`:

```typescript
import { eq, and, isNull, desc } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courses, courseCaptureProfiles, courseCaptureSnapshots, captureMessages } from '@/lib/db/schema';

export type CaptureStatus = 'not-started' | 'in-audit' | 'ai-drafted' | 'reviewed' | 'captured';

export interface CourseStatusRow {
  code: string;
  title: string;
  level: number | null;
  status: CaptureStatus;
  lastCapturedAt: Date | null;       // most-recent non-retired snapshot createdAt
  lastEditedAt: Date | null;         // capture_profiles.updatedAt
  hasActiveSession: boolean;         // any capture_messages within last 24h
}

/**
 * Compute capture status for every course in the catalog. Single query
 * per table (no per-course loops). Used by the /courses landing page.
 */
export async function listCoursesWithStatus(): Promise<CourseStatusRow[]> {
  const [courseRows, profileRows, snapshotRows, recentMessages] = await Promise.all([
    db.select().from(courses),
    db.select().from(courseCaptureProfiles),
    db
      .select()
      .from(courseCaptureSnapshots)
      .where(isNull(courseCaptureSnapshots.retiredAt))
      .orderBy(desc(courseCaptureSnapshots.createdAt)),
    db
      .select({ courseCode: captureMessages.courseCode, createdAt: captureMessages.createdAt })
      .from(captureMessages)
      .orderBy(desc(captureMessages.createdAt))
      .limit(500), // cap; for status purposes we only need most-recent per course
  ]);

  const profileByCode = new Map(profileRows.map(p => [p.courseCode, p]));
  const latestSnapshotByCode = new Map<string, typeof snapshotRows[number]>();
  for (const s of snapshotRows) {
    if (!latestSnapshotByCode.has(s.courseCode)) latestSnapshotByCode.set(s.courseCode, s);
  }
  const recentSessionByCode = new Map<string, Date>();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  for (const m of recentMessages) {
    if (m.createdAt > oneDayAgo && !recentSessionByCode.has(m.courseCode)) {
      recentSessionByCode.set(m.courseCode, m.createdAt);
    }
  }

  return courseRows.map(c => {
    const profile = profileByCode.get(c.code);
    const snapshot = latestSnapshotByCode.get(c.code);
    const hasActiveSession = recentSessionByCode.has(c.code);

    let status: CaptureStatus;
    if (snapshot) {
      status = 'captured';
    } else if (profile?.reviewerStatus === 'edited' || profile?.reviewerStatus === 'confirmed') {
      status = 'reviewed';
    } else if (profile?.reviewerStatus === 'ai_drafted') {
      status = 'ai-drafted';
    } else if (hasActiveSession) {
      status = 'in-audit';
    } else {
      status = 'not-started';
    }

    return {
      code: c.code,
      title: c.title,
      level: c.level ?? null,
      status,
      lastCapturedAt: snapshot?.createdAt ?? null,
      lastEditedAt: profile?.updatedAt ?? null,
      hasActiveSession,
    };
  });
}
```

- [ ] **Step 2: Landing page (server)**

Create `app/courses/page.tsx`:

```typescript
import Link from 'next/link';
import { isValidSlug } from '@/lib/slug';
import { listCoursesWithStatus } from '@/lib/db/capture-status-queries';
import { CoursesIndex } from './CoursesIndex';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ slug?: string }>;
}

export default async function CoursesPage({ searchParams }: Props) {
  const { slug = '' } = await searchParams;
  if (!isValidSlug(slug)) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">Access link required</h1>
        <p className="mt-3 text-muted-foreground">Open this page through the access link your administrator shared.</p>
      </div>
    );
  }
  const rows = await listCoursesWithStatus();
  // Sort by level then code.
  rows.sort((a, b) => (a.level ?? 9999) - (b.level ?? 9999) || a.code.localeCompare(b.code));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-baseline justify-between gap-4 px-6 py-4">
          <div>
            <p className="font-mono-plex text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Catalog · GC</p>
            <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight">Courses</h1>
          </div>
          <div className="flex items-center gap-4">
            <Link href={`/program?slug=${encodeURIComponent(slug)}`} className="text-sm text-muted-foreground hover:text-foreground">Coverage matrix →</Link>
            <Link href={`/?slug=${encodeURIComponent(slug)}`} className="text-sm text-muted-foreground hover:text-foreground">Hub</Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <CoursesIndex rows={rows} slug={slug} />
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Landing page (client — typeset index)**

Create `app/courses/CoursesIndex.tsx`. Design conventions:
- Header counters: small-caps labels with the 5 status counts (`N captured · N reviewed · N drafted · N in audit · N not started`).
- Table layout: each row is a course. Columns: code (mono, ~9ch) · title (serif display, flexible) · level chip · status pill · last captured (date, mono small) · → arrow.
- Row hover: subtle `bg-muted/40` fill + slight x-translate on the arrow (`translate-x-0.5 transition-transform`).
- Status pill colors: `captured` = emerald, `reviewed` = teal, `ai-drafted` = amber, `in-audit` = blue, `not-started` = stone. Use the existing Tailwind palette; don't invent.
- The row is the full clickable target — wraps in `<Link href={`/capture/${encodeURIComponent(row.code)}?slug=…`}>` — no separate buttons.
- Group rows by level with subtle level dividers (e.g. *"1000-level"*, *"2000-level"* small-caps labels inset on the left margin).
- Restrained entrance animation: staggered fade-in on first load with ~30ms per row delay using `animation-delay-*` or CSS keyframes.

The component is read-only (no edit interactions in this iteration).

Pseudocode signature:

```typescript
'use client';
import Link from 'next/link';
import type { CourseStatusRow, CaptureStatus } from '@/lib/db/capture-status-queries';

interface Props { rows: CourseStatusRow[]; slug: string; }

export function CoursesIndex({ rows, slug }: Props) {
  // group by level
  // render summary header with status counts
  // render grouped table
}
```

Implementer should produce 150-250 lines depending on how much polish is layered on.

- [ ] **Step 4: Header link from `/program` and home**

Add a "Courses →" link to the program-page header (next to "Scaffolding view →") and to the home page if there's a hub-style navigation block.

- [ ] **Step 5: Type-check + smoke**

`pnpm tsc --noEmit` clean. `pnpm build && launchctl kickstart -k gui/$(id -u)/com.gc.curriculum-tool`. Open `/courses?slug=…` — confirm all courses render with correct statuses; click a row → lands on `/capture/[code]`.

- [ ] **Step 6: Commit**

```bash
git add lib/db/capture-status-queries.ts app/courses/page.tsx app/courses/CoursesIndex.tsx app/program/page.tsx
git commit -m "feat(courses): /courses landing page — typeset index with per-course capture status"
```

---

## Task 5: STATE update

**File:** Modify `docs/STATE.md`.

- [ ] **Step 1: Add the new route + schema delta**

Under "What's live → faculty surfaces", insert after `/program/scaffolding`:

```markdown
| `/courses` | **Course catalog (Phase 2 trial-readiness)** — typeset index of every catalog course with computed capture status (`not-started / in-audit / ai-drafted / reviewed / captured`), last-captured date, and click-through to `/capture/[code]`. Editorial design language (Fraunces serif display + DM Sans + IBM Plex Mono via `next/font`). | live | 2026-05-31 |
```

Under "Active arc" (after Phase 1B Stage 1), add:

```markdown
**Course overview + editorial profile shipped 2026-05-31**: `CaptureProfile.overview` (nullable: `narrative` + `at_a_glance` bullets + `who_for` + `arc`) drafted by the LLM at synthesis time; surfaced as the front matter of the Review panel via `<CourseOverview>` — document-style typography (Fraunces narrative, em-dash bullets, small-caps marginalia, drop-cap), editable in place, persisted via the existing scores POST. "Confirm and snapshot" renamed to **"Capture this profile"** for clarity (semantics unchanged — still creates the immutable snapshot). New `/courses` route is the canonical entry point to all courses with their current capture status.
```

Update the Wiki-readiness substrate section to add `CaptureProfile.overview` as an additional captured surface.

Bump `Last verified:` to the SHA of the next commit.

- [ ] **Step 2: Commit**

```bash
git add docs/STATE.md
git commit -m "docs(state): /courses landing + CaptureProfile.overview + 'Capture this profile' rename"
```

---

## Verification (post-execute, manual)

1. **Schema** — query an existing snapshot: `SELECT profile -> 'overview' FROM course_capture_snapshots LIMIT 5;` — expect `null` for pre-today snapshots (backward-compat works).
2. **New audit + capture** — run an audit on GC 4800 (or any v2 course), confirm the LLM-drafted overview appears in the Review panel; edit a section, save, take a snapshot; confirm the snapshot's `profile.overview` is populated.
3. **Landing page** — `/courses?slug=…` renders all courses; statuses match expectation (GC 4800 = `captured`; others likely `not-started`); clicking GC 4800 → `/capture/GC 4800`; clicking a `not-started` row → same with empty draft.
4. **Capture CTA copy** — Review panel shows "Capture this profile" (not "Confirm and snapshot") in both the inline button and the snapshot-modal header.
5. **Fonts** — visually confirm Fraunces appears in the overview title + narrative, DM Sans elsewhere on the courses index, IBM Plex Mono on course codes. No FOIT/FOUT visible in dev mode.

---

## Self-Review

**Coverage:** schema (T1), prompt (T1), JSON schema strict-mode (T1), font loading (T2), overview component (T3), restructured panel + CTA rename (T3), status helper (T4), landing page (T4), STATE (T5). ✅

**Out of this scope (deliberately deferred):**
- A read-only "view a snapshot as a polished document" route (e.g. `/courses/[code]/snapshots/[id]`). The overview is currently only surfaced in the Review panel; surfacing it in a standalone snapshot-viewer is a separate small task.
- Re-generating the overview on demand for legacy snapshots that don't have one. Currently the placeholder card invites a re-audit; a "draft an overview now without a full re-audit" feature is a deferred polish.
- Faculty notification when their course's status changes (e.g., "GC 4800 was just captured"). Deferred.
- Cross-section consistency lint ("the overview narrative claims 'no exams' but the verification_summary's catalog_vs_evidence mentions a midterm exam"). Deferred to a future linter, Karpathy-wiki-pattern style.

**Tradeoffs noted:**
- Loading three Google fonts adds ~50–80 kB to the first-load (next/font subsetting helps but is not zero). For an internal trial tool this is fine; if it ever needs to scale to slow networks, switch to local @font-face files.
- The drop-cap CSS in T3 step 1 is a stylistic flourish that may render slightly differently across browsers. Acceptable for the trial.
- `listCoursesWithStatus()` does 4 queries unconditionally — fine at department scale (~30 courses, ~200 capture_messages). If the catalog grows beyond a few hundred courses, batch differently or paginate.

---

## Execution Handoff

Plan complete. Saved to `docs/superpowers/plans/2026-05-31-course-overview-and-landing-page.md`.

Recommended execution: **subagent-driven-development**. T3 in particular is design-heavy and benefits from focused subagent attention. T1, T2, T4, T5 are mechanical and quick.
