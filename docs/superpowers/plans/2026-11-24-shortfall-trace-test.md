# Shortfall-trace test — setup plan

**Status:** proposed (owner asked for the plan 2026-11-24; nothing built).
**What it tests:** the open hypothesis added to `docs/background.html` §15 ("Tracing a shortfall back to its source"): start from a career target's required depth that the courses on a student's path do not reach, and find which course change would close it.
**Background:** `reports/Backpropagation for curriculum mapping.md` (literature: no prior work found; pitfalls) and `research_notes/Backpropagation for curriculum mapping/fable_evaluation.md` (fit with the data model; this plan follows its recommendations).

## Where the data stands (live counts, 2026-11-24, read-only)

| Input the test needs | Today |
|---|---|
| Required K/U/D depths per competency for a target | **0 of ~265 rows** have a depth (all five targets; every row `draft` except one) |
| Skill-tagged prerequisite edges with expected incoming depth | **0 rows** in `prerequisite_edges` |
| Catalog prerequisites (untagged course → course) | 93 edges |
| Captured GC courses (snapshot + coverage) | 21 of 37 |
| Competencies per target (membership) | 19–29 |
| Department curriculum plan with branches | none (two personal test plans) |

So the test cannot run on the live data as it is. The plan below supplies the missing inputs for **one target and a handful of competencies** in a worksheet, without writing to the live database.

## Decisions for the owner (defaults in brackets)

1. **Which target.** [Production & Operations: the chain GC 1040 → 2070 → 3460 → 4060/4400 is mostly captured and faculty know where color and production skills fall short.] Alternative: Brand Strategy.
2. **Required depths ahead of "links before weights."** STATE.md records the owner decision that required depths are not drafted until O*NET/ESCO links are confirmed. This test needs them for one target. [Treat the worksheet depths as test inputs only, never loaded into `career_target_requirements`; the deferral stands for the product.]
3. **Which faculty.** Two faculty who teach on the chosen path, for one hour each. [Owner names them.]
4. **Second scoring run.** Re-scoring the path's captured courses checks whether a one-level change is noise. That is paid AI under `AI_PROVIDER=openai`. [Skip in round 1; use the robustness check in step 4 instead. Ask separately with an estimate if round 1 is promising.]

## Steps

### 1. Pick the scope (Claude, ~30 min, no AI spend)
- From the target's membership, take the **6–8 competencies** the target leans on most (faculty-confirmed weights where they exist, else the program-map share) and where the path's courses have captures. Fewer competencies keep the faculty hour realistic.
- List the courses on the target's path: the GC core plus the target's courses, ordered by the catalog prerequisites. Mark each **captured / uncaptured** and give its depth on each chosen competency, labeled with its evidence basis.
- Output: a one-page scope sheet for the owner to approve.

### 2. Build the faculty worksheet (Claude)
A Google Sheet (or spreadsheet) with two tabs, prefilled so faculty correct rather than author:
- **Required depths:** one row per chosen competency, with K, U and D columns (D only for foundational competencies), entry horizon. Prefill blank; show the current best path depth beside it for reference.
- **Edges:** one row per (later course, earlier course, competency) along the path where the catalog says one is a prerequisite of the other, with columns for the expected incoming K/U/D and "this link is real: yes/no". Prefill expected depth blank.

### 3. Sealed predictions, then the faculty hour
- **Before seeing anything computed,** each of the two faculty writes, per chosen competency: does the target fall short (yes/no), and if yes, which course they would change first and second. Collected separately; not shared until step 5. This is what makes the comparison honest.
- Then the hour: fill the worksheet (required depths, expected incoming depths, confirm or reject each link). Disagreements between the two are recorded, not averaged.

### 4. The script (Claude; read-only; no AI calls)
`scripts/analysis/shortfall-trace.ts`, a pure function plus a thin loader, with unit tests on hand-built graphs.
- **Inputs:** live captured depths per course and competency (read-only), the worksheet (CSV export), catalog prerequisite order.
- **Forward model:** the builder's existing rules (`lib/builder/compute.ts`): exit depth per course, ordinal MAX along the path per K/U/D, null is "no reading", foundational competencies on D only, intended-only values marked and never closing a shortfall by themselves. One addition: the **gate**. A course whose students arrive n levels below an edge's expected depth delivers less than its profile shows, under three variants: (a) no effect, (b) one level less per level short, (c) delivers nothing above the incoming level. No retention decay in round 1 (owner ruling 2026-11-16); a second run with the builder's `durable()` is optional.
- **Backward step:** exact what-ifs, not gradients. Try every +1 level change to every (course, competency, dimension) on the path, recompute, and record which shortfalls close. Then list every **minimal set** of changes that closes each shortfall (no single winner).
- **Robustness:** rerun with every input score moved one level up or down, one at a time; a recommendation counts only if it survives at least two of the three gate variants and these one-level changes.
- **Credit view:** "what this target loses if the course is removed" beside the existing skill-share bars, not merged with them.
- **Output:** a short HTML or Markdown report per shortfall: the gap, the courses on its chain, the minimal fix sets, which hold up and which flip, and every value's evidence basis.

### 5. Compare and decide (owner + the two faculty, ~30 min)
Open the sealed predictions next to the report.

**Success (worth building into the tool):**
- the report's shortfalls largely match the ones faculty predicted;
- its leading fix holds across at least two gate variants and the one-level changes;
- the gate changes the answer at least once compared with plain "which course reaches the highest depth" (otherwise the chain adds nothing over the builder);
- faculty find at least one result they did not predict and judge plausible.

**Failure (stop or rethink):**
- recommendations flip under the gate variants or one-level changes;
- most shortfalls trace to uncaptured courses or to the courses whose scoring dropped most of their outcome statements (STATE.md);
- faculty cannot tell the output from what `/build` already shows.

Either way, record the result and the decision in STATE.md (Deferred / debt if it stops).

## Cost and time
- Claude: steps 1, 2 and 4, about a day of work; no paid AI; no live database writes (read-only queries and a worksheet).
- Faculty: two people × about 1.5 hours (predictions, worksheet, comparison).
- Owner: approve the scope sheet and name the faculty.

## Not in this round
Loading worksheet values into the live tables, a UI, electives/branches (no department plan defines them yet), multiple targets, retention decay as a default, and any integer-program optimization (needs a cost per change, which faculty would have to supply).
