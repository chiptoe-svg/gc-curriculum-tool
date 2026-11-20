# One skill tree: skills, parent skills, strings and competencies

**Status:** draft for the owner's approval (2026-11-20); builder check done, two owner decisions recorded below. Builds on
[2026-11-18 locked skill strings](./2026-11-18-locked-skill-strings-design.md) (strings, joins, merges, `requires`
stops, fade and reinforcement designed but off) and
[2026-11-20 links drive coverage](./2026-11-20-links-drive-coverage-design.md) (course skills linked to catalog
competencies decide the matrix). Source: the owner's whiteboard sketch and conversation, 2026-11-20.

## Intent and why

A captured course yields dozens of narrow skills ("design targets, measure patches with an X-Rite, report results").
Comparing hundreds of these across courses, against prerequisites and against career paths, is too fine-grained to
decide anything. Faculty think in a hierarchy: narrow skills roll up to a parent ("ICC profile building"), parents to a
broader skill ("Color management"), and **a competency is just a master skill at the top of that tree** (owner).

The tree lets every downstream question work at a useful level while keeping every narrow skill's own K/U/D underneath:

- **Q1 (career readiness):** a career path is a weighted set of master skills; each is a weighted roll-up of its
  children, down to what courses actually teach, carried by strings.
- **Q2 (prerequisites):** a course's prerequisite check looks for a specific skill (at any level) at a required depth
  in what arrives on the incoming strings.

## Goals

- One department-wide skill tree. Its top level is today's catalog competencies (47 active); below them, parent skills;
  at the bottom, the skills captures produce.
