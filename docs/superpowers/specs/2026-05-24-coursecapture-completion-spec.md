# CourseCapture v1 Completion — Snapshots, Incoming Expectations, Verification Summary

**One-line:** Adds the three remaining mechanisms that close out CourseCapture v1: an immutable versioned snapshot record, a structured `incoming_expectations` field on each profile (the upstream half of the framework, prerequisite for the Explore "downstream-courses" mode), and a verification-shaped summary that helps instructors decide when the snapshot fairly captures the course.

---

## Background & motivation

The capture-side mechanisms shipped so far produce a working Course Outcome Profile per course, autosaved between sessions, with depth-scored competencies, audit notes, evidence excerpts, and an optional revised-objectives draft. What's missing for the system to act as a real curriculum-mapping foundation:

1. **No immutable history.** The working profile is mutable; re-running CourseCapture overwrites it. There is no point-in-time record that future Explore sessions or accreditation review can rely on as a stable input. The framework calls these "snapshots" but they do not yet exist as artifacts.

2. **No structured upstream signal.** The audit conversation already probes "what do students need to arrive with" and surfaces `prereq_gaps` as freeform prose. The downstream-comparison flow planned for Explore needs that information as structured data — specifically, per-competency K/U/D expectations the course assumes incoming students bring. Without it, "does GC 3460 produce what GC 4060 expects?" cannot be answered numerically.

3. **No verification aid.** The capture review panel currently shows the full profile (5–15 competencies × K/U/D × evidence × rationale, plus audit notes). Alpha feedback from a real session — *"the output is a lot ... having a way to give a simple 'what was amazing' and 'what's next' list would help"* — confirmed the obvious: the instructor needs a takeaway-shaped summary to decide whether the profile accurately captures the course. The summary is verification-shaped, not TL;DR — it answers "did the system get this right?" rather than serving as a substitute for the detail.

This spec covers the three additions that close out CourseCapture v1. The framework reaches a coherent stopping point once these ship: a captured snapshot is permanent, the structured data downstream tools need is present in every snapshot, and the instructor has a deliberate moment of decision before snapshotting rather than an undirected "is this profile done?" question.

Companion to the [2026-05-23 KUD Depth Scales spec](./2026-05-23-kud-depth-scales-design.md) and the [2026-05-23 CourseCapture Prototype plan](../plans/2026-05-23-coursecapture-prototype.md), both of which describe the substrate this spec builds on.

## Goals

1. **Immutable versioned snapshots** of confirmed Course Outcome Profiles, dated and optionally captioned, with the input context that produced them frozen alongside the profile JSON.
2. **Structured `incoming_expectations`** on every newly captured profile, derived from the same audit conversation that produces the competencies, scored to the same K/U/D depth scale.
3. **Verification-shaped summary** rendered above the competency cards on the review panel, helping the instructor decide whether to confirm and snapshot.
4. **Confirm-and-snapshot workflow** that replaces the current "Confirm" button with an explicit closing-of-capture action, including an optional caption.
5. **Snapshot history surface** on the capture page so past snapshots are visible, viewable, and reusable as starting points for new drafts.

## Non-goals

- **Not** a cross-snapshot diff view. Two-snapshot comparison is left to Phase 2.
- **Not** a longitudinal-tracking dashboard. The snapshots accumulate; a dedicated view that visualizes them over time can come later when there are snapshots worth visualizing.
- **Not** a snapshot search or organization-level browser. v1 lists snapshots per course only.
- **Not** Canvas Pages, Drive files, Google Sheets, or video transcripts — explicitly deferred to Phase 2 (see the Phase 2 enumeration below).
- **Not** a career-target alignment surface. The companion Explore module will consume snapshots for that work; this spec only ensures the snapshot exists to be consumed.

---

## Data model

### `course_capture_snapshots` (new table)

Immutable history. One row per confirmed snapshot; many per course over time.

