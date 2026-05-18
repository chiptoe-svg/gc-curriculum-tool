export interface CourseFields {
  code: string;
  title: string;
  level: number;
  track: string;
  description: string;
  prerequisites: string;
  learningObjectives: string[];
  majorProjects: string[];
  skillsRequired: string[];
}

export function formatCourseSyllabus(c: CourseFields): string {
  const parts: string[] = [];
  parts.push(`# ${c.code} — ${c.title}`);
  parts.push(`**Level:** ${c.level}`);
  parts.push(`**Track:** ${c.track}`);
  if (c.prerequisites.trim()) parts.push(`**Prerequisites:** ${c.prerequisites.trim()}`);
  if (c.description.trim()) parts.push(`\n## Description\n${c.description.trim()}`);
  if (c.learningObjectives.length > 0) {
    parts.push(`\n## Learning Objectives\n${c.learningObjectives.map(s => `- ${s}`).join('\n')}`);
  }
  if (c.majorProjects.length > 0) {
    parts.push(`\n## Major Projects\n${c.majorProjects.map(s => `- ${s}`).join('\n')}`);
  }
  if (c.skillsRequired.length > 0) {
    parts.push(`\n## Skills / Competencies Required\n${c.skillsRequired.map(s => `- ${s}`).join('\n')}`);
  }
  return parts.join('\n');
}
