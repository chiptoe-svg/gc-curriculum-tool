# Handoff to ai_career_impact: reference-card mirror (2026-10-11)

From: curriculum_developer (branch `docs/sunday-4-7`). To: the ai_career_impact session that owns `library/cards/`.
Nothing in ai_career_impact was edited from this side.

## Background

The shared-source rule (STATE.md, 2026-10-05) keeps facts in sync between twin cards: a factual correction (citation, version, figures, page refs) to either card is mirrored to the other. The 2026-10-08 Vision/Brief citation audit (curriculum_developer `67a1ed3`) added an "Audited 2026-10-08" note to six cards, each ending "Mirror to the other card: pending (owner)". A later fix to one of them (`263b03a`) changed the card body.

## Status of the six cards (checked 2026-10-11)

| Our card | ai_career twin | Audit note mirrored? | Still to mirror |
|---|---|---|---|
| `docs/references/bruner-spiral.md` | `library/cards/future_of_gc/bruner-spiral.md` | Yes (line 33) | **Yes, see below** |
| `docs/references/doignon-1985.md` | `library/cards/future_of_gc/doignon-1985.md` | Yes | No |
| `docs/references/manning-skills.md` | `library/cards/future_of_gc/manning-skills.md` | Yes | No |
| `docs/references/mcpeck-1981.md` | `library/cards/future_of_gc/load_bearing/mcpeck-1981.md` | Yes | No |
| `docs/references/tomlinson-1999.md` | `library/cards/future_of_gc/tomlinson-1999.md` | Yes | No |
| `docs/references/wiggins-2005.md` | `library/cards/future_of_gc/wiggins-2005.md` | Yes | No |

## The one remaining correction

**`library/cards/future_of_gc/bruner-spiral.md`, "What it actually says" (line 20).** The bolded quotation reads "any subject can be taught **effectively** in some intellectually honest form to any child at any stage of development". The only held source for it, Gibbs (2014), *Phi Delta Kappan* 95(7), 41–44, prints it without "effectively": "any subject can be taught in some intellectually honest form to any child at any stage of development" (1960, p. 30). Our card was corrected in `263b03a` to:

> **"any subject can be taught in some intellectually honest form to any child at any stage of development"** (as quoted in Gibbs, 2014, citing Bruner 1960, p. 30; ... the original wording and page remain unconfirmed until Bruner 1960 is held)

Your audit note at line 33 already flags the difference; the body quotation itself has not been changed. Suggested mirror: drop "effectively" from the bolded quotation and add "as quoted in Gibbs (2014)".

## Also noticed (no action required from this side)

- `library/pdfs/korinek-2026-economic-scenarios-STAGED-not-cited.pdf`: our copy in `docs/references/_pdfs/` is already named `korinek-2026-economic-scenarios.pdf`, and nothing in curriculum_developer refers to the STAGED name any more. Whether your copy keeps the STAGED name is your call.
- New sources acquired here on 2026-10-11 (held in `docs/references/_pdfs/`, git-ignored), in case they matter to your library: Collins (2007) and Duguid (2005) are now cited first-hand in Background; Sato et al. (2017), Aldrich (2014), ABET/AACSB/USMLE/ABMS/RISD/Cal Poly documents, and the NCES CIP 2020–SOC 2018 crosswalk support the 3-Act and Graduate Outcome pages. One finding relevant to O*NET use: NRC (2010, p. 76) reports that O*NET Importance and Level responses are "so highly correlated" (r = .95 in pretest; mean .92 in current data, citing Handel 2009) that the two scales are "largely redundant".
