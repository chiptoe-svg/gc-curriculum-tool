# OKF Bundle Export (single course) — Design

**Date:** 2026-06-15
**Status:** approved design (operator brainstorm 2026-06-15), pre-plan
**Origin:** Sub-project 3 of the external-university-testing arc (after (1) course scope & lifecycle — shipped, (2) IMSCC import — shipped). The external tester's **take-away**: a self-contained `.zip` of one captured course — its OKF profile, every material as markdown, and the interview transcript — openable cold by any person or tool/agent. This is the narrowed realization of the "whole-curriculum OKF bundle zip" that the [portable-OKF-course-profiles](./2026-06-14-portable-okf-course-profiles-design.md) and [capture-surface-OKF-download](./2026-06-14-capture-surface-okf-download-design.md) specs explicitly deferred as a fast-follow.

## Context — OKF already exists here

"OKF" = the project's **Open Knowledge Format**: YAML-frontmatter markdown (required keys `type, title, description, slug, tags, timestamp, resource`) with a structured body, used as the substrate of the `gc-curriculum-wiki`. The per-course profile projection is **already shipped**:

- `lib/okf/profile-to-okf.ts` → `profileToOkfMarkdown()` — a captured profile → full OKF-v0.1 markdown.
- `GET /view/[code]/okf` — serves it on demand, scope-gated (`isProgramVisible`) + PII-redacted (`redactPiiDeep`), always-current-by-construction.
- Frontmatter helpers in `lib/ai/wiki/okf-frontmatter.ts` (`okfBase`, `stampOkfFrontmatter`, `okfResource`, `deriveTags`).

This spec **reuses** all of the above. The only genuinely new code is two small pure serializers (materials, transcript), the zip assembler, the bundle route, and one UI link.

## Decisions made in the brainstorm (2026-06-15)

