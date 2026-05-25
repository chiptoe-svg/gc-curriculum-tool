# KUD Depth Scales (v1)

> **UI mirror:** the same anchors are hand-mirrored as a TypeScript
> constant in `lib/ai/capture/depth-anchors.ts` for client-side rendering
> in the review panel. Keep them in sync if you edit the scale here.

Coverage is measured along three dimensions — Know, Understand, Do — each on a
0–5 scale anchored to **what the student does or grasps**, not what the
syllabus says.

The cleanest distinguishing question per dimension:

- **Know** asks: can the student recall, recognize, or reproduce the *content*
  (terms, facts, conventions, procedural sequences)?
- **Understand** asks: can the student reason about the *why* (the principle
  behind it, the relationship to other things, the consequences)?
- **Do** asks: can the student *produce* the artifact, *perform* the
  procedure, or *demonstrate* the skill behaviorally?

## Know — recall and identification of content

```
0  Not present in this course (or listed only in aspirational syllabus language)
1  Exposure — student encountered it in actual delivery (lecture, module item, reading list)
2  Recognize — student can identify the term/fact when shown options
3  Recall — student can produce the term/fact on cue, without prompt
4  Use correct terminology when discussing the domain
5  Fluent across the full vocabulary, including conventions and edge cases
```

**K=0 vs. K=1.** A topic that appears in the syllabus's stated objectives or
catalog description but has no corresponding lecture, module item, reading,
or other delivery evidence in the course materials scores **K=0**, not K=1.
K=1 marks the lowest meaningful presence in the course — *delivery occurred*,
even if student engagement was passive. K=0 marks absence-of-delivery, which
includes aspirational claims the materials don't substantiate. This
distinction is the lowest-level operationalization of the evidence rule.

## Understand — reasoning about the why

```
0  Not present
1  Restates the explanation as given
2  Explains the rationale in own words
3  Predicts consequences (if X then Y, because…)
4  Reasons through novel cases not previously seen
5  Critiques the principle, identifies limits, extends to new domains
```

Exposure is **not** an Understand event. Hearing a principle stated without
engaging with it scores K1, U0.

## Do — behavioral output

```
0  Not present
1  Performs with per-step direction or supervision
2  Performs using a reference or checklist
3  Performs independently in familiar conditions
4  Adapts performance to new conditions or constraints
5  Performs creatively with critical judgment; can guide others
```

Watching a demonstration is **not** a Do event. It scores K1 (student is
aware the skill exists) and possibly U1–2 (student saw the procedure
explained), but D stays 0 until the student's hands or output are part of
the activity.

## Dimension applicability

| Competency type | Score K | Score U | Score D |
| --- | --- | --- | --- |
| Technical (discovered from materials) | Yes | Yes | Yes |
| Foundational (Agency, Attention to Detail, Resilience, Curiosity, Communication, and any others evidenced) | **No** (null) | **No** (null) | Yes |

Foundational competencies are dispositions demonstrated through behavior.
They have no meaningful Know or Understand levels — students don't recall
facts about Resilience or reason their way through it; they exhibit it.
`k_depth` and `u_depth` for foundational rows must be null, never zero.

A foundational with `d_depth = 0` (e.g., "this course doesn't develop
Resilience") is a valid and useful result, not missing data. Provide a
rationale explaining the absence.

## Evidence requirement

Above-zero depth values must be backed by an excerpt from the course materials
(or the conversation transcript when the instructor describes something not in
the materials). Specifically:

- `k_depth > 1` requires `evidence_k`.
- `u_depth > 0` requires `evidence_u`.
- `d_depth > 0` requires `evidence_d`. `d_depth = 0` may omit it.

Aspirational syllabus language ("students will understand X") is not
sufficient evidence above U1 or D0. The depth scale is about student
attainment, not stated intent.

## Baseline foundational competencies

Every Course Outcome Profile must score these five, even at d_depth = 0:

1. **Agency** — initiative, ownership of decisions, drive
2. **Attention to Detail** — care, accuracy, error-catching, follow-through
3. **Resilience** — persistence through failure, adaptive recovery
4. **Curiosity** — substantive questioning, inquiry beyond requirements
5. **Communication** — written, oral, visual articulation

Additional foundational competencies may be added if the materials evidence
something the baseline list doesn't capture (e.g., Collaboration,
Professionalism, Ethical Judgment). Mark them `type: "foundational"` and
score on D only.
