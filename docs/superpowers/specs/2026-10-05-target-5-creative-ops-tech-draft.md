# Target 5 redefinition — Creative Operations & Technology

> **Revision 2026-10-06 (owner):** AI must be prominent in this target, well beyond usage: implementation, benchmarking and evaluation. `ai-tool-evaluation` is kept and broadened into an eighth sub-competency, and the definition and descriptors now say so. Eight sub-competencies is one above the usual 5–7; folding colour management into packaging (open question 5) would bring it back to seven.

**STATUS: DRAFT FOR OWNER REVIEW.** Nothing here has been applied. `lib/domain/seed-targets.ts` and the live database are unchanged. This file is read-only analysis plus a proposal.

**Date:** 2026-10-05

**Source of the redefinition:** `ai_career_impact/targets/5-creative-operations-technology.md` (commit `bbc53b6`, independently fact-checked; owner decisions layered in on top by commits `a524bbd` and `81a4b8a`) and `ai_career_impact/STATE.md`. Quotes and figures below are paraphrased from that file's §1, §3, §4, §6, and §8 — see those sections for full sourcing and caveats. The five job descriptions cited there are confidential (marked so by the employer): this draft paraphrases them, as the evidence file does, and never names the employer or quotes the postings directly.

The career target's database id stays `ai-workflow` — only the name and descriptors change. Target 4's id and content (`creative-generalist`) are not touched by this draft; they're read here only to avoid overlap.

---

## 1. Why this is changing

The owner's 2026-10-05 decision (made in the `ai_career` session): target `ai-workflow` ("AI Workflow / Orchestrator") becomes **Creative Operations & Technology** — the detail-oriented systems and workflow side of creative work. AI is one strand of that work, not its definition. Target 4 ("Creative Generalist") is the maker side — design, UX/UI, video, web. The owner sees 4 and 5 as two sides of one coin.

**Path mapping (owner decision):**

| Path | Goes to |
|---|---|
| Packaging workflow & AI compliance | 5 |
| Content/brand ops & DAM | 5 |
| Creative technologist — systems/pipeline side | 5 |
| Creative technologist — content-making with AI | 4 |

**What the work actually is**, per the evidence file's seven strands:

1. Turning brand and campaign rules into templates and systems that produce compliant variations at scale.
2. Configuring and running workflow platforms: intake, approvals, proofing, reporting.
3. Managing digital assets: metadata, rights, taxonomy, the DAM platform.
4. Owning the packaging graphics workflow: artwork management, regulatory and print-quality compliance, versioning.
5. Scripting and integration: automating handoffs between systems, including generative-AI pipelines.
6. Colour management: process control and colour accuracy across print processes and devices.
7. Governing AI output: checking it against brand, legal, and quality standards, and staying accountable for it.

Those seven strands map one-to-one onto the seven proposed sub-competencies in §3.

---

## 2. Decided already (owner, 2026-10-05) — not open questions

These came from the ai_career session (STATE.md and evidence-file §8, commits `a524bbd`/`81a4b8a`) and are treated here as settled, not as open questions:

1. **Prepress vs. colour management vs. workflow/automation.** Line prepress stays in target 1 (Production & Operations). Workflow or automation administration goes to target 5. **Colour management also goes to target 5**, even though colour-management job titles currently share SOC code 51-5111 with prepress in placement data. Placement tracking will need to split that family by title — out of scope for this draft, flagged for whoever owns the alumni-placement pipeline.
2. **Target 5 is both a direct entry point and a grow-into destination.** Today's alumni evidence is almost entirely the destination route (0.3% of first jobs; 15 of 17 people who ever hold a target-5-vocabulary role got there after starting elsewhere). The owner wants GC to build a direct entry route too — early-career workflow, creative-ops, colour-management, and automation roles — not present target 5 as only an advanced specialization.

