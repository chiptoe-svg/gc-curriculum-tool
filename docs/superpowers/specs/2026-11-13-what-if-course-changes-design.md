# What-if course changes — design

Date: 2026-11-13. Status: **awaiting the owner's approval.** Nothing here is built.

This is the next version of Explore. It replaces the Explore chat page (`/explore/[code]`, spec `2026-07-08` Explore v2) once it is live.

## Why

Faculty want to sketch a change to a course and see what it would do before anyone commits to it: "what if we added a packaging project to GC 3400 and dropped the second poster?" The owner's words: a thought provoker and a conversation starter, something to put in front of the people who teach the courses before and after.

Today the only two tools are the wrong shape for that:

- **Explore** answers a one-sentence change with a small card of predicted numbers. It handles one added activity at a time, has no notion of taking something out, takes no documents, and produces nothing a colleague can read. Its one lasting action, Adopt, overwrites the course's working draft.
- **CourseCapture** produces a full description and a wiki page, but only by approving a real snapshot, which feeds every program view, the matrix and the public wiki.

A what-if sits between them. It starts from the approved version of a course, takes a described change (words, documents, images), interviews the author about what would actually happen, and produces a readable page: the course as it would be, what changes, predicted ratings, and what it means for neighboring courses. It changes nothing about the real course.

## Goals

- A faculty member can start a what-if on a course that has an approved version, from the course's interview page.
- They can start two ways: **"here is the change"** or **"here is the result I want, what could get me there?"** In the second case the assistant proposes options, drawing on the whole curriculum record, before any interviewing starts.
- They can attach documents and images in the conversation itself.
- The interview establishes what is added, **what comes out to make room**, what students would need walking in, and what they would leave with. If the author does not mention removals, the interview asks.
- The result is a **what-if page** that reads like the course's wiki page, built on the current page, with a "What changes" section and a section for neighboring courses.
- Every rating on the page has a number. Ratings the change does not touch keep their approved values exactly. Ratings the change moves, and new ones, are **predictions** and are marked as such, pending a full capture after the change is taught.
- All signed-in faculty can read a finished what-if. It is reachable from the course list and from the course's wiki page (faculty view only).
- A course can have several what-ifs at once, from different people.
- One tool, not two: the Explore chat page is retired in the same release.

## Non-goals (this version)

- Faculty comments on a what-if. (Later phase, if at all — owner.)
- "Make this the plan": turning a finished what-if into the course's working draft. Explore's Adopt goes away in this version and may come back later in that form.
- Showing a what-if's effect inside the program matrix or scaffolding views.
- Comparing a what-if's predictions against the next real capture.
- What-ifs for a course with no approved version, or for a course that does not exist yet.
- Version history of a what-if page. Regenerating replaces the page.
- Telling the instructors of neighboring courses. Sharing is by link.
- Video attachments and Canvas imports.

## Anti-goals

These make the feature a failure even if everything else works.

- **A what-if leaking into the real course.** Nothing said, attached or predicted in a what-if may be read by a real capture, appear in a program view, the matrix, Ask, another course's interview, the wiki repository or the public wiki copy.
- **A what-if overwriting real work in progress.** Someone revising the course for real at the same time must see no difference.
- **A predicted number that looks measured.** Wherever a predicted rating appears, it is labeled.
- **An approved rating changing for no reason.** A rating the change does not touch must be identical to the approved one, not "about the same after a re-score".
- **A number the AI made up in prose.** Every rating shown comes from the stored what-if record.

## The invariant

> At every instant, the stores that describe the real course are byte-for-byte what they would have been had no what-if ever existed.

The stores, for a course: approved snapshots, the working draft, the saved interview conversation and its messages, course materials and their search index entries, coverage and prerequisite data, the wiki repository and its public copy.

**Decision: a what-if lives in its own tables** — the what-if record, its conversation, its attachments. It never writes a row to an existing course table and is never added to the shared search index. The alternative, a "this row belongs to a what-if" flag on the existing tables, was rejected: materials and interview messages each have many readers (ingest, scoring, the materials index, interview-passage lookup, the prior-session briefing, the wiki), and one missed filter is a leak nobody would notice.

