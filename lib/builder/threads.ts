// Required-skill status: for each course on the map, is each skill it needs on arrival met by a skill an
// earlier course develops? Pure. Threads stand apart from competencies: nothing here reads or changes a
// competency level (spec 2026-11-16-map-course-edits-and-required-skills-design.md, sections 2-3).
import { CUTOFFS, MODEL_IN_USE } from '@/lib/ai/match-judge';
import { effectiveCourse } from './edits';
import { heldAt, planEdges, versionOf, type PlacedCourse } from './compute';
import type { Candidate, Library, MatchDecision, PlanState, RequiredSkill } from './types';

export type ReqStatus = 'met' | 'met_draft' | 'partly' | 'not';
type Dim = 'k' | 'u' | 'd';
const DIMS: Dim[] = ['k', 'u', 'd'];

export interface ReqResult {
  required: RequiredSkill & { draft: boolean };
  status: ReqStatus;
  supplier: { course: string; statement: string; draft: boolean; source: 'decision' | 'judge'; label: 'fully' | 'partly' } | null;
  short: Dim[];
  faded: Dim[];
  /** True only when a draft supplier's restoration is what makes a clean supplier meet (Met*); the supplier itself is not a draft. */
  restoredByDraft: boolean;
  candidates: Candidate[];
}

/** Judgments fetched for draft texts, keyed like decisions: `${requiredRef}|${suppliedRef}`. */
export type DraftJudgments = Record<string, { pFully: number | null; pPartly: number | null }>;

const TIER: Record<ReqStatus, number> = { met: 3, met_draft: 2, partly: 1, not: 0 };

interface Path {
  status: ReqStatus; p: number; short: Dim[]; faded: Dim[]; restoredByDraft: boolean;
  supplier: NonNullable<ReqResult['supplier']>;
}

