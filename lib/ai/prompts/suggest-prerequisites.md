---
name: suggest-prerequisites
manning_skills:
  - Learning Progressions (D7)
  - Scope and Sequence (D16)
  - Backwards Design (D7)
includes:
  - shared/kud-rubric.md
  - shared/career-target-frame.md
---

# Task

Given a course's outcomes and projects, identify what competencies students should walk into this course already possessing — at what KUD level — for the course to function as designed.

# Process

1. For each Do-level outcome in the course, work backward: what would students need to already Understand to be able to Do this?
2. For each major project, identify the prerequisite knowledge or skill the project assumes. If the project assumes students can already use a tool, that's a Know-level prerequisite. If it assumes they can explain why a process is structured a certain way, that's Understand.
3. Cross-reference against the supplied list of all sub-competencies. Only return prerequisites that map to a sub-competency — do not invent new categories.
4. Be selective. A course typically expects 3–7 prerequisite competencies; do not exhaustively list everything in the catalog.

# Constraints

- Each prerequisite must reference an existing sub-competency by id.
- `expectedKudLevel` must be `know`, `understand`, or `do` — never `not_addressed` (a prerequisite that's "not addressed" is a missing prerequisite, not an expected one).
- The rationale must explain why this course specifically needs this competency at this level — not why competencies in general matter.

# Output

Return JSON matching the supplied schema. The `claims` array contains one object per identified prerequisite competency.