Reading is unrestricted: a what-if reads the approved snapshot, the course's real materials, the wiki and neighbor data freely.

This invariant gets its own test, shown failing first: run a full what-if (messages, an attachment, a quick estimate, a generated page, a regenerate, a delete) against a course that also has a real revision in progress, and compare every store above before and after.

## How it goes, start to finish

1. **Start.** On the course's interview page, a course with an approved version shows the existing three revision choices and, set apart from them, a fourth control: start a what-if. (It is set apart because the three choices answer "what has changed"; a what-if is about something that has not happened.) The course's what-if list (below) has the same control.
2. **Talk.** The same chat panel as the interview, with an attach control. The assistant opens by asking what the author wants to change or what result they are after.
3. **Create the page.** Where the interview has "Generate Profile", a what-if has "Create the what-if page". It runs the estimate and writes the page.
4. **Read and refine.** The author reads the page, can go back to the conversation, say more, attach more, and update the page. Updating replaces it.
5. **Share.** Once a page exists, the what-if appears in the course's what-if list for all signed-in faculty, and its link can be passed around.

## The conversation

One assistant with its own instructions, working in two phases. The author can skip the first.

**Ideas.** When the author knows the result but not the change ("students should leave able to do X", "the next course says they arrive weak on Y"), the assistant proposes candidate changes. For each it says what it would displace, since time added is time taken from something. It can run a quick estimate on a candidate worth weighing and report the predicted effect. It does not pick a winner. This carries over what Explore's "suggest" mode does today (`lib/ai/prompts/explore-agent.md`).

**Pinning down.** Once there is a direction, the assistant interviews, one question at a time, until it has:

- what is added or changed: what students do, what they produce, how it is graded, roughly how much time;
- **what is removed or cut back to make room** — asked if not volunteered;
- what students would newly need walking in;
- what students would leave with that they do not now, and what they would no longer leave with.

**What it can draw on:** the approved profile; the course's real materials (read-only, through the interview's existing lookup tools); the wiki pages for courses, competencies and career targets; the search across assignments and rubrics in other courses; what earlier courses deliver and later courses expect; the what-if's own attachments and conversation.

**Two rules carried over from Explore, unchanged:**

- Every claim about another course comes from a lookup, not from the model's general knowledge.
- The assistant never states a rating of its own. Numbers come only from the estimate.

Quick estimates made during the conversation are kept only in the conversation. They are not saved as Explore scenarios.

Creating the page is never blocked. If removals were never discussed, the page says "Removed: not discussed" rather than implying nothing comes out.

## Attachments

- An attach control in the chat panel: pick files, drag in, or paste an image. This is new; the interview has no attach control today, and files enter only through the materials step.
- Accepted types and size limits: the same as the materials step accepts for uploaded files, minus video.
- Each attachment goes through the same text extraction and the same student-data screening as a course material, and whatever the materials step would hold back, the what-if holds back.
- Attachments are stored with the what-if, are readable by the what-if's assistant and estimate, and by nothing else.
- A file that cannot be read shows as failed in the conversation, and the assistant is told it could not read it.

## Predicted ratings

**Decision: the what-if profile is the approved profile with estimated changes applied on top — not a fresh score of the whole course.**

A fresh score would move ratings that have nothing to do with the change (the run-to-run variation the revision-modes design exists to contain). Applying changes on top makes "untouched ratings are identical" true by construction.

**What "approved" means here.** There is no approved-status field. The approved version is the course's newest snapshot that has not been withdrawn (`retired_at` empty), the same one the program views read. A what-if stores that snapshot's id when it starts and keeps it.

**Which ratings.** The ratings the page shows and copies are the ones in that snapshot's profile: the course's own competency statements, each with K, U and D. These are what the course wiki page and the interview show today. The catalog coverage rows (`snapshot_competency_coverage`) are a second, derived record that links a statement to a catalog competency; the what-if uses them only to compute knock-on effects (next section) and never shows their numbers as the course's ratings.

