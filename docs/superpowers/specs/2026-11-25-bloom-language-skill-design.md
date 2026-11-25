# Bloom language for the writing and interview agents — design

**Status:** APPROVED by the owner 2026-11-25 ("yes"). Implementation plan to follow.
**Owner request (2026-11-25):** "when models create verbiage, they should use bloom expanded language when it makes sense to do so (particularly when writing observed outcomes, suggesting objectives, and asking interview questions). Seems like blooms should become a skill that we hand the interview and writing agents." Asked whether to wait for the K/U wording change: "the bloom language helps with faculty acceptance anyway - so proceed."
**Background:** `docs/background.html` §5 (`#bloom-crosswalk`, proposed Bloom-process wording of K/U levels and the Do mapping) and §6 (`#levels-stack`); research notes in `research_notes/Bloom expanded taxonomy for KU/`.

## Intent

Faculty write and think in Bloom's verbs. Text the tool writes for them should speak the same language, using the revised taxonomy's 19 named processes (recognizing, recalling, interpreting, … producing), so that outcomes, suggested objectives and interview questions read as familiar. Success means faculty recognize their own vocabulary in what the tool writes. The scores stay the same.

## Goals

- One shared instruction module, `lib/ai/prompts/shared/bloom-language.md`, handed to every prompt that writes faculty-facing wording about what students do.
- Observed outcome statements, suggested objectives and interview questions name the Bloom process the evidence shows, when one fits.
- One convention for the name clash: Bloom's "understand" is not the framework's Understand (U).

## Non-goals

- No change to scoring, the K/U/D anchors, the depth scale or the evidence rule. The Bloom-worded K/U levels in Background §5 stay a proposal pending the pilot.
- No migration and no rescoring. Existing captures keep their wording until they are next regenerated in the normal course.
- Career-side prompts (`position-*`, `jd-extract`, `bundle-*`) are out of scope. Careers are not written in Bloom's vocabulary (Background §5).
- Prompts that only score (`program-score-coverage`, `what-if-estimate`, `decompose-prereq-gap`, `prereq-edge-seed`) do not get the module.

## Anti-goal (the main risk)

**Bloom wording must never raise a score.** The scorer is known to credit a competency when its vocabulary appears (Background §7). If a writer upgrades "students summarize" to "students critique", a later or same-call scorer could read the stronger verb as evidence. The module therefore requires that:
- the process named is the one the evidence shows, never a higher one;
- when the evidence is unclear, the plainer process is used or none at all;
- in any prompt that also scores, the Bloom wording describes evidence and never stands in for it. A verb in course materials or in a written statement is not evidence of a level.

## Approaches considered

1. **A shared include module (chosen).** Prompts already share modules through frontmatter `includes` (15 prompts include `shared/depth-scale.md`). One file is one source of truth, and the interview gets it on both loops, since both use the `capture-chat-agent` prompt. Cost: a few hundred tokens per call in the included prompts.
2. **An on-demand skill or tool the agent loads when it writes.** This saves tokens, but only the interview is an agent loop; synthesis and the objective guide are single calls, so they would still need the include. It adds a second mechanism for no gain.
3. **A rewrite pass after generation.** An extra AI call per output that can drift meaning, and it can't reach interview questions in real time. Rejected.

## The module (`shared/bloom-language.md`) — contents

1. **When to use it.** Use it when describing what students do with content: outcomes, objectives, interview questions and checklist items. Don't force it into other prose, and don't stack several verbs to sound rigorous.
2. **The 19 processes**, grouped under the six categories, each with a one-line plain gloss in the module's own words. Krathwohl 2002 gives names only. Where the gloss follows Larsen et al. 2022 (executing vs implementing), say so.
3. **Fit to the evidence.** Name the process the student work shows. Pair the verb with its content and, where relevant, its condition: "independently", "for an unfamiliar substrate", "with a checklist". Bloom does not grade independence, so a verb alone says nothing about Do depth.
4. **The name clash.** When the word "understand" would be ambiguous, write the specific Bloom process (explaining, inferring, comparing) rather than "understand". Never write "U" or a level code in faculty-facing wording.
5. **Do wording.** Executing (familiar task), implementing (unfamiliar task), planning and producing, plus condition phrases (guided, with a reference, independently, adapting to new conditions). Follow the Background §5 Do table, including its stated gaps: nothing in Bloom fits "with a reference", and nothing fits "guides others".
6. **Never inflate.** The anti-goal above, in plain words, with one wrong example and one right one.
7. **Foundational competencies** (agency, attention to detail and so on) are outside Bloom's cognitive domain. Describe the behavior plainly.

## Prompt changes

| Prompt | What changes |
|---|---|
| `capture-chat-agent.md` (interview, both loops) | Include the module. Interview questions about what students do use process names where natural. Example: "When students compare the two proofs, are they judging them against a standard (critiquing) or just spotting differences (differentiating)?" The §4 Bloom probe asks about the 19 processes, not the 6 categories. The objective-draft rule changes from "Use Bloom's action verbs (analyze, evaluate, create, etc.)" to "verb from the module + content + condition". |
| `capture-synthesis.md` (outcome and competency statements; this call also scores) | Include the module. Statements name the process the evidence shows. Add the anti-inflation rule next to the scoring instructions. |
| `objective-evidence-guide.md` (instructor's evidence guide) | Include the module, for wording what to collect per objective. |
| `synthesize-course-profile.md`, `wiki-update.md` | Include the module for prose about what students do. This scope is my call; it can be dropped if the token cost matters. |
| `kud-chat.md`, `extract-course-kud.md` (legacy) | Untouched; they still use `kud-rubric.md`. |

`lib/builder/bloom.ts` `proposeBloom` (a deterministic table from verb to category, for objectives faculty type) is unchanged. Extending it to the 19 processes is a separate, optional follow-up.

## Verification (before deploy)

- **Unit and prompt tests.** The module is included in exactly the in-scope prompts, the include resolves, and the strict-schema JSON is unchanged.
- **Free campus benchmark** (RCD models cost nothing; no paid AI):
  - Interview: the existing `interview-bench` cases before and after. Bloom usage goes up, and acceptable-turn rate and search/citation behavior don't drop.
  - Synthesis and scoring: regenerate 3–4 captured courses before and after with the same campus model and inputs. The K/U/D level distribution shifts no more than the run-to-run noise of a same-prompt rerun. This is the anti-inflation check, and it's required.
  - Blind read of a sample of outcome statements: is the Bloom process right for the evidence?
- **Deploy** needs the owner's yes, sent with the benchmark results. There's no migration, and only prompt files change.

## Left to the builder

The module's exact wording and glosses (within the rules above), the example questions, and the test layout.
