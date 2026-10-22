# Project → skill → competency → O*NET trail — design

Status: **approved by the owner (2026-10-22).** Purpose (owner): **explaining the model** — a readable trail on the public wiki showing how a concrete course project connects to careers through the catalog and O*NET. Read-only; no faculty editing in this version.

## 1. What already exists, and what is missing

| Link | Today | Source |
|---|---|---|
| Project → course skill | Captured, not shown as a link | `CaptureProfile.major_projects[].competencies` (statements the project develops) |
| Course skill → catalog competency | Decided by coverage scoring, stored as text | `snapshot_competency_coverage.matched_competency` (the course statement the scorer matched) |
| Course skill → O*NET items | Not done | — (bundles were built from the O*NET side, for importance weights) |

Measured on live, latest snapshot per course (2026-10-22): 18 of 21 courses have projects (76 projects); all 225 project → statement links and all 319 matched coverage cells equal a course statement **exactly** (case- and space-normalized). So the first two links are an exact join; nothing new is judged about what a course develops — that stays the coverage scorer's decision.

## 2. Data

- **Links 1 and 2** are computed when a page is built, by exact join on the normalized statement text (`lower(trim(...))`), from the course's latest non-retired snapshot. No new table.
- **Link 3** uses embeddings:
  - Each course statement is embedded once with the campus embedding endpoint (the same model `scripts/catalog/embed-items.ts` uses) and stored in `item_embeddings` with `kind = 'course_skill'`, `ref` = the normalized statement text's hash, and the usual `text_hash`; an unchanged statement is never re-embedded. The kind is already allowed (migration 0059/0061); no migration.
  - At page-build time, for each (statement, matched competency): the **3 nearest bundle items** of that competency by cosine similarity, among `bundle_members` with status `confirmed` or `proposed` and position `core` or `related` (never `fringe` or `rejected`), each via its existing `onet_element` / `onet_task` embedding (tasks through the same text-group key `embed-items` uses).
  - Items below a similarity floor are dropped ("no close O*NET item"). The floor starts at **0.5** and is fixed during the build from a printed sample of real pairs, recorded in the plan's ledger.
  - A `proposed` item is labeled **provisional**; a `confirmed` one is not.
- A course statement the scorer matched to no competency is listed as **"not yet linked to a catalog competency"**, so nothing silently drops out.

## 3. Running it

- `scripts/catalog/embed-items.ts` gains the `course_skill` kind (dry run default, `--apply`, `--expect-db`), covering every latest snapshot's statements. Run once as a backfill.
- Before a course page's wiki substrate is built, missing statement embeddings for that snapshot are created (best effort). If the campus endpoint fails, the page is written without the O*NET line; capture and wiki generation never fail because of it.
- No AI calls besides the free campus embeddings and the existing wiki page writing.

## 4. What readers see

- **Wiki course page** — new section **"How the projects connect"**, after Signature projects. Per project, one line per skill:
  *Skill (course statement) → [[competency|Catalog competency]] (K/U/D from the coverage cell) → closest O*NET: "item", "item" (provisional where proposed)*.
  Unlinked skills appear under the project as "not yet linked to a catalog competency". The section is omitted when the course has no projects.
- **Wiki competency page** — new section **"Where students build this"**: the course projects whose skills feed this competency (course, project, skill), and which of the competency's O*NET items those skills land closest to.
- Both sections are written by the existing wiki writer from new substrate fields (`projectTrail` on the course substrate, `buildingProjects` on the competency substrate), with prompt rules in `lib/ai/prompts/wiki-update.md`, and appear on the next refresh of those pages. A one-time `refresh-all` run after deploy brings every page up to date (owner decision at that time; about 30 AI calls).

## 5. Testing

- Joins: project → statement → competency on realistic profile/cell shapes, including case/space differences and an unmatched statement.
- Nearest items stay inside the matched competency; fringe and rejected members are excluded; the floor drops weak pairs; proposed items carry the provisional flag.
- Embedding: an unchanged statement is not re-embedded; an endpoint failure leaves the substrate without O*NET items and does not throw.
- Substrates carry `projectTrail` / `buildingProjects`; the prompt sections render (wiki prompt tests).
- Red-proof each regression test.

## 6. Not in this version

Faculty confirming or correcting links; AI-written explanations per link; the program gap analysis (O*NET items no project builds) — the stored embeddings make it a later read-only addition.