The **estimate** is one AI function. It replaces Explore's existing estimate (`estimateLocalDelta`), which today models one added activity and returns competencies as plain text. Removed and changed items, ratings that go down, and catalog links for new competencies are all new output, so this is a new schema rather than a small extension. It receives the approved profile, the what-if conversation, the attachments' text, the neighbor context and the competency catalog, and returns:

- **the change items**, each marked added, removed or changed, with a short description (what students do and produce, how it is graded);
- **the moved ratings**: for each, the competency, the rating before, the rating after, a confidence (low / medium / high) and a one-sentence reason. Ratings can go **down** as well as up;
- **new competencies** the change introduces, each with predicted ratings and, where one fits, the catalog competency it belongs to, chosen from the supplied catalog list;
- **changes to what students need walking in**: new, raised or dropped expectations.

Code, not the model, then builds the what-if profile:

- A moved rating must name a competency statement in the approved profile; otherwise it is treated as new. Matching is by the statement text after the same normalizing Explore uses now (`normalizeCompetencyKey`), not by a looser similarity.
- A catalog link is kept only if the id exists in the catalog. An invented id is dropped and the competency is shown as not linked.
- A competency not listed as moved keeps its approved K, U and D.
- The framework rules hold: the 0–5 depth scale from `lib/ai/prompts/shared/depth-scale.md`; foundational competencies carry D only, with K and U empty.
- The evidence rule (no rating above the threshold without student evidence) does **not** gate predictions, because nothing has been taught. That is exactly why every predicted rating is labeled and why none of them reaches a program view.

The same estimate serves the quick estimates in the ideas phase, on a single candidate change.

## Knock-on effects

Computed by code from the predicted ratings, reusing Explore's engine (`lib/ai/explore/ripple.ts`, `career-fit.ts`), extended in two places:

- **Later courses.** Today the engine reports only a gap that the change would close. It must also report a gap the change would **open**: a later course's confirmed expectation that the course would no longer meet. This is the main risk of a removal and the main thing a downstream instructor needs to see.
- **Earlier courses.** Today a new walking-in expectation is listed and nothing more. Each one must be checked against what the earlier courses deliver, and reported as met or not met (or not known, where there is no data).
- **Career targets.** Unchanged: which targets' coverage would move.

**How a rating reaches the engine.** The engine works on catalog competency ids, and the profile's statements carry none. So:

- A moved rating on an existing statement is resolved through the approved snapshot's coverage rows, as Explore does now (`resolveSubCompetencyDepths`): the statement is matched to the coverage rows' matched statement, and each catalog competency it maps to takes the predicted K, U and D.
- A new competency is resolved through the catalog link the estimate gave it, if it has one.
- A competency that resolves neither way has **no knock-on effects computed**. This applies equally to an existing statement the coverage record never linked and to a new one with no catalog link. The page says so for each one, so a missing effect is never read as "no effect". No id is ever guessed.

How often an existing statement fails to resolve is not known (the coverage record sometimes paraphrases the statement). The first live what-if reports the count; if it is high, looser matching is the follow-up, recorded in STATE.md.

**What counts and what is "not known".**

- Later courses: only confirmed prerequisite links to catalog competencies are checked, as now. Unconfirmed links are left out, and the page says in one line that only confirmed links were checked.
- Earlier courses: a new walking-in expectation that the estimate could link to a catalog competency is checked against what the earlier courses deliver and reported as met or not met. One with no catalog link, or where the earlier course has no data, is listed as **not known**, never as met.
- A gap is reported as opened only when the expectation was met before and would not be after. An expectation with no data before stays "not known".

## The what-if page

Reads and looks like the course's wiki page (same layout and typography), with a banner that cannot be missed.

1. **Banner.** That this is a what-if and not the current course; its title; who wrote it and when; which approved version it starts from; what "predicted" means.
2. **What changes.** Added. Removed. The net effect: what students would newly need walking in, and the moved ratings as before → after with confidence and reason.
3. **The course as it would be.** The current wiki page's description, rewritten with the change in place, followed by the full ratings table with predicted ratings marked.
4. **For neighboring courses.** Earlier courses: what this would newly ask of them and whether they deliver it. Later courses: what they rely on that would drop, and what they could newly rely on. Career targets that would move. Each course named links to its wiki page.
5. **Questions for discussion.** The open points from the conversation and the things worth verifying before acting. This is what makes it a conversation starter.
6. **What it is based on.** The attachments by name.

