# Skill identity across re-captures: embedding test (2026-11-16)

Owner asked (2026-11-16) whether embeddings can carry a skill's identity from one capture of a course to the next, so faculty decisions (competency links, threads, objective links) survive a re-capture. Context: [skill-thread concept](../curriculum-map-skill-threads.html) §9.

## Method

Read-only, live database (`gc_curriculum`), all snapshots including retired ones. For each course and instructor with two or more captures that list skills, each capture was paired with the one before it. Every skill statement was embedded with the campus model (free, in memory; nothing written). Each new skill was matched to its most similar skill in the previous capture. A match is **mutual** when that old skill's most similar new skill is the same one. Script: session scratchpad `recapture-match.ts` (not kept in the repo). Judgments of right and wrong below are the author's reading of the statements, not an instructor's.

## Data

5 course/instructor groups had more than one capture (GC 1010, GC 3800, GC 4400 and two whose re-captures kept every statement), giving 11 capture pairs and 141 new-side skills. 111 kept identical wording. The 30 reworded skills are the real test.

## Results on the 30 reworded skills

| Rule | Carried | Right | Wrong |
|---|---|---|---|
| Mutual, similarity ≥ 0.85 | 12 | 12 | 0 |
| Mutual, 0.70–0.85 | 4 | 4 | 0 |
| Mutual, below 0.70 | 2 | 0 | 2 |
| One-way (not mutual), any similarity | 0 carried | — | — |

- **True paraphrases scored 0.85–0.99** with a wide gap to the second-best match (e.g. 0.994 vs 0.696).
- **Real rewordings scored 0.71–0.80** and were all mutual (e.g. "reflect on personal fit with the major…" ↔ "evaluate their fit with the graphic communications major through structured self-reflection…", 0.715).
- **Every one-way match was a genuinely new skill** forced onto the nearest old one (e.g. a new salary-estimate skill matched to "reflect on personal fit", 0.689).
- **The two wrong mutual matches were below 0.70** with almost no gap to the second-best (0.603 vs 0.588; 0.667 vs 0.567). Both came from a GC 4400 re-capture that restructured the course (11 → 17 skills, one carried), where a few vague old skills ("review production-process design and explain final outcomes") were the nearest thing to many specific new ones.
- **A merge was missed.** In GC 1010 two old planning skills became one new one. The one-to-one rule carried one and left the other "unmatched", when it should be marked as merged.

## Proposed rule

1. **Carry automatically:** mutual and ≥ 0.85.
2. **Carry, flagged for a quick check:** mutual and 0.70–0.85.
3. **Treat as new:** not mutual, or below 0.70. The old skill it was nearest to is listed for the instructor as "dropped, merged or replaced?".
4. **Restructured capture:** if fewer than half the new skills carry, treat it as a new version of the course and ask the instructor once, rather than skill by skill.
5. Only faculty decisions carry over (competency links, threads, objective links). Levels always come from the new capture.

## Limits

Small sample: 30 reworded skills from 3 courses, all re-captured by the same instructor within months. The 111 identical statements probably come from revisions that reused the profile, so they overstate how stable wording is across real re-interviews. The cut-offs above are set on this sample and should be checked on the next real re-captures. Merges and splits need their own detection (an old skill whose best match is high but not mutual).
