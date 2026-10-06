/**
 * Interview-only brief of directly linked courses: where students arrive from,
 * and what the courses that build on this one expect + their major projects.
 * Deterministic (no AI). Context for better questions — NEVER evidence for
 * this course's scores; never passed to scoring/stress-test.
 * Spec: docs/superpowers/specs/2026-10-06-interview-course-context-brief-design.md §2.
 */
import { getCourseByCode } from '@/lib/db/courses-queries';
import { getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import { getCaptureProfileByCourse } from '@/lib/db/course-capture-profiles-queries';
import { loadSheetPrereqPairs, prereqsOf, dependentsOf } from '@/lib/curriculum/sheet-prereq-graph';
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import { capLines } from '@/lib/capture/cap-lines';

export const BRIEF_HEADING = "Neighboring courses — context for better questions, never evidence for this course's scores.";
export const BRIEF_MAX_CHARS = 6000;

// profile: null = not yet captured; otherwise the same CaptureProfile the
// prerequisite-profiles block renders from (set from the same latestCapture
// call as captureLabel, so the two never disagree about which capture this is).
export interface BriefPrereq { code: string; title: string; captureLabel: string | null; profile: CaptureProfile | null }
export interface BriefDependent {
  code: string;
  title: string;
  expectations: { source: string; items: string[] } | null; // null = not yet captured
  projects: { source: string; items: string[] };
}
export interface CourseContextBrief { courseCode: string; prerequisites: BriefPrereq[]; dependents: BriefDependent[] }

type Captured = { profile: CaptureProfile; label: string } | null;

async function latestCapture(code: string): Promise<Captured> {
  const snap = await getLatestSnapshotByCourse(code);
  if (snap) return { profile: snap.profile, label: `${code} capture snapshot ${snap.createdAt.toISOString().slice(0, 10)}` };
  const draft = await getCaptureProfileByCourse(code);
  if (draft) return { profile: draft.profile, label: `${code} capture draft (${draft.reviewerStatus})` };
  return null;
}

export async function buildCourseContextBrief(courseCode: string): Promise<CourseContextBrief> {
  const pairs = await loadSheetPrereqPairs();
  const prerequisites = await Promise.all(prereqsOf(pairs, courseCode).map(async (code): Promise<BriefPrereq> => {
    const [c, cap] = await Promise.all([getCourseByCode(code), latestCapture(code)]);
    return { code, title: c?.title ?? '', captureLabel: cap?.label ?? null, profile: cap?.profile ?? null };
  }));
  const dependents = await Promise.all(dependentsOf(pairs, courseCode).map(async (code): Promise<BriefDependent> => {
    const [c, cap] = await Promise.all([getCourseByCode(code), latestCapture(code)]);
    const expectations = cap
      ? {
          source: cap.label,
          items: (cap.profile.incoming_expectations ?? []).map(e =>
            `${e.statement} (expects K${e.expected_depth.k ?? '–'} U${e.expected_depth.u ?? '–'} D${e.expected_depth.d})`),
        }
      : null;
    const capProjects = cap?.profile.major_projects ?? [];
    const projects = capProjects.length > 0
      ? { source: cap!.label, items: capProjects.map(p => `${p.title} — ${p.description}`) }
      : { source: 'course sheet', items: ((c?.majorProjects ?? []) as string[]) };
    return { code, title: c?.title ?? '', expectations, projects };
  }));
  return { courseCode, prerequisites, dependents };
}

export function renderCourseContextBrief(brief: CourseContextBrief, maxChars: number = BRIEF_MAX_CHARS): string {
  const head = `## ${BRIEF_HEADING}`;
  if (brief.prerequisites.length === 0 && brief.dependents.length === 0) {
    return `${head}\nNo linked courses: the course sheet lists no prerequisites for ${brief.courseCode}, and no course lists it as a prerequisite.`;
  }
  // Each entry carries the course `code` when it is that course's OWN line
  // (the prereq's single line, or a dependent's `####` header) — the line
  // whose omission means the course itself was dropped from the brief, not
  // just one of its sub-items.
  const lines: { text: string; code?: string }[] = [{ text: '### Students arrive from' }];
  if (brief.prerequisites.length === 0) lines.push({ text: '- (none on the course sheet)' });
  for (const p of brief.prerequisites) {
    lines.push({
      text: `- ${p.code} — ${p.title}: ${p.captureLabel ? `captured (${p.captureLabel})` : 'not yet captured'}`,
      code: p.code,
    });
  }
  lines.push({ text: '### Courses that build on this one' });
  if (brief.dependents.length === 0) lines.push({ text: '- (none on the course sheet)' });
  for (const d of brief.dependents) {
    lines.push({ text: `#### ${d.code} — ${d.title}`, code: d.code });
    if (d.expectations) {
      lines.push({ text: `- Expects students to arrive with (${d.expectations.source}):` });
      for (const it of d.expectations.items) lines.push({ text: `  - ${it}` });
    } else {
      lines.push({ text: '- Expects students to arrive with: not yet captured' });
    }
    if (d.projects.items.length > 0) {
      lines.push({ text: `- Major projects (${d.projects.source}):` });
      for (const it of d.projects.items) lines.push({ text: `  - ${it}` });
    } else {
      lines.push({ text: '- Major projects: none listed' });
    }
  }
  return capLines(head, lines, maxChars);
}
