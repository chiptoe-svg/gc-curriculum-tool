import { describe, it, expect } from 'vitest';
import { pfForSnapshot, PF_CONTRACT_EPOCH } from '@/lib/db/scaffolding-queries';
import type { ProductiveFailureConditions } from '@/lib/program/scaffolding';

const BLOCK: ProductiveFailureConditions = {
  generate_then_consolidate: 'absent',
  open_ended_problems: 'absent',
  revision_cycles: 'absent',
  structured_post_mortem: 'absent',
  max_supporting_depth: 0,
  notes: [],
};

describe('pfForSnapshot legacy cutoff', () => {
  it('reclassifies a pre-epoch snapshot to null even when it carries a block', () => {
    const before = new Date(PF_CONTRACT_EPOCH.getTime() - 1000);
    expect(pfForSnapshot(before, BLOCK)).toBeNull();
  });

  it('passes a post-epoch block through unchanged', () => {
    const after = new Date(PF_CONTRACT_EPOCH.getTime() + 1000);
    expect(pfForSnapshot(after, BLOCK)).toBe(BLOCK);
  });

  it('passes a post-epoch null through as null', () => {
    const after = new Date(PF_CONTRACT_EPOCH.getTime() + 1000);
    expect(pfForSnapshot(after, null)).toBeNull();
  });
});
