import { describe, it, expect } from 'vitest';
import { parseLabels } from '@/lib/db/match-labels';
import { toCsv, toJsonl, toRecords } from '@/lib/db/match-export';
import type { Decision } from '@/lib/db/match-queries';

describe('parseLabels', () => {
  it('reads number + letter tokens, any case, any separator', () => {
    expect([...parseLabels('1F 2p, 3N\n10f')]).toEqual([[1, 'fully'], [2, 'partly'], [3, 'not'], [10, 'fully']]);
  });
  it('rejects a bad token and a repeated number', () => {
    expect(() => parseLabels('1X')).toThrow(/Cannot read "1X"/);
    expect(() => parseLabels('F1')).toThrow();
    expect(() => parseLabels('1F 1N')).toThrow(/twice/);
  });
});

describe('export format', () => {
  const row = (o: Partial<Decision>): Decision => ({
    id: 'a', requiredHash: 'r', suppliedHash: 's', requiredText: 'say "hi", ok', suppliedText: 'line\nbreak', requiredCourse: 'GC 2', requiredCourseTitle: 'Two',
    suppliedCourse: 'GC 1', suppliedCourseTitle: null, requiredSnapshotId: null, suppliedSnapshotId: null, label: 'fully', draft: false, planId: null,
    source: 'map', reason: null, decidedBy: 'me', decidedAt: new Date('2026-01-01T00:00:00Z'), judgeModel: 'm', promptVersion: 'm1', judgePFully: 0.5, judgePPartly: null, ...o,
  });
  it('marks the newest non-draft as latest; a draft is its own row', () => {
    const recs = toRecords([row({ id: 'a' }), row({ id: 'b', label: 'not', decidedAt: new Date('2026-01-02T00:00:00Z') }), row({ id: 'c', draft: true, decidedAt: new Date('2026-01-03T00:00:00Z') })]);
    expect(recs.map((r) => r.latest)).toEqual([false, true, true]);
  });
  it('quotes CSV cells and emits one JSON object per line', () => {
    const recs = toRecords([row({})]);
    const csv = toCsv(recs);
    expect(csv.split('\r\n')[0]).toMatch(/^required_text,supplied_text,/);
    expect(csv).toContain('"say ""hi"", ok","line\nbreak"');
    expect(toJsonl(recs).trim().split('\n')).toHaveLength(1);
  });
});