```sql
CREATE TABLE course_capture_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_code     text NOT NULL REFERENCES courses(code) ON DELETE CASCADE,
  profile         jsonb NOT NULL,           -- CaptureProfile JSON (frozen)
  inputs_meta     jsonb NOT NULL,           -- see shape below
  transcript      jsonb NOT NULL DEFAULT '[]', -- the audit conversation that produced this
  caption         text,                     -- instructor-provided, optional
  caption_note    text,                     -- "what changed since last snapshot?", optional
  scale_version   text NOT NULL,            -- copied from profile.scale_version
  model           text NOT NULL,            -- e.g., 'gpt-5.4' — frozen at snapshot time
  retired_at      timestamptz,              -- soft-delete; never hard-delete a snapshot
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_snapshots_course ON course_capture_snapshots (course_code, created_at DESC);
CREATE INDEX idx_snapshots_active ON course_capture_snapshots (course_code) WHERE retired_at IS NULL;
```

`inputs_meta` shape:

```jsonc
{
  catalog: {
    description: '...',
    prerequisites: '...',
    learning_objectives: [...],
    major_projects: [...],
    skills_required: [...]
  },
  builder_profile_present: true,
  materials: [
    {
      file_name: 'Canvas: Assignments',
      extraction_status: 'ok',
      size_bytes: 16893,
      ignored: false
      // NOT the full extracted text — that lives in course_materials and
      // can be hydrated back via material_id if needed.
    }
  ],
  prereq_snapshots_used: [
    { course_code: 'GC 1040', snapshot_id: '...', caption: 'Initial capture' }
  ],
  scan_passes: {
    canvas_imported_at: '...' | null,
    google_docs_scanned_at: '...' | null
  }
}
```

`transcript` stores the message array verbatim. Storage cost is trivial; traceability value is high.

`retired_at` is set when an instructor wants to hide a snapshot from the default list without erasing the record. Hard deletion is never offered through the UI.

### Extensions to `CaptureProfile` (no new table; schema update only)

Two new fields on the JSON shape:

```jsonc
{
  // ... existing fields (course_code, scale_version, generated_at,
  //                     competencies, audit_notes, revised_objectives_draft) ...

  incoming_expectations: [
    {
      statement: 'Students arrive able to interpret CMYK color reproduction',
      expected_depth: {
        k: 4,            // 0-5, nullable for dispositions
        u: 3,
        d: 2
      },
      evidenced_by: [
        'Lab: Color Profiles in Photoshop (28 pts) — uses CMYK terminology with no introductory teaching',
        'Brand Color Report (150 pts) — assumes RGB↔CMYK conversion fluency'
      ],
      confidence: 'high' | 'medium' | 'low'
    },
    // ... 0–10 items typical, one per skill the assignments truly assume
  ],

  verification_summary: {
    course_shape: '...',           // 1-2 sentences, where the K/U/D scores cluster
    strongest_evidence: [           // 3-5 bullets, format: '{Competency} — D{N} via {Assignment}'
      'Students produce production-ready package artwork — D5 via Brand Color Report'
    ],
    dimensional_patterns: [         // 0-4 bullets, dissociation cases (K-high/U-low etc.)
      'Print-prep terminology is K4 but U2 — students command the vocabulary without articulating why each step exists'
    ],
    catalog_vs_evidence: [          // 0-4 bullets, most concrete items from audit_notes
      "Objective 1 ('manufacturing processes') has no graded artifact behind it"
    ],
    foundationals_glance: '...'    // 1 sentence, which foundationals are D=0 vs D=4+
  }
}
```

Both fields are required in v1 (no nullable). Empty arrays are valid when the audit honestly produced nothing for a section.

### Why store snapshot profile as JSON rather than relational rows

Same reasoning as the existing `course_capture_profiles.profile`: the depth-scale and competency-shape can evolve without per-field migrations. Existing snapshots stay readable because their `scale_version` tells the consumer how to interpret the JSON.

---

## Snapshot lifecycle

```
Draft (course_capture_profiles)        →     Snapshot (course_capture_snapshots)
─────────────────────────────────────────────────────────────────────────────────
mutable                                       immutable
one per (course_code, scale_version)          many per course
instructor's working copy                     historical record
can be edited freely                          read-only
gets reset/replaced on new capture run        accumulates over time
```

Three operations move data between them:

