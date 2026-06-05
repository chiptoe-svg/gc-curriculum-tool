import { describe, it, expect } from 'vitest';
import { productiveFailureConditionsSchema } from '@/lib/ai/capture/schema';

const base = {
  generate_then_consolidate: 'present' as const,
  open_ended_problems: 'present' as const,
  revision_cycles: 'present' as const,
  max_supporting_depth: 4,
  notes: [] as string[],
};
const validCite = { type: 'chunk' as const, chunkId: 'chunk-abc123', excerpt: 'graded post-mortem memo' };

describe('structured_post_mortem evidence requirement', () => {
  it('rejects non-absent reflection with no evidence', () => {
    const r = productiveFailureConditionsSchema.safeParse({ ...base, structured_post_mortem: 'present' });
    expect(r.success).toBe(false);
  });

  it('rejects non-absent reflection with an empty evidence array', () => {
    const r = productiveFailureConditionsSchema.safeParse({
      ...base, structured_post_mortem: 'partial', structured_post_mortem_evidence: [],
    });
    expect(r.success).toBe(false);
  });

  it('accepts non-absent reflection with a resolvable citation', () => {
    const r = productiveFailureConditionsSchema.safeParse({
      ...base, structured_post_mortem: 'present', structured_post_mortem_evidence: [validCite],
    });
    expect(r.success).toBe(true);
  });

  it('accepts absent reflection with no evidence', () => {
    const r = productiveFailureConditionsSchema.safeParse({ ...base, structured_post_mortem: 'absent' });
    expect(r.success).toBe(true);
  });

  it('rejects a non-absent reflection whose citation is structurally invalid (chunk, no chunkId)', () => {
    // Proves the citation provenance rule composes with the new requirement —
    // a semantically invalid citation cannot satisfy the "at least one citation" gate.
    const badCite = { type: 'chunk' as const, chunkId: null, excerpt: 'x' };
    const r = productiveFailureConditionsSchema.safeParse({
      ...base, structured_post_mortem: 'present', structured_post_mortem_evidence: [badCite],
    });
    expect(r.success).toBe(false);
  });
});
