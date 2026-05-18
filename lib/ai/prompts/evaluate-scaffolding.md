---
name: evaluate-scaffolding
manning_skills:
  - Learning Progressions (D7)
  - Scope and Sequence (D16)
  - Curriculum Coherence (D13)
includes:
  - shared/kud-rubric.md
  - shared/career-target-frame.md
---

# Task

Given a set of courses and how each one covers the sub-competencies of a career target, judge how well each sub-competency is *scaffolded* across the courses as a whole — not just whether one course reaches the peak level, but whether earlier courses prepare students for later courses.

A solid scaffold introduces a competency at lower levels in earlier courses and develops it through higher levels in later courses. A brittle scaffold expects mastery in an upper-division course without any preparation in earlier ones. Your job is to apply this judgment honestly, course by course.

# Process

For each sub-competency in the career target:

1. Look at every course in the set and what KUD level it reaches for this sub-competency. Note each course's `level` (1 = freshman through 4 = senior).
2. Determine the peak level reached across the set (the highest KUD level any course in the set delivers).
3. Determine whether earlier-level courses introduce or develop the sub-competency before the course(s) that reach the peak.
4. Apply the quality rubric below.
5. Write `reasoning` that names the specific courses you saw and what they each contribute — the faculty-facing "here is how it scaffolds (or doesn't) across these courses" picture. Reference courses by their `courseLabel` (e.g., "GC 1040 introduces it at Know; GC 3460 develops to Understand; GC 4060 expects Do — solid progression").

# Quality rubric

- **`strong`** — peak is Do, AND at least one earlier-level course introduces or develops the sub-competency before the peak course. The progression is visible.
- **`adequate`** — peak is Understand, with at least one earlier course addressing the sub-competency. Or peak is Do with prior coverage that's narrow but defensible. Students are prepared, but the curriculum could go deeper.
- **`brittle`** — peak is Do but **no earlier course** addresses the sub-competency. The peak course expects mastery of something never taught earlier — a scaffolding failure even though the heat map "looks fine" at the peak.
- **`weak`** — peak is only Know across the entire set, with no further development. The competency is introduced but never built on.
- **`absent`** — no course in the set addresses the sub-competency at all.

# Constraints

- Process every sub-competency in the career target. Do not skip.
- Course level matters: a sub-competency that only appears in level-4 courses with no level-1/2/3 preparation is **brittle**, not strong, even if it reaches Do.
- If the course being analyzed is the only one that reaches a high level, look hard at the prior coursework — that's where the scaffold should be visible. If it isn't, the scaffold is brittle.
- Be honest about brittle scaffolds. "It reaches Do somewhere" is not enough; the question is whether students walk into the Do-level course with foundations to build on.
- If a competency appears strongly in early courses but is never re-engaged, that's `weak`, not `adequate` — coverage without progression is a curricular dead end.

# Output

Return JSON matching the supplied schema. The `scaffolding` array contains one object per sub-competency in the career target.
