# Alumni Destinations → Curriculum Integration Seam — Design (2026-06-27)

**Status:** PROPOSAL — not approved, not building. Cross-repo design for review (it commits work in
both `gc_alumni` and this repo, and depends on faculty/student decisions in the Graduate Outcome
study's pre-registration). Append-only; supersede with a new dated file, don't edit.

**Companion:** `gc_alumni/PRE_REGISTRATION.md` (the criterion side's method) and this repo's
`docs/graduate-outcome-validation.html` (the study's purpose) and
`docs/superpowers/specs/2026-06-07-demand-coverage-sufficiency-seam-design.md` (the demand↔coverage
seam this extends).

---

## Purpose

Define how the `gc_alumni` study's **graduate destinations** (the *criterion* — where graduates
actually land) feed this tool's career-target model and the **criterion-relevance alignment test**,
**without collapsing the two independent sides into circularity.**

The study's purpose doc makes the independence guardrail load-bearing: the alignment "must not
reduce to O\*NET vs. O\*NET." This spec is mostly about *what is allowed to cross the seam* so that
guardrail holds.

## The two systems

| | `gc_alumni` (separate repo) | `curriculum_developer` (this repo) |
|---|---|---|
| Stack | SQLite + Datasette, Python pipeline | Postgres 17 + Next.js |
| Owns | **Criterion:** first-destination SOC/NAICS, counts, trajectory, verification | **Predictor:** `career_targets`, `sub_competencies`, KUD+ coverage (`snapshot_target_coverage`); **Demand:** `career_target_demand` (Position-Capture-derived, partner-weighted) |
| Provides to the seam | per-SOC first-destination **counts + industry mix + window + verification** | the join target (`career_targets.soc_code` is already nullable-present) |

## What crosses the seam — and what must NOT

**Crosses (aggregate only):** per-SOC first-destination **counts / share**, industry (NAICS) mix,
the analytic **window label**, verified-count, `coding_scheme_version`, `generated_at`.
= *where graduates land + how many.*

**Never crosses:**
- **No competency profiles.** Demand stays employer-evidenced (Position Capture) and O\*NET-seeded
  on this side. Alumni destinations **weight and ground** targets; they **never define** a target's
  KUDs. This is the circularity guardrail.
- **No person-level PII.** Only aggregates cross (see Privacy).

## Join key: SOC

`career_targets.soc_code` ↔ `gc_alumni` first-job `position.soc_code`. Four cases, all first-class:

1. **Alumni SOC ↔ a career target** → attach a **graduate-flow weight** to that target.
2. **Alumni SOC, no career target** → graduates land where we model **no target** → *candidate
   missing target* (a program-side finding).
3. **Career target, no alumni** → a target **nobody lands in (yet)** → review its defensibility.
4. **Uncodeable alumni titles** (`soc_code` NULL — the ~32% modern hybrids) → tracked separately,
   feed the forward-taxonomy work (`gc_alumni/research/V2_target_career_paths.md`); **not dropped**,
   not force-bucketed. This *is* the study's pre-specified "no-clean-match (a)" finding.

## Three uses (in dependency order)

1. **Target salience — graduate-flow weight.** A *second, independent* weight alongside the existing
   employer weight (`partners.weight`). "This target receives 24% of graduates" is a different fact
   from "employers weight it X"; surface both, never blend silently.
2. **Criterion-relevance alignment (the primary analysis).** Alumni first-destination SOC +
   frequency are the **criterion anchor**; this tool supplies coverage; the alignment is computed
   **here**, weighted by graduate flow. The alumni side never sees curriculum data — independence
   preserved.
3. **Descriptive destinations-vs-crosswalk.** Render the study's headline finding (destinations ≠
   CIP→SOC prediction) inside this tool's program views, sourced from the same import.

## Transport — static versioned export (recommended)

`gc_alumni` emits an **aggregate JSON export** from a dedicated view (a SOC-grouped rollup of
`v_first_job_full`); this repo imports it into a read-only read-model table. No live coupling, no
PII, reproducible.

- Rejected **B) live Datasette JSON pull** — couples this tool's reads to the alumni app's uptime.
- Rejected **C) shared database** — separate stacks; would drag PII across the boundary.

**Export envelope (the contract — aggregate, no PII):**
```jsonc
{
  "schema": "gc-alumni-destinations/v1",
  "coding_scheme_version": "v1-2026",
  "window_label": "first-jobs 2016-2026",   // matches a pre-registered window (PRE_REGISTRATION §3)
  "generated_at": "2026-…",
  "total_first_jobs": 312,
  "uncodeable_count": 50,                    // soc_code NULL — the no-match finding
  "destinations": [
    { "soc_code": "27-1024", "occupation": "Graphic Designers",
      "first_jobs": 64, "share": 0.239, "verified": 28,
      "naics_mix": { "541": 30, "511": 12 } }
    // … cells below a suppression threshold omitted (see Privacy)
  ]
}
```

## New surfaces in this repo (all flag-gated, build-ahead)

Mirror the `DEMAND_COVERAGE_SEAM` discipline exactly: migration written-but-not-applied, all
read/write + UI gated by a new flag **`ALUMNI_DESTINATIONS_SEAM`**, pure import/merge logic
unit-tested, nothing live until sign-off.

- **`graduate_destinations`** (new read-model table) — PK `(soc_code, window_label)`; `first_jobs`,
  `share`, `verified`, `naics_mix` jsonb, `coding_scheme_version`, `generated_at`. Read-only;
  overwritten wholesale per import.
- **`lib/program/alumni-destinations-import.ts`** — validates the envelope (schema version, window
  matches a pre-registered window, suppression honored), upserts. Pure-ish, unit-tested.
- **Admin import trigger** — `POST /api/admin/alumni-destinations/import` (paste/upload the export
  JSON), gated. No automated scheduling in v1.
- **Merge/use** — extend the per-target view to attach graduate-flow weight + the four-case
  match status; render in the existing sufficiency panel and a small destinations card.

## Privacy at the seam (k-anonymity)

Only aggregate counts cross, and the exporter **suppresses small cells** (recommend: omit any SOC
with `first_jobs` < 5, fold into an "other" bucket) so no destination cell can re-identify an
individual. This keeps the seam itself PII-free regardless of how raw PII is handled inside
`gc_alumni`. (Note: this addresses the *seam*; the in-DB non-LinkedIn-PII concern is a separate
`gc_alumni`-side question.)

## Out of scope (v1)

Person-level transfer; trajectory/current-job alignment (first-destination only, per the study's
anchor rule); automated/scheduled pull; writing anything back to `gc_alumni`; AI-assisted
SOC→career-target mapping (the `career_targets.soc_code` is faculty-set).

## Open decisions (need sign-off)

1. **Which window(s) to export** — descriptive (all cohorts) and/or alignment (~10-yr). Likely both, labeled.
2. **SOC granularity** — 6-digit SOC vs O\*NET 8-digit for the emerging roles the crosswalk hides.
3. **Suppression threshold** — `<5` proposed; confirm with the governance review.
4. **Refresh ownership** — who regenerates + re-imports the export, and how often.
5. **Graduate-flow vs employer weight** — display side-by-side (proposed) or combine into one salience score (not recommended in v1).
