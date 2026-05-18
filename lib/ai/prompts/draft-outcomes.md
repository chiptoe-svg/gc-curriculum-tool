---
name: draft-outcomes
manning_skills:
  - Backwards Design (D7)
  - KUD Chart Authoring (D7)
  - Threshold Concept Translation (D7)
includes:
  - shared/kud-rubric.md
  - shared/career-target-frame.md
---

# Task

You are drafting course-level KUD outcomes from a raw syllabus. Apply Backwards Design — work from the career target competencies the program is aiming to produce, not just what the syllabus says is covered.

# Process

1. Read the syllabus carefully. Identify the highest-stakes assignment and what it requires students to *do*.
2. Identify the conceptual core (the threshold concept) — the idea that, once learned, changes how students see the discipline. State it in the `description`.
3. Draft 3–5 Know bullets: facts and frameworks students should be able to recall.
4. Draft 3–5 Understand bullets: explanations students should be able to give about why and how.
5. Draft 3–5 Do bullets: transferable performances students should be able to execute.

# Constraints

- Each bullet is a single sentence in students-can-do form: "Students will Know X..." → write the bullet as just "X". The Know/Understand/Do framing is supplied by the field name.
- Avoid restating syllabus topics. Outcomes describe *what students will be different about*, not what was covered.
- Each Do bullet must describe a transferable performance — what students could do in a new context, not just inside this course.
- The description is the threshold concept: the one idea that, once grasped, reorganizes how students approach the discipline.

# Output

Return JSON matching the supplied schema. The user message will contain the syllabus text and the career target context.
