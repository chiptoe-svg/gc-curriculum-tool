// Statuses on a course cluster map (spec 2026-11-17-course-cluster-map-design.md, "Matching rule"): skills only.
// Each required skill, course objective and cluster objective is checked against a pool of developed skills: a single
// supplier first (pair judge or a faculty decision), then a set test, then the best partial pair. Nothing here reads
// competencies, KUD levels, a required skill's `need`, acts, terms or fade. Pure.
import { CUTOFFS, MODEL_IN_USE } from '@/lib/ai/match-judge';
import { SET_CUTOFFS, type SetVerdict } from '@/lib/ai/set-judge';
import { textHash } from '@/lib/catalog/bundles';
import { normalizeStatement } from '@/lib/catalog/project-trail';
import { versionOf } from '../compute';
import { effectiveCourse, type EffectiveCourse } from '../edits';
import type { DraftJudgments } from '../threads';
import type { Candidate, Library, LibraryCourse, MatchDecision, ProposedCourse } from '../types';
import { clusterEdges, upstreamOf } from './graph';
import type { ClusterOverride, ClusterState } from './state';

export type { SetVerdict };
export type ClusterStatus = 'met' | 'met_set' | 'parts_met' | 'partly' | 'not' | 'pending';
/** Set-test answers keyed by targetKey (`req:…`, `obj:…`, `cobj:…`; see ClusterOverride). */
export type SetVerdicts = Record<string, SetVerdict>;
export interface StatusResult {
  targetKey: string; text: string; status: ClusterStatus;
  /** `course`: the supplying course's ref on the cluster; `ref`: the supplied skill's ref. */
  suppliers: Array<{ course: string; statement: string; ref: string }>;
  /** Where a status rests on something made up or edited, in words ("GC 4xxx drafted from syllabus"). */
  proposed: string[]; reason: string | null; override: ClusterOverride | null; staleOverride: boolean; candidates: Candidate[];
}

const hash = (s: string) => textHash(normalizeStatement(s));

/** The capture a catalog course is read from on the cluster. One place, so the cluster's own version picker can swap in. */
function versionFor(lc: LibraryCourse, state: ClusterState) {
  return versionOf(lc, state);
}

interface PoolSkill { course: string; code: string; skillRef: string; statement: string; draft: boolean }
interface Target {
  key: string; text: string; judgeRef: string; pool: PoolSkill[]; emptyReason: string;
  /** Catalog shortlist for a required skill, by `${suppliedCourse}|${suppliedRef}`. */
  libCands: Map<string, Candidate> | null;
  /** Pair decisions count for required skills only. */
  decisions: boolean;
  /** Phrase for the target itself when it is a draft or sits on a proposed course. */
  targetPhrase: string | null;
  /** Keys the target was known by before an edit changed its wording: an override there is shown stale. */
  formerKeys: string[];
}