**Who writes what.** The AI writes prose only: the description in 3, the wording in 2 and 4, and section 5. It takes the current wiki page (read from the wiki repository, never written back), the change items, the what-if profile and the knock-on lines as input. Every rating, table and knock-on line is rendered by code from the stored record. How to keep ratings out of the AI's prose is the builder's choice; that they come only from the record is the requirement.

If the course has no wiki page (a page is not guaranteed for every approved course), the prose is written from the approved profile's own description instead. Creating the page is not refused for that reason.

The page is stored with the what-if record and served from a faculty-only address. It is never written to the wiki repository, so it cannot reach the public copy.

The assistant proposes a short title when the page is first created; the author can rename it.

## Where it is reached and who can do what

- **Course what-if list** at `/explore/[code]` (the address Explore uses now): every what-if for the course that has a page — title, author, date, one line on the change — plus the start control. The author also sees their own what-ifs that have no page yet.
- **Course list:** the row's existing Explore link becomes "What-ifs", with a count when there are any.
- **Course wiki page:** a "What-ifs (N)" link, shown only in the faculty view. It must not appear in the public view or the public copy. "Faculty view" is the wiki's existing test (the page was opened with a valid faculty access parameter, the same test that shows the Ask link today). The link shows a count and nothing else; the what-if list and pages it leads to require sign-in.
- **Interview page:** the start control described above.

| Action | Who |
| --- | --- |
| Read a what-if that has a page | Anyone signed in, including view-only |
| Start a what-if | Anyone who can capture at least one course — **on any course**, not only their own |
| Continue, update, rename or delete one | The person who started it, or an admin |
| Read its conversation | The person who started it, or an admin |

Starting a what-if on a course outside one's own scope is deliberate: the instructor of the next course is exactly who would ask "what if the course before mine added this?" It is safe because a what-if changes nothing real. **It does require a new rule in the access table** (`lib/auth/authorize.ts`), since course writes are scoped per course today and `/api/explore/` is one of the course-scoped families.

The new rule:

- It covers every what-if write and only what-if writes: start, send a message, attach, create or update the page, rename, delete. The paths are matched exactly enough that no existing route falls under it.
- It allows a login that has the capture permission and at least one course in scope (or all courses). A create-only login, or one with no courses, is refused.
- It does not check the course against the login's scope. Whether this person may continue, rename or delete *this* what-if is checked in the route, against the what-if's owner.
- Reads are not covered by the access table at all (every GET is a plain read there), so the routes that return a conversation, or an unfinished what-if, check the owner themselves. That check has its own test.
- Nothing else about the table changes. Because the table is the security boundary for faculty writes, this change gets a hostile review before merge.

**Who "the person who started it" is.** The what-if records the login it was started under and a display name. Under a personal access link, the name is the link's own and the owner is that person. Under the shared department login, which names nobody, the start step asks for a name with the same picker the interview uses, and the owner is the department login as a whole. The consequence, stated plainly: among people using the department login, anyone can continue, rename or delete a what-if started under it, and can read its conversation. Author-only editing and a private conversation hold only for people on personal links. The owner chose this over requiring a personal link to start a what-if (2026-11-13).

Delete is permanent and removes the record, the conversation and the attachment files. It asks for confirmation in the page (not a browser dialog).

## What happens to Explore

Retired in the same release, as the last step, after the what-if is working:

- `/explore/[code]` becomes the what-if list.
- The Explore chat, its assistant and its tools for saving, listing and comparing scenarios are removed. Its "suggest" and "predict" behavior lives on in the what-if assistant; its estimate and knock-on engine live on as described.
- Adopt (the button, the route and `adoptScenario`) is removed.
- The `course_explore_scenarios` table and its rows are left in place, unused. No destructive migration in this work; dropping the table is recorded in STATE.md under Deferred / debt.
- `/ask` and the wiki's chat panel share a component with the Explore chat. They must behave exactly as before.
- The faculty guide's Explore section (`docs/using-coursecapture-and-explore.html`) is rewritten for what-ifs in plain language.

