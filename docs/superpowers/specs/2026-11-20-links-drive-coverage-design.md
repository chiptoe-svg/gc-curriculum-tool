# Links drive coverage (skills-and-links phase 2), with the scorer's level as the default

**Status:** approach chosen by the owner 2026-11-19 ("A"); this design awaits the owner's approval. Supersedes the
roll-up default of [2026-11-15-skill-competency-links-design.md](./2026-11-15-skill-competency-links-design.md)
("absent = the highest linked skill") and builds its phase 2 ("Phase 2 rebuilds it from links and roll-ups").

## Why

The /program matrix, what-ifs, prerequisite gaps and the wiki read `snapshot_competency_coverage`, the coverage
scorer's output. The skill links (`skill_competency_links`, 736, all proposed) feed only the builder (/build).
So a faculty decision on a link (confirm, reject, regroup, set a level) never reaches /program. The owner expected
it to.

Two gaps make phase 2 unsafe to switch on as designed:

1. **Nothing makes links after the one-off seed (2026-11-15).** The seed and faculty edits in /build are the only
   writers. A new capture, or a new competency, would have no links and would go blank. Professional readiness
   (scored 2026-11-19 on Terra) has only 41 embedding suggestions, which don't count: its 8 above-zero cells
   would vanish.
2. **"Highest linked skill" inflates the matrix.** On the 380 course/competency pairs with counting links, the
   linked skill's own level is higher than the scorer's in 262, equal in 117, lower in 1, and D is 2+ higher in
   132 (live data, 2026-11-19). The skill level is how deeply the course teaches its own skill; the cell is how
   much of the catalog competency that covers. Example: GC 3620 "Adobe production workflows and basic
   print/digital file specifications" is K3/D3 as a skill; the scorer gives Color management K1/D0 ("color-space
   selection does not establish profiling, calibration…"). /build already shows the inflated levels wherever
   links exist.

## Approaches (owner chose A)

- **A. The scorer's level is the default; links decide whether it counts.** Day one the matrix doesn't move;
  /build drops to the scorer's levels; faculty decisions then flow everywhere. *Chosen.*
- B. Keep "highest linked skill". About a third of the matrix rises 2+ levels on day one, reading partial
  coverage as full (against the evidence rule).
- C. No phase 2: keep the matrix on scores, only add auto-links and fix /build. Faculty link decisions never
  reach /program.

## The rule

For a course version (snapshot) and a competency, in order:

1. a **faculty** level set in /build (`competency_rollups`, method `faculty`);
2. an **AI** level (`competency_rollups`, method `ai`; the AI roll-up call is not in this phase);
3. the **scorer's** cell, when at least one link to that competency counts (method shown as `scoring`);
4. **needs a level**: links count but there is no level from 1–3 (e.g. a faculty-confirmed suggestion on a
   competency the scorer put at 0). Treated as 0 in the matrix and every reader, and marked so faculty can set it;
5. otherwise **0 / not present**, including when faculty rejected every link (marked "rejected by faculty").

"Counts" is unchanged from 2026-11-15: confirmed, or proposed by a judgment (scoring, AI, faculty); an embedding
match alone is a suggestion. Foundational competencies keep K and U null.

Day-one result: every current cell keeps its value (each above-zero cell gets a scoring link; zeros have none),
so the matrix, what-ifs and wiki are unchanged until someone edits a link.

## Parts

1. **One definition of the level: a database view `competency_levels`** (migration 0072) over coverage, links and
   roll-ups, with the scorer's evidence, rationale and confidence passed through plus `method` and the roll-up
   rationale. Readers that show or compute levels switch from the table to the view: the matrix
   (`program-coverage-queries`, `/api/program/coverage`), what-ifs (`neighbor-helpers`, `knock-on`), prerequisite
   gaps, sufficiency, problem-solving, project trail, live captures, the wiki (`update`, `graph-tools`,
   `provenance`) and the builder (`library`, whose pure `rollUp` follows the same rule for its panel). The table
   stays the scorer's record: stale detection, scoring and course reset keep using it.
2. **Auto-links on every score.** `upsertCoverageCell` (the only writer: the /program button and the
   per-target refresh route) adds a proposed `scoring` link when the cell is above 0 and its `matched_competency`
   is one of the snapshot's skill statements, if that link isn't there. It never changes or removes an existing
   link or a faculty decision. Shared with the seed script so both match statements the same way.
3. **Backfill once:** the seed's scoring part on live (no model calls), adding the 8 professional-readiness links.
4. **/build shows the rule's method** beside each level (faculty / AI / scorer / needs a level) and a "needs a
   level" control where it applies.

## Not in this phase

- The AI roll-up call (paid; per-run estimate and owner yes first). Until then a "needs a level" cell is set by
  hand in /build.
- The AI link judge for the 356 embedding suggestions (deferred 2026-11-15 until a few dozen faculty decisions
  exist to calibrate it).
- Rebuilding the wiki when a faculty edit changes a level. The matrix and what-ifs update at once (they read the
  view); wiki pages catch up on the next one-pass rebuild. Recorded as debt.

## Checks

- Before/after on live data: every reader's levels identical on day one (matrix cell-by-cell diff = 0 changes).
- /build: the 262 inflated pairs fall to the scorer's levels (intended; listed for the owner).
- Unit tests for the rule's five cases, foundational nulls, rejected-only links, and auto-link idempotence (never
  touching a faculty decision); red-proofed.
- Live order: backup → migration 0072 + backfill (owner go-ahead) → deploy → diff → STATE.
