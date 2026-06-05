---
name: position-rated-items
manning_skills:
  - context-grounded-generation
  - employer-perspective
includes:
  - shared/depth-scale.md
---

# Role

You are generating a list of 10 candidate "experiences worth having"
that a hiring manager would recognize a student as having gone through
in their GC undergraduate program. The partner will rate each on a
1-7 importance scale.

# What "experience worth having" means

Each item is ONE concrete, recognizable thing a student should have
done, demonstrated, or produced in their core GC coursework that
would make them more qualified for THIS specific position. Format:
short noun phrase or short imperative.

**Good examples:**
- "Has presented audience research findings to a stakeholder who pushed back"
- "Knows how to write a creative brief that survives a kickoff meeting"
- "Has shipped a multi-page design system used by other students"
- "Can articulate why a chosen typeface fits a brand voice"
- "Has critiqued and revised peers' work in a structured studio setting"

**Bad examples:**
- "Communication" (too abstract — not recognizable)
- "Has gotten an A in DSGN 2110" (course-bound, not transferable)
- "Knows Photoshop" (tool-bound, doesn't say what they DO with it)

# Input you have access to

The user message contains:
1. Career target description + sub-competencies (the catalog framing).
   Each catalog sub-competency is prefixed with its id in brackets,
   e.g. `- [sc_abc123] Typography: brief description`.
2. Pages 1-4 of the partner's position capture: structured JD fields,
   what's unique about the job, key interview questions, career trajectory
3. The company name + position title

# How to generate

1. Read the position context. What does this hire DO at week one?
2. Translate into 10 concrete experiences that, if a student had them,
   would matter for THIS job. Lean specific over abstract.
3. The 10 should span at least 3 of the catalog sub-competencies for
   variety — don't concentrate them in one area.
4. Order matters: lead with the 2-3 most strongly implied by the
   position context, then fan out.

# Output schema

```json
{
  "items": [
    {
      "name": "<short noun phrase or imperative>",
      "description": "<1-2 sentences elaborating what this looks like in practice>",
      "evidence_source": "<which page or sub-competency this drew from>",
      "sub_competency_id": "<the [bracketed id] of the closest catalog sub-competency, or null>"
    },
    ... (exactly 10)
  ]
}
```

# Hard rules

- Exactly 10 items.
- Each item ≤ 150 characters in name.
- description ≤ 400 characters.
- evidence_source ≤ 300 characters — names a source (e.g., "page 2: uniqueness",
  "sub-competency: typography fundamentals"). Faculty want to see your reasoning.
- Set `sub_competency_id` to the bracketed id of the SINGLE closest catalog
  sub-competency this item maps to, or `null` if none is a clear fit. Best-effort —
  do not force a match. This is a join key, not a scored field.
- Don't repeat items.
- Don't reference specific courses — partners don't know which course is which.
- Don't reference the partner's company name in item text — items should be
  recognizable to any GC student.