1. **Confirm and snapshot.** Copy the current draft into a new snapshot row. Caption + caption_note optional. Triggered by the explicit "Confirm and snapshot" button (replacing the existing "Confirm" button on the review panel).

2. **Use snapshot as draft starting point.** Copy a chosen snapshot's `profile` back into the working draft (`course_capture_profiles`). The transcript stays in the snapshot — it is *not* re-loaded into the active chat. Used when the instructor wants to iterate from a known prior state rather than start over.

3. **Discard draft.** Replace the working draft with an empty placeholder (no profile yet; capture would need to be re-run to produce one). Snapshots are untouched.

Re-running the audit conversation always operates on the draft. Confirm-and-snapshot is the only way to produce a permanent record.

---

## UI changes

### Capture page: snapshot history panel

A new collapsible section on `/capture/[code]`, between the materials panel and the chat/review panel. Lists existing snapshots in reverse chronological order:

```
SNAPSHOTS (3)                                              [+ View all]
  ◆ May 24 2026   "Spring 2026 baseline"  [view] [use as draft]
  ◆ Dec 18 2025   "Fall 2025 post-revision"  [view] [use as draft]
  ◆ Aug 14 2025   "Initial capture"  [view] [use as draft]
```

Each row:
- Date + caption (defaults to `Snapshot — {date}` when blank)
- "view" — opens read-only modal/panel with the snapshot's full profile + verification summary + audit notes
- "use as draft" — copies that snapshot's profile back into the working draft (with confirmation if the current draft has unsaved changes)

Snapshots with `retired_at IS NOT NULL` are hidden by default. A "+ View all" link reveals retired entries with a strikethrough.

### Review panel: verification summary section

A new section at the top of the review panel, above the competency cards, rendering the `verification_summary` block:

```
┌─ DOES THIS CAPTURE YOUR COURSE? ────────────────────────────────────┐
│                                                                      │
│  Course shape                                                        │
│  This course is strongly hands-on and measurement-heavy; the         │
│  deepest development happens in the Brand Color Report and the       │
│  Spectrophotometer SOP, both anchoring D4–5 evidence.                │
│                                                                      │
│  What the course is developing                                       │
│  • Production-ready file prep — D4 via Brand Color Report           │
│  • Spectrophotometer measurement workflow — D4 via SOP              │
│  • Ink formulation to numeric tolerance — D5 via Ink Formulation Lab │
│                                                                      │
│  Where the system saw mixed signals                                  │
│  • Print-prep terminology is K4 / U2 — vocabulary fluent without     │
│    articulated rationale                                              │
│                                                                      │
│  Where catalog and evidence disagree                                 │
│  • Objective 1 ('manufacturing processes') has no graded artifact    │
│  • Catalog claims thorough CMYK prereq; Unit 1 retiches it           │
│                                                                      │
│  Foundationals                                                       │
│  Attention to Detail and Communication score D4; Resilience and      │
│  Curiosity score D0–1.                                                │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

The full competency cards and audit notes sidebar continue to render below.

### Review panel: confirm-and-snapshot button

The existing "Confirm" button is replaced with "Confirm and snapshot." On click, a small inline panel opens:

```
  Caption (optional)        [_______________________________]
  What changed since the    [_______________________________]
  last snapshot? (optional) [_______________________________]
                                                      [Snapshot]
```

"Snapshot" writes a new row to `course_capture_snapshots` with the current draft frozen. The reviewer_status on the working draft becomes `confirmed`; subsequent edits would move it back to `edited` and would require another snapshot to make those edits permanent.

### Hidden retirement

A small "..." menu on each snapshot row offers "Retire this snapshot" (set `retired_at`) and "Restore" (clear `retired_at`). No hard-delete option.

---

## Prompt changes

The capture-chat prompt is unchanged. All changes land in `capture-scores.md` and the corresponding Zod/JSON schema.

### `capture-scores.md` — three new sections

Append to the existing structured-output instructions:

```markdown
# Incoming expectations

After scoring the competencies the course develops, identify what the
course assumes students arrive ABLE TO DO — the incoming skills its
assignments demand without teaching. For each, produce a structured
incoming-expectation entry.

