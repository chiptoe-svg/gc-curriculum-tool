# Faculty invitation email (owner-approved text, 2026-10-07; course list added 2026-10-08)

Used when the main Claude session sends each faculty member their personal link through mailcal (owner approves every send on Telegram). One email per person; the link comes from **Send a new link** on `/admin/access` (or a fresh grant) and is never pasted into chat. No deadline line (owner, 2026-10-07).

Fill-ins: `{first name}`; `{course list}` = codes joined with ", " (e.g. "GC 3460 and GC 4400"); `{is/are}`, `{it/them}`, `{s}` by count; `{course lines}` = one line per course, `- {code}: {catalog title}` (code alone if no title), or `- All courses in the tool` for an all-courses link; `{link}`.

---

**Subject:** Capturing {course list} for the curriculum map

Hi {first name},

We're building a shared record of what each course in our students' path actually develops in them: not just what the catalog says, but what students do and how deeply. Your course{s} **{course list}** {is/are} part of that path, and I'd value your help capturing {it/them}.

**Your courses:**
{course lines}

**What it involves (about 20–45 minutes per course):**
1. Open your personal link below. It signs you in and opens your course list.
2. Add your syllabus and any assignment sheets or rubrics, or import them from Canvas.
3. An AI interviewer asks you about the course. You can type your answers or speak them.
4. Review the profile it drafts, adjust anything that's off, and approve it.

You can stop and pick up where you left off at any time.

**What the result looks like:** each approved course gets a page in our curriculum wiki. Here's an example, GC 3620 Brand Design and Creative Direction: https://gcworkflow.clemson.edu:8443/wiki/courses/gc-3620. The full wiki is at https://gcworkflow.clemson.edu:8443/wiki.

**Your sign-in link:** {link}

This link is just for you. It signs in the browser you open it in. **Please keep this email**: it's how you sign in again on another computer. Please don't forward it.

Step-by-step guide with screenshots: https://gcworkflow.clemson.edu:8443/curriculum/howto

*A note: right now the tool and its curriculum map are built around the Graphic Communications program, so some of the wording you'll see is GC-specific. We intend to broaden it over time, and your course helps us get there.*

The tool is only reachable on the Clemson network. Use the VPN off campus.

Thank you,
Chip Tonkin

---

**Before sending:** the sign-in fix for browsers that already used the department password (a personal link is currently ignored while a department session is active — observed by the owner 2026-10-08) should be deployed first, or the email should tell recipients to clear the site's data if the link opens as "Department login".

---

## Variants for courses already captured (owner-approved 2026-10-08)

A course counts as **captured** when it has a non-retired row in `course_capture_snapshots`. Pick the variant per person:

- **Course lines:** captured courses get a suffix — `- {code}: {title} — already captured, thank you`.
- **Nothing captured:** the opening paragraph and "What it involves" steps above, unchanged.
- **Everything captured** — opening paragraph becomes:

  > We're building a shared record of what each course in our students' path actually develops in them: not just what the catalog says, but what students do and how deeply. Your course{s} {course list} {has/have} already been captured — thank you; that work is already part of the curriculum map. This link gives you your own access so you can keep {it/them} current: add new materials as the course changes, revise the profile, and use Explore to think through changes and see how {it fits/they fit} with the rest of the program.

  and the steps section becomes:

  > **To update a course (whenever it changes):**
  > 1. Open your personal link below. It signs you in and opens your course list.
  > 2. Open the course, then add new or changed materials, or start an update interview.
  > 3. Review the updated profile and approve it.

  (Drop "You can stop and pick up where you left off at any time." only if it reads oddly; it may stay.)
- **Some captured** — opening paragraph becomes:

  > …Your course{s} {uncaptured list} {is/are} part of that path, and I'd value your help capturing {it/them}. {captured list} {is/are} already captured — thank you; your link also lets you keep {it/them} current.

  Steps section unchanged (the capture steps apply to the uncaptured courses).

What a personal course link can do (checked 2026-10-08, `lib/auth/authorize.ts`): on its own courses — add materials, interview, revise/approve the profile, Explore incl. chat; on every other course — view pages and the wiki only.
