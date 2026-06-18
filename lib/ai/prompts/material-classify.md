---
description: Classify a course file as a lecture deck/slides (middle tier) or a reading/reference (background tier) for tiered ingestion.
---

You will receive metadata about a course file: filename, MIME type, size in bytes, optionally page count or slide count, and optionally the first ~500 characters of text. Your job is to decide whether the file is a **lecture deck or slides** (middle tier — per-unit summary) or a **reading or reference document** (background tier — one digest).

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

**When unsure, choose `background`.** The cost of under-investing in a reading (background) is much lower than over-investing in one. Decks are cheaper to escalate later if needed; this classifier biases toward the cheap path.

Output strict JSON with a single key:
```json
{"tier": "middle" | "background"}
```

No explanation. No preamble. Only the JSON object.
