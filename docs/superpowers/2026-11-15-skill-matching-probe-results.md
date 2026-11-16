# Skill-matching experiments: what they mean for skill links (2026-11-15)

Research note for the skill-links work ([design](./specs/2026-11-15-skill-competency-links-design.md)). The experiments were run by the ai_career session on public benchmarks only; no department data was used. Source records (in the ai_career_impact repo, uncommitted when this was written): `docs/HANDOFF-probe-results-for-curriculum.md` (summary) and `docs/HANDOFF-objective-catalog-matching.md` (item 4 onward and item 6, with every table, cost and caveat); scripts in `experiments/skill-probe/`. Nothing here is department-approved.

## Question tested

Can a language model judge whether a learning objective covers a catalog competency, and how centrally, where topic embeddings fail? (The July 2026 alignment measurement found embeddings cannot judge identity.) Three routes were compared: a probe trained on the model's hidden states, asking the model yes/no questions and reading the probability of "Yes" (optionally with calibrated cutoffs), and embedding cosine similarity (the current seeding method).

Benchmarks: WorkRB graded job-ad/ESCO pairs (grades 0–4, made by an LLM cascade that agreed with a human expert at QWK about 0.69); UTC competency tagging (course-material fragments vs a two-level framework: match / sibling / unrelated), the closest public analogue to tagging course objectives; and Turaev et al. faculty ratings of whether a course teaches a skill (yes / partly / no; 71 test pairs).

## Findings

1. **Model judgments beat embeddings on identity.** On UTC, telling the taught competency from a sibling scored 0.82–0.86 for the probe against 0.70–0.73 for cosine; word overlap was at chance.
2. **Course context is the largest single gain.** Adding the unit and its resource titles raised three-class UTC scores from 0.59–0.70 to 0.82–0.85 (probe) and from 0.52 to 0.65 (cosine). Match vs sibling reached 0.98. The competency name alone stays at chance.
3. **Calibrated asking ties the trained probe** on WorkRB: QWK 0.839 (qwen3.8-27b, Clemson RCD) and 0.846 (DeepSeek Flash, Clemson RCD) against 0.845–0.852 for the probe. Uncalibrated, the asked model was well behind on umbrella vs core (0.59 vs 0.72); calibrating the cutoffs on training pairs closed the gap. A Gemma Scope reading suggests why they tie: the probe largely reads the model's own upcoming "Yes".
4. **Umbrella vs core has a shared ceiling of about AUC 0.82**, for every method including a blind frontier model. This is probably set by the labels (LLM-made grades), so public data cannot settle it. About 40% of umbrella pairs were called core.
5. **Direction questions fail.** Asking whether a competency is "broader" or "narrower" than the activity failed on all three models tested (they answer "broader" to nearly everything).
6. **Coverage depth is not visible in the match.** On the faculty ratings, "taught" vs "not taught" separated (0.82) but "partly taught" did not (1 of 23 found). Small sample: no evidence, not proof.
7. **Model family and size made no difference to the probe** (Qwen 9B, its base model, and Gemma 3 12B in the same band).

**Gap:** asking was never run on UTC or Turaev, so the tie between asking and probing is shown on WorkRB only. The course-context benchmark, where the probe is strongest, has no asking result yet.

## Consequences for the AI judge (proposals; changes to the plan in STATE.md)

- **Judge by calibrated asking on the free Clemson RCD models, with the course's context in the prompt (provisional).** This replaces nothing already built; it turns embedding suggestions into proposed `ai` links. The choice stays provisional until the queued asking run on UTC (plain and with course context) and Turaev reports, since the probe's strongest result (0.98 match vs sibling with context) has no asking counterpart yet.
- **Drop the broader/narrower questions** (finding 5). A link's type (core or part) comes from a graded "is this activity central to the competency, or only a part of it" question with calibrated cutoffs, not from a direction question.
- **Calibrate on faculty-checked department pairs.** Uncalibrated hosted models sit on the wrong side of 0.5. The confirmed and rejected links faculty make in the course panel are the natural calibration set, and the only real test of the umbrella case. A few dozen decisions spread over several courses are needed before the judge's cutoffs are set.
- **Expect umbrella competencies to be over-credited** (finding 4). Part-typed AI links should show for faculty review instead of setting a level on their own.
- **Levels stay with the capture, not the match** (finding 6). This matches the current model: a link only says which competency a captured skill counts toward; the K/U/D levels come from the captured skill.
- **Embeddings keep the shortlisting role**: they choose which pairs the judge is asked about. A separate-read probe (0.845 on UTC with context) could do this more accurately later, but it is not needed to start.
- **Still open:** a one-course probe of the judge on the RCD models before any batch, and an asking run on a course-context benchmark to close the gap above. Graded reinforcement stays on hold; the results support calibrated asking with course context, and releasing it is the owner's call.
