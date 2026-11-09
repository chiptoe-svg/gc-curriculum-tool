# Course revision modes, label approach — design

Date: 2026-11-08. **Supersedes** [`2026-11-08-course-revision-modes-design.md`](./2026-11-08-course-revision-modes-design.md). The owner chose labels over a gate ("revise the design to the label approach"), after weighing the risk of partial changes against re-checking everything.

## Why

Faculty come back to an approved course (a course with a snapshot) for three reasons: a few things changed, they want the whole course looked at again, or they want to start over. The owner wants that choice made explicitly every time.

Every option makes one scorer call, so a partial re-score saves no money. What it would save is faculty review time, and it would protect program views from AI variation: ratings that move between runs with nothing behind them.

The superseded design used a gate. A rating could change only when the scorer cited new evidence; otherwise it was silently put back. A gate fails silently. If an instructor drops a project and the scorer lowers the ratings it supported without citing the change, the old ratings come back and nobody sees it.

This design keeps the evidence check but uses it as a **label** on each change, never a silent rule. Every rating that moves is shown. Changes without new evidence are marked as likely variation. In the "few things changed" mode they come pre-set to Undo, and one look confirms them.

How large the variation is has not been measured. If it turns out to be large, the label can later become a gate without reworking anything here.

## Goals

- When faculty open a course that has a non-retired snapshot, they must pick one of three modes. No mode is preselected.
- **A few specific things changed** (`targeted`): the interviewer focuses on the changes. A full re-score follows, anchored on the approved version. Every moved rating is listed and labeled. Changes without new evidence are pre-set to Undo; changes with new evidence wait for a decision.
- **Re-check the whole course** (`recheck`): today's "Build on prior capture" interview. A full re-score anchored on the approved version. Every moved rating is listed and labeled, and every change waits for a decision, because a fresh reading of old materials is a legitimate reason to move.
- **Start over** (`fresh`): a new profile from the current materials and the catalog, with no prior profile and no earlier interviews. Uploaded files are kept.
- The approved version stays live in program views until the new one is approved. This is already true, since drafts and snapshots are separate tables; keep it that way.

## Non-goals

- No change for a course without a snapshot: no chooser, and today's flow.
- No extra AI calls.
- No per-dimension evidence tracking. Citations live on the competency, so labels are per competency.
- No change to program views, the wiki or the program index.
- No lineage field on the new snapshot.

## Anti-goals

- A moved rating that the faculty member never sees.
- The approved snapshot being altered. Snapshots stay immutable.
- The mode being lost between the interview and Generate.

## Wording

Shown on the landing page only when the course has a non-retired snapshot. It replaces the "Start mode" fieldset in `app/capture/[code]/CaptureHero.tsx`. The owner approved options 2 and 3 as written. Option 1's description is adjusted to the label approach and is **pending the owner's OK**.

> **What's changed in this course since it was approved?**
>
> ◯ **A few specific things changed**
> Tell us what changed. Every rating is checked again; any rating that moves without new evidence is set back to the approved version for you. You'll see each change and approve it before it counts.
>
> ◯ **Re-check the whole course**
> The approved version is the starting point, but every rating is checked again against your current materials and this conversation. You'll see what moved before approving.
>
> ◯ **Start over**
> Build a new profile from your current materials and the catalog, as if for the first time. The approved version stays in place until you approve the new one.

