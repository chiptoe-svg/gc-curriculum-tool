/**
 * applyReconciliation — pure function that applies faculty-ACCEPTED
 * reconciliation proposals to one section of a CaptureProfile.
 *
 * Provenance discipline: any item a faculty edit MODIFIES or ADDS is
 * marked source:'instructor' with citations cleared — never silently
 * presented as materials-evidenced. The AI only proposed; this function
 * sets provenance.
 *
 * Refine compliance: when a faculty edit sets a depth above its evidence
 * threshold (k>1 / u>0 / d>0), the function writes the FACULTY_NOTE
 * sentinel as the evidence string so the captureCompetencySchema refines
 * pass. The evidence band derives 'claimed' from source+citations (not
 * evidence_*), so the sentinel does not fake materials-evidence.
 */

import type { CaptureProfile, CaptureCompetency, CaptureIncomingExpectation } from '@/lib/ai/capture/schema';
import type { ReconcileProposal, ReconcileSection } from '@/lib/ai/schemas';

const FACULTY_NOTE = 'Asserted by faculty during reconciliation.';

/** Clamp an integer to [0, 5]; returns null if input is null/undefined. */
function clampDepth(n: number | null | undefined): number | null {
  if (n === null || n === undefined) return null;
  return Math.max(0, Math.min(5, Math.trunc(n)));
}

// ---------------------------------------------------------------------------
// Outgoing (competencies)
// ---------------------------------------------------------------------------

