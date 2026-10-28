import { describe, it, expect } from 'vitest';
import { nextChecklist, checklistFromReplies, EMPTY_CHECKLIST } from '@/lib/capture/interview-checklist';

/** The interview checklist (owner, 2026-10-28): "Still to cover" is the
 *  interviewer's latest list and may change every turn; "Covered" keeps every
 *  item ever checked off, newest first, unless the interviewer reopens it. */
describe('nextChecklist', () => {
  it('still-to-cover is the latest list; covered items are kept across turns', () => {
    const a = nextChecklist(EMPTY_CHECKLIST, { covered: ['Theme: branding'], remaining: ['Incoming skills', 'Theme: palletization'] });
    const b = nextChecklist(a.checklist, { covered: ['Theme: prototyping'], remaining: ['Theme: palletization'] });
    expect(b.checklist.remaining).toEqual(['Theme: palletization']);
    expect(b.checklist.covered).toEqual(['Theme: prototyping', 'Theme: branding']);
  });

  it('reports what was just checked off', () => {
    const a = nextChecklist(EMPTY_CHECKLIST, { covered: ['A'], remaining: [] });
    const b = nextChecklist(a.checklist, { covered: ['A', 'B'], remaining: [] });
    expect(a.justCovered).toEqual(['A']);
    expect(b.justCovered).toEqual(['B']);
  });

  it('an item the interviewer reopens leaves Covered and shows as still to cover', () => {
    const a = nextChecklist(EMPTY_CHECKLIST, { covered: ['Incoming skills'], remaining: [] });
    const b = nextChecklist(a.checklist, { covered: [], remaining: ['Incoming skills'] });
    expect(b.checklist.covered).toEqual([]);
    expect(b.checklist.remaining).toEqual(['Incoming skills']);
  });

  it('ignores blank and duplicate labels', () => {
    const a = nextChecklist(EMPTY_CHECKLIST, { covered: ['A', 'A', ' '], remaining: ['B', 'B', ''] });
    expect(a.checklist).toEqual({ covered: ['A'], remaining: ['B'] });
  });
});

describe('checklistFromReplies', () => {
  it('rebuilds the checklist from the stored replies, in order', () => {
    expect(checklistFromReplies([
      { covered: ['A'], remaining: ['B', 'C'] },
      { covered: ['B'], remaining: ['C'] },
      null,
      { covered: [], remaining: ['C', 'D'] },
    ])).toEqual({ covered: ['B', 'A'], remaining: ['C', 'D'] });
  });
  it('is empty with no replies', () => {
    expect(checklistFromReplies([])).toEqual(EMPTY_CHECKLIST);
  });
});

describe('readinessFromStoredReply', () => {
  it('reads the readiness lists from a stored interviewer reply (AuditResponse JSON)', async () => {
    const { readinessFromStoredReply } = await import('@/lib/capture/interview-checklist');
    expect(readinessFromStoredReply(JSON.stringify({ finding: 'x', readiness: { score: 40, covered: ['A'], remaining: ['B'] } })))
      .toEqual({ covered: ['A'], remaining: ['B'] });
  });
  it('null for anything else', async () => {
    const { readinessFromStoredReply } = await import('@/lib/capture/interview-checklist');
    expect(readinessFromStoredReply(null)).toBeNull();
    expect(readinessFromStoredReply('plain text')).toBeNull();
    expect(readinessFromStoredReply(JSON.stringify({ finding: 'x' }))).toBeNull();
    expect(readinessFromStoredReply(JSON.stringify({ readiness: { covered: 'A', remaining: [] } }))).toBeNull();
  });
});
