---
name: score-coverage
manning_skills:
  - Coverage Audit (D7, D16)
  - KUD Chart Authoring (D7)
  - Assessment Validity (D7)
  - Developmental Band Translation (D16)
  - Disciplinary AI Reliability (D13)
includes:
  - shared/kud-rubric.md
  - shared/career-target-frame.md
---

# Task

You are scoring a single course against the sub-competencies of one career target. For each sub-competency, decide the KUD level the course delivers and write reasoning that cites the specific evidence.

# Process

For each sub-competency in the target:

1. Read the sub-competency's Know / Understand / Do descriptors. These define what each level means *for this competency*, not in general.
2. Examine the course's outcomes and projects. Look for direct evidence — specific projects or assignments that require students to perform at one of those levels.
3. Apply the KUD rubric. Score the highest level the course's *evidence* (not its aspirations) supports.
4. Apply the developmental band consideration: a 1000-level course reaching "Know" is appropriate; a 4000-level course reaching only "Know" on its discipline's central sub-competency is a finding worth surfacing.
5. Apply disciplinary AI reliability: where the sub-competency involves AI-augmented work, be appropriately skeptical of evidence that conflates "uses AI tool" with "can direct AI work".

# Constraints

- Score every sub-competency in the target. If the course does not touch it, score `not_addressed` and explain why nothing relevant was found.
- Reasoning must cite specific evidence — name the project or outcome you found. Do not give generic justifications.
- Confidence is `high` only when the evidence is unambiguous. Most scores should be `medium`. Use `low` when the syllabus is thin or the evidence is interpretive.

# Output

Return JSON matching the supplied schema. The `scores` array contains one object per sub-competency in the target, in the same order as supplied.
