---
name: interview-pre-read
description: Stage 0 of the course interview. Reads a course's materials once, before the instructor is waiting, and writes the evidence map (graded work, tests, competencies, assumed skills, objectives, conflicts, unreadable content), citing a passage for every item. Use when building the evidence map for a staged interview.
---

# Pre-read: build the evidence map

You read the course materials once and write the evidence map that the interview starts from. The instructor will see it, correct it, and then answer only what the materials cannot settle. Facts in the map are never asked in the interview, so be complete and exact, and never invent.

Search and fetch the materials (`search_materials`, `fetch_material_section`) until you have covered the syllabus, every assignment and rubric, and every test or quiz file. Then return the map.

## Citations

Every item you extract comes from a passage. Where a field is called `source`, put the `id` of that chunk, copied exactly from the tool result. Where an item has no `source` field, tie it to graded work by title or name the chunk id in its text. If you cannot point to a passage, leave the item out.

## Fields

- **`summary`**: two or three plain sentences on what the course covers and how it is graded, from the syllabus. No judgments about quality.
- **`graded_work`**: every graded item that carries real weight (projects, reports, presentations, portfolios, exams), not every small exercise. For each:
  - `title`: the title as the materials write it. The interview uses these titles as identifiers, so copy them exactly;
  - `weight`: percent or points as written, or null;
  - `deliverables`: what students hand in, or null;
  - `rubric_criteria`: each criterion with its points, as written. Empty when no rubric is in the files;
  - `source`.
- **`tests`**: each test or quiz series with its `item_types` (multiple choice, fill-in, short answer, calculation, practical, open-book or closed-book) and `source`. Only types you can see.
- **`competencies`**: 5 to 10 candidate competencies, each a plain statement of what students do, with the `graded_work` titles that show it. Only competencies some graded work demands.
- **`assumed_skills`**: 3 to 8 skills the projects require but the course does not teach, with `used_in` (the graded work that needs it) and `source`. A skill the course teaches is not assumed.
- **`objectives`**: every stated learning objective, word for word. `status` is `graded_work_found` when some graded work demands it (list those titles in `graded_work`), otherwise `not_found`. A topic listed in the schedule is not graded work.
- **`conflicts`**: places where sources disagree (a weight that differs between the syllabus and Canvas, a deliverable in one file and not another). Write each as one sentence naming both sources by chunk id. These go to the audit notes; the interview never asks about them.
- **`unreadable`**: each file or section you could not read (scanned image, broken table, empty extraction), with a short `note`.

## Rules

- Copy, do not paraphrase, titles, weights, criteria and objectives.
- The catalog is context, not material: do not take objectives or weights from it unless the syllabus repeats them.
- Silence is not a finding. If the materials do not say something, leave it out; the interview will ask.
