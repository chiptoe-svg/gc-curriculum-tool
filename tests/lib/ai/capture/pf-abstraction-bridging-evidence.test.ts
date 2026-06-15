import { describe, it, expect } from 'vitest';
import { productiveFailureConditionsSchema } from '@/lib/ai/capture/schema';

// A valid baseline PF block (structured_post_mortem 'absent' so it needs no evidence).
const base = {
  generate_then_consolidate: 'present' as const,
  open_ended_problems: 'present' as const,
  revision_cycles: 'present' as const,
  structured_post_mortem: 'absent' as const,
  max_supporting_depth: 4,
  notes: [] as string[],
};
const validCite = { type: 'chunk' as const, chunkId: 'chunk-abc123', excerpt: 'compare two press faults, apply to a third' };

describe('abstraction_bridging condition', () => {
  it('back-compat: a PF block WITHOUT abstraction_bridging still parses (old snapshots)', () => {
    expect(productiveFailureConditionsSchema.safeParse(base).success).toBe(true);
  });

  it('rejects non-absent abstraction_bridging with no evidence', () => {
    const r = productiveFailureConditionsSchema.safeParse({ ...base, abstraction_bridging: 'present' });
    expect(r.success).toBe(false);
  });

  it('rejects non-absent abstraction_bridging with an empty evidence array', () => {
    const r = productiveFailureConditionsSchema.safeParse({ ...base, abstraction_bridging: 'partial', abstraction_bridging_evidence: [] });
    expect(r.success).toBe(false);
  });

  it('accepts non-absent abstraction_bridging with a resolvable citation', () => {
    const r = productiveFailureConditionsSchema.safeParse({ ...base, abstraction_bridging: 'present', abstraction_bridging_evidence: [validCite] });
    expect(r.success).toBe(true);
  });

  it('accepts absent abstraction_bridging with no evidence', () => {
    const r = productiveFailureConditionsSchema.safeParse({ ...base, abstraction_bridging: 'absent' });
    expect(r.success).toBe(true);
  });

  it('rejects a non-absent abstraction_bridging whose citation is structurally invalid', () => {
    const badCite = { type: 'chunk' as const, chunkId: null, excerpt: 'x' };
    const r = productiveFailureConditionsSchema.safeParse({ ...base, abstraction_bridging: 'present', abstraction_bridging_evidence: [badCite] });
    expect(r.success).toBe(false);
  });
});
