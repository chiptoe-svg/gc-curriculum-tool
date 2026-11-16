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
6. **Partial coverage: the probe cannot see it, asking can.** On the faculty ratings the probe separated "taught" from "not taught" (0.82) but not "partly taught" (1 of 23 found; partly vs not, AUC 0.53). Asked directly, the RCD models separated partly from not taught at AUC 0.79–0.83 (qwen three-level 0.667 vs the probe's 0.462). 71 test pairs, so indicative only.
7. **Model family and size made no difference to the probe** (Qwen 9B, its base model, and Gemma 3 12B in the same band).

## Asking on the course-fragment and faculty-rating benchmarks (same day)

The first results showed the asking/probe tie on WorkRB only. Calibrated asking (both RCD models, two yes/no questions per pair, cutoffs fitted on the training split) was then run on the same UTC and Turaev test pairs as the probes:

- **UTC with course context, match vs sibling:** asking 0.911 (qwen3.8-27b) / 0.906 (DeepSeek Flash), ranking AUC 0.98; probe 0.979. Asking ranks as well as the probe; the remaining gap is in where the cutoff falls, not in the ranking.
- **UTC without context, match vs sibling:** asking 0.849 / 0.865; probe 0.823. Asking is better.
- **UTC three-level (match / sibling / unrelated):** asking 0.60–0.64; probe 0.82–0.85 with context. Asking calls most siblings "unrelated": the model's sense of "same subject area" is not the framework's.
- **Turaev, partly vs not taught:** asking AUC 0.79–0.83; probe 0.53 (finding 6).
- **Calibration caveat:** qwen often returns P(yes) of exactly 0, which drove several fitted cutoffs to 0.000. Cutting on log-odds or rank is sturdier than cutting on raw probability.

## Consequences for the AI judge (proposals; changes to the plan in STATE.md)

- **Judge by calibrated asking on the free Clemson RCD models, with the course's context in the prompt.** The match decision holds on all three benchmarks. This replaces nothing already built; it turns embedding suggestions into proposed `ai` links. The method is recommended, and settling it is the owner's decision.
- **Drop the broader/narrower questions** (finding 5). A link's type (core or part) comes from a graded "fully / partly / not" question with calibrated cutoffs, which asking can answer (finding 6), not from a direction question.
- **Do not ask the model whether two competencies are neighbors.** It does not share the framework's sense of a subject area. Where the builder needs that relation, take it from the catalog's own areas.
- **Calibrate on faculty-checked department pairs, cutting on log-odds or rank.** Uncalibrated hosted models sit on the wrong side of 0.5, and raw probabilities of exactly 0 make raw-probability cutoffs fragile. The confirmed and rejected links faculty make in the course panel are the natural calibration set, and the only real test of the umbrella case. A few dozen decisions spread over several courses are needed before the judge's cutoffs are set.
- **Expect umbrella competencies to be over-credited** (finding 4). Part-typed AI links should show for faculty review instead of setting a level on their own.
- **Levels stay with the capture.** A link says which competency a captured skill counts toward, and the K/U/D levels come from the captured skill. Asking's fully / partly / not grade types the link; it does not set a level.
- **Embeddings keep the shortlisting role**: they choose which pairs the judge is asked about. A separate-read probe (0.845 on UTC with context) could do this more accurately later, but it is not needed to start.
- **Still open:** a one-course probe of the judge on the RCD models before any batch. Graded reinforcement stays on hold; the results support calibrated asking with course context, and releasing it is the owner's call.
