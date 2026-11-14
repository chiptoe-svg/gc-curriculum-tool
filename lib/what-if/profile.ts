import type { CaptureProfile } from '@/lib/ai/capture/schema';
import { normalizeCompetencyKey } from '@/lib/ai/explore/run-impact';
import type { Kud, WhatIfEstimate, WhatIfProfile, WhatIfRating } from './types';

const sameKud = (a: Kud, b: Kud) => a.k === b.k && a.u === b.u && a.d === b.d;

/** K and U are always null on a foundational competency (it is rated on Do only). */
function shape(type: WhatIfRating['type'], kud: Kud): Kud {
  return type === 'foundational' ? { k: null, u: null, d: kud.d } : { ...kud };
}

/**
 * The what-if profile: the approved profile with the estimate applied. Pure.
 * Every "before" value and every untouched rating comes from the approved
 * profile; the estimate only supplies predicted values.
 */
export function buildWhatIfProfile(
  approved: CaptureProfile,
  estimate: WhatIfEstimate,
  activeCatalogIds: Set<string>,
): WhatIfProfile {
  const ratings: WhatIfRating[] = approved.competencies.map(c => ({
    statement: c.statement,
    type: c.type,
    status: 'approved',
    kud: { k: c.k_depth, u: c.u_depth, d: c.d_depth },
    before: { k: c.k_depth, u: c.u_depth, d: c.d_depth },
    confidence: null,
    reason: null,
    subCompetencyId: null,
    linked: false,
  }));
  const byKey = new Map<string, number>();
  ratings.forEach((r, i) => {
    const key = normalizeCompetencyKey(r.statement);
    if (!byKey.has(key)) byKey.set(key, i);
  });

  const seen = new Set<string>();
  for (const m of estimate.movedRatings) {
    const key = normalizeCompetencyKey(m.statement);
    if (seen.has(key)) continue; // first entry wins
    seen.add(key);
    const idx = byKey.get(key);
    if (idx === undefined) {
      // The estimate named something the approved profile does not have: a new rating.
      ratings.push({
        statement: m.statement.trim(), type: 'technical', status: 'new',
        kud: shape('technical', m.after), before: null,
        confidence: m.confidence, reason: m.reason, subCompetencyId: null, linked: false,
      });
      continue;
    }
    const current = ratings[idx]!;
    const before = current.before!;
    const after = shape(current.type, {
      k: m.after.k ?? before.k, u: m.after.u ?? before.u, d: m.after.d ?? before.d,
    });
    if (sameKud(after, before)) continue; // no real move: stays approved
    ratings[idx] = { ...current, status: 'moved', kud: after, confidence: m.confidence, reason: m.reason };
  }

  for (const n of estimate.newCompetencies) {
    const linked = n.subCompetencyId !== null && activeCatalogIds.has(n.subCompetencyId);
    ratings.push({
      statement: n.statement.trim(), type: n.type, status: 'new',
      kud: shape(n.type, n.predicted), before: null,
      confidence: n.confidence, reason: n.reason,
      subCompetencyId: linked ? n.subCompetencyId : null, linked,
    });
  }

  return {
    ratings,
    incomingChanges: estimate.incomingChanges.map(c => ({
      ...c, linked: c.subCompetencyId !== null && activeCatalogIds.has(c.subCompetencyId),
    })),
  };
}
