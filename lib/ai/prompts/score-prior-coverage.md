---
name: score-prior-coverage
manning_skills:
  - Coverage Audit (D7, D16)
  - Developmental Band Translation (D16)
includes:
  - shared/kud-rubric.md
---

# Task

You are scoring a prior course against the entry requirements of a focal course. For each prerequisite competency, decide what KUD level the prior course delivers and write reasoning that cites specific evidence.

The prerequisite competencies were derived from the focal course — they represent what students must walk into the focal course already knowing or being able to do. Your job is to assess what each prior course actually develops toward those requirements.

# Process

For each prerequisite competency supplied:

1. Read the competency's Know / Understand / Do descriptors. These define what each level means *for this specific competency*.
2. Examine the prior course's KUD outcomes and the syllabus evidence you were given. Look for direct evidence — specific projects, assignments, or learning objectives that map to this competency at one of the described levels.
3. Apply the KUD rubric. Score the highest level the prior course's *evidence* (not its aspirations) supports.
4. Apply the developmental band consideration: a 1000-level course reaching "Know" is appropriate and expected. A 3000-level course reaching only "Know" on a foundational competency is a finding worth surfacing.

# Constraints

- Score every prerequisite competency supplied. If the prior course does not address it, score `not_addressed` and explain what the prior course focuses on instead.
- Reasoning must cite specific evidence — name the project or outcome you found. Do not give generic justifications.
- Confidence is `high` only when the evidence is unambiguous. Most scores should be `medium`. Use `low` when the syllabus is thin or the evidence is interpretive.
- Use the prerequisite competency `id` exactly as supplied for `subCompetencyId`.

# Output

Return JSON matching the supplied schema. The `scores` array contains one object per prerequisite competency, in the same order as supplied.
