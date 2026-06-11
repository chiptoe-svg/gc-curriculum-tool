# Course Capture UX redesigns — landing + quick-review (Design)

> **Status:** design, 2026-06-10. Produced by a multi-agent design exploration (3 independent approaches per redesign, judged + synthesized). Grounds: the live UX review ([`docs/course-capture-ux-review.html`](../../course-capture-ux-review.html)) + the real components.
> **Relates:** `app/capture/[code]/ProfileReviewPanel.tsx` · `CaptureClient.tsx` · `CaptureChatPanel.tsx` · `MaterialsPanel.tsx` · `page.tsx`

These address the two abandon points the review found. The loved **interview itself is unchanged** in both — only the shell (landing) and the review surface change. The a11y quick-wins (slider labels, focusable chips, humanized validation) already shipped separately (2026-06-10).

---

## Redesign ① — Goal-first landing ("Ready to capture" hero)  · effort: medium

**Direction.** Approach 2 ("Ready to capture" hero) as the spine, grafted with the lowest-cost structural moves from Approaches 1 and 3.

Approach 2 wins because it is the only one that directly attacks the findings' top complaint — jargon + "what do I do" ambiguity — by leading with a plain-language goal sentence and a soft "Ready to capture" state instead of a token/objective status string, while still satisfying the one-primary-action and progressive-disclosure goals. Approaches 1 and 3 are essentially the same structural move (hoist the action, fold the rest) but anchor on the developer "status pill / Loaded line" framing rather than a faculty-legible purpose statement. I take Approach 2's hero and readiness framing, then graft: (a) from Approach 1 and 3, the single most concrete win — DELETE the "Loaded:" section in page.tsx (lines 177-188) outright rather than restyling it; (b) from Approach 3, the amber "large — review before starting" chip surfaced in the COLLAPSED Materials tray summary when totalAuditTokens crosses the existing 150k/220k thresholds, so the disclosure self-advertises exactly when hiding materials is actually risky; (c) from all three, the discipline of keeping handleStart and chooser state single-source by EXTRACTING the chooser rather than duplicating it.

**Mockup (returning / has-materials).**
```
RETURNING / HAS-MATERIALS (the common case)
┌──────────────────────────────────────────────────────────────────────────┐
│ CourseCapture · v1                  Guide↗  Program  Settings  Ask  Explore│
│ GC 1010 — Orientation to Graphic Communications                            │
├──────────────────────────────────────────────────────────────────────────┤
│  (the dense "Loaded: catalog entry · 5 stated objectives…" line is GONE)   │
│                                                                            │
│  ┌─ HERO (always the top thing; replaces chat empty-state as landing) ──┐ │
│  │                                                                       │ │
│  │  Capture what students actually walk away knowing, understanding,     │ │
│  │  and being able to do in GC 1010.                                     │ │
│  │                                                                       │ │
│  │  ✓ Ready to capture — your catalog entry and 3 materials are loaded.  │ │
│  │    A guided interview asks one focused question at a time (~10 min).  │ │
│  │                                                                       │ │
│  │  I'm the auditor:  [ Dr. Smith              ▾ ]                        │ │
│  │  ( ) Build on the May 3 capture (Dr. Lee)   ← only if a prior exists  │ │
│  │  (•) Fresh capture — from materials + catalog only                    │ │
│  │                                                                       │ │
│  │        ┌────────────────────────────────────┐                         │ │
│  │        │   ▶  Start the interview  (~10 min) │  ← THE one button      │ │
│  │        └────────────────────────────────────┘                         │ │
│
```

**Interaction model.** PRE-INTERVIEW LANDING (stage==='chat' && messages.length===0):
The page renders the new CaptureHero as the first and visually dominant element. Faculty read one purpose sentence, one plain-English readiness line, pick their name in "I'm the auditor", choose Build-on vs Fresh if a prior snapshot exists, and press one filled button "Start the interview". That button calls the SAME handleStart flow that runs today (instructorName=chooserInstructor, includePriorSessions = chooserMode!=='fresh'). On click, messages populate, messages.length>0 becomes true, the hero unmounts, and the existing live CaptureChatPanel transcript takes over — no behavior change to the interview.

