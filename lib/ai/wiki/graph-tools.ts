/**
 * Typed-graph query tools for the curriculum agent (the MCP server + /ask).
 *
 * The wiki tools (read/list/search) serve NARRATIVE prose. These answer
 * STRUCTURAL / relationship questions the prose can't — "which courses build
 * toward Production Operations and at what depth", "the prerequisite chain into
 * GC 4400" — backed directly by the typed graph already in the DB
 * (snapshot_target_coverage, prerequisite_edges). Read-only.
 *
 * Pure cores (shapeCoverageForTarget / prereqNeighborhood) are separated from
 * the DB-fetching tool wrappers so the graph logic is unit-testable.
 */

import { z } from 'zod';
import type { ToolDefinition } from '@/lib/ai/tool-use-types';
import { getMatrixData, type MatrixData } from '@/lib/db/program-coverage-queries';
import { listEdgePairs } from '@/lib/db/prerequisite-edge-queries';

const normCode = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ');

// ── coverage_for_target ────────────────────────────────────────────────────

export interface TargetCoverage {
  target: string;
  subCompetencies: Array<{
    subCompetency: string;
    courses: Array<{
      course: string;
      title: string;
      k: number | null;
      u: number | null;
      d: number;
      confidence: 'high' | 'medium' | 'low';
      evidence: string | null;
    }>;
  }>;
}

/** Pure: shape the coverage matrix into per-sub-competency course coverage for a
 *  fuzzily-matched target. Returns null if no target matches. */
export function shapeCoverageForTarget(m: MatrixData, targetQuery: string): TargetCoverage | null {
  const q = targetQuery.trim().toLowerCase();
  const t =
    m.targets.find(x => x.name.toLowerCase() === q) ??
    m.targets.find(x => x.name.toLowerCase().includes(q));
  if (!t) return null;
  const courseBySnap = new Map(m.courses.map(c => [c.snapshotId, c]));
  const subs = m.subCompetencies.filter(s => s.careerTargetId === t.id);
  return {
    target: t.name,
    subCompetencies: subs.map(s => {
      const courses = m.cells
        .filter(c => c.subCompetencyId === s.id && c.careerTargetId === t.id)
        .map(c => {
          const course = courseBySnap.get(c.snapshotId);
          return {
            course: course?.courseCode ?? '?',
            title: course?.courseTitle ?? '?',
            k: c.kDepth,
            u: c.uDepth,
            d: c.dDepth,
            confidence: c.confidence,
            evidence: c.evidenceExcerpt,
          };
        })
        .filter(x => x.d > 0 || (x.k ?? 0) > 0 || (x.u ?? 0) > 0)
        .sort((a, b) => b.d - a.d);
      return { subCompetency: s.name, courses };
    }),
  };
}

// ── prereq_chain ───────────────────────────────────────────────────────────

export interface PrereqNeighborhood {
  course: string;
  directPrereqs: string[];
  allUpstreamPrereqs: string[];
  requiredBy: string[];
}

/** Pure: from (focal → prereq) edge pairs, compute a course's direct +
 *  transitive prerequisites and the courses that require it. */
export function prereqNeighborhood(
  pairs: ReadonlyArray<{ focal: string; prereq: string }>,
  courseCode: string,
): PrereqNeighborhood {
  const target = normCode(courseCode);
  const prereqsOf = (c: string) =>
    pairs.filter(p => normCode(p.focal) === c).map(p => normCode(p.prereq));
  const direct = [...new Set(prereqsOf(target))];
  const upstream = new Set<string>();
  const stack = [...direct];
  while (stack.length) {
    const c = stack.pop()!;
    if (upstream.has(c)) continue;
    upstream.add(c);
    for (const p of prereqsOf(c)) if (!upstream.has(p)) stack.push(p);
  }
  const requiredBy = [
    ...new Set(pairs.filter(p => normCode(p.prereq) === target).map(p => normCode(p.focal))),
  ];
  return { course: target, directPrereqs: direct, allUpstreamPrereqs: [...upstream], requiredBy };
}

// ── tools ──────────────────────────────────────────────────────────────────

export const coverageForTargetTool: ToolDefinition = {
  name: 'coverage_for_target',
  description:
    'For a career target (e.g. "Production Operations", "Account Management"), list which captured courses build toward it and at what Know/Understand/Do depth, broken down by sub-competency, each with a coverage confidence (high/medium/low) and an evidence excerpt. A typed-graph query over the coverage matrix — use for "how does the program prepare students for X?" questions instead of reading prose.',
  usagePolicy: 'Pass a career-target name (fuzzy-matched). Returns structured coverage, not narrative.',
  inputSchema: z.object({ target: z.string().min(1) }),
  async execute(args) {
    const { target } = args as { target: string };
    const m = await getMatrixData();
    const shaped = shapeCoverageForTarget(m, target);
    if (!shaped) {
      return { error: `no career target matching "${target}". Known targets: ${m.targets.map(t => t.name).join(', ')}` };
    }
    return shaped;
  },
};

export const prereqChainTool: ToolDefinition = {
  name: 'prereq_chain',
  description:
    'For a course code (e.g. "GC 4400"), return its prerequisite chain: the courses that must come before it (direct + transitive) and the courses that list it as a prerequisite. A typed-graph query over prerequisite_edges. Use for "what does X require / what builds on X?" questions.',
  usagePolicy: 'Pass a course code. Returns the prerequisite-graph neighborhood, not narrative.',
  inputSchema: z.object({ courseCode: z.string().min(1) }),
  async execute(args) {
    const { courseCode } = args as { courseCode: string };
    const pairs = await listEdgePairs();
    return prereqNeighborhood(pairs, courseCode);
  },
};

/** The typed-graph tool surface — added to the MCP server + /ask alongside the
 *  narrative wiki tools. */
export function buildCurriculumGraphTools(): ToolDefinition[] {
  return [coverageForTargetTool, prereqChainTool];
}
