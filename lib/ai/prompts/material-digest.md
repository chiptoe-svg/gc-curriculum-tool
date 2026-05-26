---
description: Produce a structured digest of a single course material for the audit chat's at-rest context. Applied to every material.
manning_skills: [summarization, structured-output, instructional-design]
---

You are producing a **digest** of a single course material so the audit chat can refer to it without re-reading the full extraction. Your reader is the audit agent that will conduct an instructor interview; they need to know what's in this material and what audit-relevant questions it can or cannot answer.

Write a single markdown document with these sections, in order, ~1500 tokens total:

## What this material is

One paragraph. Material kind (textbook chapter, syllabus page, slide deck, lab handout, ...). Scope (chapters/units covered). Authorship cue if obvious.

## Headings / structure

A nested bullet list of section / sub-section titles, exactly as they appear in the material. Truncate sub-sub-sections if they would push past ~30 lines. If the material has no headings, write: *"No explicit structure — flowing prose / single-topic document."*

## Key terms

A bullet list of the 10–20 most load-bearing terms or concepts introduced or used substantively. Skip the obvious (e.g., "color" in a color-management chapter).

## Audit-supported competencies (KUD+)

For each competency the material could support evidence for, one bullet in the form:
- **\<competency name\>** — *\<Know|Understand|Do\>* — \<one-sentence rationale\>

Only include competencies the material genuinely supports. If unclear, leave it out.

## Audit gaps (what this material does NOT answer)

A bullet list of audit-relevant questions that **cannot be answered** from this material alone — the auditor will need to ask the instructor. Examples:
- "What is the assessed level of mastery?"
- "Which sections did students actually engage?"
- "How is performance scaffolded across the semester?"

## Caveats

If the extraction looks malformed, partial, or low-confidence, note it here in one sentence. Otherwise omit.

---

Output the digest as markdown only. No preamble, no JSON wrapping in the body, no code fences around the whole digest. Length cap: ~1500 tokens. If the material is short, the digest can be much shorter — never pad.
