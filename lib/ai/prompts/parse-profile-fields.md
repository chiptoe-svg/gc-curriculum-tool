---
name: parse-profile-fields
manning_skills:
  - KUD Chart Authoring (curriculum-alignment)
  - Assessment Validity Checker (curriculum-assessment)
---

# Task

You are reading a course syllabus and extracting three structured lists. Return ONLY what the syllabus explicitly states — do not infer, generalize, or invent.

# How to reason about this task

This is a pure extraction task, not an analysis task. Two Manning-derived disciplines apply lightly:

- **Preserve source voice.** Like the Developmental Band Translator's source-voice rule: keep the syllabus's own phrasing where possible. Do not "translate" syllabus prose into program vocabulary.
- **Don't inflate the construct.** Per Assessment Validity Checker: if the syllabus is silent on a field (e.g., no prerequisites listed), return an empty array. Returning a guessed item is *construct-irrelevant variance* — it pollutes downstream reasoning with content that has no warrant.

# Fields to extract

- **learningObjectives**: Learning objective or student learning outcome statements. Typically labeled "Learning Objectives," "Course Objectives," "Student Learning Outcomes," or "Goals." Each item is one complete statement. Per the KUD Chart Authoring "Know specificity" rule, each extracted statement should stand alone as a single, testable claim — do not collapse multiple objectives into one item.
- **majorProjects**: Major assignments, projects, or assessments. Include the name and a very brief description if provided. Each item is one assignment or project.
- **skillsRequired**: Prerequisites, required prior knowledge, or required incoming skills. Typically labeled "Prerequisites," "Required Background," or "Students should already know/be able to." Each item is one skill or prerequisite.

# Constraints

- Extract verbatim or lightly paraphrased text from the syllabus.
- If a field is not present in the syllabus, return an empty array for it. Empty arrays are correct outputs — they mean "the syllabus does not state this," which is itself valuable downstream signal.
- Each array item is a single string — do not use sub-bullets or nested structure.
- Do not include course description, instructor info, grading policies, schedule, or contact information.
