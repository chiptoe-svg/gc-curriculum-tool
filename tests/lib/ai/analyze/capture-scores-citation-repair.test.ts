/**
 * Tests for repairCitationProvenance (issue #4): the synthesizer sometimes cites
 * an instructor turn by a synthetic id (`user_3`) — a correct reference in the
 * wrong format — which the strict citation schema rejected, discarding the whole
 * profile ("scoring failed"). Repair resolves those to the real message id, drops
 * genuinely-unresolvable citations, and downgrades an emptied finding to inferred.
 */
import { describe, it, expect } from 'vitest';
import { repairCitationProvenance } from '@/lib/ai/analyze/capture-scores';
import { CaptureProfileCitation } from '@/lib/ai/capture/schema';
import type { captureMessages } from '@/lib/db/schema';
import type { InferSelectModel } from 'drizzle-orm';

type Row = InferSelectModel<typeof captureMessages>;

// Minimal transcript — repair only reads id / role / turnIndex.
const transcript = [
  { id: '9017fff1-1111-4111-8111-111111111111', role: 'user', turnIndex: 3 },
  { id: '05dbe6f2-2222-4222-8222-222222222222', role: 'assistant', turnIndex: 2 },
] as unknown as Row[];

describe('repairCitationProvenance', () => {
  it('resolves a synthetic `user_3` instructor citation to the real message id (the issue #4 case)', () => {
    const raw = { citations: [{ type: 'instructor', messageId: 'user_3', excerpt: 'we build weekly design decks' }] };
    const { profile, repaired, dropped } = repairCitationProvenance(raw, transcript);
    const cit = (profile as { citations: Array<{ messageId: string }> }).citations[0]!;
    expect(cit.messageId).toBe('9017fff1-1111-4111-8111-111111111111');
    expect(repaired).toBe(1);
    expect(dropped).toBe(0);
    // and the repaired citation now passes the strict schema that had rejected it
    expect(() => CaptureProfileCitation.parse(cit)).not.toThrow();
  });

  it('drops a genuinely-unresolvable synthetic id and downgrades the emptied finding to inferred', () => {
    const raw = { source: 'instructor', citations: [{ type: 'instructor', messageId: 'user_99', excerpt: 'x' }] };
    const { profile, repaired, dropped } = repairCitationProvenance(raw, transcript);
    const p = profile as { source: string; citations: unknown[] };
    expect(p.citations).toHaveLength(0);
    expect(p.source).toBe('inferred'); // honest ungrounded, not "instructor"
    expect(repaired).toBe(0);
    expect(dropped).toBe(1);
  });

  it('leaves already-valid citations (real hex/uuid + chunk) untouched', () => {
    const raw = {
      source: 'materials',
      citations: [
        { type: 'instructor', messageId: '9017fff1', excerpt: 'a' }, // valid 8-char hex
        { type: 'chunk', chunkId: 'deadbeef', excerpt: 'b' },
      ],
    };
    const { profile, repaired, dropped } = repairCitationProvenance(raw, transcript);
    const p = profile as { source: string; citations: Array<Record<string, unknown>> };
    expect(p.citations).toHaveLength(2);
    expect(p.source).toBe('materials');
    expect(repaired).toBe(0);
    expect(dropped).toBe(0);
  });

  it('repairs nested citations (overview + per-competency) in one pass', () => {
    const raw = {
      overview: { source: 'instructor', citations: [{ type: 'instructor', messageId: 'user_3', excerpt: 'o' }] },
      competencies: [
        { name: 'X', citations: [{ type: 'instructor', messageId: 'assistant_2', excerpt: 'c' }] },
      ],
    };
    const { profile, repaired } = repairCitationProvenance(raw, transcript);
    const p = profile as {
      overview: { citations: Array<{ messageId: string }> };
      competencies: Array<{ citations: Array<{ messageId: string }> }>;
    };
    expect(p.overview.citations[0]!.messageId).toBe('9017fff1-1111-4111-8111-111111111111');
    expect(p.competencies[0]!.citations[0]!.messageId).toBe('05dbe6f2-2222-4222-8222-222222222222');
    expect(repaired).toBe(2);
  });
});
