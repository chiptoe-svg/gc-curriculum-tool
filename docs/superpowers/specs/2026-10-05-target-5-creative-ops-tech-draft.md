# Target 5 redefinition — Creative Technology & Systems

> **Revision 2026-10-06 (owner):** AI must be prominent in this target, well beyond usage: implementation, benchmarking and evaluation. `ai-tool-evaluation` is kept and broadened into an eighth sub-competency, and the definition and descriptors now say so. Nine sub-competencies is above the usual 5–7; folding colour management into packaging (open question 5) would bring it to eight.
> **Revision 2026-10-06 (owner):** `domain-grounding` is kept as its own competency: domain knowledge is why this target belongs in a GC major.
> **Revision 2026-10-06 (owner, later same day):** target 5 renamed again, from "Creative Operations & Technology" to **Creative Technology & Systems** (id stays `ai-workflow`), as part of a same-day rename of all five targets and a full walkthrough that settled canonical definitions for all five — `ai_career_impact/targets/DEFINITIONS.md`. Target 5's core test is now explicit: **"does this person build or run something other people use to do the work?"** — "the enabling layer." Scope also widened to include IT support and management/systems analyst roles, and logistics was moved out to target 1. See §0 and §3a below for what's new; §1–§7 are the 2026-10-05 draft, superseded only where §3a says so (the seven strands, the nine sub-competencies, and the open questions otherwise stand).

**STATUS: DRAFT FOR OWNER REVIEW.** Nothing here has been applied. `lib/domain/seed-targets.ts` and the live database are unchanged. This file is read-only analysis plus a proposal.

**Date:** 2026-10-05

**Source of the redefinition:** `ai_career_impact/targets/5-creative-operations-technology.md` (commit `bbc53b6`, independently fact-checked; owner decisions layered in on top by commits `a524bbd` and `81a4b8a`) and `ai_career_impact/STATE.md`. Quotes and figures below are paraphrased from that file's §1, §3, §4, §6, and §8 — see those sections for full sourcing and caveats. The five job descriptions cited there are confidential (marked so by the employer): this draft paraphrases them, as the evidence file does, and never names the employer or quotes the postings directly.

The career target's database id stays `ai-workflow` — only the name and descriptors change. Target 4's id and content (`creative-generalist`) are not touched by this draft; they're read here only to avoid overlap.

---

## 0. Value chain and names — Revision 2026-10-06

On 2026-10-06, after this draft's first pass, the owner did a full walkthrough of all five targets and settled canonical names, numbering, and definitions for all of them in one sitting. Source of truth: `ai_career_impact/targets/DEFINITIONS.md` and the matching `ai_career_impact/STATE.md` entries dated 2026-10-06. This section (and §3a below) layer that walkthrough onto the 2026-10-05 target-5 draft; §1–§7 are otherwise unchanged.

**The frame: one value chain.** Each target is a link; GC's distinctive thread across all five is *understanding the downstream consequences* of the work — what happens to it after it leaves your hands, in production, in the market, in the systems.

| # | id | Name (2026-10-06) | Role in the chain | Changed from |
|---|---|---|---|---|
| 1 | `production-operations` | Production & Operations | **Makes it real** | unchanged |
| 2 | `account-management` | Sales Solutions & Account Management | **Supplies** the solutions production and brands need, on the vendor side | "Account Management" |
| 3 | `brand-strategy` | Brand Strategy & Experience | **Decides** what to do, on the brand or agency side | "Brand Strategy" |
| 4 | `creative-generalist` | Purposeful Design & Creative Generalist | **Designs** how it will look and work, across media | "Creative Generalist" (itself a 2026-10-05 rename from "Creative Generalist / AI-Native") |
| 5 | `ai-workflow` | Creative Technology & Systems | **Enables** all of the above with the tools and systems others use | "Creative Operations & Technology" (itself a 2026-10-05 rename from "AI Workflow / Orchestrator") |

