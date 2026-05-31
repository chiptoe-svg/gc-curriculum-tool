# Wiki-Readiness Substrate Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended; small inline scope) or superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve optionality to build a curriculum wiki (Karpathy-pattern markdown corpus, browsable + LLM-readable, optionally Obsidian-renderable) by closing small data-hygiene gaps in the existing capture pipeline. No wiki layer is built here — this only ensures the substrate is rich enough to synthesize from later.

**Architecture:** Three already-confirmed audit findings shape this plan:

1. **Slugs already exist.** `careerTargets.id` and `subCompetencies.id` are stable text PKs ("production-operations" style). Future `[[wikilinks]]` can target them directly. No migration needed.
2. **`reviewerNote` is half-built.** The column exists on `course_capture_profiles` (since launch) and the `POST /api/capture/[code]/scores` route accepts it on save. But no UI surfaces it, so faculty have no way to enter it — meaning it's always `null` in practice. The note also doesn't survive snapshot creation: `course_capture_snapshots` has no column for it.
3. **The audit prompt heavily probes prereq direction** (backward). It does not currently probe forward direction (how this course feeds into what students do next).

**Scope:** four tasks, ~3 hours total.

---

## File structure

- **Create:** `drizzle/0025_<auto-name>.sql` — adds `reviewer_note text` to `course_capture_snapshots`
- **Modify:** `lib/db/schema.ts` — add `reviewerNote` to `courseCaptureSnapshots`
- **Modify:** `lib/db/capture-snapshots-queries.ts` — `createSnapshot` accepts + persists `reviewerNote`; `rowToSnapshot` carries it
- **Modify:** `app/api/capture/[code]/scores/route.ts` snapshot-creation branch — pass `reviewerNote` from the profile when creating a snapshot
- **Modify:** `app/capture/[code]/ProfileReviewPanel.tsx` — textarea labeled "Departmental context" persisted via existing scores POST
- **Modify:** `lib/ai/prompts/capture-chat-agent.md` — add a small "downstream relationships" probe complementing the existing prereq probe
- **Modify:** `docs/STATE.md` — add a "Wiki-readiness substrate" subsection enumerating what data exists for future synthesis

---

## Task 1: Surface `reviewerNote` in the Review panel UI

**Files:** Modify `app/capture/[code]/ProfileReviewPanel.tsx`.

The textarea lets faculty record the *why* behind their overrides + any departmental context that doesn't fit elsewhere. Persisted via the existing `POST /api/capture/[code]/scores` body field (`reviewerNote`).

- [ ] **Step 1: Read the panel's existing onSave/save flow**

Confirm where the panel calls `onSave(profile, status)`. The reviewer-note field needs to thread through the parent's saver. If `onSave` only takes `(profile, status)`, extend it to optionally accept `(profile, status, reviewerNote)`. Read `app/capture/[code]/CaptureClient.tsx` for the parent's save handler so you know the wire to extend.

- [ ] **Step 2: Add state + textarea**

In `ProfileReviewPanel`:

```tsx
const [reviewerNote, setReviewerNote] = useState<string>(initialReviewerNote ?? '');
```