Under the heading, a muted line names the approved version as "instructor · date" (today's `priorSnapshotInfo`). Start stays disabled until a mode is picked. When a saved session is resumed, its stored mode is shown as fixed text instead of the chooser.

## How each mode behaves

| | Interviewer | Scorer's prior profile | Review |
|---|---|---|---|
| `targeted` | Opens by asking what changed. Gets a short summary of the approved profile (statement and K/U/D per competency). Keeps questions on the changes and their knock-on effects. Prior-session briefing included. | Baseline snapshot's profile | Change list. No-new-evidence changes pre-set to Undo; new-evidence changes pending. |
| `recheck` | Today's "Build on prior capture", with the prior-session briefing | Baseline snapshot's profile | Change list. Every change pending; labels shown. |
| `fresh` | Today's "Fresh capture", with no prior-session briefing | `null`; the adopt overlay is not carried | Today's review, with no change list |
| no snapshot | Today's behavior | Today's behavior (the draft row) | Today's review |

**Baseline snapshot.** `getLatestSnapshotByCourse(courseCode)` at session start, the version the landing page names, whoever approved it. Its id is stored with the session and stays authoritative even if a newer snapshot is approved in between. If the stored baseline has been retired by the time Generate runs, Generate refuses with: "The approved version this revision started from was withdrawn. Start over to revise the current version."

**Change from today.** Today the scorer's prior profile is the draft row (`getCaptureProfileByCourse`). In `recheck` and `targeted` it is the baseline snapshot's profile instead, so the scorer never anchors on an unapproved draft left by an abandoned revision.

## Storing the mode

A new table, `capture_sessions`:

- `session_id`: uuid, primary key, the existing v2 session id
- `course_code`: references courses
- `revision_mode`: `'targeted' | 'recheck' | 'fresh'`
- `baseline_snapshot_id`: uuid, nullable, references `course_capture_snapshots`
- `created_at`

How it is written and read:

- The chat route body gains `revisionMode`.
- On a session's first turn, the row is written before the agent runs and before any message is persisted (`INSERT … ON CONFLICT (session_id) DO NOTHING`). A reload therefore never finds messages without a mode.
- The row is never updated. Changing the mode means a new session, through the existing Clear / Start over control.
- `includePriorSessions` is derived on the server from the row (`fresh` means false). The client flag is still accepted for sessions that have no row.
- Generate (scores route, mode 1) reads the row for `getLatestSessionId`'s session. A session with no row uses today's behavior, which covers every session created before this ships.

## Labels: what counts as new evidence

A citation on a scored competency is **new** when either of these is true:

- It is an `instructor` citation whose `messageId` (full UUID or 8-character prefix) belongs to a message in this session.
- It is a `chunk` citation whose material is new or changed since the baseline:
  - **New:** the material id is not in the baseline's frozen `inputsMeta.materials`. `diffInputsVsSnapshot(...).added` gives this list. A replaced syllabus is a new row, so it lands here.
  - **Changed:** the snapshot route starts freezing `textHash` (sha256 of `extractedText`) on each frozen material. Where the baseline material has one, "changed" means the live text's hash differs. A Canvas re-import that refreshes a row in place lands here. Older baselines have no `textHash` and fall back to the existing status and size comparison.
  - Resolve a chunk to its material with `VectorStore.fetchChunkById(tenantForCourse(courseCode), chunkId)`, once per distinct chunk id per Generate. If the lookup fails, the citation counts as not new.

Each change gets one of two labels:

- **New evidence:** the scored competency has at least one new citation. The review shows those citations.
- **No new evidence — likely AI variation:** it has none.

**Stale evidence.** Separately, any competency in the result whose citations point at a chunk from a material no longer in use is listed under "Evidence no longer in use — check these". A material counts as no longer in use when `isSentToAI` is false, the material is in the drift `removed` list, or the row or chunk is missing. This is a flag only; nothing changes automatically.

## The change list

The comparison is pure: `buildRevisionChanges(baseline, scored, newEvidence) → revision`. It runs on the server after `generateCaptureProfileV2` and after `preserveAdoptOverlay`, and before `upsertCaptureProfile`.

**Matching.** Pair competencies by normalized statement (trim, lowercase, collapse whitespace). In each matched pair, set the scored competency's statement to the baseline wording. Rewrite cross-references to the baseline wording in the same way: course emphasis `competency`, major-project `competencies`, and `reviewer_overrides` `statement`. Count and log unmatched competencies on either side, so prompt drift shows up.

**Change entries:**

- **`moved`:** a matched pair where any of K, U or D differs.
- **`added`:** a scored competency with no match.
- **`removed`:** a baseline competency with no match.

Each entry carries `before` (the full baseline competency, or null) and `after` (the full scored competency, or null). It also carries its label and its new citations.

**Initial decisions:**

- `targeted`, no new evidence: `undone`. The working profile already holds `before`; for an `added` change, the competency is left out.
- `targeted`, new evidence: `pending`.
- `recheck`: every change is `pending`.

The draft's competency array always reflects the current decisions. A `pending` change shows `after`, so the profile reads as the scorer produced it until faculty decide.

**Schema.** Add one optional, nullable field to `captureProfileSchema`. It is needed there because the reviewer-edit persist (mode 2) parses with that schema, and Zod drops unknown keys. The field is never sent to the model.

```
revision: {
  mode: 'targeted' | 'recheck',
  baseline_snapshot_id: string,
  changes: Array<{
    statement: string,
    kind: 'moved' | 'added' | 'removed',
    label: 'new_evidence' | 'no_new_evidence',
    dims: Array<{ dim: 'k'|'u'|'d', from: number|null, to: number|null }>,
    new_citations: Citation[],
    before: CaptureCompetency | null,
    after: CaptureCompetency | null,
    decision: 'pending' | 'kept' | 'undone',
  }>,
  stale_evidence: string[],              // competency statements
  changed_sections: string[],            // non-competency sections whose JSON differs from the baseline
} | null | optional
```

The snapshot route must strip `revision` before freezing. Today it freezes `draft.profile` as is.

**Non-competency sections** (summary, incoming expectations, major projects, productive-failure conditions, course emphasis, revised objectives) take the scorer's values in both modes. Each section whose JSON differs from the baseline's, after the statement rewrite, is listed in `changed_sections`. In the review it gets a "Changed since the approved version" tag and a **Restore approved version** button. These sections never block approval.

## Review panel

A new component, `RevisionChanges`, at the top of `ProfileReviewPanel`:

- **Sections**, in this order:
  1. "Changes with new evidence"
  2. "Changes without new evidence — likely AI variation"
  3. "Evidence no longer in use — check these"
- **Each change row** shows the statement, the dimensions as "from → to", the label, and the new citations. A citation to an interview answer shows the answer's text; a citation to a file shows the file name.
- **Buttons:** each row has **Keep change** and **Undo**.
  - **Undo** puts `before` back in full: K/U/D, rationale, evidence and citations. For an `added` change it removes the competency; for a `removed` change it restores it. A hand edit to that competency is replaced, and the tooltip says so.
  - **Keep change** puts `after` back.
- **Saving:** decisions save through the existing reviewer-edit persist (mode 2).
- **Group buttons:** the no-new-evidence group has one button, **Keep all as set back** in `targeted` (it marks them confirmed) or **Undo all** in `recheck`.
- **Approval:** approve is disabled while any change is `pending`, with "Decide on each change above first." In `targeted`, the pre-set `undone` entries count as decided.

## What's left to the builder

- The interviewer's `targeted` opening text and prompt wording, within the requirements in the table above.
- Layout and styling, following the existing review panel.
- Where the short approved-profile summary sits in the interviewer context.

## Calls made (owner to check)

1. The baseline is the latest snapshot for the course, whoever approved it.
2. In `recheck`, every change waits for a decision. Only `targeted` pre-sets no-evidence changes to Undo, because there the faculty member has said only a few things changed.
3. `recheck` and `targeted` anchor on the approved snapshot, not on the draft row. This is a small change from today's "Build on prior capture".
4. Labels are per competency, because citations are stored per competency.
5. The mode is fixed for a session.
6. Start over drops the Explore adopt overlay (intended targets).
7. New snapshots record a text fingerprint per file. Older ones fall back to comparing size and read status.
8. A retired baseline blocks Generate with a clear message.
9. Non-competency sections take the new values, with a changed tag and a restore button; they never block approval.
