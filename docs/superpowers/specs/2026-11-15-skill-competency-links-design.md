# Skills, links and roll-ups: a non-destructive map from course skills to catalog competencies

**Status:** design approved by the owner in conversation, 2026-11-15 ("yes to yours", with the roll-up rule changed as below). Built on branch `feat/skill-links`; migration 0068 is applied to live only on the owner's explicit go-ahead.

## Why

The catalog scoring (`snapshot_competency_coverage`, last run 2026-10-19 with gpt-6.1-sol) does two things in one AI pass: it decides which of the catalog's competencies a captured skill belongs to, **and** it re-rates the level while doing so. Both lose information:

- A skill the pass matches to nothing disappears from every catalog view. A read-only audit of the 23 captures the builder uses found 54–60% of outcome statements dropped for GC 1010, GC 4800, GC 3800, MKT 3310 and MKT 4320, and 0–40% elsewhere (STATE.md, 2026-11-15).
- A matched skill can come out lower than the capture rated it, or land on the wrong competency (GC 4800's workplace-ethics outcome, K3 U2 D3, scored as Contracts, IP and licensing K2 U1 D1).
- Nothing records which part was a judgment, so nothing can be overridden.

## The model (owner)

1. **Skills stay what they are.** A course's outcome statements and their K/U/D, as approved in the capture profile (`profile.competencies[]`), are the record. Nothing below changes them.
2. **Links are a separate, editable layer.** A link says "this skill counts toward this catalog competency". One skill may link to several competencies. Every link records where it came from (`embedding`, `ai`, `scoring-2026-10-19`, `faculty`) and its status (`proposed`, `confirmed`, `rejected`). Overriding a link never touches the skill.
3. **Roll-ups are a separate, editable layer too.** How a competency's linked skills combine into one course-level K/U/D is its own step with its own method:
   - `max` — the highest linked skill, dimension by dimension. The starting rule: free, immediate.
   - `ai` — an AI reads the linked skills against the competency's descriptors and proposes a level with a one-line reason. The owner's example: eight linked skills at 0/0/1 and one at 3/4/4 need not make the competency 3/4/4, because one strong skill may cover only part of a broad competency. Paid; run on request.
   - `faculty` — a level set by hand.
   The method is always shown beside the level. A roll-up can be recomputed at any time without touching skills or links.
4. **Embeddings and AI propose; faculty decide.** Embedding similarity between a skill (`item_embeddings` kind `course_skill`, keyed by `statementRef`) and a competency's card (`bundle_card`) proposes links at no cost (campus Qwen). An AI pass may rank or explain candidates. Faculty confirm, reject or re-point.
5. **Unmapped skills stay visible.** A skill with no live link is listed for the course as unmapped, never dropped.

Defaults the owner accepted: proposed links count on the map until rejected (shown as proposed), so nothing goes blank while faculty review; any faculty member may change a link or a roll-up, and each change records who and when.

## Data

Migration 0068 (hand-written, additive; no existing table changes):

- `skill_competency_links` — `snapshot_id` (FK course_capture_snapshots, cascade), `skill_ref` (statementRef of the statement), `statement` (text as captured, for reading), `competency_id` (FK sub_competencies, cascade), `source` (`embedding` | `ai` | `scoring` | `faculty`), `status` (`proposed` | `confirmed` | `rejected`), `similarity` (real, null unless embedding), `note`, `decided_by`, `decided_at`, `created_at`. Primary key (`snapshot_id`, `skill_ref`, `competency_id`).
- `competency_rollups` — `snapshot_id`, `competency_id`, `k`, `u`, `d`, `method` (`ai` | `faculty`), `rationale`, `model`, `decided_by`, `created_at`. Primary key (`snapshot_id`, `competency_id`). A row exists only when the method is not `max`; `max` is computed, never stored.

Seeding (part of the apply script, idempotent): every current `snapshot_competency_coverage` row whose `matched_competency` equals a profile statement becomes a `scoring` link, status `proposed`. Embedding proposals are added for every statement with no live link and for the top match of every statement (similarity ≥ the floor, top 3), status `proposed`.

`snapshot_competency_coverage` stays as it is in this phase, so the Program page, what-ifs, prerequisite gaps and the wiki keep working unchanged. Phase 2 rebuilds it from links and roll-ups (model `links:<method>`), at which point every reader uses the new rule with no change of its own.

## Where it shows (phase 1: the builder)

- The builder's discovered reading of a course comes from links and roll-ups instead of the old scoring: per competency, the roll-up (stored `ai`/`faculty`, else `max` over linked skills whose link is not rejected).
- Course panel, Outgoing competencies: each competency shows its linked skills (with source and status) and the roll-up method; unmapped skills are listed. Controls: confirm or reject a link, link a skill to another competency, set a roll-up level by hand, and (later) ask the AI for a roll-up.
- Proposed (unconfirmed) links are drawn as soft evidence, like a stated objective.

## Not in phase 1

- The AI roll-up call (built behind the owner's per-run estimate and yes; probe one course first).
- Rebuilding `snapshot_competency_coverage` from links (phase 2).
- The Professional readiness competency is added with this migration's apply (owner approved the wording 2026-11-15; personal early-career budgeting is left out of it pending the owner's answer).
