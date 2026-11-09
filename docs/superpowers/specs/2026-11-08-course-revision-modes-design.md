# Course revision modes — design

Date: 2026-11-08. Owner decisions in conversation 2026-11-06 to 2026-11-08 ("Go with your recommendations").

## Why

Faculty come back to a course that already has an approved profile (a snapshot) for three different reasons. They changed a few specific things, they want the whole course looked at again, or they want to start over. Today the landing page offers two options: "Build on prior capture" and "Fresh capture". Neither handles the first reason well.

On every re-score, the scorer re-rates the whole course. The AI wobbles from run to run, so ratings can move even when nothing about them changed. A faculty member who changed one project then has to re-check every rating, and program views pick up noise.

The owner wants the choice made explicitly every time an approved course is reopened, with three options.

## Goals

- Faculty must pick one of three revision modes when they open a course that has an approved snapshot. There is no preselected default.
- **A few specific things changed** (`targeted`): only ratings backed by new evidence change. Every other rating stays as approved. Faculty approve or undo each change.
- **Re-check the whole course** (`recheck`): a full re-score that starts from the approved version. Faculty see what moved compared with the approved version before approving.
- **Start over** (`fresh`): a new profile built from the current materials and the catalog. It does not anchor on the approved version or on earlier interviews. Uploaded files are kept.
- In all three modes, the approved version stays live in program views until the new one is approved. This is already true, because drafts and snapshots are stored separately; the design must not break it.

## Non-goals

- No change to how a course with no approved snapshot works. The mode choice does not appear for it, and the flow is today's flow.
- No extra AI calls. Each mode uses the same single scorer call as today.
- No per-dimension evidence tracking. Citations live on the competency, not on K, U or D separately, so the "new evidence" check works per competency.
- No change to program views, the wiki or the program index.

## Anti-goals (failure even if it "works")

- A rating in `targeted` mode changes with no new evidence behind it.
- A rating silently disappears in `targeted` mode because the scorer dropped or reworded it.
- The approved snapshot is altered. Snapshots stay immutable; a revision always ends in a new snapshot.
- The mode is lost between the interview and Generate. Generate runs in a later request, so the mode must be stored.

## Wording (owner-approved)

Landing page, shown only when the course has a non-retired snapshot. It replaces the "Start mode" fieldset in `app/capture/[code]/CaptureHero.tsx`.

> **What's changed in this course since it was approved?**
>
> ◯ **A few specific things changed**
> Tell us what changed. Only the ratings those changes affect are updated; everything else stays as approved. You'll see each change and approve it before it counts.
>
> ◯ **Re-check the whole course**
> The approved version is the starting point, but every rating is checked again against your current materials and this conversation. You'll see what moved before approving.
>
> ◯ **Start over**
> Build a new profile from your current materials and the catalog, as if for the first time. The approved version stays in place until you approve the new one.

