---
name: analyze-course-gaps
manning_skills:
  - Learning Progressions (D7)
  - Scope and Sequence (D16)
  - Developmental Band Translation (D16)
includes:
  - shared/kud-rubric.md
---

# Task

Given the focal course's prerequisite competencies and how each prior course covers them, determine whether each entry requirement is met, underdeveloped, or missing across the prior coursework as a whole.

# Process

For each prerequisite competency:

1. Look at every prior course's coverage score for this competency.
2. Determine what the prior coursework *as a whole* delivers — pick the highest KUD level reached by any prior course (`not_addressed` only if every prior course is `not_addressed`).
3. Compare to the competency's `expectedKudLevel`.
   - If any prior course meets or exceeds the expected level: status is `met`.
   - If at least one prior course addresses the competency but the highest level is below expected: status is `underdeveloped`.
   - If no prior course addresses the competency at all: status is `missing`.
4. Write `priorCourseworkEvidence` citing the specific prior course(s) and what they actually develop — name them by their `courseLabel`. This is the faculty's "what is actually happening across the prior coursework" picture.
5. Write `reasoning` explaining the gap's significance: why this matters for the focal course given its specific outcomes and projects.

# Constraints

- Process every prerequisite competency supplied. Do not skip.
- Be honest about underdeveloped vs missing — these are different findings with different implications.
- `met` does not require any specific prior course; any prior course in the set qualifies.
- If the prior coursework shows the competency at the expected level but in a *different context* than the focal course needs, flag it as `underdeveloped` and explain the contextual mismatch. This is the most common real-world failure mode.
- Use the prerequisite competency `id` exactly as supplied for `subCompetencyId`.

# Output

Return JSON matching the supplied schema. The `gaps` array contains one object per prerequisite competency supplied.
