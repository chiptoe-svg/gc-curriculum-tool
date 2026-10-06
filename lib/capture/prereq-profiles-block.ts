/**
 * Interview-only block: the captured profiles of a course's own prerequisites
 * — what students arrive with (competencies + K/U/D + source), and what each
 * prerequisite itself expects students to arrive with. Deterministic (no AI).
 * NEVER evidence for this course's scores; never passed to scoring/stress-test.
 * Sits alongside lib/capture/course-context-brief.ts in the interview's
 * at-rest context (lib/ai/agent/audit-agent.ts loadBriefBlock).
 */
import type { BriefPrereq } from '@/lib/capture/course-context-brief';
import { capLines, type CapLine } from '@/lib/capture/cap-lines';

export const PREREQ_PROFILES_HEADING = "Prerequisite courses' captured profiles — what students arrive with; never evidence for this course's scores.";
export const PREREQ_PROFILES_MAX_CHARS = 6000;

export function renderPrerequisiteProfiles(prereqs: BriefPrereq[], maxChars: number = PREREQ_PROFILES_MAX_CHARS): string {
  const head = `## ${PREREQ_PROFILES_HEADING}`;
  const captured = prereqs.filter((p): p is BriefPrereq & { profile: NonNullable<BriefPrereq['profile']> } => p.profile !== null);
  if (captured.length === 0) {
    return `${head}\nNo prerequisite course has a captured profile yet.`;
  }
  // Each entry carries the course `code` only on its own `###` heading line
  // — the line whose omission means the whole prerequisite was dropped from
  // the block, not just one of its competency/expectation sub-items.
  const lines: CapLine[] = [];
  for (const p of captured) {
    lines.push({ text: `### ${p.code} — ${p.title} (${p.captureLabel})`, code: p.code });
    lines.push({ text: 'Competencies:' });
    for (const c of p.profile.competencies) {
      lines.push({ text: `- [${c.type}] ${c.statement} (K${c.k_depth ?? '–'} U${c.u_depth ?? '–'} D${c.d_depth}; source: ${c.source ?? 'not recorded'})` });
    }
    if (p.profile.incoming_expectations.length > 0) {
      lines.push({ text: `What ${p.code} itself expects students to arrive with:` });
      for (const e of p.profile.incoming_expectations) {
        lines.push({ text: `- ${e.statement} (expects K${e.expected_depth.k ?? '–'} U${e.expected_depth.u ?? '–'} D${e.expected_depth.d})` });
      }
    }
  }
  return capLines(head, lines, maxChars);
}
