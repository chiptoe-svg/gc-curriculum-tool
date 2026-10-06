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
import { loadPrereqMap, prereqEdgesOf, dependentEdgesOf, prereqSourceOf, prereqSourceLabel, type PrereqEdgeKind } from '@/lib/curriculum/prereq-map';
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import { capLines } from '@/lib/capture/cap-lines';

export const BRIEF_HEADING = "Neighboring courses — context for better questions, never evidence for this course's scores.";
export const BRIEF_MAX_CHARS = 6000;

// profile: null = not yet captured; otherwise the same CaptureProfile the
// prerequisite-profiles block renders from (set from the same latestCapture
// call as captureLabel, so the two never disagree about which capture this is).
// kind: 'concurrent_ok' = "Preq or concurrent enrollment" (before or alongside).
// source: where the link comes from ('Clemson catalog 2026–27' | 'course sheet').
// alternatives: the other courses in the same any-of group ([] = required alone).
export interface BriefPrereq {
  code: string;
  title: string;
  captureLabel: string | null;
  profile: CaptureProfile | null;
  kind: PrereqEdgeKind;
  source: string;
  alternatives: string[];
}
export interface BriefDependent {
  code: string;
  title: string;
  kind: PrereqEdgeKind;
  source: string;
  expectations: { source: string; items: string[] } | null; // null = not yet captured
  projects: { source: string; items: string[] };
}
// prereqSource: where THIS course's prerequisite list comes from.
export interface CourseContextBrief { courseCode: string; prereqSource: string; prerequisites: BriefPrereq[]; dependents: BriefDependent[] }

type Captured = { profile: CaptureProfile; label: string } | null;

async function latestCapture(code: string): Promise<Captured> {
  const snap = await getLatestSnapshotByCourse(code);
  if (snap) return { profile: snap.profile, label: `${code} capture snapshot ${snap.createdAt.toISOString().slice(0, 10)}` };
  const draft = await getCaptureProfileByCourse(code);
  if (draft) return { profile: draft.profile, label: `${code} capture draft (${draft.reviewerStatus})` };
  return null;
}

export async function buildCourseContextBrief(courseCode: string): Promise<CourseContextBrief> {
  const map = await loadPrereqMap();
  const ownEdges = prereqEdgesOf(map, courseCode);
  const prerequisites = await Promise.all(ownEdges.map(async (edge): Promise<BriefPrereq> => {
    const code = edge.prereq;
    const [c, cap] = await Promise.all([getCourseByCode(code), latestCapture(code)]);
    const alternatives = edge.anyOfGroup === null ? [] : ownEdges
      .filter(e => e.anyOfGroup === edge.anyOfGroup && e.prereq !== code)
      .map(e => e.prereq);
    return {
      code, title: c?.title ?? '', captureLabel: cap?.label ?? null, profile: cap?.profile ?? null,
      kind: edge.kind, source: prereqSourceLabel(map, edge.source), alternatives,
    };
  }));
  const dependents = await Promise.all(dependentEdgesOf(map, courseCode).map(async (edge): Promise<BriefDependent> => {
    const code = edge.focal;
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
    return { code, title: c?.title ?? '', kind: edge.kind, source: prereqSourceLabel(map, edge.source), expectations, projects };
  }));
  return { courseCode, prereqSource: prereqSourceLabel(map, prereqSourceOf(map, courseCode)), prerequisites, dependents };
}

const BEFORE_OR_ALONGSIDE = 'before or alongside (prerequisite or concurrent enrollment)';

function prereqRelation(p: BriefPrereq): string {
  const rel = p.kind === 'concurrent_ok' ? BEFORE_OR_ALONGSIDE : 'prerequisite';
  const alt = p.alternatives.length > 0 ? `, or alternatively ${p.alternatives.join(' / ')}` : '';
  return `[${rel}${alt}; ${p.source}]`;
}

function dependentRelation(d: BriefDependent, courseCode: string): string {
  const rel = d.kind === 'concurrent_ok' ? `takes ${courseCode} ${BEFORE_OR_ALONGSIDE}` : `takes ${courseCode} as a prerequisite`;
  return `[${rel}; ${d.source}]`;
}

export function renderCourseContextBrief(brief: CourseContextBrief, maxChars: number = BRIEF_MAX_CHARS): string {
  const head = `## ${BRIEF_HEADING}`;
  if (brief.prerequisites.length === 0 && brief.dependents.length === 0) {
    const noun = brief.prereqSource === 'course sheet' ? 'prerequisites' : 'course prerequisites';
    return `${head}\nNo linked courses: the ${brief.prereqSource} lists no ${noun} for ${brief.courseCode}, and no course lists it as a prerequisite.`;
  }
  // Each entry carries the course `code` when it is that course's OWN line
  // (the prereq's single line, or a dependent's `####` header) — the line
  // whose omission means the course itself was dropped from the brief, not
  // just one of its sub-items.
  const lines: { text: string; code?: string }[] = [{ text: `### Students arrive from (${brief.prereqSource})` }];
  if (brief.prerequisites.length === 0) lines.push({ text: `- (no course prerequisites listed in the ${brief.prereqSource})` });
  for (const p of brief.prerequisites) {
    lines.push({
      text: `- ${p.code} — ${p.title} ${prereqRelation(p)}: ${p.captureLabel ? `captured (${p.captureLabel})` : 'not yet captured'}`,
      code: p.code,
    });
  }
  lines.push({ text: '### Courses that build on this one' });
  if (brief.dependents.length === 0) lines.push({ text: '- (no course lists it as a prerequisite)' });
  for (const d of brief.dependents) {
    lines.push({ text: `#### ${d.code} — ${d.title} ${dependentRelation(d, brief.courseCode)}`, code: d.code });
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