function applyOutgoing(
  competencies: CaptureProfile['competencies'],
  accepted: ReconcileProposal[],
): CaptureProfile['competencies'] {
  // Build index lookup for modify/remove actions
  const byIndex = new Map<number, ReconcileProposal>();
  const adds: ReconcileProposal[] = [];

  for (const proposal of accepted) {
    if (proposal.action === 'add') {
      adds.push(proposal);
    } else if ((proposal.action === 'modify' || proposal.action === 'remove') && proposal.index !== null) {
      byIndex.set(proposal.index, proposal);
    }
    // 'keep' and unindexed actions: ignored
  }

  const result: CaptureCompetency[] = [];

  for (let i = 0; i < competencies.length; i++) {
    const it = competencies[i]!;
    const proposal = byIndex.get(i);

    if (!proposal) {
      result.push(it);
      continue;
    }

    if (proposal.action === 'remove') {
      // Drop the item
      continue;
    }

    if (proposal.action === 'modify') {
      const revised = proposal.revised;
      if (!revised) {
        result.push(it);
        continue;
      }

      const foundational = it.type === 'foundational';

      // ── K depth ──────────────────────────────────────────────────────────
      let k_depth: number | null;
      let evidence_k: string | null;
      if (foundational) {
        k_depth = null;
        evidence_k = null;
      } else if (revised.k !== null) {
        k_depth = clampDepth(revised.k);
        evidence_k = (k_depth !== null && k_depth > 1) ? FACULTY_NOTE : null;
      } else {
        k_depth = it.k_depth;
        evidence_k = it.evidence_k ?? null;
      }

      // ── U depth ──────────────────────────────────────────────────────────
      let u_depth: number | null;
      let evidence_u: string | null;
      if (foundational) {
        u_depth = null;
        evidence_u = null;
      } else if (revised.u !== null) {
        u_depth = clampDepth(revised.u);
        evidence_u = (u_depth !== null && u_depth > 0) ? FACULTY_NOTE : null;
      } else {
        u_depth = it.u_depth;
        evidence_u = it.evidence_u ?? null;
      }

      // ── D depth ──────────────────────────────────────────────────────────
      let d_depth: number;
      let evidence_d: string | null;
      if (revised.d !== null) {
        d_depth = clampDepth(revised.d) ?? it.d_depth;
        evidence_d = d_depth > 0 ? FACULTY_NOTE : null;
      } else {
        d_depth = it.d_depth;
        evidence_d = it.evidence_d ?? null;
      }

      result.push({
        statement: revised.statement ?? it.statement,
        type: it.type,
        k_depth,
        u_depth,
        d_depth,
        evidence_k,
        evidence_u,
        evidence_d,
        rationale: it.rationale,
        source: 'instructor',
        citations: [],
      } as CaptureCompetency);
      continue;
    }

    // 'keep' reached via byIndex — shouldn't happen but treat as keep
    result.push(it);
  }

  // ── Adds ─────────────────────────────────────────────────────────────────
  for (const proposal of adds) {
    const revised = proposal.revised;
    if (!revised || !revised.statement || revised.statement.trim() === '') continue;

    const kd = clampDepth(revised.k);
    const ud = clampDepth(revised.u);
    const dd = clampDepth(revised.d) ?? 0;

    result.push({
      statement: revised.statement,
      type: 'technical',
      k_depth: kd,
      u_depth: ud,
      d_depth: dd,
      evidence_k: (kd !== null && kd > 1) ? FACULTY_NOTE : null,
      evidence_u: (ud !== null && ud > 0) ? FACULTY_NOTE : null,
      evidence_d: dd > 0 ? FACULTY_NOTE : null,
      rationale: FACULTY_NOTE,
      source: 'instructor',
      citations: [],
    } as CaptureCompetency);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Incoming expectations
// ---------------------------------------------------------------------------

function applyIncoming(
  expectations: CaptureProfile['incoming_expectations'],
  accepted: ReconcileProposal[],
): CaptureProfile['incoming_expectations'] {
  const byIndex = new Map<number, ReconcileProposal>();
  const adds: ReconcileProposal[] = [];

  for (const proposal of accepted) {
    if (proposal.action === 'add') {
      adds.push(proposal);
    } else if ((proposal.action === 'modify' || proposal.action === 'remove') && proposal.index !== null) {
      byIndex.set(proposal.index, proposal);
    }
  }

  const result: CaptureIncomingExpectation[] = [];

  for (let i = 0; i < expectations.length; i++) {
    const it = expectations[i]!;
    const proposal = byIndex.get(i);

    if (!proposal) {
      result.push(it);
      continue;
    }

    if (proposal.action === 'remove') {
      continue;
    }

    if (proposal.action === 'modify') {
      const revised = proposal.revised;
      if (!revised) {
        result.push(it);
        continue;
      }

      const newK = revised.k !== null ? clampDepth(revised.k) : it.expected_depth.k;
      const newU = revised.u !== null ? clampDepth(revised.u) : it.expected_depth.u;
      const newD = revised.d !== null ? (clampDepth(revised.d) ?? it.expected_depth.d) : it.expected_depth.d;

      result.push({
        statement: revised.statement ?? it.statement,
        expected_depth: { k: newK, u: newU, d: newD },
        evidenced_by: (it.evidenced_by && it.evidenced_by.length > 0) ? it.evidenced_by : [FACULTY_NOTE],
        confidence: it.confidence,
        source: 'instructor',
        citations: [],
      } as CaptureIncomingExpectation);
      continue;
    }

    result.push(it);
  }

  // Adds
  for (const proposal of adds) {
    const revised = proposal.revised;
    if (!revised || !revised.statement || revised.statement.trim() === '') continue;

    result.push({
      statement: revised.statement,
      expected_depth: {
        k: clampDepth(revised.k),
        u: clampDepth(revised.u),
        d: clampDepth(revised.d) ?? 0,
      },
      evidenced_by: [FACULTY_NOTE],
      confidence: 'low',
      source: 'instructor',
      citations: [],
    } as CaptureIncomingExpectation);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Apparent outcomes (revised_objectives_draft — plain strings)
// ---------------------------------------------------------------------------

function applyApparentOutcomes(
  draft: string[] | null,
  accepted: ReconcileProposal[],
): string[] {
  const items = draft ?? [];

  const byIndex = new Map<number, ReconcileProposal>();
  const adds: ReconcileProposal[] = [];

  for (const proposal of accepted) {
    if (proposal.action === 'add') {
      adds.push(proposal);
    } else if ((proposal.action === 'modify' || proposal.action === 'remove') && proposal.index !== null) {
      // Only record if index is in-bounds; out-of-bounds modifications are ignored
      if (proposal.index >= 0 && proposal.index < items.length) {
        byIndex.set(proposal.index, proposal);
      }
    }
    // 'keep' and bad-index entries: ignored
  }

  const result: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const proposal = byIndex.get(i);

    if (!proposal) {
      result.push(item);
      continue;
    }

    if (proposal.action === 'remove') {
      continue;
    }

    if (proposal.action === 'modify') {
      const stmt = proposal.revised?.statement;
      if (stmt && stmt.trim() !== '') {
        result.push(stmt);
      } else {
        result.push(item); // no-op if no replacement statement
      }
      continue;
    }

    result.push(item);
  }

  // Adds
  for (const proposal of adds) {
    const stmt = proposal.revised?.statement;
    if (stmt && stmt.trim() !== '') {
      result.push(stmt);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Pure function. Returns a new CaptureProfile (input is never mutated)
 * with the accepted reconciliation proposals applied to `section`.
 *
 * Every modified or added item is stamped source:'instructor' and citations:[].
 * Evidence strings are written where refines require them (k>1, u>0, d>0).
 */
export function applyReconciliation(
  profile: CaptureProfile,
  section: ReconcileSection,
  accepted: ReconcileProposal[],
): CaptureProfile {
  switch (section) {
    case 'outgoing':
      return { ...profile, competencies: applyOutgoing(profile.competencies, accepted) };

    case 'incoming':
      return { ...profile, incoming_expectations: applyIncoming(profile.incoming_expectations, accepted) };

    case 'apparent_outcomes':
      return { ...profile, revised_objectives_draft: applyApparentOutcomes(profile.revised_objectives_draft, accepted) };
  }
}