export function requiredByCourse(
  lib: Library, plan: PlanState, courses: PlacedCourse[], drafts: DraftJudgments,
  planDecisions: Record<string, MatchDecision> = {},
): Record<string, { results: ReqResult[]; counts: Record<ReqStatus, number> }> {
  const cut = CUTOFFS[MODEL_IN_USE];
  const fade = plan.fade;
  const onMap = courses.filter(c => !c.requirement);
  const edges = planEdges(lib, plan);
  const byCode = new Map(lib.courses.map(c => [c.code, c]));
  const proposed = new Map(plan.proposed.map(p => [p.id, p]));

  // Each placed course as the map reads it.
  const eff = new Map(onMap.map(c => {
    const lc = byCode.get(c.ref) ?? proposed.get(c.ref);
    if (!lc) return [c.ref, null] as const;
    const version = byCode.has(c.ref) ? versionOf(lc as never, plan) : null;
    return [c.ref, effectiveCourse(lc, version, plan.courseEdits?.[c.ref])] as const;
  }));

  const same = (a: PlacedCourse, id: string) => a.ref === id || a.code === id;
  /** null = not eligible; otherwise whether eligibility rests only on a coreq added on this map. */
  const eligibility = (req: PlacedCourse, sup: PlacedCourse): { viaPlanCoreq: boolean } | null => {
    if (sup.ref === req.ref) return null;
    if (sup.term < req.term) return { viaPlanCoreq: false };
    if (sup.term !== req.term) return null;
    const links = edges.filter(e => e.kind === 'concurrent_ok'
      && ((same(sup, e.from) && same(req, e.to)) || (same(req, e.from) && same(sup, e.to))));
    if (!links.length) return null;
    return { viaPlanCoreq: links.every(e => e.source === 'plan') };
  };

  const out: Record<string, { results: ReqResult[]; counts: Record<ReqStatus, number> }> = {};
  for (const course of onMap) {
    const me = eff.get(course.ref);
    if (!me || !me.required.length) continue;
    const suppliers = onMap.map(s => ({ s, el: eligibility(course, s), eff: eff.get(s.ref) }))
      .filter((x): x is { s: PlacedCourse; el: { viaPlanCoreq: boolean }; eff: NonNullable<typeof x.eff> } => !!x.el && !!x.eff);

    const results = me.required.map((req): ReqResult => {
      const need = DIMS.filter(d => (req.need[d] ?? 0) > 0);
      const libCands = new Map((lib.candidates[`${course.code}|${req.ref}`] ?? []).map(c => [`${c.suppliedCourse}|${c.suppliedRef}`, c]));
      type Pair = { cand: Candidate; sup: typeof suppliers[number]; skill: typeof suppliers[number]['eff']['developed'][number]; decision: MatchDecision | undefined };
      const pairs: Pair[] = [];
      for (const sup of suppliers) {
        for (const skill of sup.eff.developed) {
          const key = `${req.ref}|${skill.skillRef}`;
          const lc = libCands.get(`${sup.s.code}|${skill.skillRef}`);
          const dj = drafts[key];
          const decision = planDecisions[key] ?? lib.decisions[key];
          if (!lc && !dj && !decision) continue;
          const cand: Candidate = {
            requiredRef: req.ref, suppliedRef: skill.skillRef, suppliedCourse: sup.s.code, suppliedStatement: skill.statement,
            similarity: lc?.similarity ?? 0,
            pFully: dj ? dj.pFully : lc?.pFully ?? null, pPartly: dj ? dj.pPartly : lc?.pPartly ?? null,
          };
          pairs.push({ cand, sup, skill, decision });
        }
      }
      const labelOf = (p: Pair): { label: 'fully' | 'partly' | 'not'; source: 'decision' | 'judge'; p: number } => {
        if (p.decision) return { label: p.decision.label, source: 'decision', p: 1 };
        if ((p.cand.pFully ?? 0) >= cut.fully && p.cand.pFully != null) return { label: 'fully', source: 'judge', p: p.cand.pFully };
        if (p.cand.pPartly != null && p.cand.pPartly >= cut.partly) return { label: 'partly', source: 'judge', p: p.cand.pPartly };
        return { label: 'not', source: 'judge', p: 0 };
      };
      const labeled = pairs.map(p => ({ p, l: labelOf(p) })).filter(x => x.l.label !== 'not');

      const isDraft = (p: Pair) => p.skill.draft || p.sup.el.viaPlanCoreq || (p.decision?.draft ?? false);
      // Contributions of every eligible fully supplier, per dimension: what a later one restores. A draft
      // supplier's contribution may only restore a level toward Met*, never toward Met.
      const contrib = (d: Dim, cleanOnly: boolean) => labeled
        .filter(x => x.l.label === 'fully' && x.p.skill[d] != null && !(cleanOnly && isDraft(x.p)))
        .map(x => ({ term: x.p.sup.s.term, level: x.p.skill[d]! }));

      let best: Path | null = null;
      for (const { p, l } of labeled) {
        const supDraft = isDraft(p) || req.draft;
        const base = { course: p.sup.s.code, statement: p.skill.statement, draft: supDraft, source: l.source };
        let path: Path;
        if (l.label === 'partly') {
          path = { status: 'partly', p: l.p, short: [], faded: [], restoredByDraft: false, supplier: { ...base, label: 'partly' } };
        } else {
          const short = need.filter(d => (p.skill[d] ?? 0) < req.need[d]!);
          const fadedWith = (cleanOnly: boolean) =>
            need.filter(d => !short.includes(d) && heldAt(contrib(d, cleanOnly), course.term, fade) < req.need[d]!);
          const fadedAll = fadedWith(false);
          const faded = supDraft ? fadedAll : fadedWith(true);
          // Held only by counting a draft supplier's restoration: Met*, not Met.
          const draftRestored = !supDraft && faded.length > 0 && !fadedAll.length;
          const status: ReqStatus = short.length || (faded.length && !draftRestored) ? 'partly' : supDraft || draftRestored ? 'met_draft' : 'met';
          path = { status, p: l.p, short, faded: draftRestored ? [] : faded, restoredByDraft: draftRestored, supplier: { ...base, label: 'fully' } };
        }
        if (!best || TIER[path.status] > TIER[best.status] || (TIER[path.status] === TIER[best.status] && path.p > best.p)) best = path;
      }
      return {
        required: req,
        status: best?.status ?? 'not',
        supplier: best?.supplier ?? null,
        short: best?.short ?? [],
        faded: best?.faded ?? [],
        restoredByDraft: best?.restoredByDraft ?? false,
        candidates: pairs.map(x => x.cand).sort((a, b) => (b.pFully ?? 0) - (a.pFully ?? 0)),
      };
    });
    const counts: Record<ReqStatus, number> = { met: 0, met_draft: 0, partly: 0, not: 0 };
    for (const r of results) counts[r.status]++;
    out[course.ref] = { results, counts };
  }
  return out;
}
