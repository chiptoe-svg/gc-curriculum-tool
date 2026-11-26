---
name: interview-pre-read
description: Stage 0 of the course interview. Reads a course's materials once, before the instructor is waiting, and writes the evidence map (graded work, tests, competencies, assumed skills, objectives, conflicts, unreadable content), citing a passage for every item. Use when building the evidence map for a staged interview.
---

# Pre-read: build the evidence map

You read the course materials once and write the evidence map that the interview starts from. The instructor will see it, correct it, and then answer only what the materials cannot settle. Facts in the map are never asked in the interview, so be complete and exact, and never invent.

You have about 12 searches (`search_materials`, `fetch_material_section`). The file summaries above already give most of the map; search only for what they don't show (exact rubric criteria, weights, test item types). Then submit.

## Citations

Every item you extract comes from a passage or a file summary. Every `source` is the `id` of that chunk, copied verbatim from the tool result. When a file summary is the only source, write `material:` followed by the id in that file's `--- name (id=…) ---` header. Competencies and objectives cite through their `graded_work` titles; only `conflicts` name chunk ids in their text. If you cannot point to a passage, leave the item out.

## Fields

- **`summary`**: two or three plain sentences on what the course covers and how it is graded, from the syllabus. No judgments about quality.
- **`graded_work`**: every graded item that carries real weight (projects, reports, presentations, portfolios, exams), not every small exercise. For each:
  - `title`: the title as the materials write it. The interview uses these titles as identifiers, so copy them exactly;
  - `weight`: percent or points as written, or null;
  - `deliverables`: what students hand in, or null;
  - `rubric_criteria`: each criterion with its points, as written. Empty when no rubric is in the files;
  - `source`.
- **`tests`**: each test or quiz series. For each:
  - `name`: the test or quiz series as the materials write it;
  - `item_types`: multiple choice, fill-in, short answer, calculation, practical, open-book or closed-book. Only types you can see;
  - `source`.
- **`competencies`**: 5 to 10 candidates, only ones some graded work demands. For each:
  - `statement`: a plain statement of what students do;
  - `graded_work`: the titles of the graded work that shows it.
- **`assumed_skills`**: 3 to 8 skills the projects require but the course does not teach. For each:
  - `skill`: a short name for the skill;
  - `used_in`: the graded work that needs it;
  - `source`.
- **`objectives`**: every stated learning objective. For each:
  - `text`: the objective word for word, with no numbers or ids inside it;
  - `status`: `graded_work_found` when some graded work demands it, otherwise `not_found`. A topic listed in the schedule is not graded work;
  - `graded_work`: the titles of that graded work, empty when not found.
- **`conflicts`**: places where sources disagree (a weight that differs between the syllabus and Canvas, a deliverable in one file and not another). Write each as one sentence naming both sources by chunk id. These go to the audit notes; the interview never asks about them.
- **`unreadable`**: each file or section you could not read (scanned image, broken table, empty extraction). For each, `file` is the file name as listed and `note` says briefly what could not be read.

## Rules

- Copy, do not paraphrase, titles, weights, criteria and objectives.
- The catalog is context, not material: do not take objectives or weights from it unless the syllabus repeats them.
- Silence is not a finding. If the materials do not say something, leave it out; the interview will ask.
