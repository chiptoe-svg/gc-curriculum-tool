/**
 * Problem solving as a program-level evidence profile (spec 2026-10-19 §2.6).
 * It is never a 0–5 score per course: this builds and renders counts of the
 * conditions course capture records, plus where students reach adaptive depth
 * on technical competencies. Pure — the DB read lives in
 * lib/db/problem-solving-queries.ts.
 */
import type { Area7Block } from '@/lib/ai/capture/area7-types';
import type { WikiCommit } from '@/lib/wiki/git-ops';
import { problemSolvingBand } from '@/lib/program/problem-solving-band';
import additions from '@/docs/superpowers/specs/2026-10-19-catalog-additions.json';

export interface PsCourseInput { courseCode: string; courseTitle: string; level: number; area7: Area7Block | null }
export interface PsDepthInput { competencyId: string; competencyName: string; courseCode: string; dDepth: number }

type Band = 'none' | 'slight' | 'moderate' | 'significant' | 'no_data';
const CONDITIONS = [
  'generate_then_consolidate', 'open_ended_problems', 'revision_cycles',
  'structured_post_mortem', 'abstraction_bridging',
] as const;
type Condition = (typeof CONDITIONS)[number];

export interface ProblemSolvingProfile {
  bands: Record<Band, string[]>; // course codes
  conditionCounts: Record<Condition, { present: number; partial: number; absent: number; unassessed: number }>;
  d4ByCompetency: Array<{ competencyId: string; competencyName: string; courses: string[] }>;
  coursesWithData: number;
  /** Course metadata for link labels (code -> title). */
  titles?: Record<string, string>;
}

export function buildProblemSolvingProfile(courses: PsCourseInput[], depths: PsDepthInput[]): ProblemSolvingProfile {
  const bands: Record<Band, string[]> = { none: [], slight: [], moderate: [], significant: [], no_data: [] };
  const conditionCounts = Object.fromEntries(
    CONDITIONS.map(c => [c, { present: 0, partial: 0, absent: 0, unassessed: 0 }]),
  ) as ProblemSolvingProfile['conditionCounts'];
  const titles: Record<string, string> = {};
  let coursesWithData = 0;

  for (const c of courses) {
    titles[c.courseCode] = c.courseTitle;
    if (!c.area7) { bands.no_data.push(c.courseCode); continue; }
    coursesWithData++;
    bands[problemSolvingBand(c.area7).band].push(c.courseCode);
    for (const k of CONDITIONS) conditionCounts[k][c.area7[k] ?? 'unassessed']++;
  }

  const byComp = new Map<string, { competencyId: string; competencyName: string; courses: Set<string> }>();
  for (const d of depths) {
    if (d.dDepth < 4) continue;
    const e = byComp.get(d.competencyId) ?? { competencyId: d.competencyId, competencyName: d.competencyName, courses: new Set<string>() };
    e.courses.add(d.courseCode);
    byComp.set(d.competencyId, e);
  }
  const d4ByCompetency = [...byComp.values()]
    .map(e => ({ competencyId: e.competencyId, competencyName: e.competencyName, courses: [...e.courses].sort() }))
    .sort((a, b) => a.competencyName.localeCompare(b.competencyName));

  for (const b of Object.values(bands)) b.sort();
  return { bands, conditionCounts, d4ByCompetency, coursesWithData, titles };
}

// Same convention as courseCodeToSlug in lib/ai/wiki/update.ts (not imported:
// that module pulls in the DB and model clients, and this one stays pure).
const slugOf = (code: string) => code.toLowerCase().replace(/\s+/g, '-');
const link = (code: string) => `[[${slugOf(code)}]]`;
const links = (codes: string[]) => codes.map(link).join(', ');

const SCAFFOLDING_URL = 'https://gcworkflow.clemson.edu:8443/program/scaffolding';
/** Throws (never renders blank) if the problem-solving entry or its D descriptor / derivedFrom is missing. */
export function readProblemSolvingEntry(a: { newCompetencies: Array<{ id: string; doDescriptor?: unknown; derivedFrom?: unknown }> }): { doDescriptor: string; derivedFrom: string } {
  const ps = a.newCompetencies.find(c => c.id === 'problem-solving');
  if (!ps) throw new Error("catalog additions: 'problem-solving' entry is missing");
  const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
  if (!nonEmpty(ps.doDescriptor)) throw new Error("catalog additions: 'problem-solving' has no doDescriptor");
  if (!nonEmpty(ps.derivedFrom)) throw new Error("catalog additions: 'problem-solving' has no derivedFrom");
  return { doDescriptor: ps.doDescriptor, derivedFrom: ps.derivedFrom };
}
const PS = readProblemSolvingEntry(additions);
export const PS_DO_DESCRIPTOR: string = PS.doDescriptor;
export const PS_DERIVED_FROM: string = PS.derivedFrom;

