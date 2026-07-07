import type { Scenario, PredictedDelta, RippleLine } from './scenario';

export interface DeltaChange {
  competency: string;
  aTo: PredictedDelta['to'] | null;
  bTo: PredictedDelta['to'] | null;
}
export interface ScenarioComparison {
  deltaChanges: DeltaChange[];      // competencies whose predicted `to` differs (or exists in only one)
  rippleOnlyInA: RippleLine[];
  rippleOnlyInB: RippleLine[];
}

const rippleKey = (r: RippleLine) => `${r.kind}|${r.courseCode ?? ''}|${r.subCompetencyId ?? ''}|${r.after}`;
const sameTo = (a: PredictedDelta['to'], b: PredictedDelta['to']) => a.k === b.k && a.u === b.u && a.d === b.d;

export function compareScenarios(a: Scenario, b: Scenario): ScenarioComparison {
  const aByComp = new Map(a.predictedDeltas.map(d => [d.competency, d]));
  const bByComp = new Map(b.predictedDeltas.map(d => [d.competency, d]));
  const comps = new Set([...aByComp.keys(), ...bByComp.keys()]);
  const deltaChanges: DeltaChange[] = [];
  for (const c of comps) {
    const da = aByComp.get(c) ?? null;
    const db = bByComp.get(c) ?? null;
    if (!da || !db || !sameTo(da.to, db.to)) {
      deltaChanges.push({ competency: c, aTo: da?.to ?? null, bTo: db?.to ?? null });
    }
  }
  const aKeys = new Set(a.computedRipple.map(rippleKey));
  const bKeys = new Set(b.computedRipple.map(rippleKey));
  return {
    deltaChanges,
    rippleOnlyInA: a.computedRipple.filter(r => !bKeys.has(rippleKey(r))),
    rippleOnlyInB: b.computedRipple.filter(r => !aKeys.has(rippleKey(r))),
  };
}
