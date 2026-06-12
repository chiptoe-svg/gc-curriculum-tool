# Faculty Flag Mechanism — Design

**Date:** 2026-06-12
**Status:** approved design, pre-plan
**Origin:** Action item **A1(b)** of the [vision-alignment review](../audits/2026-06-12-vision-alignment-review.md). The executive brief's first trust commitment ("Every AI reading is disputable. A 'Flag' button… Flags persist; they are not silently overwritten on the next re-score") is currently dead code — the `FlagDialog` → `ReasoningExpand` → `TargetChainResults` chain is mounted nowhere and `/api/flag` was deleted 2026-06-03. The operator chose to **build the minimal mechanism** rather than reword the claim.

## Goal

A faculty member can flag any AI reading — a program-matrix cell or a review-panel competency — with a note. Flags persist across re-scores and re-captures, stay open until a named person explicitly resolves them with a note, and are visible both on the flagged item and in a roll-up on `/program`. The executive brief's trust bullet becomes true (minus the prompts-update loop, whose sentence is removed).

## Decisions (made with the operator, 2026-06-12)

1. **Lifecycle:** open until explicitly resolved. Resolution carries name + required note + date. Resolved flags remain in history. Nothing auto-clears.
2. **Surfacing:** indicator on the flagged cell/row **plus** a "⚑ N open" roll-up panel on `/program`.
3. **Identity:** roster dropdown (`lib/faculty.ts`, same pattern as CourseCapture's session-start chooser), remembered in `localStorage`.
4. **Data model:** one polymorphic table keyed by stable identifiers (approach 1 below).

## Why the keying matters (the load-bearing constraint)

Matrix cells (`snapshot_target_coverage`) are **upsert-overwritten** on re-score and **deleted** on sub-competency descriptor change (`invalidateCoverageForSubCompetency`); re-captures mint new snapshot IDs and the matrix is newest-snapshot-wins (`getMatrixData`, `DISTINCT ON (course_code)`). Any flag keyed to a snapshot or cell row dies with it. Therefore:

- **Coverage-cell flags** key on `(course_code, career_target_id, sub_competency_id)` — stable across re-scores and re-captures by construction.
- **Profile-competency flags** key on `(course_code, competency_statement)` — resurfaces on exact statement match in later profiles; always visible in the roll-up regardless of match.

## Approaches considered

1. **One `faculty_flags` table, polymorphic stable key** — chosen. One API, one query path, one list UI.
2. Two tables (one per flag kind) — cleaner per-kind FK constraints, but duplicates every layer for identical behavior. Rejected (YAGNI).
3. Reuse the M-trial `prototype_flags` table — exists, but M-trial-shaped; bending it muddies provenance. Rejected; `prototype_flags` may be dropped in a later sweep.

## Schema (migration `0034`)

New table `faculty_flags` in `lib/db/schema.ts`:

| column | type | notes |
| --- | --- | --- |
| `id` | uuid PK default random | |
| `target_kind` | text enum `coverage_cell` \| `profile_competency` | pgEnum `flag_target_kind` |
| `course_code` | text NOT NULL | both kinds |
| `career_target_id` | text nullable | cell flags only |
| `sub_competency_id` | text nullable | cell flags only |
| `competency_statement` | text nullable | profile flags only |
| `note` | text NOT NULL | what's disputed (required, non-empty) |
| `flagged_by` | text NOT NULL | roster name |
| `flagged_context` | jsonb nullable | the reading *as disputed*, frozen at flag time: `{k,u,d, matchedCompetency?, rationale?}` for cells; `{k,u,d, statement, source?}` for competencies |
| `status` | text enum `open` \| `resolved`, default `open` | pgEnum `flag_status` |
| `resolved_by` | text nullable | |
| `resolved_at` | timestamp nullable | |
| `resolution_note` | text nullable | required at resolve time (route-enforced) |
| `created_at` | timestamp default now | |

Consistency rule (route-enforced, mirrors the codebase's Zod-over-CHECK convention): `coverage_cell` rows must have `career_target_id` + `sub_competency_id` and null `competency_statement`; `profile_competency` rows the inverse. Multiple open flags per target are allowed — markers show a count.

Migration `0034` is additive and immediately appliable (the held-migration blocker lapsed when `0033` carried `0032` in).

## Pure logic — `lib/program/flags.ts`

All unit-testable, no DB:

- ~~`flagKeyForCell` / `flagKeyForCompetency` — canonical match keys.~~ **Resolved in implementation review (2026-06-12): dropped.** Nothing consumes string keys — the `openFlagsFor*` filters ARE the canonical matchers, and shipping unused exports would recreate the dead-code pattern this feature exists to fix (A3).
- `openFlagsForCell(flags, courseCode, targetId, subCompetencyId)` and `openFlagsForStatement(flags, courseCode, statement)` — exact-match filters the UIs use for markers/counts.
- `flagDrift(flaggedContext, currentCell)` → `null | {dim: 'k'|'u'|'d', was: number|null, now: number|null}[]` — the "score changed since flagged: was D=4 → now D=2" comparison, computed at read time. Null context or missing current cell → `null` (annotated "(no longer in matrix)" / "(context not recorded)").

## Queries — `lib/db/flag-queries.ts`

`createFlag(input)`, `listFlags({status?})`, `resolveFlag(id, {resolvedBy, resolutionNote})` (sets status/by/at; rejects an already-resolved id with a clean error), `listOpenFlagCounts()` (grouped counts for markers — one query feeding both matrix and review panel).

## API — three faculty-tier routes

All behind middleware Basic Auth; slug validated via `isValidSlug` like neighboring faculty routes (slug in body for POST/PATCH, query for GET):

- `POST /api/flags` — create. Zod-validates the kind/field consistency rule + non-empty `note` + `flaggedBy`.
- `GET /api/flags?status=open&slug=…` — list, joined at read time against current matrix cells to attach `drift` and `stillInMatrix`.
- `PATCH /api/flags/[id]` — resolve. Requires non-empty `resolutionNote` + `resolvedBy`; 409 on already-resolved.

## UI

- **`components/FlagDialog.tsx` — resurrected, extended.** Already generic (`onSubmit(note)`, `context`). Gains a "Flagging as" roster `<select>` (from `lib/faculty.ts`, default from `localStorage['gc-flagger-name']`, persisted on submit). The placeholder text drops its stale "gets used to tune prompts" parenthetical.
- **Matrix (`app/program/ProgramCoverageClient.tsx`):** the cell-detail view gains "⚑ Flag this reading" → FlagDialog → POST with `flagged_context` frozen from the cell being viewed. Cells with open flags render a small ⚑ marker (count if >1) from `listOpenFlagCounts` data passed via the page loader.
- **Review panel (`app/capture/[code]/ProfileReviewPanel.tsx`):** per-competency "⚑" action → same dialog (`target_kind: 'profile_competency'`, statement + current depths frozen as context). Open-flag marker on exact statement match.
- **Flags panel (`app/program/` new `FlagsPanel.tsx`):** "⚑ N open" affordance in the `/program` header (hidden at N=0, still reachable via a quiet "flag history" link). Panel lists flags grouped course → target → sub-competency: note, flagger, date, drift line, "(no longer in matrix)" annotation when applicable, and inline resolve (name dropdown + required note). Filter: open / resolved / all.
- **Dead-chain sweep (A3, same increment):** delete `components/ReasoningExpand.tsx`, `components/PrerequisiteGapPanel.tsx`, `components/CoverageHeatMap.tsx`, `components/TargetChainResults.tsx`, and `insertPrototypeFlag`/`listFlags` from `lib/db/queries.ts` (the `prototype_flags` *table* stays; dropping it is a separate migration decision). `FlagDialog.tsx` is the one survivor, now actually mounted.

## Error handling

- POST/PATCH failures surface inline in the dialog/panel (existing pattern: small amber text), never silently swallowed.
- A flag whose target leaves the matrix (course unflagged from `builds_to_career`, sub-competency retired) stays listed, annotated — never hidden, never auto-resolved.
- Concurrent resolve: second PATCH gets 409 and the panel refreshes.

## Docs updated in the same increment (the actual A1)

- **`docs/executive-brief.html`** trust bullet rewritten to describe this mechanism: flag button on matrix cells and review-panel competencies; flags persist across re-scores; score changes on flagged cells are shown, never silent; resolution is explicit and recorded. The **"patterns of flagged disagreement update the prompts" sentence is removed** (that loop remains unbuilt; we do not re-promise it).
- **Vision doc** (`gc-curriculum-tool-vision.md` + `.html`): same correction where the flag/dispute trail is described.
- A2 (faculty-guide per-instructor matrix claim) is **not** bundled — separate item, separate fix.

## Testing

- Unit: `flags.ts` pure helpers (key matching incl. statement edge cases, drift computation incl. null context / missing cell).
- Queries: create/list/resolve round-trip, double-resolve rejection, consistency-rule violations rejected.
- Routes: auth gating, Zod rejections, 409 path (per the repo's route-test conventions).
- Components: FlagDialog roster select + persistence; marker rendering from counts; FlagsPanel resolve flow (testing-library).

## Out of scope (YAGNI, recorded)

Prompt-updating feedback loop (sentence removed from brief instead); flag→GitHub-issue bridging; notifications; per-user auth; fuzzy statement matching across re-captures (exact match only — unmatched profile flags still appear in the roll-up, which is the safety net); dropping `prototype_flags`.
