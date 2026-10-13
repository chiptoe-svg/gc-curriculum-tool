# Bundle membership (competency catalog P2) — design

**Status:** owner-approved design, 2026-10-13 (sections 1–4 approved in session). Supersedes the P2 rows of [`2026-10-11-competency-catalog-and-career-demand-design.md`](./2026-10-11-competency-catalog-and-career-demand-design.md) §3 (`competency_links`), §5 step 3 and §8 "P2"; the rest of that spec stands.

## 1. Why

The catalog's competencies are **skill bundles**. Fine-grained items belong to them: an O*NET element or task on the demand side, and (P2b) a skill a course or lab develops on the supply side. Each item sits in a bundle at a **position** (core, related or fringe). P3's career weights need confirmed O*NET members; P2b's course-skill mapping needs the same structure. P2 builds that structure once and fills it from O*NET first.

## 2. Decisions (owner, 2026-10-13)

1. **Links only; weights in P3.** Weight seeding, AI-drafted weights and required depths get their own spec once confirmed members exist.
2. **O*NET now, ESCO later.** P2 maps only the loaded O*NET 31.0 elements and tasks (the 91 mix occupations). Bundles with no clean O*NET match are recorded; that list is ESCO's to-do.
3. **Approach B (hybrid).** The model sees every loaded O*NET element (with its definition) in every call; embeddings shortlist only the task statements.
4. **Golden set = blind sample + review the rest.** About 8 bundles are placed blind by a reviewer before the AI's placements are visible; everything else goes through a review queue with AI rationale. Nothing is auto-confirmed in P2.
5. **Reviewer: owner first, faculty later.** Every action records a reviewer name; a second blind reviewer later adds an inter-rater figure.
6. **Two-level structure (owner idea, 2026-10-13).** Items belong to bundles with a position (core / related / fringe). Build the tables for both sides; map O*NET first, course skills in P2b.
7. **Centrality is not weight.** `position` says how central an item is to its bundle. How much a bundle matters to a career stays in P3's `career_target_requirements.weight`.
8. **Scoring unchanged.** Courses keep being scored directly per bundle. Deriving a bundle's depth from its members is deferred (it would change what every score means, and many fringe items could inflate a bundle).

## 3. Data model — migration `0059` (additive only)

| Table | Purpose | Key fields |
|---|---|---|
| `bundle_cards` | One card per catalog competency; the embedded text | `competency_id` (FK `sub_competencies`), `includes`, `excludes`, `distinctions`, `positive_examples` (text[]), `negative_examples` (text[]), `status` (`draft` \| `confirmed`), `confirmed_by`, `confirmed_at`, timestamps |
| `item_embeddings` | Embedding cache for every source | `kind` (`bundle_card` \| `onet_task`; later `course_skill`, `esco_skill`), `ref` (text), `model`, `text_hash`, `vector` (`real[]`), `created_at`; PK (`kind`, `ref`, `model`, `text_hash`) |
| `onet_element_definitions` | Element descriptions (O*NET 31.0 Content Model Reference) for elements present in `onet_element_ratings` | `release`, `domain`, `element_id`, `element_name`, `description`; PK (`release`, `element_id`) |
| `bundle_members` | Item ↔ bundle membership | `id`, `bundle_id` (FK `sub_competencies`), `source` (`onet_element` \| `onet_task`; later `course_skill`, `esco_skill`), `external_id`, `external_label`, `onet_soc_code` (tasks only; null for elements), `release` (O*NET items), `position` (`core` \| `related` \| `fringe`), `ai_position` (as first proposed; null for reviewer-added), `status` (`proposed` \| `confirmed` \| `rejected`), `proposed_by` (model id or `reviewer`), `rationale`, `run_id`, `confirmed_by`, `confirmed_at`, `bulk_confirmed` (bool), `review_note`, `centroid_distance` (real, null until a bundle has enough confirmed members), timestamps; UNIQUE (`bundle_id`, `source`, `release`, `external_id`, `onet_soc_code`) NULLS NOT DISTINCT |
| `bundle_mapping_runs` | One row per mapping run | `id`, `model`, `prompt_version`, `task_shortlist_k`, `bundle_count`, `cost_usd_cents`, `dry_run`, `started_at`, `finished_at` |
| `bundle_mapping_outcomes` | One row per (run, bundle) | `run_id`, `bundle_id`, `status` (`ok` \| `failed`), `no_clean_match` (bool), `note`, `cost_usd_cents` |
| `bundle_golden_samples` | The blind sample's bundles | `bundle_id` (PK), `sample_seed`, `reviewer`, `submitted_at` (null until submitted; non-null = locked), `reset_note`, `created_at` |
| `bundle_golden_picks` | The blind reviewer's placements | `bundle_id` (FK `bundle_golden_samples`), `reviewer`, `source`, `external_id`, `onet_soc_code`, `position`, plus one row per bundle with `no_clean_match = true` when nothing fits; UNIQUE (`bundle_id`, `reviewer`, `source`, `external_id`, `onet_soc_code`) NULLS NOT DISTINCT |

