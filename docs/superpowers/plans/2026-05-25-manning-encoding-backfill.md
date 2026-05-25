# Manning Skill Encoding Backfill

**Date:** 2026-05-25
**Status:** in progress — Phase A starting
**Owner:** Curriculum tool maintainer

## Context

The project's AI integration design (per `gc-curriculum-tool-spec.md` §"Manning Skills Integration") is that pedagogical reasoning comes from Gareth Manning's [Education Agent Skills Library](https://github.com/GarethManning/education-agent-skills) — 131 SKILL.md files describing evidence-based curriculum-design skills. The implementation pattern is **build-time prompt encoding** (not runtime MCP): we read the relevant SKILL.md files, then encode their reasoning frameworks into our system prompts.

The original analysis layer (M-trial / M0–M3) was built this way — 11 prompts have `manning_skills:` frontmatter and embody those skills' frameworks. The layers built on top of that (CourseCapture, Explore, Phase 1A) were written without that step — 11 prompts have no Manning encoding.

This plan backfills the encoding for the newer prompts.

## Encoding pattern (and the KUD+ interaction)

Manning is the **analytical scaffold** (be systematic, distinguish presence from depth, demand evidence, type the knowledge correctly). KUD+ is the **operational instrument** on top — our extensions to Wiggins/McTighe KUD that Manning didn't include:

1. Depth scale 0-5 per dimension, with student-side anchors
2. Foundational competencies scored on D only (K, U null)
3. Evidence-required-above-zero rule

Where Manning's framings give us *how to think*, our depth-scale anchors win for *what to score*. Specifically, Manning's KUD Chart Authoring skill describes K/U/D in Wiggins/McTighe terms (factual / transferable insight / performance-or-disposition); we use those terms but the actual rubric is `shared/depth-scale.md`.

Two principles to keep this clean:

- **Manning frames the disposition.** "Look for level not presence." "Demand evidence." "Type the knowledge correctly." "Be conservative on interpretive claims."
- **KUD+ owns the rubric.** Every prompt that scores includes `shared/depth-scale.md` and treats it as the source of truth.

`manning_skills:` frontmatter is the contract that the encoding happened. The body must actually reflect the skills, not just list them.

## Phases

### Phase A — Phase-1A scorer (the headline view's scorer)

**Prompt:** `lib/ai/prompts/program-score-coverage.md`

**Skills to encode:**
- Coverage Audit (curriculum-alignment) — match-classification tiers, conservative classification rule, row-per-requirement discipline
- KUD Chart Authoring (curriculum-alignment) — K/U/D definitions, performance vs. disposition, knowledge-type classification
- Developmental Band Translator (curriculum-alignment) — preserve source voice, confidence calibration based on band span
- Assessment Validity Checker (curriculum-assessment) — construct-irrelevant variance, construct underrepresentation, validation-as-argument
- Disciplinary AI Literacy Sequence Designer (ai-literacy) — Bernstein's vertical/horizontal discourse; be conservative when output is an AI interpretive claim

**Why this prompt first:** it's the heart of the new program coverage matrix view, and it's structurally similar to `score-coverage.md` (which is already encoded), so the comparison will be instructive.

### Phase B — Capture pipeline (snapshot quality upstream of the scorer)

These produce the snapshots the scorer reads. Quality here multiplies into every downstream score.

| Prompt | Skills to encode |
| --- | --- |
| `analyze-material.md` | KUD Chart Authoring (K/U/D type discipline), Assessment Validity Checker (avoid construct-irrelevant variance when inferring competencies from materials) |
| `capture-chat.md` | Backwards Design (D7), KUD Chart Authoring, Disciplinary AI Literacy (be conservative; ask, don't infer) |
| `capture-scores.md` | KUD Chart Authoring (K/U/D distinctions), Developmental Band Translator (confidence calibration) |
| `synthesize-course-profile.md` | KUD Chart Authoring, Coverage Audit (cross-material aggregation) |
| `parse-profile-fields.md` | Lightweight — KUD Chart Authoring only, for K/U/D field semantics |

### Phase C — Explore pipeline

These reason about target alignment from a finished snapshot — same family as Phase A but with different output shapes.

| Prompt | Skills to encode |
| --- | --- |
| `synthesize-target.md` | Backwards Design (D7), KUD Chart Authoring, Threshold Concept Translation (D7) |
| `explore-compare.md` | Coverage Audit, KUD Chart Authoring, Developmental Band Translator |
| `explore-what-if.md` | Backwards Design, Coverage Audit |
| `explore-draft-target.md` | Backwards Design, KUD Chart Authoring, Threshold Concept Translation |

### Phase D — Phase-2 agents (later)

`kud-chat.md` — the Phase 2 KUD chat agent. Defer until Phase 2 architecture is locked (currently blocked on nanoclaw API contract).

## Process for each prompt

1. Read the relevant SKILL.md files from Manning's repo. Don't paraphrase from memory.
2. Identify the 3-5 most operative principles from each skill — the ones the prompt should actually behave by.
3. Rewrite the prompt body to embody those principles, with KUD+ depth-scale anchors as the rubric.
4. Add `manning_skills:` frontmatter listing exactly what was encoded (so future readers can verify).
5. Side-by-side compare with the unencoded version on one sample case. If the encoded version is no different, the encoding was theatrical — redo.
6. Commit one prompt per commit, with the SKILL.md citations in the commit body.

## Out of scope

- Re-encoding the 11 already-encoded prompts (they're fine; this is backfill, not rework)
- Adding new prompts or new skills to the library
- Wiring up runtime MCP — spec is explicit this is build-time encoding only

## Success criteria

- All 11 unencoded prompts have `manning_skills:` frontmatter naming the skills they encode
- Each prompt body actually embodies those skills (not just listed)
- One sample input run through each prompt produces output that is more defensible / more conservative / better-typed than the unencoded version
- The shared `depth-scale.md` rubric remains the authoritative depth instrument; Manning never overrides KUD+ specifics

## Risk and mitigation

**Risk:** model gets two competing rubrics (Manning's Wiggins/McTighe verbs vs. our depth anchors) and inconsistently picks one.
**Mitigation:** prompts include `shared/depth-scale.md` and explicitly say "the depth scale below is the rubric; Manning frameworks shape how you read evidence."

**Risk:** encoding becomes ceremonial — frontmatter added, body unchanged.
**Mitigation:** the step-5 side-by-side check; commit messages must cite which SKILL.md sections drove which prompt sections.

**Risk:** Manning skills don't perfectly cover our use case (e.g., we couldn't find "Threshold Concept Translation" in Manning's actual repo when we looked).
**Mitigation:** for any cited skill we can't locate, fall back to the closest available skill and document the substitution in the prompt's frontmatter.