(Where `initialReviewerNote` is a new optional prop — the parent can pass the current draft's `reviewerNote` if it has one.)

Render a textarea above the Save Profile buttons:

```tsx
<section className="border-t px-4 py-3">
  <label htmlFor="reviewer-note" className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
    Departmental context <span className="font-normal text-muted-foreground">(why these scores, decisions, anything a future reader should know)</span>
  </label>
  <textarea
    id="reviewer-note"
    value={reviewerNote}
    onChange={e => setReviewerNote(e.target.value)}
    rows={4}
    placeholder="e.g. 'Lowered D from 4 to 3 because the Spring 2026 rubric dropped the project-defense component.' Optional."
    className="mt-1 w-full resize-y rounded border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
  />
</section>
```

- [ ] **Step 3: Thread through the save handler**

Update the `onSave` calls in the panel to pass `reviewerNote`. Update the parent in `CaptureClient.tsx` to forward it to the POST body.

- [ ] **Step 4: Type-check + commit**

`pnpm tsc --noEmit` — clean.

```bash
git add app/capture/[code]/ProfileReviewPanel.tsx app/capture/[code]/CaptureClient.tsx
git commit -m "feat(capture): surface reviewerNote in Review panel (DB+API were already there)"
```

---

## Task 2: Persist `reviewerNote` onto snapshots

**Files:** Migration + `lib/db/schema.ts` + `lib/db/capture-snapshots-queries.ts` + `app/api/capture/[code]/scores/route.ts`.

Once Task 1 lands and faculty start writing notes, freezing a snapshot must carry the note forward — otherwise the immutable record loses the departmental context.

- [ ] **Step 1: Add column to schema**

In `lib/db/schema.ts`, in the `courseCaptureSnapshots` definition (between `captionNote` and `transcriptSessionId`):

```typescript
  reviewerNote: text('reviewer_note'),
```

- [ ] **Step 2: Generate migration**

```bash
pnpm db:generate
```

This should produce `drizzle/0025_<adjective_animal_thing>.sql` with the single `ALTER TABLE` adding the nullable column. Sanity-check the diff before running.

- [ ] **Step 3: Apply migration**

```bash
pnpm db:migrate
```

- [ ] **Step 4: Carry the field through queries**

In `lib/db/capture-snapshots-queries.ts`:

- Add `reviewerNote: string | null` to `SnapshotRow`, `CreateSnapshotInput`.
- In `rowToSnapshot`, copy `row.reviewerNote`.
- In `createSnapshot`, include `reviewerNote: input.reviewerNote ?? null` in the `.values({...})` insert.

- [ ] **Step 5: Wire the snapshot-creation call site**

In `app/api/capture/[code]/scores/route.ts` (the snapshot-creation branch, line ~199 onwards), before calling `createSnapshot`, fetch the current profile's `reviewerNote` (or pass through from the draft `profile` row), and forward as `reviewerNote: profile.reviewerNote ?? null`.

- [ ] **Step 6: Type-check + commit**

`pnpm tsc --noEmit` — clean.

```bash
git add drizzle/0025_*.sql lib/db/schema.ts lib/db/capture-snapshots-queries.ts app/api/capture/[code]/scores/route.ts
git commit -m "feat(db): snapshots persist reviewerNote (the departmental-context field)"
```

---

## Task 3: Audit prompt — forward-direction probe

**File:** Modify `lib/ai/prompts/capture-chat-agent.md`.

The prompt already probes prereq direction richly (Audit Area for incoming-expectations). It does NOT explicitly ask about how this course's outputs feed into successors. That forward direction is the missing half of the cross-course graph a wiki would render.

- [ ] **Step 1: Find the prereq probe**

Read `lib/ai/prompts/capture-chat-agent.md`. Locate the prereq-probing section (search for "prereq" / "incoming"). Note the structure — the addition should match its style.

- [ ] **Step 2: Add a downstream probe**

Add a small paragraph in the same section (or as a new audit-area bullet) — keep it 3-5 sentences max:

```markdown
**Downstream connections.** Where appropriate, ask the instructor which later courses build on what students learn here, and which capstone or studio courses depend on the depths reached in this one. Surface this as a single probe per session (not per turn); the goal is to gather the forward-direction edges that the prereq probe captures going backward. Findings here should land in `audit_notes.downstream_connections` (a free-form prose field; no structured schema required). When the instructor doesn't know or the connections aren't obvious, drop the probe — do not invent edges from catalog data alone.
```

If the schema doesn't have `downstream_connections`, the LLM will tuck it into `audit_notes.cross_source_conflicts` or similar; either way the prose is captured in the audit transcript (`capture_messages`) which is the actual substrate the wiki would read. The schema field is a soft preference, not a hard requirement.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/prompts/capture-chat-agent.md
git commit -m "feat(prompt): add downstream-connections probe to capture-chat-agent"
```

---

## Task 4: STATE — Wiki-readiness substrate section

**File:** Modify `docs/STATE.md`.

A 5-10 line inventory enumerating what data already exists for future wiki synthesis. Its job is to remind future-you (or future-Claude) that the substrate is rich enough to skip "capture more data first" and jump to "render it."

- [ ] **Step 1: Add the section**

After the "Architecture (at-a-glance)" section but before "Active arc", add:

```markdown
### Wiki-readiness substrate

Data already captured that a future curriculum wiki (Karpathy-pattern markdown + bidirectional links, browsable in-app or in Obsidian) could synthesize over without further capture work:

- **Stable entity slugs.** `careerTargets.id` and `subCompetencies.id` are human-readable text PKs; future `[[wikilinks]]` resolve directly.
- **Immutable raw layer.** `course_capture_snapshots` (per-audit profile JSON, frozen), `capture_messages` (append-only audit transcript with tool calls + citations), `course_materials` (extracted text + digests + chunked vectors).
- **Per-finding provenance.** Stage 4 source flags (`instructor` / `materials` / `inferred`) + citations linking back to chunks or instructor turns.
- **Departmental narrative.** `reviewerNote` (`courseCaptureProfiles` + `courseCaptureSnapshots` — surfaced in the Review panel, persisted with snapshots; the "why" behind overrides + decisions).
- **Cross-course observations.** Audit transcripts capture both prereq direction (Audit Area for incoming expectations) and downstream direction (Task 3 of the wiki-readiness plan). The graph emerges from these prose exchanges; no normalized cross-course table needed.

Anything not listed here that a wiki would want — captured edits with rationale, concept-level descriptors beyond what subCompetencies carry, cross-snapshot evolution diffs — is derivable from the raw layer at wiki-build time and does not require additional capture infrastructure.
```

- [ ] **Step 2: Bump Last verified**

Update `Last verified:` to the SHA of the next commit (set after committing).

- [ ] **Step 3: Commit**

```bash
git add docs/STATE.md
git commit -m "docs(state): document wiki-readiness substrate (no capture-side work blocking a future wiki)"
```

---

## Verification (post-execute)

1. **UI smoke** — open `/capture/GC 4800?slug=…`, scroll to Review panel, see the "Departmental context" textarea. Type a sentence. Hit Save. Reload page — text persists.
2. **Snapshot smoke** — take a snapshot ("Capture profile"). Query DB: `psql "$DATABASE_URL" -c "SELECT id, course_code, LEFT(reviewer_note, 80) FROM course_capture_snapshots ORDER BY created_at DESC LIMIT 3;"` — most-recent snapshot should carry the note.
3. **Audit prompt smoke** — start a fresh audit session on a course. Within the session, the agent should at some point probe forward-direction relationships (likely as a later-session question, not opening turn).
4. **STATE smoke** — `grep -c 'Wiki-readiness substrate' docs/STATE.md` → 1.

---

## Self-Review

**What's NOT in this plan (deliberately):**

- No wiki layer. Markdown generation, route, MCP server — all deferred until you decide the synthesis is worth building.
- No `course_relationships` table. The audit transcript is a better substrate than a normalized table for the same data.
- No concept-level entity table (productive failure, three-act, scaffolding). These live in markdown when the wiki is built; no DB row needed.
- No reviewer-note round-trip on snapshot load. The "Loaded from snapshot {N}" placeholder behavior in `capture-snapshots-queries.ts:157` is preserved — when faculty restore an old snapshot to the draft, the prior note's narrative is overwritten with the load-receipt. Acceptable for now; revisit if it bites.

**Total scope:** four tasks, ~3 hours including the build + restart afterward. Half a day at most.

---

## Execution Handoff

Plan complete. Saved to `docs/superpowers/plans/2026-05-30-wiki-readiness-substrate.md`.

Execution: inline (executing-plans) is fine — the four tasks are short and sequential, no subagent overhead needed.
