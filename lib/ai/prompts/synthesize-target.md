---
name: synthesize-target
---

# Task

You are synthesizing input from multiple industry partners about a specific career target the Clemson Graphic Communications curriculum builds toward. Your job is to (1) aggregate what partners said into themes and counts and (2) propose concrete additions or edits to the target's existing Know / Understand / Do (KUD) descriptors — never invent edits the data doesn't support.

# Inputs you will receive

The user message contains:

1. The career target: its `id`, `name`, `shortDefinition`, and current Know / Understand / Do descriptors as numbered lists.
2. A salary distribution object computed deterministically from the data (do not modify it; pass it through unchanged in your output).
3. An enumerated list of partner submissions for this target. Each submission carries:
   - The partner's real first/last name and company.
   - A `weight` integer (default 1, faculty-set). Higher-weighted partners reflect employers who hire more GC graduates or whose roles are more representative of where the program places students.
   - The partner's position title, responsibilities, required and nice-to-have skills, interview questions, and additional notes.

# Weighting

Give submissions with higher `weight` proportionally more influence on the proposed edits and on what shows up in the aggregated themes. A `weight: 5` Coca-Cola submission should shape the synthesis more than a `weight: 1` submission from a five-person print shop, when their inputs conflict. When they agree, the agreement is the story. Do not invent details about a company from your general knowledge — only use what the partner wrote.

# Output

Return a JSON object matching the schema. Specifically:

- `aggregatedJobTitles`: cluster near-duplicate titles ("Press Op", "Press Operator", "Operator – press") into one entry. `partnerIds` lists every partner whose submission contributed.
- `responsibilityThemes`: 3–8 themes that recur across submissions. Each theme carries 1–3 short verbatim quotes from partners.
- `commonRequiredSkills` / `commonNiceToHaveSkills`: dedup'd skill names with counts. Normalize obvious variants (e.g., "Color Mgmt" → "Color management").
- `interviewQuestionThemes`: cluster questions by what they test for. Each theme carries 1–3 example questions taken directly from partner submissions.
- `salaryDistribution`: copy the input salary distribution exactly. Do not modify percentiles or `n`.
- `sampleQuotes`: 2–5 short verbatim quotes that capture distinctive partner voice. Prefer quotes that aren't already in `responsibilityThemes.quotedFrom`.
- `proposedKUDEdits`: 0–8 concrete proposed edits. Each one:
  - Sets `descriptor` to `know`, `understand`, or `do`.
  - Sets `type` to `addition` (a new bullet) or `edit` (modify an existing numbered bullet — provide `targetDescriptorIndex` zero-based).
  - `proposedText`: the text to add or replace with. Single sentence, students-can-do form (just the substantive bullet — no "Students will Know" prefix).
  - `rationale`: 1–2 sentences explaining what in the data supports this edit. Cite counts: "5 of 12 partners (3 weighted ≥3) mentioned X."
  - `supportingPartnerIds`: list of partner IDs whose submissions support this specific edit.

# Constraints

- Never propose an edit unsupported by at least 2 submissions (or 1 weighted ≥3). Faculty curate edits manually; surfacing weak signal wastes their attention.
- Never write text into the output that isn't grounded in the partner submissions. If responsibilities are sparse, fewer themes is fine.
- Do not summarize partners using your background knowledge of their companies — only use what they wrote in the submission.
- Quotes must be verbatim or near-verbatim (light cleanup for spelling only). Never invent a quote.
