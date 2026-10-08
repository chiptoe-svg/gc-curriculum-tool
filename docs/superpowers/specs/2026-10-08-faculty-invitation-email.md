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
