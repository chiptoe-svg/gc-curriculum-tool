---
name: synthesize-course-profile
manning_skills:
  - Coverage Audit (curriculum-alignment)
  - KUD Chart Authoring (curriculum-alignment)
  - Backwards Design Unit Planner (curriculum-assessment)
---

# Task

You are synthesizing per-file analysis findings from multiple course assignment materials into an evidence-grounded course profile. The profile describes what this course *actually* develops — based on real assignments — not just what the catalog says it covers.

# How to reason about this task

Two Manning-derived disciplines govern this synthesis:

1. **This is a coverage audit, not a summary.** The `catalogDivergence` block applies Webb-style coverage-audit logic across two axes: catalog (intended curriculum) and assignment materials (enacted curriculum). Each catalog claim gets classified — *reinforced* (direct evidence in assignments), *gaps* (no evidence), or *additions* (evidence of things not claimed). Be honest about gaps: if no assignment requires it, it's a gap regardless of how foundational the catalog says it is. Conservative classification: when in doubt between *reinforced* and *gap*, lean *gap* and let the instructor push back.

2. **Backwards Design for the learning-objectives layer.** Per Wiggins & McTighe: objectives should follow from the assessment evidence, not precede it. When you produce `learningObjectives`, work from what assignments *actually require students to do* (Stage 2 evidence) → toward objective statements (Stage 1 desired results). An objective with no assignment evidence behind it is a Stage-1/Stage-2 misalignment; omit it rather than carry it forward.

# Inputs you will receive

The user message contains:

1. Course context: course code, title, level (1–4), track, catalog description, catalog learning objectives, and catalog skills required.
2. Per-file findings: an array of `analysisFinding` objects (one per uploaded material). Each finding has: `fileName`, `materialType`, `competencies` (with `evidenceQuotes`), `skills`, and `notes`.

# Output fields

- `summary`: 2–4 sentences describing what the course actually develops, grounded in the assignments. Focus on the highest-stakes competencies and what students must demonstrably *do*.
- `learningObjectives`: a flat list of learning objective strings, derived from the assignment evidence. These should be action-verb statements ("Operate a multi-color press through make-ready and a 10k-impression run"). Aim for 3–8 objectives that cover the scope of the materials without duplication. **Use Wiggins/McTighe action verbs (analyze, evaluate, create, operate, prepare). Avoid vague verbs (*understand*, *know*, *appreciate*) — they fail the Stage 2 assessability test.**
- `skills`: a deduplicated flat list of specific technical or professional skills evidenced across all materials. Normalize variants ("color mgmt" → "Color management").
- `competencies`: an array of competency objects with evidence chains. Merge competencies that appear across multiple files under a single name (match on normalized `name`). For each merged competency:
  - `name`: the normalized short label.
  - `description`: one sentence synthesizing what the course requires of students in this area. **Frame as a performance (the KUD Chart Authoring "Do" discipline) — what artifact or act the student produces, not what topic they encounter.**
  - `level`: your best judgment of the proficiency level this course targets for this competency. Use one of: `introduced`, `developed`, or `mastered`. Base this on assignment complexity, not catalog level.
  - `evidence`: an array of `{ fileName, quote }` objects — the best 1–3 verbatim quotes across all files, one per source file where possible.
- `catalogDivergence`:
  - `reinforced`: catalog objectives or skills that the assignments **actively evidence** (verbatim or close paraphrase of the catalog text). This is the *direct* match tier from coverage-audit logic.
  - `additions`: competencies or skills the assignments evidence that are **not** in the catalog (new ground the assignments cover beyond what's cataloged). These are honest findings worth surfacing — the assignments are evidence the course really does this; the catalog hasn't caught up.
  - `gaps`: catalog objectives or skills that the assignments do **not** evidence (catalog claims the course covers these, but no assignment requires them). This is the coverage-audit *none* tier. **Each gap is a finding worth surfacing.** Do not soften them.

# Constraints

- **Base everything on the per-file findings.** Do not invent competencies from your knowledge of Graphic Communications or press operation. (Construct-validity rule: extracted competencies must trace to evidence in the supplied findings, not to your domain prior.)
- **For `catalogDivergence`, compare against the catalog fields supplied in the course context** — not against general industry knowledge.
- **If only one file was analyzed, the profile will be narrow; that is correct.** Do not pad it. (Sparse-input honesty — better a defensible narrow profile than an inflated speculative one.)
- **Keep `learningObjectives` as concrete and measurable as the evidence allows.** Avoid vague verbs like "understand" or "appreciate." These objectives must be assessable in principle (Stage 2 alignment); if you can't picture how an assignment would evidence them, they're too vague.
- **Merge discipline:** when the same competency appears in multiple files with slightly different framings, the merged description should be the *most specific* synthesis that all the evidence supports — not the *broadest* one that covers all evidence. Breadth-by-merge dilutes evidence value.
