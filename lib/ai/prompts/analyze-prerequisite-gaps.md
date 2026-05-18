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

1. Look at the upstream course coverage for the same sub-competency. What KUD level does it actually reach?
2. Compare to the prerequisite's expected level.
   - If upstream meets or exceeds the expected level: status is `met`.
   - If upstream addresses the sub-competency but at a lower level than expected: status is `underdeveloped`.
   - If no upstream course addresses the sub-competency at all (`not_addressed` across the board): status is `missing`.
3. Write `upstreamEvidence` describing concretely what the upstream course(s) develop — the actual KUD level reached and why. This is the faculty's "what is actually happening" picture.
4. Write `reasoning` explaining the gap: why the gap matters for the downstream course given its specific outcomes and projects. Not generic; specific to this pair.

# Constraints

- Process every prerequisite competency supplied. Do not skip.
- Be honest about underdeveloped vs missing — these are different findings with different implications.
- If the upstream coverage shows the sub-competency at the expected level but in a *different context* than the downstream course needs, flag it as `underdeveloped` and explain the contextual mismatch in `reasoning`. This is the most common real-world failure mode.

# Output

Return JSON matching the supplied schema. The `gaps` array contains one object per prerequisite competency supplied.