Under the heading, a muted line names the approved version: instructor · date (today's `priorSnapshotInfo`). Starting the interview stays disabled until a mode is picked.

## How each mode behaves

| | Interviewer | Scorer's prior profile | After scoring |
|---|---|---|---|
| `targeted` | Opens by asking what changed. Sees the approved profile's competencies and depths, and focuses on the changes. Prior-session briefing included. | The baseline snapshot's profile, plus an instruction to keep competency statements word for word | Merge rule (below), then a change list to approve or undo |
| `recheck` | Today's "Build on prior capture" behavior, with prior-session briefing | The baseline snapshot's profile | A change list against the baseline, to approve or undo |
| `fresh` | Today's "Fresh capture" behavior, with no prior-session briefing | `null` | Today's review, with no change list |
| (no snapshot) | Today's behavior | Today's behavior (the draft) | Today's review |

**Baseline snapshot:** the snapshot the landing page names, which is `getLatestSnapshotByCourse(courseCode)` (the latest non-retired one). Its id is stored when the session starts. That stored id stays authoritative, even if a newer snapshot is approved in between. If the stored baseline has been retired by the time Generate runs, Generate refuses with "The approved version this revision started from was withdrawn. Start over to revise the current version."

**Lineage:** not recorded on the new snapshot in this build. `sourceSnapshotId` keeps its current meaning (the fork baseline for the materials-drift banner) and stays null after a re-score, as today.

**Behavior change in `recheck`:** today the scorer's prior profile is the draft row (`getCaptureProfileByCourse`), not the snapshot. In `recheck` and `targeted` it becomes the baseline snapshot's profile. This avoids anchoring on an unapproved draft left over from an abandoned revision.

## Storing the mode

Add a new table, `capture_sessions`, with these columns:

- `session_id` (uuid, primary key; the existing v2 session id)
- `course_code` (references courses)
- `revision_mode` (`'targeted' | 'recheck' | 'fresh'`)
- `baseline_snapshot_id` (uuid, nullable, references `course_capture_snapshots`)
- `created_at`

The chat route body gains `revisionMode`. Write the row on the first chat turn of a session, before the agent runs and before any message is persisted (`INSERT … ON CONFLICT (session_id) DO NOTHING`), so a reload can never find messages without a mode. The row is never updated: changing the mode means starting a new session, using the existing Start over / Clear control. When a saved session is resumed, page.tsx reads the row and the landing page shows the stored mode as fixed text, not the chooser.

Generate (`POST /api/capture/[code]/scores`, mode 1) already finds the session with `getLatestSessionId`; it then reads that session's row. A session with no row is treated as the no-snapshot path, which is today's behavior. That covers every session created before this ships.

`includePriorSessions` is derived on the server from the stored mode (`fresh` means false). The client flag stays accepted for sessions that have no row.

## The `targeted` merge rule

This runs on the server after `generateCaptureProfileV2` returns and before `upsertCaptureProfile`. It is a pure function: `mergeTargetedRevision(baseline, scored, newEvidence) → { profile, changes }`.

**Matching competencies.** Pair each competency in `scored` with one in `baseline` by normalized statement: trim, lowercase, collapse whitespace.

**New evidence.** A citation on a scored competency counts as new when either of these holds:

- It is an `instructor` citation whose `messageId` (full UUID or 8-character prefix) belongs to a message in this session.
- It is a `chunk` citation whose chunk's material is new or changed since the baseline:
  - a material id the baseline did not freeze (`diffInputsVsSnapshot(...).added`);
  - or one whose text changed. The snapshot route starts freezing `textHash` (sha256 of `extractedText`) on each material in `inputsMeta.materials`. Where the baseline has a `textHash`, "changed" means the hash differs from the live text's hash. For older baselines without one, fall back to today's `extractionStatus·sizeBytes` comparison. A replaced syllabus is a new row, so it shows up as `added`; a Canvas re-import that refreshes a row in place is caught by the hash.

  Resolve a chunk to its material with `VectorStore.fetchChunkById(tenantForCourse(courseCode), chunkId)`. Look up each distinct chunk id once per Generate. If a lookup fails, the citation counts as not new.

For each pair, compare `k_depth`, `u_depth` and `d_depth` with the baseline:

- **All three are equal.** Keep the baseline competency unchanged: its rationale, evidence and citations. No change entry.
- **Any differs, and the scored competency has at least one new citation.** Take the scored competency and record a change entry for each moved dimension, with its new citations.
- **Any differs, with no new citation.** Keep the baseline competency. Record no change entry; this is AI wobble being discarded. Count these and log them.

Other cases:

- **A scored competency with no baseline match.** Include it only if it has a new citation, as a change entry of kind `added`. Otherwise drop it and log it.
- **A baseline competency with no scored match.** Keep it unchanged. Faculty can still remove it in review, as they can today.
- **Stale evidence.** After the merge, check each kept baseline competency for chunk citations whose material is not in use any more: `isSentToAI` false, the material is in the drift `removed` list, the row is missing, or the chunk can't be found. Mark the competency with a `stale_evidence` flag. It is shown for re-checking and is not reverted.
- **Reworded statements.** The prompt asks the scorer to keep statements word for word, but it may not. A reworded competency fails to match: its baseline twin is kept unchanged, and the reworded one is treated as unmatched (`added` only with new evidence). Count and log every unmatched scored competency, so drift in the prompt shows up.

**Non-competency sections** (summary, incoming expectations, major projects, productive-failure conditions, course emphasis, revised objectives) **keep the baseline's values** in `targeted` mode. Where the scorer's version of a section differs from the baseline (deep equality of the section's JSON), it is stored as a proposal (`revision.section_proposals`). The review shows it as "Suggested update" with **Use this** and **Keep approved**. These sections are optional, not pending decisions; they never block approval.

Keeping the baseline also keeps their cross-references consistent: course emphasis, major-project `competencies` and `reviewer_overrides` name competencies by statement. When a proposal is applied, rewrite each reference whose normalized text matches a baseline statement to the baseline wording. Drop a reference that matches no competency in the merged profile, and log it.

In `recheck` mode these sections take the scorer's values, as a full re-check should. They get a "Changed since the approved version" tag when the section's JSON differs from the baseline's.

The adopt overlay (`preserveAdoptOverlay`) still runs after the merge, as today, from the draft row in `targeted` and `recheck`. In `fresh` mode the overlay is not carried: Start over means as if for the first time.

## The change list (`targeted` and `recheck`)

The draft carries the comparison so the review panel can show it after a reload. Add one optional field to the profile schema:

```
revision: {
  mode: 'targeted' | 'recheck',
  baseline_snapshot_id: string,
  changes: Array<{
    statement: string,
    kind: 'moved' | 'added' | 'removed',
    dims: Array<{ dim: 'k'|'u'|'d', from: number|null, to: number|null }>,
    new_citations: Citation[],         // empty in recheck mode
    before: CaptureCompetency | null,  // baseline competency in full (null for added)
    after: CaptureCompetency | null,   // scored competency in full (null for removed)
    decision: 'pending' | 'kept' | 'undone',
  }>,
  section_proposals: Array<{ section: string, value: unknown, decision: 'pending' | 'used' | 'kept_approved' }>,  // targeted only
  stale_evidence: string[],            // competency statements
  discarded_wobble: number,            // targeted only
} | null | optional
```

The field is optional and nullable. The OpenAI strict-mode rule only applies to schemas sent to the model, and this field never is. It must be added to `captureProfileSchema` itself, because the reviewer-edit persist (mode 2) parses with that schema and Zod drops unknown keys. **New requirement on the snapshot route:** strip `revision` before freezing. Today it freezes `draft.profile` exactly as it is. The draft only carries full copies of the competencies that moved, so its size stays small.

- **`recheck`:** the change list is a plain diff of scored against baseline (moved, added and removed competencies). No merge rule runs.
- **Review panel:** a new component, `RevisionChanges`, sits at the top of `ProfileReviewPanel`. Each change has two buttons, **Keep change** and **Undo**. Undo replaces the competency in the working profile with `before` in full: K/U/D, rationale, evidence and citations. For `added`, it removes the competency; for `removed`, it restores it. Any hand edit to that competency is replaced, and the button's tooltip says so. Keep change after an Undo puts `after` back. Decisions save through the existing reviewer-edit persist (mode 2).
- **Stale evidence:** these competencies are listed under "Evidence no longer in use — check these".
- **Approving:** the approve control is disabled while any change is `pending`, with the line "Decide on each change above first."

## What's left to the builder

- The interviewer's opening text and prompt wording for `targeted` mode. Requirements: the interviewer asks what changed, references the approved profile, and keeps questions on the changes and their knock-on effects.
- Component layout and styling, following the existing review panel.
- Where the competency-and-depth summary of the approved profile goes in the interviewer context. It must be short: statement and K/U/D only.

## Calls made (owner to check)

1. The baseline is the latest snapshot for the course, whichever instructor approved it, because that is the version the landing page names.
2. Non-competency sections take the new values in `targeted` mode, tagged as changed. Ratings are what program views use. Per-section merging would add review work for little benefit.
3. `recheck` and `targeted` anchor on the approved snapshot, not on the draft. This is a change from today's "Build on prior capture".
4. "New evidence" is judged per competency, not per K, U or D dimension, because citations are stored per competency.
5. The mode is fixed for a session. Switching means starting over through the existing Clear control.
6. In `targeted` mode, non-competency sections keep the approved version and offer the new one as an optional suggestion. Taking the scorer's text would let rewording alone mark every section as changed.
7. Start over drops the Explore adopt overlay (intended targets).
8. Each new snapshot records a fingerprint of every file's text, so an edited file is recognized as new evidence even when its size didn't change. Older snapshots fall back to comparing size and read status.
9. A retired baseline blocks Generate with a clear message. The alternative, silently re-basing onto a newer version, could mix two revisions.
