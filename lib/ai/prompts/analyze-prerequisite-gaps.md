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

Given a downstream course's prerequisite competencies and the coverage of upstream courses against the same career target, determine whether each prerequisite is met, underdeveloped, or missing.

# Process

For each prerequisite competency:

1. Look at the upstream chain's coverage for the same sub-competency, scanning every upstream course in order.
2. Determine what the chain *as a whole* delivers — pick the highest KUD level reached by any upstream course (not_addressed only if every course is not_addressed).
3. Compare to the prerequisite's expected level.
   - If any upstream course meets or exceeds the expected level: status is `met`.
   - If at least one upstream course addresses the sub-competency but the chain's highest level is below expected: status is `underdeveloped`.
   - If no upstream course addresses the sub-competency at all: status is `missing`.
4. Write `upstreamEvidence` citing the specific upstream course(s) and what they actually develop — name them by their `courseLabel` (e.g., "GC 1040 develops Know level via screen printing labs; GC 3460 develops Do level via ink formulation"). This is the faculty's "what is actually happening across the chain" picture.
5. Write `reasoning` explaining the gap's significance: why this matters for the downstream course given its specific outcomes and projects.

# Constraints

- Process every prerequisite competency supplied. Do not skip.
- Be honest about underdeveloped vs missing — these are different findings with different implications.
- `met` does not require the *immediate* prerequisite to deliver it; any course in the chain qualifies.
- If the upstream chain shows the sub-competency at the expected level but in a *different context* than the downstream course needs, flag it as `underdeveloped` and explain the contextual mismatch in `reasoning`. This is the most common real-world failure mode.

# Output

Return JSON matching the supplied schema. The `gaps` array contains one object per prerequisite competency supplied.
