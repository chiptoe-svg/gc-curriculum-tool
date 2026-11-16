# Course edits and required-skill threads on the curriculum map (design, 2026-11-16)

Owner request (2026-11-16): on the curriculum map, add and edit **required** and **developed** skills for each course, edit **prerequisites and corequisites**, and edit **objectives**. These edits affect only that map's "met" judgments. Each course shows a colored bar for how many of its required skills are met; clicking it lists each skill and its status. Every change is clearly marked, and a **Markdown export** lists all changes in objectives, required skills, developed skills and prerequisites/corequisites.

Builds on: the [skill-thread concept](../../curriculum-map-skill-threads.html) (drafting model, owner 2026-11-16); [skill links](./2026-11-15-skill-competency-links-design.md); the [matching results](../2026-11-15-skill-matching-probe-results.md); the [re-capture identity test](../2026-11-16-recapture-skill-identity-test.md).

## Decisions taken (owner, 2026-11-16)

- **Matching** uses the benchmarked method: ask a free campus model, with course context, and read P(yes); calibrate the cut-off on department pairs.
- **Card bar:** segmented; all green only when every required skill is met.
- **Export:** a Markdown file that is easy to read.
- **Drafting model:** a map edit is a draft. It counts toward "met" on that map, is shown in italics with an asterisk, and is listed on the course as "to confirm through capture". Captures are never changed by a map edit.

## 1. What a map edit is

Stored in the plan (`PlanState.courseEdits[courseCode]`), never in the capture. Kinds:

| Kind | Fields | Notes |
|---|---|---|
| Objective | text, Bloom process (proposed from the leading verb, confirmed by the editor) | add, edit, remove; a captured or catalog objective can be edited or removed on the map only |
| Required skill | statement, needed K/U/D | add, edit (wording or levels), remove |
| Developed skill | statement, K/U/D goal | add a new skill, raise or lower a goal on an existing one, remove |
| Prerequisite / corequisite | other course, kind (`prereq` or `coreq`) | add, or set aside a catalog one; extends the plan's existing `links` / `unlinked` with a `coreq` kind (same term allowed) |
| Match decision | required skill, supplying skill, fully / partly / not | a faculty override of the judge; stored as shared evidence (§2) |