An item may belong to several bundles, each with its own position. Only `confirmed` members feed P3. `centroid_distance` is a review flag only; it never changes a position by itself.

**Rollback:** drop the new tables (nothing references them yet).

## 4. Pipeline

Every stage is a script: dry run by default, `--apply` to write.

- **A. Bundle cards** (`scripts/catalog/draft-bundle-cards.ts`). One AI call per bundle with its K/U/D descriptors plus every other bundle's name and descriptors (for distinctions). Drafts go to a committed review file `docs/superpowers/specs/<date>-bundle-cards.json`; on owner approval, `--apply` inserts them `confirmed`. No later stage uses an unconfirmed card.
- **B. Embeddings** (`scripts/catalog/embed-items.ts`). Confirmed cards and the 1,961 O*NET task statements via the campus `qwen3-embedding-4b` (`lib/ai/embeddings.ts`). Only changed text (new `text_hash`) is re-embedded. Elements are not embedded.
- **C. Shortlist** (inside D, not stored). Per bundle, top 25 tasks by cosine similarity to the card. Identical task text across occupations is grouped into one candidate listing its occupations. Blind-sample bundles also get a top-50 list, shown only to the blind reviewer.
- **D. Placement** (`scripts/catalog/map-bundles-onet.ts`; AI function `bundle-map-onet`, heavy tier, strict JSON schema with every property in `required`). Input: one card, all loaded O*NET elements with definitions grouped by domain, the bundle's 25 task candidates. Output: placed items (`external_id`, `position`, one-line rationale) plus `no_clean_match` and a note when nothing beats fringe. Unlisted items are not members; unknown ids are dropped. Writes `proposed` rows, a run row and an outcome row per bundle. **Reruns replace only `proposed` rows; confirmed and rejected rows are never touched.** `--max-cost` stops at the cap; the dry run prints shortlists, token counts and an estimated cost before any paid call. Each bundle is its own call and write: a failure is logged and skipped, leaves no partial rows, and a rerun picks up missing bundles. Blind-sample bundles are mapped too, but their AI placements are withheld (see §5).
- **Blind sample draw.** 8 bundles, seeded random, spread across foundational, technical and business bundles with at least one likely no-match (workflow technology or AI). Seed and draw are recorded.
- **Element definitions** load through the existing O*NET loader (`lib/onet/load.ts`, `scripts/onet/load-onet.ts`, same `--apply` gate).

## 5. Review page — `/admin/bundles`

Behind the existing admin gate; every write is also checked admin-only server-side via `lib/auth/viewer.ts`. Each action records a reviewer name (remembered per browser). O*NET attribution is shown on the page.