1. **Unit = a single captured course.** Not whole-curriculum (still deferred).
2. **The whole bundle is human-readable + tool-openable** — every file is OKF markdown. (It "didn't need" to be human-readable, but making each file OKF makes it so, which is the point of OKF.)
3. **Light OKF frontmatter on every file** — `profile.md` is full OKF-v0.1 (reused serializer); `transcript.md` and each `materials/<name>.md` get minimal OKF frontmatter (`type`, `title`, `description`, `slug`, `tags`, `timestamp`, `resource`) over a plain-markdown body (the canonical extracted text / interview turns). Bundle is uniformly OKF.
4. **An `index.md` manifest** (OKF `type: bundle`) sits at the zip root — a self-describing entry point listing the course, snapshot id/timestamp, instructor, and every file in the zip.
5. **Delivery: a scoped `.zip` route + a capture-surface button.** `GET /view/[code]/okf-bundle` (sibling of `/okf`, same scope gate + PII redaction); plus a "↓ Bundle (.zip)" link on the capture review surface next to the existing "↓ Markdown".
6. **Sources of truth** (consistent with the existing OKF projection): `profile.md` + `transcript.md` come from the **latest non-retired snapshot** (immutable, citable — `transcript.md` uses the snapshot's `transcriptSessionId`); `materials/*` come from current `course_materials`. 404 when no snapshot exists, exactly like `/okf`.
7. **Zip writer = `yazl`** (new dep) — the natural companion to the `yauzl` reader already added for IMSCC; tiny, streaming. Bundle is assembled in-memory (all entries are text; even a large course's extracted text is modest).

## Components

| File | New/Changed | Responsibility |
|---|---|---|
| `lib/okf/material-to-okf.ts` | **new (pure)** | `materialToOkfMarkdown(material) → string` — one material's extracted text + light OKF frontmatter (`type: material`, title = fileName, `ignored: true` when set-aside). |
| `lib/okf/transcript-to-okf.ts` | **new (pure)** | `transcriptToOkfMarkdown(messages, meta) → string` — the interview turns + light OKF frontmatter (`type: transcript`). |
| `lib/okf/bundle.ts` | **new** | `buildOkfBundle(input) → Promise<Buffer>` — assembles the file list (`index.md`, `profile.md`, `transcript.md`, `materials/*.md`) and zips via `yazl`. Builds `index.md` itself. Pure-ish (takes already-loaded data; no DB/AI). |
| `app/view/[code]/okf-bundle/route.ts` | **new (thin)** | `GET` — loads course (gate via `isProgramVisible`, opaque 404), latest snapshot (404 if none), session messages, materials; redacts; calls `buildOkfBundle`; returns `application/zip` + `Content-Disposition`. |
| `app/capture/[code]/ProfileReviewPanel.tsx` | **changed** | "↓ Bundle (.zip)" link to `/view/[code]/okf-bundle`, beside the existing "↓ Markdown", same `hasSnapshot` gate. |
| `package.json` | **changed** | add `yazl` (+ `@types/yazl` dev). |

## Bundle layout

```
<slug>-okf-bundle.zip
├── index.md            # OKF type: bundle — manifest (course, snapshot id+ts, instructor, file list)
├── profile.md          # OKF type: course — profileToOkfMarkdown(latest snapshot), PII-redacted
├── transcript.md       # OKF type: transcript — interview turns (snapshot.transcriptSessionId), PII-redacted
└── materials/
    ├── <safe-name-1>.md  # OKF type: material — frontmatter + course_materials.extractedText
    └── <safe-name-2>.md
```

- **`profile.md`** — `profileToOkfMarkdown({ course, profile: redactPiiDeep(snapshot.profile), snapshot, viewUrl })`, identical inputs to the `/okf` route.
- **`transcript.md`** — `getSessionMessages(code, snapshot.transcriptSessionId)` → user + assistant turns rendered as `**Faculty:** …` / `**Auditor:** …` markdown; `system`/`tool` turns skipped. `redactPiiDeep` applied to text. If `transcriptSessionId` is null (pre-0027 snapshot) → a one-line "transcript not linked for this snapshot" body, still a valid OKF file.
- **`materials/*`** — `listMaterialsByCourse(code)`, one file per material with non-empty `extractedText`; `safeFilename(fileName)` for the entry name (collisions disambiguated with a numeric suffix); `ignored: true` in frontmatter for set-aside rows (included anyway — the bundle is the full archive, not the interview-feed). Materials with no extracted text are listed in `index.md` as "not extracted" but produce no file.
- **`index.md`** — frontmatter `type: bundle`; body lists course code/title, snapshot id + ISO timestamp, instructor, generated-at, and a bulleted inventory of every file with its `type` and title. The depth-scale legend line so the bundle is self-explanatory cold.

## Scope, auth, PII

- **Route lives under `/view`** → already in `PUBLIC_PREFIXES`, so middleware skips Basic Auth, matching `/okf`. **Same scope gate**: `isProgramVisible(course)` → opaque 404 for non-gc/non-offered (a sandbox course's bundle is reachable only via the scoped link added in sub-project 4, identical to `/okf`'s posture).
- **PII**: `redactPiiDeep` on the profile (as `/okf` does) **and** on the transcript text (the transcript is the highest-PII surface — faculty names, etc.). Materials are course content (already the same exposure as the live capture surfaces); no extra redaction beyond what extraction stored.
- The capture-surface link points at the same public/scoped route (matching the shipped "↓ Markdown" pattern — exports the last saved snapshot, not the in-progress draft).

## What is explicitly UNCHANGED

- Postgres remains source of truth; snapshots, matrix, coverage engine, evidence discipline — untouched.
- `profileToOkfMarkdown`, the `/okf` route, the `/view` + capture "↓ Markdown" links — reused as-is, untouched.
- `redactPiiDeep`, `getLatestSnapshotByCourse`, `getSessionMessages`, `listMaterialsByCourse`, `isProgramVisible` — reused; **no new DB queries**.
- The wiki layer and its OKF frontmatter alignment — separate, untouched.

## Out of scope / deferred / non-goals

- **Whole-curriculum multi-course bundle** (all captured courses + a root `index.md`) — still deferred; this serializer + assembler make it a later fast-follow.
- **Re-import of a bundle** back into the tool — not a goal (IMSCC is the import path).
- **The external-access scoped magic link** that makes a sandbox course's `/view`+`/okf`+`/okf-bundle` reachable to a tester — sub-project 4, its own spec.
- **In-progress draft / in-memory working-state export** — rejected for the same reason as the capture-surface `/okf` link (the snapshot is the citable record).
- **Pixel-faithful material rendering** — materials are Docling's extracted text; rough tables/spacing are accepted ("doesn't need to be pretty").

## Testing

- **`material-to-okf` (pure):** valid OKF frontmatter (required keys present, `type: material`, title = fileName); body = the extracted text; `ignored: true` rendered for set-aside; parse frontmatter back and assert keys.
- **`transcript-to-okf` (pure):** user/assistant turns rendered, system/tool skipped; `type: transcript` frontmatter; null-session degrades to the placeholder body; PII redaction is applied by the route (asserted there).
- **`bundle.ts`:** `buildOkfBundle(fixture)` → read the resulting Buffer back **with `yauzl`** and assert the entry set (`index.md`, `profile.md`, `transcript.md`, `materials/<name>.md` per input), that `index.md` lists every file, and that a material with empty text yields no file but appears in the manifest.
- **Route:** 200 `application/zip` + `Content-Disposition: attachment; filename="<slug>-okf-bundle.zip"` for a course with a snapshot; 404 when no snapshot; opaque 404 for a non-`isProgramVisible` course (scope gate); transcript text is PII-redacted (assert a seeded name is absent from the zip's `transcript.md`).
- **`ProfileReviewPanel` (RTL):** with `hasSnapshot={true}` a "↓ Bundle (.zip)" link is present with `href` ending `/view/<encoded-code>/okf-bundle`; absent when no snapshot.
- **Full suite** stays green (`pnpm test`); `tsc` clean.

## Relationship to the arc

Sub-project 3 of 4. (1) scope & lifecycle — shipped. (2) IMSCC import — shipped. **(3) this — self-contained OKF bundle (content out + durability).** (4) external-access scoped link — ties it together so a tester can reach their sandbox course's `/view`+`/okf`+`/okf-bundle`. The bundle also stands alone: any faculty member can export a captured course as a portable OKF archive.
