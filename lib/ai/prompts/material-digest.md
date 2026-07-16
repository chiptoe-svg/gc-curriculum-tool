---
description: Produce a structured digest of a single course material for the audit chat's at-rest context. Applied to every material.
manning_skills: [summarization, structured-output, instructional-design]
---

You are producing a **digest** of a single course material so the audit chat can refer to it without re-reading the full extraction. Your reader is the audit agent that will conduct an instructor interview; they need to know what's in this material and what audit-relevant questions it can or cannot answer.

**Faithfulness is the first priority — above completeness.** Describe ONLY what is explicitly present in the material text below. Do NOT invent, infer, or extrapolate: no sections, headings, key terms, percentages, grade breakdowns, names, personas, dates, or frameworks that are not literally in the text. If something is "typical" of this kind of material but not actually present, leave it out — absence is information the auditor needs. A short, fully-grounded digest is always better than a fuller one padded with plausible guesses. When in doubt, leave it out.

Write a single markdown document with these sections, in order, ~1500 tokens total:

## What this material is

One paragraph. Material kind (textbook chapter, syllabus page, slide deck, lab handout, ...). State only the scope you can actually see in the text. If the text is clearly partial, truncated, or a fragment, say so plainly here — do not describe content you cannot see. Authorship cue only if obvious.

## Headings / structure

A nested bullet list of section / sub-section titles, **verbatim — exactly as they appear, not paraphrased or normalized**. Truncate sub-sub-sections if they would push past ~30 lines. If the material has no headings, write: *"No explicit structure — flowing prose / single-topic document."* Do not fabricate a structure the text doesn't have.

## Key terms

A bullet list of the 10–20 most load-bearing terms or concepts that **actually appear and are used substantively in this text**. Do not add terms that would fit the topic but are absent from the material. Skip the obvious (e.g., "color" in a color-management chapter). If the material is thin, list fewer — do not pad.

## Audit-supported competencies (KUD+)

**Evidence discipline (the framework's core rule): include a competency ONLY if the material shows concrete evidence a student would engage it** — an assignment, an assessment item, a produced artifact, a worked example, an explicit instruction. Do NOT list a competency because the topic "implies" it, or because a syllabus verb aspires to it. Prefer FEWER, well-evidenced competencies over a long speculative list. For each:

- **\<competency name\>** — *\<Know|Understand|Do\>* — \<one sentence naming the specific evidence in THIS material\>

Classify the dimension by what the student actually does: recall / identify / name = **Know**; explain the why / reason about consequences = **Understand**; produce, make, or demonstrate an artifact = **Do**. If you cannot point to the evidence, omit the competency.

## Audit gaps (what this material does NOT answer)

A bullet list of audit-relevant questions that **cannot be answered** from this material alone — the auditor will need to ask the instructor. Examples:
- "What is the assessed level of mastery?"
- "Which sections did students actually engage?"
- "How is performance scaffolded across the semester?"

## Caveats

If the extraction looks partial, truncated, malformed, or low-confidence, say so here in one sentence — and **never claim the material is complete when you cannot verify it from the text**. Otherwise omit this section.

---

Output the digest as markdown only. No preamble, no JSON wrapping in the body, no code fences around the whole digest. Length cap: ~1500 tokens. If the material is short or thin, the digest **must** be short — never pad to reach a length.
