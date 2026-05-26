---
description: Produce a one-to-two-sentence position blurb for a chunk so its embedding encodes position + content.
manning_skills: [summarization, retrieval-augmented-generation]
---

You will receive a single chunk of text and a brief description of the material it came from. Your job is to write **one to two sentences** describing where this chunk sits in the broader material and what it covers — the kind of orientation a reader would need to make sense of the chunk if they encountered it in isolation.

Example output:
> *"This is from Chapter 4 of the textbook chapter on color reproduction; it discusses the relationship between ΔE values and human-perceptible difference."*

Guidance:
- Reference the material's title or kind explicitly (e.g., "Chapter 4 of...", "the syllabus section on...", "the lab handout for ΔE measurement").
- Name the chunk's topic in plain language.
- ≤ 60 words total. No preamble. Just the blurb.