All five renames are names-only and already applied on `dev` in `lib/domain/seed-targets.ts` (commit `28eca9d`) and in the live DB and wiki. **This worktree's branch point predates that commit**, so the copy of `lib/domain/seed-targets.ts` read for this draft (and quoted in §4 below) still shows the pre-rename names (`Account Management`, `Brand Strategy`, `AI Workflow / Orchestrator`); the content — ids, descriptors, sub-competencies — is unaffected and current. Don't be alarmed by the mismatch if you diff this draft against that file directly; it's a branch-timing artifact, not a contradiction.

**A numbering note.** This draft's own §2 and Appendix, written 2026-10-05, refer to the account-management target as "target 3" in one heading ("Narrowed, target 3 (`account-management`)"). Per the canonical numbering settled 2026-10-06 above, `account-management` is **target 2** and `brand-strategy` is **target 3**. The heading in the Appendix is left as originally written (existing sections aren't edited), but should be read as target 2. The content of that Appendix entry — narrowing `project-oversight` to client-facing coordination — is correct regardless of the number attached to it.

**Decisions that reach beyond target 5, settled the same day:**
- Target 1 (`production-operations`) scope confirmed: estimating, process engineering, equipment justification, people management (including HR, decided earlier), at printers, packaging converters, brand-side production/procurement, and agency production departments. Project management (SOC 13-1082) belongs here — already handled in this draft's Appendix.
- Target 2 (`account-management`) scope confirmed: **all** sales, account management, technical sales, and customer-service roles — nothing excluded. What sets it apart is the skill emphasis: technical and fiscal — understanding the technology and process, building the ROI case, making the numbers work — not relationship skills alone. Entry-level customer service is this target's on-ramp.
- Target 4 (`creative-generalist`) builds AI tools **for its own use**; target 5 builds them **for others**. That's the line between the two targets. One consequence: some tool-building — scripting, assembling a small AI workflow — is a target-4 requirement too, not purely a target-5 one. See §3a's revisit of the `prompt-design` retirement below.
- Target 5 (`ai-workflow`) scope widened: IT support, management/systems analysts, platform/integration roles, and AI implementation/evaluation are explicitly included; logistics is explicitly moved **out**, to target 1. Core test: *"does this person build or run something other people use to do the work?"*