- Faculty build the tree in two places that share one control and one parent list (owner: "these two belong
  together"): **the cluster map** (across courses) and **the end of capture review**, when skill levels are confirmed.
  The tool proposes; faculty confirm.
- **One roll-up rule at every level:** a parent's K, U and D are each a weighted average of its children's (owner: "the
  same weighted average and dimensions we use at competency level works throughout"). A missing child counts as 0.
  Faculty may set a parent's depth by hand; the computed value is then the suggestion.
- **Nothing is flattened away:** every child keeps its own K/U/D at every level, so any parent's figure can be opened
  to the skills behind it (owner).
- **Weights from outside in:** a branch's weight starts from O*NET importance, adjusted by faculty, and is replaced by
  employer position captures where they exist (owner). `career_target_requirements.weight_source` already records
  `onet | employer | faculty | ai`.
- **Strings carry everything forward:** a string holds every skill it has picked up, at whatever tree level is
  useful; a prerequisite (`requires`) check reads only the skill it needs from what arrives (owner).

## Rules settled with the owner (2026-11-20)

1. **A string carries the whole incoming string forward**, not just what the next course's prerequisite needs. The
   prerequisite check is a lookup against it.
2. **Same skill arriving on two strings:** the stronger depth counts (per K, U, D). "Same" is decided by faculty, never
   by wording alone: wording always differs a little, so similarity proposes and faculty confirm (as the strings
   design already does for reworded skills).
3. **Up the tree:** weighted average of the children, per K, U, D (not the strongest child: "highest linked skill"
   overstated the matrix on 262 of 380 pairs, 2026-11-19).
4. **Weights:** O*NET, then faculty, then employer position captures.
5. **Reinforcement** (later phase) is **every touch**: a reminder or a use of the same or a similar skill. Each touch
   records its strength on the existing depth scale (about 1 = reminder, 3+ = real use), so fade can treat them
   differently. This replaces the 2026-11-18 rule (only a re-teach within one level of the peak counted); nothing
   built depends on that rule yet.
6. **Fade** is a later phase. Phase 1 keeps each stop's place in time (already in the strings design) so fade can be
   added without rework.

## Approaches

- **A. One tree; competencies are its top level.** *Recommended; matches the owner's "competencies are just master
  skills".* Course skill → competency links become ordinary branches; the matrix's competency level is the tree's
  roll-up at the top.
- B. A separate parent-skill layer between course skills and competencies. Two roll-up mechanisms (skill → parent,
  parent → competency) that do the same thing; more to explain and keep consistent.
- C. No hierarchy; group only inside strings. Keeps hundreds of narrow skills in every prerequisite and competency
  decision, which is what the owner wants to avoid.

## Design (phase 1: structure and roll-up, no time effects)

**The tree.** A node is a department-wide skill with a name, an optional description, and a parent (none for a master
skill). Catalog competencies become master-skill nodes, keeping their ids, K/U/D descriptors and foundational (D-only)
flag. A captured course skill attaches to a node as evidence: it is a leaf, holding its own K/U/D for that course
version. A branch carries a weight and where the weight came from.

**Reading a node.** For a course version: the node's K, U, D = weighted average of its children's (recursively), with
leaves from that course's captured skills. For the program or a career path: the same, over what the strings deliver.
A faculty-set depth overrides the computed one at that node and is shown as such ("set by hand").

**Where faculty build it.**
- *End of capture review:* each newly captured skill is placed under a parent (the tool suggests the closest by
  similarity, faculty confirm, move it, or start a new parent).
- *Cluster map:* the same parents across courses; faculty merge, split, rename and re-parent.
Both use one component and edit one tree.

**Strings.** A string's stops can be at any node level. A `requires` stop names a node and a depth; it passes when the
incoming strings reach that depth on that node (rule 2 for duplicates, rule 3 for roll-up).

**What it replaces.** `skill_competency_links` (course skill → competency) become leaf → node attachments;
`competency_rollups` (a faculty or AI level for a course and competency) become hand-set depths on a node. The
`competency_levels` view (0072) keeps its contract and its numbers for /program and the wiki (owner decision below):
the tree's reading at a master node is shown beside it, not in place of it, until the owner decides to switch.

## Phase 2 (later)

Fade (depth drops with time since last use) and reinforcement (rule 5) on top of the phase 1 readings, using the
existing `durable()` model in `lib/builder/compute.ts`.

## Non-goals

- Changing how captures score skills.
- An AI-built tree without faculty confirmation.
- Fade and reinforcement (phase 2).

## Anti-goals

- A parent's number hiding a missing child (weighted average with 0 for missing, and drill-down always available).
- Two different roll-up rules in different places.
- Faculty having to place hundreds of skills by hand with no suggestion.

## Owner decisions on the builder check (2026-11-20)

- **/program keeps the scorer's level for now.** The course cells stay as decided this morning (the scorer's level,
  links decide whether it counts; `competency_levels`, 0072). The tree drives the program and career-path readings and
  the drill-down, and shows its own computed number beside the scorer's. Switching the cells to the tree is a later,
  separate decision, made after comparing the two on real courses. Day one: /program and the wiki are unchanged.
- **A course skill (leaf) can sit under several parents**, each with a share. Nodes above the course level keep a
  single parent, so the structure above the leaves stays a tree. (Live data: 164 of 397 linked skills link to two or
  more competencies, most still unreviewed suggestions.)

## Calls made in writing this (Claude's, owner to check)

- **Recaptures keep placements.** A leaf is keyed by course + the skill's wording hash, as string points are
  (2026-11-18). A recapture with the same wording keeps its place in the tree; a reworded skill gets the existing
  "Reworded? confirm / not the same" step, and confirming keeps its placement; a skill that disappears drops out of
  the readings. Hand-set depths are per node and course and survive recaptures, marked for review when the leaves
  under them change.
- **"Missing" means missing from this course.** A node's children are those in the department tree; a child with no
  evidence in this course counts as 0 in that course's reading. A course that teaches one of three ICC-building
  skills reads about a third of the way up, not full marks.
- **Default branch weights are equal among siblings.** Faculty adjust them; O*NET supplies a starting weight only where
  its elements map to a node (bundles today map to competencies, so mostly at the top two levels); employer position
  captures override where they exist.
- **Merged nodes redirect; splits ask.** A merged node keeps its id and points to the survivor (as `merged_into` does
  for catalog competencies today), so string stops and links follow it. A split lists the string stops and hand-set
  depths on the old node for faculty to re-point.
- **Foundational nodes read D only.** K and U stay null at a foundational node and everything above it inherits only
  what non-foundational children supply; a foundational node's children contribute only their D.
- **Who edits:** any login that can capture a course may edit the tree, as with strings; every change is logged with
  who, when and what (an append-only events table, as `curriculum_string_events`). No locking; last write wins, with
  the log to recover.

## Open for the builder

- Storage of the tree (a nodes table with parent id, or reuse `sub_competencies` for the top level plus a new table
  below) and the migration path for the 740 existing skill links and any roll-ups.
- The suggestion method for placing a new skill (embedding shortlist plus the pair judge, as the matcher uses today).
- How bundles (O*NET elements placed into competencies, `bundle_members`) supply starting weights for branches.