If a prior profile exists, "View it →" is a quiet text link under the button that calls setStage('review') — never a second button competing with Start.

FIRST-RUN (stage==='chat' && messages.length===0 && materials.length===0):
Hero shows the empty-materials state with two weighted real buttons. "Add materials first (recommended)" expands+scrolls the Materials tray (opens it via a defaultOpen prop and focuses the upload control). "Start from catalog only" calls handleStart directly. The Materials tray also defaults OPEN in this state so the upload zone is immediately reachable.

PROGRESSIVE DISCLOSURE (all states):
The three trays below the hero are closed <details> rows. Each summary carries a one-line health string computed from already-present state: Materials = "3 active · catalog ✓" or, when totalAuditTokens crosses 150k/220k, "3 active · ⚠ large — review before starting"; Snapshots = "Prior captures (1

**Concrete changes.**
- **`app/capture/[code]/page.tsx`** — DELETE the dense status <section> at lines 177-188 (the 'Loaded: catalog entry · N stated objectives · …' line). Its facts become redundant once the hero shows 'Ready to capture — catalog + N materials loaded' and the Materials tray summary shows counts. No data-fetch change; materialCounts/builderProfile/priorCapture are already computed and passed to CaptureClient. Optionally thread a small derived readiness summary (hasMaterials, canvasCount, hasPriorProfile) so the hero renders its plain-language line without recomputing.
- **`app/capture/[code]/CaptureChatPanel.tsx`** — Extract the empty-state chooser JSX (lines 451-528: the instructor <select>, the priorSnapshotInfo Build-on/Fresh <fieldset>, and the 'Start audit' button) into an exported <SessionStartChooser> component that takes chooserInstructor/chooserMode (controlled), FACULTY_ROSTER, priorSnapshotInfo, busy, and onStart. Keep handleStart and the chooser state owning component as the single source of truth — the hero renders SessionStartChooser, so there is no state duplication. The chat empty-state then shows only the transcript placeholder text after Start. The live interview, citation chips, ReadinessStrip, and always-visible auditor badge (lines 370-409) are untouched.
- **`app/capture/[code]/CaptureHero.tsx`** — NEW component. Rendered by CaptureClient only when stage==='chat' && messages.length===0. Owns: the goal sentence ('Capture what students actually walk away knowing, understanding, and being able to do in {code}'), a plain-text readiness line ('Ready to capture' when materials.length>0, 'No materials yet — but you can still start' when 0 — NO dot meter, text only), the lifted SessionStartChooser, the single filled 'Start the interview' primary button, and a secondary 'View it →' link when a prior profile exists. First-run variant (materials.length===0) renders the two weighted buttons ('Add materials first (recommended)' → opens Materials tray; 'Start from catalog only' → onStart). Use real <button>/<a> by role; h2 heading.
- **`app/capture/[code]/CaptureClient.tsx`** — Restructure the stage==='chat' branch JSX (lines 228-318). Render <CaptureHero> FIRST when messages.length===0 (passing chooser state, onStart wired to the chat panel's start path, materials, existingProfile, onViewProfile=()=>setStage('review'), onAddMaterials to open the Materials tray). Move <CaptureHelpPanel>, <CanvasImportSummary>, <MaterialsPanel>, and <SnapshotHistoryPanel> OUT of the always-rendered top-of-page stack into a 'secondary disclosure' region of three closed <details> rows BELOW the hero/chat. Pass Materials tray a defaultOpen = materials.length===0. The amber resume strip, generating spinner, and review-stage branch stay exactly as-is.
- **`app/capture/[code]/MaterialsPanel.tsx`** — Default the existing `collapsed` state (line 608) to TRUE (or accept a defaultCollapsed prop from CaptureClient so first-run can open it). Enrich the collapsed-header summary using the already-computed activeCount/ignoredCount/totalAuditTokens (lines 1073-1116): show 'N active · catalog ✓' and, when totalAuditTokens >= 150_000 (amber) / >= 220_000 (red), append a '⚠ large — review before starting' chip so the collapsed tray self-advertises when hiding materials is actually risky. No control removed; the audit-mode dropdown, token estimate, Sync-from-sheet, and all per-material affordances stay inside the expanded body unchanged. Add an optional prop to auto-scroll/focus the 'Choose file' upload control when entered via the first-run 'Add materials' path.
- **`app/capture/[code]/HelpPanel.tsx`** — No content change (it is already a <details>). It simply becomes the second collapsed row in the new disclosure region below the hero instead of an always-open block at the top of the stack. Optionally relabel summary to 'How this page works' for consistency with the other tray labels.
- **`app/capture/[code]/SnapshotHistoryPanel.tsx`** — Render as the third collapsed disclosure row ('Prior captures & snapshots (N)') instead of an always-expanded panel between materials and chat. Content unchanged.

**Risks.** 1) DOUBLE-OWNERSHIP of chooser state: lifting the chooser out of CaptureChatPanel risks chooserInstructor/chooserMode drifting between hero and chat. MITIGATION: extract a presentational SessionStartChooser; keep the state + handleStart owned by ONE component and pass controlled values — never copy state. The existing always-visible auditor badge (chat header) already proves this single-source pattern works mid-session.
2) COLLAPSING MATERIALS hides a token-whale or an auto-ignored syllabus a faculty member should review before starting. MITIGATION: the grafted '⚠ large — review before starting' chip in the collapsed tray summary (driven by the existing 150k/220k thresholds) self-advertises;

