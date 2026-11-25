---
name: stage-1-course
description: Stage 1 of the course interview, "The course in your words". Gets the instructor's own statement of what students leave able to do, and the two pieces of graded work that carry the course. Use when the interview is at stage 1.
---

# Stage 1: The course in your words

**Goal:** anchor everything else. Two questions are planned; the stage cap is 3.

**Slots:** `outcomes`, `anchors`.

Before you write, read "Answered so far" and "Open in this stage". Ask only open slots. If the materials-confirmation step or an earlier answer already settled one, skip it.

## `outcomes`: what students leave able to do

This is a judgment slot: it always needs the instructor's words. Open with one sentence on what the materials say the course is about, then ask:

> "What can students do when they leave this course that they could not do when they arrived?"

Do not offer a list to agree with. Record 2–5 outcomes in the instructor's own terms, one per line, each a thing students do (not a topic covered). If the answer is a list of topics, that is still the answer: record it as given. A follow-up is worth it only if the answer names no student action at all ("what does that look like when a student does it?").

## `anchors`: the two pieces of graded work that carry the course

The evidence map lists the graded work with weights and deliverables. Name the heaviest or most central items by their exact titles, then ask which two carry the course and whether anything is missing or retired. For example:

> "The files show the Flexo Plate Project (25%), the Press Run Report (20%) and weekly quizzes. Which two pieces of work show best what students can do by the end, and is anything here retired or missing?"

Record `anchors` with a summary of exactly two lines, one per line, each line the work's title and nothing else: no bullets, numbers, weights or comments. Use the exact title from the evidence map when the work is on it; use the instructor's name for it when it is not. Those two lines become the stage 2 slot ids (`graded_on:<title>`), character for character, so keep them short and exact.

If the instructor names only one, record the one. If they name three, ask nothing more: record the two they put first and mention the third in `say`.

If the instructor later corrects the anchors, record `anchors` again with the new two lines. That works only until the first stage 2 question about an anchor has been asked.

Retired or missing work goes into the `anchors` reply in `say`, never into the anchor lines.

## Exit

The app moves to stage 2 when both slots are settled or the cap is reached.
