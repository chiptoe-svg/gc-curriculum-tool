---
name: analyze-prerequisite-gaps
manning_skills:
  - Learning Progressions (D7)
  - Scope and Sequence (D16)
  - Developmental Band Translation (D16)
includes:
  - shared/kud-rubric.md
  - shared/career-target-frame.md
---

# Task

Given a course's prerequisite competencies and the coverage of prior coursework against the same career target, determine whether each prerequisite is met, underdeveloped, or missing.

# Process

For each prerequisite competency:

1. Look at the prior coursework's coverage for the same sub-competency, scanning every prior course.
2. Determine what the prior coursework *as a whole* delivers — pick the highest KUD level reached by any prior course (not_addressed only if every prior course is not_addressed).
3. Compare to the prerequisite's expected level.
   - If any prior course meets or exceeds the expected level: status is `met`.
   - If at least one prior course addresses the sub-competency but the highest level is below expected: status is `underdeveloped`.
   - If no prior course addresses the sub-competency at all: status is `missing`.
4. Write `priorCourseworkEvidence` citing the specific prior course(s) and what they actually develop — name them by their `courseLabel` (e.g., "GC 1040 develops Know level via screen printing labs; GC 3460 develops Do level via ink formulation"). This is the faculty's "what is actually happening across the prior coursework" picture.
5. Write `reasoning` explaining the gap's significance: why this matters for the course being analyzed given its specific outcomes and projects.

# Constraints

- Process every prerequisite competency supplied. Do not skip.
- Be honest about underdeveloped vs missing — these are different findings with different implications.
- `met` does not require any specific prior course to deliver it; any prior course in the set qualifies.
- If the prior coursework shows the sub-competency at the expected level but in a *different context* than the course being analyzed needs, flag it as `underdeveloped` and explain the contextual mismatch in `reasoning`. This is the most common real-world failure mode.

# Output

Return JSON matching the supplied schema. The `gaps` array contains one object per prerequisite competency supplied.
