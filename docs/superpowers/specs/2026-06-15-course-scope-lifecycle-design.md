# Course Scope & Lifecycle Model — Design

**Status:** Design spec (brainstormed + approved 2026-06-15). Foundation sub-project of a three-part arc; see "Relationship to sibling sub-projects."
**Goal:** Give every course two orthogonal classifiers — *owning scope* and *lifecycle status* — and route every program rollup through one inclusion predicate, so non-GC, proposed, and external/sandbox courses can exist in the system without leaking into the GC program record. The first end-to-end consumer is **external-university testers** (capture + OKF export, fully isolated from GC).

---

## 1. Why

Today `courses` is a single flat GC roster: it carries `category` (gc_core / specialty / major_req / other) and a `builds_to_career` boolean the matrix filters on, but **no notion of which program owns a course, nor whether it's real/offered**. Every rollup (`listCoursesWithStatus`, `program-coverage-queries`, the wiki compile, scaffolding, prereq-gap, `/view`) reads all courses/snapshots. That blocks three growth cases the operator has surfaced:

- **External-university testers** — let an outsider capture *their* course, review, approve, and export OKF, without it ever entering our public list or program rollups.
- **Hypothetical / proposed courses** — "test the waters" on a course we're considering, without counting it as delivered.
- **Other majors / departments** — eventually each program rolls up only its own courses.

`category` answers "what curricular role within GC"; these answer "does it belong to our program at all" and "is it real." Those are **orthogonal axes**, so they get their own columns rather than overloading `category`.

---

## 2. The model

Two new columns on `courses`, independent of the existing `category` / `builds_to_career`:

- **`scope`** — `course_scope` enum, initial values `gc | external`. Default `gc`. (When a real second campus program arrives, `scope` is replaced by/upgraded to a `programs` FK; the enum is the YAGNI stand-in until then.)
- **`status`** — `course_status` enum: `offered | proposed | sandbox | retired`. Default `offered`.

Use-cases map cleanly:

| Use-case | scope | status |
|---|---|---|
| Normal GC course (today) | `gc` | `offered` |
| Proposed / "test the waters" GC course | `gc` | `proposed` |
| External-university test course | `external` | `sandbox` |
| Decommissioned course | `gc` | `retired` |

**Migration:** additive (add two enums + two columns with defaults). Backfill every existing course → `scope='gc', status='offered'`. Zero behavior change on existing data. Snapshots **derive** scope/status via their `course_code` join — no new column on `course_capture_snapshots`.

---

## 3. The inclusion predicate (the leakage guard)

The single most important element. One source of truth, used everywhere:

```
isProgramVisible(course)  ⇔  course.scope = 'gc' AND course.status = 'offered'
```

Implemented as a pure TS helper over a course row **and** an equivalent SQL fragment (`c.scope = 'gc' AND c.status = 'offered'`) for query-level filters, kept in one module so they can't drift. Thin sibling predicates: `isSandbox(c) ⇔ scope='external' AND status='sandbox'`; `isProposed(c) ⇔ status='proposed'`.

**Rollup audit (spec deliverable — every consumer must route through the predicate or explicitly handle the non-visible case):**

| Consumer | File(s) | Change |
|---|---|---|
| Public course list (`/`) | `lib/db/capture-status-queries.ts` (`listCoursesWithStatus`) | filter to `isProgramVisible` for the public list; sandbox/proposed surface only in the segregated faculty sections (§5) |
| Program coverage matrix | `lib/db/program-coverage-queries.ts` (`WHERE s.retired_at IS NULL AND c.builds_to_career = true`) | add `AND c.scope='gc' AND c.status='offered'` |
| Wiki compile | `lib/ai/wiki/update.ts` (snapshot selection) | exclude non-`isProgramVisible` snapshots from regeneration |
| Scaffolding analysis | `lib/db/scaffolding-queries.ts` | predicate on the course set |
| Prerequisite-gap | prereq-gap engine + edge queries | predicate on focal/prereq course sets |
| `/view/[code]` (+ `/okf`) | `app/view/[code]/*` | gate non-`isProgramVisible` (see §4 access) |
| `/ask` + MCP graph tools | `lib/ai/wiki/graph-tools.ts` | predicate on coverage/prereq reads |