Every edit records who made it (the login's name; "department login" when shared) and when. The original value is kept beside the edit, so the export can show before and after.

## 2. Required skills and their suppliers

**Threads stand apart (owner, 2026-11-16).** A thread (a required skill met by an earlier course's skill) answers one question only: does the earlier course on this map supply what the later course needs? It does not add to or change any competency bucket, competency level, roll-up, program or act target, or learning objective. Competency levels still come only from skill-to-competency links, and objectives only from their own links. Nor does the status of a required skill read competencies: there is no "met through the competency" fallback in this feature. There is no separate calculation either: each developed skill is counted once, and read two ways. Through its competency link it is part of a bucket's roll-up; through a thread it supplies a later requirement. A thread adds no level and no evidence, so feeding it into a competency would count the same skill twice. A draft skill on a map can meet a thread (met*) but never raises a bucket's evidenced level until a capture confirms it.

- **Required skills** of a captured course are its capture's incoming expectations (statement, expected K/U/D), loaded into the library for the version the plan uses. Map edits add to, change or remove them.
- **Candidates:** the developed skills (captured, plus map-added) of every course placed in an **earlier term** on the map, or the **same term** when linked as a corequisite. Not limited to listed prerequisites: the map asks what students have had by then.
- **Shortlist:** the 5 nearest candidates by campus embedding (free).
- **Judge:** campus models (free): `qwen3.8-27b-fp8` and `deepseek-v4.1-flash-1017`, both asked and both stored; one yes/no question per pair, P(yes) from logprobs. The question asks about the **activity only** ("does the earlier skill develop the activity the later course requires?"); levels are compared separately. Course titles and descriptions give context. A second question asks "partly": the earlier skill covers part of it.
- **Cache:** judgments are stored by the texts' hashes, model and prompt version (`skill_match_judgments`, migration 0069), so every map reuses them and a re-capture with unchanged wording costs nothing. Map-added skills are judged on save (a few calls, under a second).
- **Model choice:** on the 48 spike pairs the two models rank pairs alike (Spearman 0.85) but DeepSeek scores higher (mean P(fully) 0.62 against 0.45), so each needs its own cut-off. Qwen is used until the owner's labels show which model agrees better.
- **Calibration:** the cut-offs come from a labeled set of department pairs (fit on log-odds or rank, per the results note). Before any labels exist, a spike sets provisional cut-offs; accept/reject decisions on maps become the labels.

### Faculty decisions are evidence (owner, 2026-11-16)

Faculty can overrule the judge during mapping: accept a match, reject it, rate it partly, or pick a different supplier. Every such decision is **stored as evidence** in a shared table (`skill_match_decisions`, in migration 0069), never only in the plan:

- **What is kept:** the two skill texts (and their capture and skill references when captured), the decision (fully / partly / not), the judge's P(yes) at the time, who decided, when, on which map, and an optional reason. Decisions are never overwritten; a new decision is added and the latest one counts.
- **Where it applies:** a decision about two **captured** skills is a fact about those skills, so it applies on **every** map, shown as "confirmed (or rejected) by <name>, <date>". A decision that involves a **draft** skill applies only on the map where the draft lives, but is kept all the same.
- **What it is used for:** it outranks the judge wherever it applies; it is the labeled set the judge's cut-offs are fitted on; and it carries across re-captures through the identity rule in the re-capture test (decisions follow a skill whose wording carries over).
- **In the export:** each map's decisions are listed with who and when.
- **Retrievable as pairs (owner, 2026-11-16):** the whole decision set can be pulled as a labeled-pair dataset for later use (calibration, training or testing a matcher, research). `GET /api/build/match-decisions.jsonl` (faculty login) and `pnpm tsx scripts/catalog/export-match-decisions.ts` write one record per pair: `required_text`, `supplied_text`, both courses' codes and titles (the context the judge saw), `label` (fully / partly / not), `latest` (whether it is the decision that counts), `decided_by`, `decided_at`, `plan_id`, `source` (map, labeling sheet), and the judge's model, prompt version and P(yes) at the time. Options: latest decisions only, or the full history; CSV as well as JSON Lines. The owner's 48-pair labeling sheet (2026-11-16) is loaded as the first batch, `source: labeling_sheet`.
- **Kept fit for reuse:** pair texts are stored as written at the time of the decision, so a later re-capture or rewording never changes a stored pair.

## 3. Status of a required skill (first match wins)

| Status | Color | Rule |
|---|---|---|
| Met | green | an accepted or above-cut-off "fully" match from a captured skill whose captured levels reach every needed dimension |
| Met* | yellow | met only by counting a map edit (a draft skill or goal, an edited requirement, or a corequisite added on the map) |
| Partly met | orange | a match exists but falls short on a level, or matches only "partly" |
| Not met | red | none of the above, or every match rejected |

Levels are whole numbers; nothing is rounded up.

### Fade applies to threads only (owner, 2026-11-16)

Fade is a property of a thread, not of a competency. A supplier's level is carried forward to the term of the course that requires it, losing the plan's fade rate per term (the plan's per-act setting spread over its three terms), and truncated to a whole level. Another fully matching supplier in a later term restores the level, as a near-peak rework does today. A requirement that the supplier's captured level meets but the faded level does not shows as **Partly met, faded** (orange), naming the dimension that slipped. With fade set to 0, nothing fades.

Competency levels, act checkpoints and targets no longer fade: the builder's competency "fading" status and the fade-held level are removed from them, and the fade setting on the map now governs threads only.

## 4. On the map

- **Card bar:** under the course code, a thin bar split into green / yellow / orange / red segments in proportion to the course's required skills; all green only at 100% met. No bar when the course has no required skills.
- **Click the bar:** a list of the course's required skills with status, needed levels, the supplying course and skill, and accept / reject / "pick another" controls.
- **Changed courses:** a pencil mark and change count on the card; edited items in italics with an asterisk; a "Changes on this map" section in the course panel, and "To confirm through capture".
- **Course panel editors** for each kind in §1.

## 4b. Courses drafted from a syllabus (owner, 2026-11-16)

A course with no capture can be brought onto a map from its syllabus, so it takes part in mapping like any other course. A syllabus is required: there is no drafting from a title or description alone.

- **Where:** "Import a course from a syllabus" in the library panel, for a catalog course with no capture, a course already proposed on the plan, or a new course. Upload a PDF, Word file or pasted text.
- **Reading the file:** the existing extractor (`getExtractorFor`, Docling for PDF and Word). The extracted text is stored with the plan (`plan_syllabus_drafts`, migration 0069: plan, course, file name, text, who, when, model), not as a course material, so it never enters captures.
- **Drafting:** a free campus model reads the syllabus and drafts, as structured output: learning objectives (each with its Bloom process), developed skills with K/U/D goals, required skills with needed K/U/D, and the prerequisites and corequisites the syllabus names. The prompt carries the framework's depth scale and evidence rule: a syllabus states intentions, so every drafted level is a **goal**, never evidence, and Do levels follow the condition the syllabus states (none stated → the model proposes at most D2 and flags "condition missing").
- **Same warnings as an edited course:** every drafted item is a draft (italic, asterisk), counts toward "met" only as **Met\*** (yellow), and appears under "To confirm through capture". The card is marked **Drafted from syllabus**, and the course panel shows the source file and date.
- **Faculty review:** the drafted items are ordinary map edits, so faculty can keep, change or remove each one; changes are logged and exported like any other.
- **Judging:** drafted skills are judged against the map's other courses on import (both directions: what the course needs, and what it supplies to later courses), cached like any draft.
- **When the course is captured:** the capture interview can be given the syllabus draft as context, and the capture's evidence replaces the draft; the "To confirm through capture" list is checked off against it.
- **Cost:** campus models are free. If the provider ever has to be a paid one, the import shows an estimate and needs the owner's yes first.

## 5. Export

`GET /api/build/plans/<id>/changes.md` (plan read rule), a download named `<plan-name>-changes-<date>.md`:

- Header: plan name, date, catalog year, who exported.
- Summary: courses changed; counts per kind; required skills met / met* / partly / not met across the map.
- One section per changed course: Objectives, Required skills (with status and supplier), Developed skills, Prerequisites and corequisites, Match decisions. Each change shows before → after, who and when.
- Courses drafted from a syllabus are marked as such, with the file name and date.
- Closing list: every draft that needs a capture to confirm it.

## 6. Not in this design

Changing captures; storing threads outside a plan; the AI roll-up; the needed-shape view (concept §10). Map edits to skills, objectives and prerequisites stay on their map; match decisions between captured skills are shared evidence (§2).

## 7. Build order

1. **Spike (free):** judge ~40 real pairs from captured courses; owner labels them; set provisional cut-offs and the question wording.
2. Migration 0069 (`skill_match_judgments`, `skill_match_decisions`, `plan_syllabus_drafts`) on scratch; judge library and batch over captured courses (free).
3. Plan edits in `PlanState` and the met computation (pure, tested).
4. Map UI: bar, list, editors, change marks.
5. Markdown export.
5b. Syllabus import and drafting (one course probe on the campus model first).
6. Live: backup, migration, batch, deploy (owner go-ahead required for the live migration).
