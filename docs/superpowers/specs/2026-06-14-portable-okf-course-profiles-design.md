# Portable OKF Course Profiles — Design

**Date:** 2026-06-14
**Status:** approved design (operator brainstorm 2026-06-14), pre-plan
**Origin:** Operator wants course profiles to be **easily portable**. The driver for the long-deferred OKF-alignment item. After weighing OKF-as-storage vs OKF-as-projection, the operator chose **Model B**: Postgres stays the source of truth (immutable snapshots + the relational coverage/matrix/evidence-discipline engine); a complete OKF-v0.1 markdown representation of each course profile is produced **deterministically, on demand** from the latest snapshot — so it is portable, self-contained, openable cold by any person/tool/agent, and **always current by construction** (computed each request, never a stored stale copy).

## Decisions made in the brainstorm (2026-06-14)

1. **Model B — DB source of truth + on-demand OKF projection.** Rejected OKF-as-the-actual-storage: the matrix, reliability tripwire, prereq-gap engine, per-instructor immutable snapshot identity (UUIDs, `retired_at`, `reconciliation_log`), and the structured evidence-discipline validation are relational/quantitative and cannot live in markdown (OKF is a prose format, not a metrics layer — the same conclusion as the earlier OKF analysis and the band-floor "don't scrape prose" lesson).
2. **Always-current by construction.** The OKF markdown is computed from the latest snapshot on each request — no stored file, no sync/commit step, no drift.
3. **Full OKF v0.1 fidelity.** Frontmatter `type`/`title`/`description`/`tags`/`timestamp`/`resource` + the full profile content + a `# Citations` section.
4. **Delivery: on-demand download + served URL.** A "Download as Markdown" button + a clean `.md` URL per course on the public `/view/<code>` surface. A whole-curriculum bundle zip is a **fast follow**, not this increment.
5. **Per-course first.** This increment = the serializer + the served route + the `/view` download button. (Capture-surface download + the bundle zip are follow-ons.)

## Component 1 — pure serializer `lib/okf/profile-to-okf.ts`

```
profileToOkfMarkdown(input: {
  course: { code: string; title: string; prefix?: string; level?: number|null; track?: string|null; buildsToCareer?: boolean; catalogUrl?: string|null };
  profile: CaptureProfile;
  snapshot: { id: string; createdAt: Date|string; instructorName: string|null };
  viewUrl?: string;   // absolute /view URL for the `resource` field, when known
}): string
```
Pure, no I/O, no AI. Emits OKF-v0.1 markdown:

**Frontmatter (YAML):**
```yaml
type: course
title: "GC 4800 — <course title>"
description: <overview essence / course_shape, one line>
slug: <course-slug>
tags: [<prefix>, level-<n>, <track>, builds-to-career?]   # only the non-empty ones
timestamp: <snapshot createdAt ISO>
resource: <viewUrl or catalogUrl, when present>
instructor: <instructorName or "Department canonical">
snapshot_id: <uuid>
scale_version: <profile.scale_version>
```
**Body** (mirrors `/view`'s content, as markdown — skip any null/empty section):
- `# <code> — <title>` + the overview narrative.
- `## Apparent outcomes` — `revised_objectives_draft` list.
- `## Competencies developed` — each: statement + `K{k} U{u} D{d}` (omit K/U for foundational) + the evidence-band marker (`·claimed`/`·materials`/`·artifact`, from `deriveEvidenceBand(source, citations)` via the existing `BAND_MARKER`) + the evidence excerpt.
- `## Incoming expectations` — each: statement + `K/U/D` from `expected_depth`.
- `## Class structure` — cadence, topics, assessment.
- `## Major projects` — title + description each.
- `## Course emphasis` — competency + centrality + `{points} pts · {share_pct}%`.
- `## Citations` — the distinct evidence excerpts/sources backing the above + a provenance line linking the immutable snapshot id and the `/view` URL.
- A trailing depth-scale legend line (so the file is self-explanatory cold).

Reuses `deriveEvidenceBand` + `BAND_MARKER` from the existing modules; otherwise self-contained. Null/empty guards on every section (legacy/partial profiles degrade gracefully).

## Component 2 — served route (public) `app/view/[code]/okf/route.ts`

- `GET` route handler. Public: it lives under `/view` (already a `PUBLIC_PREFIXES` entry → middleware skips Basic Auth), matching the public read-only `/view/<code>` page.
- Loads the course (`getCourseByCode`) + the latest non-retired snapshot (`getLatestSnapshotByCourse`). If no snapshot → 404 (`text/plain` "No captured profile for <code>").
- Calls `profileToOkfMarkdown(...)` with the snapshot's `profile`, `id`, `createdAt`, `instructorName`, and a `viewUrl` built from the request origin.
- Returns the markdown with `Content-Type: text/markdown; charset=utf-8` and `Content-Disposition: attachment; filename="<slug>.md"`. A tool/agent that just `GET`s it (ignoring the disposition) gets the current OKF file.

## Component 3 — `/view` download affordance

- On `app/view/[code]/page.tsx` (or in `CapturedView`'s header), add a **"Download as Markdown"** link to `/view/<code>/okf` (only shown when a captured profile exists — i.e. the `CapturedView` branch, not the catalog-fallback branch). A plain `<a download>` to the route.

## What is explicitly UNCHANGED
- Postgres remains the source of truth: the profile schema, immutable snapshots, `snapshot_target_coverage`, the matrix / reliability / prereq engine, evidence-discipline validation — all untouched.
- The `gc-curriculum-wiki` agent-narrative layer is separate and untouched (this is a distinct deterministic per-course projection, not the wiki).
- `/view` page rendering (Piece 1) is unchanged; we only add a download link.
- Auth model: the export is public exactly because `/view` is public; no new gate.

## Out of scope (deferred / fast-follow / non-goals)
- **Whole-curriculum bundle zip** (all captured courses' `.md` + an `index.md`) — the fast follow; reuses the serializer.
- **Capture-surface download** (a button on the review panel) — easy follow-on; note it would reflect the latest *snapshot*, not the in-progress draft.
- **Standing git-versioned OKF files** (writing `profiles/<slug>.md` into a repo on snapshot) — explicitly not chosen; on-demand generation is the agreed realization of "always current."
- **OKF-as-storage** (markdown as source of truth) — rejected (Model A).
- Writing OKF back to the Google Sheet; competency/target/concept OKF pages (those are the wiki layer's job).

## Testing
- **Pure `profileToOkfMarkdown` (the priority):** valid OKF frontmatter (every section's presence/absence is null-guarded); competency lines carry K/U/D + the correct band marker (`deriveEvidenceBand` → `·claimed`/`·materials`/`·artifact`); foundational competency omits K/U; incoming shows depths; apparent outcomes / class structure / major projects / course emphasis render when present and are omitted when null; a `# Citations` section with the snapshot-id provenance line; depth-scale legend present. Parse the emitted frontmatter back and assert `type: course` + required keys.
- **Route:** 200 `text/markdown` + `Content-Disposition: attachment` for a course with a snapshot; 404 when none; public (no auth needed). (Use the temp-dir/DB or a mocked snapshot-query pattern as the sibling route tests do.)
- **`/view` page:** the download link is present in the captured branch, absent in the catalog-fallback branch.