Each consumer gets a leakage test (§6). This audit is exhaustive by construction: any query that reads `courses` or `course_capture_snapshots` for a program view is in scope.

---

## 4. External-tester access (first end-to-end consumer)

**Operator flow (faculty UI, Basic-Auth):** "Add external test course" creates a `courses` row (`scope='external'`, `status='sandbox'`, operator-entered code + title) and **mints a scoped magic-link token**, reusing the existing partner-session pattern (`lib/partners/sessions.ts` + the middleware `/partners/*` cookie mint). The token is bound to that single `course_code`, is **revocable and expirable**, and is the only thing the operator hands the external tester.

**Scoped session (middleware):** the token mints a session cookie that authorizes **only**:
- `/capture/<that-code>` and its capture APIs (`/api/courses/<that-code>/*`, `/api/capture/<that-code>/*`),
- `/view/<that-code>` and `/view/<that-code>/okf`.

Every other path (other courses, the roster, admin) 403s for a scoped session. The capture flow itself (materials → interview → generate → review → approve → snapshot → OKF export) runs unchanged; approval writes a sandbox-flagged snapshot that the §3 predicate excludes everywhere.

**Visibility:** `/view/<sandbox>` and `/okf` are gated — reachable only by (a) the matching scoped session or (b) an operator Basic-Auth session. Never public (the public `/view` path check consults `isProgramVisible`; non-visible courses require a matching scoped/operator session). This keeps an outside party's content entirely off our public surface.

**Content path:** external scope **disables the Canvas-API-token import** (it's tied to our institution's Canvas). The tester brings content via file upload (existing Docling path) and — once **sub-project 2 (IMSCC import)** lands — a Common Cartridge upload. Per the sequencing decision, external testing ships **with** IMSCC.

---

## 5. Roster / surfacing

- **Public `/`** — `isProgramVisible` only (GC + offered). Unchanged for the existing roster.
- **Faculty/admin roster** — gains two segregated sections below the GC roster: **"External / sandbox"** and **"Proposed"**, each with a status badge. This is the "external course list under a rollup" the operator asked for. Sandbox/proposed courses never appear in the public list or any program rollup.
- Status is shown as a small badge (reuse the existing roster `StatusPill` styling vocabulary).

---

## 6. Testing

- **Unit:** `isProgramVisible` / `isSandbox` / `isProposed` truth table over the `(scope × status)` matrix.
- **Leakage tests (one per rollup in the §3 table):** seed a `gc/offered` course + snapshot and an `external/sandbox` course + snapshot; assert the GC one is **included** and the sandbox one is **excluded** from each rollup's output. Mirror for a `gc/proposed` course (excluded from delivered rollups). These are the anti-leakage guarantee.
- **Access tests:** a scoped session reaches only its bound course's capture + `/view`/`/okf`; 403s elsewhere. Public `/view` of a sandbox course 403s without a matching session.

---

## 7. Out of scope / deferred

- **True multi-program ownership** (a `programs` table, per-program rollups for other majors) — deferred until a real second campus program exists; `scope` enum is the forward-compatible placeholder.
- **Hypothetical-course what-if modeling** (model a `proposed` course's effect on coverage via `course_explore_what_ifs`) — the `proposed` status is introduced here so it's expressible, but the what-if *modeling* is a follow-up.
- **Self-serve external sign-up** — only operator-minted scoped links in this design.

---

## 8. Relationship to sibling sub-projects

External-university testing — the first consumer — depends on all three:

1. **This spec — Course scope & lifecycle model** (isolate it).
2. **IMSCC import** (sub-project 2): a new ingestion route parallel to `canvas-import`; upload a Common Cartridge → parse → same `course_materials` rows → existing pipeline. The external content path; ships *with* this for external testing to be usable.
3. **Self-contained OKF bundle export** (sub-project 3): normalize each material to a canonical `.md` at digestion (distinct from the AI digest), then export a zip of `profile.md` (OKF) + materials `.md` + `transcript.md`. The external tester's take-away, and it doubles as the deferred **self-contained-snapshot durability** (faithful reprocessing) and subsumes the **whole-curriculum OKF bundle** item in STATE.md Deferred/debt.

Each gets its own spec → plan. This one is the foundation the other two build on.
