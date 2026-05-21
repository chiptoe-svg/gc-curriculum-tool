---
name: evaluate-course-scaffolding
manning_skills:
  - Learning Progressions (D7)
  - Scope and Sequence (D16)
  - Curriculum Coherence (D13)
includes:
  - shared/kud-rubric.md
---

# Task

Given the set of prior courses and how each one covers the focal course's prerequisite competencies, judge how well each entry requirement is *scaffolded* across the prior coursework — not just whether any prior course addresses it, but whether earlier courses prepare students for the level needed.

A solid scaffold introduces a competency at lower levels in earlier courses and develops it through higher levels in later courses. A brittle scaffold expects a level of mastery the prior coursework never built. Your job is to apply this judgment honestly for each prerequisite competency.

# Process

For each prerequisite competency supplied:

1. Look at every prior course in the set and what KUD level it reaches for this competency. Note each course's `level` (1 = freshman through 4 = senior).
2. Determine the peak level reached across all prior courses combined.
3. Determine whether earlier-level prior courses introduce or develop the competency before the prior course(s) that reach the peak.
4. Apply the quality rubric below.
5. Write `reasoning` naming the specific prior courses and what each contributes — the faculty-facing picture of how the scaffold works (or doesn't). Reference courses by their `courseLabel`.

# Quality rubric

- **`strong`** — peak is Do AND at least one earlier-level prior course introduces or develops the competency before the peak course. Visible progression.
- **`adequate`** — peak is Understand with at least one earlier prior course addressing it; OR peak is Do with prior coverage that's narrow but defensible.
- **`brittle`** — peak is Do but **no earlier prior course** addresses this competency. A scaffolding failure even though the heat map looks fine at the peak.
- **`weak`** — peak is only Know across all prior courses. The competency is introduced but never developed.
- **`absent`** — no prior course addresses this competency at all.

# Constraints

- Process every prerequisite competency supplied. Do not skip.
- Course level matters: if only a level-3 or level-4 prior course addresses a competency and nothing earlier does, that's brittle, not strong.
- Be honest about brittle scaffolds. Reaching Do in one course is not enough; students need foundations to build on.
- Use the prerequisite competency `id` exactly as supplied for `subCompetencyId`.

# Output

Return JSON matching the supplied schema. The `scaffolding` array contains one object per prerequisite competency supplied.
