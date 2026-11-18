# Locked skill strings — design

Status: draft for owner review (2026-11-18); owner answered the three open questions the same day. First half of the ROADMAP item "Skills vs. competencies: strings and chords".

## Intent and why

Today a string is drawn on the fly: a match reading links one required skill to the upstream skills that supply it, per
cluster, per page load. Nothing ties A→B→C together, nothing has a name, and nothing survives a course change.

The owner wants faculty to **lock** a string that runs across and through several courses' skills, and have it be a
**durable part of the department's curriculum record**. A locked string is an entity with its own panel that shows what
happens along the way:

- **Depth:** K/U/D at each stop: does it rise, hold, or slip?
- **Reinforcement:** how many later courses develop it again.
- **Where it ends:** the last course the string reaches. Not a failure and not permanent: an end is a future
  opportunity, so it is shown plainly, with no warning flag (owner, 2026-11-18).
- **The why:** each link says why this course follows the last, in a faculty member's words.

Two more payoffs the owner named:

- **Breaks are visible and obvious to faculty who change a course later.** Someone rewording or dropping a skill that a
  string runs through sees it at that moment, and the break stays visible on the string until it is repaired or the
  string is unlocked.
- **Orphan skills show:** skills on no string. "Why do them?"

Success: a faculty member opens a course and sees which strings run through it and what depends on it; the department can
look at a string and see the progression, where it thins, and where it ends.

## Goals

1. A department-wide string record: name, a short "what this string is", ordered stops, who locked it, when, and why.
2. Lock a string from a cluster map, from links already on the canvas; extend an existing string from any cluster.
3. A string panel with the stops in order and the four readings (depth, reinforcement, where it ends, why).
4. String status against today's captures: intact, changed-since-locked (confirm), broken (skill gone).
5. Break warnings where courses are changed, and "strings through this course" marks.
6. An orphan list per course.

## Non-goals (this version)

- Chords / competencies derived from strings (the second half of the ROADMAP item).
- Automatic string suggestions from existing links (agreed as a later phase).
- Branching strings. A string is one ordered line; a skill may sit on several strings, which covers most branching.
- Strings through what-ifs or map-only draft courses. Strings anchor to **captured** courses only.

## Anti-goals

- A string that silently changes or disappears. Nothing repairs a stop without a faculty member confirming it.
- A capture or an edit blocked by a string. Warnings inform; they never stop someone saving their course.
- Orphan labels that read as an accusation, and any warning styling on a string's end. An orphan is a question; an
  explained one shows its explanation. An end is just where the string stops today.

## Approaches considered

1. **Strings as their own stored record** (chosen by the owner, 2026-11-18). New tables; each stop anchored to a course
   and a skill's saved wording; readings computed live from current captures. Has a name and a why; survives course
   changes by flagging rather than dropping.
2. Strings stitched from saved pair decisions (`skill_match_decisions`). No new record, but chains drift (A≈B, B≈C,
   A≉C), no name or why, and decisions keyed by wording orphan on rewording.
3. Option 1 plus automatic suggestions. Suggestions deferred to a later phase.

## Design

### The record (department-wide, migration 0071)

- `curriculum_strings`: id, name (unique among active strings), description, status `active | unlocked`,
  created_by / at, updated_by / at, version (optimistic lock, as `curriculum_clusters`).
- `curriculum_string_stops`: string_id, position (order), course_code, role `develops | requires`, statement (saved
  wording at lock), statement_hash (the `skillRef` / `ref` scheme: `textHash(normalizeStatement(s))`), snapshot_id at
  lock, k/u/d at lock, link_reason (why this stop follows the previous; null on the first stop), added_by / at.
