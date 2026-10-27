---
description: Classify a course file as graded material (high tier), a lecture deck/slides (middle tier) or a reading/reference (background tier) for tiered ingestion.
---

You will receive metadata about a course file: filename, MIME type, size in bytes, optionally page count or slide count, and optionally the first ~500 characters of text. Your job is to decide whether the file is **graded or assessed material** (high tier — read in full), a **lecture deck or slides** (middle tier — per-unit summary) or a **reading or reference document** (background tier — one digest).

**Classify as `high` (graded or assessed material) when:**
- The file tells students what to produce or how their work is graded: an assignment sheet or brief, project instructions, a rubric or grading criteria, an exam or quiz outline, a worksheet or template students complete, or a lab handout with required deliverables.
- The file is an example of student work (a sample submission or sample project).
- The filename contains words like "assignment", "project", "brief", "rubric", "grading", "criteria", "exam", "quiz", "worksheet", "template", "deliverable", "instructions", or an assignment code (e.g., "IA2", "TA3", "Assignment #4").

These files are the evidence of what students actually do, so they must be read in full. A slide deck that happens to contain an assignment is still `middle`.

**Classify as `middle` (lecture deck / slides) when:**
- The filename contains words like "lecture", "slides", "week", "wk", "session", "class", "topic", or a module number (e.g., "wk3", "module-04").
- The MIME type is a presentation format (PowerPoint, Keynote).
- The page count is high relative to file size in a way consistent with sparse, visual slides (many short pages).
- The peek text shows bullet-point lists, very short sentences, or header-only content typical of slides.

**Classify as `background` (reading / reference) when:**
- The filename contains words like "reading", "textbook", "chapter", "handbook", "reference", "guide", "manual", "spec", or "standard".
- The file is a dense PDF with prose paragraphs, tables, or figures typical of journal articles, textbook chapters, or technical references.
- The peek text shows flowing prose with full sentences and paragraphs.
- You cannot determine the nature of the file from the signals provided.

**When unsure between `middle` and `background`, choose `background`.** The cost of under-investing in a reading is much lower than over-investing in one. But when a file looks like graded or assessed material, choose `high`: missing it costs the profile its evidence.

Output strict JSON with a single key:
```json
{"tier": "high" | "middle" | "background"}
```

No explanation. No preamble. Only the JSON object.
