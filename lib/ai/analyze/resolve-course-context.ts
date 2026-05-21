import { getCourseProfile } from '@/lib/db/course-profile-queries';

export async function resolveCourseContext(
  courseLabel: string,
  fallbackSyllabusText: string
): Promise<string> {
  const profile = await getCourseProfile(courseLabel);
  if (!profile) return fallbackSyllabusText;

  const lines: string[] = [
    `[Course profile: ${profile.courseCode}]`,
    `Summary: ${profile.summary}`,
  ];

  const objectives = profile.learningObjectives as string[];
  if (objectives.length > 0) {
    lines.push('', 'Learning objectives:');
    for (const o of objectives) lines.push(`- ${o}`);
  }

  const skills = profile.skills as string[];
  if (skills.length > 0) {
    lines.push('', 'Skills:');
    for (const s of skills) lines.push(`- ${s}`);
  }

  const competencies = profile.competencies as Array<{
    name: string;
    description: string;
    level: string;
    evidence: Array<{ fileName: string; quote: string }>;
  }>;
  if (competencies.length > 0) {
    lines.push('', 'Competencies:');
    for (const c of competencies) {
      lines.push(`- ${c.name} (${c.level}): ${c.description}`);
    }
  }

  return lines.join('\n');
}
