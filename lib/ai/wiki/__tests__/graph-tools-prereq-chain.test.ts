import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/prerequisite-edge-queries', () => ({ listEdgePairs: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/db/program-coverage-queries', () => ({ getMatrixData: vi.fn() }));
vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({
      from: async () => [
        { code: 'GC 1040', prerequisites: '' },
        { code: 'GC 3460', prerequisites: 'GC 1040' },
        { code: 'GC 4060', prerequisites: 'GC 3460' },
        { code: 'GC 4070', prerequisites: 'GC 3460, GC 4060' },
        { code: 'GC 4400', prerequisites: 'GC 3460' },
      ],
    }),
  },
}));

import { prereqChainTool } from '@/lib/ai/wiki/graph-tools';

describe('prereq_chain', () => {
  it("returns GC 3460's real neighbors when prerequisite_edges is empty", async () => {
    const out = await prereqChainTool.execute({ courseCode: 'GC 3460' }) as {
      directPrereqs: string[]; requiredBy: string[];
    };
    expect(out.directPrereqs).toEqual(['GC 1040']);
    expect([...out.requiredBy].sort()).toEqual(['GC 4060', 'GC 4070', 'GC 4400']);
  });
});
