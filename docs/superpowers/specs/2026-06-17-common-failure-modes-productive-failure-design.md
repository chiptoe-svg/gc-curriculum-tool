# Common-Failure-Mode Elicitation → Productive-Failure Evidence — Design

**Date:** 2026-06-17
**Status:** Proposed
**Surface:** `lib/ai/prompts/capture-chat-agent.md` (prompt-only)
**Related:** Area 7 productive-failure conditions; Area 9 signature projects (2026-06-16); Round 10 problem-solving reframe (2026-06-16)

---

## Problem

The interview's Area 7 (`capture-chat-agent.md:634`) probes six *conditions* for
productive failure — generate-then-consolidate, ill-structured problems, revision
cycles, structured post-mortem, abstraction-and-bridging, domain depth. Two of
those already reference failure *content*: condition (c) asks about revision
"that responds to **specific identified failures**," and (d) asks whether the
post-mortem is "tied to the **concrete failure modes** they experienced."

But the agent verifies these as **structural properties** ("is there a revision
cycle? a debrief?") rather than **eliciting the actual recurring failure modes**.
That's the gap. The same syllabus structure (a revision step, a debrief prompt)
exists both in courses where students genuinely struggle-then-convert *and* in
courses where the revision is pro-forma. The discriminator between them is the
**named recurring failure mode plus what students do with it** — and the
instructor carries exactly that tacit knowledge ("every cohort underestimates
trapping and the first proof comes back wrong, then they fix it on revision"),
which nothing currently pulls out.

This matters because the highest-value Area-7 finding — *high competency depth
with absent productive-failure conditions* (Kapur's "unproductive success") —
is only legible when you can see whether the failures students hit actually get
**converted** into understanding or just **eaten** (lost points, moved on).

## Goal

Make the interview elicit, per signature project, the recurring student failure
modes and — contextually — what the course does with them, so the Area-7
productive-failure band rests on concrete, project-anchored evidence instead of
structural yes/nos. **No new stored field, no surface, no nag.**

## Decisions (locked with operator, 2026-06-17)

1. **Internal evidence only.** Elicited failure modes corroborate Area-7
   conditions and sharpen the band; they are **not** stored as a distinct field
   and **not** surfaced on `/view` or the wiki. Pure prompt change — no schema,
   synthesis, or view work.
2. **Contextual follow-up** for the resolution ("what happens after the
   stumble"), not a hard required pairing. The agent uses judgment about when to
   ask it; see the discipline in Edit 2 that keeps an unconverted failure from
   silently corroborating a condition.

## Design

Two coordinated edits to `capture-chat-agent.md`, split by Area ownership.

### Edit 1 — Area 9 (Signature projects): the elicitation

For each major project the agent is already characterizing (deliverables /
what-it-develops), it adds **one natural question**: *"Where do students
typically stumble on this one?"*

- Framed **positively** — instructors readily answer "where do they struggle,"
  and it fits the project-characterization flow.
- **Pattern-level and de-identified**: "students tend to…", drawn from the
  instructor's experience across cohorts. **Never** a named or identifiable
  student (FERPA).
- **Elicitation only.** Nothing is scored in Area 9. The captured failure modes
  are conversational context that Area 7 interprets.

### Edit 2 — Area 7 (Productive failure): the interpretation

The elicited failure modes become the **evidence substrate** for conditions
(c) revision cycles, (d) structured post-mortem, and (e) abstraction-and-bridging.
Add to the Area-7 prompt:

- **Contextual resolution probe.** When a common failure mode is in hand, the
  agent **may** ask the resolution: *"Do students revise against that, or does it
  just cost them points?"* (judgment, not a forced every-time turn).
- **Converted-vs-eaten discipline.** Only a **converted** failure — a revision or
  debrief **tied to the named failure mode** — corroborates a condition. An
  **eaten / unconverted** failure (lost points, no revisit) corroborates
  **nothing**; it is logged as context and is precisely the tell for the
  high-depth-but-absent-conditions / *unproductive-success* pattern the probe
  already names.
- **Evidence-tier rule.** Instructor-recalled failure modes are **claimed**
  evidence — they corroborate and sharpen the band, but do **not** by themselves
  lift it above what artifact evidence (graded revision history, a debrief
  assignment) supports. This preserves the load-bearing rule that no score rises
  above its evidence.

### Why split across both Areas

Area 9 owns project characterization, so the failure question fits the
conversation there; Area 7 owns the conditions and the band, so interpretation
belongs there. Anchoring everything in Area 7 would force the agent to
re-introduce each project mid-probe; anchoring everything in Area 9 would scatter
productive-failure logic across two places. Eliciting in 9, interpreting in 7,
keeps each Area coherent.

## Scope guards — what this deliberately does NOT do

- **No schema change.** No `common_failure_modes` field, no migration, no
  synthesis emit, no `/view` or wiki render. (Internal evidence only — decision 1.
  If a future increment wants the failure modes surfaced, that is its own spec;
  the elicitation built here would feed it.)
- **No readiness gating.** Consistent with Area 9 (which does not gate readiness)
  and the Round 10 de-nag. This is positive elicitation, never a deficiency flag —
  a course with no project failures to name is not penalized.
- **Never about individuals.** Pattern-level, de-identified, cohort-typical only.
- **Not a new condition.** It feeds the existing conditions (c)/(d)/(e); the six
  Area-7 conditions are unchanged in number and meaning.

## Verification

This is **prompt-guided**, not code-enforced — the architecture doc's §12
traceability map would classify it that way, and the spec says so plainly rather
than implying a test pins it. There is no clean unit test for "the agent asks the
right follow-up at the right time." Verification is:

1. The `capture-stress-test` pass (already part of the review flow) exercises the
   updated prompt.
2. A **manual interview walkthrough** on a project-heavy course (e.g. a capstone)
   confirms: the failure-mode question fires per signature project; the resolution
   probe appears when warranted; an eaten failure is correctly *not* counted; the
   band reflects converted failures without over-counting claimed evidence.

A light **prompt-structure assertion** (the existing pattern: a test that loads
the prompt and asserts a required section/phrase is present) is optional and, if
added, should assert only that Area 9 mentions the stumble elicitation and Area 7
mentions the converted-vs-eaten discriminator — not the wording (brittle).

## Risks

- **Model discretion (the contextual-follow-up tradeoff).** Because the resolution
  probe is contextual, the agent could let an unconverted failure corroborate a
  condition. The converted-vs-eaten discipline in Edit 2 is the guardrail; the
  stress-test + walkthrough is how we catch drift. If walkthrough shows the agent
  under-asking the resolution, the cheap escalation is to make the probe required
  (the option not chosen here) — a one-line prompt change, no rework.
- **Re-nagging.** Care in phrasing keeps this positive. The prompt must not frame
  "no nameable failures" as a deficiency.
- **Evidence inflation.** The claimed-tier rule is the defense; it mirrors the
  evidence-above-zero discipline used everywhere else in capture.