export function clusterStatuses(
  lib: Library, state: ClusterState, judgments: DraftJudgments, sets: SetVerdicts, decisions: Record<string, MatchDecision>,
): { required: Record<string, StatusResult[]>; objectives: Record<string, StatusResult[]>; cluster: StatusResult[] } {
  const cut = CUTOFFS[MODEL_IN_USE];
  const byCode = new Map(lib.courses.map(c => [c.code, c]));
  const proposedById = new Map(state.proposed.map(p => [p.id, p]));
  const onCards = new Set(state.cards.map(c => c.ref));

  const courses = new Map<string, { code: string; proposed: ProposedCourse | null; eff: EffectiveCourse }>();
  for (const { ref } of state.cards) {
    const lc = byCode.get(ref);
    const p = lc ? null : proposedById.get(ref) ?? null;
    if (!lc && !p) continue;
    const eff = effectiveCourse((lc ?? p)!, lc ? versionFor(lc, state) : null, state.courseEdits?.[ref]);
    courses.set(ref, { code: lc ? lc.code : p!.code, proposed: p, eff });
  }

  /** How a draft item on a course is named: drafted from syllabus, a new course, or an edit. */
  const phraseFor = (ref: string): string => {
    const c = courses.get(ref)!;
    const e = state.courseEdits?.[ref];
    const fromSyllabus = !!e && [...e.objectives, ...e.required, ...e.developed].some(x => x.origin === 'syllabus');
    if (c.proposed && fromSyllabus) return `${c.code} drafted from syllabus`;
    if (c.proposed?.source === 'new') return `new course ${c.code}`;
    return `edited skill in ${c.code}`;
  };
  const developedOf = (ref: string): PoolSkill[] => {
    const c = courses.get(ref);
    return c ? c.eff.developed.map(s => ({ course: ref, code: c.code, skillRef: s.skillRef, statement: s.statement, draft: s.draft })) : [];
  };

  const evaluate = (t: Target): StatusResult => {
    /** `known`: some reading exists (judgment, shortlist entry or decision); `judged`: it has a verdict. */
    type Pair = { skill: PoolSkill; cand: Candidate; decision: MatchDecision | undefined; known: boolean; judged: boolean };
    const pairs: Pair[] = t.pool.map(skill => {
      const key = `${t.judgeRef}|${skill.skillRef}`;
      const dj = judgments[key];
      const lc = t.libCands?.get(`${skill.code}|${skill.skillRef}`);
      const decision = t.decisions ? decisions[key] ?? lib.decisions[key] : undefined;
      const cand: Candidate = {
        requiredRef: t.judgeRef, suppliedRef: skill.skillRef, suppliedCourse: skill.code, suppliedStatement: skill.statement,
        similarity: lc?.similarity ?? 0, pFully: dj ? dj.pFully : lc?.pFully ?? null, pPartly: dj ? dj.pPartly : lc?.pPartly ?? null,
      };
      return { skill, cand, decision, known: !!dj || !!lc || !!decision, judged: !!dj || lc?.pFully != null || !!decision };
    });
    const labelOf = (p: Pair): 'fully' | 'partly' | 'not' => {
      if (p.decision) return p.decision.label;
      if (p.cand.pFully != null && p.cand.pFully >= cut.fully) return 'fully';
      if (p.cand.pPartly != null && p.cand.pPartly >= cut.partly) return 'partly';
      return 'not';
    };
    // Faculty decisions first, then the judge's probability.
    const best = (label: 'fully' | 'partly') => pairs.filter(p => labelOf(p) === label)
      .sort((a, b) => Number(!!b.decision) - Number(!!a.decision)
        || ((label === 'fully' ? b.cand.pFully : b.cand.pPartly) ?? 0) - ((label === 'fully' ? a.cand.pFully : a.cand.pPartly) ?? 0));

    let status: ClusterStatus;
    let used: PoolSkill[] = [];
    let reason: string | null = null;
    const fully = best('fully'), partly = best('partly');
    if (!t.pool.length) {
      status = 'not';
      reason = t.emptyReason;
    } else if (!pairs.some(p => p.judged)) {
      status = 'pending';
    } else if (fully.length) {
      status = 'met';
      used = [fully[0]!.skill];
    } else if (partly.length) {
      const v = sets[t.key];
      const members = v?.kept.map(ref => t.pool.find(s => s.skillRef === ref));
      if (!v || !members || members.some(m => !m)) {
        // No answer yet, or it named a skill no longer in the pool (its course left the cluster): ask again.
        status = 'pending';
      } else if (v.kept.length >= 2 && (v.pAny ?? -1) >= SET_CUTOFFS.any && (v.pTogether ?? -1) >= SET_CUTOFFS.together) {
        status = (v.pCombining ?? -1) >= SET_CUTOFFS.combining ? 'met_set' : 'parts_met';
        used = members as PoolSkill[];
      } else {
        status = 'partly';
        used = [partly[0]!.skill];
      }
    } else {
      status = 'not';
    }

    const proposed = [...new Set([
      ...used.filter(s => s.draft).map(s => phraseFor(s.course)),
      ...(t.targetPhrase ? [t.targetPhrase] : []),
    ])];

    const textHashNow = hash(t.text);
    const own = state.overrides.find(o => o.targetKey === t.key);
    const former = own ? undefined : state.overrides.find(o => t.formerKeys.includes(o.targetKey));
    const override = own ?? former ?? null;
    const staleOverride = !!override && (!!former || override.textHash !== textHashNow);
    if (override && !staleOverride) status = override.label;

    return {
      targetKey: t.key, text: t.text, status, reason, override, staleOverride, proposed,
      suppliers: used.map(s => ({ course: s.course, statement: s.statement, ref: s.skillRef })),
      candidates: pairs.filter(p => p.known).map(p => p.cand).sort((a, b) => (b.pFully ?? 0) - (a.pFully ?? 0)),
    };
  };

  const edges = clusterEdges(lib, state);
  const required: Record<string, StatusResult[]> = {};
  const objectives: Record<string, StatusResult[]> = {};
  for (const [ref, c] of courses) {
    const edits = state.courseEdits?.[ref];
    const upstream = [...upstreamOf(edges, ref)].filter(r => onCards.has(r));
    const upstreamPool = upstream.flatMap(developedOf);
    required[ref] = c.eff.required.map(req => evaluate({
      key: `req:${ref}|${req.ref}`, text: req.statement, judgeRef: req.ref, pool: upstreamPool,
      emptyReason: upstream.length ? 'no upstream course has developed skills yet' : 'no upstream courses',
      libCands: new Map((lib.candidates[`${c.code}|${req.ref}`] ?? []).map(x => [`${x.suppliedCourse}|${x.suppliedRef}`, x])),
      decisions: true,
      targetPhrase: req.draft || c.proposed ? phraseFor(ref) : null,
      formerKeys: (edits?.required ?? []).filter(e => e.action === 'edit' && e.target && e.statement && hash(e.statement) === req.ref)
        .map(e => `req:${ref}|${e.target}`),
    }));
    const ownPool = developedOf(ref);
    objectives[ref] = c.eff.objectives.map(o => evaluate({
      key: `obj:${ref}|${hash(o.text)}`, text: o.text, judgeRef: hash(o.text), pool: ownPool,
      emptyReason: 'this course has no developed skills yet', libCands: null, decisions: false,
      targetPhrase: o.draft || c.proposed ? phraseFor(ref) : null,
      formerKeys: (edits?.objectives ?? []).filter(e => e.action === 'edit' && e.target && e.text === o.text)
        .map(e => `obj:${ref}|${hash(e.target!)}`),
    }));
  }
  const allPool = [...courses.keys()].flatMap(developedOf);
  const cluster = state.objectives.map(o => evaluate({
    key: `cobj:${o.id}`, text: o.text, judgeRef: hash(o.text), pool: allPool,
    emptyReason: 'no course on this cluster has developed skills yet', libCands: null, decisions: false,
    targetPhrase: null, formerKeys: [],
  }));
  return { required, objectives, cluster };
}

const WORD: Record<Exclude<ClusterStatus, 'met_set'>, string> = {
  met: 'Met', parts_met: 'Parts met, combining not shown', partly: 'Partly met', not: 'Not met', pending: 'Matching…',
};

/** The status in words. `codeOf` turns a course ref on the cluster into its course code. */
export function statusLabel(r: StatusResult, codeOf: (ref: string) => string): string {
  if (r.proposed.length) {
    const word = r.status === 'met_set' ? 'Met by a set' : WORD[r.status];
    return `${word}: proposed (${r.proposed.join('; ')})`;
  }
  if (r.status === 'met_set') return `Met by ${[...new Set(r.suppliers.map(s => codeOf(s.course)))].join(' + ')} (used together)`;
  return WORD[r.status];
}
