/**
 * The interview checklist shown beside the chat (owner, 2026-10-28).
 *
 * Built from the interviewer's per-turn `readiness` lists. "Still to cover" is
 * the latest `remaining` list and may change every turn. "Covered" keeps every
 * item the interviewer has ever checked off, newest first, so the instructor
 * sees progress accumulate; an item the interviewer puts back on `remaining`
 * leaves Covered (it was reopened). Labels are free text and matched exactly.
 */
export interface InterviewChecklist {
  covered: string[];
  remaining: string[];
}

export interface ReadinessLists {
  covered: string[];
  remaining: string[];
}

export const EMPTY_CHECKLIST: InterviewChecklist = { covered: [], remaining: [] };

const clean = (labels: string[]) => [...new Set(labels.map(l => l.trim()).filter(Boolean))];

/** Apply one turn's readiness lists. `justCovered` = items checked off this turn. */
export function nextChecklist(
  prev: InterviewChecklist,
  turn: ReadinessLists,
): { checklist: InterviewChecklist; justCovered: string[] } {
  const remaining = clean(turn.remaining);
  const open = new Set(remaining);
  const justCovered = clean(turn.covered).filter(c => !open.has(c) && !prev.covered.includes(c));
  const covered = [...justCovered.slice().reverse(), ...prev.covered].filter(c => !open.has(c));
  return { checklist: { covered, remaining }, justCovered };
}

/** Rebuild the checklist from the stored replies, oldest first (null = a reply without readiness). */
export function checklistFromReplies(replies: Array<ReadinessLists | null>): InterviewChecklist {
  return replies.reduce<InterviewChecklist>(
    (acc, r) => (r ? nextChecklist(acc, r).checklist : acc),
    EMPTY_CHECKLIST,
  );
}

/** The readiness lists in one stored interviewer reply (capture_messages
 *  content = the AuditResponse JSON), or null when it has none. */
export function readinessFromStoredReply(content: string | null): ReadinessLists | null {
  if (!content) return null;
  try {
    const r = (JSON.parse(content) as { readiness?: { covered?: unknown; remaining?: unknown } }).readiness;
    if (!r || !Array.isArray(r.covered) || !Array.isArray(r.remaining)) return null;
    return { covered: r.covered.filter((x): x is string => typeof x === 'string'), remaining: r.remaining.filter((x): x is string => typeof x === 'string') };
  } catch {
    return null;
  }
}