const CONDITION_LABELS: Record<Condition, string> = {
  generate_then_consolidate: 'Generate, then consolidate',
  open_ended_problems: 'Open-ended problems',
  revision_cycles: 'Revision cycles',
  structured_post_mortem: 'Structured post-mortem',
  abstraction_bridging: 'Abstraction bridging',
};
const BAND_LABELS: Array<[Band, string]> = [
  ['significant', 'Significant evidence'], ['moderate', 'Moderate evidence'],
  ['slight', 'Slight evidence'], ['none', 'No evidence of the conditions'],
  ['no_data', 'No condition data yet'],
];

export function renderProblemSolvingPage(p: ProblemSolvingProfile, generatedAt: Date): string {
  const out: string[] = [];
  out.push(
    '---',
    'type: competency',
    'title: "Problem solving in the discipline"',
    'description: "A program-level evidence profile of the conditions under which students practice solving unfamiliar problems; not a per-course score."',
    `timestamp: ${generatedAt.toISOString()}`,
    'slug: problem-solving',
    'tags: [competency, foundational, program-level]',
    'resource: https://gcworkflow.clemson.edu:8443/wiki/competencies/problem-solving',
    '---',
    '',
    '# Problem solving in the discipline',
    '',
    '## Definition',
    '',
    PS_DO_DESCRIPTOR,
    '',
    PS_DERIVED_FROM,
    '',
    '## How the program builds it',
    '',
  );

  if (p.coursesWithData === 0) {
    out.push('Problem solving is program-level and not scored course by course. At present no captured course has condition data yet, so there is no profile to show.', '');
  } else {
    out.push(`${p.coursesWithData} captured course(s) carry condition data. Courses by how much evidence of the conditions they show:`, '');
    for (const [band, label] of BAND_LABELS) {
      const codes = p.bands[band];
      if (codes.length > 0) out.push(`- **${label}** (${codes.length}): ${links(codes)}`);
    }
    out.push('');
  }

  out.push('## Which conditions recur', '');
  if (p.coursesWithData === 0) {
    out.push('No captured course has condition data yet.', '');
  } else {
    out.push('| Condition | Present | Partial | Absent | Not assessed |', '| --- | --- | --- | --- | --- |');
    for (const k of CONDITIONS) {
      const c = p.conditionCounts[k];
      out.push(`| ${CONDITION_LABELS[k]} | ${c.present} | ${c.partial} | ${c.absent} | ${c.unassessed} |`);
    }
    out.push('');
  }

  out.push('## Where students reach adaptive depth', '');
  if (p.d4ByCompetency.length === 0) {
    out.push('No technical competency yet shows evidence of students adapting to new conditions (Do depth 4 or higher).', '');
  } else {
    out.push('Technical competencies where a course shows Do depth 4 or higher (adapts to new conditions):', '');
    for (const e of p.d4ByCompetency) out.push(`- [[${e.competencyId}|${e.competencyName}]]: ${links(e.courses)}`);
    out.push('');
  }

  out.push(
    '## How to read this',
    '',
    `This is an evidence profile, not a score. Problem solving is a program-level outcome and is not scored course by course: it emerges from repeated cycles of productive failure and structured reflection across the sequence, so a single number for one course would credit any assignment called a problem. Read the bands, conditions and depth lists together. For how the conditions are sequenced across the program, see the [scaffolding analysis](${SCAFFOLDING_URL}).`,
    '',
    `Generated ${generatedAt.toISOString().slice(0, 10)} from each program-visible course's latest capture snapshot.`,
    '',
  );
  return out.join('\n');
}

export interface PsPageInputs { courses: PsCourseInput[]; depths: PsDepthInput[] }

/** The wiki commit for the page (shared by the script and refresh-all). */
export function buildProblemSolvingCommit(inputs: PsPageInputs, now: Date = new Date()): WikiCommit {
  return {
    pages: [{
      path: 'competencies/problem-solving.md',
      content: renderProblemSolvingPage(buildProblemSolvingProfile(inputs.courses, inputs.depths), now),
    }],
    logEntry: 'Regenerated the problem-solving evidence-profile page',
    commitMessage: 'feat(problem-solving): regenerate program-level evidence profile',
  };
}

/** Build, render and commit the page. `write` is writeAndPush in production. */
export async function writeProblemSolvingPage(
  inputs: PsPageInputs,
  write: (commit: WikiCommit) => Promise<{ sha: string }>,
  now: Date = new Date(),
): Promise<{ sha: string; content: string }> {
  const commit = buildProblemSolvingCommit(inputs, now);
  const { sha } = await write(commit);
  return { sha, content: commit.pages[0]!.content };
}
