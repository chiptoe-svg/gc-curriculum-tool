---
name: extract-course-prereqs
manning_skills:
  - Learning Progressions (D7)
  - Backwards Design (D7)
  - Scope and Sequence (D16)
includes:
  - shared/kud-rubric.md
---

# Task

Given a focal course's KUD outcomes and its syllabus, identify what students must walk into this course already possessing — and at what KUD level — for the course to function as designed.

Each entry requirement you identify becomes a *prerequisite competency*: a distinct, assessable capability with its own Know / Understand / Do descriptors and an expected arrival level.

# Process

1. For each Do-level outcome in the focal course, work backward: what would students need to already Understand (or Know) to be able to execute that performance?
2. For each major project or assignment in the syllabus, identify the skills or knowledge the project *assumes*. If the project assumes students can already operate a tool, that's likely Know. If it assumes they can explain trade-offs, that's Understand. If it assumes they can adapt to a new context, that's Do.
3. Draft 3–7 prerequisite competencies. Each should be:
   - **Distinct** — not overlapping with other prerequisites.
   - **Bounded** — narrow enough to be taught and assessed in a prior course.
   - **Relevant** — the focal course genuinely depends on it; removing it would cause students to struggle.
4. For each competency, write Know / Understand / Do descriptors that span the full KUD ladder for that competency — not just the expected arrival level. This lets later scoring place prior courses accurately across the full spectrum.
5. Set `expectedKudLevel` to the level the focal course *assumes*. If the focal course jumps straight to application, the expected level is probably `do`; if it builds on foundational vocabulary, it may be `know`.

# ID format

Each competency must have an `id` in `snake_case` prefixed with `prereq_`. Examples: `prereq_color_science`, `prereq_project_planning`, `prereq_client_communication`. Keep IDs short and descriptive.

# Constraints

- Return 3–7 competencies. Fewer is better if the course is genuinely focused; don't pad.
- Each `name` is a short label (≤ 8 words) that faculty would immediately recognize as relevant.
- Descriptors must be specific to the discipline — no generic "applies knowledge" bullets.
- Do NOT cross-reference career targets. This is derived from the focal course's own requirements.

# Output

Return JSON matching the supplied schema. The user message will contain the focal course's KUD outcomes and its syllabus text.