- **Cards** (read-only in P2; edits go through the review-file flow).
- **Blind sample** (done first). Card, all elements by domain with definitions (collapsed), top-50 tasks. The reviewer marks core / related / fringe or "no clean match" and submits. **The API does not return AI placements for a sampled bundle until its blind pick is submitted** (enforced server-side, not just hidden in the UI). A submitted pick is locked; correcting it needs an admin reset with a recorded note. Submitting runs **reconcile** for that bundle: agreement → confirm; reviewer-only items → added (`proposed_by = reviewer`, confirmed); position disagreements → review queue. Reconcile is idempotent.
- **Review queue.** Per bundle, AI-proposed items grouped by position with rationale. Actions: confirm, reject, change position (`ai_position` kept), add a missing item (search elements and tasks). "Confirm the rest as proposed" per bundle, behind a confirmation prompt, sets `bulk_confirmed`. Progress by bundle; no-match bundles listed separately.

## 6. Measurement

`scripts/catalog/bundle-agreement-report.ts` plus a summary panel on the page, over the blind-sample bundles, per bundle and overall, counts first (8 bundles makes percentages rough, and the report says so):

- **Precision:** of items the AI placed, how many the reviewer also placed.
- **Recall:** of items the reviewer placed, how many the AI found.
- **Position agreement:** exact, and within one step.
- **Shortlist recall:** reviewer-picked tasks from the top 50 that fell outside the AI's top 25.
- **No-match list** (the ESCO to-do).
- With a second blind reviewer: Cohen's κ between reviewers.

**Rule:** nothing is auto-confirmed in P2 regardless of the figures; they inform P3's spec.

## 7. Testing

DB tests on a dedicated scratch DB (`scripts/migrations/p2-scratch-db.sh`), never live. Fake AI provider; embeddings stubbed.

- Unit: shortlist ranking, top-k cut, identical-task grouping; strict-schema audit; unknown-id drop; seeded sample draw is reproducible; agreement figures against a hand-worked fixture.
- Rerun safety: only `proposed` rows replaced; confirmed/rejected untouched; a failed bundle leaves no partial rows.
- Reconcile: agree → confirm; reviewer-only → added; disagreement → queue; idempotent.
- API: blindness (no AI placements before submit); non-admin writes → 403; locked blind pick refuses edits.
- **Red-proof** the blindness and rerun-safety tests (shown failing with the fix reverted).
- Hostile adversarial review to an honest ACCEPT before the final whole-branch review (the rerun path deletes rows).

## 8. Rollout

Owner gates marked ★.

1. Merge → verified backup (`p2-backup.sh`).
2. ★ Apply 0059 with the OLD app running (additive) → verify SQL.
3. Deploy: push `$SHA:main`, fast-forward the deploy checkout, `pnpm build`, `launchctl kickstart -k`.
4. Load element definitions: dry run → `--apply`.
5. ★ Draft cards → committed review file → owner approval → `--apply`.
6. Embed (free; changed text only).
7. ★ Mapping dry run with measured cost → owner go → `--apply --max-cost`.
8. Owner does the blind sample on `/admin/bundles`, then the review queue.

Rollback: revert code first, then drop the new tables by absolute path. No live data is modified, so no restore is needed.

**Cost (estimate, re-measured in the dry runs):** cards ≈ $1, mapping < $3, embeddings $0.

Also in P2: STATE.md entries; a short update to `docs/competency-catalog-deep-dive.html` "what comes next".

## 9. Out of scope (recorded as deferred)

- Course skills as members (P2b; needs a stable id per profile skill — today they are statements inside the snapshot JSON).
- ESCO skills and the ESCO↔O*NET crosswalk.
- Deriving a bundle's depth from its members' depths.
- Weights and required depths (P3).
- Any automatic confirmation.
- In-page card editing.

## 10. Risks

- **Model judgment on position.** Core/related/fringe is a judgment call; the blind sample measures it, and nothing is used before confirmation.
- **Shortlist misses tasks.** Measured by shortlist recall; widen k if it is poor.
- **Reviewer anchoring.** The blind sample is the defense; bulk confirmations are tagged so they can be audited.
- **Workload.** About 40 bundles of review; the queue is per bundle, can be done in sittings, and shows rationale.
- **Single reviewer.** One person's placements are the golden set until a second reviewer exists; the report says so.
