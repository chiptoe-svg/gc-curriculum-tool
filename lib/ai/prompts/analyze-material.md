---
name: analyze-material
manning_skills:
  - KUD Chart Authoring (curriculum-alignment)
  - Assessment Validity Checker (curriculum-assessment)
---

# Task

You are analyzing a single course assignment material (a rubric, worksheet, exam, project brief, or stated expectation document) from a Graphic Communications course. Your job is to classify the material and extract the competencies and skills it evidences, grounded in direct quotes from the document.

# How to reason about this task

A course material is *direct evidence* of what the course requires students to demonstrate. You are reading it as evidence, not as intent. Two principles govern:

1. **Extract specific testable elements, not topics.** Per the KUD Chart Authoring discipline: each competency you record must be a specific capability you could write an assessment item from — not a topic or theme. "Color management" alone is a topic; "Color-manage a print project across CMYK and spot-color channels with verified profiles" is a competency. When the material is vague, prefer extracting fewer, more specific competencies over many topic-level ones.

2. **Match the construct, not incidental features.** Per Assessment Validity Checker (Messick / Wiliam): a material's rubric may include criteria that measure constructs other than what the assignment is "about" — most commonly, *construct-irrelevant variance* from writing quality, formatting, or punctuality. If a project rubric weights "writing mechanics" alongside the technical work, the technical competency is evidenced by the technical criteria, and the writing weight evidences a Communication foundational *only if* it's substantive enough to count. Don't double-count by listing every rubric line as a separate competency.

# Inputs you will receive

The user message contains:

1. Course context: the course code, title, level (1–4), track, and catalog description.
2. File name: the original upload name, which may hint at the material type.
3. Extracted text: the full text content of the document.

# Output fields

- `materialType`: one short string classifying the document. Use one of: `rubric`, `exam`, `worksheet`, `project_brief`, `syllabus_section`, `lab_instructions`, `expectations_document`, or `other` — pick the closest match.
- `competencies`: an array of competency objects the document evidences. For each:
  - `name`: a short, noun-phrase label (e.g., "Color management", "Press make-ready").
  - `description`: one sentence explaining what the document expects students to be able to **do** with this competency. Frame as a performance, not a topic.
  - `evidenceQuotes`: 1–3 short verbatim or near-verbatim excerpts from the document that demonstrate the competency is required. Quotes must come directly from the text — do not paraphrase.
- `skills`: flat list of specific technical or professional skills the document names or clearly requires (e.g., "Spectrophotometry", "Pantone Live", "InDesign preflight"). Normalize obvious variants ("color mgmt" → "Color management").
- `notes`: one sentence (or empty string) flagging anything unusual — e.g., "This document is a grading rubric only; no assignment prompt is included" or "Text appears truncated after page 3."

# Constraints

- **Only extract what the document actually requires of students.** Do not infer competencies from the course title or catalog description. This is the construct-validity rule applied at extraction.
- **Quotes must be verbatim** (light cleanup for OCR artifacts only). Never fabricate a quote.
- **Competency names should be reusable across materials in the same course** — if two rubrics both test "Color management," name it identically so the downstream synthesis can merge them.
- **Watch for construct-irrelevant variance.** A presentation rubric weighting "eye contact" evidences a Communication-foundational facet, not a separate competency. A rubric whose largest weights are on writing mechanics may be telling you more about Communication than about the assignment's nominal technical content — flag this in `notes` if it's the dominant pattern.
- **If the document is too sparse to identify any competencies, return empty arrays** and explain in `notes`. Padding with topic-level guesses degrades the snapshot.
- **In the `notes` field, explicitly flag any images, diagrams, charts, figures, or tables you can see in the document but cannot fully describe in text.** Example: "This rubric includes a grading matrix as an image table; exact point values may not be fully captured." If no such elements are present, `notes` may be empty.
