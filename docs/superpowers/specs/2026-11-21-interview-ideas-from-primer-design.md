# CourseCapture interview: what to take from Primer (2026-11-21)

**Status:** decision record (owner asked "decide what should be integrated into current interviewing approach",
2026-11-21). Source: Mollick et al. (2026), *Primer*, SSRN 7696720, held at
`docs/references/_pdfs/mollick-2026-primer-ssrn-7696720.pdf`; card `docs/references/mollick-2026-primer.md`. Primer's
Intake Agent interviews K–12 educators before building a practice simulation; its prompt is published in full
(Appendix A walkthrough, Appendix B prompt). Its evidence is formative (design sessions with educators, no learning
outcomes), so everything below is a design choice to test, not a proven improvement.

Compared against our interviewer prompt `lib/ai/prompts/capture-chat-agent.md` (as of `d1ffd638`).

## Already in our interviewer (no change)

| Primer practice | Ours |
|---|---|
| One question at a time, never stacked (App. A note 5) | "Ask ONE question per turn. Never more than one." (Conversation rules) |
| Ask for materials; read uploads (note 2) | Materials-first rule; in-chat "Add a file" button (live 2026-11-20) |
| Prior-knowledge questions with a concrete subject example (note 8) | Stronger: Audit Area 1 Step 3 asks about one concrete skill named from the prerequisite course's captured profile ("GC 1040's capture shows…") |
| Rubric as the basis for assessment (note 9) | Materials-FIRST rubric rule; rubric criteria cited in questions |
| Misconceptions and current teaching approach | Audit Area 5 (threshold concept and prior-knowledge reality) |
| Session recovery: recap and continue (App. A "Scene and session recovery") | Resumed sessions keep the server-owned conversation (2026-10-28) |
| Accept "looks right" etc. without asking again (note 14) | Pre-wrap-up rule: a brief confirmation proceeds to the readiness signal |

## Integrate (prompt only; test on the campus replay before it goes live)

1. **A check before every question** (note 5). Before writing the `question` field, the interviewer checks: what do I
   already know from earlier answers and the materials; what did the last answer change; is the question I planned still
   needed; what is the single most important thing to ask next. Target: the re-asking seen in PKSC 2200 (bench cases
   `b0dd926c` on `feat/interview-reask`). Differs from the tabled re-ask fix (an already-answered list, which barely
   moved re-asks) by making the interviewer decide, not just remember.
2. **Skip experience-dependent questions for a first-time instructor or a new course** (note 8). If the instructor has not
   taught the course before (or the course is new), do not ask Area 5's "what do students consistently misunderstand" or
   "what do you routinely re-teach"; say why, and ask what they expect instead, marked as expectation in the notes.
3. **Progress in words** (paper p. 11: an on-screen checklist of unchecked steps confused educators; a spoken "about
   halfway" worked). In the periodic synthesis turn, open with one plain line derived from `readiness.score` ("We're
   about halfway", "Nearly there: two things left"). Keep the progress strip; note for owner observation whether its
   `remaining` labels read as a to-do list faculty feel behind on.

## Test first (needs code and a benchmark)

4. **A private planning journal** (note 4, App. A "Reflective journal"): fixed headings (session goal, current
   understanding, plan for the next one to three turns, key observations, decisions made, next steps), updated every
   third instructor answer, never shown to the instructor. Ours keeps `readiness` and audit notes but nothing that
   carries "what is settled and what is next" across turns. Needs a new field in the per-turn response and storage with
   the conversation. Bench on the PKSC 2200 and GC 3400 replays: free campus models first, then Terra (paid: estimate and
   owner yes first). Paired with item 1, judged on re-asks and on blind-reviewed turn quality.

## Not adopting (and why)

- **The educator as the source of knowledge** (paper p. 6): Primer defers to the educator; our interviewer ranks the materials
  above instructor testimony (`capture-chat-agent.md`, "Disagreement triangulation") and records disagreements as findings,
  because the audit characterizes a course that already runs. We keep that order.
- **Sticky notes and slides as two writing surfaces** (note 3): a larger interface change; our review step and progress
  strip already show the developing record. Revisit only if faculty ask to see captured items during the interview.
- **Live voice turn-taking tweaks**: we record and transcribe; no live voice loop.
- **Web research on named standards** (note 7): useful for K–12 frameworks; our courses' standards (G7, ISO 12647) live in
  the materials; adding live web search to the interviewer is a separate decision.
- **Comparing three candidate designs and presenting one** (note 10): the interview captures a course; it does not
  propose a design. (Relevant later, if the tool drafts course revisions.)

## Next step

Items 1–3 are one prompt change plus prompt-text tests; then the free campus replay against today's prompt on the
existing cases, blind-reviewed, before deploy. Item 4 follows as its own small design with a paid-run estimate.
