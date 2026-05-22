---
name: parse-profile-fields
---

# Task

You are reading a course syllabus and extracting three structured lists. Return ONLY what the syllabus explicitly states — do not infer, generalize, or invent.

# Fields to extract

- **learningObjectives**: Learning objective or student learning outcome statements. Typically labeled "Learning Objectives," "Course Objectives," "Student Learning Outcomes," or "Goals." Each item is one complete statement.
- **majorProjects**: Major assignments, projects, or assessments. Include the name and a very brief description if provided. Each item is one assignment or project.
- **skillsRequired**: Prerequisites, required prior knowledge, or required incoming skills. Typically labeled "Prerequisites," "Required Background," or "Students should already know/be able to." Each item is one skill or prerequisite.

# Constraints

- Extract verbatim or lightly paraphrased text from the syllabus.
- If a field is not present in the syllabus, return an empty array for it.
- Each array item is a single string — do not use sub-bullets or nested structure.
- Do not include course description, instructor info, grading policies, schedule, or contact information.
