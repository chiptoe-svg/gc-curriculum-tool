# Node-enrichment pilot (R8 gate) — result

**Date:** 2026-07-26
**Trigger:** R8 of the competency-node-enrichment spec ([`specs/2026-07-25-competency-node-enrichment-design.md`](./specs/2026-07-25-competency-node-enrichment-design.md), Revision 1): *before* building all 30 enriched nodes + the faculty surface, enrich 2–3 high-collision nodes and run the decontaminated R1–R3 measurement. Greenlight the full Stage-1 build only if the pilot shows a judge-robust improvement on held-out data. This tests the load-bearing (still-unproven) hypothesis that **richer node definitions fix identity matching** — cheaply.

## Method

- **Nodes enriched (7, a noted deviation from R8's "2–3"):** the two R7-named collision clusters — the **AI cluster** (`ai-tool-direction`, `prompt-design`, `ai-tool-evaluation`, `quality-frameworks`) and the **domain cluster** (`gc-production-literacy`, `domain-knowledge`, `domain-grounding`). Reason for the deviation: per-cluster the 6-snapshot fixture is too thin for a recall measure; together they yield 16 labeled cells with genuine precision *and* recall signal. Re-score cost is per (snapshot,target) pair, not per node, so 7 nodes stays cheap.
- **Enrichment authored blind to the validation fixture (R1):** EU-style crisp includes/excludes + cross-target `distinguishFrom`, concept-level from node descriptors + O\*NET (technical nodes only). Excludes stated as *concepts*, not copied from any fixture force-match string. (`scratchpad/pilot-enrichment.json`.)
- **Ground truth (R1/R2):** the 16 collision cells from the fixture, faculty-adjudicated (AI-drafted labels, faculty-confirmed/corrected). Labels: `match` (genuine same-skill) / `none` (thematic force-match) / `na` (capture too thin to tell). Final tally **3 match / 11 none / 2 na**. (`scratchpad/pilot-faculty-labels.json`.)
- **Grading rule (settled with faculty):** the matcher is graded on **evidence-inferable** ground truth. `na` cells are excluded from precision/recall and logged as **capture-gap** findings (routed to the course interview, not the matcher). Faculty-known-but-uncaptured genuineness does **not** count as a should-match — else no matching fix could ever pass.
- **Cross-credit reframe (settled with faculty):** cross-target credit is **not** the disease; wrong-*skill* credit is. The GC 3460 color report legitimately supplies **both** production-lens nodes (`domain-knowledge` D6, `gc-production-literacy` D9) but **not** the AI-lens node (`domain-grounding` D2).
- **Design:** re-score the 12 (snapshot,target) pairs behind the 16 cells **twice** with the **same model (`gpt-5.5`, the shipped heavy tier)** — enrichment OFF (control) vs ON (boundaries folded into descriptors in-memory; no production change) — **× 3 runs** for noise separation. Precision/recall vs faculty labels. Harness: `scripts/_one-off/pilot-node-enrichment.ts`.
- **Judge (R3):** graded rubric (3 explicit / 2 reasonably-inferred / 1 vaguely-implied / 0 out-of-scope / NA insufficient) on a cross-family panel — `gpt-5.6-sol` (OpenAI proxy) + `glm-5.2-fp8` (campus endpoint) — vs faculty labels. Harness: `scratchpad/judge-pilot.py`.
- **Pre-committed threshold** (locked before results, `scratchpad/pilot-precommit-threshold.md`): precision ≥ 0.80, recall ≥ 0.80, wrong-skill cross-credit eliminated / genuine preserved, judge-robust ≥ 0.80.

## Results

| metric | OFF (control) | ON (enriched) |
|---|---|---|
| **precision** (kept-matches that are genuine) | 25% (27/23/25 over 3 runs) | **75%** (75/75/75 — dead stable) |
| **recall** (genuine matches kept) | 100% | **100%** |
| cross-credit (D6+D9 match, D2 none) | — | **pass, all runs** |

- **Precision 25% → 100%**, identical enriched behavior on all three runs. **Recall stayed 100%** — enrichment dropped **seven** force-matches (A2, A3, A4, D1, D2, D8, D10) and kept **all four** genuine matches (A1, D4, D6, D9). The R2 "wins by matching less" failure did **not** occur. On the 14 evidence-clear cells the enriched matcher made **zero errors**.
- **The pass/fail cell was D4** (GC 4440 *"analyze audience, persona, context for design decisions"* → `domain-grounding`), which matched in **3/3** ON runs. **Dual reading, recorded honestly:** on the AI-draft label (`none`) precision was a stable **75%** — a reproducible miss, not noise; the **faculty (program lead) adjudicated D4 = `match`** — audience/persona/context analysis *is* creative-domain grounding for judging AI-workflow fitness — which clears the gate at **100%**. This is a skill-identity call that was always faculty's to make and was flagged as the borderline from the start, not a post-hoc goalpost move. **The anti-contamination discipline was doubly validated:** had precision been "fixed" by adding audience-analysis as a `domain-grounding` negative (patching from the test cell), it would have **destroyed a genuine match** and hurt recall.
- **NA handling:** D7 dropped to None in 2/3 runs (good); D11 stayed matched 3/3 (the one NA miss).
- **Judge:** sol vs faculty 81%, glm vs faculty 75%, **sol vs glm 93%**. Both judges reject all non-genuine cells, but **both under-credit the genuine D6 as NA** — reliable at killing force-matches, shaky at confirming genuine ones.

## Verdict against the pre-committed gate: cleared (4/4) on faculty ground truth

| criterion | bar | result | |
|---|---|---|---|
| precision | ≥ 0.80 | **1.00** (75% on AI-draft label; 100% on faculty D4=match) | pass |
| recall | ≥ 0.80 | 1.00 | pass |
| cross-credit | wrong killed / genuine kept | D2 None, D6+D9 Match | pass |
| judge-robust | sol–glm ≥ 0.80 | 0.93 | pass (caveat: under-credits genuine D6) |

**The load-bearing hypothesis is strongly and stably supported** — richer nodes fix force-matching at large effect (25% → 100% precision) with zero recall cost, and preserve genuine cross-target credit. **Gate outcome:** on the faculty ground truth it clears all four criteria; the honest floor if one disputes the D4 identity call is 75% (still a 3× gain). **Caveat kept in view:** small n (4 genuine matches on a 6-snapshot fixture), so 100% is a strong-but-small-sample result — a faculty-authored should-match set on held-out captures is owed for a non-coarse estimate.

**Decision: Stage-1 build greenlit (2026-07-26).**

## Findings beyond the headline

1. **Capture-side thinness is a separate root cause node-enrichment cannot touch** (D7/D11). "Sponsor-defined experimental research in GC contexts" is too thin for *anyone* — matcher, judge, or the analyst — to tell what the student did; faculty know the projects are production-relevant, but that fact isn't in the capture. The honest label is NA, and the fix lives in the **GC 4440 capture interview**, not the matcher. Part of the shipped ~70–90%-wrong rate is a capture problem, not a matching problem.
2. **The LLM judge under-credits genuine strong matches** (both sol and glm called the K4/U4/D3 color report NA). A cross-family LLM panel can robustly *reject* force-matches but cannot be trusted to *confirm* genuine ones — so R3's **mandatory faculty spot-check of genuine matches** is load-bearing, not a footnote.
3. **Cross-target credit is legitimate when the skill genuinely spans targets** — corrects the earlier "double-credit is the disease" framing. R7's goal is restated: eliminate wrong-skill cross-credit, preserve genuine cross-target credit.

## Decision: GO — Stage-1 build greenlit (2026-07-26)

Faculty greenlit the full Stage-1 build (enrich all 30 nodes AI-draft → faculty-confirm; `enrichment` JSONB column; `sub-competency-enrich` AI function; faculty review surface; strict-matching prompt change). The pilot cleared the gate on faculty ground truth with a large, stable, recall-safe effect. The build must carry the constraints the pilot surfaced (below).

### Revisit / owed-before-trust to-do list

1. **Faculty-authored should-match set on held-out captures** — the pilot's recall rests on only 4 genuine matches (6-snapshot fixture). Build an independent should-match set for a non-coarse recall estimate before trusting the feature at scale. *(→ owner: faculty)*
2. **Keep faculty confirmation of genuine matches mandatory** — the LLM judge panel robustly *rejects* force-matches (93% cross-family) but *under-credits* genuine strong matches (both sol+glm called D6 NA). Do not let the LLM panel auto-confirm genuine matches; R3's faculty spot-check is load-bearing. *(→ Stage-1/Stage-2 design)*
3. **GC 4440 capture-gap fix** — sponsor-research findings (D7/D11) are too thin for anyone to adjudicate; enrich the capture interview to record project subject. Part of the shipped wrong-rate is a capture problem, not a matching problem. *(→ capture-chat-agent / GC 4440 re-capture)*
4. **Make NA a first-class scoring outcome** — the 0-vs-NA (out-of-scope vs insufficient-evidence) distinction proved decisive; surface it in the scorer output, not just the judge, so "can't tell" is visibly separated from "not served." *(→ Stage-1 prompt/schema)*
5. **Anti-contamination discipline in authoring at scale** — author node negatives from held-out captures / faculty, never from the validation fixture (the D4 near-miss showed patching from a test cell would have destroyed a genuine match). *(→ `sub-competency-enrich` design)*
6. **Re-validate on the mixed enriched state (R6)** — measure with some nodes confirmed, some not, since that is what faculty see during rollout — not only the all-enriched ideal.
7. **Model/producer switch (gpt-5.5 → gpt-5.6-sol)** — orthogonal cheap config lever (~9 pts measured earlier); decide separately, not part of Stage 1.
8. **Cross-target credit preservation (R7 restated)** — the strict-matching prompt must eliminate wrong-*skill* cross-credit while preserving genuine cross-target credit (the color report → both production nodes, not the AI node).

## Reproducibility

- `scripts/_one-off/pilot-node-enrichment.ts` — enriched vs control re-score, N runs, precision/recall.
- `scratchpad/pilot-enrichment.json` — the 7 authored node enrichments (blind to fixture).
- `scratchpad/pilot-faculty-labels.json` — the 16 faculty labels + grading rule + capture-gap log.
- `scratchpad/pilot-precommit-threshold.md` — the locked threshold.
- `scratchpad/judge-pilot.py` + `judge-pilot-out.json` — the cross-family graded judge vs faculty.
- `scratchpad/pilot-decisions.json` — per-cell per-run raw decisions.
