/**
 * Course wiki page layout helpers (owner 2026-11-08; review of the course
 * pages found them ordered upside down and repeating facts). The page
 * template splits the generated markdown by its `## ` sections and places each
 * where a reader needs it: about → objectives vs. evidence → what students
 * learn → projects → program fit → instructor guide → sources and limits.
 * Pure; no I/O.
 */
import type { GuideMeasure } from '@/lib/objective-guide/schema';

export interface CourseBody {
  /** Text before the first `## ` heading (the overview narrative). */
  intro: string;
  /** Section bodies keyed by their exact `## ` heading text, in page order. */
  sections: Record<string, string>;
}

export function splitCourseBody(md: string): CourseBody {
  const sections: Record<string, string> = {};
  const parts = md.split(/^## +(.+)$/m);
  const intro = (parts[0] ?? '').trim();
  for (let i = 1; i < parts.length; i += 2) {
    const heading = parts[i]!.trim();
    sections[heading] = tidyLeaders((parts[i + 1] ?? '').trim());
  }
  return { intro: tidyLeaders(intro), sections };
}

/** The generator sometimes writes a doubled leader: "- — **Label:** …". */
function tidyLeaders(md: string): string {
  return md.replace(/^(\s*)- — /gm, '$1- ');
}

/** Syllabus section without the objectives list (shown once, above) and the
 *  "Signature projects: see above" pointer; with `dropArrivalSkills`, also
 *  without the arrival-skills list (shown in About). Description and links remain. */
export function cleanSyllabus(md: string, opts: { dropArrivalSkills?: boolean } = {}): string {
  const dropLabel = opts.dropArrivalSkills
    ? /^\*\*(Learning objectives|Skills students should arrive with):?\*\*/i
    : /^\*\*Learning objectives:?\*\*/i;
  const out: string[] = [];
  let dropping = false;
  for (const line of md.split('\n')) {
    if (dropLabel.test(line.trim())) { dropping = true; continue; }
    if (dropping) {
      if (line.trim() === '' || /^\s*[-*]\s/.test(line)) continue;
      dropping = false;
    }
    if (/^\*\*Signature projects:?\*\*.*see\b/i.test(line.trim())) continue;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Signature projects without the pipeline note that the list came from the
 *  course sheet (internal state, not content). */
export function cleanProjects(md: string): string {
  return md.split('\n')
    .filter(l => !/not yet captured in a profile audit/i.test(l))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** "How the projects connect" for the public page: each project with the
 *  competencies it builds. Drops the O*NET matches (tool working data), lines
 *  not yet linked to a competency, the explanatory footnote, and any project
 *  left with no competency. */
export function cleanProjectLinks(md: string): string {
  const blocks = md.split(/^(?=### )/m);
  const kept: string[] = [];
  for (const block of blocks) {
    const lines = block.split('\n')
      .filter(l => !/not yet linked to a catalog competency/.test(l))
      .filter(l => !/coverage scorer's match/.test(l))
      .map(l => l.replace(/\s+—\s+closest O\*NET:.*$/, ''));
    const hasLink = lines.some(l => /\[\[[^\]]+\]\]|\]\(\/wiki\//.test(l));
    if (!hasLink) continue;
    // A parent bullet ("- Agency") whose children were all removed stays harmless;
    // the linked children carry the content.
    kept.push(lines.join('\n').replace(/\n{3,}/g, '\n\n').trim());
  }
  return kept.join('\n\n');
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };
export function decodeEntities(s: string): string {
  return s.replace(/&(amp|quot|#39|apos|lt|gt|nbsp);/g, m => ENTITIES[m] ?? m);
}

export function guideSummary(measures: GuideMeasure[]): string {
  const n = measures.length;
  const count = (m: GuideMeasure) => measures.filter(x => x === m).length;
  const parts = [
    [count('clear'), 'clearly measured'],
    [count('partial'), 'partly measured'],
    [count('none'), 'without a graded measure yet'],
  ].filter(([c]) => (c as number) > 0).map(([c, label]) => `${c} ${label}`);
  return `${n} objective${n === 1 ? '' : 's'}: ${parts.join(', ')}.`;
}

/** "4000-level course" from the course number; no 3-Act label (a proposal,
 *  not department policy — owner 2026-11-08). */
export function courseLevelLabel(code: string): string {
  const m = /(\d)\d{3}/.exec(code);
  return m ? `${m[1]}000-level course` : 'Course';
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function captureFact(capturedOn: string | null, materialsSupported: boolean): string {
  if (!capturedOn) return 'Not yet captured';
  return `Captured ${fmtDate(capturedOn)} from the instructor interview${materialsSupported ? ' and course materials' : ''}`;
}