**What decision 2 means for this draft, concretely:** the KUD+ framework already separates *what the sub-competency is* (the K/U/D descriptors, written at a competent "full" level, same as every other target in the seed file) from *how deep a given course's evidence reaches* (the depth scale, scored 0–5 per course). Decision 2 doesn't change the descriptors — it changes **which courses are expected to carry evidence and at what depth**. It implies Do-evidence for target 5 should start showing up at D1–D2 ("performs with direction," "performs with reference") in early/mid-curriculum courses — prepress, colour management, production, intro packaging — not only at D4–D5 in a capstone. See §5's re-scoring note and §6 Q4.

---

## 3. Proposed new target-level definition

| Field | Current (`ai-workflow`) | Proposed |
|---|---|---|
| `id` | `ai-workflow` | **unchanged** — `ai-workflow` |
| `name` | AI Workflow / Orchestrator | **Creative Operations & Technology** |
| `socCode` | `null` | **unchanged** — `null` (no SOC code; the evidence file flags this as the target's weakest-data point, since it blocks any BLS or OpenAI-framework rating) |

**shortDefinition:**
> The detail-oriented systems and workflow side of creative and production work — the counterpart to Creative Generalist's maker side. Builds and runs the templates, workflow platforms, asset libraries, automations, and compliance checks that creative and production work flows through. Implementing, benchmarking and evaluating AI in those systems is a central part of the role, well beyond using AI tools.

**industryContexts:**
- Creative or marketing workflow technologist configuring intake, approvals, and reporting on a platform like Workfront or Monday
- Packaging workflow or compliance specialist managing artwork versioning and regulatory/print-quality sign-off
- DAM specialist, creative-ops coordinator, or colour-management technician governing a brand's asset library, colour accuracy, or AI-assisted output quality
- AI implementation lead selecting, piloting, benchmarking and rolling out AI models and tools across a creative or production operation

**knowDescriptors:**
- How workflow platforms, DAM systems, and packaging-artwork pipelines structure creative and production work
- What brand, regulatory, and print-quality compliance standards govern packaging and brand asset output
- How scripting, APIs, and low-code automation connect creative, workflow, and AI systems
- How AI models and tools are selected, implemented, benchmarked and evaluated: test sets, quality and cost measures, failure modes, drift

**understandDescriptors:**
- Why systems and workflow design is what lets creative and production work scale without proportional headcount growth
- Why someone has to stay accountable for AI-assisted and automated output against brand, legal, and quality standards
- Why an AI tool has to be measured on the organisation's own work before it is adopted, and re-measured after, rather than trusted on vendor claims
- Why colour, metadata, and versioning discipline compound in value as volume grows — and compound in cost when missing

**doDescriptors:**
- Configure or design a workflow, template system, or automation for a real creative or production context
- Check a packaging, brand, or AI-assisted output against a defined compliance or quality standard and catch failure modes
- Implement an AI step in a real workflow and benchmark it against the current process on quality, cost and turnaround, then recommend adopt, adjust or drop
- Manage a digital asset library or a colour-management process so output stays accurate, findable, and reusable at scale

**defensibilityNote:**
> AI can execute steps inside these workflows, but someone has to design the system, decide what the templates and automations should do, and stay accountable when output is checked against brand, legal, or print-quality standards. That accountability, and the judgment behind it, doesn't automate.

---

## 4. Proposed sub-competencies (8)

Same format as `lib/domain/seed-targets.ts`: each has `id`, `name`, `knowDescriptor`, `understandDescriptor`, `doDescriptor`.

| # | id | name |
|---|---|---|
| 1 | `brand-system-templating` | Brand system templating |
| 2 | `workflow-architecture` *(kept)* | Workflow platform configuration and operation |
| 3 | `digital-asset-management` | Digital asset management |
| 4 | `packaging-artwork-compliance` | Packaging artwork workflow and compliance |
| 5 | `systems-automation-integration` | Systems automation and integration |
| 6 | `colour-management` | Colour management |
| 7 | `quality-frameworks` *(kept)* | AI and quality governance |
| 8 | `ai-tool-evaluation` *(kept, broadened)* | AI implementation, benchmarking and evaluation |

**1. `brand-system-templating` — Brand system templating**
- Know: Knows how brand and campaign rules translate into reusable templates, components, and platform settings — including generative-AI presets — that scale compliant variation.
- Understand: Understands why templates must encode brand rules precisely enough to produce compliant output automatically, and why they need ongoing monitoring and maintenance as brand rules change.
- Do: Builds and maintains a template or settings system, in a design tool, workflow platform, or generative-AI platform, that produces on-brand variations at scale, and documents it for others to run.

**2. `workflow-architecture` — Workflow platform configuration and operation** *(id kept; descriptors broadened from AI-specific sequencing to full workflow-platform operation)*
- Know: Knows workflow design patterns and how workflow platforms (e.g., Workfront, Monday) structure intake, approvals, proofing, and reporting, and the role of handoff points in maintaining quality.
- Understand: Understands why workflows fail at handoff points, and why platform configuration and sequencing matter more than any single tool choice, including AI tools.
- Do: Configures or designs a workflow — on a real platform or on paper — for a creative or production context, sequencing human and AI work through intake, approval, and reporting steps, for both quality and efficiency.

**3. `digital-asset-management` — Digital asset management**
- Know: Knows how DAM platforms organize assets by metadata, taxonomy, and rights, and what makes an asset findable and reusable at scale.
- Understand: Understands why poor metadata and taxonomy decisions compound as an asset library grows, and why rights tracking is a compliance requirement, not a convenience.
- Do: Sets up or maintains a metadata/taxonomy structure in a DAM (or DAM-like) system for a real asset library and demonstrates that assets can be found and reused correctly.

**4. `packaging-artwork-compliance` — Packaging artwork workflow and compliance**
- Know: Knows the packaging artwork production pipeline — artwork management, versioning, and the regulatory and print-quality requirements that govern packaging graphics.
- Understand: Understands why packaging compliance failures (labeling errors, missed regulatory requirements) are costly, and why versioning discipline prevents them.
- Do: Manages a packaging artwork file through versioning and a compliance check — regulatory, brand, or print-quality — using a defined checklist or an AI-assisted review tool.

**5. `systems-automation-integration` — Systems automation and integration**
- Know: Knows the basics of scripting, APIs, and low-code automation tools used to connect creative, workflow, and AI systems, and where automation commonly breaks.
- Understand: Understands why automating a handoff between systems requires understanding both systems' data and failure modes, not just the happy path.
- Do: Builds or configures an automation — a script, an API integration, or a low-code workflow — that handles a real handoff between two systems, including a generative-AI step.

**6. `colour-management` — Colour management**
- Know: Knows colour-management fundamentals — profiles, calibration, and process control — across the print processes and devices used in GC production.
- Understand: Understands why colour drifts across devices and substrates without active process control, and why colour accuracy is a measurable, auditable standard, not a subjective preference.
- Do: Sets up or audits colour management — calibration, profiling, or process control — for a real print or packaging job and demonstrates the job meets a defined colour standard.

**7. `quality-frameworks` — AI and quality governance** *(id kept; descriptors broadened from "AI output quality" to brand/legal/print-quality governance generally)*
- Know: Knows the dimensions on which creative, production, and AI-assisted output is evaluated — brand, legal/regulatory, and print-quality standards — and where each kind of check belongs in a workflow.
- Understand: Understands why quality and compliance checking requires domain expertise and can't be fully automated, and why someone must stay accountable for AI-assisted output specifically.
- Do: Builds or operates a quality/compliance review step in a real workflow — a brand check, a legal/regulatory check, or a print-quality check — that catches failure modes consistently, including checks on AI-assisted output.

**Overlap check against target 4 (`creative-generalist`):** target 4 keeps `ai-tool-direction` (prompt design, iteration, quality evaluation *for content-making*) and `cross-medium-production`, `aesthetic-judgment`, `brief-translation`, `conceptual-development`, `brand-standards-application`. None of those six duplicate the seven above — target 4 stays about making things; target 5 stays about the systems things flow through. The one place this needed an explicit call is `prompt-design` (old target-5 id) vs. target 4's `ai-tool-direction` — see §5.

---

**8. `ai-tool-evaluation` — AI implementation, benchmarking and evaluation** *(id kept; broadened from "evaluate generative AI tools" to the full adoption cycle, owner 2026-10-06)*
- Know: Knows how AI models and tools are chosen and deployed in creative and production operations, and the measures used to judge them: output quality against a reference set, error and failure-mode rates, cost per item, turnaround, and consistency across runs.
- Understand: Understands why an AI tool must be benchmarked on the organisation's own work, not vendor demos; why results drift as models change; and how to weigh quality, cost, risk and staff workload in an adopt-or-drop decision.
- Do: Implements an AI step in a real workflow, builds a small benchmark (a test set and scoring rule) comparing it with the current process, runs it, and writes a recommendation to adopt, adjust or drop, with the evidence.

---

## 5. Mapping table: old sub-competency → new

| Old id | Verdict | Where it lands | Why |
|---|---|---|---|
| `ai-tool-evaluation` | **Kept, id unchanged** | `ai-tool-evaluation` | Owner, 2026-10-06: AI must be prominent in this target, well beyond usage. Broadened from evaluating generative-AI tools to the full cycle: implementation, benchmarking, evaluation, adoption decision. Descriptors change — **re-score required**. |
| `workflow-architecture` | **Kept, id unchanged** | `workflow-architecture` | Same conceptual slot, broadened from "sequence human and AI work" to full workflow-platform configuration and operation. Descriptors change — **re-score required**, old coverage rows don't reflect the new rubric. |
| `prompt-design` | **Retired** at target 5; **not duplicated** at target 4 | Target 4's existing `ai-tool-direction` already covers prompt design/iteration/quality-eval for content-making | Per the owner's split rule, content-making with AI is target 4's territory. `ai-tool-direction` already exists there — no new id needed. |
| `quality-frameworks` | **Kept, id unchanged** | `quality-frameworks` | Broadened from "AI output quality" to brand/legal/print-quality governance generally, with AI as one input. Descriptors change — **re-score required**. |
| `change-management` | **Retired, no replacement** | — | Not one of the seven evidenced strands. The "monitor and maintain" and "train teams" language from the job descriptions is folded into `brand-system-templating`'s do-descriptor instead of standing alone. Flagged as an open question in §6 — the owner may want to keep this as a distinct sub-competency. |
| `domain-grounding` | **Retired, distributed** | Folded into the K-descriptors of `colour-management`, `packaging-artwork-compliance`, and `brand-system-templating` | Matches how other targets (e.g., Production & Operations) embed domain literacy inside specific competencies rather than always having one generic "domain knowledge" slot — though Production & Operations *does* keep a standalone one, so this is a judgment call, not a hard rule. Open question in §6. |
| *(none)* | **New** | `brand-system-templating` | New evidenced strand (#1), no prior analog. |
| *(none)* | **New** | `digital-asset-management` | New evidenced strand (#3). |
| *(none)* | **New** | `packaging-artwork-compliance` | New evidenced strand (#4). |
| *(none)* | **New** | `systems-automation-integration` | New evidenced strand (#5). |
| *(none)* | **New** | `colour-management` | New evidenced strand (#6), added by owner decision 2026-10-05 after the first draft of the evidence file. |

**Net:** 2 of 6 old ids kept (descriptors changed on both); 4 retired with no replacement id; 5 new ids added. Final count: 7 sub-competencies.

---

## 6. What re-scoring this implies

Read-only counts from the live database (2026-10-05), scoped to `career_target_id = 'ai-workflow'`:

| Measure | Count |
|---|---|
| `snapshot_target_coverage` rows for `ai-workflow` | **36** |
| Distinct capture snapshots covered | **6** |
| Distinct courses covered (any snapshot) | **5** |
| Rows per sub-competency | 6 each, evenly split across all 6 current sub-competencies |
| Total courses in the catalog (`courses` table) | 50 |
| Total capture snapshots (all targets) | 26, across 18 distinct courses |

**What that means concretely:**

- **All 36 existing rows are stale** once this ships, regardless of whether their sub-competency id is kept or retired:
  - 18 rows (`workflow-architecture`, `quality-frameworks` and `ai-tool-evaluation`, 6 each) sit under ids that are *kept* but whose descriptors changed — these need a fresh AI coverage run against the new rubric, not a mechanical carry-forward.
  - 18 rows (`prompt-design`, `change-management`, `domain-grounding` — 6 each) sit under ids that are *retired*. They become historical-only: still valid rows (the FK and `retired` flag handle this safely, same soft-delete pattern used elsewhere in the schema), but any current coverage view or program-matrix read for target 5 needs to exclude retired sub-competencies, or those 4 retired slots will silently show stale data forever.
- **5 new sub-competencies start at zero rows.** First-time scoring is needed for any course judged in scope, and decision 2 (§2) means that scope is **broader than the current 5 courses** — colour-management, prepress, production, and packaging courses that were never captured against this target at all are now plausibly in scope, since those are exactly where early-career Do-evidence should appear. There are 18 distinct captured courses today and 50 in the catalog; which of those are actually in scope for target 5 is an open call (§7 Q4), not something this draft can determine from the schema alone.
- **Tables touched by applying this draft** (not done here — read-only task):
  - `career_targets`: 1 row updated (`name`, `shortDefinition`, descriptor arrays, `defensibilityNote`; `id` and `socCode` unchanged).
  - `sub_competencies`: 3 rows updated in place (`workflow-architecture`, `quality-frameworks`, `ai-tool-evaluation`), 3 rows set `retired=true` (`prompt-design`, `change-management`, `domain-grounding`), 5 rows inserted.
  - `snapshot_target_coverage`: 36 existing rows become stale in the sense above; none need deleting (soft-delete handles it), but a re-score pass is needed for the 3 kept ids on the 5 already-captured courses (minimum ~10–12 rows) plus first-time scoring for the 5 new ids on whichever courses end up in scope.
  - Anything downstream that reads `snapshot_target_coverage` filtered by `career_target_id = 'ai-workflow'` — the program coverage matrix and the scaffolding analysis were not inspected in this draft task (out of scope; flagging so whoever applies this checks both before/after).

---

## 7. Open questions for the owner

1. **`change-management` — keep, drop, or fold in?** This draft retires it with no replacement, since it isn't one of the evidence file's seven strands. But "train a small team to operate a documented workflow" does appear in the job-description paraphrase for the senior AI-integration-lead role. Keep retired, or restore as an eighth sub-competency (pushing past the 5–7 target band)?
2. **`domain-grounding` — distribute or keep standalone?** This draft folds general domain literacy into three of the new sub-competencies' K-descriptors rather than keeping a generic slot, unlike Production & Operations (which keeps a standalone `domain-knowledge` sub-competency). Confirm that's the right call for target 5, or keep a standalone domain sub-competency and drop to 6 of the new ones to stay in band.
3. **`prompt-design` — any coverage-continuity concern?** The old target-5 `prompt-design` rows (6, across the same 5 courses) are retired with no target-5 replacement, on the theory that target 4's `ai-tool-direction` already covers this. Those 5 courses have likely never been scored against target 4 at all — worth confirming whether that gap should be closed (i.e., run those 5 courses against target 4 too) as part of applying this change, or left for a separate pass.
4. **Which courses are in scope for first-time target-5 scoring, and at what depth?** Decision 2 (§2) means Do-evidence should appear early in the curriculum (colour management, prepress, intro production, packaging courses), not only in an advanced/capstone course. This draft doesn't have a course list — someone with curriculum knowledge needs to name candidate courses for each of the 7 sub-competencies, especially `colour-management` and `packaging-artwork-compliance`, before any AI coverage run.
5. **Sub-competency wording review.** Confirm the 7 names and descriptors in §4 match intent — in particular whether `colour-management` should stand alone (as the evidence file's owner decision implies) or be folded into `packaging-artwork-compliance`, since colour process control is heavily packaging/print-adjacent.
6. **id churn.** This draft proposes keeping 3 of 6 old ids, retiring 3, and adding 5 new ones (net 8). If the owner would rather preserve more continuity (e.g., rename ids in place instead of retiring + adding new), that changes which existing coverage rows can be mechanically carried forward vs. need a fresh AI run — worth deciding before anyone touches the seed file.
