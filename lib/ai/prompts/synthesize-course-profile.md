---
name: synthesize-course-profile
---

# Task

You are synthesizing per-file analysis findings from multiple course assignment materials into an evidence-grounded course profile. The profile describes what this course *actually* develops — based on real assignments — not just what the catalog says it covers.

# Inputs you will receive

The user message contains:

1. Course context: course code, title, level (1–4), track, catalog description, catalog learning objectives, and catalog skills required.
2. Per-file findings: an array of `analysisFinding` objects (one per uploaded material). Each finding has: `fileName`, `materialType`, `competencies` (with `evidenceQuotes`), `skills`, and `notes`.

# Output fields

- `summary`: 2–4 sentences describing what the course actually develops, grounded in the assignments. Focus on the highest-stakes competencies and what students must demonstrably *do*.
- `learningObjectives`: a flat list of learning objective strings, derived from the assignment evidence. These should be action-verb statements ("Operate a multi-color press through make-ready and a 10k-impression run"). Aim for 3–8 objectives that cover the scope of the materials without duplication.
- `skills`: a deduplicated flat list of specific technical or professional skills evidenced across all materials. Normalize variants ("color mgmt" → "Color management").
- `competencies`: an array of competency objects with evidence chains. Merge competencies that appear across multiple files under a single name (match on normalized `name`). For each merged competency:
  - `name`: the normalized short label.
  - `description`: one sentence synthesizing what the course requires of students in this area.
  - `level`: your best judgment of the proficiency level this course targets for this competency. Use one of: `introduced`, `developed`, or `mastered`. Base this on assignment complexity, not catalog level.
  - `evidence`: an array of `{ fileName, quote }` objects — the best 1–3 verbatim quotes across all files, one per source file where possible.
- `catalogDivergence`:
  - `reinforced`: catalog objectives or skills that the assignments actively evidence (verbatim or close paraphrase of the catalog text).
  - `additions`: competencies or skills the assignments evidence that are **not** in the catalog (new ground the assignments cover beyond what's cataloged).
  - `gaps`: catalog objectives or skills that the assignments do **not** evidence (catalog claims the course covers these, but no assignment requires them).

# Constraints

- Base everything on the per-file findings. Do not invent competencies from your knowledge of Graphic Communications or press operation.
- For `catalogDivergence`, compare against the catalog fields supplied in the course context — not against general industry knowledge.
- If only one file was analyzed, the profile will be narrow; that is correct. Do not pad it.
- Keep `learningObjectives` as concrete and measurable as the evidence allows. Avoid vague verbs like "understand" or "appreciate."