- `curriculum_strings` also holds an optional end_note, end_by, end_at: a faculty note on the end (e.g. "could continue
  into GC 4800"). Optional; no note is the normal case. Adding a stop past the end clears it.
- `skill_orphan_notes`: course_code, role, statement_hash, statement, reason, by, at: why a skill on no string is there. Resolved like a stop (a reworded skill shows its note as "changed, confirm").
- `curriculum_string_events`: append-only history (locked, stop added, stop removed, reword confirmed, renamed,
  unlocked), with who, when, reason, and the stop's before/after wording. Unlocking keeps the rows; status flips.

A course can appear more than once on a string (e.g. a course that requires the skill and develops it further: two stops).

### Anchoring and status

A captured skill's reference is the hash of its wording, so there is no stable skill ID across recaptures. Each stop is
resolved against the course's **current** captured snapshot:

- **Intact:** a skill with the same hash and role exists.
- **Changed since locked:** the hash is gone, but the closest skill in that course (embedding shortlist, then the pair
  judge as the matcher uses today) reads at least partly. The stop shows "Reworded? *new wording* — confirm / not the
  same". Confirming records a `reword confirmed` event and updates the stop's saved wording and hash.
- **Broken:** no candidate. The string draws a visible gap at that stop.

Resolution is computed on read and cached by (stop hash, snapshot id); it never writes to the string.

### Locking (cluster map)

On a cluster canvas, a faculty member picks a link already drawn (a required skill and the upstream skill(s) that meet
it) and chooses **Lock as string**: name, what it is, why the link holds. Or **Add to string…** to extend an existing one
(placed by course order; the user can reorder). Only stops on captured courses can be locked; a what-if or draft course
in the cluster shows why it can't.

Who (owner, 2026-11-18): any signed-in faculty who can use the cluster map can lock, extend, confirm, explain an end or
an orphan, and unlock; unlock needs a reason. All of it is in the event history with names. Strings are faculty-only
(owner, 2026-11-18): `/strings` and `/api/strings` are gated like `/build`; nothing appears on public wiki pages yet.

### The string panel

Opened from any stop marker, from the course, or from a strings index (`/strings`, plus `/strings/[id]`). Shows:

- Stops in order, grouped by Act where known: course, role, wording, K/U/D now (and at lock if changed), status, the
  link's why, and the evidence the capture holds for that skill (see "Left to the builder").
- **Depth:** a small K/U/D line across stops, flagging any slip (a later develops stop lower than an earlier one).
- **Reinforcement:** count of `develops` stops after the first that are within one level of the peak so far (see
  "Built for fade and reinforcement later").
- **Ends at:** the string's last stop, shown plainly as "Ends at GC xxxx (Act n)" with its optional end note. `/strings`
  can sort and filter by where strings end (course, Act), so faculty can see which strings stop where.
- History: the event list.

### Built for fade and reinforcement later (owner, 2026-11-18)

Not built in this version, but the design must not need reworking to add them. /build already models both in
`durable()` (`lib/builder/compute.ts`): depth nobody revisits loses `fade` levels per act; a revisit within a level of
the peak halves the loss; time runs in terms, three per act. A string is exactly the input that function wants, so:

- **Every stop has a place in time.** It resolves to an Act through `defaultAct()`, and carries an optional `term`
  (column on `curriculum_string_stops`, null in this version; null means the act's last term, as `durable()` treats it).
  A later version can let a plan or cluster's placement override both.
- **One pure reading function.** All panel readings come from `readString(stops, options)` in
  `lib/builder/strings/read.ts`, returning per-stop readings plus string totals. `options.fade` exists now and is
  `null` (no fade): readings are attained depth. Adding fade later means passing a number and mapping `develops` stops
  to `durable()` contributions, giving "estimated depth still held" at each stop and where the string ends.
- **Reinforcement means the same thing now and later.** In this version a stop counts as reinforcement when it is a
  `develops` stop after the first whose depth is within one level of the string's peak so far, on any of K, U or D:
  the same rule `durable()` uses for a revisit that makes depth stick. Lighter touches are shown but not counted.
  This way the count doesn't change meaning when fade arrives.
- **Gaps can switch to held depth.** The `requires` gap check compares need to attained depth now; with fade it compares
  need to estimated held depth at that stop's term, through the same function.
- **Related-string support** (the `support` flag in `durable()`, a related competency at integration depth) waits for
  chords and is out of scope.

### Break warnings and marks

- **Cluster and /build course editors:** removing or rewording a skill that a string runs through shows "This skill is
  on *<string>*. *<later courses>* build on it." before save; saving still works. The map's string markers show the
  would-be break as a preview; the record does not change (map edits are proposals).
- **CourseCapture:** when a new snapshot of a course is saved, a banner lists the strings it changed (now reworded or
  broken), with links to confirm. The course page shows "Strings through this course" with each string's status.

### Orphans

Per course (course page, cluster course card): developed skills on no string, and required skills no string supplies.
Every orphan is listed, Act 3 included (owner, 2026-11-18); one with an orphan note shows the note instead of a flag.
Orphans are a list, not a score.

## Constraints

- Live DB migration needs the owner's explicit go-ahead and a backup first (as 0070).
- The pair judge runs on free campus models; no paid AI in this feature.
- US spelling, plain-language copy; UI says "string", never "thread".
- No instructor names in shared files; names in the UI follow existing attribution rules.

## Left to the builder

- What per-skill evidence the capture holds and how to show it in the panel (projects, cited materials, interview
  quotes): read the snapshot shape in `lib/builder/library.ts` and show what exists; no new extraction.
- Exact UI layout of the panel and markers, following cluster.css.
- Cache table vs. in-memory cache for stop resolution.

## Resolved after the builder check (Claude's calls unless marked)

- **Hashes:** required and developed refs use the same scheme (`textHash(normalizeStatement(s))`, `lib/builder/compute.ts`).
  A `develops` stop resolves against the course's developed skills, a `requires` stop against its required skills.
- **Depth by role:** a `develops` stop carries attained K/U/D; a `requires` stop carries the needed depth. Slip compares
  `develops` stops only. A `requires` stop whose need is above the previous `develops` stop's level shows as a gap.
- **Anchor:** captured snapshots only, never map edits. "Current" is the course's latest snapshot (`versions[0]`, the
  same default as /build). Pinning a snapshot is not offered.
- **Lock gesture:** one string per lock. The user ticks which of the link's supplying skills belong (default all); each
  becomes a stop. Stops are ordered by Act (the existing default-act-by-catalog-level rule), then course number, then
  develops before requires within a course; the user can reorder.
- **Ends (owner, 2026-11-18):** an end is a future opportunity, not a fault: no flag, just visible, with an optional
  note and a sort/filter on `/strings`.
- **Orphans:** a developed skill is an orphan if it is on no string. A required skill is unsupplied if it is not a
  `requires` stop with an earlier `develops` stop on some string.
- **Warnings:** checked in the browser against the strings loaded with the page, on cluster and /build course edits
  (shown as a preview) and on the capture page. Nothing blocks saving.
- **Capture banner:** computed when the course or capture page loads, not at snapshot save. If the matcher can't run,
  the stop reads "Couldn't check", never "broken" (same rule as the cluster map).
- **Unlock:** an unlocked string stays readable and frozen with its history; it can be locked again.
- **Creation:** strings are created from cluster maps only in this version; `/strings` lists them and opens the panel.
  Name uniqueness is a partial unique index on active strings. Whether 0071 adds a resolution cache table is the
  builder's call.

## Calls made by Claude (owner to check)

- Strings are linear; a skill can be on many strings (no branching).
- Captured courses only.
- Unlock needs a reason; full history.
- End notes and orphan notes are free text, one per string end or skill, editable by any faculty.
- Warnings never block saving.
- Reword detection reuses the existing matcher; confirmation is manual.