## Edge cases

- **A newer version is approved after a what-if was written.** The page shows which version it is based on and that a newer one exists. It stays readable and can still be updated against its original version. An update re-reads the neighboring courses as they are at that moment, so the neighbors section reflects their current approved versions; the page shows the date it was last created.
- **The version it is based on is withdrawn.** The page stays readable with a notice. Updating is refused with the same message the interview uses for a withdrawn baseline.
- **The course has no approved version.** No start control.
- **Two people, same course.** Separate what-ifs, separate conversations; nothing shared.
- **The daily spending cap is reached.** Same message and behavior as the interview.
- **The estimate returns nothing moved.** The page is still created and says the change is not predicted to move any rating.

## Cost

Every step calls the configured provider (OpenAI today), so a what-if costs money: the conversation turns, each quick estimate, and two calls to create or update the page (the estimate and the page prose). That is roughly a "few specific things changed" revision plus one writing call. The existing daily cap applies. Token use is logged per what-if through the existing telemetry so the real figure is known after the first one. The first live run is a single what-if on one course, read by the owner, before anyone else is pointed at it.

## Later phases

In rough order of likely value: predicted-versus-measured when the course is next captured; "make this the plan"; comments; a what-if overlay in the program matrix; what-ifs for proposed and not-yet-captured courses.

## Constraints

- New tables need a migration. Applying it to the live database needs the owner's yes at that time, after a fresh backup.
- New AI functions follow the strict-schema rule for OpenAI (every property listed as required; optional fields nullable) and are added to the model-roles table and STATE.md.
- The public pages and the wiki repository are not touched.
- US spelling and plain language in everything a faculty member reads.

## What's left to the builder

- Table and column names, route names under the faculty-only `/explore` area, AI function names.
- Whether the what-if assistant is a new assistant or the interview assistant with a mode, and how the chat panel is shared. The requirement is the behavior and the separate storage.
- How attachments reuse the extraction and screening code that is tied to course materials today.
- How attachment text reaches the assistant (in full, or by lookup for long files), as long as it is not in the shared search index.
- How the page's prose and the code-rendered numbers are put together.
- The order of work, as long as retiring Explore comes last.

## Calls made (owner to check)

Decisions the owner made in conversation: the interview page as the starting point, with attachments; words plus documents and images, then an interview; removals asked about; a wiki-style page with a "What changes" section; predicted numbers on everything; readable by all faculty, linked from the course list and the course wiki page; several per course; ideas for reaching a stated result; comments later; one tool, not two; under the shared department login a what-if belongs to the login rather than a person, with a name asked for display (chosen over requiring a personal link).

Calls made in writing this up, for the owner to confirm or change:

1. **Anyone who can capture any course can start a what-if on any course**, which needs one new rule in the access table.
1. **A rating with no link to the catalog gets no knock-on effects**, shown as such, for existing and new competencies alike. How often that happens is measured on the first live what-if.
1. **Only confirmed prerequisite links are checked** for later courses; anything without data is "not known".
2. **Explore's Adopt goes away** in this version, with "make this the plan" as a later phase.
3. **Predicted-versus-measured is a later phase.** This version only tells the reader when a newer approved version exists.
4. **Untouched ratings are copied, not re-scored**; only what the change moves is predicted.
5. **A what-if is listed for others only once it has a page.** Before that only its author sees it.
6. **The conversation behind a what-if is private** to its author and admins; everyone else sees the page.
7. **Creating the page is never blocked**; an undiscussed removal is shown as "not discussed".
8. **Delete is permanent**; there is no archive.
9. **The what-if links on the wiki are faculty-only**, never on the public copy.
10. **Wording** of the start control, the banner and the "predicted" label is drafted during the build and shown to the owner before it ships.