§2 below (target 1 / target 3-labeled-as-2 appendix) and §3a (targets 1, 2, 3, 4 proposed changes) carry these decisions into the seed-file shape. §3/§4 (target 5's own definition and sub-competencies) are revised in §3a's final subsection to the new name and scope.

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

## 4. Proposed sub-competencies (9)

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
| 9 | `domain-grounding` *(kept, broadened)* | Domain grounding: creative, brand and production knowledge |

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

**9. `domain-grounding` — Domain grounding: creative, brand and production knowledge** *(id kept; broadened from AI output to all systems work, owner 2026-10-06)*
- Know: Knows enough of the creative, brand and print/production domain (substrates, colour, finishing, brand standards, how creative work is made and approved) to judge whether a workflow, template, automation or AI output is fit for purpose.
- Understand: Understands why systems built without domain knowledge look correct but fail at the point of use, and why that knowledge is what separates this role from a general IT or automation role.
- Do: Designs or evaluates a workflow, template system, automation or AI step and shows, with specific domain reasons, where it would succeed or fail in a real creative or production setting.

---

## 5. Mapping table: old sub-competency → new

| Old id | Verdict | Where it lands | Why |
|---|---|---|---|
| `ai-tool-evaluation` | **Kept, id unchanged** | `ai-tool-evaluation` | Owner, 2026-10-06: AI must be prominent in this target, well beyond usage. Broadened from evaluating generative-AI tools to the full cycle: implementation, benchmarking, evaluation, adoption decision. Descriptors change — **re-score required**. |
| `workflow-architecture` | **Kept, id unchanged** | `workflow-architecture` | Same conceptual slot, broadened from "sequence human and AI work" to full workflow-platform configuration and operation. Descriptors change — **re-score required**, old coverage rows don't reflect the new rubric. |
| `prompt-design` | **Retired** at target 5; **not duplicated** at target 4 | Target 4's existing `ai-tool-direction` already covers prompt design/iteration/quality-eval for content-making | Per the owner's split rule, content-making with AI is target 4's territory. `ai-tool-direction` already exists there — no new id needed. |
| `quality-frameworks` | **Kept, id unchanged** | `quality-frameworks` | Broadened from "AI output quality" to brand/legal/print-quality governance generally, with AI as one input. Descriptors change — **re-score required**. |
| `change-management` | **Retired, no replacement** | — | Not one of the seven evidenced strands. The "monitor and maintain" and "train teams" language from the job descriptions is folded into `brand-system-templating`'s do-descriptor instead of standing alone. Flagged as an open question in §6 — the owner may want to keep this as a distinct sub-competency. |
| `domain-grounding` | **Kept, id unchanged** | `domain-grounding` | Owner, 2026-10-06: domain knowledge is the reason this target sits in a GC major, so it stays a scored competency. Broadened from judging AI output to judging any workflow, template, automation or AI output against creative, brand and production reality. Descriptors change — **re-score required**. |
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
  - 24 rows (`workflow-architecture`, `quality-frameworks`, `ai-tool-evaluation` and `domain-grounding`, 6 each) sit under ids that are *kept* but whose descriptors changed — these need a fresh AI coverage run against the new rubric, not a mechanical carry-forward.
  - 12 rows (`prompt-design`, `change-management` — 6 each) sit under ids that are *retired*. They become historical-only: still valid rows (the FK and `retired` flag handle this safely, same soft-delete pattern used elsewhere in the schema), but any current coverage view or program-matrix read for target 5 needs to exclude retired sub-competencies, or those 4 retired slots will silently show stale data forever.
- **5 new sub-competencies start at zero rows.** First-time scoring is needed for any course judged in scope, and decision 2 (§2) means that scope is **broader than the current 5 courses** — colour-management, prepress, production, and packaging courses that were never captured against this target at all are now plausibly in scope, since those are exactly where early-career Do-evidence should appear. There are 18 distinct captured courses today and 50 in the catalog; which of those are actually in scope for target 5 is an open call (§7 Q4), not something this draft can determine from the schema alone.
- **Tables touched by applying this draft** (not done here — read-only task):
  - `career_targets`: 1 row updated (`name`, `shortDefinition`, descriptor arrays, `defensibilityNote`; `id` and `socCode` unchanged).
  - `sub_competencies`: 4 rows updated in place (`workflow-architecture`, `quality-frameworks`, `ai-tool-evaluation`, `domain-grounding`), 2 rows set `retired=true` (`prompt-design`, `change-management`), 5 rows inserted.
  - `snapshot_target_coverage`: 36 existing rows become stale in the sense above; none need deleting (soft-delete handles it), but a re-score pass is needed for the 4 kept ids on the 5 already-captured courses (minimum ~10–12 rows) plus first-time scoring for the 5 new ids on whichever courses end up in scope.
  - Anything downstream that reads `snapshot_target_coverage` filtered by `career_target_id = 'ai-workflow'` — the program coverage matrix and the scaffolding analysis were not inspected in this draft task (out of scope; flagging so whoever applies this checks both before/after).

---

## 7. Open questions for the owner

1. **`change-management` — keep, drop, or fold in?** This draft retires it with no replacement, since it isn't one of the evidence file's seven strands. But "train a small team to operate a documented workflow" does appear in the job-description paraphrase for the senior AI-integration-lead role. Keep retired, or restore as an eighth sub-competency (pushing past the 5–7 target band)?
2. ~~`domain-grounding` — distribute or keep standalone?~~ **Decided 2026-10-06: keep standalone** (owner: "otherwise why have it in this major").
3. **`prompt-design` — any coverage-continuity concern?** The old target-5 `prompt-design` rows (6, across the same 5 courses) are retired with no target-5 replacement, on the theory that target 4's `ai-tool-direction` already covers this. Those 5 courses have likely never been scored against target 4 at all — worth confirming whether that gap should be closed (i.e., run those 5 courses against target 4 too) as part of applying this change, or left for a separate pass.
4. **Which courses are in scope for first-time target-5 scoring, and at what depth?** Decision 2 (§2) means Do-evidence should appear early in the curriculum (colour management, prepress, intro production, packaging courses), not only in an advanced/capstone course. This draft doesn't have a course list — someone with curriculum knowledge needs to name candidate courses for each of the 7 sub-competencies, especially `colour-management` and `packaging-artwork-compliance`, before any AI coverage run.
5. **Sub-competency wording review.** Confirm the 7 names and descriptors in §4 match intent — in particular whether `colour-management` should stand alone (as the evidence file's owner decision implies) or be folded into `packaging-artwork-compliance`, since colour process control is heavily packaging/print-adjacent.
6. **id churn.** This draft proposes keeping 4 of 6 old ids, retiring 2, and adding 5 new ones (net 9). If the owner would rather preserve more continuity (e.g., rename ids in place instead of retiring + adding new), that changes which existing coverage rows can be mechanically carried forward vs. need a fresh AI run — worth deciding before anyone touches the seed file.

---

## Appendix: related changes to targets 1 and 3 (owner, 2026-10-06)

Decision: project management (SOC 13-1082) belongs to target 1. The owner chose to give target 1 its own project-management competency and narrow target 3's to client-facing coordination (option b), rather than moving target 3's competency.

**New, target 1 (`production-operations`): `project-management` — Project management across creative and production work**
- Know: Knows the project life cycle (scope, plan, schedule, budget, risk, change control, close-out) and the standard tools for each: work breakdown, dependencies, critical path, status reporting.
- Understand: Understands why projects fail at scope and handoff rather than at execution, and why a plan has to be re-baselined when scope, budget or dates change rather than quietly absorbed.
- Do: Plans and runs a real creative or production project from brief to delivery: defines scope, builds the schedule and budget, tracks risks and changes, reports status, and closes it out with a lessons-learned record.

Overlap to watch: target 1 already has `timeline-management` (schedule under pressure), `cost-management` (estimating and budgets) and `team-coordination`. The new competency is the end-to-end discipline that ties them together; it should not re-score the same evidence those three already capture. If the owner prefers fewer competencies, the alternative is to broaden `timeline-management` into project management instead of adding a seventh target-1 competency.

**Narrowed, target 3 (`account-management`): `project-oversight` (id kept) — Client-facing project coordination**
- Know: Knows the handoff points between brief, creative, prepress, production and delivery, and which of them need client sign-off.
- Understand: Understands why the client's expectations on timeline, quality and cost have to be managed continuously, and how to communicate trade-offs before they become surprises.
- Do: Keeps the client and the internal creative and production teams aligned through a project, managing approvals, changes and expectations, while the production side runs the plan.

Re-scoring: target 3's `project-oversight` descriptors change, so its existing coverage rows need a fresh run; target 1's new competency starts with none. Both go in the same batch as the target 5 re-score.

---

## 8. Proposed changes to targets 1, 2, 3, 4 — Revision 2026-10-06

Driven only by the 2026-10-06 owner decisions in §0 and `ai_career_impact/targets/DEFINITIONS.md`. Conservative throughout: every id below is **kept** — nothing is retired or added for these four targets — and descriptors change only where a decision requires it. Current content is quoted from `lib/domain/seed-targets.ts` as it reads on this branch (pre-rename names; see §0's note). All four `shortDefinition` edits below are proposed rewrites of the live field, shown as a full replacement rather than a diff, since the changes touch more than a clause.

### 8.1 Target 1 — `production-operations` (Production & Operations)

No name change (already correct). DEFINITIONS.md's explicit list — estimating, process engineering, equipment justification, people management including HR, across printers, packaging converters, brand-side production/procurement, and agency production departments — is mostly already covered by the current seven sub-competencies plus the Appendix's new `project-management`. Two gaps: **equipment justification** (a capital-investment business case, distinct from per-job cost estimation) and **process engineering** (re-engineering a production process itself, distinct from designing a single project's workflow) aren't currently named anywhere. Rather than add two more ids on top of the Appendix's `project-management` (which would bring the target to nine — well past the 5–7 band), this draft folds both into the two closest existing competencies by broadening their descriptors, and makes the agency setting and HR scope explicit in `shortDefinition`.

**Proposed `shortDefinition`** (replaces the current field; added language in *italics* for review — remove italics on apply):
> The role that makes creative and brand work actually happen — on time, on spec, and within budget, *at printers and packaging converters, brand-side production and procurement, and agency production departments*. Production managers design and oversee the workflows, quality systems, vendor relationships, equipment and process decisions, and team and people-management responsibilities *(including HR)* that translate a creative brief into a finished physical or digital product.

**Broadened, id kept — `workflow-design` → "Production workflow design, process engineering, and optimization"**
- Know: Knows the standard workflow patterns for offset, digital, flexo, and packaging production, *and the basics of process engineering — re-sequencing, automating, or re-tooling a production process itself to change its throughput, quality, or cost profile*.
- Understand: Understands why workflow design must balance throughput, quality, and adaptability — and why optimizing one trades off another — *and why a process re-engineering change (not just a project's workflow) needs validation before it replaces a working process*.
- Do: Designs a production workflow for a multi-component project that meets quality, timeline, and budget constraints*, or re-engineers a step in an existing production process and validates the change before it replaces what's running*.

**Broadened, id kept — `cost-management` → "Cost estimation, budget management, and equipment justification"**
- Know: Knows the cost structures of major print and packaging processes, *and how to build a capital-equipment business case — purchase cost, throughput or quality gain, and payback period — distinct from a per-job estimate*.
- Understand: Understands why cost estimation requires reconciling specification, vendor capability, and run-length economics, *and why an equipment decision is judged over a multi-year payback horizon, not a single job's margin*.
- Do: Produces a defensible cost estimate for a complex production project and manages spend through to delivery*, or builds an equipment-justification case (cost, gain, payback) for a real or proposed purchase*.

**Broadened, id kept — `team-coordination` → "Team coordination, performance management, and people management (incl. HR)"**
- Know: Knows how production teams are structured and the typical responsibilities at each role, *and the basics of the people-management functions that sit alongside day-to-day coordination — hiring, onboarding, and performance/HR policy*.
- Understand: Understands why coordination breaks down under stress and what practices preserve communication, *and why hiring and performance-policy decisions have consequences that outlast any single project*.
- Do: Coordinates a production team through a high-pressure project and addresses performance gaps in real time*, and carries out at least one people-management task end-to-end (a hire, an onboarding plan, or a documented performance review) for a real or simulated team*.

No change: `quality-control`, `vendor-management`, `timeline-management`, `domain-knowledge`. These aren't touched by the 2026-10-06 decisions.

Net effect: target 1 stays at 7 ids plus the Appendix's `project-management` = 8 total, three of the seven broadened, none added or retired for this section. (The Appendix already flagged that 8 is above the usual band and offered broadening `timeline-management` instead as an alternative — that trade-off is unchanged by this section.)

### 8.2 Target 2 — `account-management` → rename to **Sales Solutions & Account Management**

This is the one target where the 2026-10-06 decision changes the frame, not just the scope. The current `shortDefinition` and sub-competencies read as brand/agency-side account management (bridging "a brand's marketing intent" to production). The owner's decision reframes it as the **vendor-side solution seller**: all of sales, account management, technical sales, and customer service, with a technical-and-fiscal skill emphasis (understanding the technology/equipment/process, building the ROI case, making the numbers work) rather than relationship skills alone. Boundary with target 3: target 3 decides (brand/agency side); target 2 serves those decisions with solutions (vendor side).

**Proposed `shortDefinition`** (full replacement):
> The solution-seller on the vendor side — sales, account management, technical sales, and customer-service roles at printers, packaging converters, and equipment or technology suppliers. Acts as liaison between the creative/production side and the people deciding what to buy: understands the buyer's problem, builds the ROI case, makes the numbers work, and justifies the purchase. Entry-level customer service is this target's on-ramp, not a separate track.

**Proposed `industryContexts`** (add a fourth; keep the existing three):
- *(existing)* Agency account team serving brand clients across print and digital deliverables
- *(existing)* In-house brand marketing coordinator translating creative briefs to vendors
- *(existing)* Print/packaging sales representative consulting on production specifications
- **(new)** Technical sales or customer-service representative at an equipment or technology supplier, building the ROI case for a prospective buyer

**Broadened, id kept — `proposal-development` → "Proposal development, consultative communication, and the ROI case"**
- Know: Knows the structural elements of a client proposal and the rhythm of consultative communication, *and how to build a cost/benefit or ROI case — payback, total cost of ownership, cost-per-unit — that quantifies why a purchase pays for itself*.
- Understand: Understands why a proposal must justify scope, sequence, and cost in business terms — not creative terms — *and why a buying decision ultimately rests on a quantified business case, not the relationship alone*.
- Do: Writes and presents a proposal that wins client commitment and sets accurate expectations for delivery*, including a quantified ROI or TCO case for the solution being proposed*.

**Broadened, id kept — `gc-production-literacy` → "Domain literacy in production technology, equipment, and process"**
- Know: Knows what print, packaging, and brand production processes can and cannot accommodate*, and what the equipment or technology being sold can and cannot do, well enough to speak to it credibly on the vendor side*.
- Understand: Understands why this knowledge is what differentiates a credible account manager *or technical sales rep* from an order-taker.
- Do: Holds a substantive conversation with a brand director *or a prospective buyer* and turns to brief a production team *or a sales engineer* accurately.

No change: `client-needs-diagnosis`, `results-interpretation`. `project-oversight` is already narrowed by this file's Appendix (labeled "target 3" there — per §0's numbering note, read as target 2/`account-management`); not touched again here.

Net effect: still 5 ids, two broadened, none added or retired.

### 8.3 Target 3 — `brand-strategy` → rename to **Brand Strategy & Experience**

No sub-competency changes required by the 2026-10-06 decisions — DEFINITIONS.md's target-3 description ("decides what to do next... communicates with all those parties and gets the best out of them... mostly a destination, usual entry a marketing coordinator or specialist role") is consistent with the current shortDefinition and all six sub-competencies. This is a name-only change for target 3's core content; the one piece of target-3-adjacent content that *does* change is the Appendix's `project-oversight` narrowing — but that competency lives on `account-management` (target 2), not here (see §0's numbering note).

**Proposed `shortDefinition`** (light touch only — added language in *italics*):
> The analytical and strategic layer of marketing — understanding consumers, competitors, and market conditions well enough to define where a brand should position itself and how, *and to direct and get the best out of the creative, production, and vendor parties who carry that decision out*. *Mostly a destination role: the usual entry is a marketing coordinator or specialist position that grows into strategy.*

No change: all six sub-competencies (`consumer-research`, `competitive-analysis`, `brand-positioning`, `campaign-measurement`, `quantitative-literacy`, `cross-channel-translation`).

### 8.4 Target 4 — `creative-generalist` → rename to **Purposeful Design & Creative Generalist** *(name already set 2026-10-05; unchanged here)*

One decision reaches target 4 directly: it **builds AI tools for its own use**, where target 5 builds them **for others** — that's the line between the two targets (§0). This confirms the original draft's call (§5) that retiring target 5's `prompt-design` into target 4's `ai-tool-direction` was the right move, since content-making-with-AI is target 4's territory either way. But it also means `ai-tool-direction` needs to be read — and described — a little more broadly than "prompt design, iteration, quality evaluation" for *content*: it should also cover the lightweight tool-building (a prompt chain, a small script, a personal automation) that a generalist assembles for their own workflow, short of building systems other people run (target 5's job).

**Broadened, id kept — `ai-tool-direction` → "AI tool direction and personal tool-building: prompt design, iteration, quality evaluation"**
- Know: Knows the capabilities and failure modes of major generative AI tools across image, copy, and video, *and how to script or assemble a lightweight personal AI workflow or tool (a prompt chain, a small automation) to speed their own work*.
- Understand: Understands why AI outputs require iteration grounded in human judgment about what good looks like, *and why building a small tool for one's own workflow is now baseline fluency for this target — distinct from building a system other people run, which is target 5's job*.
- Do: Directs an AI workflow from prompt through final output that meets brand quality standards*, and, where useful, builds or configures a small AI tool or automation for their own workflow and documents it well enough to reuse*.

No change: `conceptual-development`, `aesthetic-judgment`, `cross-medium-production`, `brand-standards-application`, `brief-translation`. DEFINITIONS.md's classification note that developers who build a *client-deliverable* website or product (as opposed to internal tools) belong here is a classification clarification only — it doesn't require a new sub-competency, since `cross-medium-production` and `brief-translation` already cover that work generically.

This resolves part of open question 3 (§7, carried to §11): the retirement of target-5 `prompt-design` into target-4 `ai-tool-direction` is confirmed correct, with slightly broadened scope. The coverage-continuity gap it flagged — the 5 courses captured under the retired `prompt-design` have likely never been scored against `ai-tool-direction` at all — still stands and still needs a decision (see §11).

---

## 9. Target 5 update — name and scope — Revision 2026-10-06

This supersedes only the **name** and the **framing sentences** in §3 above; the shortDefinition, descriptors, and all nine sub-competencies in §3/§4 stand as written — none of them conflict with the 2026-10-06 walkthrough; they're confirmed, not revised.

- **Name:** Creative Operations & Technology → **Creative Technology & Systems**. Id unchanged (`ai-workflow`).
- **Core definition, now explicit:** "the enabling layer — building or running the tools, systems and processes the other targets use to get creative-related work done." Membership test: *does this person build or run something other people use to do the work?* This is the same idea §3's shortDefinition already expressed ("Builds and runs the templates, workflow platforms, asset libraries, automations, and compliance checks that creative and production work flows through") — the 2026-10-06 wording just sharpens it into a one-line test, and confirms the §4 sub-competencies (workflow platforms, DAM, packaging compliance, automation, colour, AI governance, AI evaluation, domain grounding) all pass that test.
- **Scope widened, confirmed in scope:** IT support (SOC 15-1232), management and systems analysts (13-1111, 15-1211), platform/integration roles, and AI implementation/evaluation roles. None of these require a new sub-competency: IT support and systems-analyst work is carried by `workflow-architecture` (platform configuration and operation) and `systems-automation-integration` (scripting, APIs, integration) already drafted in §4; AI implementation/evaluation is exactly `ai-tool-evaluation`.
- **Scope narrowed:** **logistics moves out, to target 1.** Logistics was never one of the evidence file's seven strands or one of the nine §4 sub-competencies, so nothing in §3/§4 needs to change to reflect this — it's a classification confirmation, not a content change. (Target 1's §8.1 shortDefinition doesn't call out logistics explicitly either; if the owner wants it named there, that's a one-line addition, flagged in §11.)

No change to the §3 `shortDefinition` text is proposed beyond the name itself — "the detail-oriented systems and workflow side of creative and production work... counterpart to Creative Generalist's maker side" already reads consistently with "the enabling layer." Whoever applies this draft should use the new name (**Creative Technology & Systems**) wherever this file's earlier sections say "Creative Operations & Technology."

---

## 10. Consolidated re-scoring table — Revision 2026-10-06

Read-only counts from the live database, via a throwaway `tsx` script (`lib/db/client`, `--env-file=.env.local`; deleted after use, nothing written). Confirms and extends §6's target-5-only numbers to all five targets:

| Target (id) | Total `snapshot_target_coverage` rows | Rows under **affected** sub-competencies (descriptors changed or id retired) | Rows under **unaffected** sub-competencies | New ids (0 rows, first-time scoring) |
|---|---|---|---|---|
| 1 `production-operations` | 42 (7 ids × 6) | 18 (`workflow-design`, `cost-management`, `team-coordination` — 6 each) | 24 (`quality-control`, `vendor-management`, `timeline-management`, `domain-knowledge`) | `project-management` (Appendix) |
| 2 `account-management` | 30 (5 ids × 6) | 18 (`proposal-development`, `gc-production-literacy`, `project-oversight` — 6 each) | 12 (`client-needs-diagnosis`, `results-interpretation`) | none |
| 3 `brand-strategy` | 36 (6 ids × 6) | 0 — no sub-competency changes | 36 (all six) | none |
| 4 `creative-generalist` | 36 (6 ids × 6) | 6 (`ai-tool-direction`) | 30 (the other five) | none |
| 5 `ai-workflow` | 36 (6 ids × 6) | 36 — all six current ids become stale on apply (4 kept-but-broadened: 24 rows; 2 retired: 12 rows, see §6) | 0 | 5 (`brand-system-templating`, `digital-asset-management`, `packaging-artwork-compliance`, `systems-automation-integration`, `colour-management`) |
| **Catalog totals** | **180** rows across all 5 targets, 26 capture snapshots (18 distinct courses), 50 courses total | **78** rows need a fresh AI scoring pass against changed descriptors | **102** rows stay valid as-is | **6** new ids start at zero (5 in target 5, 1 in target 1) |

Every sub-competency across every target currently has exactly 6 coverage rows, across the same 6 snapshots — the catalog's AI-scoring passes have so far run evenly across all targets and all of a given target's sub-competencies, never partially. That evenness is worth preserving: a re-score batch that covers all 78 affected rows in one pass (rather than target-by-target over time) keeps the catalog in the same consistent state it's in today.

None of targets 1–4's *existing* rows need deletion — same soft-delete-safe pattern as target 5 (§6): a kept-but-broadened id's old rows are stale evidence against a new rubric, not invalid rows, and get overwritten by the idempotent `UNIQUE(snapshot, target, sub_competency)` re-score, same as any other re-score.

---

## 11. Updated open questions for the owner — Revision 2026-10-06

Supersedes §7's list (kept above for the record; items 2 is resolved there already). Renumbered and consolidated:

1. **`change-management` — keep, drop, or fold in?** *(carried from §7.1, unresolved.)* Still open: restore as an eighth target-5 sub-competency, or leave retired with its "train a team" language folded into `brand-system-templating`?
2. **`prompt-design` retirement — close the coverage gap now or later?** *(carried from §7.3, sharpened by §8.4.)* §8.4 confirms target 4's `ai-tool-direction` is the right home and broadens it slightly to cover personal tool-building. The 5 courses previously scored against the now-retired target-5 `prompt-design` have likely never been scored against target-4 `ai-tool-direction` at all. Close that gap in the same batch as the rest of this re-score, or leave it for a separate pass?
3. **Target-5 course scope at each depth.** *(carried from §7.4, unresolved.)* Decision 2 (§2) means early/mid-curriculum Do-evidence is expected, not only capstone evidence. Still needs someone with curriculum knowledge to name candidate courses per sub-competency — now across 14 sub-competency ids total if targets 1, 2, and 4's broadened ones are included in the same pass.
4. **`colour-management` — standalone or folded?** *(carried from §7.5, unresolved.)*
5. **id churn at target 5.** *(carried from §7.6, unresolved.)*
6. **Target 1 — new, or broadened?** §8.1 folds "equipment justification" into `cost-management` and "process engineering" into `workflow-design` rather than adding two more ids on top of the Appendix's `project-management` (which would make 9 total). Is that the right call, or should either stand alone? Separately: target 1 is at 7 ids before the Appendix addition, 8 after — above the usual 5–7 band, same issue target 5 already has. Worth deciding once, for both targets, rather than target-by-target.
7. **Target 1 — name logistics explicitly?** Target 5's scope narrowing (§9) moves logistics to target 1, but §8.1's proposed `shortDefinition` doesn't name it. Add a clause, or leave it implicit in "production and operations"?
8. **Re-score batching.** §10 shows 78 rows across 4 targets need a fresh AI pass and 6 new ids need first-time scoring. Confirm whether to run this as one consolidated batch (preserving the catalog's current even-coverage pattern) or split by target as each target's draft is separately approved.
9. **Appendix heading correction.** §0 flags that the Appendix's "target 3 (`account-management`)" heading should read "target 2" under the canonical numbering. Harmless as analysis, but worth fixing before this draft is applied, so no one copies the wrong number into `lib/domain/seed-targets.ts` or a commit message.
