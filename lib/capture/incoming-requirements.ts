import type { CaptureIncomingExpectation } from '@/lib/ai/capture/schema';

/**
 * Paste-ready syllabus lines from the profile's confirmed
 * `incoming_expectations` (2026-06-12 walkthrough: "one of the outputs of
 * this process should be a solid list of incoming requirements that could
 * be pasted into a syllabus" + "KUD would be really strange on a syllabus —
 * can you think of a way to encode it?").
 *
 * THE VOCABULARY IS THE ENCODING. Raw K2·U1·D3 notation reads as jargon on
 * a syllabus, so each (dimension, level) pair maps to exactly ONE fixed
 * verb phrase below, and a line is composed from the phrases for its
 * non-zero dimensions. Faculty read natural prose; the system can recover
 * the precise depths by reverse table lookup because the mapping is
 * bijective — no information is lost in translation. If you edit a phrase,
 * keep the 1:1 property (no two cells may share a phrase).
 *
 * DERIVED, not generated: no model call; retroactive on every profile.
 */

export const SYLLABUS_PHRASES = {
  k: {
    1: 'have seen the terminology',
    2: 'recognize the terminology',
    3: 'recall the key terms unprompted',
    4: 'use the terminology correctly',
    5: 'be fluent in the full vocabulary',
  },
  u: {
    1: 'follow an explanation of it',
    2: 'explain the why in your own words',
    3: 'predict what follows from it',
    4: 'reason through unfamiliar cases',
    5: 'critique and extend the idea',
  },
  d: {
    1: 'do it with step-by-step guidance',
    2: 'do it with a reference at hand',
    3: 'work independently',
    4: 'adapt it to new situations',
    5: 'do it creatively and guide others',
  },
} as const satisfies Record<'k' | 'u' | 'd', Record<1 | 2 | 3 | 4 | 5, string>>;

function phrase(dim: 'k' | 'u' | 'd', level: number | null): string | null {
  if (level == null || level < 1) return null;
  const capped = Math.min(level, 5) as 1 | 2 | 3 | 4 | 5;
  return SYLLABUS_PHRASES[dim][capped];
}

/** "a" / "a, and b" / "a, b, and c" */
function joinClauses(clauses: string[]): string {
  if (clauses.length <= 1) return clauses[0] ?? '';
  if (clauses.length === 2) return `${clauses[0]}, and ${clauses[1]}`;
  return `${clauses.slice(0, -1).join(', ')}, and ${clauses[clauses.length - 1]}`;
}

export function formatIncomingRequirements(
  expectations: ReadonlyArray<CaptureIncomingExpectation>,
): string[] {
  return expectations.map(exp => {
    const { k, u, d } = exp.expected_depth;
    const clauses = [phrase('k', k), phrase('u', u), phrase('d', d)].filter(
      (c): c is string => c !== null,
    );
    return clauses.length > 0
      ? `${exp.statement} — ${joinClauses(clauses)}.`
      : exp.statement;
  });
}
