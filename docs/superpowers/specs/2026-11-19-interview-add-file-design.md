# Add a file during the interview — design

Date: 2026-11-19 · Owner decision: files added in the chat become course materials (option A).

## Why

Instructors think of evidence mid-interview: a rubric, a brief, a photo of student work. Today the
chat takes text and voice only, and the prompt tells the instructor to paste text or leave for the
Materials step. GC 3400 (2026-08-14) opened with two wasted turns: "How can I upload them?" and
"It doesn't upload it when I add it." The evidence rule needs graded work in the record, so a
file shared in the interview is exactly the evidence the profile should rest on.

## Goals

- An "Add a file" button beside Voice in the reply area: documents (PDF, Word, slides, CSV and the
  other types Materials accepts) and pictures (PNG, JPEG).
- The file becomes a course material, marked "added during the interview", visible under
  Materials, and used by later captures and the profile writer.
- The interviewer reads it on its next turn and picks up from it.
- Works the same on every interview model (DeepSeek, Qwen, Sol) and on both loops (current, Pi).

## Non-goals

- The interview model does not read the file directly (no multimodal input to the interviewer).
- No new extraction pipeline, no new vision model.
- No drag-and-drop or paste-an-image in the first version (button only).

## Approaches

- **A. Course material (chosen).** Reuses the Materials upload and ingest; the file outlives the
  conversation. Cost: a few seconds to a minute of processing before the interviewer can use it.
- B. Conversation-only attachment. Simpler, but the file would be lost to later captures and the
  profile writer could not cite it. Rejected by the owner.

## How it works

1. **Upload.** The button posts to the existing `POST /api/courses/[code]/materials` with one new
   form field, the interview session id. The route stores the file as today.
2. **Provenance.** New nullable column `course_materials.added_in_session` (the capture session id)
   — migration, applied after a backup and the owner's yes. Materials shows "Added during the
   interview" for these rows.
3. **Processing.** The chat route asks the ingest worker to process that one material now
   (extraction → passages → embeddings → digest), skipping the tier triage: a file the instructor
   chose to share mid-interview is read in full (tier high). Pictures go through the same
   extractor; their description comes from RCD qwen3.6 like any image material (fallbacks unchanged).
4. **In the chat.** The instructor's message area shows the file as a chip with "Reading your
   file…", then "Ready". The instructor can type a note with it ("here's the rubric for the
   podcast"). Sending waits until the file is ready, or sends the note at once with the file marked
   pending.
5. **What the interviewer sees.** The instructor's turn carries a line the model can rely on:
   `[Instructor added a file: <name> (id=<material id>) — search it before answering.]` The
   material list it already gets on every turn includes the new file. The existing search check
   forces a search on that turn because the turn names a course file.
6. **Prompt.** Replace "never ask for a file in the chat" with: the instructor can add a file with
   the button beside Voice; when a needed document isn't in the materials, ask for it that way.

## Constraints

- Same upload limits and allowed types as Materials (100 MB, `SUPPORTED_MIME_TYPES`).
- Same auth as the Materials upload (course-write); the daily cost cap applies to processing.
- The 60-second per-course ingest cooldown must not block a second file added a minute later:
  the single-file path bypasses the course-wide cooldown but keeps the cost cap.
- Phone width: the button and chip fit the reply row without sideways scroll.

## Edge cases

- **Extraction fails or is slow** (over ~2 minutes): the chip says so; the turn is still sent with
  the note, and the file line says it could not be read, so the interviewer asks for the key part
  pasted instead of searching.
- **Duplicate** of a file already in Materials (same name and size): say it's already there and
  point the interviewer at the existing one.
- **Instructor removes the file** before sending: the material is deleted, as under Materials.

## Left to the builder

Component layout of the chip; polling vs. streaming the processing status; the exact wording of
the status lines (plain language, US spelling).

## Test

Free, on campus models: replay GC 3400 turn 1 with the rubric CSV added through the button and check
the interviewer searches and cites it; a photo of a student print with a note; a failed extraction.