---

## Redesign ② — Quick-review mode (triage-and-collapse)  · effort: medium  · IMPLEMENTING FIRST

**Direction.** All three approaches are the same skeleton (client-side partition, reuse CompetencyCard, no schema change) — they differ in framing and how much extra surgery they bundle. I chose **Approach 1 (Triage-and-collapse)** as the base because it is the most surgical and lowest-risk: it touches only the competency `.map` block and the bottom CTA, leaves CourseOverview/ClassStructure/MajorProjects/StressTest in place, and reuses every existing component verbatim. Approach 2's "demote course front-matter behind a disclosure" and "sticky footer" are real layout changes faculty have already learned — that's a separate concern (abandon-point #1, the landing) and bundling it raises cost and review risk for the wrong finding. Approach 3 articulates the flag taxonomy and a11y rigor best. So: Approach 1's structure, grafted with Approach 3's dissociation reasons + foundational rigor, and Approach 2's empty-state and humanized-label copy.

**Mockup.**
```
┌─────────────────────────────────────────────────────────────────────────┐
│ DRAFT — pending your approval                                             │
│ The AI scored 24 technical + 5 foundational competencies from your        │
│ interview. Most look well-evidenced — we flagged the few worth a look.    │
│   ◐ 4 worth a look · ✓ 25 the AI is confident about  [ Accept all & approve → ]│
├─────────────────────────────────────────────────────────────────────────┤
│ (StressTest · Course overview · Class structure · Major projects — UNCHANGED)│
│ (Course Outcome Profile header · Back to chat · Save edits — UNCHANGED)   │
│                                                                           │
│ ┌─ WORTH A LOOK (4) ──────────────────────── why these? ▾ ─────────────┐ │
│ │ These rest on your word, sit high on the scale, or carry the most     │ │
│ │ graded weight. Adjust a slider, or confirm each.                      │ │
│ │ ┌─────────────────────────────────────────────────────────────────┐  │ │
│ │ │ [technical] [you said] [claim] ⚠ unverified                  #7 │  │ │
│ │ │ "Estimates realistic project timelines and scope"               │  │ │
│ │ │   Know ●──── 2     Understand ───●── 4     Do ──●── 3            │  │ │
│ │ │   Recognize       Reasons novel cases    Performs independently │  │ │
│ │ │ ── flagged: Do=4 rests on your word — no rubric cited yet ──    │  │ │
│ │ │   ▸ Evidence   ▸ Rationale            [ Looks right ✓ ]          │  │ │
│ │ └─────────────────────────────────────────────────────────────────┘  │ │
│ │  …#12 U=4/D=1 theory without craft · #3 inferred · #19 central 24% …  │ │
│ └───────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│ ┌─ AI IS CONFIDENT (25) — trusting these  [ Confirm all ✓ ] [ Open all ▾ ]┐│
│ │ Each cited to your materia
```

**Interaction model.** 1. **Land in DRAFT review** (via "Generate Course Outcome Profile" / "View it"). The page is unchanged above the competency list — StressTest, CourseOverview, ClassStructure, MajorProjects, the Course Outcome Profile header all render exactly as today. Only the flat competency `.map` (lines 1019-1026) is replaced.

2. **Triage runs purely client-side** via a new pure `triageCompetency(c, emphasis)` helper returning `{ flagged, reason }`, using only existing data: (a) the existing `isUnverifiedHighScore` expression (`deriveEvidenceBand({source,citations}) === 'claimed'` AND (`u_depth>=3` || `d_depth>=3`)) → reason "Do/Understand rests on your word — no rubric cited yet"; (b) a **dissociation case** (`u_depth>=3 && d_depth<=1` → "theory without craft"; `d_depth>=3 && u_depth<=1` → "craft without articulation") — grafted from Approach 3, the CLAUDE.md rule-3 cases worth a human eye; (c) `source==='inferred'` → "the AI inferred this — no direct source"; (d) membership as `centrality==='central'` in `working.course_emphasis` (matched by statement string) → "carries most of the graded weight." Everything else is confident. To keep the flagged set genuinely *few* (claimed-band is common; `artifact_verified` is unreachable today), cap the flagged zone at the top ~6 ranked by `d_depth` desc; the overflow falls into confident, still one click from full edit.

3. **WORTH A LOOK** renders the unchanged `CompetencyCard` (live sliders, Evidence/Rationale `<details>`, all badges) plus one visible `<p>` reason line above the slider grid and a **"Looks right ✓"** button. Editing any slider (already calls `updateCompetency`) or clicking "Looks right" adds the index to a `reviewed: Set<number>` — purely advisory styling, never gates anything.

4. **AI IS CONFIDENT** renders a new lightweight `CompetencyRow` (statement + **humanized source label** "found in materials" / "you said" / "AI inferred" — grafted from Approaches 2/3 to match the report's rename — + read-only "Know 3 Und 2 Do 3" + a `▸` disclosure). Clicking `▸` toggles the index into `expandedIndexes: Set<number>` and swaps the row for the identical full `CompetencyCard` in place. Foundationals keep their own subhead with

**Concrete changes.**
- **`app/capture/[code]/ProfileReviewPanel.tsx`** — Add a pure helper `triageCompetency(c: CaptureCompetency, emphasis: CaptureProfile['course_emphasis']): { flagged: boolean; reason: string | null }` near `isLegacyProfile` (line ~29). Lift the `isUnverifiedHighScore` expression out of CompetencyCard (lines 234-237) into a shared module-scope function so the card border and the triage share one source of truth. Reason precedence: unverified-high-score > dissociation (u>=3&&d<=1 / d>=3&&u<=1) > inferred-source > central-emphasis (statement matched against emphasis[].competency where centrality==='central'). No schema/API change.
- **`app/capture/[code]/ProfileReviewPanel.tsx`** — Add a `CompetencyRow` inline component: statement + humanized source label ('found in materials' / 'you said' / 'AI inferred') + read-only 'Know N Und N Do N' (label, not bare 'K3') + EvidenceBandChip + a real `<button aria-expanded aria-controls>` chevron. Map source->label so the report's rename ships here without touching SourceBadge.
- **`app/capture/[code]/ProfileReviewPanel.tsx`** — Replace the flat competency `.map` block (lines 1019-1026) with two zones computed from triage: WORTH A LOOK (flagged minus reviewed, capped ~6 by d_depth, each = existing CompetencyCard + reason `<p>` + 'Looks right ✓'; degrade to calm empty-state if none) and AI IS CONFIDENT (rest, as CompetencyRow; clicking expands the full CompetencyCard via `expandedIndexes`). Keep the Audit-notes aside (lines 1029-1056) exactly as-is in the right rail.
- **`app/capture/[code]/ProfileReviewPanel.tsx`** — Add `const [reviewed, setReviewed] = useState<Set<number>>(new Set())` and `const [expandedIndexes, setExpandedIndexes] = useState<Set<number>>(new Set())`. 'Looks right ✓' / 'Confirm all ✓' add to `reviewed`; have `updateCompetency` also add `i` to `reviewed`. 'Open all ▾' bulk-adds every confident index to `expandedIndexes`. None of this gates Save/Approve — advisory only.
- **`app/capture/[code]/ProfileReviewPanel.tsx`** — Update the DRAFT banner (lines 837-842) to the 'most look well-evidenced — we flagged the few worth a look' framing + counts, and add an 'Accept all & approve →' button calling the existing `openSnapshotPanel()`. Add the progress line ('N flagged · M still need a look · K trusted') to the bottom 'Done reviewing?' card (lines 1065-1085); leave its `openSnapshotPanel`/validation/disabled logic untouched.
- **`app/capture/[code]/ProfileReviewPanel.tsx`** — A11y (closes the report's critical finding in the same pass): in DepthSlider (lines 201-210) add `aria-label` reading 'Know depth for "<statement>", 3 of 5' (thread the competency statement in via a prop). Make EvidenceBandChip focusable (button variant) so keyboard users reach the band tooltip. When a confident row expands, move focus into the card. Map `validationError` to a human label ('Competency #4 — Know evidence is required') instead of the raw Zod path at lines 770-771.

**Grafted ideas.** From **Approach 3**: the dissociation-case reasons (U-high/D-low = "theory without craft", D-high/U-low = "craft without articulation") as triage signals — the CLAUDE.md rule-3 cases and the most defensible 'worth a look' beyond unverified-high-score; plus the discipline of keeping foundationals under their own subhead with K/U shown as '—' (rule #2), and lifting `isUnverifiedHighScore` into one shared function so the card border and triage can't diverge. From **Approach 2**: the humanized source labels ('found in materials' / 'you said' / 'AI inferred') matching the report's rename, the expli

**Risks.** (1) **Heuristic mis-sort** — a genuinely wrong score the AI happened to back with a materials citation lands in 'confident' and gets rubber-stamped. Mitigation: 'Open all ▾' restores the full grid, every row is one click from full edit, and the footer always shows the unreviewed count. It's a triage *hint*, never a guarantee — the 'why these? ▾' affordance says so plainly. (2) **Flag over-fire** — 'claimed'-band is common (artifact_verified unreachable today), so without AND-gating the flagged zone could swell back toward 29; the unverified-high-score AND central/dissociation gating plus the top-6 cap keep it to a handful. Tune the cap/threshold in pilot. (3) **course_emphasis statement matc

---

## Build order
1. **②  Quick-review** first — single file (`ProfileReviewPanel.tsx`), lowest blast radius, directly kills abandon-point #2. Pure `triageCompetency` helper is unit-tested; the rest reuses `CompetencyCard` verbatim.
2. **①  Landing** second — bigger surface (new `CaptureHero`, chooser extraction); do after the hero direction is eyeballed.