The depth values express what depth the course assumes incoming
students bring. A course that requires students to interpret CMYK
separations on day-one assumes Know-4 / Understand-3 / Do-2 even
though the course does not develop those depths itself.

Constraints:
- 0–10 entries. Most courses produce 3–6 if they have honest prereqs.
- Each entry must cite at least one specific assignment that demands
  the skill ('evidenced_by'). Without an assignment that depends on
  the skill, do not include it as an expectation.
- Use the same K/U/D depth anchors as the competencies (see depth-scale
  partial).
- 'confidence' reflects how clearly the assignments evidence the
  assumption. High = explicit dependence in graded work. Medium = strong
  inference. Low = soft signal in instructor language only.

Do NOT include in incoming_expectations:
- Skills the course itself teaches (those are competencies, not
  expectations).
- Skills the catalog lists as prereqs but no assignment requires.
- Skills the instructor mentioned aspirationally but the assignments
  don't demand.

# Verification summary

After producing competencies, audit_notes, and incoming_expectations,
produce a verification_summary block. This summary is NOT a TL;DR — it
is a fidelity check that helps the instructor decide whether the
captured profile accurately describes the course. The instructor reads
each section and asks "yes, that's my course" or "no, the system missed
something — keep going."

Hard length cap: 300 words across the whole block.

Sections:

course_shape — 1–2 sentences. What kind of work the course develops,
based on where the K/U/D scores cluster. Name the one or two
assignments that anchor the deepest development.

strongest_evidence — 3–5 single-line bullets. Competencies that reached
D=4 or D=5. Format: '{Competency statement, ≤15 words} — D{N} via
{Assignment name}'.

dimensional_patterns — 0–4 single-line bullets. Where K/U/D diverge
meaningfully for a competency (K-high/U-low = vocabulary without
rationale; D-high/U-low = craft without articulation; etc.). Cite the
specific competency. Omit the array if no patterns stand out.

catalog_vs_evidence — 0–4 single-line bullets. The most concrete items
from audit_notes (prereq_gaps, objective_misalignments,
cross_source_conflicts). Name the specific objective number, prereq
skill, or source pair. Omit if audit_notes is essentially empty.

foundationals_glance — 1 sentence. Which of Agency, Attention to
Detail, Resilience, Curiosity, Communication scored D=0 (course does
not develop) and which scored D=4 or D=5 (strongly developed). Skip
the middle.

Do NOT include recommendations, proposed changes, or speculation in any
section. Strict description only.
```

### Zod schema additions (`lib/ai/capture/schema.ts`)

```ts
export const incomingExpectationSchema = z.object({
  statement: z.string().min(1),
  expected_depth: z.object({
    k: z.number().int().min(0).max(5).nullable(),
    u: z.number().int().min(0).max(5).nullable(),
    d: z.number().int().min(0).max(5),
  }),
  evidenced_by: z.array(z.string()).min(1),
  confidence: z.enum(['high', 'medium', 'low']),
});

export const verificationSummarySchema = z.object({
  course_shape: z.string().min(1),
  strongest_evidence: z.array(z.string()).min(3).max(5),
  dimensional_patterns: z.array(z.string()).max(4),
  catalog_vs_evidence: z.array(z.string()).max(4),
  foundationals_glance: z.string().min(1),
});

// captureProfileSchema gains:
//   incoming_expectations: z.array(incomingExpectationSchema).max(10),
//   verification_summary: verificationSummarySchema,
```

JSON Schema mirror updated to match (strict mode in OpenAI structured-output).

---

## API additions

Three new endpoints under `/api/capture/[code]/snapshots`:

```
POST   /api/capture/[code]/snapshots?slug=...
       Body: { caption?: string, caption_note?: string }
       Copies the current draft into a new immutable snapshot row.
       Returns: { snapshot_id, created_at, caption }

GET    /api/capture/[code]/snapshots?slug=...
       Returns: { snapshots: Array<{ id, caption, caption_note,
                                      created_at, retired_at, summary,
                                      scale_version, model }> }
       (summary is the verification_summary excerpt for the list view;
        the full profile is fetched separately.)

GET    /api/capture/[code]/snapshots/[id]?slug=...
       Returns the full snapshot row (profile, inputs_meta, transcript).

PATCH  /api/capture/[code]/snapshots/[id]?slug=...
       Body: { retired_at: '...' | null }
       Soft-retire or restore a snapshot.

POST   /api/capture/[code]/snapshots/[id]/use-as-draft?slug=...
       Replaces the working course_capture_profiles row with the
       snapshot's profile (transcript is NOT loaded into chat).
       Returns: { ok: true }
```

The existing `POST /api/capture/[code]/scores` continues to write the working draft. The new POST .../snapshots is what makes the draft permanent.

---

## Tasks (numbered for plan-doc reference)

### Schema & queries
1. Add `course_capture_snapshots` table to `lib/db/schema.ts` with the columns above. Generate migration via `pnpm db:generate`; apply via `pnpm db:migrate`.
2. Extend `CaptureProfile`, `captureProfileSchema`, and `captureProfileJsonSchema` with `incoming_expectations` and `verification_summary`. Both required.
3. Write `lib/db/capture-snapshots-queries.ts` with `createSnapshot`, `listSnapshotsByCourse`, `getSnapshotById`, `setSnapshotRetired`, and `loadSnapshotAsDraft` (the last one upserts into `course_capture_profiles`).

### Prompt & scoring
4. Add the two new sections to `lib/ai/prompts/capture-scores.md` as drafted above. The capture-chat prompt is unchanged.
5. Update `lib/ai/analyze/capture-scores.ts` JSON Schema mirror to include the new fields with `additionalProperties: false`. The Zod refinement chain validates per-item.
6. Smoke-test against an existing course (GC 3460 or GC 3400) to confirm the model populates both new sections coherently. Iterate on the prompt if `incoming_expectations` collapses into the same content as competencies.

### API
7. Implement the five new endpoints under `/api/capture/[code]/snapshots/...` per the shape above. Slug-gated, IP-rate-limited.
8. The existing `/api/capture/[code]/scores` POST stays as the draft-write endpoint. No behavioral change beyond now emitting the two new profile fields.

### UI
9. Build `SnapshotHistoryPanel` component on `/capture/[code]`. Renders between MaterialsPanel and CaptureChatPanel/ProfileReviewPanel.
10. Build `VerificationSummary` component. Renders at the top of `ProfileReviewPanel` when the profile contains a `verification_summary` block.
11. Replace the existing "Confirm" button in `ProfileReviewPanel` with "Confirm and snapshot." Inline caption + caption_note fields. On click, POSTs to the snapshots endpoint.
12. Build a "use as draft" confirmation modal — prompts when the current draft has unsaved edits.
13. Build a read-only snapshot viewer modal — opens when the user clicks "view" on a snapshot row.

### Smoke test
14. Capture two snapshots on GC 3460 in sequence (one immediately, one after a small materials change) to confirm the history list, the use-as-draft flow, and the captioned record are working as designed.
15. Write up findings against the open questions from the depth-scales spec (whether K=5 ever appears, foundational D=0 frequency, etc.) and against the new verification-summary quality bar (does it actually feel like a fidelity check, or does it read like a TL;DR?).

---

## Acceptance criteria

- A confirmed CourseCapture session produces a new row in `course_capture_snapshots` with the full profile, inputs_meta, transcript, and optional caption/caption_note frozen at that moment.
- Past snapshots are visible on the capture page as a dated, captioned list with view and use-as-draft actions.
- The review panel renders a Verification Summary at the top of the page, structured per the section labels above, with the instructor able to read each section and decide whether the system has captured the course faithfully.
- Every newly captured profile carries a structured `incoming_expectations` array describing what the course assumes incoming students bring, scored on the same K/U/D depth scale, citing the assignments that demand each skill.
- Retiring a snapshot soft-deletes (sets `retired_at`); restoring clears it; hard deletion is not exposed in the UI.
- The existing prereq-snapshot-loading mechanism (`prerequisiteCaptureProfiles` in the chat context) is updated to read from the latest *snapshot* for each prereq course, not the working draft — so audit conversations always reason about confirmed upstream state.

---

## What ships with this spec, what is explicitly Phase 2

### Ships with this spec (closes out CourseCapture v1)

- Snapshot table + history UI + use-as-draft flow
- `incoming_expectations` structured field on every profile
- `verification_summary` block on every profile
- Confirm-and-snapshot replacing the bare Confirm button
- Soft-retire / restore on snapshots
- Prereq context loader uses the latest non-retired snapshot, not the working draft

### Already shipped (recap)

For completeness, the existing CourseCapture v1 surface as of this spec:

- Self-standing page at `/capture/[code]?slug=…`
- Materials & catalog panel: read-only catalog summary, materials list with Canvas / Google Doc / Google Slides / uploaded badges, per-material ignore/preview/delete, upload zone, Sync-from-sheet, Import-from-Canvas, Scan-Google-Docs-&-Slides
- Audit chat: one focused question per turn, paragraph-separated opening, finding-then-question coherence rule, structured readiness signal on every turn (score + covered + remaining)
- Voice input via OpenAI Whisper
- Conversation persistence (autosave + resume across sessions, devices, and tab closes)
- Generate Course Outcome Profile via structured output (Zod refinements enforcing K/U null for foundationals; above-zero scores require evidence excerpts)
- Review panel with K/U/D sliders, evidence excerpts, audit notes sidebar, revised-objectives draft
- Canvas import with rubrics inline, ExternalUrl URLs preserved, anchor href URLs preserved through HTML-to-text
- Google Docs and Google Slides scan-and-fetch via public export endpoints
- Prereq-course capture profiles loaded into the audit context when available

### Phase 2 — out of scope for this spec, captured here so the deferral is explicit

- **Cross-snapshot diff view** — pick two snapshots, see what changed in depths, audit notes, recommendations addressed.
- **Snapshot longitudinal dashboard** — visualize how a course's depths have moved across snapshots.
- **Canvas Pages extraction** — the wiki-style pages where many courses house substantive lecture content; currently not fetched at all. Probably the single highest-leverage Phase 2 add.
- **Drive file content** — PDFs / images / videos uploaded to Google Drive. Different fetch flow than Docs/Slides.
- **Google Sheets export** — `/export?format=csv`; same pattern as Docs/Slides but with structured data.
- **Video transcripts** — YouTube, Vimeo, Panopto, Canvas Studio. Each platform is its own integration.
- **Bulk re-capture** — re-run audit on multiple courses in one operation. Not needed at single-faculty scale.
- **Conversation transcript export** — currently the transcript persists in the snapshot but the UI doesn't offer a download.
- **Reset capture** — clear all materials + draft + snapshots for a course (destructive; not exposed in UI to prevent accidental loss).
- **Cross-organization sharing of snapshots** — would require an authentication model beyond the single shared slug.

---

## Open questions

1. **Snapshot at audit time vs. at confirmation time?** Today the audit runs against the working draft, but the new prereq loader is supposed to use snapshots. Do we use the latest snapshot's profile only, or do we fall back to the draft if no snapshot exists yet? Lean: latest non-retired snapshot only, with explicit messaging in the chat context when a prereq has no snapshot ("GC 1040 has been captured to draft but not snapshotted yet — using draft state").

2. **What lands in `inputs_meta.materials`?** Just the IDs + file_name + status (enough to find the materials again if needed), or also the extracted text (full snapshot but heavy)? Lean: just IDs + metadata; the materials table is the persistent store for text.

3. **Use-as-draft confirmation when current draft has unsaved changes** — block, warn-and-allow, or auto-snapshot current draft first? Lean: warn-and-allow with explicit "discard current draft and load snapshot" confirmation.

4. **`caption_note` placement** — own field on the snapshot, or appended to caption? Lean: own field. Caption is the title; caption_note is the prose answer to "what changed?"

5. **Verification summary as part of the same Generate call, or a separate "summarize" call?** Lean: same call. Same context, same audit transcript, no risk of summary drifting from the scores it describes.

6. **`incoming_expectations` confidence** — does low confidence on an expectation downgrade its weight in downstream comparison, or just inform the reviewer? Lean: just inform for v1; Explore can decide whether to filter on confidence when it consumes the data.
